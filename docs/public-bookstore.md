# Public bookstore and platform translation

The public catalog is separate from users' private book libraries. `/admin` requires a web session whose User.isAdmin is true. Public browsing and book download do not require an account. Translation requires a signed-in account and uses the server's AI_BASE_URL, AI_MODEL and AI_API_KEY. No user-supplied provider or key is accepted by the hosted service; personal translation instructions remain editable.

```mermaid
erDiagram
  CatalogBook ||--o{ CatalogEdition : editions
  CatalogEdition ||--o{ CatalogAsset : files
  CatalogEdition ||--o| CatalogImportJob : parsing
  CatalogBook ||--o| CatalogPublication : published
  CatalogEdition ||--o| CatalogPublication : selected
  CatalogCollection ||--o{ CatalogCollectionItem : ordered_books
  CatalogBook ||--o{ CatalogCollectionItem : belongs_to
  User ||--o{ Book : private_library
  Book ||--o{ Note : notes
  Book ||--o{ Bookmark : bookmarks
  Book ||--o| ReadingProgress : position
```

A downloaded book uses its immutable catalog edition ID as the local/private Book.id. The file is a complete validated reading-core Book, including supported images, TOC and references. An updated upload creates a new edition, preserving existing reader copies and paragraph anchors. Metadata edits apply to new downloads. Unpublishing removes public access without deleting users' copies. There is no billing or rights approval workflow.

## Admin workflow

1. Save title, author, URL slug, language, category and description. Source link is optional.
2. Upload EPUB, text-layer PDF or UTF-8 TXT (30 MB maximum).
3. A persistent database queue parses the source into a reading bundle. Worker leases recover interrupted jobs; failed jobs can be explicitly retried. PDF OCR is not performed on the server. Parsing warnings remain visible.
4. Preview chapters, then publish the ready edition. Draft source files are never publicly accessible.
5. Create collections, select books in display order and save. Only published books appear in the public collection.

Object storage uses the private GCS bucket configured by CATALOG_BUCKET. The runtime service account has bucket-scoped object permissions. Database rows retain file size and SHA-256, checked before delivery; clients validate size, hash, book schema and edition identity before writing their local library. There is no public upload or bootstrap endpoint.

## Initial content

`scripts/publish-classics.ts` downloads complete EPUB editions from the official Project Gutenberg pages for Pride and Prejudice (1342), Alice's Adventures in Wonderland (11), Frankenstein (84) and The Adventures of Sherlock Holmes (1661). Original credits and license text remain inside the reading bundle. These entries are marked public domain in the USA by their source catalog. Source links provide the original formats.

Run `NODE_OPTIONS=--conditions=react-server npx tsx scripts/publish-classics.ts` to prepare local publication previews; add `--publish` with operator-provided DATABASE_URL and CATALOG_BUCKET to import and publish. The script is idempotent for already-published entries. It does not grant admin privileges or embed credentials.

## Mobile translation

Downloaded books enter the existing local library. Book details offer translation preparation; the reader supports paragraph, chapter and book ranges and bilingual display. Translation batches save completed paragraphs locally. The current native queue runs in the foreground and pauses on backgrounding, account changes or cancellation; users can resume the unfinished range. Billing is not implemented.

The iOS storefront requires the updated app binary. Existing native translation endpoints use the platform configuration as soon as the server deploys. Keys stay server-side. Complete exceptions, upstream error responses and request correlation remain in protected logs; privacy disclosures describe this processing.

Validation for this change is type checking, production builds and static review. No unit, integration or end-to-end automation was run, following the user's preference.
