# 🔐 Relatório de Auditoria de Segurança

**Data:** 2026-11-17
**Pontuação:** 97/100 🟢 (antes das correções desta rodada: 96/100)
**Projeto:** agendamento-manicure (Studio de Manicure)
**Stacks detectadas:** Node.js 24 · Next.js 15.5.29 (App Router) · Prisma 5.22 · **PostgreSQL no Supabase (São Paulo)** · NextAuth 4.24.15 (credenciais, JWT) · Google Calendar API · Vitest/Playwright
**Auditado por:** security-skill v1.0.0 (método de pontuação) + leitura do código e execução de testes nesta sessão

> **Resultado em uma frase:** nenhum problema Crítico ou Alto. Foram corrigidos 1 Médio e 3 Baixos reais, criada a trilha de auditoria (página **Logs**) e restam 5 Médios de **política e operação** (e-mail de confirmação, CSP com nonce, LGPD, bloqueio de conta), que precisam de decisão sua.

---

## 📊 Quadro de pontuação

```
╔══════════════════════════════════════════════════╗
║        SECURITY SCORE : 97/100  🟢                ║
╠══════════════════════════════════════════════════╣
║  🟢 01 Secrets & Files             98/100         ║
║  🟢 02 Network & CORS              98/100         ║
║  🟢 03 HTTP Headers                95/100         ║
║  🟡 04 Auth & Sessions             86/100         ║
║  🟢 05 Cryptography                98/100         ║
║  🟢 06 JWT (deep)                 100/100         ║
║  🟢 07 Database Security           98/100         ║
║  🟢 08 Deployment & Cloud          98/100         ║
║  ⚪ 09 Docker & Containers          N/A           ║
║  ⚪ 10 Protocols                    N/A           ║
║  🟢 11 Advanced Attacks           100/100         ║
║  🟢 12 Injections                 100/100         ║
║  🟢 13 Race Conditions             98/100         ║
║  🟢 14 File Upload                 98/100         ║
║  ⚪ 15 DNS & Email                  N/A           ║
║  🟢 16 Supply Chain                98/100         ║
║  ⚪ 17 Mobile                       N/A           ║
║  🟡 18 Compliance & LGPD           88/100         ║
║  🟢 19 Monitoring & Detection      96/100         ║
║  ⚪ 20 Serverless & Edge            N/A           ║
║  🟢 21 Source Code Analysis       100/100         ║
║  ⚪ 22 AI/LLM Security              N/A           ║
║  🟢 23 Bot & DDoS                  98/100         ║
║  🟢 24 Browser APIs               100/100         ║
║  🟢 25 Advanced Security (L3)      98/100         ║
╚══════════════════════════════════════════════════╝
  📈 Auditoria anterior: 96/100 (2026-11-05) · antes das correções desta rodada: 96/100
  🔴 0 críticos | 🟠 0 altos | 🟡 5 médios | 🔵 12 baixos
```

**Como foi calculado.** Cada categoria parte de 100 e perde 20/10/5/2 pontos por problema Crítico/Alto/Médio/Baixo. A nota final é a média ponderada das 19 categorias aplicáveis; os pesos da skill somam 111%, então normalizei pela soma dos pesos aplicáveis (95): 9.207 ÷ 95 = **96,9**. Antes das correções desta rodada o mesmo cálculo dava 96,4. *Upload de arquivos* passou a ser aplicável (a logo, que não existia na auditoria anterior). *Julgamento meu, para você conferir:* as 12 vulnerabilidades de `npm audit` (2 "críticas" no `tinypool`) estão só em ferramentas de teste/lint (vitest 2, typescript-eslint) e não entram no site publicado; pontuei como Baixo, não como Crítico.

---

## ✅ Corrigido nesta rodada

| # | Severidade | Problema | Arquivos | Como foi verificado |
|---|---|---|---|---|
| S1 | 🟡 Média (CWE-770) | **Reservar e cancelar não tinham limite de pedidos.** Uma cliente logada podia repetir "reservar/cancelar" em laço: enchia a tabela de reservas, a fila do Google Agenda (cota) e, agora, a trilha de auditoria. | `src/app/agendar/actions.ts`, `src/app/meus-agendamentos/actions.ts`, `src/lib/constants.ts` | Teste: 10 pedidos/min passam, o 11º é barrado e o bloqueio fica registrado (1 linha agrupada) |
| S2 | 🔵 Baixa (CWE-352) | **O cadastro aceitava qualquer `Content-Type`.** Um formulário de *outro site* (`text/plain`, sem pedir permissão ao navegador) podia disparar cadastros pelo navegador de uma visitante e gastar o limite do e-mail. | `src/app/api/auth/cadastro/route.ts` | Teste: `text/plain` → 415, nenhuma conta, nenhum log; o formulário do site (JSON) segue funcionando |
| S3 | 🔵 Baixa (CWE-1333) | **Custo quadrático (ReDoS) no limpador de texto do log**, achado no meu próprio código novo: um texto de 100 mil caracteres sem espaços levou ~8 s. Corrigido antes de publicar (corta o texto antes das expressões regulares). | `src/lib/audit-log.ts` | Teste de regressão: entrada gigante termina em < 2 s |
| S4 | 🔵 Baixa | **O registro podia derrubar uma mudança de situação.** Meu texto "Confirmada → Cancelada" usava uma seta que um banco não-UTF-8 recusa; como o log divide a transação com a mudança, ela falhava. Troquei por "De X para Y" (só letras comuns). | `src/lib/booking.ts` | Teste de regressão (apareceu no banco de teste, que usa WIN1252) |
| L9/M8 | resolvidos | **Sem trilha de auditoria persistente** (apontado na auditoria anterior): agora existe, com página administrativa. Veja a seção abaixo. | vários | 29 testes novos + 4 de tela |

---

## 🧾 Página "Logs" (`/admin/logs`)

**Acesso (verificado):** visitante → vai ao login; cliente → vai a `/meus-agendamentos` (testes de tela); a consulta `listAuditLogs` chama `requireAdmin()` **ela mesma** (sessão + papel conferido no banco), então qualquer chamador futuro continua protegido. Não existe rota de API nem Server Action para logs, e **nenhuma função altera ou apaga registros**.

| Aba | Eventos gravados | Resultado | Gravação |
|---|---|---|---|
| **Cadastro** | conta criada · cadastro com e-mail já existente · cadastro bloqueado por excesso de tentativas | Sucesso / Falha / Bloqueado | conta + log na **mesma transação**; falhas agrupadas |
| **Login** | login realizado · tentativa recusada · login bloqueado | Sucesso / Falha / Bloqueado | evento `signIn` do NextAuth (depois da sessão emitida); falhas agrupadas por e-mail e hora |
| **Logout** | saída da conta | Sucesso | evento `signOut` do NextAuth |
| **Marcação** | agendamento criado · cancelado pela cliente · situação alterada (administradora) · pedido bloqueado por excesso | Sucesso / Bloqueado | **dentro da transação da agenda** (`runLocked`): só existe se a reserva foi confirmada; chave de idempotência por reserva |
| **Ações administrativas** | serviço criado/alterado/(des)ativado · expediente salvo · bloqueio de horário criado/removido · configurações do site alteradas | Sucesso | na transação da mudança (configurações: logo após o salvamento) |
| **Integrações** | Google conectado / falha ao conectar / desconectado · reenvio ao Google (um e em lote) · chamada não autorizada ao agendador (cron) | Sucesso / Falha / Bloqueado | evento isolado; chamada não autorizada agrupada por hora |

Cada linha mostra data e hora (America/Sao_Paulo), ação, resultado, responsável e registro afetado. Ordem do mais recente para o mais antigo, **25 por página (teto 50)**, filtros de período (padrão 30 dias, máximo 92), resultado e usuário (nome, ou e-mail completo).

**Sem fluxo correspondente no site (não criei aba nem registro, como pedido):**
- **Entrada / Saída (check-in / check-out):** o site não registra chegada nem saída do atendimento. A situação da reserva (confirmada/concluída/cancelada/falta) é mudada pela administradora e aparece em **Marcação**.
- **Remarcação:** não existe ação de remarcar (só criar e cancelar).

**O que nunca é gravado:** senha, token, cookie, chave, segredo OAuth, corpo de requisição, e-mail, nome e celular. Pessoas entram como ID interno (o nome é buscado só ao exibir) ou, em tentativa sem conta, como hash curto do e-mail. O motivo digitado em bloqueios de horário e os textos das Configurações também ficam de fora. Teste confere que e-mail, celular e senha **não aparecem** em nenhuma coluna.

**Crescimento controlado:** logins recusados, bloqueios, cadastros repetidos e chamadas não autorizadas viram **uma linha por (ação, quem, hora)** com contador, com teto de **50 linhas distintas por ação e hora**; o excedente vira uma só linha "agrupada" (teste: 56 e-mails diferentes → ≤ 51 linhas, soma das contagens = 56, nada se perde). O registro é feito **depois** dos limites de tentativas, então não os enfraquece (teste: o 6º login errado continua sendo barrado).

**Limite do histórico:** não havia trilha persistente antes; só linhas JSON no console. Nada foi reconstruído a partir de reservas/contas antigas, porque não dá para saber quem fez o quê. O histórico começa quando a migração for aplicada.

---

## 🟡 Médios abertos (5) — dependem de decisão ou infraestrutura

| # | Categoria | Problema | Sugestão |
|---|---|---|---|
| M3 | 03 Headers | CSP com `script-src 'unsafe-inline'` (o Next injeta scripts inline). O escape do React continua sendo a barreira; não há `dangerouslySetInnerHTML`. | CSP com *nonce* via middleware (exige renderização dinâmica) |
| M4 | 04 Auth | Sem confirmação de e-mail nem "esqueci minha senha": alguém pode cadastrar o e-mail de outra pessoa. | Provedor de e-mail transacional + ativação por link |
| M5 | 04 Auth | Sem `TRUSTED_PROXY_HOPS`, 5 senhas erradas bloqueiam o e-mail por 15 min de **qualquer origem**, inclusive a conta ADMIN. Com a variável configurada, o bloqueio passa a ser por origem+e-mail. | **Definir `TRUSTED_PROXY_HOPS` no deploy** (ação sua) |
| M6 | 18 LGPD | Sem exclusão/exportação de dados da cliente (art. 18). | Rotina de anonimização que preserve valores financeiros |
| M7 | 18 LGPD | Sem aviso de privacidade/consentimento no cadastro (nome e celular vão ao evento do Google Agenda). | Página de privacidade + aceite (o texto legal é seu) |

## 🔵 Baixos e informativos (12)

| # | Categoria | Achado |
|---|---|---|
| L1 | 02 Rede | Ações administrativas (serviços, expediente, situação) sem limite de taxa; só Configurações tem. Exige conta ADMIN. |
| L2 | 01 Segredos | Restam 6 arquivos SQLite antigos em `prisma/` (`dev.db`, `dev.backup.db`, `e2e.db`, `perf.db`, `test.db`, `dev.before-site-settings.db`), ignorados pelo git, mas com dados e hashes de senha de desenvolvimento. O SQLite não é mais usado: apague quando confirmar que não precisa deles. |
| L3 | 04 Auth | Sem segundo fator para a conta ADMIN. |
| L4 | 04 Auth | JWT de 7 dias sem revogação (o papel é conferido no banco a cada acesso, então rebaixar/remover conta vale na hora). |
| L5 | 05 Cripto | bcrypt com custo 10. |
| L6 | 07 Banco | Backups sem criptografia em repouso (`scripts/backup.ts` grava em modo 0600, que não vale no Windows). |
| L7 | 08 Deploy | `gitleaks/gitleaks-action@v2` usa tag móvel (as demais ações do CI estão fixadas por SHA). O CI nunca rodou (repositório fora do GitHub). |
| L8 | 16 Supply chain | `npm audit` completo: 12 avisos (1 alto, 2 "críticos" no `tinypool`), **todos só em ferramentas de desenvolvimento**; `npm audit --omit=dev` = **0**. |
| L9 | 14 Upload | EXIF da logo é mantido (a imagem é guardada como veio). |
| L10 | 19 Monitoramento | Sem alerta/coleta externa dos logs, e **sem política de retenção** da tabela `AuditLog` (a tabela só cresce, de forma limitada pelo agrupamento). Os eventos automáticos de sincronização com o Google (processo do sistema) não entram na trilha, só os feitos pela administradora. |
| L11 | 23 Bot | Sem CAPTCHA no cadastro. |
| L12 | 13 Race | Janela entre a consulta ao Google e o commit (documentada no README). |
| info | Ambiente | O banco de **teste** (PostgreSQL embutido no Windows) usa a codificação WIN1252, não UTF-8 como o Supabase; `.env.example` fica ignorado pelo git (`.env.*` no `.gitignore`), então não vai para o repositório. Nada disso afeta produção. |

---

## ✅ O que está seguro (e como foi verificado)

- **Segredos:** `git ls-files` não lista `.env`, `.env.supabase`, `*.db`; histórico git sem `.env` e sem chaves (`GOCSPX-`, `AKIA`, chaves privadas, `postgres://usuario:senha@`); só dois achados em testes, com senhas fictícias locais. `.env.example` com valores-modelo. Valores de `.env` **não foram lidos nem impressos**.
- **Autorização:** toda Server Action e rota chama `requireAdmin`/`requireClient`/`getAdminApiUser`, que reconferem o papel no banco; teste prova que cliente tentando criar serviço não cria nada nem deixa log; reserva de outra cliente responde "não encontrada" (teste de cancelamento) e não gera log.
- **Injeção:** Prisma parametrizado; nenhum `$queryRaw` no código do site; nenhum `eval`/`innerHTML`/`dangerouslySetInnerHTML`/`child_process`. Filtros da página de Logs (aba, resultado, datas, página, usuário) são validados e limitados; teste com `ADMIN'; DROP TABLE` cai na aba padrão.
- **Autenticação:** limite atômico por e-mail e origem; bcrypt sempre executado (sem diferença de tempo); resposta genérica; cadastro sem enumeração de contas (teste: resposta idêntica para e-mail novo e repetido).
- **Concorrência e duplicidade:** toda mudança na agenda passa por `runLocked`; restrição `EXCLUDE` contra sobreposição no banco; teste de corrida: duas clientes no mesmo horário → 1 reserva e **1** linha de log.
- **Banco:** RLS ligado em **todas** as tabelas (inclusive `AuditLog`), verificado por teste que consulta `pg_class`; um papel sem `BYPASSRLS` não lê nem grava nada.
- **Upload (logo):** só administradora, tipo pelos bytes (PNG/JPEG/WebP), SVG recusado, limite de tamanho e de dimensões, resposta com `nosniff` e CSP `sandbox`.
- **Cabeçalhos:** CSP (sem frames/objetos), `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP/CORP, HSTS em HTTPS. **Cookies/CORS:** sem CORS aberto; cookie do OAuth `httpOnly`, `sameSite=lax`, `secure` em produção.
- **Segredos do cron e OAuth:** `CRON_SECRET` comparado em tempo constante (mín. 16 caracteres); estado OAuth aleatório de 128 bits.
- **Dependências de produção:** `npm audit --omit=dev` = **0** vulnerabilidades.

## 📋 Riscos aceitos (de `memory-security.md`)

- **M2** teto global de cadastros **não aplicado** (permitiria bloquear todos os cadastros novos). Mitigação: `TRUSTED_PROXY_HOPS` e, se houver abuso, CAPTCHA.

## 🔄 Rotação de segredos

| Segredo | Situação |
|---|---|
| `NEXTAUTH_SECRET`, `TOKEN_ENCRYPTION_KEY`, senha da administradora, `CRON_SECRET` | Valores de desenvolvimento (não lidos). **Gerar valores novos para produção.** Guarde cópia segura de `TOKEN_ENCRYPTION_KEY`: sem ela os tokens do Google ficam ilegíveis. |
| Senha do banco (Supabase) e credenciais do Google | Não foram expostas por esta rodada. Rotacione se algum dia forem coladas em chat, log ou repositório. |

---

## 🧪 Verificações executadas

| Verificação | Resultado |
|---|---|
| `npx tsc --noEmit` | ✅ sem erros no projeto (os erros restantes são só da pasta `ECC/`, de terceiros, como o CLAUDE.md já avisa) |
| ESLint em `src`, `tests`, `e2e`, `scripts` | ✅ 0 erros, 0 avisos (`npm run lint` na raiz falha só por causa de `ECC/`) |
| `npm test` (PostgreSQL real, embutido e descartável) | ✅ **313/313** (284 antigos + 29 novos) |
| `next build` de produção (dentro do `playwright test`, numa cópia **sem `ECC/` e sem `.env`**) | ✅ build e servidor subiram |
| `npm run test:e2e` (Edge, desktop + 390 px), cópia sem `ECC/` | ✅ **26/26 testes antigos** (agendamento, cancelamento, disputa de horário, Google simulado, configurações) na rodada completa; ✅ **4/4** da página de Logs após corrigir 3 seletores do meu próprio teste |
| `npm audit --omit=dev` / completo | ✅ 0 / ⚠️ 12 (só ferramentas de dev) |

Nenhum comando tocou o Supabase: os testes usam `127.0.0.1` (o `resetDb()` recusa outro host) e a cópia do e2e foi feita sem os arquivos `.env`.

---

## 📅 Ações manuais antes de publicar

1. **Aplicar a migração no Supabase ANTES de subir esta versão:** `npm run db:deploy` (cria `AuditLog` com RLS). A gravação do log faz parte da transação da reserva; sem a tabela, **reservar falha**. Quem rodar `npm run dev` apontando para o Supabase sem aplicar a migração terá o mesmo erro.
2. Definir `TRUSTED_PROXY_HOPS` (M5/M2), gerar `NEXTAUTH_SECRET`, `TOKEN_ENCRYPTION_KEY` e `CRON_SECRET` novos para produção.
3. Decidir a **retenção** da tabela `AuditLog` (sugestão: manter falhas/bloqueios por 6–12 meses e o restante conforme a política de privacidade) e quem coleta os logs do console (`securityLog`).
4. Decidir sobre M4, M6 e M7 (e-mail de confirmação, LGPD) e M3 (CSP com nonce).
5. Apagar os `*.db` antigos de `prisma/` quando confirmar que não precisa mais deles (L2).
6. Opcional: `initdbFlags` UTF-8 no banco embutido dos testes para espelhar o Supabase.

Para aplicar as demais correções, use `/security-fix` (mudanças em arquivos existentes pedem confirmação).
