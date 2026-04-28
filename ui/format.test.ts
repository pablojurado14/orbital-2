import { describe, it, expect } from "vitest";
import {
  formatMoney,
  formatTime,
  formatDate,
  formatDuration,
} from "./format";

describe("formatMoney", () => {
  it("formatea EUR sin decimales si es entero", () => {
    const result = formatMoney(180);
    // "180 €" en es-ES, con espacio fino o normal — solo verificamos contenido
    expect(result).toContain("180");
    expect(result).toContain("€");
  });

  it("formatea EUR con 2 decimales si tiene fracción", () => {
    const result = formatMoney(123.45);
    expect(result).toContain("123,45");
  });

  it("acepta moneda alternativa", () => {
    const result = formatMoney(100, "USD");
    expect(result).toContain("100");
    // El símbolo varía por locale; en es-ES "USD" → "100 US$"
  });
});

describe("formatTime", () => {
  it("formatea instante en TZ Madrid", () => {
    // 28/04/2026 10:30 Madrid (CEST = UTC+2) = 08:30 UTC
    const instant = Date.UTC(2026, 3, 28, 8, 30, 0);
    expect(formatTime(instant, "Europe/Madrid")).toBe("10:30");
  });

  it("formatea instante en TZ UTC", () => {
    const instant = Date.UTC(2026, 3, 28, 8, 30, 0);
    expect(formatTime(instant, "UTC")).toBe("08:30");
  });
});

describe("formatDate", () => {
  it("formatea fecha en TZ Madrid", () => {
    const instant = Date.UTC(2026, 3, 28, 10, 0, 0);
    expect(formatDate(instant, "Europe/Madrid")).toBe("28/04/2026");
  });
});

describe("formatDuration", () => {
  it("menos de 60 min: '30 min'", () => {
    expect(formatDuration(30 * 60 * 1000)).toBe("30 min");
  });

  it("exacto 1 hora: '1h'", () => {
    expect(formatDuration(60 * 60 * 1000)).toBe("1h");
  });

  it("hora y media: '1h 30 min'", () => {
    expect(formatDuration(90 * 60 * 1000)).toBe("1h 30 min");
  });
});