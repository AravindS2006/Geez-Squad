-- AlterTable
ALTER TABLE "Studio" ADD COLUMN     "address" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "hours" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "phone" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "StudioMember" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "goal" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'active',
    "joinedOn" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudioMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MembershipOffer" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "durationDays" INTEGER NOT NULL,
    "pricePaise" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "MembershipOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberTerm" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "planName" TEXT NOT NULL,
    "feePaise" INTEGER NOT NULL,
    "startsOn" TEXT NOT NULL,
    "endsOn" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberTerm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudioPayment" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "paidOn" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudioPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudioAttendance" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudioAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudioEnquiry" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "interest" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'new',
    "followUpOn" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "StudioEnquiry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudioStaff" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "role" TEXT NOT NULL,
    "specialty" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'active',

    CONSTRAINT "StudioStaff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StudioMember_studioId_status_idx" ON "StudioMember"("studioId", "status");

-- CreateIndex
CREATE INDEX "MembershipOffer_studioId_idx" ON "MembershipOffer"("studioId");

-- CreateIndex
CREATE INDEX "MemberTerm_studioId_endsOn_idx" ON "MemberTerm"("studioId", "endsOn");

-- CreateIndex
CREATE INDEX "MemberTerm_memberId_idx" ON "MemberTerm"("memberId");

-- CreateIndex
CREATE INDEX "StudioPayment_studioId_paidOn_idx" ON "StudioPayment"("studioId", "paidOn");

-- CreateIndex
CREATE INDEX "StudioAttendance_studioId_date_idx" ON "StudioAttendance"("studioId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "StudioAttendance_memberId_date_key" ON "StudioAttendance"("memberId", "date");

-- CreateIndex
CREATE INDEX "StudioEnquiry_studioId_followUpOn_idx" ON "StudioEnquiry"("studioId", "followUpOn");

-- CreateIndex
CREATE INDEX "StudioStaff_studioId_idx" ON "StudioStaff"("studioId");

-- AddForeignKey
ALTER TABLE "StudioMember" ADD CONSTRAINT "StudioMember_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipOffer" ADD CONSTRAINT "MembershipOffer_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberTerm" ADD CONSTRAINT "MemberTerm_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberTerm" ADD CONSTRAINT "MemberTerm_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "StudioMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberTerm" ADD CONSTRAINT "MemberTerm_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "MembershipOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudioPayment" ADD CONSTRAINT "StudioPayment_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudioPayment" ADD CONSTRAINT "StudioPayment_termId_fkey" FOREIGN KEY ("termId") REFERENCES "MemberTerm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudioAttendance" ADD CONSTRAINT "StudioAttendance_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudioAttendance" ADD CONSTRAINT "StudioAttendance_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "StudioMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudioEnquiry" ADD CONSTRAINT "StudioEnquiry_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudioStaff" ADD CONSTRAINT "StudioStaff_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;
