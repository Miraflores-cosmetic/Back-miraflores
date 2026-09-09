-- CreateEnum
CREATE TYPE "GroupCategoryPriceType" AS ENUM ('PERCENT_OFF', 'FIXED_OFF', 'FIXED_PRICE');

-- CreateEnum
CREATE TYPE "CatalogVisibilityMode" AS ENUM ('HIDE_FROM_GUESTS', 'HIDE_FROM_REGISTERED', 'HIDE_FROM_GROUP', 'SHOW_ONLY_REGISTERED', 'SHOW_ONLY_GROUP');

-- CreateEnum
CREATE TYPE "CatalogVisibilityTarget" AS ENUM ('PRODUCT', 'CATEGORY', 'VARIANT');

-- CreateEnum
CREATE TYPE "PriceRounding" AS ENUM ('FLOOR', 'CEIL', 'NEAREST');

-- CreateTable
CREATE TABLE "UserGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isDefaultGuest" BOOLEAN NOT NULL DEFAULT false,
    "isDefaultRegistered" BOOLEAN NOT NULL DEFAULT false,
    "assignable" BOOLEAN NOT NULL DEFAULT true,
    "allowCatalogDiscounts" BOOLEAN NOT NULL DEFAULT false,
    "allowPromoCodes" BOOLEAN NOT NULL DEFAULT true,
    "priceRounding" "PriceRounding" NOT NULL DEFAULT 'NEAREST',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupVariantPrice" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupVariantPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupCategoryPrice" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "type" "GroupCategoryPriceType" NOT NULL,
    "value" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupCategoryPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogGroupVisibility" (
    "id" TEXT NOT NULL,
    "mode" "CatalogVisibilityMode" NOT NULL,
    "groupId" TEXT,
    "targetType" "CatalogVisibilityTarget" NOT NULL,
    "targetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogGroupVisibility_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "User" ADD COLUMN "groupId" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "pricingGroupId" TEXT,
ADD COLUMN "pricingGroupName" TEXT,
ADD COLUMN "pricingContext" TEXT;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN "baseUnitPrice" INTEGER,
ADD COLUMN "groupUnitPrice" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "UserGroup_slug_key" ON "UserGroup"("slug");

-- CreateIndex
CREATE INDEX "UserGroup_active_idx" ON "UserGroup"("active");

-- CreateIndex
CREATE UNIQUE INDEX "GroupVariantPrice_groupId_variantId_key" ON "GroupVariantPrice"("groupId", "variantId");

-- CreateIndex
CREATE INDEX "GroupVariantPrice_variantId_idx" ON "GroupVariantPrice"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupCategoryPrice_groupId_categoryId_key" ON "GroupCategoryPrice"("groupId", "categoryId");

-- CreateIndex
CREATE INDEX "GroupCategoryPrice_categoryId_idx" ON "GroupCategoryPrice"("categoryId");

-- CreateIndex
CREATE INDEX "CatalogGroupVisibility_targetType_targetId_idx" ON "CatalogGroupVisibility"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "CatalogGroupVisibility_groupId_idx" ON "CatalogGroupVisibility"("groupId");

-- CreateIndex
CREATE INDEX "CatalogGroupVisibility_mode_idx" ON "CatalogGroupVisibility"("mode");

-- CreateIndex
CREATE INDEX "User_groupId_idx" ON "User"("groupId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "UserGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupVariantPrice" ADD CONSTRAINT "GroupVariantPrice_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "UserGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupVariantPrice" ADD CONSTRAINT "GroupVariantPrice_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupCategoryPrice" ADD CONSTRAINT "GroupCategoryPrice_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "UserGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupCategoryPrice" ADD CONSTRAINT "GroupCategoryPrice_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogGroupVisibility" ADD CONSTRAINT "CatalogGroupVisibility_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "UserGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed system groups
INSERT INTO "UserGroup" ("id", "name", "slug", "active", "isDefaultGuest", "isDefaultRegistered", "assignable", "allowCatalogDiscounts", "allowPromoCodes", "priceRounding", "createdAt", "updatedAt")
VALUES
  ('ug_default_guest', 'Гости', 'guests', true, true, false, false, true, true, 'NEAREST', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ug_default_registered', 'Розница (зарег.)', 'retail-registered', true, false, true, false, true, true, 'NEAREST', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
