/**
 * ORBITAL — Capa de formato
 * -----------------------------------------------------------------------------
 * Formato de moneda y de fechas/horas en timezone del tenant.
 *
 * Cierra estructuralmente CLEAN-CORE-4 (acoplamiento moneda) y completa el
 * cierre de INTL-2 (multi-moneda). El TZ se resuelve en presentación, no en
 * el core: cierre estructural de INTL-3 (TZ-MADRID-VERCEL).
 *
 * Ver core-contract.md §7.4.
 */

const DEFAULT_LOCALE = "es-ES";
const DEFAULT_CURRENCY = "EUR";
const DEFAULT_TZ = "Europe/Madrid";

/**
 * Formatea una cantidad monetaria con el símbolo de la moneda y el separador
 * decimal del locale.
 *
 * Ejemplos (locale "es-ES"):
 *   formatMoney(180)          → "180 €"
 *   formatMoney(180, "USD")   → "180 US$"
 *   formatMoney(1234.5)       → "1234,50 €"
 *
 * Decimal places: 0 si la cantidad es entera, 2 si tiene decimales.
 */
export function formatMoney(
  amount: number,
  currency: string = DEFAULT_CURRENCY,
  locale: string = DEFAULT_LOCALE,
): string {
  const isInteger = Math.abs(amount - Math.round(amount)) < 0.005;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: isInteger ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Formatea un instante (epoch ms UTC) como hora "HH:MM" en la TZ del tenant.
 * Ejemplo: formatTime(1746450000000, "Europe/Madrid") → "10:30"
 */
export function formatTime(
  instantMs: number,
  tz: string = DEFAULT_TZ,
  locale: string = DEFAULT_LOCALE,
): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(instantMs));
}

/**
 * Formatea un instante como fecha "DD/MM/YYYY" en la TZ del tenant.
 */
export function formatDate(
  instantMs: number,
  tz: string = DEFAULT_TZ,
  locale: string = DEFAULT_LOCALE,
): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(instantMs));
}

/**
 * Formatea un instante completo "DD/MM/YYYY HH:MM" en la TZ del tenant.
 */
export function formatInstant(
  instantMs: number,
  tz: string = DEFAULT_TZ,
  locale: string = DEFAULT_LOCALE,
): string {
  return `${formatDate(instantMs, tz, locale)} ${formatTime(instantMs, tz, locale)}`;
}

/**
 * Formatea una duración en ms como "60 min" / "1h 30 min".
 */
export function formatDuration(durationMs: number): string {
  const totalMinutes = Math.round(durationMs / (60 * 1000));
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes} min`;
}