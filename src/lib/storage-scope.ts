// Assigned once before any reading component mounts. A different identity requires
// a document reload so pending saves can never be retargeted to another account.
let scope: string | undefined;

export function initializeStorageScope(userId: string | null) {
  const next = userId ? `user:${userId}` : 'guest';
  if (scope !== undefined && scope !== next) throw new Error('阅读身份已变化，请刷新。');
  scope = next;
}

export function storageKey(key: string) {
  if (scope === undefined) throw new Error('阅读身份尚未确认。');
  return scope === 'guest' ? key : `${key}:${scope}`;
}

export const libraryDatabaseName = () => storageKey('ai-read');

export const storageUserId = () => (scope?.startsWith('user:') ? scope.slice(5) : null);
