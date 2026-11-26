"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { checkSlotStillAvailableAction, findNextAvailableDayAction, getAvailableSlotsAction } from "@/app/agendar/actions";
import { getRescheduleSlotsAction, rescheduleBookingAction } from "@/app/meus-agendamentos/[id]/reagendar/actions";
import { TIMEZONE } from "@/lib/constants";
import { createSlotRequestTracker } from "@/lib/slot-request-tracker";
import { revisarUrl, veiculoUrl } from "@/lib/booking-urls";
import { getMonthGrid, shiftMonthKey } from "@/lib/calendar-grid";
import { ChevronRightIcon } from "@/components/icons";

import type { CalendarRange } from "@/lib/calendar-range";

type Loaded = { slots: string[]; closed: boolean };

const time = (iso: string) => formatInTimeZone(new Date(iso), TIMEZONE, "HH:mm");
const WEEKDAYS = ["D", "S", "T", "Q", "Q", "S", "S"];
const WEEKDAY_NAMES = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

const monthLabel = (monthKey: string) => {
  const [y, m] = monthKey.split("-").map(Number);
  const label = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
  return label.charAt(0).toUpperCase() + label.slice(1);
};
const weekdayOf = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};
const longDay = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", year: "numeric", weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
};

/** Atualização silenciosa da lista enquanto a tela está aberta (outra cliente pode reservar a qualquer momento). */
const BACKGROUND_REFRESH_MS = 45_000;

/**
 * Escolha de data e horário (agendamento novo e reagendamento). Calendário mensal acessível: cada dia é um botão com
 * rótulo por extenso; dias passados, além do horizonte ou sem expediente ficam desativados. Toda a lógica de
 * concorrência é a de antes: respostas fora de ordem descartadas, atualização silenciosa, conferência no servidor
 * antes de seguir e busca do próximo dia com vaga. A decisão final é sempre do servidor, sob o BookingLock.
 */
export function SlotPicker({
  serviceId,
  vehicleId,
  calendar,
  mode = "book",
  appointmentId,
  startAtIso,
  initialDay,
  initialTime,
}: {
  /** Dia e horário preferidos (vindos do agendamento rápido): ponto de partida, nunca uma garantia de vaga. */
  initialDay?: string;
  initialTime?: string;
  serviceId: string;
  /** Só no agendamento novo: o veículo já escolhido na etapa anterior (revalidado no servidor na revisão e na reserva). */
  vehicleId?: string;
  calendar: CalendarRange;
  mode?: "book" | "reschedule";
  /** Só no reagendamento: a reserva que está sendo movida (a posse é revalidada no servidor). */
  appointmentId?: string;
  /** Só no reagendamento: horário atual, para o aviso "este já é o seu horário". */
  startAtIso?: string;
}) {
  const router = useRouter();
  const startDay = initialDay ?? calendar.todayKey;
  const [selectedDay, setSelectedDay] = useState(startDay);
  const [monthKey, setMonthKey] = useState(startDay.slice(0, 7));
  // O horário preferido só é aplicado uma vez, na primeira lista carregada do dia inicial.
  const pendingTime = useRef<string | undefined>(initialTime);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [searching, setSearching] = useState(false);
  const [navigating, startTransition] = useTransition();

  // Ordena as respostas: descarta as de outro dia/serviço e impede que uma antiga sobrescreva a mais nova.
  // Uma atualização em segundo plano (quiet) não invalida o carregamento normal em andamento
  // (regras em src/lib/slot-request-tracker.ts).
  const tracker = useRef(createSlotRequestTracker());
  const selectedSlotRef = useRef<string | null>(null);
  selectedSlotRef.current = selectedSlot;

  const isEnabled = useCallback(
    (key: string) => key >= calendar.todayKey && key <= calendar.maxKey && calendar.openWeekdays.includes(weekdayOf(key)),
    [calendar]
  );

  // Começa no primeiro dia que o calendário permite (hoje pode não ter expediente).
  useEffect(() => {
    if (isEnabled(selectedDay)) return;
    for (let i = 0; i <= 90; i++) {
      const [y, m, d] = calendar.todayKey.split("-").map(Number);
      const key = new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10);
      if (isEnabled(key)) {
        setSelectedDay(key);
        setMonthKey(key.slice(0, 7));
        return;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só no primeiro carregamento
  }, []);

  /** Carrega a lista do dia. `quiet` = atualização em segundo plano (sem esqueleto de carregamento). */
  const load = useCallback(
    async (day: string, opts: { quiet?: boolean } = {}) => {
      if (!day || !isEnabled(day)) {
        setData(null);
        return;
      }
      const quiet = !!opts.quiet;
      const key = `${mode}|${serviceId}|${appointmentId ?? ""}|${day}`;
      const id = tracker.current.start(key, quiet);
      if (!quiet) {
        setLoading(true);
        setError(null);
      }
      let result: Awaited<ReturnType<typeof getAvailableSlotsAction>> | null = null;
      try {
        result = mode === "reschedule" && appointmentId ? await getRescheduleSlotsAction(appointmentId, day) : await getAvailableSlotsAction(serviceId, day);
      } catch {
        result = null; // falha de rede
      }
      const ok = result !== null && !("error" in result);
      const outcome = tracker.current.settle(id, key, quiet, ok);

      if (outcome.applyData && result && !("error" in result)) {
        setError(null);
        setData(result);
        // Horário preferido do agendamento rápido: seleciona se existe vaga exatamente nele (uma vez só).
        if (pendingTime.current) {
          const wanted = result.slots.find((iso) => time(iso) === pendingTime.current);
          pendingTime.current = undefined;
          if (wanted) {
            setSelectedSlot(wanted);
            return void (outcome.clearLoading && setLoading(false));
          }
        }
        // O horário escolhido sumiu da lista (outra cliente reservou, ou o prazo mínimo passou): retira a seleção e avisa.
        const chosen = selectedSlotRef.current;
        if (chosen && !result.slots.includes(chosen)) {
          setSelectedSlot(null);
          setNotice(`O horário das ${time(chosen)} acabou de ser ocupado. Escolha outro horário disponível.`);
        }
      } else if (outcome.reportError) {
        setError(
          result && "error" in result
            ? result.error
            : "Não foi possível carregar os horários. Verifique sua conexão e tente novamente."
        );
        setData(null);
      }
      if (outcome.clearLoading) setLoading(false);
    },
    [serviceId, mode, appointmentId, isEnabled]
  );

  // Trocar o dia (ou o serviço) recarrega a lista e limpa a seleção.
  useEffect(() => {
    setSelectedSlot(null);
    setNotice(null);
    void load(selectedDay);
  }, [selectedDay, load]);

  // Revalida ao voltar para a aba e periodicamente enquanto ela está visível.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void load(selectedDay, { quiet: true });
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, BACKGROUND_REFRESH_MS);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
      window.clearInterval(timer);
    };
  }, [selectedDay, load]);

  const goOn = useCallback(async () => {
    if (!selectedSlot) return;
    setChecking(true);
    setNotice(null);
    try {
      if (mode === "reschedule" && appointmentId) {
        // O servidor revalida TUDO (posse, política, disponibilidade) sob o BookingLock e redireciona se der certo.
        const result = await rescheduleBookingAction(appointmentId, selectedSlot);
        if (result && "error" in result) {
          setNotice(result.error);
          if (result.refresh) {
            setSelectedSlot(null);
            await load(selectedDay);
          }
        }
        return;
      }
      // Conferência no servidor, com a agenda externa consultada na hora (sem cache), antes de seguir.
      const result = await checkSlotStillAvailableAction(serviceId, selectedSlot);
      if ("error" in result) {
        setNotice(result.error);
        return;
      }
      if (!result.available) {
        setNotice(`O horário das ${time(selectedSlot)} acabou de ser ocupado. Escolha outro horário disponível.`);
        setSelectedSlot(null);
        await load(selectedDay);
        return;
      }
      startTransition(() => {
        // Sem veículo escolhido (não deveria acontecer) volta para a etapa do veículo, que é quem decide o preço.
        router.push(vehicleId ? revisarUrl(serviceId, selectedSlot, vehicleId) : veiculoUrl(serviceId));
      });
    } catch {
      setNotice("Não foi possível conferir o horário. Verifique sua conexão e tente novamente.");
    } finally {
      setChecking(false);
    }
  }, [appointmentId, load, mode, router, selectedDay, selectedSlot, serviceId, vehicleId]);

  const goToNextAvailableDay = useCallback(async () => {
    setSearching(true);
    setNotice(null);
    try {
      const result = await findNextAvailableDayAction(serviceId, selectedDay);
      if ("error" in result) {
        setNotice(result.error);
      } else if (result.dateKey) {
        const found = result.dateKey;
        if (isEnabled(found)) {
          setSelectedDay(found);
          setMonthKey(found.slice(0, 7));
        } else setNotice("O próximo dia com vaga fica fora do período de agendamento. Escolha outra data no calendário.");
      } else {
        setNotice("Não encontramos horários livres nas próximas semanas. Tente novamente mais tarde.");
      }
    } catch {
      setNotice("Não foi possível procurar agora. Tente novamente.");
    } finally {
      setSearching(false);
    }
  }, [isEnabled, selectedDay, serviceId]);

  const grid = useMemo(() => getMonthGrid(monthKey), [monthKey]);
  const canPrev = monthKey > calendar.todayKey.slice(0, 7);
  const canNext = monthKey < calendar.maxKey.slice(0, 7);
  const hasSlots = !!data && data.slots.length > 0;
  const busy = loading || checking || navigating;
  const sameAsCurrent = mode === "reschedule" && !!startAtIso && selectedSlot === startAtIso;

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <section aria-labelledby="calendario-titulo" className="rounded-2xl border border-brand/45 bg-surface p-4">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setMonthKey((m) => shiftMonthKey(m, -1))}
            disabled={!canPrev}
            aria-label="Mês anterior"
            className="btn-ghost h-11 w-11 min-h-[44px] px-0 disabled:opacity-30"
          >
            <ChevronRightIcon className="h-5 w-5 rotate-180" />
          </button>
          <h2 id="calendario-titulo" className="font-display text-xl font-bold normal-case not-italic tracking-wide text-fg" aria-live="polite">
            {monthLabel(monthKey)}
          </h2>
          <button
            type="button"
            onClick={() => setMonthKey((m) => shiftMonthKey(m, 1))}
            disabled={!canNext}
            aria-label="Próximo mês"
            className="btn-ghost h-11 w-11 min-h-[44px] px-0 disabled:opacity-30"
          >
            <ChevronRightIcon className="h-5 w-5" />
          </button>
        </div>

        <div role="grid" aria-labelledby="calendario-titulo" className="mt-3">
          <div role="row" className="grid grid-cols-7 text-center text-xs font-semibold text-fg-muted">
            {WEEKDAYS.map((w, i) => (
              <span key={i} role="columnheader" aria-label={WEEKDAY_NAMES[i]} className="py-1">
                {w}
              </span>
            ))}
          </div>
          {grid.map((week, wi) => (
            <div key={wi} role="row" className="grid grid-cols-7">
              {week.map((cell) => {
                if (!cell.inMonth) return <span key={cell.dateKey} role="gridcell" aria-hidden="true" />;
                const enabled = isEnabled(cell.dateKey);
                const active = selectedDay === cell.dateKey;
                const isToday = cell.dateKey === calendar.todayKey;
                return (
                  <span key={cell.dateKey} role="gridcell" className="flex justify-center p-0.5">
                    <button
                      type="button"
                      data-date={cell.dateKey}
                      disabled={!enabled}
                      aria-pressed={active}
                      aria-current={isToday ? "date" : undefined}
                      aria-label={`${longDay(cell.dateKey)}${enabled ? "" : ", indisponível"}${active ? ", selecionado" : ""}`}
                      onClick={() => setSelectedDay(cell.dateKey)}
                      className={`h-11 w-11 rounded-lg text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-ink ${
                        active
                          ? "bg-brand text-ink"
                          : enabled
                            ? `text-fg hover:bg-surface-2 ${isToday ? "ring-1 ring-brand/60" : ""}`
                            : "cursor-not-allowed text-fg-muted/40 line-through decoration-fg-muted/30"
                      }`}
                    >
                      {Number(cell.dateKey.slice(8))}
                    </button>
                  </span>
                );
              })}
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-fg-muted">Dias riscados estão sem atendimento ou fora do período de agendamento.</p>
      </section>

      <div className="min-w-0 space-y-4">
        <section aria-labelledby="horarios-titulo" aria-busy={loading}>
          <h2 id="horarios-titulo" className="font-display text-xl font-bold normal-case not-italic tracking-wide text-fg">
            Horários disponíveis
          </h2>
          <p className="text-sm text-fg-muted">{longDay(selectedDay)}</p>

          {notice && (
            <div className="notice-warning mt-3" role="alert">
              {notice}
            </div>
          )}

          <div className="mt-3" role="status" aria-live="polite">
            {loading && (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" aria-hidden="true">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="skeleton h-11" />
                ))}
              </div>
            )}
            {loading && <p className="sr-only">Carregando horários...</p>}

            {!loading && error && (
              <div className="notice-error" role="alert">
                <div className="flex flex-wrap items-center gap-3">
                  <span>{error}</span>
                  <button type="button" onClick={() => void load(selectedDay)} className="font-semibold underline underline-offset-4">
                    Tentar novamente
                  </button>
                </div>
              </div>
            )}

            {!loading && !error && data && !hasSlots && (
              <div className="rounded-2xl border border-dashed border-brand/60 bg-surface/60 px-5 py-8 text-center">
                <p className="font-display text-xl font-bold uppercase tracking-wide text-fg">Sem horários disponíveis neste dia</p>
                <p className="mx-auto mt-1 max-w-sm text-sm text-fg-muted">
                  {data.closed ? "A Garage Zero Zero não atende neste dia." : "Todos os horários deste dia já foram reservados ou não comportam a duração do serviço."}{" "}
                  Escolha outra data no calendário ou veja o próximo dia com vaga.
                </p>
                <button type="button" onClick={() => void goToNextAvailableDay()} disabled={searching} className="btn-secondary mt-4">
                  {searching ? "Procurando..." : "Ver próximo dia com horários"}
                </button>
              </div>
            )}
          </div>

          {!loading && !error && hasSlots && (
            <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
              {data.slots.map((iso) => {
                const selected = selectedSlot === iso;
                return (
                  <button
                    key={iso}
                    type="button"
                    aria-pressed={selected}
                    aria-label={`${time(iso)}${selected ? ", selecionado" : ""}`}
                    onClick={() => {
                      setSelectedSlot(iso);
                      setNotice(null);
                    }}
                    className={`min-h-[44px] rounded-lg border px-2 text-sm font-bold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-ink ${
                      selected ? "border-brand bg-brand text-ink" : "border-brand/60 bg-transparent text-fg hover:bg-brand/10"
                    }`}
                  >
                    {selected && <span aria-hidden="true">✓ </span>}
                    {time(iso)}
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <div className="sticky bottom-0 -mx-4 border-t border-line bg-ink/95 px-4 py-3 backdrop-blur lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:p-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-fg-muted" aria-live="polite">
              {selectedSlot ? (
                sameAsCurrent ? (
                  "Esse já é o horário do seu agendamento. Escolha outro."
                ) : (
                  <>
                    Horário escolhido: <strong className="text-fg">{time(selectedSlot)}</strong>
                  </>
                )
              ) : (
                "Escolha um horário para continuar."
              )}
            </p>
            <button type="button" onClick={() => void goOn()} disabled={!selectedSlot || busy || sameAsCurrent} className="btn-primary w-full sm:w-auto">
              {checking ? "Conferindo..." : navigating ? "Carregando..." : mode === "reschedule" ? "Confirmar novo horário" : "Continuar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
