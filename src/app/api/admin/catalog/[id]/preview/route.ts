import { adminCatalogApi } from '@/lib/server/catalog-admin';
import { database } from '@/lib/server/database';
import { catalogBundle } from '@/lib/server/catalog';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return adminCatalogApi(async () => {
    const edition = await database.catalogEdition.findFirstOrThrow({
      where: {
        id: new URL(request.url).searchParams.get('edition') || '',
        bookId: (await context.params).id,
        state: 'ready',
      },
    });
    return Response.json(await catalogBundle(edition.id));
  });
}
