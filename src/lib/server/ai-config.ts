import 'server-only';
import { authEnabled } from './auth-config';
import { database } from './database';
import { decryptAIKey } from './ai-credentials';

export type ServerAIConfig = {
  baseUrl: string;
  model: string;
  apiKey: string;
  accountManaged: boolean;
};

const empty = { baseUrl: '', model: '', apiKey: '', accountManaged: false };

function localConfig(): ServerAIConfig {
  if (authEnabled()) return empty;
  return {
    baseUrl: process.env.AI_BASE_URL || '',
    model: process.env.AI_MODEL || '',
    apiKey: process.env.AI_API_KEY || '',
    accountManaged: false,
  };
}

export async function publicAIConfig(userId?: string) {
  if (userId) {
    const connection = await database.aIConnection.findUnique({
      where: { userId },
      select: { baseUrl: true, model: true, encryptedKey: true, updatedAt: true },
    });
    return {
      baseUrl: connection?.baseUrl || '',
      model: connection?.model || '',
      hasKey: Boolean(connection?.encryptedKey),
      accountManaged: true,
      updatedAt: connection?.updatedAt.toISOString() || null,
    };
  }
  const local = localConfig();
  return {
    baseUrl: local.baseUrl,
    model: local.model,
    hasKey: Boolean(local.apiKey),
    accountManaged: false,
    updatedAt: null,
  };
}

// Read on every request. User configuration is data, never a release artifact.
export async function serverAIConfig(userId?: string): Promise<ServerAIConfig> {
  if (!userId) return localConfig();
  const connection = await database.aIConnection.findUnique({ where: { userId } });
  if (!connection) return { ...empty, accountManaged: true };
  return {
    baseUrl: connection.baseUrl,
    model: connection.model,
    apiKey: connection.encryptedKey
      ? decryptAIKey(connection.encryptedKey, userId, connection.baseUrl)
      : '',
    accountManaged: true,
  };
}
