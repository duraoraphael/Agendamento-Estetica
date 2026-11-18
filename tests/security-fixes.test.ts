import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, openAllWeek, createClient, createAdmin, createService } from "./helpers";
import { prisma } from "@/lib/db";
import { readJsonLimited, TOO_LARGE } from "@/lib/body-limit";
import { securityLog, shortHash } from "@/lib/security-log";
import { authOptions } from "@/lib/auth";
import { POST as cadastro } from "@/app/api/auth/cadastro/route";
import { RATE_LIMITS } from "@/lib/constants";

// A ação de horários exige sessão de cliente; aqui simulamos só a sessão (o limitador e o banco são reais).
let sessionUserId = "u-slots";
vi.mock("@/lib/session", () => ({
  requireClient: async () => ({ id: sessionUserId, role: "CLIENTE", name: "Cliente" }),
}));

const post = (body: BodyInit, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/auth/cadastro", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body });

describe("Corpo de requisição limitado (L11)", () => {
  it("aceita JSON pequeno e devolve null para JSON inválido", async () => {
    expect(await readJsonLimited(post(JSON.stringify({ a: 1 })), 10_000)).toEqual({ a: 1 });
    expect(await readJsonLimited(post("{não é json"), 10_000)).toBeNull();
    expect(await readJsonLimited(new Request("http://x", { method: "POST" }), 10_000)).toBeNull();
  });

  it("recusa corpo grande pelo Content-Length, sem ler o corpo", async () => {
    const big = "x".repeat(50_000);
    expect(await readJsonLimited(post(JSON.stringify({ big })), 10_000)).toBe(TOO_LARGE);
  });

  it("recusa corpo grande MESMO sem Content-Length (streaming) e para de ler ao passar do limite", async () => {
    let chunksRead = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunksRead += 1;
        controller.enqueue(new TextEncoder().encode("x".repeat(4000)));
        if (chunksRead >= 1000) controller.close(); // 4 MB no total, se alguém lesse tudo
      },
    });
    const req = new Request("http://localhost/api/auth/cadastro", { method: "POST", body: stream, duplex: "half" } as RequestInit);
    expect(await readJsonLimited(req, 10_000)).toBe(TOO_LARGE);
    expect(chunksRead).toBeLessThan(20); // abortou cedo
  });

  it("o cadastro responde 413 para corpo grande e não cria conta; o normal continua funcionando", async () => {
    await resetDb();
    const huge = JSON.stringify({ name: "A".repeat(200_000) + " B", email: "grande@example.com", phone: "(11) 91234-5678", password: "Tulipa-Rosa-42", confirmPassword: "Tulipa-Rosa-42" });
    const res = await cadastro(post(huge));
    expect(res.status).toBe(413);
    expect(await prisma.user.count()).toBe(0);

    const ok = await cadastro(post(JSON.stringify({ name: "Maria Silva", email: "maria.ok@example.com", phone: "(11) 91234-5678", password: "Tulipa-Rosa-42", confirmPassword: "Tulipa-Rosa-42", consent: true })));
    expect(ok.status).toBe(200);
  });
});

describe("Limite de consultas de horários por cliente (M1)", () => {
  beforeEach(async () => {
    await resetDb();
    await openAllWeek();
  });

  it(`a consulta ${RATE_LIMITS.slotsPerMinute + 1} no mesmo minuto é barrada; outra cliente não é afetada`, async () => {
    const { getAvailableSlotsAction } = await import("@/app/agendar/actions");
    const svc = await createService({ durationMinutes: 30 });
    const key = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(Date.now() + 3 * 86_400_000));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    sessionUserId = "cliente-abusiva";
    for (let i = 0; i < RATE_LIMITS.slotsPerMinute; i++) {
      const r = await getAvailableSlotsAction(svc.id, key);
      expect("error" in r ? r.error : "").not.toMatch(/Muitas consultas/);
    }
    const blocked = await getAvailableSlotsAction(svc.id, key);
    expect(blocked).toEqual({ error: "Muitas consultas seguidas. Aguarde um instante e tente novamente." });
    expect(warn.mock.calls.map((c) => String(c[0])).some((l) => l.includes("slots_rate_limited"))).toBe(true);

    sessionUserId = "cliente-normal";
    const other = await getAvailableSlotsAction(svc.id, key);
    expect("slots" in other).toBe(true);
    warn.mockRestore();
  });
});

describe("Log de eventos de segurança (M8): sem dados pessoais", () => {
  let lines: string[];
  beforeEach(async () => {
    await resetDb();
    lines = [];
    vi.spyOn(console, "warn").mockImplementation((l: unknown) => void lines.push(String(l)));
  });
  afterEach(() => vi.restoreAllMocks());

  const authorize = (email: string, password: string) => (authOptions.providers[0] as any).options.authorize({ email, password }, { headers: {} });

  it("cada linha é JSON com evento e carimbo de tempo", () => {
    securityLog("login_failed", { emailHash: shortHash("A@b.com") });
    const e = JSON.parse(lines[0]);
    expect(e).toMatchObject({ kind: "security", event: "login_failed" });
    expect(new Date(e.ts).getTime()).toBeGreaterThan(0);
    expect(shortHash(" A@B.com ")).toBe(shortHash("a@b.com")); // normaliza como o limitador
  });

  it("login falho, bloqueio e login de ADMIN são registrados SEM e-mail, senha ou nome", async () => {
    const c = await createClient({ email: "pessoa.secreta@example.com", name: "Pessoa Secreta", phone: "(11) 97777-1234", password: "SenhaBoa#2026" });
    const admin = await createAdmin({ email: "dona.admin@example.com", password: "AdminBoa#2026" });

    for (let i = 0; i < RATE_LIMITS.loginEmail; i++) await authorize(c.email, "senha-errada-" + i);
    await expect(authorize(c.email, c.plainPassword)).rejects.toThrow(); // 6ª tentativa: bloqueada
    expect(await authorize(admin.email, admin.plainPassword)).not.toBeNull();

    const events = lines.map((l) => JSON.parse(l).event);
    expect(events.filter((e) => e === "login_failed")).toHaveLength(RATE_LIMITS.loginEmail);
    expect(events).toContain("login_blocked");
    expect(events).toContain("admin_login");

    const all = lines.join("\n");
    for (const secret of ["pessoa.secreta@example.com", "Pessoa Secreta", "97777-1234", "senha-errada", "SenhaBoa#2026", "AdminBoa#2026", "dona.admin@example.com"]) {
      expect(all, `vazou: ${secret}`).not.toContain(secret);
    }
  });
});
