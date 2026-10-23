# Native translation while reading

Native and Web share one reading flow: choose Original, Bilingual or Translation only and a target language in **Reading language**. The choice takes effect immediately and is remembered for the book. Original text, paragraph IDs, saved translation keys, notes and portable reading data remain intact.

## Reading demand

Bilingual and translation-only modes reuse saved text first. The foreground reader requests missing passages on the visible page and preloads two following paragraphs. It advances to the next visible missing paragraph as completed text arrives, so a page with many short paragraphs does not stall after the first three. Advancing through the book updates that demand; it does not start an entire logical chapter, PDF page range or whole-book job. Book details have no translation preparation card, and there is no app-wide preparation banner, explicit batch continuation or manual pause workflow.

Switching to original text, leaving the reader, backgrounding, changing account/library, target language, server or source-language override interrupts active work. Returning to the foreground can resume missing text for the still-active reading context. The queue serializes requests and guards writes with the current library lease; stale requests cannot publish into a different library.

Original mode and equivalent source/target languages make no new translation request. Saved-note, bookmark and search navigation can display exact saved text without replacing it or changing the book's normal language preference.

## Status and layout

Bilingual mode leaves the original readable while missing translations arrive. Translation-only mode uses placeholders, without inserting original-language fallback text. Loading, offline and failure are shown near the missing content; a persistent failure exposes Retry. Ordinary translation errors do not turn into an API-key configuration wizard.

Layout updates wait for reading interaction to settle and preserve the reading anchor. Status text is not saved as book content and is not part of translation selection offsets. Existing completed text remains available offline.

## Durable paragraph drafts

Long paragraphs are divided into chunks of at most 6,000 UTF-16 code units, preferring word boundaries and preserving surrogate pairs. Only a successfully completed stream enters `translation_drafts`; an interrupted response never counts as completed text. Draft ranges are contiguous and begin at zero.

Draft identity includes the book, paragraph, source hash and length, service origin, account identity, source and target languages, and translation configuration fingerprint. The public `translationContextKey` identifies the normalized provider URL, model and effective prompt without a key or session token. Incompatible configurations cannot be combined into a resumed paragraph.

Checkpoints append to an identical saved prefix. A delayed shorter prefix cannot erase durable work. Only a fully completed paragraph is atomically committed to the existing translation stores and selected for reading; its completed draft is then removed. Existing saved/imported translations win conflicts. Drafts stay out of reading text and portable exports. Deleting a book retains the existing cascade behavior for its draft records.

Output is bounded to 100,000 characters per paragraph. Transient request failures receive at most two automatic retries; persistent failures wait for Retry. Offline state is checked again before continuing. Storage failures stop further generation rather than losing completed chunks while continuing to incur provider charges.

The current flow does not create a separate background execution service or delete prior translations. Saved versions, notes and reading selections remain in SQLite and continue to use the existing export and recovery contracts.

## Validation boundary

The authorized lightweight offline checks in `scripts/check-mobile-reading-translation.mjs` exercise the real scheduler with simulated lifecycle, API responses, storage and timers. They cover saved text reuse, complete long paragraphs, interruption/checkpoint recovery, navigation priority, bounded retries and offline recovery. Mobile TypeScript checks and an iOS Simulator build pass; no real account actions or paid model requests are used. Previous simulator evidence remains in [verification notes](mobile-verification.md); it describes the implementation at the time recorded and does not validate the new interaction. Real-device gestures, translation quality, offline recovery and account changes remain for user validation.
