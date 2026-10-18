import 'server-only';
import { authEnabled } from './auth-config';

export type ServerAIConfig = { baseUrl: string; model: string; apiKey: string };

// Hosted credentials belong only to explicitly configured accounts. Other users
// can still supply their own credentials for their selected service.
export function serverAIConfig(userId?: string): ServerAIConfig {
  const allowedUsers = new Set(
    (process.env.AI_ALLOWED_USER_IDS || '').split(',').map((id) => id.trim()).filter(Boolean),
  );
  const local =
    !authEnabled() ||
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(process.env.APP_ORIGIN || '');
  const allowed = local || Boolean(userId && allowedUsers.has(userId));
  return {
    baseUrl: allowed ? process.env.AI_BASE_URL || '' : '',
    model: allowed ? process.env.AI_MODEL || '' : '',
    // Older runtimes only understand AI_API_KEY: a rollback must not turn this
    // account-scoped hosted credential into an unrestricted shared key.
    apiKey: allowed ? (local ? process.env.AI_API_KEY : process.env.AI_PRIVATE_API_KEY) || '' : '',
  };
}
