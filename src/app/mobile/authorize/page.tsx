import { headers } from 'next/headers';
import { MobileAuthorize } from '@/components/auth/mobile-authorize';
import { mobileAuthorizationInput, mobileAuthOrigin } from '@/lib/server/mobile-auth';
import { nativeAuthConfigured, nativeAuthOrigin } from '@/lib/server/auth-config';

export const dynamic = 'force-dynamic';
export default async function MobileAuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  let input: { challenge: string; state: string; issuer: string } | null = null;
  let directGoogle = false;
  try {
    const values = await searchParams;
    const requestHeaders = await headers();
    const canonical = nativeAuthOrigin();
    if (nativeAuthConfigured() && canonical) {
      const request = new Request(`${canonical}/mobile/authorize`, { headers: requestHeaders });
      input = { ...mobileAuthorizationInput(values), issuer: mobileAuthOrigin(request) };
      directGoogle = values.provider === 'google';
    }
  } catch {
    /* Invalid or unavailable login links cannot create a handoff. */
  }
  return <MobileAuthorize input={input} directGoogle={directGoogle} />;
}
