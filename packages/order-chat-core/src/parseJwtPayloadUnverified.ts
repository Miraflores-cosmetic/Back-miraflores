export function parseJwtPayloadUnverified(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4;
    if (pad === 2) b64 += '==';
    else if (pad === 3) b64 += '=';
    const json =
      typeof atob === 'function'
        ? atob(b64)
        : Buffer.from(b64, 'base64').toString('utf8');
    const o = JSON.parse(json) as unknown;
    return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function orderChatWsMetaFromAccessTokenJwt(token: string): {
  sub: string | null;
  exp: number | null;
} {
  const p = parseJwtPayloadUnverified(token);
  if (!p) return { sub: null, exp: null };
  const sub = typeof p.sub === 'string' ? p.sub : null;
  const exp = typeof p.exp === 'number' && Number.isFinite(p.exp) ? p.exp : null;
  return { sub, exp };
}
