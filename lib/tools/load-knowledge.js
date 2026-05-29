/**
 * TOOL: load_knowledge
 * Databron: knowledge/-map (brand.md, seo.md, templates.md, knowledge.md)
 * Gebruik wanneer: je merk-, SEO-, template- of productinfo nodig hebt als context
 * Gebruik NIET voor: het schrijven van content of ophalen van externe URL's
 * Input: { file: "brand"|"seo"|"templates"|"knowledge"|"all" }
 * Succes: { success: true, file, content }
 * Fout:   { success: false, error, hint }
 */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { readFile } from 'fs/promises';
// readFile (async) i.p.v. readFileSync — blokkeert de event loop niet in serverless.
import { join } from 'path';

// process.cwd() = projectroot in Vercel; __dirname werkt niet betrouwbaar in ESM-functies
const KNOWLEDGE_DIR = join(process.cwd(), 'knowledge');
const TEMPLATES_DIR = join(process.cwd(), 'templates');
const BASE_URL = 'https://www.vancranenbroek.com';

export function normalizeUrl(url) {
  if (!url || typeof url !== 'string') return url;
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^www\./i.test(trimmed)) return 'https://' + trimmed;
  if (/^vancranenbroek\.com/i.test(trimmed)) return 'https://' + trimmed;
  if (/^\//.test(trimmed)) return BASE_URL + trimmed;
  if (/^[a-z0-9][^\s]*$/i.test(trimmed) && trimmed.includes('/')) return BASE_URL + '/' + trimmed;
  return trimmed;
}

export function toRelativeUrl(url) {
  if (!url || typeof url !== 'string') return url;
  try {
    const u = new URL(url, BASE_URL);
    return u.pathname + u.search + u.hash;
  } catch {
    return url;
  }
}

function normalizeRelativeUrls(content) {
  if (typeof content !== 'string') return content;
  return content.replace(/(^|[\s([{])\/([a-z0-9][^\s)\]'"]*)/gi, (match, prefix, path) => prefix + BASE_URL + '/' + path);
}

function normalizeKnowledgeContent(content) {
  return normalizeRelativeUrls(content);
}

export async function readKnowledge() {
  const read = async name => {
    try { return normalizeKnowledgeContent(await readFile(join(KNOWLEDGE_DIR, name + '.md'), 'utf8')); }
    catch { return '# ' + name + '.md\n_Bestand niet gevonden_'; }
  };
  const [brand, seo, templates, knowledge] = await Promise.all([read('brand'), read('seo'), read('templates'), read('knowledge')]);
  return { brand, seo, templates, knowledge };
}

// Klantspecifieke template uit templates/Tnn.md (parsedSheet-derived).
// Retourneert null als bestand niet bestaat — caller mag dan terugvallen op templates.md.
export async function readTemplate(code) {
  if (!code || !/^T\d+/i.test(String(code))) return null;
  try { return await readFile(join(TEMPLATES_DIR, code + '.md'), 'utf8'); }
  catch { return null; }
}

// Briefing voor één URL uit knowledge/briefings.md (parsedSheet-derived).
// Retourneert de tekst van de H2-sectie, of null als URL niet voorkomt.
export async function readBriefing(url) {
  if (!url) return null;
  try {
    const all = await readFile(join(KNOWLEDGE_DIR, 'briefings.md'), 'utf8');
    const candidates = [...new Set([url, normalizeUrl(url), toRelativeUrl(url), toRelativeUrl(normalizeUrl(url))].filter(Boolean))];
    for (const candidate of candidates) {
      const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp('## ' + escaped + '\\n([\\s\\S]*?)(?=\\n## |$)');
      const m = all.match(re);
      if (m) return normalizeKnowledgeContent(m[1].trim());
    }
    return null;
  } catch { return null; }
}

export const loadKnowledgeTool = tool(
  async ({ file }) => {
    try {
      const k = await readKnowledge();
      const content = file === 'all'
        ? Object.entries(k).map(([n, v]) => '## ' + n + '.md\n' + v).join('\n\n---\n\n')
        : k[file] ?? ('Bestand "' + file + '.md" niet gevonden.');
      return JSON.stringify({ success: true, file, content });
    } catch (err) {
      return JSON.stringify({ success: false, error: err.message, hint: 'Controleer of de knowledge/-map aanwezig is.' });
    }
  },
  {
    name: 'load_knowledge',
    description: 'Laad brand-, SEO-, template- of productkennis. Gebruik dit als context voordat je een pagina schrijft.',
    schema: z.object({
      file: z.enum(['brand','seo','templates','knowledge','all'])
    })
  }
);