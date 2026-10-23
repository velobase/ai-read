import { cleanPreferences, type Preferences } from '../context';
import { getPreference, setPreference } from './database';
import type { LibraryHandle } from './library-scope';

export type BookReadingPreferences = Pick<Preferences, 'language' | 'mode'>;
const key = (handle: LibraryHandle, bookId: string) =>
  `reading-language:${JSON.stringify([handle.key, bookId])}`;
let writes = Promise.resolve();
export async function readBookReadingPreferences(
  handle: LibraryHandle,
  bookId: string,
  defaults: BookReadingPreferences,
): Promise<BookReadingPreferences> {
  await writes;
  const stored = await getPreference<Partial<BookReadingPreferences>>(
    key(handle, bookId),
    defaults,
  );
  const clean = cleanPreferences({ ...defaults, ...stored });
  return { language: clean.language, mode: clean.mode };
}
export function saveBookReadingPreferences(
  handle: LibraryHandle,
  bookId: string,
  value: BookReadingPreferences,
) {
  const write = writes.then(() => setPreference(key(handle, bookId), value));
  writes = write.catch(() => {});
  return write;
}
