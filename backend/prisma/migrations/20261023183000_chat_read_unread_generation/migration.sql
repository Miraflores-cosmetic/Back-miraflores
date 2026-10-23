-- CAS для /read vs /unread: поздний /read не перетирает sticky unread.
ALTER TABLE "ChatReadState"
  ADD COLUMN IF NOT EXISTS "unreadGeneration" INTEGER NOT NULL DEFAULT 0;
