-- Preserve chat history when user is deleted; snapshot author label at post time.
ALTER TABLE "ChatMessage" ADD COLUMN "authorLabelSnapshot" TEXT NOT NULL DEFAULT '';

ALTER TABLE "ChatMessage" DROP CONSTRAINT "ChatMessage_authorUserId_fkey";

ALTER TABLE "ChatMessage" ALTER COLUMN "authorUserId" DROP NOT NULL;

UPDATE "ChatMessage" m
SET "authorLabelSnapshot" = COALESCE(
  NULLIF(TRIM(u."staffDisplayName"), ''),
  NULLIF(TRIM(u."displayName"), ''),
  NULLIF(TRIM(u."email"), ''),
  CASE WHEN m."authorRole" = 'STAFF' THEN 'Miraflores' ELSE 'Покупатель' END
)
FROM "User" u
WHERE u."id" = m."authorUserId";

ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_authorUserId_fkey"
  FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
