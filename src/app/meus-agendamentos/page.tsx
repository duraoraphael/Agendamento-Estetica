import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireClient } from "@/lib/session";
import { splitUpcomingAndHistory } from "@/lib/appointments";
import { formatDateBR, formatTimeBR } from "@/lib/format";
import { cancelPolicyText, getBookingPolicy } from "@/lib/policy";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState, Page, PageHeader } from "@/components/ui";
import { CalendarIcon, CarIcon, ClockIcon } from "@/components/icons";
import { getServiceInfo } from "@/lib/service-catalog";
import { PHOTOS } from "@/lib/site";
import { confirmadoUrl } from "@/lib/booking-urls";

export const metadata = { title: "Meus agendamentos" };

type Item = Awaited<ReturnType<typeof prisma.appointment.findMany>>[number];

const VEHICLE_FALLBACK = "Veículo não informado";

function AppointmentCard({ a }: { a: Item }) {
  const photo = PHOTOS[getServiceInfo(a.serviceName).photo];
  const vehicle = [a.vehicleBrandSnapshot, a.vehicleModelSnapshot].filter(Boolean).join(" ");
  return (
    <li className="overflow-hidden rounded-2xl border border-brand/45 bg-surface shadow-soft sm:flex">
      <Image src={photo.src} alt="" width={photo.width} height={photo.height} sizes="(min-width: 640px) 208px, 100vw" className="h-32 w-full flex-none object-cover sm:h-auto sm:w-52" />
      <div className="flex min-w-0 flex-1 flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:border-l sm:border-brand/45">
        <div className="min-w-0">
          <h2 className="truncate font-display text-xl font-bold uppercase not-italic tracking-wide text-fg">{a.serviceName}</h2>
          <div className="mt-1.5">
            <StatusBadge status={a.status} />
          </div>
          <dl className="mt-3 space-y-1 text-sm text-fg-muted">
            <div className="flex items-center gap-2">
              <dt className="sr-only">Veículo</dt>
              <CarIcon className="h-4 w-4 text-brand" />
              <dd>{vehicle || VEHICLE_FALLBACK}</dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className="sr-only">Data</dt>
              <CalendarIcon className="h-4 w-4 text-brand" />
              <dd>{formatDateBR(a.startAt)}</dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className="sr-only">Horário</dt>
              <ClockIcon className="h-4 w-4 text-brand" />
              <dd>{formatTimeBR(a.startAt)}</dd>
            </div>
          </dl>
        </div>
        <Link href={`/meus-agendamentos/${a.id}`} className="btn-primary w-full sm:w-auto">
          Ver detalhes<span className="sr-only"> de {a.serviceName}, {formatDateBR(a.startAt)}</span>
        </Link>
      </div>
    </li>
  );
}

export default async function MeusAgendamentosPage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<{ confirmado?: string; aba?: string }>;
}) {
  const searchParams = await searchParamsPromise;
  // Links antigos (?confirmado=ID) levam à página de confirmação; ela revalida a posse no servidor.
  if (searchParams.confirmado) redirect(confirmadoUrl(searchParams.confirmado));

  const user = await requireClient();
  const appointments = await prisma.appointment.findMany({ where: { clientId: user.id }, orderBy: { startAt: "desc" } });
  const { upcoming, history } = splitUpcomingAndHistory(appointments);

  const tab = searchParams.aba === "historico" ? "historico" : "proximos";
  const list = tab === "historico" ? history : upcoming;
  const tabClass = (active: boolean) =>
    `inline-flex min-h-[44px] flex-1 items-center justify-center px-6 text-sm font-bold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand sm:flex-none ${
      active ? "bg-brand text-ink" : "text-fg hover:bg-surface-2"
    }`;

  return (
    <Page width="lg">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader title="Meus" accent="agendamentos" />
        <Link href="/agendar" className="btn-primary">
          Novo agendamento
        </Link>
      </div>

      <nav aria-label="Seus agendamentos" className="mt-6 flex w-full overflow-hidden rounded-lg border border-brand/60 sm:inline-flex sm:w-auto">
        <Link href="/meus-agendamentos" className={tabClass(tab === "proximos")} aria-current={tab === "proximos" ? "page" : undefined}>
          Próximos{upcoming.length > 0 ? ` (${upcoming.length})` : ""}
        </Link>
        <Link href="/meus-agendamentos?aba=historico" className={tabClass(tab === "historico")} aria-current={tab === "historico" ? "page" : undefined}>
          Histórico
        </Link>
      </nav>

      {tab === "proximos" && <p className="mt-4 text-sm text-fg-muted">{cancelPolicyText(getBookingPolicy().clientCancelMinHours)}</p>}

      <section className="mt-5" aria-label={tab === "historico" ? "Histórico" : "Próximos agendamentos"}>
        {list.length === 0 ? (
          tab === "proximos" ? (
            <EmptyState
              title="Nenhum agendamento marcado"
              action={
                <Link href="/agendar" className="btn-primary">
                  Agendar agora
                </Link>
              }
            >
              Quando você agendar, seus próximos atendimentos aparecem aqui.
            </EmptyState>
          ) : (
            <EmptyState title="Sem histórico ainda">Seus atendimentos concluídos, cancelados ou passados aparecerão aqui.</EmptyState>
          )
        ) : (
          <ul className="space-y-4">
            {list.map((a) => (
              <AppointmentCard key={a.id} a={a} />
            ))}
          </ul>
        )}
      </section>
    </Page>
  );
}
