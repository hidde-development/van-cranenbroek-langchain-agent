import { writePageTool } from '../lib/tools/write-page.js';
import { fetchUrlTool } from '../lib/tools/fetch-url.js';
import { consolidateTool } from '../lib/tools/consolidate.js';
import { normalizeUrl } from '../lib/tools/load-knowledge.js';

export const config = { maxDuration: 300 };

function checkAuth(req, res) {
  const key = process.env.AGENT_API_KEY;
  if (!key) return true;
  const token = (req.headers['authorization'] || '').replace('Bearer ', '');
  if (token !== key) { res.status(401).json({ error: 'Unauthorized' }); return false; }
  return true;
}

// Bronpagina's ophalen + consolideren tot één werkbare brief.
// Retourneert { brief, failed, consolidateFailed }.
// Geen sources → brief blijft zoals hij is.
// 1 source  → bronpagina als context aan brief toegevoegd.
// 2+ sources → consolidate_sources samenvatting + brief als aanvulling.
//             Bij consolidate-fout: fallback op simpele concatenatie (verlies geen content).
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
  // 2+ gefetcht → probeer consolideren
  let consolidateFailed = false;
  try {
    const c = JSON.parse(await consolidateTool.func({ sources: fetched, topic: pageType + " over " + url }));
    if (c.success) return { brief: c.brief + (brief ? "\n\nAanvullende opdracht:\n" + brief : ""), failed, consolidateFailed: false };
    consolidateFailed = true;
  } catch (_) { consolidateFailed = true; }
  // Fallback: concateneer ruwe content zodat de writer iets heeft om mee te werken.
  const concatenated = fetched.map(f => "## " + (f.title || f.url) + "\n" + f.content).join("\n\n---\n\n");
  return { brief: "Bronpagina's (consolidatie mislukt — ruwe inhoud):\n\n" + concatenated + (brief ? "\n\nAanvullende opdracht:\n" + brief : ""), failed, consolidateFailed };
}

// write_page direct aanroepen (niet via agent.invoke). Voorkomt schema-mismatches:
// LangChain liet de LLM tool-args invullen op basis van natuurlijke taal,
// waarbij verplichte velden incidenteel ontbraken. Direct aanroepen passeert
// alle gestructureerde velden 1-op-1.
async function callWritePage({ brief, pageType, url, keywords, templateCode, style }) {
  const styledBrief = (brief || "") + (style ? "\n\nStijl: " + style : "");
  const out = JSON.parse(await writePageTool.func({
    brief: styledBrief, pageType, url, keywords: keywords || "", templateCode: templateCode || null
  }));
  if (!out.success) throw new Error(out.error || "write_page faalde");
  return out.page;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!checkAuth(req, res)) return;

  const { url, pageType = "dienstpagina", keywords = "", brief = "", sources = [], style = "feitelijk", templateCode = null } = req.body || {};
  // Invoerlimieten — voorkomt onverwacht grote Claude-calls en kostenoverschrijding.
  const safeBrief    = String(brief    || "").slice(0, 8000);
  const safeKeywords = String(keywords || "").slice(0, 500);
  const safeSources  = Array.isArray(sources) ? sources.slice(0, 5).map(normalizeUrl) : [];
  const safeUrl      = url ? normalizeUrl(url) : url;

  try {
    const { brief: enrichedBrief, failed: sourcesFailed, consolidateFailed } = await prepareBrief({ brief: safeBrief, sources: safeSources, pageType, url: safeUrl });
    const page = await callWritePage({ brief: enrichedBrief, pageType, url: safeUrl, keywords: safeKeywords, templateCode, style });
    const warnings = [];
    if (sourcesFailed.length) warnings.push("Niet bereikbare bronpagina's (403/timeout/DNS): " + sourcesFailed.join(", "));
    if (consolidateFailed) warnings.push("Consolidatie van bronpagina's mislukt — ruwe inhoud is gebruikt in plaats van AI-samenvatting.");
    return res.status(200).json({ success: true, content: page.content, page, style, ...(warnings.length ? { warnings } : {}), ...(sourcesFailed.length ? { sourceWarnings: sourcesFailed } : {}) });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}