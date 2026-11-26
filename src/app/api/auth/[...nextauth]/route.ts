import NextAuth from "next-auth";
import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { withGoogleLogin } from "@/lib/google-auth";
import { getClientIp, hitLimit, limitKey } from "@/lib/rate-limit";

async function handler(req: NextRequest, context: { params: Promise<{ nextauth: string[] }> }) {
  const [action, provider] = (await context.params).nextauth;
  if (provider === "google" && (action === "signin" || action === "callback") &&
      authOptions.providers.some((candidate) => candidate.id === "google")) {
    const ip = getClientIp(req.headers);
    if (ip) {
      const limit = await hitLimit(limitKey(`google-${action}-ip`, ip), 30);
      if (limit.blocked) {
        const url = "/login?error=GoogleRateLimited";
        const headers = { "Retry-After": String(limit.retryAfterSeconds) };
        if (action === "callback") return new NextResponse(null, { status: 303, headers: { ...headers, Location: url } });
        return NextResponse.json({ url }, {
          status: 429, headers,
        });
      }
    }
  }
  return NextAuth(withGoogleLogin(authOptions, async () => {
    const token = await getToken({ req });
    if (token?.role === "CLIENTE" && typeof token.id === "string") {
      return { id: token.id, sessionVersion: token.sv ?? 0 };
    }
  }))(req, context);
}

export { handler as GET, handler as POST };
