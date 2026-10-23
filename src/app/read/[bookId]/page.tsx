import { ReaderClient } from '@/components/reader/reader-client';
import type { TranslationSearchTarget } from '@/lib/translation-search';
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ bookId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { bookId } = await params;
  const { at, from, note, offset, source, lang, translation, end, textHash } = await searchParams;
  const textOffset =
    typeof offset === 'string' && /^\d{1,8}$/.test(offset) && Number(offset) <= 20 * 1024 * 1024
      ? Number(offset)
      : undefined;
  const translationTarget: TranslationSearchTarget | undefined =
    source === 'translation'
      ? {
          language:
            typeof lang === 'string' && /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(lang) ? lang : '',
          translationKey:
            typeof translation === 'string' && /^[\w.:-]{1,200}$/.test(translation)
              ? translation
              : '',
          textHash: typeof textHash === 'string' && /^[a-f0-9]{64}$/.test(textHash) ? textHash : '',
          sourceEnd:
            typeof end === 'string' && /^\d{1,6}$/.test(end) && Number(end) <= 100000
              ? Number(end)
              : -1,
        }
      : undefined;
  const returnTo =
    typeof from === 'string' &&
    /^(\/|\/(?:library|notes|books|search|discover|categories|collections)(?:[/?][^\n\r\\]*)?)$/.test(
      from,
    )
      ? from
      : '/library';
  return (
    <ReaderClient
      bookId={bookId}
      paragraph={typeof at === 'string' ? at : undefined}
      noteId={typeof note === 'string' && note.length <= 200 ? note : undefined}
      textOffset={textOffset}
      translationTarget={translationTarget}
      returnTo={returnTo}
    />
  );
}
