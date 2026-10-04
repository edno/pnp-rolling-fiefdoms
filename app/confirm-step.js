/**
 * Confirm Step - decides whether plot/forfeit/population placements require
 * an explicit Confirm step (touch devices) or commit immediately on tap
 * (mouse devices). Overridable so tests can force either mode.
 */

let override = null;

/**
 * Force needsConfirmStep() to return a fixed value (true/false), or pass
 * null to go back to the real matchMedia-based detection.
 */
export function setConfirmStepOverride(value) {
  override = value;
}

export function needsConfirmStep() {
  if (override !== null) return override;
  try {
    return Boolean(
      typeof window !== "undefined" &&
        window.matchMedia &&
        window.matchMedia("(pointer: coarse)").matches,
    );
  } catch {
    return false;
  }
}
