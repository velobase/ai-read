import { adminCatalogApi } from '@/lib/server/catalog-admin';
import { database } from '@/lib/server/database';
import { accountBody } from '@/lib/server/account-request';
export async function POST(request: Request) {
  return adminCatalogApi(async () => {
    const body = await accountBody(request, 32000);
    if (
      typeof body.title !== 'string' ||
      !body.title.trim() ||
      body.title.length > 120 ||
      typeof body.description !== 'string' ||
      body.description.length > 2000 ||
      !Array.isArray(body.bookIds) ||
      body.bookIds.length > 100 ||
      !body.bookIds.every((id) => typeof id === 'string' && id.length < 100)
    )
      throw new Error('Invalid collection');
    const ids = [...new Set(body.bookIds as string[])];
    const data = {
      title: body.title.trim(),
      description: body.description,
      sortOrder: Number.isInteger(body.sortOrder)
        ? Math.max(0, Math.min(1000, body.sortOrder as number))
        : 0,
    };
    const collection = await database.$transaction(async (tx) => {
      const collection =
        typeof body.id === 'string'
          ? await tx.catalogCollection.update({ where: { id: body.id }, data })
          : await tx.catalogCollection.create({ data });
      await tx.catalogCollectionItem.deleteMany({ where: { collectionId: collection.id } });
      await tx.catalogCollectionItem.createMany({
        data: ids.map((bookId, sortOrder) => ({ collectionId: collection.id, bookId, sortOrder })),
      });
      return collection;
    });
    return Response.json(collection);
  });
}
