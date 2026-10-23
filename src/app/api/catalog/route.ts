import { publicCatalog } from '@/lib/server/catalog';
import { database } from '@/lib/server/database';
export async function GET() {
  try {
    const [books, collections] = await Promise.all([
      publicCatalog(),
      database.catalogCollection.findMany({
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          title: true,
          description: true,
          items: {
            orderBy: { sortOrder: 'asc' },
            where: { book: { publication: { isNot: null } } },
            select: { bookId: true },
          },
        },
      }),
    ]);
    return Response.json({ books, collections });
  } catch (error) {
    console.error('catalog.list', error);
    return Response.json({ error: 'The bookstore is temporarily unavailable' }, { status: 503 });
  }
}
