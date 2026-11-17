import { describe, expect, it } from "vitest";
import { horarioUrl, revisarUrl } from "@/lib/booking-urls";

const NASTY = "x&conflito=0#frag?a=b/../c d%20";

describe("URLs do fluxo de agendamento (achado 8)", () => {
  it("serviceId com caracteres reservados continua sendo UM valor: sem parâmetros, fragmentos ou segmentos extras", () => {
    const url = new URL(horarioUrl(NASTY, { conflito: true }), "http://site.test");
    expect(url.pathname).toBe("/agendar/horario");
    expect(url.hash).toBe("");
    expect([...url.searchParams.keys()]).toEqual(["serviceId", "conflito"]);
    expect(url.searchParams.get("serviceId")).toBe(NASTY);
    expect(url.searchParams.get("conflito")).toBe("1");
  });

  it("a injeção do achado (`x&conflito=0`) não vira um segundo parâmetro", () => {
    const url = new URL(horarioUrl("x&conflito=0", { conflito: true }), "http://site.test");
    expect(url.searchParams.getAll("conflito")).toEqual(["1"]);
    expect(url.searchParams.get("serviceId")).toBe("x&conflito=0");
  });

  it("sem `conflito` o parâmetro não aparece; ids normais (cuid) ficam legíveis", () => {
    expect(horarioUrl("cmabc123xyz")).toBe("/agendar/horario?serviceId=cmabc123xyz");
    expect(horarioUrl("cmabc123xyz", { conflito: true })).toBe("/agendar/horario?serviceId=cmabc123xyz&conflito=1");
  });

  it("revisar: serviceId e horário ISO ficam em parâmetros próprios, ida e volta sem perda", () => {
    const iso = "2026-12-01T13:00:00.000Z";
    const url = new URL(revisarUrl(NASTY, iso), "http://site.test");
    expect(url.pathname).toBe("/agendar/revisar");
    expect(url.hash).toBe("");
    expect([...url.searchParams.keys()]).toEqual(["serviceId", "startAt"]);
    expect(url.searchParams.get("serviceId")).toBe(NASTY);
    expect(url.searchParams.get("startAt")).toBe(iso);
  });

  it("valor vazio continua sendo um parâmetro vazio (quem recebe decide; a página já trata ausência)", () => {
    const url = new URL(horarioUrl(""), "http://site.test");
    expect(url.searchParams.get("serviceId")).toBe("");
  });
});
