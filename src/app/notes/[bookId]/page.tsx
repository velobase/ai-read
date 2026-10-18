import { NotesPage } from '@/components/library/notes-page';
export default async function Page({ params }: { params: Promise<{ bookId: string }> }) {
  const { bookId } = await params;
  return <NotesPage bookId={bookId} />;
}
