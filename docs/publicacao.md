# Roteiro de publicação e plano de retorno

Este roteiro **não foi executado em produção**. As etapas marcadas ✅ foram ensaiadas em banco de teste neste repositório; as marcadas ⏳ dependem de infraestrutura que ainda não existe (servidor, PostgreSQL gerenciado, domínio HTTPS, credenciais do Google).

## 0. Pré-requisitos

| Item | Estado |
|---|---|
| Servidor Node ≥ 20.9 com HTTPS e domínio ⏳ | definir `NEXTAUTH_URL=https://...` (liga HSTS e `upgrade-insecure-requests`) |
| PostgreSQL ≥ 14 (gerenciado ou próprio) ⏳ | usuário com permissão de criar tabelas e restrições (não precisa de superusuário nem de extensões) |
| `pg_dump` e `pg_restore` na máquina de backup ⏳ | defina `PG_BIN_DIR` se não estiverem no PATH |
| Segredos novos de produção ⏳ | `NEXTAUTH_SECRET`, `TOKEN_ENCRYPTION_KEY` (a **mesma** chave se migrar tokens do Google), senha forte da administradora |
| Proxy confiável? | se sim, `TRUSTED_PROXY_HOPS=1` (limite de tentativas por IP) |

## 1. Antes do dia da migração (ensaio) ✅

```bash
npm ci
npx tsc --noEmit && npm run lint && npm test          # SQLite
npm run test:pg                                       # PostgreSQL real (embutido)
npm run db:check-overlaps                             # dados limpos? (somente leitura)
npm run db:rehearse-pg                                # migração completa numa cópia, em PostgreSQL descartável
```

Se `db:check-overlaps` listar problemas, **pare** e sanere (cancele pelo painel as reservas que não devem prevalecer; nada é apagado). A migração também se recusa a rodar com dados incompatíveis.

## 2. Dia da migração (ordem das operações)

1. **Congelar** o site antigo (página de manutenção ou parar o processo) para não entrar reserva nova.
2. **Backup do SQLite** e guardar fora do servidor: `npm run db:backup` (gera `backups/agenda-AAAAMMDD-HHMMSS.sqlite`, já verificado por `PRAGMA integrity_check`) ✅.
3. **Preparar o PostgreSQL vazio**:
   ```bash
   npm run db:pg:generate                                        # gera o cliente PostgreSQL
   DATABASE_URL="postgresql://..." npm run db:pg:deploy          # tabelas + restrição Appointment_no_overlap + CHECKs
   ```
4. **Migrar os dados** (para com relatório se houver conflito; copia numa transação; confere contagens e hash):
   ```bash
   npx tsx scripts/migrate-sqlite-to-postgres.ts --source file:./prisma/dev.db --target "postgresql://..." --dry-run   # só verifica
   npx tsx scripts/migrate-sqlite-to-postgres.ts --source file:./prisma/dev.db --target "postgresql://..."
   ```
   Códigos de saída: `0` ok · `2` dados incompatíveis (relatório) · `3` destino não preparado/não vazio · `4` verificação falhou (nada gravado).
5. **Verificações pós-migração**:
   - `DATABASE_URL="postgresql://..." npm run db:check-overlaps` → "Nenhum problema".
   - Contagens de usuárias/serviços/reservas iguais às do relatório da migração.
   - Entrar como administradora e como uma cliente de teste; abrir "Agendamentos", "Faturamento" e "Meus agendamentos".
   - Tentar reservar o mesmo horário em duas abas ao mesmo tempo (uma deve recusar com mensagem clara).
6. **Subir a aplicação** apontando para o PostgreSQL (`DATABASE_URL` novo, `npm run db:pg:generate && npm run build && npm start`).
7. **Ligar o backup diário** (seção 4) e fazer o primeiro backup manual.
8. **Google Agenda** (se for usar) ⏳: criar credenciais OAuth, cadastrar `GOOGLE_REDIRECT_URI` = `https://SEU-DOMINIO/api/google/callback`, conectar pelo painel e rodar o roteiro da seção 5.

## 3. Plano de retorno (rollback)

| Quando | O que fazer |
|---|---|
| Falha **antes** do passo 6 | Nada mudou no site antigo: descongele-o. O PostgreSQL novo pode ser apagado e a migração refeita. |
| Falha **depois** do passo 6, nas primeiras horas | Pare o site novo, volte `DATABASE_URL` para o SQLite e reinicie o site antigo. **Reservas feitas no PostgreSQL depois da virada não existem no SQLite**: exporte-as antes (consulta em `Appointment` por `createdAt` > horário da virada) e recadastre no antigo. |
| Dados corrompidos | Restaurar o último backup válido (seção 4) em um banco novo, conferir e só então apontar a aplicação. |

Mantenha o SQLite original **intacto e somente leitura por pelo menos 14 dias** após a virada.

## 4. Backup diário, retenção e restauração

- **O que roda:** `npm run db:backup` (usa `DATABASE_URL`). SQLite → arquivo `.sqlite` consistente (`VACUUM INTO`) conferido por integridade ✅. PostgreSQL → `pg_dump --format=custom` conferido por `pg_restore --list` ⏳ (código pronto; **não executado** nesta máquina por falta de `pg_dump`).
- **Retenção:** 1 backup por dia nos últimos **14 dias** + 1 por mês nos últimos **6 meses** (`BACKUP_KEEP_DAILY`, `BACKUP_KEEP_MONTHLY`). Só apaga arquivos `agenda-AAAAMMDD-HHMMSS.*`; nunca o mais recente ✅.
- **Onde:** `BACKUP_DIR` (padrão `./backups`). Copie também para **fora do servidor** (outro disco ou armazenamento na nuvem); backup no mesmo disco não protege contra perda do disco.
- **Agendar uma vez por dia** (exemplo Windows, 03:00): `schtasks /Create /SC DAILY /ST 03:00 /TN "BackupAgenda" /TR "cmd /c cd /d C:\caminho\do\site && npm run db:backup"`. No Linux: `0 3 * * * cd /srv/agenda && npm run db:backup >> backups/backup.log 2>&1`.
- **Restaurar (sempre em um banco NOVO primeiro):**
  ```bash
  npx tsx scripts/restore.ts backups/agenda-AAAAMMDD-HHMMSS.sqlite --target file:C:/temp/restaurado.db     # SQLite ✅ (recusa sobrescrever sem --force)
  npx tsx scripts/restore.ts backups/agenda-....dump --target "postgresql://.../banco_novo"                # PostgreSQL ⏳
  ```
  Depois confira com `npm run db:check-overlaps` apontando `DATABASE_URL` para o banco restaurado e abra o site contra ele.
- **Teste de restauração:** repita a restauração em um banco de teste **a cada mês**; backup nunca testado não conta como backup.

## 5. Roteiro do teste real do Google Agenda ⏳

1. Google Cloud Console → criar projeto → ativar **Google Calendar API** → tela de consentimento (externo, modo teste, adicione a sua conta) → credenciais **ID do cliente OAuth** (aplicativo Web) com URI de redirecionamento `http://localhost:3000/api/google/callback`.
2. No `.env` **de teste**: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI=http://localhost:3000/api/google/callback`.
3. Use uma **agenda dedicada** de teste. No painel → Google Agenda → Conectar.
4. Verificar: reservar (evento aparece com nome da cliente) · cancelar pela cliente e pela administradora (evento some) · reativar (evento volta, sem duplicar) · criar um compromisso pessoal no Google no mesmo horário (o horário deixa de ser oferecido) · desligar a internet/revogar o acesso e tentar reservar (mensagem "tente novamente", nenhuma reserva criada).
5. Só marque como "validado com Google real" depois de cumprir os cinco itens.
