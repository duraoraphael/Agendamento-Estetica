 
/**
 * Copia os dados de um banco SQLite para um PostgreSQL JÁ PREPARADO (migrações aplicadas).
 *
 *   npx tsx scripts/migrate-sqlite-to-postgres.ts --source file:./prisma/dev.db --target "postgresql://..." [--dry-run]
 *
 * Pré-requisitos (veja docs/publicacao.md): `npm run db:pg:generate` (gera .prisma-pg-client) e
 * `DATABASE_URL=<destino> npm run db:pg:deploy` (cria tabelas e restrições).
 *
 * Garantias:
 *  1. ANTES de gravar, procura problemas nos dados de origem (sobreposição, situação inválida, intervalo
 *     inválido, órfãos...). Se houver, imprime o relatório e PARA com código 2, sem tocar no destino.
 *  2. O destino precisa estar vazio (código 3 se não estiver).
 *  3. A cópia roda numa única transação: ou tudo, ou nada.
 *  4. Confere que os tokens do Google continuam legíveis com a TOKEN_ENCRYPTION_KEY atual (código 5 se não).
 *  5. Depois compara contagem e hash do conteúdo de cada tabela (IDs, vínculos, horários, preços, situação).
 *     Divergência => código 4 (e nada foi confirmado, pois a verificação roda dentro da transação).
 * Nunca altera a origem. Não copia RateLimit (contadores temporários).
 */
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { decryptSecret } from "../src/lib/crypto";
import { BLOCKING_KINDS, diffSnapshots, findDataIssues, snapshot, TABLES } from "./lib/data-checks";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** SQLite: caminho relativo em "file:" é relativo à pasta prisma/ (mesma regra do Prisma). */
function sqliteUrl(url: string): string {
  if (!url.startsWith("file:")) throw new Error("--source deve ser uma URL SQLite (file:...)");
  const p = url.slice("file:".length);
  return "file:" + (path.isAbsolute(p) ? p : path.resolve(process.cwd(), "prisma", p));
}

async function main() {
  const source = arg("source");
  const target = arg("target");
  const dryRun = process.argv.includes("--dry-run");
  if (!source || !target) {
    console.error("Uso: --source file:./prisma/dev.db --target postgresql://... [--dry-run]");
    process.exit(64);
  }

  const src: any = new PrismaClient({ datasourceUrl: sqliteUrl(source) });
  const pgDir = path.resolve(process.cwd(), process.env.PG_CLIENT_DIR ?? ".prisma-pg-client");
   
  const PgClient = require(pgDir).PrismaClient;
  const dst: any = new PgClient({ datasourceUrl: target });

  try {
    // 1) Checagem prévia da origem
    const issues = await findDataIssues(src);
    const blocking = issues.filter((i) => BLOCKING_KINDS.includes(i.kind));
    const report = { etapa: "checagem", problemasBloqueantes: blocking, informativos: issues.filter((i) => !BLOCKING_KINDS.includes(i.kind)) };
    if (blocking.length > 0) {
      console.error(JSON.stringify(report, null, 2));
      console.error(`\nMigração INTERROMPIDA: ${blocking.length} problema(s) nos dados de origem. Nada foi gravado no destino.`);
      console.error("Sanear primeiro (veja scripts/check-overlaps.ts) e rodar de novo.");
      process.exit(2);
    }

    const before = await snapshot(src);
    if (dryRun) {
      console.log(JSON.stringify({ ...report, origem: before, aviso: "dry-run: nada foi gravado" }, null, 2));
      return;
    }

    // 2) Destino preparado e vazio
    const constraint: any[] = await dst.$queryRaw`SELECT conname FROM pg_constraint WHERE conname = 'Appointment_no_overlap'`;
    if (constraint.length === 0) {
      console.error("O destino não tem a restrição Appointment_no_overlap. Rode `npm run db:pg:deploy` nele antes de migrar.");
      process.exit(3);
    }
    const existing = await snapshot(dst);
    const nonEmpty = TABLES.filter((t) => existing[t].count > 0);
    if (nonEmpty.length > 0) {
      console.error(`O destino não está vazio (${nonEmpty.join(", ")}). Migração interrompida.`);
      process.exit(3);
    }

    // 3) Cópia atômica + verificação dentro da transação
    let mismatch: string[] = [];
    await dst.$transaction(
      async (tx: any) => {
        const copy = async (table: string, rows: any[]) => {
          for (let i = 0; i < rows.length; i += 500) await tx[table].createMany({ data: rows.slice(i, i + 500) });
        };
        // Ordem respeita as chaves estrangeiras.
        await copy("user", await src.user.findMany());
        await copy("service", await src.service.findMany());
        await copy("businessHours", await src.businessHours.findMany());
        await copy("blockedPeriod", await src.blockedPeriod.findMany());
        await copy("appointment", await src.appointment.findMany());
        await copy("googleCalendarAccount", await src.googleCalendarAccount.findMany());
        const lock = await src.bookingLock.findUnique({ where: { id: 1 } });
        await tx.bookingLock.upsert({ where: { id: 1 }, create: { id: 1, version: lock?.version ?? 0 }, update: { version: lock?.version ?? 0 } });

        // Os tokens do Google são copiados criptografados: se a chave do ambiente de destino for outra, a
        // integração ficaria inutilizável (e, falhando fechada, bloquearia as reservas). Confere antes de confirmar.
        for (const acc of await src.googleCalendarAccount.findMany()) {
          try {
            decryptSecret(acc.accessToken);
            decryptSecret(acc.refreshToken);
          } catch {
            throw new Error("TOKENS_ILEGIVEIS");
          }
        }

        mismatch = diffSnapshots(before, await snapshot(tx));
        if (mismatch.length > 0) throw new Error("VERIFICACAO_FALHOU");
      },
      { timeout: 600_000, maxWait: 60_000 }
    );

    console.log(JSON.stringify({ ok: true, ...report, tabelasCopiadas: before }, null, 2));
  } catch (err) {
    if (err instanceof Error && err.message === "VERIFICACAO_FALHOU") {
      console.error("Verificação falhou; a transação foi desfeita (nada foi gravado).");
      process.exit(4);
    }
    if (err instanceof Error && err.message === "TOKENS_ILEGIVEIS") {
      console.error("Os tokens do Google Agenda não podem ser lidos com a TOKEN_ENCRYPTION_KEY atual. Use a MESMA chave do ambiente de origem (ou reconecte o Google depois). Nada foi gravado.");
      process.exit(5);
    }
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    await src.$disconnect();
    await dst.$disconnect();
  }
}

main();
