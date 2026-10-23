import 'server-only';
import { Storage } from '@google-cloud/storage';
import { createHash } from 'node:crypto';

const storage = new Storage();
export const catalogHash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function bucket() {
  const name = process.env.CATALOG_BUCKET;
  if (!name) throw new Error('Catalog storage is not configured');
  return storage.bucket(name);
}
export async function saveCatalogAsset(key: string, bytes: Buffer, mime: string) {
  await bucket()
    .file(key)
    .save(bytes, {
      resumable: false,
      validation: 'crc32c',
      metadata: { contentType: mime, cacheControl: 'private, no-store' },
      preconditionOpts: { ifGenerationMatch: 0 },
    });
  return { key, mime, byteLength: bytes.length, sha256: catalogHash(bytes) };
}
export async function readCatalogAsset(asset: { key: string; byteLength: number; sha256: string }) {
  if (asset.byteLength > 50 * 1024 * 1024) throw new Error('Catalog asset exceeds size limit');
  const [bytes] = await bucket().file(asset.key).download();
  if (bytes.length !== asset.byteLength || catalogHash(bytes) !== asset.sha256)
    throw new Error('Catalog asset integrity check failed');
  return bytes;
}
