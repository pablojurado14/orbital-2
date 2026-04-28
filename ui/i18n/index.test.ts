/**
 * Tests de la capa i18n. Garantizan que la traducción funciona, que no rompe
 * con claves desconocidas, y que la interpolación de parámetros respeta el
 * formato.
 */

import { describe, it, expect } from "vitest";
import { t, translateExplanationCodes } from "./index";

describe("t() — traducción de claves jerárquicas", () => {
  it("traduce claves planas", () => {
    expect(t("status.confirmed")).toBe("Confirmada");
  });

  it("traduce claves anidadas (explanation.*)", () => {
    expect(t("explanation.FIT_EXACT")).toBe("encaje perfecto en duración");
  });

  it("devuelve la clave como fallback si no existe", () => {
    expect(t("does.not.exist")).toBe("does.not.exist");
  });

  it("interpola parámetros simples", () => {
    const result = t("events.suggestion_body", {
      patient: "Mónica T.",
      treatment: "Endodoncia",
      value: "180 €",
    });
    expect(result).toContain("Mónica T.");
    expect(result).toContain("Endodoncia");
    expect(result).toContain("180 €");
  });

  it("deja placeholders sin sustituir si falta el parámetro", () => {
    const result = t("events.suggestion_body", { patient: "X" });
    expect(result).toContain("X");
    expect(result).toContain("{treatment}");
  });
});

describe("translateExplanationCodes() — concatenación con coma", () => {
  it("traduce múltiples códigos con separador", () => {
    const result = translateExplanationCodes(["FIT_EXACT", "RESOURCE_MATCH"]);
    expect(result).toBe("encaje perfecto en duración, compatibilidad con gabinete");
  });

  it("ignora códigos que no traduzcan a string", () => {
    const result = translateExplanationCodes(["FIT_EXACT", "UNKNOWN_CODE"]);
    expect(result).toContain("encaje perfecto");
  });

  it("array vacío devuelve string vacía", () => {
    expect(translateExplanationCodes([])).toBe("");
  });
});