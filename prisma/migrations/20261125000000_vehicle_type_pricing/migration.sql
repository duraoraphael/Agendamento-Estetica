-- Preço por tipo de veículo.
-- MIGRAÇÃO SOMENTE ADITIVA: nenhuma reserva, veículo ou serviço é alterado ou apagado. Veículos e reservas existentes
-- ficam com tipo nulo; a chave nasce desligada (todos continuam pagando o preço padrão do serviço).

-- AlterTable
ALTER TABLE "SiteSettings" ADD COLUMN "priceByVehicleType" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN "vehicleType" TEXT;

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN "vehicleTypeSnapshot" TEXT;

-- CreateTable
CREATE TABLE "ServicePrice" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "vehicleType" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,

    CONSTRAINT "ServicePrice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServicePrice_serviceId_vehicleType_key" ON "ServicePrice"("serviceId", "vehicleType");

-- AddForeignKey
ALTER TABLE "ServicePrice" ADD CONSTRAINT "ServicePrice_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Restrições que o Prisma não modela (segunda barreira, além do Zod no servidor): categorias válidas (src/lib/pricing.ts)
-- e preço entre R$ 0,00 e R$ 5.000,00 (o mesmo teto do preço do serviço, LIMITS.priceCentsMax em src/lib/limits.ts).
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_valid_type" CHECK ("vehicleType" IS NULL OR "vehicleType" IN ('HATCH', 'SEDA', 'SUV', 'PICAPE', 'VAN'));
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_valid_vehicle_type" CHECK ("vehicleTypeSnapshot" IS NULL OR "vehicleTypeSnapshot" IN ('HATCH', 'SEDA', 'SUV', 'PICAPE', 'VAN'));
ALTER TABLE "ServicePrice" ADD CONSTRAINT "ServicePrice_valid_type" CHECK ("vehicleType" IN ('HATCH', 'SEDA', 'SUV', 'PICAPE', 'VAN'));
ALTER TABLE "ServicePrice" ADD CONSTRAINT "ServicePrice_valid_price" CHECK ("priceCents" >= 0 AND "priceCents" <= 500000);

-- Supabase expõe o schema public por API REST com a chave anon pública: sem RLS qualquer pessoa leria a tabela.
-- (Sem políticas: só a aplicação, dona das tabelas, lê e grava. Nunca FORCE ROW LEVEL SECURITY.)
ALTER TABLE "ServicePrice" ENABLE ROW LEVEL SECURITY;
