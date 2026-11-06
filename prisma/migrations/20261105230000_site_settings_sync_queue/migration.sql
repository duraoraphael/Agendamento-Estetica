-- CreateTable
CREATE TABLE "SiteSettings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "siteName" TEXT NOT NULL DEFAULT '',
    "tagline" TEXT NOT NULL DEFAULT '',
    "intro" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "whatsapp" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "locationNotes" TEXT NOT NULL DEFAULT '',
    "instagramUrl" TEXT NOT NULL DEFAULT '',
    "logoVersion" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SiteLogo" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "contentType" TEXT NOT NULL,
    "data" BLOB NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Appointment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "serviceName" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "startAt" DATETIME NOT NULL,
    "endAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CONFIRMADA',
    "googleEventId" TEXT,
    "googleSyncStatus" TEXT NOT NULL DEFAULT 'NAO_CONECTADO',
    "googleSyncError" TEXT,
    "googleSyncAttempts" INTEGER NOT NULL DEFAULT 0,
    "googleSyncNextAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Appointment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Appointment_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Appointment" ("clientId", "createdAt", "durationMinutes", "endAt", "googleEventId", "googleSyncError", "googleSyncStatus", "id", "priceCents", "serviceId", "serviceName", "startAt", "status", "updatedAt") SELECT "clientId", "createdAt", "durationMinutes", "endAt", "googleEventId", "googleSyncError", "googleSyncStatus", "id", "priceCents", "serviceId", "serviceName", "startAt", "status", "updatedAt" FROM "Appointment";
DROP TABLE "Appointment";
ALTER TABLE "new_Appointment" RENAME TO "Appointment";
CREATE INDEX "Appointment_startAt_idx" ON "Appointment"("startAt");
CREATE INDEX "Appointment_status_idx" ON "Appointment"("status");
CREATE INDEX "Appointment_clientId_idx" ON "Appointment"("clientId");
CREATE INDEX "Appointment_startAt_status_idx" ON "Appointment"("startAt", "status");
CREATE INDEX "Appointment_createdAt_idx" ON "Appointment"("createdAt");
CREATE INDEX "Appointment_googleSyncStatus_googleSyncNextAt_idx" ON "Appointment"("googleSyncStatus", "googleSyncNextAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

