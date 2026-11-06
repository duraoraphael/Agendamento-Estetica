import type { AuthOptions, DefaultSession } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./db";
import { loginSchema } from "./validation";
import { RATE_LIMITS } from "./constants";
import { getClientIp, hitLimit, limitKey, normalizeEmailForLimit, refundLimit, resetLimit } from "./rate-limit";
import { securityLog, shortHash } from "./security-log";
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
    } & DefaultSession["user"];
  }
  interface User {
    id: string;
    role: Role;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: Role;
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

        // Limite de tentativas por e-mail normalizado e por IP (este só com proxy confiável declarado).
        const emailKey = limitKey("login-email", normalizeEmailForLimit(email));
        const ip = getClientIp({ get: (name) => headerValue(req?.headers, name) });
        const ipKey = ip ? limitKey("login-ip", ip) : null;

        // A tentativa é RESERVADA (contada) antes de verificar a senha, de forma atômica. Assim uma
        // rajada paralela não consegue testar centenas de senhas "antes" de o contador subir.
        // Login correto devolve a tentativa; a 6ª tentativa por e-mail (limite 5) já é barrada.
        const [byEmail, byIp] = await Promise.all([
          hitLimit(emailKey, RATE_LIMITS.loginEmail),
          ipKey ? hitLimit(ipKey, RATE_LIMITS.loginIp) : Promise.resolve({ blocked: false, retryAfterSeconds: 0 }),
        ]);
        if (byEmail.blocked || byIp.blocked) {
          // O e-mail NÃO precisa existir para ser bloqueado: o bloqueio é igual para qualquer e-mail.
          securityLog("login_blocked", { emailHash: shortHash(email) });
          throw new Error(RATE_LIMITED_ERROR);
        }

        const user = await prisma.user.findUnique({ where: { email } });

        // Sempre executa uma comparação bcrypt (hash fictício se o e-mail não existe):
        // o tempo de resposta não revela se a conta existe.
        const valid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);

        if (!user || !valid) {
          securityLog("login_failed", { emailHash: shortHash(email) });
          return null;
        }

        await Promise.all([resetLimit(emailKey), ipKey ? refundLimit(ipKey) : null]);
        if (user.role === "ADMIN") securityLog("admin_login", { userId: user.id });
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role as Role,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role as Role;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id;
      session.user.role = token.role;
      return session;
    },
  },
};
