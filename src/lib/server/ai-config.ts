import 'server-only';
import { authEnabled } from './auth-config';
import { database } from './database';
import { decryptAIKey } from './ai-credentials';
import { effectiveTranslationPrompt } from '../translation-prompt';

export type ServerAIConfig = {
  baseUrl: string;
  model: string;
  apiKey: string;
  translationPrompt: string;
  accountManaged: boolean;
};

const empty = {
  baseUrl: '',
  model: '',
  apiKey: '',
  translationPrompt: effectiveTranslationPrompt(''),
  accountManaged: false,
};

function localConfig(): ServerAIConfig {
  if (authEnabled()) return empty;
  return {
    baseUrl: process.env.AI_BASE_URL || '',
    model: process.env.AI_MODEL || '',
    apiKey: process.env.AI_API_KEY || '',
    translationPrompt: effectiveTranslationPrompt(''),
    accountManaged: false,
  };
}

export async function publicAIConfig(userId?: string) {
  if (userId) {
    const connection = await database.aIConnection.findUnique({
      where: { userId },
      select: {
        baseUrl: true,
        model: true,
        encryptedKey: true,
        translationPrompt: true,
        updatedAt: true,
      },
    });
    return {
      baseUrl: connection?.baseUrl || '',
      model: connection?.model || '',
      translationPrompt: effectiveTranslationPrompt(connection?.translationPrompt),
      hasKey: Boolean(connection?.encryptedKey),
      accountManaged: true,
      updatedAt: connection?.updatedAt.toISOString() || null,
    };
  }
  const local = localConfig();
  return {
    baseUrl: local.baseUrl,
    model: local.model,
    translationPrompt: local.translationPrompt,
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
    translationPrompt: effectiveTranslationPrompt(connection.translationPrompt),
    apiKey: connection.encryptedKey
      ? decryptAIKey(connection.encryptedKey, userId, connection.baseUrl)
      : '',
    accountManaged: true,
  };
}
