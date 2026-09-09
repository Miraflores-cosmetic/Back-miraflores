-- CreateEnum
CREATE TYPE "ProductAttributeKind" AS ENUM ('productType', 'purpose', 'shelfLife', 'storage');

-- CreateTable
CREATE TABLE "ProductAttributeOption" (
    "id" TEXT NOT NULL,
    "kind" "ProductAttributeKind" NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductAttributeOption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductAttributeOption_kind_active_sortOrder_idx" ON "ProductAttributeOption"("kind", "active", "sortOrder");
