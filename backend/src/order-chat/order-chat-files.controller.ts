import {
  Controller,
  Get,
  NotFoundException,
  Query,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Response } from 'express';
import { createReadStream, existsSync } from 'fs';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import { LocalStorageService } from '../storage/local-storage.service';
import { readChatUploadMeta, inferChatUploadMetaFromFile } from '../storage/chat-upload-meta';
import {
  extractChatStorageKeyFromRef,
  resolveChatFileSigningSecret,
  verifyChatFileSignature,
} from './chat-file-url';

@Controller('order-chat/files')
export class OrderChatFilesController {
  private readonly signSecret: string;

  constructor(
    private readonly storage: LocalStorageService,
    config: ConfigService,
  ) {
    this.signSecret = resolveChatFileSigningSecret(config);
  }

  @Get()
  async download(
    @Query('key') keyRaw: string | undefined,
    @Query('exp') expRaw: string | undefined,
    @Query('sig') sigRaw: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const key = keyRaw?.trim() ?? '';
    const sig = sigRaw?.trim() ?? '';
    const exp = expRaw != null ? Number(expRaw) : NaN;
    if (!key || !sig || !Number.isFinite(exp)) {
      throw new UnauthorizedException('Invalid file link');
    }
    if (!verifyChatFileSignature(this.signSecret, key, exp, sig)) {
      throw new UnauthorizedException('Invalid or expired file link');
    }

    let normalized: string;
    try {
      normalized = extractChatStorageKeyFromRef(key, this.storage.publicBase()) ?? key;
    } catch {
      throw new NotFoundException();
    }

    const abs = join(this.storage.uploadRoot(), normalized);
    if (!existsSync(abs)) {
      throw new NotFoundException();
    }

    const meta =
      (await readChatUploadMeta(this.storage.uploadRoot(), normalized)) ??
      (await inferChatUploadMetaFromFile(this.storage.uploadRoot(), normalized));
    const mime = meta?.mimeType?.trim() || 'application/octet-stream';

    res.setHeader('Content-Type', mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Cache-Control', 'private, no-store');
    createReadStream(abs).pipe(res);
  }
}
