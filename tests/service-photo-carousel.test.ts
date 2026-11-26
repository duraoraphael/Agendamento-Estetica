import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ServicePhotoCarousel } from "@/components/ServicePhotoCarousel";

it("mostra só a primeira foto no carregamento e oferece navegação nos dois sentidos", () => {
  const fallback = { src: "/placeholder.webp", alt: "Garage Zero Zero", width: 800, height: 600 };
  const photos = [
    { url: "/primeira.webp", alt: "Carro antes da lavagem", width: 800, height: 600 },
    { url: "/segunda.webp", alt: "Carro depois da lavagem", width: 800, height: 600 },
  ];
  const html = renderToStaticMarkup(createElement(ServicePhotoCarousel, { photos, fallback, serviceName: "Lavagem" }));

  expect(html).toContain('alt="Carro antes da lavagem"');
  expect(html).not.toContain('alt="Carro depois da lavagem"');
  expect(html).toContain('aria-label="Foto anterior"');
  expect(html).toContain('aria-label="Próxima foto"');
});
