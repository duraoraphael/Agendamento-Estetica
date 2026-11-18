import type { PrismaClient } from "@prisma/client";
import { DEFAULT_SERVICES, LEGACY_DEMO_SERVICE_NAMES, LEGACY_SITE_DEFAULTS } from "./service-catalog";

/**
 * Migração dos dados de demonstração do sistema antigo (manicure) para a Garage Zero Zero. IDEMPOTENTE: rodar de novo não
 * muda mais nada. Regras (e o que NUNCA faz):
 *
 *  1. DESATIVA (active = false) apenas os serviços cujo nome é EXATAMENTE um dos 5 do seed antigo. Nada é apagado, então
 *     as reservas históricas continuam apontando para o serviço e mostrando o nome e o preço gravados nelas.
 *     Serviços com qualquer outro nome (personalizados) não são tocados. Se a administração mudou o PREÇO de um serviço
 *     antigo mas manteve o nome, ele também é desativado (decisão confirmada pela proprietária).
 *  2. CADASTRA os 7 serviços automotivos padrão que ainda NÃO existem (comparação pelo nome exato, ativo ou não). Um serviço
 *     já existente com esse nome nunca é reativado, renomeado nem tem o preço alterado.
 *  3. Nas Configurações do site (`SiteSettings`), troca por vazio (= usar o padrão novo) só os campos nome, slogan e
 *     apresentação que ainda estão IDÊNTICOS aos textos padrão antigos. Contatos, endereço, Instagram e logo ficam como estão.
 *  4. NÃO altera nenhum agendamento.
 */
export interface ServiceMigrationReport {
  dryRun: boolean;
  deactivated: string[];
  created: string[];
  settingsFieldsReset: string[];
}

export async function migrateManicureServices(db: PrismaClient, opts: { dryRun?: boolean } = {}): Promise<ServiceMigrationReport> {
  const dryRun = Boolean(opts.dryRun);

  const run = async (tx: Pick<PrismaClient, "service" | "siteSettings">): Promise<ServiceMigrationReport> => {
    const legacyActive = await tx.service.findMany({ where: { name: { in: [...LEGACY_DEMO_SERVICE_NAMES] }, active: true }, select: { id: true, name: true } });

    const existingNames = new Set((await tx.service.findMany({ select: { name: true } })).map((s) => s.name));
    const missing = DEFAULT_SERVICES.filter((s) => !existingNames.has(s.name));

    const settings = await tx.siteSettings.findUnique({ where: { id: 1 } });
    const resetData: Record<string, string> = {};
    if (settings) {
      for (const field of ["siteName", "tagline", "intro"] as const) {
        if (settings[field] === LEGACY_SITE_DEFAULTS[field]) resetData[field] = "";
      }
    }

    if (!dryRun) {
      if (legacyActive.length > 0) await tx.service.updateMany({ where: { id: { in: legacyActive.map((s) => s.id) } }, data: { active: false } });
      if (missing.length > 0) {
        await tx.service.createMany({ data: missing.map((s) => ({ name: s.name, priceCents: s.priceCents, durationMinutes: s.durationMinutes, active: true })) });
      }
      if (Object.keys(resetData).length > 0) await tx.siteSettings.update({ where: { id: 1 }, data: resetData });
    }

    return { dryRun, deactivated: legacyActive.map((s) => s.name), created: missing.map((s) => s.name), settingsFieldsReset: Object.keys(resetData) };
  };

  // Tudo ou nada: se algo falhar no meio, nada fica pela metade.
  return dryRun ? run(db) : db.$transaction((tx) => run(tx));
}
