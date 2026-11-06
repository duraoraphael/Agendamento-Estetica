/**
 * Google Agenda SIMULADO, só para desenvolvimento e verificação manual quando não há credenciais reais.
 * Ligado por GOOGLE_CALENDAR_MOCK=1 e NUNCA em produção (NODE_ENV=production o desliga, mesmo com a variável).
 *
 * Imita o comportamento documentado da API: ID escolhido pelo cliente, 409 se o ID já existe, 404 para evento
 * inexistente, evento removido que continua existindo como "cancelled", e `freebusy` por agenda.
 * O estado (eventos e o interruptor de falha) vive em memória do processo; a rota /api/dev/google-mock
 * (também só fora de produção) permite ver os eventos e ligar/desligar falhas para testar o "tentar novamente".
 */

type Ev = Record<string, unknown>;
interface MockState {
  events: Map<string, Ev>;
  failing: boolean;
  calls: string[];
}

const g = globalThis as unknown as { __googleMock?: MockState };
function state(): MockState {
  return (g.__googleMock ??= { events: new Map(), failing: false, calls: [] });
}

export function isMockCalendarEnabled(): boolean {
  return process.env.GOOGLE_CALENDAR_MOCK === "1" && process.env.NODE_ENV !== "production";
}

export function mockCalendarControl() {
  const s = state();
  return {
    setFailing: (v: boolean) => (s.failing = v),
    reset: () => {
      s.events.clear();
      s.calls.length = 0;
      s.failing = false;
    },
    snapshot: () => ({ failing: s.failing, calls: [...s.calls], events: [...s.events.entries()].map(([id, e]) => ({ id, ...e })) }),
  };
}

const httpError = (code: number, message: string) => Object.assign(new Error(message), { code });

export function createMockCalendar() {
  const s = state();
  const guard = (op: string) => {
    s.calls.push(op);
    if (s.failing) throw httpError(503, "Google Agenda simulado indisponível");
  };
  return {
    freebusy: {
      query: async (req: { requestBody: { items: { id: string }[] } }) => {
        guard("freebusy");
        const id = req.requestBody.items[0].id;
        const busy = [...s.events.values()]
          .filter((e) => e.status !== "cancelled")
          .map((e) => ({ start: (e.start as { dateTime: string }).dateTime, end: (e.end as { dateTime: string }).dateTime }));
        return { data: { calendars: { [id]: { busy } } } };
      },
    },
    events: {
      insert: async ({ requestBody }: { requestBody: Ev & { id: string } }) => {
        guard("insert");
        if (s.events.has(requestBody.id)) throw httpError(409, "identifier already exists");
        s.events.set(requestBody.id, { ...requestBody });
        return { data: { id: requestBody.id } };
      },
      get: async ({ eventId }: { eventId: string }) => {
        guard("get");
        const e = s.events.get(eventId);
        if (!e) throw httpError(404, "not found");
        return { data: e };
      },
      update: async ({ eventId, requestBody }: { eventId: string; requestBody: Ev }) => {
        guard("update");
        if (!s.events.has(eventId)) throw httpError(404, "not found");
        s.events.set(eventId, { ...requestBody, id: eventId });
        return { data: { id: eventId } };
      },
      delete: async ({ eventId }: { eventId: string }) => {
        guard("delete");
        if (!s.events.has(eventId)) throw httpError(404, "not found");
        s.events.set(eventId, { id: eventId, status: "cancelled" });
        return { data: {} };
      },
    },
  };
}
