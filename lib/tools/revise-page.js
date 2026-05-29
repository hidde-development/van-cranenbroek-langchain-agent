/**
 * TOOL: revise_page
 * Databron: knowledge/-map (brand, seo, knowledge — geen templates)
 * Gebruik wanneer: V1-output moet worden herzien op basis van critic-feedback
 * Behoudt structuur, koppen, alinea's en URLs van V1 tenzij critic flagt
 * Input: { pageType, url, keywords, v1Content, criticFeedback, allowedNewUrls }
 * Succes: { success: true, page: {...}, warnings? }
 */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { ChatAnthropic } from '@langchain/anthropic';
import { readKnowledge, readBriefing } from './load-knowledge.js';

const model = new ChatAnthropic({ apiKey: process.env.Claude ?? process.env.ANTHROPIC_API_KEY, model: 'claude-sonnet-4-6', maxTokens: 4096, temperature: null, topP: 1 });

// Markdown-link-extractor: vindt alle [tekst](url)-patronen.
function extractUrls(md) {
  const urls = new Set();
  const re = /\[([^\]]*)\]\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(md || "")) !== null) urls.add(m[2].trim());
  return urls;
}

export const revisePageTool = tool(
  async ({ pageType, url, keywords, v1Content, criticFeedback, allowedNewUrls = [] }) => {
    try {
      const { brand, seo, knowledge } = await readKnowledge();
      const isCaseType = pageType === 'case' || pageType === 'social proof snippet';

      const urlBriefing = url ? await readBriefing(url) : null;
      const briefingBlock = urlBriefing ? '\n\n## URL-briefing (parent / kinderen / bronnen)\n\n' + urlBriefing : '';

      // System content: STRICT PREFIX van write-page system tot aan linkRules.
      // Zo deelt revise_page de cache-prefix met write_page (Anthropic prompt-cache,
      // mits cache_control wordt gezet — kan later worden toegevoegd zonder structuurwijziging).
      const langRules = "\n\n---\n\n## TAALREGELS (altijd verplicht — ook bij revisies)\n\n- Schrijf correct Nederlands (NLP). Geen Engelse constructies in Nederlandse zinnen.\n- VERBODEN: em-dashes (— en –). Vervang altijd door een komma, een punt of herschrijf de zin.\n- Geen onnodige hoofdletters mid-sentence. Niet: 'de Dienst', 'ons Product', 'uw Organisatie'.\n- Houd de aanspreekvorm (je of u) consistent door de gehele tekst.\n- Geen AI-clichés: geen 'in de wereld van', 'in dit artikel', 'kom meer te weten', 'navigeer naar'.";
      const linkRules = '\n\n---\n\n## LINKREGELS (verplicht voor élke <a>-link)\n\n'
        + '1. ZELF-VERWIJZING VERBODEN. Link nooit naar de URL waarvoor je deze pagina schrijft (' + (url || '(geen URL meegegeven)') + ').\n'
        + '2. URL-HALLUCINATIE VERBODEN. Een URL mag ALLEEN gelinkt worden als die LETTERLIJK voorkomt in V1, in de URL-briefing (parent/kinderen/bronnen), of in een critic-suggestie hieronder.\n'
        + '3. KINDEREN-LINKING (max 1 niveau). Link 1× naar elk direct kind uit de URL-briefing — niet dieper.\n'
        + '4. ANKERTEKST. Beschrijvend en natuurlijk — geen "hier", "klik hier" of kale URL.';
      const reviseRules = '\n\n---\n\n## REVISIE-REGELS (specifiek voor V2)\n\n'
        + '- BEHOUD de exacte H1, H2 en H3 koppen van V1, tenzij een critic deze expliciet flagt.\n'
        + '- BEHOUD elke alinea die NIET door een critic-flag wordt geraakt — woord voor woord identiek.\n'
        + '- BEHOUD elke URL en elke <a>-link uit V1 ongewijzigd, tenzij een critic deze flagt of suggereert.\n'
        + '- BEHOUD meta_title, meta_description en slug uit V1, tenzij een critic deze flagt.\n'
        + '- VERWERK ALLEEN wat in CRITIC-FEEDBACK staat — geen ongevraagde verbeteringen.';

      // Cacheable prefix (identiek aan write-page tot en met linkRules) + reviseRules.
      const systemContent = isCaseType
        ? brand + "\n\n---\n\n" + knowledge + langRules + linkRules + reviseRules
        : brand + "\n\n---\n\n" + seo + "\n\n---\n\n" + knowledge + langRules + linkRules + reviseRules;

      const mdRules = "\n\nOPMAAK-REGELS voor het content-veld (verplicht):\n- Lege regel vóór én na elk kopje\n- Lege regel voor en na elke lijst\n- Lege regel tussen alinea's\n- Geen trailing whitespace";
      const hardRules = '\n\nABSOLUTE TOPREGELS (overtreden = afkeur):\n- GEEN em-dashes (— of –). Gebruik komma, punt of herschrijf.\n- GEEN horizontale scheidingslijnen (--- of langer) tussen secties. Kopstructuur is voldoende.\n- GEEN onnodige hoofdletters mid-sentence.\n- ELKE webpagina heeft meta_title (max 60 tekens) ÉN meta_description (140-160 tekens).\n- ELKE link 1-op-1 uit V1, briefing of critic-suggestie. Niets verzinnen.';

      const userPrompt = 'HERZIE de bestaande pagina op basis van critic-feedback.\n\n'
        + 'URL: ' + url + '\n'
        + 'Paginatype: ' + pageType + '\n'
        + (keywords ? 'Zoekwoorden: ' + keywords + '\n' : '')
        + briefingBlock + '\n\n'
        + '## CRITIC-FEEDBACK — verwerk elk punt:\n\n' + criticFeedback + '\n\n'
        + '## BESTAANDE V1 (behoud onveranderd waar mogelijk):\n\n' + v1Content
        + mdRules + hardRules
        + (isCaseType
            ? '\n\nGeef ALLEEN dit JSON-object terug: {"title":"...","meta_title":"...","meta_description":"...","content":"..."}'
            : '\n\nGeef ALLEEN dit JSON-object terug: {"meta_title":"...","meta_description":"...","slug":"...","content":"..."}');

      const response = await model.invoke([
        { role: 'system', content: systemContent },
        { role: 'user',   content: userPrompt }
      ]);
      const raw = typeof response.content === 'string' ? response.content : (response.content[0]?.text || '');
      const match = raw.match(/{[\s\S]*}/);
      const page = match ? (() => { try { return JSON.parse(match[0]); } catch { return { content: raw }; } })() : { content: raw };

      // Em-dash + horizontale-lijn post-processing — zelfde safety net als write-page.
      const cleanStr = s => typeof s === 'string' ? s.replace(/[—–]/g, ',').replace(/,\s*,/g, ',').replace(/  +/g, ' ') : s;
      const cleanContent = s => typeof s !== 'string' ? s : cleanStr(s).replace(/^[ \t]*-{3,}[ \t]*$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
      ['meta_title', 'meta_description', 'title'].forEach(k => { if (page[k]) page[k] = cleanStr(page[k]); });
      if (page.content) page.content = cleanContent(page.content);

      // URL-validatie: alle nieuwe URLs in V2 die niet in V1 staan en niet door critic
      // werden gesuggereerd — flag als warning. We strippen ze niet (kan content kapot maken),
      // maar de gebruiker krijgt expliciet te zien dat de schrijver iets heeft toegevoegd.
      const v1UrlSet = extractUrls(v1Content);
      const allowed = new Set([...v1UrlSet, ...(allowedNewUrls || [])]);
      const v2UrlSet = extractUrls(page.content || '');
      const novelUrls = [...v2UrlSet].filter(u => !allowed.has(u));
      const warnings = [];
      if (novelUrls.length) {
        warnings.push("V2 introduceerde URLs die niet in V1 stonden en niet door een critic werden gevraagd: " + novelUrls.join(", ") + ". Controleer of deze legitiem zijn.");
      }

      return JSON.stringify({ success: true, page: { ...page, ai_generated: true, generated_at: new Date().toISOString(), revised_from_v1: true }, ...(warnings.length ? { warnings } : {}) });
    } catch (err) {
      return JSON.stringify({ success: false, error: err.message });
    }
  },
  {
    name: 'revise_page',
    description: 'Herzie een bestaande pagina (V1) op basis van critic-feedback. Behoudt V1-structuur en URLs, past alleen geflagde punten aan. Lean context: geen templates of bronpagina\'s nodig — die zijn al verwerkt in V1.',
    schema: z.object({
      pageType:        z.enum(['dienstpagina','productpagina','artikelpagina','case','social proof snippet','overig']),
      url:             z.string(),
      keywords:        z.string().optional().describe('Zoekwoorden van V1 — voor consistentie'),
      v1Content:       z.string().describe('De V1-tekst die herzien moet worden'),
      criticFeedback:  z.string().describe('Genummerde lijst van critic-flags met severity, issue en suggestie'),
      allowedNewUrls:  z.array(z.string()).optional().describe('URLs die V2 mag introduceren — geëxtraheerd uit critic-suggesties')
    })
  }
);