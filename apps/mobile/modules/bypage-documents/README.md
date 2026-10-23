# ByPage document inbox

An iOS Expo local module for the system **Open in ByPage** action. It does not parse a book or add anything to the library. The app lists pending items and explicitly opens the existing import preview.

- `available` detects whether the installed native build includes version 1.
- `listPending()` returns `{ id, name, uri, size, createdAt }[]`, oldest first. `createdAt` is Unix milliseconds and `uri` is exclusively an app-owned copy.
- `addListener('inboxChanged', callback)` signals an incoming item, an incoming error, or a dismissal. Subscribe before listing, and list again on foreground. Events contain no paths.
- `takeError()` consumes the most recent incoming error: `limit`, `unsupported`, or `read`. Errors are bounded in memory; pending documents are persisted.
- `dismiss(id)` removes only that UUID's inbox copy. The caller decides when import succeeded or the user explicitly removed an item. Closing a preview need not dismiss it.

Only file URLs with PDF, EPUB, TXT, or JSON extensions are admitted. Copies are coordinated off the main thread while security-scoped access is held. The original source is never modified or removed. The stream uses a 64 KiB buffer, rejects symlink leaves and non-regular files, and checks the byte limit before every write. Limits are 30 MiB per book, 50 MiB per JSON file, 5 items, and 150 MiB in total. A full inbox rejects the new item without evicting an existing one.

Each item is staged in a UUID directory under Application Support, with protected files excluded from backups. Metadata is written last and the directory is atomically renamed before publication. Completed staging items can be recovered after interruption; incomplete staging copies can be removed. Committed items do not expire. The originating URL is not persisted. In-flight URL-digest deduplication and a three-second content fingerprint (name, type, size and streamed SHA-256) suppress duplicate launch/open callbacks, including provider URLs that differ, while allowing later explicit imports. Fingerprints remain in memory only.

`ByPageDocumentsAppDelegateSubscriber` handles both legacy launch options and open-URL callbacks. The installed Expo 57 `ExpoAppSceneDelegate` forwards cold scene connection URLs and warm URL contexts to the latter callback. This persists the copy before any JavaScript listener is required. No generated AppDelegate changes are needed. Expo may separately expose a launch URL through its generic React Native Linking machinery; this module and the app's import path do not consume it or send it across this bridge.

The document type declarations live in `app.config.js`: Viewer / Alternate, import-copy semantics, and no Files sharing of the app's Documents directory. Native configuration changes require the app's usual prebuild, CocoaPods, and native build steps. A missing module has an inert optional JavaScript bridge, so older installed builds remain usable.
