import { writePageTool }   from '../lib/tools/write-page.js';
import { fetchUrlTool }    from '../lib/tools/fetch-url.js';
import { consolidateTool } from '../lib/tools/consolidate.js';

export const config = { maxDuration: 300 };

function checkAuth(req, res) {
  const key = process.env.AGENT_API_KEY;
  if (!key) return true;
  const token = (req.headers['authorization'] || '').replace('Bearer ', '');
  if (token !== key) { res.status(401).json({ error: 'Unauthorized' }); return false; }
  return true;
}

// Bronpagina ophalen en samenvoegen tot een brief (identiek patroon als api/agent.js).
// Retourneert { brief, failed, consolidateFailed } — silent failures worden zichtbaar gemaakt.
async function prepareBrief({ brief, sources, pageType, url }) {
  if (!sources || !sources.length) return { brief: brief || "", failed: [], consolidateFailed: false };
  // Parallelle source-fetches — voorkomt dat N sources × 10s sequentieel cumuleren.
  // Promise.allSettled zodat één faal-URL de andere niet meesleurt.
  const results = await Promise.allSettled(sources.map(u => fetchUrlTool.func({ url: u }).then(r => ({ u, r: JSON.parse(r) }))));
  const fetched = [];
  const failed = [];
  results.forEach((res, i) => {
    const u = sources[i];
    if (res.status === 'fulfilled' && res.value.r.success) {
      fetched.push({ url: u, title: res.value.r.title || "", content: res.value.r.content || "" });
    } else {
      failed.push(u);
    }
  });
  if (fetched.length === 0) return { brief: brief || "", failed, consolidateFailed: false };
  if (fetched.length === 1) {
    return { brief: "Bronpagina:\n" + fetched[0].content + (brief ? "\n\nAanvullende opdracht:\n" + brief : ""), failed, consolidateFailed: false };
  }
  let consolidateFailed = false;
  try {
    const c = JSON.parse(await consolidateTool.func({ sources: fetched, topic: pageType + " over " + url }));
    if (c.success) return { brief: c.brief + (brief ? "\n\nAanvullende opdracht:\n" + brief : ""), failed, consolidateFailed: false };
    consolidateFailed = true;
  } catch (_) { consolidateFailed = true; }
  // Fallback: concateneer ruwe content (geen verlies van source-content).
  const concatenated = fetched.map(f => "## " + (f.title || f.url) + "\n" + f.content).join("\n\n---\n\n");
  return { brief: "Bronpagina's (consolidatie mislukt — ruwe inhoud):\n\n" + concatenated + (brief ? "\n\nAanvullende opdracht:\n" + brief : ""), failed, consolidateFailed };
}

// write_page direct aanroepen — geen agent.invoke, voorkomt schema-mismatches.
async function callWritePage({ brief, pageType, url, keywords, templateCode }) {
  const out = JSON.parse(await writePageTool.func({
    brief: brief || "", pageType, url, keywords: keywords || "", templateCode: templateCode || null
  }));
  if (!out.success) throw new Error(out.error || "write_page faalde");
  return out.page;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!checkAuth(req, res)) return;

  // pages: [{url, keywords, templateCode}] — per-pagina overschrijft globals.
  // urls: legacy array van URL-strings (backwards compat).
  const { urls = [], pages = null, completed = [], batchSize = 3, pageType = "dienstpagina", keywords = "" } = req.body || {};

  // Normalize: pages[] nemen voorrang; urls[] worden omgezet zonder per-pagina metadata.
  const allPages = Array.isArray(pages) && pages.length
    ? pages
    : urls.map(u => ({ url: u, keywords, templateCode: null }));

  const allUrls = allPages.map(p => p.url);
  const remaining = allPages.filter(p => !completed.includes(p.url));
  // Cap op 5 per batch — voorkomt runaway API-kosten en Vercel-timeout.
  const batch = remaining.slice(0, Math.min(batchSize, 5));

  if (!batch.length) {
    return res.status(200).json({ done: true, completed, remaining: [], results: [], progress: { total: allUrls.length, done: allUrls.length } });
  }

  const results = [];

  for (const entry of batch) {
    const { url, keywords: pgKw, templateCode: pgTpl } = entry;
    // Per-pagina keywords/template pakken prioriteit over globals.
    const effectiveKw  = pgKw  || keywords;
    const effectivePt  = pgTpl || pageType;
    try {
      const brief = "Herschrijf deze pagina volledig op basis van de merkregels en templates.\nURL: " + url + "\nPaginatype: " + effectivePt + "\nZoekwoorden: " + effectiveKw;
      const { brief: enrichedBrief, failed: pageSourcesFailed, consolidateFailed } = await prepareBrief({ brief, sources: [url], pageType: effectivePt, url });
      const page = await callWritePage({ brief: enrichedBrief, pageType: effectivePt, url, keywords: effectiveKw, templateCode: pgTpl || null });
      // Per-pagina warnings — zo blijven silent failures zichtbaar in de bulk-resultaten.
      const warnings = [];
      if (pageSourcesFailed.length) warnings.push("Bronpagina niet bereikbaar: " + pageSourcesFailed.join(", "));
      if (consolidateFailed)        warnings.push("Consolidatie mislukt — ruwe inhoud gebruikt.");
      results.push({ url, success: true, content: page.content, page, ...(warnings.length ? { warnings } : {}) });
    } catch (err) {
      results.push({ url, success: false, error: err.message });
    }
  }

  const newCompleted = [...completed, ...batch.map(e => e.url)];
  const done = newCompleted.length >= allUrls.length;

  return res.status(200).json({
    done,
    completed: newCompleted,
    remaining: remaining.slice(batch.length).map(e => e.url),
    results,
    progress: { total: allUrls.length, done: newCompleted.length },
  });
}