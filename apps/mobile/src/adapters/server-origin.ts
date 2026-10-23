import Constants from 'expo-constants';

const officialOrigin = 'https://leafread.ai';
function configuredOrigin(): string {
  // Release bundles cannot redirect account, AI or sync traffic through a
  // persisted preference or an arbitrary Expo extra value.
  if (__DEV__ && Constants.expoConfig?.extra?.environment === 'development') {
    try {
      const value = normalizeServerOrigin(Constants.expoConfig?.extra?.apiOrigin || '');
      if (value && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(value).hostname))
        return value;
    } catch {
      // A stale development configuration falls back to the official service.
    }
  }
  return officialOrigin;
}
export const apiOrigin = configuredOrigin();

/** Enforce the service boundary at the network layer, not only in the UI. */
export function requireServiceOrigin(value: string) {
  const origin = normalizeServerOrigin(value);
  if (origin !== apiOrigin) throw new Error('unsupported_service_origin');
  return origin;
}

// Historical storage partitions still need canonicalization without deletion.
export function normalizeServerOrigin(value: string) {
  if (!value.trim()) return '';
  const url = new URL(value.trim());
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    !(
      url.protocol === 'https:' ||
      (local &&
        Constants.expoConfig?.extra?.environment === 'development' &&
        url.protocol === 'http:')
    )
  )
    throw new Error('invalid_server_origin');
  return url.origin;
}
