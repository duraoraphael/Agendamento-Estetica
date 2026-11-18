import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { resetDb, createClient } from "./helpers";
import { prisma } from "@/lib/db";
import { __setMailTransportForTests, type MailMessage } from "@/lib/mailer";
import {
  buildResetLink,
  changeOwnPassword,
  generateResetToken,
  hashResetToken,
  isResetTokenUsable,
  issueResetToken,
  redeemResetToken,
  requestPasswordResetFor,
  RESET_TOKEN_TTL_MINUTES,
} from "@/lib/password-reset";
import { passwordResetSchema, passwordResetRequestSchema, changePasswordSchema } from "@/lib/validation";

const NEW_PASSWORD = "Nova#Senha2026";

describe("Recuperação de senha", () => {
  let sent: MailMessage[];

  beforeEach(async () => {
    await resetDb();
    sent = [];
    __setMailTransportForTests(async (m) => {
      sent.push(m);
      return { ok: true };
    });
    process.env.NEXTAUTH_URL = "https://garagezerozero.example.com/";
  });

  afterEach(() => {
    __setMailTransportForTests(null);
    vi.restoreAllMocks();
  });

  it("o token é aleatório e forte, e no banco fica SÓ o hash (SHA-256)", async () => {
    const a = generateResetToken();
    const b = generateResetToken();
    expect(a.token).not.toBe(b.token);
    expect(a.token.length).toBeGreaterThanOrEqual(43); // 32 bytes em base64url
    expect(a.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.tokenHash).toBe(hashResetToken(a.token));

    const u = await createClient();
    const token = await issueResetToken(u.id);
    const rows = await prisma.passwordResetToken.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(hashResetToken(token));
    expect(JSON.stringify(rows)).not.toContain(token);
    // validade curta
    const ttl = rows[0].expiresAt.getTime() - rows[0].createdAt.getTime();
    expect(ttl).toBeGreaterThan((RESET_TOKEN_TTL_MINUTES - 1) * 60_000);
    expect(ttl).toBeLessThanOrEqual(RESET_TOKEN_TTL_MINUTES * 60_000 + 1000);
  });

  it("e-mail desconhecido: nada é criado nem enviado (e nada quebra)", async () => {
    await requestPasswordResetFor("ninguem@example.com");
    expect(await prisma.passwordResetToken.count()).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("e-mail conhecido: gera 1 token, envia o link (base = NEXTAUTH_URL) e não registra o token em log nem na auditoria", async () => {
    const u = await createClient();
    const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error"), vi.spyOn(console, "info")].map((s) => s.mockImplementation(() => {}));
    await requestPasswordResetFor(u.email);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(u.email);
    const token = new URL(sent[0].text.match(/https?:\/\/\S+/)![0]).searchParams.get("token")!;
    expect(sent[0].text).toContain("https://garagezerozero.example.com/redefinir-senha?token=");
    expect(token.length).toBeGreaterThanOrEqual(43);

    const logged = spies.flatMap((s) => s.mock.calls.map((c) => c.join(" "))).join("\n");
    expect(logged).not.toContain(token);
    const audit = JSON.stringify(await prisma.auditLog.findMany());
    for (const secret of [token, u.email, u.phone]) expect(audit).not.toContain(secret);
    expect((await prisma.auditLog.findMany({ where: { action: "password_reset_requested" } })).length).toBe(1);
  });

  it("o link nunca usa o cabeçalho Host: a base vem da configuração", () => {
    expect(buildResetLink("abc")).toBe("https://garagezerozero.example.com/redefinir-senha?token=abc");
  });

  it("pedir um novo link invalida os anteriores", async () => {
    const u = await createClient();
    const first = await issueResetToken(u.id);
    expect(await isResetTokenUsable(first)).toBe(true);
    const second = await issueResetToken(u.id);
    expect(await isResetTokenUsable(first)).toBe(false);
    expect(await isResetTokenUsable(second)).toBe(true);
    expect((await redeemResetToken(first, NEW_PASSWORD)).ok).toBe(false);
  });

  it("redefinir: troca a senha, sobe a versão da sessão (encerra as outras sessões), invalida o link e audita sem dados pessoais", async () => {
    const u = await createClient();
    const token = await issueResetToken(u.id);
    const before = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(before.sessionVersion).toBe(0);

    expect(await redeemResetToken(token, NEW_PASSWORD)).toEqual({ ok: true });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(await bcrypt.compare(NEW_PASSWORD, after.passwordHash)).toBe(true);
    expect(await bcrypt.compare(u.plainPassword, after.passwordHash)).toBe(false);
    expect(after.sessionVersion).toBe(1);

    // uso único
    expect((await redeemResetToken(token, "Outra#Senha2026")).ok).toBe(false);
    expect(await bcrypt.compare(NEW_PASSWORD, (await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).passwordHash)).toBe(true);

    const audit = JSON.stringify(await prisma.auditLog.findMany({ where: { action: "password_reset_completed" } }));
    expect(audit).toContain(u.id);
    for (const secret of [token, u.email, u.phone, NEW_PASSWORD]) expect(audit).not.toContain(secret);
  });

  it("link expirado, inexistente ou malformado é recusado sem mudar nada", async () => {
    const u = await createClient();
    const token = await issueResetToken(u.id);
    const inThePast = new Date(Date.now() + (RESET_TOKEN_TTL_MINUTES + 1) * 60_000);
    expect((await redeemResetToken(token, NEW_PASSWORD, inThePast)).ok).toBe(false);
    expect(await isResetTokenUsable(token, inThePast)).toBe(false);
    for (const bad of ["", "curto", "x".repeat(500), generateResetToken().token]) expect((await redeemResetToken(bad, NEW_PASSWORD)).ok).toBe(false);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(await bcrypt.compare(u.plainPassword, row.passwordHash)).toBe(true);
    expect(row.sessionVersion).toBe(0);
  });

  it("uso do mesmo link ao mesmo tempo: só UMA requisição vence (reivindicação atômica)", async () => {
    const u = await createClient();
    const token = await issueResetToken(u.id);
    const results = await Promise.all([1, 2, 3, 4].map((i) => redeemResetToken(token, `Senha#Concorrente${i}`)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).sessionVersion).toBe(1);
  });

  it("troca de senha logada exige a senha atual e também encerra as sessões", async () => {
    const u = await createClient();
    expect(await changeOwnPassword(u.id, "senha-errada", NEW_PASSWORD)).toEqual({ ok: false, reason: "wrong_password" });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).sessionVersion).toBe(0);
    expect(await changeOwnPassword(u.id, u.plainPassword, NEW_PASSWORD)).toEqual({ ok: true });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(await bcrypt.compare(NEW_PASSWORD, after.passwordHash)).toBe(true);
    expect(after.sessionVersion).toBe(1);
  });

  it("os schemas aplicam a política de senha e o formato do e-mail", () => {
    const token = generateResetToken().token;
    expect(passwordResetSchema.safeParse({ token, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD }).success).toBe(true);
    expect(passwordResetSchema.safeParse({ token, password: "12345678", confirmPassword: "12345678" }).success).toBe(false); // comum
    expect(passwordResetSchema.safeParse({ token, password: NEW_PASSWORD, confirmPassword: "diferente" }).success).toBe(false);
    expect(passwordResetSchema.safeParse({ token: "x", password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD }).success).toBe(false);
    expect(passwordResetRequestSchema.safeParse({ email: "nao-e-email" }).success).toBe(false);
    expect(changePasswordSchema.safeParse({ currentPassword: "", password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD }).success).toBe(false);
  });
});
