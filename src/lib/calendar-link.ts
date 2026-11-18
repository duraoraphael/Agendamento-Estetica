import { TIMEZONE } from "./constants";

/**
 * Link "Salvar no Google Agenda" (modelo de criação de evento do Google). A cliente abre o link, vê o evento
 * já preenchido e confirma o salvamento NA PRÓPRIA conta; o site não acessa a agenda dela.
 *
 * Horários: o link leva início e fim em UTC (sufixo Z, a partir dos instantes gravados na reserva) e
 * `ctz=America/Sao_Paulo`, então o Google mostra o evento no fuso da empresa, sem depender do fuso do servidor
 * nem do navegador. Todos os parâmetros passam por encodeURIComponent (acentos, &, #, quebras de linha).
 */

export interface CalendarLinkInput {
  /** Reserva persistida: a única fonte dos dados do evento. */
  appointment: { id: string; serviceName: string; startAt: Date; endAt: Date };
  businessName: string;
  address?: string;
  locationNotes?: string;
  phone?: string;
}

const MAX_TITLE = 200;
const MAX_LOCATION = 300;
const MAX_DETAILS = 1200; // o endereço inteiro do link precisa caber nos ~2.000 caracteres que os navegadores/Google aceitam

/** "20261110T173000Z" a partir de um instante. */
export function toGoogleCalendarDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** Referência curta e legível da reserva (os últimos 8 caracteres do id, em maiúsculas). */
export function bookingReference(id: string): string {
  return id.slice(-8).toUpperCase();
}

/** Só reservas confirmadas e ainda futuras podem ser salvas na agenda. */
export function canSaveToGoogleCalendar(a: { status: string; startAt: Date }, now: Date = new Date()): boolean {
  return a.status === "CONFIRMADA" && a.startAt.getTime() > now.getTime();
}

export function buildGoogleCalendarUrl(input: CalendarLinkInput): string {
  const { appointment: a, businessName, address, locationNotes, phone } = input;

  const detailLines = [
    `Reserva ${bookingReference(a.id)}`,
    ...(locationNotes ? [`Como chegar: ${locationNotes}`] : []),
    ...(phone ? [`Contato: ${phone}`] : []),
    "Se este horário mudar, confira o evento salvo na sua agenda.",
  ];

  const params: [string, string][] = [
    ["action", "TEMPLATE"],
    ["text", `${a.serviceName} — ${businessName}`.slice(0, MAX_TITLE)],
    ["dates", `${toGoogleCalendarDate(a.startAt)}/${toGoogleCalendarDate(a.endAt)}`],
    ["ctz", TIMEZONE],
    ["details", detailLines.join("\n").slice(0, MAX_DETAILS)],
  ];
  if (address) params.push(["location", address.slice(0, MAX_LOCATION)]);

  return "https://calendar.google.com/calendar/render?" + params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
}
