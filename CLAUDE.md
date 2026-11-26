# Garage Zero Zero — guia para o Claude Code

Site de agendamento de estética automotiva (Next.js 15 App Router, Prisma, NextAuth por credenciais). Banco ÚNICO: PostgreSQL no Supabase (região São Paulo); não há mais SQLite. O projeto foi um sistema de manicure e foi transformado em Garage Zero Zero (papéis internos `CLIENTE`/`ADMIN` mantidos). Leia o [README](README.md) para o contexto completo.

## Comandos

| O quê | Comando |
|---|---|
| Servidor de desenvolvimento | `npm run dev` (um só por pasta `.next`) |
| Tipos / lint | `npx tsc --noEmit` · `npm run lint` |
| Testes (PostgreSQL REAL embutido e descartável; nunca toca o Supabase) | `npm test` |
| Aplicar migrações no Supabase (usa `DIRECT_URL`) | `npm run db:deploy` |
| Testes de tela (Edge, desktop + 390 px) | `npm run test:e2e` |
| Dados duplicados/inválidos (somente leitura) | `npm run db:check-overlaps` |
| Migrar dados de manicure (idempotente; `-- --dry-run` simula) | `npm run db:migrate-services` |
| Trocar as fotos (WebP, sem metadados) | `npm run images:optimize -- <pasta>` ([docs/imagens.md](docs/imagens.md)) |
| Criar o bucket das fotos dos serviços / limpar pendências do Storage | `npm run storage:setup` · `npm run storage:cleanup` ([docs/fotos-servicos.md](docs/fotos-servicos.md)) |
| Backup / restauração | `npm run db:backup` · `npm run db:restore` |

## Regras que não podem ser quebradas

- **Veículo é obrigatório em novas reservas, no servidor**, e tem que ser da própria cliente (`createBooking` confere dentro do `runLocked`). A reserva guarda **snapshot** de marca, modelo e placa: editar/apagar o veículo nunca altera o histórico. Reservas antigas sem veículo continuam válidas. Todo acesso a veículo filtra pelo dono da sessão (`src/lib/vehicles.ts`); ID da URL ou do formulário nunca é confiável.
- **Placa:** sempre normalizada (`src/lib/plate.ts`); nunca em log, auditoria ou evento do Google da cliente. Observações da cliente são texto puro (nunca HTML) e não vão na URL.
- **Reagendamento** (`rescheduleOwnBooking`) é atômico, sob o mesmo `BookingLock`, e exclui a própria reserva da disponibilidade (e o evento dela no Google). Falhou = horário anterior mantido.
- **Sessões:** `User.sessionVersion` sobe a cada troca/redefinição de senha; `requireUser` compara com o do JWT. Recuperação de senha: só o hash do token no banco, uso único atômico, link montado de `NEXTAUTH_URL` (nunca de `Host`), resposta sempre genérica.
- **Fotos dos serviços** (`src/lib/service-images.ts`, [docs/fotos-servicos.md](docs/fotos-servicos.md)): até 6 por serviço, a menor `position` é a capa. Bytes no Supabase Storage (bucket público só para leitura, **sem** política de escrita), metadados em `ServiceImage`. Só o servidor escreve, depois do `ADMIN` (rota `/api/admin/servicos/[id]/fotos` e `fotos-actions.ts`). `SUPABASE_SERVICE_ROLE_KEY` nunca vai em `NEXT_PUBLIC_*` nem para o navegador. O tipo vem dos **magic bytes** e da decodificação do `sharp` (nunca de `File.type`/extensão); o nome do arquivo é gerado no servidor (`services/{serviceId}/{uuid}.webp`); toda foto é buscada por `id` **e** `serviceId`. O teto de 6 vale sob `SELECT … FOR UPDATE` na linha do `Service`; nada de rede dentro da transação; remoção que o Storage recusar vai para `StorageCleanup`. Vitrine: `ServiceImageView` (`next/image` + placeholder se faltar ou quebrar).
- **Toda alteração na agenda passa por `runLocked` (`src/lib/booking.ts`)**: criação, reativação, cancelamento e reagendamento. Ele serializa via `BookingLock`. Nenhuma chamada de rede dentro da transação (o Google Agenda é consultado antes).
- **Listar e confirmar horários usam a mesma regra** (`src/lib/availability.ts`): expediente, almoço, grade de 15 min, 30 min de antecedência, 60 dias de horizonte, fuso `America/Sao_Paulo`. **Serviço longo** (mais que o menor turno do dia, ex.: 4 h e 5 h com almoço 12h–13h num expediente 09h–18h) **atravessa o almoço** (`getServiceWindows`): oferece todo início livre de 15 em 15 min dentro do expediente; serviço que cabe nos dois turnos segue a regra do almoço.
- **Validar no servidor**, nunca só na tela: use os schemas de `src/lib/validation.ts` nas Server Actions e rotas. Reserva de outra cliente responde como "não encontrada".
- **Preço e duração são gravados na reserva**; mudar o serviço não altera o histórico.
- **Preço por tipo de veículo** (`src/lib/pricing.ts` = regra pura; `src/lib/pricing-data.ts` = leitura/gravação): a chave `SiteSettings.priceByVehicleType` começa **desligada** (preço padrão do serviço); ligada, vale o preço da categoria do veículo (`ServicePrice`: HATCH, SEDA, SUV, PICAPE, VAN) e **categoria sem preço usa o padrão**. O preço é decidido **só no servidor**: `createBooking` o recalcula sob o `BookingLock` a partir do veículo da cliente e **nunca** usa valor vindo do formulário; `expectedPriceCents` (o que a cliente viu na revisão) só serve de conferência e, se diferir, a reserva é recusada (`BookingPriceChangedError`). A chave e a tabela são lidas **sem cache** (o cache de `getSiteSettings` é só para textos). A reserva grava `priceCents` e `vehicleTypeSnapshot`; mudar a tabela, desligar a chave ou reagendar nunca altera o valor já gravado. `Vehicle.vehicleType` é obrigatório em cadastro/edição, mas nulo em veículo antigo: com a chave ligada, a etapa do veículo pede para completar (`completeVehicleType`).
- **Fluxo de agendamento: serviço → veículo → data e horário → revisão.** As etapas de horário e revisão só abrem com um veículo **da própria cliente** (`resolveBookingVehicle` em `src/lib/booking-vehicle.ts`; ID de outra cliente, apagado ou inventado volta para a etapa do veículo sem revelar nada). Serviço e preferência de dia/hora viajam na URL (`booking-urls.ts` descarta valor inválido); observações, no cookie `httpOnly`.
- **Um só schema e um só conjunto de migrações**: `prisma/schema.prisma` + `prisma/migrations`. A restrição contra sobreposição, os CHECKs e o RLS estão em SQL nas migrações (o Prisma não os modela). **Toda migração que cria tabela deve terminar com `ALTER TABLE "X" ENABLE ROW LEVEL SECURITY;`**: o Supabase expõe o schema `public` por API REST com a chave `anon` pública; sem RLS, qualquer pessoa leria `User`. Nunca use `FORCE ROW LEVEL SECURITY` (derruba o app).
- **Conexões do Supabase**: `DATABASE_URL` = Transaction pooler (6543, `?pgbouncer=true`) para o app; `DIRECT_URL` = Session pooler/Direct (5432) para migrações e backup (o Prisma usa via `directUrl`).
- Políticas configuráveis por ambiente: `MAX_ACTIVE_FUTURE_BOOKINGS` (3), `CLIENT_CANCEL_MIN_HOURS` (24), `TRUSTED_PROXY_HOPS` (limite por IP só atrás de proxy confiável).

## Armadilhas conhecidas

- **Nunca rode dois `next dev`/`next build` na mesma pasta `.next`**: o manifesto de rotas corrompe e `/meus-agendamentos` vira 404. Para um segundo servidor use `NEXT_DIST_DIR=.next-teste`. Para consertar: pare tudo, apague só `.next`, rode `npm run dev` uma vez.
- **Barras invertidas em scripts de shell/heredoc são consumidas** (já causou um bug de regex `\d` virar `d`). Para regex e edições com `\`, use a ferramenta de edição de arquivos, não `node -e`/`sed` dentro do shell.
- Não leia nem imprima `.env` ou bancos `*.db` em relatórios. Os testes e o e2e usam PostgreSQL embutido e descartável em `127.0.0.1` (portas 54330 e 54331); `resetDb()` recusa rodar contra qualquer outro host.
- Depois de mudar `prisma/schema.prisma`, rode `npx prisma generate` (pare o `npm run dev` antes: no Windows ele trava a DLL do motor do Prisma e dá EPERM).
- `ECC/` (repositório de terceiros, não rastreado) está excluída do `tsconfig.json`, então `tsc` e `next build` funcionam. O `eslint .` ainda a varre (a config está protegida por hook): use `npx eslint src tests e2e scripts` ou adicione `ECC/**` aos `ignores` você mesmo.
- **Componentes de cliente (`"use client"`) não podem importar componentes de servidor que usam `session`/`prisma`** (erro `node:crypto`/`node:net` no build). `AuthShell` usa o `SiteHeader` de cliente por isso; páginas de servidor usam `PublicHeader`. Constantes usadas em telas ficam em módulos sem dependências (`src/lib/limits.ts`), para não levar o Zod ao navegador.
- Arquivos `"use server"` só podem exportar funções assíncronas (constantes ficam em outro módulo, ex.: `password-reset-text.ts`).
- Cores: use os tokens (`ink`, `surface`, `brand`, `fg`, `line`) de `src/lib/theme.ts`; amarelo só em CTAs, selecionados, filetes e destaques. Texto sobre fundo amarelo é preto (`text-ink`).


## 🔐 Security Skill Active

This project uses security-skill for automated security engineering.

**At the start of every session:**
1. Read `.skills/security/skill.md` — security engineering instructions (25 categories)
2. Read `memory-security.md` — project security state and history
3. Be ready for: `/security-scan`, `/security-audit`, `/security-fix`, `/security-status`, `/security-incident`

You are acting as both a developer assistant AND a security engineer.
Proactively flag security issues in all code you write or review.
