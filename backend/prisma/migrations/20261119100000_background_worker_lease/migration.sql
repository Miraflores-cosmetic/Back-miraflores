-- Lease строка для фоновых воркеров (без session advisory lock через пул).
CREATE TABLE "BackgroundWorkerLease" (
    "key" TEXT NOT NULL,
    "holder" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackgroundWorkerLease_pkey" PRIMARY KEY ("key")
);

INSERT INTO "BackgroundWorkerLease" ("key", "holder", "expiresAt", "updatedAt")
VALUES ('cdek_sync', '', TIMESTAMP '1970-01-01 00:00:00', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;