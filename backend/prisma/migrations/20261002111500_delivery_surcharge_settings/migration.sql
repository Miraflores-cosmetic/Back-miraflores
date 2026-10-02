-- CartSettings was renamed from DeliverySettings (20260827200000); PK name stayed "DeliverySettings_pkey".
ALTER TABLE "CartSettings" RENAME CONSTRAINT "DeliverySettings_pkey" TO "CartSettings_pkey";

CREATE TABLE "DeliverySettings" (
    "id" TEXT NOT NULL,
    "cdekSurchargeRub" INTEGER NOT NULL DEFAULT 0,
    "ozonSurchargeRub" INTEGER NOT NULL DEFAULT 0,
    "yandexSurchargeRub" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliverySettings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "DeliverySettings" ("id", "cdekSurchargeRub", "ozonSurchargeRub", "yandexSurchargeRub", "updatedAt")
VALUES ('default', 0, 0, 0, CURRENT_TIMESTAMP);
