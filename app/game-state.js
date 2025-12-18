import { resetTurnState } from "./state-controller.js";
import {
  POPS_PER_INFLUENCE,
  applyInfluenceToDice,
  totalInfluenceSpent,
  isInfluenceEligibleDie,
  DICE_MIN_VALUE,
  DICE_MAX_VALUE,
} from "./influence.js";

const WINDROSE_FACE = "windrose";

// Check if die is labeled with "N" (N-type dice for auto-assignment)
const isNDie = (die) => {
  if (!die) return false;
  if (typeof die.label === "string") return die.label.startsWith("N");
  // Fallback for unlabeled dice: treat non-X faces as N-type
  return die.face !== "X";
};

function forcedLocationDiceIndices(dice) {
  if (!Array.isArray(dice)) return [];
  return dice.reduce((acc, die, idx) => {
    if (die?.face === WINDROSE_FACE) acc.push(idx);
    return acc;
  }, []);
}

function influenceBudget(state) {
  const earned = Math.max(0, state.influence?.earned || 0);
  const spent = Math.max(0, state.influence?.spent || 0);
  return Math.max(0, earned - spent);
}

export function canRescueLocationWithInfluence(
  state,
  diceList = [],
  board,
  { uniqueLocationPairs, filterAvailablePairs } = {},
) {
  if (!Array.isArray(diceList) || diceList.length !== 2) return false;
  if (!Array.isArray(board) || !board.length) return false;
  if (typeof uniqueLocationPairs !== "function" || typeof filterAvailablePairs !== "function") return false;
  const budget = influenceBudget(state);
  if (budget <= 0) return false;
  for (let idx = 0; idx < diceList.length; idx += 1) {
    const die = diceList[idx];
    if (!isInfluenceEligibleDie(die)) continue;
    const base =
      typeof die.resolved === "number"
        ? die.resolved
        : typeof die.face === "number"
          ? die.face
          : null;
    if (base === null) continue;
    for (let step = 1; step <= budget; step += 1) {
      for (const direction of [-1, 1]) {
        const nextVal = base + step * direction;
        if (nextVal < DICE_MIN_VALUE || nextVal > DICE_MAX_VALUE) continue;
        const adjustedDice = diceList.map((original, jdx) =>
          jdx === idx ? { ...original, resolved: nextVal } : { ...original },
        );
        const pairs = filterAvailablePairs(uniqueLocationPairs(adjustedDice), board);
        if (pairs.length > 0) return true;
      }
    }
  }
  return false;
}

function canRescueAnyLocationPair(state, board, helpers) {
  if (!Array.isArray(state.dice) || state.dice.length < 2) return false;
  if (influenceBudget(state) <= 0) return false;
  // Include both N dice and X dice with resolved values
  const eligibleDice = state.dice
    .map((die, idx) => ({ die, idx }))
    .filter(({ die }) => {
      if (!die) return false;
      // Include N dice
      if (isNDie(die)) return true;
      // Include X dice with resolved numeric values (they can be adjusted with influence)
      if (die.face === "X" && typeof die.resolved === "number") return true;
      return false;
    });
  for (let i = 0; i < eligibleDice.length; i += 1) {
    for (let j = i + 1; j < eligibleDice.length; j += 1) {
      const diceList = [eligibleDice[i].die, eligibleDice[j].die];
      if (
        canRescueLocationWithInfluence(state, diceList, board, helpers)
      ) {
        return true;
      }
    }
  }
  return false;
}

function autoAssignLocationDice(dice, forced = []) {
  const forcedSet = new Set(forced);
  const selection = [...forcedSet];
  const candidates = dice
    .map((die, idx) => ({ die, idx }))
    .filter(({ die }) => die && isNDie(die));
  for (const { idx } of candidates) {
    if (selection.length >= 2) break;
    if (!selection.includes(idx)) selection.push(idx);
  }
  return selection.slice(0, 2);
}

function mergeForcedLocationDice(state) {
  const forced = state.forcedLocationDice || [];
  const merged = [...new Set([...(forced || []), ...(state.locationSelection || [])])];
  state.locationSelection = merged.slice(0, 2);
}

export function beginTurn(
  state,
  dice,
  board,
  { uniqueLocationPairs, filterAvailablePairs, computePestilenceInfo, turnIndexOverride = null, activeTurnOverride = null },
) {
  const messages = [];
  resetTurnState(state);
  const newTurnIndex = typeof turnIndexOverride === "number" ? turnIndexOverride : state.turnIndex + 1;
  state.turnIndex = newTurnIndex;
  state.activeTurn = typeof activeTurnOverride === "boolean" ? activeTurnOverride : newTurnIndex % 2 === 1;
  state.pendingTurnIndex = null;
  state.pendingActiveTurn = null;
  const statusLogged = state.lastStatusTurnIndex === newTurnIndex;
  if (!statusLogged) {
    messages.push(state.activeTurn ? "Active turn." : "Non-active turn. Dice automatically assigned.");
    state.lastStatusTurnIndex = newTurnIndex;
  }
  state.dice = dice;
  state.forcedLocationDice = forcedLocationDiceIndices(state.dice);
  if (state.forcedLocationDice.length) {
    messages.push("Windrose rolled (acts as 1–5).");
  }
  state.autoLocationSelection = [];
  state.nonActiveSwap = false;

  const adjustedDice = applyInfluenceToDice(state, state.dice);
  if (!state.activeTurn) {
    state.locationSelection = autoAssignLocationDice(state.dice, state.forcedLocationDice);
    state.autoLocationSelection = state.locationSelection.slice();
    const allPairs = filterAvailablePairs(uniqueLocationPairs(adjustedDice), board);
    state.locationPairs = allPairs;
    const locDice = state.locationSelection.map((i) => adjustedDice[i]).filter(Boolean).slice(0, 2);
    const canRescue =
      allPairs.length === 0 &&
      locDice.length === 2 &&
      canRescueLocationWithInfluence(state, locDice, board, { uniqueLocationPairs, filterAvailablePairs });
    const generalRescue = canRescueAnyLocationPair(state, board, { uniqueLocationPairs, filterAvailablePairs });
    const advisory = allPairs.length === 0 && (canRescue || generalRescue);
    state.forceForfeit = allPairs.length === 0 && !advisory;
    state.forceForfeitAdvisory = advisory;
    if (allPairs.length === 0) {
      messages.push(
        state.forceForfeit
          ? "No valid location pairs; forfeit a plot."
          : "No valid location pairs; spend Influence or forfeit a plot.",
      );
    }
  } else {
    state.locationSelection = state.forcedLocationDice.slice();
    state.forceForfeit = false;
    state.forceForfeitAdvisory = false;
  }

  state.pestilence = dice.filter((d) => d.face === "X").length === 2;
  state.pestilenceInfo = state.pestilence ? computePestilenceInfo(state.dice, board) : null;
  if (state.pestilence) {
    messages.push("Pestilence! Forfeit any empty plot.");
  }
  return { messages };
}

export function selectLocationDie(state, dieIndex, { uniqueLocationPairs, filterAvailablePairs, board }) {
  if ((state.diceLocked && !state.forceForfeitAdvisory) || state.pestilence || (state.forceForfeit && !state.forceForfeitAdvisory) || state.activationMode) {
    return { invalidSelection: false };
  }
  const die = state.dice[dieIndex];
  // Allow any die with a numeric value (1-5) to be selected, including X dice when they show numbers
  // Block X dice that show the "X" face (no resolved numeric value)
  if (!die || (die.face === "X" && typeof die.resolved !== "number")) return { invalidSelection: false };
  if ((state.forcedLocationDice || []).includes(dieIndex)) {
    return { invalidSelection: false, message: "Windrose dice must stay in the location pair." };
  }

  const sel = state.locationSelection.slice();
  const existingIdx = sel.indexOf(dieIndex);
  if (existingIdx >= 0) {
    sel.splice(existingIdx, 1);
  } else if (sel.length < 2) {
    sel.push(dieIndex);
  } else {
    return { invalidSelection: false, message: "Unassign a location die before choosing another." };
  }
  state.locationSelection = sel;
  mergeForcedLocationDice(state);
  return evaluateLocationSelection(state, { uniqueLocationPairs, filterAvailablePairs, board });
}

export function evaluateLocationSelection(state, { uniqueLocationPairs, filterAvailablePairs, board }) {
  mergeForcedLocationDice(state);
  const prevForce = state.forceForfeit;
  const locationDiceRaw = state.locationSelection.map((i) => state.dice[i]).filter(Boolean);
  const buildDiceRaw =
    state.locationSelection.length === 2 ? state.dice.filter((_, idx) => !state.locationSelection.includes(idx)) : [];
  state.buildDice = buildDiceRaw;
  const locationDice = applyInfluenceToDice(state, locationDiceRaw);
  const numberedDice = applyInfluenceToDice(
    state,
    state.dice.filter((d) => d && isNDie(d)),
  );
  // Include X dice that have influence adjustments in the location pool for rescue calculations
  const influenceAdjustedDice = state.influenceTarget
    ? applyInfluenceToDice(state, state.dice.filter(d => d && d.label === state.influenceTarget))
    : [];
  const poolWithInfluence = influenceAdjustedDice.length
    ? [...numberedDice, ...influenceAdjustedDice]
    : numberedDice;
  const locationPool = state.activeTurn ? poolWithInfluence : (locationDice.length ? locationDice : poolWithInfluence);
  const allPairs = filterAvailablePairs(uniqueLocationPairs(locationPool), board);
  let locationPairs = [];
  let forceForfeit = state.diceLocked ? state.forceForfeit : allPairs.length === 0;
  let rescueHint = false;
  let invalidSelection = false;
  let message = null;

  const generalRescue = !state.diceLocked
    ? canRescueAnyLocationPair(state, board, { uniqueLocationPairs, filterAvailablePairs })
    : false;

  if (!state.diceLocked && allPairs.length === 0) {
    if (state.activeTurn) {
      state.locationSelection = Array.isArray(state.locationSelection)
        ? state.locationSelection.slice(0, 2)
        : [];
    } else {
      const numberedDice = state.dice
        .map((die, idx) => ({ die, idx }))
        .filter(({ die }) => die && isNDie(die))
        .map(({ idx }) => idx);
      const preferred = [
        ...(state.locationSelection || []),
        ...(state.forcedLocationDice || []),
      ].filter((idx, pos, arr) => arr.indexOf(idx) === pos && numberedDice.includes(idx));
      const filled = preferred.slice(0, 2);
      const fallback = numberedDice.filter((idx) => !filled.includes(idx)).slice(0, 2 - filled.length);
      state.locationSelection = filled.concat(fallback).slice(0, 2);
      state.nonActiveSwap = false;
    }
    locationPairs = [];
    if (generalRescue) {
      forceForfeit = false;
      rescueHint = true;
      invalidSelection = true;
      message = "No valid location pairs; spend Influence or forfeit a plot.";
    } else {
      forceForfeit = true;
      invalidSelection = false;
      if (!prevForce) message = "No valid location pairs; forfeit a plot.";
    }
  }

  if (state.diceLocked) {
    if (state.lockedLocationPairs) locationPairs = state.lockedLocationPairs.map((p) => p.slice());
  } else if (state.activeTurn) {
    if (locationDice.length === 2) {
      const selectedPairs = filterAvailablePairs(uniqueLocationPairs(locationDice), board);
      if (selectedPairs.length) {
        locationPairs = selectedPairs;
      } else if (allPairs.length) {
        const canAdjustSelected = canRescueLocationWithInfluence(state, locationDice, board, {
          uniqueLocationPairs,
          filterAvailablePairs,
        });
        locationPairs = [];
        invalidSelection = true;
        if (canAdjustSelected && influenceBudget(state) > 0) {
          message = "No valid plots for that pair; spend Influence or choose a different location pair.";
        } else if (!prevForce) {
          message = "No valid plots for that pair; choose a different location pair.";
        }
      } else {
        forceForfeit = true;
        if (!prevForce) message = "No valid location pairs; forfeit a plot.";
      }
    } else if (forceForfeit && !prevForce) {
      message = "No valid location pairs; forfeit a plot.";
    }
  } else {
    if (locationDice.length === 2) {
      const selectedPairs = filterAvailablePairs(uniqueLocationPairs(locationDice), board);
      if (selectedPairs.length) {
        locationPairs = selectedPairs;
      } else {
        forceForfeit = true;
      }
    }
  }

  if (forceForfeit && locationDice.length === 2) {
    const canRescue = canRescueLocationWithInfluence(state, locationDice, board, {
      uniqueLocationPairs,
      filterAvailablePairs,
    });
    if (canRescue) {
      forceForfeit = false;
      rescueHint = true;
      if (!invalidSelection) invalidSelection = true;
      message = "No valid location pairs; spend Influence or forfeit a plot.";
    }
  }

  state.locationPairs = locationPairs;
  state.forceForfeit = forceForfeit;
  state.forceForfeitAdvisory = rescueHint;
  state.invalidSelection = invalidSelection;
  state.invalidSelectionMessage = invalidSelection ? message : null;
  if (!state.activeTurn && !state.diceLocked && forceForfeit) {
    const swapped = autoSelectValidNonActivePair(state, { uniqueLocationPairs, filterAvailablePairs, board });
    if (swapped) {
      return evaluateLocationSelection(state, { uniqueLocationPairs, filterAvailablePairs, board });
    }
  }
  return { invalidSelection, forceForfeit, message };
}

function autoSelectValidNonActivePair(state, { uniqueLocationPairs, filterAvailablePairs, board }) {
  if (!Array.isArray(state.locationSelection) || state.locationSelection.length !== 2) return false;
  if (!Array.isArray(state.dice) || state.dice.length < 4) return false;
  const forced = Array.isArray(state.forcedLocationDice) ? state.forcedLocationDice : [];
  if (forced.length) return false;
  const altIdx = state.dice
    .map((_, idx) => idx)
    .filter((idx) => !state.locationSelection.includes(idx));
  if (altIdx.length !== 2) return false;
  const alternateDice = applyInfluenceToDice(
    state,
    altIdx.map((i) => state.dice[i]).filter(Boolean),
  );
  if (alternateDice.length !== 2) return false;
  const alternatePairs = filterAvailablePairs(uniqueLocationPairs(alternateDice), board);
  if (!alternatePairs.length) return false;
  state.locationSelection = altIdx.slice();
  state.buildDice = state.dice.filter((_, idx) => !altIdx.includes(idx));
  state.locationPairs = alternatePairs;
  state.forceForfeit = false;
  state.invalidSelection = false;
  state.invalidSelectionMessage = null;
  if (Array.isArray(state.autoLocationSelection) && state.autoLocationSelection.length === 2) {
    const normalize = (arr) => arr.slice().sort((a, b) => a - b);
    const current = normalize(state.locationSelection);
    const base = normalize(state.autoLocationSelection);
    const matchesBase = current.length === base.length && current.every((val, idx) => val === base[idx]);
    state.nonActiveSwap = !matchesBase;
  } else {
    state.nonActiveSwap = true;
  }
  return true;
}

export function startActivation(state) {
  if (state.activationMode) return;
  state.activationMode = true;
  state.activationComplete = false;
  state.activationSelection = { pop: null };
  state.populationAvailable = state.populationNodes.map((row) => row.slice());
  state.workerAllocations = Array.from({ length: state.board.length }, () =>
    Array.from({ length: state.board[0].length }, () => 0),
  );
  state.board.forEach((row) => row.forEach((cell) => delete cell.activationForfeit));
}

export function finishActivation(state) {
  state.activationMode = false;
  state.activationComplete = true;
}

export function evaluateAutoAdvance(state, board) {
  if (state.pendingPopulation?.remaining > 0) return "wait";
  if (boardFull(board)) return "activate";
  if (state.diceLocked) return "wait";
  return "roll";
}

export function autoAdvanceState(state, board) {
  const action = evaluateAutoAdvance(state, board);
  if (action === "activate") return { action, message: "Board full." };
  return { action, message: null };
}

export function recalcTracks(state, { computeScore, calcVagrants }) {
  const pop = state.populationNodes ? state.populationNodes.flat().reduce((a, b) => a + b, 0) : 0;
  const cottages = boardCottages(state.board);
  const housing = cottages * 4;
  const prevEarned = Math.max(0, state.influence?.earned || 0);
  const prevCommitted = Math.max(0, state.influence?.spent || 0);
  const adjustmentsSpent = totalInfluenceSpent(state.influenceAdjustments);
  const newEarned = Math.max(0, Math.floor(pop / POPS_PER_INFLUENCE));
  const committed = Math.min(prevCommitted, newEarned);
  const remaining = Math.max(0, newEarned - committed);
  const pending = Math.min(remaining, Math.max(0, adjustmentsSpent));
  const availableInfluence = Math.max(0, newEarned - committed - pending);
  state.influence = { earned: newEarned, spent: committed, pending };
  state.tracks.population = pop;
  state.tracks.housing = housing;
  state.tracks.influence = availableInfluence;
  const vagrants = calcVagrants(pop, housing);
  const scoreResult = computeScore(state.board, state.populationNodes, state.workerAllocations, {
    allowPopulationActivation: false,
  });
  return { vagrants, scoreResult, influence: { earned: newEarned, available: availableInfluence, gained: Math.max(0, newEarned - prevEarned) } };
}

export function boardFull(board) {
  return board.every((row) => row.every((c) => c.building || c.forfeited));
}

export function maybeRollAfterLockState(state) {
  if (!state.diceLocked || !state.pendingNextRoll) return "wait";
  if (state.pendingPopulation?.remaining > 0 || state.pestilence || state.forceForfeit || state.activationMode) {
    return "wait";
  }
  state.diceLocked = false;
  state.pendingNextRoll = false;
  state.lockedLocationDice = null;
  state.lockedBuildDice = null;
  state.lockedLocationPairs = null;
  return "roll";
}

export function startPopulationPlacement(state, cellCoord, count, { nodesForCell }) {
  const nodes = nodesForCell(cellCoord[0], cellCoord[1]);
  const availableNodes = nodes.filter(([nr, nc]) => (state.populationNodes?.[nr]?.[nc] || 0) === 0);
  if (!availableNodes.length) {
    state.pendingPopulation = null;
    return { started: false, message: "No available population spots around this plot; population skipped." };
  }
  state.pendingPopulation = { remaining: count, cell: cellCoord };
  return { started: true, message: `Place ${count} population on one intersection around row ${cellCoord[0] + 1}, col ${cellCoord[1] + 1}.` };
}

export function placePopulationNode(state, nr, nc, { nodesForCell, allocatePopulationToNode, popCapacity }) {
  if (!state.pendingPopulation || state.pendingPopulation.remaining <= 0) {
    return { placed: 0, message: null };
  }
  const eligible = nodesForCell(state.pendingPopulation.cell[0], state.pendingPopulation.cell[1]).some(
    ([r, c]) => r === nr && c === nc,
  );
  if (!eligible)
    return { placed: 0, message: "Population must be placed on an intersection touching the built plot." };
  if ((state.populationNodes[nr]?.[nc] || 0) > 0)
    return { placed: 0, message: "That population spot is already used." };

  const { placed, grid } = allocatePopulationToNode(
    state.populationNodes,
    nr,
    nc,
    state.pendingPopulation.remaining,
    popCapacity,
  );
  if (placed <= 0) return { placed: 0, message: "That population spot is full." };
  state.populationNodes = grid;
  const unplaced = state.pendingPopulation.remaining - placed;
  state.pendingPopulation = null;
  return {
    placed,
    unplaced,
    message:
      unplaced > 0
        ? `Placed ${placed} population; ${unplaced} could not be placed (spot full).`
        : `Placed ${placed} population on row ${nr + 1}, col ${nc + 1}.`,
  };
}

export function allocateWorker(state, popSel, buildingSel, { nodesForCell, buildingRules }) {
  if (!state.activationMode) {
    return { updated: false, message: "Workers can only be assigned during activation." };
  }
  if (!state.populationAvailable || !state.workerAllocations) {
    return { updated: false, message: "Activation not initialized." };
  }
  const [pr, pc] = popSel;
  const [br, bc] = buildingSel;
  const cell = state.board[br]?.[bc];
  if (!cell || !cell.building || cell.forfeited || cell.activationForfeit) {
    return { updated: false, message: "Select a valid building." };
  }
  const available = state.populationAvailable?.[pr]?.[pc] || 0;
  if (available <= 0) return { updated: false, message: "No available population on that node." };
  const adj = nodesForCell(br, bc).some(([nr, nc]) => nr === pr && nc === pc);
  if (!adj) return { updated: false, message: "Population must be adjacent to the building." };
  const req = Math.max(0, (buildingRules[cell.building]?.requirement || 0) - Math.max(0, Number(cell.springBoost) || 0));
  const filled = Math.max(0, state.workerAllocations?.[br]?.[bc] || 0);
  const remaining = Math.max(0, req - filled);
  if (remaining <= 0) return { updated: false, message: "Building already filled." };

  state.populationAvailable[pr][pc] = Math.max(0, available - 1);
  state.workerAllocations[br][bc] = filled + 1;
  const activated = state.workerAllocations[br][bc] >= req;
  state.activationSelection.pop = state.populationAvailable[pr][pc] > 0 ? [pr, pc] : null;
  return {
    updated: true,
    activated,
    message: activated ? `Activated ${cell.building} at row ${br + 1}, col ${bc + 1}.` : null,
  };
}

export function autoForfeitUnfillableState(state, { nodesForCell, buildingRules, finalize = false }) {
  const messages = [];
  if (!state.populationAvailable || !state.workerAllocations) return messages;
  const rows = state.board.length;
  const cols = state.board[0]?.length || 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = state.board[r][c];
      if (!cell.building || cell.forfeited) continue;
      const rule = buildingRules[cell.building];
      const req = Math.max(0, rule?.requirement || 0) - Math.max(0, Number(cell.springBoost) || 0);
      if (req <= 0) {
        delete cell.activationForfeit;
        continue;
      }
      const filled = Math.max(0, state.workerAllocations?.[r]?.[c] || 0);
      const remaining = Math.max(0, req - filled);
      if (remaining <= 0) {
        delete cell.activationForfeit;
        continue;
      }
      const availableAdj = nodesForCell(r, c)
        .map(([nr, nc]) => state.populationAvailable?.[nr]?.[nc] || 0)
        .reduce((a, b) => a + b, 0);
      const shouldForfeit = finalize ? remaining > 0 : availableAdj < remaining;
      if (shouldForfeit) {
        if (!cell.activationForfeit) {
          messages.push(
            `Could not activate ${cell.building} at row ${r + 1}, col ${c + 1}; marked forfeited for scoring.`,
          );
        }
        cell.activationForfeit = true;
      } else if (!finalize) {
        delete cell.activationForfeit;
      }
    }
  }
  return messages;
}

function boardCottages(board) {
  return board.flat().filter((c) => c.building === "C").length;
}
