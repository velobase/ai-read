import type { Settings } from './types';

export type AIConnection = {
  baseUrl: string;
  model: string;
  hasKey: boolean;
  accountManaged: boolean;
  updatedAt: string | null;
};

export async function readAIConnection(): Promise<AIConnection> {
  const response = await fetch('/api/config', {
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error('暂时无法读取 AI 配置，请重试。');
  return response.json();
}

export async function saveAIConnection(
  settings: Settings,
  clearKey = false,
): Promise<AIConnection> {
  const response = await fetch('/api/account/ai', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      baseUrl: settings.baseUrl,
      model: settings.model,
      apiKey: settings.apiKey,
      clearKey,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'AI 配置暂时无法保存，请稍后重试。');
  return data;
}

export function applyAIConnection(settings: Settings, config: AIConnection): Settings {
  return {
    ...settings,
    baseUrl: config.accountManaged ? config.baseUrl : settings.baseUrl || config.baseUrl,
    model: config.accountManaged ? config.model : settings.model || config.model,
    apiKey: config.accountManaged ? '' : settings.apiKey,
  };
}
