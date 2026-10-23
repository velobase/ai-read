import 'server-only';
import { createHash } from 'node:crypto';
import { authEnabled, nativeAuthConfigured } from './auth-config';
import { serverAIConfig } from './ai-config';
import { normalizeAIUrl } from './ai-endpoint';
import { canUseAI } from '../ai-availability';
import { MobileAuthError, mobileAuthOrigin, requireMobileSession } from './mobile-auth';

/** Public configuration identity for local history isolation; excludes keys and sessions. */
export function mobileAIContextKey(config: { baseUrl: string; model: string }) {
  return createHash('sha256')
    .update(JSON.stringify([normalizeAIUrl(config.baseUrl), config.model]))
    .digest('hex');
}

// Every protected request resolves the revocable session again. Cookie sessions
// and caller-supplied user IDs never authenticate the native API.
export async function mobileAI(request: Request, optional = false) {
  const enabled = authEnabled();
  const hasBearer = request.headers.has('authorization');
  if (enabled && !nativeAuthConfigured()) {
    if (optional && !hasBearer) return { config: null, authenticated: false };
    throw new MobileAuthError('auth_unavailable', 503);
  }
  if (enabled) mobileAuthOrigin(request);
  if (enabled && !hasBearer && optional) return { config: null, authenticated: false };
  if (!enabled && hasBearer) throw new MobileAuthError('invalid_session');
  const session = enabled ? await requireMobileSession(request) : null;
  const config = await serverAIConfig(session?.user.id);
  return { config: canUseAI(config) ? config : null, authenticated: !!session };
}
