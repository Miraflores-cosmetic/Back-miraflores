-- Editable transactional email templates (admin/settings).
CREATE TABLE "EmailNotificationTemplate" (
    "id" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailNotificationTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailNotificationTemplate_eventKey_key" ON "EmailNotificationTemplate"("eventKey");
