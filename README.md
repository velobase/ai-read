# ByPage · 逐页

**Read across languages. Understand beyond the words.**

A local-first, self-hostable ebook reader with bilingual reading and source-grounded AI conversation. Built with Next.js App Router, TypeScript, Tailwind CSS, and shadcn/ui. MIT licensed.

[简体中文](README.zh-CN.md) · [Architecture](docs/architecture.md) · [Contributing](CONTRIBUTING.md)

> **v0.1.0 alpha.** The core implementation is available. TypeScript and production build checks have passed. Runtime reading flows and live AI-provider integration have not yet been verified. Do not treat citation presence as proof that an answer is correct.

## What it does

- Import DRM-free EPUB or UTF-8 TXT into a browser-local library.
- Switch between original, bilingual, and translation-only reading in reading settings; original is the default for new users, and existing choices are remembered.
- Prepare complete chapters, prefetch the next chapter, or prepare an entire book. Saved editions support pause/resume and remain readable when model settings change.
- Translate a passage or a chapter using your own OpenAI-compatible model service.
- Ask questions in your preferred language, with streamed answers and clickable paragraph references.
- Limit context to the current chapter, all chapters up to the furthest opened chapter, or the whole book.
- Use query expansion and local lexical retrieval when a book exceeds the context budget.
- Save reading position, translations, conversations, highlights, and notes in IndexedDB first. Signed-in readers synchronize parsed books, shelf state, positions, notes, completed conversations, automatic translations, and reading preferences across devices.
- Export notes as Markdown and search the original text. Read on a centered page with overlay tools; tap the mobile page to hide controls. Adjust type size, font, line spacing, page width or mobile margins, and day/night theme.
- Start without an API key using an original bilingual sample book. Its Chinese translations are prewritten examples, not live model output.
- Browse five user-selected English economics and management recommendations, with edition, ISBN, and official source links. These are bibliographic listings; their full text and translations are not hosted. See [recommended books](docs/recommended-books.md).

The interface is available in 10 languages: English, Simplified Chinese, Traditional Chinese, Japanese, Korean, Spanish, French, German, Portuguese, and Arabic. Choose **Settings → Interface language**, or use the language menu on the login screen and desktop header. Browser language detection, persistent preferences, localized dates/counts and right-to-left interface direction are included.

Translation and AI answers have **65 target-language choices**, configured separately under Reading language or Reading preferences. Changing the interface language does not translate books, change notes or replace the translation target. Actual translation quality depends on the connected model; selecting a language does not itself call a model.

## Quick start

Requires Node.js **22.12+** and npm.

```sh
git clone https://github.com/velobase/ai-read.git
cd ai-read
npm ci
npm run dev
```

Open **http://127.0.0.1:4173**. The Next.js development server includes the AI route handlers; no second server is needed. The reader runs in the browser to preserve local storage and viewport behavior.

The launcher reads `PORT` from the environment or `.env` (default `4173`) and disables Next.js telemetry. To keep an existing library, use the same host and port as before.

For a production build:

```sh
npm run build
npm start
```

The local launcher binds to loopback and validates Host and Origin. For the hosted account deployment, see [deployment notes](docs/deployment.md). Keep the origin (including port) consistent: browser storage belongs to each origin.

## Connect a model

Open **AI connection settings** in the reading companion, then enter:

1. A base URL ending in `/v1` (or the appropriate API prefix for your provider).
2. An exact model ID supported by that provider.
3. An API key, if required. Signed-in accounts save keys encrypted on the server. In local mode without accounts, manually entered keys stay in page memory and clear on reload.

Account changes take effect on the next request without a release or restart. Leaving the key blank keeps the saved key; changing its endpoint requires a new key or explicit removal.

The integration calls `POST {baseUrl}/chat/completions` with standard `messages`. It uses SSE streaming for translations and answers, and a non-streamed request for query expansion. No provider SDK or specific model is required. The provider must support the Chat Completions protocol, including `data: [DONE]` at the end of a stream.

For local mode without accounts, you can alternatively configure a trusted service in `.env`:

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

Both AI settings screens also offer editable translation prompts with Natural, Academic and Close-to-source starting points. Use `{{to}}` and `{{from}}` for language variables; source text and adjacent context are supplied automatically. New editions snapshot the current prompt; existing editions keep their style until you explicitly retranslate and switch. See [prompt behavior](docs/translation-prompts.md).

For a locally running Ollama service with an installed model:

```dotenv
AI_BASE_URL=http://localhost:11434/v1
AI_MODEL=your-installed-model
AI_API_KEY=
```

No API key, credits, hosted AI subscription, or model weights are bundled. Requests may incur costs with your provider. Bilingual and translation-only modes prepare the current and next chapters and publish complete chapters after structural validation. Book details and the reader’s Translation panel support whole-book preparation, pause/resume, and new editions. Reading the original, navigating away, or hiding the page does not cancel a started task. Account jobs continue on the server; local jobs pause when the browser closes and resume from saved checkpoints. You can read original text while preparing. See [persistent book translations](docs/chapter-translations.md).

Questions follow the current reading position unless an explicit selection takes priority. Background translation and chat run independently. A long-context question may issue an additional query-expansion request. Answer generation can be stopped at any time.

## Data and privacy

Books are parsed in the browser. The raw EPUB/TXT file is not uploaded. Extracted text, reading positions, notes, translations, and chat history are saved in IndexedDB. Signed-in accounts also synchronize parsed text and covers, shelf state, positions, notes, completed chat turns, translations, and reading preferences to the deployment’s PostgreSQL database. Guest data stays local until explicitly copied to an account. Preferences (excluding keys) are stored in localStorage. Fonts are bundled locally; there is no analytics integration.

Using AI sends the selected text, relevant source passages, book title, question, and eligible recent conversation to your selected provider through the local proxy. The provider's own data policies apply. An entire short book may fit in the selected context; larger books use excerpts. The AI proxy does not log request bodies or credentials; completed conversations and translations are persisted by account sync.

Clearing browser data deletes the local library. Keep original files and use **Me → Data & backup** to export parsed books, local covers, notes, and reading positions. Restore preserves existing books/positions and merges new note IDs. API keys, AI conversations, translation caches, and original EPUB files are excluded. Account provider settings are stored separately in PostgreSQL with encrypted keys, and are excluded from browser exports. The server never returns saved keys to the browser. Interface language remains device-local.

Sync runs after edits, on focus/reconnect, and periodically while the page is visible. An already open page can read local books and save edits offline; offline PWA startup is not implemented. Position is a chapter/paragraph anchor with an approximate fraction within the paragraph. Percentages use original-text length and can decrease when rereading; “finished” is a manual shelf status. Remote progress never moves an active reader. Stale offline progress yields to the cloud version, with a local recovery export; conflicting note edits keep a separate copy. Sync needs PostgreSQL, not Redis. Devices must use the same deployment and account.

## Current boundaries

- Reflowed **text** reading with optional local EPUB covers: inline images, tables as visual layouts, formulas, inline styling, footnote navigation, and embedded content are not preserved.
- Separate home, bookshelf, book details, categories, collections, search, notes, profile, and settings routes. Guest profiles stay local; signed-in account profiles are stored in PostgreSQL.
- No PDF, scanned books, DRM removal, audiobooks, glossary management, or manual translation editing.
- EPUB: up to 30 MB compressed; 4 MB per extracted text entry; 20 MB extracted text total. UTF-8 TXT: up to 30 MB, divided into 60-paragraph sections.
- EPUB chapter order follows the package spine. Files must contain valid XHTML text. Image-only and fixed-layout material may not import usefully.
- Context retrieval is lexical, with model-generated multilingual terms. It is **not** an exhaustive semantic index or guaranteed whole-book reasoning.
- “Up to furthest chapter” includes all text in any earlier chapter, even if not read. Progress controls reduce supplied spoilers; model prior knowledge may still leak them.
- Only source IDs included in the current request become clickable citations. This verifies the reference exists, not that the cited passage entails the model's claim.
- Each edition freezes its source, target language, model, and prompt. Settings changes leave existing editions intact; explicit retranslation creates a new version. A bounded generated glossary helps consistency; manual translation editing is not implemented.
- The selected passage and chat panel are text based; Markdown formatting is intentionally limited, and model-generated HTML is never rendered.

## Development

```sh
npm run typecheck
npm run build
```

`typecheck` generates Next.js route types before checking TypeScript; `build` produces `.next/`. These commands perform static compilation and bundling, not runtime or integration validation. There is no automated test suite in this initial release.

See [architecture and roadmap](docs/architecture.md) for implementation details and next steps.

## License

[MIT](LICENSE). Original sample text and translations are included under the same license. Third-party dependencies retain their respective licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Imported books remain the user's content and are not covered by this project's license.

## Accounts

Google OAuth, account profiles and revocable database sessions use Auth.js, Prisma and PostgreSQL. See [account setup and data boundaries](docs/authentication.md). The original guest library remains intact; signed-in readers get separate browser-local libraries and an explicit guest-library import. Apply the additive sync migration with `npm run db:migrate` after configuring the database. Parsed books and reading data synchronize within each account; raw EPUB files and API keys do not. The launcher still binds to loopback; production hosting needs HTTPS, a domain and a managed database.
