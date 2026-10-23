import { adminCatalogApi } from '@/lib/server/catalog-admin';
import { enqueueCatalogImport } from '@/lib/server/catalog';
export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return adminCatalogApi(async () => {
    const name = decodeURIComponent(request.headers.get('x-file-name') || '');
    if (!name || name.length > 200 || /[\\/\x00-\x1f]/.test(name))
      throw new Error('Invalid file name');
    const max = 30 * 1024 * 1024;
    if (Number(request.headers.get('content-length')) > max) throw new Error('File exceeds 30 MB');
    const reader = request.body?.getReader();
    if (!reader) throw new Error('Missing upload');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > max) {
          await reader.cancel();
          throw new Error('File exceeds 30 MB');
        }
        chunks.push(next.value);
      }
    } finally {
      reader.releaseLock();
    }
    return Response.json(
      await enqueueCatalogImport((await context.params).id, Buffer.concat(chunks), name),
    );
  });
}
