/**
 * URLs do fluxo de agendamento. Os valores (serviceId, horário) vêm da URL ou de formulários, então NUNCA são
 * concatenados na string: URLSearchParams codifica "&", "=", "#", "?", "/" e espaços, e eles continuam sendo parte
 * do VALOR — não criam parâmetros, fragmentos nem segmentos novos.
 */

/** /agendar/horario?serviceId=...  (com `conflito`, a tela avisa que o horário escolhido foi ocupado). */
export function horarioUrl(serviceId: string, opts: { conflito?: boolean } = {}): string {
  const params = new URLSearchParams({ serviceId });
  if (opts.conflito) params.set("conflito", "1");
  return `/agendar/horario?${params.toString()}`;
}

/** /agendar/revisar?serviceId=...&startAt=...  (startAt = instante ISO escolhido). */
export function revisarUrl(serviceId: string, startAtIso: string): string {
  return `/agendar/revisar?${new URLSearchParams({ serviceId, startAt: startAtIso }).toString()}`;
}
