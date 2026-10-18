'use client';

import { useI18n } from '@/lib/i18n/provider';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { LoaderCircle, ShieldCheck } from 'lucide-react';
import { initializeStorageScope } from '@/lib/storage-scope';
import type { IdentityState } from '@/lib/identity';
import { Button } from '@/components/ui/button';

type IdentityContext = IdentityState & { refreshIdentity: () => Promise<void> };
const Context = createContext<IdentityContext | null>(null);

export function IdentityProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [state, setState] = useState<IdentityState | null>(null);
  const [error, setError] = useState(false);
  const currentId = useRef<string | null | undefined>(undefined);
  const requestId = useRef(0);
  const refreshIdentity = useCallback(async () => {
    const generation = ++requestId.current;
    try {
      const response = await fetch('/api/identity', {
        cache: 'no-store',
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error('identity-unavailable');
      const next: IdentityState = await response.json();
      if (generation !== requestId.current) return;
      const id = next.user?.id ?? null;
      if (currentId.current !== undefined && currentId.current !== id) {
        // Unmount immediately. Reload aborts requests and clears in-memory API keys.
        setState(null);
        window.location.reload();
        return;
      }
      initializeStorageScope(id);
      currentId.current = id;
      setState(next);
      setError(false);
    } catch {
      if (generation === requestId.current && currentId.current === undefined) setError(true);
    }
  }, []);

  useEffect(() => {
    void refreshIdentity();
    const visible = () => {
      if (document.visibilityState === 'visible') void refreshIdentity();
    };
    const changed = (event: StorageEvent) => {
      if (event.key === 'ai-read-identity-change') void refreshIdentity();
    };
    window.addEventListener('focus', visible);
    window.addEventListener('ai-read-identity-refresh', visible);
    window.addEventListener('storage', changed);
    document.addEventListener('visibilitychange', visible);
    const interval = setInterval(visible, 60_000);
    try {
      localStorage.setItem('ai-read-identity-change', `${Date.now()}:${Math.random()}`);
    } catch {
      /* focus refresh remains available */
    }
    return () => {
      requestId.current++;
      clearInterval(interval);
      window.removeEventListener('focus', visible);
      window.removeEventListener('ai-read-identity-refresh', visible);
      window.removeEventListener('storage', changed);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [refreshIdentity]);

  if (error)
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-[#f5f5f7] px-6 text-center">
        <ShieldCheck className="text-muted-foreground" />
        <h1 className="text-lg font-medium">{t('暂时无法确认阅读身份')}</h1>
        <p className="max-w-sm text-sm leading-7 text-muted-foreground">
          {t('书库仍在本机。重新连接后，可继续访问自己的阅读数据。')}
        </p>
        <Button onClick={() => void refreshIdentity()}>{t('重新连接')}</Button>
      </main>
    );
  if (!state)
    return (
      <div
        className="flex min-h-dvh items-center justify-center gap-3 bg-[#f5f5f7] text-sm text-muted-foreground"
        role="status"
      >
        <LoaderCircle size={18} className="animate-spin" />
        {t('正在打开阅读空间…')}
      </div>
    );
  return <Context.Provider value={{ ...state, refreshIdentity }}>{children}</Context.Provider>;
}

export function useIdentity() {
  const value = useContext(Context);
  if (!value) throw new Error('IdentityProvider is missing.');
  return value;
}
