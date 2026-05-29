/**
 * TOOL: publish_to_cms
 * Databron: CMS API (Webflow Data API v2)
 * Gebruik wanneer: een gevalideerde pagina als concept gepubliceerd moet worden
 * Gebruik NIET voor: pagina's die validate_output niet hebben doorstaan
 * Input: { slug, content, meta_title?, meta_description? }
 * Succes: { success: true, ...platform-specifiek }
 * Fout:   { success: false, error }
 */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export const publishCmsTool = tool(
  async ({ slug, content, meta_title = '', meta_description = '' }) => {
    try {
      // Webflow Data API v2
      // Vereist: Collections ID van je CMS-collectie
      const COLLECTION_ID = process.env.WEBFLOW_COLLECTION_ID || 'VULL_IN';
      const res = await fetch('https://api.webflow.com/v2/collections/' + COLLECTION_ID + '/items', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + process.env.CLAUDE,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          isArchived: false,
          isDraft: true,
          fieldData: { name: meta_title || slug, slug, 'post-body': content, 'meta-title': meta_title || '', 'meta-description': meta_description || '' }
        })
      });
      if (!res.ok) throw new Error('Webflow API fout: ' + res.status);
      const data = await res.json();
      return JSON.stringify({ success: true, itemId: data.id, isDraft: true });
    } catch (err) {
      return JSON.stringify({ success: false, error: err.message });
    }
  },
  {
    name: 'publish_to_cms',
    description: 'Publiceer een gevalideerde pagina als concept naar het CMS. Gebruik dit ALLEEN na validate_output met passed: true.',
    schema: z.object({
      slug:             z.string().describe('URL-slug van de pagina'),
      content:          z.string().describe('Volledige paginatekst in Markdown'),
      meta_title:       z.string().optional().describe('SEO-titel (max 65 tekens)'),
      meta_description: z.string().optional().describe('SEO-beschrijving (max 155 tekens)')
    })
  }
);