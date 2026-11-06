"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { checkSlotStillAvailableAction, findNextAvailableDayAction, getAvailableSlotsAction } from "@/app/agendar/actions";
import { TIMEZONE } from "@/lib/constants";

interface Day {
  key: string;
  label: string;
}

type Loaded = { slots: string[]; closed: boolean };

const time = (iso: string) => formatInTimeZone(new Date(iso), TIMEZONE, "HH:mm");

/** Atualização silenciosa da lista enquanto a tela está aberta (outra cliente pode reservar a qualquer momento). */
const BACKGROUND_REFRESH_MS = 45_000;

export function SlotPicker({ serviceId, days }: { serviceId: string; days: Day[] }) {
  const router = useRouter();
  const [selectedDay, setSelectedDay] = useState(days[0]?.key ?? "");
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [searching, setSearching] = useState(false);
  const [navigating, startTransition] = useTransition();

  // Evita que uma resposta antiga (de outro dia ou de uma consulta anterior) sobrescreva a mais recente.
  const requestId = useRef(0);
  const selectedSlotRef = useRef<string | null>(null);
  selectedSlotRef.current = selectedSlot;

  /** Carrega a lista do dia. `quiet` = atualização em segundo plano (sem esqueleto de carregamento). */
  const load = useCallback(
    async (day: string, opts: { quiet?: boolean } = {}) => {
      if (!day) return;
      const id = ++requestId.current;
      if (!opts.quiet) {
        setLoading(true);
        setError(null);
      }
      try {
        const result = await getAvailableSlotsAction(serviceId, day);
        if (id !== requestId.current) return;
        if ("error" in result) {
          if (!opts.quiet) {
            setError(result.error);
            setData(null);
          }
          return;
        }
        setError(null);
        setData(result);
        // O horário escolhido sumiu da lista (outra cliente reservou, ou o prazo mínimo passou): retira a seleção e avisa.
        const chosen = selectedSlotRef.current;
        if (chosen && !result.slots.includes(chosen)) {
          setSelectedSlot(null);
          setNotice(`O horário das ${time(chosen)} acabou de ser ocupado. Escolha outro horário disponível.`);
        }
      } catch {
        if (id !== requestId.current || opts.quiet) return;
        setError("Não foi possível carregar os horários. Verifique sua conexão e tente novamente.");
        setData(null);
      } finally {
        if (id === requestId.current && !opts.quiet) setLoading(false);
      }
    },
    [serviceId]
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

  const goToReview = useCallback(async () => {
    if (!selectedSlot) return;
    setChecking(true);
    setNotice(null);
    try {
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
        router.push(`/agendar/revisar?serviceId=${serviceId}&startAt=${encodeURIComponent(selectedSlot)}`);
      });
    } catch {
      setNotice("Não foi possível conferir o horário. Verifique sua conexão e tente novamente.");
    } finally {
      setChecking(false);
    }
  }, [load, router, selectedDay, selectedSlot, serviceId]);

  const goToNextAvailableDay = useCallback(async () => {
    setSearching(true);
    setNotice(null);
    try {
      const result = await findNextAvailableDayAction(serviceId, selectedDay);
      if ("error" in result) {
        setNotice(result.error);
      } else if (result.dateKey) {
        const found = result.dateKey;
        if (days.some((d) => d.key === found)) setSelectedDay(found);
        else setNotice("Os próximos dias com vaga ficam além da lista de datas desta tela. Escolha outra data acima.");
      } else {
        setNotice("Não encontramos horários livres nas próximas semanas. Tente novamente mais tarde.");
      }
    } catch {
      setNotice("Não foi possível procurar agora. Tente novamente.");
    } finally {
      setSearching(false);
    }
  }, [days, selectedDay, serviceId]);

  const dayLabel = useMemo(() => days.find((d) => d.key === selectedDay)?.label ?? "", [days, selectedDay]);
  const hasSlots = !!data && data.slots.length > 0;
  const busy = loading || checking || navigating;

  return (
    <div className="mt-6 space-y-6">
      <fieldset className="min-w-0">
        <legend className="mb-2 text-sm font-semibold text-plum">Dia</legend>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
          {days.map((day) => {
            const active = selectedDay === day.key;
            return (
              <button
                key={day.key}
                type="button"
                aria-pressed={active}
                onClick={() => setSelectedDay(day.key)}
                className={`min-h-[44px] flex-none whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-wine focus-visible:ring-offset-2 focus-visible:ring-offset-cream ${
                  active ? "bg-wine text-white shadow-soft" : "border border-plum-line bg-white text-plum hover:border-wine hover:bg-blush"
                }`}
              >
                {day.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      <section aria-labelledby="horarios-titulo" aria-busy={loading}>
        <h2 id="horarios-titulo" className="text-sm font-semibold text-plum">
          Horários disponíveis — {dayLabel}
        </h2>

        {notice && (
          <div className="notice-warning mt-3" role="alert">
            {notice}
          </div>
        )}

        <div className="mt-3" role="status" aria-live="polite">
          {loading && (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" aria-hidden="true">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-11 animate-pulse rounded-xl bg-blush" />
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
            <div className="rounded-2xl border border-dashed border-gold/60 bg-white/60 px-5 py-8 text-center">
              <p className="font-display text-lg font-semibold text-plum">Sem horários disponíveis neste dia</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-plum-muted">
                {data.closed ? "O estúdio não atende neste dia." : "Todos os horários deste dia já foram reservados ou não comportam a duração do serviço."}{" "}
                Escolha outra data acima ou veja o próximo dia com vaga.
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
                  className={`min-h-[44px] rounded-xl px-2 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-wine focus-visible:ring-offset-2 focus-visible:ring-offset-cream ${
                    selected ? "bg-wine text-white shadow-soft" : "border border-wine/50 bg-white text-wine hover:bg-blush"
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

      <div className="sticky bottom-0 -mx-4 border-t border-blush-deep/60 bg-cream/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-plum-muted" aria-live="polite">
            {selectedSlot ? (
              <>
                Horário escolhido: <strong className="text-plum">{time(selectedSlot)}</strong>
              </>
            ) : (
              "Escolha um horário para continuar."
            )}
          </p>
          <button type="button" onClick={() => void goToReview()} disabled={!selectedSlot || busy} className="btn-primary w-full sm:w-auto">
            {checking ? "Conferindo..." : navigating ? "Carregando..." : "Continuar"}
          </button>
        </div>
      </div>
    </div>
  );
}
