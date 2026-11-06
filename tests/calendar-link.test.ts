import { describe, expect, it } from "vitest";
import { buildGoogleCalendarUrl, bookingReference, canSaveToGoogleCalendar, toGoogleCalendarDate } from "@/lib/calendar-link";
import { zonedToUtc } from "@/lib/format";

const base = (startAt: Date, minutes: number) => ({
  id: "cmw4b5en40019rez6ot53cta7",
  serviceName: "Esmaltação em gel",
  startAt,
  endAt: new Date(startAt.getTime() + minutes * 60_000),
});

describe("Link “Salvar no Google Agenda”", () => {
  it("converte 14:00 de São Paulo para UTC e respeita a duração do serviço", () => {
    const start = zonedToUtc(2026, 12, 10, 14, 0); // 14:00 BRT (UTC-3) = 17:00Z
    const url = new URL(buildGoogleCalendarUrl({ appointment: base(start, 90), studioName: "Studio" }));
    expect(url.origin + url.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("dates")).toBe("20261210T170000Z/20261210T183000Z");
    expect(url.searchParams.get("ctz")).toBe("America/Sao_Paulo");
  });

  it("formata a data sem milissegundos nem separadores", () => {
    expect(toGoogleCalendarDate(new Date("2026-03-01T03:05:09.123Z"))).toBe("20260301T030509Z");
  });

  it("codifica caracteres especiais sem quebrar a URL (&, #, acentos, quebra de linha)", () => {
    const start = zonedToUtc(2026, 12, 10, 9, 15);
    const raw = buildGoogleCalendarUrl({
      appointment: { ...base(start, 45), serviceName: "Manicure & Pedicure #1 — “Ação”" },
      studioName: "Studio João & Maria",
      address: "Rua das Flores, 123 — sala 2 / Centro? (fundos)",
      locationNotes: "Interfone 12\nSubir a escada",
      phone: "(11) 90000-0000",
    });
    // Nenhum & ou # cru dentro dos valores: a query tem exatamente os 6 pares esperados.
    expect(raw.split("?")[1].split("&")).toHaveLength(6);
    expect(raw).not.toMatch(/#/);
    const url = new URL(raw);
    expect(url.searchParams.get("text")).toBe("Manicure & Pedicure #1 — “Ação” — Studio João & Maria");
    expect(url.searchParams.get("location")).toBe("Rua das Flores, 123 — sala 2 / Centro? (fundos)");
    const details = url.searchParams.get("details")!;
    expect(details).toContain("Reserva " + bookingReference("cmw4b5en40019rez6ot53cta7"));
    expect(details).toContain("Como chegar: Interfone 12\nSubir a escada");
    expect(details).toContain("Contato do estúdio: (11) 90000-0000");
    expect(details).toContain("confira o evento salvo");
  });

  it("não inclui dados da cliente (nome, celular) nem o id completo da reserva", () => {
    const raw = buildGoogleCalendarUrl({ appointment: base(zonedToUtc(2026, 12, 10, 9, 0), 60), studioName: "Studio" });
    expect(decodeURIComponent(raw)).not.toContain("cmw4b5en40019rez6ot53cta7");
  });

  it("omite o local quando o endereço não foi configurado e limita textos enormes", () => {
    const url = new URL(
      buildGoogleCalendarUrl({
        appointment: base(zonedToUtc(2026, 12, 10, 9, 0), 60),
        studioName: "Studio",
        locationNotes: "x".repeat(5000),
      })
    );
    expect(url.searchParams.has("location")).toBe(false);
    expect(url.searchParams.get("details")!.length).toBeLessThanOrEqual(1200);
  });

  it("só reservas confirmadas e futuras são elegíveis", () => {
    const now = new Date("2026-12-01T12:00:00Z");
    const future = new Date("2026-12-02T12:00:00Z");
    const past = new Date("2026-11-30T12:00:00Z");
    expect(canSaveToGoogleCalendar({ status: "CONFIRMADA", startAt: future }, now)).toBe(true);
    expect(canSaveToGoogleCalendar({ status: "CONFIRMADA", startAt: past }, now)).toBe(false);
    for (const status of ["CANCELADA", "CONCLUIDA", "FALTA"]) {
      expect(canSaveToGoogleCalendar({ status, startAt: future }, now)).toBe(false);
    }
  });
});
