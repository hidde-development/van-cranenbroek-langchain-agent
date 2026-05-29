/**
 * TOOL: validate_output
 * Databron: brand.md en seo.md
 * Gebruik wanneer: je een gegenereerde pagina wilt checken op SEO, toon en guardrails
 * Gebruik NIET voor: bronmateriaal valideren of URL's ophalen
 * Input: { content: string }
 * Succes: { success: true, passed, score, issues[], suggestions[] }
 * Fout:   { success: false, error }
 */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { ChatAnthropic } from '@langchain/anthropic';
import { readKnowledge } from './load-knowledge.js';

const model = new ChatAnthropic({ apiKey: process.env.Claude ?? process.env.ANTHROPIC_API_KEY, model: 'claude-haiku-4-5-20251001', maxTokens: 1024, temperature: null, topP: 1 });

export const validateTool = tool(
  async ({ content, pageType = "overig" }) => {
    try {
      const { brand, seo } = await readKnowledge();
      const isCaseType = pageType === 'case' || pageType === 'social proof snippet';
      const systemContext = isCaseType ? brand : brand + "\n\n" + seo;
      const validationFocus = isCaseType
        ? "Valideer alleen op: toon (brand.md), aanspreekvorm, guardrails en verboden woorden. SEO-criteria zijn NIET van toepassing op dit contenttype."
        : "Valideer op: SEO (zoekwoorden, structuur), toon (brand.md), guardrails en verboden woorden.";
      const response = await model.invoke([
        { role: 'system', content: 'Je bent een content QA-specialist. ' + validationFocus + '\n\n' + systemContext },
        { role: 'user',   content: 'Valideer deze pagina. Geef terug als JSON: {"passed":bool,"score":0-100,"issues":[],"suggestions":[]}\n\nPAGINA:\n' + content }
      ]);
      const match = response.content.match(/{[\s\S]*}/);
      if (!match) throw new Error('Geen JSON in validatie-response');
      return JSON.stringify({ success: true, ...JSON.parse(match[0]) });
    } catch (err) {
      return JSON.stringify({ success: false, error: err.message });
    }
  },
  {
    name: 'validate_output',
    description: 'Controleer een gegenereerde pagina op toon, guardrails en (voor niet-case types) SEO. Gebruik dit altijd NA write_page en VOOR publish_to_cms.',
    schema: z.object({
      content:  z.string().describe('Volledige gegenereerde paginatekst'),
      pageType: z.enum(['dienstpagina','productpagina','artikelpagina','case','social proof snippet','overig']).optional().describe('Paginatype — bepaalt of SEO-validatie van toepassing is')
    })
  }
);