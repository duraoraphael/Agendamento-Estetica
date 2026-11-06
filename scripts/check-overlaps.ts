/**
 * Relatório SOMENTE LEITURA de saneamento: sobreposições entre reservas ativas, situações inválidas,
 * intervalos inválidos, registros órfãos e clientes acima do limite de reservas futuras.
 * NÃO altera nada no banco.
 *
 * Uso:  npm run db:check-overlaps          (usa DATABASE_URL do .env)
 *
 * Saneamento sugerido (preserva o histórico — nada é apagado):
 *  - Sobreposição: mantenha a reserva criada primeiro e fale com a cliente da outra para reagendar;
 *    no painel (Agendamentos) mude a(s) outra(s) para "Cancelada". Ela segue no histórico e o horário é liberado.
 *  - Situação inválida: corrija pelo painel para uma situação válida (ex.: Cancelada ou Concluída).
 *  - Acima do limite: apenas informativo; o limite vale para NOVAS reservas.
 * Rode de novo até aparecer "Nenhum problema".
 */
import { PrismaClient } from "@prisma/client";
import { getBookingPolicy } from "../src/lib/policy";
import { findDataIssues } from "./lib/data-checks";

const prisma = new PrismaClient();

async function main() {
  const issues = await findDataIssues(prisma, { maxActiveFuture: getBookingPolicy().maxActiveFutureBookings });
  if (issues.length === 0) {
    console.log("Nenhum problema encontrado nos dados.");
    return;
  }
  console.log(`${issues.length} ponto(s) para revisão:\n`);
  for (const [i, issue] of issues.entries()) {
    console.log(`${i + 1}. [${issue.kind}] ${issue.message}`);
    for (const id of issue.ids) console.log(`     - ${id}`);
  }
  console.log("\nVeja o passo a passo no cabeçalho de scripts/check-overlaps.ts.");
  process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 2;
  })
  .finally(() => prisma.$disconnect());
