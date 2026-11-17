import crypto from "node:crypto";
import type { calendar_v3 } from "googleapis";
import type { GoogleCalendarAccount } from "@prisma/client";
import { prisma } from "./db";
import { encryptSecret, decryptSecret } from "./crypto";
import { GOOGLE_EVENTS_TIMEOUT_MS, GOOGLE_FREEBUSY_TIMEOUT_MS } from "./constants";
import { loadSiteSettings } from "./site-settings";
import { createMockCalendar, isMockCalendarEnabled } from "./google-mock";
import type { Interval } from "./availability";
import type { Db } from "./prisma-types";

const SCOPES = ["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.readonly"];

/** A agenda do Google está conectada, mas não foi possível consultá-la agora. */
export class CalendarUnavailableError extends Error {
  constructor(message = "Não foi possível verificar a agenda do estúdio agora.") {
    super(message);
    this.name = "CalendarUnavailableError";
  }
}

type CalendarApi = Pick<calendar_v3.Calendar, "events" | "freebusy">;
let calendarFactoryOverride: ((account: { calendarId: string }) => CalendarApi) | null = null;

/** Somente para testes: substitui o cliente do Google por uma integração simulada. */
export function __setCalendarFactoryForTests(factory: typeof calendarFactoryOverride) {
  calendarFactoryOverride = factory;
}

/**
 * ID determinístico do evento, derivado do ID da reserva. O Google exige IDs em
 * base32hex (a-v, 0-9) com 5 a 1024 caracteres; hexadecimal minúsculo atende.
 * Repetir a criação com o mesmo ID nunca gera um segundo evento (o Google
 * responde 409), o que torna o retry seguro após timeout ou resposta perdida.
 */
export function eventIdForAppointment(appointmentId: string): string {
  return "ag" + crypto.createHash("sha256").update(appointmentId).digest("hex");
}

export function isGoogleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI);
}

/**
 * O SDK `googleapis` é enorme (milhares de módulos). Carregá-lo só quando uma chamada real ao Google
 * acontece evita que ele pese na compilação e no arranque das páginas que apenas importam este arquivo
 * (listagem de horários, painel, faturamento...), e some do caminho de quem não usa a integração.
 */
async function loadGoogle() {
  return (await import("googleapis")).google;
}

async function createOAuthClient() {
  if (!isGoogleConfigured()) return null;
  const google = await loadGoogle();
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

export async function getGoogleAuthUrl(state: string): Promise<string | null> {
  const client = await createOAuthClient();
  if (!client) return null;
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state,
  });
}

/** Outra administradora tentou conectar o Google enquanto já existe uma conta conectada (a conexão é única). */
export class GoogleAccountConflictError extends Error {
  constructor() {
    super("Já existe uma conta do Google conectada por outra administradora. Desconecte-a antes de conectar outra.");
    this.name = "GoogleAccountConflictError";
  }
}

/**
 * CONTRATO: o negócio tem UMA agenda do Google (uma conexão). As reservas não guardam a qual conta pertencem — o
 * evento de qualquer reserva vai para a conta conectada —, então duas contas ao mesmo tempo seriam ambíguas.
 * Por isso:
 *  - conectar enquanto OUTRA administradora já tem conexão é recusado (GoogleAccountConflictError);
 *  - a conta da própria administradora é substituída (reconectar);
 *  - se mesmo assim existirem duas ou mais linhas (dados antigos, ou duas conexões simultâneas), NENHUMA é usada:
 *    a disponibilidade e a sincronização falham fechadas até alguém desconectar em Configurações > Google Agenda.
 */
export async function handleGoogleOAuthCallback(adminUserId: string, code: string): Promise<void> {
  const client = await createOAuthClient();
  if (!client) throw new Error("Integração com o Google não está configurada.");

  const { tokens } = await client.getToken(code);
  if (!tokens.access_token || !tokens.refresh_token || !tokens.expiry_date) {
    throw new Error(
      "O Google não retornou um refresh token. Remova o acesso do app em myaccount.google.com/permissions e tente novamente."
    );
  }

  const accessToken = encryptSecret(tokens.access_token);
  const refreshToken = encryptSecret(tokens.refresh_token);
  const expiryDate = new Date(tokens.expiry_date);

  // Checagem e gravação na mesma transação: no PostgreSQL o pior caso (duas
  // conexões simultâneas) deixa duas linhas, que a leitura abaixo trata como ambíguas (falha fechada).
  await prisma.$transaction(async (tx) => {
    const other = await tx.googleCalendarAccount.findFirst({ where: { adminUserId: { not: adminUserId } }, select: { id: true } });
    if (other) throw new GoogleAccountConflictError();
    await tx.googleCalendarAccount.upsert({
      where: { adminUserId },
      update: { accessToken, refreshToken, expiryDate, lastSyncError: null },
      create: { adminUserId, accessToken, refreshToken, expiryDate, calendarId: "primary" },
    });
  });
  clearFreeBusyCache();
}

/**
 * Desconecta o Google. Sem argumento remove TODAS as conexões (a conexão é única e qualquer administradora pode
 * desfazê-la; é também como se resolve uma ambiguidade). Com `adminUserId`, só a daquela administradora.
 */
export async function disconnectGoogleCalendar(adminUserId?: string): Promise<void> {
  await prisma.googleCalendarAccount.deleteMany({ where: adminUserId ? { adminUserId } : {} });
  clearFreeBusyCache();
}

type AccountRow = GoogleCalendarAccount;
type AccountResolution = { status: "none" } | { status: "ok"; account: AccountRow } | { status: "ambiguous"; count: number };

/** A conta do Google conectada: nenhuma, exatamente uma, ou ambígua (mais de uma linha — nunca escolhe uma "qualquer"). */
async function resolveConnectedAccount(db: Db): Promise<AccountResolution> {
  const rows = await db.googleCalendarAccount.findMany({ orderBy: [{ connectedAt: "asc" }, { id: "asc" }], take: 2 });
  if (rows.length === 0) return { status: "none" };
  if (rows.length > 1) return { status: "ambiguous", count: rows.length };
  return { status: "ok", account: rows[0] };
}

const AMBIGUOUS_ACCOUNT_MESSAGE =
  "Há mais de uma conta do Google conectada. Em Configurações > Google Agenda, desconecte e conecte novamente.";

/** Há conexão registrada? Verdadeiro também quando ambígua: quem consulta a agenda deve falhar fechado, não ignorá-la. */
export async function isGoogleCalendarConnected(db: Db = prisma): Promise<boolean> {
  if (!isGoogleConfigured() && !calendarFactoryOverride && !isMockCalendarEnabled()) return false;
  return (await resolveConnectedAccount(db)).status !== "none";
}

/** Conta única, ou null se não há conexão. Com mais de uma linha, falha fechada (CalendarUnavailableError). */
async function getConnectedAccount(db: Db): Promise<AccountRow | null> {
  const resolved = await resolveConnectedAccount(db);
  if (resolved.status === "ambiguous") {
    console.error(`Google Agenda: ${resolved.count} contas conectadas; nenhuma será usada até haver uma só.`);
    throw new CalendarUnavailableError();
  }
  return resolved.status === "ok" ? resolved.account : null;
}

type ConnectedAccount = AccountRow;

type RefreshedTokens = { access_token?: string | null; refresh_token?: string | null; expiry_date?: number | null };

/** Resumo de falha de gravação SEM a mensagem: erros do Prisma podem trazer os valores (tokens cifrados) da consulta. */
function persistenceErrorSummary(err: unknown): string {
  const e = err as { name?: unknown; code?: unknown };
  return `${typeof e?.name === "string" ? e.name : "Error"}${typeof e?.code === "string" ? ` (${e.code})` : ""}`;
}

/**
 * Grava na conexão `accountId` os tokens que o Google acabou de emitir (evento "tokens" do cliente OAuth).
 *  - `refresh_token` só vem quando o Google o rotaciona: então é gravado (cifrado); sem ele, o guardado é mantido.
 *  - `access_token`/`expiry_date` só avançam: se outra renovação simultânea (outro cliente OAuth da mesma conta) já
 *    gravou um token que vale por mais tempo, o evento atrasado não o sobrescreve.
 *  - Falha de gravação nunca derruba a chamada em andamento (o cliente já tem os tokens em memória) e nunca registra
 *    token algum: o próximo uso relê o banco.
 */
export async function persistRefreshedTokens(accountId: string, tokens: RefreshedTokens, db: Db = prisma): Promise<void> {
  try {
    if (tokens.refresh_token) {
      await db.googleCalendarAccount.updateMany({ where: { id: accountId }, data: { refreshToken: encryptSecret(tokens.refresh_token) } });
    }
    if (tokens.access_token || tokens.expiry_date) {
      const data: { accessToken?: string; expiryDate?: Date } = {};
      if (tokens.access_token) data.accessToken = encryptSecret(tokens.access_token);
      if (tokens.expiry_date) data.expiryDate = new Date(tokens.expiry_date);
      await db.googleCalendarAccount.updateMany({
        where: { id: accountId, ...(data.expiryDate ? { expiryDate: { lte: data.expiryDate } } : {}) },
        data,
      });
    }
  } catch (err) {
    console.error("Falha ao gravar os tokens renovados do Google Agenda:", persistenceErrorSummary(err));
  }
}

async function getAuthorizedClient(account: { id: string; accessToken: string; refreshToken: string; expiryDate: Date }) {
  const client = await createOAuthClient();
  if (!client) return null;

  client.setCredentials({
    access_token: decryptSecret(account.accessToken),
    refresh_token: decryptSecret(account.refreshToken),
    expiry_date: account.expiryDate.getTime(),
  });

  // Renova o access token quando necessário e persiste o que o Google emitiu (inclusive um refresh token rotacionado).
  client.on("tokens", (tokens) => {
    void persistRefreshedTokens(account.id, tokens);
  });

  return client;
}

async function getCalendarApi(account: ConnectedAccount): Promise<CalendarApi | null> {
  if (calendarFactoryOverride) return calendarFactoryOverride(account);
  if (isMockCalendarEnabled()) return createMockCalendar() as unknown as CalendarApi;
  const client = await getAuthorizedClient(account);
  if (!client) return null;
  const google = await loadGoogle();
  return google.calendar({ version: "v3", auth: client });
}

/**
 * Busy intervals vindos da agenda conectada.
 *
 * Falha FECHADA: se há agenda conectada e a consulta falha, lança
 * CalendarUnavailableError. Quem confirma ou reativa uma reserva deve recusar
 * a operação (com mensagem para tentar de novo) em vez de assumir "livre" e
 * arriscar conflito com compromissos reais da administradora.
 */
export async function getFreeBusyIntervals(rangeStart: Date, rangeEnd: Date, db: Db = prisma): Promise<Interval[]> {
  const account = await getConnectedAccount(db);
  if (!account) return [];
  try {
    const calendar = await getCalendarApi(account);
    if (!calendar) throw new Error("Cliente do Google não configurado.");

    const res = await calendar.freebusy.query(
      {
        requestBody: {
          timeMin: rangeStart.toISOString(),
          timeMax: rangeEnd.toISOString(),
          items: [{ id: account.calendarId }],
        },
      },
      { timeout: GOOGLE_FREEBUSY_TIMEOUT_MS, retry: false }
    );

    const info = res.data.calendars?.[account.calendarId];
    // O Google devolve erros por agenda dentro de um 200 OK (ex.: notFound); tratamos como falha.
    if (!info || (info.errors && info.errors.length > 0)) {
      throw new Error("Resposta do FreeBusy sem dados da agenda.");
    }
    return (info.busy ?? [])
      .filter((b) => b.start && b.end)
      .map((b) => ({ start: new Date(b.start as string), end: new Date(b.end as string) }));
  } catch (err) {
    console.error("Falha ao consultar FreeBusy do Google Agenda:", safeErrorSummary(err));
    throw new CalendarUnavailableError();
  }
}

/**
 * Intervalos ocupados na agenda externa; [] quando a integração está desativada.
 * Deve ser chamada ANTES de abrir a transação do banco: a chamada de rede não
 * pode segurar o lock de escrita. A janela entre esta consulta e o COMMIT é
 * curta, mas um evento criado no Google nesse intervalo não será visto (veja README).
 */
export async function fetchExternalBusy(
  rangeStart: Date,
  rangeEnd: Date,
  db: Db = prisma,
  opts: { allowCache?: boolean } = {}
): Promise<Interval[]> {
  if (!(await isGoogleCalendarConnected(db))) return [];
  if (!opts.allowCache) return getFreeBusyIntervals(rangeStart, rangeEnd, db);

  // Cache SÓ para a LISTAGEM de horários (nunca para confirmar ou reativar, que consultam o Google na hora):
  //  - chave: agenda + intervalo exato consultado (um dia local); escopo: o processo, e só guarda pares início/fim,
  //    sem nenhum dado pessoal;
  //  - validade: 15 s; consultas simultâneas ao mesmo dia dividem uma única chamada ao Google;
  //  - invalidação: ao conectar/desconectar a conta, ao gravar um evento e por expiração; falhas nunca ficam guardadas.
  const account = await getConnectedAccount(db);
  if (!account) return [];
  const key = `${account.calendarId}|${rangeStart.toISOString()}|${rangeEnd.toISOString()}`;
  const now = Date.now();
  const hit = freebusyCache.get(key);
  if (hit && hit.expires > now) return hit.value.then(cloneIntervals);
  const value = getFreeBusyIntervals(rangeStart, rangeEnd, db);
  freebusyCache.set(key, { expires: now + FREEBUSY_CACHE_TTL_MS, value });
  value.catch(() => freebusyCache.delete(key));
  if (freebusyCache.size > 200) for (const [k, v] of freebusyCache) if (v.expires <= now) freebusyCache.delete(k);
  return value.then(cloneIntervals);
}

const FREEBUSY_CACHE_TTL_MS = 15_000;
const freebusyCache = new Map<string, { expires: number; value: Promise<Interval[]> }>();
const cloneIntervals = (v: Interval[]) => v.map((i) => ({ start: new Date(i.start), end: new Date(i.end) }));

/** Descarta o cache de disponibilidade externa (conta conectada/desconectada, evento gravado). */
export function clearFreeBusyCache() {
  freebusyCache.clear();
}

interface AppointmentForSync {
  id: string;
  serviceName: string;
  startAt: Date;
  endAt: Date;
  status: string;
  googleEventId: string | null;
  googleSyncAttempts?: number;
  client: { name: string; phone: string };
}

/** Intervalos de nova tentativa automática (fila durável): 1 min, 5 min, 15 min, 1 h, 6 h. Depois disso, só manual. */
export const SYNC_RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000];
export const MAX_AUTO_SYNC_ATTEMPTS = SYNC_RETRY_DELAYS_MS.length + 1;

/** Quando tentar de novo após a falha número `attempts` (1 = primeira falha); null = parar de tentar sozinho. */
export function nextSyncAttemptAt(attempts: number, now: Date = new Date()): Date | null {
  if (attempts >= MAX_AUTO_SYNC_ATTEMPTS) return null;
  return new Date(now.getTime() + SYNC_RETRY_DELAYS_MS[Math.min(attempts, SYNC_RETRY_DELAYS_MS.length) - 1]);
}

function errorCode(err: unknown): number | undefined {
  const e = err as { code?: unknown; status?: unknown; response?: { status?: unknown } };
  const raw = e?.code ?? e?.status ?? e?.response?.status;
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") return Number(raw) || undefined;
  return undefined;
}

/**
 * Cria/atualiza/remove o evento correspondente a uma reserva na agenda
 * conectada, de forma idempotente:
 *  - o evento usa um ID determinístico derivado da reserva (eventIdForAppointment);
 *  - se a criação for repetida (timeout, resposta perdida), o Google responde
 *    409; então buscamos o evento existente, CONFERIMOS que ele pertence a esta
 *    reserva (propriedade privada appointmentId) e o reconciliamos em vez de
 *    criar outro ou declarar sucesso às cegas;
 *  - em caso de erro, marca ERRO no banco para nova tentativa manual.
 */
async function syncOnce(appointment: AppointmentForSync): Promise<void> {
  let account: AccountRow | null;
  try {
    account = await getConnectedAccount(prisma);
  } catch (err) {
    // Conexão ambígua (mais de uma conta): não escolhe uma por engano; registra ERRO na fila para o painel mostrar.
    await recordSyncFailure(appointment, err instanceof CalendarUnavailableError ? new Error(AMBIGUOUS_ACCOUNT_MESSAGE) : err);
    return;
  }
  if (!account) {
    await prisma.appointment.update({
      where: { id: appointment.id },
      data: { googleSyncStatus: "NAO_CONECTADO", googleSyncError: null, googleSyncAttempts: 0, googleSyncNextAt: null },
    });
    return;
  }

  const requestOpts = { timeout: GOOGLE_EVENTS_TIMEOUT_MS, retry: false };
  const deterministicId = eventIdForAppointment(appointment.id);

  try {
    const calendar = await getCalendarApi(account);
    if (!calendar) throw new Error("Cliente do Google não configurado.");
    const calendarId = account.calendarId;

    if (appointment.status === "CANCELADA" || appointment.status === "FALTA") {
      // Removemos o evento conhecido E o determinístico: se uma criação anterior
      // teve a resposta perdida, o evento existe no Google mesmo sem ID salvo.
      const ids = new Set([deterministicId, ...(appointment.googleEventId ? [appointment.googleEventId] : [])]);
      for (const eventId of ids) {
        await calendar.events.delete({ calendarId, eventId }, requestOpts).catch((err: unknown) => {
          // Já removido (404/410) é o resultado desejado.
          if (errorCode(err) !== 404 && errorCode(err) !== 410) throw err;
        });
      }
      await prisma.appointment.update({
        where: { id: appointment.id },
        data: { googleSyncStatus: "SINCRONIZADO", googleSyncError: null, googleEventId: null, googleSyncAttempts: 0, googleSyncNextAt: null },
      });
      return;
    }

    const site = await loadSiteSettings(prisma).catch(() => null);
    const eventBody: calendar_v3.Schema$Event = {
      summary: `${appointment.serviceName} — ${appointment.client.name}`,
      description: `Cliente: ${appointment.client.name}\nCelular: ${appointment.client.phone}\nReferência: ${appointment.id}`,
      ...(site?.address ? { location: site.address } : {}),
      start: { dateTime: appointment.startAt.toISOString(), timeZone: "America/Sao_Paulo" },
      end: { dateTime: appointment.endAt.toISOString(), timeZone: "America/Sao_Paulo" },
      status: "confirmed",
      extendedProperties: { private: { appointmentId: appointment.id } },
    };

    let eventId = appointment.googleEventId ?? deterministicId;
    let done = false;

    if (appointment.googleEventId) {
      try {
        await calendar.events.update({ calendarId, eventId, requestBody: eventBody }, requestOpts);
        done = true;
      } catch (err) {
        // Evento removido manualmente: recriamos com o ID determinístico.
        if (errorCode(err) !== 404 && errorCode(err) !== 410) throw err;
      }
    }

    if (!done) {
      try {
        await calendar.events.insert({ calendarId, requestBody: { ...eventBody, id: deterministicId } }, requestOpts);
      } catch (err) {
        if (errorCode(err) !== 409) throw err;
        // ID já existe: pode ser o retry de uma criação bem-sucedida, ou o evento
        // cancelado de uma reserva reativada. Só aceitamos se for desta reserva.
        const existing = await calendar.events.get({ calendarId, eventId: deterministicId }, requestOpts);
        // Evento cancelado (removido) pode voltar sem as propriedades estendidas; nesse caso
        // o próprio ID (SHA-256 do ID da reserva) já comprova a posse e o evento é restaurado.
        const owned =
          existing.data.status === "cancelled" || existing.data.extendedProperties?.private?.appointmentId === appointment.id;
        if (!owned) {
          throw new Error("Já existe um evento com este ID que não pertence a esta reserva.");
        }
        await calendar.events.update({ calendarId, eventId: deterministicId, requestBody: eventBody }, requestOpts);
      }
      eventId = deterministicId;
    }

    await prisma.appointment.update({
      where: { id: appointment.id },
      data: { googleSyncStatus: "SINCRONIZADO", googleSyncError: null, googleEventId: eventId, googleSyncAttempts: 0, googleSyncNextAt: null },
    });
  } catch (err) {
    await recordSyncFailure(appointment, err);
  }
}

/** Registra a falha de sincronização na fila durável: ERRO, mensagem e horário da próxima tentativa automática. */
async function recordSyncFailure(appointment: AppointmentForSync, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : "Erro desconhecido ao sincronizar com o Google Agenda.";
  console.error("Falha ao sincronizar reserva com o Google Agenda:", safeErrorSummary(err));
  const attempts = (appointment.googleSyncAttempts ?? 0) + 1;
  await prisma.appointment.update({
    where: { id: appointment.id },
    data: {
      googleSyncStatus: "ERRO",
      googleSyncError: message.slice(0, 500),
      googleSyncAttempts: attempts,
      googleSyncNextAt: nextSyncAttemptAt(attempts),
    },
  });
}

/** Resumo de erro SEM o corpo da requisição: erros do cliente HTTP do Google carregam o evento (nome e celular da cliente). */
export function safeErrorSummary(err: unknown): string {
  const code = errorCode(err);
  const message = err instanceof Error ? err.message : String(err);
  return `${code ? `[${code}] ` : ""}${message}`.slice(0, 300);
}

/**
 * Sincroniza uma reserva com o Google Agenda usando SEMPRE o estado atual do banco (o
 * parâmetro é só um ponteiro: quem chamou pode ter um retrato antigo, ex.: o administrador
 * cancelou enquanto a criação do evento ainda estava em andamento). Depois de sincronizar,
 * confere se a situação mudou no meio do caminho e, se mudou, sincroniza de novo — assim uma
 * reserva cancelada nunca fica com evento vivo na agenda.
 */
export async function syncAppointmentToGoogle(appointment: { id: string }): Promise<void> {
  for (let round = 0; round < 3; round++) {
    const fresh = await prisma.appointment.findUnique({ where: { id: appointment.id }, include: { client: true } });
    if (!fresh) return;

    await syncOnce({
      id: fresh.id,
      serviceName: fresh.serviceName,
      startAt: fresh.startAt,
      endAt: fresh.endAt,
      status: fresh.status,
      googleEventId: fresh.googleEventId,
      googleSyncAttempts: fresh.googleSyncAttempts,
      client: { name: fresh.client.name, phone: fresh.client.phone },
    });

    clearFreeBusyCache();
    const after = await prisma.appointment.findUnique({ where: { id: appointment.id }, select: { status: true } });
    if (!after || after.status === fresh.status) return;
  }
}
