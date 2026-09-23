-- Ops: last transactional send path for admin badge (does not touch updatedAt on write via raw SQL).
ALTER TABLE "EmailNotificationTemplate" ADD COLUMN "lastSendPath" TEXT;
ALTER TABLE "EmailNotificationTemplate" ADD COLUMN "lastSendAt" TIMESTAMP(3);
