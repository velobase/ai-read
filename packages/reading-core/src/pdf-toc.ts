import type { Book, BookTocEntry } from './types';

/** Recognize current imports and older parsed PDFs that predate sourceFormat. */
export function isPdfBook(book: Pick<Book, 'id' | 'sourceFormat'>): boolean {
  return (
    book.sourceFormat === 'pdf' ||
    /^[a-f0-9]{64}\.pdf(?:js|kit)-v\d+\.\d+-\d+(?:\.(?:ocr|text))?$/.test(book.id)
  );
}

/**
 * Infer navigation from an existing book's own paragraphs, without reparsing or
 * changing text anchors. Only a consecutive series of explicit English chapter
 * markers with separate uppercase titles is supported; uncertain books return [].
 */
export function inferPdfToc(book: Book): BookTocEntry[] {
  if (!isPdfBook(book)) return [];

  const candidates: { number: number; entry: BookTocEntry }[] = [];
  let previousPage = 0;
  for (const chapter of book.chapters) {
    // A physical page remains the source of every anchor, including partial imports.
    const page = chapter.sourcePage;
    if (typeof page !== 'number' || !Number.isInteger(page) || page <= previousPage || page > 1000)
      return [];
    previousPage = page;
    for (let index = 0; index + 1 < chapter.paragraphs.length; index++) {
      const paragraph = chapter.paragraphs[index];
      const marker = /^Chapter\s+([1-9]\d{0,2})$/i.exec(paragraph.text.trim());
      if (!marker) continue;
      const title = chapter.paragraphs[index + 1].text.trim().replace(/\s+/g, ' ');
      if (
        title.length < 5 ||
        title.length > 200 ||
        title !== title.toUpperCase() ||
        (title.match(/[A-Z]{2,}/g)?.length || 0) < 2 ||
        /[.!?]$/.test(title)
      )
        continue;
      const number = Number(marker[1]);
      candidates.push({
        number,
        entry: {
          title: `Chapter ${number}: ${title}`,
          chapterId: chapter.id,
          paragraphId: paragraph.id,
          depth: 0,
        },
      });
    }
  }
  // Repeated running headers, skipped numbers or contents-page duplicates are
  // ambiguous. Do not reorder or select a convenient subsequence in those cases.
  if (
    candidates.length < 3 ||
    candidates.some(
      (candidate, index) => index > 0 && candidate.number !== candidates[index - 1].number + 1,
    )
  )
    return [];
  return candidates.map(({ entry }) => entry);
}
