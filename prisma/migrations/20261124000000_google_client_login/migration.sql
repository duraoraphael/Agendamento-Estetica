ALTER TABLE "User"
    ADD COLUMN "googleSubject" TEXT,
    ALTER COLUMN "passwordHash" DROP NOT NULL;

CREATE UNIQUE INDEX "User_googleSubject_key" ON "User"("googleSubject");
