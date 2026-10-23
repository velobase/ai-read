# Native bookshelf collections

The iOS bookshelf supports named collections with **All books**, **Ungrouped** and individual collection filters. Status and sort filters still apply within the selected collection. The app retains these filters while opening and returning from a book during the same app session.

Use **Manage collections** to create, rename or dissolve a collection. Creating one does not move books automatically. Select books on the shelf and choose **Move to collection**, or use the same action in one book's menu. Creating a destination in that panel selects it; a separate move action applies the selection. **Ungrouped** removes those books' collection membership. Dissolving a collection removes only its grouping and retains its books, notes, translations and reading positions.

## Storage and limits

`shelf_collections` and `book_collections` are additive tables in the existing device SQLite library. A book belongs to at most one collection. Names are trimmed, whitespace is collapsed, and the displayed NFC name is limited to 40 Unicode code points. A normalized, case-insensitive NFKC key prevents duplicate names. At most 100 collections may exist.

Bulk moves validate the complete unique book selection and destination inside one exclusive transaction before changing any membership. Missing books or groups roll back the complete move. Statements use batches of 400 parameters. Deleting a book through the existing database adapter removes its membership; dissolving a collection explicitly removes its memberships without editing book records. Concurrent UI refreshes use request generations; busy refs prevent duplicate submissions or closing during writes.

Collection metadata belongs to the device library and travels in portable reading packs. Native account sync is not implemented. Session filter choices are not saved across app restarts.

## Portable reading packs

The existing v1 format now accepts optional `collections: { name, bookIds }[]`. Older packs still work and do not change collections. Full-library exports include empty collections; a single-book export includes only its collection and its own ID. The shared validator checks normalized unique names, the 100-group limit, membership in the exported book set, and at most one collection per book.

Imports merge by normalized name. Existing local assignments win, while an ungrouped book may receive the incoming assignment. Importing never dissolves a collection or removes its members. On iOS, collection merge and all book, note, bookmark, position and translation writes share one transaction; exceeding capacity rolls back the whole import. Errors are shown inside the import sheet.

Web shelf state lives in localStorage while books live in IndexedDB. Capacity is checked before and inside the book transaction. That transaction also records a collection completion intent. The completion step merges the latest shelf state, preserves local assignments, stages synchronization data and removes the intent. If completion fails after books commit, the UI explicitly reports that the books were imported and collection organization is pending. The next library load or the backup page's retry action resumes it. A concurrent change that exceeds capacity after book commit therefore leaves a pending collection import; it does not roll back already committed books. Completion is scoped to the original local library and filters out deleted books.

## Verification

Type checking, iOS JavaScript export, formatting and independent static review passed. In the local iPhone simulator, the existing Keynes PDF and `结构性改革.epub` were selected together, assigned to a newly created collection and displayed as its two books. The collection was renamed from `经济学` to `经济与改革`; its two members remained visible. Opening the PDF and returning preserved the selected collection and its two-book view. The single-book menu opened the move workflow in the same sheet and was cancelled without changing membership. A read-only SQLite snapshot immediately after the bulk move found unchanged book-body, position, note, bookmark, translation and draft digests. No automated tests, model requests or cloud uploads were run. Deletion, maximum capacity, concurrent failures and recovery remain static-review coverage.
