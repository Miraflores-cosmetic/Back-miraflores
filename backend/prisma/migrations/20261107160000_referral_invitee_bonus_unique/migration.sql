-- Lifetime invitee bonus: один PENDING|POSTED на userId (race двух PAID).
CREATE UNIQUE INDEX IF NOT EXISTS "ReferralWalletLedger_invitee_bonus_userId_key"
  ON "ReferralWalletLedger"("userId")
  WHERE kind = 'INVITEE_BONUS' AND status IN ('PENDING', 'POSTED');
