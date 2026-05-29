/**
 * TOOL: write_page
 * Databron: knowledge/-map (brand, seo, templates, knowledge)
 * Gebruik wanneer: je een nieuwe productieklare webpagina moet schrijven
 * Gebruik NIET voor: informatie ophalen of output valideren
 * Input: { brief, pageType, url, keywords }
 * Succes: { success: true, page: { meta_title, meta_description, slug, content } }
 * Fout:   { success: false, error }
 */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { ChatAnthropic } from '@langchain/anthropic';
import { readKnowledge, readTemplate, readBriefing, normalizeUrl } from './load-knowledge.js';

const model = new ChatAnthropic({ apiKey: process.env.Claude ?? process.env.ANTHROPIC_API_KEY, model: 'claude-sonnet-4-6', maxTokens: 4096, temperature: null, topP: 1 });

export const writePageTool = tool(
  async ({ brief, pageType, url, keywords, templateCode = null }) => {
    try {
      const safeUrl = url ? normalizeUrl(url) : url;
      const { brand, seo, templates, knowledge } = await readKnowledge();
      const isCaseType = pageType === 'case' || pageType === 'social proof snippet';

      // Klantspecifieke template uit templates/Tnn.md (heeft voorrang op generieke templates.md)
      const customTpl = templateCode ? await readTemplate(templateCode) : null;
      const tplBlock = customTpl
        ? '## KLANTSPECIFIEKE TEMPLATE (' + templateCode + ') — leidend voor structuur\n\n' + customTpl + '\n\n---\n\n## Generieke fallback (alleen als sheet-template een aspect niet dekt)\n\n' + templates
        : templates;

      // Per-URL briefing uit briefings.md (geeft de agent contextuele intel: parent, kinderen, primair zoekwoord, opmerking)
      const urlBriefing = safeUrl ? await readBriefing(safeUrl) : null;
      const briefingBlock = urlBriefing ? '\n\n---\n\n## URL-briefing (uit SEO-strategie)\n\n' + urlBriefing : '';

      const langRules = "\n\n---\n\n## TAALREGELS (altijd verplicht — ook bij revisies)\n\n- Schrijf correct Nederlands (NLP). Geen Engelse constructies in Nederlandse zinnen.\n- VERBODEN: em-dashes (— en –). Vervang altijd door een komma, een punt of herschrijf de zin.\n- Geen onnodige hoofdletters mid-sentence. Niet: 'de Dienst', 'ons Product', 'uw Organisatie'.\n- Houd de aanspreekvorm (je of u) consistent door de gehele tekst.\n- Geen AI-clichés: geen 'in de wereld van', 'in dit artikel', 'kom meer te weten', 'navigeer naar'.";
      // Harde linkregels — voorkomt zelf-verwijzing, URL-hallucinatie en onjuiste cluster-diepte.
      const linkRules = '\n\n---\n\n## LINKREGELS (verplicht — geldt voor élke <a>-link in het content-veld)\n\n'
        + '1. ZELF-VERWIJZING VERBODEN. Link nooit naar de URL waarvoor je deze pagina schrijft (' + (safeUrl || '(geen URL meegegeven)') + ').\n'
        + '2. URL-HALLUCINATIE VERBODEN. Een URL mag ALLEEN gelinkt worden als die LETTERLIJK voorkomt in:\n'
        + '   - de URL-briefing (parent / kinderen / consolidatiebronnen)\n'
        + '   - de productcatalogus in knowledge.md\n'
        + '   - de hoofdpagina-lijst in seo.md\n'
        + '   Komt een URL niet 1-op-1 voor in deze bronnen? NIET LINKEN. Geen vergelijkbare paden raden, geen URL-fragmenten verzinnen, geen domeinnamen invullen op gevoel.\n'
        + '3. KINDEREN VERPLICHT (max 1 niveau diep). Als de URL-briefing een lijst kinderen bevat, link in de lopende tekst minstens één keer naar elk direct kind. Niet dieper: een level-1 pagina linkt alleen naar level-2 kinderen, niet naar level-3.\n'
        + '4. PARENT VERPLICHT. Link minstens één keer naar de parent uit de URL-briefing (mits aanwezig en niet de homepage).\n'
        + '5. ANKERTEKST. Beschrijvend en natuurlijk — geen \"hier\", \"klik hier\" of kale URL.';
      const systemContent = isCaseType
        ? brand + "\n\n---\n\n" + tplBlock + "\n\n---\n\n" + knowledge + briefingBlock + langRules + linkRules
        : brand + "\n\n---\n\n" + seo + "\n\n---\n\n" + tplBlock + "\n\n---\n\n" + knowledge + briefingBlock + langRules + linkRules;
      const mdRules = "\n\nOPMAAK-REGELS voor het content-veld (verplicht):\n- Gebruik altijd een lege regel vóór én na elk kopje (##, ###)\n- Gebruik altijd een lege regel voor en na een lijst\n- Gebruik altijd een lege regel tussen alinea's\n- Twee alinea's nooit direct aan elkaar plakken\n- Geen trailing whitespace op regels";
      // Topregels herhalen vlak voor de output-instructie — anders raken ze begraven in de lange system-content.
      const hardRules = '\n\nABSOLUTE TOPREGELS (overtreden = afkeur):\n- GEEN em-dashes (— of –). Ook niet als ze "natuurlijk lopen". Gebruik komma, punt of herschrijf.\n- GEEN horizontale scheidingslijnen (--- of langere reeks streepjes) tussen secties. Kopstructuur (##, ###) is genoeg — extra lijnen zijn ruis.\n- GEEN onnodige hoofdletters mid-sentence (niet: "de Dienst", "ons Product").\n- ELKE webpagina heeft meta_title (max 60 tekens, primair keyword vooraan) ÉN meta_description (140-160 tekens). Lever ze altijd mee.\n- ELKE link in de tekst moet 1-op-1 voorkomen in de meegegeven kennisbestanden. Niets verzinnen.\n- Verwerk de URL-briefing: link 1× naar parent en 1× naar elk direct kind (max 1 niveau diep).';
      const userPrompt = isCaseType
        ? 'Schrijf ' + (pageType === 'case' ? 'een casepagina' : 'een social proof snippet') + ' volgens het case/social proof schrijfregime in templates.md.\nSEO-regels zijn NIET van toepassing.\nURL (indien van toepassing): ' + safeUrl + '\n\nOpdracht:\n' + brief + mdRules + hardRules + '\n\nGeef ALLEEN dit JSON-object terug (geen markdown, geen uitleg):\n{"title":"...","meta_title":"...(max 60 tekens, primair keyword vooraan)","meta_description":"...(140-160 tekens, met CTA)","content":"...(volledige Markdown-tekst)"}' 
        : 'Schrijf een complete webpagina.\nURL: ' + safeUrl + '\nPaginatype: ' + pageType + (templateCode ? '\nKlantspecifieke template: ' + templateCode + ' — volg de sectie-volgorde uit de KLANTSPECIFIEKE TEMPLATE bovenaan.' : '') + '\nZoekwoorden: ' + keywords + '\n\nOpdracht:\n' + brief + mdRules + hardRules + '\n\nGeef ALLEEN dit JSON-object terug (geen markdown code blocks, geen uitleg):\n{"meta_title":"...(max 60 tekens, primair keyword vooraan, geen punt aan eind)","meta_description":"...(140-160 tekens, met CTA, geen marketingtaal)","slug":"...(kleine letters, koppeltekens)","content":"...(volledige Markdown-tekst)"}';
      const response = await model.invoke([
        { role: 'system', content: systemContent },
        { role: 'user',   content: userPrompt }
      ]);
      const raw = typeof response.content === 'string' ? response.content : (response.content[0]?.text || '');
      const match = raw.match(/{[\s\S]*}/);
      const page = match ? (() => { try { return JSON.parse(match[0]); } catch { return { content: raw }; } })() : { content: raw };

      // Programmatisch nettoetsen — safety net voor regels die de LLM soms toch overtreedt.
      // Em-dashes (— en –) → komma (de Nederlandse standaard-vervanging in lopende tekst).
      const cleanStr = s => typeof s === 'string' ? s.replace(/[—–]/g, ',').replace(/,\s*,/g, ',').replace(/  +/g, ' ') : s;
      // Content krijgt extra: horizontale lijnen (---) eruit (Claude-tic, niemand vraagt erom)
      // en opeenvolgende lege regels samenvoegen tot één.
      const cleanContent = s => typeof s !== 'string' ? s : cleanStr(s).replace(/^[ \t]*-{3,}[ \t]*$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
      ['meta_title', 'meta_description', 'title'].forEach(k => { if (page[k]) page[k] = cleanStr(page[k]); });
      if (page.content) page.content = cleanContent(page.content);

      return JSON.stringify({ success: true, page: { ...page, ai_generated: true, generated_at: new Date().toISOString(), template_used: templateCode || null } });
    } catch (err) {
      return JSON.stringify({ success: false, error: err.message });
    }
  },
  {
    name: 'write_page',
    description: 'Schrijf een complete webpagina op basis van een brief. Gebruikt brand-, SEO- en templateregels automatisch. Geef templateCode mee (bv. T01) wanneer een klantspecifieke paginastructuur uit templates/-map gebruikt moet worden.',
    schema: z.object({
      brief:        z.string().describe('Schrijfopdracht of geconsolideerde brief'),
      pageType:     z.enum(['dienstpagina','productpagina','artikelpagina','case','social proof snippet','overig']),
      url:          z.string().describe('Toekomstige URL van de pagina'),
      keywords:     z.string().describe('Zoekwoorden, kommagescheiden — mag leeg zijn voor case/social proof'),
      templateCode: z.string().nullable().optional().describe('Optionele klantspecifieke template-code uit de SEO-strategie (T01, T02, ...). Laat leeg voor generieke paginatypen.')
    })
  }
);