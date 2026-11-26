import { execFile, execSync } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, openAllWeek, createClient, createService, nextDayAt } from "./helpers";
import { prisma } from "@/lib/db";
import { updateAppointmentStatus, BookingConflictError } from "@/lib/booking";
import { createBooking } from "./helpers";
import { PG_TEST_URL, PG_TEST_URL_FOR } from "./pg-env";

const execFileAsync = promisify(execFile);
const root = path.resolve(__dirname, "..");

let n = 0;
/** INSERT direto no banco, sem passar pela aplicação (simula bug ou acesso externo). */
async function rawInsert(clientId: string, serviceId: string, start: Date, end: Date, status = "CONFIRMADA") {
  n += 1;
  await prisma.$executeRaw`
    INSERT INTO "Appointment" ("id","clientId","serviceId","serviceName","priceCents","durationMinutes","startAt","endAt","status","googleSyncStatus","createdAt","updatedAt")
    VALUES (${"raw" + Date.now() + n}, ${clientId}, ${serviceId}, 'x', 1000, 60, ${start.toISOString()}::timestamp(3), ${end.toISOString()}::timestamp(3), ${status}, 'NAO_CONECTADO', NOW(), NOW())`;
}

describe("PostgreSQL: garantias do próprio banco", () => {
  let clientId: string;
  let serviceId: string;
  const T = (h: number, m = 0) => new Date(Date.UTC(2027, 0, 15, h, m));

  beforeEach(async () => {
    await resetDb();
    await openAllWeek();
    clientId = (await createClient()).id;
    serviceId = (await createService()).id;
  });

  it("a migração criou a restrição de exclusão e a linha do BookingLock", async () => {
    const rows = await prisma.$queryRaw<{ conname: string }[]>`SELECT conname FROM pg_constraint WHERE conname IN ('Appointment_no_overlap','Appointment_valid_status')`;
    expect(rows.map((r) => r.conname).sort()).toEqual(["Appointment_no_overlap", "Appointment_valid_status"]);
    expect(await prisma.bookingLock.count()).toBe(1);
  });

  it("rejeita sobreposição gravada DIRETO no banco (total e parcial)", async () => {
    await rawInsert(clientId, serviceId, T(10), T(11));
    await expect(rawInsert(clientId, serviceId, T(10), T(11))).rejects.toThrow(/Appointment_no_overlap|23P01|exclusion/i);
    await expect(rawInsert(clientId, serviceId, T(10, 30), T(11, 30))).rejects.toThrow(/Appointment_no_overlap|23P01|exclusion/i);
    await expect(rawInsert(clientId, serviceId, T(9, 30), T(10, 15))).rejects.toThrow(/Appointment_no_overlap|23P01|exclusion/i);
    expect(await prisma.appointment.count()).toBe(1);
  });

  it("aceita reservas CONSECUTIVAS (fim = início) e a que começa 1 minuto depois", async () => {
    await rawInsert(clientId, serviceId, T(10), T(11));
    await rawInsert(clientId, serviceId, T(11), T(12));
    await rawInsert(clientId, serviceId, T(9), T(10));
    await rawInsert(clientId, serviceId, T(12, 1), T(13));
    expect(await prisma.appointment.count()).toBe(4);
  });

  it("canceladas e faltas não bloqueiam; reativar sobreposta por UPDATE direto é recusado; concluída bloqueia", async () => {
    await rawInsert(clientId, serviceId, T(10), T(11), "CANCELADA");
    await rawInsert(clientId, serviceId, T(10), T(11), "FALTA");
    await rawInsert(clientId, serviceId, T(10), T(11), "CONFIRMADA");
    await expect(rawInsert(clientId, serviceId, T(10, 30), T(11, 30), "CONCLUIDA")).rejects.toThrow();
    await expect(prisma.$executeRaw`UPDATE "Appointment" SET "status"='CONFIRMADA' WHERE "status"='CANCELADA'`).rejects.toThrow(/no_overlap|23P01|exclusion/i);
  });

  it("rejeita status inválido (FOO), intervalo invertido e papel inválido", async () => {
    await expect(rawInsert(clientId, serviceId, T(10), T(11), "FOO")).rejects.toThrow(/valid_status|23514|check/i);
    await expect(rawInsert(clientId, serviceId, T(11), T(10))).rejects.toThrow(/valid_range|23514|check/i);
    await expect(prisma.$executeRaw`UPDATE "User" SET "role"='SUPER' WHERE "id"=${clientId}`).rejects.toThrow(/valid_role|23514|check/i);
  });

  it("dois INSERTs sobrepostos simultâneos por conexões diferentes: o banco deixa passar só um", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => rawInsert(clientId, serviceId, T(14), T(15)))
    );
    const reasons = results.filter((r) => r.status === "rejected").map((r) => String((r as PromiseRejectedResult).reason).slice(0, 160));
    expect(results.filter((r) => r.status === "fulfilled"), reasons.join(" | ")).toHaveLength(1);
    expect(await prisma.appointment.count({ where: { startAt: T(14) } })).toBe(1);
  });

  it("aplicação: horários consecutivos são aceitos; sobreposição parcial é recusada", async () => {
    const svc = await createService({ durationMinutes: 60 });
    const c2 = await createClient();
    await createBooking({ clientId, serviceId: svc.id, startAt: nextDayAt(9, 0, 2) });
    const consecutive = await createBooking({ clientId: c2.id, serviceId: svc.id, startAt: nextDayAt(10, 0, 2) });
    expect(consecutive.status).toBe("CONFIRMADA");
    await expect(createBooking({ clientId: c2.id, serviceId: svc.id, startAt: nextDayAt(10, 45, 2) })).rejects.toBeInstanceOf(BookingConflictError);
  });

  it("se a verificação da aplicação fosse burlada, o erro do banco vira mensagem de conflito clara (não 500)", async () => {
    // Reativação concorrente com nova reserva: o banco é a rede de segurança final.
    const svc = await createService({ durationMinutes: 60 });
    const c2 = await createClient();
    const startAt = nextDayAt(11, 0, 2);
    const a = await createBooking({ clientId, serviceId: svc.id, startAt });
    await updateAppointmentStatus(a.id, "CANCELADA");
    await createBooking({ clientId: c2.id, serviceId: svc.id, startAt });
    await expect(updateAppointmentStatus(a.id, "CONFIRMADA")).rejects.toBeInstanceOf(BookingConflictError);
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("CANCELADA");
  });

  it("3 PROCESSOS Node independentes disputando o mesmo horário: exatamente 1 reserva", async () => {
    const svc = await createService({ durationMinutes: 60 });
    const clients = await Promise.all([createClient(), createClient(), createClient()]);
    const startAt = nextDayAt(16, 0, 2).toISOString();
    const runs = await Promise.all(
      clients.map((c) =>
        execFileAsync("npx", ["tsx", "tests/fixtures/race.ts", c.id, svc.id, startAt], {
          cwd: root,
          shell: true,
          env: { ...process.env, DATABASE_URL: PG_TEST_URL, DIRECT_URL: PG_TEST_URL },
          timeout: 120_000,
        })
      )
    );
    const results = runs.map((r) => JSON.parse(r.stdout.split("RESULT ")[1].trim()));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).every((r) => r.error === "BookingConflictError")).toBe(true);
    expect(await prisma.appointment.count({ where: { startAt: new Date(startAt), status: "CONFIRMADA" } })).toBe(1);
  });

  it("as migrações em prisma/migrations produzem exatamente o que prisma/schema.prisma descreve (sem divergência)", async () => {
    // Banco-sombra: aplica TODAS as migrações do zero e compara com o schema. Saída 0 = iguais, 2 = divergem.
    await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS agenda_shadow`);
    await prisma.$executeRawUnsafe(`CREATE DATABASE agenda_shadow`);
    try {
      execSync(
        `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "${PG_TEST_URL_FOR("agenda_shadow")}" --exit-code`,
        { cwd: root, stdio: "pipe", env: { ...process.env, DATABASE_URL: PG_TEST_URL, DIRECT_URL: PG_TEST_URL } }
      );
    } catch (err) {
      const e = err as { status?: number; stdout?: Buffer };
      throw new Error(`Migrações e schema divergem (código ${e.status}):\n${e.stdout?.toString().slice(0, 1500)}`);
    } finally {
      await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS agenda_shadow`);
    }
  }, 120_000);
});

describe("PostgreSQL: RLS ligado em todas as tabelas (Supabase expõe o schema public por API REST)", () => {
  beforeEach(resetDb);

  it("toda tabela do schema public tem RLS ligado, inclusive a de controle do Prisma", async () => {
    const rows = await prisma.$queryRaw<{ relname: string; relrowsecurity: boolean }[]>`
      SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname`;
    expect(rows.map((r) => r.relname)).toEqual(
      expect.arrayContaining(["User", "Service", "BusinessHours", "BlockedPeriod", "Appointment", "BookingLock", "GoogleCalendarAccount", "RateLimit", "SiteSettings", "SiteLogo", "_prisma_migrations"])
    );
    expect(rows.filter((r) => !r.relrowsecurity).map((r) => r.relname)).toEqual([]);
  });

  it("um papel sem BYPASSRLS (como o 'anon' do Supabase) não lê nem grava nada, mesmo com GRANT", async () => {
    await createClient({ email: "alvo-rls@example.com" });
    await prisma.$executeRawUnsafe(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rls_probe') THEN CREATE ROLE rls_probe NOLOGIN; END IF; END $$`);
    await prisma.$executeRawUnsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON "User" TO rls_probe`);
    try {
      const seen = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE rls_probe`);
        return tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*)::bigint AS n FROM "User"`);
      });
      expect(Number(seen[0].n)).toBe(0); // existe 1 usuária, mas a política padrão (nenhuma) esconde tudo

      await expect(
        prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL ROLE rls_probe`);
          await tx.$executeRawUnsafe(
            `INSERT INTO "User" ("id","name","email","phone","passwordHash","role","notificationsSeenAt","createdAt") VALUES ('x','x','x@x.com','x','x','ADMIN',NOW(),NOW())`
          );
        })
      ).rejects.toThrow(/row-level security|42501/i);
    } finally {
      await prisma.$executeRawUnsafe(`REVOKE ALL ON "User" FROM rls_probe`);
      await prisma.$executeRawUnsafe(`DROP ROLE IF EXISTS rls_probe`);
    }
  });

  it("a aplicação (dono das tabelas) continua lendo e gravando normalmente", async () => {
    const c = await createClient();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: c.id } })).id).toBe(c.id);
  });
});

describe("PostgreSQL: tipo de veículo e preço por categoria", () => {
  let clientId: string;
  let serviceId: string;
  let k = 0;

  beforeEach(async () => {
    await resetDb();
    clientId = (await createClient()).id;
    serviceId = (await createService()).id;
  });

  /** INSERT direto (sem passar pela aplicação): o CHECK do banco é a segunda barreira depois do Zod. */
  async function rawVehicle(vehicleType: string | null, plate: string) {
    k += 1;
    await prisma.$executeRaw`
      INSERT INTO "Vehicle" ("id","userId","brand","model","plate","vehicleType","createdAt","updatedAt")
      VALUES (${"v" + Date.now() + k}, ${clientId}, 'Fiat', 'Argo', ${plate}, ${vehicleType}, NOW(), NOW())`;
  }
  async function rawServicePrice(vehicleType: string, priceCents: number, svc = serviceId) {
    k += 1;
    await prisma.$executeRaw`
      INSERT INTO "ServicePrice" ("id","serviceId","vehicleType","priceCents") VALUES (${"p" + Date.now() + k}, ${svc}, ${vehicleType}, ${priceCents})`;
  }

  it("Vehicle.vehicleType aceita nulo (veículo antigo) e as cinco categorias, e recusa qualquer outro valor", async () => {
    await rawVehicle(null, "AAA1A11");
    await rawVehicle("SUV", "AAA1A12");
    await expect(rawVehicle("BARCO", "AAA1A13")).rejects.toThrow(/Vehicle_valid_type/);
    await expect(rawVehicle("suv", "AAA1A14")).rejects.toThrow(/Vehicle_valid_type/);
    expect(await prisma.vehicle.count()).toBe(2);
  });

  it("ServicePrice recusa categoria inválida e preço fora de 0..500000 (mesmo teto do preço do serviço), e aceita zero e o teto", async () => {
    await rawServicePrice("SUV", 9000);
    await rawServicePrice("HATCH", 0);
    await rawServicePrice("PICAPE", 500_000);
    await expect(rawServicePrice("BARCO", 9000)).rejects.toThrow(/ServicePrice_valid_type/);
    await expect(rawServicePrice("SEDA", -1)).rejects.toThrow(/ServicePrice_valid_price/);
    await expect(rawServicePrice("SEDA", 500_001)).rejects.toThrow(/ServicePrice_valid_price/);
    expect(await prisma.servicePrice.count()).toBe(3);
  });

  it("ServicePrice: uma linha por (serviço, categoria)", async () => {
    await rawServicePrice("SUV", 9000);
    await expect(rawServicePrice("SUV", 9500)).rejects.toThrow(/ServicePrice_serviceId_vehicleType_key|23505|unique/i);
  });

  it("apagar o serviço apaga os preços por categoria dele (e só dele)", async () => {
    const other = await createService({ name: "Outro serviço" });
    await rawServicePrice("SUV", 9000);
    await rawServicePrice("SUV", 7000, other.id);
    await prisma.service.delete({ where: { id: serviceId } });
    expect(await prisma.servicePrice.findMany({ select: { serviceId: true } })).toEqual([{ serviceId: other.id }]);
  });

  it("Appointment.vehicleTypeSnapshot aceita nulo e categoria, e recusa outro valor", async () => {
    const insert = (snapshot: string | null) => {
      k += 1;
      return prisma.$executeRaw`
        INSERT INTO "Appointment" ("id","clientId","serviceId","serviceName","priceCents","durationMinutes","vehicleTypeSnapshot","startAt","endAt","status","googleSyncStatus","createdAt","updatedAt")
        VALUES (${"a" + Date.now() + k}, ${clientId}, ${serviceId}, 'x', 1000, 60, ${snapshot}, ${new Date(Date.UTC(2027, 0, 15 + k, 10)).toISOString()}::timestamp(3), ${new Date(Date.UTC(2027, 0, 15 + k, 11)).toISOString()}::timestamp(3), 'CONFIRMADA', 'NAO_CONECTADO', NOW(), NOW())`;
    };
    await insert(null);
    await insert("PICAPE");
    await expect(insert("BARCO")).rejects.toThrow(/Appointment_valid_vehicle_type/);
  });

  it("SiteSettings.priceByVehicleType começa desligada", async () => {
    const row = await prisma.siteSettings.create({ data: { id: 1 } });
    expect(row.priceByVehicleType).toBe(false);
  });
});
