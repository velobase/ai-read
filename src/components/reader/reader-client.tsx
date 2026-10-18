'use client';

import dynamic from 'next/dynamic';
import { useI18n } from '@/lib/i18n/provider';
import { LoaderCircle } from 'lucide-react';

function ReaderLoading() {
  const { t } = useI18n();
  return (
    <div
      className="flex h-dvh items-center justify-center gap-3 bg-background text-sm text-muted-foreground"
      role="status"
    >
      <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" />
      {t('正在打开本地书架…')}
    </div>
  );
}

// Preferences, viewport state, and the book library belong to the browser.
const Reader = dynamic(() => import('./reader'), { ssr: false, loading: ReaderLoading });

export function ReaderClient({
  bookId,
  paragraph,
  returnTo,
}: {
  bookId?: string;
  paragraph?: string;
  returnTo?: string;
}) {
  return (
    <Reader
      key={`${bookId || ''}:${paragraph || ''}`}
      bookId={bookId}
      targetParagraph={paragraph}
      returnTo={returnTo}
    />
  );
}
