'use client';

import dynamic from 'next/dynamic';
import type { TranslationSearchTarget } from '@/lib/translation-search';
import { ReaderLoading } from './reader-loading';

// Preferences, viewport state, and the book library belong to the browser.
const Reader = dynamic(() => import('./reader'), { ssr: false, loading: ReaderLoading });

export function ReaderClient({
  bookId,
  paragraph,
  noteId,
  textOffset,
  translationTarget,
  returnTo,
}: {
  bookId?: string;
  paragraph?: string;
  noteId?: string;
  textOffset?: number;
  translationTarget?: TranslationSearchTarget;
  returnTo?: string;
}) {
  return (
    <Reader
      key={JSON.stringify([bookId, paragraph, noteId, textOffset, translationTarget])}
      bookId={bookId}
      targetParagraph={paragraph}
      targetNoteId={noteId}
      targetTextOffset={textOffset}
      targetTranslation={translationTarget}
      returnTo={returnTo}
    />
  );
}
