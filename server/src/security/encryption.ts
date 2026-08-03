import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { config } from '../config.js';

const key = createHash('sha256').update(config.SESSION_SECRET).digest();

export function encryptSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString('base64url')).join('.');
}

export function decryptSecret(value: string) {
  const parts = value.split('.');
  if (parts.length !== 3) throw new Error('Segredo criptografado inválido');
  const iv = Buffer.from(parts[0]!, 'base64url');
  const tag = Buffer.from(parts[1]!, 'base64url');
  const encrypted = Buffer.from(parts[2]!, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
