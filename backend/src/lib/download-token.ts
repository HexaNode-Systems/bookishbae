import { createHmac } from 'node:crypto';
import { env } from './env';

export interface DownloadTokenPayload {
  orderId: string;
  productId?: string;
  exp: number;
}

export function signDownloadToken(
  orderId: string,
  productId?: string,
  ttlMs: number = 24 * 60 * 60 * 1000,
): string {
  const payload: DownloadTokenPayload = {
    orderId,
    productId,
    exp: Date.now() + ttlMs,
  };
  const jsonStr = JSON.stringify(payload);
  const data = Buffer.from(jsonStr, 'utf8').toString('base64url');
  const secret = env.CASHFREE_SECRET_KEY || env.IP_HASH_SALT || 'bookishbae-token-secret';
  const sig = createHmac('sha256', secret).update(data, 'utf8').digest('base64url');
  return `${data}.${sig}`;
}

export function verifyDownloadToken(token: string): DownloadTokenPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [data, sig] = parts;
    if (!data || !sig) return null;
    const secret = env.CASHFREE_SECRET_KEY || env.IP_HASH_SALT || 'bookishbae-token-secret';
    const expectedSig = createHmac('sha256', secret).update(data, 'utf8').digest('base64url');
    if (sig !== expectedSig) return null;
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as DownloadTokenPayload;
    if (!payload.orderId || !payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}
