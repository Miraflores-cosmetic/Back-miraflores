CREATE TYPE "DeliverySurchargeKind" AS ENUM ('FIXED', 'PERCENT');

ALTER TABLE "DeliverySettings" ADD COLUMN "cdekSurchargeKind" "DeliverySurchargeKind" NOT NULL DEFAULT 'FIXED';
ALTER TABLE "DeliverySettings" ADD COLUMN "cdekSurchargeValue" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DeliverySettings" ADD COLUMN "ozonSurchargeKind" "DeliverySurchargeKind" NOT NULL DEFAULT 'FIXED';
ALTER TABLE "DeliverySettings" ADD COLUMN "ozonSurchargeValue" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DeliverySettings" ADD COLUMN "yandexSurchargeKind" "DeliverySurchargeKind" NOT NULL DEFAULT 'FIXED';
ALTER TABLE "DeliverySettings" ADD COLUMN "yandexSurchargeValue" INTEGER NOT NULL DEFAULT 0;

UPDATE "DeliverySettings"
SET
  "cdekSurchargeValue" = "cdekSurchargeRub",
  "ozonSurchargeValue" = "ozonSurchargeRub",
  "yandexSurchargeValue" = "yandexSurchargeRub";

ALTER TABLE "DeliverySettings" DROP COLUMN "cdekSurchargeRub";
ALTER TABLE "DeliverySettings" DROP COLUMN "ozonSurchargeRub";
ALTER TABLE "DeliverySettings" DROP COLUMN "yandexSurchargeRub";
