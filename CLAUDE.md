# Agendamento Studio de Manicure — guia para o Claude Code

Site de agendamento (Next.js 15 App Router, Prisma, NextAuth por credenciais). Banco ÚNICO: PostgreSQL no Supabase (região São Paulo); não há mais SQLite. Leia o [README](README.md) para o contexto completo.

## Comandos

| O quê | Comando |
|---|---|
| Servidor de desenvolvimento | `npm run dev` (um só por pasta `.next`) |
| Tipos / lint | `npx tsc --noEmit` · `npm run lint` |
| Testes (PostgreSQL REAL embutido e descartável; nunca toca o Supabase) | `npm test` |
| Aplicar migrações no Supabase (usa `DIRECT_URL`) | `npm run db:deploy` |
| Testes de tela (Edge, desktop + 390 px) | `npm run test:e2e` |
| Dados duplicados/inválidos (somente leitura) | `npm run db:check-overlaps` |
| Backup / restauração | `npm run db:backup` · `npm run db:restore` |

## Regras que não podem ser quebradas

- **Toda alteração na agenda passa por `runLocked` (`src/lib/booking.ts`)**: criação, reativação e cancelamento. Ele serializa via `BookingLock`. Nenhuma chamada de rede dentro da transação (o Google Agenda é consultado antes).
- **Listar e confirmar horários usam a mesma regra** (`src/lib/availability.ts`): expediente, almoço, grade de 15 min, 30 min de antecedência, 60 dias de horizonte, fuso `America/Sao_Paulo`.
- **Validar no servidor**, nunca só na tela: use os schemas de `src/lib/validation.ts` nas Server Actions e rotas. Reserva de outra cliente responde como "não encontrada".
- **Preço e duração são gravados na reserva**; mudar o serviço não altera o histórico.
- **Um só schema e um só conjunto de migrações**: `prisma/schema.prisma` + `prisma/migrations`. A restrição contra sobreposição, os CHECKs e o RLS estão em SQL nas migrações (o Prisma não os modela). **Toda migração que cria tabela deve terminar com `ALTER TABLE "X" ENABLE ROW LEVEL SECURITY;`**: o Supabase expõe o schema `public` por API REST com a chave `anon` pública; sem RLS, qualquer pessoa leria `User`. Nunca use `FORCE ROW LEVEL SECURITY` (derruba o app).
- **Conexões do Supabase**: `DATABASE_URL` = Transaction pooler (6543, `?pgbouncer=true`) para o app; `DIRECT_URL` = Session pooler/Direct (5432) para migrações e backup (o Prisma usa via `directUrl`).
- Políticas configuráveis por ambiente: `MAX_ACTIVE_FUTURE_BOOKINGS` (3), `CLIENT_CANCEL_MIN_HOURS` (24), `TRUSTED_PROXY_HOPS` (limite por IP só atrás de proxy confiável).

## Armadilhas conhecidas

- **Nunca rode dois `next dev`/`next build` na mesma pasta `.next`**: o manifesto de rotas corrompe e `/meus-agendamentos` vira 404. Para um segundo servidor use `NEXT_DIST_DIR=.next-teste`. Para consertar: pare tudo, apague só `.next`, rode `npm run dev` uma vez.
- **Barras invertidas em scripts de shell/heredoc são consumidas** (já causou um bug de regex `\d` virar `d`). Para regex e edições com `\`, use a ferramenta de edição de arquivos, não `node -e`/`sed` dentro do shell.
- Não leia nem imprima `.env` ou bancos `*.db` em relatórios. Os testes e o e2e usam PostgreSQL embutido e descartável em `127.0.0.1` (portas 54330 e 54331); `resetDb()` recusa rodar contra qualquer outro host.
- Depois de mudar `prisma/schema.prisma`, rode `npx prisma generate` (pare o `npm run dev` antes: no Windows ele trava a DLL do motor do Prisma e dá EPERM).
- `next build` faz checagem de tipos em tudo, inclusive na pasta `ECC/` (repositório de terceiros, não rastreado), e falha por dependências que ela não tem. Para o e2e sem a `ECC/`, rode numa cópia do projeto sem ela.


## 🔐 Security Skill Active

This project uses security-skill for automated security engineering.

**At the start of every session:**
1. Read `.skills/security/skill.md` — security engineering instructions (25 categories)
2. Read `memory-security.md` — project security state and history
3. Be ready for: `/security-scan`, `/security-audit`, `/security-fix`, `/security-status`, `/security-incident`

You are acting as both a developer assistant AND a security engineer.
Proactively flag security issues in all code you write or review.
