import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "./db";
import { recordAuditTx } from "./audit-log";
import { sendMail } from "./mailer";
import { loadSiteSettings } from "./site-settings";
import { DEFAULT_SITE } from "./site";
import { LIMITS } from "./validation";

/**
 * Recuperação de senha. Regras:
 *  - token = 32 bytes aleatórios (CSPRNG) em base64url; no banco fica SÓ o hash SHA-256 (um vazamento do banco não
 *    entrega links utilizáveis) e o token nunca é registrado em log, auditoria ou tela;
 *  - validade curta (30 min) e USO ÚNICO: o link é "reivindicado" por um UPDATE condicional (usedAt nulo e não expirado),
 *    então duas requisições com o mesmo link nunca passam as duas;
 *  - pedir um novo link invalida os anteriores;
 *  - redefinir sobe `User.sessionVersion`: todas as sessões abertas (outros aparelhos) deixam de valer;
 *  - o link usa NEXTAUTH_URL como base, NUNCA o cabeçalho Host da requisição (envenenamento do link de redefinição).
 */
export const RESET_TOKEN_TTL_MINUTES = 30;
const TOKEN_BYTES = 32;

export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateResetToken(): { token: string; tokenHash: string } {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  return { token, tokenHash: hashResetToken(token) };
}

export function buildResetLink(token: string): string {
  const base = (process.env.NEXTAUTH_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  return `${base}/redefinir-senha?token=${encodeURIComponent(token)}`;
}

/**
 * Gera um token para a conta e invalida os anteriores, na mesma transação. Devolve o token EM CLARO (só para montar o
 * link do e-mail). Chamar só para contas que existem.
 */
export async function issueResetToken(userId: string, now: Date = new Date()): Promise<string> {
  const { token, tokenHash } = generateResetToken();
  await prisma.$transaction(async (tx) => {
    await tx.passwordResetToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: now } });
    const row = await tx.passwordResetToken.create({
      data: { userId, tokenHash, expiresAt: new Date(now.getTime() + RESET_TOKEN_TTL_MINUTES * 60_000) },
      select: { id: true },
    });
    // Auditoria sem e-mail, sem token, sem hash: só o ID interno da conta e do registro.
    await recordAuditTx(tx, {
      action: "password_reset_requested",
      actorId: userId,
      targetType: "PasswordResetToken",
      targetId: row.id,
      dedupeKey: `pwreset_requested:${row.id}`,
    });
  });
  return token;
}

/**
 * Pedido de recuperação para um e-mail. Se a conta não existe, não faz nada (a resposta ao usuário é a mesma nos dois
 * casos). Roda DEPOIS da resposta (`after()` na Server Action), então o tempo da resposta não revela se a conta existe.
 * Nunca lança: falha de e-mail ou de banco aqui só vira log sem dados pessoais.
 */
export async function requestPasswordResetFor(email: string): Promise<void> {
  try {
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, name: true, email: true } });
    if (!user) return;
    const token = await issueResetToken(user.id);
    const site = await loadSiteSettings(prisma).catch(() => null);
    const siteName = site?.siteName || DEFAULT_SITE.name;
    const link = buildResetLink(token);
    await sendMail({
      to: user.email,
      subject: `${siteName}: redefinição de senha`,
      text:
        `Olá, ${user.name.split(" ")[0]}!\n\n` +
        `Recebemos um pedido para redefinir a senha da sua conta na ${siteName}. Use o link abaixo (vale por ${RESET_TOKEN_TTL_MINUTES} minutos e só pode ser usado uma vez):\n\n` +
        `${link}\n\n` +
        `Se você não fez esse pedido, ignore este e-mail: sua senha continua a mesma.`,
    });
  } catch {
    console.error(JSON.stringify({ kind: "password_reset", event: "request_failed" }));
  }
}

export type RedeemResult = { ok: true } | { ok: false };

/**
 * Usa o link: troca a senha, invalida o link (e os demais da conta) e sobe a versão da sessão, tudo numa transação.
 * O hash bcrypt é calculado ANTES e nos dois caminhos (link válido ou não), então o tempo não distingue os casos.
 * `newPassword` já passou por `passwordSchema` (política de senha) na Server Action.
 */
export async function redeemResetToken(token: string, newPassword: string, now: Date = new Date()): Promise<RedeemResult> {
  if (typeof token !== "string" || token.length < 20 || token.length > LIMITS.resetTokenMax) {
    await bcrypt.hash(newPassword, 10);
    return { ok: false };
  }
  const passwordHash = await bcrypt.hash(newPassword, 10);
  const tokenHash = hashResetToken(token);

  return prisma.$transaction(async (tx) => {
    // Reivindicação atômica: só UMA requisição consegue marcar o link como usado.
    const claimed = await tx.passwordResetToken.updateMany({
      where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) return { ok: false } as const;

    const row = await tx.passwordResetToken.findUnique({ where: { tokenHash }, select: { userId: true } });
    if (!row) return { ok: false } as const;

    await tx.user.update({ where: { id: row.userId }, data: { passwordHash, sessionVersion: { increment: 1 } } });
    // Qualquer outro link ainda aberto desta conta deixa de valer.
    await tx.passwordResetToken.updateMany({ where: { userId: row.userId, usedAt: null }, data: { usedAt: now } });
    await recordAuditTx(tx, {
      action: "password_reset_completed",
      actorId: row.userId,
      targetType: "User",
      targetId: row.userId,
      dedupeKey: `pwreset_completed:${tokenHash.slice(0, 16)}`,
    });
    return { ok: true } as const;
  });
}

/** Link ainda utilizável? Só para a página decidir entre mostrar o formulário ou o aviso (não consome o link). */
export async function isResetTokenUsable(token: string, now: Date = new Date()): Promise<boolean> {
  if (typeof token !== "string" || token.length < 20 || token.length > LIMITS.resetTokenMax) return false;
  const row = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashResetToken(token) }, select: { usedAt: true, expiresAt: true } });
  return Boolean(row && !row.usedAt && row.expiresAt > now);
}

/**
 * Troca de senha com a conta logada. Exige a SENHA ATUAL (reautenticação). Sobe a versão da sessão: todas as sessões,
 * inclusive a atual, deixam de valer, e a cliente entra de novo com a senha nova.
 */
export async function changeOwnPassword(userId: string, currentPassword: string, newPassword: string): Promise<{ ok: true } | { ok: false; reason: "wrong_password" }> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  const valid = await bcrypt.compare(currentPassword, user?.passwordHash ?? "$2a$10$2uGn94DQRnHIr2hfXCgB4OocfK8GEIg9FgWdcL.iC6Y2R.Wl.irT2");
  if (!user || !valid) return { ok: false, reason: "wrong_password" };
  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { passwordHash, sessionVersion: { increment: 1 } } });
    await tx.passwordResetToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } });
    await recordAuditTx(tx, {
      action: "password_changed",
      actorId: userId,
      targetType: "User",
      targetId: userId,
      dedupeKey: `password_changed:${userId}:${Date.now()}`,
    });
  });
  return { ok: true };
}
