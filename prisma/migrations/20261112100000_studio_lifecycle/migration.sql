-- CreateTable
CREATE TABLE "StudioRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "studioId" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StudioRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- AlterTable
ALTER TABLE "Studio" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "Studio" ADD COLUMN "closedAt" DATETIME;
ALTER TABLE "Studio" ADD COLUMN "closedById" TEXT;

-- CreateIndex
CREATE INDEX "StudioRequest_status_createdAt_idx" ON "StudioRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "StudioRequest_userId_status_idx" ON "StudioRequest"("userId", "status");

