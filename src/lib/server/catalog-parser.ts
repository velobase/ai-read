import 'server-only';
import { parseEpub } from '../../../packages/reading-core/src/import-epub';
import { bookFromText } from '../../../packages/reading-core/src/import-text';
import { pdfToBook, type ParsedPdf } from '../../../packages/reading-core/src/pdf-document';

export async function parseCatalogBook(bytes: Buffer, id: string, name: string) {
  if (/\.epub$/i.test(name))
    return {
      book: await parseEpub(bytes, id, name, (n) => `Chapter ${n}`, 'Unknown author'),
      warnings: [] as string[],
    };
  if (/\.txt$/i.test(name))
    return {
      book: {
        ...bookFromText(new TextDecoder('utf-8', { fatal: true }).decode(bytes), {
          id,
          title: name.replace(/\.txt$/i, ''),
          author: 'Unknown author',
          section: (n) => `Section ${n}`,
        }),
        sourceFormat: 'txt' as const,
      },
      warnings: [] as string[],
    };
  if (!/\.pdf$/i.test(name)) throw new Error('Please upload EPUB, PDF or UTF-8 TXT');
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  const doc = await task.promise;
  try {
    if (doc.numPages > 1000) throw new Error('PDF exceeds 1,000 pages');
    const parsed: ParsedPdf = { totalPages: doc.numPages, pages: [] };
    let characters = 0;
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      let line = '';
      const blocks: { text: string }[] = [];
      for (const item of content.items) {
        if (!('str' in item)) continue;
        line += item.str + (item.hasEOL ? '\n' : ' ');
        if (item.hasEOL) {
          blocks.push({ text: line.trim() });
          line = '';
        }
        characters += item.str.length;
        if (characters > 20 * 1024 * 1024) throw new Error('PDF text exceeds 20 MB');
      }
      if (line.trim()) blocks.push({ text: line.trim() });
      parsed.pages.push({ pageNumber: n, blocks, method: 'text' });
      page.cleanup();
    }
    const report = pdfToBook(parsed, {
      id,
      fileName: name,
      unknownAuthor: 'Unknown author',
      pageTitle: (n) => `Page ${n}`,
    });
    return {
      book: report.book,
      warnings: report.emptyPages.length
        ? [
            `Pages without text: ${report.emptyPages.join(', ')}. Scanned pages require OCR before publishing.`,
          ]
        : [],
    };
  } finally {
    await task.destroy();
  }
}
