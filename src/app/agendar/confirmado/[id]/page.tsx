import { notFound, redirect } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { requireClient } from "@/lib/session";
import { getAppointmentForClient } from "@/lib/appointments";
import { getSiteSettings } from "@/lib/site-settings-cache";
import { whatsappLink } from "@/lib/site-settings";
import { formatDateBR, formatTimeBR } from "@/lib/format";
import { formatPlate } from "@/lib/plate";
import { PHOTOS } from "@/lib/site";
import { AddToGoogleCalendar } from "@/components/AddToGoogleCalendar";
import { CalendarIcon, CheckIcon, CarIcon, ClockIcon, WrenchIcon } from "@/components/icons";
import { idSchema } from "@/lib/validation";

export const metadata = { title: "Agendamento confirmado" };

export default async function AgendamentoConfirmadoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireClient();
  if (!idSchema.safeParse(id).success) notFound();

  // Nunca confiar no id da URL: só a DONA da reserva a vê (reserva de outra cliente responde 404, como se não existisse).
  const [appointment, site] = await Promise.all([getAppointmentForClient(id, user.id), getSiteSettings()]);
  if (!appointment) notFound();
  if (appointment.status !== "CONFIRMADA") redirect(`/meus-agendamentos/${appointment.id}`);

  const hero = PHOTOS.hero;
  const wa = whatsappLink(site.whatsapp);
  const waText = `Olá! Meu agendamento na ${site.siteName}: ${appointment.serviceName}, ${formatDateBR(appointment.startAt)} às ${formatTimeBR(appointment.startAt)}.`;
  const vehicle = [appointment.vehicleBrandSnapshot, appointment.vehicleModelSnapshot].filter(Boolean).join(" ");

  const rows = [
    { icon: <WrenchIcon className="h-6 w-6" />, label: "Serviço", value: appointment.serviceName },
    { icon: <CalendarIcon className="h-6 w-6" />, label: "Data", value: formatDateBR(appointment.startAt) },
    { icon: <ClockIcon className="h-6 w-6" />, label: "Horário", value: formatTimeBR(appointment.startAt) },
    ...(vehicle
      ? [{ icon: <CarIcon className="h-6 w-6" />, label: "Veículo", value: `${vehicle}${appointment.vehiclePlateSnapshot ? ` · ${formatPlate(appointment.vehiclePlateSnapshot)}` : ""}` }]
      : []),
  ];

  return (
    <main id="conteudo">
      <section className="relative isolate overflow-hidden border-b border-brand/70">
        <Image src={hero.src} alt="" width={hero.width} height={hero.height} priority sizes="100vw" className="absolute inset-0 -z-10 h-full w-full object-cover opacity-60" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-ink via-ink/80 to-transparent" aria-hidden="true" />
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand text-ink">
            <CheckIcon className="h-8 w-8" />
          </span>
          <h1 className="page-title mt-5 max-w-xl">
            Agendamento <span className="accent">confirmado</span>
          </h1>
          <div className="accent-rule mt-3" aria-hidden="true" />
          <p className="mt-3 max-w-md text-fg-muted">Tudo certo! Te esperamos no horário combinado.</p>
        </div>
      </section>

      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <section aria-label="Resumo do agendamento" className="rounded-2xl border border-brand/50 bg-surface shadow-soft">
          <dl className="divide-y divide-line px-5">
            {rows.map((r) => (
              <div key={r.label} className="flex items-center gap-4 py-4">
                <span className="text-brand">{r.icon}</span>
                <div className="min-w-0">
                  <dt className="text-sm text-fg-muted">{r.label}</dt>
                  <dd className="font-display text-xl font-bold tracking-wide text-fg">{r.value}</dd>
                </div>
              </div>
            ))}
          </dl>
        </section>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <Link href="/meus-agendamentos" className="btn-primary w-full sm:w-auto">
            Ver agendamentos
          </Link>
          {wa && (
            <a href={`${wa}?text=${encodeURIComponent(waText)}`} target="_blank" rel="noopener noreferrer" className="btn-secondary w-full sm:w-auto">
              Falar pelo WhatsApp
              <span className="sr-only"> (abre em uma nova aba)</span>
            </a>
          )}
        </div>

        <AddToGoogleCalendar appointment={appointment} site={site} />
      </div>
    </main>
  );
}
