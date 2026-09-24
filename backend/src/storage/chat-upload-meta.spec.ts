import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { normalizeChatStorageKey } from './chat-upload-meta';

describe('normalizeChatStorageKey', () => {
  const prefix = 'chat/orders/o1';

  it('accepts keys under prefix', () => {
    expect(normalizeChatStorageKey(`${prefix}/file.pdf`, prefix)).toBe(
      `${prefix}/file.pdf`,
    );
  });

  it('rejects path traversal', () => {
    expect(() =>
      normalizeChatStorageKey(`${prefix}/../other/x.pdf`, prefix),
    ).toThrow(BadRequestException);
  });

  it('rejects absolute paths', () => {
    expect(() => normalizeChatStorageKey('/chat/orders/o1/x.pdf', prefix)).toThrow(
      BadRequestException,
    );
  });
});
