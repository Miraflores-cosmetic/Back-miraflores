-- Аудит смены ReferralSettings (снимок ДО изменения).
CREATE TABLE "ReferralSettingsRevision" (
    "id" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "actorUserId" TEXT,
    "actorEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralSettingsRevision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReferralSettingsRevision_createdAt_idx" ON "ReferralSettingsRevision"("createdAt");

ALTER TABLE "ReferralSettingsRevision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReferralSettingsRevision" FORCE ROW LEVEL SECURITY;

CREATE POLICY referral_settings_revision_all ON "ReferralSettingsRevision"
  FOR ALL
  USING (jcos_rls_bypass())
  WITH CHECK (jcos_rls_bypass());
