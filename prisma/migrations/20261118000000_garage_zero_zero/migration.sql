-- Garage Zero Zero: veículos, snapshots do veículo e observações no agendamento, recuperação de senha e versão de sessão.
-- MIGRAÇÃO SOMENTE ADITIVA: nada é apagado nem reescrito. Reservas antigas continuam válidas (vehicleId e snapshots nulos).

-- AlterTable: versão da sessão (sobe a cada troca/redefinição de senha; invalida JWTs antigos).
ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "plate" TEXT NOT NULL,
    "year" INTEGER,
    "color" TEXT,
    "nickname" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- AlterTable: veículo, cópia dos dados do veículo e observações (todas opcionais, por causa do histórico).
ALTER TABLE "Appointment" ADD COLUMN "vehicleId" TEXT,
ADD COLUMN "vehicleBrandSnapshot" TEXT,
ADD COLUMN "vehicleModelSnapshot" TEXT,
ADD COLUMN "vehiclePlateSnapshot" TEXT,
ADD COLUMN "notes" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_userId_plate_key" ON "Vehicle"("userId", "plate");

-- CreateIndex
CREATE INDEX "Vehicle_userId_idx" ON "Vehicle"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");

-- CreateIndex
CREATE INDEX "Appointment_vehicleId_idx" ON "Appointment"("vehicleId");

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Restrições que o Prisma não modela (mesma convenção das demais migrações): formato da placa (antigo AAA9999 e
-- Mercosul AAA9A99, já normalizada), faixas e tamanhos. O servidor valida com Zod; o banco é a segunda barreira.
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_valid_plate" CHECK ("plate" ~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$');
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_valid_year" CHECK ("year" IS NULL OR ("year" >= 1900 AND "year" <= 2100));
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_valid_sizes" CHECK (
  char_length("brand") BETWEEN 1 AND 40 AND char_length("model") BETWEEN 1 AND 60
  AND char_length(coalesce("color", '')) <= 30 AND char_length(coalesce("nickname", '')) <= 40
);
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_valid_vehicle_snapshot" CHECK (
  char_length(coalesce("notes", '')) <= 500
  AND char_length(coalesce("vehicleBrandSnapshot", '')) <= 40
  AND char_length(coalesce("vehicleModelSnapshot", '')) <= 60
  AND ("vehiclePlateSnapshot" IS NULL OR "vehiclePlateSnapshot" ~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$')
);
-- O hash do token é um SHA-256 em hexadecimal (64 caracteres): nunca o token em si.
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_valid_hash" CHECK (char_length("tokenHash") = 64);

-- RLS: o Supabase expõe o schema "public" pela API REST com a chave "anon" pública. Sem política, ninguém além do
-- dono (a aplicação, via Prisma) lê ou grava. NUNCA use FORCE ROW LEVEL SECURITY (derruba o app). Veja CLAUDE.md.
ALTER TABLE "Vehicle" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PasswordResetToken" ENABLE ROW LEVEL SECURITY;
