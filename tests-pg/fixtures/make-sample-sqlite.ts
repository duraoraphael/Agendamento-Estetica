// Cria dados de exemplo (fictícios) num SQLite: usado pelos testes de migração. Uso: tsx make-sample-sqlite.ts <arquivo> <clean|overlap|foo>
import { PrismaClient } from "@prisma/client";
import { encryptSecret } from "../../src/lib/crypto";

async function main() {
  const [file, mode] = process.argv.slice(2);
  const db = new PrismaClient({ datasourceUrl: "file:" + file });
  const day = (d: number, h: number, m = 0) => new Date(Date.UTC(2099, 0, d, h, m));

  const admin = await db.user.create({ data: { id: "u-admin", name: "Admin Teste", email: "admin@example.com", phone: "(11) 90000-0001", passwordHash: "$2a$10$hash", role: "ADMIN" } });
  const ana = await db.user.create({ data: { id: "u-ana", name: "Ana Teste", email: "ana@example.com", phone: "(11) 90000-0002", passwordHash: "$2a$10$hash", role: "CLIENTE" } });
  const bia = await db.user.create({ data: { id: "u-bia", name: "Bia Teste", email: "bia@example.com", phone: "(11) 90000-0003", passwordHash: "$2a$10$hash", role: "CLIENTE" } });
  const gel = await db.service.create({ data: { id: "s-gel", name: "Gel", priceCents: 9900, durationMinutes: 60 } }); // preço ATUAL 99,00
  await db.service.create({ data: { id: "s-man", name: "Manicure", priceCents: 4000, durationMinutes: 45, active: false } });
  for (let d = 0; d < 7; d++) await db.businessHours.create({ data: { dayOfWeek: d, active: d > 1, startTime: "09:00", endTime: "18:00", breakStart: d === 6 ? null : "12:00", breakEnd: d === 6 ? null : "13:00" } });
  await db.blockedPeriod.create({ data: { id: "b-1", startAt: day(20, 3), endAt: day(21, 3), reason: "Feriado" } });

  const mk = (id: string, clientId: string, start: Date, mins: number, status: string, priceCents: number) =>
    db.appointment.create({ data: { id, clientId, serviceId: gel.id, serviceName: "Gel", priceCents, durationMinutes: mins, startAt: start, endAt: new Date(start.getTime() + mins * 60_000), status } });
  await mk("a-1", ana.id, day(10, 10), 60, "CONFIRMADA", 6000); // preço histórico 60,00 ≠ atual 99,00
  await mk("a-2", bia.id, day(10, 11), 60, "CONFIRMADA", 6000); // CONSECUTIVA da a-1 (permitida)
  await mk("a-3", bia.id, day(10, 10), 60, "CANCELADA", 6000); // cancelada sobre o horário da a-1 (permitida)
  await mk("a-4", ana.id, day(11, 10), 60, "FALTA", 5000);
  await mk("a-5", ana.id, day(12, 10), 60, "CONCLUIDA", 5500);
  await mk("a-6", bia.id, day(13, 15), 30, "CONFIRMADA", 3000);
  if (mode === "overlap") await mk("a-x", bia.id, day(10, 10, 30), 60, "CONFIRMADA", 6000); // sobrepõe a-1/a-2
  if (mode === "foo") await mk("a-foo", bia.id, day(14, 10), 60, "FOO", 6000);

  await db.googleCalendarAccount.create({ data: { id: "g-1", adminUserId: admin.id, accessToken: encryptSecret("access-fake"), refreshToken: encryptSecret("refresh-fake"), expiryDate: day(30, 0), calendarId: "primary" } });
  await db.bookingLock.upsert({ where: { id: 1 }, create: { id: 1, version: 7 }, update: { version: 7 } });
  await db.$disconnect();
}
main();
