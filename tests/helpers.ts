import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { zonedToUtc, dateKeyInTz } from "@/lib/format";

export async function resetDb() {
  await prisma.rateLimit.deleteMany();
  await prisma.siteSettings.deleteMany();
  await prisma.siteLogo.deleteMany();
  await prisma.appointment.deleteMany();
  await prisma.blockedPeriod.deleteMany();
  await prisma.googleCalendarAccount.deleteMany();
  await prisma.service.deleteMany();
  await prisma.businessHours.deleteMany();
  await prisma.user.deleteMany();
  await prisma.bookingLock.deleteMany();
  await prisma.bookingLock.create({ data: { id: 1, version: 0 } });
}

/** Abre todos os dias da semana com um expediente amplo, sem almoço, para isolar os testes do dia real em que rodam. */
export async function openAllWeek() {
  for (let day = 0; day <= 6; day++) {
    await prisma.businessHours.upsert({
      where: { dayOfWeek: day },
      update: { active: true, startTime: "00:00", endTime: "23:45", breakStart: null, breakEnd: null },
      create: { dayOfWeek: day, active: true, startTime: "00:00", endTime: "23:45" },
    });
  }
}

let counter = 0;
function unique(prefix: string) {
  counter += 1;
  return `${prefix}${Date.now()}${counter}`;
}

export async function createClient(overrides: Partial<{ name: string; email: string; phone: string; password: string }> = {}) {
  const password = overrides.password ?? "Senha1234";
  const passwordHash = await bcrypt.hash(password, 4);
  const user = await prisma.user.create({
    data: {
      name: overrides.name ?? "Cliente Teste",
      email: overrides.email ?? `${unique("cliente")}@example.com`,
      phone: overrides.phone ?? "(11) 90000-0000",
      passwordHash,
      role: "CLIENTE",
    },
  });
  return { ...user, plainPassword: password };
}

export async function createAdmin(overrides: Partial<{ name: string; email: string; phone: string; password: string }> = {}) {
  const password = overrides.password ?? "SenhaAdmin1234";
  const passwordHash = await bcrypt.hash(password, 4);
  const user = await prisma.user.create({
    data: {
      name: overrides.name ?? "Administradora Teste",
      email: overrides.email ?? `${unique("admin")}@example.com`,
      phone: overrides.phone ?? "(11) 90000-0001",
      passwordHash,
      role: "ADMIN",
    },
  });
  return { ...user, plainPassword: password };
}

export async function createService(
  overrides: Partial<{ name: string; priceCents: number; durationMinutes: number; active: boolean }> = {}
) {
  return prisma.service.create({
    data: {
      name: overrides.name ?? "Serviço Teste",
      priceCents: overrides.priceCents ?? 4000,
      durationMinutes: overrides.durationMinutes ?? 60,
      active: overrides.active ?? true,
    },
  });
}

/** Horário em `daysAhead` dias a partir de hoje, às hour:minute, no fuso America/Sao_Paulo. */
export function nextDayAt(hour: number, minute: number, daysAhead = 1): Date {
  const todayKey = dateKeyInTz(new Date());
  const [y, m, d] = todayKey.split("-").map(Number);
  const base = new Date(y, m - 1, d + daysAhead);
  return zonedToUtc(base.getFullYear(), base.getMonth() + 1, base.getDate(), hour, minute);
}

export function dateKeyDaysAhead(daysAhead: number): string {
  const todayKey = dateKeyInTz(new Date());
  const [y, m, d] = todayKey.split("-").map(Number);
  const base = new Date(y, m - 1, d + daysAhead);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(base.getDate())}`;
}
