import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { passwordSchema } from "../src/lib/validation";

const prisma = new PrismaClient();

async function main() {
  // Linha de lock usada pelas transações de reserva (veja src/lib/booking.ts).
  await prisma.bookingLock.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, version: 0 },
  });

  // Primeira conta administrativa, criada a partir de variáveis de ambiente.
  // Esse é o único caminho para criar uma conta ADMIN: o cadastro público
  // sempre cria clientes (veja src/app/api/auth/cadastro/route.ts).
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD;
  const adminName = process.env.ADMIN_NAME?.trim() || "Administradora";
  const adminPhone = process.env.ADMIN_PHONE?.trim() || "(00) 00000-0000";

  if (!adminEmail || !adminPassword) {
    console.warn(
      "ADMIN_EMAIL/ADMIN_PASSWORD não definidos no .env — nenhuma conta administrativa foi criada. " +
        "Defina-os e rode `npm run db:seed` novamente."
    );
  } else if (/defina-|coloque-/i.test(adminPassword) || !passwordSchema.safeParse(adminPassword).success) {
    console.warn(
      "ADMIN_PASSWORD não atende à política de senha (8 a 72 bytes, nada de senha comum) — conta administrativa não criada."
    );
  } else {
    const passwordHash = await bcrypt.hash(adminPassword, 10);
    const admin = await prisma.user.upsert({
      where: { email: adminEmail },
      update: { role: "ADMIN" },
      create: {
        name: adminName,
        email: adminEmail,
        phone: adminPhone,
        passwordHash,
        role: "ADMIN",
      },
    });
    console.log(`Conta administrativa pronta: ${admin.email}`);
  }

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

  // Serviços de exemplo (apenas se ainda não houver nenhum).
  const serviceCount = await prisma.service.count();
  if (serviceCount === 0) {
    await prisma.service.createMany({
      data: [
        { name: "Manicure tradicional", priceCents: 4000, durationMinutes: 45 },
        { name: "Pedicure tradicional", priceCents: 4500, durationMinutes: 50 },
        { name: "Manicure + Pedicure", priceCents: 8000, durationMinutes: 90 },
        { name: "Esmaltação em gel", priceCents: 6000, durationMinutes: 60 },
        { name: "Alongamento de unhas", priceCents: 12000, durationMinutes: 120 },
      ],
    });
    console.log("Serviços de exemplo criados.");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
