/**
 * i18n - Minimal translation loader and lookup helper.
 *
 * Locale data lives in ./locales/<code>.js as a plain nested object of
 * strings. Add a new locale by dropping a file there and registering it
 * in LOCALES below.
 */
import en from "./locales/en.js";
import fr from "./locales/fr.js";

const LOCALES = { en, fr };
const DEFAULT_LOCALE = "en";
const PLACEHOLDER_RE = /\{(\w+)\}/g;
const LOCALE_STORAGE_KEY = "rf-locale";

let currentLocale = DEFAULT_LOCALE;
let strings = LOCALES[DEFAULT_LOCALE];

export function supportedLocales() {
  return Object.keys(LOCALES);
}

/**
 * Human-readable name of a locale, in that locale's own language
 * (e.g. "Français" even while the UI is displayed in English).
 * @param {string} code
 */
export function localeDisplayName(code) {
  return LOCALES[code]?.meta?.languageName || code;
}

/**
 * Flag emoji representing a locale (e.g. "🇫🇷" for fr).
 * @param {string} code
 */
export function localeFlag(code) {
  return LOCALES[code]?.meta?.flag || "🌐";
}

function storedLocale() {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
      if (stored && LOCALES[stored]) return stored;
    }
  } catch {
    // ignore storage failures
  }
  return null;
}

export function detectLocale() {
  const stored = storedLocale();
  if (stored) return stored;
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

/**
 * Explicitly switch locale and persist the choice for future visits.
 * @param {string} locale
 * @returns {string} the locale actually applied
 */
export function setLocale(locale) {
  const applied = initI18n(locale);
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, applied);
    }
  } catch {
    // ignore storage failures
  }
  return applied;
}

export function getLocale() {
  return currentLocale;
}

function resolveKeyIn(key, source) {
  return key
    .split(".")
    .reduce((node, part) => (node && typeof node === "object" ? node[part] : undefined), source);
}

function resolveKey(key) {
  return resolveKeyIn(key, strings);
}

/**
 * Whether the *active* locale (not the English fallback) actually defines
 * this key. Use this to detect content that hasn't been translated yet
 * for a given locale, rather than silently falling back to English.
 * @param {string} key
 */
export function hasOwnTranslation(key) {
  return typeof resolveKeyIn(key, strings) === "string";
}

/**
 * Look up a key directly in the English locale, regardless of the active
 * locale. Used to label untranslated content explicitly as English rather
 * than presenting it as if it were localized.
 * @param {string} key
 */
export function tEnglish(key) {
  const value = resolveKeyIn(key, LOCALES[DEFAULT_LOCALE]);
  return typeof value === "string" ? value : key;
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

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/**
 * Escape a string for safe interpolation into an innerHTML-rendered translation.
 * @param {string} str
 */
export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/**
 * Apply translations to static markup: [data-i18n] sets textContent,
 * [data-i18n-attr]="attr1:key1;attr2:key2" sets attributes.
 */
export function applyStaticDom(root = typeof document !== "undefined" ? document : null) {
  if (!root) return;
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
