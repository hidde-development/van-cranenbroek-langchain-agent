# Van Cranenbroek — LangChain Content Agent

Gegenereerd door Goldfizh Content Agent Builder voor **Goldfizh**.



## Vereisten

- Node.js 18+
- Vercel CLI (`npm i -g vercel`)
- Anthropic API key

## Installatie

```bash
npm install
cp .env.example .env.local
# Vul Claude (Anthropic API-key) en CLAUDE in .env.local
```

## Deployen op Vercel

```bash
vercel deploy
# Voeg environment variables toe in het Vercel dashboard
```

## API-endpoints

### `POST /api/agent` — Schrijf één pagina
```json
{ "url": "https://www.voorbeeld.nl/diensten/...", "pageType": "dienstpagina", "style": "feitelijk", "keywords": "...", "brief": "..." }
```

### `POST /api/migrate` — Batch migratie (continuation token)
```json
{ "urls": ["https://oud.nl/pagina-1"], "completed": [], "batchSize": 3 }
```
Herhaal tot `done: true` in de response.

## Content-tools (6)

| Tool | Wanneer |
|------|---------|
| `fetch_url_content` | Inhoud van een bestaande URL ophalen |
| `consolidate_sources` | Meerdere bronpagina's samenvoegen |
| `write_page` | Nieuwe pagina schrijven |
| `validate_output` | SEO + brand check |
| `load_knowledge` | Merk- of productinfo opzoeken |
| `publish_to_cms` | Publiceren naar Webflow |

## CMS

Platform: **Webflow**
Endpoint: _zie `lib/tools/publish-cms.js`_
API-key: `process.env.CLAUDE`