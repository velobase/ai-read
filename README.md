# ByPage · 逐页

**Read across languages. Understand beyond the words.**

A local-first, self-hostable ebook reader with bilingual reading and source-grounded AI conversation. Built with Next.js App Router, TypeScript, Tailwind CSS, and shadcn/ui. MIT licensed.

[简体中文](README.zh-CN.md) · [Architecture](docs/architecture.md) · [Contributing](CONTRIBUTING.md)

> **v0.1.0 alpha.** TypeScript and production build checks have passed. Targeted local reading and AI flows are recorded in [verification notes](docs/mobile-verification.md); these are not comprehensive platform or provider coverage. Do not treat citation presence as proof that an answer is correct.

## What it does

- Import DRM-free EPUB, UTF-8 TXT or text-based PDF into a browser-local library.
- Keep supported JPEG/PNG block illustrations from EPUBs beside the original or translated text, and open them for zooming. See [illustrations and their limits](docs/epub-images.md).
- Preview EPUB footnotes, follow internal links and return to the reading location. Supplementary notes stay separate from chapter text. See [EPUB references](docs/epub-references.md).
- Choose original, bilingual or translation-only reading in Reading language. Changes apply immediately and the mode and target language are remembered per book; new users start with the original.
- Read saved translations immediately and fill missing nearby paragraphs automatically. Bilingual reading keeps the original visible; translation-only reading uses placeholders while text arrives.
- Translate through the existing OpenAI-compatible connection. Original mode and leaving the reader stop further translation demand.
- Ask questions in your preferred language, with streamed answers and clickable paragraph references.
- Limit context to the current chapter, all chapters up to the furthest opened chapter, or the whole book.
- Use query expansion and local lexical retrieval when a book exceeds the context budget.
- Save reading position, translations, conversations, highlights, and notes in IndexedDB first. Signed-in readers synchronize parsed books, shelf state, positions, notes, completed conversations, automatic translations, and reading preferences across devices.
- Export notes as Markdown and search the original text. Read on a centered page with overlay tools; tap the mobile page to hide controls. Adjust type size, font, line spacing, page width or mobile margins, and day/night theme.
- Start without an API key using an original bilingual sample book. Its Chinese translations are prewritten examples, not live model output.
- Browse five user-selected English economics and management recommendations, with edition, ISBN, and official source links. These are bibliographic listings; their full text and translations are not hosted. See [recommended books](docs/recommended-books.md).

The interface is available in 10 languages: English, Simplified Chinese, Traditional Chinese, Japanese, Korean, Spanish, French, German, Portuguese, and Arabic. Choose **Settings → Interface language**, or use the language menu on the login screen and desktop header. Browser language detection, persistent preferences, localized dates/counts and right-to-left interface direction are included.

Translation and AI answers have **65 target-language choices**, configured separately under Reading language or Reading preferences. Changing the interface language does not translate books, change notes or replace the translation target. Actual translation quality depends on the connected model. In bilingual or translation-only reading, choosing a target language can automatically request missing nearby translations.

Book details also let you correct the original language, including PDF/TXT imports without language metadata. File default restores the imported declaration; equivalent original and target languages can be read immediately. Existing text, notes and translations remain saved. See [source-language settings](docs/source-language.md).

## Quick start

Requires Node.js **22.15+** and npm.

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

Both AI settings screens also offer editable translation prompts with Natural, Academic and Close-to-source starting points. Use `{{to}}` and `{{from}}` for language variables; source text and adjacent context are supplied automatically. New requests use the current prompt; existing saved translations remain unchanged. See [prompt behavior](docs/translation-prompts.md).

For a locally running Ollama service with an installed model:

```dotenv
AI_BASE_URL=http://localhost:11434/v1
AI_MODEL=your-installed-model
AI_API_KEY=
```

No API key, credits, hosted AI subscription, or model weights are bundled. Requests may incur costs with your provider. Bilingual and translation-only reading reuse saved text, then translate the current passage and a small nearby lookahead. Completed paragraphs are saved automatically. Switching to original text, leaving the reader or hiding the page stops unneeded work; reopening an active translated reading context can resume missing passages from compatible saved chunks. There is no whole-book preparation or background translation task. Existing saved editions and note keys remain readable. See [translation while reading](docs/chapter-translations.md).

Questions follow the current reading position unless an explicit selection takes priority. Reading translation and chat run independently. A long-context question may issue an additional query-expansion request. Answer generation can be stopped at any time.

## Data and privacy

Books are parsed in the browser. The raw EPUB/TXT/PDF file is not uploaded. Extracted text, supported EPUB illustrations, reading positions, notes, translations, and chat history are saved in IndexedDB. Signed-in accounts also synchronize parsed text, covers and supported illustrations, shelf state, positions, notes, completed chat turns, translations, and reading preferences to the deployment’s PostgreSQL database. Guest data stays local until explicitly copied to an account. Preferences (excluding keys) are stored in localStorage. Fonts are bundled locally. Optional anonymous PostHog analytics require deployment configuration and a browser opt-in under Settings → Diagnostics & privacy; analytics is off by default. Session diagnostics stay in memory. Server logs and metrics contain operation names, durations and status classifications, never reading content or credentials. See [observability](docs/observability.md).

Using AI sends the selected text, relevant source passages, book title, question, and eligible recent conversation to your selected provider through the local proxy. Context remains text-only: retaining an illustration does not send its pixels to the model or translate text inside the image. The provider's own data policies apply. An entire short book may fit in the selected context; larger books use excerpts. The AI proxy does not log request bodies or credentials; completed conversations and translations are persisted by account sync.

Clearing browser data deletes the local library. Keep original files and use **Me → Data & backup** to export parsed books, local covers, supported EPUB illustrations, notes, and reading positions. Restore preserves existing text and positions, merges new note IDs, and can add compatible missing illustrations. The standard backup excludes API keys, AI conversations and translation caches; [portable reading packs](docs/mobile.md#move-reading-between-web-and-ios) also carry translations already saved on the device. Neither format includes raw EPUB/TXT/PDF files. Retained original PDFs are stored separately for the local page viewer and are excluded from account sync and exports. Account provider settings are stored separately in PostgreSQL with encrypted keys, and are excluded from browser exports. The server never returns saved keys to the browser. Interface language remains device-local.

Sync runs after edits, on focus/reconnect, and periodically while the page is visible. An already open page can read local books and save edits offline; offline PWA startup is not implemented. Position is a chapter/paragraph anchor with an approximate fraction within the paragraph. Percentages use original-text length and can decrease when rereading; “finished” is a manual shelf status. Remote progress never moves an active reader. Stale offline progress yields to the cloud version, with a local recovery export; conflicting note edits keep a separate copy. Sync needs PostgreSQL, not Redis. Devices must use the same deployment and account.

## Current boundaries

- Reflowed text with EPUB covers and supported JPEG/PNG block illustrations. An image containing a table or formula remains a viewable image; text-based tables, formulas and complex page layouts are not reconstructed. Mixed inline images, SVG and image-only chapters without a text anchor are counted as unconverted. Inline styling remains unsupported. Local footnotes and internal links use a separate bounded reference sidecar. See [EPUB illustrations](docs/epub-images.md) and [references](docs/epub-references.md).
- Separate home, bookshelf, book details, categories, collections, search, notes, profile, and settings routes. Guest profiles stay local; signed-in account profiles are stored in PostgreSQL.
- PDF has a dedicated local parser with page-range selection, password handling, conversion preview and original-page references. Web reads the text layer; the iOS app also offers on-device OCR for scanned pages. The local original-page viewer preserves source graphics and formulas and returns to the corresponding text chapter. Raw PDFs are not included in sync or reading packs. See [PDF parsing](docs/pdf-import.md).
- DRM removal, audiobook catalogs, glossary management, and manual translation editing are not implemented. The native app can read text aloud with system voices.
- EPUB: up to 30 MB compressed; 4 MB per extracted text entry; 20 MB extracted text total. UTF-8 TXT: up to 30 MB, divided into 60-paragraph sections.
- Illustration limits: 4 MiB per asset, 12 MiB per book and 24 MiB of image bytes across a validated backup/reading pack; encoded JSON is larger. Export large libraries as separate books. Media supplements do not change paragraph IDs, text anchors or translation source hashes.
- EPUB chapter order follows the package spine. Files must contain valid XHTML text. Image-only and fixed-layout material may not import usefully.
- Context retrieval is lexical, with model-generated multilingual terms. It is **not** an exhaustive semantic index or guaranteed whole-book reasoning.
- “Up to furthest chapter” includes all text in any earlier chapter, even if not read. Progress controls reduce supplied spoilers; model prior knowledge may still leak them.
- Only source IDs included in the current request become clickable citations. This verifies the reference exists, not that the cited passage entails the model's claim.
- Settings changes affect missing translations and leave saved text and annotation keys intact. Historical complete editions remain readable. Manual translation editing and glossary management are not implemented.
- The selected passage and chat panel are text based; Markdown formatting is intentionally limited, and model-generated HTML is never rendered.

## Native iOS preview

The native assistant offers chapter/read/book scope, device-local conversation history, source-return navigation and per-answer Markdown export. Native reading uses the same Original / Bilingual / Translation only flow as Web, with automatic nearby translation, saved paragraph chunks and per-book language choices. Returning to an active translated reader may resume missing passages. See [native assistant](docs/native-assistant.md) and [native translation while reading](docs/native-translation.md).

`apps/mobile` contains the Expo / React Native app with SQLite storage, native PDFKit / Vision import and UIKit page transitions. It supports local reading, notes, search and portable reading packs between web and iOS, including supported EPUB illustrations. A real EPUB's table caption, image fit and return position were checked in the local simulator; pinch gestures and all layouts remain unverified. Native [account connection](docs/mobile-accounts.md) uses the system browser and Keychain for existing Web accounts and their AI settings. The phone library remains device-local; cloud library sync is not enabled. Local account-disabled services remain supported. Simulator checks reached Google sign-in and verified both cancellation paths; full sign-in and authenticated AI remain unverified. See [setup and architecture](docs/mobile.md), [observed simulator checks](docs/mobile-verification.md), and the [2026-10-23 iteration handoff](docs/iteration-2026-10-23.md).

## Development

```sh
npm run typecheck
npm run build
```

`typecheck` generates Next.js route types before checking TypeScript; `build` produces `.next/`. These commands perform static compilation and bundling, not runtime or integration validation. This iteration used a few explicitly authorized focused checks and manual simulator flows; there is no comprehensive automated test suite. Follow the repository's testing preference before running additional checks.

See [architecture and roadmap](docs/architecture.md) for implementation details and next steps.

## License

[MIT](LICENSE). Original sample text and translations are included under the same license. Third-party dependencies retain their respective licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Imported books remain the user's content and are not covered by this project's license.

## Accounts

Google OAuth, account profiles and revocable database sessions use Auth.js, Prisma and PostgreSQL. See [account setup and data boundaries](docs/authentication.md). The original guest library remains intact; signed-in readers get separate browser-local libraries and an explicit guest-library import. Apply the additive sync migration with `npm run db:migrate` after configuring the database. Parsed books and reading data synchronize within each account; raw EPUB files and API keys do not. The launcher still binds to loopback; production hosting needs HTTPS, a domain and a managed database.
