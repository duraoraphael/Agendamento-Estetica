import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { zonedToUtc, dateKeyInTz } from "@/lib/format";
import { createBooking as createBookingCore } from "@/lib/booking";

/**
 * resetDb() APAGA todas as tabelas. Só roda contra o PostgreSQL local e descartável dos testes (tests/pg-env.ts):
 * se a DATABASE_URL apontar para qualquer outro servidor (ex.: o Supabase do .env), recusa antes de apagar algo.
 */
function assertDisposableDatabase() {
  let host = "";
  try {
    host = new URL(process.env.DATABASE_URL ?? "").hostname;
  } catch {
    /* URL inválida: cai na recusa abaixo */
  }
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error("Recusei apagar os dados: DATABASE_URL não é um banco local descartável. Os testes nunca devem tocar o Supabase.");
  }
}

export async function resetDb() {
  assertDisposableDatabase();
  await prisma.rateLimit.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.siteSettings.deleteMany();
  await prisma.siteLogo.deleteMany();
  await prisma.appointment.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.vehicle.deleteMany();
  await prisma.blockedPeriod.deleteMany();
  await prisma.googleCalendarAccount.deleteMany();
  await prisma.storageCleanup.deleteMany();
  await prisma.service.deleteMany(); // ServiceImage sai em cascata
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

let plateCounter = 0;
/** Placa válida e única por chamada (ex.: TST1A01, TST1A02...). */
export function uniquePlate(): string {
  plateCounter += 1;
  return `TST${plateCounter % 10}A${String(Math.floor(plateCounter / 10) % 100).padStart(2, "0")}`;
}

/** Cria um veículo de teste para a cliente (placa única). */
export async function createVehicleFor(userId: string, overrides: Partial<{ brand: string; model: string; plate: string }> = {}) {
  return prisma.vehicle.create({
    data: { userId, brand: overrides.brand ?? "Fiat", model: overrides.model ?? "Argo", plate: overrides.plate ?? uniquePlate() },
  });
}

/**
 * `createBooking` para os testes: o servidor EXIGE `vehicleId` (e que o veículo seja da cliente). Sem `vehicleId`, usa o
 * primeiro veículo da cliente ou cria um. Os testes que verificam a exigência chamam `@/lib/booking` direto.
 */
export async function createBooking(params: { clientId: string; serviceId: string; startAt: Date; vehicleId?: string; notes?: string | null }) {
  const vehicleId =
    params.vehicleId ??
    (await prisma.vehicle.findFirst({ where: { userId: params.clientId }, select: { id: true } }))?.id ??
    (await createVehicleFor(params.clientId)).id;
  return createBookingCore({ ...params, vehicleId });
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
