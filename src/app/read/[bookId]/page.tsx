import { ReaderClient } from '@/components/reader/reader-client';
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ bookId: string }>;
  searchParams: Promise<{ at?: string; from?: string }>;
}) {
  const { bookId } = await params;
  const { at, from } = await searchParams;
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
      returnTo={returnTo}
    />
  );
}
