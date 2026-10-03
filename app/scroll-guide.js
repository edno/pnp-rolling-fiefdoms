/**
 * Scroll Guide - on narrow/portrait screens, the sheet is split across stacked
 * `.sheet-window`s with a sticky `.action-bar` at the top. guideTo() nudges the
 * viewport to a target element at step transitions (dice -> buildings -> plot, etc.)
 * so the player doesn't have to hunt for the next control.
 */

export function guideTo(el, { block = "center" } = {}) {
  if (!el) return;
  try {
    if (typeof window === "undefined" || !window.matchMedia) return;
    if (!window.matchMedia("(max-width: 1100px)").matches) return;

    const rect = el.getBoundingClientRect();
    const actionBar = document.querySelector(".action-bar");
    const barHeight = actionBar ? actionBar.getBoundingClientRect().height : 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;

    const fullyVisible = rect.top >= barHeight && rect.bottom <= viewportHeight;
    if (fullyVisible) return;

    const reduceMotion = Boolean(
      window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
    el.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block });
  } catch {
    // Scrolling is a nice-to-have UX affordance; never let it break the game flow.
  }
}
