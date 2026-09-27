import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'crypto';

function keyFrom(secret: string, purpose: string): Buffer {
  return createHash('sha256').update(`${purpose}:${secret}`).digest();
}

/** AES-256-GCM → `iv.tag.data` (base64url). */
export function encryptOzonSecret(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(secret, 'ozon-refresh.v1'), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, data].map((b) => b.toString('base64url')).join('.');
}

/** null — если ключ сменился или данные повреждены. */
export function decryptOzonSecret(enc: string, secret: string): string | null {
  const parts = enc.split('.');
  if (parts.length !== 3) return null;
  try {
    const [iv, tag, data] = parts.map((p) => Buffer.from(p, 'base64url'));
    const decipher = createDecipheriv(
      'aes-256-gcm',
      keyFrom(secret, 'ozon-refresh.v1'),
      iv,
    );
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

type OAuthStatePayload = { uid: string; exp: number; n: string };

export function signOzonOAuthState(
  uid: string,
  secret: string,
  ttlSec = 15 * 60,
): string {
  const payload: OAuthStatePayload = {
    uid,
    exp: Math.floor(Date.now() / 1000) + ttlSec,
    n: randomBytes(8).toString('base64url'),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', keyFrom(secret, 'ozon-oauth-state.v1'))
    .update(body)
    .digest('base64url');
  return `${body}.${sig}`;
}

/** uid инициатора или null (подпись / срок). */
export function verifyOzonOAuthState(state: string, secret: string): string | null {
  const [body, sig] = (state || '').split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', keyFrom(secret, 'ozon-oauth-state.v1'))
    .update(body)
    .digest();
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as OAuthStatePayload;
    if (!payload?.uid || !Number.isFinite(payload.exp)) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload.uid;
  } catch {
    return null;
  }
}
