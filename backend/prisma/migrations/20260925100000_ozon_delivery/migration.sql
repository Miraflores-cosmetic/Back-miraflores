-- AlterEnum
ALTER TYPE "ShipmentProvider" ADD VALUE IF NOT EXISTS 'OZON' BEFORE 'PICKUP';

-- CreateTable
CREATE TABLE "OzonIntegration" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "refreshTokenEnc" TEXT,
    "connectedAt" TIMESTAMP(3),
    "connectedByUserId" TEXT,
    "lastRefreshAt" TIMESTAMP(3),
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OzonIntegration_pkey" PRIMARY KEY ("id")
);

-- RLS: токены — только staff / системный bypass
ALTER TABLE "OzonIntegration" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OzonIntegration" FORCE ROW LEVEL SECURITY;

CREATE POLICY ozon_integration_bypass ON "OzonIntegration"
  FOR ALL
  USING (jcos_rls_bypass())
  WITH CHECK (jcos_rls_bypass());
