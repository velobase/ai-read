import { useEffect, useRef, useState } from 'react';
import { Directory, File, Paths } from 'expo-file-system';
import type { Book, BookMediaAsset, BookMediaPlacement } from '@bypage/reading-core';
import { assertLibraryHandle, type LibraryHandle, type LibraryLease } from './library-scope';

export type BookImageReference = { asset: BookMediaAsset; placement: BookMediaPlacement };
export function bookImages(book: Book): BookImageReference[] {
  const assets = new Map(book.media?.assets.map((asset) => [asset.id, asset]));
  return (book.media?.placements || []).flatMap((placement) => {
    const asset = assets.get(placement.assetId);
    return asset ? [{ asset, placement }] : [];
  });
}

/** The portable Book keeps the authoritative bytes; these files are disposable render caches. */
export function cacheBookImage(
  handle: LibraryHandle,
  asset: BookMediaAsset,
  replace = false,
): string {
  assertLibraryHandle(handle);
  if (!/^[a-f0-9]{64}$/.test(asset.id)) throw new Error('Invalid image identity');
  if (handle.kind === 'account' && !/^account-[a-f0-9]{64}$/.test(handle.attachmentScope))
    throw new Error('invalid_library_identity');
  const root = new Directory(Paths.cache, 'bypage-book-images');
  // Keep the original device cache path. Account bytes never share its files.
  const directory = handle.kind === 'device' ? root : new Directory(root, handle.attachmentScope);
  directory.create({ intermediates: true, idempotent: true });
  const file = new File(directory, `${asset.id}.${asset.mimeType === 'image/png' ? 'png' : 'jpg'}`);
  if (replace || !file.exists || file.size !== asset.byteLength) {
    const prefix = `data:${asset.mimeType};base64,`;
    if (!asset.dataUri.startsWith(prefix)) throw new Error('Invalid image data');
    file.create({ overwrite: true });
    file.write(asset.dataUri.slice(prefix.length), { encoding: 'base64' });
    if (file.size !== asset.byteLength) throw new Error('Incomplete image cache');
  }
  return file.uri;
}

/** Prepare file references once, never resend image bytes in every native page payload. */
export function useBookImageFiles(lease: LibraryLease, assets: readonly BookMediaAsset[]) {
  const [attempt, setAttempt] = useState(0);
  const repairAssets = useRef(new Set<string>());
  const replaceAll = useRef(false);
  const [state, setState] = useState<{
    lease: LibraryLease;
    assets: readonly BookMediaAsset[];
    uris: Record<string, string>;
    ready: boolean;
    error: boolean;
  }>({ lease, assets, uris: {}, ready: !assets.length, error: false });
  useEffect(() => {
    let alive = true;
    const current = () => alive && lease.isCurrent();
    const replaceIds = new Set(repairAssets.current);
    const replaceEveryAsset = replaceAll.current;
    const uris: Record<string, string> = {};
    setState({ lease, assets, uris, ready: !assets.length, error: false });
    void (async () => {
      try {
        for (const asset of assets) {
          if (!current()) return;
          uris[asset.id] = cacheBookImage(
            lease.handle,
            asset,
            replaceEveryAsset || replaceIds.has(asset.id),
          );
          if (replaceEveryAsset || replaceIds.has(asset.id)) repairAssets.current.delete(asset.id);
          // Yield between bounded assets so a large illustrated chapter can still be closed.
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
        if (current()) {
          replaceAll.current = false;
          setState({ lease, assets, uris, ready: true, error: false });
        }
      } catch {
        if (current()) setState({ lease, assets, uris, ready: false, error: true });
      }
    })();
    return () => {
      alive = false;
    };
  }, [lease, assets, attempt]);
  const current = state.lease === lease && lease.isCurrent() && state.assets === assets;
  return {
    uris: current ? state.uris : {},
    ready: current && state.ready,
    error: current && state.error,
    retry: () => {
      if (!lease.isCurrent()) return;
      replaceAll.current = true;
      setAttempt((value) => value + 1);
    },
    repair: (assetId: string) => {
      if (!lease.isCurrent()) return;
      repairAssets.current.add(assetId);
      setAttempt((value) => value + 1);
    },
  };
}
