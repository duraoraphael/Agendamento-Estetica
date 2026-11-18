import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, openAllWeek, createAdmin, createClient, createService, nextDayAt, dateKeyDaysAhead } from "./helpers";
import { prisma } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import {
  __setCalendarFactoryForTests,
  CalendarUnavailableError,
  eventIdForAppointment,
} from "@/lib/google-calendar";
import { updateAppointmentStatus, retryGoogleSync, cancelOwnBooking, BookingConflictError } from "@/lib/booking";
import { createBooking } from "./helpers";
import { generateSlotCandidatesForDate } from "@/lib/availability";
import { makeFakeCalendar } from "./fake-calendar";

async function connectGoogle() {
  const admin = await createAdmin();
  await prisma.googleCalendarAccount.create({
    data: {
      adminUserId: admin.id,
      accessToken: encryptSecret("token-fake"),
      refreshToken: encryptSecret("refresh-fake"),
      expiryDate: new Date(Date.now() + 3600_000),
    },
  });
}

describe("Google Agenda — integração simulada", () => {
  let fake: ReturnType<typeof makeFakeCalendar>;

  beforeEach(async () => {
    await resetDb();
    await openAllWeek();
    fake = makeFakeCalendar();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    __setCalendarFactoryForTests(null);
    vi.restoreAllMocks();
  });

  describe("integração desativada", () => {
    it("usa a agenda interna normalmente, sem chamar o Google", async () => {
      const client = await createClient();
      const service = await createService();
      const a = await createBooking({ clientId: client.id, serviceId: service.id, startAt: nextDayAt(10, 0) });
      expect(a.googleSyncStatus).toBe("NAO_CONECTADO");
      expect(fake.calls).toEqual([]);
    });
  });

  describe("integração conectada", () => {
    beforeEach(async () => {
      await connectGoogle();
      __setCalendarFactoryForTests(() => fake.api);
    });

    it("sucesso: cria um evento com ID determinístico válido e guarda o vínculo", async () => {
      const client = await createClient();
      const service = await createService();
      const a = await createBooking({ clientId: client.id, serviceId: service.id, startAt: nextDayAt(10, 0) });

      const id = eventIdForAppointment(a.id);
      expect(id).toMatch(/^[a-v0-9]{5,1024}$/); // base32hex exigido pelo Google
      expect(fake.live()).toHaveLength(1);
      expect(fake.events.get(id)?.extendedProperties.private.appointmentId).toBe(a.id);

      const row = await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } });
      expect(row.googleSyncStatus).toBe("SINCRONIZADO");
      expect(row.googleEventId).toBe(id);
    });

    it("a consulta de disponibilidade acontece antes da transação e um evento ocupado bloqueia a reserva", async () => {
      const client = await createClient();
      const service = await createService({ durationMinutes: 60 });
      const startAt = nextDayAt(10, 0);
      fake.setBusy([{ start: startAt.toISOString(), end: new Date(startAt.getTime() + 3600_000).toISOString() }]);

      await expect(createBooking({ clientId: client.id, serviceId: service.id, startAt })).rejects.toBeInstanceOf(BookingConflictError);
      expect(await prisma.appointment.count()).toBe(0);
      expect(fake.calls).not.toContain("insert");
    });

    it("falha do Google na consulta: recusa a confirmação com erro tratado e não cria reserva", async () => {
      const client = await createClient();
      const service = await createService();
      fake.setFreebusyFails(true);
      await expect(
        createBooking({ clientId: client.id, serviceId: service.id, startAt: nextDayAt(10, 0) })
      ).rejects.toBeInstanceOf(CalendarUnavailableError);
      expect(await prisma.appointment.count()).toBe(0);
    });

    it("falha do Google na consulta também bloqueia a listagem de horários", async () => {
      fake.setFreebusyFails(true);
      await expect(generateSlotCandidatesForDate(dateKeyDaysAhead(2), 60)).rejects.toBeInstanceOf(CalendarUnavailableError);
    });

    it("falha do Google na consulta bloqueia a reativação e mantém a reserva cancelada", async () => {
      const client = await createClient();
      const service = await createService();
      const a = await createBooking({ clientId: client.id, serviceId: service.id, startAt: nextDayAt(10, 0) });
      await updateAppointmentStatus(a.id, "CANCELADA");
      fake.setFreebusyFails(true);
      await expect(updateAppointmentStatus(a.id, "CONFIRMADA")).rejects.toBeInstanceOf(CalendarUnavailableError);
      expect((await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("CANCELADA");
    });

    it("timeout na criação com resposta perdida: o retry reconcilia o evento existente e NÃO duplica", async () => {
      const client = await createClient();
      const service = await createService();
      // O Google grava o evento, mas a resposta se perde (timeout).
      fake.failNext("insert", { afterStore: Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }) });
      const a = await createBooking({ clientId: client.id, serviceId: service.id, startAt: nextDayAt(10, 0) });

      let row = await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } });
      expect(row.googleSyncStatus).toBe("ERRO");
      expect(fake.live()).toHaveLength(1); // o evento já existe no Google

      await retryGoogleSync(a.id);
      row = await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } });
      expect(row.googleSyncStatus).toBe("SINCRONIZADO");
      expect(row.googleEventId).toBe(eventIdForAppointment(a.id));
      expect(fake.live()).toHaveLength(1); // continua um único evento
      expect(fake.calls.filter((c) => c === "insert")).toHaveLength(2);
      expect(fake.calls).toContain("get"); // verificou a posse antes de aceitar
    });

    it("falha do Google (500) ao criar: marca ERRO e a nova tentativa cria um único evento", async () => {
      const client = await createClient();
      const service = await createService();
      fake.failNext("insert", { beforeStore: fake.err(500, "backend error") });
      const a = await createBooking({ clientId: client.id, serviceId: service.id, startAt: nextDayAt(10, 0) });
      expect((await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } })).googleSyncStatus).toBe("ERRO");
      expect(fake.live()).toHaveLength(0);

      await retryGoogleSync(a.id);
      await retryGoogleSync(a.id); // repetir não cria outro
      expect(fake.live()).toHaveLength(1);
      expect((await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } })).googleSyncStatus).toBe("SINCRONIZADO");
    });

    it("conflito de ID com evento de OUTRA reserva: não registra sucesso", async () => {
      const client = await createClient();
      const service = await createService();
      const a = await createBooking({ clientId: client.id, serviceId: service.id, startAt: nextDayAt(10, 0) });
      // Simula um evento alheio ocupando o ID (propriedade diferente).
      fake.events.set(eventIdForAppointment(a.id), { id: "x", status: "confirmed", extendedProperties: { private: { appointmentId: "outra-reserva" } } });
      await prisma.appointment.update({ where: { id: a.id }, data: { googleEventId: null, googleSyncStatus: "ERRO" } });

      await retryGoogleSync(a.id);
      const row = await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } });
      expect(row.googleSyncStatus).toBe("ERRO");
      expect(row.googleSyncError).toMatch(/não pertence/);
    });

    it("alteração atualiza o mesmo evento; cancelamento remove; reativação restaura sem duplicar", async () => {
      const client = await createClient();
      const service = await createService();
      const a = await createBooking({ clientId: client.id, serviceId: service.id, startAt: nextDayAt(10, 0) });
      const id = eventIdForAppointment(a.id);

      await retryGoogleSync(a.id); // alteração/reenvio => update do mesmo ID
      expect(fake.calls).toContain("update");
      expect(fake.live()).toHaveLength(1);

      await updateAppointmentStatus(a.id, "CANCELADA");
      expect(fake.live()).toHaveLength(0);
      expect((await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } })).googleEventId).toBeNull();

      await updateAppointmentStatus(a.id, "CONFIRMADA"); // 409 no insert -> evento cancelado é restaurado
      expect(fake.live()).toHaveLength(1);
      expect(fake.events.get(id)?.status).toBe("confirmed");
      expect((await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } })).googleSyncStatus).toBe("SINCRONIZADO");
    });

    it("cancelamento pela cliente aciona o Google Agenda e remove o evento", async () => {
      const client = await createClient();
      const service = await createService();
      const a = await createBooking({ clientId: client.id, serviceId: service.id, startAt: nextDayAt(10, 0, 3) });
      expect(fake.live()).toHaveLength(1);
      await cancelOwnBooking({ appointmentId: a.id, clientId: client.id });
      expect(fake.live()).toHaveLength(0);
      expect((await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } })).googleEventId).toBeNull();
    });

    it("cancelamento durante a criação do evento: a reserva cancelada não fica com evento vivo no Google", async () => {
      const client = await createClient();
      const service = await createService();
      fake.hooks.beforeInsertStore = async () => {
        const row = await prisma.appointment.findFirstOrThrow({ orderBy: { createdAt: "desc" } });
        await updateAppointmentStatus(row.id, "CANCELADA"); // roda inteiro (e sincroniza) no meio do insert
      };
      const a = await createBooking({ clientId: client.id, serviceId: service.id, startAt: nextDayAt(10, 0) });

      const row = await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } });
      expect(row.status).toBe("CANCELADA");
      expect(fake.live()).toHaveLength(0); // sem o re-sync final, o evento ficaria vivo e bloquearia o horário
      expect(row.googleEventId).toBeNull();
      expect(row.googleSyncStatus).toBe("SINCRONIZADO");
    });

    it("não registra nome nem celular da cliente nos logs quando o Google falha", async () => {
      const client = await createClient({ name: "Cliente Sigilosa", phone: "(11) 97777-6666" });
      const service = await createService();
      const failure = Object.assign(new Error("Backend Error"), {
        code: 500,
        config: { data: JSON.stringify({ description: "Cliente: Cliente Sigilosa\nCelular: (11) 97777-6666" }) },
      });
      fake.failNext("insert", { beforeStore: failure });
      await createBooking({ clientId: client.id, serviceId: service.id, startAt: nextDayAt(10, 0) });

      const logged = JSON.stringify((console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls);
      expect(logged).toContain("Backend Error");
      expect(logged).not.toContain("97777-6666");
      expect(logged).not.toContain("Cliente Sigilosa");
    });

    it("cancelar após criação com resposta perdida remove o evento órfão", async () => {
      const client = await createClient();
      const service = await createService();
      fake.failNext("insert", { afterStore: Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }) });
      const a = await createBooking({ clientId: client.id, serviceId: service.id, startAt: nextDayAt(10, 0) });
      expect(fake.live()).toHaveLength(1);
      await updateAppointmentStatus(a.id, "CANCELADA");
      expect(fake.live()).toHaveLength(0);
    });
  });
});
