import { describe, expect, it } from "vitest";
import { createSlotRequestTracker } from "@/lib/slot-request-tracker";

const A = "svc|2026-12-01";
const B = "svc|2026-12-02";

describe("SlotPicker: ordem das respostas (corrida normal x segundo plano)", () => {
  it("achado 2: atualização quiet NÃO invalida o carregamento normal em andamento (esqueleto sai)", () => {
    const t = createSlotRequestTracker();
    const normal = t.start(A, false); // cliente escolheu o dia
    const quiet = t.start(A, true); // foco da aba / intervalo dispara no meio

    // A resposta normal chega primeiro: é aplicada e encerra o carregamento.
    expect(t.settle(normal, A, false, true)).toEqual({ applyData: true, reportError: false, clearLoading: true });
    // A quiet, mais nova, chega depois e também é aplicada, sem mexer no carregamento.
    expect(t.settle(quiet, A, true, true)).toEqual({ applyData: true, reportError: false, clearLoading: false });
  });

  it("a quiet (mais nova) chega ANTES da normal: dados da quiet valem, a normal só encerra o carregamento", () => {
    const t = createSlotRequestTracker();
    const normal = t.start(A, false);
    const quiet = t.start(A, true);

    expect(t.settle(quiet, A, true, true)).toEqual({ applyData: true, reportError: false, clearLoading: false });
    // Os dados antigos da normal não sobrescrevem os mais novos, mas o esqueleto precisa sair.
    expect(t.settle(normal, A, false, true)).toEqual({ applyData: false, reportError: false, clearLoading: true });
  });

  it("trocar de dia: a resposta do dia antigo é descartada e não mexe no carregamento do novo", () => {
    const t = createSlotRequestTracker();
    const first = t.start(A, false);
    const second = t.start(B, false); // cliente trocou de dia antes de a primeira voltar

    expect(t.settle(first, A, false, true)).toEqual({ applyData: false, reportError: false, clearLoading: false });
    expect(t.settle(second, B, false, true)).toEqual({ applyData: true, reportError: false, clearLoading: true });
  });

  it("erro do dia antigo (fora de ordem) não aparece na tela do dia novo", () => {
    const t = createSlotRequestTracker();
    const first = t.start(A, false);
    const second = t.start(B, false);
    expect(t.settle(second, B, false, true).applyData).toBe(true);
    expect(t.settle(first, A, false, false)).toEqual({ applyData: false, reportError: false, clearLoading: false });
  });

  it("atualização quiet do dia antigo, chegando depois da troca, é descartada", () => {
    const t = createSlotRequestTracker();
    t.start(A, false);
    const quietA = t.start(A, true);
    const normalB = t.start(B, false);
    expect(t.settle(quietA, A, true, true)).toEqual({ applyData: false, reportError: false, clearLoading: false });
    expect(t.settle(normalB, B, false, true).applyData).toBe(true);
  });

  it("A -> B -> A: só a última consulta normal manda, mesmo com a chave repetida", () => {
    const t = createSlotRequestTracker();
    const a1 = t.start(A, false);
    t.start(B, false);
    const a2 = t.start(A, false);
    expect(t.settle(a1, A, false, true)).toEqual({ applyData: false, reportError: false, clearLoading: false });
    expect(t.settle(a2, A, false, true)).toEqual({ applyData: true, reportError: false, clearLoading: true });
  });

  it("duas quiet fora de ordem: a mais antiga, chegando depois da mais nova, é descartada", () => {
    const t = createSlotRequestTracker();
    t.start(A, false);
    const q1 = t.start(A, true);
    const q2 = t.start(A, true);
    expect(t.settle(q2, A, true, true).applyData).toBe(true);
    expect(t.settle(q1, A, true, true).applyData).toBe(false);
  });

  it("erro da consulta normal sem dados mais novos: aparece e encerra o carregamento", () => {
    const t = createSlotRequestTracker();
    const normal = t.start(A, false);
    expect(t.settle(normal, A, false, false)).toEqual({ applyData: false, reportError: true, clearLoading: true });
  });

  it("erro da normal quando uma quiet mais nova já trouxe dados: não derruba a lista, mas o esqueleto sai", () => {
    const t = createSlotRequestTracker();
    const normal = t.start(A, false);
    const quiet = t.start(A, true);
    expect(t.settle(quiet, A, true, true).applyData).toBe(true);
    expect(t.settle(normal, A, false, false)).toEqual({ applyData: false, reportError: false, clearLoading: true });
  });

  it("erro de atualização quiet nunca aparece nem encerra o carregamento", () => {
    const t = createSlotRequestTracker();
    const normal = t.start(A, false);
    const quiet = t.start(A, true);
    expect(t.settle(quiet, A, true, false)).toEqual({ applyData: false, reportError: false, clearLoading: false });
    // A normal ainda pode terminar bem depois disso.
    expect(t.settle(normal, A, false, true)).toEqual({ applyData: true, reportError: false, clearLoading: true });
  });

  it("nova consulta normal (ex.: Tentar novamente) depois de um erro volta a funcionar", () => {
    const t = createSlotRequestTracker();
    const first = t.start(A, false);
    expect(t.settle(first, A, false, false).reportError).toBe(true);
    const retry = t.start(A, false);
    expect(t.settle(retry, A, false, true)).toEqual({ applyData: true, reportError: false, clearLoading: true });
  });
});
