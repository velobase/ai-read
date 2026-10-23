import 'server-only';
import { authEnabled } from './auth-config';
import { database } from './database';
import { effectiveTranslationPrompt } from '../translation-prompt';

export type ServerAIConfig = {
  baseUrl: string;
  model: string;
  apiKey: string;
  translationPrompt: string;
  accountManaged: boolean;
};
const empty: ServerAIConfig = {
  baseUrl: '',
  model: '',
  apiKey: '',
  translationPrompt: effectiveTranslationPrompt(''),
  accountManaged: true,
};

// Platform credentials never follow client-supplied URLs or enter client state.
export async function serverAIConfig(userId?: string): Promise<ServerAIConfig> {
  if (authEnabled() && !userId) return empty;
  const user = userId
    ? await database.user.findUniqueOrThrow({
        where: { id: userId },
        select: { translationPrompt: true },
      })
    : null;
  return {
    baseUrl: process.env.AI_BASE_URL || '',
    model: process.env.AI_MODEL || '',
    apiKey: process.env.AI_API_KEY || '',
    translationPrompt: effectiveTranslationPrompt(user?.translationPrompt),
    accountManaged: true,
  };
}
export async function publicAIConfig(userId?: string) {
  const config = await serverAIConfig(userId);
  return {
    baseUrl: config.baseUrl,
    model: config.model,
    translationPrompt: config.translationPrompt,
    hasKey: Boolean(config.apiKey),
    accountManaged: true,
    updatedAt: null,
  };
}
