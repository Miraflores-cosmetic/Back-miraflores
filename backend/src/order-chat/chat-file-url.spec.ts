import { describe, expect, it } from 'vitest';
import {
  extractChatStorageKeyFromRef,
  signChatStorageKey,
  verifyChatFileSignature,
} from './chat-file-url';

describe('chat-file-url', () => {
  const secret = 'test-secret';
  const base = 'https://shop.test';

  it('signs and verifies chat storage key', () => {
    const key = 'chat/orders/ord-1/1700000000000-deadbeef.pdf';
    const url = signChatStorageKey(secret, base, key, 4_000_000_000);
    const u = new URL(url);
    const exp = Number(u.searchParams.get('exp'));
    const sig = u.searchParams.get('sig') ?? '';
    expect(verifyChatFileSignature(secret, key, exp, sig)).toBe(true);
    expect(extractChatStorageKeyFromRef(url, base)).toBe(key);
  });

  it('parses legacy /uploads/ URL', () => {
    const key = 'chat/support/u1/1-abc.jpg';
    expect(extractChatStorageKeyFromRef(`${base}/uploads/${key}`, base)).toBe(key);
  });
});
