import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { accountSnapshot, useAccount } from './adapters/account';
import { openLibraryDatabase } from './adapters/database';
import {
  createLibraryLease,
  deviceLibrary,
  type LibraryHandle,
  type LibraryLease,
} from './adapters/library-scope';
import { LibraryContext } from './library-context';
import { LibraryControllerContext } from './library-controller';

let nextEpoch = 0;
export function LibraryHost({ children }: { children: (lease: LibraryLease) => ReactNode }) {
  const account = useAccount();
  const current = useRef<{ lease: LibraryLease; abort: AbortController } | null>(null);
  const flushers = useRef(new Set<() => Promise<void>>());
  const locked = useRef(false);
  const mounted = useRef(false);
  const [lease, setLease] = useState<LibraryLease | null>(null);
  const [switching, setSwitching] = useState(false);
  const [failed, setFailed] = useState(false);
  const activate = useCallback((handle: LibraryHandle) => {
    const abort = new AbortController();
    const epoch = ++nextEpoch;
    const next = createLibraryLease(
      handle,
      epoch,
      abort.signal,
      () => current.current?.lease.epoch === epoch,
    );
    current.current = { lease: next, abort };
    setLease(next);
  }, []);
  useEffect(() => {
    mounted.current = true;
    activate(deviceLibrary);
    return () => {
      mounted.current = false;
      current.current?.abort.abort();
      current.current = null;
    };
  }, [activate]);
  const switchTo = useCallback(
    async (handle: LibraryHandle) => {
      const old = current.current;
      if (!old || !mounted.current) throw new Error('library_unavailable');
      if (old.lease.handle.key === handle.key) {
        setFailed(false);
        return;
      }
      if (locked.current) throw new Error('library_switch_busy');
      locked.current = true;
      setSwitching(true);
      setFailed(false);
      const validDestination = () => {
        if (!mounted.current || current.current !== old) throw new Error('library_scope_changed');
        if (handle.kind === 'account') {
          const identity = accountSnapshot();
          if (
            identity.busy ||
            identity.loading ||
            identity.origin !== handle.origin ||
            identity.session?.user.id !== handle.userId ||
            !identity.session.permissions.includes('library_sync')
          )
            throw new Error('library_permission_required');
        }
      };
      try {
        validDestination();
        await openLibraryDatabase(handle);
        validDestination();
        // The old reader remains mounted during its bounded semantic capture and save.
        for (const flush of [...flushers.current]) await flush();
        const db = await openLibraryDatabase(old.lease.handle);
        await db.withExclusiveTransactionAsync(async () => {});
        validDestination();
        old.abort.abort();
        activate(handle);
      } catch (error) {
        if (mounted.current) setFailed(true);
        throw error;
      } finally {
        locked.current = false;
        if (mounted.current) setSwitching(false);
      }
    },
    [activate],
  );
  const registerFlush = useCallback((flush: () => Promise<void>) => {
    flushers.current.add(flush);
    return () => {
      flushers.current.delete(flush);
    };
  }, []);
  useEffect(() => {
    if (
      !lease ||
      lease.handle.kind !== 'account' ||
      account.busy ||
      account.loading ||
      switching ||
      failed
    )
      return;
    if (
      account.origin !== lease.handle.origin ||
      account.session?.user.id !== lease.handle.userId ||
      !account.session.permissions.includes('library_sync')
    )
      void switchTo(deviceLibrary).catch(() => {});
  }, [lease, account, switching, failed, switchTo]);
  const unavailable =
    !!lease &&
    lease.handle.kind === 'account' &&
    (account.busy ||
      account.loading ||
      account.origin !== lease.handle.origin ||
      account.session?.user.id !== lease.handle.userId ||
      !account.session?.permissions.includes('library_sync'));
  const control = useMemo(
    () => ({ switching, blocked: switching || unavailable, switchTo, registerFlush }),
    [switching, unavailable, switchTo, registerFlush],
  );
  if (!lease) return null;

  return (
    <LibraryControllerContext.Provider value={control}>
      <LibraryContext.Provider value={lease}>
        <View style={{ flex: 1 }}>
          <View
            style={{ flex: 1 }}
            pointerEvents={switching || unavailable ? 'none' : 'auto'}
            accessibilityElementsHidden={switching || unavailable}
            importantForAccessibility={switching || unavailable ? 'no-hide-descendants' : 'auto'}
          >
            {children(lease)}
          </View>
          {failed && (
            <Pressable
              accessibilityRole="button"
              onPress={() => void switchTo(deviceLibrary).catch(() => {})}
              style={{ padding: 16, backgroundColor: '#FFF4DD' }}
            >
              <Text>书库切换未完成 · 重试返回本机书库 / Retry device library</Text>
            </Pressable>
          )}
          {unavailable && !switching && (
            <View
              style={{
                position: 'absolute',
                inset: 0,
                backgroundColor: '#F5F5F7',
                padding: 32,
                alignItems: 'center',
                justifyContent: 'center',
                gap: 18,
              }}
            >
              <Text>
                账号连接已变化，本机数据已保留。 Account connection changed. Local data is
                preserved.
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => void switchTo(deviceLibrary).catch(() => {})}
                style={{ padding: 18 }}
              >
                <Text style={{ color: '#3489E7' }}>返回本机书库 / Open device library</Text>
              </Pressable>
            </View>
          )}
          {switching && (
            <View
              style={{
                position: 'absolute',
                inset: 0,
                backgroundColor: unavailable ? '#F5F5F7' : '#00000033',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <ActivityIndicator size="large" color="#3489E7" />
            </View>
          )}
        </View>
      </LibraryContext.Provider>
    </LibraryControllerContext.Provider>
  );
}
