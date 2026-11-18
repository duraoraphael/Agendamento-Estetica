-- Fotos dos serviços (metadados; os arquivos ficam no Supabase Storage, bucket público `service-images`).
-- MIGRAÇÃO SOMENTE ADITIVA: nenhum serviço nem agendamento é alterado ou apagado.

-- CreateTable
CREATE TABLE "ServiceImage" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "objectPath" TEXT NOT NULL,
    "altText" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "contentType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorageCleanup" (
    "id" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "objectPath" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StorageCleanup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceImage_objectPath_key" ON "ServiceImage"("objectPath");

-- CreateIndex
CREATE INDEX "ServiceImage_serviceId_position_idx" ON "ServiceImage"("serviceId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "StorageCleanup_objectPath_key" ON "StorageCleanup"("objectPath");

-- AddForeignKey
ALTER TABLE "ServiceImage" ADD CONSTRAINT "ServiceImage_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Restrições que o Prisma não modela (segunda barreira, além do Zod no servidor): posição, dimensões, tamanho, tipo,
-- caminho no formato services/{serviceId}/{uuid}.webp (sem "..", sem barras extras) e texto alternativo curto.
ALTER TABLE "ServiceImage" ADD CONSTRAINT "ServiceImage_valid_position" CHECK ("position" >= 0 AND "position" < 6);
ALTER TABLE "ServiceImage" ADD CONSTRAINT "ServiceImage_valid_dimensions" CHECK ("width" BETWEEN 1 AND 1600 AND "height" BETWEEN 1 AND 1600);
ALTER TABLE "ServiceImage" ADD CONSTRAINT "ServiceImage_valid_size" CHECK ("sizeBytes" BETWEEN 1 AND 8388608);
ALTER TABLE "ServiceImage" ADD CONSTRAINT "ServiceImage_valid_type" CHECK ("contentType" = 'image/webp');
ALTER TABLE "ServiceImage" ADD CONSTRAINT "ServiceImage_valid_path" CHECK (
  "objectPath" ~ '^services/[A-Za-z0-9_-]+/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$'
);
ALTER TABLE "ServiceImage" ADD CONSTRAINT "ServiceImage_valid_alt" CHECK (char_length("altText") <= 160);
ALTER TABLE "StorageCleanup" ADD CONSTRAINT "StorageCleanup_valid_path" CHECK (char_length("objectPath") BETWEEN 1 AND 200);

-- RLS ligado em toda tabela nova: o Supabase expõe o schema public por API REST com a chave anon pública.
-- Sem política, a anon não lê nada; a aplicação (dono da tabela, via Prisma) continua lendo e gravando.
-- NUNCA use FORCE ROW LEVEL SECURITY (derruba o app). Veja CLAUDE.md.
ALTER TABLE "ServiceImage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StorageCleanup" ENABLE ROW LEVEL SECURITY;
