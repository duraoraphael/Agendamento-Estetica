import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatCents } from "@/lib/format";
import { TIMEZONE, BOOKING_HORIZON_DAYS } from "@/lib/constants";
import { SlotPicker } from "@/components/SlotPicker";
import { Notice, Page, Stepper } from "@/components/ui";

function buildUpcomingDays(count: number) {
  const days: { key: string; label: string }[] = [];
  const now = new Date();

  for (let i = 0; i < count; i++) {
    const d = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
    const key = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
    let label = new Intl.DateTimeFormat("pt-BR", { timeZone: TIMEZONE, weekday: "short", day: "2-digit", month: "2-digit" }).format(d);
    if (i === 0) label = `Hoje ${new Intl.DateTimeFormat("pt-BR", { timeZone: TIMEZONE, day: "2-digit", month: "2-digit" }).format(d)}`;
    if (i === 1) label = `Amanhã ${new Intl.DateTimeFormat("pt-BR", { timeZone: TIMEZONE, day: "2-digit", month: "2-digit" }).format(d)}`;
    days.push({ key, label });
  }
  return days;
}

export default async function EscolherHorarioPage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<{ serviceId?: string; conflito?: string }>;
}) {
  // Next 15: searchParams é assíncrono (em Next 14 o await é inofensivo).
  const searchParams = await searchParamsPromise;
  const serviceId = searchParams.serviceId;
  if (!serviceId) redirect("/agendar");

  const service = await prisma.service.findUnique({ where: { id: serviceId } });
  if (!service || !service.active) redirect("/agendar?indisponivel=1");

  const days = buildUpcomingDays(Math.min(BOOKING_HORIZON_DAYS, 30));

  return (
    <Page>
      <Stepper current={2} serviceId={service.id} />
      <h1 className="page-title mt-8">Escolha o dia e o horário</h1>
      <p className="mt-2 text-plum-muted">Passo 2 de 3 — {service.name}</p>

      {searchParams.conflito && (
        <div className="mt-5">
          <Notice tone="warning">Esse horário não está mais disponível (acabou de ser reservado). Escolha outro horário abaixo — a lista já foi atualizada.</Notice>
        </div>
      )}

      <div className="mt-5 flex items-center justify-between gap-4 rounded-2xl border border-gold/40 bg-white px-5 py-3">
        <div>
          <p className="font-display font-semibold text-plum">{service.name}</p>
          <p className="text-sm text-plum-muted">{service.durationMinutes} minutos</p>
        </div>
        <p className="font-display text-xl font-semibold text-wine">{formatCents(service.priceCents)}</p>
      </div>

      <SlotPicker serviceId={service.id} days={days} />
    </Page>
  );
}
