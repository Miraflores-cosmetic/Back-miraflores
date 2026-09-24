import { BadRequestException } from '@nestjs/common';
import { ChatAttachmentKind } from '@prisma/client';
import { readFile, stat } from 'fs/promises';
import { join } from 'path';
import {
  CHAT_FILE_MAX_BYTES,
  detectImageMime,
  detectPdfMime,
} from './local-storage.service';

export const CHAT_UPLOAD_META_SUFFIX = '.chat-upload-meta.json';

export type ChatUploadMeta = {
  filename: string;
  mimeType: string;
  kind: ChatAttachmentKind;
  size: number;
  /** Кто загрузил (revoke только владельцу). */
  uploadedByUserId?: string;
};

/** Reject path traversal and require key under expected prefix (no trailing slash on prefix). */
function decodeStorageKeySegment(key: string): string {
  try {
    return decodeURIComponent(key.trim());
  } catch {
    throw new BadRequestException('Недопустимый URL вложения');
  }
}

export function normalizeChatStorageKey(key: string, expectedPrefix: string): string {
  const decoded = decodeStorageKeySegment(key).replace(/\\/g, '/');
  if (!decoded || decoded.includes('\0')) {
    throw new BadRequestException('Недопустимый URL вложения');
  }
  if (decoded.startsWith('/') || decoded.includes('..')) {
    throw new BadRequestException('Недопустимый URL вложения');
  }
  const normalized = decoded.replace(/\/+/g, '/');
  const prefix = expectedPrefix.replace(/^\/+|\/+$/g, '');
  if (!normalized.startsWith(`${prefix}/`) && normalized !== prefix) {
    throw new BadRequestException('Недопустимый URL вложения');
  }
  return normalized;
}

export function chatAttachmentKindFromMime(mime: string): ChatAttachmentKind {
  return mime.startsWith('image/') && mime !== 'image/tiff'
    ? ChatAttachmentKind.IMAGE
    : ChatAttachmentKind.FILE;
}

export async function writeChatUploadMetaFile(
  uploadRoot: string,
  key: string,
  meta: ChatUploadMeta,
): Promise<void> {
  const { writeFile } = await import('fs/promises');
  const abs = join(uploadRoot, key + CHAT_UPLOAD_META_SUFFIX);
  await writeFile(abs, JSON.stringify(meta), 'utf8');
}

export async function readChatUploadMeta(
  uploadRoot: string,
  key: string,
): Promise<ChatUploadMeta | null> {
  try {
    const raw = await readFile(join(uploadRoot, key + CHAT_UPLOAD_META_SUFFIX), 'utf8');
    const parsed = JSON.parse(raw) as ChatUploadMeta;
    if (
      typeof parsed.filename !== 'string' ||
      typeof parsed.mimeType !== 'string' ||
      typeof parsed.size !== 'number'
    ) {
      return null;
    }
    const uploadedByUserId =
      typeof parsed.uploadedByUserId === 'string' && parsed.uploadedByUserId.trim()
        ? parsed.uploadedByUserId.trim()
        : undefined;
    return {
      filename: parsed.filename.slice(0, 512),
      mimeType: parsed.mimeType.slice(0, 128),
      kind: chatAttachmentKindFromMime(parsed.mimeType),
      size: parsed.size,
      uploadedByUserId,
    };
  } catch {
    return null;
  }
}

/** Fallback for uploads before sidecar meta existed. */
export async function inferChatUploadMetaFromFile(
  uploadRoot: string,
  key: string,
): Promise<ChatUploadMeta | null> {
  const abs = join(uploadRoot, key);
  let st;
  try {
    st = await stat(abs);
  } catch {
    return null;
  }
  if (!st.isFile() || st.size <= 0 || st.size > CHAT_FILE_MAX_BYTES) return null;
  const buf = await readFile(abs);
  const img = detectImageMime(buf);
  const mime = img ?? (detectPdfMime(buf) ? 'application/pdf' : null);
  if (!mime) return null;
  const base = key.split('/').pop() ?? 'file';
  return {
    filename: base.slice(0, 512),
    mimeType: mime,
    kind: chatAttachmentKindFromMime(mime),
    size: st.size,
  };
}
