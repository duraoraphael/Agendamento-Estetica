# 🔐 Relatório de Auditoria de Segurança

**Data:** 2026-11-05
**Pontuação:** 96/100 🟢
**Projeto:** agendamento-manicure (Studio de Manicure)
**Stacks detectadas:** Node.js 24 · Next.js 15.5.29 (App Router) · Prisma 5.22 (SQLite; variante PostgreSQL pronta) · NextAuth 4.24.15 (credenciais, JWT) · Google Calendar API · Playwright/Vitest (testes)
**Auditado por:** security-skill v1.0.0 (método) + leitura de código e evidências coletadas nesta sessão

> **Resultado em uma frase:** não há problema Crítico nem Alto verificado. Os pontos abertos são 8 Médios e 12 Baixos, quase todos de **política e operação** (e-mail de confirmação, LGPD, monitoramento, limites por usuário), não de falha de código explorável.

---

## 📊 Quadro de pontuação

```
╔══════════════════════════════════════════════════╗
║        SECURITY SCORE : 96/100  🟢                ║
╠══════════════════════════════════════════════════╣
║  🟢 01 Secrets & Files            100/100         ║
║  🟡 02 Network & CORS              90/100         ║
║  🟢 03 HTTP Headers                93/100         ║
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
║  ⚪ 14 File Upload                  N/A           ║
║  ⚪ 15 DNS & Email                  N/A           ║
║  🟢 16 Supply Chain                98/100         ║
║  ⚪ 17 Mobile                       N/A           ║
║  🟢 18 Compliance & LGPD/GDPR      90/100         ║
║  🟢 19 Monitoring & Detection      93/100         ║
║  ⚪ 20 Serverless & Edge            N/A           ║
║  🟢 21 Source Code Analysis       100/100         ║
║  ⚪ 22 AI/LLM Security              N/A           ║
║  🟢 23 Bot & DDoS                  96/100         ║
║  🟢 24 Browser APIs               100/100         ║
║  🟢 25 Advanced Security (L3)      98/100         ║
╚══════════════════════════════════════════════════╝
  📈 Pontuação anterior: nenhuma (primeira auditoria)
  🔴 0 críticos | 🟠 0 altos | 🟡 8 médios | 🔵 12 baixos
```

**Como foi calculado.** Cada categoria parte de 100 e perde 20/10/5/2 pontos por problema Crítico/Alto/Médio/Baixo (mínimo 0). A nota final é a média ponderada pelas categorias aplicáveis. Sete categorias não se aplicam a este projeto (Docker, Protocolos, Upload de arquivos, DNS/E-mail, Mobile, Serverless, IA/LLM) e ficaram de fora. **Observação:** os pesos definidos na skill somam 111%, não 100%; normalizei dividindo pela soma dos pesos aplicáveis (92). Cálculo: 8.872 ÷ 92 = **96,4**.

---

## 🔴 Críticos e 🟠 Altos

Nenhum verificado.

---

## 🟡 Médios (8)

### M1. Ações autenticadas sem limite de taxa (CWE-770) — Categoria 02
**Arquivo:** `src/app/agendar/actions.ts` (`getAvailableSlotsAction`)
**Problema:** qualquer cliente logada pode chamar a listagem de horários quantas vezes quiser. Com o Google Agenda conectado, cada chamada consulta a API do Google.
**Risco:** esgotar a cota do Google. Como a consulta falha "fechada" (por segurança), isso **bloqueia todas as reservas** do estúdio.
**Correção sugerida:** limite por usuária (ex.: 60 consultas/minuto) usando o mesmo `rate-limit.ts` e cache curto (30–60 s) do resultado por dia.

### M2. Limite de cadastro por IP desligado por padrão (CWE-770) — Categoria 02
**Arquivo:** `src/lib/rate-limit.ts` (`getClientIp`), `src/app/api/auth/cadastro/route.ts`
**Problema:** sem `TRUSTED_PROXY_HOPS`, só vale o limite por e-mail. Com e-mails diferentes, um script cadastra sem limite.
**Risco:** gasto de CPU (bcrypt) e crescimento da tabela de usuários.
**Correção sugerida:** definir `TRUSTED_PROXY_HOPS` em produção atrás de proxy e/ou adicionar um teto global de cadastros por janela (ex.: 100 por 15 min).

### M3. CSP com `script-src 'unsafe-inline'` (CWE-1021) — Categoria 03
**Arquivo:** `next.config.mjs`
**Problema:** o Next injeta scripts de inicialização inline, então a política não bloqueia um eventual XSS.
**Risco:** reduz a defesa em profundidade; o escape do React continua sendo a barreira principal (não há `dangerouslySetInnerHTML` no site).
**Correção sugerida:** CSP com *nonce* via middleware (exige renderização dinâmica em todas as páginas).

### M4. Sem confirmação de e-mail nem recuperação de senha (CWE-287) — Categoria 04
**Arquivo:** `src/app/api/auth/cadastro/route.ts`
**Problema:** alguém pode cadastrar o e-mail de outra pessoa com uma senha que conhece; e, tentando entrar com ela, descobre se o e-mail era novo (oráculo de existência de conta). A dona real, ao se cadastrar depois, recebe "cadastro recebido" mas não consegue entrar.
**Risco:** tomada de conta preventiva e enumeração de contas. Também não existe "esqueci minha senha".
**Correção sugerida:** provedor de e-mail transacional + ativação por link + recuperação de senha.

### M5. Bloqueio por e-mail pode ser usado contra a administradora (CWE-645) — Categoria 04
**Arquivo:** `src/lib/auth.ts`
**Problema:** 5 senhas erradas bloqueiam o e-mail por 15 min, de qualquer IP.
**Risco:** repetindo a cada 15 min, mantém a administradora fora do painel.
**Correção sugerida:** chave e-mail + IP com limite maior só por e-mail, atraso progressivo, ou desafio/CAPTCHA para a conta ADMIN.

### M6. Sem exclusão/exportação de dados pessoais (LGPD art. 18) — Categoria 18
**Problema:** não há fluxo para a cliente pedir exclusão ou cópia dos seus dados (nome, e-mail, celular, histórico). Reservas ficam no histórico e no faturamento.
**Correção sugerida:** rotina de anonimização (preservar valores financeiros, apagar nome/e-mail/celular) acionável pela administradora e, depois, pela cliente.

### M7. Sem aviso de privacidade nem consentimento (LGPD arts. 7 e 9) — Categoria 18
**Arquivo:** `src/app/cadastro/page.tsx`
**Problema:** o cadastro não informa finalidade, retenção nem que nome e celular vão para o evento do Google Agenda da administradora.
**Correção sugerida:** página de privacidade e aceite no cadastro.

### M8. Sem registro de eventos de segurança (CWE-778) — Categoria 19
**Arquivos:** `src/lib/auth.ts`, `src/lib/rate-limit.ts`
**Problema:** bloqueios de login, respostas 429, falhas repetidas e mudanças de situação feitas pela administradora não geram log estruturado nem alerta.
**Risco:** um ataque lento de força bruta passaria despercebido.
**Correção sugerida:** log estruturado (sem dados pessoais) para: login bloqueado, 429, login de ADMIN, alteração de situação e cancelamento.

---

## 🔵 Baixos (12)

| # | Categoria | Achado | Sugestão |
|---|---|---|---|
| L1 | 03 Headers | Sem `Cross-Origin-Opener-Policy`/`Cross-Origin-Resource-Policy` | `COOP: same-origin`, `CORP: same-origin` (testar o fluxo OAuth do Google) |
| L2 | 04 Auth | Sem segundo fator para a conta ADMIN | TOTP/WebAuthn para a administradora |
| L3 | 04 Auth | JWT de 7 dias sem revogação; o papel é conferido no banco, mas um token de cliente continua válido até expirar | Reduzir `maxAge` ou lista de revogação |
| L4 | 05 Cripto | bcrypt com custo 10 | Subir para 12 (rehash no login) |
| L5 | 07 Banco | Arquivo SQLite e backups sem criptografia em repouso; modo 0600 não vale no Windows | Disco criptografado / criptografar backups |
| L6 | 08 Deploy | Sem pipeline de CI (audit, lint, testes não são automáticos) | GitHub Actions com `npm audit`, `lint`, `test`, `test:pg` |
| L7 | 13 Race | Janela entre a consulta ao Google e o commit: compromisso criado no Google nesse intervalo não é visto | Já documentada; aceitar ou reconsultar |
| L8 | 16 Supply chain | 6 avisos só em ferramentas de desenvolvimento (vitest/vite/esbuild, typescript-eslint/minimatch); **produção: 0** | Migrar para vitest 3 quando conveniente |
| L9 | 19 Monitoramento | Sem trilha de auditoria das ações administrativas | Tabela `AuditLog` |
| L10 | 23 Bot/DDoS | Sem CAPTCHA no cadastro | Turnstile/hCaptcha se houver abuso |
| L11 | 23 Bot/DDoS | Sem teto de tamanho do corpo em `/api/auth/cadastro` (aceitou 200 KB; o limite padrão do Node é alto) | Rejeitar corpo > 10 KB antes de `request.json()` |
| L12 | 25 Avançado | Cabeçalhos `Sec-Fetch-*` não são usados para barrar requisições cross-site | Opcional; o Next já checa Origin em Server Actions |

---

## ✅ O que está seguro

- **Segredos:** nenhum padrão de chave/token/chave privada no código; histórico git sem ocorrências; `.env` e `*.db` ignorados pelo git; `.env.example` com valores vazios; o servidor em produção **recusa subir** com `NEXTAUTH_SECRET` fraco ou de exemplo; tokens do Google criptografados com AES-256-GCM (IV aleatório).
- **Autorização:** toda Server Action e rota chama `requireAdmin`/`requireClient`/`getAdminApiUser` antes de agir; IDs validados; reserva de outra cliente responde "não encontrada" (sem IDOR); o papel é reconferido **no banco**, não só no JWT; cadastro público nunca cria ADMIN (sem mass assignment).
- **Autenticação:** limite atômico por e-mail e por IP entre processos; comparação bcrypt sempre executada (sem diferença de tempo); resposta de login genérica; política de senha em bytes UTF-8; destino pós-login restrito a caminhos do próprio site (sem redirecionamento aberto).
- **Injeção:** Prisma parametrizado; nenhum `eval`, `new Function`, `innerHTML` ou `child_process` no código do site; o `$queryRawUnsafe` só aparece em scripts do operador com texto fixo; sem Trojan Source (0 caracteres bidirecionais ou de largura zero).
- **Concorrência:** toda mudança na agenda serializada por `BookingLock`; limite de reservas e conflitos checados sob o lock; no PostgreSQL há ainda a restrição `EXCLUDE` no banco; Google com ID de evento idempotente e consulta fora da transação.
- **Cabeçalhos:** CSP (sem frames, sem `object`), `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS em HTTPS, `X-Powered-By` removido.
- **Dependências:** `npm audit --omit=dev` = **0 vulnerabilidades**; versões fixadas; lockfile presente.
- **Rede:** nenhuma porta em escuta no momento; sem CORS aberto (mesma origem).

---

## 📋 Riscos aceitos

Nenhum registrado em `memory-security.md`. Os itens M4, M5, M2 e L7 estão documentados no README como riscos residuais, mas **não foram marcados como aceitos por você**.

## 🔄 Rotação de segredos

| Segredo | Situação |
|---|---|
| `NEXTAUTH_SECRET`, `TOKEN_ENCRYPTION_KEY`, senha da administradora | Valores locais de desenvolvimento (não lidos nesta auditoria). **Gerar valores novos para produção.** |
| Credenciais do Google | Ainda não configuradas |

---

## 🚫 O que esta auditoria NÃO cobriu

- **Ambiente de publicação** (domínio, HTTPS real, DNS, SPF/DKIM/DMARC, painel de hospedagem): ainda não existe.
- **Teste de invasão** com o site no ar e **varredura dinâmica** (DAST).
- **Google OAuth e Google Agenda reais**: validados só por simulação.
- Não li as 28 páginas de instruções detalhadas da skill; usei a lista de categorias e pesos de `skill.md` e o método de pontuação do arquivo 26.
- Cabeçalhos de cache de páginas autenticadas e `Set-Cookie` em HTTPS não foram medidos.

---

## 📅 Próximos passos (ordem sugerida)

1. **Antes de publicar:** M4 (e-mail de confirmação + recuperação de senha), M6 e M7 (LGPD), M8 (log de segurança) e definir `TRUSTED_PROXY_HOPS` (M2).
2. **Logo depois:** M1 (limite por usuária e cache no `getAvailableSlotsAction`), M5 (proteção da conta ADMIN) e L11 (limite de corpo).
3. **Evolução:** M3 (CSP com nonce), L2 (2FA da administradora), L6 (CI).

Para aplicar correções, use `/security-fix`. As mudanças em arquivos existentes pedem confirmação antes.

---

## ✅ Correções aplicadas em 2026-11-05 (`/security-fix`)

| Item | O que foi feito | Arquivos | Verificação |
|---|---|---|---|
| **M1** Consultas de horário sem limite | 60 consultas/min por cliente; excesso responde "Muitas consultas seguidas" e é registrado | `src/app/agendar/actions.ts`, `src/lib/constants.ts` | teste (61ª barrada; outra cliente não afetada); vermelho→verde ✅ |
| **L11** Corpo do cadastro sem teto | Leitura em partes com aborto acima de 10 KB (`413`), também sem `Content-Length` | `src/lib/body-limit.ts` (novo), `src/app/api/auth/cadastro/route.ts` | 4 testes; vermelho→verde ✅ |
| **M8** Sem log de segurança | Uma linha JSON por evento (login falho/bloqueado, login de ADMIN, cadastro bloqueado, consulta limitada, mudança de situação pela administradora). E-mail só como hash curto | `src/lib/security-log.ts` (novo), `src/lib/auth.ts`, `src/app/admin/agendamentos/actions.ts` | teste prova que o log **não contém** e-mail, nome, celular nem senha ✅. Falta coletar/alertar no ambiente de hospedagem |
| **L1** COOP/CORP | `Cross-Origin-Opener-Policy` e `Cross-Origin-Resource-Policy: same-origin` | `next.config.mjs` | teste de cabeçalhos + build de produção + 16 testes de tela ✅ |
| **L6** Sem CI | Fluxo de verificação (auditoria de produção, gitleaks, tipos, lint, testes) e Dependabot | `.github/workflows/security.yml`, `.github/dependabot.yml`, `.gitleaks.toml` (novos) | ⏳ **não executado**: só vale quando o repositório for ao GitHub; o gitleaks não foi rodado localmente |

**Resultado das verificações após as correções:** `tsc` ok · lint 0 avisos · `npm test` 139/139 · `npm run test:pg` 138/138 · `npm run test:e2e` 16/16 · `npm audit --omit=dev` 0.

**Decididos pela usuária:** M2 (teto global de cadastros) **não aplicado**: abriria uma forma de bloquear todos os cadastros novos. Mitigação: definir `TRUSTED_PROXY_HOPS` ao publicar.

**Pontuação estimada após as correções: ~97/100** (6 Médios e 10 Baixos restantes). É uma estimativa: rode `/security-audit` para confirmar.

### Pendentes que exigem decisão ou infraestrutura (nível 5, não aplicados)
- **M4** confirmação de e-mail + recuperação de senha (precisa de provedor de e-mail).
- **M5** proteção da conta ADMIN contra bloqueio por terceiros (escolher: chave e-mail+IP, atraso progressivo ou CAPTCHA).
- **M6 e M7** LGPD: exclusão/exportação de dados e aviso de privacidade (o texto legal e o contato do responsável precisam ser seus).
- **M3** CSP com *nonce* (mudança estrutural).
- **M2** teto global de cadastros (recusado); **L2** 2FA da administradora; **L4** bcrypt custo 12 (não recomendado agora: quadruplica o custo de CPU no cadastro/login); **L3, L5, L7, L8, L9, L10, L12**.
