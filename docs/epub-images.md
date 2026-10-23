# EPUB illustrations

The EPUB importer retains supported JPEG/PNG illustrations as local image bytes, with positions beside the existing text. An illustration can contain a table, graph or formula: it remains an image that the reader can open and enlarge. It is not converted into selectable cells, mathematical markup or model-readable text.

## Reading behavior

Images appear before or after their original paragraph. They sit outside the original/translated text blocks, so original, bilingual and translation-only views use the same image position without changing text-selection offsets. Existing captions remain ordinary text paragraphs and can participate in the usual translation workflow; words printed inside the image are not translated.

The web reader reserves image space from validated dimensions before decoding. Pagination keeps the image intact and groups a nearby caption with it where the group fits. Click an illustration to open the viewer, fit its width or zoom up to 400%, and scroll to inspect details. Closing the viewer keeps the current reading page.

The native implementation uses image blocks in continuous and chapter-only scrolling and image fragments in the UIKit curl, slide and instant page modes. It caches validated assets as local files for page rendering and provides a full-screen pinch-zoom viewer. Page-curl layout, the viewer's initial fit and closing it were checked in the simulator as described below. An actual pinch gesture and the other reading modes with images have not been verified.

### Native cache ownership

`cacheBookImage` now requires an immutable `LibraryHandle`. The existing device cache stays at `Caches/bypage-book-images/<asset-hash>.<extension>`. An account library uses `Caches/bypage-book-images/account-<64-hex-scope-digest>/<asset-hash>.<extension>` instead, so identical asset IDs in two libraries do not share a cache file. These remain disposable rendering files; the validated `Book.media` bytes in the selected library are authoritative, and cache paths are not exported in reading packs.

The image-file hook receives the mounted `LibraryLease`, checks it between assets and only exposes URIs/readiness for the matching lease and asset list. Paginated layout identity also includes library scope and epoch. The native reader's existing cache-subdirectory allowance supports the new account paths, and its in-memory image cache keys include the full file URI. No broader native file whitelist was added. The full-screen image viewer and image actions also use the current library context.

The scope changes have static review coverage; account switching with cached illustrations has not been manually exercised. They do not enable native account sync or alter image bytes, placement IDs, paragraph offsets or the established device-library cache path. App account switching and synchronization remain separate work.

Both readers cap an illustration's inline size at its encoded width and height in layout units. Small signatures and ornaments are not stretched across the entire text column; larger charts scale down to the available width and, in paginated reading, the available page height. No reliable EPUB image-density metadata is assumed. Opening the viewer remains an explicit way to enlarge a small image.

Saved reading positions remain text anchors. Closing a viewer does not navigate to another chapter, but reopening a book resumes near the associated text; there is no persistent image-pan, image-zoom or image-only reading position.

## What is retained

The shared parser observes images alongside its existing paragraph conversion. It accepts images that can be placed at an existing paragraph boundary without rewriting text. EPUB-relative references resolve inside the ZIP only; remote URLs and paths outside the archive are not loaded. Repeated image bytes are deduplicated within a book.

Supported bytes are ordinary 8-bit baseline, extended sequential or progressive JPEG, and static PNG. Validation checks image signatures, encoded dimensions, byte limits, asset SHA-256 identities and placement references. PNG chunks also have CRC checks. A bounded amount of NUL padding after a JPEG end marker is allowed, retaining the original bytes and hash. Animated PNG and other image formats are not supported by this illustration pipeline. Cover extraction is separate and has its own existing format limits.

The parser also accepts a direct image prefix at the start of a paragraph when an explicit HTML line break separates it from the text. Such a separate illustration line is placed before that existing paragraph; its text and reference offsets remain unchanged. Whitespace alone is not enough to infer this boundary. Images within sentences, nested wrappers or paragraph suffixes remain unconverted instead of being moved to a guessed position. SVG and unsupported embedded graphics are counted separately. An image-only spine item with no retained paragraph is not assigned a fabricated chapter or text anchor. CSS backgrounds and complex fixed layouts are not reconstructed. EPUB footnotes and internal links use the separate [reference pipeline](epub-references.md). Keep the original EPUB for unsupported layouts.

Import and book details expose retained and unconverted counts. Internally, diagnostics distinguish inline, unsupported, unsafe-path, missing/unreadable, invalid, over-limit and unanchored images. The web importer retries individually if a batch image decompression fails, preserving readable text and other valid images. No placeholder is counted as a retained illustration.

## Limits

These image limits use binary units: 1 MiB = 1,048,576 bytes.

| Scope                                              | Limit                                               |
| -------------------------------------------------- | --------------------------------------------------- |
| One encoded JPEG/PNG asset                         | 4 MiB                                               |
| Retained image bytes in one book                   | 12 MiB                                              |
| Assets in one book                                 | 256                                                 |
| Image placements in one book                       | 2,000                                               |
| Image dimensions                                   | At most 8,192 pixels per edge and 16 million pixels |
| Image bytes across a validated backup/reading pack | 24 MiB                                              |

Hosts also apply entry-count and decompression-byte budgets before inflating referenced images. These limits count JPEG/PNG file bytes before base64 encoding; the resulting JSON is larger. The separate 50 MiB portable-pack file limit still applies; export a large library one book at a time. An oversized or invalid backup is rejected before importing local records, rather than silently dropping its images. These checks constrain encoded structure and decode dimensions; they are not a complete raster decoder or a promise of fidelity for every image variant.

## Data compatibility and reimport

`Book.media` is optional and contains a version, revision, deduplicated assets, ordered placements and diagnostics. Assets carry their hash, MIME type, byte length, dimensions and local data URI. Placements reference an existing `chapterId` and `paragraphId` with `before` or `after` positioning. All media lives outside `Chapter` and `Paragraph`.

Adding images preserves the original chapter objects, titles, paragraph IDs, text and kinds. Translation source hashes, quote ranges, notes and reading progress therefore continue to refer to the same text. Image labels and pixels are not inserted into paragraph strings or text-selection roots.

Reimporting the same book can fill missing media. It can also replace an incomplete media result with a strict compatible superset: every previous asset must retain its bytes and dimensions, and every previous placement must remain at the same text location, with the same alternative text, order and multiplicity. A smaller or incompatible result leaves the saved media intact. Early accepted-count placement IDs are upgraded to source-occurrence IDs during this repair; saved notes and progress do not reference those media IDs. Text is never replaced through this channel.

The ordinary web backup and the portable web/iOS reading pack both retain validated image bytes and placements. Portable packs additionally include translations already saved on the exporting device. They do not trigger translation requests, include API keys or contain the original EPUB/TXT/PDF files. Older books without `media` remain readable, and reimport is the way to obtain illustrations that were never stored.

Web account sync announces a small media revision and transfers book content when an image update is needed. Shelf/progress acknowledgements do not carry image bytes. Server and client use the same compatible-superset rule; differing, incompatible media remains intact instead of repeatedly overwriting either side. This sync path has static review coverage only; live cloud synchronization was not exercised for this change. Native account synchronization is not enabled; use portable packs between web and iOS.

## AI and PDF boundaries

AI context, search and translation continue to consume paragraph text. Keeping an illustration does not send its pixels to the configured model, perform image OCR or translate its embedded labels. A textual caption can be provided as an ordinary source paragraph; that does not mean the model has seen the graph itself.

PDF text conversion is separate. Its reflowed paragraphs can lose graphical or mathematical layout; the local **PDF original** viewer displays the source page and can return to the corresponding text chapter. Web uses a locally stored PDF Blob; iOS uses a protected application-support file and excludes that file from device backup. Raw PDFs are excluded from account sync and reading packs. Another device needs the original file, and association with an older parsed book requires a matching source fingerprint. See [PDF conversion and original pages](pdf-import.md).

## Observed verification

On 2026-10-23, an in-memory analysis of the user's EPUB 《结构性改革》 retained 47 chapters and 1,640 paragraphs, with identical paragraph IDs, text and kinds before and after enabling image collection. It produced 7 deduplicated assets, 13 placements and 468,192 image bytes. Four inline images and one SVG were explicitly reported as unconverted. Asset hashes matched an independent platform SHA-256 calculation. A partial one-image result upgraded to all 13 placements without replacing chapter objects; the reverse downgrade was rejected.

The web was then checked manually: reimport showed 13 retained / 5 unconverted images, all five substantive chart/table images decoded with nonzero natural widths, table 4.1 and its caption appeared on the same page, and the viewer was enlarged to 150%. Closing it left the reader on page 4 of 26. These observations cover this book and the observed viewport, not all EPUB structures, languages or page sizes.

On iOS, reimport also reported 13 retained / 5 unconverted illustrations, kept the library at seven books without adding a duplicate, and preserved the reading position. After the caption and initial-fit fixes, table 4.1's title and complete image appeared together on page 5 of 26 in page-curl mode. The viewer initially showed both sides of the image, and closing it returned to page 5 of 26. Private evidence is held outside the repository as `ios-epub-caption-and-table.png` and `ios-epub-image-fit.png`.

An actual native pinch gesture was not performed. PNG variants, every chart and reading mode with images, physical devices, RTL layouts, accessibility coverage and actual cloud-media synchronization have not been comprehensively verified. No new automated test suite was added. The real book, extracted content, image bytes and private screenshots remain outside the repository. See the [web](mobile-verification.md#epub-illustrations-continuation--web) and [iOS](mobile-verification.md#epub-illustrations-continuation--ios) verification continuations.

### Paragraph-prefix illustration repair

A subsequent inspection identified the four skipped inline placements as three raster signatures, one reused, each directly followed by a line break before the paragraph's text. The shared parser now retains them before paragraphs `4.10`, `5.22`, `6.16` and `46.14`. The real EPUB contains 10 deduplicated assets, 17 placements and 482,788 image bytes after this repair. All 47 chapters, 1,640 paragraphs, 271,040 text characters, original paragraph IDs/kinds, anchor/reference ranges and previous 13 placements remain unchanged. The single remaining unsupported item is an SVG wrapper around the separately extracted cover.

Manual Web reimport displayed 17 retained / 1 unconverted without making a duplicate book. The first preface's signature appeared with its following date on page 7/7; its rendered dimensions were 238 × 112 CSS pixels, matching its encoded size instead of filling the 720-pixel text column. Clicking opened the viewer and closing returned to page 7/7.

Manual simulator reimport also displayed 17 / 1 and kept the library at seven books. Read-only SQLite snapshots immediately before and after import showed unchanged chapter/reference content and unchanged positions/bookmarks; the existing empty notes/translation/history collections also remained empty. The signature was visible between the preceding text and its date, could open in the native viewer, and returned to the same passage when closed. The original bookmark still opened the earlier reading passage. Only this one new signature was visually exercised; all four were identified in the parsed media. The new intrinsic sizing branches for continuous/slide/instant modes and real devices were statically reviewed, not manually exercised.

Web production build, package/mobile types and iOS export passed. No automated test or model request was run. Private evidence: `web-epub-inline-import.png`, `web-epub-inline-signature.png`, `ios-epub-inline-import.png`, `ios-epub-inline-signature.png`, plus hash/count-only SQLite snapshots outside the repository.

## Implementation map

- `packages/reading-core/src/import-markup.ts`: image collection alongside unchanged paragraph parsing.
- `packages/reading-core/src/book-media.ts`: ZIP references, image validation, assembly and compatible supplements.
- `packages/reading-core/src/reading-backup.ts` and `portable.ts`: validation and cross-platform retention.
- `src/lib/import.ts`, `storage.ts` and sync adapters: web import, local supplement and revision exchange.
- `src/components/reader/book-illustration.tsx`, `reader.tsx` and `reading-navigation.css`: web image blocks and viewer.
- `apps/mobile/src/adapters/files.ts`, `database.ts` and `book-media.ts`: native import, persistence and disposable render cache.
- `apps/mobile/src/components/book-image.tsx` and the native reader module: native image blocks, zoom viewer and paginated rendering.
