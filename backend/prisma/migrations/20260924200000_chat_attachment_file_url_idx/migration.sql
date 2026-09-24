-- Подсчёт ссылок на файл при удалении / retention (fileUrl canonical).
CREATE INDEX IF NOT EXISTS "ChatAttachment_fileUrl_idx" ON "ChatAttachment"("fileUrl");
