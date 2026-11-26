import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { E2E_DATABASE_URL, E2E_ENV, E2E_PORT } from "../playwright.config";
import { encodeGoogleSignup } from "../src/lib/google-login";
import { pickDay } from "./helpers";

/**
 * Preço por tipo de veículo: chave desligada/ligada, cliente sem veículo, primeiro acesso com Google, veículo antigo sem
 * categoria, troca de veículo com mudança de preço, valor que muda entre a revisão e a confirmação e URL direta com veículo
 * de outra cliente. Cada projeto (desktop e celular) usa o PRÓPRIO serviço e clientes novos, no banco descartável do e2e.
 */
const prisma = new PrismaClient({ datasourceUrl: E2E_DATABASE_URL });
const ADMIN = { email: E2E_ENV.ADMIN_EMAIL, password: E2E_ENV.ADMIN_PASSWORD };
const PASSWORD = "Tulipa-Rosa-42";
const stamp = Date.now().toString().slice(-7);
const TZ = "America/Sao_Paulo";

test.describe.configure({ mode: "serial" });
test.afterAll(async () => {
  // A chave é global: deixa desligada para não mudar o comportamento dos outros arquivos de teste.
  await prisma.siteSettings.upsert({ where: { id: 1 }, create: { id: 1, priceByVehicleType: false }, update: { priceByVehicleType: false } });
  await prisma.$disconnect();
});

// ---------- utilidades ----------
const issues = new WeakMap<Page, string[]>();
function watch(page: Page) {
  const list: string[] = [];
  issues.set(page, list);
  page.on("pageerror", (e) => list.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) list.push("console.error: " + m.text().slice(0, 200));
  });
  page.on("response", (r) => {
    if (r.status() >= 400) list.push(`HTTP ${r.status()} ${new URL(r.url()).pathname}`);
  });
}
const expectClean = (page: Page) => expect(issues.get(page) ?? []).toEqual([]);

async function noHScroll(page: Page, label: string) {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(r.sw, `${label}: rolagem horizontal (${r.sw}px > ${r.iw}px)`).toBeLessThanOrEqual(r.iw + 1);
}

async function shot(page: Page, info: TestInfo, name: string) {
  await noHScroll(page, name);
  const dir = path.join(__dirname, "screenshots", info.project.name, "preco-tipo");
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, name + ".png") });
}

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

async function newClient(label: string, info: TestInfo) {
  return prisma.user.create({
    data: {
      name: `${label} ${info.project.name}`,
      email: `${label}-${info.project.name}-${stamp}@example.com`,
      phone: "(11) 98888-2222",
      passwordHash: bcrypt.hashSync(PASSWORD, 10),
      role: "CLIENTE",
    },
  });
}

async function newContext(browser: Browser, info: TestInfo) {
  return browser.newContext({
    baseURL: `http://localhost:${E2E_PORT}`,
    locale: "pt-BR",
    timezoneId: TZ,
    viewport: info.project.use.viewport ?? { width: 1280, height: 900 },
    isMobile: info.project.use.isMobile,
    hasTouch: info.project.use.hasTouch,
  });
}

let plateN = 0;
async function addVehicle(userId: string, brand: string, model: string, vehicleType: string | null) {
  plateN += 1;
  return prisma.vehicle.create({ data: { userId, brand, model, vehicleType, plate: `PTP${plateN % 10}A${String(10 + Math.floor(plateN / 10)).padStart(2, "0")}` } });
}

const setSwitch = (enabled: boolean) =>
  prisma.siteSettings.upsert({ where: { id: 1 }, create: { id: 1, priceByVehicleType: enabled }, update: { priceByVehicleType: enabled } });

/** Serviço próprio do projeto (padrão R$ 50,00, 30 min) com a tabela de preços por categoria dada (centavos). */
async function setupService(info: TestInfo, table: Record<string, number>) {
  const name = `Detalhe Tipo ${info.project.name}`;
  const service = (await prisma.service.findFirst({ where: { name } })) ?? (await prisma.service.create({ data: { name, priceCents: 5000, durationMinutes: 30, active: true } }));
  await prisma.service.update({ where: { id: service.id }, data: { priceCents: 5000, active: true } });
  await prisma.servicePrice.deleteMany({ where: { serviceId: service.id } });
  for (const [vehicleType, priceCents] of Object.entries(table)) await prisma.servicePrice.create({ data: { serviceId: service.id, vehicleType, priceCents } });
  return service;
}

const spKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);

/**
 * O `n`-ésimo dia útil (ter–sex) a partir de uma faixa própria deste arquivo, sempre às 09:00 de São Paulo (ISO UTC).
 * O banco do e2e é compartilhado e só há UMA agenda: os outros arquivos usam 10h, 12h, 14h–17h (inclusive serviços de 60 e
 * 120 min), então às 09:00 um serviço de 30 min nunca encosta neles. Cada cenário que reserva usa um `n` diferente.
 */
function slotIso(info: TestInfo, n: number): string {
  const start = info.project.name === "desktop" ? 30 : 38;
  const base = new Date();
  let found = -1;
  for (let i = start; i < start + 30; i++) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
    if (d.getDay() >= 2 && d.getDay() <= 5 && ++found === n) {
      const p = (x: number) => String(x).padStart(2, "0");
      return new Date(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T09:00:00-03:00`).toISOString();
    }
  }
  throw new Error("sem dia útil");
}

const hhmm = (iso: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

/** Na etapa de horário: escolhe o dia e o horário do `iso` e segue para a revisão. */
async function pickSlotAndContinue(page: Page, iso: string) {
  await pickDay(page, spKey(new Date(iso)));
  await page.getByRole("button", { name: hhmm(iso), exact: true }).click();
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page).toHaveURL(/\/agendar\/revisar/);
}

const valueRegion = (page: Page) => page.getByRole("region", { name: "Valor do serviço" });
const money = (reais: string) => new RegExp(`R\\$\\s*${reais.replace(".", "\\.")}`);

// ---------- cenários ----------
test("chave desligada: vitrine, etapa do veículo e revisão usam o preço padrão", async ({ page }, info) => {
  watch(page);
  await setSwitch(false);
  const service = await setupService(info, { SUV: 9000, HATCH: 4000 }); // guardados, mas não usados
  const client = await newClient("desligada", info);
  await addVehicle(client.id, "Jeep", "Compass", "SUV");

  await page.goto("/servicos");
  const card = page.locator("li", { hasText: service.name }).first();
  await expect(card).toContainText(money("50,00"));
  await expect(card).not.toContainText("A partir de");

  await login(page, client.email, PASSWORD);
  await page.goto(`/agendar/veiculo?serviceId=${service.id}`);
  await expect(valueRegion(page)).toContainText(money("50,00"));
  await shot(page, info, "01-desligada-veiculo");
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page).toHaveURL(/\/agendar\/horario/);
  await pickSlotAndContinue(page, slotIso(info, 4));
  await expect(page.getByRole("region", { name: "Resumo do agendamento" })).toContainText(money("50,00"));
  await shot(page, info, "02-desligada-revisao");
  expectClean(page);
});

test("chave ligada pelo painel: 'A partir de' na vitrine, valor do veículo em cada etapa e reserva gravada com o preço do tipo", async ({ browser, page }, info) => {
  watch(page);
  await setSwitch(false);
  const service = await setupService(info, {});
  const client = await newClient("ligada", info);
  await addVehicle(client.id, "Jeep", "Compass", "SUV");

  // A administradora define os preços primeiro (com a chave ainda desligada): o painel avisa que não estão valendo.
  await login(page, ADMIN.email, ADMIN.password);
  await page.goto(`/admin/servicos/${service.id}/editar`);
  await page.getByLabel("SUV (R$)").fill("90,00");
  await page.getByLabel("Hatch (R$)").fill("40,00");
  await shot(page, info, "04-painel-servico-precos");
  await page.getByRole("button", { name: "Salvar serviço" }).click();
  await expect(page).toHaveURL(/\/admin\/servicos$/);
  const warning = page.getByText(/a cobrança por tipo de veículo está desligada/i);
  await expect(warning).toBeVisible();
  await shot(page, info, "03-painel-aviso-desligada");

  // O link do aviso leva às Configurações, onde um clique liga a cobrança (sem botão "Salvar" separado).
  await page.getByRole("link", { name: "Ligar em Configurações" }).click();
  await expect(page).toHaveURL(/\/admin\/configuracoes$/);
  await expect(page.getByText("Situação atual: desligada")).toBeVisible();
  await page.getByRole("button", { name: "Ligar cobrança por tipo de veículo" }).click();
  await expect(page.getByText(/Cobrança por tipo de veículo ligada/)).toBeVisible();
  await expect(page.getByText("Situação atual: ligada")).toBeVisible();
  await expect(page.getByRole("button", { name: "Desligar cobrança por tipo de veículo" })).toBeVisible();
  await shot(page, info, "03-painel-chave");
  await page.goto("/admin/servicos");
  await expect(warning).toHaveCount(0);
  await expect(page.getByText(/por tipo: a partir de R\$\s*40,00/).first()).toBeVisible();
  expect(await prisma.servicePrice.findMany({ where: { serviceId: service.id }, orderBy: { vehicleType: "asc" } })).toMatchObject([
    { vehicleType: "HATCH", priceCents: 4000 },
    { vehicleType: "SUV", priceCents: 9000 },
  ]);

  // Visitante: a vitrine mostra "A partir de" com o menor valor.
  const visitor = await newContext(browser, info);
  const vp = await visitor.newPage();
  await vp.goto("/servicos");
  const card = vp.locator("li", { hasText: service.name }).first();
  await expect(card).toContainText("A partir de");
  await expect(card).toContainText(money("40,00"));
  await visitor.close();

  // Cliente com SUV: o valor exato (R$ 90,00) aparece na etapa do veículo, no horário e na revisão.
  const ctx = await newContext(browser, info);
  const cp = await ctx.newPage();
  watch(cp);
  await login(cp, client.email, PASSWORD);
  await cp.goto("/agendar");
  await expect(cp.locator("label", { hasText: service.name })).toContainText("A partir de");
  await cp.goto(`/agendar/veiculo?serviceId=${service.id}`);
  await expect(valueRegion(cp)).toContainText(money("90,00"));
  await shot(cp, info, "05-ligada-veiculo");
  await cp.getByRole("button", { name: "Continuar" }).click();
  await expect(cp).toHaveURL(/\/agendar\/horario/);
  await expect(cp.getByText(money("90,00")).first()).toBeVisible();
  await shot(cp, info, "06-ligada-horario");
  await pickSlotAndContinue(cp, slotIso(info, 0));
  await expect(cp.getByRole("region", { name: "Resumo do agendamento" })).toContainText(money("90,00"));
  await expect(cp.getByRole("region", { name: "Resumo do agendamento" })).toContainText("Jeep Compass (SUV)");
  await shot(cp, info, "07-ligada-revisao");
  await cp.getByRole("button", { name: "Confirmar agendamento" }).click();
  await expect(cp).toHaveURL(/\/agendar\/confirmado\//);
  expect(await prisma.appointment.findFirstOrThrow({ where: { clientId: client.id } })).toMatchObject({ priceCents: 9000, vehicleTypeSnapshot: "SUV" });
  expectClean(cp);
  await ctx.close();
});

test("cliente sem veículo: cadastra na etapa do veículo, preserva serviço e preferência de dia e horário, e agenda", async ({ page }, info) => {
  watch(page);
  await setSwitch(true);
  const service = await setupService(info, { SUV: 9000 }); // Sedã sem preço: usa o padrão
  const client = await newClient("semveiculo", info);
  const iso = slotIso(info, 1);
  await login(page, client.email, PASSWORD);

  await page.goto(`/agendar/veiculo?serviceId=${service.id}&data=${spKey(new Date(iso))}&hora=09:00`);
  await expect(page.getByText("Cadastre seu veículo para ver o valor e escolher o horário.")).toBeVisible();
  await expect(valueRegion(page)).toContainText("—"); // sem tipo escolhido ainda, não há valor
  await page.getByLabel("Marca").fill("Toyota");
  await page.getByLabel("Modelo").fill("Corolla");
  await page.getByLabel("Tipo de veículo").selectOption("SEDA");
  await expect(valueRegion(page)).toContainText(money("50,00")); // Sedã sem preço específico: padrão
  await page.getByLabel("Placa").fill("TYT1A23");
  await shot(page, info, "08-sem-veiculo-cadastro");
  await page.getByRole("button", { name: "Continuar" }).click();

  await expect(page).toHaveURL(/\/agendar\/horario/);
  await expect(page.locator(`[data-date="${spKey(new Date(iso))}"]`)).toHaveAttribute("aria-pressed", "true"); // preferência preservada
  await expect(page.getByText("Horário escolhido:")).toContainText("09:00");
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page).toHaveURL(/\/agendar\/revisar/);
  await expect(page.getByRole("region", { name: "Resumo do agendamento" })).toContainText("Toyota Corolla (Sedã)");
  await page.getByRole("button", { name: "Confirmar agendamento" }).click();
  await expect(page).toHaveURL(/\/agendar\/confirmado\//);

  expect(await prisma.vehicle.findFirstOrThrow({ where: { userId: client.id } })).toMatchObject({ brand: "Toyota", model: "Corolla", vehicleType: "SEDA" });
  expect(await prisma.appointment.findFirstOrThrow({ where: { clientId: client.id } })).toMatchObject({ priceCents: 5000, vehicleTypeSnapshot: "SEDA", vehicleBrandSnapshot: "Toyota" });
  expectClean(page);
});

test("primeiro acesso com Google: depois do cadastro chega à etapa do veículo com o serviço escolhido", async ({ page, context, baseURL }, info) => {
  watch(page);
  await setSwitch(true);
  const service = await setupService(info, { SUV: 9000 });
  const callback = `/agendar/veiculo?serviceId=${service.id}`;
  // Simula a saída da verificação do Google (a mesma técnica de google-login.spec.ts): cookie, formulário e banco são reais.
  const pending = await encodeGoogleSignup(
    { sub: `google-preco-${info.project.name}-${stamp}`, email: `google-preco-${info.project.name}-${stamp}@example.com`, email_verified: true, name: "Cliente Google Preço" },
    callback
  );
  await context.addCookies([{ name: "google-signup", value: pending, url: baseURL!, httpOnly: true }]);

  await page.goto("/completar-cadastro");
  await page.getByLabel("WhatsApp / celular com DDD").fill("11912345678");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Concluir cadastro" }).click();

  await expect(page).toHaveURL(new RegExp(`/agendar/veiculo\\?serviceId=${service.id}`));
  await expect(page.getByText("Cadastre seu veículo para ver o valor e escolher o horário.")).toBeVisible();
  await shot(page, info, "09-google-veiculo");
  expectClean(page);
});

test("veículo antigo sem categoria: com a chave ligada pede o tipo antes de seguir; desligada, segue direto", async ({ browser, page }, info) => {
  watch(page);
  await setSwitch(true);
  const service = await setupService(info, { PICAPE: 8000 });
  const client = await newClient("antigo", info);
  const legacy = await addVehicle(client.id, "Fiat", "Uno", null);
  await login(page, client.email, PASSWORD);

  await page.goto(`/agendar/veiculo?serviceId=${service.id}`);
  await expect(page.getByLabel("Complete o tipo deste veículo")).toBeVisible();
  await expect(valueRegion(page)).toContainText("—");
  await shot(page, info, "10-antigo-completar-tipo");
  await page.getByRole("button", { name: "Continuar" }).click(); // sem escolher: o navegador não deixa seguir
  await expect(page).toHaveURL(/\/agendar\/veiculo/);
  expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: legacy.id } })).vehicleType).toBeNull();

  await page.getByLabel("Complete o tipo deste veículo").selectOption("PICAPE");
  await expect(valueRegion(page)).toContainText(money("80,00"));
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page).toHaveURL(/\/agendar\/horario/);
  expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: legacy.id } })).vehicleType).toBe("PICAPE");

  // Chave desligada: outro veículo antigo avança sem pedir o tipo.
  await setSwitch(false);
  const other = await newClient("antigo2", info);
  await addVehicle(other.id, "Fiat", "Palio", null);
  const ctx2 = await newContext(browser, info);
  const page2 = await ctx2.newPage();
  await login(page2, other.email, PASSWORD);
  await page2.goto(`/agendar/veiculo?serviceId=${service.id}`);
  await expect(page2.getByLabel("Complete o tipo deste veículo")).toHaveCount(0);
  await expect(valueRegion(page2)).toContainText(money("50,00"));
  await page2.getByRole("button", { name: "Continuar" }).click();
  await expect(page2).toHaveURL(/\/agendar\/horario/);
  await ctx2.close();
  expectClean(page);
});

test("troca de veículo com mudança de preço: o valor acompanha a escolha até a confirmação", async ({ page }, info) => {
  watch(page);
  await setSwitch(true);
  const service = await setupService(info, { HATCH: 4000, SUV: 9000 }); // Sedã: padrão R$ 50,00
  const client = await newClient("troca", info);
  await addVehicle(client.id, "Honda", "Civic", "SEDA");
  await addVehicle(client.id, "Jeep", "Compass", "SUV");
  await addVehicle(client.id, "Fiat", "Mobi", "HATCH");
  await login(page, client.email, PASSWORD);

  await page.goto(`/agendar/veiculo?serviceId=${service.id}`);
  await expect(page.getByRole("radio", { name: /Fiat Mobi.*R\$\s*40,00/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: /Jeep Compass.*R\$\s*90,00/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: /Honda Civic.*R\$\s*50,00/ })).toBeVisible();
  await page.getByRole("radio", { name: /Jeep Compass/ }).check();
  await expect(valueRegion(page)).toContainText(money("90,00"));
  await page.getByRole("radio", { name: /Fiat Mobi/ }).check();
  await expect(valueRegion(page)).toContainText(money("40,00"));

  // Veículo novo: o valor acompanha o tipo escolhido, mas não pode sobrar de uma escolha anterior ao voltar para a opção.
  await page.getByRole("radio", { name: "Cadastrar um novo veículo" }).check();
  await page.getByLabel("Tipo de veículo").selectOption("SUV");
  await expect(valueRegion(page)).toContainText(money("90,00"));
  await page.getByRole("radio", { name: /Fiat Mobi/ }).check();
  await page.getByRole("radio", { name: "Cadastrar um novo veículo" }).check();
  await expect(page.getByLabel("Tipo de veículo")).toHaveValue("");
  await expect(valueRegion(page)).toContainText("—");
  await page.getByRole("radio", { name: /Fiat Mobi/ }).check();
  await expect(valueRegion(page)).toContainText(money("40,00"));
  await shot(page, info, "11-troca-veiculo");
  await page.getByRole("button", { name: "Continuar" }).click();

  await expect(page).toHaveURL(/\/agendar\/horario/);
  const iso = slotIso(info, 2);
  await pickSlotAndContinue(page, iso);
  await expect(page.getByRole("region", { name: "Resumo do agendamento" })).toContainText(money("40,00"));

  // Troca o veículo na revisão: o valor passa a ser o do SUV.
  await page.getByRole("link", { name: "Voltar e trocar o veículo" }).click();
  await expect(page).toHaveURL(/\/agendar\/veiculo/);
  await page.getByRole("radio", { name: /Jeep Compass/ }).check();
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page).toHaveURL(/\/agendar\/horario/);
  await pickSlotAndContinue(page, iso);
  await expect(page.getByRole("region", { name: "Resumo do agendamento" })).toContainText(money("90,00"));
  await page.getByRole("button", { name: "Confirmar agendamento" }).click();
  await expect(page).toHaveURL(/\/agendar\/confirmado\//);
  expect(await prisma.appointment.findFirstOrThrow({ where: { clientId: client.id } })).toMatchObject({ priceCents: 9000, vehicleTypeSnapshot: "SUV", vehicleModelSnapshot: "Compass" });
  expectClean(page);
});

test("valor que muda entre a revisão e a confirmação: nada é gravado e a cliente revê o valor novo", async ({ page }, info) => {
  watch(page);
  await setSwitch(true);
  const service = await setupService(info, { SUV: 9000 });
  const client = await newClient("valormudou", info);
  await addVehicle(client.id, "Jeep", "Compass", "SUV");
  await login(page, client.email, PASSWORD);

  await page.goto(`/agendar/veiculo?serviceId=${service.id}`);
  await page.getByRole("button", { name: "Continuar" }).click();
  await pickSlotAndContinue(page, slotIso(info, 3));
  await expect(page.getByRole("region", { name: "Resumo do agendamento" })).toContainText(money("90,00"));

  await prisma.servicePrice.update({ where: { serviceId_vehicleType: { serviceId: service.id, vehicleType: "SUV" } }, data: { priceCents: 11_000 } });
  await page.getByRole("button", { name: "Confirmar agendamento" }).click();
  // (o anunciador de rotas do Next também é um role=alert: filtra pelo texto)
  await expect(page.getByRole("alert").filter({ hasText: "O valor deste serviço mudou" })).toBeVisible();
  await shot(page, info, "12-valor-mudou");
  expect(await prisma.appointment.count({ where: { clientId: client.id } })).toBe(0);

  await page.getByRole("link", { name: "Rever o agendamento" }).click();
  await expect(page.getByRole("region", { name: "Resumo do agendamento" })).toContainText(money("110,00"));
  // O aviso do valor antigo não pode ficar na tela ao lado do valor novo.
  await expect(page.getByRole("alert").filter({ hasText: "O valor deste serviço mudou" })).toHaveCount(0);
  await page.getByRole("button", { name: "Confirmar agendamento" }).click();
  await expect(page).toHaveURL(/\/agendar\/confirmado\//);
  expect((await prisma.appointment.findFirstOrThrow({ where: { clientId: client.id } })).priceCents).toBe(11_000);
  expectClean(page);
});

test("URL direta com veículo de outra cliente: volta à etapa do veículo, sem revelar nada", async ({ page }, info) => {
  watch(page);
  await setSwitch(true);
  const service = await setupService(info, { SUV: 9000 });
  const a = await newClient("idor-a", info);
  const b = await newClient("idor-b", info);
  const theirs = await addVehicle(b.id, "Ferrari", "Roma", "SUV");
  await login(page, a.email, PASSWORD);

  const startAt = slotIso(info, 5);
  for (const url of [
    `/agendar/horario?serviceId=${service.id}&vehicleId=${theirs.id}`,
    `/agendar/revisar?serviceId=${service.id}&startAt=${encodeURIComponent(startAt)}&vehicleId=${theirs.id}`,
    `/agendar/horario?serviceId=${service.id}&vehicleId=nao-existe`,
    `/agendar/horario?serviceId=${service.id}`,
  ]) {
    await page.goto(url);
    await expect(page, url).toHaveURL(/\/agendar\/veiculo/);
    await expect(page.locator("body")).not.toContainText("Ferrari");
    await expect(page.locator("body")).not.toContainText(theirs.plate);
  }
  expect(await prisma.appointment.count({ where: { clientId: a.id } })).toBe(0);
});
