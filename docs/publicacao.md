# Roteiro de publicação e plano de retorno

O banco é **um só: PostgreSQL no Supabase (região São Paulo, `sa-east-1`)**. Este roteiro **não foi executado em produção** (nem contra o seu Supabase): o que foi ensaiado de verdade (✅) rodou num PostgreSQL embutido e descartável, com as mesmas migrações. As etapas marcadas ⏳ dependem de infraestrutura que só você tem (projeto Supabase, hospedagem, domínio HTTPS, credenciais do Google).

## 0. Pré-requisitos

| Item | Estado |
|---|---|
| Projeto Supabase em **São Paulo** ⏳ | a região não muda depois de criada. Use **um segundo projeto** para desenvolvimento: `npm run dev` e o seed gravam de verdade no banco do `.env` |
| Hospedagem do app **na mesma região** (São Paulo) ⏳ | app e banco longe um do outro deixam cada reserva lenta (cada operação faz várias idas ao banco) |
| Node.js **24.x** com HTTPS e domínio ⏳ | a versão está fixada em `package.json`; definir `NEXTAUTH_URL=https://...` (liga HSTS e `upgrade-insecure-requests`) |
| Strings de conexão (Supabase > **Connect**) ⏳ | `DATABASE_URL` = *Transaction pooler* (6543, `?pgbouncer=true`); `DIRECT_URL` = *Session pooler* ou *Direct* (5432) |
| `pg_dump` e `pg_restore` na máquina de backup ⏳ | versão igual ou maior que a do Postgres do Supabase; defina `PG_BIN_DIR` se não estiverem no PATH |
| Segredos novos de produção ⏳ | `NEXTAUTH_SECRET`, `TOKEN_ENCRYPTION_KEY` (guarde uma cópia: sem ela os tokens do Google ficam ilegíveis), senha forte da administradora |
| Proxy confiável? | se sim, `TRUSTED_PROXY_HOPS=1` (limite de login por IP + e-mail, **e da recuperação de senha por IP**) |
| E-mail transacional (recuperação de senha) ⏳ | `MAIL_PROVIDER=resend`, `RESEND_API_KEY` e `MAIL_FROM` (domínio verificado no Resend). **Sem isto a recuperação de senha não envia nada** (e nunca mostra o link). `NEXTAUTH_URL` precisa ser o endereço público: o link do e-mail é montado a partir dele |
| Fotos dos serviços (Supabase Storage) ⏳ | defina `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` **só no servidor** (nunca `NEXT_PUBLIC_*`), rode `npm run db:deploy` (migração `20261119000000_service_images`) e `npm run storage:setup` (cria o bucket público `service-images`). Sem isso o painel avisa e o site usa os placeholders. Veja [fotos-servicos.md](fotos-servicos.md) |
| Logo e fotos ⏳ | a logo oficial já está em `public/brand/logo.svg`. As fotos são placeholders: troque-as seguindo [imagens.md](imagens.md) (`npm run images:optimize`) |

O app não usa a chave `anon` do Supabase. A chave `service_role` é opcional e usada **somente no servidor** para
gerenciar as fotos dos serviços no Storage; o restante da aplicação acessa os dados pela conexão PostgreSQL.

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
6. **Subir a aplicação**: `npm run build && npm start` (ou o deploy da hospedagem). O script `postinstall` do projeto
   executa `prisma generate`, inclusive em instalações limpas e no cache de dependências da Vercel.
7. **Ligar o backup diário** (seção 4) e fazer o primeiro backup manual.
8. **Google Agenda** (se for usar): criar credenciais OAuth, cadastrar `GOOGLE_REDIRECT_URI` = `https://SEU-DOMINIO/api/google/callback`, conectar pelo painel e rodar o roteiro da seção 5.

### Publicação na Vercel

O repositório inclui `vercel.json` com a região `gru1` (São Paulo), próxima ao Supabase `sa-east-1`. O `package.json`
fixa Node.js 24.x e gera o Prisma Client no `postinstall`; não altere o Build Command padrão detectado para Next.js.

Antes do primeiro deploy, cadastre em **Project → Settings → Environment Variables**, no ambiente **Production**:

- obrigatórias: `DATABASE_URL`, `DIRECT_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL` e `TOKEN_ENCRYPTION_KEY`;
- administração inicial: `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PHONE` e `ADMIN_PASSWORD` apenas até executar o seed;
- opcionais: credenciais do Google, Resend e Supabase Storage descritas em `.env.example`.

Use `DATABASE_URL` com o Transaction Pooler e `DIRECT_URL` com o Session Pooler/Direct. Marque URLs, senhas, tokens e
chaves como **Secret**; nunca use prefixo `NEXT_PUBLIC_`. Depois de aplicar as migrations e o seed, remova `ADMIN_PASSWORD`
da Vercel. Alterações de variáveis só chegam a um deployment novo, portanto faça um redeploy depois de cadastrá-las.

Na Vercel o temporizador interno da fila do Google é desativado automaticamente, pois instâncias serverless não são
processos permanentes. Se usar Google Agenda, configure `CRON_SECRET` forte e um Vercel Cron (ou agendador externo) para
`GET /api/cron/google-sync` a cada 5 minutos, enviando `Authorization: Bearer <CRON_SECRET>`.

### Banco que já era o sistema de manicure (atualização) ⏳

A migração `20261118000000_garage_zero_zero` é **só aditiva** (nada é apagado ou reescrito): cria `Vehicle` e `PasswordResetToken`
(com RLS ligado), acrescenta colunas opcionais em `Appointment` (veículo, snapshots, observações) e `User.sessionVersion`. Ordem:

1. **Backup** (seção 4) e, de preferência, ensaio num banco restaurado.
2. `npm run db:deploy` — **antes** de subir o código novo (o código novo lê as colunas novas).
3. `npm run db:migrate-services -- --dry-run`, conferir a lista, e depois `npm run db:migrate-services`. Desativa os 5 serviços de
   manicure pelo **nome exato** e cadastra os 7 automotivos que faltam; **não altera reservas** nem serviços personalizados.
   Idempotente. Se quiser reativar algum serviço antigo, é só ativá-lo em `/admin/servicos`.
4. Subir o código novo. Reservas antigas continuam abrindo ("Veículo não informado — agendamento anterior à atualização"), e as
   sessões já abertas continuam valendo (tokens antigos contam como `sessionVersion` 0).
5. Em `/admin/configuracoes`, conferir nome, slogan, contatos e endereço (os textos que ainda eram os padrões de manicure foram
   restaurados ao padrão novo; o que você tinha personalizado ficou).

**Retorno:** como a migração é aditiva, voltar o app para a versão anterior continua funcionando com o banco novo (as colunas novas
são ignoradas). Os serviços desativados voltam a ser oferecidos reativando-os no painel.

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
4. Verificar: reservar (evento aparece com o nome da cliente, **o modelo e a placa do veículo** e as observações) · **reagendar pela cliente** (o MESMO evento muda de horário, sem duplicar, inclusive ao deslocar só 30 minutos) · cancelar pela cliente e pela administradora (evento some) · reativar (evento volta, sem duplicar) · criar um compromisso pessoal no Google no mesmo horário (o horário deixa de ser oferecido) · desligar a internet/revogar o acesso e tentar reservar (mensagem "tente novamente", nenhuma reserva criada).

## 6. Roteiro de verificação da recuperação de senha ⏳

Depende do provedor de e-mail configurado (`MAIL_PROVIDER=resend`). Use uma conta de teste:

1. `/recuperar-senha` com o e-mail da conta e com um e-mail que **não** existe: a mensagem na tela deve ser **idêntica**.
2. O e-mail chega, com um link `https://SEU-DOMINIO/redefinir-senha?token=...` válido por 30 minutos.
3. Pedir outro link: o primeiro deixa de funcionar. Usar o link novo: define a senha e leva ao login; usá-lo **de novo** é recusado.
4. Com a conta aberta em outro navegador, redefinir a senha: a sessão antiga deve ser encerrada na próxima ação.
5. Conferir que **nenhum log** do servidor contém o link ou o token (a auditoria em `/admin/logs` mostra só o evento, sem e-mail).
