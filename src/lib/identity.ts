export type ReaderIdentity = {
  id: string;
  isAdmin: boolean;
  name: string;
  email: string;
  image: string | null;
  bio: string;
  color: string;
  createdAt: string;
};

export type IdentityState = {
  enabled: boolean;
  providers?: ('google' | 'apple')[];
  user: ReaderIdentity | null;
};

export function safeReturnPath(value: string | null | undefined) {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\r\n]/.test(value))
    return '/me';
  try {
    const url = new URL(value, 'https://reader.invalid');
    if (
      url.origin !== 'https://reader.invalid' ||
      url.pathname === '/login' ||
      url.pathname.startsWith('/api/')
    )
      return '/me';
    return url.pathname + url.search + url.hash;
  } catch {
    return '/me';
  }
}
