-- Audit: last editor on template + revision snapshots on PUT.
ALTER TABLE "EmailNotificationTemplate" ADD COLUMN "lastEditedByUserId" TEXT;
ALTER TABLE "EmailNotificationTemplate" ADD COLUMN "lastEditedByEmail" TEXT;
ALTER TABLE "EmailNotificationTemplate" ADD COLUMN "lastEditedAt" TIMESTAMP(3);

CREATE TABLE "EmailNotificationTemplateRevision" (
    "id" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "actorUserId" TEXT,
    "actorEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailNotificationTemplateRevision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmailNotificationTemplateRevision_eventKey_createdAt_idx" ON "EmailNotificationTemplateRevision"("eventKey", "createdAt");
