# Agendamento Online — Studio de Manicure

Site completo de agendamento para uma manicure: clientes reservam horário pelo
celular, e a administradora gerencia serviços, expediente, agendamentos e
acompanha o faturamento.

## Stack escolhida

O repositório estava vazio, então a stack foi escolhida do zero:

- **Next.js 14 (App Router) + TypeScript** — front-end e back-end no mesmo
  projeto (páginas, Server Actions e rotas de API), SSR e layout mobile-first.
- **Prisma ORM + SQLite** — banco relacional com migrations versionadas.
  SQLite foi escolhido para que o projeto rode **sem nenhum serviço externo**
  (sem Docker/Postgres instalados neste ambiente). O schema é 100% relacional
  e a troca para PostgreSQL em produção é só uma mudança de `datasource` (veja
  [Usando PostgreSQL em produção](#usando-postgresql-em-produção)).
- **NextAuth (Auth.js) v4** — autenticação por e-mail/senha (Credentials),
  sessão JWT com o papel (`CLIENTE`/`ADMIN`) embutido.
- **Tailwind CSS** — interface leve e mobile-first.
- **Recharts** — gráfico do dashboard de faturamento.
- **googleapis** — integração OAuth2 com o Google Agenda.
- **Vitest** — testes automatizados de integração contra um banco de testes real.

## Requisitos

- Node.js 18+ (testado com Node 24)
- Nenhum banco de dados externo é necessário — o SQLite é um arquivo local.

## Configuração inicial

```bash
npm install
cp .env.example .env
```

Edite o `.env` e defina pelo menos:

- `NEXTAUTH_SECRET` — gere com `openssl rand -base64 32`.
- `TOKEN_ENCRYPTION_KEY` — gere com `openssl rand -base64 32` (usada só para
  criptografar os tokens do Google Agenda em repouso).
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` / `ADMIN_PHONE` — dados da
  primeira conta administrativa (veja a próxima seção).

Rode as migrations e o seed:

```bash
npm run db:migrate   # cria o banco (prisma/dev.db) e aplica as migrations
npm run db:seed      # cria a primeira administradora, expediente padrão e serviços de exemplo
```

Inicie o servidor:

```bash
npm run dev
```

Acesse `http://localhost:3000`.

## Criando a primeira conta administrativa

**Não existe cadastro público de administradora.** O formulário de cadastro
do site (`/cadastro`) sempre cria uma conta `CLIENTE`, mesmo que alguém tente
manipular a requisição — o papel é decidido no servidor, nunca lido do corpo
da requisição (veja `src/app/api/auth/cadastro/route.ts`).

A única forma de criar/promover uma conta administrativa é pelo script de
seed, que lê `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PHONE` e `ADMIN_PASSWORD` do
`.env`:

```bash
npm run db:seed
```

Rodar de novo com um `ADMIN_EMAIL` já existente apenas garante que aquele
e-mail continue com papel `ADMIN` (idempotente). Para trocar a senha depois,
edite `ADMIN_PASSWORD` no `.env` e rode o seed novamente, ou atualize a senha
direto no banco com `npx prisma studio`.

## Configurando serviços e expediente

Como administradora, logue em `/login` e acesse o painel:

- **Serviços** (`/admin/servicos`) — cadastre nome, preço (em reais), duração
  em minutos e se o serviço está ativo. Só serviços ativos aparecem para as
  clientes.
- **Horários** (`/admin/horarios`) — defina, para cada dia da semana, se há
  atendimento, o horário de início/fim e o intervalo de almoço (opcional).
  Abaixo, cadastre bloqueios pontuais (feriados, folgas, férias) informando
  data e faixa de horário.

O seed já cria um expediente padrão (terça a sábado, 09h–18h, almoço
12h–13h) e 5 serviços de exemplo — ajuste como preferir.

## Conectar o Google Agenda

A integração é opcional: **o site funciona inteiramente com a agenda interna
sem ela.** Quando conectada, cada reserva confirmada gera um evento na agenda
do Google da administradora, que é atualizado ao mudar a reserva e removido
ao cancelar; eventos marcados como ocupados na agenda conectada também
bloqueiam horários no site.

1. No [Google Cloud Console](https://console.cloud.google.com/), crie um
   projeto (ou use um existente).
2. Em **APIs e serviços → Biblioteca**, ative a **Google Calendar API**.
3. Em **APIs e serviços → Tela de consentimento OAuth**, configure um app do
   tipo "Externo" (modo de teste é suficiente) e adicione o e-mail da
   administradora como usuário de teste.
4. Em **APIs e serviços → Credenciais → Criar credenciais → ID do cliente
   OAuth**, tipo "Aplicativo da Web", com:
   - Origem JavaScript autorizada: `http://localhost:3000` (ou o domínio de produção)
   - URI de redirecionamento autorizado: `http://localhost:3000/api/google/callback`
     (ajuste a porta/domínio em produção)
5. Copie o **Client ID** e o **Client Secret** gerados para o `.env`:
   ```
   GOOGLE_CLIENT_ID="..."
   GOOGLE_CLIENT_SECRET="..."
   GOOGLE_REDIRECT_URI="http://localhost:3000/api/google/callback"
   ```
6. Reinicie o servidor e acesse **Google Agenda** (`/admin/configuracoes/google`)
   no painel administrativo → **Conectar Google Agenda** → autorize o acesso
   com a conta Google da administradora.

**Para testar:** confirme uma reserva pelo fluxo da cliente e veja o evento
aparecer na agenda do Google em poucos segundos. Em cada reserva, o painel
administrativo mostra "✓ Sincronizado" ou, se algo falhar (token expirado,
sem internet etc.), "⚠ Falha ao sincronizar" com um botão **Tentar
novamente** — a nova tentativa reaproveita o evento já criado (nunca duplica).
O status de sincronização e o último erro ficam salvos no banco (`Appointment.googleSyncStatus`/`googleSyncError` e `GoogleCalendarAccount.lastSyncError`).

## Fuso horário e formato

Toda a aplicação trabalha com o fuso `America/Sao_Paulo`: os horários
exibidos, o cálculo de disponibilidade, o expediente e os períodos do
faturamento são todos calculados nesse fuso (os timestamps ficam salvos em
UTC no banco, convertidos nas bordas — veja `src/lib/format.ts`). Datas são
exibidas no padrão brasileiro (`dd/MM/yyyy`, `HH:mm`) e valores em reais
(`Intl.NumberFormat('pt-BR', { currency: 'BRL' })`).

## Prevenção de sobreposição de horários

Como o projeto roda em SQLite (sem suporte a `EXCLUDE CONSTRAINT`), a
prevenção de sobreposição é feita por **transação com bloqueio adequado**
(uma das duas abordagens pedidas), em `src/lib/booking.ts`:

1. A **criação** e a **reativação** de reservas (voltar uma reserva cancelada para
   confirmada) passam pelo mesmo mecanismo, `runLocked`, dentro de uma transação do Prisma.
2. A primeira instrução da transação é um `UPDATE` em uma linha única
   (`BookingLock`), o que faz o SQLite escalar imediatamente para um lock de
   escrita exclusivo do banco.
3. Só depois disso a disponibilidade do horário é reconferida — se duas
   clientes tentarem reservar o mesmo horário (ou horários que se sobrepõem)
   ao mesmo tempo, a segunda transação fica bloqueada até a primeira
   confirmar, reavalia a disponibilidade já vendo a reserva recém-criada, e é
   corretamente rejeitada com uma mensagem clara.
4. Falhas transitórias de lock (`SQLITE_BUSY`) são reexecutadas automaticamente.
5. As regras de horário são **as mesmas ao listar e ao confirmar**: dentro do
   expediente e fora do almoço, alinhado à grade de 15 minutos (a partir do início
   do expediente), com antecedência mínima de 30 minutos e no máximo 60 dias à
   frente, sempre no fuso `America/Sao_Paulo`.
6. Nenhuma chamada de rede acontece dentro da transação: a consulta ao Google
   Agenda é feita **antes** e o resultado é passado para a validação final sob o lock.

Isso está coberto por teste automatizado (duas reservas simultâneas para o
mesmo horário e sobreposição parcial — veja [Testes](#testes-automatizados)).

### Usando PostgreSQL em produção

> **Atualizado:** a variante PostgreSQL já está pronta e testada (restrição de exclusão no banco, migrações, migração de dados, backup). Veja a seção [PostgreSQL, backup e publicação](#postgresql-backup-e-publicação) e [docs/publicacao.md](docs/publicacao.md). O trecho abaixo é só o princípio.

Para mais concorrência simultânea (múltiplas profissionais, volume alto),
troque o `datasource` do `prisma/schema.prisma` para `postgresql` e use, em
vez do lock manual, uma constraint nativa:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Appointment" ADD COLUMN period tstzrange
  GENERATED ALWAYS AS (tstzrange("startAt", "endAt", '[)')) STORED;

ALTER TABLE "Appointment" ADD CONSTRAINT no_overlap
  EXCLUDE USING gist (period WITH &&)
  WHERE (status IN ('CONFIRMADA', 'CONCLUIDA'));
```

Isso faz o próprio Postgres rejeitar qualquer `INSERT`/`UPDATE` que crie uma
sobreposição, sem precisar do lock manual do `BookingLock`.

## Testes automatizados

```bash
npm test
```

Os testes rodam contra um **banco SQLite de teste real** (`prisma/test.db`,
recriado do zero a cada execução — veja `tests/global-setup.ts`), não contra
mocks. Cobertura (177 testes na suíte SQLite, 176 na PostgreSQL; 26 testes de tela no e2e):

| Cenário pedido | Onde está testado |
|---|---|
| Cadastro e login | `tests/auth.test.ts` — validação de campos, hash de senha, papel sempre `CLIENTE` no cadastro público (mesmo enviando `role: "ADMIN"` no corpo), e-mail duplicado, login com credenciais corretas/incorretas para cliente e administradora |
| Visibilidade imediata da reserva no painel | `tests/booking.test.ts` — após `createBooking`, a mesma consulta usada pelo painel já retorna a reserva |
| Histórico da cliente | `tests/booking.test.ts` — separação entre "próximos horários" e "histórico" |
| Acesso indevido a reservas de outra pessoa | `tests/booking.test.ts` — `getAppointmentForClient` retorna `null` ao tentar acessar o id de outra cliente (também verificado manualmente no navegador: `GET /meus-agendamentos/<id-de-outra-cliente>` → 404) |
| Sobreposição parcial | `tests/availability.test.ts` — o exemplo exato do briefing (atendimento 14h–15h bloqueia reservas às 13h30 e 14h30) |
| Duas reservas simultâneas para o mesmo horário | `tests/booking.test.ts` — `Promise.allSettled` disparando duas `createBooking` concorrentes; exatamente uma é confirmada |
| Liberação após cancelamento | `tests/booking.test.ts` — cancelar libera o horário para uma nova cliente |
| Preservação do preço histórico | `tests/booking.test.ts` — alterar o preço do serviço não afeta reservas já criadas |
| Faturamento nos três períodos | `tests/billing.test.ts` — diário/semanal/mensal, excluindo canceladas e faltas, por serviço |
| Integridade das reservas (grade de 15 min, horizonte de 60 dias, antecedência, datas inválidas, status inválido, CONCLUIDA só após o horário, cancelar → reservar → reativar, concorrência de criação e reativação) | `tests/booking-integrity.test.ts` |
| Google Agenda com integração **simulada** (sucesso, timeout com resposta perdida, falha 500, repetição sem duplicar, conflito de ID, indisponibilidade bloqueando confirmação/reativação/listagem) | `tests/google-sync.test.ts` |
| Limite de tentativas, IP atrás de proxy, resposta uniforme do cadastro, política de senha em bytes UTF-8, limites de tamanho, datas de filtros, cabeçalhos de segurança | `tests/auth-hardening.test.ts` |

Também validado num navegador real (Edge, servidor de produção isolado, fluxo
completo clicando/preenchendo formulários): cadastro → login →
escolher serviço → escolher dia/horário (respeitando expediente e almoço) →
revisar → confirmar → aparece em "Meus agendamentos" → aparece imediatamente
no painel administrativo com notificação → mudança de status reflete no
dashboard de faturamento → tentativa de acessar a reserva por outra conta
retorna 404.

**O que depende de configuração externa e não é testado automaticamente:**
a sincronização real com o Google Agenda (requer credenciais OAuth de um
projeto real no Google Cloud — veja [Conectar o Google Agenda](#conectar-o-google-agenda));
o código trata a ausência de conexão como caminho normal (`isGoogleCalendarConnected` retorna `false`),
então os testes automatizados cobrem o restante do sistema com essa
integração desligada, exatamente como ela se comporta sem credenciais.

## Scripts disponíveis

| Comando | Descrição |
|---|---|
| `npm run dev` | Servidor de desenvolvimento (Turbopack: 2,6× a 11× mais rápido na 1ª visita de cada página; veja [docs/perf/resultados.md](docs/perf/resultados.md)) |
| `npm run dev:webpack` | Servidor de desenvolvimento com webpack (o anterior) |
| `npm run build` / `npm start` | Build e execução em produção |
| `npm run db:migrate` | Cria/atualiza o banco local a partir do schema |
| `npm run db:deploy` | Aplica migrations em produção (sem gerar novas) |
| `npm run db:seed` | Cria a admin, expediente padrão e serviços de exemplo |
| `npm run db:studio` | Interface visual do banco (Prisma Studio) |
| `npm test` | Roda a suíte de testes automatizados |
| `npm run db:check-overlaps` | Relatório somente leitura: sobreposições, situações inválidas, órfãos, clientes acima do limite |
| `npm run test:pg` · `npm run test:e2e` | Suíte contra PostgreSQL real · testes de tela (Edge, desktop e 390 px) |
| `npm run db:backup` · `npm run db:restore` · `npm run db:rehearse-pg` | Backup com retenção · restauração · ensaio da migração para PostgreSQL |
| `npm run lint` | ESLint |

## Estrutura do projeto

```
prisma/schema.prisma      Modelos do banco (usuários, serviços, expediente,
                           bloqueios, agendamentos, conta do Google)
prisma/seed.ts             Script de inicialização (admin, expediente, serviços)
scripts/                   Utilitários de manutenção (check-overlaps.ts)
src/lib/                   Regras de negócio (disponibilidade, reservas,
                           faturamento, auth, Google Agenda, formatação)
src/app/                   Páginas e rotas (App Router): cadastro/login,
                           fluxo de agendamento da cliente, painel admin
src/components/            Componentes de UI compartilhados
tests/                     Testes de integração (Vitest) + helpers de fixture
```

## Segurança

### Limite de tentativas (login e cadastro)

Política inicial — janela de **15 minutos**, contadores guardados no banco
(tabela `RateLimit`, compartilhada entre processos e reinícios; as chaves são
hashes SHA-256, o e-mail/IP não ficam em claro). Os valores estão em
`src/lib/constants.ts` (`RATE_LIMITS`):

| Ação | Chave | Limite |
|---|---|---|
| Login (falhas) | e-mail normalizado (minúsculas, sem espaços, Unicode NFKC) | 5 falhas; a 6ª tentativa é barrada |
| Login (falhas) | IP | 20 falhas (mais alto: várias clientes podem dividir o mesmo Wi-Fi) |
| Cadastro (tentativas) | e-mail normalizado | 5 tentativas; a 6ª recebe `429` + `Retry-After` |
| Cadastro (tentativas) | IP | 10 tentativas |

- O bloqueio vale para **qualquer** e-mail, exista conta ou não, e é igual para todos.
  Um login correto zera o contador do e-mail.
- Trade-off conhecido: quem sabe o e-mail de outra pessoa pode bloqueá-la por até 15
  minutos digitando senhas erradas. É o custo de limitar força bruta sem CAPTCHA.
- **Limite por IP e proxy.** Cabeçalhos como `X-Forwarded-For` podem ser forjados por
  qualquer cliente, então **por padrão são ignorados** e o limite por IP fica desativado
  (o limite por e-mail continua valendo). Se o site roda atrás de proxy/CDN confiável,
  defina `TRUSTED_PROXY_HOPS` com o número de proxies confiáveis à frente da
  aplicação (ex.: `1`); a aplicação usa a entrada que o proxy mais próximo registrou
  (a N-ésima a partir da direita) e valida que é um IP.
- Login: resposta genérica para credenciais inválidas e a comparação bcrypt sempre
  acontece (hash fictício quando o e-mail não existe), então o tempo não revela se a conta existe.

### Cadastro sem enumeração de contas

O cadastro responde **igual** (status 200, mesmo corpo e mesmo custo de tempo) para
e-mail novo e e-mail já cadastrado, e não entra automaticamente: a cliente vê "Cadastro
recebido" e usa **Entrar**. **Risco residual:** sem confirmação por e-mail não há como avisar
a dona de um e-mail de que alguém tentou cadastrá-lo, nem impedir que alguém crie uma conta
com e-mail alheio. Para resolver é preciso um provedor de e-mail transacional (SMTP/API) e o
fluxo "confirmar e-mail para ativar a conta" + "esqueci minha senha". Esses fluxos **não existem
hoje**; não há troca de senha no site, então a política de senha abaixo vale para o cadastro e
para a senha da conta administrativa criada no seed (e deve ser reutilizada, via `passwordSchema`,
quando a troca/recuperação for criada).

### Política de senha e tamanhos

- Senha: 8 a **72 bytes em UTF-8** (limite do bcrypt; acima disso a senha seria truncada em
  silêncio, então é recusada), sem senhas muito comuns e sem um único caractere repetido.
  Contas antigas continuam entrando (o login não aplica essa política; aceita até 1024 bytes).
- Nome até 100, e-mail até 254, celular até 20 caracteres; serviço: nome até 80, preço até
  R$ 5.000,00, duração de 5 a 480 minutos; motivo de bloqueio até 200.

### Cabeçalhos de segurança (`next.config.mjs`)

CSP, `X-Frame-Options: DENY` (+ `frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`,
`Referrer-Policy`, `Permissions-Policy`; `X-Powered-By` removido. **HSTS** e
`upgrade-insecure-requests` só são enviados em produção com `NEXTAUTH_URL` em `https://`
(em `next start` local por HTTP eles quebrariam o site).

**Riscos residuais:**
- A CSP usa `script-src 'unsafe-inline'` porque o Next injeta scripts inline de
  inicialização. Isso reduz a proteção contra XSS (a defesa principal continua sendo o
  escape do React); o caminho para fechar isso é CSP com *nonce* via middleware, o que exige
  renderização dinâmica em todas as páginas.
- A sessão é um JWT (7 dias) com o papel embutido: se uma conta for rebaixada/removida, a
  sessão já emitida continua válida até expirar.

### Dependências

Auditoria de produção (`npm audit --omit=dev`): **8 avisos (2 críticos, 2 altos) → 0** após
`next` 14.2.35 → **15.5.29**, `next-auth` 4.24.11 → **4.24.15**, `zod` 3.23.8 → **4.6.7**,
`googleapis` 144.0.0 → **189.0.0** e `postcss` 8.5.32 (com `overrides` para a cópia embutida no
Next). Os avisos restantes de `npm audit` (completo) são só de ferramentas de desenvolvimento
(`vitest`/`vite`/`esbuild`) e não entram no site publicado.

Notas do upgrade para o Next 15: `params`/`searchParams` das páginas são assíncronos (já
ajustado). O React permanece 18.3.1 (o App Router do Next 15 usa o React que o próprio Next
empacota). Para rodar um servidor de teste sem sobrescrever a pasta de build do servidor
principal, use `NEXT_DIST_DIR=.next-teste` (veja abaixo).

## Google Agenda — consulta, idempotência e limites

- **Consulta de disponibilidade** (`freebusy`) é feita **antes** da transação de reserva e
  nunca dentro dela. Se a agenda está **conectada** e a consulta falha (rede, token, resposta
  sem dados), a confirmação, a reativação e a listagem de horários são **recusadas** com a
  mensagem "Não foi possível verificar a agenda do estúdio agora. Tente novamente…". Com a
  integração desativada, a agenda interna é usada normalmente.
- **Janela de concorrência:** entre a consulta ao Google e o `COMMIT` (milissegundos a poucos
  segundos), um compromisso criado diretamente no Google nesse intervalo não é visto. A
  validação interna continua exata sob o `BookingLock`; só o lado externo tem essa janela.
- **Eventos idempotentes:** o evento usa um ID determinístico (`"ag"` + SHA-256 do ID da
  reserva, em hexadecimal, que é um ID válido para o Google) e uma propriedade privada
  `appointmentId`. Se a criação for repetida (timeout, resposta perdida), o Google responde
  `409`; o sistema busca o evento, **confere que pertence à reserva** e o atualiza (ou o
  restaura, se estava cancelado) em vez de criar outro. Cancelar também remove o evento mesmo
  que o ID nunca tenha sido salvo. Chamadas ao Google têm timeout (5 s na consulta, 10 s nos eventos).
- **Depende de credenciais reais** (não verificável sem um projeto no Google Cloud): o
  comportamento exato do Google ao restaurar um evento removido (`update` com `status:
  confirmed`) e do `freebusy` com a sua agenda. Os testes usam uma integração simulada que
  imita o comportamento documentado.

## Verificação de reservas duplicadas antigas

```bash
npm run db:check-overlaps
```

Somente leitura. Lista grupos de reservas ativas (confirmadas/concluídas) que se sobrepõem e
indica qual manter. O saneamento preserva o histórico: cancele as demais pelo painel
(Agendamentos → situação "Cancelada"); nada é apagado.

## Desenvolvimento: um servidor por pasta de build

Dois `next dev` (ou um `next build` junto com um `next dev`) usando a mesma pasta `.next`
sobrescrevem o manifesto de rotas um do outro — sintoma: `GET /meus-agendamentos 404` e
"missing required error components, refreshing…" mesmo com sessão válida. Correção: pare todos
os servidores, apague **só** a pasta `.next` (banco e `.env` não são afetados) e rode
`npm run dev` uma única vez. Para um segundo servidor (testes, build de produção):

```bash
NEXT_DIST_DIR=.next-teste npm run build && NEXT_DIST_DIR=.next-teste npx next start -p 3100
```

## Riscos residuais conhecidos (decisões em aberto)

Pontos apontados na revisão final que **não têm correção honesta sem infraestrutura nova ou
uma decisão sua**:

| Risco | Por quê | O que resolveria |
|---|---|---|
| **Pré-cadastro de e-mail alheio / oráculo de login.** Quem cadastra `fulano@x` com uma senha que conhece e tenta entrar descobre se o e-mail era novo (entrou) ou já existia (não entrou); se era novo, a conta fica com a senha de quem cadastrou e a dona real, ao se cadastrar depois, recebe "cadastro recebido" mas não consegue entrar. | O cadastro público não confirma o e-mail. A resposta da API é uniforme, mas o login serve de teste. Cada tentativa é limitada (5 por e-mail em 15 min). | Confirmação de e-mail antes de ativar a conta + "esqueci minha senha" (provedor de e-mail transacional). |
| **Bloqueio de login usado contra outra pessoa.** 5 senhas erradas para um e-mail o bloqueiam por 15 min; repetir a cada 15 min mantém a conta (inclusive a da administradora) bloqueada. | Limite por e-mail é o que a política pede. | Chave (e-mail + IP) com limite maior só por e-mail, *backoff* progressivo ou desafio/CAPTCHA para a conta ADMIN; ou liberar a administradora por outro canal. |
| **Limite por IP desativado por padrão** (sem `TRUSTED_PROXY_HOPS`) e e-mails com `+alias` contam como e-mails diferentes; clientes IPv6 são contados por endereço completo. | O cabeçalho de IP é forjável sem proxy confiável. Cadastros em massa gastam CPU (bcrypt) e enchem a tabela de usuários. | Declarar o proxy; limite global de cadastros; CAPTCHA; confirmação de e-mail. |
| **Sem limite de reservas ativas por cliente.** Uma conta pode reservar todos os horários livres dos próximos 60 dias. Além disso, cada listagem de horários consulta o Google (cota da API), e como a consulta falha fechada, esgotar a cota bloqueia as reservas. | Regra de negócio (quantas reservas?) e cache. | Teto de reservas futuras por cliente (checado dentro do `runLocked`) e cache curto do `freebusy` por dia. |
| **Reativação com agenda do Google desatualizada em corrida rara.** Se a situação muda entre a leitura inicial e a transação, a operação pede para tentar de novo (já tratado); se a exclusão do evento falhou antes (status "Falha ao sincronizar"), o evento fantasma pode aparecer como conflito da própria reserva. | Depende do comportamento real do Google. | Reconciliar pelo ID do evento ao reativar; validar com credenciais reais. |
| **Sessão JWT com o papel embutido** (7 dias). | Padrão do NextAuth com credenciais. | Reler o papel no banco em rotas administrativas sensíveis, ou sessões em banco. |
| **`freebusy` usa a chave `primary`**: o código assume que o Google devolve o resultado sob a mesma chave pedida. Não verificado sem credenciais; se não for, a confirmação falha fechada (com mensagem) em vez de aceitar horário. | Sem projeto Google de teste. | Teste com credenciais reais. |

## Políticas de reserva (configuráveis)

| Política | Padrão | Variável | Onde vale |
|---|---|---|---|
| Reservas futuras ativas por cliente (status que ocupam a agenda: confirmada/concluída, com início no futuro) | **3** | `MAX_ACTIVE_FUTURE_BOOKINGS` | criação **e** reativação, checado **dentro** do lock de concorrência |
| Cancelamento pela cliente, com antecedência mínima | **24 horas** | `CLIENT_CANCEL_MIN_HOURS` (0 = até o início) | `Meus agendamentos` (detalhe da reserva); validado no servidor (dona, situação e prazo) |

O cancelamento pela cliente preserva o histórico (situação passa a "Cancelada"), libera o horário e atualiza o Google Agenda. A política aparece **antes de confirmar** a reserva e em **Meus agendamentos**; o cancelamento é em duas etapas ("Cancelar agendamento" → "Sim, cancelar"). A administradora continua podendo cancelar a qualquer momento.

## PostgreSQL, backup e publicação

- **Estratégia:** SQLite continua no dia a dia e nos testes; a variante PostgreSQL é **derivada** de `prisma/schema.prisma` (`npm run db:pg:schema`), então os modelos não divergem. As migrações do PostgreSQL ficam em `prisma/postgres/migrations` e incluem a restrição `Appointment_no_overlap` (`EXCLUDE USING gist (tsrange("startAt","endAt",'[)') WITH &&) WHERE status IN ('CONFIRMADA','CONCLUIDA')`), que **recusa sobreposição no próprio banco**, entre processos e instâncias; horários consecutivos são aceitos. Também há `CHECK` de situação, papel, intervalo e valores.
- **Migração de dados:** `scripts/migrate-sqlite-to-postgres.ts` (checagem prévia que **para com relatório** se houver sobreposição, situação inválida, intervalo inválido, órfãos ou e-mails duplicados; cópia numa única transação; verificação por contagem e hash; nunca altera a origem). Ensaio com seus dados: `npm run db:rehearse-pg`.
- **Backup:** `npm run db:backup` (diário; retenção 14 dias + 6 meses), `npm run db:restore` (recusa sobrescrever sem `--force`). Veja [docs/publicacao.md](docs/publicacao.md) para ordem das operações, verificações e plano de retorno.
- **Testes:** `npm run test:pg` roda **toda a suíte** contra um PostgreSQL real e descartável (embutido, sem Docker) mais testes próprios do PostgreSQL (restrição direta no banco, 3 processos Node disputando o mesmo horário, migração).
- **Testes de tela:** `npm run test:e2e` (Playwright com o Edge instalado; desktop e 390 px; capturas em `e2e/screenshots/`).
- **Lint:** `npm run lint` (ESLint 9 + config do Next).

## Configurações do estúdio, Google Agenda e horários livres

- **Configurações** (`/admin/configuracoes`, só administradora): nome, slogan, apresentação, logo, telefone, WhatsApp,
  Instagram, endereço e instruções de chegada. Ficam no banco (`SiteSettings`; a logo em `SiteLogo`, no banco para
  persistir em qualquer hospedagem e entrar no backup). Sem registro, o site usa os padrões de `src/lib/site.ts`. A logo é
  validada no servidor pelos bytes (PNG/JPEG/WebP, até 512 KB, 64–2048 px; SVG recusado) e servida por `/api/logo?v=N` com
  cache de 1 ano — por isso o número da versão nunca é reutilizado. Cache das configurações: global, chave fixa, invalidado ao salvar.
- **Salvar no Google Agenda** (cliente): aparece na confirmação e no detalhe de reservas **confirmadas e futuras**. É um link
  de criação de evento (início/fim em UTC + `ctz=America/Sao_Paulo`, endereço e instruções das Configurações, referência da
  reserva); a cliente confirma na própria conta e, depois de salvo, o evento é dela.
- **Sincronização com a agenda da administradora**: fila durável no banco (`src/lib/google-sync-queue.ts`); falhas e "Tentar
  novamente" em `/admin/configuracoes/google`. Servidor de processo fixo: o temporizador interno cuida de tudo, inclusive após
  reinício. Hospedagem serverless: defina `CRON_SECRET` e agende `GET /api/cron/google-sync` a cada 5 min com
  `Authorization: Bearer <CRON_SECRET>`.
- **Horários**: a lista mostra só inícios em que o serviço inteiro cabe (reservas, bloqueios, expediente, almoço e agenda
  externa). Datas fora do período reservável não consultam o Google.

### Verificação real do Google Agenda (depende de credenciais)

Os fluxos foram validados com agenda simulada (`tests/google-sync-queue.test.ts`). Para a verificação real, use uma agenda
**de teste**, não a de uso:

1. Crie as credenciais OAuth conforme [Conectar o Google Agenda](#conectar-o-google-agenda) e preencha o `.env`.
2. `npm run dev`, entre como administradora, **Google Agenda → Conectar** e autorize a conta de teste.
3. Como cliente, confirme uma reserva: o evento "Serviço — Cliente" deve aparecer na agenda em poucos segundos, com o endereço
   das Configurações e o horário em America/Sao_Paulo.
4. Cancele a reserva: o evento some. Desligue a internet e reserve de novo: a reserva fica "Falha ao sincronizar" no painel;
   religue e use **Tentar novamente** — o mesmo evento é criado, nunca dois.
5. Crie um compromisso na agenda de teste no meio de um dia: os horários que ele cobre devem sumir da lista da cliente.
6. Dois comportamentos são assumidos e só a API real confirma: `events.get` de evento apagado devolve `status: "cancelled"`
   e o `freebusy` responde sob a chave `primary`.

Sem credenciais, `GOOGLE_CALENDAR_MOCK=1` (só em desenvolvimento) liga um Google simulado em memória; `/api/dev/google-mock`
(administradora) lista os eventos e liga/desliga falhas.
