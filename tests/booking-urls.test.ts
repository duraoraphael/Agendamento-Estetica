import { describe, expect, it } from "vitest";
import { horarioUrl, revisarUrl, veiculoUrl } from "@/lib/booking-urls";

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
    const url = new URL(revisarUrl(NASTY, iso, "veh&1#x"), "http://site.test");
    expect(url.pathname).toBe("/agendar/revisar");
    expect(url.hash).toBe("");
    expect([...url.searchParams.keys()]).toEqual(["serviceId", "startAt", "vehicleId"]);
    expect(url.searchParams.get("serviceId")).toBe(NASTY);
    expect(url.searchParams.get("startAt")).toBe(iso);
    expect(url.searchParams.get("vehicleId")).toBe("veh&1#x");
  });

  it("veículo (etapa 2): serviço e as preferências de data e hora; sem preferências, só o serviço", () => {
    expect(veiculoUrl("cmabc123xyz")).toBe("/agendar/veiculo?serviceId=cmabc123xyz");
    expect(veiculoUrl("cmabc123xyz", { data: "2026-12-01", hora: "10:30" })).toBe("/agendar/veiculo?serviceId=cmabc123xyz&data=2026-12-01&hora=10%3A30");
    const url = new URL(veiculoUrl(NASTY, { data: "2026-12-01" }), "http://site.test");
    expect(url.pathname).toBe("/agendar/veiculo");
    expect([...url.searchParams.keys()]).toEqual(["serviceId", "data"]);
    expect(url.searchParams.get("serviceId")).toBe(NASTY);
  });

  it("data e hora fora do formato (ou impossíveis) são descartadas, nunca repassadas", () => {
    for (const data of ["2026-13-99", "2026-02-30", "amanhã", "2026-12-01&x=1", ""]) {
      expect(veiculoUrl("s1", { data })).toBe("/agendar/veiculo?serviceId=s1");
    }
    for (const hora of ["25:00", "10:60", "9:30", "10h", "10:30&x=1", ""]) {
      expect(veiculoUrl("s1", { hora })).toBe("/agendar/veiculo?serviceId=s1");
      expect(horarioUrl("s1", { hora })).toBe("/agendar/horario?serviceId=s1");
    }
  });

  it("horário (etapa 3): leva o veículo escolhido e as preferências; o parâmetro de conflito vem por último", () => {
    expect(horarioUrl("s1", { vehicleId: "v1", data: "2026-12-01", hora: "10:30", conflito: true })).toBe(
      "/agendar/horario?serviceId=s1&vehicleId=v1&data=2026-12-01&hora=10%3A30&conflito=1"
    );
    const url = new URL(horarioUrl("s1", { vehicleId: NASTY }), "http://site.test");
    expect([...url.searchParams.keys()]).toEqual(["serviceId", "vehicleId"]);
    expect(url.searchParams.get("vehicleId")).toBe(NASTY);
  });

  it("valor vazio continua sendo um parâmetro vazio (quem recebe decide; a página já trata ausência)", () => {
    const url = new URL(horarioUrl(""), "http://site.test");
    expect(url.searchParams.get("serviceId")).toBe("");
  });
});
