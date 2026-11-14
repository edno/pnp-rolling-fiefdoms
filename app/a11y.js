// Small DOM helpers for keyboard and screen-reader support. No game logic.

const NATIVE_INTERACTIVE = /^(button|a|input|select|textarea|summary)$/i;
const ID_ATTRS = [
  ["row", "col"],
  ["nodeRow", "nodeCol"],
  ["code"],
];

/**
 * Marks a non-native element as an accessible button.
 * tabindex defaults to "0" when enabled and "-1" when disabled unless overridden.
 */
export function setControlState(el, { label, disabled, pressed, tabindex } = {}) {
  if (!el) return;
  el.setAttribute("role", "button");
  if (label) el.setAttribute("aria-label", label);
  if (disabled) el.setAttribute("aria-disabled", "true");
  else el.removeAttribute("aria-disabled");
  if (typeof pressed === "boolean") el.setAttribute("aria-pressed", String(pressed));
  else el.removeAttribute("aria-pressed");
  el.setAttribute("tabindex", tabindex !== undefined ? String(tabindex) : disabled ? "-1" : "0");
}

const activationRoots = new WeakSet();

/** One delegated keydown listener: Enter/Space clicks role="button" non-native elements. */
export function initKeyboardActivation(root = document) {
  if (!root || activationRoots.has(root)) return;
  activationRoots.add(root);
  root.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
    const target = e.target;
    if (!target || typeof target.getAttribute !== "function") return;
    if (target.getAttribute("role") !== "button") return;
    if (NATIVE_INTERACTIVE.test(target.tagName)) return;
    if (target.getAttribute("aria-disabled") === "true") return;
    e.preventDefault();
    target.click();
  });
}

function selectorFor(token) {
  return Object.entries(token)
    .map(([k, v]) => `[data-${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}="${String(v).replace(/"/g, '\\"')}"]`)
    .join("");
}

/** Returns a token identifying the focused element inside container, or null. */
export function captureFocus(container) {
  const active = typeof document !== "undefined" ? document.activeElement : null;
  if (!container || !active || active === container || !container.contains(active)) return null;
  for (const attrs of ID_ATTRS) {
    if (attrs.every((a) => active.dataset?.[a] !== undefined)) {
      const token = {};
      attrs.forEach((a) => {
        token[a] = active.dataset[a];
      });
      return token;
    }
  }
  return null;
}

/** Re-focuses the element matching a token from captureFocus() after a rebuild. */
export function restoreFocus(container, token) {
  if (!container || !token) return;
  const next = container.querySelector(selectorFor(token));
  if (next && typeof next.focus === "function") next.focus({ preventScroll: true });
}

/** Arrow-key navigation among .cell elements by data-row/data-col, clamped at edges. */
export function moveGridFocus(container, event) {
  if (!container || !event) return false;
  const deltas = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
  const delta = deltas[event.key];
  const current = event.target?.closest?.(".cell");
  if (!delta || !current || !container.contains(current)) return false;
  const cells = Array.from(container.querySelectorAll(".cell"));
  const rows = cells.map((c) => Number(c.dataset.row));
  const cols = cells.map((c) => Number(c.dataset.col));
  const r = Math.min(Math.max(Number(current.dataset.row) + delta[0], 0), Math.max(...rows));
  const c = Math.min(Math.max(Number(current.dataset.col) + delta[1], 0), Math.max(...cols));
  const next = container.querySelector(`.cell[data-row="${r}"][data-col="${c}"]`);
  event.preventDefault();
  if (next && next !== current) {
    cells.forEach((cell) => cell.setAttribute("tabindex", "-1"));
    next.setAttribute("tabindex", "0");
    next.focus();
  }
  return true;
}
