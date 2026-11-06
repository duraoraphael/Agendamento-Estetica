# Desempenho — antes e depois

Medições feitas com `scripts/perf/measure.mjs` (Edge real via Playwright), no mesmo computador e no mesmo banco
descartável (`prisma/perf.db`: ~2.400 agendamentos, 41 clientes), porta 3200, sem Google conectado.
Valores em milissegundos. "Primeira visita" = `goto` até o `<h1>` da página visível; "aquecida" = clique no menu até o
`<h1>` da página de destino (mediana de 5 rodadas depois de uma de aquecimento). Cache de compilação limpo antes de
cada rodada de dev.

**Limite da comparação.** O repositório não tem commit anterior às melhorias, então o "antes" são os arquivos
`antes-*.json` gravados antes delas (mesmo script, mesmo banco e mesma máquina); os "depois" foram regravados nesta
revisão. Uma segunda rodada independente de cada "depois" está ao lado. `depois-prod.json` é uma medição anterior
feita com a máquina ocupada (aquecida 329 ms) e **não foi reproduzida**; não deve ser usada.

## Desenvolvimento (`next dev`) — o cenário dos seus prints

| Rota | Antes (webpack) | Depois, webpack | Depois, **Turbopack** (2 rodadas) |
|---|---|---|---|
| `/admin` — 1ª visita | 10.147 | 7.936 | **3.036 · 2.896** |
| `/admin/faturamento` — 1ª visita | 4.082 | 3.133 | **1.070 · 966** |
| `/admin/agendamentos` — 1ª visita | 3.412 | 3.175 | **947 · 910** |
| cliente `/agendar` — 1ª visita | 3.515 | 2.133 | **981 · 854** |
| cliente → página de horários (1ª) | 9.916 | 8.927 | **876 · 878** |
| Hoje → Faturamento (aquecida) | 108 | 109 | 226 · 217 |
| → Agendamentos (aquecida) | 206 | 218 | 218 · 218 |
| → Hoje (aquecida) | 203 | 219 | 208 · 212 |
| cliente: trocar de dia (lista) | 63 | 65 | 131 · 128 |

- A lentidão dos seus prints é **compilação sob demanda do `next dev`** (webpack): `/admin` compila ~3.900 módulos,
  `/admin/faturamento` ~5.150. Só trocar para `next dev --turbopack` (agora o padrão de `npm run dev`; o antigo ficou em
  `npm run dev:webpack`) reduz a primeira visita de 2,6× a 11×. A diferença entre "antes" e "depois, webpack" (≈20–40 %)
  está na faixa de variação da máquina e **não é atribuída a nenhuma mudança de código**.
- Em dev com Turbopack a navegação aquecida e a troca de dia ficaram **mais lentas** (≈ +110 ms e ≈ +65 ms): é o custo
  do modo dev dele, sem relação com produção.

## Produção (`next build` + `next start`)

| Rota | Antes | Depois (2 rodadas) |
|---|---|---|
| `/admin` — 1ª visita | 89 | 167 · 89 |
| `/admin/faturamento` — 1ª visita | 119 | 75 · 70 |
| `/admin/agendamentos` — 1ª visita | 66 | 71 · 70 |
| Hoje → Faturamento (aquecida) | 40 | 49 · 46 |
| → Agendamentos (aquecida) | 40 | 40 · 40 |
| → Hoje (aquecida) | 42 | 44 · 48 |
| cliente `/agendar` — 1ª visita | 63 | 71 · 61 |
| cliente → página de horários | 70 | 88 · 67 |
| cliente: trocar de dia (lista) | 33 | 31 · 46 |

**Em produção a navegação já era rápida (~40 ms) e continua igual: não há melhora de tempo a declarar.**

## O que mudou de forma comprovada

| Medida | Antes | Depois | Fonte |
|---|---|---|---|
| Chamadas a `/api/auth/session` na 1ª visita | 1 | 0 | `sessionCalls` nos JSON |
| JS carregado até hidratar `/admin/faturamento` (First Load, build) | 221 kB | 107 kB | `build-antes.txt` × `build-depois.txt` |
| Rota `/admin/faturamento` (código próprio) | 107 kB | 1,4 kB | idem — o gráfico (Recharts) vira um pedaço à parte, carregado depois dos totais |
| JS total da página de faturamento depois de o gráfico carregar | 385 kB | 412 kB | `jsKB`: **não diminuiu** (o gráfico ainda é baixado, só depois) |

## Causas investigadas

- **Confirmada:** compilação sob demanda do `next dev` com webpack (tabelas acima).
- **Descartadas por medição:** banco (consultas aquecidas ≈ 10–16 ms de TTFB em produção, faturamento já agrega com
  `groupBy`; nenhum índice novo foi justificado), Google (`googleapis` já é carregado só quando há chamada real; o painel
  não o importa), sessão (0 chamadas repetidas), redirecionamentos e requisições em sequência (consultas do painel já
  rodam em paralelo).
- **`loading.tsx` não foi adicionado de propósito:** o retorno imediato ao clique é o indicador `LinkPending` dentro de
  cada link do menu (o `loading.tsx` troca o conteúdo com atraso do React em respostas rápidas; veja o comentário em
  `src/components/LinkPending.tsx`). Não medi esse atraso novamente nesta revisão.
