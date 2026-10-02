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
