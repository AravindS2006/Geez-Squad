-- AlterTable
ALTER TABLE "Studio" ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "closedById" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'active';

-- CreateTable
CREATE TABLE "StudioRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "studioId" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudioRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StudioRequest_status_createdAt_idx" ON "StudioRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "StudioRequest_userId_status_idx" ON "StudioRequest"("userId", "status");

-- AddForeignKey
ALTER TABLE "StudioRequest" ADD CONSTRAINT "StudioRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

