ALTER TABLE "Studio" ADD COLUMN "coachingFeatures" JSONB;
ALTER TABLE "ClassSession" ADD COLUMN "activeBlockId" TEXT;
ALTER TABLE "ClassSession" ADD COLUMN "controlSequence" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Metric" ADD COLUMN "measurement" JSONB;
ALTER TABLE "WorkoutSet" ADD COLUMN "measurement" JSONB;
CREATE TABLE "CustomExercise" (
  "id" TEXT NOT NULL PRIMARY KEY, "studioId" TEXT NOT NULL, "createdById" TEXT NOT NULL,
  "name" TEXT NOT NULL, "equipment" TEXT NOT NULL, "instructions" TEXT NOT NULL,
  "targetUnit" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomExercise_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "CustomExercise_studioId_idx" ON "CustomExercise"("studioId");
CREATE TABLE "WorkoutCorrection" (
  "id" TEXT NOT NULL PRIMARY KEY, "setId" TEXT NOT NULL, "actorId" TEXT NOT NULL,
  "reps" INTEGER NOT NULL, "holdMs" INTEGER NOT NULL, "reason" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkoutCorrection_setId_fkey" FOREIGN KEY ("setId") REFERENCES "WorkoutSet" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "WorkoutCorrection_setId_createdAt_idx" ON "WorkoutCorrection"("setId", "createdAt");
