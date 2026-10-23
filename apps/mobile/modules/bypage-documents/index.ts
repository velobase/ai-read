import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core';

export type PendingDocument = {
  id: string;
  name: string;
  /** App-owned copy only. Never the originating app's security-scoped URL. */
  uri: string;
  size: number;
  /** Unix time in milliseconds. */
  createdAt: number;
};

export type DocumentInboxError = 'limit' | 'unsupported' | 'read';

type NativeDocuments = {
  version: number;
  listPending(): Promise<PendingDocument[]>;
  /** Removes only this inbox copy, after successful import or explicit inbox removal. */
  dismiss(id: string): Promise<void>;
  takeError(): Promise<DocumentInboxError | null>;
  addListener(event: 'inboxChanged', listener: () => void): EventSubscription;
};

const native = requireOptionalNativeModule<NativeDocuments>('ByPageDocuments');
export const available = !!native && native.version >= 1;

// Old installed builds can keep running while the new native module is built.
export const listPending = (): Promise<PendingDocument[]> =>
  available ? native!.listPending() : Promise.resolve([]);
export const dismiss = (id: string): Promise<void> =>
  available ? native!.dismiss(id) : Promise.resolve();
export const takeError = (): Promise<DocumentInboxError | null> =>
  available ? native!.takeError() : Promise.resolve(null);
export const addListener = (event: 'inboxChanged', listener: () => void): EventSubscription =>
  available ? native!.addListener(event, listener) : { remove() {} };
