-- AlterTable
ALTER TABLE "PromoCode" ADD COLUMN "scope" "DiscountScope";

-- CreateTable
CREATE TABLE "PromoCodeCategory" (
    "promoCodeId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,

    CONSTRAINT "PromoCodeCategory_pkey" PRIMARY KEY ("promoCodeId","categoryId")
);

-- CreateTable
CREATE TABLE "PromoCodeProduct" (
    "promoCodeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,

    CONSTRAINT "PromoCodeProduct_pkey" PRIMARY KEY ("promoCodeId","productId")
);

-- CreateIndex
CREATE INDEX "PromoCodeCategory_categoryId_idx" ON "PromoCodeCategory"("categoryId");

-- CreateIndex
CREATE INDEX "PromoCodeProduct_productId_idx" ON "PromoCodeProduct"("productId");

-- AddForeignKey
ALTER TABLE "PromoCodeCategory" ADD CONSTRAINT "PromoCodeCategory_promoCodeId_fkey" FOREIGN KEY ("promoCodeId") REFERENCES "PromoCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoCodeCategory" ADD CONSTRAINT "PromoCodeCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoCodeProduct" ADD CONSTRAINT "PromoCodeProduct_promoCodeId_fkey" FOREIGN KEY ("promoCodeId") REFERENCES "PromoCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoCodeProduct" ADD CONSTRAINT "PromoCodeProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
