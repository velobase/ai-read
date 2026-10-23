# Native background book translation

The native reader uses the same persistent server task as the web reader. Opening a book ensures a task for its target language, shows the latest saved paragraphs and overall progress, and polls while the reader is active. Closing the reader or backgrounding the app stops observation only; the server worker continues translating and saving the whole book.

Returning restores the reading position and refreshes the task. Changing Original/Bilingual/Translation-only affects display only. Changing the target language selects that language’s task. Turning pages may prioritize pending chapters; it never aborts an in-flight model request. No pause or translation-scope controls are required.

Authenticated requests use the existing account session and origin checks. Results are validated against the canonical book/chapter identity before entering the account-scoped SQLite library. Only complete paragraphs are shown. Existing exact saved versions and selections are retained for notes, bookmarks, search and recovery. Offline reading continues from local results.

The foreground paragraph generation queue, model streaming adapter and client draft runner have been removed. Historical draft data remains readable by recovery export/import; it is not resumed by a second execution path. Task creation, retries, leases, checkpoints and full-book continuation belong to the server worker. See [persistent book translation](chapter-translations.md).

Type checking and builds do not replace real-device validation of foreground/background transitions, account changes or translation quality. No paid model request is needed for static verification.
