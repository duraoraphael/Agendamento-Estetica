 
// Verificações SOMENTE LEITURA sobre os dados (PostgreSQL).

const VALID_STATUS = ["CONFIRMADA", "CONCLUIDA", "CANCELADA", "FALTA"];
const BLOCKING = ["CONFIRMADA", "CONCLUIDA"];

export interface Issue {
  kind: "SOBREPOSICAO" | "STATUS_INVALIDO" | "PAPEL_INVALIDO" | "INTERVALO_INVALIDO" | "ORFA" | "VALOR_INVALIDO" | "EMAIL_DUPLICADO" | "ACIMA_DO_LIMITE";
  message: string;
  ids: string[];
}

/** Procura problemas que impediriam a restrição do PostgreSQL ou indicam dados inconsistentes. Nunca altera nada. */
export async function findDataIssues(db: any, opts: { maxActiveFuture?: number; now?: Date } = {}): Promise<Issue[]> {
  const issues: Issue[] = [];
  const now = opts.now ?? new Date();

  const appts: any[] = await db.appointment.findMany({ orderBy: { startAt: "asc" } });
  const users: any[] = await db.user.findMany();
  const services: any[] = await db.service.findMany({ select: { id: true } });
  const userIds = new Set(users.map((u) => u.id));
  const serviceIds = new Set(services.map((s) => s.id));

  // Status / valores / intervalos inválidos
  for (const a of appts) {
    if (!VALID_STATUS.includes(a.status)) issues.push({ kind: "STATUS_INVALIDO", message: `Reserva com situação inválida "${a.status}"`, ids: [a.id] });
    if (!(a.endAt > a.startAt)) issues.push({ kind: "INTERVALO_INVALIDO", message: "Reserva com término anterior ou igual ao início", ids: [a.id] });
    if (a.priceCents < 0 || a.durationMinutes <= 0) issues.push({ kind: "VALOR_INVALIDO", message: "Reserva com preço negativo ou duração não positiva", ids: [a.id] });
    if (!userIds.has(a.clientId) || !serviceIds.has(a.serviceId)) issues.push({ kind: "ORFA", message: "Reserva sem cliente ou serviço correspondente", ids: [a.id] });
  }
  for (const u of users) {
    if (!["CLIENTE", "ADMIN"].includes(u.role)) issues.push({ kind: "PAPEL_INVALIDO", message: `Usuária com papel inválido "${u.role}"`, ids: [u.id] });
  }
  const bp: any[] = await db.blockedPeriod.findMany();
  for (const b of bp) if (!(b.endAt > b.startAt)) issues.push({ kind: "INTERVALO_INVALIDO", message: "Bloqueio com término anterior ou igual ao início", ids: [b.id] });

  // E-mails duplicados ignorando maiúsculas (o cadastro normaliza para minúsculas)
  const byEmail = new Map<string, string[]>();
  for (const u of users) byEmail.set(u.email.toLowerCase(), [...(byEmail.get(u.email.toLowerCase()) ?? []), u.id]);
  for (const [, ids] of byEmail) if (ids.length > 1) issues.push({ kind: "EMAIL_DUPLICADO", message: `E-mail repetido (${ids.length} contas)`, ids });

  // Sobreposição entre reservas que ocupam a agenda: grupos de reservas encadeadas por tempo
  const active = appts.filter((a) => BLOCKING.includes(a.status));
  let group: any[] = [];
  let groupEnd = 0;
  const flush = () => {
    if (group.length > 1) {
      issues.push({ kind: "SOBREPOSICAO", message: `${group.length} reservas ativas se sobrepõem (${group[0].startAt.toISOString()})`, ids: group.map((g) => g.id) });
    }
  };
  for (const a of active) {
    if (group.length > 0 && a.startAt.getTime() < groupEnd) {
      group.push(a);
      groupEnd = Math.max(groupEnd, a.endAt.getTime());
    } else {
      flush();
      group = [a];
      groupEnd = a.endAt.getTime();
    }
  }
  flush();

  // Clientes acima do limite de reservas futuras ativas (informativo: dados antigos não são alterados)
  if (opts.maxActiveFuture) {
    const counts = new Map<string, string[]>();
    for (const a of active) if (a.startAt > now) counts.set(a.clientId, [...(counts.get(a.clientId) ?? []), a.id]);
    for (const [, ids] of counts) {
      if (ids.length > opts.maxActiveFuture) {
        issues.push({ kind: "ACIMA_DO_LIMITE", message: `Cliente com ${ids.length} reservas futuras ativas (limite ${opts.maxActiveFuture})`, ids });
      }
    }
  }
  return issues;
}
