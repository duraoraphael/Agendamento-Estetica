import { vi } from "vitest";

type StoredEvent = Record<string, any>;

/** Integração simulada do Google Calendar com comportamento de IDs/409 como o real. */
export function makeFakeCalendar() {
  const events = new Map<string, StoredEvent>();
  const calls: string[] = [];
  const failures: Record<string, any[]> = {}; // fila de falhas por operação
  let busy: { start: string; end: string }[] = [];
  let freebusyFails = false;
  const hooks: { beforeInsertStore?: () => Promise<void> } = {};

  const nextFailure = (op: string) => failures[op]?.shift();
  const err = (code: number, message = "erro") => Object.assign(new Error(message), { code });

  const api: any = {
    freebusy: {
      query: vi.fn(async (req: any) => {
        calls.push("freebusy");
        if (freebusyFails) throw err(500, "freebusy fora do ar");
        const id = req.requestBody.items[0].id;
        return { data: { calendars: { [id]: { busy } } } };
      }),
    },
    events: {
      insert: vi.fn(async ({ requestBody }: any) => {
        calls.push("insert");
        const f = nextFailure("insert");
        if (f?.beforeStore) throw f.beforeStore;
        if (hooks.beforeInsertStore) {
          const run = hooks.beforeInsertStore;
          hooks.beforeInsertStore = undefined; // só na primeira chamada
          await run(); // ex.: o administrador cancela enquanto a criação do evento está em andamento
        }
        if (events.has(requestBody.id)) throw err(409, "identifier already exists");
        events.set(requestBody.id, { ...requestBody });
        if (f?.afterStore) throw f.afterStore; // o Google gravou, mas a resposta se perdeu
        return { data: { id: requestBody.id } };
      }),
      get: vi.fn(async ({ eventId }: any) => {
        calls.push("get");
        const e = events.get(eventId);
        if (!e) throw err(404);
        return { data: e };
      }),
      update: vi.fn(async ({ eventId, requestBody }: any) => {
        calls.push("update");
        const f = nextFailure("update");
        if (f) throw f;
        if (!events.has(eventId)) throw err(404);
        events.set(eventId, { ...requestBody, id: eventId });
        return { data: { id: eventId } };
      }),
      delete: vi.fn(async ({ eventId }: any) => {
        calls.push("delete");
        const f = nextFailure("delete");
        if (f) throw f;
        const e = events.get(eventId);
        if (!e) throw err(404);
        // Como no Google real: o evento removido continua existindo como "cancelled", sem as propriedades.
        events.set(eventId, { id: eventId, status: "cancelled" });
        return { data: {} };
      }),
    },
  };

  return {
    api,
    hooks,
    events,
    calls,
    failNext: (op: string, failure: any) => ((failures[op] ??= []).push(failure)),
    setBusy: (b: typeof busy) => (busy = b),
    setFreebusyFails: (v: boolean) => (freebusyFails = v),
    live: () => [...events.values()].filter((e) => e.status !== "cancelled"),
    err,
  };
}
