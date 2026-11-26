/**
 * URLs do fluxo de agendamento: serviço → veículo → data e horário → revisão → confirmado.
 *
 * Os valores (serviceId, veículo, horário) vêm da URL ou de formulários, então NUNCA são concatenados na string:
 * URLSearchParams codifica "&", "=", "#", "?", "/" e espaços, e eles continuam sendo parte do VALOR — não criam
 * parâmetros, fragmentos nem segmentos novos. Este módulo não importa nada de servidor (telas de cliente o usam).
 */

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const TIME_KEY = /^([01]\d|2[0-3]):[0-5]\d$/;

/** AAAA-MM-DD de um dia que existe no calendário (2026-02-30 não vale). */
function isDateKey(value: string): boolean {
  if (!DATE_KEY.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Preferências de dia e horário (vindas do agendamento rápido da página inicial). Valor inválido é descartado. */
interface SlotPreference {
  data?: string;
  hora?: string;
}

function addPreference(params: URLSearchParams, pref: SlotPreference) {
  if (pref.data && isDateKey(pref.data)) params.set("data", pref.data);
  if (pref.hora && TIME_KEY.test(pref.hora)) params.set("hora", pref.hora);
}

/** /agendar/veiculo?serviceId=...  (etapa 2: escolher ou cadastrar o veículo; guarda a preferência de dia/horário). */
export function veiculoUrl(serviceId: string, opts: SlotPreference = {}): string {
  const params = new URLSearchParams({ serviceId });
  addPreference(params, opts);
  return `/agendar/veiculo?${params.toString()}`;
}

/**
 * /agendar/horario?serviceId=...&vehicleId=...  (etapa 3). Sem `vehicleId` a página volta para a etapa do veículo.
 * Com `conflito`, a tela avisa que o horário escolhido foi ocupado.
 */
export function horarioUrl(serviceId: string, opts: SlotPreference & { vehicleId?: string; conflito?: boolean } = {}): string {
  const params = new URLSearchParams({ serviceId });
  if (opts.vehicleId) params.set("vehicleId", opts.vehicleId);
  addPreference(params, opts);
  if (opts.conflito) params.set("conflito", "1");
  return `/agendar/horario?${params.toString()}`;
}

/**
 * /agendar/revisar?serviceId=...&startAt=...&vehicleId=...  (startAt = instante ISO escolhido).
 * As observações NÃO vão na URL (ficam num cookie de curta duração): texto livre na URL iria para histórico e logs.
 */
export function revisarUrl(serviceId: string, startAtIso: string, vehicleId: string): string {
  return `/agendar/revisar?${new URLSearchParams({ serviceId, startAt: startAtIso, vehicleId }).toString()}`;
}

/** /agendar/confirmado/<id>  (só a dona da reserva a vê; o id é revalidado no servidor). */
export function confirmadoUrl(appointmentId: string): string {
  return `/agendar/confirmado/${encodeURIComponent(appointmentId)}`;
}
