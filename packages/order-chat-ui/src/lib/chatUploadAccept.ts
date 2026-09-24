/** Совпадает с Nest `assertChatFile` / magic bytes (JPEG, PNG, WebP, GIF, PDF). */
export const ORDER_CHAT_ALLOWED_UPLOAD_MIMES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
] as const;

export const ORDER_CHAT_FILE_INPUT_ACCEPT =
  'image/jpeg,image/png,image/webp,image/gif,application/pdf';

export const ORDER_CHAT_UNSUPPORTED_FILE_MESSAGE =
  'Допустимы изображения JPEG, PNG, WebP, GIF и PDF';

export function isAllowedChatUploadFile(file: File): boolean {
  const mime = (file.type ?? '').trim().toLowerCase();
  if (
    mime &&
    (ORDER_CHAT_ALLOWED_UPLOAD_MIMES as readonly string[]).includes(mime)
  ) {
    return true;
  }
  const name = file.name.toLowerCase();
  return /\.(jpe?g|png|gif|webp|pdf)$/.test(name);
}
