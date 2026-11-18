import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, openAllWeek, createAdmin, createClient, createService, nextDayAt } from "./helpers";
import { prisma } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { __setCalendarFactoryForTests } from "@/lib/google-calendar";
import { RETRY_BATCH_CONCURRENCY, RETRY_BATCH_LIMIT, retryFailedBatch } from "@/lib/google-sync-queue";
import { makeFakeCalendar } from "./fake-calendar";

async function connectGoogle() {
  const admin = await createAdmin();
  await prisma.googleCalendarAccount.create({
    data: { adminUserId: admin.id, accessToken: encryptSecret("t"), refreshToken: encryptSecret("r"), expiryDate: new Date(Date.now() + 3600_000) },
  });
}

describe("'Tentar todas novamente': lote com concorrência limitada (achado 9)", () => {
  let fake: ReturnType<typeof makeFakeCalendar>;
  let clientId: string;
  let serviceId: string;

  /** Cria `n` reservas confirmadas com falha de sincronização. */
  let slotCounter = 0; // cada reserva ocupa um horário próprio (o PostgreSQL recusa reservas ativas sobrepostas)
  async function failedAppointments(n: number) {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const startAt = new Date(nextDayAt(9, 0).getTime() + slotCounter++ * 30 * 60_000);
      const a = await prisma.appointment.create({
        data: {
          clientId, serviceId, serviceName: "Lavagem", priceCents: 4000, durationMinutes: 30,
          startAt, endAt: new Date(startAt.getTime() + 30 * 60_000),
          googleSyncStatus: "ERRO", googleSyncError: "falhou antes", googleSyncAttempts: 6, googleSyncNextAt: null,
        },
      });
      ids.push(a.id);
    }
    return ids;
  }
  const status = (id: string) => prisma.appointment.findUniqueOrThrow({ where: { id } });

  beforeEach(async () => {
    await resetDb();
    await openAllWeek();
    slotCounter = 0;
    await connectGoogle();
    clientId = (await createClient()).id;
    serviceId = (await createService()).id;
    fake = makeFakeCalendar();
    __setCalendarFactoryForTests(() => fake.api);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    __setCalendarFactoryForTests(null);
    vi.restoreAllMocks();
  });

  it("sincroniza todas e devolve o resultado de cada uma", async () => {
    const ids = await failedAppointments(6);
    const results = await retryFailedBatch();
    expect(results.map((r) => r.status)).toEqual(Array(6).fill("SINCRONIZADO"));
    expect(results.map((r) => r.id).sort()).toEqual([...ids].sort());
    for (const id of ids) {
      const row = await status(id);
      expect(row).toMatchObject({ googleSyncStatus: "SINCRONIZADO", googleSyncError: null, googleSyncAttempts: 0 });
      expect(row.googleEventId).toBeTruthy();
    }
    expect(fake.live()).toHaveLength(6);
  });

  it(`roda em paralelo, mas nunca mais que ${RETRY_BATCH_CONCURRENCY} chamadas ao Google ao mesmo tempo`, async () => {
    await failedAppointments(10);
    let inFlight = 0;
    let maxInFlight = 0;
    const originalInsert = fake.api.events.insert.getMockImplementation()!;
    fake.api.events.insert.mockImplementation(async (...args: unknown[]) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 25));
      try {
        return await originalInsert(...args);
      } finally {
        inFlight--;
      }
    });

    const results = await retryFailedBatch();
    expect(results.every((r) => r.status === "SINCRONIZADO")).toBe(true);
    expect(maxInFlight).toBeGreaterThan(1); // não é mais estritamente serial
    expect(maxInFlight).toBeLessThanOrEqual(RETRY_BATCH_CONCURRENCY);
  });

  it("isola falhas: um item com erro não interrompe os demais e fica registrado com o erro", async () => {
    const ids = await failedAppointments(5);
    fake.failNext("insert", { beforeStore: fake.err(500, "Google fora do ar") });

    const results = await retryFailedBatch({ concurrency: 1 }); // ordem previsível: o primeiro insert falha
    const byStatus = results.map((r) => r.status);
    expect(byStatus.filter((s) => s === "ERRO")).toHaveLength(1);
    expect(byStatus.filter((s) => s === "SINCRONIZADO")).toHaveLength(4);

    const failed = await status(results.find((r) => r.status === "ERRO")!.id);
    expect(failed).toMatchObject({ googleSyncStatus: "ERRO", googleSyncAttempts: 1 });
    expect(failed.googleSyncError).toMatch(/fora do ar/);
    expect(failed.googleSyncNextAt).not.toBeNull(); // volta para a fila automática
    expect(ids).toContain(failed.id);
  });

  it(`respeita o teto do lote (${RETRY_BATCH_LIMIT}) e o limite pedido`, async () => {
    await failedAppointments(8);
    const some = await retryFailedBatch({ limit: 3 });
    expect(some).toHaveLength(3);
    expect(await prisma.appointment.count({ where: { googleSyncStatus: "ERRO" } })).toBe(5);

    // Pedir mais que o teto não passa do teto.
    await failedAppointments(RETRY_BATCH_LIMIT + 4);
    const many = await retryFailedBatch({ limit: 10_000 });
    expect(many).toHaveLength(RETRY_BATCH_LIMIT);
  }, 60_000);

  it("duas execuções simultâneas sobre os mesmos itens: cada um é processado uma vez e não há evento duplicado", async () => {
    const ids = await failedAppointments(6);
    const [one, two] = await Promise.all([retryFailedBatch(), retryFailedBatch()]);

    const processed = [...one, ...two].filter((r) => r.status !== "IGNORADO");
    expect(processed.map((r) => r.id).sort()).toEqual([...ids].sort()); // uma vez cada
    expect(fake.calls.filter((c) => c === "insert")).toHaveLength(6);
    expect(fake.live()).toHaveLength(6);
  });

  it("repetir o lote depois de concluído não faz nada (já sincronizadas) e não duplica eventos", async () => {
    await failedAppointments(3);
    await retryFailedBatch();
    fake.calls.length = 0;
    expect(await retryFailedBatch()).toEqual([]);
    expect(fake.calls).toEqual([]);
    expect(fake.live()).toHaveLength(3);
  });

  it("sem reservas com falha: lote vazio", async () => {
    expect(await retryFailedBatch()).toEqual([]);
  });
});
