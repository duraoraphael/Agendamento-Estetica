import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { signupSchema, formatZodError } from "@/lib/validation";
import { RATE_LIMITS } from "@/lib/constants";
import { getClientIp, hitLimit, limitKey, normalizeEmailForLimit } from "@/lib/rate-limit";
import { readJsonLimited, TOO_LARGE } from "@/lib/body-limit";
import { securityLog, shortHash } from "@/lib/security-log";
import { recordAuditCoalesced, recordAuditTx } from "@/lib/audit-log";

const MAX_SIGNUP_BODY_BYTES = 10_000;

// Resposta ÚNICA para "conta criada" e "e-mail já cadastrado": status, corpo e
// tempo iguais, para o cadastro não revelar quem já é cliente. (Sem confirmação
// por e-mail não há como avisar a dona do e-mail; veja "Riscos residuais" no README.)
const ACCEPTED = {
  ok: true,
  message:
    "Cadastro recebido! Se este e-mail ainda não tinha conta, ela já está pronta: entre com a senha que você escolheu. Se você já tinha conta, use Entrar.",
};

export async function POST(request: Request) {
  // Só JSON de verdade. Um formulário de OUTRO site só consegue enviar text/plain ou form-urlencoded sem pedir permissão
  // ao navegador (sem "preflight"); exigir application/json impede que a página de um terceiro dispare cadastros
  // (e gaste o limite do e-mail) a partir do navegador de uma visitante. O nosso formulário já envia JSON.
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    return NextResponse.json({ ok: false, errors: { _form: "Dados inválidos." } }, { status: 415 });
  }

  // O formulário tem poucos campos curtos: corpo acima de 10 KB é abuso e nem chega a ser carregado inteiro.
  const body = await readJsonLimited(request, MAX_SIGNUP_BODY_BYTES);
  if (body === TOO_LARGE) {
    return NextResponse.json({ ok: false, errors: { _form: "Dados grandes demais." } }, { status: 413 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, errors: { _form: "Dados inválidos." } }, { status: 400 });
  }

  const parsed = signupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, errors: formatZodError(parsed.error) }, { status: 400 });
  }

  const { name, email, phone, password } = parsed.data;

  // Limite de tentativas por e-mail normalizado e por IP (este só com proxy confiável declarado).
  const ip = getClientIp(request.headers);
  const statuses = await Promise.all([
    hitLimit(limitKey("signup-email", normalizeEmailForLimit(email)), RATE_LIMITS.signupEmail),
    ip ? hitLimit(limitKey("signup-ip", ip), RATE_LIMITS.signupIp) : null,
  ]);
  const blocked = statuses.find((s) => s?.blocked);
  if (blocked) {
    securityLog("signup_blocked", { emailHash: shortHash(email) });
    await recordAuditCoalesced({ action: "signup_blocked", result: "BLOQUEADO", subject: email });
    const minutes = Math.ceil(blocked.retryAfterSeconds / 60);
    return NextResponse.json(
      { ok: false, errors: { _form: `Muitas tentativas de cadastro. Tente novamente em ${minutes} minuto${minutes > 1 ? "s" : ""}.` } },
      { status: 429, headers: { "Retry-After": String(blocked.retryAfterSeconds) } }
    );
  }

  // O hash é calculado ANTES de consultar o e-mail, nos dois caminhos: o tempo de resposta não revela se a conta existe.
  const passwordHash = await bcrypt.hash(password, 10);

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  let duplicate = Boolean(existing);
  if (!existing) {
    try {
      // Importante: todo cadastro público cria uma conta CLIENTE. O papel não
      // é lido do corpo da requisição — contas ADMIN só são criadas pelo seed
      // (veja prisma/seed.ts e o README).
      // A conta e o registro de auditoria entram na MESMA transação: o log existe se, e somente se, a conta foi criada.
      await prisma.$transaction(async (tx) => {
        const created = await tx.user.create({ data: { name, email, phone, passwordHash, role: "CLIENTE" }, select: { id: true } });
        await recordAuditTx(tx, { action: "signup_created", actorId: created.id, targetType: "User", targetId: created.id, dedupeKey: `signup:${created.id}` });
      });
    } catch (err) {
      // Duas requisições simultâneas com o mesmo e-mail: a segunda recebe a mesma resposta genérica.
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
      duplicate = true;
    }
  }
  // E-mail que já tinha conta: a RESPOSTA ao visitante continua igual; só a administradora vê isto, agregado por e-mail e hora.
  if (duplicate) await recordAuditCoalesced({ action: "signup_duplicate", result: "FALHA", subject: email });

  return NextResponse.json(ACCEPTED);
}
