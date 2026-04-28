/**
 * ORBITAL — Capa i18n
 * -----------------------------------------------------------------------------
 * Función t(key, params?) que traduce claves jerárquicas (ej: "explanation.FIT_EXACT")
 * a strings del locale activo. Locale único activo: "es" (Sesión 9).
 *
 * INTL-1 cierra al usar este módulo en lugar de strings hardcoded en componentes.
 *
 * Diseño portable: si en el futuro queremos meter next-intl, react-i18next o
 * cualquier otra librería, solo cambia este archivo. Los consumidores siguen
 * llamando t(key, params).
 *
 * Ver core-contract.md §7.3.
 */

import esMessages from "@/messages/es.json";

type Messages = Record<string, unknown>;

const LOCALES: Record<string, Messages> = {
  es: esMessages as Messages,
};

const DEFAULT_LOCALE = "es";

/**
 * Resuelve una clave jerárquica (ej: "events.gap_detected_title") en el árbol
 * de mensajes. Si no encuentra, devuelve la clave como fallback.
 */
function resolveKey(messages: Messages, key: string): string {
  const parts = key.split(".");
  let current: unknown = messages;
  for (const part of parts) {
    if (typeof current !== "object" || current === null) return key;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" ? current : key;
}

/**
 * Sustituye {placeholders} en la string traducida con los valores de params.
 */
function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, key) =>
    params[key] !== undefined ? String(params[key]) : `{${key}}`,
  );
}

/**
 * Traduce una clave del locale activo. Si la clave no existe, devuelve la
 * clave en sí (señal visible de traducción faltante).
 *
 * Uso típico:
 *   t("explanation.FIT_EXACT")
 *   → "encaje perfecto en duración"
 *
 *   t("events.gap_detected_body", { gabinete: "Gab. 4", patient: "David Q.", minutes: 60 })
 *   → "Gab. 4 · David Q. ha cancelado su cita de 60 min. Orbital detecta..."
 */
export function t(
  key: string,
  params?: Record<string, string | number>,
  locale: string = DEFAULT_LOCALE,
): string {
  const messages = LOCALES[locale] ?? LOCALES[DEFAULT_LOCALE];
  const template = resolveKey(messages, key);
  return interpolate(template, params);
}

/**
 * Traduce una lista de ExplanationCode a una string compuesta separada por
 * comas (estilo motor v7.3). Mantiene compatibilidad con el output esperado
 * por OrbitalPanel.
 */
export function translateExplanationCodes(
  codes: ReadonlyArray<string>,
  locale: string = DEFAULT_LOCALE,
): string {
  return codes
    .map((code) => t(`explanation.${code}`, undefined, locale))
    .filter(Boolean)
    .join(", ");
}