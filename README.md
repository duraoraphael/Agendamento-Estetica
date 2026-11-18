# Garage Zero Zero — Agendamento de estética automotiva

Plataforma de agendamento da **Garage Zero Zero** (estética automotiva premium): clientes escolhem o serviço, o dia e o
horário, informam o veículo e confirmam pelo celular; a administração gerencia serviços, expediente, agendamentos,
veículos atendidos e o faturamento. O projeto nasceu como um sistema de agendamento para manicure e foi **transformado por
completo** em estética automotiva (identidade visual, textos, fluxo, banco e painel), sem perder nenhuma rota nem regra de
segurança. Os valores internos dos papéis (`CLIENTE`/`ADMIN`) foram mantidos de propósito (evitam uma migração desnecessária).

> **Nome:** GARAGE ZERO ZERO. **Logo:** `public/brand/logo.svg` (arquivo fornecido pela proprietária; não redesenhar).
> **Fotos:** veja [docs/imagens.md](docs/imagens.md). **Fotos dos serviços (envio pelo painel, Supabase Storage):** veja [docs/fotos-servicos.md](docs/fotos-servicos.md). **Publicação:** veja [docs/publicacao.md](docs/publicacao.md).

## Identidade visual (design system)

Tema escuro com amarelo estratégico, definido num só lugar: `src/lib/theme.ts` (cores) → `tailwind.config.ts` (tokens) →
`src/app/globals.css` (botões, campos, cartões, avisos, selos, esqueleto de carregamento).

| Token | Valor | Uso |
|---|---|---|
| `ink` | `#090D10` | fundo principal |
| `surface` / `surface-2` | `#11171B` / `#171E22` | fundo elevado e superfície secundária |
| `brand` | `#FFCA05` (hover `#E9B800`) | CTAs, selecionados, filetes, bordas de destaque, ícones, palavras-chave dos títulos |
| `fg` / `fg-muted` | `#F5F0DF` / `#B9BEC1` | texto e texto secundário |
| `line` | `#2A3237` (forte `#6B777E`) | divisórias e bordas de campos |

- **Fontes:** Inter (corpo e formulários) e **Barlow Condensed** (títulos: caixa alta, itálico, pesos 700/800), ambas pelo
  `next/font` (servidas pelo próprio site). O Playfair Display saiu.
- **Acessibilidade:** contraste WCAG AA (os pares estão documentados em `src/lib/theme.ts`), foco visível, alvos de toque de pelo
  menos 44 px, rótulos visíveis, erros associados aos campos (`aria-describedby`), `prefers-reduced-motion` respeitado, link
  "Pular para o conteúdo" e calendário com rótulos por extenso.
- **Imagens:** `next/image` com `sizes` e dimensões fixas (sem salto de layout), em WebP. Hoje são placeholders escuros que você
  troca pelas fotos reais sem mexer no código ([docs/imagens.md](docs/imagens.md)).

## Rotas

| Rota | Quem acessa | O que é |
|---|---|---|
| `/` | todos (cliente logada vai para a conta) | landing: abertura, agendamento rápido, serviços, diferenciais, contato |
| `/servicos` | todos | serviços com descrição, duração, preço, benefícios e foto |
| `/login`, `/cadastro`, `/recuperar-senha`, `/redefinir-senha` | visitantes | acesso (com mostrar/ocultar senha e callback seguro) |
| `/agendar` → `/agendar/horario` → `/agendar/veiculo` → `/agendar/revisar` → `/agendar/confirmado/[id]` | cliente | fluxo de **4 etapas** (serviço, data e horário, veículo, revisão) e a confirmação |
| `/meus-agendamentos`, `/meus-agendamentos/[id]`, `/meus-agendamentos/[id]/reagendar` | cliente | abas Próximos/Histórico, detalhe, cancelamento em duas etapas e reagendamento |
| `/minha-conta`, `/minha-conta/veiculos`, `/minha-conta/veiculos/novo`, `/minha-conta/veiculos/[id]/editar` | cliente | dados pessoais, troca de senha, veículos |
| `/admin/**` | administração | dashboard, agendamentos (com busca por cliente e placa), serviços, horários, faturamento, configurações, Google Agenda, logs |

## Stack escolhida

O repositório estava vazio, então a stack foi escolhida do zero:

- **Next.js 15 (App Router) + TypeScript** — front-end e back-end no mesmo
  projeto (páginas, Server Actions e rotas de API), SSR e layout mobile-first.
- **Prisma ORM + PostgreSQL (Supabase, região São Paulo)** — banco relacional ÚNICO, com migrations
  versionadas em `prisma/migrations`. Restrições que o Prisma não modela (sem sobreposição de
  horários, CHECKs e RLS) estão em SQL nessas migrations.
- **NextAuth (Auth.js) v4** — autenticação por e-mail/senha (Credentials),
  sessão JWT com o papel (`CLIENTE`/`ADMIN`) embutido.
- **Tailwind CSS** — interface leve e mobile-first.
- **Recharts** — gráfico do dashboard de faturamento.
- **googleapis** — integração OAuth2 com o Google Agenda.
- **Vitest** — testes automatizados de integração contra um banco de testes real.

## Requisitos

- Node.js 18+ (testado com Node 24)
- Um projeto no [Supabase](https://supabase.com) (PostgreSQL), de preferência na região **São Paulo (sa-east-1)**.
- Os testes NÃO usam o Supabase: rodam num PostgreSQL embutido e descartável (sem Docker).

## Configuração inicial

```bash
npm install
cp .env.example .env
```

Edite o `.env` e defina pelo menos:

- `DATABASE_URL` e `DIRECT_URL` — as strings do Supabase (**Connect**): *Transaction pooler* (porta 6543, com
  `?pgbouncer=true`) para o app e *Session pooler* ou *Direct* (porta 5432) para migrations e backup.
  O modelo completo, com instruções, está em `.env.example`.
- `NEXTAUTH_SECRET` — gere com `openssl rand -base64 32`.
- `TOKEN_ENCRYPTION_KEY` — gere com `openssl rand -base64 32` (usada só para
  criptografar os tokens do Google Agenda em repouso).
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` / `ADMIN_PHONE` — dados da
  primeira conta administrativa (veja a próxima seção).

Rode as migrations e o seed:

```bash
npm run db:deploy    # aplica prisma/migrations no Supabase (tabelas, restrições, RLS)
npm run db:seed      # cria a primeira administradora, expediente padrão e serviços de exemplo
```

> `npm run dev` usa o banco do `.env`, ou seja, o **Supabase**. Se ele também for o de produção, use um segundo
> projeto Supabase só para desenvolvimento: o dev e o seed gravam de verdade.

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

A única forma de criar uma conta administrativa é pelo script de seed, que lê
`ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PHONE` e `ADMIN_PASSWORD` do `.env`:

```bash
npm run db:seed
```

O seed **só cria** a conta, e nunca promove nem altera uma conta que já exista
(o cadastro público não verifica o e-mail, então promover uma linha existente
poderia entregar o painel a quem escolheu a senha dela):

- e-mail novo → cria a conta `ADMIN`;
- e-mail que já é `ADMIN` → não muda nada (nem a senha), então rodar de novo é seguro;
- e-mail que já pertence a uma cliente → o seed **é interrompido** com uma
  mensagem de erro e nada é alterado nessa conta. Use outro `ADMIN_EMAIL`.

Como o seed não troca senhas, para trocar a senha da administradora use
`npx prisma studio` (ou um script próprio que gere o hash bcrypt).

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
12h–13h) e os **7 serviços automotivos padrão** (Lavagem detalhada, Higienização interna, Polimento técnico, Cristalização de
pintura, Vitrificação, Higienização de ar-condicionado e Limpeza e hidratação de couro). Os preços e as durações do seed são só
**ponto de partida**: ajuste em `/admin/servicos`. O seed e a migração abaixo **nunca** sobrescrevem preço, duração ou estado de
um serviço que já existe com o mesmo nome.

## Migração dos dados da manicure (bancos que já existiam)

Quem já tinha o sistema de manicure no Supabase roda, **depois** de `npm run db:deploy`:

```bash
npm run db:migrate-services -- --dry-run   # só mostra o que seria feito
npm run db:migrate-services                # aplica
```

Comportamento (idempotente: rodar de novo não muda mais nada; coberto por `tests/service-migration.test.ts`):

1. **Desativa** (`active = false`, sem apagar) apenas os serviços cujo nome é **exatamente** um dos 5 do seed antigo
   (Manicure tradicional, Pedicure tradicional, Manicure + Pedicure, Esmaltação em gel, Alongamento de unhas), **mesmo que o preço
   tenha sido editado**. Serviços personalizados (outros nomes) não são tocados.
2. **Cadastra** os 7 serviços automotivos que ainda não existem (nome exato, ativo ou não). Nunca reativa nem altera um existente.
3. Troca por vazio (= usar o padrão novo) só os textos do site (nome, slogan, apresentação) que ainda estão **idênticos** aos
   padrões antigos. Contatos, endereço, Instagram e logo ficam como estão.
4. **Não altera nenhum agendamento.** As reservas históricas continuam mostrando o serviço e o preço gravados nelas; por isso
   reservas antigas ainda exibirão nomes como "Manicure tradicional" no histórico, e isso é intencional (o histórico não se reescreve).

## Veículos e o fluxo de 4 etapas

1. **Serviço** → 2. **Data e horário** (calendário mensal acessível; dias passados, fora do horizonte de 60 dias ou sem expediente
ficam desativados; atualização silenciosa da lista; "próximo dia com horário"; conflito tratado se outra cliente ocupar o
horário) → 3. **Veículo** (escolher um veículo da conta **ou cadastrar um novo na hora**, mais observações de até 500
caracteres) → 4. **Revisão** (serviço, data, duração, valor, veículo com **placa parcialmente mascarada**, observações, local e
política de cancelamento) → **Confirmação** (`/agendar/confirmado/[id]`, só para a dona da reserva).

- **Obrigatório no servidor:** `createBooking` exige `vehicleId` e confere, dentro do `runLocked`, que o veículo é **da própria
  cliente** (de outra pessoa responde como inexistente). A tela é só conveniência.
- **Snapshot:** a reserva guarda uma cópia de marca, modelo e placa (`vehicle*Snapshot`). Editar ou apagar o veículo depois
  **não altera** o histórico; reservas anteriores à atualização (sem veículo) continuam abrindo normalmente e mostram
  "Veículo não informado — agendamento anterior à atualização".
- **Placa:** guardada normalizada (maiúsculas, sem separadores); aceita o formato antigo (`ABC1234`) e o Mercosul (`ABC1D23`);
  única por dona; validada por Zod **e** por `CHECK` no banco. Até 10 veículos por conta.
- **Observações:** texto puro, até 500 caracteres, sem caracteres de controle/direção; ficam num cookie `httpOnly` de 30 min
  entre as etapas (não na URL, para não irem para histórico e logs) e são validadas de novo ao confirmar. Sempre exibidas como
  texto (o React escapa), nunca como HTML.
- **Administração:** a lista de agendamentos mostra veículo e placa e tem **busca por cliente ou placa**; o evento do Google
  Agenda da administração inclui modelo, placa e observações (o link "Salvar no Google Agenda" da cliente **não** leva a placa).

## Reagendamento

`/meus-agendamentos/[id]/reagendar`, só para reserva **confirmada e futura**, dentro da mesma antecedência do cancelamento
(`CLIENT_CANCEL_MIN_HOURS`, padrão 24 h). Roda em `rescheduleOwnBooking` (`src/lib/booking.ts`), **numa transação sob o
`BookingLock`**: revalida expediente, grade de 15 min, horizonte, bloqueios, outras reservas e a agenda do Google (consultada
**antes**, sem rede dentro da transação), ignorando a própria reserva; mantém serviço, preço, duração e veículo; atualiza o
**mesmo** evento do Google (ID determinístico) e grava a auditoria `booking_rescheduled`. É **atômico**: se falhar, o horário
anterior permanece. O evento da própria reserva no Google não conta como "ocupado" (senão deslocar 30 minutos conflitaria com
ela mesma). Coberto por `tests/booking-vehicle-reschedule.test.ts` (inclusive concorrência).

## Recuperação e troca de senha

- **Esqueci minha senha** (`/recuperar-senha`): resposta **idêntica** para qualquer e-mail (a busca da conta e o envio acontecem
  depois da resposta, em `after()`, então nem o tempo revela se a conta existe); limite por e-mail (3 por 15 min) e por IP
  (10, só com `TRUSTED_PROXY_HOPS`).
- **Token:** 32 bytes aleatórios (CSPRNG); no banco fica **só o hash SHA-256**; validade de **30 minutos**; **uso único** (a
  reivindicação é um `UPDATE` condicional, então duas requisições nunca passam as duas); pedir outro link invalida os anteriores;
  nunca aparece em log, auditoria ou tela. O link usa `NEXTAUTH_URL` como base, **nunca** o cabeçalho `Host`.
- **Redefinir** (`/redefinir-senha`): aplica a política de senha, limita as tentativas por IP e por link, troca a senha e **sobe
  `User.sessionVersion`**, o que encerra **todas** as sessões abertas (as sessões conferem a versão no banco em `requireUser`).
- **Troca logada** (`/minha-conta`): exige a **senha atual** (reautenticação), limita tentativas e também encerra as sessões.
  Trocar o **e-mail** da conta **não** está disponível pela tela (exige verificação por e-mail): é uma pendência declarada.
- **E-mail:** `src/lib/mailer.ts`. `MAIL_PROVIDER=none` (padrão) não envia nada, e a recuperação fica inoperante até você
  configurar um provedor, **sem** mostrar o link em lugar nenhum. `MAIL_PROVIDER=resend` usa a API HTTPS do Resend, sem
  dependência nova: defina `RESEND_API_KEY` e `MAIL_FROM` (domínio verificado) e `NEXTAUTH_URL` com o endereço público. Para
  SMTP ou outro provedor, implemente `MailTransport` e registre em `transports`.

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

**Uma só agenda.** O negócio usa uma única conta do Google: as reservas não guardam a qual conta pertencem, então o evento de qualquer reserva vai para a conta conectada. Por isso:
- conectar enquanto **outra** administradora já tem uma conta conectada é recusado ("desconecte a atual antes"); reconectar a própria conta apenas a substitui;
- se mesmo assim existirem duas contas gravadas (dados antigos), o site **não escolhe uma**: novas reservas e sincronizações falham com aviso até alguém clicar em **Desconectar** em `/admin/configuracoes/google` (qualquer administradora pode) e conectar a conta certa;
- quando o Google emite um novo *refresh token*, ele é gravado (cifrado) na conexão; sem um novo, o guardado é mantido;
- **Tentar novamente todas** reenvia até 50 reservas com falha, 3 por vez, sem duplicar eventos.

## Fuso horário e formato

Toda a aplicação trabalha com o fuso `America/Sao_Paulo`: os horários
exibidos, o cálculo de disponibilidade, o expediente e os períodos do
faturamento são todos calculados nesse fuso (os timestamps ficam salvos em
UTC no banco, convertidos nas bordas — veja `src/lib/format.ts`). Datas são
exibidas no padrão brasileiro (`dd/MM/yyyy`, `HH:mm`) e valores em reais
(`Intl.NumberFormat('pt-BR', { currency: 'BRL' })`).

## Prevenção de sobreposição de horários

A prevenção de sobreposição tem **duas camadas**: a **transação com bloqueio** em
`src/lib/booking.ts` (abaixo) e, como segunda garantia no próprio banco, a restrição
`Appointment_no_overlap` do PostgreSQL (veja [PostgreSQL, backup e publicação](#postgresql-backup-e-publicação)).

1. A **criação** e a **reativação** de reservas (voltar uma reserva cancelada para
   confirmada) passam pelo mesmo mecanismo, `runLocked`, dentro de uma transação do Prisma.
2. A primeira instrução da transação é um `UPDATE` em uma linha única
   (`BookingLock`), que trava a linha até o `COMMIT`: as outras transações esperam nela.
3. Só depois disso a disponibilidade do horário é reconferida — se duas
   clientes tentarem reservar o mesmo horário (ou horários que se sobrepõem)
   ao mesmo tempo, a segunda transação fica bloqueada até a primeira
   confirmar, reavalia a disponibilidade já vendo a reserva recém-criada, e é
   corretamente rejeitada com uma mensagem clara.
4. Falhas transitórias (deadlock ou serialização do PostgreSQL) são reexecutadas automaticamente.
5. As regras de horário são **as mesmas ao listar e ao confirmar**: dentro do
   expediente e fora do almoço, alinhado à grade de 15 minutos (a partir do início
   do expediente), com antecedência mínima de 30 minutos e no máximo 60 dias à
   frente, sempre no fuso `America/Sao_Paulo`.
6. Nenhuma chamada de rede acontece dentro da transação: a consulta ao Google
   Agenda é feita **antes** e o resultado é passado para a validação final sob o lock.

Isso está coberto por teste automatizado (duas reservas simultâneas para o
mesmo horário e sobreposição parcial — veja [Testes](#testes-automatizados)).

## Testes automatizados

```bash
npm test
```

Os testes rodam contra um **PostgreSQL real, embutido e descartável** (sem Docker; as mesmas
migrations que vão para o Supabase, recriadas do zero a cada execução — veja `tests/global-setup.ts`),
não contra mocks e **nunca contra o Supabase** (`resetDb()` recusa qualquer banco que não seja local).
Cobertura (364 testes automatizados em 32 arquivos; 42 testes de tela no e2e, nos dois tamanhos de tela):

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
| Veículos: placas (antigo e Mercosul), validação, IDOR, unicidade, limite, snapshot no histórico | `tests/vehicles.test.ts`, `tests/booking-vehicle-reschedule.test.ts` |
| Reagendamento: atômico, concorrência, política de antecedência, evento do Google atualizado sem falso conflito, auditoria sem PII | `tests/booking-vehicle-reschedule.test.ts` |
| Recuperação e troca de senha: token só em hash, uso único (inclusive em paralelo), expiração, sessões encerradas, sem token em log | `tests/password-reset.test.ts` |
| Migração dos dados de manicure: nome exato, idempotente, nada apagado, histórico intacto | `tests/service-migration.test.ts` |
| Busca do painel por cliente e placa | `tests/admin-search.test.ts` |
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
| `npm run db:migrate` | Cria uma NOVA migration a partir de mudanças no schema (desenvolvimento; usa o banco do `.env`) |
| `npm run db:deploy` | Aplica as migrations existentes no banco do `DIRECT_URL` (Supabase), sem gerar novas |
| `npm run db:seed` | Cria a admin, o expediente padrão e os 7 serviços automotivos padrão (só os que faltam) |
| `npm run db:studio` | Interface visual do banco (Prisma Studio) |
| `npm test` | Roda a suíte de testes automatizados |
| `npm run db:check-overlaps` | Relatório somente leitura: sobreposições, situações inválidas, órfãos, clientes acima do limite |
| `npm run db:migrate-services` | Migra os dados de manicure (desativa os serviços antigos pelo nome exato e cadastra os automotivos). `-- --dry-run` só simula |
| `npm run images:optimize -- <pasta>` | Converte as fotos geradas para WebP nos tamanhos finais ([docs/imagens.md](docs/imagens.md)) |
| `npm run storage:setup` | Cria o bucket público `service-images` no Supabase Storage (idempotente; precisa de `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`) ([docs/fotos-servicos.md](docs/fotos-servicos.md)) |
| `npm run storage:cleanup` | Apaga do Storage os arquivos de fotos que ficaram pendentes de remoção |
| `npm run test:e2e` | Testes de tela (Edge, desktop e 390 px; PostgreSQL embutido próprio) |
| `npm run db:backup` · `npm run db:restore` | Backup (`pg_dump`) com retenção · restauração (`pg_restore`) |
| `npm run lint` | ESLint |

## Estrutura do projeto

```
prisma/schema.prisma      Modelos do banco (usuários, veículos, serviços, expediente,
                           bloqueios, agendamentos, recuperação de senha, conta do Google)
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
| Login (falhas), **com** `TRUSTED_PROXY_HOPS` | **IP + e-mail** normalizado (minúsculas, sem espaços, Unicode NFKC) | 5 falhas por par; a 6ª tentativa do par é barrada |
| Login (falhas), **com** `TRUSTED_PROXY_HOPS` | IP | 20 falhas (mais alto: várias clientes podem dividir o mesmo Wi-Fi) |
| Login (falhas), **com** `TRUSTED_PROXY_HOPS` | e-mail, somando todos os IPs | 50 falhas (freia ataque distribuído; só é cobrado de quem passou nos limites do próprio IP) |
| Login (falhas), **sem** `TRUSTED_PROXY_HOPS` | e-mail normalizado | 5 falhas; a 6ª tentativa é barrada |
| Cadastro (tentativas) | e-mail normalizado | 5 tentativas; a 6ª recebe `429` + `Retry-After` |
| Cadastro (tentativas) | IP | 10 tentativas |

- O bloqueio vale para **qualquer** e-mail, exista conta ou não, e é igual para todos.
  Um login correto zera o contador daquele IP + e-mail (ou do e-mail, sem proxy declarado).
- **Terceiros não bloqueiam a dona da conta (com proxy confiável declarado).** Quem erra
  a senha de outra pessoa esgota só o *próprio* par IP + e-mail; a dona, em outra rede,
  continua entrando. Um IP que insiste depois de barrado não gasta o teto por e-mail. Esgotar
  esse teto exige 50 falhas vindas de pelo menos 10 IPs diferentes.
- **Sem `TRUSTED_PROXY_HOPS` não há como separar a dona de um atacante** (cabeçalhos de
  IP do cliente não são confiáveis), então vale o limite só por e-mail: quem sabe o e-mail
  de outra pessoa pode bloqueá-la por até 15 minutos digitando senhas erradas. Atrás de um
  proxy/CDN confiável, declare `TRUSTED_PROXY_HOPS` para eliminar esse efeito.
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
recebido" e usa **Entrar**. O cadastro exige o **consentimento** de uso dos dados (LGPD), conferido também no servidor.
**Risco residual:** sem confirmação por e-mail não há como avisar a dona de um e-mail de que alguém tentou cadastrá-lo, nem
impedir que alguém crie uma conta com e-mail alheio. O fluxo "esqueci minha senha" **existe** (veja "Recuperação e troca de
senha") e a política de senha abaixo vale para o cadastro, a redefinição e a troca (`passwordSchema`); o que **continua faltando**
é o fluxo "confirmar e-mail para ativar a conta" (precisa do provedor de e-mail configurado).

### Logs (trilha de auditoria) — `/admin/logs`

Página só para a administradora (o middleware, o layout do painel, a própria página e a função de consulta
`listAuditLogs` conferem a sessão e o papel **no banco**). Abas: **Cadastro, Login, Logout, Marcação, Ações
administrativas, Integrações**. Mostra data e hora (Brasília), ação, resultado, responsável e registro afetado, do mais
recente para o mais antigo, com 25 linhas por página (máximo 50) e filtros de período (padrão 30 dias, máximo 92),
resultado e usuário (nome, ou e-mail completo). Os registros são **somente leitura**: não existe ação, rota ou tela que os
altere ou apague.

- **Onde está o código:** gravação em `src/lib/audit-log.ts`, leitura em `src/lib/audit-log-read.ts`, vocabulário em
  `src/lib/audit-types.ts`, tabela `AuditLog` (migração `20261116010000_audit_log`, com RLS ligado).
- **Ações de negócio** (reserva criada/cancelada/situação alterada, serviço, expediente, bloqueios, cadastro) são
  gravadas **na mesma transação** da mudança: o registro só existe se a mudança foi confirmada, e uma chave de
  idempotência impede linha duplicada.
- **Eventos que um atacante gera em volume** (login recusado/bloqueado, cadastro repetido/bloqueado, chamada não
  autorizada ao cron, excesso de pedidos de reserva) são **agrupados**: uma linha por (ação, quem, hora) com contador, no
  máximo 50 linhas distintas por ação e hora; o excedente vira uma única linha "agrupada". São gravados **depois** dos
  limites de tentativas, então não os enfraquecem.
- **O que nunca é gravado:** senha, token, cookie, chave, segredo OAuth, corpo de requisição, e-mail, nome e celular.
  Pessoas aparecem só como ID interno (o nome é buscado na hora de exibir) ou, em tentativa sem conta identificada, como
  hash curto do e-mail. O motivo digitado em bloqueios de horário e os textos das Configurações também não entram.
- **Não existe no site** (por isso não há aba nem registro): **Entrada/Saída** (check-in/check-out). A **remarcação** pela cliente existe e aparece em "Marcação"; veículos e dados da conta aparecem em "Cadastro" e a recuperação/troca de senha em "Login", sempre só com IDs internos (nunca placa, nome, e-mail, celular ou token).
  Mudar a situação de uma reserva (concluída, falta...) aparece em "Marcação".
- **Limite do histórico:** o registro começa quando a migração é aplicada. Antes disso só havia linhas JSON no console
  (`securityLog`), que não foram migradas; nada foi reconstruído a partir de dados antigos (não dá para saber quem fez o
  quê). A tabela **não tem expurgo automático** (a política de retenção é uma decisão sua).
- **Ordem de publicação:** aplique `npm run db:deploy` **antes** de subir esta versão: a gravação do log faz parte da
  transação da reserva, então a tabela precisa existir.

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
  mensagem "Não foi possível verificar a agenda da Garage Zero Zero agora. Tente novamente…". Com a
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
| **Bloqueio de login usado contra outra pessoa, SEM proxy confiável declarado.** 5 senhas erradas para um e-mail o bloqueiam por 15 min; repetir a cada 15 min mantém a conta (inclusive a da administradora) bloqueada. Com `TRUSTED_PROXY_HOPS` o bloqueio é por IP + e-mail e o efeito some (veja "Limite por IP e proxy"). | Sem origem confiável não há como distinguir a dona de um atacante. | Declarar o proxy; *backoff* progressivo ou desafio/CAPTCHA para a conta ADMIN; ou liberar a administradora por outro canal. |
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

- **Estratégia:** PostgreSQL (Supabase) é o único banco: um schema (`prisma/schema.prisma`) e um conjunto de migrações (`prisma/migrations`). As migrações incluem a restrição `Appointment_no_overlap` (`EXCLUDE USING gist (tsrange("startAt","endAt",'[)') WITH &&) WHERE status IN ('CONFIRMADA','CONCLUIDA')`), que **recusa sobreposição no próprio banco**, entre processos e instâncias; horários consecutivos são aceitos. Também há `CHECK` de situação, papel, intervalo e valores.
- **RLS (segurança em nível de linha):** o Supabase expõe o schema `public` por uma API REST acessível com a chave `anon`, que é pública. A migração `*_enable_rls` liga o RLS em todas as tabelas, **sem políticas**: a API pública não lê nem grava nada, e o app segue normal porque conecta como `postgres` (dono das tabelas, que ignora o RLS). Toda migração futura que criar tabela deve ligar o RLS também. Testado em `tests/db-constraints.test.ts`.
- **Conexões:** o app usa o *Transaction pooler* (`DATABASE_URL`, `?pgbouncer=true`); migrations e backup usam o *Session pooler* ou *Direct* (`DIRECT_URL`).
- **Backup:** `npm run db:backup` (diário; retenção 14 dias + 6 meses), `npm run db:restore` (recusa sobrescrever sem `--force`). Veja [docs/publicacao.md](docs/publicacao.md) para ordem das operações, verificações e plano de retorno.
- **Testes:** `npm test` roda **toda a suíte** contra um PostgreSQL real e descartável (embutido, sem Docker), incluindo a restrição direta no banco, o RLS, 3 processos Node disputando o mesmo horário e a conferência de que `prisma/migrations` produz exatamente o `prisma/schema.prisma`.
- **Testes de tela:** `npm run test:e2e` (Playwright com o Edge instalado; desktop e 390 px; capturas em `e2e/screenshots/`).
- **Lint:** `npm run lint` (ESLint 9 + config do Next).

## Configurações da empresa, Google Agenda e horários livres

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
