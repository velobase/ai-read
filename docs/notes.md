# Reading notebooks and readable exports

The native Notes tab offers **By book** and **Recent notes**, with search across saved quotes, thoughts and book titles. Selecting a book narrows that scope. Search folds case, accents, full-width Latin characters and whitespace. Opening a saved passage and returning preserves the selected book, query, view and result page during the app session. Original and saved-translation notes are labelled separately; older notes without a source anchor are labelled **Source not recorded**.

Both recent notes and search display 60 notes per page, with previous, next and first-page navigation. Pages use SQLite cursor boundaries ordered by stored creation time, book ID and note ID. Search scans bounded batches after the current boundary; one further matching note enables the next page, and its cursor points to the last returned note so that the probe is not skipped. Neither browsing nor search stops at a fixed total count. The separate reader notebook still has its load ceiling described below. Note identities include both book ID and note ID, including when imported books reuse a note ID.

The page label reports this page's count, not a guessed total. Changing the query, book or view resets pagination. Editing, deleting or returning from a passage refreshes the current page; empty or failed deep pages retain a way back. Page boundaries do not freeze a database snapshot across browsing: new notes before the current boundary appear after returning to the first page, and edits can change which notes match. Session page history is not persisted after restarting the app. Returning preserves the page, not its exact list scroll offset.

Quote and thought previews share the reader notebook's bounded excerpt component. When a query matches late in a long note, its surrounding text and highlight are shown. Without a match, previews remain short; opening the editor still exposes the complete saved thought. Exports continue to include all matching notes and full saved text, regardless of the current page. Page loading adds only operation, outcome and duration to the existing local diagnostics buffer; queries, note text and book identifiers are not recorded.

## Notebook inside the native reader

The reader has a separate, virtualized notebook for the open book. It searches saved quotes and thoughts and switches between **This chapter** and **Whole book**. It no longer truncates the display to the first 100 notes. The reader's existing load ceiling is 100,000 notes; this is not an unbounded database search. Chapter filtering follows logical PDF paragraph boundaries, so two chapters beginning on the same physical page remain distinct.

Opening the editor and returning preserves the notebook query and scope. **Read passage** uses the saved source, translation key and character range through the reader's existing verified navigation. Opening the notebook or editing a thought does not itself navigate.

The reader and the main Notes tab share one editor. Saving changes only the thought, preserving the stored quote, anchor, record time and other metadata. An empty thought leaves a highlight. The existing 50,000 UTF-16-unit thought limit is retained. Before an update, a transaction checks that the opened note still exists and its known fields are unchanged; a stale or missing record is reported with the draft still available to copy. Saving never inserts a replacement for a deleted note. A refresh failure after a successful save is reported separately from a storage failure.

## Markdown export

On iOS, **Export notes** captures every saved note matching the displayed book and query scope. The preparation sheet shows the frozen scope and its exact note/book counts. **Share Markdown** explicitly opens the system share sheet. Preparation may be cancelled; changing scope or leaving the screen discards an unfinished preview. A private temporary file is created only for sharing and cleaned up afterward. A failed export retains the original notebook unchanged.

Web's export button uses the same Markdown formatter for its current filtered notes. Each book includes its title and author. Entries include the saved quote, thought, record time, paragraph identifier, original/translated/unknown source, and the available chapter and original PDF page. PDF logical chapter labels use the same precise paragraph boundaries as reader navigation. A quote from a saved translation is exported as it was captured, even if that translation is no longer cached; it is not regenerated or silently replaced with the original.

Book metadata and user text are escaped as literal Markdown content, so saved HTML or image/link syntax is not emitted as an active resource. Files contain no complete book text, API settings, credentials or assistant history. The limit is 10 MiB of the resulting UTF-8 Markdown; an oversized export fails explicitly and asks for a narrower scope rather than truncating notes. Markdown is a readable document, not a replacement for a restorable reading pack.

## Storage and verification boundaries

Native export reads notes and their book/navigation metadata inside one SQLite transaction. It scans batches, checks cancellation and output size, and loads each matching book's navigation once. It neither changes notes nor requests translations. The Web path exports the already loaded local notebook snapshot. Actual simulator observations and build results are recorded in [mobile verification](mobile-verification.md).

## Precise native excerpts

From a passage action or an unsaved note, **Adjust selection** opens a read-only UIKit text view. The full paragraph is available for scrolling and system text selection; confirming replaces only its UTF-16 range. Cancelling keeps the original range and the unsaved thought. The source and language remain frozen. A changed original or saved translation is rejected before confirmation or saving, rather than applying old offsets to new text.

New notes keep the exact selected text and range. Quotes longer than 20,000 UTF-16 units are rejected explicitly to preserve reading-pack compatibility. The selector currently supports paragraphs up to 100,000 UTF-16 units and reports larger paragraphs without truncating them. An older native binary shows an update message. These limits are distinct from the assistant's 4,000-unit input limit.

The selection surface uses system handles and hardware-keyboard selection without an editing keyboard. UIKit's selection menu is available, but ByPage does not trigger its external actions automatically. The paginated reader's page-turn gestures remain separate from this full-screen selector.
