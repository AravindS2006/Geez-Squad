-- CreateTable
CREATE TABLE "StudioClass" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "trainer" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "duration" INTEGER NOT NULL,
    "capacity" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'scheduled',

    CONSTRAINT "StudioClass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudioBooking" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'booked',

    CONSTRAINT "StudioBooking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StudioClass_studioId_startsAt_idx" ON "StudioClass"("studioId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "StudioBooking_classId_memberId_key" ON "StudioBooking"("classId", "memberId");

-- AddForeignKey
ALTER TABLE "StudioClass" ADD CONSTRAINT "StudioClass_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudioBooking" ADD CONSTRAINT "StudioBooking_classId_fkey" FOREIGN KEY ("classId") REFERENCES "StudioClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudioBooking" ADD CONSTRAINT "StudioBooking_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "StudioMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
