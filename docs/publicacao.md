# Roteiro de publicação e plano de retorno

O banco é **um só: PostgreSQL no Supabase (região São Paulo, `sa-east-1`)**. Este roteiro **não foi executado em produção** (nem contra o seu Supabase): o que foi ensaiado de verdade (✅) rodou num PostgreSQL embutido e descartável, com as mesmas migrações. As etapas marcadas ⏳ dependem de infraestrutura que só você tem (projeto Supabase, hospedagem, domínio HTTPS, credenciais do Google).

## 0. Pré-requisitos

| Item | Estado |
|---|---|
| Projeto Supabase em **São Paulo** ⏳ | a região não muda depois de criada. Use **um segundo projeto** para desenvolvimento: `npm run dev` e o seed gravam de verdade no banco do `.env` |
| Hospedagem do app **na mesma região** (São Paulo) ⏳ | app e banco longe um do outro deixam cada reserva lenta (cada operação faz várias idas ao banco) |
| Servidor Node ≥ 20.9 com HTTPS e domínio ⏳ | definir `NEXTAUTH_URL=https://...` (liga HSTS e `upgrade-insecure-requests`) |
| Strings de conexão (Supabase > **Connect**) ⏳ | `DATABASE_URL` = *Transaction pooler* (6543, `?pgbouncer=true`); `DIRECT_URL` = *Session pooler* ou *Direct* (5432) |
| `pg_dump` e `pg_restore` na máquina de backup ⏳ | versão igual ou maior que a do Postgres do Supabase; defina `PG_BIN_DIR` se não estiverem no PATH |
| Segredos novos de produção ⏳ | `NEXTAUTH_SECRET`, `TOKEN_ENCRYPTION_KEY` (guarde uma cópia: sem ela os tokens do Google ficam ilegíveis), senha forte da administradora |
| Proxy confiável? | se sim, `TRUSTED_PROXY_HOPS=1` (limite de login por IP + e-mail) |

O app **não** usa as chaves `anon` nem `service_role` do Supabase: só a conexão Postgres.

## 1. Antes de publicar (ensaio) ✅

```bash
npm ci
npx tsc --noEmit && npm run lint
npm test            # PostgreSQL real embutido: todas as regras, restrições do banco, RLS e migrações == schema
npm run test:e2e    # testes de tela (Edge), também com PostgreSQL embutido próprio
```

## 2. Primeira publicação (ordem das operações) ⏳

1. **Colocar as variáveis** no ambiente do app e no `.env` local de quem vai rodar as migrações (modelo: `.env.example`).
2. **Criar as tabelas, restrições e RLS** no Supabase (usa `DIRECT_URL`, não o pooler de transação):
   ```bash
   npm run db:deploy
   ```
   Isso aplica `prisma/migrations`: tabelas, a restrição `Appointment_no_overlap`, os CHECKs e o **RLS** em todas as tabelas.
3. **Conferir o RLS** (Supabase > SQL Editor). Deve devolver **zero linhas**:
   ```sql
   SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;
   ```
   E em **Advisors > Security** não deve haver aviso de "RLS disabled".
4. **Criar a administradora e os dados iniciais**: `npm run db:seed` (só cria; nunca promove nem altera conta existente). Depois **apague `ADMIN_PASSWORD` do `.env`**.
5. **Verificações**: `npm run db:check-overlaps` ("Nenhum problema"); entrar como administradora e como cliente de teste; tentar reservar o mesmo horário em duas abas ao mesmo tempo (uma deve recusar com mensagem clara).
6. **Subir a aplicação**: `npm run build && npm start` (ou o deploy da hospedagem). O cliente do Prisma é gerado no `npm ci`/`npm install` (postinstall do `@prisma/client`); se a hospedagem pular essa etapa, rode `npx prisma generate` antes do build.
7. **Ligar o backup diário** (seção 4) e fazer o primeiro backup manual.
8. **Google Agenda** (se for usar): criar credenciais OAuth, cadastrar `GOOGLE_REDIRECT_URI` = `https://SEU-DOMINIO/api/google/callback`, conectar pelo painel e rodar o roteiro da seção 5.

### Mudanças de schema depois

`npm run db:migrate` (desenvolvimento, contra o projeto Supabase **de desenvolvimento**) gera a migração; revise o SQL, **acrescente `ENABLE ROW LEVEL SECURITY` para toda tabela nova** e rode `npm test` (ele confere que as migrações produzem exatamente o schema). Em produção, só `npm run db:deploy`. Migrações são só para frente.

## 3. Plano de retorno (rollback)

| Quando | O que fazer |
|---|---|
| Falha **antes** do passo 6 | Nada foi ao ar. O banco novo pode ser apagado (ou o projeto Supabase recriado) e o roteiro refeito. |
| Falha no **app** depois de publicar | Volte o deploy anterior do app. Migrações são só para frente: uma migração já aplicada não é desfeita sozinha, então prefira migrações compatíveis com a versão anterior do app. |
| **Dados** corrompidos ou apagados | Restaure o último backup válido (seção 4) em um banco NOVO, confira e só então aponte o app para ele. O Supabase também oferece backups/PITR conforme o plano contratado. |

## 4. Backup diário, retenção e restauração

- **O que roda:** `npm run db:backup` (usa `DIRECT_URL`; o `pg_dump` **não** funciona pelo pooler de transação). Gera `pg_dump --format=custom` só do schema `public` e confere com `pg_restore --list` ⏳ (código pronto e coberto por testes de falha/segredo; **não executado** nesta máquina por falta de `pg_dump`).
- **Retenção:** 1 backup por dia nos últimos **14 dias** + 1 por mês nos últimos **6 meses** (`BACKUP_KEEP_DAILY`, `BACKUP_KEEP_MONTHLY`). Só apaga arquivos `agenda-AAAAMMDD-HHMMSS.*`; nunca o mais recente ✅.
- **Onde:** `BACKUP_DIR` (padrão `./backups`). Copie também para **fora do servidor** (outro disco ou armazenamento na nuvem). O backup contém hashes de senha, nomes e celulares: guarde com acesso restrito.
- **Agendar uma vez por dia** (exemplo Windows, 03:00): `schtasks /Create /SC DAILY /ST 03:00 /TN "BackupAgenda" /TR "cmd /c cd /d C:\caminho\do\site && npm run db:backup"`. No Linux: `0 3 * * * cd /srv/agenda && npm run db:backup >> backups/backup.log 2>&1`.
- **Restaurar (sempre em um banco NOVO primeiro):**
  ```bash
  npx tsx scripts/restore.ts backups/agenda-AAAAMMDD-HHMMSS.dump --target "postgresql://.../banco_novo"
  ```
  Recusa restaurar sobre o banco em uso sem `--allow-live`. Depois confira com `npm run db:check-overlaps` apontando `DATABASE_URL` para o banco restaurado e abra o site contra ele.
- **Teste de restauração:** repita a restauração em um banco de teste **a cada mês**; backup nunca testado não conta como backup.

## 5. Roteiro do teste real do Google Agenda ⏳

1. Google Cloud Console → criar projeto → ativar **Google Calendar API** → tela de consentimento (externo, modo teste, adicione a sua conta) → credenciais **ID do cliente OAuth** (aplicativo Web) com URI de redirecionamento `http://localhost:3000/api/google/callback`.
2. No `.env` **de teste**: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI=http://localhost:3000/api/google/callback`.
3. Use uma **agenda dedicada** de teste. No painel → Google Agenda → Conectar.
4. Verificar: reservar (evento aparece com nome da cliente) · cancelar pela cliente e pela administradora (evento some) · reativar (evento volta, sem duplicar) · criar um compromisso pessoal no Google no mesmo horário (o horário deixa de ser oferecido) · desligar a internet/revogar o acesso e tentar reservar (mensagem "tente novamente", nenhuma reserva criada).
