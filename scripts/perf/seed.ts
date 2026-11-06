/**
 * Banco DESCARTÁVEL para medir desempenho (prisma/perf.db). Nunca toca em dev.db.
 * Uso: DATABASE_URL=file:./perf.db npx tsx scripts/perf/seed.ts
 * Cria 1 administradora, 1 cliente de teste, 40 clientes, 5 serviços, expediente e ~2.400
 * agendamentos espalhados em 12 meses (volume realista para um estúdio com anos de uso).
 */
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
export const PERF_ADMIN = { email: "admin.perf@example.com", password: "Perf-Admin#2026x" };
export const PERF_CLIENT = { email: "cliente.perf@example.com", password: "Perf-Client#2026x" };

async function main() {
  if (!(process.env.DATABASE_URL ?? "").includes("perf")) throw new Error("Recuso rodar fora de um banco perf*.");
  const hash = await bcrypt.hash(PERF_ADMIN.password, 10);
  const clientHash = await bcrypt.hash(PERF_CLIENT.password, 10);

  await prisma.appointment.deleteMany();
  await prisma.user.deleteMany();
  await prisma.service.deleteMany();
  await prisma.businessHours.deleteMany();

  await prisma.user.create({ data: { name: "Admin Perf", email: PERF_ADMIN.email, phone: "11999990000", passwordHash: hash, role: "ADMIN" } });
  const clients = [];
  clients.push(await prisma.user.create({ data: { name: "Cliente Perf", email: PERF_CLIENT.email, phone: "11988880000", passwordHash: clientHash } }));
  for (let i = 0; i < 40; i++) {
    clients.push(await prisma.user.create({ data: { name: `Cliente ${i}`, email: `c${i}@example.com`, phone: `1197777${String(i).padStart(4, "0")}`, passwordHash: clientHash } }));
  }
  const services = [];
  for (const [name, price, dur] of [["Manicure", 4500, 45], ["Pedicure", 5500, 60], ["Esmaltação em gel", 9000, 90], ["Alongamento", 15000, 120], ["Spa dos pés", 8000, 60]] as const) {
    services.push(await prisma.service.create({ data: { name, priceCents: price, durationMinutes: dur } }));
  }
  for (let d = 0; d < 7; d++) {
    await prisma.businessHours.create({ data: { dayOfWeek: d, active: d >= 2 && d <= 6, startTime: "09:00", endTime: "18:00", breakStart: "12:00", breakEnd: "13:00" } });
  }

  // 2.400 agendamentos: 12 meses para trás até 30 dias à frente, sem sobreposição (um por faixa de 2 h).
  const rows = [];
  const base = new Date();
  base.setUTCHours(0, 0, 0, 0);
  let n = 0;
  for (let day = -365; day <= 30 && n < 2400; day++) {
    const date = new Date(base.getTime() + day * 86_400_000);
    const wd = date.getUTCDay();
    if (wd < 2) continue;
    for (const hourUtc of [12, 14, 16, 18, 20]) {
      const svc = services[(n + day + 400) % services.length];
      const startAt = new Date(date.getTime() + hourUtc * 3_600_000);
      const endAt = new Date(startAt.getTime() + svc.durationMinutes * 60_000);
      const past = startAt.getTime() < Date.now();
      const status = past ? (n % 11 === 0 ? "CANCELADA" : n % 17 === 0 ? "FALTA" : "CONCLUIDA") : "CONFIRMADA";
      rows.push({
        clientId: clients[1 + (n % 40)].id, serviceId: svc.id, serviceName: svc.name, priceCents: svc.priceCents,
        durationMinutes: svc.durationMinutes, startAt, endAt, status, createdAt: new Date(Math.min(startAt.getTime() - 86_400_000, Date.now())),
      });
      n++;
    }
  }
  await prisma.appointment.createMany({ data: rows });
  await prisma.user.updateMany({ where: { role: "ADMIN" }, data: { notificationsSeenAt: new Date() } });
  console.log(`perf.db pronto: ${rows.length} agendamentos`);
}

main().finally(() => prisma.$disconnect());
