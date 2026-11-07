-- Сумма списания реф. кошелька на заказе (XOR с promo/gift).
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "referralWalletAmount" INTEGER NOT NULL DEFAULT 0;
