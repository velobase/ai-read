import 'server-only';

export function normalizeAIUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('请填写有效的模型服务地址。');
  }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  const hosted = process.env.APP_ORIGIN?.startsWith('https://') === true;
  if (
    (hosted && local) ||
    (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('服务地址必须为 HTTPS；本机模型可使用 http://localhost。');
  return url.href.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
}
