// Processo filho: tenta criar UMA reserva e imprime o resultado em JSON. Usado para provar a
// garantia entre PROCESSOS Node independentes (cada um com seu próprio pool de conexões).
import { createBooking } from "../helpers";
import { prisma } from "@/lib/db";

async function main() {
  const [clientId, serviceId, startAtIso] = process.argv.slice(2);
  try {
    const a = await createBooking({ clientId, serviceId, startAt: new Date(startAtIso) });
    console.log("RESULT " + JSON.stringify({ ok: true, id: a.id }));
  } catch (err) {
    console.log("RESULT " + JSON.stringify({ ok: false, error: err instanceof Error ? err.constructor.name : "?" }));
  } finally {
    await prisma.$disconnect();
  }
}
main();
