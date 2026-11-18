import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatCents } from "@/lib/format";
import { buildCalendarRange } from "@/lib/calendar-range";
import { isValidDateKey } from "@/lib/availability";
import { SlotPicker } from "@/components/SlotPicker";
import { Notice, Page, PageHeader, Stepper } from "@/components/ui";
import { ClockIcon } from "@/components/icons";

export const metadata = { title: "Escolha a data e o horário" };

export default async function EscolherHorarioPage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<{ serviceId?: string; conflito?: string; data?: string; hora?: string }>;
}) {
  const searchParams = await searchParamsPromise;
  const serviceId = searchParams.serviceId;
  if (!serviceId) redirect("/agendar");

  const service = await prisma.service.findUnique({ where: { id: serviceId } });
  if (!service || !service.active) redirect("/agendar?indisponivel=1");

  const calendar = await buildCalendarRange();
  // Preferências vindas do agendamento rápido da página inicial. São só sugestão de partida: validadas aqui, e a lista
  // de horários (e a confirmação) continuam sendo as regras do servidor.
  const initialDay = searchParams.data && isValidDateKey(searchParams.data) && searchParams.data >= calendar.todayKey && searchParams.data <= calendar.maxKey ? searchParams.data : undefined;
  const initialTime = searchParams.hora && /^([01]\d|2[0-3]):[0-5]\d$/.test(searchParams.hora) ? searchParams.hora : undefined;

  return (
    <Page width="xl">
      <Stepper current={2} serviceId={service.id} />
      <div className="mt-8">
        <PageHeader title="Escolha a" accent="data e o horário" subtitle="Etapa 2 de 4 — selecione uma data e um horário disponível." />
      </div>

      {searchParams.conflito && (
        <div className="mt-5">
          <Notice tone="warning">Esse horário não está mais disponível (acabou de ser reservado). Escolha outro horário abaixo — a lista já foi atualizada.</Notice>
        </div>
      )}

      <div className="mt-5 flex items-center justify-between gap-4 rounded-2xl border border-brand/40 bg-surface px-5 py-3">
        <div>
          <p className="font-display text-lg font-bold uppercase tracking-wide text-fg">{service.name}</p>
          <p className="flex items-center gap-1.5 text-sm text-fg-muted">
            <ClockIcon className="h-4 w-4" /> {service.durationMinutes} minutos
          </p>
        </div>
        <p className="font-display text-2xl font-bold text-brand">{formatCents(service.priceCents)}</p>
      </div>

      <SlotPicker serviceId={service.id} calendar={calendar} initialDay={initialDay} initialTime={initialTime} />
    </Page>
  );
}
