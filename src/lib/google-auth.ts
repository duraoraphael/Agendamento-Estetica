import type { AuthOptions, User } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import { cookies } from "next/headers";
import { completeGoogleSignup, decodeGoogleSignup, encodeGoogleSignup, GOOGLE_SIGNUP_TTL_SECONDS, resolveGoogleLogin, type ExistingClientSession } from "./google-login";
import { safeCallbackPath } from "./safe-redirect";

function signupCookie() {
  const secure = process.env.NEXTAUTH_URL?.startsWith("https://") ?? Boolean(process.env.VERCEL_URL);
  return {
    name: secure ? "__Host-google-signup" : "google-signup",
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
  };
}

export async function readGoogleSignup() {
  return decodeGoogleSignup((await cookies()).get(signupCookie().name)?.value);
}

export function googleLoginProviders(): AuthOptions["providers"] {
  const clientId = process.env.GOOGLE_LOGIN_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_LOGIN_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return [];
  return [
    GoogleProvider({ clientId, clientSecret, checks: ["pkce", "state", "nonce"] }),
    CredentialsProvider({
      id: "google-cadastro",
      name: "Concluir cadastro Google",
      credentials: {
        phone: { label: "WhatsApp", type: "tel" },
        consent: { label: "Consentimento", type: "text" },
      },
      async authorize(fields) {
        try {
          const pending = await readGoogleSignup();
          if (!pending || !fields) return null;
          const user = await completeGoogleSignup(pending.identity, fields);
          if (user) (await cookies()).set({ ...signupCookie(), value: "", maxAge: 0 });
          return user;
        } catch {
          console.error(JSON.stringify({ kind: "auth", event: "google_signup_failed" }));
          return null;
        }
      },
    }),
  ];
}

/** Os dados intermediários existem só durante a requisição do callback OAuth. */
export function withGoogleLogin(
  options: AuthOptions,
  currentClient: () => Promise<ExistingClientSession | undefined>,
): AuthOptions {
  let callbackPath = "/";
  let googleUser: User | undefined;
  return {
    ...options,
    callbacks: {
      ...options.callbacks,
      async redirect({ url, baseUrl }) {
        try {
          const target = new URL(url, baseUrl);
          callbackPath = target.origin === baseUrl ? safeCallbackPath(target.pathname + target.search + target.hash) : "/";
        } catch {
          callbackPath = "/";
        }
        return baseUrl + callbackPath;
      },
      async signIn(params) {
        if (params.account?.provider !== "google") return options.callbacks?.signIn?.(params) ?? true;

        try {
          const result = await resolveGoogleLogin(params.profile, await currentClient());
          if (result.kind === "denied") return false;
          const jar = await cookies();
          if (result.kind === "client") {
            if (jar.has(signupCookie().name)) jar.set({ ...signupCookie(), value: "", maxAge: 0 });
            googleUser = result.user;
            return true;
          }
          const value = await encodeGoogleSignup(result.identity, callbackPath);
          jar.set({ ...signupCookie(), value, maxAge: GOOGLE_SIGNUP_TTL_SECONDS });
          // O redirecionamento de signIn cancela a emissão da sessão pelo NextAuth.
          return "/completar-cadastro";
        } catch {
          console.error(JSON.stringify({ kind: "auth", event: "google_login_failed" }));
          return false;
        }
      },
      async jwt(params) {
        if (params.account?.provider === "google") {
          if (!googleUser) throw new Error("GoogleLoginDenied");
          params = {
            ...params,
            user: googleUser,
            token: { sub: googleUser.id, name: googleUser.name, email: googleUser.email } as typeof params.token,
          };
        }
        return options.callbacks?.jwt?.(params) ?? params.token;
      },
    },
    events: {
      ...options.events,
      async signIn(params) {
        const user = params.account?.provider === "google" ? googleUser : params.user;
        if (user) await options.events?.signIn?.({ ...params, user });
      },
    },
    logger: {
      ...options.logger,
      // O erro bruto do OAuth pode conter código, token ou dados do perfil.
      error(code) {
        console.error(JSON.stringify({ kind: "auth", event: code }));
      },
    },
  };
}
