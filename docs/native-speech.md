# Native read aloud

The iOS reader uses the installed `expo-speech` system-voice adapter. Reading aloud does not request a model, fetch a translation, or upload book text. Voice availability and output routing depend on the device.

## Reading range and source

- The reader toolbar opens the player. Starting from a passage action selects **Selected text**, with the exact source, language, start and end offsets. Changing to **Current passage** or **Rest of this chapter** explicitly widens the range; changing source clears the selection and switches to the passage range.
- **Rest of this chapter** uses the shared logical reading scope. A PDF chapter may span several original pages or end partway through a page. Speech starts at the current paragraph and stops at the logical chapter boundary.
- Original text and saved translations are explicit choices. Translated speech stops before the first missing translation; it does not skip the gap or read the original in its place. The preview reports the contiguous readable count and missing count.
- A run freezes its text, language, range and rate. Later translation arrivals do not extend it. Offsets are UTF-16 and are reused only for the same source. Selected-text plans also verify the complete frozen text against the current original or saved translation. Preview, progress, completion, startup pause and background resume all retain the selected end boundary. Text is split into at most 3,000 UTF-16 units, preferring sentence/whitespace boundaries without dropping characters or dividing surrogate pairs.

## Player behavior

The player supports pause, resume, previous/next paragraph, stop, and explicit passage location. Paragraph changes preserve the paused state. Locating a passage keeps the voice session and temporarily displays the correct source; it verifies that a frozen translation still matches the saved text before applying its offset. Voice boundaries do not move the page or write reading progress.

Backgrounding releases the native utterance and keeps an in-memory paused cursor. Returning does not automatically resume. Manual resume may repeat the last word because the cursor comes from the latest text boundary, not an audio sample position. Leaving the reader stops and clears the run. A process restart does not restore a speech session. This is not a background audio player.

The installed iOS adapter does not emit pause/resume events and its `speak()` API discards the native promise. Commands are serialized across reader mounts; owner/session/utterance guards reject stale callbacks. Pausing during startup cancels the pending utterance instead of claiming a native pause succeeded. A bounded startup watchdog checks synthesizer activity when no start/boundary event arrives and reports a generic error if startup cannot be established.

## Local diagnostics and performance

The existing manual diagnostics export includes speech counters and up to 40 events. Fields are numeric or fixed event names: session/paragraph/chunk ordinals, lengths, UTF-16 offsets, rate and elapsed time. No book identifiers, titles, paragraph IDs, text, language, voice identifiers, URL, key or raw errors enter the speech diagnostics API. Boundary events update counters/latest values without appending an event per word.

The player publishes boundary progress at most four times per second while open. With the sheet closed, boundaries update only the controller cursor; status and paragraph transitions can still update the reader. Diagnostic and UI events establish synthesizer activity, not audible output or voice quality.

## Verification

See [local iOS verification](mobile-verification.md) for the observed manual flows and remaining limitations. No automated test suite was added for this feature.
