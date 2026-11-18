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

/** /agendar/veiculo?serviceId=...&startAt=...  (etapa 3: veículo e observações). */
export function veiculoUrl(serviceId: string, startAtIso: string): string {
  return `/agendar/veiculo?${new URLSearchParams({ serviceId, startAt: startAtIso }).toString()}`;
}

/**
 * /agendar/revisar?serviceId=...&startAt=...&vehicleId=...  (startAt = instante ISO escolhido).
 * As observações NÃO vão na URL (ficam num cookie de curta duração): texto livre na URL iria para histórico e logs.
 */
export function revisarUrl(serviceId: string, startAtIso: string, vehicleId?: string): string {
  const params = new URLSearchParams({ serviceId, startAt: startAtIso });
  if (vehicleId) params.set("vehicleId", vehicleId);
  return `/agendar/revisar?${params.toString()}`;
}

/** /agendar/confirmado/<id>  (só a dona da reserva a vê; o id é revalidado no servidor). */
export function confirmadoUrl(appointmentId: string): string {
  return `/agendar/confirmado/${encodeURIComponent(appointmentId)}`;
}
