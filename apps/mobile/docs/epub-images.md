# EPUB illustrations on iOS

EPUB imports retain independently anchored JPEG and PNG illustrations in a `Book.media` sidecar. Text, chapter and paragraph identities remain unchanged. Reimport and portable-library restore use the shared media supplementation rules and keep existing notes, translations and reading progress.

Continuous and chapter scrolling show illustrations at their original aspect ratio. Curl, slide and instant page modes treat each image as an indivisible block. An image taller than one page is fitted completely onto its own page, without cropping. Tap an image in any mode to open the full-screen viewer, pinch to zoom and scroll through the entire source. Closing this viewer keeps the current reading page.

Image pages still save the adjacent text anchor. Reopening the book, changing type settings or switching reading modes can therefore return to the adjacent paragraph rather than a particular image among several images at the same paragraph. The portable position format has not been extended with image anchors in this iteration.

Imports report retained and skipped image counts. Inline/signature images with no precise paragraph boundary, unanchored image-only spine documents, SVG and unsupported or invalid images are reported rather than moved or converted into text paragraphs. Keep the original EPUB for those elements and complex layouts. Bounds are enforced by `@bypage/reading-core` (currently 4 MiB per encoded image, 12 MiB per book, 8192 pixels per edge and 16 million decoded pixels).

The portable book keeps validated data URIs. Rendering uses disposable SHA-named files in the app cache; native page payloads carry only file references, staying below the existing 2 MiB bridge limit. Native page thumbnails decode off the main thread with a bounded cache. A failed native decode triggers one cache repair per asset per layout, then reports an error if it still cannot be displayed. The full-screen viewer reads the authoritative source.

The iOS reader module exposes `mediaVersion: 1`. A development build with the earlier text-only module must be rebuilt to support native illustrated pagination. It shows an explicit update message for image chapters; scroll reading remains available. Type checking and Swift syntax parsing alone do not validate native rendering, page gestures or zoom interactions; these require the local Simulator check.
