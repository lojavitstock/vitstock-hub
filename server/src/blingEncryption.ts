import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export function integrationCipher(keyText: string) {
  const key = Buffer.from(keyText, 'base64');
  if (key.length !== 32 || key.toString('base64') !== keyText) throw new Error('INTEGRATION_ENCRYPTION_KEY inválida');
  return {
    encrypt(value: string, companyId: string, kind: 'access' | 'refresh') {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(`bling:v1:${companyId}:${kind}`));
      const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
    },
    decrypt(value: string, companyId: string, kind: 'access' | 'refresh') {
      try {
        const [version, iv, tag, encrypted, extra] = value.split('.');
        if (version !== 'v1' || !iv || !tag || !encrypted || extra) throw new Error();
        const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
        cipher.setAAD(Buffer.from(`bling:v1:${companyId}:${kind}`));
        cipher.setAuthTag(Buffer.from(tag, 'base64url'));
        return Buffer.concat([cipher.update(Buffer.from(encrypted, 'base64url')), cipher.final()]).toString('utf8');
      } catch { throw new Error('Credencial Bling indisponível; reconecte a integração'); }
    },
  };
}
