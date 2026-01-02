export const POPS_PER_INFLUENCE = 8;
export const FIRST_INFLUENCE_MILESTONE = 9;
export const DICE_MIN_VALUE = 1;
export const DICE_MAX_VALUE = 5;

export function earnedInfluenceFromPopulation(population = 0) {
  const popCount = Math.max(0, Math.floor(Number(population) || 0));
  if (popCount < FIRST_INFLUENCE_MILESTONE) return 0;
  return 1 + Math.floor((popCount - FIRST_INFLUENCE_MILESTONE) / POPS_PER_INFLUENCE);
}

export function isInfluenceMilestone(pipIndex = 0) {
  const pipNumber = Math.max(0, Math.floor(Number(pipIndex) || 0));
  if (pipNumber < FIRST_INFLUENCE_MILESTONE) return false;
  return (pipNumber - FIRST_INFLUENCE_MILESTONE) % POPS_PER_INFLUENCE === 0;
}

export function clampDieValue(value) {
  if (typeof value !== "number") return value;
  if (Number.isNaN(value)) return value;
  return Math.max(DICE_MIN_VALUE, Math.min(DICE_MAX_VALUE, value));
}

export function isInfluenceEligibleDie(die) {
  if (!die) return false;
  if (die.face === "windrose") return false;
  // X dice with resolved numeric values are eligible for influence
  if (die.face === "X" && typeof die.resolved !== "number") return false;
  return typeof die.resolved === "number";
}

export function influenceDeltaForDie(state, die) {
  if (!die?.label || !state?.influenceAdjustments) return 0;
  const entry = state.influenceAdjustments[die.label];
  if (!entry || typeof entry.delta !== "number") return 0;
  return entry.delta;
}

export function totalInfluenceSpent(adjustments = {}) {
  if (!adjustments || typeof adjustments !== "object") return 0;
  return Object.values(adjustments).reduce((sum, entry) => {
    const delta = typeof entry?.delta === "number" ? entry.delta : 0;
    return sum + Math.max(0, Math.abs(delta));
  }, 0);
}

export function applyInfluenceToDie(state, die) {
  if (!die) return null;
  const target = state?.influenceTarget;
  if (target && die.label !== target) return die;
  const delta = influenceDeltaForDie(state, die);
  if (!delta || !isInfluenceEligibleDie(die)) return die;
  const resolved = clampDieValue((typeof die.resolved === "number" ? die.resolved : 0) + delta);
  if (resolved === die.resolved) return die;
  return { ...die, resolved };
}

export function applyInfluenceToDice(state, dice = []) {
  if (!Array.isArray(dice) || !dice.length) return dice || [];
  let changed = false;
  const mapped = dice.map((die) => {
    const adjusted = applyInfluenceToDie(state, die);
    if (adjusted !== die) changed = true;
    return adjusted || die;
  });
  return changed ? mapped : dice;
}
