import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, openAllWeek, createClient, createAdmin, createService, nextDayAt, dateKeyDaysAhead } from "./helpers";
import { prisma } from "@/lib/db";
import { authOptions, RATE_LIMITED_ERROR } from "@/lib/auth";
import { POST as cadastroHandler } from "@/app/api/auth/cadastro/route";
import { createBooking, cancelOwnBooking, updateAppointmentStatus, BookingConflictError } from "@/lib/booking";
import { recordAudit, recordAuditCoalesced, AUDIT_MAX_DISTINCT_ROWS_PER_WINDOW } from "@/lib/audit-log";
import { listAuditLogs, parseAuditFilters, resolveAuditRange, AUDIT_MAX_PAGE_SIZE, AUDIT_MAX_RANGE_DAYS } from "@/lib/audit-log-read";
import { shortHash } from "@/lib/security-log";
import { dateKeyInTz } from "@/lib/format";
import { RATE_LIMITS } from "@/lib/constants";
import { confirmBookingAction } from "@/app/agendar/actions";
import { upsertServiceAction, toggleServiceActiveAction } from "@/app/admin/servicos/actions";
import { saveBusinessHoursAction, addBlockedPeriodAction, deleteBlockedPeriodAction } from "@/app/admin/horarios/actions";
import { changeStatusAction } from "@/app/admin/agendamentos/actions";

// ---- Sessão simulada (o banco, o limitador e o log são REAIS) ----
let session: { id: string; role: "ADMIN" | "CLIENTE" | null } = { id: "", role: null };
vi.mock("@/lib/session", () => {
  const deny = (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  };
  return {
    requireAdmin: async () => (session.role === "ADMIN" ? { id: session.id, role: "ADMIN", name: "Admin" } : deny("/login")),
    requireClient: async () => (session.role === "CLIENTE" ? { id: session.id, role: "CLIENTE", name: "Cliente" } : deny("/login")),
    getAdminApiUser: async () => (session.role === "ADMIN" ? { id: session.id } : null),
  };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

function postCadastro(body: unknown, headers: Record<string, string> = { "Content-Type": "application/json" }) {
  return cadastroHandler(new Request("http://localhost/api/auth/cadastro", { method: "POST", headers, body: JSON.stringify(body) }));
}
const signup = (email: string) => ({ name: "Maria da Silva", email, phone: "(11) 91234-5678", password: "senhaSegura123", confirmPassword: "senhaSegura123" });

function authorizeFn() {
  const provider = authOptions.providers[0] as unknown as {
    options: { authorize: (c: Record<string, string>) => Promise<{ id: string; role: string } | null> };
  };
  return provider.options.authorize;
}

const allRows = () => prisma.auditLog.findMany({ orderBy: { createdAt: "asc" } });
const rowsOf = (action: string) => prisma.auditLog.findMany({ where: { action }, orderBy: { createdAt: "asc" } });
const redirectsTo = async (p: Promise<unknown>) => {
  await expect(p).rejects.toThrow(/REDIRECT:/);
};

beforeEach(async () => {
  await resetDb();
  session = { id: "", role: null };
});

describe("Gravação: sem dados sensíveis, com limite de tamanho e idempotente", () => {
  it("limpa o texto: sem e-mail, sem código longo, sem caracteres de controle, no máximo 200 caracteres", async () => {
    await recordAudit({
      action: "settings_changed",
      detail: `contato maria@example.com token ${"a".repeat(48)}\n‮oculto ${"x ".repeat(300)}`,
    });
    const [row] = await allRows();
    expect(row.detail).not.toContain("maria@example.com");
    expect(row.detail).not.toContain("a".repeat(32));
    expect(row.detail).toContain("[oculto]");
    expect(row.detail).not.toMatch(/[\n‮]/);
    expect((row.detail ?? "").length).toBeLessThanOrEqual(200);
  });

  it("guarda o e-mail só como hash curto e nunca em claro, em nenhuma coluna", async () => {
    await recordAudit({ action: "login_failed", result: "FALHA", subject: "Maria@Example.com " });
    const rows = await allRows();
    expect(rows[0].subjectHash).toBe(shortHash("maria@example.com"));
    expect(JSON.stringify(rows).toLowerCase()).not.toContain("maria@example.com");
  });

  it("a mesma chave de idempotência nunca gera duas linhas (nem em chamadas simultâneas)", async () => {
    await Promise.all(Array.from({ length: 8 }, () => recordAudit({ action: "booking_created", dedupeKey: "k:1", targetId: "x" })));
    expect(await prisma.auditLog.count({ where: { dedupeKey: "k:1" } })).toBe(1);
  });

  it("nunca lança, mesmo com entrada absurda (o log não pode derrubar a ação)", async () => {
    const started = Date.now();
    await expect(recordAudit({ action: "logout", actorId: "i".repeat(10_000), detail: "d".repeat(100_000) })).resolves.toBeUndefined();
    // Texto enorme e sem espaços não pode custar tempo quadrático (ReDoS) na limpeza.
    expect(Date.now() - started).toBeLessThan(2_000);
    const [row] = await allRows();
    expect(row.actorId?.length).toBeLessThanOrEqual(64);
  });

  it("agrega repetições: uma linha por (ação, quem, janela), com contador", async () => {
    for (let i = 0; i < 5; i++) await recordAuditCoalesced({ action: "login_failed", result: "FALHA", subject: "a@example.com" });
    await recordAuditCoalesced({ action: "login_failed", result: "FALHA", subject: "b@example.com" });
    const rows = await rowsOf("login_failed");
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.count).sort()).toEqual([1, 5]);
  });

  it("agrega chamadas simultâneas sem perder contagem nem duplicar a linha", async () => {
    await Promise.all(Array.from({ length: 12 }, () => recordAuditCoalesced({ action: "cron_unauthorized", result: "BLOQUEADO" })));
    const rows = await rowsOf("cron_unauthorized");
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(12);
  });

  it("teto de linhas distintas: o excedente vira UMA linha agrupada, sem identificar ninguém", async () => {
    const extra = 7;
    for (let i = 0; i < AUDIT_MAX_DISTINCT_ROWS_PER_WINDOW + extra; i++) {
      await recordAuditCoalesced({ action: "signup_blocked", result: "BLOQUEADO", subject: `atacante${i}@example.com` });
    }
    const rows = await rowsOf("signup_blocked");
    expect(rows.length).toBe(AUDIT_MAX_DISTINCT_ROWS_PER_WINDOW + 1);
    const overflow = rows.filter((r) => r.subjectHash === null);
    expect(overflow).toHaveLength(1);
    expect(overflow[0].count).toBe(extra);
  });
});

describe("Login e logout", () => {
  it("falha de senha vira 'login_failed' agregado, com hash do e-mail e sem a senha", async () => {
    const client = await createClient({ email: "ana@example.com", password: "SenhaCorreta123" });
    const authorize = authorizeFn();
    for (let i = 0; i < 3; i++) expect(await authorize({ email: "ana@example.com", password: "senha-errada-XYZ" })).toBeNull();
    expect(await authorize({ email: "ninguem@example.com", password: "outra-errada-ABC" })).toBeNull();

    const rows = await rowsOf("login_failed");
    expect(rows).toHaveLength(2);
    const ana = rows.find((r) => r.actorId === client.id)!;
    expect(ana.count).toBe(3);
    expect(ana.result).toBe("FALHA");
    expect(ana.subjectHash).toBe(shortHash("ana@example.com"));
    const dump = JSON.stringify(await allRows());
    expect(dump).not.toContain("senha-errada-XYZ");
    expect(dump).not.toContain("outra-errada-ABC");
    expect(dump).not.toContain("SenhaCorreta123");
    expect(dump).not.toContain("ana@example.com");
  });

  it("o limite de tentativas continua barrando na mesma tentativa e o bloqueio fica registrado", async () => {
    await createClient({ email: "bia@example.com", password: "SenhaCorreta123" });
    const authorize = authorizeFn();
    for (let i = 0; i < RATE_LIMITS.loginEmail; i++) expect(await authorize({ email: "bia@example.com", password: "errada-1234" })).toBeNull();
    await expect(authorize({ email: "bia@example.com", password: "SenhaCorreta123" })).rejects.toThrow(RATE_LIMITED_ERROR);
    const blocked = await rowsOf("login_blocked");
    expect(blocked).toHaveLength(1);
    expect(blocked[0].result).toBe("BLOQUEADO");
  });

  it("uma enxurrada de e-mails diferentes não faz a tabela crescer sem limite", async () => {
    const authorize = authorizeFn();
    const total = AUDIT_MAX_DISTINCT_ROWS_PER_WINDOW + 6;
    for (let i = 0; i < total; i++) await authorize({ email: `invasor${i}@example.com`, password: "tentativa-1234" });
    expect(await prisma.auditLog.count({ where: { action: "login_failed" } })).toBeLessThanOrEqual(AUDIT_MAX_DISTINCT_ROWS_PER_WINDOW + 1);
    const sum = (await rowsOf("login_failed")).reduce((acc, r) => acc + r.count, 0);
    expect(sum).toBe(total); // nada se perde: só é agrupado
  }, 120_000);

  it("login bem-sucedido (cliente e administradora) e logout viram linhas distintas, cada uma na sua categoria", async () => {
    const client = await createClient();
    const admin = await createAdmin();
    await authOptions.events!.signIn!({ user: { id: client.id, role: "CLIENTE" }, account: null, isNewUser: false } as never);
    await authOptions.events!.signIn!({ user: { id: admin.id, role: "ADMIN" }, account: null, isNewUser: false } as never);
    await authOptions.events!.signOut!({ token: { id: client.id } } as never);
    expect((await prisma.auditLog.findMany({ where: { category: "LOGIN", result: "SUCESSO" } })).map((r) => r.actorId).sort()).toEqual([client.id, admin.id].sort());
    const logout = await prisma.auditLog.findMany({ where: { category: "LOGOUT" } });
    expect(logout).toHaveLength(1);
    expect(logout[0].actorId).toBe(client.id);
    // Logout sem sessão identificável não gera linha.
    await authOptions.events!.signOut!({ token: {} } as never);
    expect(await prisma.auditLog.count({ where: { category: "LOGOUT" } })).toBe(1);
  });
});

describe("Cadastro", () => {
  it("conta criada gera 'signup_created' na mesma transação, sem e-mail nem senha no log", async () => {
    const res = await postCadastro(signup("nova@example.com"));
    expect(res.status).toBe(200);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "nova@example.com" } });
    const [row] = await rowsOf("signup_created");
    expect(row.actorId).toBe(user.id);
    expect(row.result).toBe("SUCESSO");
    const dump = JSON.stringify(await allRows());
    expect(dump).not.toContain("nova@example.com");
    expect(dump).not.toContain("senhaSegura123");
  });

  it("e-mail repetido: resposta idêntica ao visitante e linha 'signup_duplicate' agregada para a administradora", async () => {
    const first = await postCadastro(signup("dup@example.com"));
    const second = await postCadastro(signup("dup@example.com"));
    expect(await second.json()).toEqual(await first.json());
    expect(await prisma.auditLog.count({ where: { action: "signup_created" } })).toBe(1);
    expect((await rowsOf("signup_duplicate"))[0].result).toBe("FALHA");
  });

  it("recusa corpo que não é JSON (formulário de outro site): 415, nenhuma conta, nenhum log", async () => {
    const res = await cadastroHandler(
      new Request("http://localhost/api/auth/cadastro", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify(signup("csrf@example.com")),
      })
    );
    expect(res.status).toBe(415);
    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it("o limite de cadastro por e-mail continua valendo e o bloqueio é registrado", async () => {
    for (let i = 0; i < RATE_LIMITS.signupEmail; i++) expect((await postCadastro(signup("limite@example.com"))).status).toBe(200);
    const blocked = await postCadastro(signup("limite@example.com"));
    expect(blocked.status).toBe(429);
    expect((await rowsOf("signup_blocked"))[0].result).toBe("BLOQUEADO");
  });
});

describe("Marcação: registro só no commit, sem duplicar", () => {
  beforeEach(async () => {
    await openAllWeek();
  });

  it("criar, cancelar (cliente) e mudar situação (administradora) geram uma linha cada, com o autor certo", async () => {
    const client = await createClient();
    const admin = await createAdmin();
    const service = await createService({ name: "Esmaltação especial" });
    const appt = await createBooking({ clientId: client.id, serviceId: service.id, startAt: nextDayAt(10, 0, 3) });

    const created = await rowsOf("booking_created");
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ category: "MARCACAO", actorId: client.id, targetType: "Appointment", targetId: appt.id, result: "SUCESSO" });
    expect(created[0].detail).toContain("Esmaltação especial");
    expect(JSON.stringify(created)).not.toContain(client.email);
    expect(JSON.stringify(created)).not.toContain(client.phone);

    await cancelOwnBooking({ appointmentId: appt.id, clientId: client.id });
    expect((await rowsOf("booking_canceled_by_client"))[0].actorId).toBe(client.id);

    await updateAppointmentStatus(appt.id, "CONFIRMADA", admin.id); // reativa
    const changed = await rowsOf("booking_status_changed");
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({ actorId: admin.id, detail: "De Cancelada para Confirmada" });

    // Repetir o MESMO estado não muda nada: nenhuma linha nova.
    await updateAppointmentStatus(appt.id, "CONFIRMADA", admin.id);
    expect(await prisma.auditLog.count({ where: { action: "booking_status_changed" } })).toBe(1);
  });

  it("reserva recusada por conflito não deixa log; só a vencedora da corrida é registrada", async () => {
    const a = await createClient();
    const b = await createClient();
    const service = await createService();
    const startAt = nextDayAt(14, 0, 2);
    const results = await Promise.allSettled([
      createBooking({ clientId: a.id, serviceId: service.id, startAt }),
      createBooking({ clientId: b.id, serviceId: service.id, startAt }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: expect.any(BookingConflictError) });
    expect(await prisma.auditLog.count({ where: { action: "booking_created" } })).toBe(1);
    expect(await prisma.appointment.count()).toBe(1);
  });

  it("cancelamento recusado (outra cliente) não gera log", async () => {
    const owner = await createClient();
    const other = await createClient();
    const service = await createService();
    const appt = await createBooking({ clientId: owner.id, serviceId: service.id, startAt: nextDayAt(9, 0, 4) });
    await expect(cancelOwnBooking({ appointmentId: appt.id, clientId: other.id })).rejects.toThrow();
    expect(await prisma.auditLog.count({ where: { action: "booking_canceled_by_client" } })).toBe(0);
  });
});

describe("Limite de pedidos de reserva (correção)", () => {
  it("a cliente que repete pedidos de reserva é barrada no limite, e o bloqueio fica registrado uma vez", async () => {
    const client = await createClient();
    session = { id: client.id, role: "CLIENTE" };
    const fd = () => {
      const f = new FormData();
      f.set("serviceId", "servico-que-nao-existe");
      f.set("startAtIso", nextDayAt(10, 0).toISOString());
      return f;
    };
    for (let i = 0; i < RATE_LIMITS.bookingWritesPerMinute; i++) {
      const r = await confirmBookingAction(null, fd());
      expect(r?.error).not.toContain("Muitos pedidos");
    }
    for (let i = 0; i < 3; i++) expect((await confirmBookingAction(null, fd()))?.error).toContain("Muitos pedidos");
    const rows = await rowsOf("booking_rate_limited");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorId: client.id, result: "BLOQUEADO", count: 3 });
  });
});

describe("Ações administrativas", () => {
  it("serviço criado, alterado e (des)ativado: uma linha cada, com a administradora como autora", async () => {
    const admin = await createAdmin();
    session = { id: admin.id, role: "ADMIN" };
    const form = (name: string, id?: string) => {
      const f = new FormData();
      if (id) f.set("id", id);
      f.set("name", name);
      f.set("priceReais", "40,00");
      f.set("durationMinutes", "45");
      f.set("active", "on");
      return f;
    };
    await redirectsTo(upsertServiceAction(null, form("Manicure nova")));
    const service = await prisma.service.findFirstOrThrow({ where: { name: "Manicure nova" } });
    await redirectsTo(upsertServiceAction(null, form("Manicure renomeada", service.id)));
    await toggleServiceActiveAction(service.id, false);

    const rows = await prisma.auditLog.findMany({ where: { category: "ADMIN" }, orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => r.action)).toEqual(["service_created", "service_updated", "service_toggled"]);
    expect(rows.every((r) => r.actorId === admin.id && r.targetId === service.id)).toBe(true);
  });

  it("expediente e bloqueios: registrados, e o motivo digitado (texto livre) NÃO vai para o log", async () => {
    const admin = await createAdmin();
    session = { id: admin.id, role: "ADMIN" };
    const hours = new FormData();
    for (let d = 0; d <= 6; d++) {
      hours.set(`active-${d}`, "on");
      hours.set(`startTime-${d}`, "09:00");
      hours.set(`endTime-${d}`, "18:00");
    }
    expect(await saveBusinessHoursAction(null, hours)).toEqual({ ok: true });

    const block = new FormData();
    block.set("date", dateKeyDaysAhead(10));
    block.set("startTime", "09:00");
    block.set("endTime", "10:00");
    block.set("reason", "consulta medica de Maria 11 91234-5678");
    expect(await addBlockedPeriodAction(null, block)).toEqual({ ok: true });
    const period = await prisma.blockedPeriod.findFirstOrThrow();
    await deleteBlockedPeriodAction(period.id);
    await deleteBlockedPeriodAction(period.id); // repetido: nada a remover, nada a registrar

    const rows = await prisma.auditLog.findMany({ where: { category: "ADMIN" }, orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => r.action)).toEqual(["business_hours_saved", "blocked_period_created", "blocked_period_deleted"]);
    expect(JSON.stringify(rows)).not.toContain("Maria");
    expect(JSON.stringify(rows)).not.toContain("91234");
  });

  it("mudança de situação pelo painel registra a administradora como autora", async () => {
    const admin = await createAdmin();
    const client = await createClient();
    const service = await createService();
    await openAllWeek();
    const appt = await createBooking({ clientId: client.id, serviceId: service.id, startAt: nextDayAt(11, 0, 5) });
    session = { id: admin.id, role: "ADMIN" };
    expect(await changeStatusAction(appt.id, "CANCELADA")).toEqual({ ok: true });
    expect((await rowsOf("booking_status_changed"))[0]).toMatchObject({ actorId: admin.id, detail: "De Confirmada para Cancelada" });
  });

  it("quem não é administradora não executa a ação nem deixa log", async () => {
    const client = await createClient();
    session = { id: client.id, role: "CLIENTE" };
    const f = new FormData();
    f.set("name", "Serviço invasor");
    f.set("priceReais", "1,00");
    f.set("durationMinutes", "30");
    await expect(upsertServiceAction(null, f)).rejects.toThrow(/REDIRECT:/);
    expect(await prisma.service.count()).toBe(0);
    expect(await prisma.auditLog.count()).toBe(0);
  });
});

describe("Leitura dos logs: autorização, filtros, paginação", () => {
  const baseFilters = () => parseAuditFilters({}, dateKeyInTz(new Date()));

  it("sem sessão ou com sessão de cliente a consulta é recusada ANTES de ler o banco", async () => {
    await recordAudit({ action: "signup_created", actorId: "u1" });
    session = { id: "", role: null };
    await expect(listAuditLogs({ ...baseFilters(), category: "CADASTRO" })).rejects.toThrow(/REDIRECT:/);
    const client = await createClient();
    session = { id: client.id, role: "CLIENTE" };
    await expect(listAuditLogs({ ...baseFilters(), category: "CADASTRO" })).rejects.toThrow(/REDIRECT:/);
  });

  it("administradora vê cada categoria separada, mais recentes primeiro, com nomes e sem e-mail ou celular", async () => {
    const admin = await createAdmin();
    const client = await createClient({ name: "Cliente Visível", email: "visivel@example.com", phone: "(11) 98888-7777" });
    session = { id: admin.id, role: "ADMIN" };
    const old = new Date(Date.now() - 3600_000);
    await prisma.auditLog.create({ data: { category: "LOGIN", action: "login_success", result: "SUCESSO", actorId: client.id, occurredAt: old, createdAt: old } });
    await recordAudit({ action: "login_failed", result: "FALHA", subject: "visivel@example.com" });
    await recordAudit({ action: "logout", actorId: client.id });
    await recordAudit({ action: "signup_created", actorId: client.id });

    const login = await listAuditLogs({ ...baseFilters(), category: "LOGIN" });
    expect(login.items.map((r) => r.action)).toEqual(["login_failed", "login_success"]); // mais recente primeiro
    expect(login.items[1].actor).toBe("Cliente Visível (cliente)");
    expect(login.items[0].actor).toContain(shortHash("visivel@example.com"));
    expect((await listAuditLogs({ ...baseFilters(), category: "LOGOUT" })).items.map((r) => r.action)).toEqual(["logout"]);
    expect((await listAuditLogs({ ...baseFilters(), category: "CADASTRO" })).items.map((r) => r.action)).toEqual(["signup_created"]);
    const dump = JSON.stringify(login);
    expect(dump).not.toContain("visivel@example.com");
    expect(dump).not.toContain("98888");
  });

  it("filtra por resultado e por usuário (nome, ou e-mail completo, que também acha tentativas sem conta)", async () => {
    const admin = await createAdmin();
    const ana = await createClient({ name: "Ana Souza", email: "ana2@example.com" });
    const bia = await createClient({ name: "Bia Lima", email: "bia2@example.com" });
    session = { id: admin.id, role: "ADMIN" };
    await recordAudit({ action: "login_success", actorId: ana.id });
    await recordAudit({ action: "login_success", actorId: bia.id });
    await recordAuditCoalesced({ action: "login_failed", result: "FALHA", subject: "ana2@example.com" });
    await recordAuditCoalesced({ action: "login_failed", result: "FALHA", subject: "outra@example.com" });

    const f = baseFilters();
    expect((await listAuditLogs({ ...f, category: "LOGIN", result: "FALHA" })).total).toBe(2);
    expect((await listAuditLogs({ ...f, category: "LOGIN", result: "SUCESSO" })).total).toBe(2);
    const byName = await listAuditLogs({ ...f, category: "LOGIN", usuario: "ana sou" });
    expect(byName.items.map((r) => r.actor)).toEqual(["Ana Souza (cliente)"]);
    const byEmail = await listAuditLogs({ ...f, category: "LOGIN", usuario: "ANA2@example.com" });
    expect(byEmail.total).toBe(2); // o login da conta + a tentativa recusada com esse e-mail
    expect((await listAuditLogs({ ...f, category: "LOGIN", usuario: "ninguem existe" })).total).toBe(0);
  });

  it("filtra por período e limita o intervalo máximo", async () => {
    const admin = await createAdmin();
    session = { id: admin.id, role: "ADMIN" };
    const longAgo = new Date(Date.now() - 100 * 86_400_000);
    await prisma.auditLog.create({ data: { category: "LOGOUT", action: "logout", result: "SUCESSO", occurredAt: longAgo, createdAt: longAgo } });
    await recordAudit({ action: "logout", actorId: "u" });

    expect((await listAuditLogs({ ...baseFilters(), category: "LOGOUT" })).total).toBe(1); // padrão: últimos 30 dias
    const today = dateKeyInTz(new Date());
    const wide = parseAuditFilters({ de: "2000-01-01", ate: today }, today);
    expect(wide.clamped).toBe(true);
    const days = (Date.parse(wide.toKey) - Date.parse(wide.fromKey)) / 86_400_000 + 1;
    expect(days).toBe(AUDIT_MAX_RANGE_DAYS);
    const old = dateKeyInTz(longAgo);
    const range = parseAuditFilters({ de: old, ate: old }, today);
    expect((await listAuditLogs({ ...range, category: "LOGOUT" })).total).toBe(1);
  });

  it("pagina com tamanho limitado (mesmo pedindo mais), sem repetir nem perder linhas", async () => {
    const admin = await createAdmin();
    session = { id: admin.id, role: "ADMIN" };
    const base = Date.now();
    await prisma.auditLog.createMany({
      data: Array.from({ length: 60 }, (_, i) => ({
        category: "LOGOUT",
        action: "logout",
        result: "SUCESSO",
        occurredAt: new Date(base - i * 1000),
        createdAt: new Date(base - i * 1000),
      })),
    });
    const f = { ...baseFilters(), category: "LOGOUT" as const };
    const huge = await listAuditLogs({ ...f, page: 1, pageSize: 100_000 });
    expect(huge.items).toHaveLength(AUDIT_MAX_PAGE_SIZE);
    const p2 = await listAuditLogs({ ...f, page: 2, pageSize: 100_000 });
    expect(p2.items).toHaveLength(60 - AUDIT_MAX_PAGE_SIZE);
    const ids = [...huge.items, ...p2.items].map((r) => r.id);
    expect(new Set(ids).size).toBe(60);
    const times = [...huge.items, ...p2.items].map((r) => r.occurredAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect((await listAuditLogs({ ...f, page: 999, pageSize: 100_000 })).page).toBe(huge.pageCount); // página além do fim -> última
    expect((await listAuditLogs({ ...f, pageSize: -5 })).items.length).toBeGreaterThan(0);
  });

  it("filtros inválidos da URL caem no padrão (aba, resultado, página, usuário)", () => {
    const today = "2026-11-16";
    const f = parseAuditFilters({ aba: "ADMIN'; DROP TABLE", resultado: "QUALQUER", pagina: "-3", usuario: `  Ana\u0000\n${"x".repeat(500)}`, de: "lixo", ate: "2026-13-99" }, today);
    expect(f.category).toBe("CADASTRO");
    expect(f.result).toBeUndefined();
    expect(f.page).toBe(1);
    expect(f.usuario.length).toBeLessThanOrEqual(100);
    expect(f.usuario).not.toMatch(/[\u0000\n]/);
    expect(resolveAuditRange("lixo", "lixo", today).toKey).toBe(today);
  });
});
