# Native document import

ByPage can receive supported local documents through the iOS **Open in / Copy to ByPage** action, including documents selected in Files. This is an app document handler, not a separate Share Extension. The ordinary in-app file picker remains available and uses the same parsing and confirmation flow.

The native implementation and JavaScript integration are in place. Mobile type checking, the iOS JavaScript export, CocoaPods integration and a full Xcode simulator build passed. The rebuilt app was installed over the existing simulator app and the Files/open-in flow was manually checked with both key samples; see [verification](mobile-verification.md#native-filesopen-in-continuation). A Metro reload or JavaScript export alone cannot install the document handler.

## Receive, preview and confirm

Receiving a file stages a private copy in the app's pending inbox. It does not add a book, overwrite a saved book or begin translation. The app shows an **Incoming files** entry on its main screens; receiving a file while reading or using another screen shows a notice without replacing the current reading view.

Open the inbox and choose **Preview import**. EPUB and UTF-8 TXT use the existing book parser. JSON uses the reading-pack/backup validator. PDF opens the existing PDF conversion sheet, including page selection and conversion preview. Only explicit confirmation writes the parsed result to the local library, using the existing import/merge rules. See [PDF conversion](pdf-import.md) for PDF-specific behavior.

The inbox, PDF conversion and import confirmation use a shared presentation coordinator. Preparing a local file keeps the inbox visible and disables its actions. A ready preview waits for the inbox's native dismissal acknowledgement before mounting; its file/payload is retained through the transition. Normal closure also waits for presentation to finish before dismissing, without an arbitrary timer. Recovery confirmation and its completed result reuse the same native modal. A library block or revocation invalidates queued presentations.

| Action or outcome | Pending inbox copy | Local library |
| --- | --- | --- |
| Receive a supported file | Added after copying finishes | Unchanged |
| Close the inbox or cancel a preview | Retained for a later attempt | Unchanged |
| Parsing or validation fails | Retained; it can be retried or removed | Unchanged |
| Confirm and save successfully | Removed after the library save | Imported or merged |
| Library save succeeds but inbox cleanup fails | Retained with a cleanup notice; use **Remove** later | Import remains saved |
| Library save succeeds but shelf refresh fails | Cleanup is still attempted; any remaining copy is reported | Import remains saved; reopen the shelf, without confirming again |
| Choose **Remove** in the inbox | That private pending copy is deleted | Existing books are unchanged |

Committed pending files have no automatic expiry or oldest-item eviction. They remain available after an app restart until a successful import or explicit removal. Files still being copied when the process stops are not shown as complete: the next inbox initialization recovers copies with valid final metadata and removes incomplete staging directories.

For PDF preview, `prepareImport` makes a separate UUID-named cache copy. Before the PDF sheet mounts, its parent owns that copy and releases a cancelled or stale queued result. Once mounted, the PDF sheet owns cleanup: hiding terminates that preview, drains extraction and inspection, and waits for any active retain/save operation before removing the copy. The hidden host remains mounted until its dismissal acknowledgement. Cancelling the preview leaves the inbox item available. A successfully imported PDF can also have its own retained original for local original-page viewing. Removing the inbox item does not delete that retained original or the parsed book.

## Accepted files and capacity

The handler accepts local files with `.pdf`, `.epub`, `.txt` or `.json` extensions. Content is still parsed and validated before library confirmation; a recognized extension is not proof of a valid book or reading pack.

| Limit | Maximum |
| --- | --- |
| One PDF, EPUB or TXT file | 30 MiB |
| One JSON backup or reading pack | 50 MiB |
| Committed pending items | 5 files |
| Combined pending file bytes | 150 MiB |

The UI labels these byte limits as MB. A full inbox rejects new arrivals instead of deleting existing items. Remove or finish importing an existing item before trying again. Ordinary parsed-content, image and reading-pack validation limits still apply after the file-size check.

## Ownership and privacy

The importer reads the source through iOS file coordination and copies it in bounded chunks. It does not edit or delete the original document in Files or its provider. The pending inbox exposes only app-owned copy URLs to the import interface, and deletion accepts a validated inbox item ID rather than an external path.

Pending copies are stored in Application Support, excluded from system backup and protected with iOS file protection until the first device unlock after a restart. The native queue serializes copying, listing, recovery and removal. File payloads must be regular files; the copy checks size while reading and publishes the final inbox directory only after payload and metadata writing finish. Brief duplicate delivery is suppressed in memory using the source-URL digest and a three-second fingerprint of name, type, size and streamed SHA-256. The latter catches launch/open callbacks whose provider URLs differ. Later explicit delivery remains possible; library book deduplication is separate.

This import path does not upload documents, enable account-library synchronization or call a model. Files or another provider may separately download a document to make it readable; that is the provider's operation. Pending raw files are not included in reading-pack exports. Imported content follows the existing local-library and explicit export behavior.

## Implementation and rebuild

- `apps/mobile/modules/bypage-documents/` owns the native AppDelegate subscriber, private inbox and event bridge. Cold-start capture does not require a JavaScript listener; the interface also lists saved pending items when it starts or returns to the foreground.
- `apps/mobile/app.config.js` declares the supported document types and import-copy behavior. It does not enable opening external documents in place or app document sharing.
- `apps/mobile/src/components/use-document-inbox.ts` refreshes pending items and reports native receive errors. A failed native list request does not emit another inbox-change event.
- `apps/mobile/src/adapters/files.ts` exports `prepareImport(libraryLease, { uri, name }, labels)`. It leaves the caller's source intact, returns a parsed preview or a separate PDF preview copy, and performs no library writes. `chooseImport` owns cleanup of its picker-created source cache.
- `apps/mobile/App.tsx` owns inbox actions, preview state, explicit confirmation and cleanup after successful import.
- `apps/mobile/src/components/use-sheet-presentation.ts` supplies the native presentation/acknowledgement state machine. The Reader retains its existing `useReaderSheet` alias and behavior; import and Reader coordination remain separate owners.

Regenerate/install the native iOS dependencies and rebuild the development app after adding this module or changing the document-type declarations, following [local iOS setup](mobile.md#run-locally). The generated `apps/mobile/ios` project is not the source of truth. The optional bridge keeps older installed builds from failing at import time, but those builds do not acquire the new Files handler through hot reload.

Observed checks include EPUB cold opening from Files, EPUB preview cancellation/reopening and successful merge cleanup, PDF warm opening from the system Preview share panel while an EPUB was open, all 190 PDF pages converting to a preview, and cancellation retaining the pending PDF while removing its temporary work copy. The original EPUB stayed at page 7/11 during warm delivery. The first cold check exposed duplicate callback delivery; after the streamed content-fingerprint fix and native rebuild, the same cold flow produced one inbox item.

Remote/iCloud provider downloads, AirDrop, capacity and interruption recovery remain unverified at runtime. A full inbox can report a limit on a repeated callback; callbacks separated by more than the short deduplication window can still create separate pending items. No automated tests were added or run for this change, and no model requests were made.
