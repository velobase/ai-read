import 'server-only';
import { database } from './database';
import { nativeAppleClientId, revokeAppleToken } from './apple-auth';

export class AccountDeletionError extends Error {
  constructor(
    public status: number,
    code: string,
  ) {
    super(code);
  }
}
export async function deleteAccount(identity: {
  userId: string;
  sessionId?: string;
  sessionToken?: string;
  kind: 'web' | 'mobile';
}) {
  await database.$transaction(
    async (tx) => {
      // Serialize against grants and sync writes, then revalidate the acting session under the lock.
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${identity.userId} FOR UPDATE`;
      if (!identity.sessionId && !identity.sessionToken)
        throw new AccountDeletionError(401, 'invalid_session');
      const active = await tx.session.findFirst({
        where: {
          id: identity.sessionId,
          sessionToken: identity.sessionToken,
          userId: identity.userId,
          kind: identity.kind,
          expires: { gt: new Date() },
        },
      });
      if (!active) throw new AccountDeletionError(401, 'invalid_session');
      const accounts = await tx.account.findMany({
        where: { userId: identity.userId, provider: 'apple' },
      });
      for (const account of accounts) {
        try {
          if (!account.encryptedAppleRefreshToken && !account.encryptedNativeAppleRefreshToken)
            throw new Error('missing_token');
          if (account.encryptedAppleRefreshToken)
            await revokeAppleToken(
              account.encryptedAppleRefreshToken,
              identity.userId,
              account.providerAccountId,
            );
          if (account.encryptedNativeAppleRefreshToken)
            await revokeAppleToken(
              account.encryptedNativeAppleRefreshToken,
              identity.userId,
              account.providerAccountId,
              nativeAppleClientId,
            );
        } catch {
          throw new AccountDeletionError(503, 'account_deletion_retry');
        }
      }
      // FK cascades remove books and all child reading data, credentials, sessions and pending grants.
      await tx.user.delete({ where: { id: identity.userId } });
    },
    { timeout: 30000 },
  );
}
export function accountDeletionFailure(error: unknown) {
  return Response.json(
    { error: error instanceof AccountDeletionError ? error.message : 'account_deletion_retry' },
    {
      status: error instanceof AccountDeletionError ? error.status : 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
