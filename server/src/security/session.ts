import { createHmac, randomBytes } from 'node:crypto';
import { config } from '../config.js';

export const SESSION_COOKIE = 'vitstock_session';
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;

export function createSessionToken() {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string) {
  return createHmac('sha256', config.SESSION_SECRET).update(token).digest('hex');
}
