/**
 * i18n - Minimal translation loader and lookup helper.
 *
 * Locale data lives in ./locales/<code>.js as a plain nested object of
 * strings. Add a new locale by dropping a file there and registering it
 * in LOCALES below.
 */
import en from "./locales/en.js";

const LOCALES = { en };
const DEFAULT_LOCALE = "en";
const PLACEHOLDER_RE = /\{(\w+)\}/g;

let currentLocale = DEFAULT_LOCALE;
let strings = LOCALES[DEFAULT_LOCALE];

export function supportedLocales() {
  return Object.keys(LOCALES);
}

export function detectLocale() {
  const nav = (typeof navigator !== "undefined" && navigator.language) || DEFAULT_LOCALE;
  const short = nav.slice(0, 2).toLowerCase();
  return supportedLocales().includes(short) ? short : DEFAULT_LOCALE;
}

/**
 * Select the active locale (falls back to auto-detection, then English).
 * @param {string} [locale]
 * @returns {string} the locale actually applied
 */
export function initI18n(locale) {
  const requested = locale && LOCALES[locale] ? locale : detectLocale();
  currentLocale = LOCALES[requested] ? requested : DEFAULT_LOCALE;
  strings = LOCALES[currentLocale];
  if (typeof document !== "undefined" && document.documentElement) {
    document.documentElement.lang = currentLocale;
  }
  return currentLocale;
}

export function getLocale() {
  return currentLocale;
}

function resolveKey(key) {
  return key
    .split(".")
    .reduce((node, part) => (node && typeof node === "object" ? node[part] : undefined), strings);
}

/**
 * Look up a translation string by dotted key, interpolating {placeholder} tokens.
 * @param {string} key
 * @param {Record<string, string|number>} [params]
 */
export function t(key, params) {
  let value = resolveKey(key);
  if (value === undefined && strings !== LOCALES[DEFAULT_LOCALE]) {
    value = key
      .split(".")
      .reduce((node, part) => (node && typeof node === "object" ? node[part] : undefined), LOCALES[DEFAULT_LOCALE]);
  }
  if (typeof value !== "string") {
    if (typeof console !== "undefined") console.warn(`i18n: missing key "${key}"`);
    return key;
  }
  if (!params) return value;
  return value.replace(PLACEHOLDER_RE, (match, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

/**
 * Apply translations to static markup: [data-i18n] sets textContent,
 * [data-i18n-attr]="attr1:key1;attr2:key2" sets attributes.
 */
export function applyStaticDom(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  root.querySelectorAll("[data-i18n-attr]").forEach((el) => {
    el.getAttribute("data-i18n-attr")
      .split(";")
      .forEach((pair) => {
        const [attr, key] = pair.split(":").map((part) => part.trim());
        if (attr && key) el.setAttribute(attr, t(key));
      });
  });
  if (typeof document !== "undefined") {
    document.title = t("meta.title");
  }
}
