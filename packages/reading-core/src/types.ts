export type Paragraph = { id: string; text: string; kind: 'text' | 'heading' | 'quote' | 'code' };
export type Chapter = { id: string; title: string; paragraphs: Paragraph[]; sourcePage?: number };
export type BookTocEntry = {
  title: string;
  chapterId: string;
  paragraphId: string;
  depth: number;
};
export type BookMediaAsset = {
  /** SHA-256 of the decoded image bytes, shared by repeated references. */
  id: string;
  mimeType: 'image/jpeg' | 'image/png';
  dataUri: string;
  byteLength: number;
  width: number;
  height: number;
};
export type BookMediaPlacement = {
  id: string;
  assetId: string;
  chapterId: string;
  paragraphId: string;
  position: 'before' | 'after';
  alt?: string;
};
export type BookMediaDiagnostics = {
  skippedInline: number;
  skippedUnsupported: number;
  skippedUnsafePath: number;
  skippedMissing: number;
  skippedInvalid: number;
  skippedLimit: number;
  skippedUnanchored: number;
};
/** Images stay outside chapters so translation hashes and text anchors remain valid. */
export type BookMedia = {
  version: 1;
  revision: string;
  assets: BookMediaAsset[];
  /** Source order is retained, including multiple images at the same text boundary. */
  placements: BookMediaPlacement[];
  diagnostics: BookMediaDiagnostics;
};
export type BookReferenceRange = { paragraphId: string; start: number; end: number };
export type BookReferenceLink = {
  id: string;
  kind: 'footnote' | 'internal' | 'backlink';
  source: BookReferenceRange[];
  targetId: string;
};
export type BookReferenceTarget =
  | {
      id: string;
      location: { chapterId: string; paragraphId: string; offset: number };
      paragraphIds: string[];
      content?: never;
    }
  | {
      id: string;
      content: Pick<Paragraph, 'text' | 'kind'>[];
      location?: never;
      paragraphIds?: never;
    };
export type BookReferences = {
  version: 1;
  revision: string;
  links: BookReferenceLink[];
  targets: BookReferenceTarget[];
  diagnostics: {
    skippedExternal: number;
    skippedMissing: number;
    skippedUnanchored: number;
    skippedLimit: number;
  };
};
export type Book = {
  id: string;
  title: string;
  author: string;
  language: string;
  /** User correction; `auto` restores the language declared by the imported file. */
  sourceLanguage?: string;
  chapters: Chapter[];
  toc?: BookTocEntry[];
  media?: BookMedia;
  /** EPUB links and supplementary notes never change the imported reading text. */
  references?: BookReferences;
  importedAt: number;
  sample?: boolean;
  sourceFormat?: 'epub' | 'txt' | 'pdf';
  sourcePages?: number;
  subtitle?: string;
  description?: string;
  category?: string;
  cover?: string;
  pageDirection?: 'ltr' | 'rtl';
};
// Display metadata is also used for recommendations that do not contain a book file.
export type BookDisplay = Pick<
  Book,
  'id' | 'title' | 'author' | 'language' | 'sourceLanguage' | 'sample' | 'subtitle' | 'cover'
> & { publisher?: string; listingOnly?: true };
export type Position = {
  chapter: number;
  paragraph: string;
  farthest: number;
  /** Approximate original-text fraction; retained for older progress records. */
  offset?: number;
  textOffset?: number;
  textSource?: 'original' | 'translation';
  textQuote?: string;
};
/** A saved reading location, independent of notes and translation content. */
export type Bookmark = {
  id: string;
  bookId: string;
  position: Position;
  quote: string;
  label: string;
  /** Exact existing translation identity; omitted for original-text locations. */
  translationKey?: string;
  createdAt: number;
};
export type NoteAnchor = {
  source: 'original' | 'translation';
  start: number;
  end: number;
  translationKey?: string;
};
export type Note = {
  id: string;
  bookId: string;
  paragraphId: string;
  quote: string;
  anchor?: NoteAnchor;
  text: string;
  createdAt: number;
};
export type Message = {
  turnId?: string;
  createdAt?: number;
  role: 'user' | 'assistant';
  content: string;
  sources?: string[];
  partial?: boolean;
};
