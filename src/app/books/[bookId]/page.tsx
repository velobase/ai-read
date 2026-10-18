import { BookDetailPage } from '@/components/library/book-detail-page';
export default async function Page({ params }: { params: Promise<{ bookId: string }> }) {
  const { bookId } = await params;
  return <BookDetailPage id={bookId} />;
}
