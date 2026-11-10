-- Агрегат кликов ?mf= по календарному дню (Europe/Moscow) и коду.
CREATE TABLE "ReferralMfVisitDaily" (
    "id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "code" TEXT NOT NULL,
    "referrerUserId" TEXT,
    "visits" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralMfVisitDaily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReferralMfVisitDaily_day_code_key" ON "ReferralMfVisitDaily"("day", "code");
CREATE INDEX "ReferralMfVisitDaily_day_idx" ON "ReferralMfVisitDaily"("day");
CREATE INDEX "ReferralMfVisitDaily_code_idx" ON "ReferralMfVisitDaily"("code");
CREATE INDEX "ReferralMfVisitDaily_referrerUserId_day_idx" ON "ReferralMfVisitDaily"("referrerUserId", "day");

ALTER TABLE "ReferralMfVisitDaily" ADD CONSTRAINT "ReferralMfVisitDaily_referrerUserId_fkey" FOREIGN KEY ("referrerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Только bypass (агрегат, не user-owned). Public track / admin funnel — runInRlsTransaction bypass.
ALTER TABLE "ReferralMfVisitDaily" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReferralMfVisitDaily" FORCE ROW LEVEL SECURITY;

CREATE POLICY referral_mf_visit_daily_all ON "ReferralMfVisitDaily"
  FOR ALL
  USING (jcos_rls_bypass())
  WITH CHECK (jcos_rls_bypass());
