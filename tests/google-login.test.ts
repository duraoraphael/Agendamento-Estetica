import { beforeEach, describe, expect, it } from "vitest";
import { createAdmin, createClient, resetDb } from "./helpers";
import { prisma } from "@/lib/db";
import { completeGoogleSignup, resolveGoogleLogin, encodeGoogleSignup, decodeGoogleSignup } from "@/lib/google-login";
import { requestPasswordResetFor } from "@/lib/password-reset";

const identity = {
  sub: "123456789987654321",
  email: "cliente@gmail.com",
  email_verified: true,
  name: "Pessoa Cliente",
};
const phone = "(11) 91234-5678";

async function pendingSignup() {
  const result = await resolveGoogleLogin(identity);
  if (result.kind !== "signup") throw new Error("O cadastro deveria estar pendente");
  return result.identity;
}

describe("Login Google de clientes", () => {
  beforeEach(resetDb);

  it("recusa perfil sem e-mail verificado", async () => {
    expect(await resolveGoogleLogin({ ...identity, email_verified: false })).toEqual({ kind: "denied" });
  });

  it("não autentica uma conta administrativa com o mesmo e-mail", async () => {
    await createAdmin({ email: identity.email });
    expect(await resolveGoogleLogin(identity)).toEqual({ kind: "denied" });
  });

  it("vincula uma cliente existente e passa a reconhecer o identificador permanente", async () => {
    const existing = await createClient({ email: identity.email });
    expect(await resolveGoogleLogin(identity)).toEqual({ kind: "denied" });
    const proof = { id: existing.id, sessionVersion: existing.sessionVersion };
    expect(await resolveGoogleLogin(identity, proof)).toMatchObject({ kind: "client", user: { id: existing.id } });
    expect(await resolveGoogleLogin({ ...identity, sub: "outro-google" })).toEqual({ kind: "denied" });
    expect(await resolveGoogleLogin({ ...identity, email: "novo@gmail.com" })).toMatchObject({
      kind: "client", user: { id: existing.id, email: identity.email },
    });
    expect(await prisma.user.count()).toBe(1);
  });

  it("recusa vínculo com uma sessão de outra cliente ou já revogada", async () => {
    const existing = await createClient({ email: "pessoa@example.com" });
    const profile = { ...identity, email: existing.email };
    expect(await resolveGoogleLogin(profile, { id: "outra", sessionVersion: existing.sessionVersion })).toEqual({ kind: "denied" });
    expect(await resolveGoogleLogin(profile, { id: existing.id, sessionVersion: existing.sessionVersion + 1 })).toEqual({ kind: "denied" });
  });

  it("aguarda WhatsApp válido e consentimento antes de criar a conta", async () => {
    const pending = await pendingSignup();
    expect(await completeGoogleSignup(pending, { phone: "123", consent: "true" })).toBeNull();
    expect(await completeGoogleSignup(pending, { phone, consent: "false" })).toBeNull();
    expect(await prisma.user.count()).toBe(0);
  });

  it("cria uma conta de cliente sem senha e consome o cadastro pendente", async () => {
    const pending = await pendingSignup();
    const results = await Promise.all([
      completeGoogleSignup(pending, { phone, consent: "true" }),
      completeGoogleSignup(pending, { phone, consent: "true" }),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: identity.email } });
    expect(user).toMatchObject({ phone, role: "CLIENTE", passwordHash: null });
    expect(await prisma.auditLog.count({ where: { action: "signup_created", actorId: user.id } })).toBe(1);
    expect(await resolveGoogleLogin(identity)).toMatchObject({ kind: "client", user: { id: user.id } });
    await requestPasswordResetFor(identity.email);
    expect(await prisma.passwordResetToken.count()).toBe(0);
  });

  it("mantém o destino interno no cookie de cadastro e recusa um cookie adulterado", async () => {
    const pending = await pendingSignup();
    const cookie = await encodeGoogleSignup(pending, "/agendar/horario?serviceId=1");
    expect(await decodeGoogleSignup(cookie)).toMatchObject({ callbackPath: "/agendar/horario?serviceId=1" });
    expect(await decodeGoogleSignup(cookie + "inválido")).toBeNull();
    const external = await encodeGoogleSignup(pending, "//example.com");
    expect(await decodeGoogleSignup(external)).toMatchObject({ callbackPath: "/" });
  });
});
