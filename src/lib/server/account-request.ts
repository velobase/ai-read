import 'server-only';

export async function accountBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    throw new Error('请求格式不正确。');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('请求不能为空。');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) {
        await reader.cancel();
        throw new Error('请求内容过长。');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('请求格式不正确。');
  return value;
}

export const unauthorized = () =>
  Response.json({ error: '请先登录，再继续操作。' }, { status: 401 });
