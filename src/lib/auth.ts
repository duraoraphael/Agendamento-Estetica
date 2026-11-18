import type { AuthOptions, DefaultSession } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./db";
import { loginSchema } from "./validation";
import { RATE_LIMITS } from "./constants";
import { getClientIp, hitLimit, limitKey, normalizeEmailForLimit, refundLimit, resetLimit } from "./rate-limit";
import { securityLog, shortHash } from "./security-log";
import { recordAuditCoalesced } from "./audit-log";
import type { Role } from "./types";

/** Código devolvido ao navegador quando o limite de tentativas foi atingido. */
export const RATE_LIMITED_ERROR = "RATE_LIMITED";

// Hash bcrypt (custo 10) de uma senha fictícia, usado para igualar o tempo de resposta
// quando o e-mail não existe. Não corresponde a nenhuma conta.
const DUMMY_HASH = "$2a$10$2uGn94DQRnHIr2hfXCgB4OocfK8GEIg9FgWdcL.iC6Y2R.Wl.irT2";

function headerValue(headers: Record<string, unknown> | undefined, name: string): string | null {
  const raw = headers?.[name];
  if (Array.isArray(raw)) return raw.join(",");
  return typeof raw === "string" ? raw : null;
}

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      /** Versão da sessão com que o token foi emitido (compare com User.sessionVersion; veja session.ts). */
      sessionVersion: number;
    } & DefaultSession["user"];
  }
  interface User {
    id: string;
    role: Role;
    sessionVersion?: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: Role;
    sv?: number;
  }
}

export const authOptions: AuthOptions = {
  // Sessão de 7 dias (padrão do NextAuth: 30) — menos tempo de exposição se um aparelho for perdido.
  session: { strategy: "jwt", maxAge: 7 * 24 * 60 * 60 },
  pages: {
    signIn: "/login",
  },
  providers: [
    CredentialsProvider({
      name: "Credenciais",
      credentials: {
        email: { label: "E-mail", type: "email" },
        password: { label: "Senha", type: "password" },
      },
      async authorize(credentials, req) {
        const parsed = loginSchema.safeParse({ email: credentials?.email, password: credentials?.password });
        // Entrada malformada: mesma resposta genérica, mas ainda gastamos o custo do bcrypt.
        if (!parsed.success) {
          await bcrypt.compare(String(credentials?.password ?? "").slice(0, 72), DUMMY_HASH);
          return null;
        }
        const { email, password } = parsed.data;

        // Limites de tentativas. A ORIGEM só existe quando a aplicação declara um proxy confiável
        // (TRUSTED_PROXY_HOPS): cabeçalhos como X-Forwarded-For são forjáveis e nunca são usados sem isso.
        //
        //  - COM origem validada: o bloqueio de uma conta é por PAR origem+e-mail (5 falhas), então quem erra a
        //    senha de outra pessoa esgota só o próprio par, não o acesso da dona; a mesma origem tentando muitos
        //    e-mails é barrada por origem (20); e há um teto por e-mail somando todas as origens (50) contra
        //    tentativa distribuída.
        //  - SEM origem validada: não há como separar a dona de um atacante, então vale o limite por e-mail
        //    (5), como antes. É o custo de não confiar em cabeçalhos do cliente; configurar TRUSTED_PROXY_HOPS
        //    atrás de um proxy elimina esse efeito.
        const emailNorm = normalizeEmailForLimit(email);
        const ip = getClientIp({ get: (name) => headerValue(req?.headers, name) });
        const emailKey = limitKey("login-email", emailNorm);
        const pairKey = ip ? limitKey("login-pair", `${ip}|${emailNorm}`) : null;
        const ipKey = ip ? limitKey("login-ip", ip) : null;

        // A tentativa é RESERVADA (contada) antes de verificar a senha, de forma atômica. Assim uma
        // rajada paralela não consegue testar centenas de senhas "antes" de o contador subir.
        // Login correto devolve a tentativa; a 6ª tentativa do par (limite 5) já é barrada.
        const none = { blocked: false, retryAfterSeconds: 0 };
        const [byPair, byIp] =
          pairKey && ipKey
            ? await Promise.all([hitLimit(pairKey, RATE_LIMITS.loginEmail), hitLimit(ipKey, RATE_LIMITS.loginIp)])
            : [none, none];
        // O teto por e-mail só é cobrado de quem passou nos limites da própria origem: uma origem já barrada não
        // consegue, insistindo, esgotar o teto compartilhado e travar a conta para as demais.
        const byEmail =
          byPair.blocked || byIp.blocked
            ? none
            : await hitLimit(emailKey, ip ? RATE_LIMITS.loginEmailAnySource : RATE_LIMITS.loginEmail);
        if (byPair.blocked || byIp.blocked || byEmail.blocked) {
          // O e-mail NÃO precisa existir para ser bloqueado: o bloqueio é igual para qualquer e-mail.
          securityLog("login_blocked", { emailHash: shortHash(email) });
          // Registro DEPOIS do limite e agregado (uma linha por e-mail e hora, com teto): bloquear não vira escrita sem fim.
          await recordAuditCoalesced({ action: "login_blocked", result: "BLOQUEADO", subject: email });
          throw new Error(RATE_LIMITED_ERROR);
        }

        const user = await prisma.user.findUnique({ where: { email } });

        // Sempre executa uma comparação bcrypt (hash fictício se o e-mail não existe):
        // o tempo de resposta não revela se a conta existe.
        const valid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);

        if (!user || !valid) {
          securityLog("login_failed", { emailHash: shortHash(email) });
          // Agregado por e-mail e hora, com teto de linhas distintas. Só o hash do e-mail é guardado; nunca a senha.
          await recordAuditCoalesced({ action: "login_failed", result: "FALHA", subject: email, actorId: user?.id ?? null });
          return null;
        }

        // Login correto zera o contador do par (ou do e-mail, sem origem) e devolve a tentativa ao limite da origem
        // e ao teto por e-mail: as falhas de OUTRAS origens contra esta conta não são apagadas por um login legítimo.
        await Promise.all([
          pairKey ? resetLimit(pairKey) : resetLimit(emailKey),
          ipKey ? refundLimit(ipKey) : null,
          pairKey ? refundLimit(emailKey) : null,
        ]);
        if (user.role === "ADMIN") securityLog("admin_login", { userId: user.id });
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role as Role,
          sessionVersion: user.sessionVersion,
        };
      },
    }),
  ],
  // Eventos do NextAuth: disparados DEPOIS que o login foi aceito e a sessão emitida (login) e quando a pessoa encerra a
  // sessão (logout). Nunca lançam: o log não pode impedir entrar nem sair.
  events: {
    async signIn({ user }) {
      if (!user?.id) return;
      // Um login com credencial válida custa um bcrypt; ainda assim agrega por conta e minuto para não encher a tabela.
      await recordAuditCoalesced({ action: "login_success", actorId: user.id }, { windowMs: 60_000, maxDistinctRows: Infinity });
    },
    async signOut({ token }) {
      const id = typeof token?.id === "string" ? token.id : null;
      if (!id) return;
      await recordAuditCoalesced({ action: "logout", actorId: id }, { windowMs: 60_000, maxDistinctRows: Infinity });
    },
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role as Role;
        // Um login novo SEMPRE emite um token novo com a versão atual: depois de uma troca de senha, entrar de novo vale.
        token.sv = user.sessionVersion ?? 0;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id;
      session.user.role = token.role;
      // Tokens emitidos antes desta versão não têm `sv`: contam como 0 (igual ao padrão do banco), então ninguém é deslogado no deploy.
      session.user.sessionVersion = token.sv ?? 0;
      return session;
    },
  },
};
