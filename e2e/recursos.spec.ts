import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import bcrypt from "bcryptjs";
import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { E2E_DATABASE_URL, E2E_ENV, E2E_PORT } from "../playwright.config";
import { completeVehicleStep, pickDay, showDay } from "./helpers";

/**
 * Verificação de tela dos recursos novos: Configurações (nome, logo, contatos), horários livres (sobreposição
 * parcial, dia sem vagas, corrida entre duas clientes), "Salvar no Google Agenda", painel de sincronização e faturamento.
 * Usa o mesmo build de produção e o mesmo banco descartável de agendamento.spec.ts.
 */
const prisma = new PrismaClient({ datasourceUrl: E2E_DATABASE_URL });
const ADMIN = { email: E2E_ENV.ADMIN_EMAIL, password: E2E_ENV.ADMIN_PASSWORD };
const PASSWORD = "Tulipa-Rosa-42";
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
    if (/ERR_ABORTED/.test(r.failure()?.errorText ?? "")) return; // pré-carregamentos cancelados pela navegação
    list.push("requestfailed: " + r.url());
  });
}
const expectClean = (page: Page) => expect(issues.get(page) ?? []).toEqual([]);

async function noHScroll(page: Page, label: string) {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(r.sw, `${label}: largura ${r.sw}px > viewport ${r.iw}px`).toBeLessThanOrEqual(r.iw + 1);
}

async function check(page: Page, info: TestInfo, name: string) {
  await noHScroll(page, name);
  const dir = path.join(__dirname, "screenshots", info.project.name);
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
  const email = `${label}-${info.project.name}-${stamp}@example.com`;
  const user = await prisma.user.create({
    data: { name: `${label} ${info.project.name}`, email, phone: "(11) 98888-1111", passwordHash: bcrypt.hashSync(PASSWORD, 10), role: "CLIENTE" },
  });
  return { ...user, email, password: PASSWORD };
}

async function clientPage(browser: Browser, info: TestInfo, client: { email: string }) {
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
  await login(page, client.email, PASSWORD);
  return { ctx, page };
}

const spKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);

/** Dia útil (ter–sex) a partir de `ahead` dias, no horário do negócio, às `hour`:`minute`, como ISO UTC. */
function slotIso(ahead: number, hour: number, minute = 0): string {
  const base = new Date();
  for (let i = ahead; i < ahead + 14; i++) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
    if (d.getDay() >= 2 && d.getDay() <= 5) {
      const p = (n: number) => String(n).padStart(2, "0");
      return new Date(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(hour)}:${p(minute)}:00-03:00`).toISOString();
    }
  }
  throw new Error("sem dia útil");
}


async function insertAppointment(clientId: string, startIso: string, serviceName: string, status = "CONFIRMADA") {
  const svc = await prisma.service.findFirstOrThrow({ where: { name: serviceName } });
  const start = new Date(startIso);
  return prisma.appointment.create({
    data: {
      clientId, serviceId: svc.id, serviceName: svc.name, priceCents: svc.priceCents, durationMinutes: svc.durationMinutes,
      startAt: start, endAt: new Date(start.getTime() + svc.durationMinutes * 60_000), status,
    },
  });
}

const slot = (page: Page, hhmm: string) => page.getByRole("button", { name: hhmm, exact: true });

async function openPicker(page: Page, serviceName: string, iso: string) {
  const svc = await prisma.service.findFirstOrThrow({ where: { name: serviceName } });
  await page.goto(`/agendar/horario?serviceId=${svc.id}`);
  await pickDay(page, spKey(new Date(iso)));
  return svc;
}

/** PNG de cor lisa (válido para o servidor: assinatura, IHDR, IDAT e IEND). */
function makePng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = table[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8 bits
  ihdr[9] = 2; // RGB
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set(rgb, 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const state: { studio?: string; address?: string; notes?: string; ahead?: number; clientId?: string; apptId?: string } = {};

// ---------- Configurações ----------
test("administradora: edita nome, logo e contatos; prévia, erros, persistência e aplicação no site", async ({ page, browser }, info) => {
  watch(page);
  state.studio = `Garage Ação & Çé #${info.project.name === "desktop" ? "D" : "M"}${stamp}`;
  state.address = "Rua das Flores, 123 — Centro, São Paulo/SP";
  state.notes = "Portão preto & interfone #3 (nos fundos)";

  await login(page, ADMIN.email, ADMIN.password);
  await page.getByRole("navigation", { name: "Painel" }).getByRole("link", { name: "Configurações", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Configurações", level: 1 })).toBeVisible();
  await expect(page.getByText(/PNG, JPEG ou WebP, até 512 KB/)).toBeVisible(); // orientação de dimensões e formato

  await page.getByLabel("Nome da empresa", { exact: true }).fill(state.studio);
  await page.getByLabel("Slogan", { exact: true }).fill("Brilho & cuidado");
  await page.getByLabel("Texto curto de apresentação").fill("Atendimento com hora marcada e muito carinho.");
  await page.getByLabel("Telefone", { exact: true }).fill("(11) 3000-1234");
  await page.getByLabel("WhatsApp", { exact: true }).fill("(11) 91234-5678");
  await page.getByLabel("Instagram", { exact: true }).fill("@studio.e2e");
  await page.getByLabel("Endereço", { exact: true }).fill(state.address);
  await page.getByLabel("Instruções de chegada").fill(state.notes);
  await expect(page.getByLabel("Prévia da identidade visual")).toContainText(state.studio); // prévia ao vivo

  // Erros: formatos/tamanhos recusados na tela e, mesmo burlando a tela, no servidor.
  await page.locator("#logo").setInputFiles({ name: "logo.gif", mimeType: "image/gif", buffer: Buffer.from("GIF89a") });
  await expect(page.getByText("Formato não aceito")).toBeVisible();
  await page.locator("#logo").setInputFiles({ name: "grande.png", mimeType: "image/png", buffer: Buffer.alloc(600 * 1024, 1) });
  await expect(page.getByText(/Arquivo grande demais/)).toBeVisible();
  await page.locator("#logo").setInputFiles({
    name: "logo.png",
    mimeType: "image/png",
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><script>alert(1)</script></svg>'),
  });
  const versionBefore = (await prisma.siteSettings.findUnique({ where: { id: 1 } }))?.logoVersion ?? 0;
  await page.getByRole("button", { name: "Salvar configurações" }).click();
  await expect(page.getByText(/Arquivos SVG não são aceitos/)).toBeVisible(); // o servidor olha os bytes, não o nome nem o tipo
  await expect(page.getByText("Não foi possível salvar. Corrija os campos destacados.")).toBeVisible();
  expect((await prisma.siteSettings.findUnique({ where: { id: 1 } }))?.logoVersion ?? 0).toBe(versionBefore); // nada foi gravado
  // O erro não apaga o que foi digitado nos outros campos.
  await expect(page.getByLabel("Endereço", { exact: true })).toHaveValue(state.address);
  await expect(page.getByLabel("WhatsApp", { exact: true })).toHaveValue("(11) 91234-5678");

  // Dados inválidos: telefone sem DDD.
  await page.locator("#logo").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: makePng(128, 128, [150, 30, 90]) });
  await page.getByLabel("Telefone", { exact: true }).fill("1234");
  await page.getByRole("button", { name: "Salvar configurações" }).click();
  await expect(page.getByText(/informe o número com DDD/)).toBeVisible();

  // Sucesso.
  await page.getByLabel("Telefone", { exact: true }).fill("(11) 3000-1234");
  await page.locator("#logo").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: makePng(128, 128, [150, 30, 90]) });
  await expect(page.getByText(/Nova logo selecionada/)).toBeVisible();
  await check(page, info, "21-configuracoes-previa");
  await page.getByRole("button", { name: "Salvar configurações" }).click();
  await expect(page.getByText("Configurações salvas. O site já usa os novos dados.")).toBeVisible();
  await expect(page.getByText(/Logo atual: PNG, 128 × 128 px/)).toBeVisible();
  await check(page, info, "22-configuracoes-salvas");

  // Persistência e cabeçalho do painel.
  await page.reload();
  await expect(page.getByLabel("Nome da empresa", { exact: true })).toHaveValue(state.studio);
  await expect(page.getByLabel("Endereço", { exact: true })).toHaveValue(state.address);
  await expect(page.getByLabel("Instagram", { exact: true })).toHaveValue("https://www.instagram.com/studio.e2e");
  await expect(page.getByRole("banner").getByText(state.studio)).toBeVisible();
  const headerLogo = page.getByRole("banner").locator('img[src^="/api/logo?v="]');
  await expect(headerLogo).toBeVisible();
  expect(await headerLogo.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

  // Visitante: login e página inicial usam o nome, a logo e os contatos novos.
  const visitor = await browser.newContext({ baseURL: `http://localhost:${E2E_PORT}`, locale: "pt-BR", viewport: page.viewportSize()! });
  const vp = await visitor.newPage();
  watch(vp);
  await vp.goto("/login");
  await expect(vp.getByRole("banner").getByText(state.studio)).toBeVisible();
  await expect(vp.getByRole("banner").locator('img[src^="/api/logo?v="]')).toBeVisible();
  await vp.goto("/");
  await expect(vp.getByText("Brilho & cuidado").first()).toBeVisible();
  await expect(vp.getByText("Atendimento com hora marcada e muito carinho.")).toBeVisible();
  await expect(vp.getByRole("link", { name: /WhatsApp: \(11\) 91234-5678/ })).toHaveAttribute("href", "https://wa.me/5511912345678");
  await expect(vp.getByRole("link", { name: /instagram/i }).first()).toHaveAttribute("href", "https://www.instagram.com/studio.e2e");
  await expect(vp.locator("footer, body").first()).toContainText(state.address);
  const logoRes = await vp.request.get("/api/logo");
  expect(logoRes.status()).toBe(200);
  expect(logoRes.headers()["content-type"]).toBe("image/png");
  expect(logoRes.headers()["x-content-type-options"]).toBe("nosniff");
  await check(vp, info, "23-home-com-identidade");
  expectClean(vp);
  await visitor.close();

  // Permissão: cliente não abre Configurações; visitante vai ao login.
  const c = await newClient("perm", info);
  const { ctx, page: cp } = await clientPage(browser, info, c);
  await cp.goto("/admin/configuracoes");
  await expect(cp).toHaveURL(/\/meus-agendamentos$/);
  await ctx.close();
  expectClean(page);
});

// ---------- Horários livres, Google Agenda e corrida ----------
test("cliente: lista só horários livres (sobreposição parcial), confirma e salva no Google Agenda com os dados certos", async ({ browser }, info) => {
  state.ahead = info.project.name === "desktop" ? 18 : 25;
  const occupant = await newClient("ocupante", info);
  const mine = await newClient("cliente", info);
  state.clientId = mine.id;
  const busyIso = slotIso(state.ahead, 14); // atendimento das 14h às 15h (60 min)
  await insertAppointment(occupant.id, busyIso, "Higienização de ar-condicionado");

  const { ctx, page } = await clientPage(browser, info, mine);
  await openPicker(page, "Higienização de ar-condicionado", busyIso);

  // 13h livre (termina às 14h) e 15h livre; 13h15, 13h30, 14h, 14h30 e 14h45 não cabem.
  await expect(slot(page, "13:00")).toBeVisible();
  await expect(slot(page, "15:00")).toBeVisible();
  for (const hhmm of ["13:15", "13:30", "14:00", "14:30", "14:45"]) await expect(slot(page, hhmm), hhmm).toHaveCount(0);
  await expect(slot(page, "12:00")).toHaveCount(0); // almoço
  await check(page, info, "24-horarios-so-livres");

  // Troca de serviço: 120 min não cabem às 13h (terminaria às 15h, dentro da reserva).
  const longSvc = await prisma.service.findFirstOrThrow({ where: { name: "Lavagem detalhada" } });
  await page.goto(`/agendar/horario?serviceId=${longSvc.id}`);
  await pickDay(page, spKey(new Date(busyIso)));
  await expect(slot(page, "15:00")).toBeVisible();
  await expect(slot(page, "13:00")).toHaveCount(0);

  // Fluxo completo com o serviço de 60 min às 15h.
  await openPicker(page, "Higienização de ar-condicionado", busyIso);
  await slot(page, "15:00").click();
  await expect(page.getByText("Horário escolhido:")).toContainText("15:00");
  await page.getByRole("button", { name: "Continuar" }).click();
  await completeVehicleStep(page);
  await expect(page).toHaveURL(/\/agendar\/revisar/);
  await expect(page.getByRole("region", { name: "Local do atendimento" })).toContainText(state.address!);
  await page.getByRole("button", { name: "Confirmar agendamento" }).click();
  await expect(page).toHaveURL(/\/agendar\/confirmado\//);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/Agendamento\s+confirmado/i);

  const appt = await prisma.appointment.findFirstOrThrow({ where: { clientId: mine.id, status: "CONFIRMADA" } });
  state.apptId = appt.id;
  expect(appt.startAt.toISOString()).toBe(slotIso(state.ahead, 15));
  expect(appt.endAt.getTime() - appt.startAt.getTime()).toBe(60 * 60_000);

  // Link do Google Agenda: parâmetros corretos e bem codificados.
  const btn = page.getByRole("link", { name: /Salvar no Google Agenda/ });
  await expect(btn).toBeVisible();
  await expect(page.getByText(/confirma o salvamento na sua conta/)).toBeVisible();
  const href = (await btn.getAttribute("href"))!;
  expect(href.startsWith("https://calendar.google.com/calendar/render?")).toBe(true);
  expect(href).toContain("%26"); // o "&" do nome do negócio foi codificado, não quebrou a URL
  expect(href).not.toMatch(/[\s"<>]/);
  const q = new URL(href).searchParams;
  const ref = appt.id.slice(-8).toUpperCase();
  const compact = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  expect(q.get("action")).toBe("TEMPLATE");
  expect(q.get("text")).toBe(`Higienização de ar-condicionado — ${state.studio}`);
  expect(q.get("dates")).toBe(`${compact(appt.startAt)}/${compact(appt.endAt)}`); // 15:00–16:00 de São Paulo = 18:00Z–19:00Z
  expect(q.get("dates")).toMatch(/T180000Z\/\d{8}T190000Z$/);
  expect(q.get("ctz")).toBe(TZ);
  expect(q.get("location")).toBe(state.address);
  expect(q.get("details")).toContain(`Reserva ${ref}`);
  expect(q.get("details")).toContain(`Como chegar: ${state.notes}`);
  expect(q.get("details")).toContain("confira o evento salvo na sua agenda");
  expect(q.get("details")).not.toContain("98888"); // sem celular da cliente
  await check(page, info, "25-confirmado-google-agenda");

  // Também nos detalhes da reserva futura; e o horário aparece no histórico/lista.
  await page.goto(`/meus-agendamentos/${appt.id}`);
  await expect(page.getByRole("link", { name: /Salvar no Google Agenda/ })).toBeVisible();
  await expect(page.getByText("15:00")).toBeVisible();
  await expect(page.getByText("60 min")).toBeVisible();
  await check(page, info, "26-detalhe-google-agenda");

  // Reserva passada ou cancelada não oferece o botão.
  // Dias diferentes por projeto: os dois compartilham o banco e o PostgreSQL recusa reservas ativas sobrepostas.
  const pastDays = info.project.name === "desktop" ? 3 : 5;
  const past = await insertAppointment(mine.id, new Date(Date.now() - pastDays * 86_400_000).toISOString(), "Higienização de ar-condicionado", "CONCLUIDA");
  await page.goto(`/meus-agendamentos/${past.id}`);
  await expect(page.getByRole("link", { name: /Salvar no Google Agenda/ })).toHaveCount(0);

  expectClean(page);
  await ctx.close();
});

test("cancelar libera o horário; faturamento e agenda da administradora acompanham", async ({ browser, page: adminPage }, info) => {
  watch(adminPage);
  const day = spKey(new Date(slotIso(state.ahead!, 15)));
  const mineRow = await prisma.user.findUniqueOrThrow({ where: { id: state.clientId! } });

  // Administradora vê a reserva na agenda e no faturamento (previsto = 150,00 da ocupante + 150,00 desta cliente).
  await login(adminPage, ADMIN.email, ADMIN.password);
  await adminPage.goto(`/admin/agendamentos?from=${day}&to=${day}`);
  await expect(adminPage.getByText(mineRow.name).first()).toBeVisible();
  await adminPage.goto(`/admin/faturamento?kind=DIARIO&ref=${day}`);
  await expect(adminPage.getByText(/R\$\s*300,00/).first()).toBeVisible(); // 2 x R$ 150,00 (serviço de 60 min)

  // A cliente cancela pela interface.
  const { ctx, page } = await clientPage(browser, info, mineRow);
  await page.goto(`/meus-agendamentos/${state.apptId}`);
  await page.getByRole("button", { name: "Cancelar agendamento" }).click();
  await page.getByRole("button", { name: "Sim, cancelar" }).click();
  await expect(page.getByText("Cancelada").first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Salvar no Google Agenda/ })).toHaveCount(0); // não é mais elegível
  expect((await prisma.appointment.findUniqueOrThrow({ where: { id: state.apptId! } })).status).toBe("CANCELADA");

  // O horário volta para a lista (a mesma cliente, e outra cliente).
  await openPicker(page, "Higienização de ar-condicionado", slotIso(state.ahead!, 15));
  await expect(slot(page, "15:00")).toBeVisible();
  await ctx.close();

  // Faturamento já reflete o cancelamento (somente a ocupante, 60,00).
  await adminPage.goto(`/admin/faturamento?kind=DIARIO&ref=${day}`);
  await expect(adminPage.getByText(/R\$\s*150,00/).first()).toBeVisible();
  await expect(adminPage.getByText(/R\$\s*300,00/)).toHaveCount(0);
  await check(adminPage, info, "27-faturamento-apos-cancelar");
  expectClean(adminPage);
});

test("duas clientes disputando o mesmo horário: só uma confirma; a outra vê aviso e lista atualizada", async ({ browser }, info) => {
  const a = await newClient("corrida-a", info);
  const b = await newClient("corrida-b", info);
  const iso = slotIso(state.ahead!, 16); // 16h, livre
  const A = await clientPage(browser, info, a);
  const B = await clientPage(browser, info, b);

  // As duas chegam à tela de revisão com o mesmo horário (ambas o viam livre).
  for (const { page } of [A, B]) {
    await openPicker(page, "Higienização de ar-condicionado", iso);
    await slot(page, "16:00").click();
    await page.getByRole("button", { name: "Continuar" }).click();
    await completeVehicleStep(page);
    await expect(page).toHaveURL(/\/agendar\/revisar/);
  }

  // Confirmam ao mesmo tempo.
  await Promise.all([
    A.page.getByRole("button", { name: "Confirmar agendamento" }).click(),
    B.page.getByRole("button", { name: "Confirmar agendamento" }).click(),
  ]);
  await Promise.all([
    A.page.waitForURL(/\/agendar\/confirmado\/|\/agendar\/horario\?.*conflito=1/),
    B.page.waitForURL(/\/agendar\/confirmado\/|\/agendar\/horario\?.*conflito=1/),
  ]);
  const winners = [A, B].filter(({ page }) => page.url().includes("/agendar/confirmado/"));
  const losers = [A, B].filter(({ page }) => page.url().includes("conflito=1"));
  expect(winners).toHaveLength(1);
  expect(losers).toHaveLength(1);
  expect(await prisma.appointment.count({ where: { startAt: new Date(iso), status: "CONFIRMADA" } })).toBe(1); // sem reserva dupla

  const loser = losers[0].page;
  await expect(loser.getByText(/Esse horário não está mais disponível/)).toBeVisible();
  await pickDay(loser, spKey(new Date(iso)));
  await expect(slot(loser, "17:00")).toBeVisible();
  await expect(slot(loser, "16:00")).toHaveCount(0); // a lista já vem sem o horário perdido
  await check(loser, info, "28-corrida-aviso");

  // Horário escolhido que é ocupado enquanto a tela está aberta: a seleção cai, a lista atualiza e há aviso.
  await slot(loser, "17:00").click();
  await expect(loser.getByText("Horário escolhido:")).toContainText("17:00");
  const other = await newClient("corrida-c", info);
  await insertAppointment(other.id, slotIso(state.ahead!, 17), "Higienização de ar-condicionado");
  await loser.evaluate(() => window.dispatchEvent(new Event("focus"))); // o que acontece ao voltar para a aba
  await expect(loser.getByText(/O horário das 17:00 acabou de ser ocupado/)).toBeVisible();
  await expect(loser.getByText("Escolha um horário para continuar.")).toBeVisible();
  await expect(slot(loser, "17:00")).toHaveCount(0);
  await expect(loser.getByRole("button", { name: "Continuar" })).toBeDisabled();

  // Dia sem expediente (segunda-feira): a data fica DESATIVADA no calendário.
  const monday = Array.from({ length: 14 }, (_, i) => new Date(Date.parse(spKey(new Date())) + (i + 1) * 86_400_000)).find((d) => d.getUTCDay() === 1)!;
  const mondayKey = monday.toISOString().slice(0, 10);
  await expect(await showDay(loser, mondayKey)).toBeDisabled();

  // Dia com expediente mas totalmente bloqueado (feriado): mensagem pedida e atalho para o próximo dia com vaga.
  // Dia fixo no fim do horizonte (+55..+59 dias): nenhum outro teste usa essa faixa (os dois projetos dividem o banco), e é
  // diferente do dia já selecionado.
  const blockedKey = spKey(new Date(slotIso(55, 12)));
  const [by, bm, bd] = blockedKey.split("-").map(Number);
  await prisma.blockedPeriod.create({
    data: { startAt: new Date(Date.UTC(by, bm - 1, bd, 3, 0)), endAt: new Date(Date.UTC(by, bm - 1, bd + 1, 3, 0)), reason: "Feriado (teste)" },
  });
  await pickDay(loser, blockedKey);
  await expect(loser.getByText("Sem horários disponíveis neste dia")).toBeVisible();
  await loser.getByRole("button", { name: "Ver próximo dia com horários" }).click();
  await expect(loser.locator("[data-date][aria-pressed='true']")).not.toHaveAttribute("data-date", blockedKey);
  await check(loser, info, "29-sem-horarios");
  await prisma.blockedPeriod.deleteMany({ where: { reason: "Feriado (teste)" } }); // não afeta as outras specs (banco compartilhado)

  for (const { page } of [A, B]) expectClean(page);
  await A.ctx.close();
  await B.ctx.close();
});

// ---------- Painel: falha de sincronização com o Google ----------
test("administradora: falha de sincronização aparece no painel, com nova tentativa", async ({ page }, info) => {
  watch(page);
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN.email } });
  const client = await newClient("sync", info);
  const iso = slotIso(info.project.name === "desktop" ? 40 : 47, 10);
  const appt = await insertAppointment(client.id, iso, "Polimento técnico");
  // Conta conectada (valores fictícios; nenhum dado real) e reserva marcada como falha.
  await prisma.googleCalendarAccount.upsert({
    where: { adminUserId: admin.id },
    update: {},
    create: { adminUserId: admin.id, accessToken: "x", refreshToken: "x", expiryDate: new Date(Date.now() + 3600_000), calendarId: "primary" },
  });
  await prisma.appointment.update({
    where: { id: appt.id },
    data: { googleSyncStatus: "ERRO", googleSyncError: "Google Agenda simulado indisponível", googleSyncAttempts: 2, googleSyncNextAt: new Date(Date.now() + 900_000) },
  });

  await login(page, ADMIN.email, ADMIN.password);
  await expect(page.getByText(/não (foi|foram) sincronizada/)).toBeVisible(); // aviso na página inicial do painel
  await page.getByRole("navigation", { name: "Painel" }).getByRole("link", { name: "Google Agenda", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sincronização das reservas" })).toBeVisible();
  const row = page.getByRole("listitem").filter({ hasText: client.name });
  await expect(row).toContainText("Google Agenda simulado indisponível");
  await expect(row).toContainText("2 tentativas");
  await check(page, info, "30-sincronizacao-falha");
  await row.getByRole("button", { name: "Tentar novamente" }).click();
  // Sem credenciais reais a nova tentativa também falha, mas é registrada (tentativa recontada) e a tela segue estável.
  await expect(page.getByRole("heading", { name: "Sincronização das reservas" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: client.name })).toContainText(/1 tentativa/);
  await prisma.googleCalendarAccount.deleteMany({ where: { adminUserId: admin.id } });
  expectClean(page);
});
