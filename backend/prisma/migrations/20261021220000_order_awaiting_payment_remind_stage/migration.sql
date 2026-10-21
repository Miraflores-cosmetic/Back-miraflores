-- AlterTable
ALTER TABLE "Order" ADD COLUMN "awaitingPaymentRemindStage" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Order_status_awaitingPaymentRemindStage_createdAt_idx" ON "Order"("status", "awaitingPaymentRemindStage", "createdAt");
