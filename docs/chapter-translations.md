# Persistent book translations

Translation is a durable edition of a book. Reading consumes complete chapter artifacts; generation is independent of scroll, pagination, chat, and the lifetime of the reader component.

## Reader behavior

- Opening an untranslated chapter in bilingual/translation mode queues that chapter and the next one. It never resumes an explicitly paused or failed edition.
- The preparation page displays chapter progress and offers original-text reading. A complete chapter replaces the preparation page automatically, restoring the saved paragraph anchor. There is no partial-language fallback inside the chapter.
- The reader's **Translation** panel and book details provide whole-book preparation, pause, resume, and edition selection. Pausing lets an already-running batch finish and save its checkpoint. Switching to original text or leaving the reader does not cancel an existing job.
- An edition freezes its endpoint, model, prompt, source fingerprints, and target language. Changing general AI settings does not invalidate finished chapters. An explicit retranslation creates a new edition, retains the old one, and only allows switching after the new book is complete.
- Complete legacy paragraph-cache chapters remain readable with their original note keys. Partial legacy caches are retained but do not produce a mixed-language reading page. New editions use separate per-chapter records and edition-qualified note anchors. No browser database is reset.

## Generation and validation

`translationBookSource` rebuilds the canonical reading fields before SHA-256 fingerprints are computed over chapter structure/text. Workers apply the same normalization after loading JSONB, whose object key order is not stable. `translation-edition.ts` plans consecutive batches. Small chapters fit into one request; larger ones prefer section boundaries and keep multiple paragraphs together. Exceptionally long paragraphs are split without losing source characters and reassembled under the original paragraph ID. Each batch contains at most 12,000 source characters / 80 segments. These are provider-independent safety bounds, not tokenizer-exact limits.

Reference material includes the complete chapter when it is at most 28,000 characters; otherwise it includes section headings and surrounding original text. The book outline, bounded preceding translation, edition style, and an accumulated glossary accompany every batch. Glossary choices already recorded in the edition take precedence over later additions. This is a bounded consistency aid, not a guarantee of literary quality or a whole-book analysis pass.

The provider uses non-streaming Chat Completions and returns JSON with ordered segment IDs, translated text, and optional terms. The response must end normally and cover every expected segment exactly once and in order. Code is preserved. Oversized, malformed, incomplete, or truncated responses are not published. Checkpoints and glossary changes commit together; the complete chapter is assembled and published atomically. Successful chapter publication discards intermediate text checkpoints to avoid duplicating the whole translation in job storage.

Network, rate-limit, and retryable response failures receive at most two automatic retries per batch. Credential/configuration failures stop the job. Resume retries failed chapters, including failures outside the currently open chapter. Models with insufficient output capacity can still fail a batch; the UI retains completed work and reports the problem. Structural checks do not establish translation accuracy.

## Account jobs

Apply `202610180003_chapter_translations` with `npm run db:migrate` before using the new server. It adds `TranslationEdition`, `TranslationChapter`, and `TranslationSelection`; existing paragraph translations remain untouched. `/api/ready` verifies the new tables.

`/api/translations` authenticates Web sessions or native bearer sessions and accepts a validated reading-text snapshot. Books do not need a separate library sync before translation. Edition creation/selection is serialized with the existing account lock. New-edition requests carry a client request ID. Two devices preparing the same selected edition share its chapter jobs.

`src/instrumentation.ts` starts a small worker on each long-lived Node server. Each process handles one batch at a time. A three-minute database lease plus a random fencing token coordinates replicas; provider requests time out after two minutes. Workers only claim active jobs, checkpoint each batch, and resume after a process restart. Checkpoint writes verify the lease and parent book. Soft-deleting a book pauses its jobs and fences in-flight results. No network request happens inside a database transaction.

Platform credentials stay in the server secret. Workers read the platform key for each batch only if the configured endpoint matches the edition endpoint. A model/prompt change leaves the edition frozen. Keys are never copied into jobs or client storage.

This worker requires a running Node process, as provided by the existing standalone Docker/Kubernetes deployment. A request-suspending serverless host would require a separately managed worker. `TRANSLATION_WORKER_DISABLED=1` disables job execution for builds/maintenance without deleting jobs. A crash after the provider answers but before checkpoint commit can cause that batch to be requested again: delivery is at least once, not an exactly-once billing guarantee.

## Local jobs and offline reads

IndexedDB version 3 adds `translation-manifests`, `chapter-translations` (compound edition/chapter keys), and `translation-jobs` without altering existing stores. The root translation runtime survives route changes. Web Locks serialize local generation across tabs. Closing the browser pauses local work; reopening resumes from the last committed batch. A manually supplied local API key remains memory-only and must be entered again after reload; an environment-configured key remains on the local server.

Account clients fetch metadata and download newly ready chapter artifacts once. Reading cached text never needs a provider request. Cached chapters can be read in an already-open app while offline; offline app startup/PWA support has not been added. Existing backup exports still exclude translations; original files, notes, and reading positions retain their existing backup behavior.

## Error presentation

Server task errors persist stable codes. Web and native clients use the same `translationErrorMessage` formatter for Chinese and English; full messages, stacks, causes and upstream responses remain in protected server logs. Source conflicts stop automatic preparation until the source or edition changes. Failed tasks require an explicit resume.

## Validation boundary

Prisma generation, type checking, production compilation, and static review are allowed. No unit/integration/E2E tests or live paid model requests are part of this implementation. Translation fluency, pause/resume behavior, browser layout, offline usage, and cross-device interaction need user validation.
