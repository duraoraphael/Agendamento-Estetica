import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import type { NextRequest } from "next/server";

// Primeira camada de proteção (defesa em profundidade). A verificação
// definitiva de permissão acontece sempre no servidor, em cada rota/ação
// (veja src/lib/session.ts), mesmo que alguém chame a rota diretamente.
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const needsAuth = pathname.startsWith("/admin") || pathname.startsWith("/meus-agendamentos") || pathname.startsWith("/agendar");
  if (!needsAuth) return NextResponse.next();

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

  if (!token) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (pathname.startsWith("/admin") && token.role !== "ADMIN") {
    return NextResponse.redirect(new URL("/meus-agendamentos", req.url));
  }

  if ((pathname.startsWith("/meus-agendamentos") || pathname.startsWith("/agendar")) && token.role !== "CLIENTE") {
    return NextResponse.redirect(new URL("/admin", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/meus-agendamentos/:path*", "/agendar/:path*"],
};
