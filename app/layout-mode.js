/**
 * Layout Mode - shared helper to detect the compact (narrow screen) layout
 * where the sheet windows are scaled down and touch-sized controls (e.g. the
 * building picker in the sticky action bar) are shown instead of the small
 * sheet overlay hitboxes.
 */

export function isCompactLayout() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(max-width: 1100px)").matches;
}
