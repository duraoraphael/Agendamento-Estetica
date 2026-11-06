import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatCents, formatDateBR, formatTimeBR } from "@/lib/format";
import { ConfirmBookingForm } from "@/components/ConfirmBookingForm";
import { Page, Stepper } from "@/components/ui";
import { cancelPolicyText, getBookingPolicy } from "@/lib/policy";
import { StudioInfo } from "@/components/StudioInfo";
import { getSiteSettings } from "@/lib/site-settings-cache";

export default async function RevisarAgendamentoPage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<{ serviceId?: string; startAt?: string }>;
}) {
  // Next 15: searchParams é assíncrono (em Next 14 o await é inofensivo).
  const searchParams = await searchParamsPromise;
  const { serviceId, startAt } = searchParams;
  if (!serviceId || !startAt) redirect("/agendar");

  const [service, site] = await Promise.all([prisma.service.findUnique({ where: { id: serviceId } }), getSiteSettings()]);
  if (!service || !service.active) redirect("/agendar?indisponivel=1");

  const startDate = new Date(startAt);
  if (Number.isNaN(startDate.getTime()) || startDate.getTime() < Date.now()) {
    redirect(`/agendar/horario?serviceId=${serviceId}&conflito=1`);
  }

  return (
    <Page>
      <Stepper current={3} serviceId={service.id} />
      <h1 className="page-title mt-8">Revise seu agendamento</h1>
      <p className="mt-2 text-plum-muted">Passo 3 de 3 — confira os dados antes de confirmar.</p>

      <section aria-label="Resumo do agendamento" className="mt-6 overflow-hidden rounded-2xl border border-gold/50 bg-white shadow-soft">
        <div className="bg-blush px-6 py-4">
          <p className="eyebrow">Serviço</p>
          <p className="mt-1 font-display text-2xl font-semibold text-plum">{service.name}</p>
        </div>
        <dl className="divide-y divide-blush-deep/50 px-6">
          <div className="flex items-baseline justify-between gap-4 py-4">
            <dt className="text-plum-muted">Data</dt>
            <dd className="font-semibold text-plum">{formatDateBR(startDate)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4 py-4">
            <dt className="text-plum-muted">Hora</dt>
            <dd className="font-display text-2xl font-semibold text-plum">{formatTimeBR(startDate)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4 py-4">
            <dt className="text-plum-muted">Duração</dt>
            <dd className="font-medium text-plum">{service.durationMinutes} min</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4 py-5">
            <dt className="font-semibold text-plum">Valor</dt>
            <dd className="font-display text-3xl font-semibold text-wine">{formatCents(service.priceCents)}</dd>
          </div>
        </dl>
      </section>

      <StudioInfo site={site} className="mt-4" />

      <p className="mt-4 text-sm text-plum-muted">{cancelPolicyText(getBookingPolicy().clientCancelMinHours)}</p>
      <ConfirmBookingForm serviceId={service.id} startAtIso={startDate.toISOString()} />
    </Page>
  );
}
