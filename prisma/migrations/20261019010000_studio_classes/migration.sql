-- CreateTable
CREATE TABLE "StudioClass" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studioId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "trainer" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "startsAt" DATETIME NOT NULL,
    "duration" INTEGER NOT NULL,
    "capacity" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    CONSTRAINT "StudioClass_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StudioBooking" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "classId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'booked',
    CONSTRAINT "StudioBooking_classId_fkey" FOREIGN KEY ("classId") REFERENCES "StudioClass" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StudioBooking_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "StudioMember" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "StudioClass_studioId_startsAt_idx" ON "StudioClass"("studioId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "StudioBooking_classId_memberId_key" ON "StudioBooking"("classId", "memberId");
