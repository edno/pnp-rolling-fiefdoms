const baseState = {
  board: [],
  populationNodes: [],
  populationAvailable: null,
  tracks: { population: 0, housing: 0 },
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
  invalidSelection: false,
  finalScore: null,
  theme: "light",
};

export function createState() {
  return JSON.parse(JSON.stringify(baseState));
}

export function resetTurnState(state) {
  state.pendingSpringhouseTarget = null;
  state.pendingPopulation = null;
  state.buildChoice = null;
  state.selectedGuildType = null;
  state.locationSelection = [];
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
}

export function lockDiceSnapshot(state, { markPendingNextRoll = false, uniqueLocationPairs } = {}) {
  if (state.diceLocked) return;
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
