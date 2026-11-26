import { Prisma } from "@prisma/client";
import { decode, encode, type JWT } from "next-auth/jwt";
import { z } from "zod";
import { recordAuditTx } from "./audit-log";
import { RATE_LIMITS } from "./constants";
import { prisma } from "./db";
import { hitLimit, limitKey } from "./rate-limit";
import { safeCallbackPath } from "./safe-redirect";
import { LIMITS, signupSchema } from "./validation";

const identitySchema = z.object({
  sub: z.string().min(1).max(255),
  email: signupSchema.shape.email,
  email_verified: z.literal(true),
  name: z.string().optional(),
});
type GoogleIdentity = z.output<typeof identitySchema>;
const clientFields = { id: true, name: true, email: true, role: true, sessionVersion: true } as const;
type GoogleClient = {
  id: string;
  name: string;
  email: string;
  role: "CLIENTE";
  sessionVersion: number;
};
type GoogleLogin =
  | { kind: "client"; user: GoogleClient }
  | { kind: "signup"; identity: GoogleIdentity }
  | { kind: "denied" };

export type ExistingClientSession = Pick<GoogleClient, "id" | "sessionVersion">;

function clientResult(user: Prisma.UserGetPayload<{ select: typeof clientFields }> | null): GoogleLogin {
  if (user?.role !== "CLIENTE") return { kind: "denied" };
  return { kind: "client", user: { ...user, role: "CLIENTE" } };
}

function bySubject(sub: string) {
  return prisma.user.findUnique({ where: { googleSubject: sub }, select: clientFields });
}

function isUniqueConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** Recebe as claims já verificadas pelo provedor OpenID Connect do NextAuth. */
export async function resolveGoogleLogin(profile: unknown, session?: ExistingClientSession): Promise<GoogleLogin> {
  const parsed = identitySchema.safeParse(profile);
  if (!parsed.success) return { kind: "denied" };
  const identity = parsed.data;
  const { sub, email } = identity;

  const linked = await bySubject(sub);
  if (linked) return clientResult(linked);

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, role: true, googleSubject: true },
  });
  if (!existing) return session ? { kind: "denied" } : { kind: "signup", identity };

  // O cadastro por senha ainda não confirma o e-mail. Vincular exige provar acesso às duas contas.
  if (existing.role !== "CLIENTE" || session?.id !== existing.id) return { kind: "denied" };
  if (existing.googleSubject === sub) return clientResult(await bySubject(sub));
  if (existing.googleSubject) return { kind: "denied" };

  try {
    await prisma.user.updateMany({
      where: { id: existing.id, role: "CLIENTE", sessionVersion: session.sessionVersion, googleSubject: null },
      data: { googleSubject: sub },
    });
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
  }
  return clientResult(await bySubject(sub));
}

export async function completeGoogleSignup(identity: GoogleIdentity, fields: { phone?: unknown; consent?: unknown }) {
  const phone = signupSchema.shape.phone.safeParse(fields.phone);
  if (!phone.success || fields.consent !== "true") return null;

  const limit = await hitLimit(limitKey("google-signup", identity.sub), RATE_LIMITS.signupEmail);
  if (limit.blocked) return null;
  const name = identity.name?.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, LIMITS.nameMax) || "Cliente Google";
  try {
    return await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email: identity.email, googleSubject: identity.sub, name, phone: phone.data, role: "CLIENTE" },
        select: clientFields,
      });
      await recordAuditTx(tx, {
        action: "signup_created", actorId: user.id, targetType: "User", targetId: user.id, dedupeKey: `signup:${user.id}`,
      });
      return { ...user, role: "CLIENTE" as const };
    });
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    return null;
  }
}

const signupSalt = "garage-google-signup";
export const GOOGLE_SIGNUP_TTL_SECONDS = 10 * 60;

export function encodeGoogleSignup(identity: GoogleIdentity, callbackPath: string) {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("GoogleSignupConfiguration");
  return encode({
    secret,
    salt: signupSalt,
    maxAge: GOOGLE_SIGNUP_TTL_SECONDS,
    // O salt próprio separa esta credencial temporária dos JWTs de sessão tipados em auth.ts.
    token: { identity, callbackPath: safeCallbackPath(callbackPath) } as unknown as JWT,
  });
}

export async function decodeGoogleSignup(value: string | undefined) {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!value || !secret) return null;
  const token = await decode({ secret, salt: signupSalt, token: value }).catch(() => null);
  const identity = identitySchema.safeParse(token?.identity);
  if (!identity.success) return null;
  const path = token?.callbackPath;
  return { identity: identity.data, callbackPath: safeCallbackPath(typeof path === "string" ? path : null) };
}
