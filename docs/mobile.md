# ByPage iOS app

The native host is in `apps/mobile`, following the application/package boundaries of VeloAgent and Velobase Harness. It uses Expo 57 and React Native 0.86, native React Native screens and SQLite. It does not embed the website in a WebView.

## Run locally

Requirements: Node 22.15+, Xcode with an iOS simulator, and CocoaPods. The web and native dependency trees have separate lockfiles so their React versions do not interfere.

```sh
npm ci
npm run mobile:install
npm run mobile:ios -- --device 'iPhone 17 Pro' --port 8083
```

If the native project has not been generated, Expo generates it. `apps/mobile/ios` and `android` are generated and ignored; app configuration and plugins are the source of truth. `npm run mobile:dev -- --port 8083` starts Metro for an already installed development build. Port 8083 avoids an existing Metro instance on 8081. A JavaScript export is available with `npm run mobile:build`; this is not an IPA.

Local reading works without an account. Profile offers Google sign-in directly. Release builds use the official `https://leafread.ai` service; Account, Settings and the AI assistant have no custom-server controls. Legacy `serverOrigin` preferences are discarded without deleting books or account caches. Only development builds accept a loopback `BYPAGE_MOBILE_API_ORIGIN` for local implementation work. Other overrides fail the build. `BYPAGE_MOBILE_ENV` is `development` or `production`; only public configuration enters Expo `extra`. Root `.env`, database credentials, server AI keys and telemetry credentials are not imported.

## Implemented workflows

- Four main tabs: Reading, Bookshelf, Notes and Me. A three-column bookshelf, cover-based recommendations, book details, grouped notes and local reading statistics follow the historical mobile-web/WeRead references. Bookshelf sorting, filters, multi-selection and finished status operate on real stored books.
- Device-local bookshelf collections support create, rename, dissolve, single-book and bulk moves, and an ungrouped view. Returning from reading retains the collection/status/sort filters within the session. Reading packs carry collections, with existing local membership taking priority on import; native account sync is not implemented. See [native collections](native-collections.md).
- Import DRM-free EPUB, UTF-8 TXT and PDF (up to 30 MB), existing web JSON backups and portable reading packs (up to 50 MB). Imports show a preview, validate content and commit in a SQLite transaction. Existing notes and reading positions win conflicts.
- PDF confirmation includes a complete report browser: enter an actually parsed physical page, step through pages or filter those without extracted text and those recognized with OCR. At most four complete paragraphs are mounted in a bounded text viewport, with controls for every remaining paragraph. Preview navigation neither reparses nor saves the book; invalid page entry leaves the current preview unchanged. It shows extracted text, not the original page image. See [completed conversion inspection](pdf-import.md#inspect-a-completed-conversion).
- PDF extraction can pause and continue within the open import, retaining only completed pages. Recoverable errors identify the failed physical page; text-budget failures require a smaller range. Closing or changing range releases the in-memory checkpoint. This requires the rebuilt resumable native module; older hosts retain full-range parsing without Pause. See [import recovery](pdf-import.md#pause-and-recover-within-an-import).
- The iOS document handler stages files opened from Files or another app in a private pending inbox for explicit preview and confirmation. Cancelling keeps the pending file; successful import or explicit removal clears it. The rebuilt simulator app was checked with a cold EPUB share and a PDF share while reading. See [native document import](native-document-import.md).
- EPUB 2 NCX and EPUB 3 navigation map nested contents entries to existing paragraph IDs. Reader and book-detail menus use the same contents; long detail menus expand in bounded batches. Reimport can supplement missing navigation without replacing stored chapter text or titles.
- The reader's contents sheet virtualizes its complete directory and opens around the active deepest section, including entries beyond the old first-60 batch. Hierarchical contents support separate branch disclosure and title navigation, plus Expand/Collapse all. Folds remain in the reader session by book and contents/page mode; reopening preserves them and can locate the visible ancestor marked as containing the current position. Title search temporarily ignores folds and includes each direct match's parent path, counting only direct matches; clearing it restores the folds. **Locate current section** clears a directory query, expands the current ancestor path and brings that entry into view without changing the reading position. Fixed, font-scale-aware row heights allow exact deep jumps; long titles use two visible lines and retain their full accessibility label. Flat original-page lists have no hierarchy controls.
- Supported EPUB JPEG/PNG block illustrations and direct paragraph-prefix images followed by a line break are stored separately from text, placed before or after the same paragraph, and can open in a zoomable viewer. Selected real-book illustrations and a signature were checked in the simulator; not every layout or gesture was covered. Mixed images within sentences, SVG and pure-image content without a text anchor are reported as unconverted. See [EPUB illustrations](epub-images.md).
- Read original text, translation or both. Native text measurements compose pages around stable paragraph/character positions; UIKit page curl, horizontal slide and instant transitions are available, alongside continuous or chapter-only virtualized scrolling. Both the reader typography sheet and Settings expose these choices. Tap the middle to reveal tools. Contents, progress, notes, language and typography use separate bottom sheets. Font size, spacing, typeface and paper/night themes reflow text.
- Scroll progress captures a visible text line after a settled user scroll, with one retry if layout is still changing. Explicit exit and reader typography changes use bounded capture, retaining the last trusted position when measurement is unavailable. Full visible lines outrank clipped fragments across original and translated text. An unchanged restored viewport can retain its validated character anchor during repeated typography changes; navigation, movement, source and layout changes invalidate stale work. Background saving is best effort, not a guarantee against process termination. Natural touch scrolling and rotation still require device verification; see [the targeted reflow check](mobile-verification.md#scroll-position-and-typography).
- Reading progress offers a system slider and paragraph stepping with a chapter/original-text preview. **Jump here** explicitly applies the target; changing or closing the preview does not persist a position or mark a book finished. Slider spacing follows paragraph ordinal, while the displayed percentage uses original-text lengths, so the two are not a linear percentage scale. The current chapter's previous/next actions remain available. An older native host falls back to paragraph stepping until updated.
- A dedicated PDF preview converts selected pages with PDFKit, optional Apple Vision OCR for scanned pages, progress/cancellation and password handling. Original page references are preserved. The reader's More menu opens the locally retained original in PDFKit and can return to the matching text chapter. Older imports can associate a fingerprint-matching original. Raw PDFs remain local and are excluded from sync/reading packs. See [PDF conversion](pdf-import.md).
- Reading position survives closing and restarting; an imported position also counts as started reading without inventing a last-opened time. Long-press a visible passage to highlight or annotate it. **Adjust selection** opens a read-only UIKit surface for choosing the exact text; a cancelled adjustment preserves an unsaved thought. Notes have stable paragraph references and can be edited, removed, searched and reopened at their source. Saved-note jumps verify the exact translation key and quote, use temporary display settings, and fall back explicitly to the original when verification fails. Returning from the reader preserves the note list's book, query, view and page within the session.
- Notes can be browsed by book or by recency, searched across books and exported as readable Markdown. Browsing and search use 60-note cursor pages with previous, next and first-page access; the main list no longer imposes a fixed total limit. Matching previews show the surrounding quote or thought, including late matches. Export includes all notes matching the current scope, with full saved quotes, thoughts, source labels, chapter and original-page references; it does not stop at the visible page. See [notebooks and exports](notes.md).
- The reader's own notebook virtualizes all loaded notes instead of the first 100, with quote/thought search, logical-chapter filtering and direct thought editing. Search and scope survive the editor round trip. The shared editor updates only the thought and rejects stale or missing records while retaining the draft; clearing the thought preserves its highlight. The reader currently loads at most 100,000 notes per book.
- Search title, author and original or saved translated passages locally, including accents, full-width Latin and CJK text. Global search filters by book and saved language; results page in batches of 60. Returning from a result keeps the query, source, language, book and page within the session. Book search can return to its results or the original reading position. Neither search generates translations. See [local search](local-search.md).
- Ask an evidence-grounded question about the current or selected passage. Responses stream from the configured service; supplied source references reopen their paragraph, and completed answers can be saved explicitly as thoughts. Local SQLite history is partitioned by book, canonical service origin and stable account identity, with explicit Markdown export. See [native assistant history](native-assistant.md).
- Choose Original, Bilingual or Translation only and a target language in the reader. Choices apply immediately and are remembered per book. Saved text is reused first; missing nearby paragraphs translate automatically. Bilingual keeps the original visible, while Translation only reserves placeholders without source-language fallback. Completed paragraphs enter SQLite and portable exports; compatible completed chunks of long paragraphs remain in separate resumable drafts. See [native translation while reading](native-translation.md).
- [System read aloud](native-speech.md) with original/saved-translation sources, current-passage/logical-chapter ranges, pause/resume, paragraph controls and explicit passage location. Leaving the reader clears playback; backgrounding keeps an in-memory cursor for manual resume. Voices available on the device determine language support.
- Export books, notes, progress and saved translations through the system share sheet. No model keys, prompts or chat history are in the pack.
- English and Simplified Chinese native UI. Book text is language-independent and right-to-left reading direction is respected.

## Translation while reading

The shared `sameReadingLanguage` check compares language and writing script, rather than requiring identical locale tags. For example, `zh`, `zh-CN` and `zh-Hans` are equivalent for reading; `zh-TW` / `zh-Hant` remain a different script. Unknown or automatic source languages do not count as a match. When the source and target match, the native reader displays the original and does not request translation. It preserves the user's saved reading-language choices for other books and keeps AI questions available.

Translation demand follows the visible reading position, requesting missing nearby paragraphs and a small lookahead instead of a chapter or whole-book job. Moving changes that demand. Leaving the reader, selecting Original, backgrounding, account/configuration changes, target-language changes and source-language changes interrupt unneeded work. Each model request has a 120-second timeout. Retry skips saved paragraphs and can resume compatible completed chunks; interrupted output never appears as a completed translation. Returning to an active bilingual or translation-only reading context can automatically resume missing nearby text. There is no preparation card, task progress banner or explicit batch-continuation workflow.

Language equivalence controls whether translation is needed; it does not rename saved language keys or alias translation-cache lookups. Existing translations and note `translationKey` values remain unchanged. Original text is never written into the translation cache to make a same-language passage appear translated, and successfully completed paragraphs remain available after cancellation or failure.

## Move reading between web and iOS

On the website, open **Data and backups → Export iOS reading pack**, or export one book from its detail menu. Save the JSON via AirDrop or Files and import it in ByPage on iOS. The pack includes only translations already saved on the web device; export does not trigger model requests or download remote chapters.

On iOS, use **Settings → Export reading pack** or a book's menu. The website's existing restore screen accepts the pack. The original web backup format still works, without translations. Both formats preserve supported parsed EPUB illustrations and their paragraph placements. Keep original books for complex layout, mixed inline images, unsupported image formats and source files. Raw EPUB/TXT/PDF files are excluded. The retained original PDF belongs to the local viewer, not the portable book.

A reading pack carries one saved readable translation per language, not every historical edition. Translated notes and bookmarks are rebound to that portable text only when the saved quote matches at its original offset or occurs exactly once elsewhere. Otherwise their old translation keys remain intact. A local translation that wins an import conflict must still pass quote verification when a note or bookmark is opened; missing or mismatched text opens the original without generating replacement text.

Images are limited to 4 MiB each, 12 MiB per book and 24 MiB across the validated backup or reading pack. These limits count JPEG/PNG file bytes before base64 encoding; the resulting JSON is larger, and the separate 50 MiB pack-file limit still applies. Export large libraries one book at a time. Supplementing images preserves existing chapter objects, paragraph IDs, translation hashes, notes and progress. A fuller reimport may add images only when every existing image remains at its previous text position; incompatible media does not overwrite the saved result.

For existing web account libraries, the sync protocol can supplement missing `toc` and `sourceFormat` metadata and compatible additional illustrations after reimport or backup restore. Shelf metadata carries a media revision; image bytes travel with book content when needed, not with every progress update or acknowledgement. The server validates references against stored chapters and does not accept chapter replacement through this channel. Existing differing directories and incompatible illustration sets are retained rather than forcibly reconciled. This path passed static review; live cloud synchronization was not exercised in the local account-disabled setup. Native account synchronization remains unavailable.

AI context and translation requests remain text-only. Viewing or exporting an illustration does not send its pixels to a model or translate text printed inside it. PDF text extraction and the local original-page viewer remain separate from EPUB illustrations; see [PDF conversion](pdf-import.md).

## Architecture

```text
apps/mobile/                     Expo app composition and native UI
  src/adapters/database.ts       SQLite persistence and atomic imports
  src/adapters/files.ts          DocumentPicker, EPUB parsing and system sharing
  modules/bypage-pdf/           Native PDFKit and Vision extraction
  src/adapters/pdf.ts           PDF orchestration and common-format conversion
  modules/bypage-reader/        UIKit page transitions and native text presentation
  src/adapters/api.ts            Capability check and bounded streaming AI transport
  src/adapters/diagnostics.ts    Bounded, content-free in-memory operation timings
packages/reading-core/           Neutral types, validation, progress, search, original sample
packages/api-client/             Versioned capability contract, injected transport and pure SSE parser
src/app/                        Existing Next.js host and HTTP adapters
src/lib/                        Web storage/network adapters; compatibility re-exports
```

Mobile never imports the Next.js host, browser IndexedDB adapter or server modules. Shared packages typecheck without DOM/Node ambient types. The web host remains in place; no server deployment path has moved. Web Docker builds do not install Expo.

The references informed platform ownership, explicit public configuration and injected transports. No reference product's authentication protocol, branding, customer content or credentials were copied.

## Current boundaries

Native account connection uses the system browser and Keychain to sign in to an existing Web account and use its AI configuration; see [mobile accounts](mobile-accounts.md). Local developer services still work without an account. The phone library remains device-local and independent of login. Account library sync, App Store distribution and background translation jobs are not enabled in this preview; the capability endpoint reports these limits explicitly. SQLite is app-sandbox storage, not a claim of application-level encryption. System backups follow device policy; exported packs are plain JSON selected explicitly by the user.

Native diagnostics remain in memory and are exported only on demand. They contain operation name, duration and success/error status, not exception text, URLs, book titles, source text, notes or search terms. No native PostHog upload or automatic telemetry is enabled.

Signing and distribution must use the user's Apple team and provisioning profiles. The configured bundle ID is `com.velobase.bypage`; no Apple account, paid build service or store submission is created by local development.

## Verification

Use `npm run check:packages`, `npm run typecheck`, `npm run mobile:typecheck`, and `npm run mobile:build` for static checks and compilation. Simulator checks and their observed outcomes are recorded in `docs/mobile-verification.md`. A successful Metro export alone does not verify native modules or persistence.

The Expo 57 dependency audit currently reports high-severity upstream advisories in build tooling (`braces`/Metro and `node-forge`/Expo CLI), with no compatible patched releases supplied by the registry at the time of implementation. `npm audit fix --force` proposes incompatible downgrades and was not applied. These findings are not hidden by an audit suppression.
