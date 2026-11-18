import { expect, type Page } from "@playwright/test";

/** Abre o menu do cabeçalho quando ele está recolhido (celular). No desktop não faz nada. */
export async function openMenu(page: Page) {
  const toggle = page.getByRole("button", { name: "Abrir menu" });
  if (await toggle.isVisible()) await toggle.click();
}

/** Clica num link do menu principal do cabeçalho (abrindo o menu no celular). */
export async function clickNav(page: Page, name: string | RegExp) {
  await openMenu(page);
  await page.getByRole("navigation", { name: /principal/i }).getByRole("link", { name, exact: typeof name === "string" }).click();
}

/** Deixa o dia (AAAA-MM-DD) visível no calendário, navegando para o mês certo (para a frente ou para trás). */
export async function showDay(page: Page, dateKey: string) {
  const btn = page.locator(`[data-date="${dateKey}"]`);
  for (let i = 0; i < 4 && !(await btn.isVisible()); i++) {
    // O primeiro [data-date] é o dia 1 do mês exibido.
    const shown = await page.locator("[data-date]").first().getAttribute("data-date");
    const goBack = shown !== null && dateKey.slice(0, 7) < shown.slice(0, 7);
    await page.getByRole("button", { name: goBack ? "Mês anterior" : "Próximo mês" }).click();
  }
  return btn;
}

/** Seleciona um dia (AAAA-MM-DD) no calendário, passando de mês se for preciso. O dia precisa estar habilitado. */
export async function pickDay(page: Page, dateKey: string) {
  await (await showDay(page, dateKey)).click();
}

/** Todos os dias habilitados do calendário visível (em ordem). */
export async function enabledDayKeys(page: Page): Promise<string[]> {
  return page.locator("[data-date]:not([disabled])").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.date as string));
}

/** Etapa "Veículo": usa o veículo já marcado ou cadastra um novo na hora; observações são opcionais. */
export async function completeVehicleStep(page: Page, opts: { plate?: string; notes?: string } = {}) {
  await expect(page).toHaveURL(/\/agendar\/veiculo/);
  const brand = page.getByLabel("Marca");
  if (await brand.isVisible()) {
    await brand.fill("Fiat");
    await page.getByLabel("Modelo").fill("Argo");
    await page.getByLabel("Placa").fill(opts.plate ?? "ABC1D23");
  }
  if (opts.notes) await page.getByLabel(/Observações/).fill(opts.notes);
  await page.getByRole("button", { name: "Continuar" }).click();
}
