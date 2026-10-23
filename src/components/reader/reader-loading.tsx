'use client';

import { LoaderCircle } from 'lucide-react';
import { useI18n } from '@/lib/i18n/provider';

export function ReaderLoading() {
  const { t } = useI18n();
  return (
    <div
      className="flex h-dvh items-center justify-center gap-3 bg-background text-sm text-muted-foreground"
      role="status"
      aria-busy="true"
    >
      <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
      {t('正在打开书籍…')}
    </div>
  );
}
