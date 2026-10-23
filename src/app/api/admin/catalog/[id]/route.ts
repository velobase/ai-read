import { database } from '@/lib/server/database';
import { adminCatalogApi } from '@/lib/server/catalog-admin';
import { catalogInclude, catalogMetadata, publishCatalogBook } from '@/lib/server/catalog';
import { accountBody } from '@/lib/server/account-request';
type Context = { params: Promise<{ id: string }> };
export async function GET(_: Request, context: Context) {
  return adminCatalogApi(async () =>
    Response.json(
      await database.catalogBook.findUniqueOrThrow({
        where: { id: (await context.params).id },
        include: catalogInclude,
      }),
    ),
  );
}
export async function PATCH(request: Request, context: Context) {
  return adminCatalogApi(async () => {
    const { id } = await context.params;
    const body = await accountBody(request, 16000);
    if (body.action === 'publish') {
      if (typeof body.editionId !== 'string') throw new Error('Choose an edition');
      await publishCatalogBook(id, body.editionId);
    } else if (body.action === 'unpublish') {
      await database.catalogPublication.deleteMany({ where: { bookId: id } });
    } else if (body.action === 'retry') {
      if (typeof body.editionId !== 'string') throw new Error('Choose an edition');
      const edition = await database.catalogEdition.findFirst({
        where: { id: body.editionId, bookId: id, state: 'failed' },
      });
      if (!edition) throw new Error('Only failed imports can be retried');
      await database.$transaction([
        database.catalogImportJob.update({
          where: { editionId: edition.id },
          data: { state: 'queued', error: null, leaseToken: null, leaseUntil: null },
        }),
        database.catalogEdition.update({ where: { id: edition.id }, data: { state: 'queued' } }),
      ]);
    } else if (body.action === 'metadata') {
      await database.catalogBook.update({ where: { id }, data: catalogMetadata(body) });
    } else throw new Error('Unknown action');
    return Response.json({ ok: true });
  });
}
