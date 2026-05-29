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

export async function readKnowledge() {
  const read = async name => {
    try { return await readFile(join(KNOWLEDGE_DIR, name + '.md'), 'utf8'); }
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
    const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('## ' + escaped + '\\n([\\s\\S]*?)(?=\\n## |$)');
    const m = all.match(re);
    return m ? m[1].trim() : null;
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