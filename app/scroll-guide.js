/**
 * Scroll Guide - on narrow/portrait screens, the sheet is split across stacked
 * `.sheet-window`s with a sticky `.action-bar` at the top. guideTo() nudges the
 * viewport to a target element at step transitions (dice -> buildings -> plot, etc.)
 * so the player doesn't have to hunt for the next control.
 */

import { isCompactLayout } from "./layout-mode.js";

export function guideTo(el, { block = "center", minVisible = 1 } = {}) {
  if (!el) return;
  try {
    if (typeof window === "undefined" || !window.matchMedia) return;
    if (!isCompactLayout()) return;

    const rect = el.getBoundingClientRect();
    const actionBar = document.querySelector(".action-bar");
    let barHeight = actionBar ? actionBar.getBoundingClientRect().bottom : 0;
    // On narrow widths the aux row (Confirm/building picker/influence stepper)
    // is an overlay drawer below the bar (see styles.css); when open it
    // obstructs the viewport too, so targets must clear it as well.
    const aux = document.querySelector(".action-bar-aux");
    if (aux && window.getComputedStyle) {
      const auxStyle = window.getComputedStyle(aux);
      if (auxStyle.visibility === "visible") {
        const auxBottom = aux.getBoundingClientRect().bottom;
        if (auxBottom > barHeight) barHeight = auxBottom;
      }
    }
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
    const available = viewportHeight - barHeight - 16;

    if (rect.height >= available || block === "start") {
      // Place element at the top of the comfort zone (below action bar)
      // when element is taller than available space or explicitly "start"
      top = window.scrollY + rect.top - barHeight - COMFORT_MARGIN;
    } else {
      // block === "center": center the element in the available area below the bar
      const availableHeight = viewportHeight - barHeight;
      const elementHeight = rect.height;
      const centerOffset = (availableHeight - elementHeight) / 2;
      top = window.scrollY + rect.top - barHeight - centerOffset;
      // Clamp so the element's top is never above barHeight + 8
      top = Math.min(top, window.scrollY + rect.top - barHeight - COMFORT_MARGIN);
    }

    // Never place the element's top above the screen start
    top = Math.max(0, top);

    const reduceMotion = Boolean(
      window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
    window.scrollTo({ top, behavior: reduceMotion ? "auto" : "smooth" });
  } catch {
    // Scrolling is a nice-to-have UX affordance; never let it break the game flow.
  }
}
