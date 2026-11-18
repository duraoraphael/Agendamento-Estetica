import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { E2E_DATABASE_URL, E2E_ENV } from "../playwright.config";
import { FAKE_STORAGE_PORT } from "./fake-storage";

/**
 * Fotos dos serviços no navegador: criar um serviço já com fotos (envio depois do salvamento), contador, capa,
 * reordenar, remover com confirmação, limite de 6, arquivos inválidos, Storage fora do ar, vitrine pública e imagem
 * quebrada (placeholder). O Storage é o FALSO local (e2e/fake-storage.ts): nada vai para o Supabase.
 */
const prisma = new PrismaClient({ datasourceUrl: E2E_DATABASE_URL });
const ADMIN = { email: E2E_ENV.ADMIN_EMAIL, password: E2E_ENV.ADMIN_PASSWORD };
const stamp = Date.now().toString().slice(-7);
const STORAGE = `http://127.0.0.1:${FAKE_STORAGE_PORT}`;

test.describe.configure({ mode: "serial" });
test.afterAll(async () => {
  await prisma.$disconnect();
});

const nameFor = (info: TestInfo, suffix: string) => `Fotos ${info.project.name} ${stamp} ${suffix}`;

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

async function shot(page: Page, info: TestInfo, name: string) {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(r.sw, `${name}: a página rolou na horizontal (${r.sw}px > ${r.iw}px)`).toBeLessThanOrEqual(r.iw + 1);
  const dir = path.join(__dirname, "screenshots", info.project.name);
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, name + ".png"), fullPage: true });
}

const colors = [
  { r: 200, g: 30, b: 30 },
  { r: 30, g: 120, b: 200 },
  { r: 30, g: 160, b: 80 },
  { r: 230, g: 190, b: 20 },
  { r: 120, g: 40, b: 160 },
  { r: 90, g: 90, b: 90 },
  { r: 250, g: 120, b: 20 },
];
async function photo(i: number, name = `foto-${i}.jpg`) {
  const buffer = await sharp({ create: { width: 1600, height: 1000, channels: 3, background: colors[i % colors.length] } }).jpeg().toBuffer();
  return { name, mimeType: "image/jpeg", buffer };
}
const fileInput = (page: Page) => page.getByLabel("Escolher fotos do serviço");
const tiles = (page: Page) => page.getByTestId("foto-salva");
const counter = (page: Page, n: number) => expect(page.getByText(`${n} de 6 fotos`)).toBeVisible();

async function serviceIdByName(name: string) {
  const s = await prisma.service.findFirstOrThrow({ where: { name } });
  return s.id;
}
async function setStorageOffline(on: boolean) {
  const res = await fetch(`${STORAGE}/__e2e/offline?on=${on ? 1 : 0}`);
  expect(res.ok).toBe(true);
}
async function publicContext(browser: Browser, info: TestInfo) {
  return browser.newContext({ ...info.project.use, baseURL: String(info.project.use.baseURL ?? E2E_ENV.NEXTAUTH_URL) });
}

test("criar serviço com fotos: prévia, contador, capa, envio depois de salvar e miniatura na lista", async ({ page }, info) => {
  const name = nameFor(info, "A");
  await login(page, ADMIN.email, ADMIN.password);
  await page.goto("/admin/servicos/novo");
  await expect(page.getByRole("heading", { name: "Fotos do serviço" })).toBeVisible();
  await expect(page.getByText("Este serviço ainda não tem fotos.")).toBeVisible();
  await counter(page, 0);

  await page.getByLabel("Nome do serviço").fill(name);
  await page.getByLabel("Preço (R$)").fill("120,00");
  await fileInput(page).setInputFiles([await photo(0), await photo(1)]);
  await counter(page, 2);
  await expect(page.getByTestId("foto-pendente")).toHaveCount(2);
  await expect(page.getByText("Capa", { exact: true })).toHaveCount(1);
  await shot(page, info, "fotos-novo-com-previa");

  // O botão de salvar fica abaixo das fotos, longe dos botões de remover.
  const save = page.getByRole("button", { name: "Salvar serviço" });
  const firstRemove = page.getByTestId("foto-pendente").first().getByRole("button", { name: "Remover foto" });
  const saveBox = (await save.boundingBox())!;
  const removeBox = (await firstRemove.boundingBox())!;
  expect(saveBox.y - (removeBox.y + removeBox.height)).toBeGreaterThan(40);

  await save.click();
  await page.waitForURL(/\/admin\/servicos$/);
  const row = page.locator("div.card", { hasText: name });
  await expect(row).toBeVisible();
  const thumb = row.locator("img").first();
  await expect(thumb).toHaveAttribute("src", /_next\/image/);
  // Carregamento preguiçoso: a miniatura só carrega quando entra na tela (no celular a linha fica abaixo da dobra).
  await thumb.scrollIntoViewIfNeeded();
  await expect.poll(() => thumb.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

  const saved = await prisma.serviceImage.findMany({ where: { serviceId: await serviceIdByName(name) }, orderBy: { position: "asc" } });
  expect(saved.map((s) => s.position)).toEqual([0, 1]);
  expect(saved.every((s) => s.contentType === "image/webp" && s.width <= 1600 && s.height <= 1200)).toBe(true);
});

test("editar: definir capa, reordenar, remover com confirmação (e a próxima vira capa)", async ({ page }, info) => {
  const name = nameFor(info, "A");
  const id = await serviceIdByName(name);
  await login(page, ADMIN.email, ADMIN.password);
  await page.goto(`/admin/servicos/${id}/editar`);
  await counter(page, 2);
  await expect(tiles(page)).toHaveCount(2);
  await expect(page.getByText("Capa", { exact: true })).toHaveCount(1);

  const srcOf = (n: number) => tiles(page).nth(n).locator("img").first().getAttribute("src");
  const [firstBefore, secondBefore] = [await srcOf(0), await srcOf(1)];
  expect(firstBefore).not.toBe(secondBefore);

  // Definir a segunda como capa troca a ordem.
  await tiles(page).nth(1).getByRole("button", { name: "Definir como capa" }).click();
  await expect(page.getByText("Capa atualizada.")).toBeVisible();
  await expect.poll(() => srcOf(0)).toBe(secondBefore);
  const afterCover = await prisma.serviceImage.findMany({ where: { serviceId: id }, orderBy: { position: "asc" } });
  expect(afterCover).toHaveLength(2);

  // Mover de volta com "Depois ▶" na capa.
  await tiles(page).nth(0).getByRole("button", { name: /para depois/ }).click();
  await expect.poll(() => srcOf(0)).toBe(firstBefore);

  // Texto alternativo.
  await tiles(page).nth(0).getByRole("button", { name: "Texto alternativo" }).click();
  await page.getByLabel("Texto alternativo").fill("Carro preto com espuma durante a lavagem");
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(page.getByText("Texto alternativo salvo.")).toBeVisible();
  await expect(tiles(page).nth(0).locator("img").first()).toHaveAttribute("alt", "Carro preto com espuma durante a lavagem");

  // Remover: cancelar mantém; confirmar remove e a próxima vira capa.
  const coverId = (await prisma.serviceImage.findFirstOrThrow({ where: { serviceId: id, position: 0 } })).id;
  await tiles(page).nth(0).getByRole("button", { name: "Remover foto" }).click();
  await expect(page.getByRole("alertdialog", { name: /Confirmar remoção/ })).toBeVisible();
  await page.getByRole("button", { name: "Cancelar" }).click();
  await expect(tiles(page)).toHaveCount(2);
  await tiles(page).nth(0).getByRole("button", { name: "Remover foto" }).click();
  await page.getByRole("button", { name: "Sim, remover" }).click();
  await expect(page.getByText("Capa removida. A próxima foto agora é a capa.")).toBeVisible();
  await counter(page, 1);
  await expect(page.getByText("Capa", { exact: true })).toHaveCount(1);
  expect(await prisma.serviceImage.findUnique({ where: { id: coverId } })).toBeNull();
  const left = await prisma.serviceImage.findMany({ where: { serviceId: id } });
  expect(left.map((l) => l.position)).toEqual([0]);
  await shot(page, info, "fotos-editar");
});

test("arquivos inválidos, limite de 6 fotos e Storage fora do ar", async ({ page }, info) => {
  const id = await serviceIdByName(nameFor(info, "A"));
  await login(page, ADMIN.email, ADMIN.password);
  await page.goto(`/admin/servicos/${id}/editar`);
  await counter(page, 1);

  // Texto com extensão e tipo de imagem: passa na tela, o servidor recusa pelos bytes.
  await fileInput(page).setInputFiles({ name: "falso.jpg", mimeType: "image/jpeg", buffer: Buffer.from("isto não é uma imagem de verdade") });
  await expect(page.getByText(/Formato não aceito/).first()).toBeVisible();
  await page.getByTestId("foto-pendente").getByRole("button", { name: "Descartar" }).click();
  await expect(page.getByTestId("foto-pendente")).toHaveCount(0);

  // SVG é recusado já na tela.
  await fileInput(page).setInputFiles({ name: "x.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg></svg>") });
  await expect(page.getByText(/x\.svg: Formato não aceito/)).toBeVisible();

  // Storage fora do ar: erro claro, nada fica gravado e dá para tentar de novo.
  await setStorageOffline(true);
  await fileInput(page).setInputFiles(await photo(2));
  await expect(page.getByText(/Não foi possível guardar a foto no armazenamento/).first()).toBeVisible();
  expect(await prisma.serviceImage.count({ where: { serviceId: id } })).toBe(1);
  await setStorageOffline(false);
  await page.getByTestId("foto-pendente").getByRole("button", { name: "Tentar novamente" }).click();
  await counter(page, 2);
  await expect(tiles(page)).toHaveCount(2);

  // Limite: escolher 5 quando só cabem 4.
  await fileInput(page).setInputFiles([await photo(3), await photo(4), await photo(5), await photo(6), await photo(0, "sobra.jpg")]);
  await expect(page.getByText(/sobra\.jpg: limite de 6 fotos atingido/)).toBeVisible();
  await expect(tiles(page)).toHaveCount(6, { timeout: 60_000 });
  await counter(page, 6);
  await expect(page.getByRole("button", { name: "Adicionar fotos" })).toBeDisabled();
  await expect(page.getByText(/Limite de 6 fotos atingido/).first()).toBeVisible();
  expect(await prisma.serviceImage.count({ where: { serviceId: id } })).toBe(6);
  await shot(page, info, "fotos-limite-6");
});

test("vitrine pública: capa e galeria no /servicos, sem rolagem horizontal", async ({ browser }, info) => {
  const name = nameFor(info, "A");
  const ctx = await publicContext(browser, info);
  const page = await ctx.newPage();
  await page.goto("/servicos");
  const card = page.locator("li", { has: page.getByRole("heading", { name, exact: true }) }).first();
  await expect(card).toBeVisible();
  const cover = card.locator("img").first();
  await expect(cover).toHaveAttribute("src", /_next\/image/);
  await expect(cover).not.toHaveAttribute("data-placeholder", "true");
  await expect.poll(() => cover.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  // Galeria: as outras 5 fotos.
  await expect(card.getByRole("list", { name: `Mais fotos de ${name}` }).locator("img")).toHaveCount(5);
  await card.scrollIntoViewIfNeeded();
  await shot(page, info, "fotos-servicos-publico");
  await ctx.close();
});

test("imagem quebrada: o card continua inteiro e mostra o placeholder", async ({ browser, page }, info) => {
  const name = nameFor(info, "B");
  await login(page, ADMIN.email, ADMIN.password);
  await page.goto("/admin/servicos/novo");
  await page.getByLabel("Nome do serviço").fill(name);
  await page.getByLabel("Preço (R$)").fill("80,00");
  await fileInput(page).setInputFiles(await photo(4));
  await page.getByRole("button", { name: "Salvar serviço" }).click();
  await page.waitForURL(/\/admin\/servicos$/);
  expect(await prisma.serviceImage.count({ where: { serviceId: await serviceIdByName(name) } })).toBe(1);

  await setStorageOffline(true);
  try {
    const ctx = await publicContext(browser, info);
    const pub = await ctx.newPage();
    await pub.goto("/servicos");
    const card = pub.locator("li", { has: pub.getByRole("heading", { name, exact: true }) }).first();
    await expect(card).toBeVisible();
    await expect(card.locator('img[data-placeholder="true"]')).toBeVisible();
    await expect(card.getByRole("link", { name: new RegExp(`Agendar ${name}`) })).toBeVisible();
    await shot(pub, info, "fotos-imagem-quebrada");
    await ctx.close();
  } finally {
    await setStorageOffline(false);
  }
});

test("serviço sem foto continua com o placeholder da marca", async ({ browser, page }, info) => {
  const name = nameFor(info, "C");
  await login(page, ADMIN.email, ADMIN.password);
  await page.goto("/admin/servicos/novo");
  await page.getByLabel("Nome do serviço").fill(name);
  await page.getByLabel("Preço (R$)").fill("50,00");
  await page.getByRole("button", { name: "Salvar serviço" }).click();
  await page.waitForURL(/\/admin\/servicos$/);

  const ctx = await publicContext(browser, info);
  const pub = await ctx.newPage();
  await pub.goto("/servicos");
  const card = pub.locator("li", { has: pub.getByRole("heading", { name, exact: true }) }).first();
  await expect(card.locator('img[data-placeholder="true"]')).toBeVisible();
  await ctx.close();
});

test("quem não é administradora não envia fotos (visitante: 401)", async ({ request }, info) => {
  const id = await serviceIdByName(nameFor(info, "A"));
  const res = await request.post(`/api/admin/servicos/${id}/fotos`, {
    headers: { "content-type": "application/octet-stream" },
    data: (await photo(0)).buffer,
  });
  expect(res.status()).toBe(401);
});

test("excluir serviço pela tela: sem reservas exclui (com as fotos); com reservas é recusado e manda desativar", async ({ page }, info) => {
  const free = nameFor(info, "B"); // 1 foto, nunca reservado
  const empty = nameFor(info, "C"); // sem foto, nunca reservado
  const booked = nameFor(info, "D"); // com uma reserva no histórico
  const service = await prisma.service.create({ data: { name: booked, priceCents: 9000, durationMinutes: 60 } });
  const client = await prisma.user.create({
    data: { name: "Cliente Fotos", email: `fotos.${info.project.name}.${stamp}@example.com`, phone: "(11) 90000-1111", passwordHash: "x", role: "CLIENTE" },
  });
  // Um dia diferente por projeto (desktop/celular): o banco recusa reservas sobrepostas.
  const start = new Date(Date.now() + (info.project.name === "desktop" ? 40 : 41) * 24 * 3600 * 1000);
  await prisma.appointment.create({
    data: { clientId: client.id, serviceId: service.id, serviceName: booked, priceCents: 9000, durationMinutes: 60, startAt: start, endAt: new Date(start.getTime() + 3600 * 1000) },
  });

  await login(page, ADMIN.email, ADMIN.password);
  await page.goto("/admin/servicos");
  const row = (n: string) => page.locator("div.card", { hasText: n });
  const deleteBtn = (n: string) => row(n).getByRole("button", { name: `Excluir o serviço ${n}` });
  const storedObjects = async () => ((await (await fetch(`${STORAGE}/__e2e/count`)).json()) as { count: number }).count;

  // Com reservas: a janela explica e nada é apagado.
  await deleteBtn(booked).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByText("Não é possível excluir")).toBeVisible();
  await expect(dialog.getByText(/1 agendamento no histórico/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Sim, excluir" })).toHaveCount(0);
  await shot(page, info, "servico-excluir-bloqueado");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(await prisma.service.findUnique({ where: { id: service.id } })).not.toBeNull();

  // Sem reservas, com 1 foto: cancelar mantém; confirmar exclui e apaga o arquivo do Storage.
  const before = await storedObjects();
  await deleteBtn(free).click();
  await expect(dialog.getByText(/junto com a foto/)).toBeVisible();
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(row(free)).toBeVisible();
  await deleteBtn(free).click();
  await shot(page, info, "servico-excluir-confirmar");
  await dialog.getByRole("button", { name: "Sim, excluir" }).click();
  await expect(row(free)).toHaveCount(0);
  expect(await prisma.service.findFirst({ where: { name: free } })).toBeNull();
  expect(await storedObjects()).toBe(before - 1);

  // Sem reservas e sem foto.
  await deleteBtn(empty).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Sim, excluir" }).click();
  await expect(row(empty)).toHaveCount(0);

  // A reserva e o serviço com histórico continuam; o botão "Desativar" é a saída.
  await expect(row(booked)).toBeVisible();
  expect(await prisma.appointment.count({ where: { serviceId: service.id } })).toBe(1);
  await expect(row(booked).getByRole("button", { name: "Desativar" })).toBeVisible();
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(r.sw).toBeLessThanOrEqual(r.iw + 1);
});
