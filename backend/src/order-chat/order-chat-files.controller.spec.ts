import 'reflect-metadata';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Writable } from 'stream';
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { Response } from 'express';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { SKIP_RLS_TRANSACTION_KEY } from '../rls/skip-rls-transaction.decorator';
import { LocalStorageService } from '../storage/local-storage.service';
import { OrderChatFilesController } from './order-chat-files.controller';
import { signChatStorageKey } from './chat-file-url';

describe('OrderChatFilesController', () => {
  const secret = 'files-controller-test-secret';
  const publicBase = 'https://shop.test';

  it('marked @Public and @SkipRlsTransaction (no JWT / RLS for signed GET)', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, OrderChatFilesController)).toBe(true);
    expect(Reflect.getMetadata(SKIP_RLS_TRANSACTION_KEY, OrderChatFilesController)).toBe(true);
  });

  it('streams file by valid signed URL without Authorization', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mira-chat-files-'));
    const key = 'chat/orders/test-order/1-sample.bin';
    const abs = join(root, key);
    mkdirSync(join(root, 'chat/orders/test-order'), { recursive: true });
    writeFileSync(abs, 'chat-bytes', { encoding: 'utf8' });

    const storage = {
      uploadRoot: () => root,
      publicBase: () => publicBase,
    } as Pick<LocalStorageService, 'uploadRoot' | 'publicBase'> as LocalStorageService;

    const controller = new OrderChatFilesController(storage, {
      get: (name: string) => (name === 'ORDER_CHAT_FILE_SIGN_SECRET' ? secret : undefined),
    });

    const signed = signChatStorageKey(secret, publicBase, key, Math.floor(Date.now() / 1000) + 3600);
    const u = new URL(signed);

    const headers: Record<string, string> = {};
    const chunks: Buffer[] = [];
    const writable = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        cb();
      },
    });
    const res = Object.assign(writable, {
      setHeader(name: string, value: string) {
        headers[name] = value;
      },
    }) as unknown as Response;

    await new Promise<void>((resolve, reject) => {
      writable.on('finish', () => resolve());
      writable.on('error', reject);
      void controller
        .download(
          u.searchParams.get('key') ?? undefined,
          u.searchParams.get('exp') ?? undefined,
          u.searchParams.get('sig') ?? undefined,
          res,
        )
        .then(() => {
          /* body streams after download() returns */
        })
        .catch(reject);
    });

    expect(Buffer.concat(chunks).toString('utf8')).toBe('chat-bytes');
    expect(headers['Content-Type']).toBe('application/octet-stream');
    expect(headers['Cache-Control']).toBe('private, no-store');
  });

  it('400 on malformed storage key encoding', async () => {
    const storage = {
      uploadRoot: () => tmpdir(),
      publicBase: () => publicBase,
    } as Pick<LocalStorageService, 'uploadRoot' | 'publicBase'> as LocalStorageService;

    const controller = new OrderChatFilesController(storage, {
      get: (name: string) => (name === 'ORDER_CHAT_FILE_SIGN_SECRET' ? secret : undefined),
    });

    const exp = String(Math.floor(Date.now() / 1000) + 3600);
    await expect(
      controller.download('chat/orders/x/%E0%A4%A', exp, 'sig', {} as Response),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
