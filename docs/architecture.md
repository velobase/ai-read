# Architecture

## Application boundaries

The frontend is a React + TypeScript application built with Vite. A small Node HTTP server serves Vite middleware in development, the compiled `dist/` directory in production, and two same-origin API endpoints. There is no application database on the server and no hosted account dependency.

```text
EPUB / TXT -> browser parser -> structured chapters and stable paragraph IDs
                                  |
                           IndexedDB book store
                                  |
                   reader / notes / translation cache
                                  |
Question -> scope selection -> optional multilingual query expansion
                                  |
                    local lexical retrieval + context budget
                                  |
                      localhost /api/ai proxy
                                  |
                    configured Chat Completions service
                                  |
                     SSE answer + source reference buttons
```

## Source layout

| File                 | Responsibility                                                       |
| -------------------- | -------------------------------------------------------------------- |
| `src/App.tsx`        | Reader, library, notes, progress, and AI orchestration               |
| `src/components.tsx` | Dialogs, settings, library cards, safe answer rendering              |
| `src/lib/import.ts`  | ZIP/EPUB metadata and spine extraction, XHTML-to-text, TXT import    |
| `src/lib/storage.ts` | IndexedDB transactions and non-secret preferences                    |
| `src/lib/ai.ts`      | API requests, SSE parsing, context selection, translation cache keys |
| `src/lib/sample.ts`  | Original example text and clearly labeled preset translation         |
| `server/index.mjs`   | Same-origin HTTP server, provider proxy, server-side prompting       |

## EPUB processing

The importer reads `META-INF/container.xml`, then the OPF manifest and spine. It processes linear text chapters in spine order, ignoring the navigation document. Paragraphs receive IDs such as `2.7`, identifying chapter 2, paragraph 7. Book identity is a SHA-256 digest of the original bytes, so repeated imports reuse the same local book ID.

The importer extracts text instead of rendering supplied HTML. Book scripts, styles, SVG, math, frames, and objects are discarded; React escapes the remaining text. Long blocks are split into bounded sources. ZIP extraction checks original entry sizes before accepting entries. Original styling and image data are not persisted.

## Storage

Database `ai-read`, schema version 1:

- `books`: parsed book structure, keyed by book digest.
- `positions`: current chapter / paragraph and furthest opened chapter.
- `notes`: quote and optional user-authored note, grouped by book.
- `translations`: per-book map keyed by paragraph, output language, and provider/model/glossary fingerprint.
- `chats`: most recent 60 messages per book.
- `glossaries`: per-book translation terminology.

UI preferences contain no API keys. Browser-entered keys are React state only. Deleting a book removes all six stores' entries for that book in one transaction. Writes resolve only after their transaction completes.

## Translation

Translation uses the target paragraph, nearby paragraphs, and the per-book glossary. A chapter operation runs sequentially and skips already cached paragraphs. Only a completed SSE response is cached; interrupted translations can be requested again. The cache includes provider/model and glossary identity to avoid silently reusing translations generated under different settings.

There is no post-translation quality scoring, automatic glossary extraction, or promise of perfect name consistency. These are candidate improvements.

## Context and citations

Requests are restricted to the declared chapter scope. At most 46,000 source characters (including approximate overhead) and 400 passages are selected. If the available text exceeds this budget, a short model request expands the question into search terms in the book language, then a deterministic lexical scorer ranks passages. Selection and nearby paragraphs have priority. The UI displays supplied/available passage counts during the request.

This is deliberately transparent, simple retrieval; it is not a vector database. Long multilingual queries, implicit references, and multi-hop arguments can be missed. The assistant is instructed to distinguish evidence, interpretation, and background knowledge and to acknowledge omitted context.

Answer rendering accepts plain text, limited emphasis, and references matching `[chapter.paragraph]`. Only IDs supplied in that request become clickable buttons. Unknown citations are marked rather than linked. No raw model HTML is rendered. Model answers are untrusted text and never trigger tools or actions.

Recent conversation is included only in complete user/assistant pairs whose supplied source IDs remain within the current permitted scope. Incomplete generations are excluded. This reduces accidental leakage when moving to an earlier chapter, but does not provide a guarantee against the model's own knowledge revealing spoilers.

## Provider proxy

The server supports `ask`, `translate`, and `terms` actions; it constructs system instructions itself. Endpoint redirects are rejected. Only HTTPS is accepted for remote providers; HTTP is allowed for loopback providers. A server-configured secret is used only for the normalized server-configured endpoint, never an arbitrary browser-selected endpoint.

The server binds to `127.0.0.1` and accepts matching loopback Host/Origin values. It is a personal local tool, not an authenticated hosted gateway. Adding remote hosting requires a deliberate authentication, tenancy, network-destination, and secret-management design.

Requests have a 512 KB input limit, a source-content cap, a two-minute provider timeout, and a four-request concurrency ceiling. Streams are limited to 8 MB. Browser cancellation closes the HTTP response and aborts the upstream request. Full request/response bodies and secrets are not logged.

Protocol reference: [Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create).

## Next directions

- Improve EPUB fidelity: images, footnotes, internal links, and layout.
- Add portable book/annotation backup and restore.
- Introduce optional semantic retrieval with clear coverage indicators.
- Persist per-answer context summaries and expose retrieval diagnostics.
- Improve terminology consistency, bilingual alignment, and translation quality review.
- Add interface localization, deeper RTL support, and accessibility review.
- Explore model/provider adapters and local inference without locking the reader to one vendor.

These are future work, not capabilities claimed by the current release.
