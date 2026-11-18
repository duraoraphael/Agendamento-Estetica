import { PrismaClient } from "@prisma/client";
import { AdminProvisioningError, provisionAdmin } from "./provision-admin";
import { DEFAULT_SERVICES } from "../src/lib/service-catalog";

const prisma = new PrismaClient();

async function main() {
  // Linha de lock usada pelas transações de reserva (veja src/lib/booking.ts).
  await prisma.bookingLock.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, version: 0 },
  });

  // Primeira conta administrativa, a partir das variáveis de ambiente. Nunca promove nem altera uma conta
  // existente (regras em prisma/provision-admin.ts); se o e-mail já for de uma cliente, o seed é interrompido.
  const admin = await provisionAdmin(prisma, process.env);
  if (admin.status === "created") console.log(`Conta administrativa criada: ${admin.email}`);
  else if (admin.status === "existing") console.log(`Conta administrativa já existia (papel e senha preservados): ${admin.email}`);

  // Expediente padrão: terça a sábado, 09:00-18:00, almoço 12:00-13:00.
  // A administradora pode ajustar tudo isso depois em /admin/horarios.
  const defaultHours: Array<{
    dayOfWeek: number;
    active: boolean;
    startTime: string;
    endTime: string;
    breakStart?: string | null;
    breakEnd?: string | null;
  }> = [
    { dayOfWeek: 0, active: false, startTime: "09:00", endTime: "18:00" }, // domingo
    { dayOfWeek: 1, active: false, startTime: "09:00", endTime: "18:00" }, // segunda
    { dayOfWeek: 2, active: true, startTime: "09:00", endTime: "18:00", breakStart: "12:00", breakEnd: "13:00" },
    { dayOfWeek: 3, active: true, startTime: "09:00", endTime: "18:00", breakStart: "12:00", breakEnd: "13:00" },
    { dayOfWeek: 4, active: true, startTime: "09:00", endTime: "18:00", breakStart: "12:00", breakEnd: "13:00" },
    { dayOfWeek: 5, active: true, startTime: "09:00", endTime: "18:00", breakStart: "12:00", breakEnd: "13:00" },
    { dayOfWeek: 6, active: true, startTime: "09:00", endTime: "13:00" }, // sábado
  ];

  for (const hours of defaultHours) {
    await prisma.businessHours.upsert({
      where: { dayOfWeek: hours.dayOfWeek },
      update: {},
      create: hours,
    });
  }

  // Serviços automotivos padrão (só os que ainda não existem, pelo nome exato; nunca altera preço ou estado de um serviço
  // existente). Em bancos que ainda têm os serviços de demonstração da manicure, use também `npm run db:migrate-services`.
  const existing = new Set((await prisma.service.findMany({ select: { name: true } })).map((s) => s.name));
  const missing = DEFAULT_SERVICES.filter((s) => !existing.has(s.name));
  if (missing.length > 0) {
    await prisma.service.createMany({ data: missing.map((s) => ({ name: s.name, priceCents: s.priceCents, durationMinutes: s.durationMinutes })) });
    console.log(`Serviços padrão criados: ${missing.map((s) => s.name).join(", ")}.`);
  }
}

main()
  .catch((err) => {
    // Conflito com o e-mail do administrador: mensagem curta e clara, sem pilha de chamadas.
    if (err instanceof AdminProvisioningError) console.error(`\nSeed interrompido: ${err.message}`);
    else console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
