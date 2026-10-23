import { database } from '@/lib/server/database';
import { readCatalogAsset } from '@/lib/server/catalog-storage';
export const runtime = 'nodejs';
export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string; asset: string }> },
) {
  const { slug, asset } = await context.params;
  if (!['download', 'cover'].includes(asset)) return new Response(null, { status: 404 });
  const book = await database.catalogBook.findUnique({
    where: { slug },
    include: { publication: { include: { edition: { include: { assets: true } } } } },
  });
  const publication = book?.publication;
  const expected = new URL(request.url).searchParams.get('edition');
  if (!publication || (expected && expected !== publication.editionId))
    return Response.json(
      { error: 'This edition is no longer available. Refresh the bookstore.' },
      { status: 404 },
    );
  const file = publication.edition.assets.find(
    (a) => a.kind === (asset === 'cover' ? 'cover' : 'bundle'),
  );
  if (!file) return new Response(null, { status: 404 });
  try {
    const bytes = await readCatalogAsset(file);
    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': file.mime,
        'Content-Length': String(bytes.length),
        'X-Content-SHA256': file.sha256,
        ...(asset === 'download'
          ? { 'Content-Disposition': `attachment; filename="${slug}.json"` }
          : {}),
      },
    });
  } catch (error) {
    console.error('catalog.asset', { slug, asset, editionId: publication.editionId }, error);
    return Response.json({ error: 'Download failed. Please retry.' }, { status: 503 });
  }
}
