CREATE TABLE "NutritionProfile" (
  "userId" TEXT NOT NULL PRIMARY KEY,
  "shareWithCoach" BOOLEAN NOT NULL DEFAULT false,
  "calories" INTEGER,
  "protein" REAL,
  "waterMl" INTEGER,
  "preferences" TEXT NOT NULL DEFAULT '',
  "guidance" TEXT NOT NULL DEFAULT '',
  "updatedById" TEXT NOT NULL,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "NutritionProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "NutritionEntry" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "date" TEXT NOT NULL,
  "meal" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "calories" INTEGER,
  "protein" REAL,
  "carbs" REAL,
  "fat" REAL,
  "waterMl" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NutritionEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "NutritionEntry_userId_date_idx" ON "NutritionEntry"("userId", "date");
