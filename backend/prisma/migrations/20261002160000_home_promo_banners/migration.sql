-- CreateTable
CREATE TABLE "HomePromoConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "titleLeft" TEXT NOT NULL DEFAULT 'НАШИ',
    "titleRight" TEXT NOT NULL DEFAULT 'АКЦИИ',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomePromoConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HomePromoBanner" (
    "id" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "href" TEXT NOT NULL DEFAULT '/catalog',
    "alt" TEXT NOT NULL DEFAULT '',
    "notch" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomePromoBanner_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HomePromoBanner_active_sortOrder_idx" ON "HomePromoBanner"("active", "sortOrder");

-- Seed default config row
INSERT INTO "HomePromoConfig" ("id", "titleLeft", "titleRight", "updatedAt")
VALUES ('default', 'НАШИ', 'АКЦИИ', CURRENT_TIMESTAMP);
