-- Сверка тарифа Ozon: факт из кабинета vs оценка по своей сетке
ALTER TABLE "Shipment" ADD COLUMN "carrierCostRub" INTEGER;
ALTER TABLE "Shipment" ADD COLUMN "carrierCostAt" TIMESTAMP(3);
ALTER TABLE "Shipment" ADD COLUMN "estimatedCostRub" INTEGER;
ALTER TABLE "Shipment" ADD COLUMN "billableGrams" INTEGER;
ALTER TABLE "Shipment" ADD COLUMN "tariffVersion" TEXT;

-- Мониторинг подключения Ozon
ALTER TABLE "OzonIntegration" ADD COLUMN "lastCheckAt" TIMESTAMP(3);
ALTER TABLE "OzonIntegration" ADD COLUMN "lastCheckOk" BOOLEAN;
ALTER TABLE "OzonIntegration" ADD COLUMN "lastPointCount" INTEGER;
ALTER TABLE "OzonIntegration" ADD COLUMN "consecutiveFailures" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "OzonIntegration" ADD COLUMN "alertState" TEXT;
ALTER TABLE "OzonIntegration" ADD COLUMN "lastAlertAt" TIMESTAMP(3);

CREATE TABLE "OzonHealthCheck" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ok" BOOLEAN NOT NULL,
    "connected" BOOLEAN NOT NULL,
    "pointCount" INTEGER,
    "durationMs" INTEGER NOT NULL,
    "failure" TEXT,
    "error" TEXT,
    "trigger" TEXT NOT NULL,

    CONSTRAINT "OzonHealthCheck_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OzonHealthCheck_createdAt_idx" ON "OzonHealthCheck"("createdAt");

-- RLS: служебные данные — только системный bypass (как OzonIntegration)
ALTER TABLE "OzonHealthCheck" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OzonHealthCheck" FORCE ROW LEVEL SECURITY;

CREATE POLICY ozon_health_check_bypass ON "OzonHealthCheck"
  FOR ALL
  USING (jcos_rls_bypass())
  WITH CHECK (jcos_rls_bypass());
