# Source-language corrections

The Web and iOS book-detail screens let the reader choose the original language of an existing book. This is useful for PDF/TXT imports that have no language declaration, and EPUB files with incorrect metadata. Both use the shared language list. **File default** restores the imported declaration.

`Book.sourceLanguage` is optional. Its value is a supported language tag or `auto`; `auto` and an absent value both resolve to the original `Book.language` through `effectiveBookLanguage`. The explicit `auto` value also carries a reset across backup and Web sync. The imported language, chapter text, paragraph IDs, translation source hash, saved notes and translation cache keys remain unchanged.

Reading, AI inputs and native speech consume the effective language. Equivalent original/target languages show the original immediately without starting translation. Existing translations remain saved, and explicit translation-note navigation can reveal its saved translation. This setting does not rewrite the global bilingual preference.

On Web, the notes page passes only the saved note ID to the reader. The reader resolves the note locally and reads its exact translation key; an edition cache must belong to the same book and match the chapter's source hash. The temporary view shows that saved paragraph beside its original without waiting for an entire translated chapter or changing the selected edition. Missing cached text falls back to the original with a notice. Normal navigation clears this temporary view, while returning from a reference restores the previous view and anchor.

Web local jobs and account workers check the current book before starting and committing a chunk. Active requests monitor pauses and same-language changes, and abort when appropriate; cancellation retains prior checkpoints rather than recording a provider failure. Aborting a request cannot recall work already processed or billed by a provider. The local monitor reads the stored Book because IndexedDB has no JSON-field projection; the server monitor reads only language/status metadata. Native translation is foreground-only and aborts when the effective source language changes.

Web synchronization sends the override as book metadata. It does not require uploading book text or image resources again. Conflict handling compares the base, local and remote values: a local-only edit survives; a remote change wins a concurrent conflict. Older clients that omit the field do not clear it. Backup imports supplement a missing override and retain an explicit existing choice. Native SQLite and portable reading packs retain the same field; native account sync remains unavailable.

## Verification boundaries

On the local iOS simulator, the Keynes PDF was changed from automatic detection to English. Reopening its detail after reading still showed EN. Choosing English as the target displayed the no-translation-needed state; the existing Simplified Chinese target and bilingual preference were then restored. On Web, the English source selection survived a full reload, and an English target displayed the same-language state while keeping the existing Chinese translation count after switching back.

These were limited manual checks. Explicit old-translation note recovery, active paid-request cancellation, account-worker/database behavior, live conflict synchronization and restored reading packs were reviewed statically but were not exercised by these checks. The current Web guest library had no notes; no additional note was created for this check. No automated test suite was added or run for this feature. See [local verification](mobile-verification.md).
