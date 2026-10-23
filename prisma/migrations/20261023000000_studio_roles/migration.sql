-- AlterTable
ALTER TABLE "StudioJoinRequest" ADD COLUMN "targetUserId" TEXT;

-- AlterTable
ALTER TABLE "StudioClass" ADD COLUMN "hostId" TEXT;

-- AlterTable
ALTER TABLE "WorkoutPlan" ADD COLUMN "createdById" TEXT;

-- AlterTable
ALTER TABLE "ClassSession" ADD COLUMN "hostId" TEXT;

-- CreateTable
CREATE TABLE "StudioRoleGrant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studioId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "grantedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StudioRoleGrant_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StudioRoleGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PrimaryCoachAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "memberId" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "assignedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "PrimaryCoachAssignment_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "StudioMember" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PrimaryCoachAssignment_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CoachAssignmentHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "memberId" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "assignedAt" DATETIME NOT NULL,
    "endedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "StudioTeamRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studioId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'coach',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StudioTeamRequest_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "StudioRoleGrant_userId_status_idx" ON "StudioRoleGrant"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StudioRoleGrant_studioId_userId_role_key" ON "StudioRoleGrant"("studioId", "userId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "PrimaryCoachAssignment_memberId_key" ON "PrimaryCoachAssignment"("memberId");

-- CreateIndex
CREATE INDEX "PrimaryCoachAssignment_coachId_idx" ON "PrimaryCoachAssignment"("coachId");

-- CreateIndex
CREATE INDEX "CoachAssignmentHistory_studioId_memberId_idx" ON "CoachAssignmentHistory"("studioId", "memberId");

-- CreateIndex
CREATE INDEX "StudioTeamRequest_email_status_idx" ON "StudioTeamRequest"("email", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StudioTeamRequest_studioId_email_role_key" ON "StudioTeamRequest"("studioId", "email", "role");


-- Preserve legacy ownership and accepted membership. Directory entries grant no access.
INSERT INTO "StudioRoleGrant" ("id", "studioId", "userId", "role", "status", "updatedAt")
SELECT 'legacy-admin-' || "id", "id", "ownerId", 'admin', 'active', CURRENT_TIMESTAMP FROM "Studio";
INSERT INTO "StudioRoleGrant" ("id", "studioId", "userId", "role", "status", "grantedAt", "updatedAt")
SELECT 'legacy-trainee-' || "id", "studioId", "userId", 'trainee', 'active', "createdAt", CURRENT_TIMESTAMP FROM "Membership";
UPDATE "ClassSession" SET "hostId" = (SELECT "ownerId" FROM "Studio" WHERE "Studio"."id" = "ClassSession"."studioId") WHERE "hostId" IS NULL;
UPDATE "StudioClass" SET "hostId" = (SELECT "ownerId" FROM "Studio" WHERE "Studio"."id" = "StudioClass"."studioId") WHERE "hostId" IS NULL;
UPDATE "WorkoutPlan" SET "createdById" = (SELECT "ownerId" FROM "Studio" WHERE "Studio"."id" = "WorkoutPlan"."studioId") WHERE "createdById" IS NULL;
