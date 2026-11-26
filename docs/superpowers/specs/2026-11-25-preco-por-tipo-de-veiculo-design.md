# Preço por tipo de veículo — desenho (aprovado em 2026-11-25)

## Intenção
O dono da Garage Zero Zero cobra valores diferentes conforme o porte do veículo e quer poder ligar essa diferenciação quando quiser. Desligada, o site funciona como hoje (um preço por serviço).

## Metas
- Chave "Cobrar por tipo de veículo" em Configurações (começa desligada).
- Preço por categoria em cada serviço: Hatch, Sedã, SUV, Picape, Van/Utilitário. Categoria sem preço usa o preço padrão (o painel mostra isso).
- Campo obrigatório "Tipo de veículo" no cadastro e na edição (marca e modelo continuam separados).
- Home e `/servicos`: "A partir de R$ X" quando o preço varia; valor exato na etapa do veículo e na revisão.
- Preço calculado no servidor; veículo conferido contra a dona da sessão; preço gravado na reserva.

## Não metas
- Não muda duração por tipo de veículo.
- Não altera reservas existentes nem o reagendamento (preço já gravado é mantido).
- Não cria categorias editáveis pelo admin (lista fixa em código).

## Restrições (CLAUDE.md)
- Migração aditiva; toda tabela nova termina com `ENABLE ROW LEVEL SECURITY` (nunca FORCE).
- Validação no servidor (Zod em `src/lib/validation.ts`); IDs da URL nunca são confiáveis.
- Reserva sempre via `createBooking`/`runLocked`; nada de rede dentro da transação.
- Placa nunca em log/auditoria. Constantes de tela em módulo sem dependências.
- Arquivos "use server" só exportam funções assíncronas.

## Abordagens consideradas
1. **Tabela `ServicePrice` + coluna em `Vehicle`** (escolhida): normalizada, permite RLS e CHECK, fácil de achar o menor preço.
2. Coluna JSON em `Service`: menos tabelas, mas sem CHECK no banco e mais frágil.
3. Cinco colunas fixas em `Service`: simples, mas rígido.

Fluxo escolhido pelo usuário: **serviço → veículo → horário → revisão**.

## Desenho
**Dados (migração aditiva)**
- `SiteSettings.priceByVehicleType Boolean @default(false)`.
- `ServicePrice(id, serviceId → Service onDelete Cascade, vehicleType, priceCents, @@unique([serviceId, vehicleType]))`, CHECK de tipo válido e preço ≥ 0, RLS ligado.
- `Vehicle.vehicleType String?` (nulo = veículo antigo), CHECK de valores válidos.
- `Appointment.vehicleTypeSnapshot String?`.

**`src/lib/pricing.ts`** (único ponto de verdade; sem dependências de servidor)
- `VEHICLE_TYPES`, rótulos, `isVehicleType`.
- `resolvePrice`: chave ligada + tipo + preço da categoria → esse; senão preço padrão. Chave ligada e veículo sem tipo → `needsVehicleType`.
- `lowestPrice`: menor preço efetivo entre as cinco categorias (padrão cobre as sem preço), para "A partir de".

**Admin:** interruptor em Configurações (action própria, auditoria, limite de escrita). Formulário do serviço ganha a seção "Preço por tipo de veículo" (vazio = usa o padrão, com aviso; chave desligada = aviso de inativo, valores preservados).

**Veículo:** `vehicleSchema` exige `vehicleType`; select "Tipo de veículo" em `VehicleFields` (cadastro, edição, etapa do agendamento). Veículo antigo sem tipo, com a chave ligada, é completado na etapa do veículo.

**Fluxo:** todas as entradas (home, `/servicos`, agendamento rápido, `/agendar`) levam à etapa de veículo (sem veículo → cadastro; vários → escolha com preço por escolha). Serviço e preferências de data/hora viajam na URL (validadas); observações no cookie `httpOnly` existente; login (inclusive Google) volta por `callbackUrl`. `/agendar/horario` e `/agendar/revisar` exigem `vehicleId` da própria cliente, revalidado no servidor.

**Reserva:** `createBooking` recalcula o preço sob o lock (nunca do formulário) e grava `priceCents` e `vehicleTypeSnapshot`. Veículo sem tipo com a chave ligada é recusado.

**Vitrine:** chave desligada = preço padrão; ligada e variando = "A partir de R$ X"; todas iguais = valor simples.

## Testes
Unidade de `pricing.ts`; integração no PostgreSQL embutido (`createBooking` com chave ligada/desligada, categoria sem preço, veículo de outra cliente, veículo antigo sem tipo, preço histórico preservado, reagendamento mantém preço); migração == schema; e2e desktop e 390 px (chave ligada/desligada, sem veículo, veículo antigo sem tipo, troca de veículo com mudança de preço).

## Decisões do construtor (minhas escolhas)
- Lista fixa: Hatch, Sedã, SUV, Picape, Van/Utilitário.
- "Tipo de veículo" obrigatório sempre, mesmo com a chave desligada.
- Observações permanecem na etapa de veículo.
- Preços por categoria preservados quando a chave é desligada.
