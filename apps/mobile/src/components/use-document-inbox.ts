import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as documents from '../../modules/bypage-documents';

/** Native storage is authoritative, including files received before JS starts. */
export function useDocumentInbox(report: (error: 'limit' | 'unsupported' | 'read') => void) {
  const [items, setItems] = useState<documents.PendingDocument[]>([]);
  const alive = useRef(false);
  const sequence = useRef(0);
  const reportRef = useRef(report);
  reportRef.current = report;
  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    try {
      const pending = await documents.listPending();
      if (alive.current && sequence.current === request) setItems(pending);
      if (!alive.current || sequence.current !== request || AppState.currentState !== 'active')
        return;
      const error = await documents.takeError();
      if (alive.current && sequence.current === request && error) reportRef.current(error);
    } catch {
      if (alive.current && sequence.current === request) reportRef.current('read');
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    const subscription = documents.addListener('inboxChanged', () => void refresh());
    const foreground = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    void refresh();
    return () => {
      alive.current = false;
      sequence.current++;
      subscription.remove();
      foreground.remove();
    };
  }, [refresh]);
  const dismiss = useCallback(
    async (id: string) => {
      await documents.dismiss(id);
      await refresh();
    },
    [refresh],
  );
  return { items, dismiss, refresh };
}
