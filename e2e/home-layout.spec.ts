import { expect, test } from "@playwright/test";

function spread(values: number[]) {
  return Math.max(...values) - Math.min(...values);
}

test("página inicial: destaques alinhados, sem preços e sem o formulário de agendamento rápido", async ({ page }, info) => {
  await page.goto("/");
  await page.evaluate(async () => { await document.fonts.ready; });
  const cards = page.getByRole("region", { name: "Serviços em destaque" }).getByRole("list").getByRole("link");
  await expect(cards).toHaveCount(3);

  // A pedido do dono: nada de "Agende seu horário" nem de valores na página inicial (os preços ficam em /servicos).
  await expect(page.getByRole("form", { name: "Agende seu horário" })).toHaveCount(0);
  await expect(page.getByText("Horário preferido")).toHaveCount(0);
  await expect(page.getByText("Você confere os horários livres")).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText("R$");
  await expect(page.locator("main")).not.toContainText("A partir de");

  const widths = info.project.name === "desktop" ? [768, 1024, 1440] : [390];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    const boxes = await cards.evaluateAll((links) => links.map((link) => {
      const card = link.getBoundingClientRect();
      const photo = link.querySelector("img")!.getBoundingClientRect();
      const caption = link.lastElementChild!.getBoundingClientRect();
      return { top: card.top, bottom: card.bottom, height: card.height, photoHeight: photo.height, captionHeight: caption.height };
    }));

    expect(spread(boxes.map((card) => card.height)), `altura dos cartões em ${width}px`).toBeLessThanOrEqual(1);
    expect(spread(boxes.map((card) => card.photoHeight)), `altura das fotos em ${width}px`).toBeLessThanOrEqual(1);
    expect(spread(boxes.map((card) => card.captionHeight)), `altura das faixas em ${width}px`).toBeLessThanOrEqual(1);
    if (width >= 768) {
      expect(spread(boxes.map((card) => card.top))).toBeLessThanOrEqual(1);
      expect(spread(boxes.map((card) => card.bottom))).toBeLessThanOrEqual(1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
});
