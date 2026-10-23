import * as Crypto from 'expo-crypto';
import { validSyncId } from '@bypage/reading-core';
import { normalizeServerOrigin } from './server-origin';

const libraryHandle = Symbol('LibraryHandle');
const handles = new WeakSet<object>();

type StorageIdentity = Readonly<{
  [libraryHandle]: true;
  key: string;
  databaseName: string;
  attachmentScope: string;
}>;
export type DeviceLibraryHandle = StorageIdentity & Readonly<{ kind: 'device' }>;
export type AccountLibraryHandle = StorageIdentity &
  Readonly<{ kind: 'account'; origin: string; userId: string }>;
export type LibraryHandle = DeviceLibraryHandle | AccountLibraryHandle;

function register<T extends LibraryHandle>(handle: T): T {
  handles.add(handle);
  return Object.freeze(handle);
}

/** Existing device data stays in its original database and attachment namespace. */
export const deviceLibrary: DeviceLibraryHandle = register({
  [libraryHandle]: true,
  kind: 'device',
  key: 'device',
  databaseName: 'bypage-v1.db',
  attachmentScope: 'device',
});

/** Describes storage only. It grants no account access and opens no database. */
export async function createAccountLibrary(
  rawOrigin: string,
  userId: string,
): Promise<AccountLibraryHandle> {
  const origin = normalizeServerOrigin(rawOrigin);
  if (!origin || !validSyncId(userId)) throw new Error('invalid_library_identity');
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    JSON.stringify(['bypage-library-v1', origin, userId]),
    { encoding: Crypto.CryptoEncoding.HEX },
  );
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('invalid_library_digest');
  const key = `account-${digest}`;
  return register({
    [libraryHandle]: true,
    kind: 'account',
    origin,
    userId,
    key,
    databaseName: `bypage-${key}-v1.db`,
    attachmentScope: key,
  });
}

/** Accept only handles created here, never a persisted or caller-supplied filename. */
export function assertLibraryHandle(value: unknown): asserts value is LibraryHandle {
  if (!value || typeof value !== 'object' || !handles.has(value))
    throw new Error('invalid_library_handle');
}

export type LibraryLease = Readonly<{
  handle: LibraryHandle;
  epoch: number;
  signal: AbortSignal;
  isCurrent: () => boolean;
  assertCurrent: () => void;
}>;

/**
 * The App owner advances epochs even when returning to the same library.
 * A lease fences UI/network work; its immutable handle still identifies where an
 * explicitly permitted final local flush belongs after that lease is revoked.
 */
export function createLibraryLease(
  handle: LibraryHandle,
  epoch: number,
  signal: AbortSignal,
  stillCurrent: () => boolean,
): LibraryLease {
  assertLibraryHandle(handle);
  if (!Number.isSafeInteger(epoch) || epoch < 0) throw new Error('invalid_library_epoch');
  const isCurrent = () => !signal.aborted && stillCurrent();
  return Object.freeze({
    handle,
    epoch,
    signal,
    isCurrent,
    assertCurrent() {
      if (!isCurrent())
        throw Object.assign(new Error('library_scope_changed'), { name: 'AbortError' });
    },
  });
}
