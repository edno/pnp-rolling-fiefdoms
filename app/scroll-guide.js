/**
 * Scroll Guide - on narrow/portrait screens, the sheet is split across stacked
 * `.sheet-window`s with a sticky `.action-bar` at the top. guideTo() nudges the
 * viewport to a target element at step transitions (dice -> buildings -> plot, etc.)
 * so the player doesn't have to hunt for the next control.
 */

export function guideTo(el, { block = "center", minVisible = 1 } = {}) {
  if (!el) return;
  try {
    if (typeof window === "undefined" || !window.matchMedia) return;
    if (!window.matchMedia("(max-width: 1100px)").matches) return;

    const rect = el.getBoundingClientRect();
    const actionBar = document.querySelector(".action-bar");
    const barHeight = actionBar ? actionBar.getBoundingClientRect().height : 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;

    // Comfort zone: element must be at least 8px away from bar and viewport edges
    const COMFORT_MARGIN = 8;
    const comfortTop = barHeight + COMFORT_MARGIN;
    const comfortBottom = viewportHeight - COMFORT_MARGIN;

    // Check if element is adequately visible within comfort zone
    let isAdequatelyVisible = false;
    if (minVisible >= 1) {
      // Fully visible: top >= comfortTop AND bottom <= comfortBottom
      isAdequatelyVisible = rect.top >= comfortTop && rect.bottom <= comfortBottom;
    } else {
      // Fractional visibility: visible part >= minVisible × min(rect.height, viewportHeight - barHeight)
      const visibleStart = Math.max(rect.top, comfortTop);
      const visibleEnd = Math.min(rect.bottom, comfortBottom);
      const visibleHeight = Math.max(0, visibleEnd - visibleStart);
      const maxPossibleHeight = viewportHeight - barHeight;
      const requiredHeight = minVisible * Math.min(rect.height, maxPossibleHeight);
      isAdequatelyVisible = visibleHeight >= requiredHeight;
    }

    if (isAdequatelyVisible) return;

    // Compute the scroll position based on block option
    let top;
    if (block === "start") {
      // Place element at the top of the comfort zone (below action bar)
      top = window.scrollY + rect.top - barHeight - COMFORT_MARGIN;
    } else {
      // block === "center": center the element in the available area below the bar
      const availableHeight = viewportHeight - barHeight;
      const elementHeight = rect.height;
      const centerOffset = (availableHeight - elementHeight) / 2;
      top = window.scrollY + rect.top - barHeight - centerOffset;
    }

    // Never place the element's top above the bar
    top = Math.max(0, top);

    const reduceMotion = Boolean(
      window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
    window.scrollTo({ top, behavior: reduceMotion ? "auto" : "smooth" });
  } catch {
    // Scrolling is a nice-to-have UX affordance; never let it break the game flow.
  }
}
