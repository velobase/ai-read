export const MAX_COLLECTIONS = 100;

/** The display name travels between devices; the key identifies equivalent names. */
export function normalizeCollectionName(value: unknown): { name: string; key: string } | null {
  if (typeof value !== 'string' || value.length > 400) return null;
  const name = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if (!name || [...name].length > 40 || /[\u0000-\u001f\u007f]/u.test(name)) return null;
  return { name, key: name.normalize('NFKC').toLowerCase() };
}
