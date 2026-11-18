import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, openAllWeek, createAdmin, createClient, createService, nextDayAt } from "./helpers";
import { prisma } from "@/lib/db";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import {
  __setCalendarFactoryForTests,
  CalendarUnavailableError,
  disconnectGoogleCalendar,
  fetchExternalBusy,
  getFreeBusyIntervals,
  GoogleAccountConflictError,
  handleGoogleOAuthCallback,
  isGoogleCalendarConnected,
  persistRefreshedTokens,
  syncAppointmentToGoogle,
} from "@/lib/google-calendar";
import { createBooking } from "./helpers";
import { makeFakeCalendar } from "./fake-calendar";

// Google simulado: nenhuma chamada real. O cliente OAuth é um EventEmitter, como o de verdade, e o `freebusy`
// dispara os eventos "tokens" combinados no teste (a renovação que o SDK faz ao usar a conexão).
const g = vi.hoisted(() => ({
  tokensToEmit: [] as Array<Record<string, unknown>>,
  getTokenResult: {} as Record<string, unknown>,
  seenCredentials: [] as Array<Record<string, unknown>>,
}));
vi.mock("googleapis", async () => {
  const { EventEmitter } = await import("node:events");
  class OAuth2 extends EventEmitter {
    setCredentials(c: Record<string, unknown>) {
      g.seenCredentials.push(c);
    }
    async getToken() {
      return { tokens: g.getTokenResult };
    }
  }
  return {
    google: {
      auth: { OAuth2 },
      calendar: ({ auth }: { auth: InstanceType<typeof OAuth2> }) => ({
        freebusy: {
          query: async (req: { requestBody: { items: { id: string }[] } }) => {
            for (const t of g.tokensToEmit) auth.emit("tokens", t);
            return { data: { calendars: { [req.requestBody.items[0].id]: { busy: [] } } } };
          },
        },
        events: {},
      }),
    },
  };
});

const HOUR = 3600_000;
async function addAccount(adminId?: string, over: Partial<{ calendarId: string; refresh: string; access: string; expiry: Date }> = {}) {
  const id = adminId ?? (await createAdmin()).id;
  return prisma.googleCalendarAccount.create({
    data: {
      adminUserId: id,
      accessToken: encryptSecret(over.access ?? "access-original"),
      refreshToken: encryptSecret(over.refresh ?? "refresh-original"),
      expiryDate: over.expiry ?? new Date(Date.now() + HOUR),
      calendarId: over.calendarId ?? "primary",
    },
  });
}
const reload = (id: string) => prisma.googleCalendarAccount.findUniqueOrThrow({ where: { id } });
const range = () => [new Date(Date.now() + 86_400_000), new Date(Date.now() + 2 * 86_400_000)] as const;

describe("Google Agenda: conexão única e seleção determinística (achado 5)", () => {
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

  it("uma conta: é a usada, com o calendário dela", async () => {
    await addAccount(undefined, { calendarId: "agenda-da-garage@group.calendar.google.com" });
    await getFreeBusyIntervals(...range());
    expect(fake.api.freebusy.query.mock.calls[0][0].requestBody.items).toEqual([{ id: "agenda-da-garage@group.calendar.google.com" }]);
  });

  it("nenhuma conta: não está conectado e a agenda externa é vazia, sem chamar o Google", async () => {
    expect(await isGoogleCalendarConnected()).toBe(false);
    expect(await fetchExternalBusy(...range())).toEqual([]);
    expect(fake.calls).toEqual([]);
  });

  it("duas contas (dados antigos): NENHUMA é usada — falha fechada, sem escolher uma por engano", async () => {
    await addAccount(undefined, { calendarId: "conta-a" });
    await addAccount(undefined, { calendarId: "conta-b" });

    expect(await isGoogleCalendarConnected()).toBe(true); // há conexão; só que ambígua
    await expect(getFreeBusyIntervals(...range())).rejects.toBeInstanceOf(CalendarUnavailableError);
    await expect(fetchExternalBusy(...range())).rejects.toBeInstanceOf(CalendarUnavailableError);
    await expect(fetchExternalBusy(...range(), prisma, { allowCache: true })).rejects.toBeInstanceOf(CalendarUnavailableError);
    expect(fake.calls).toEqual([]); // nem a conta A nem a B foi consultada
  });

  it("com conexão ambígua, uma reserva é recusada e nada é criado", async () => {
    await addAccount();
    await addAccount();
    const client = await createClient();
    const service = await createService();
    await expect(createBooking({ clientId: client.id, serviceId: service.id, startAt: nextDayAt(10, 0) })).rejects.toBeInstanceOf(CalendarUnavailableError);
    expect(await prisma.appointment.count()).toBe(0);
    expect(fake.calls).toEqual([]);
  });

  it("com conexão ambígua, a sincronização registra ERRO na reserva (visível no painel) e não chama o Google", async () => {
    const client = await createClient();
    const service = await createService();
    const a = await prisma.appointment.create({
      data: {
        clientId: client.id, serviceId: service.id, serviceName: "Lavagem", priceCents: 4000, durationMinutes: 30,
        startAt: nextDayAt(10, 0), endAt: nextDayAt(10, 30), googleSyncStatus: "PENDENTE",
      },
    });
    await addAccount();
    await addAccount();

    await syncAppointmentToGoogle({ id: a.id });
    const row = await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.googleSyncStatus).toBe("ERRO");
    expect(row.googleSyncError).toMatch(/mais de uma conta/i);
    expect(row.googleSyncAttempts).toBe(1);
    expect(row.googleSyncNextAt).not.toBeNull();
    expect(fake.calls).toEqual([]);
  });

  it("desconectar sem argumento remove todas as conexões e resolve a ambiguidade", async () => {
    await addAccount();
    await addAccount();
    await disconnectGoogleCalendar();
    expect(await prisma.googleCalendarAccount.count()).toBe(0);
    expect(await isGoogleCalendarConnected()).toBe(false);
  });

  it("desconectar com o id de uma administradora remove só a dela", async () => {
    const keep = await addAccount();
    const other = await addAccount();
    await disconnectGoogleCalendar(other.adminUserId);
    expect((await prisma.googleCalendarAccount.findMany()).map((a) => a.id)).toEqual([keep.id]);
  });
});

describe("Google Agenda: conectar (OAuth) respeita a conexão única", () => {
  const prevEnv = { ...process.env };
  beforeEach(async () => {
    await resetDb();
    process.env.GOOGLE_CLIENT_ID = "id";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    process.env.GOOGLE_REDIRECT_URI = "http://localhost/callback";
    g.getTokenResult = { access_token: "novo-access", refresh_token: "novo-refresh", expiry_date: Date.now() + HOUR };
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    process.env = { ...prevEnv };
    vi.restoreAllMocks();
  });

  it("primeira conexão grava os tokens cifrados", async () => {
    const admin = await createAdmin();
    await handleGoogleOAuthCallback(admin.id, "codigo");
    const row = await prisma.googleCalendarAccount.findUniqueOrThrow({ where: { adminUserId: admin.id } });
    expect(row.refreshToken).not.toContain("novo-refresh");
    expect(decryptSecret(row.refreshToken)).toBe("novo-refresh");
    expect(decryptSecret(row.accessToken)).toBe("novo-access");
  });

  it("a mesma administradora reconectando substitui a própria conta (continua 1 linha)", async () => {
    const admin = await createAdmin();
    await addAccount(admin.id);
    await handleGoogleOAuthCallback(admin.id, "codigo");
    expect(await prisma.googleCalendarAccount.count()).toBe(1);
    expect(decryptSecret((await prisma.googleCalendarAccount.findFirstOrThrow()).refreshToken)).toBe("novo-refresh");
  });

  it("OUTRA administradora conectando enquanto já existe uma conta: recusado, nada muda", async () => {
    const first = await addAccount();
    const second = await createAdmin();
    await expect(handleGoogleOAuthCallback(second.id, "codigo")).rejects.toBeInstanceOf(GoogleAccountConflictError);
    const rows = await prisma.googleCalendarAccount.findMany();
    expect(rows.map((r) => r.id)).toEqual([first.id]);
    expect(decryptSecret(rows[0].refreshToken)).toBe("refresh-original"); // a conta existente não foi tocada
  });
});

describe("Google Agenda: refresh token renovado é persistido (achado 6)", () => {
  const prevEnv = { ...process.env };
  beforeEach(async () => {
    await resetDb();
    process.env.GOOGLE_CLIENT_ID = "id";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    process.env.GOOGLE_REDIRECT_URI = "http://localhost/callback";
    g.tokensToEmit = [];
    g.seenCredentials = [];
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    process.env = { ...prevEnv };
    vi.restoreAllMocks();
  });

  it("ponta a ponta: o evento 'tokens' do cliente OAuth grava o novo refresh_token (cifrado) na conexão correta", async () => {
    const acc = await addAccount();
    g.tokensToEmit = [{ access_token: "access-novo", refresh_token: "refresh-rotacionado", expiry_date: Date.now() + 2 * HOUR }];

    await getFreeBusyIntervals(...range()); // usa o cliente OAuth real do código, com o SDK simulado
    expect(g.seenCredentials[0]).toMatchObject({ refresh_token: "refresh-original", access_token: "access-original" });

    await vi.waitFor(async () => expect(decryptSecret((await reload(acc.id)).refreshToken)).toBe("refresh-rotacionado"));
    const row = await reload(acc.id);
    expect(decryptSecret(row.accessToken)).toBe("access-novo");
    expect(row.refreshToken).not.toContain("refresh-rotacionado"); // continua cifrado no banco
  });

  it("evento sem refresh_token: mantém o guardado e só atualiza o access token e a validade", async () => {
    const acc = await addAccount();
    const expiry = Date.now() + 2 * HOUR;
    await persistRefreshedTokens(acc.id, { access_token: "access-novo", expiry_date: expiry });
    const row = await reload(acc.id);
    expect(decryptSecret(row.refreshToken)).toBe("refresh-original");
    expect(decryptSecret(row.accessToken)).toBe("access-novo");
    expect(row.expiryDate.getTime()).toBe(expiry);
  });

  it("evento só com refresh_token (sem access token): grava o refresh e preserva o resto", async () => {
    const acc = await addAccount();
    const before = await reload(acc.id);
    await persistRefreshedTokens(acc.id, { refresh_token: "refresh-rotacionado" });
    const row = await reload(acc.id);
    expect(decryptSecret(row.refreshToken)).toBe("refresh-rotacionado");
    expect(row.accessToken).toBe(before.accessToken);
    expect(row.expiryDate.getTime()).toBe(before.expiryDate.getTime());
  });

  it("atualiza SÓ a conexão do evento (outra linha, mesmo ambígua, não é tocada)", async () => {
    const a = await addAccount();
    const b = await addAccount(undefined, { refresh: "refresh-da-outra" });
    await persistRefreshedTokens(a.id, { access_token: "x", refresh_token: "refresh-rotacionado", expiry_date: Date.now() + 2 * HOUR });
    expect(decryptSecret((await reload(b.id)).refreshToken)).toBe("refresh-da-outra");
    expect((await reload(b.id)).accessToken).toBe(b.accessToken);
  });

  it("renovações simultâneas: um evento atrasado (validade menor) não sobrescreve o access token mais novo", async () => {
    const acc = await addAccount();
    const newer = Date.now() + 3 * HOUR;
    const older = Date.now() + 2 * HOUR;
    // O mais novo grava primeiro; o atrasado chega depois (ou ao mesmo tempo).
    await Promise.all([
      persistRefreshedTokens(acc.id, { access_token: "access-mais-novo", expiry_date: newer }),
      persistRefreshedTokens(acc.id, { access_token: "access-atrasado", expiry_date: older }),
    ]);
    await persistRefreshedTokens(acc.id, { access_token: "access-atrasado-2", expiry_date: older });
    const row = await reload(acc.id);
    expect(decryptSecret(row.accessToken)).toBe("access-mais-novo");
    expect(row.expiryDate.getTime()).toBe(newer);
  });

  it("falha ao gravar não lança e não registra token, mensagem do banco nem valor cifrado", async () => {
    const secretMessage = "falha com refresh-super-secreto e access-super-secreto";
    const failing = {
      googleCalendarAccount: {
        updateMany: vi.fn().mockRejectedValue(Object.assign(new Error(secretMessage), { name: "PrismaClientKnownRequestError", code: "P2034" })),
      },
    } as never;
    const spy = vi.spyOn(console, "error");

    await expect(
      persistRefreshedTokens("id", { access_token: "access-super-secreto", refresh_token: "refresh-super-secreto", expiry_date: Date.now() + HOUR }, failing)
    ).resolves.toBeUndefined();

    const logged = spy.mock.calls.flat().map(String).join("\n");
    expect(logged).toMatch(/PrismaClientKnownRequestError \(P2034\)/);
    for (const leak of ["refresh-super-secreto", "access-super-secreto", secretMessage]) expect(logged).not.toContain(leak);
  });
});
