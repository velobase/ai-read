# Reading bookmarks

Bookmarks save a reading location separately from highlights, notes and the latest reading progress. Web and native readers expose an independent bookmark list with add-current-position, optional name, jump and delete. Web adds text search; native supports reading-order and newest-first sorting. Existing notes retain their meaning and counts.

## Shared data contract

`packages/reading-core/src/bookmarks.ts` validates `Bookmark`: book-scoped ID, stable original paragraph ID, chapter, UTF-16 text offset, original/translation source, short quote, optional exact translation key, label and creation time. Original offsets are checked against the unchanged paragraph text. Quotes and labels are bounded to 280 and 120 characters; each book is bounded to 1,000 bookmarks. Adding the same exact location returns its existing bookmark; progress and page fractions are not part of location identity.

A translated bookmark retains the full cached translation key. Web resolves only that key/edition. Native accepts its language cache only for the exact portable translation key, and additionally verifies the stored quote at the original offset or a unique quote match. Imported Web edition keys are retained but cannot be resolved from a different native cache. A missing or incompatible translation falls back explicitly to the original paragraph. Visiting a bookmark does not start a model request or change the saved global reading language.

## Persistence and compatibility

- Web IndexedDB version 5 adds the `bookmarks` object store without rebuilding existing stores. Add/edit/delete use a single transaction with sync staging. Editing or deleting a stale sheet item fails visibly so it cannot overwrite another tab's changes.
- Native SQLite adds a separate bookmark table and removes a book's bookmarks with its book. Existing note data is unchanged.
- Version 1 reading backups and portable libraries accept an optional `bookmarks` array, bounded to 10,000 per pack. Old packs remain valid. Restore adds missing IDs and retains local versions of existing IDs; the whole import fails if its merged per-book result exceeds the bound. Original PDF files remain device-local and excluded.
- Web guest-library import reads bookmarks only if the older guest database contains the store. Library, per-book portable export, and synchronization recovery export retain bookmarks.

## Account synchronization

The Web account sync protocol adds `bookmark` records with versioned updates and deletion tombstones. Prisma migration `202610230002_bookmarks` creates an independent table with the book's composite foreign key. Server writes validate the shared contract, matching IDs and active per-book count under the existing account transaction lock. Deleting a book tombstones its bookmarks together with the other child records.

Concurrent differing label edits keep the pending local version as a separate conflict copy, then accept the remote version. All remote bookmark tombstones across every collection page are applied before additions, so a full collection can receive a replacement. Conflict copies replacing a remotely deleted ID use the resulting count. A genuinely additional conflict at the per-book limit fails visibly rather than discarding a label. Recovery snapshots taken before remote book deletion include bookmarks. Native account library synchronization is still disabled; native bookmarks move across devices through reading packs.

The existing reading-progress write path also now retains validated `textOffset`, `textSource` and `textQuote`, which it previously dropped during server writes.

## Verification boundaries

Implementation review, type checking and build results are recorded in `mobile-verification.md`. Actual account conflict sync, translated-bookmark recovery across different caches, every scrolling mode, accessibility and real-device behavior require separate verification. No automated test suite or paid model request is needed for this feature.
