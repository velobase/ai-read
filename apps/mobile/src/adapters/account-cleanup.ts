import { createAccountLibrary } from './library-scope';
import { getPreference, setPreference, eraseAccountDatabase } from './database';
import { eraseAccountPdfOriginals } from './pdf';

type DeletedAccount = { origin: string; userId: string };
let cleanup: Promise<void> | undefined;
export async function queueAccountCleanup(origin: string, userId: string) {
  const pending = await getPreference<DeletedAccount[]>('deleted_account_cleanup', []);
  if (!pending.some((item) => item.origin === origin && item.userId === userId))
    await setPreference('deleted_account_cleanup', [...pending, { origin, userId }]);
  await retryAccountCleanup();
}
export function retryAccountCleanup(): Promise<void> {
  if (cleanup) return cleanup;
  cleanup = (async () => {
    const pending = await getPreference<DeletedAccount[]>('deleted_account_cleanup', []);
    for (const item of pending) {
      const handle = await createAccountLibrary(item.origin, item.userId);
      await eraseAccountDatabase(handle);
      await eraseAccountPdfOriginals(handle);
      const current = await getPreference<DeletedAccount[]>('deleted_account_cleanup', []);
      await setPreference('deleted_account_cleanup', current.filter((value) => value.origin !== item.origin || value.userId !== item.userId));
    }
  })().finally(() => { cleanup = undefined; });
  return cleanup;
}
