import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LocationInfo } from "@/components/LocationInfo";
import { ContactLinks } from "@/components/ContactLinks";
import { resolveSettings } from "@/lib/site-settings";

describe("Local do atendimento", () => {
  it("oferece a escolha de GPS e codifica todo o endereço como destino", () => {
    const site = { ...resolveSettings(null), address: "Rua São João, 10 & Vila Nova", locationNotes: "Portão preto" };
    const html = renderToStaticMarkup(createElement(LocationInfo, { site }));

    expect(html).toContain("<summary");
    expect(html).toContain("https://www.google.com/maps/dir/?api=1&amp;destination=Rua%20S%C3%A3o%20Jo%C3%A3o%2C%2010%20%26%20Vila%20Nova");
    expect(html).toContain("https://waze.com/ul?q=Rua%20S%C3%A3o%20Jo%C3%A3o%2C%2010%20%26%20Vila%20Nova");
    expect(html).toContain("https://maps.apple.com/directions?destination=Rua%20S%C3%A3o%20Jo%C3%A3o%2C%2010%20%26%20Vila%20Nova");
    expect(html).toContain("Portão preto");
    expect(html).not.toContain("Port%C3%A3o%20preto");
  });

  it("mostra a instrução de chegada sem sugerir GPS quando falta o endereço", () => {
    const site = { ...resolveSettings(null), locationNotes: "Portão preto" };
    const html = renderToStaticMarkup(createElement(LocationInfo, { site }));

    expect(html).toContain("Portão preto");
    expect(html).not.toContain("<summary");
  });

  it("exibe o Instagram configurado mesmo sem endereço ou telefone", () => {
    const site = { ...resolveSettings(null), instagramUrl: "https://www.instagram.com/garagezerozero" };
    const html = renderToStaticMarkup(createElement(LocationInfo, { site }));

    expect(html).toContain('href="https://www.instagram.com/garagezerozero"');
  });

  it("contatos e redes sociais aparecem só com o ícone, com o nome disponível para leitores de tela", () => {
    const site = { ...resolveSettings(null), phone: "(11) 3000-1234", whatsapp: "(11) 91234-5678", instagramUrl: "https://www.instagram.com/garagezerozero" };
    const html = renderToStaticMarkup(createElement(ContactLinks, { site, className: "mt-2" }));

    for (const label of ["Telefone: (11) 3000-1234", "WhatsApp: (11) 91234-5678", "Instagram"]) {
      expect(html).toContain(`aria-label="${label}"`);
    }
    // Nenhum texto visível: depois de tirar as tags (os ícones são SVG sem texto) não sobra nada.
    expect(html.replace(/<[^>]*>/g, "").trim()).toBe("");
    expect(html.match(/<svg/g)).toHaveLength(3);
    // Alvo de toque de 44 px para cada ícone.
    expect(html.match(/h-11 w-11/g)).toHaveLength(3);
  });
});
