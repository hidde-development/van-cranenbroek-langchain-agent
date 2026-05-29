/**
 * TOOL: fetch_url_content
 * Databron: het open web via fetch()
 * Gebruik wanneer: je de tekstinhoud van een bestaande webpagina nodig hebt als bronmateriaal
 * Gebruik NIET voor: lokale bestanden, API-endpoints, al opgehaalde URL's
 * Input: { url: string }
 * Succes: { success: true, url, title, content }
 * Fout:   { success: false, error, hint }
 */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export const fetchUrlTool = tool(
  async ({ url }) => {
    // 15s timeout per URL — voorkomt dat één hangende server de hele agent-call (300s) opvreet.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      if (!/^https?:\/\//i.test(url)) throw new Error("Alleen http(s) URLs zijn toegestaan.");
      const res = await fetch(url, { headers: { 'User-Agent': 'ContentAgent/1.0' }, signal: ctrl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const html = await res.text();
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 8000);
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      const title = titleMatch ? titleMatch[1].trim() : url;
      return JSON.stringify({ success: true, url, title, content: text });
    } catch (err) {
      const msg = err.name === 'AbortError' ? 'Timeout na 15s' : err.message;
      return JSON.stringify({
        success: false, error: msg,
        hint: 'Controleer of de URL publiek bereikbaar is en geen login vereist.'
      });
    } finally {
      clearTimeout(timer);
    }
  },
  {
    name: 'fetch_url_content',
    description: 'Haal de tekstinhoud op van een webpagina als bronmateriaal. Gebruik NIET voor API-endpoints of al opgehaalde URLs.',
    schema: z.object({
      url: z.string().describe('Volledige URL inclusief https://')
    })
  }
);