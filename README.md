# AI Read

**Read across languages. Understand beyond the words.**

A local-first, self-hostable ebook reader with bilingual reading and source-grounded AI conversation. Built independently with React and TypeScript. MIT licensed.

[简体中文](README.zh-CN.md) · [Architecture](docs/architecture.md) · [Contributing](CONTRIBUTING.md)

> **v0.1.0 alpha.** The core implementation is available. TypeScript and production build checks have passed. Runtime reading flows and live AI-provider integration have not yet been verified. Do not treat citation presence as proof that an answer is correct.

## What it does

- Import DRM-free EPUB or UTF-8 TXT into a browser-local library.
- Switch between original, bilingual, and translation-only reading.
- Translate a passage or a chapter using your own OpenAI-compatible model service.
- Keep names and terminology consistent using a per-book glossary.
- Ask questions in your preferred language, with streamed answers and clickable paragraph references.
- Limit context to the current chapter, all chapters up to the furthest opened chapter, or the whole book.
- Use query expansion and local lexical retrieval when a book exceeds the context budget.
- Save reading position, translations, conversations, highlights, and notes in IndexedDB.
- Export notes as Markdown; search the original text; adjust text size and reading theme.
- Start without an API key using an original bilingual sample book. Its Chinese translations are prewritten examples, not live model output.

The interface is currently in Simplified Chinese. Translation and answer language choices include Chinese (Simplified and Traditional), English, Japanese, Korean, French, German, Spanish, Portuguese, and Arabic. Actual language quality depends on the configured model.

## Quick start

Requires Node.js **22.12+** and npm.

```sh
git clone https://github.com/velobase/ai-read.git
cd ai-read
npm ci
npm run dev
```

Open **http://127.0.0.1:4173**. The development server includes the AI proxy; no second server is needed.

For a production build:

```sh
npm run build
npm start
```

The server deliberately binds to the loopback interface and validates Host and Origin. This release is intended for a personal local instance. It is not a multi-user public SaaS deployment template. Keep the origin (including port) consistent: browser storage belongs to each origin.

## Connect a model

Open **AI 设置** in the reading companion, then enter:

1. A base URL ending in `/v1` (or the appropriate API prefix for your provider).
2. An exact model ID supported by that provider.
3. An API key, if required. Browser-entered keys remain in page memory and are cleared on reload.

The integration calls `POST {baseUrl}/chat/completions` with standard `messages`. It uses SSE streaming for translations and answers, and a non-streamed request for query expansion. No provider SDK or specific model is required. The provider must support the Chat Completions protocol, including `data: [DONE]` at the end of a stream.

Alternatively, configure the trusted service on the server:

```sh
cp .env.example .env
```

```dotenv
AI_BASE_URL=https://your-provider.example/v1
AI_MODEL=your-model-id
AI_API_KEY=your-key
PORT=4173
```

Restart the server after changing `.env`. The server key is never returned to the browser and is only used with its configured endpoint. Choosing a different endpoint in the UI requires a separate key if that endpoint needs one.

For a locally running Ollama service with an installed model:

```dotenv
AI_BASE_URL=http://localhost:11434/v1
AI_MODEL=your-installed-model
AI_API_KEY=
```

No API key, credits, hosted AI subscription, or model weights are bundled. Requests may incur costs with your provider. A chapter translation issues one request per uncached paragraph; a long-context question may issue an additional query-expansion request. Both operations can be stopped.

## Data and privacy

Books are parsed in the browser. The raw EPUB/TXT file is not uploaded. Extracted text, reading positions, notes, translations, and chat history stay in IndexedDB. Preferences (excluding keys) are stored in localStorage. Fonts are bundled locally; there is no analytics integration.

Using AI sends the selected text, relevant source passages, book title, glossary, question, and eligible recent conversation to your selected provider through the local proxy. The provider's own data policies apply. An entire short book may fit in the selected context; larger books use excerpts. The server does not persist request bodies or log credentials.

Clearing browser data deletes the local library. Preserve original books and export important notes. There is no cloud sync or full-library backup/restore yet.

## Current boundaries

- Reflowed **text** reading: original images, tables as visual layouts, formulas, inline styling, footnote navigation, and embedded content are not preserved.
- No PDF, scanned books, DRM removal, audiobooks, or account system.
- EPUB: up to 30 MB compressed; 4 MB per extracted text entry; 20 MB extracted text total. UTF-8 TXT: up to 30 MB, divided into 60-paragraph sections.
- EPUB chapter order follows the package spine. Files must contain valid XHTML text. Image-only and fixed-layout material may not import usefully.
- Context retrieval is lexical, with model-generated multilingual terms. It is **not** an exhaustive semantic index or guaranteed whole-book reasoning.
- “Up to furthest chapter” includes all text in any earlier chapter, even if not read. Progress controls reduce supplied spoilers; model prior knowledge may still leak them.
- Only source IDs included in the current request become clickable citations. This verifies the reference exists, not that the cited passage entails the model's claim.
- Changing provider, model, target language, or glossary changes the translation cache key. Older entries remain local until the book is removed.
- The selected passage and chat panel are text based; Markdown formatting is intentionally limited, and model-generated HTML is never rendered.

## Development

```sh
npm run typecheck
npm run build
```

These commands perform static compilation and bundling, not runtime or integration validation. There is no automated test suite in this initial release.

See [architecture and roadmap](docs/architecture.md) for implementation details and next steps.

## License

[MIT](LICENSE). Original sample text and translations are included under the same license. Third-party dependencies retain their respective licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Imported books remain the user's content and are not covered by this project's license.
