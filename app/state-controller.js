import { totalInfluenceSpent } from "./influence.js";

const baseState = {
  board: [],
  populationNodes: [],
  populationAvailable: null,
  tracks: { population: 0, housing: 0, influence: 0 },
  influence: { earned: 0, spent: 0, pending: 0 },
  influenceAdjustments: {},
  influenceTarget: null,
  dice: [],
  pendingPopulation: null,
  buildChoice: null,
  pestilence: false,
  pestilenceInfo: null,
  forceForfeit: false,
  log: [],
  pendingSpringhouseTarget: null,
  selectedGuildType: null,
  activationMode: false,
  workerAllocations: null,
  activationSelection: { pop: null },
  diceRolling: false,
  locationSelection: [],
  autoLocationSelection: [],
  locationPairs: [],
  buildDice: [],
  diceLocked: false,
  lockedLocationDice: null,
  lockedBuildDice: null,
  activationComplete: false,
  pendingNextRoll: false,
  lockedLocationPairs: null,
  lastLocationDice: [],
  lastBuildDice: [],
  bannerOverride: null,
  fiefdomName: "",
  activeTurn: true,
  turnIndex: 0,
  turnTrack: 0,
  invalidSelection: false,
  finalScore: null,
  theme: "light",
  forcedLocationDice: [],
  rollAvailable: true,
  pendingTurnIndex: null,
  pendingActiveTurn: null,
  lastStatusTurnIndex: 0,
  splitUsedForBuild: false,
  noBuildOptionsLogged: false,
  nonActiveSwap: false,
  invalidSelectionMessage: null,
  forceForfeitAdvisory: false,
};

function commitPendingInfluence(state) {
  if (!state || !state.influence) {
    state.influence = { earned: 0, spent: 0, pending: 0 };
  }
  const earned = Math.max(0, state.influence?.earned || 0);
  const committed = Math.min(earned, Math.max(0, state.influence?.spent || 0));
  const remaining = Math.max(0, earned - committed);
  const adjustments = Math.min(totalInfluenceSpent(state.influenceAdjustments), remaining);
  const nextCommitted = Math.min(earned, committed + (Number.isFinite(adjustments) ? adjustments : 0));
  state.influence.spent = nextCommitted;
  state.influence.pending = 0;
}

export function createState() {
  return JSON.parse(JSON.stringify(baseState));
}

export function resetTurnState(state) {
  commitPendingInfluence(state);
  state.pendingSpringhouseTarget = null;
  state.pendingPopulation = null;
  state.buildChoice = null;
  state.selectedGuildType = null;
  state.locationSelection = [];
  state.autoLocationSelection = [];
  state.locationPairs = [];
  state.buildDice = [];
  state.diceLocked = false;
  state.lockedLocationDice = null;
  state.lockedBuildDice = null;
  state.activationComplete = false;
  state.pendingNextRoll = false;
  state.lockedLocationPairs = null;
  state.lastLocationDice = [];
  state.lastBuildDice = [];
  state.bannerOverride = null;
  state.invalidSelection = false;
  state.forceForfeit = false;
  state.pestilence = false;
  state.pestilenceInfo = null;
  state.dice = [];
  state.forcedLocationDice = [];
  state.splitUsedForBuild = false;
  state.noBuildOptionsLogged = false;
  state.nonActiveSwap = false;
  state.invalidSelectionMessage = null;
  state.forceForfeitAdvisory = false;
  state.influenceAdjustments = {};
  state.influenceTarget = null;
  // rollAvailable intentionally not reset here to preserve per-turn lock until explicitly re-enabled
}

export function lockDiceSnapshot(state, { markPendingNextRoll = false, uniqueLocationPairs } = {}) {
  if (state.diceLocked) {
    if (markPendingNextRoll) state.pendingNextRoll = true;
    return;
  }
  if (!state.dice?.length) return;
  const locSnapshot = state.locationSelection.map((i) => state.dice[i]).filter(Boolean);
  const buildSnapshot = state.dice.filter((_, idx) => !state.locationSelection.includes(idx));
  const lockedLocationPairs =
    state.locationPairs?.length > 0
      ? state.locationPairs.map((p) => p.slice())
      : locSnapshot.length === 2 && uniqueLocationPairs
        ? uniqueLocationPairs(locSnapshot)
        : null;
  state.lockedLocationDice = locSnapshot;
  state.lockedBuildDice = buildSnapshot;
  state.lockedLocationPairs = lockedLocationPairs;
  if (markPendingNextRoll) state.pendingNextRoll = true;
  state.diceLocked = true;
}
