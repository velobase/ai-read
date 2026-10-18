import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function encryptionKey() {
  const value = process.env.AI_ENCRYPTION_KEY || '';
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32 || key.toString('base64') !== value)
    throw new Error('AI credential encryption is unavailable');
  return key;
}

export function assertAIEncryptionConfigured() {
  encryptionKey();
}

// Bind each credential to both its owner and destination; model changes do not
// require re-encryption. Never expose these envelopes through account APIs.
const context = (userId: string, baseUrl: string) =>
  Buffer.from(JSON.stringify(['leafread-ai-v1', userId, baseUrl]));

export function encryptAIKey(apiKey: string, userId: string, baseUrl: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(context(userId, baseUrl));
  const encrypted = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    encrypted.toString('base64'),
  ].join('.');
}

export function decryptAIKey(envelope: string, userId: string, baseUrl: string) {
  const [version, iv, tag, encrypted, extra] = envelope.split('.');
  if (version !== 'v1' || !iv || !tag || !encrypted || extra !== undefined)
    throw new Error('Invalid AI credential envelope');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64'));
  decipher.setAAD(context(userId, baseUrl));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
