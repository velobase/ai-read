# Translation while reading

Web and native reading use the same interaction: **Reading language** contains Original, Bilingual and Translation only, plus the target language. A selection takes effect immediately and is remembered for that book. A book with no saved choice uses the reader's preferences; new installations default to Original on both platforms. Interface language remains separate.

## Reader behavior

- Original mode reads the source and requests no further translation. Equivalent source and target languages also read directly.
- Bilingual and translation-only modes first reuse saved translations. Missing passages on the visible page are translated automatically, with a small lookahead of two following paragraphs. Completing the first visible missing paragraph advances demand to the next one, including on pages containing many short paragraphs.
- Bilingual mode keeps original text visible. Translation-only mode reserves placeholders for missing translations and never substitutes the original body text. A nearby status distinguishes loading, offline and failure; failed requests offer Retry.
- Completed paragraphs appear when interaction is idle. Web waits for pointer activity, selections and page turns to settle and restores the visible text anchor when updating layout. There is no manual “show new translations” step.
- Changing the reading position changes demand. Changing book or target language, returning to original mode, leaving the reader, or hiding the page stops work that is no longer needed. Returning to an active translated reading context may resume missing nearby passages.
- Search, bookmarks and notes can reveal their exact saved text without requesting replacement translations or changing the book's reading preference.

There is no preparation screen, translation task panel, whole-book action, manual queue or edition-switching step in the reading flow. Book details open reading directly.

## Generation and saving

The Web reader uses LeafRead's platform AI service through the existing streaming endpoint. Signed-in users do not configure a provider, model or API key. Provider credentials stay on the server; changing the translation prompt affects future missing passages without replacing saved text.

Only one paragraph request runs at a time for the current demand. Nearby original passages provide bounded context. Long source paragraphs are split into chunks of up to 6,000 UTF-16 code units without splitting surrogate pairs. Successful chunks are saved as a draft; incomplete stream output is not published. A complete paragraph is saved with an immutable translation key and a separate reading selection. Existing saved text wins a duplicate generation race.

Web drafts use the existing `translation-jobs` IndexedDB store under a reading-specific key, scoped to book, paragraph, source identity, target language and translation configuration. The store name does not imply a background job. Only complete paragraphs enter reading text, note anchors and ordinary translation exports. Compatible saved chunks can be reused when the same passage is needed again.

Transient failures receive bounded automatic retries. Persistent failures stop that demand and expose Retry. Going offline preserves saved text; reconnecting can resume the current reading demand. Changing connection settings affects missing translations and does not replace saved paragraphs.

## Existing saved editions

Existing paragraph caches, exact saved versions, reading selections and complete chapter artifacts remain readable. The authenticated `GET /api/translations` endpoint continues to provide saved manifests and completed chapter artifacts after checking their source identity against each edition’s saved source snapshot. A separate library sync is not required. Production SHA-256 hashes keep the existing canonical reading-text normalization; portable source fingerprints additionally protect local artifacts. The browser checks the account's saved manifest and downloads matching completed content around the current position before requesting new translation. A failed saved-content download exposes Retry rather than generating a replacement.

The former POST task commands, chunk-generation endpoint, local background runner and server translation worker have been removed. Existing database tables, browser stores, books, notes, checkpoints and completed translations are retained. An old queued job is not restarted by the application. No migration deletes user data.

Previously saved note and bookmark keys remain unchanged. Downloading or importing a saved translation does not authorize replacing an existing reading selection. Ordinary Web backups and portable reading packs retain their existing data boundaries; see [mobile reading packs](mobile.md#move-reading-between-web-and-ios).

## Validation boundary

The explicitly authorized lightweight checks run with `node scripts/check-web-reading-translation.mjs` and `node scripts/check-mobile-reading-translation.mjs`. They exercise the real paragraph writer and mobile scheduler with local storage/model/lifecycle substitutes: saved text reuse, complete-paragraph publishing, interruption/checkpoint recovery, duplicate request locking, retry limits and offline recovery. A small DOM substitute in `node --experimental-strip-types scripts/check-reading-translation-layout.mjs` additionally checks saved offsets across placeholders, language isolation, cancellation and replacement geometry. These checks make no network or paid model requests. Type checking and Web/iOS compilation also pass. Real-device gestures, translation quality and end-to-end layout behavior remain for user validation.
