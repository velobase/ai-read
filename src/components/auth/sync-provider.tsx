'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useIdentity } from './identity-provider';
import { initialSyncStatus, startSync, type SyncStatus } from '@/lib/sync-client';
const Context = createContext<SyncStatus>(initialSyncStatus);
export function SyncProvider({ children }: { children: ReactNode }) {
  const { user } = useIdentity();
  const [status, setStatus] = useState(initialSyncStatus);
  useEffect(() => {
    if (!user) {
      setStatus(initialSyncStatus);
      return;
    }
    return startSync(user.id, setStatus);
  }, [user?.id]);
  return <Context.Provider value={status}>{children}</Context.Provider>;
}
export const useSync = () => useContext(Context);
export const syncNow = () => window.dispatchEvent(new Event('ai-read-sync-now'));
