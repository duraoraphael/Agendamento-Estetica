import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { getAdminApiUser } from "@/lib/session";
import { getGoogleAuthUrl, isGoogleConfigured } from "@/lib/google-calendar";

export async function GET(req: NextRequest) {
  const admin = await getAdminApiUser();
  if (!admin) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  if (!isGoogleConfigured()) {
    return NextResponse.redirect(new URL("/admin/configuracoes/google?erro=nao_configurado", req.url));
  }

  const state = randomBytes(16).toString("hex");
  const authUrl = await getGoogleAuthUrl(state);
  if (!authUrl) {
    return NextResponse.redirect(new URL("/admin/configuracoes/google?erro=nao_configurado", req.url));
  }

  const res = NextResponse.redirect(authUrl);
  res.cookies.set("google_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return res;
}
