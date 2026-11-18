import { prisma } from "@/lib/db";
import { formatDateTimeBR } from "@/lib/format";
import { BusinessHoursForm } from "@/components/BusinessHoursForm";
import { BlockedPeriodForm } from "@/components/BlockedPeriodForm";
import { deleteBlockedPeriodAction } from "./actions";

export default async function HorariosPage() {
  const [hours, blocks] = await Promise.all([
    prisma.businessHours.findMany(),
    prisma.blockedPeriod.findMany({ where: { endAt: { gte: new Date() } }, orderBy: { startAt: "asc" } }),
  ]);

  const hoursByDay = Object.fromEntries(hours.map((h) => [h.dayOfWeek, h]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Expediente</h1>
        <p className="text-sm text-fg-muted">Defina os dias e horários de atendimento e o intervalo de almoço. Serviços mais longos que o menor turno do dia (por exemplo, 4 h ou 5 h com almoço no meio) atravessam o almoço; para impedir um horário específico, use um bloqueio.</p>
      </div>

      <BusinessHoursForm hoursByDay={hoursByDay} />

      <div>
        <h2 className="font-display text-3xl font-extrabold uppercase italic text-fg">Bloqueios <span className="accent">pontuais</span></h2>
        <p className="text-sm text-fg-muted">Feriados, folgas e férias — o horário fica indisponível para reservas.</p>
      </div>

      <BlockedPeriodForm />

      <div className="space-y-2">
        {blocks.length === 0 ? (
          <p className="text-center text-sm text-fg-muted">Nenhum bloqueio futuro cadastrado.</p>
        ) : (
          blocks.map((block) => (
            <div key={block.id} className="card flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-fg">
                  {formatDateTimeBR(block.startAt)} até {formatDateTimeBR(block.endAt)}
                </p>
                {block.reason && <p className="text-sm text-fg-muted">{block.reason}</p>}
              </div>
              <form action={deleteBlockedPeriodAction.bind(null, block.id)}>
                <button type="submit" className="btn-ghost text-status-danger">
                  Remover
                </button>
              </form>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
