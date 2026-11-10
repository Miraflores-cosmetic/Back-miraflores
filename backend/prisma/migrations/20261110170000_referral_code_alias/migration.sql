-- Previous ?mf= codes stay resolvable for grace (linkTtlDays) after regenerate.
CREATE TABLE "ReferralCodeAlias" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralCodeAlias_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReferralCodeAlias_code_key" ON "ReferralCodeAlias"("code");
CREATE INDEX "ReferralCodeAlias_userId_idx" ON "ReferralCodeAlias"("userId");
CREATE INDEX "ReferralCodeAlias_expiresAt_idx" ON "ReferralCodeAlias"("expiresAt");

ALTER TABLE "ReferralCodeAlias" ADD CONSTRAINT "ReferralCodeAlias_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
