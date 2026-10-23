type Connection = { baseUrl: string; hasKey: boolean };
type Settings = { baseUrl: string; model: string; apiKey: string };

function endpoint(value: string) {
  try {
    return new URL(value).href.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  } catch {
    return '';
  }
}

// Local model servers commonly run without authentication. Remote services
// require an explicit key; never assume a saved server key belongs to a new URL.
export function isLocalAI(value: string) {
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(value).hostname);
  } catch {
    return false;
  }
}

export function hasMatchingServerKey(baseUrl: string, connection?: Connection | null) {
  return Boolean(
    connection?.hasKey && endpoint(baseUrl) && endpoint(baseUrl) === endpoint(connection.baseUrl),
  );
}

export function canUseAI(settings: Settings, connection?: Connection | null) {
  return Boolean(
    endpoint(settings.baseUrl) &&
    settings.model.trim() &&
    (settings.apiKey.trim() ||
      hasMatchingServerKey(settings.baseUrl, connection) ||
      isLocalAI(settings.baseUrl)),
  );
}
