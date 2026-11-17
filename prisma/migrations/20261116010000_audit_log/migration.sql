-- Trilha de auditoria da página /admin/logs.
-- Só o servidor grava. Não guarda segredos nem dados pessoais (veja o comentário do modelo em prisma/schema.prisma).

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "actorId" TEXT,
    "subjectHash" TEXT,
    "targetType" TEXT,
    "targetId" TEXT,
    "detail" TEXT,
    "count" INTEGER NOT NULL DEFAULT 1,
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AuditLog_dedupeKey_key" ON "AuditLog"("dedupeKey");

-- CreateIndex
CREATE INDEX "AuditLog_category_occurredAt_idx" ON "AuditLog"("category", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditLog_occurredAt_idx" ON "AuditLog"("occurredAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_occurredAt_idx" ON "AuditLog"("actorId", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditLog_subjectHash_idx" ON "AuditLog"("subjectHash");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- Valores válidos no próprio banco (mesma convenção das demais tabelas) e limites de tamanho dos textos.
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_valid_category"
  CHECK ("category" IN ('CADASTRO', 'LOGIN', 'LOGOUT', 'MARCACAO', 'ADMIN', 'INTEGRACAO'));
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_valid_result"
  CHECK ("result" IN ('SUCESSO', 'FALHA', 'BLOQUEADO'));
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_valid_count" CHECK ("count" >= 1);
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_valid_sizes"
  CHECK (char_length("action") <= 64 AND char_length(coalesce("detail", '')) <= 200 AND char_length(coalesce("targetId", '')) <= 64);

-- RLS: o Supabase expõe o schema "public" pela API REST com a chave "anon" pública. Sem política, ninguém além do
-- dono (a aplicação, via Prisma) lê ou grava. NUNCA use FORCE ROW LEVEL SECURITY (derruba o app). Veja CLAUDE.md.
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
