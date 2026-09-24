import { ORDER_CHAT_UPLOAD_MAX_FILE_BYTES } from './constants';

export function orderChatUploadMaxMbHuman(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return Number.isInteger(mb) ? String(mb) : mb.toFixed(1);
}

export function orderChatFileTooLargeUserMessage(
  maxBytes: number = ORDER_CHAT_UPLOAD_MAX_FILE_BYTES,
): string {
  return `Файл слишком большой. Максимум ${orderChatUploadMaxMbHuman(maxBytes)} МБ на одно вложение.`;
}

function messageFromNestJsonBody(text: string): string | undefined {
  try {
    const j = JSON.parse(text) as { message?: unknown };
    if (typeof j?.message === 'string' && j.message.trim()) return j.message.trim();
    if (Array.isArray(j?.message) && j.message.length) return j.message.map(String).join(', ');
  } catch {
    /* not JSON */
  }
  return undefined;
}

function looksLikeFileTooLarge(body: string): boolean {
  const s = body.toLowerCase();
  return (
    s.includes('too large') ||
    s.includes('file size') ||
    s.includes('limit exceeded') ||
    s.includes('request entity too large') ||
    s.includes('payload too large') ||
    s.includes('multer_error') ||
    s.includes('"code":"limits_file_size"') ||
    /\b413\b/.test(s)
  );
}

export async function describeOrderChatUploadFailure(
  res: Response,
  maxBytes: number = ORDER_CHAT_UPLOAD_MAX_FILE_BYTES,
): Promise<string> {
  const oversizeHint = orderChatFileTooLargeUserMessage(maxBytes);
  if (res.status === 413) return oversizeHint;

  let text = '';
  try {
    text = await res.text();
  } catch {
    return oversizeHint;
  }

  if (looksLikeFileTooLarge(text)) return oversizeHint;

  const fromJson = messageFromNestJsonBody(text);
  if (fromJson) {
    return looksLikeFileTooLarge(fromJson) ? oversizeHint : fromJson;
  }

  const trimmed = text.trim();
  if (!trimmed) return res.statusText?.trim() || oversizeHint;
  return looksLikeFileTooLarge(trimmed) ? oversizeHint : trimmed;
}
