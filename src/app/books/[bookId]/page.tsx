import { BookDetailPage } from '@/components/library/book-detail-page';
export default async function Page({ params }: { params: Promise<{ bookId: string }> }) {
  return <BookDetailPage id={(await params).bookId} />;
}
