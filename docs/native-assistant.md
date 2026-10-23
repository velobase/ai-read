# Native reading assistant

The native reading assistant keeps conversations in the device's existing SQLite library. Each turn records its question, answer, completion status, creation time, model label, scope and original-source ranges. Leaving the reader no longer intentionally discards finished answers. Books and source paragraphs remain unchanged.

## Reading scope and evidence

The default scope is the current chapter. Read chapters and whole-book search are explicit alternatives. The native app uses the shared `readingScopeParagraphs` contract, including PDF logical chapters whose boundaries can fall within the same original page. An ambiguous PDF outline falls back conservatively rather than implying knowledge of a whole chapter.

Evidence is limited to 200 passages, 16,000 source characters in total and 4,000 per passage. Small chapters are included in full when they fit; larger scopes select passages using the focused paragraph, nearby passages and question terms, including Chinese bigrams. The answer shows included/total passage counts and whether extraction was partial. This is bounded local retrieval, not a claim that the model has read the full book. Citations open original text through the reader's return-position navigation.

## Identity and configuration

History is displayed only for the current book, canonical service origin and stable account ID (or explicit guest identity). Account loading and account operations do not temporarily fall back to a guest history. Offline history remains available for an existing cached identity.

Automatic conversation context is narrower: it requires the same origin, account and public AI configuration fingerprint. Only completed answers whose source IDs all belong to the newly selected scope can be reused. At most three recent compatible question/answer pairs are sent, with each previous answer capped at 4,000 characters. Stored answers are not truncated to this request budget.

`aiContextKey` is a SHA-256 fingerprint of normalized provider URL and model. It contains no API key, token, email or session ID. If configuration changes after capability discovery, the server rejects the stale key before contacting the provider. The app refreshes capabilities and preserves the question for an explicit new Send. Older servers without a fingerprint can answer new questions but do not receive automatic conversation history.

## Saving, stopping and exporting

Each request persists once on its terminal path, including stopped or failed partial responses. Partial responses are labelled and never automatically reused as conversation history. Save failures remain visible with a local retry action. A later partial write cannot downgrade an already complete record; saved-as-thought state is preserved independently. History loads in pages of 20 without deleting older records.

The top-level Latest answer action scrolls to the most recent turn. A new completed answer may reveal itself once after saving, but starting a manual scroll or loading older records cancels that automatic movement. Streaming tokens do not repeatedly move the scroll position.

Saving an answer as a thought requires a valid original anchor or the exact cached translation identity and quote. Answers exceeding the existing 50,000-character note limit cannot be saved as a thought; the complete answer remains available in history and export. Missing translated text is not given a fabricated original-text offset.

Per-turn Markdown export includes the question, answer, date, scope, completion warning where needed and source excerpts. It does not include account identities, endpoint configuration or credentials. Export uses the native share sheet and a temporary cache file; payloads above 1 MiB are rejected rather than silently truncated.

Conversations are currently device-local. They are **not included in reading packs or native cloud synchronization**; the assistant displays this limitation. Deleting a book cascades to its conversation rows. Numeric local diagnostics record history load/save duration and outcome without book IDs, questions, answers or source text.

See [manual simulator observations](mobile-verification.md) for the paths actually exercised. Static review does not establish all lifecycle, account-switch or failure behavior.

## Precise selection

An explicit passage keeps its complete UTF-16 range. Input above 4,000 units or an invalid selection is rejected with a visible explanation; it is not replaced with the first paragraph or silently shortened. Original context windows contain the full accepted selection. `readingPassage` uses that same evidence window, so a selection late in a long paragraph is not accompanied by unrelated paragraph-start text.

Chapter scope follows the selected paragraph, including PDF logical chapters that share a physical page. The read-so-far scope retains its existing progress boundary. Before sending a translated selection, the exact local language/paragraph cache must still match its frozen full text. Changing source, language, range or reference scope aborts the previous operation. This change was reviewed without live model requests.
