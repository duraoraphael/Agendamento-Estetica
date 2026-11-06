-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'CLIENTE',
    "notificationsSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Service" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BusinessHours" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dayOfWeek" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "breakStart" TEXT,
    "breakEnd" TEXT
);

-- CreateTable
CREATE TABLE "BlockedPeriod" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "startAt" DATETIME NOT NULL,
    "endAt" DATETIME NOT NULL,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Appointment" (
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Appointment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Appointment_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BookingLock" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "GoogleCalendarAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "adminUserId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiryDate" DATETIME NOT NULL,
    "calendarId" TEXT NOT NULL DEFAULT 'primary',
    "connectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncError" TEXT,
    CONSTRAINT "GoogleCalendarAccount_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessHours_dayOfWeek_key" ON "BusinessHours"("dayOfWeek");

-- CreateIndex
CREATE INDEX "BlockedPeriod_startAt_endAt_idx" ON "BlockedPeriod"("startAt", "endAt");

-- CreateIndex
CREATE INDEX "Appointment_startAt_idx" ON "Appointment"("startAt");

-- CreateIndex
CREATE INDEX "Appointment_status_idx" ON "Appointment"("status");

-- CreateIndex
CREATE INDEX "Appointment_clientId_idx" ON "Appointment"("clientId");

-- CreateIndex
CREATE INDEX "Appointment_startAt_status_idx" ON "Appointment"("startAt", "status");

-- CreateIndex
CREATE UNIQUE INDEX "GoogleCalendarAccount_adminUserId_key" ON "GoogleCalendarAccount"("adminUserId");
