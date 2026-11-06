import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, openAllWeek, createAdmin, createClient, createService, nextDayAt } from "./helpers";
import { prisma } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { __setCalendarFactoryForTests, eventIdForAppointment, nextSyncAttemptAt, MAX_AUTO_SYNC_ATTEMPTS } from "@/lib/google-calendar";
import { createBooking, updateAppointmentStatus, cancelOwnBooking, retryGoogleSync } from "@/lib/booking";
import { enqueueUnsyncedFuture, getSyncOverview, markPendingIfConnected, processGoogleSyncQueue } from "@/lib/google-sync-queue";
import { makeFakeCalendar } from "./fake-calendar";

async function connectGoogle() {
  const admin = await createAdmin();
  await prisma.googleCalendarAccount.create({
    data: { adminUserId: admin.id, accessToken: encryptSecret("t"), refreshToken: encryptSecret("r"), expiryDate: new Date(Date.now() + 3600_000) },
  });
}
const row = (id: string) => prisma.appointment.findUniqueOrThrow({ where: { id } });
const minutes = (n: number) => new Date(Date.now() + n * 60_000);

describe("Fila durável de sincronização com o Google Agenda", () => {
  let fake: ReturnType<typeof makeFakeCalendar>;

  beforeEach(async () => {
    await resetDb();
    await openAllWeek();
    fake = makeFakeCalendar();
    __setCalendarFactoryForTests(() => fake.api);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    __setCalendarFactoryForTests(null);
    vi.restoreAllMocks();
  });

  it("política de espera: 1 min, 5 min, 15 min, 1 h, 6 h e depois só manual", () => {
    const now = new Date("2026-12-01T12:00:00Z");
    const waits = [1, 2, 3, 4, 5].map((n) => (nextSyncAttemptAt(n, now)!.getTime() - now.getTime()) / 60_000);
    expect(waits).toEqual([1, 5, 15, 60, 360]);
    expect(nextSyncAttemptAt(MAX_AUTO_SYNC_ATTEMPTS, now)).toBeNull();
  });

  it("reserva confirmada cria 1 evento na agenda conectada e zera a fila", async () => {
    await connectGoogle();
    const client = await createClient();
    const service = await createService({ durationMinutes: 60 });
    const a = await createBooking({ clientId: client.id, serviceId: service.id, startAt: nextDayAt(10, 0) });
    const r = await row(a.id);
    expect(r).toMatchObject({ googleSyncStatus: "SINCRONIZADO", googleSyncAttempts: 0, googleSyncNextAt: null, googleEventId: eventIdForAppointment(a.id) });
    expect(fake.live()).toHaveLength(1);
    expect(fake.live()[0].start.timeZone).toBe("America/Sao_Paulo");
  });

  it("falha do Google fica registrada (ERRO, tentativas, próxima tentativa) e o trabalhador reenvia sem duplicar", async () => {
    await connectGoogle();
    const client = await createClient();
    const service = await createService();
    fake.failNext("insert", { beforeStore: fake.err(503, "Google fora do ar") });

    const a = await createBooking({ clientId: client.id, serviceId: service.id, startAt: nextDayAt(10, 0) });
    let r = await row(a.id);
    expect(r.googleSyncStatus).toBe("ERRO");
    expect(r.googleSyncAttempts).toBe(1);
    expect(r.googleSyncNextAt!.getTime()).toBeGreaterThan(Date.now());
    expect(fake.live()).toHaveLength(0);
    expect((await getSyncOverview()).failed.map((f) => f.id)).toEqual([a.id]);

    // Antes do prazo o trabalhador não mexe; depois do prazo reenvia.
    expect((await processGoogleSyncQueue()).picked).toBe(0);
    const run = await processGoogleSyncQueue({ now: minutes(2) });
    expect(run).toEqual({ picked: 1, synced: 1, failed: 0 });
    r = await row(a.id);
    expect(r).toMatchObject({ googleSyncStatus: "SINCRONIZADO", googleSyncAttempts: 0, googleSyncNextAt: null });
    expect(fake.live()).toHaveLength(1);

    // Rodar de novo não duplica nem recria.
    expect((await processGoogleSyncQueue({ now: minutes(10) })).picked).toBe(0);
    expect(fake.live()).toHaveLength(1);
  });

  it("resposta perdida (o Google gravou, mas a resposta falhou): a nova tentativa reconcilia o mesmo evento", async () => {
    await connectGoogle();
    const client = await createClient();
    const service = await createService();
    fake.failNext("insert", { afterStore: fake.err(504, "timeout") });
    const a = await createBooking({ clientId: client.id, serviceId: service.id, startAt: nextDayAt(11, 0) });
    expect((await row(a.id)).googleSyncStatus).toBe("ERRO");
    expect(fake.live()).toHaveLength(1); // já existe no Google

    await processGoogleSyncQueue({ now: minutes(2) });
    expect((await row(a.id)).googleSyncStatus).toBe("SINCRONIZADO");
    expect(fake.live()).toHaveLength(1);
  });

  it("sobrevive a reinício: reserva que ficou PENDENTE (processo caiu antes de sincronizar) é enviada pelo trabalhador", async () => {
    await connectGoogle();
    const client = await createClient();
    const service = await createService();
    // Simula o processo morrendo logo após o COMMIT: a reserva existe, marcada como pendente, sem nenhuma chamada ao Google.
    const created = await prisma.appointment.create({
      data: {
        clientId: client.id, serviceId: service.id, serviceName: service.name, priceCents: service.priceCents,
        durationMinutes: service.durationMinutes, startAt: nextDayAt(14, 0), endAt: nextDayAt(15, 0),
      },
    });
    await markPendingIfConnected(prisma, created.id);
    expect((await row(created.id)).googleSyncStatus).toBe("PENDENTE");
    expect(fake.calls).toEqual([]);

    expect((await processGoogleSyncQueue()).picked).toBe(0); // folga de 60 s para a tentativa imediata
    expect(await processGoogleSyncQueue({ now: minutes(2) })).toEqual({ picked: 1, synced: 1, failed: 0 });
    expect(fake.live()).toHaveLength(1);
  });

  it("dois trabalhadores ao mesmo tempo não enviam duas vezes a mesma reserva", async () => {
    await connectGoogle();
    const client = await createClient();
    const service = await createService();
    const created = await prisma.appointment.create({
      data: {
        clientId: client.id, serviceId: service.id, serviceName: service.name, priceCents: service.priceCents,
        durationMinutes: service.durationMinutes, startAt: nextDayAt(14, 0), endAt: nextDayAt(15, 0),
      },
    });
    await markPendingIfConnected(prisma, created.id);
    const [a, b] = await Promise.all([processGoogleSyncQueue({ now: minutes(2) }), processGoogleSyncQueue({ now: minutes(2) })]);
    expect(a.picked + b.picked).toBe(1);
    expect(fake.live()).toHaveLength(1);
    expect(fake.calls.filter((c) => c === "insert")).toHaveLength(1);
  });

  it("após esgotar as tentativas automáticas para de tentar; “tentar novamente” do painel zera e reenvia", async () => {
    await connectGoogle();
    const client = await createClient();
    const service = await createService();
    // Exatamente uma falha por tentativa: a da reserva + uma por rodada do trabalhador.
    for (let i = 0; i < MAX_AUTO_SYNC_ATTEMPTS; i++) fake.failNext("insert", { beforeStore: fake.err(503, "fora") });
    const a = await createBooking({ clientId: client.id, serviceId: service.id, startAt: nextDayAt(10, 0) });

    for (let i = 1; i < MAX_AUTO_SYNC_ATTEMPTS; i++) await processGoogleSyncQueue({ now: minutes(24 * 60 * i) });
    const r = await row(a.id);
    expect(r.googleSyncStatus).toBe("ERRO");
    expect(r.googleSyncAttempts).toBe(MAX_AUTO_SYNC_ATTEMPTS);
    expect(r.googleSyncNextAt).toBeNull();
    expect((await processGoogleSyncQueue({ now: minutes(24 * 60 * 30) })).picked).toBe(0);

    await retryGoogleSync(a.id); // o Google voltou
    expect(await row(a.id)).toMatchObject({ googleSyncStatus: "SINCRONIZADO", googleSyncAttempts: 0 });
    expect(fake.live()).toHaveLength(1);
  });

  it("cancelamento e alteração passam pela mesma fila e removem/atualizam o evento", async () => {
    await connectGoogle();
    const client = await createClient();
    const service = await createService();
    const a = await createBooking({ clientId: client.id, serviceId: service.id, startAt: nextDayAt(10, 0, 3) });
    expect(fake.live()).toHaveLength(1);

    fake.failNext("delete", fake.err(503, "fora"));
    await cancelOwnBooking({ appointmentId: a.id, clientId: client.id, now: new Date(Date.now() - 48 * 3600_000) });
    expect((await row(a.id)).googleSyncStatus).toBe("ERRO");
    expect(fake.live()).toHaveLength(1); // o evento ainda existe

    await processGoogleSyncQueue({ now: minutes(2) });
    expect((await row(a.id)).googleSyncStatus).toBe("SINCRONIZADO");
    expect(fake.live()).toHaveLength(0);

    // Reativar volta a criar/restaurar o MESMO evento.
    await updateAppointmentStatus(a.id, "CONFIRMADA");
    expect(fake.live()).toHaveLength(1);
    expect(fake.events.size).toBe(1);
  });

  it("ao conectar o Google, reservas futuras já existentes entram na fila e são enviadas", async () => {
    const client = await createClient();
    const service = await createService();
    const a = await createBooking({ clientId: client.id, serviceId: service.id, startAt: nextDayAt(10, 0) });
    expect((await row(a.id)).googleSyncStatus).toBe("NAO_CONECTADO");

    await connectGoogle();
    expect(await enqueueUnsyncedFuture()).toBe(1);
    expect(await processGoogleSyncQueue({ now: minutes(1) })).toEqual({ picked: 1, synced: 1, failed: 0 });
    expect(fake.live()).toHaveLength(1);
  });

  it("reserva cancelada enquanto o Google estava desconectado tem o evento removido ao reconectar", async () => {
    await connectGoogle();
    const client = await createClient();
    const service = await createService();
    const a = await createBooking({ clientId: client.id, serviceId: service.id, startAt: nextDayAt(10, 0) });
    expect(fake.live()).toHaveLength(1);

    await prisma.googleCalendarAccount.deleteMany(); // desconecta
    await updateAppointmentStatus(a.id, "CANCELADA");
    expect((await row(a.id)).googleSyncStatus).not.toBe("PENDENTE"); // nada foi enfileirado: não havia conta
    expect(fake.live()).toHaveLength(1); // o evento antigo continua vivo na agenda

    await connectGoogle(); // reconecta
    expect(await enqueueUnsyncedFuture()).toBe(1);
    await processGoogleSyncQueue({ now: minutes(1) });
    expect(fake.live()).toHaveLength(0);
    expect(await row(a.id)).toMatchObject({ googleSyncStatus: "SINCRONIZADO", googleEventId: null });
  });

  it("sem conta conectada a fila não faz nada", async () => {
    const client = await createClient();
    const service = await createService();
    await createBooking({ clientId: client.id, serviceId: service.id, startAt: nextDayAt(10, 0) });
    expect(await processGoogleSyncQueue({ now: minutes(10) })).toEqual({ picked: 0, synced: 0, failed: 0 });
    expect(fake.calls).toEqual([]);
  });
});
