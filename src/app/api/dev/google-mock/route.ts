import { NextResponse } from "next/server";
import { getAdminApiUser } from "@/lib/session";
import { isMockCalendarEnabled, mockCalendarControl } from "@/lib/google-mock";

// SOMENTE desenvolvimento (GOOGLE_CALENDAR_MOCK=1 e fora de produção): inspeciona o Google simulado e liga/desliga falhas.
//   GET  /api/dev/google-mock               -> eventos criados e chamadas feitas
//   POST /api/dev/google-mock?fail=1|0      -> simula indisponibilidade do Google
//   POST /api/dev/google-mock?reset=1       -> limpa tudo
export const dynamic = "force-dynamic";

async function guard() {
  if (!isMockCalendarEnabled()) return NextResponse.json({ error: "Indisponível." }, { status: 404 });
  if (!(await getAdminApiUser())) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  return null;
}

export async function GET() {
  return (await guard()) ?? NextResponse.json(mockCalendarControl().snapshot());
}

export async function POST(req: Request) {
  const denied = await guard();
  if (denied) return denied;
  const url = new URL(req.url);
  const control = mockCalendarControl();
  if (url.searchParams.get("reset") === "1") control.reset();
  const fail = url.searchParams.get("fail");
  if (fail !== null) control.setFailing(fail === "1");
  return NextResponse.json(control.snapshot());
}
