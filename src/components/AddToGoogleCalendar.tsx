import { buildGoogleCalendarUrl, canSaveToGoogleCalendar } from "@/lib/calendar-link";
import type { SiteSettingsView } from "@/lib/site-settings";

/**
 * Botão "Salvar no Google Agenda". Aparece somente para reservas futuras confirmadas. Os dados vêm da
 * reserva persistida e das Configurações do estúdio (nome, endereço, instruções, telefone).
 */
export function AddToGoogleCalendar({
  appointment,
  site,
  compact = false,
}: {
  appointment: { id: string; serviceName: string; startAt: Date; endAt: Date; status: string };
  site: SiteSettingsView;
  compact?: boolean;
}) {
  if (!canSaveToGoogleCalendar(appointment)) return null;

  const href = buildGoogleCalendarUrl({
    appointment,
    studioName: site.siteName,
    address: site.address,
    locationNotes: site.locationNotes,
    phone: site.phone || site.whatsapp,
  });

  return (
    <div className={compact ? "" : "mt-6"}>
      <a href={href} target="_blank" rel="noopener noreferrer" className="btn-secondary w-full sm:w-auto">
        <span aria-hidden="true">📅</span> Salvar no Google Agenda
        <span className="sr-only"> (abre o Google Agenda em uma nova aba)</span>
      </a>
      {!compact && (
        <p className="mt-2 text-xs text-plum-muted">
          O Google Agenda abre com o evento preenchido e você confirma o salvamento na sua conta. Depois de salvo, o evento é só seu: se este
          horário mudar, confira o evento na sua agenda.
        </p>
      )}
    </div>
  );
}
