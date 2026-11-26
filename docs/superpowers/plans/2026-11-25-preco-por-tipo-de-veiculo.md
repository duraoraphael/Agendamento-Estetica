# Preço por tipo de veículo — plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar tarefa a tarefa. Os passos usam caixas `- [ ]`.

**Objetivo:** o dono liga "Cobrar por tipo de veículo" e passa a ter preço por categoria em cada serviço; o preço é calculado no servidor a partir do veículo da cliente e gravado na reserva.

**Arquitetura:** um módulo puro (`src/lib/pricing.ts`) decide o preço; uma camada de dados (`src/lib/pricing-data.ts`) lê a chave e a tabela de preços sem cache. `createBooking` recalcula o preço sob o `BookingLock`. O fluxo vira serviço → veículo → horário → revisão, e as etapas de horário e revisão exigem um veículo da própria cliente.

**Tecnologias:** Next.js 15 (App Router, Server Actions), Prisma/PostgreSQL, Zod, Vitest (PostgreSQL embutido), Playwright (Edge).

**Spec:** `docs/superpowers/specs/2026-11-25-preco-por-tipo-de-veiculo-design.md`

## Restrições globais

- Migração **aditiva**; tabela nova termina com `ALTER TABLE "X" ENABLE ROW LEVEL SECURITY;` (nunca `FORCE`). Nome: `prisma/migrations/20261125000000_vehicle_type_pricing/migration.sql` (depois de `20261124000000_google_client_login`). Schema e migração têm que ficar equivalentes (teste de equivalência existente).
- Categorias fixas, valor gravado → rótulo: `HATCH` Hatch, `SEDA` Sedã, `SUV` SUV, `PICAPE` Picape, `VAN` Van/Utilitário.
- `SiteSettings.priceByVehicleType` começa `false`. Chave desligada: preço padrão do serviço; categoria sem preço: preço padrão.
- Preço **nunca** vem do formulário: sempre recalculado no servidor. Veículo sempre filtrado pela dona da sessão (`src/lib/vehicles.ts`); ID da URL nunca é confiável.
- A chave e a tabela de preços são lidas **direto do banco, sem cache** (`getSiteSettings` tem cache de 5 min e não serve para decidir preço).
- Reserva só por `runLocked`; nenhuma rede dentro da transação. Reagendamento não recalcula preço.
- Placa nunca em log, auditoria ou evento do Google. Observações continuam no cookie `gzz_notes` (nunca na URL).
- Arquivos `"use server"` só exportam funções assíncronas; constantes de tela ficam em módulo sem dependências de servidor (`pricing.ts` não importa `prisma`).
- Textos da interface em português do Brasil. Cores só pelos tokens de `src/lib/theme.ts`.
- **Sem commits** neste plano: o usuário não pediu e a árvore tem trabalho do login Google ainda sem commit. O ponto de verificação de cada tarefa é `npx tsc --noEmit` + os testes citados.
- Depois de mudar `prisma/schema.prisma`: parar o `npm run dev` e rodar `npx prisma generate`.

## Foco da revisão

1. Formulário adulterado: `expectedPriceCents` ou `vehicleId` forjados → reserva recusada, nada criada (Tarefa 4).
2. Admin muda a tabela entre a revisão e a confirmação → cliente é avisada do novo valor e nada é gravado com o valor antigo (Tarefa 4).
3. Chave desligada com preços por categoria já salvos → reservas novas usam o preço padrão; ao religar, os valores voltam (Tarefas 4 e 5).
4. Veículo de outra cliente ou apagado em URL direta de `/agendar/horario` e `/agendar/revisar` → volta à etapa de veículo, sem revelar nada do veículo (Tarefas 6 e 9).
5. `vehicleType` fora da lista (formulário ou banco) → recusado pelo Zod e pelo CHECK (Tarefas 2 e 3).

---

### Tarefa 1: Regras de preço (módulo puro)

**Arquivos:**
- Criar: `src/lib/pricing.ts`
- Teste: `tests/pricing.test.ts`

**Interfaces:**
- Produz (exportações de `src/lib/pricing.ts`, sem importar `prisma`):
  - `VEHICLE_TYPES = ["HATCH","SEDA","SUV","PICAPE","VAN"] as const`; `type VehicleType`; `VEHICLE_TYPE_LABELS: Record<VehicleType,string>`; `isVehicleType(v: unknown): v is VehicleType`.
  - `type PriceTable = Partial<Record<VehicleType, number>>` (centavos).
  - `type PriceResolution = { status: "ok"; cents: number; source: "default" | "type" } | { status: "needs-type" }`.
  - `resolvePrice(o: { enabled: boolean; defaultCents: number; table: PriceTable; vehicleType: string | null | undefined }): PriceResolution`.
  - `lowestPrice(o: { enabled: boolean; defaultCents: number; table: PriceTable }): { cents: number; varies: boolean }`.
  - `priceLabel(o: { enabled: boolean; defaultCents: number; table: PriceTable }): { text: string; prefix: string | null }` — `prefix` = `"A partir de"` quando `lowestPrice(...).varies`, senão `null`; `text` = `formatCents(cents)` (importado de `src/lib/format.ts`; conferir que esse módulo não puxa dependências de servidor).
  - `parseReaisToCents(raw: string): number | null` (aceita `"40,00"`, `"40.5"`, `"40"`; `null` se vazio, negativo, não numérico ou acima de R$ 1.000.000,00).

- [ ] **Passo 1: escrever os testes que falham** em `tests/pricing.test.ts` (Vitest, sem banco), com estas asserções:
  - `resolvePrice` com `enabled:false`, `vehicleType:"SUV"`, tabela `{SUV:9000}`, padrão 5000 → `{status:"ok",cents:5000,source:"default"}`.
  - `enabled:true`, `vehicleType:"SUV"`, tabela `{SUV:9000}` → `{status:"ok",cents:9000,source:"type"}`.
  - `enabled:true`, `vehicleType:"SEDA"`, tabela sem `SEDA` → padrão (`source:"default"`).
  - `enabled:true`, `vehicleType:null` e `undefined` → `{status:"needs-type"}`; `enabled:false`, `vehicleType:null` → `ok` com o padrão.
  - `enabled:true`, `vehicleType:"BARCO"` → `{status:"needs-type"}` (valor fora da lista nunca vira preço).
  - `lowestPrice` desligada → `{cents:5000,varies:false}`; ligada com `{HATCH:4000,SUV:9000}` e padrão 5000 → `{cents:4000,varies:true}`; ligada com tabela vazia → `{cents:5000,varies:false}`; ligada com as cinco categorias a 5000 → `varies:false`.
  - `priceLabel` ligada com `{HATCH:4000,SUV:9000}` → `prefix:"A partir de"` e `text` igual a `formatCents(4000)`; desligada → `prefix:null` e `text` igual a `formatCents(5000)`.
  - `parseReaisToCents`: `"40,00"→4000`, `"40.5"→4050`, `"40"→4000`, `""→null`, `"-1"→null`, `"abc"→null`, `"1000000,01"→null`.
- [ ] **Passo 2: rodar e ver falhar:** `npx vitest run tests/pricing.test.ts` → falha por módulo inexistente.
- [ ] **Passo 3: implementar** `src/lib/pricing.ts` com as assinaturas acima. `lowestPrice`: calcula o preço efetivo das cinco categorias (tabela ou padrão), `cents` = mínimo, `varies` = há mais de um valor distinto; desligada = padrão, `varies:false`. `parseReaisToCents` arredonda com `Math.round(n * 100)`.
- [ ] **Passo 4: rodar e ver passar:** `npx vitest run tests/pricing.test.ts` → todos verdes.

---

### Tarefa 2: Banco (migração, schema, ajuda dos testes)

**Arquivos:**
- Criar: `prisma/migrations/20261125000000_vehicle_type_pricing/migration.sql`
- Modificar: `prisma/schema.prisma` (`SiteSettings`, `Vehicle`, `Appointment`, `Service`, novo `ServicePrice`); `tests/helpers.ts`; `tests/db-constraints.test.ts`

**Interfaces:**
- Produz (Prisma): `SiteSettings.priceByVehicleType Boolean @default(false)`; `Vehicle.vehicleType String?`; `Appointment.vehicleTypeSnapshot String?`; `model ServicePrice { id String @id @default(cuid()); serviceId String; service Service @relation(fields:[serviceId], references:[id], onDelete: Cascade); vehicleType String; priceCents Int; @@unique([serviceId, vehicleType]) }` e `Service.prices ServicePrice[]`.
- Produz (SQL): CHECK em `Vehicle.vehicleType` e `Appointment.vehicleTypeSnapshot` (nulo ou um dos cinco valores); CHECK em `ServicePrice` (`vehicleType` na lista; `priceCents` entre 0 e 100000000); `ALTER TABLE "ServicePrice" ENABLE ROW LEVEL SECURITY;` ao final.
- Produz (helpers de teste em `tests/helpers.ts`): `createVehicleFor(userId, overrides)` passa a aceitar `vehicleType` (padrão `null`, que representa o "veículo antigo"); `setPricing(opts: { enabled: boolean })` faz upsert de `SiteSettings` id 1 com `priceByVehicleType`; `setServicePrices(serviceId: string, table: PriceTable)` recria as linhas de `ServicePrice`; `resetDb` apaga `servicePrice` antes de `service`.

- [ ] **Passo 1: escrever testes que falham** em `tests/db-constraints.test.ts` (seguir o estilo do arquivo): `Vehicle` com `vehicleType:"BARCO"` é recusado pelo banco; `null` e `"SUV"` passam; `ServicePrice` com `priceCents:-1` e com tipo inválido são recusados; duas linhas para o mesmo `(serviceId, vehicleType)` são recusadas; apagar o `Service` apaga os `ServicePrice`; `Appointment.vehicleTypeSnapshot:"BARCO"` é recusado.
- [ ] **Passo 2: rodar e ver falhar:** `npx vitest run tests/db-constraints.test.ts`.
- [ ] **Passo 3: editar `prisma/schema.prisma`**, escrever a migração à mão (ADD COLUMN, CREATE TABLE, índice único, FK `ON DELETE CASCADE`, CHECKs, RLS no fim; cabeçalho "MIGRAÇÃO SOMENTE ADITIVA" como em `20261119000000_service_images`), parar o `npm run dev`, rodar `npx prisma generate`; atualizar os helpers.
- [ ] **Passo 4: rodar e ver passar:** `npx vitest run tests/db-constraints.test.ts` e o teste de equivalência migrações == schema (localizar com `Grep "equival" tests`; rodar o arquivo que o contém), depois `npx tsc --noEmit`.

---

### Tarefa 3: Tipo no cadastro e na edição do veículo

**Arquivos:**
- Modificar: `src/lib/validation.ts` (`vehicleSchema`); `src/lib/vehicles.ts`; `src/components/VehicleFields.tsx`; `src/components/VehicleForm.tsx`; `src/app/minha-conta/veiculos/page.tsx`; `src/app/minha-conta/veiculos/[id]/editar/page.tsx` (repassar `vehicleType` aos formulários)
- Testes: `tests/vehicles.test.ts`; `e2e/conta.spec.ts`; `e2e/helpers.ts`

**Interfaces:**
- Consome: `VEHICLE_TYPES`, `VEHICLE_TYPE_LABELS` (Tarefa 1).
- Produz:
  - `vehicleSchema` ganha `vehicleType: z.enum(VEHICLE_TYPES, { message: "Escolha o tipo do veículo." })` (obrigatório); `VehicleInput.vehicleType: VehicleType`.
  - `createVehicle`/`updateVehicle` gravam o campo; `parseVehicleForm` lê `${prefix}vehicleType`.
  - `completeVehicleType(userId: string, vehicleId: string, type: VehicleType): Promise<boolean>` em `src/lib/vehicles.ts`: `updateMany({ where: { id: vehicleId, userId, vehicleType: null }, data: { vehicleType: type } })`, devolve `count > 0`, com auditoria `vehicle_updated` (sem placa).
  - `VehicleDefaults.vehicleType?: string | null`; `VehicleFields` mostra um `<select>` "Tipo de veículo" (obrigatório, opção inicial "Selecione…") entre Modelo e Placa; erro em `errors[prefix+"vehicleType"]`; estado controlado como os demais campos. Marca e Modelo continuam campos separados.
  - A lista de veículos de "Minha conta" mostra o tipo junto da marca/modelo e, quando for nulo, o aviso "Tipo não informado" com link para editar.

- [ ] **Passo 1: escrever testes que falham** em `tests/vehicles.test.ts`: o helper `input()` passa a incluir `vehicleType:"SEDA"`; `vehicleSchema` recusa `vehicleType` ausente, vazio e `"BARCO"`; `createVehicle` e `updateVehicle` gravam o tipo; `completeVehicleType` preenche um veículo antigo (nulo), **não** altera um que já tem tipo e **não** funciona para veículo de outra cliente (retorna `false`); `parseVehicleForm` com prefixo `novo_` lê `novo_vehicleType`; formulário com `userId`/`role` extras continua ignorando-os.
- [ ] **Passo 2: rodar e ver falhar:** `npx vitest run tests/vehicles.test.ts`.
- [ ] **Passo 3: implementar** conforme as interfaces. Usar a ação de auditoria `vehicle_updated` já existente.
- [ ] **Passo 4: rodar e ver passar:** `npx vitest run tests/vehicles.test.ts` e `npx tsc --noEmit`.
- [ ] **Passo 5: ajustar os e2e do cadastro** (`e2e/conta.spec.ts` ~linhas 257 e 277 e `completeVehicleStep` em `e2e/helpers.ts`): depois de preencher Marca e Modelo, `await page.getByLabel("Tipo de veículo").selectOption("SEDA")`. Rodar: `npx playwright test e2e/conta.spec.ts -g "veículo"` (projetos desktop e 390 px do `playwright.config.ts`).

---

### Tarefa 4: Dados de preço, `createBooking` e snapshot

**Arquivos:**
- Criar: `src/lib/pricing-data.ts`
- Modificar: `src/lib/booking.ts` (`createBooking`); `src/lib/validation.ts` (`createBookingSchema`); `src/app/agendar/actions.ts` (`confirmBookingAction`); `src/lib/audit-types.ts`
- Teste: `tests/pricing-booking.test.ts`

**Interfaces:**
- Consome: `resolvePrice`, `PriceTable`, `PriceResolution` (Tarefa 1); modelos da Tarefa 2.
- Produz (`src/lib/pricing-data.ts`, importa `prisma`; **sem cache**):
  - `loadPriceByTypeEnabled(db?: Db): Promise<boolean>` (sem linha de `SiteSettings` = `false`).
  - `loadPriceTables(serviceIds: string[], db?: Db): Promise<Map<string, PriceTable>>`.
  - `setPriceByTypeEnabled(enabled: boolean, adminId: string): Promise<void>`: upsert da linha 1 + `recordAuditTx` na mesma transação (`pricing_mode_changed`, detalhe "Ligado"/"Desligado").
  - `saveServicePrices(tx: Prisma.TransactionClient, serviceId: string, table: PriceTable): Promise<void>`: apaga as linhas das categorias ausentes e faz upsert das presentes.
  - `priceFor(service: { id: string; priceCents: number }, vehicleType: string | null, ctx: { enabled: boolean; tables: Map<string, PriceTable> }): PriceResolution`.
- Produz (`createBooking`): parâmetro opcional `expectedPriceCents?: number`. Sob o `runLocked`, depois de reler o veículo da dona: lê a chave e a tabela do serviço com `tx`, chama `resolvePrice`; `needs-type` → `BookingValidationError("Informe o tipo do seu veículo para continuar o agendamento.")`; `expectedPriceCents` definido e diferente do calculado → `BookingValidationError("O valor deste serviço mudou. Revise o agendamento e confirme novamente.")`. Grava `priceCents` (o calculado) e `vehicleTypeSnapshot: vehicle.vehicleType`.
- Produz (`createBookingSchema`): `expectedPriceCents: z.coerce.number().int().min(0).max(100_000_000).optional()`; `confirmBookingAction` lê o campo `expectedPriceCents` do `FormData` (ausente = `undefined`) e o repassa.
- `src/lib/audit-types.ts`: registrar `pricing_mode_changed` e `service_prices_updated` seguindo o padrão das ações existentes (categoria `ADMIN`).

- [ ] **Passo 1: escrever testes que falham** em `tests/pricing-booking.test.ts` (PostgreSQL embutido; `resetDb`, `openAllWeek`, helpers da Tarefa 2; chama `createBooking` de `@/lib/booking` direto):
  - chave desligada, serviço padrão 5000, tabela `{SUV:9000}`, veículo SUV → `priceCents` 5000.
  - chave ligada, mesmo cenário → 9000 e `vehicleTypeSnapshot:"SUV"`.
  - chave ligada, veículo `SEDA` sem preço de Sedã → 5000.
  - chave ligada, veículo com `vehicleType:null` → `BookingValidationError` com a mensagem de tipo, nenhuma reserva criada; chave desligada, mesmo veículo → cria com o padrão e `vehicleTypeSnapshot` nulo.
  - `expectedPriceCents:5000` com calculado 9000 → `BookingValidationError` ("O valor deste serviço mudou…"), nada criado; com `9000` → cria.
  - preço histórico: depois de criar a reserva a 9000, mudar a tabela para `{SUV:12000}` e desligar a chave → a reserva continua com `priceCents` 9000; `rescheduleOwnBooking` também mantém 9000.
  - chave ligada, `vehicleId` de **outra** cliente → `BookingValidationError` (comportamento atual preservado).
  - `loadPriceByTypeEnabled` = `false` sem linha em `SiteSettings`; `setPriceByTypeEnabled(true, admin.id)` grava a chave e uma linha de auditoria `pricing_mode_changed`; `saveServicePrices` com `{SUV:9000}` e depois com `{}` deixa zero linhas.
- [ ] **Passo 2: rodar e ver falhar:** `npx vitest run tests/pricing-booking.test.ts`.
- [ ] **Passo 3: implementar** `pricing-data.ts`, os ajustes em `createBooking`, `createBookingSchema`, `confirmBookingAction` e as ações de auditoria.
- [ ] **Passo 4: rodar e ver passar:** `npx vitest run tests/pricing-booking.test.ts tests/booking.test.ts tests/booking-vehicle-reschedule.test.ts tests/billing.test.ts` e `npx tsc --noEmit`.

---

### Tarefa 5: Painel do administrador (chave e preços por serviço)

**Arquivos:**
- Criar: `src/components/PriceModeForm.tsx`
- Modificar: `src/app/admin/configuracoes/page.tsx`; `src/app/admin/configuracoes/actions.ts`; `src/components/ServiceForm.tsx`; `src/app/admin/servicos/actions.ts`; `src/app/admin/servicos/[id]/editar/page.tsx`; `src/app/admin/servicos/novo/page.tsx`; `src/app/admin/servicos/page.tsx`
- Teste: `tests/pricing-admin.test.ts`

**Interfaces:**
- Consome: `setPriceByTypeEnabled`, `saveServicePrices`, `loadPriceByTypeEnabled`, `loadPriceTables`, `priceFor` (Tarefa 4); `parseReaisToCents`, `lowestPrice`, `VEHICLE_TYPES`, `VEHICLE_TYPE_LABELS` (Tarefa 1).
- Produz:
  - `togglePriceByTypeAction(_prev: PriceModeState, formData: FormData): Promise<PriceModeState>` no `actions.ts` de Configurações; `type PriceModeState = { ok: boolean; message: string } | null`. Faz `requireAdmin`, limite `RATE_LIMITS.settingsPerMinute`, lê o checkbox `priceByVehicleType` (`"on"`), chama `setPriceByTypeEnabled`, `revalidatePath("/", "layout")`.
  - Cartão "Preços por tipo de veículo" em Configurações (`PriceModeForm`), com o interruptor "Cobrar por tipo de veículo" (estado inicial do banco) e o texto: "Desligado: todos os veículos pagam o preço padrão do serviço. Ligado: defina o preço de cada serviço por categoria; categoria sem preço usa o preço padrão."
  - `ServiceForm` recebe `priceByType?: { enabled: boolean; table: Record<VehicleType, string> }` e mostra a seção "Preço por tipo de veículo" com cinco campos `price_HATCH` … `price_VAN` (reais, opcionais, controlados). Campo vazio mostra a dica "Usa o preço padrão (R$ X,XX)". Chave desligada: aviso "Cobrança por tipo desligada em Configurações: estes valores ficam guardados, mas não são usados." (campos continuam editáveis).
  - `upsertServiceAction` valida cada `price_*` com `parseReaisToCents` (inválido → erro no campo `price_SUV` etc.; vazio = sem preço) e chama `saveServicePrices` **na mesma transação** da gravação do serviço (serviço novo: com o id criado); audita `service_prices_updated` (detalhe só "N categorias", sem valores). `/servicos`, `/` e `/agendar` são revalidados.
  - A lista `/admin/servicos` mostra `priceLabel` ("A partir de …") quando a chave está ligada e o preço varia.

- [ ] **Passo 1: escrever testes que falham** em `tests/pricing-admin.test.ts`: `togglePriceByTypeAction` sem sessão de administradora é recusada (seguir como `tests/ops-security.test.ts` e `tests/security-fixes.test.ts` testam `requireAdmin`); com `ADMIN` liga e desliga; ao desligar, as linhas de `ServicePrice` **permanecem**; `upsertServiceAction`-equivalente de biblioteca: valores com vírgula (`"90,00"`) viram 9000, inválidos (`"abc"`, `"-5"`) são recusados antes de gravar qualquer coisa (serviço e preços na mesma transação: falha de preço não deixa serviço alterado).
- [ ] **Passo 2: rodar e ver falhar:** `npx vitest run tests/pricing-admin.test.ts`.
- [ ] **Passo 3: implementar** as ações, o cartão e a seção do `ServiceForm`; passar `priceByType` nas páginas de novo/editar (a de "novo" mostra os cinco campos vazios).
- [ ] **Passo 4: rodar e ver passar:** `npx vitest run tests/pricing-admin.test.ts`, `npx tsc --noEmit` e `npx eslint src tests e2e scripts`.

---

### Tarefa 6: Fluxo serviço → veículo → horário → revisão

**Arquivos:**
- Modificar: `src/lib/booking-urls.ts`; `src/components/ui.tsx` (`Stepper`); `src/app/agendar/page.tsx`; `src/app/agendar/veiculo/page.tsx`; `src/app/agendar/veiculo/actions.ts`; `src/components/VehicleStepForm.tsx`; `src/app/agendar/horario/page.tsx`; `src/components/SlotPicker.tsx`; `src/app/agendar/revisar/page.tsx`; `src/components/ConfirmBookingForm.tsx`; `src/app/agendar/actions.ts` (redirecionamento de conflito); `src/app/page.tsx` e `src/app/servicos/page.tsx` (somente links/ação do agendamento); `src/app/meus-agendamentos/[id]/reagendar/page.tsx` (somente se usar as URLs/Stepper alterados)
- Testes: `tests/booking-urls.test.ts`; `tests/booking-flow-pricing.test.ts`

**Interfaces:**
- Consome: `priceFor`, `loadPriceByTypeEnabled`, `loadPriceTables` (Tarefa 4); `completeVehicleType`, `getVehicleForUser`, `listVehicles` (Tarefa 3).
- Produz (`src/lib/booking-urls.ts`, sempre com `URLSearchParams`):
  - `veiculoUrl(serviceId: string, opts?: { data?: string; hora?: string }): string` → `/agendar/veiculo?serviceId=…[&data=…][&hora=…]`.
  - `horarioUrl(serviceId: string, opts?: { vehicleId?: string; conflito?: boolean; data?: string; hora?: string }): string`.
  - `revisarUrl(serviceId: string, startAtIso: string, vehicleId: string): string` (veículo passa a ser obrigatório).
  - `data` (`AAAA-MM-DD`) e `hora` (`HH:mm`) só são repassados se passarem em `isValidDateKey` e em `^([01]\d|2[0-3]):[0-5]\d$`; qualquer outro valor é descartado.
- Produz (`Stepper`): etapas `1 Serviço`, `2 Veículo`, `3 Data e horário`, `4 Revisão`; props `{ current, serviceId?, vehicleId?, startAt? }`; links de volta só para etapas concluídas; atualizar todos os usos.
- Produz (comportamento):
  - **Entradas:** `/agendar` (formulário GET), os cartões e a lista da home, o agendamento rápido da home (mantém `data`/`hora`) e os botões de `/servicos` apontam para `/agendar/veiculo`. Visitante sem login cai no login pelo middleware, que já preserva o `callbackUrl` (inclusive depois do cadastro/entrada com Google).
  - **`/agendar/veiculo`:** valida o serviço ativo; lista os veículos da cliente; carrega chave e tabela; calcula o preço de cada veículo com `priceFor`. Sem veículos: só o formulário de cadastro, com o aviso "Cadastre seu veículo para ver o valor e escolher o horário". Com veículos: escolha por rádio, cada opção com seu valor. Veículo sem tipo **com a chave ligada**: seletor "Complete o tipo deste veículo" (campo `completeType`), e a etapa não avança sem ele. "Cadastrar novo veículo" mostra o valor conforme o tipo escolhido no formulário. Observações continuam nesta etapa.
  - **`saveVehicleStepAction`:** recebe `serviceId`, `data` e `hora` opcionais (no lugar de `startAtIso`); valida serviço ativo e observações; cria o veículo novo ou confere o existente com `getVehicleForUser`; veículo existente sem tipo + chave ligada exige `completeType` válido e chama `completeVehicleType`; grava `setNotesDraft`; `redirect(horarioUrl(serviceId, { vehicleId, data, hora }))`.
  - **`/agendar/horario`:** exige `vehicleId` da própria cliente (`getVehicleForUser`); ausente, inválido, de outra cliente, apagado, ou sem tipo com a chave ligada → `redirect(veiculoUrl(serviceId, { data, hora }))`. Mostra veículo e valor (`priceFor`) no cabeçalho. `SlotPicker` ganha a prop opcional `vehicleId` e, no modo de agendamento novo, segue para `revisarUrl(serviceId, slot, vehicleId)`; o modo de reagendamento não muda.
  - **`/agendar/revisar`:** mesmas regras de redirecionamento; mostra veículo, tipo e o **valor final** calculado no servidor; `ConfirmBookingForm` ganha o campo oculto `expectedPriceCents`; "Trocar veículo" aponta para `veiculoUrl(serviceId)`.
  - **Conflito de horário** (`confirmBookingAction` e `ConfirmBookingForm`): redireciona para `horarioUrl(serviceId, { vehicleId, conflito: true })`. A mensagem "O valor deste serviço mudou…" (Tarefa 4) aparece no `ConfirmBookingForm` com o link "Rever o agendamento" para `revisarUrl(...)`.

- [ ] **Passo 1: escrever testes que falham.** `tests/booking-urls.test.ts` (já existe; atualizar): `veiculoUrl("s1", { data: "2026-12-01", hora: "10:30" })`; `horarioUrl` com e sem `vehicleId`; `revisarUrl`; `data="2026-13-99"` e `hora="25:00"` são descartados; `serviceId` com `&`, `=`, `#` e espaço continua sendo valor e não cria parâmetros. `tests/booking-flow-pricing.test.ts` (PostgreSQL embutido): `priceFor` para veículo de tipo nulo com chave ligada (`needs-type`) e desligada (`ok`), para as cinco categorias, e para categoria sem preço (padrão). As regras de redirecionamento das páginas são cobertas pelos e2e da Tarefa 9.
- [ ] **Passo 2: rodar e ver falhar:** `npx vitest run tests/booking-urls.test.ts tests/booking-flow-pricing.test.ts`.
- [ ] **Passo 3: implementar** URLs, `Stepper`, telas e ações; os erros de `tsc` das assinaturas antigas de `veiculoUrl`/`horarioUrl`/`revisarUrl` apontam todos os pontos a trocar.
- [ ] **Passo 4: rodar e ver passar:** `npx vitest run tests/booking-urls.test.ts tests/booking-flow-pricing.test.ts`, `npx tsc --noEmit` e `npx eslint src tests e2e scripts`.

---

### Tarefa 7: Vitrine ("A partir de" e valor exato)

**Arquivos:**
- Criar: `src/components/ServicePrice.tsx`
- Modificar: `src/app/page.tsx`; `src/app/servicos/page.tsx`; `src/app/agendar/page.tsx`
- Teste: já coberto por `priceLabel` em `tests/pricing.test.ts` (Tarefa 1) e pelos e2e (Tarefa 9)

**Interfaces:**
- Consome: `priceLabel`, `loadPriceByTypeEnabled`, `loadPriceTables` (Tarefas 1 e 4).
- Produz: componente `ServicePrice({ label, className })` que renderiza `prefix` (texto pequeno, acima do valor) e `text`; usa `text-brand` (e `text-ink` no cartão amarelo da home). Home (cartões e lista), `/servicos` e a etapa 1 de `/agendar` o usam; chave desligada = valor padrão, como hoje. `/servicos` e `/` continuam sendo revalidados pelas ações da Tarefa 5.

- [ ] **Passo 1: implementar** o componente e trocar `formatCents(s.priceCents)` pelas três telas, carregando chave e tabelas uma vez por página (`loadPriceTables(services.map(s => s.id))`).
- [ ] **Passo 2: verificar:** `npx tsc --noEmit` e `npx eslint src`; conferência visual fica nos e2e da Tarefa 9 (cenários 1 e 2).

---

### Tarefa 8: Tipo gravado nas reservas (painel)

**Arquivos:**
- Modificar: `src/lib/admin-appointments.ts` e `src/app/admin/agendamentos/page.tsx` (somente se já mostram o veículo)
- Teste: `tests/admin-appointments.test.ts` (um caso novo)

- [ ] **Passo 1: escrever o teste que falha:** reserva com `vehicleTypeSnapshot:"SUV"` aparece com o tipo na listagem do painel; reserva antiga (nulo) continua aparecendo sem erro.
- [ ] **Passo 2: rodar e ver falhar:** `npx vitest run tests/admin-appointments.test.ts`.
- [ ] **Passo 3: implementar** só a leitura do snapshot (nenhum preço de reserva existente é recalculado).
- [ ] **Passo 4: rodar e ver passar:** `npx vitest run tests/admin-appointments.test.ts` e `npx tsc --noEmit`.

---

### Tarefa 9: Testes de tela (desktop e 390 px), documentação e verificação final

**Arquivos:**
- Criar: `e2e/preco-tipo.spec.ts`
- Modificar: `e2e/agendamento.spec.ts`, `e2e/recursos.spec.ts`, `e2e/conta.spec.ts`, `e2e/helpers.ts` (fluxo novo: o veículo é a etapa 2, antes do horário); `CLAUDE.md`; `README.md`; `memory-security.md`

**Interfaces:**
- Consome: tudo das tarefas 1–8. Os projetos do Playwright já cobrem desktop e 390 px (conferir `playwright.config.ts`).

- [ ] **Passo 1: atualizar os e2e existentes** ao novo fluxo (`completeVehicleStep` passa a ser chamado logo depois de escolher o serviço, antes do horário). Rodar `npx playwright test e2e/agendamento.spec.ts e2e/recursos.spec.ts e2e/conta.spec.ts`, ver falhar, ajustar e ver passar.
- [ ] **Passo 2: escrever `e2e/preco-tipo.spec.ts`** com estes cenários (banco descartável do e2e; cada um em desktop e 390 px):
  1. **Chave desligada:** serviço padrão R$ 50,00 com preços por categoria salvos; home mostra R$ 50,00 sem "A partir de"; revisão mostra R$ 50,00 para veículo SUV.
  2. **Chave ligada:** administradora liga em Configurações e define SUV R$ 90,00 e Hatch R$ 40,00; home mostra "A partir de R$ 40,00"; cliente com SUV vê R$ 90,00 na etapa de veículo, no horário e na revisão; Sedã (sem preço) mostra o padrão; a reserva gravada tem `priceCents` 9000 e `vehicleTypeSnapshot` "SUV".
  3. **Cliente sem veículo:** ao escolher um serviço, cai na etapa de veículo só com o cadastro; cadastra Toyota / Corolla / Sedã / placa; segue ao horário com serviço e data preferida preservados; confirma.
  4. **Primeiro acesso com Google** (identidade simulada de `e2e/google-login.spec.ts`): visitante clica em "Agendar" num serviço, entra com Google, completa o cadastro e chega à etapa de veículo com o serviço escolhido.
  5. **Veículo antigo sem categoria:** chave ligada → "Complete o tipo deste veículo", sem avançar até escolher; ao escolher "Picape", segue e mostra o preço de Picape; chave desligada → o mesmo veículo avança sem pedir tipo.
  6. **Troca de veículo com mudança de preço:** cliente com Hatch (R$ 40,00) e SUV (R$ 90,00): o valor muda ao trocar a seleção; na revisão, "Trocar veículo" volta e o valor confirmado é o do último escolhido.
  7. **Valor mudou:** na revisão, o preço é alterado no banco e a cliente confirma → mensagem "O valor deste serviço mudou…", nenhuma reserva criada; ao rever, o valor novo aparece.
  8. **URL direta:** cliente A abre `/agendar/horario?serviceId=…&vehicleId=<veículo de B>` e `/agendar/revisar?…` → volta à etapa de veículo sem exibir dados de B.
- [ ] **Passo 3: rodar e ver passar:** `npx playwright test e2e/preco-tipo.spec.ts`. Defeito de produto encontrado volta para a tarefa dona do código.
- [ ] **Passo 4: documentar:** em `CLAUDE.md`, nas "Regras que não podem ser quebradas" (preço só no servidor via `src/lib/pricing.ts`; chave e tabela lidas sem cache; `expectedPriceCents`) e nas "Armadilhas" (veículo sem tipo + chave ligada exige completar; fluxo de 4 etapas com veículo antes do horário); seção de preços no `README.md`; seção "Mudança 2026-11-25" em `memory-security.md` (superfície nova, controles, "sem nova auditoria completa").
- [ ] **Passo 5: verificação final** (superpowers:verification-before-completion): `npx tsc --noEmit`, `npx eslint src tests e2e scripts`, `npm test`, `npm run test:e2e`. **Não** rodar `npm run db:deploy` no Supabase sem o usuário pedir.
