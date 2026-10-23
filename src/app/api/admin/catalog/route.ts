import { database } from '@/lib/server/database';
import { adminCatalogApi } from '@/lib/server/catalog-admin';
import { catalogInclude, catalogMetadata } from '@/lib/server/catalog';
import { accountBody } from '@/lib/server/account-request';
export async function GET() {
  return adminCatalogApi(async () =>
    Response.json({
      books: await database.catalogBook.findMany({
        include: catalogInclude,
        orderBy: { updatedAt: 'desc' },
      }),
      collections: await database.catalogCollection.findMany({
        include: { items: true },
        orderBy: { sortOrder: 'asc' },
      }),
    }),
  );
}
export async function POST(request: Request) {
  return adminCatalogApi(async () =>
    Response.json(
      await database.catalogBook.create({
        data: catalogMetadata(await accountBody(request, 16000)),
      }),
    ),
  );
}
