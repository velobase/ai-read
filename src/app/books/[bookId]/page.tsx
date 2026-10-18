import { BookDetailPage } from '@/components/library/book-detail-page';
import { RecommendedBookPage } from '@/components/library/recommended-book-page';
import { recommendedBooks } from '@/lib/recommended-books';
export default async function Page({ params }: { params: Promise<{ bookId: string }> }) {
  const { bookId } = await params;
  const recommendation = recommendedBooks.find((book) => book.id === bookId);
  if (recommendation) return <RecommendedBookPage book={recommendation} />;
  return <BookDetailPage id={bookId} />;
}
