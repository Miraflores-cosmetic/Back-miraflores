import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, readdir, stat, unlink, writeFile } from 'fs/promises';
import { join, extname } from 'path';
import { randomBytes } from 'crypto';
import type { ChatAttachmentKind } from '@prisma/client';
import { extractChatStorageKeyFromRef } from '../order-chat/chat-file-url';
import {
  CHAT_UPLOAD_META_SUFFIX,
  chatAttachmentKindFromMime,
  normalizeChatStorageKey,
  readChatUploadMeta,
  inferChatUploadMetaFromFile,
  writeChatUploadMetaFile,
  type ChatUploadMeta,
} from './chat-upload-meta';

const IMAGE_ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const VIDEO_ALLOWED = new Set(['video/mp4', 'video/quicktime']);
/** Лимит картинок (каталог, блог, аватар staff) — multer и storage должны совпадать. */
export const IMAGE_MAX_BYTES = 6 * 1024 * 1024;
/** Чат: фото и PDF (совпадает с ORDER_CHAT_UPLOAD_MAX_FILE_BYTES). */
export const CHAT_FILE_MAX_BYTES = 35 * 1024 * 1024;
const VIDEO_MAX_BYTES = 80 * 1024 * 1024;

const MIME_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'application/pdf': '.pdf',
};

export function detectPdfMime(buf: Buffer): boolean {
  return buf.length >= 5 && buf.subarray(0, 5).toString('ascii') === '%PDF-';
}

/** Определяет MIME картинки по magic bytes (не по заголовку клиента). */
export function detectImageMime(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return 'image/png';
  }
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) {
    return 'image/gif';
  }
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

/** MP4/MOV: ISO BMFF `ftyp` box; уточняем по бренду / расширению. */
export function detectVideoMime(buf: Buffer, originalname?: string): string | null {
  if (buf.length < 12) return null;
  const box = buf.toString('ascii', 4, 8);
  if (box !== 'ftyp') return null;
  const brand = buf.toString('ascii', 8, 12);
  const ext = (originalname ? extname(originalname) : '').toLowerCase();
  if (ext === '.mov' || brand === 'qt  ') return 'video/quicktime';
  if (
    ext === '.mp4' ||
    ['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'M4V ', 'MSNV', 'ndas'].includes(brand)
  ) {
    return 'video/mp4';
  }
  // ftyp есть — по умолчанию mp4 (многие mov тоже так маркируются)
  if (ext === '.mov') return 'video/quicktime';
  return 'video/mp4';
}

export type MediaKind = 'image' | 'video';

@Injectable()
export class LocalStorageService {
  constructor(private readonly config: ConfigService) {}

  private backendRootDir(): string {
    const cwd = process.cwd().replace(/\/+$/, '');
    return cwd.endsWith('/backend') ? cwd : join(cwd, 'backend');
  }

  uploadRoot(): string {
    return (
      this.config.get<string>('LOCAL_UPLOADS_DIR')?.trim() ||
      join(this.backendRootDir(), '.data', 'local-uploads')
    );
  }

  /** Публичный origin API без завершающего / */
  publicBase(): string {
    const fromEnv = this.config.get<string>('LOCAL_UPLOADS_PUBLIC_URL')?.trim();
    if (fromEnv) return fromEnv.replace(/\/+$/, '');
    const port = this.config.get('PORT') ?? 3001;
    return `http://127.0.0.1:${port}`;
  }

  /**
   * Проверка размера + magic bytes.
   * Client `mimetype` игнорируется как источник истины (можно подделать).
   * @returns канонический MIME по содержимому файла
   */
  assertImage(file: { size: number; mimetype?: string; buffer?: Buffer }): string {
    if (file.size > IMAGE_MAX_BYTES) {
      throw new BadRequestException('Изображение больше 6 МБ');
    }
    if (!file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('Пустой файл');
    }
    const detected = detectImageMime(file.buffer);
    if (!detected || !IMAGE_ALLOWED.has(detected)) {
      throw new BadRequestException('Допустимы только JPEG, PNG, WebP или GIF');
    }
    return detected;
  }

  assertVideo(file: {
    size: number;
    mimetype?: string;
    buffer?: Buffer;
    originalname?: string;
  }): string {
    if (file.size > VIDEO_MAX_BYTES) {
      throw new BadRequestException('Видео больше 80 МБ');
    }
    if (!file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('Пустой файл');
    }
    const detected = detectVideoMime(file.buffer, file.originalname);
    if (!detected || !VIDEO_ALLOWED.has(detected)) {
      throw new BadRequestException('Допустимы только MP4 или MOV');
    }
    return detected;
  }

  /** Картинка или видео для галереи товара. */
  assertGalleryMedia(file: {
    size: number;
    mimetype?: string;
    buffer?: Buffer;
    originalname?: string;
  }): { mime: string; kind: MediaKind } {
    if (!file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('Пустой файл');
    }
    const imageMime = detectImageMime(file.buffer);
    if (imageMime && IMAGE_ALLOWED.has(imageMime)) {
      if (file.size > IMAGE_MAX_BYTES) {
        throw new BadRequestException('Изображение больше 6 МБ');
      }
      return { mime: imageMime, kind: 'image' };
    }
    const videoMime = detectVideoMime(file.buffer, file.originalname);
    if (videoMime && VIDEO_ALLOWED.has(videoMime)) {
      if (file.size > VIDEO_MAX_BYTES) {
        throw new BadRequestException('Видео больше 80 МБ');
      }
      return { mime: videoMime, kind: 'video' };
    }
    throw new BadRequestException('Допустимы JPEG/PNG/WebP/GIF или MP4/MOV');
  }

  getPublicUrlForKey(key: string): string {
    return `${this.publicBase()}/uploads/${key.replace(/^\/+/, '')}`;
  }

  tryPublicUrlToKey(url: string): string | null {
    const u = url.trim();
    const prefix = `${this.publicBase()}/uploads/`;
    if (!u.startsWith(prefix)) return null;
    try {
      return decodeURIComponent(u.slice(prefix.length));
    } catch {
      return null;
    }
  }

  /** Validates chat attachment URL and returns stored metadata (sidecar or file probe). */
  /** Всегда через normalizeChatStorageKey (без сырого tryPublicUrlToKey). */
  resolveChatStorageKeyFromRef(ref: string, expectedPrefix: string): string {
    const prefix = expectedPrefix.replace(/\/$/, '');
    const fromSigned = extractChatStorageKeyFromRef(ref, this.publicBase());
    if (fromSigned) return normalizeChatStorageKey(fromSigned, prefix);
    const fromPublic = this.tryPublicUrlToKey(ref);
    if (!fromPublic) throw new BadRequestException('Недопустимый URL вложения');
    return normalizeChatStorageKey(fromPublic, prefix);
  }

  async resolveChatAttachmentFromUrl(
    url: string,
    expectedPrefix: string,
  ): Promise<{ fileUrl: string; filename: string; mimeType: string; kind: ChatAttachmentKind }> {
    const key = this.resolveChatStorageKeyFromRef(url, expectedPrefix);
    const fileUrl = this.getPublicUrlForKey(key);
    let meta: ChatUploadMeta | null = await readChatUploadMeta(this.uploadRoot(), key);
    if (!meta) {
      meta = await inferChatUploadMetaFromFile(this.uploadRoot(), key);
    }
    if (!meta) throw new BadRequestException('Файл вложения не найден');
    return {
      fileUrl,
      filename: meta.filename,
      mimeType: meta.mimeType,
      kind: meta.kind,
    };
  }

  async saveImage(
    file: { buffer: Buffer; mimetype: string; size: number; originalname?: string },
    folder: string,
  ): Promise<{ key: string; url: string }> {
    const mime = this.assertImage(file);
    return this.writeFile(file.buffer, folder, mime);
  }

  /** Изображение или PDF для чата заказа / поддержки. */
  assertChatFile(file: { size: number; buffer?: Buffer }): string {
    if (file.size > CHAT_FILE_MAX_BYTES) {
      throw new BadRequestException('Файл больше 35 МБ');
    }
    const buf = file.buffer;
    if (!buf?.length) throw new BadRequestException('Пустой файл');
    const img = detectImageMime(buf);
    if (img) return img;
    if (detectPdfMime(buf)) return 'application/pdf';
    throw new BadRequestException('Допустимы изображения (JPEG, PNG, WebP, GIF) и PDF');
  }

  async saveChatFile(
    file: { buffer: Buffer; size: number },
    folder: string,
    opts?: { originalFilename?: string; uploadedByUserId?: string },
  ): Promise<{ key: string; url: string; mime: string }> {
    const mime = this.assertChatFile(file);
    const saved = await this.writeFile(file.buffer, folder, mime, { entropyBytes: 16 });
    const filename = (opts?.originalFilename?.trim() || 'file').slice(0, 512);
    const meta: ChatUploadMeta = {
      filename,
      mimeType: mime,
      kind: chatAttachmentKindFromMime(mime),
      size: file.size,
      uploadedByUserId: opts?.uploadedByUserId?.trim() || undefined,
    };
    await writeChatUploadMetaFile(this.uploadRoot(), saved.key, meta);
    return { ...saved, mime };
  }

  async saveGalleryMedia(
    file: { buffer: Buffer; mimetype: string; size: number; originalname?: string },
    folder: string,
  ): Promise<{ key: string; url: string; mediaType: MediaKind }> {
    const { mime, kind } = this.assertGalleryMedia(file);
    const saved = await this.writeFile(file.buffer, folder, mime);
    return { ...saved, mediaType: kind };
  }

  private async writeFile(
    buffer: Buffer,
    folder: string,
    mime: string,
    opts?: { entropyBytes?: number },
  ): Promise<{ key: string; url: string }> {
    const ext = MIME_EXT[mime] ?? '.bin';
    const entropyBytes = opts?.entropyBytes ?? 4;
    const key = `${folder.replace(/^\/+|\/+$/g, '')}/${Date.now()}-${randomBytes(entropyBytes).toString('hex')}${ext}`;
    const abs = join(this.uploadRoot(), key);
    await mkdir(join(abs, '..'), { recursive: true });
    await writeFile(abs, buffer);
    return { key, url: this.getPublicUrlForKey(key) };
  }

  async deleteByPublicUrl(url: string): Promise<boolean> {
    try {
      const key = this.resolveChatStorageKeyFromRef(url, 'chat');
      return this.deleteByStorageKey(key);
    } catch {
      return false;
    }
  }

  async deleteByStorageKey(key: string): Promise<boolean> {
    let normalized: string;
    try {
      normalized = normalizeChatStorageKey(key, 'chat');
    } catch {
      return false;
    }
    const root = this.uploadRoot();
    let ok = false;
    try {
      await unlink(join(root, normalized));
      ok = true;
    } catch {
      /* file may already be gone */
    }
    try {
      await unlink(join(root, normalized + CHAT_UPLOAD_META_SUFFIX));
    } catch {
      /* ignore */
    }
    return ok;
  }

  /** Файлы chat/* старше minAgeMs без записи в БД (orphan uploads). */
  async purgeUnreferencedChatFiles(
    minAgeMs: number,
    canDelete: (publicUrl: string) => Promise<boolean>,
  ): Promise<number> {
    const root = this.uploadRoot();
    const chatRoot = join(root, 'chat');
    let deleted = 0;

    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const ent of entries) {
        const abs = join(dir, ent.name);
        if (ent.isDirectory()) {
          await walk(abs);
          continue;
        }
        if (ent.name.endsWith('.chat-upload-meta.json')) continue;
        const st = await stat(abs).catch(() => null);
        if (!st?.isFile()) continue;
        if (Date.now() - st.mtimeMs < minAgeMs) continue;
        const rel = abs.slice(root.length + 1).replace(/\\/g, '/');
        if (!rel.startsWith('chat/')) continue;
        const publicUrl = this.getPublicUrlForKey(rel);
        if (await canDelete(publicUrl)) {
          if (await this.deleteByStorageKey(rel)) deleted += 1;
        }
      }
    };

    await walk(chatRoot);
    return deleted;
  }
}
