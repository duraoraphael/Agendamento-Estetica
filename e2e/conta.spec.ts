import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { E2E_DATABASE_URL, E2E_ENV, E2E_PORT } from "../playwright.config";
import { pickDay } from "./helpers";

/**
 * Telas novas da Garage Zero Zero: serviços, agendamento rápido, conta e veículos, reagendamento, recuperação de senha e
 * verificação em quatro larguras (390, 768, 1024 e 1440 px). Usa o mesmo build e o mesmo banco descartável das outras specs.
 */
const prisma = new PrismaClient({ datasourceUrl: E2E_DATABASE_URL });
const ADMIN = { email: E2E_ENV.ADMIN_EMAIL, password: E2E_ENV.ADMIN_PASSWORD };
const PASSWORD = "Tulipa-Rosa-42";
const NEW_PASSWORD = "Nova#Senha2026";
const stamp = Date.now().toString().slice(-7);
const TZ = "America/Sao_Paulo";

test.describe.configure({ mode: "serial" });
test.afterAll(async () => {
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
    const u = new URL(r.url());
    if (r.status() >= 400) list.push(`HTTP ${r.status()} ${u.pathname}`);
  });
  page.on("requestfailed", (r) => {
    if (/ERR_ABORTED/.test(r.failure()?.errorText ?? "")) return;
    list.push("requestfailed: " + r.url());
  });
}
const expectClean = (page: Page) => expect(issues.get(page) ?? []).toEqual([]);

async function noHScroll(page: Page, label: string) {
  const r = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    iw: window.innerWidth,
    wide: [...document.querySelectorAll("body *")]
      .filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1)
      .slice(0, 4)
      .map((e) => e.tagName + "." + String((e as HTMLElement).className).slice(0, 40)),
  }));
  expect(r.sw, `${label}: largura ${r.sw}px > viewport ${r.iw}px. Largos: ${r.wide.join(", ")}`).toBeLessThanOrEqual(r.iw + 1);
}

async function shot(page: Page, info: TestInfo, name: string, sub = "") {
  const dir = path.join(__dirname, "screenshots", info.project.name, sub);
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, name + ".png") });
}

async function check(page: Page, info: TestInfo, name: string) {
  await noHScroll(page, name);
  await shot(page, info, name);
}

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

async function newClient(label: string, info: TestInfo) {
  const email = `${label}-${info.project.name}-${stamp}@example.com`;
  const user = await prisma.user.create({
    data: { name: `${label} ${info.project.name}`, email, phone: "(11) 98888-2222", passwordHash: bcrypt.hashSync(PASSWORD, 10), role: "CLIENTE" },
  });
  return { ...user, email };
}

async function clientPage(browser: Browser, info: TestInfo, email: string, password = PASSWORD) {
  const ctx = await browser.newContext({
    baseURL: `http://localhost:${E2E_PORT}`,
    locale: "pt-BR",
    timezoneId: TZ,
    viewport: info.project.use.viewport ?? { width: 1280, height: 900 },
    isMobile: info.project.use.isMobile,
    hasTouch: info.project.use.hasTouch,
  });
  const page = await ctx.newPage();
  watch(page);
  await login(page, email, password);
  return { ctx, page };
}

const spKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);

/** Dia útil (ter–sex) a partir de `ahead` dias, às `hour`:00 de São Paulo, como ISO UTC. */
function slotIso(ahead: number, hour: number): string {
  const base = new Date();
  for (let i = ahead; i < ahead + 14; i++) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
    if (d.getDay() >= 2 && d.getDay() <= 5) {
      const p = (n: number) => String(n).padStart(2, "0");
      return new Date(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(hour)}:00:00-03:00`).toISOString();
    }
  }
  throw new Error("sem dia útil");
}

async function service(name: string) {
  return prisma.service.findFirstOrThrow({ where: { name } });
}

/** Cria uma reserva confirmada com veículo (snapshot) direto no banco. */
async function seedAppointment(clientId: string, iso: string, serviceName: string, plate: string) {
  const svc = await service(serviceName);
  const vehicle = await prisma.vehicle.create({ data: { userId: clientId, brand: "Fiat", model: "Argo", plate } });
  const start = new Date(iso);
  return prisma.appointment.create({
    data: {
      clientId, serviceId: svc.id, serviceName: svc.name, priceCents: svc.priceCents, durationMinutes: svc.durationMinutes,
      vehicleId: vehicle.id, vehicleBrandSnapshot: "Fiat", vehicleModelSnapshot: "Argo", vehiclePlateSnapshot: plate,
      startAt: start, endAt: new Date(start.getTime() + svc.durationMinutes * 60_000),
    },
  });
}

/** Verificações básicas de acessibilidade da página atual. */
async function basicA11y(page: Page, label: string) {
  const r = await page.evaluate(() => {
    const visible = (el: Element) => {
      const s = getComputedStyle(el as HTMLElement);
      const b = (el as HTMLElement).getBoundingClientRect();
      return s.visibility !== "hidden" && s.display !== "none" && b.width > 0 && b.height > 0;
    };
    const name = (el: Element) =>
      (el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || (el as HTMLElement).innerText || el.getAttribute("title") || "").trim() ||
      ((el as HTMLInputElement).labels?.[0]?.textContent ?? "").trim();
    return {
      lang: document.documentElement.lang,
      h1: [...document.querySelectorAll("h1")].filter(visible).length,
      imgsWithoutAlt: [...document.querySelectorAll("img")].filter((i) => !i.hasAttribute("alt")).length,
      unnamedControls: [...document.querySelectorAll("button, a[href], input:not([type=hidden]):not([type=radio]), select, textarea")]
        .filter(visible)
        .filter((el) => !name(el) && !el.querySelector("img[alt]:not([alt=''])"))
        .map((el) => el.tagName + (el.id ? "#" + el.id : "")),
      smallTargets: [...document.querySelectorAll("button, a.btn-primary, a.btn-secondary, input[type=submit]")]
        .filter(visible)
        .filter((el) => el.getBoundingClientRect().height < 43.5)
        .map((el) => (el as HTMLElement).innerText.trim().slice(0, 20) || el.tagName),
    };
  });
  expect(r.lang, `${label}: html lang`).toBe("pt-BR");
  expect(r.h1, `${label}: exatamente um h1 visível`).toBe(1);
  expect(r.imgsWithoutAlt, `${label}: imagens sem atributo alt`).toBe(0);
  expect(r.unnamedControls, `${label}: controles sem nome acessível`).toEqual([]);
  expect(r.smallTargets, `${label}: alvos de toque menores que 44px`).toEqual([]);
}

// ---------- público ----------
test("público: /servicos completa e agendamento rápido que preserva a intenção até o login", async ({ browser, page }, info) => {
  watch(page);
  await page.goto("/servicos");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/Nossos\s+serviços/i);
  for (const name of ["Lavagem detalhada", "Higienização interna", "Polimento técnico", "Cristalização de pintura", "Vitrificação", "Higienização de ar-condicionado", "Limpeza e hidratação de couro"]) {
    await expect(page.getByRole("heading", { name, level: 2 })).toBeVisible();
  }
  await expect(page.getByText("Duração média: 120 min").first()).toBeVisible();
  await check(page, info, "40-servicos");
  await basicA11y(page, "/servicos");

  // CTA de um serviço leva ao login e guarda o destino.
  const lav = await service("Lavagem detalhada");
  await page.getByRole("link", { name: "Agendar Lavagem detalhada" }).click();
  await expect(page).toHaveURL(/\/login\?callbackUrl=/);
  expect(decodeURIComponent(new URL(page.url()).searchParams.get("callbackUrl")!)).toBe(`/agendar/horario?serviceId=${lav.id}`);

  // Agendamento rápido na home: serviço + data + horário preferido viram o destino do login.
  const c = await newClient("rapido", info);
  const day = spKey(new Date(slotIso(24, 10)));
  await page.goto("/");
  await page.getByLabel("Serviço", { exact: true }).selectOption({ label: "Higienização de ar-condicionado" });
  await page.getByLabel("Data", { exact: true }).fill(day);
  await page.getByLabel("Horário preferido").selectOption("10:00");
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page).toHaveURL(/\/login\?callbackUrl=/);
  const callback = decodeURIComponent(new URL(page.url()).searchParams.get("callbackUrl")!);
  expect(callback).toContain("/agendar/horario?");
  expect(callback).toContain(`data=${day}`);
  expect(callback).toContain("hora=10:00");
  await check(page, info, "41-login-com-intencao");

  // Depois de entrar volta para a etapa de horário, já no dia e no horário pedidos.
  await page.getByLabel("E-mail", { exact: true }).fill(c.email);
  await page.getByLabel("Senha", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/agendar\/horario\?/);
  await expect(page.locator(`[data-date="${day}"]`)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Horário escolhido:")).toContainText("10:00");

  // "Criar conta" a partir do login leva a intenção junto.
  const visitor = await browser.newContext({ baseURL: `http://localhost:${E2E_PORT}`, locale: "pt-BR" });
  const vp = await visitor.newPage();
  await vp.goto(`/login?callbackUrl=${encodeURIComponent(callback)}`);
  await vp.getByRole("link", { name: "Criar conta" }).first().click();
  await expect(vp).toHaveURL(/\/cadastro\?callbackUrl=/);
  await visitor.close();
  expectClean(page);
});

test("segurança: callbackUrl externo (open redirect) é ignorado no login", async ({ page }, info) => {
  watch(page);
  const c = await newClient("redirect", info);
  await page.goto(`/login?callbackUrl=${encodeURIComponent("https://evil.example.com/phish")}`);
  await page.getByLabel("E-mail", { exact: true }).fill(c.email);
  await page.getByLabel("Senha", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  expect(new URL(page.url()).hostname).toBe("localhost");
  expectClean(page);
});

// ---------- conta e veículos ----------
test("conta: editar dados, CRUD de veículos pela interface, limite e IDOR (veículo de outra cliente dá 404)", async ({ browser }, info) => {
  const a = await newClient("conta-a", info);
  const b = await newClient("conta-b", info);
  const bVehicle = await prisma.vehicle.create({ data: { userId: b.id, brand: "Honda", model: "Civic", plate: "BBB2B22" } });
  const { ctx, page } = await clientPage(browser, info, a.email);

  await page.goto("/minha-conta");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/Minha\s+conta/i);
  await expect(page.getByText(a.email)).toBeVisible();
  await check(page, info, "42-minha-conta-vazia");
  await basicA11y(page, "/minha-conta");

  // Perfil: nome e celular (e-mail é só leitura); erros por campo.
  await page.getByRole("button", { name: "Editar dados" }).click();
  await expect(page.getByLabel("E-mail", { exact: true })).toHaveAttribute("readonly", "");
  await page.getByLabel(/WhatsApp/).fill("123");
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(page.getByText(/celular válido com DDD/)).toBeVisible();
  await page.getByLabel(/WhatsApp/).fill("(21) 97777-1234");
  await page.getByLabel("Nome completo").fill("Cliente Conta Alterada");
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(page.getByText("Dados atualizados.")).toBeVisible();
  const row = await prisma.user.findUniqueOrThrow({ where: { id: a.id } });
  expect(row).toMatchObject({ name: "Cliente Conta Alterada", phone: "(21) 97777-1234", email: a.email, role: "CLIENTE" });

  // Veículo novo: erro de placa, depois sucesso.
  await page.goto("/minha-conta/veiculos/novo");
  await page.getByLabel("Marca").fill("Jeep");
  await page.getByLabel("Modelo").fill("Compass");
  await page.getByLabel("Placa").fill("ABC-12");
  await page.getByRole("button", { name: "Cadastrar veículo" }).click();
  await expect(page.getByText(/placa válida/)).toBeVisible();
  await check(page, info, "43-veiculo-erro");
  await page.getByLabel("Placa").fill("abc-1234");
  await page.getByLabel("Ano (opcional)").fill("2022");
  await page.getByLabel("Cor (opcional)").fill("Preto");
  await page.getByRole("button", { name: "Cadastrar veículo" }).click();
  await expect(page).toHaveURL(/\/minha-conta\/veiculos\?salvo=1/);
  await expect(page.getByText("Veículo salvo.")).toBeVisible();
  await expect(page.getByText("Jeep Compass")).toBeVisible();
  await expect(page.getByText(/ABC-1234/)).toBeVisible(); // formato antigo exibido com hífen
  await check(page, info, "44-veiculos");
  const mine = await prisma.vehicle.findFirstOrThrow({ where: { userId: a.id } });
  expect(mine).toMatchObject({ plate: "ABC1234", year: 2022, color: "Preto" }); // gravada normalizada

  // Placa duplicada na mesma conta.
  await page.goto("/minha-conta/veiculos/novo");
  await page.getByLabel("Marca").fill("Fiat");
  await page.getByLabel("Modelo").fill("Argo");
  await page.getByLabel("Placa").fill("ABC1234");
  await page.getByRole("button", { name: "Cadastrar veículo" }).click();
  await expect(page.getByText(/já cadastrou um veículo com essa placa/)).toBeVisible();

  // Edição e remoção em duas etapas.
  await page.goto(`/minha-conta/veiculos/${mine.id}/editar`);
  await page.getByLabel("Modelo").fill("Compass Limited");
  await page.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(page.getByText("Jeep Compass Limited")).toBeVisible();
  await page.getByRole("link", { name: /Jeep Compass Limited/ }).click();
  await page.getByRole("button", { name: "Remover este veículo" }).click();
  await expect(page.getByText(/Tem certeza/)).toBeVisible();
  await page.getByRole("button", { name: "Voltar" }).click();
  expect(await prisma.vehicle.count({ where: { userId: a.id } })).toBe(1); // "Voltar" não remove

  // IDOR: veículo de outra cliente responde 404 (tela e dados intactos).
  const res = await page.goto(`/minha-conta/veiculos/${bVehicle.id}/editar`);
  expect(res!.status()).toBe(404);
  expect(await prisma.vehicle.findUniqueOrThrow({ where: { id: bVehicle.id } })).toMatchObject({ userId: b.id, model: "Civic" });

  await page.goto(`/minha-conta/veiculos/${mine.id}/editar`);
  await page.getByRole("button", { name: "Remover este veículo" }).click();
  await page.getByRole("button", { name: "Sim, remover" }).click();
  await expect(page).toHaveURL(/removido=1/);
  await expect(page.getByText("Nenhum veículo cadastrado")).toBeVisible();
  expect(await prisma.vehicle.count({ where: { userId: a.id } })).toBe(0);

  // Visitante não entra em /minha-conta.
  const anon = await browser.newContext({ baseURL: `http://localhost:${E2E_PORT}` });
  const ap = await anon.newPage();
  await ap.goto("/minha-conta");
  await expect(ap).toHaveURL(/\/login\?callbackUrl=/);
  await anon.close();
  issues.get(page)!.length = 0; // os 404 acima são o resultado esperado
  await ctx.close();
});

// ---------- reagendar e confirmação ----------
test("reagendar pela interface: troca o horário, mantém o resto e confirma; reserva de outra cliente dá 404", async ({ browser }, info) => {
  const a = await newClient("reag-a", info);
  const b = await newClient("reag-b", info);
  const H = info.project.name === "desktop" ? { mine: 15, to: 17, theirs: 16 } : { mine: 9, to: 11, theirs: 10 }; // horas próprias de cada projeto (o banco é compartilhado)
  const hh = (n: number) => String(n).padStart(2, "0") + ":00";
  const iso = slotIso(52, H.mine);
  const day = spKey(new Date(iso));
  const mine = await seedAppointment(a.id, iso, "Higienização de ar-condicionado", "RRR1R11");
  const theirs = await seedAppointment(b.id, slotIso(52, H.theirs), "Higienização de ar-condicionado", info.project.name === "desktop" ? "SSS2S22" : "TTT3T33");

  const { ctx, page } = await clientPage(browser, info, a.email);
  await page.goto(`/meus-agendamentos/${mine.id}`);
  await expect(page.getByText("Fiat Argo")).toBeVisible();
  await expect(page.getByText("RRR1R11")).toBeVisible(); // a própria cliente vê a placa completa no detalhe
  await expect(page.getByRole("link", { name: "Reagendar" })).toBeVisible();
  await check(page, info, "45-detalhe-reagendar");
  await page.getByRole("link", { name: "Reagendar" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/Reagendar/i);
  await expect(page.getByText(/Horário atual/)).toBeVisible();

  await pickDay(page, day);
  // O próprio horário aparece (a reserva é ignorada na lista) mas não pode ser "confirmado" como novo horário.
  await page.getByRole("button", { name: hh(H.mine), exact: true }).click();
  await expect(page.getByText(/já é o horário do seu agendamento/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirmar novo horário" })).toBeDisabled();
  await page.getByRole("button", { name: hh(H.to), exact: true }).click();
  await check(page, info, "46-reagendar");
  await page.getByRole("button", { name: "Confirmar novo horário" }).click();
  await expect(page).toHaveURL(/\/meus-agendamentos\/.*reagendado=1/);
  await expect(page.getByText(/reagendado/i).first()).toBeVisible();
  await expect(page.getByText(hh(H.to)).first()).toBeVisible();

  const after = await prisma.appointment.findUniqueOrThrow({ where: { id: mine.id } });
  expect(after.startAt.toISOString()).toBe(slotIso(52, H.to));
  expect(after).toMatchObject({ status: "CONFIRMADA", vehiclePlateSnapshot: "RRR1R11", serviceName: "Higienização de ar-condicionado" });
  expect(await prisma.auditLog.count({ where: { action: "booking_rescheduled", targetId: mine.id } })).toBe(1);

  // IDOR: confirmação, detalhe e reagendamento de outra cliente respondem 404 e nada muda.
  for (const url of [`/agendar/confirmado/${theirs.id}`, `/meus-agendamentos/${theirs.id}`, `/meus-agendamentos/${theirs.id}/reagendar`]) {
    const res = await page.goto(url);
    expect(res!.status(), url).toBe(404);
  }
  expect((await prisma.appointment.findUniqueOrThrow({ where: { id: theirs.id } })).startAt.toISOString()).toBe(theirs.startAt.toISOString());

  // A página de confirmação da própria reserva abre.
  await page.goto(`/agendar/confirmado/${mine.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/Agendamento\s+confirmado/i);
  await expect(page.getByRole("link", { name: "Ver agendamentos" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Salvar no Google Agenda/ })).toBeVisible();
  await check(page, info, "47-confirmado-reagendada");
  issues.get(page)!.length = 0;
  await ctx.close();
});

// ---------- recuperar senha ----------
test("recuperar senha: resposta genérica, limite, link inválido, uso único e sessões antigas encerradas", async ({ browser, page }, info) => {
  watch(page);
  const u = await newClient("recupera", info);
  const other = await newClient("recupera-b", info);
  const { ctx: oldCtx, page: oldPage } = await clientPage(browser, info, u.email); // sessão aberta ANTES da redefinição
  await oldPage.goto("/minha-conta");
  await expect(oldPage.getByRole("heading", { level: 1 })).toContainText(/Minha\s+conta/i);

  // Mesma mensagem para conta existente e inexistente.
  await page.goto("/recuperar-senha");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/Recuperar\s+senha/i);
  await basicA11y(page, "/recuperar-senha");
  await page.getByLabel("E-mail", { exact: true }).fill(u.email);
  await page.getByRole("button", { name: "Enviar link" }).click();
  const known = await page.getByText(/Se existir uma conta com este e-mail/).innerText();
  await page.goto("/recuperar-senha");
  await page.getByLabel("E-mail", { exact: true }).fill(`ninguem-${stamp}@example.com`);
  await page.getByRole("button", { name: "Enviar link" }).click();
  const unknown = await page.getByText(/Se existir uma conta com este e-mail/).innerText();
  expect(unknown).toBe(known);
  await check(page, info, "48-recuperar-senha-enviado");
  // O token nunca aparece na tela, e só o hash é guardado.
  expect(await page.content()).not.toMatch(/token=/);
  await expect.poll(() => prisma.passwordResetToken.count({ where: { userId: u.id } })).toBeGreaterThanOrEqual(1);
  expect(await prisma.passwordResetToken.count({ where: { user: { email: `ninguem-${stamp}@example.com` } } })).toBe(0);
  const stored = await prisma.passwordResetToken.findFirstOrThrow({ where: { userId: u.id } });
  expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);

  // Limite por e-mail: o 4º pedido em seguida é barrado.
  for (let i = 0; i < 4; i++) {
    await page.goto("/recuperar-senha");
    await page.getByLabel("E-mail", { exact: true }).fill(other.email);
    await page.getByRole("button", { name: "Enviar link" }).click();
    if (i < 3) await expect(page.getByText(/Se existir uma conta/)).toBeVisible();
  }
  await expect(page.getByText(/Muitos pedidos de recuperação/)).toBeVisible();

  // Link inválido.
  await page.goto("/redefinir-senha?token=lixo-qualquer-que-nao-existe-123456");
  await expect(page.getByText(/inválido, expirou ou já foi usado/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Pedir um novo link" })).toBeVisible();

  // Link válido (criado direto no banco, como o e-mail entregaria): política de senha, sucesso e uso único.
  const token = `tok-${stamp}-${info.project.name}-` + "x".repeat(30);
  await prisma.passwordResetToken.updateMany({ where: { userId: u.id }, data: { usedAt: new Date() } });
  await prisma.passwordResetToken.create({
    data: { userId: u.id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 20 * 60_000) },
  });
  await page.goto(`/redefinir-senha?token=${token}`);
  await check(page, info, "49-redefinir-senha");
  await basicA11y(page, "/redefinir-senha");
  await page.getByLabel("Nova senha", { exact: true }).fill("12345678");
  await page.getByLabel("Confirmar nova senha").fill("12345678");
  await page.getByRole("button", { name: "Redefinir senha" }).click();
  await expect(page.getByText(/muito comum/)).toBeVisible();
  await page.getByLabel("Nova senha", { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel("Confirmar nova senha").fill("diferente");
  await page.getByRole("button", { name: "Redefinir senha" }).click();
  await expect(page.getByText(/não coincidem/)).toBeVisible();
  await page.getByLabel("Nova senha", { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel("Confirmar nova senha").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Redefinir senha" }).click();
  await expect(page).toHaveURL(/\/login\?senha=alterada/);
  await expect(page.getByText("Senha alterada. Entre com a nova senha.")).toBeVisible();

  // A senha nova vale, a antiga não, e o link não pode ser usado de novo.
  await page.getByLabel("E-mail", { exact: true }).fill(u.email);
  await page.getByLabel("Senha", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByText(/incorretos/)).toBeVisible();
  await page.getByLabel("Senha", { exact: true }).fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  await page.goto(`/redefinir-senha?token=${token}`);
  await expect(page.getByText(/inválido, expirou ou já foi usado/)).toBeVisible();

  // A sessão aberta antes da redefinição foi encerrada.
  await oldPage.goto("/meus-agendamentos");
  await expect(oldPage).toHaveURL(/\/login/);
  await oldCtx.close();
  issues.get(page)!.length = 0; // 401 do login recusado é esperado
});

// ---------- larguras e acessibilidade ----------
test("larguras 390, 768, 1024 e 1440: sem rolagem horizontal, um h1, imagens com alt, alvos de 44px; capturas", async ({ browser, page }, info) => {
  test.skip(info.project.name !== "desktop", "este teste muda a largura sozinho; roda uma vez");
  test.setTimeout(240_000);
  watch(page);
  const c = await newClient("largura", info);
  await prisma.vehicle.create({ data: { userId: c.id, brand: "Fiat", model: "Argo", plate: "WWW1W11" } });
  const svc = await service("Lavagem detalhada");
  const startAt = slotIso(33, 10);
  const veh = await prisma.vehicle.findFirstOrThrow({ where: { userId: c.id } });

  const publicPages = ["/", "/servicos", "/login", "/cadastro", "/recuperar-senha", "/redefinir-senha?token=x"];
  const clientPages = [
    "/agendar",
    `/agendar/horario?serviceId=${svc.id}`,
    `/agendar/veiculo?serviceId=${svc.id}&startAt=${encodeURIComponent(startAt)}`,
    `/agendar/revisar?serviceId=${svc.id}&startAt=${encodeURIComponent(startAt)}&vehicleId=${veh.id}`,
    "/meus-agendamentos",
    "/minha-conta",
    "/minha-conta/veiculos",
    "/minha-conta/veiculos/novo",
  ];
  const adminPages = ["/admin", "/admin/agendamentos", "/admin/servicos", "/admin/horarios", "/admin/faturamento", "/admin/configuracoes", "/admin/configuracoes/google", "/admin/logs"];

  const widths = [390, 768, 1024, 1440];
  const slug = (p: string) => (p === "/" ? "home" : p.replace(/\?.*/, "").replace(/^\//, "").replace(/[\/\[\]]/g, "-"));

  const visit = async (p: Page, url: string, w: number) => {
    await p.setViewportSize({ width: w, height: 900 });
    await p.goto(url);
    await p.waitForLoadState("networkidle");
    await noHScroll(p, `${url} @${w}`);
    await basicA11y(p, `${url} @${w}`);
    await shot(p, info, `${slug(url)}-${w}`, "larguras");
  };

  for (const w of widths) for (const url of publicPages) await visit(page, url, w);

  const client = await clientPage(browser, info, c.email);
  for (const w of widths) for (const url of clientPages) await visit(client.page, url, w);
  expectClean(client.page);
  await client.ctx.close();

  const admin = await clientPage(browser, info, ADMIN.email, ADMIN.password);
  for (const w of widths) for (const url of adminPages) await visit(admin.page, url, w);
  expectClean(admin.page);
  await admin.ctx.close();
  issues.get(page)!.length = 0; // /redefinir-senha com link falso é uma tela de aviso, não erro
});

test("menu móvel: abre, navega por teclado, Esc fecha e devolve o foco", async ({ page }, info) => {
  test.skip(info.project.name === "desktop", "o menu recolhido só existe no celular");
  watch(page);
  await page.goto("/");
  const toggle = page.getByRole("button", { name: "Abrir menu" });
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(page.getByRole("button", { name: "Fechar menu" })).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("navigation", { name: "Menu principal" }).getByRole("link", { name: "Serviços" })).toBeVisible();
  await check(page, info, "50-menu-movel");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Abrir menu" })).toBeFocused();
  await toggle.click();
  await page.getByRole("navigation", { name: "Menu principal" }).getByRole("link", { name: "Serviços" }).click();
  await expect(page).toHaveURL(/\/servicos$/);
  expectClean(page);
});
