/**
 * TOOL: consolidate_sources
 * Databron: eerder opgehaalde paginateksten
 * Gebruik wanneer: je 2+ bronpagina's hebt over hetzelfde onderwerp
 * Gebruik NIET voor: één bronpagina (gebruik dan direct write_page)
 * Input: { sources: Array<{url,title,content}>, topic: string }
 * Succes: { success: true, brief }
 * Fout:   { success: false, error }
 */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { ChatAnthropic } from '@langchain/anthropic';

const model = new ChatAnthropic({ apiKey: process.env.Claude ?? process.env.ANTHROPIC_API_KEY, model: 'claude-sonnet-4-6', maxTokens: 2048, temperature: null, topP: 1 });

export const consolidateTool = tool(
  async ({ sources, topic }) => {
    try {
      const sourcesText = sources.map((s, i) =>
        "=== Bron " + (i + 1) + ": " + s.title + " (" + s.url + ") ===\n" + s.content
      ).join('\n\n');
      const response = await model.invoke([{
        role: 'user',
        content: 'Analyseer de bronpagina\'s over "' + topic + '". Geef terug: (1) alle unieke feiten en argumenten, (2) ontbrekende informatie, (3) aanbevolen structuur voor de nieuwe pagina.\n\nBRONNEN:\n' + sourcesText
      }]);
      return JSON.stringify({ success: true, brief: response.content });
    } catch (err) {
      return JSON.stringify({ success: false, error: err.message });
    }
  },
  {
    name: 'consolidate_sources',
    description: 'Voeg 2+ bronpagina\'s samen tot één gestructureerde brief. Gebruik NIET voor een enkele bron.',
    schema: z.object({
      sources: z.array(z.object({
        url: z.string(), title: z.string(), content: z.string()
      })).describe('Lijst van opgehaalde bronpagina\'s'),
      topic: z.string().describe('Het centrale onderwerp van de nieuwe pagina')
    })
  }
);