/**
 * Ordena as respostas das consultas de horários da tela de escolha (SlotPicker), que podem voltar fora de ordem.
 *
 * Há dois tipos de consulta para a MESMA seleção (serviço + dia):
 *  - normal: iniciada pela cliente (trocar de dia, "Tentar novamente"); mostra o esqueleto de carregamento;
 *  - quiet: atualização em segundo plano (foco da aba, intervalo); nunca mexe no esqueleto nem em erros.
 *
 * Regras:
 *  1. Resposta de OUTRA seleção (a cliente trocou de dia/serviço desde o envio) é descartada.
 *  2. Uma consulta quiet NÃO invalida a consulta normal em andamento: só a normal mais recente controla o
 *     esqueleto de carregamento, que sai quando ELA termina, qualquer que seja a ordem de chegada.
 *  3. Dados mais antigos nunca sobrescrevem dados mais novos já aplicados (a ordem é a de ENVIO).
 *  4. Erro de consulta normal só aparece se nenhum dado mais novo já foi aplicado; erro de quiet nunca aparece.
 */

export interface SlotSettlement {
  /** Aplicar os horários recebidos (e conferir se o horário escolhido ainda existe). */
  applyData: boolean;
  /** Mostrar o erro e limpar a lista. */
  reportError: boolean;
  /** Encerrar o estado de carregamento (esqueleto). */
  clearLoading: boolean;
}

export function createSlotRequestTracker() {
  let seq = 0;
  let currentKey = "";
  let latestNormal = 0;
  let applied = 0;

  return {
    /** Registra o envio de uma consulta. Consultas normais passam a ser a seleção atual. */
    start(key: string, quiet: boolean): number {
      const id = ++seq;
      if (!quiet) {
        currentKey = key;
        latestNormal = id;
      }
      return id;
    },

    /** Decide o que fazer quando a resposta (ou o erro) da consulta `id` chega. */
    settle(id: number, key: string, quiet: boolean, ok: boolean): SlotSettlement {
      const sameSelection = key === currentKey;
      const isLatestNormal = !quiet && id === latestNormal;
      // Normal: só a mais recente vale. Quiet: vale qualquer uma da seleção atual (a ordem é checada abaixo).
      const eligible = sameSelection && (quiet || isLatestNormal);
      const fresher = eligible && id > applied;

      const clearLoading = sameSelection && isLatestNormal;
      if (ok && fresher) {
        applied = id;
        return { applyData: true, reportError: false, clearLoading };
      }
      return { applyData: false, reportError: !ok && !quiet && fresher, clearLoading };
    },
  };
}

export type SlotRequestTracker = ReturnType<typeof createSlotRequestTracker>;
