# Native library protocol v2, local exact translations and proposed v3

This is the implemented backend contract. The native App now has a separate v2 library authorization action, explicit isolated account-library selection, a transactional outbox and four-entity synchronization. Its existing AI-only sign-in remains compatible. Server discovery alone grants no access and uploads no device books; copying a selected device book is a separate user action. Real account authorization, round-trip synchronization and multiple-account switching have not yet been manually verified. See [implementation and verification boundaries](native-sync-design.md).

## Discovery and consent

`GET /api/mobile/v1/config` remains version 1 with `nativeAccountSync: false`. New clients explicitly use `GET /api/mobile/v2/config`, which returns the existing product/AI fields plus:

```ts
{
  version: 2;
  nativeAccountSync: boolean; // nativeAuthConfigured(), server availability only
  librarySync: {
    version: 1;
    entities: ['book', 'position', 'note', 'bookmark'];
  };
  permissions: ('account_ai' | 'library_sync')[];
}
```

An unauthenticated response has no permissions. An existing mobile token has only `account_ai`. The server does not infer library permission from the client's version, headers or requested scopes.

`/mobile/library/authorize` uses `GET` and explicit confirmation `POST` on `/api/mobile/v2/auth/authorize`. This route has a fixed profile: `account_ai` plus `library_sync`. Its HMAC nonce binds the browser session, canonical origin, PKCE challenge, state, fixed callback, profile and permissions. The existing AI-only route and nonce remain compatible. Both flows use the existing one-use `/api/mobile/v1/auth/token` exchange and `/api/mobile/v1/auth/session` verification/revocation; session responses now include the persisted permissions. The exchange never accepts an extra permission from its body.

## Protected transport

`GET` and `POST /api/mobile/v2/sync` require:

- `Authorization: Bearer <mobile-session-token>` with `library_sync`.
- `x-reader-user` exactly equal to that authenticated session's stable user ID. The header is an additional account fence, not authentication by itself.
- `Host` matching configured `APP_ORIGIN`. If `Origin` is present it must match exactly; non-GET/HEAD requests require it.
- `Content-Type: application/json` on POST. Responses use `Cache-Control: no-store`.

No cookies, caller-supplied account ID or AI-only token substitute for the required mobile session. Token and private request contents must not be put in URLs, UI state or diagnostics.

GET accepts only `entity`, `bookId`, `id`, `after` and `content`, with no duplicate parameters. Omitted `entity` defaults to `book`. IDs and nonempty cursors use the existing `validSyncId` rules; omit `after` for the first page rather than sending an empty value.

| Request                  | Required query                             | Additional rules                                                                            |
| ------------------------ | ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| List books               | `entity=book`                              | No `bookId` or `id`; optional `after`                                                       |
| Read a book              | `entity=book&bookId=…&id=…`                | IDs equal; optional `content=0` for metadata only or `content=1` for full content (default) |
| List notes/bookmarks     | `entity=note` or `bookmark`, plus `bookId` | Optional `after`; no `content`                                                              |
| List the book's progress | `entity=position&bookId=…`                 | No `after` or `content`                                                                     |
| Read a child record      | `entity`, `bookId`, `id`                   | Position ID equals book ID; no `after` or `content`                                         |

Lists return `{userId, items, next}` with ID-ordered pages of at most 200 version/tombstone descriptors. They do not return whole book contents. Single-record reads return `{userId, record}`. Keep following `next` until null; a final empty page is possible. This is the existing server protocol, not a cross-page database snapshot.

POST accepts no query string. Its JSON frame is `{entity, bookId, id, baseVersion, mutationId, deleted, data?}`. The entity must be one of the four negotiated values, and book/position IDs must equal `bookId`. The shared `syncBody` applies a 96 MiB raw-body cap; `writeRecord` applies the existing book, sidecar, position, note and bookmark validators and limits. Books can include validated EPUB media/references; raw PDF originals have no transport field.

## Mutations, deletion and errors

Writes reuse the Web server's per-account lock, versions and mutation IDs. A matching current mutation ID returns its existing result. Otherwise the base version must match; a stale base returns HTTP 409 and the current record. A missing/deleted parent returns 409 with `parentDeleted: true`. Native clients must preserve later local edits and recovery data before handling either conflict; those client algorithms are not implemented by this endpoint.

Book metadata acknowledgements do not resend full text or image bytes. Updating media requires compatible book content and the existing strict supplement rules. Book deletion creates tombstones for related progress, notes, bookmarks, translation-cache and chat records, and pauses translation jobs. The browser consent discloses this effect even though translation and chat endpoints are not exposed here. Independent translations, conversations and preferences require separate contracts and renewed permission consent.

| Status                                          | Meaning                                                                                 |
| ----------------------------------------------- | --------------------------------------------------------------------------------------- |
| 400 `sync-invalid`                              | Invalid/duplicate query, unsupported entity, malformed JSON or failed record validation |
| 401 `invalid_session`                           | Missing, expired, revoked or invalid mobile credential                                  |
| 403 `library_permission_required`               | Valid AI-only session; explicit library authorization is required                       |
| 403 `sync_identity_mismatch` / `invalid_origin` | Account header or origin does not match; do not fall back to guest requests             |
| 404 `sync-missing`                              | Requested single record is absent                                                       |
| 409                                             | Version conflict or deleted parent; preserve local work before resolving                |
| 413 `sync-invalid`                              | Request body exceeds the transport budget                                               |
| 503 `auth_unavailable` / `sync-unavailable`     | Authentication configuration or backend unavailable                                     |

The POST handler rechecks the current session after reading a potentially large body, before entering the shared write transaction. This does not provide an App storage lease or undo an already accepted write after logout; request cancellation and immutable library identity remain client responsibilities.

## Current verification

Prisma generation, TypeScript checking and static review passed. The additive permissions migration ran successfully only against the confirmed local PostgreSQL database; its relevant account/library tables were empty. No legacy-session runtime check, signed-in data transfer or complete native synchronization is established by those checks. No automated tests or account uploads were performed for this foundation.

## Saved translations: implemented locally, remote v3 pending

Local exact-version storage, legacy migration, completed-translation commits, native version selection, exact reading references, portable-library v2 and full recovery archive v2 are implemented. The shared pure helpers now live in `packages/reading-core/src/saved-translation.ts`; the former mobile adapter re-exports them for compatibility. Web also has independent exact-version storage and consumes v2 reading packs.

These local features do **not** implement remote v3 authorization, saved-version upload/backfill or a native published-edition endpoint. V2 consent and transport remain restricted to `book`, `position`, `note` and `bookmark`. A note or bookmark may carry an exact translation key, but transferring that reference does not transfer the referenced text or grant translation permission.

The existing native `translations` table remains a genuine legacy paragraph-to-text cache per book and language. It is no longer the destination for newly completed saved versions or a projection of another selected edition. Exact versions and the current display choice have separate storage, so reading one version does not redefine another version's identity.

### Immutable names and local validation

New locally saved versions use this key, with a newly generated canonical lowercase UUID:

```text
<language>:<paragraphId>:saved-<uuid>
```

`savedTranslationKey(language, paragraphId, uuid)` formats and validates that name without generating randomness. `resolveSavedTranslationIdentity(book, key)` uses the actual book's paragraph IDs and the shared `resolveTranslationKey` parser. Colons inside paragraph IDs are supported; `split(':')[1]` is not a valid parser. Language and paragraph IDs retain their exact spelling. The existing `validSyncId` maximum of 200 characters still applies to the whole key. Unrepresentable keys fail explicitly; neither the paragraph ID nor the UUID may be truncated, sanitized or replaced silently.

The resolver distinguishes four existing namespaces:

| Suffix                        | Meaning                              |
| ----------------------------- | ------------------------------------ |
| `saved-<uuid>`                | New immutable saved version          |
| `portable-v1`                 | Existing portable/native alias       |
| `edition-<editionId>`         | Exact published Web edition          |
| Other supported legacy suffix | Existing exact legacy cache identity |

These classifications do not prove account ownership or remote publication. In particular, constructing an `edition-` key does not make a native paragraph a published Web artifact.

The shared validator accepts this local record shape:

```ts
type SavedTranslationVersion = {
  version: 1;
  bookId: string;
  key: string;
  language: string;
  paragraphId: string;
  kind: 'saved' | 'portable' | 'published' | 'legacy';
  chapterIndex: number;
  sourceScheme: 'bypage-source-v1';
  sourceFingerprint: string;
  text: string;
  textHash: string;
  createdAt: number;
};
```

`validateSavedTranslationVersion(book, value)` requires an already validated, immutable book. It checks the exact book/key/language/paragraph/chapter relationship, the source scheme and fingerprint, a nonempty translation of at most 100,000 UTF-16 code units, a matching text hash and a bounded creation time. It returns an allowlisted record. Text is not trimmed, normalized or truncated. `textHash` is SHA-256 of the exact text's UTF-8 bytes; this differs from Web search's existing hash of a JSON-quoted string.

`assertSameSavedTranslationVersion(existing, incoming)` is for two already validated records. The same book and key must retain the same source, paragraph and exact text. A conflicting value raises an immutable-version conflict rather than overwriting it. An identical replay keeps the first saved creation metadata. Neither helper reads SQLite, logs in, imports data or grants permission.

Two devices can hold different texts under the same `portable-v1` key. Local migration retains that exact alias and does not rewrite existing note/bookmark references. Importing a conflicting text under an already stored exact key fails atomically; it does not replace the local text or invent a new alias. Any future cross-device reconciliation of that conflict needs an explicit contract. Unknown Web edition keys are never rebound through language, a short preview or a matching prefix. Ambiguous or unavailable exact references continue to fall back visibly to original text.

### Canonical source proof

The negotiated scheme is `bypage-source-v1`. Canonical chapter identity hashes the UTF-8 encoding of this JSON tuple:

```text
['bypage-chapter-source-v1', chapter.id, chapter.title,
 chapter.sourcePage ?? null,
 chapter.paragraphs.map(p => [p.id, p.kind, p.text])]
```

Canonical book identity similarly hashes `['bypage-book-source-v1', book.language, chapterFingerprints]`. Paragraph order, source-page numbers, text and chapter titles remain significant. Object insertion order does not. Editable source-language overrides, TOC entries, media and references are excluded. Whitespace and Unicode are not normalized because saved offsets refer to exact text.

These hashes do not replace existing Web `chapter-v1` hashes. Existing Web manifest/chapter reads verify the stored legacy artifact hash against the unchanged raw parent source before attaching canonical proof. Consumers use a valid canonical scheme/fingerprint pair when present; an incomplete or invalid pair cannot fall back to the legacy hash. Old records without either canonical field retain the legacy-hash check. A future native published-artifact endpoint must preserve this validation, including exact account-owned book ID, edition ID and chapter index. Native draft `sourceHash` hashes raw paragraph bytes and is also a separate identity.

A fingerprint is a compatibility check, not authentication. It excludes book ID intentionally, so restored copies can have identical source fingerprints. Downloads still require the exact account-owned book ID. PDFKit and PDF.js books with different paragraph structures must not exchange translations merely because their PDF-file hashes match.

### Implemented native storage and consumers

`apps/mobile/src/adapters/translation-store.ts` manages three tables in each immutable device/account library database:

- `translation_versions`: immutable records keyed by `(book_id, key)`.
- `translation_selections`: display choices keyed by `(book_id, language, paragraph_id)`, referencing an exact version.
- `translation_migrations`: a durable per-book legacy-migration marker.

Foreign keys follow book deletion. Migration validates the old completed cache and inserts exact `portable-v1` records in one transaction, preserving the original cache and existing references. It fills missing selections without replacing an existing choice. Migration is local, requires no model call or upload, and fails explicitly on invalid data or immutable conflicts rather than truncating it.

Completed-paragraph writes and draft completion use the same writer. A newly completed paragraph gets a `saved-UUID` key; an existing selected translation wins. Draft completion inserts the version and selection and removes the completed draft atomically, with library/controller guards. Partial drafts never appear as completed versions or portable translations. These writes do not stage translation entities in the v2 account outbox.

Database display reads return parallel text/key maps. Exact reads are independent of selection; batched exact reads support AI-history restoration. The native reader provides a per-paragraph version chooser. Choosing a version changes that local selection, captures/restores the reading anchor and revalidates the quote against the text that will actually be shown. Missing or changed translated anchors return to a safe original position. The global language/mode preferences are not changed by a saved-reference return or version choice.

Passage selections, note highlights, bookmarks, AI focus/history, speech segments and search returns carry the exact key. Explicitly reopening an old note/bookmark can temporarily reveal its saved version while the default selection remains unchanged. Text equality alone does not merge two keys. Pagination retains key metadata alongside text, so highlighting and subsequent captures identify the displayed version.

Imports preserve existing local selections; an unselected imported version remains available without automatically becoming the displayed text. Copying a device book to an account library uses the full v2 reading pack locally and preserves these exact versions; it does not upload them through the four-entity protocol.

### Implemented Web storage and conflict boundaries

IndexedDB has separate `translation-versions` and `translation-selections` stores. V2 import validates exact versions and commits them with books, notes, bookmarks and positions in the same transaction. Existing selections win. Where an incoming choice would displace an older implicit legacy choice, the import first materializes that valid local choice without changing its key.

The reader can display saved individual paragraphs, including partial chapter coverage, without claiming the chapter is complete or automatically preparing more text. An explicitly selected published edition remains a separate boundary: its missing chapters are not filled with unrelated legacy or imported versions. Explicit old-reference and local-search returns read and verify the requested exact version independently of the current display selection. Failed exact-source validation cannot silently fall back to a same-named legacy value.

Same-key/different-text conflicts are rejected in both write orders. Import checks existing legacy text and chapter artifacts; later legacy synchronization, chapter downloads and local chapter completion check already imported exact records before writing. Chapter checks include book, language, paragraph and edition identity and run inside the artifact write transaction. This protects the independent exact store without treating an `edition-`-shaped key as proof of server publication.

### Pending v3 authorization and cross-device transport

V3 must require new explicit saved-translation consent, proposed as `saved_translations`, alongside the existing library grant. Neither a v1 AI token nor a v2 library token gains this permission through client version or discovery. The consent must describe completed saved text transfer; it does not cover translation drafts, AI conversation history, preferences or starting a paid translation task.

Two transport paths are needed:

- Completed native/legacy saved paragraphs use explicit exact identities, source proof and immutable-text CAS. Parent-book and account checks, lease cancellation, late acknowledgements and conflict recovery remain mandatory. After new consent, existing completed local versions need a bounded, resumable outbox backfill; staging only future translations would leave prior work unsynchronized. Device-library records are never uploaded just because a user signed in.
- Modern Web editions need a new read-only native published manifest/chapter endpoint. It must return only ready artifacts with their true edition IDs and verified source proof. A manifest may expose a bounded model label, timestamps, selected ID and published chapter descriptors; it must omit provider configuration, prompts, credentials, glossary and unfinished job checkpoints. These reads cannot call prepare/new/resume or start a worker. This native endpoint and its client remain unimplemented; existing Web cookie-authenticated reads are not a substitute for new native consent.

Do not materialize arbitrary edition-shaped keys into the legacy text map as a shortcut. A validated local exact record can be read as saved content, but it does not authenticate a remote published edition or authorize its download. Web paragraph-level display for saved native results is implemented; transport of those results is still pending. Downloads exceeding the 100,000-code-unit paragraph limit must fail or be explicitly reported as unsupported, never truncated into a different version.

### Implemented portable v2 and full recovery v2

Portable-library v1 remains compatible with its existing single-text-per-language map and quote-verified `portable-v1` rebinding. Portable-library v2 retains the existing backup/translations/collections fields and requires these two arrays, which may be empty:

```ts
translationVersions: SavedTranslationVersion[];
translationSelections: {
  bookId: string;
  language: string;
  paragraphId: string;
  key: string;
}[];
```

V2 preserves note/bookmark keys and ranges as stored; it never rebinds them to the current selection or a portable alias. The validator checks duplicate book/key identities, unique selection tuples, selection targets, canonical source proof and raw text hashes. Limits are 100,000 versions, 100,000 selections, 100,000 UTF-16 code units per paragraph, 30 MiB of UTF-8 translation text across exact and legacy entries, and 50 MiB of serialized UTF-8 pack data. Excess data is rejected, not truncated. V1 frames containing v2-only fields are rejected rather than silently losing those fields.

Native and Web v2 exports preserve all supported locally saved exact versions, including unselected ones, plus the display choices. The legacy `translations` field contains only genuine legacy maps when used; it is not a flattened projection of new selected versions. Web export can represent content-compatible legacy edition-shaped entries as independent exact records without inventing a server manifest. Its published selection still follows the validated manifest/artifact boundary. Importing or exporting a reading pack does not grant remote permissions.

Native full recovery capture includes version and selection rows and emits archive version 2 when they are present. Old version-1 archives remain readable and keep their previous digest identity. Restore writes a fresh device book and all exact versions, then its selections, before filling missing legacy choices; the book and completion marker commit together. Only each version/selection's `bookId` changes. Paragraph IDs, exact keys, source proofs, text hashes and note/bookmark references remain intact. Recovery does not replay an outbox, and imported archives cannot use an untrusted account label to open an account database or fetch an edition. Web conflict/deletion recovery also retains exact records and selections for portable v2 export.

### Remaining verification and delivery boundary

The local implementation has passed type checking and independent static review. Runtime/manual results belong in [mobile verification](mobile-verification.md); this protocol document does not infer them from compilation. Remote v3 consent, saved-version transport, resumable outbox backfill and native published-edition reads are still required before claiming saved-translation synchronization. Authorized cross-device transfer and its account/conflict/offline behavior remain unverified here. The existing v2 four-entity permission has not been expanded. No automated tests, remote account transfers or model requests were run for this documentation update.
