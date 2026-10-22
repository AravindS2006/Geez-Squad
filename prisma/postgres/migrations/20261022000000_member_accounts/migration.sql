ALTER TABLE "StudioMember" ADD COLUMN "userId" TEXT REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE UNIQUE INDEX "StudioMember_studioId_userId_key" ON "StudioMember"("studioId", "userId");
CREATE TABLE "StudioJoinRequest" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "memberId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudioJoinRequest_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "StudioMember"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "StudioJoinRequest_memberId_key" ON "StudioJoinRequest"("memberId");
CREATE INDEX "StudioJoinRequest_email_status_idx" ON "StudioJoinRequest"("email", "status");
