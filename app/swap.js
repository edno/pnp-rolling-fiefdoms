// DOM-free swap / pairing decisions. Every function takes the game `state`
// explicitly instead of reading a module-level variable.
import { uniqueLocationPairs, filterAvailablePairs } from "./rules.js";
import { canRescueLocationWithInfluence } from "./game-state.js";
import { applyInfluenceToDice } from "./influence.js";

export function computeSwapChoice(baseLoc = [], baseBuild = [], swapFlag = false) {
  // X dice with resolved numbers can be location dice, only X without numbers need swap
  const locHasXWithoutNumber = baseLoc.some((d) => d?.face === "X" && typeof d?.resolved !== "number");
  const buildHasXWithoutNumber = baseBuild.some((d) => d?.face === "X" && typeof d?.resolved !== "number");
  const locHasWindrose = baseLoc.some((d) => d?.face === "windrose");
  const buildHasWindrose = baseBuild.some((d) => d?.face === "windrose");

  let forcedSwap = false;
  if (locHasXWithoutNumber && !buildHasXWithoutNumber) forcedSwap = true;
  if (!locHasWindrose && buildHasWindrose) forcedSwap = true;

  const swapAllowed = !locHasXWithoutNumber && !buildHasXWithoutNumber && !forcedSwap && !(locHasWindrose && !buildHasWindrose);
  const doSwap = forcedSwap || (swapAllowed && swapFlag);
  return {
    locDice: doSwap ? baseBuild : baseLoc,
    buildDice: doSwap ? baseLoc : baseBuild,
    swapped: doSwap,
    swapAllowed,
  };
}

export function lockedPairChoice(state) {
  const baseLoc = (state.lockedLocationDice || []).slice(0, 2);
  const baseBuild = (state.lockedBuildDice || state.buildDice || []).slice(0, 2);
  return computeSwapChoice(baseLoc, baseBuild, false);
}

export function soloBaseSelections(state) {
  if (!Array.isArray(state.dice) || state.dice.length < 4) return null;
  const storedBase = Array.isArray(state.autoLocationSelection) && state.autoLocationSelection.length === 2
    ? state.autoLocationSelection.slice()
    : null;
  let baseLocIdx = storedBase;
  if (!baseLocIdx || baseLocIdx.length !== 2) {
    baseLocIdx = state.dice
      .map((die, idx) => ({ die, idx }))
      .filter(({ die }) => die?.label?.startsWith("N"))
      .map(({ idx }) => idx)
      .slice(0, 2);
  }
  if (!baseLocIdx || baseLocIdx.length !== 2) return null;
  const baseBuildIdx = state.dice
    .map((_, idx) => idx)
    .filter((idx) => !baseLocIdx.includes(idx))
    .slice(0, 2);
  if (baseBuildIdx.length !== 2) return null;
  const baseLocDice = baseLocIdx.map((i) => state.dice[i]).filter(Boolean);
  const baseBuildDice = baseBuildIdx.map((i) => state.dice[i]).filter(Boolean);
  if (baseLocDice.length !== 2 || baseBuildDice.length !== 2) return null;
  return { baseLocIdx: baseLocIdx.slice(), baseBuildIdx: baseBuildIdx.slice(), baseLocDice, baseBuildDice };
}

export function soloPairChoice(state) {
  const base = soloBaseSelections(state);
  if (!base) return { locDice: [], buildDice: [], swapped: false, swapAllowed: false };
  const choice = computeSwapChoice(base.baseLocDice, base.baseBuildDice, state.nonActiveSwap);
  return {
    ...choice,
    baseLocIdx: base.baseLocIdx,
    baseBuildIdx: base.baseBuildIdx,
    baseLocDice: base.baseLocDice,
    baseBuildDice: base.baseBuildDice,
  };
}

export function soloPairHasValidLocations(state, diceList = []) {
  if (!Array.isArray(diceList) || diceList.length !== 2) return false;
  if (!Array.isArray(state.board) || !state.board.length) return false;
  const adjusted = applyInfluenceToDice(state, diceList);
  const pairs = filterAvailablePairs(uniqueLocationPairs(adjusted), state.board);
  return pairs.length > 0;
}

export function soloPairCanBeRescued(state, diceList = []) {
  if (!Array.isArray(diceList) || diceList.length !== 2) return false;
  if (!Array.isArray(state.board) || !state.board.length) return false;
  return canRescueLocationWithInfluence(state, diceList, state.board, {
    uniqueLocationPairs,
    filterAvailablePairs,
  });
}

// Returns "hidden" when the swap button doesn't apply to the current turn at all (no dice to
// swap), a locale key naming the reason it's disabled-but-visible, or null when swap is fully
// available. Centralizing this lets the button show a grey/disabled state with an explanatory
// tooltip instead of just disappearing (see updateSwapButton()).
// True once this turn's placement or forfeit has been committed (its population may still
// be pending): the pairing is settled, so swapping it no longer applies.
export function placementCommittedThisTurn(state) {
  return Boolean(state.pendingNextRoll) || (state.pendingPopulation?.remaining || 0) > 0;
}

export function soloSwapUnavailableReasonKey(state) {
  if (state.activeTurn || state.pestilence || state.activationMode) return "hidden";
  if (placementCommittedThisTurn(state)) return "hidden";
  const choice = soloPairChoice(state);
  if (!choice.baseLocIdx || !choice.baseBuildIdx) return "hidden";
  if (!choice.swapAllowed) {
    return "html.swapUnavailableOnlyOnePairing";
  }

  const baseValid = soloPairHasValidLocations(state, choice.baseLocDice);
  const altValid = soloPairHasValidLocations(state, choice.baseBuildDice);

  const baseCanBeRescued = !baseValid && soloPairCanBeRescued(state, choice.baseLocDice);
  const altCanBeRescued = !altValid && soloPairCanBeRescued(state, choice.baseBuildDice);
  const basePossible = baseValid || baseCanBeRescued;
  const altPossible = altValid || altCanBeRescued;
  if (!basePossible && !altPossible) {
    return "html.swapUnavailableNoValidPairing";
  }

  // One pairing is possible, but if it's the one currently in effect (not the one
  // swapping would switch to), swapping would land on a pairing with no valid
  // location. `choice.swapped` reflects the pairing currently active: true means the
  // alt (base build dice as location) pairing is in effect, so swapping would switch
  // to the base pairing, and vice versa.
  const targetPossible = choice.swapped ? basePossible : altPossible;
  if (!targetPossible) {
    return "html.swapUnavailableNoValidLocationOnSwap";
  }
  return null;
}

export function soloSwapAvailable(state) {
  return soloSwapUnavailableReasonKey(state) === null;
}
