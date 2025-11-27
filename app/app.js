import {
  uniqueLocationPairs,
  buildingOptionsFromDice,
  calcVagrants,
  computeScore,
  filterAvailablePairs,
  computePestilenceInfo,
  restrictBuildOptionsForBoard,
  allocatePopulationToNode,
  BUILDING_RULES,
  pestilenceAssignments,
  computeActivationMap,
  scoreBuildingAt,
} from "./rules.js";

const terrainLayout = [
  ["Mt", "Fo", "Fo", "Fo", "Se"],
  ["Mt", "..", "..", "..", "Se"],
  ["Mt", "..", "Vi", "..", "Se"],
  ["Mt", "..", "..", "..", "Se"],
  ["Mt", "Ma", "Ma", "Ma", "Se"],
];

const buildings = {
  C: { name: "Cottage", sum: null },
  F: { name: "Farm", sum: 2 },
  Q: { name: "Quarry", sum: 3 },
  W: { name: "Windmill", sum: 4 },
  M: { name: "Market", sum: 5 },
  S: { name: "Springhouse", sum: 6 },
  T: { name: "Townhall", sum: 7 },
  U: { name: "University", sum: 8 },
  A: { name: "Almshouse", sum: 9 },
  G: { name: "Guild", sum: 10 },
};

const state = {
  board: [],
  populationNodes: [],
  populationAvailable: null,
  tracks: { population: 0, housing: 0 },
  dice: [],
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
};

let controlsReady = false;

function refreshDiceVisibility() {
  const hidden = state.activationMode || state.activationComplete;
  if (diceView) diceView.style.display = hidden ? "none" : "";
  const rollBtn = document.getElementById("rollBtn");
  if (rollBtn) {
    if (!debugMode) {
      rollBtn.style.display = "none";
    } else {
      rollBtn.style.display = hidden ? "none" : "inline-block";
    }
  }
  if (turnHintEl) {
    turnHintEl.style.display = hidden ? "none" : "";
    if (!hidden && !state.activationMode && !state.activationComplete) {
      turnHintEl.style.display = "";
    }
  }
}

function toggleFullscreen() {
  const elem = document.documentElement;
  if (!document.fullscreenElement) {
    if (elem.requestFullscreen) {
      elem.requestFullscreen();
    }
  } else if (document.exitFullscreen) {
    document.exitFullscreen();
  }
}

function lockDiceSnapshot() {
  if (state.diceLocked) return;
  const locSnapshot = state.locationSelection.map((i) => state.dice[i]).filter(Boolean);
  const buildSnapshot = state.dice.filter((_, idx) => !state.locationSelection.includes(idx));
  state.lockedLocationDice = locSnapshot;
  state.lockedBuildDice = buildSnapshot;
  state.lockedLocationPairs =
    state.locationPairs?.length > 0
      ? state.locationPairs.map((p) => p.slice())
      : locSnapshot.length === 2
        ? uniqueLocationPairs(locSnapshot)
        : null;
  state.diceLocked = true;
}

const boardEl = document.getElementById("board");
const diceView = document.getElementById("diceView");
const turnHintEl = document.getElementById("turnHint");
const locDicePreview = document.getElementById("locDicePreview");
const buildDicePreview = document.getElementById("buildDicePreview");
const logEl = document.getElementById("log");
const scoreOverlayEl = document.getElementById("scoreOverlay");
const popHousingOverlay = document.getElementById("popHousingOverlay");
const guildTypes = ["GF", "GQ", "GW", "GM"];
const finishActivationBtn = document.getElementById("finishActivation");
const newGameBtn = document.getElementById("newGameBtn");
const fullscreenBtn = document.getElementById("fullscreenToggle");
const actionBannerEl = document.getElementById("actionBanner");
const loadingOverlay = document.getElementById("loadingOverlay");
const sheetEl = document.getElementById("sheet");
const regionOverlayEl = document.getElementById("regionOverlay");
const SHEET_VERSION = "v1";
const POP_CAPACITY = 5;
const POP_LAYOUT = { cols: 9, rows: 2, pipsPerCell: 4 };
const debugMode = new URLSearchParams(window.location.search).has("debug");
// Hitboxes relative to printed sheet regions (percent of Buildings/Guilds box)
const buildingHitboxes = [
  { code: "C", col: 1, row: 1 },
  { code: "F", col: 1, row: 2 },
  { code: "Q", col: 1, row: 3 },
  { code: "W", col: 1, row: 4 },
  { code: "M", col: 1, row: 5 },
  { code: "S", col: 2, row: 1 },
  { code: "T", col: 2, row: 2 },
  { code: "U", col: 2, row: 3 },
  { code: "A", col: 2, row: 4 },
  { code: "G", col: 2, row: 5 },
];
const guildHitboxes = [
  { code: "GF", col: 1, row: 1 },
  { code: "GW", col: 2, row: 1 },
  { code: "GQ", col: 1, row: 2 },
  { code: "GM", col: 2, row: 2 },
];

function countGuilds(board) {
  return board.flat().filter((cell) => cell.building === "G").length;
}

function builtGuildTypes(board) {
  const set = new Set();
  board.flat().forEach((cell) => {
    if (cell.building === "G" && cell.buildingLabel) {
      set.add(cell.buildingLabel.toUpperCase());
    }
  });
  return set;
}

const scoringSpots = [
  { key: "cottages", x: 22, y: 20 },
  { key: "farm", x: 68, y: 20 },
  { key: "quarry", x: 114, y: 20 },
  { key: "windmill", x: 158, y: 20 },
  { key: "market", x: 204, y: 20 },
  { key: "townhall", x: 246, y: 20 },
  { key: "university", x: 292, y: 20 },
  { key: "guilds", x: 336, y: 20 },
  { key: "springhouse", x: 384, y: 20 },
  { key: "vagrants", x: 428, y: 20 },
  { key: "reputation", x: 528, y: 20 },
];

function init() {
  resetState();
  renderBoard();
  renderRegionOverlay();
  updateTracks();
  updateActionBanner();
  refreshDiceVisibility();
  if (!controlsReady) {
    setupControls();
    controlsReady = true;
  }
  rollDice();
}

function resetState() {
  state.board = terrainLayout.map((row) =>
    row.map((terrain) => ({ terrain, building: null, buildingLabel: null, forfeited: false, springBoost: 0 })),
  );
  state.populationNodes = Array.from({ length: 4 }, () => Array(4).fill(0));
  state.populationAvailable = null;
  state.workerAllocations = null;
  state.locationSelection = [];
  state.locationPairs = [];
  state.diceLocked = false;
  state.lockedLocationDice = null;
  state.lockedBuildDice = null;
  state.activationComplete = false;
  state.pendingNextRoll = false;
  state.lockedLocationPairs = null;
  state.lastLocationDice = [];
  state.lastBuildDice = [];
  state.turnIndex = 0;
  state.activeTurn = true;
  state.invalidSelection = false;
  state.finalScore = null;
  state.log = [];
  if (logEl) logEl.innerHTML = "";
  if (finishActivationBtn) finishActivationBtn.style.display = "none";
  if (newGameBtn) newGameBtn.style.display = "none";
  refreshDiceVisibility();
  log("Game started.");
}

function preloadSheet() {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = sheetImageUrl();
  });
}

function sheetImageUrl() {
  return `resources/rolling-fiefdoms-player-sheet.png?v=${SHEET_VERSION}`;
}

preloadSheet().then(() => {
  document.body.classList.remove("loading");
  if (loadingOverlay) loadingOverlay.remove();
  if (sheetEl) {
    sheetEl.style.backgroundImage = `url("${sheetImageUrl()}")`;
  }
  init();
});

function setupControls() {
  const rollBtn = document.getElementById("rollBtn");
  if (rollBtn) {
    rollBtn.onclick = () => rollDice();
    rollBtn.style.display = debugMode ? "inline-block" : "none";
  }
  if (newGameBtn) {
    newGameBtn.onclick = () => newGame();
    newGameBtn.style.display = "none";
  }
  if (fullscreenBtn) {
    fullscreenBtn.onclick = () => toggleFullscreen();
  }
  const fiefdomInput = document.getElementById("fiefdomInput");
  if (fiefdomInput) {
    fiefdomInput.value = state.fiefdomName || "";
    const wrapper = fiefdomInput.closest(".fiefdom-overlay");
    const syncFilled = () => {
      if (!wrapper) return;
      const hasValue = Boolean(fiefdomInput.value && fiefdomInput.value.trim().length);
      if (hasValue) {
        wrapper.classList.add("filled");
      } else {
        wrapper.classList.remove("filled");
      }
    };
    syncFilled();
    const handleInput = (e) => {
      state.fiefdomName = e.target.value || "";
      syncFilled();
      updateActionBanner();
    };
    fiefdomInput.addEventListener("input", handleInput);
    fiefdomInput.addEventListener("change", handleInput);
    fiefdomInput.addEventListener("blur", syncFilled);
  }
  renderBuildingOverlay();
  renderGuildOverlay([]);
  if (finishActivationBtn) {
    finishActivationBtn.onclick = () => finishActivation();
    finishActivationBtn.style.display = "none";
  }
}

function rollDice() {
  state.turnIndex += 1;
  state.activeTurn = state.turnIndex % 2 === 1;
  log(state.activeTurn ? "Active turn." : "Non-active turn.");
  state.pendingSpringhouseTarget = null;
  state.pendingPopulation = null;
  state.buildChoice = null;
  state.selectedGuildType = null;
  state.pendingPopulation = null;
  state.buildChoice = null;
  state.selectedGuildType = null;
  state.locationSelection = [];
  state.locationPairs = [];
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
  if (state.activationMode) return;
  triggerDiceAnimation();
  const n1 = rollNumberedDie("N1");
  const n2 = rollNumberedDie("N2");
  const x1 = rollXDie("X1");
  const x2 = rollXDie("X2");
  state.dice = [n1, n2, x1, x2];
  if (!state.activeTurn) {
    // Non-active: auto-assign numbered dice
    state.locationSelection = [0, 1];
    const allPairs = filterAvailablePairs(uniqueLocationPairs(state.dice), state.board);
    state.locationPairs = allPairs;
    state.forceForfeit = allPairs.length === 0;
    if (state.forceForfeit) log("No valid location pairs; forfeit a plot.");
  } else {
    state.forceForfeit = false;
  }
  state.pestilence = [x1, x2].every((d) => d.face === "X");
  state.pestilenceInfo = state.pestilence ? computePestilenceInfo(state.dice, state.board) : null;
  if (state.pestilenceInfo && state.pestilenceInfo.section) {
    state.pestilenceInfo.sectionLabel = sectionLabels[state.pestilenceInfo.section] || state.pestilenceInfo.section;
  }
  if (state.pestilence) {
    const target = state.pestilenceInfo?.sectionLabel || "any section";
    if (turnHintEl) turnHintEl.textContent = `Pestilence! Forfeit a plot in ${target}.`;
    if (state.pestilenceInfo?.sectionLabel && state.pestilenceInfo.targetCells.length === 0) {
      log("Target section is full; forfeit any empty plot.");
    }
    lockDiceSnapshot();
  } else if (turnHintEl) {
    turnHintEl.textContent = state.activeTurn ? "" : "Non-active turn. Dice automatically assigned.";
  }
  updateDiceAssignments();
  renderDice();
  log(`Rolled ${describeDice(state.dice)}`);
  if (state.pestilence) {
    log(
      `Pestilence! Sum ${state.pestilenceInfo?.sum ?? "?"}${
        state.pestilenceInfo?.sectionLabel ? ` -> ${state.pestilenceInfo.sectionLabel}` : ""
      }`,
    );
  }
  updateActionBanner();
}

function rollNumberedDie(label) {
  const faces = [1, 2, 3, 4, 5, label === "N1" ? "1/2" : "4/5"];
  const face = faces[Math.floor(Math.random() * faces.length)];
  const choices = face === "1/2" ? [1, 2] : face === "4/5" ? [4, 5] : [];
  const resolved = choices.length ? choices[0] : face;
  return { label, face, choices, resolved };
}

function rollXDie(label) {
  const faces = [1, 2, 3, 4, 5, "X"];
  const face = faces[Math.floor(Math.random() * faces.length)];
  return { label, face, choices: [], resolved: typeof face === "number" ? face : null };
}

function describeDice(dice) {
  return dice
    .map((d) => {
      const face =
        d.face === "X" ? "X" : d.face === "1/2" ? "1/2" : d.face === "4/5" ? "4/5" : d.face;
      return `${d.label}:${face}`;
    })
    .join(", ");
}

function triggerDiceAnimation() {
  if (!diceView) return;
  state.diceRolling = true;
  diceView.classList.add("dice-rolling");
  state.bannerOverride = "Rolling dice...";
  updateActionBanner();
  setTimeout(() => {
    state.diceRolling = false;
    diceView.classList.remove("dice-rolling");
    state.bannerOverride = null;
    updateActionBanner();
  }, 1200);
}

function dieMaxValue(die) {
  if (!die) return 0;
  if (Array.isArray(die.choices) && die.choices.length) {
    return Math.max(...die.choices);
  }
  if (typeof die.resolved === "number") return die.resolved;
  return 0;
}

function renderDice() {
  if (!diceView) return;
  refreshDiceVisibility();
  if (state.activationMode || state.activationComplete) return;
  diceView.innerHTML = "";
  if (turnHintEl) {
    if (state.pestilence) {
      const target = state.pestilenceInfo?.sectionLabel || "any section";
      turnHintEl.textContent = `Pestilence! Forfeit a plot in ${target}.`;
    } else if (state.activeTurn && state.invalidSelection) {
      turnHintEl.textContent = "No valid plots for that pair; choose a different location pair.";
    } else if (state.forceForfeit) {
      turnHintEl.textContent = "No valid location pairs; forfeit a plot.";
    } else if (!state.activeTurn) {
      turnHintEl.textContent = "Non-active turn. Dice automatically assigned.";
    } else {
      turnHintEl.textContent = "";
    }
  }
  const field = document.createElement("div");
  field.className = "field dice-field";
  const row = document.createElement("div");
  row.className = "dice-row";
  const turnLocked = state.diceLocked || state.activationMode || state.pestilence || state.forceForfeit;
  if (turnLocked) row.classList.add("dice-locked");
  state.dice.forEach((die, idx) => {
    const isLocation = state.locationSelection.includes(idx);
    const isBuildAssigned = state.locationSelection.length === 2 || die.face === "X";
    const locked = turnLocked;
    const badge = makeDieBadge(die, idx, {
      role: isLocation ? "location" : isBuildAssigned ? "build" : null,
      locked: locked || turnLocked || die.face === "X",
      clickable: !turnLocked,
      showRoleStyle: !turnLocked,
    });
    row.appendChild(badge);
  });
  field.appendChild(row);
  diceView.appendChild(field);
  diceView.classList.toggle("dice-rolling", state.diceRolling);
}

function fillBuildings(buildDice) {
  if (state.locationSelection.length !== 2 || state.diceLocked) {
    state.buildChoice = null;
    state.selectedGuildType = null;
    renderBuildingOverlay([], true);
    return;
  }
  if (state.activationMode || state.forceForfeit || state.pestilence) {
    renderBuildingOverlay([], true);
    return;
  }
  const allowed = restrictBuildOptionsForBoard(buildingOptionsFromDice(buildDice, buildings), state.board);
  const availableGuildTypes = guildTypes.filter((t) => !builtGuildTypes(state.board).has(t));
  const options = allowed.filter((opt) => {
    if (opt.code !== "G") return true;
    return availableGuildTypes.length > 0;
  });
  enforceBuildingSelection(options);
  if (state.pendingPopulation?.remaining > 0) {
    // Lock building selection while placing population
    renderBuildingOverlay([], true);
    return;
  }
  if (!options.some((o) => o.code === state.buildChoice?.code)) {
    state.selectedGuildType = null;
  }
  renderBuildingOverlay(options);
  updateActionBanner();
}

function enforceBuildingSelection(options = []) {
  const optionCodes = new Set(options.map((o) => o.code));
  const selected = document.querySelector(".building-hit.selected");
  if (selected && !optionCodes.has(selected.dataset.code)) {
    selected.classList.remove("selected");
  }
  if (state.buildChoice && !optionCodes.has(state.buildChoice.code)) {
    state.buildChoice = null;
  }
  if (state.buildChoice?.code !== "G") {
    state.selectedGuildType = null;
    renderGuildOverlay([]);
  }
}

function renderBuildingOverlay(options = [], disabled = false) {
  const overlay = document.getElementById("buildingsOverlay");
  if (!overlay) return;
  const forceDisabled =
    disabled ||
    state.locationSelection.length !== 2 ||
    state.diceLocked ||
    state.activationMode ||
    state.forceForfeit ||
    state.pestilence;
  if ((!options || !options.length) && state.buildDice?.length && !forceDisabled) {
    const fallback = restrictBuildOptionsForBoard(buildingOptionsFromDice(state.buildDice, buildings), state.board);
    options = fallback;
  }
  overlay.innerHTML = "";
  const disableOverlay = forceDisabled || !options?.length;
  overlay.classList.toggle("disabled", disableOverlay);
  const optionMap = new Map(options.map((o) => [o.code, o]));
  buildingHitboxes.forEach((hit) => {
    const opt = disableOverlay ? null : optionMap.get(hit.code);
    const div = document.createElement("div");
    div.className = "building-hit";
    div.dataset.code = hit.code;
    div.style.gridColumn = hit.col;
    div.style.gridRow = hit.row;
    if (opt) {
      div.classList.add("available");
      if (opt.source) div.dataset.source = opt.source;
      if (opt.popGain) div.dataset.pop = opt.popGain;
      div.dataset.sourceLabel = opt.sourceLabel || "";
      if (state.buildChoice?.code === hit.code) {
        div.classList.add("selected");
      }
    } else {
      div.classList.add("disabled");
    }
    div.addEventListener("click", (e) => {
      e.stopPropagation();
      if (div.classList.contains("disabled")) return;
      if (state.locationSelection.length !== 2 || state.diceLocked) return;
      document.querySelectorAll(".building-hit.selected").forEach((el) => el.classList.remove("selected"));
      div.classList.add("selected");
      handleBuildingChoice();
      renderSelectionDice();
    });
    div.setAttribute("aria-label", `${hit.code}${opt?.sourceLabel ? ` via ${opt.sourceLabel}` : ""}`);
    overlay.appendChild(div);
  });
}

function renderBoard() {
  boardEl.innerHTML = "";
  const activationMap =
    state.activationMode || state.activationComplete
      ? computeActivationMap(state.board, state.populationNodes, currentWorkerAllocationsForScore())
      : null;
  terrainLayout.forEach((row, r) => {
    row.forEach((terrain, c) => {
      const cell = document.createElement("div");
      cell.className = "cell terrain";
      cell.dataset.row = r;
      cell.dataset.col = c;
      cell.style.gridRowStart = r + 1;
      cell.style.gridColumnStart = c + 1;
      const data = state.board[r][c];
      if (data.forfeited) {
        cell.classList.add("forfeited");
        const forfeiture = document.createElement("img");
        forfeiture.src = "assets/img/forfeit.svg";
        forfeiture.alt = "Forfeit";
        forfeiture.className = "forfeit-icon";
        cell.appendChild(forfeiture);
      } else if (data.building) {
        cell.classList.remove("terrain");
        const label = document.createElement("div");
        label.className = "label building";
        label.textContent =
          data.building === "G"
            ? (() => {
                const map = { GF: "FG", GQ: "QG", GW: "WG", GM: "MG" };
                const raw = (data.buildingLabel || "G").toUpperCase();
                return map[raw] || raw;
              })()
            : data.buildingLabel || data.building;
        cell.appendChild(label);
        if (data.activationForfeit) {
          cell.classList.add("forfeit");
          cell.classList.add("disabled");
        }
        if (state.activationMode && state.activationSelection.building?.[0] === r && state.activationSelection.building?.[1] === c) {
          cell.classList.add("selected-building");
        }
        const req = Math.max(
          0,
          (BUILDING_RULES[data.building]?.requirement || 0) - (Number(data.springBoost) || 0),
        );
        const filled = Math.max(0, state.workerAllocations?.[r]?.[c] || 0);
        const isActivated = req === 0 || filled >= req;
        if (isActivated) {
          cell.classList.add("activated-building");
          const oct = document.createElement("div");
          oct.className = "octagon-border";
          cell.appendChild(oct);
          if (
            activationMap &&
            !data.forfeited &&
            !data.activationForfeit &&
            data.building !== "C" &&
            data.building !== "A"
          ) {
            const scoreVal = scoreBuildingAt(
              state.board,
              state.populationNodes,
              currentWorkerAllocationsForScore(),
              r,
              c,
              activationMap,
            );
            const scoreLabel = document.createElement("div");
            scoreLabel.className = "cell-score";
            scoreLabel.textContent = `${scoreVal >= 0 ? "+" : ""}${scoreVal}`;
            cell.appendChild(scoreLabel);
          }
        }
        if (req > 0) {
          const worker = document.createElement("div");
          worker.className = "worker-pips";
          worker.dataset.row = r;
          worker.dataset.col = c;
          for (let i = 0; i < Math.min(req, 4); i++) {
            const pip = document.createElement("div");
            pip.className = "worker-pip";
            if (filled > i) pip.classList.add("filled");
            worker.appendChild(pip);
          }
          cell.appendChild(worker);
        }
      } else {
        cell.classList.add("terrain");
      }
      cell.onclick = () => onCellClick(r, c);
      boardEl.appendChild(cell);
    });
  });
  renderPopulationNodes();
  highlightLocations();
  renderTopTracks();
  updateActionBanner();
}

function onCellClick(r, c) {
  if (state.pendingPopulation?.remaining > 0) {
    log("Place pending population first.");
    return;
  }
  if (state.activationMode) {
    const popSel = state.activationSelection.pop;
    if (!popSel) {
      log("Select a population node first.");
      return;
    }
    allocateWorkersFromPop(popSel, [r, c]);
    return;
  }
  if (state.pendingSpringhouseTarget) {
    const { options } = state.pendingSpringhouseTarget;
    const isOption = options.some(([or, oc]) => or === r && oc === c);
    if (!isOption) {
      log("Choose an adjacent building to reduce with the Springhouse.");
      return;
    }
    applySpringhouseTarget([r, c]);
    return;
  }
  if (state.pestilence || state.forceForfeit) {
    const cell = state.board[r][c];
    if (cell.building || cell.forfeited) {
      log("Choose an empty plot to forfeit.");
      return;
    }
    forfeitCell(r, c);
    return;
  }
  if (state.locationSelection.length !== 2 || !state.locationPairs.length) {
    log("Select two dice for Location first.");
    return;
  }
  const matches = state.locationPairs.some(([a, b]) => {
    const r1 = a - 1;
    const c1 = b - 1;
    const r2 = b - 1;
    const c2 = a - 1;
    return (r === r1 && c === c1) || (r === r2 && c === c2);
  });
  if (!matches) {
    log("Cell does not match location pair.");
    return;
  }
  if (!state.buildChoice) {
    log("Choose a building first.");
    return;
  }
  placeBuilding(r, c, state.buildChoice.code);
}

function highlightLocations() {
  boardEl.querySelectorAll(".cell").forEach((cell) => {
    cell.classList.remove("highlight");
    cell.classList.remove("disabled");
    const oct = cell.querySelector(".octagon");
    if (oct) oct.remove();
  });
  if (state.activationMode) {
    const selPop = state.activationSelection.pop;
    boardEl.querySelectorAll(".cell").forEach((cell) => {
      const r = parseInt(cell.dataset.row, 10);
      const c = parseInt(cell.dataset.col, 10);
      const data = state.board[r][c];
      const req = Math.max(
        0,
        (BUILDING_RULES[data.building]?.requirement || 0) - (Number(data.springBoost) || 0),
      );
      const filled = Math.max(0, state.workerAllocations?.[r]?.[c] || 0);
      const canSelect =
        data.building && !data.forfeited && !data.activationForfeit && req > filled && (selPop
          ? nodesForCell(r, c).some(([nr, nc]) => nr === selPop[0] && nc === selPop[1])
          : true);
      if (canSelect) {
        cell.classList.add("highlight");
      } else {
        cell.classList.add("disabled");
      }
      if ((req === 0 && data.building) || filled >= req) {
        cell.classList.add("activated-building");
      }
    });
    return;
  }
  if (state.activationMode) {
    const sel = state.activationSelection.building;
    boardEl.querySelectorAll(".cell").forEach((cell) => {
      const r = parseInt(cell.dataset.row, 10);
      const c = parseInt(cell.dataset.col, 10);
      const data = state.board[r][c];
      const req = Math.max(
        0,
        (BUILDING_RULES[data.building]?.requirement || 0) - (Number(data.springBoost) || 0),
      );
      const filled = Math.max(0, state.workerAllocations?.[r]?.[c] || 0);
      const canSelect = data.building && !data.forfeited && req > filled;
      if (sel && sel[0] === r && sel[1] === c) {
        cell.classList.add("selected-building");
      }
      if (canSelect) {
        cell.classList.add("highlight");
      } else {
        cell.classList.add("disabled");
      }
    });
    return;
  }
  if (state.pendingSpringhouseTarget) {
    const options = state.pendingSpringhouseTarget.options || [];
    boardEl.querySelectorAll(".cell").forEach((cell) => {
      const r = parseInt(cell.dataset.row, 10);
      const c = parseInt(cell.dataset.col, 10);
      const data = state.board[r][c];
      const match = options.some(([rr, cc]) => rr === r && cc === c);
      if (match && data.building && !data.forfeited) {
        cell.classList.add("highlight");
        const oct = document.createElement("div");
        oct.className = "octagon";
        cell.appendChild(oct);
      } else {
        cell.classList.add("disabled");
      }
    });
    return;
  }
  if (state.pestilence || state.diceLocked) {
    if (!state.pestilence) return;
    const targetCells = state.pestilenceInfo?.targetCells || [];
    const highlightAny = targetCells.length === 0;
    boardEl.querySelectorAll(".cell").forEach((cell) => {
      const r = parseInt(cell.dataset.row, 10);
      const c = parseInt(cell.dataset.col, 10);
      const data = state.board[r][c];
      const match =
        (!data.building && !data.forfeited && highlightAny) ||
        targetCells.some(([tr, tc]) => tr === r && tc === c);
      if (match && !data.building && !data.forfeited) {
        cell.classList.add("highlight");
        const oct = document.createElement("div");
        oct.className = "octagon";
        cell.appendChild(oct);
      } else {
        cell.classList.add("disabled");
      }
    });
    return;
  }
  if (state.forceForfeit) {
    boardEl.querySelectorAll(".cell").forEach((cell) => {
      const r = parseInt(cell.dataset.row, 10);
      const c = parseInt(cell.dataset.col, 10);
      const data = state.board[r][c];
      if (!data.building && !data.forfeited) {
        cell.classList.add("highlight");
        const oct = document.createElement("div");
        oct.className = "octagon";
        cell.appendChild(oct);
      } else {
        cell.classList.add("disabled");
      }
    });
    return;
  }
  if (state.pestilence || state.pendingPopulation?.remaining > 0) return;
  if (state.locationSelection.length !== 2 || !state.locationPairs.length) return;
  boardEl.querySelectorAll(".cell").forEach((cell) => {
    const r = parseInt(cell.dataset.row, 10);
    const c = parseInt(cell.dataset.col, 10);
    const data = state.board[r][c];
    const match = state.locationPairs.some(([a, b]) => {
      const r1 = a - 1;
      const c1 = b - 1;
      const r2 = b - 1;
      const c2 = a - 1;
      return (r === r1 && c === c1) || (r === r2 && c === c2);
    });
    if (match && !data.building && !data.forfeited) {
      cell.classList.add("highlight");
      const oct = document.createElement("div");
      oct.className = "octagon";
      cell.appendChild(oct);
    } else {
      cell.classList.add("disabled");
    }
  });
}

function placeBuilding(r, c, code) {
  const cell = state.board[r][c];
  if (cell.building || cell.forfeited) {
    log("Cell occupied or forfeited.");
    return;
  }
  const advancedLimit = new Set(["T", "U", "A"]);
  if (advancedLimit.has(code)) {
    const exists = state.board.flat().some((b) => b.building === code);
    if (exists) {
      log("That advanced building is already built.");
      return;
    }
  }
  if (code === "G") {
    if (!state.selectedGuildType) {
      log("Select a guild type before placing a Guild.");
      return;
    }
    const guildCount = countGuilds(state.board);
    if (guildCount >= 2) {
      log("Maximum number of guilds already built.");
      return;
    }
    const available = guildTypes.filter((t) => !builtGuildTypes(state.board).has(t));
    if (!available.length) {
      log("No guild types available.");
      return;
    }
  }
  let buildingLabel = code;
  if (code === "G") {
    const selection = state.selectedGuildType || guildTypes.find((t) => !builtGuildTypes(state.board).has(t)) || "GF";
    const normalized = selection.toUpperCase().trim();
    const valid = ["GF", "GQ", "GW", "GM"];
    buildingLabel = valid.includes(normalized) ? normalized : "G";
  }
  cell.building = code;
  cell.buildingLabel = buildingLabel;
  if (code === "C") state.tracks.housing += 4;
  const popGain =
    state.buildChoice?.source === "die1"
      ? dieMaxValue(state.buildDice[1])
      : state.buildChoice?.source === "die2"
        ? dieMaxValue(state.buildDice[0])
        : 0;
  const locSnapshot = state.locationSelection.map((i) => state.dice[i]).filter(Boolean);
  const buildSnapshot = state.dice.filter((_, idx) => !state.locationSelection.includes(idx));
  state.lockedLocationDice = locSnapshot;
  state.lockedBuildDice = buildSnapshot;
  state.lockedLocationPairs =
    state.locationPairs?.length > 0
      ? state.locationPairs.map((p) => p.slice())
      : locSnapshot.length === 2
        ? uniqueLocationPairs(locSnapshot)
        : null;
  state.pendingNextRoll = true;
  lockDiceSnapshot();
  renderBoard();
  updateTracks();
  const displayLabel =
    code === "G"
      ? (() => {
          const map = { GF: "FG", GQ: "QG", GW: "WG", GM: "MG" };
          const raw = (buildingLabel || "G").toUpperCase();
          return map[raw] || raw;
        })()
      : code;
  log(`Placed ${displayLabel} at row ${r + 1}, col ${c + 1}`);
  state.diceLocked = true;
  updateDiceAssignments();
  // Reset guild selection after placement
  if (code !== "G") {
    state.selectedGuildType = null;
    renderGuildOverlay([]);
  } else {
    // After placing a guild, no further guild selection until next valid build
    state.selectedGuildType = null;
    renderGuildOverlay([]);
  }
  let springResolved = false;
  if (code === "S") {
    const springResult = handleSpringhouseTargeting(r, c);
    if (springResult === "pending") return;
    if (springResult === "handled") springResolved = true;
  }
  if (popGain > 0) {
    beginPopulationPlacement(r, c, popGain);
  } else if (!springResolved) {
    autoAdvance();
    maybeRollAfterLock();
  }
}

function handleSpringhouseTargeting(r, c) {
  const options = adjacentCells(r, c).filter(([rr, cc]) => {
    const target = state.board[rr][cc];
    if (!target.building || target.forfeited) return false;
    const rule = BUILDING_RULES[target.building];
    if (!rule) return false;
    const currentBoost = Number(target.springBoost) || 0;
    const remainingReq = Math.max(0, rule.requirement - currentBoost);
    return remainingReq > 0;
  });
  if (!options.length) {
    log("No adjacent buildings with remaining worker requirement; Springhouse effect unused.");
    return "none";
  }
  state.pendingSpringhouseTarget = { source: [r, c], options };
  renderBoard();
  log("Choose an adjacent building to reduce its worker requirement by 1.");
  return "pending";
}

function applySpringhouseBoost(target) {
  const [tr, tc] = target;
  const targetCell = state.board[tr][tc];
  if (!targetCell.building || targetCell.forfeited) {
    log("Select a built, non-forfeited building for the Springhouse effect.");
    return;
  }
  const rule = BUILDING_RULES[targetCell.building];
  const maxBoost = Math.max(0, rule?.requirement || 0);
  const nextBoost = Math.min(maxBoost, (Number(targetCell.springBoost) || 0) + 1);
  targetCell.springBoost = nextBoost;
  log(`Springhouse reduced worker requirement for row ${tr + 1}, col ${tc + 1} by 1.`);
  renderBoard();
  updateTracks();
  const scoreResult = computeScore(state.board, state.populationNodes, currentWorkerAllocationsForScore());
  updateScoreOverlay(scoreResult.breakdown, scoreResult.total);
  state.pendingSpringhouseTarget = null;
  autoAdvance();
  maybeRollAfterLock();
  updateActionBanner();
}

function applySpringhouseTarget(target) {
  state.pendingSpringhouseTarget = null;
  applySpringhouseBoost(target);
}

function forfeitCell(r, c) {
  const cell = state.board[r][c];
  if (cell.building || cell.forfeited) {
    log("Cell occupied or forfeited.");
    return;
  }
  cell.forfeited = true;
  const locSnapshot = state.locationSelection.map((i) => state.dice[i]).filter(Boolean);
  const buildSnapshot = state.dice.filter((_, idx) => !state.locationSelection.includes(idx));
  state.lockedLocationDice = locSnapshot;
  state.lockedBuildDice = buildSnapshot;
  state.lockedLocationPairs =
    state.locationPairs?.length > 0
      ? state.locationPairs.map((p) => p.slice())
      : locSnapshot.length === 2
        ? uniqueLocationPairs(locSnapshot)
        : null;
  state.pendingNextRoll = true;
  lockDiceSnapshot();
  updateDiceAssignments();
  renderBoard();
  const section = state.pestilenceInfo?.sectionLabel || null;
  const context =
    section && state.pestilence ? ` during Pestilence (${section})` : state.pestilence ? " during Pestilence" : "";
  log(`Forfeited row ${r + 1}, col ${c + 1}${context}`);
  // Resolve pestilence/forfeit state so the turn can advance
  state.pestilence = false;
  state.pestilenceInfo = null;
  state.forceForfeit = false;
  const scoreResult = computeScore(state.board, state.populationNodes, currentWorkerAllocationsForScore());
  updateScoreOverlay(scoreResult.breakdown, scoreResult.total);
  autoAdvance();
  maybeRollAfterLock();
}

function updateTracks() {
  // Recalculate population from nodes and housing from cottages
  const pop = state.populationNodes ? state.populationNodes.flat().reduce((a, b) => a + b, 0) : 0;
  const cottages = state.board ? state.board.flat().filter((c) => c.building === "C").length : 0;
  state.tracks.population = pop;
  state.tracks.housing = cottages * 4;
  const vagrants = calcVagrants(state.tracks.population, state.tracks.housing);
  const scoreResult = computeScore(state.board, state.populationNodes, currentWorkerAllocationsForScore());
  updateScoreOverlay(scoreResult.breakdown, scoreResult.total);
  renderPopHousingTrack(state.tracks.population, state.tracks.housing, vagrants);
}

function log(msg) {
  state.log.unshift(msg);
  logEl.innerHTML = state.log.map((m) => `<li>${m}</li>`).join("");
}

function autoAdvance() {
  if (state.pendingPopulation?.remaining > 0) return;
  if (isBoardFull()) {
    log("Board full.");
    enterActivationMode();
    return;
  }
  if (state.diceLocked) return;
  rollDice();
}

function enterActivationMode() {
  if (state.activationMode) return;
  state.activationMode = true;
  state.activationComplete = false;
  state.activationSelection = { pop: null };
  state.populationAvailable = state.populationNodes.map((row) => row.slice());
  state.workerAllocations = Array.from({ length: state.board.length }, () =>
    Array.from({ length: state.board[0].length }, () => 0),
  );
  // Reset activation forfeits
  state.board.forEach((row) => row.forEach((cell) => delete cell.activationForfeit));
  autoForfeitUnfillable(false);
  if (finishActivationBtn) finishActivationBtn.style.display = "block";
  renderBuildingOverlay([], true);
  renderGuildOverlay([]);
  renderBoard();
  highlightLocations();
  refreshDiceVisibility();
  log("Activation phase: select a population node, then click adjacent buildings to fill workers one at a time.");
  updateActionBanner();
}

function finishActivation() {
  if (!state.activationMode) return;
  autoForfeitUnfillable(true);
  state.activationMode = false;
  state.activationComplete = true;
  state.finalScore = computeScore(state.board, state.populationNodes, currentWorkerAllocationsForScore()).total;
  state.activationSelection = { pop: null };
  if (finishActivationBtn) finishActivationBtn.style.display = "none";
  if (newGameBtn) newGameBtn.style.display = "inline-block";
  renderBoard();
  highlightLocations();
  refreshDiceVisibility();
  updateTracks();
  log("Activation finished. Scoring updated.");
  log(`Game end. Final score ${state.finalScore}.`);
  updateActionBanner();
}

function newGame() {
  resetState();
  renderBoard();
  renderRegionOverlay();
  updateTracks();
  updateActionBanner();
  if (newGameBtn) newGameBtn.style.display = "none";
  refreshDiceVisibility();
  rollDice();
}

function isBoardFull() {
  return state.board.every((row) => row.every((c) => c.building || c.forfeited));
}

function handleBuildingChoice() {
  const selected = document.querySelector(".building-hit.selected");
  if (state.locationSelection.length !== 2 || state.diceLocked) {
    state.buildChoice = null;
    state.selectedGuildType = null;
    return;
  }
  if (!selected) {
    state.buildChoice = null;
    state.selectedGuildType = null;
    updateActionBanner();
    return;
  }
  const code = selected.dataset.code;
  const source = selected.dataset.source;
  const popGain = Number(selected.dataset.pop || 0);
  state.buildChoice = { code, source, popGain };
  if (code === "G") {
    const available = guildTypes.filter((t) => !builtGuildTypes(state.board).has(t));
    renderGuildOverlay(available);
    if (!available.length) {
      log("No guild types available.");
      return;
    }
    if (!state.selectedGuildType) {
      log("Select a guild type from the guilds overlay.");
      return;
    }
  } else {
    state.selectedGuildType = null;
    renderGuildOverlay([]);
  }
  updateActionBanner();
  renderSelectionDice();
}

function renderGuildOverlay(available = []) {
  const overlay = document.getElementById("guildsOverlay");
  if (!overlay) return;
  const locked = state.locationSelection.length !== 2 || state.diceLocked || state.activationMode || state.forceForfeit || state.pestilence;
  overlay.style.pointerEvents = available.length && !locked ? "auto" : "none";
  overlay.innerHTML = "";
  const availableSet = new Set(available);
  guildHitboxes.forEach((hit) => {
    const div = document.createElement("div");
    div.className = "guild-hit";
    div.dataset.code = hit.code;
    div.style.gridColumn = hit.col;
    div.style.gridRow = hit.row;
    if (!locked && availableSet.has(hit.code) && !builtGuildTypes(state.board).has(hit.code)) {
      div.classList.add("available");
    } else {
      div.classList.add("disabled");
    }
    if (state.selectedGuildType === hit.code) {
      div.classList.add("selected");
    }
    div.onclick = () => {
      if (locked || !div.classList.contains("available")) return;
      document.querySelectorAll(".guild-hit.selected").forEach((el) => el.classList.remove("selected"));
      div.classList.add("selected");
      state.selectedGuildType = hit.code;
    };
    div.setAttribute("aria-label", hit.code);
    overlay.appendChild(div);
  });
}

function nodesForCell(r, c) {
  const coords = [];
  const nodeRows = state.populationNodes.length;
  const nodeCols = state.populationNodes[0]?.length || 0;
  [
    [r - 1, c - 1],
    [r - 1, c],
    [r, c - 1],
    [r, c],
  ].forEach(([nr, nc]) => {
    if (nr >= 0 && nc >= 0 && nr < nodeRows && nc < nodeCols) {
      coords.push([nr, nc]);
    }
  });
  return coords;
}

function beginPopulationPlacement(r, c, count) {
  const nodes = nodesForCell(r, c);
  const availableNodes = nodes.filter(([nr, nc]) => (state.populationNodes[nr][nc] || 0) === 0);
  if (availableNodes.length === 0) {
    log("No available population spots around this plot; population skipped.");
    autoAdvance();
    maybeRollAfterLock();
    return;
  }
  state.pendingPopulation = { remaining: count, cell: [r, c] };
  renderBoard();
  log(`Place ${count} population on one intersection around row ${r + 1}, col ${c + 1}.`);
  updateActionBanner();
}

function onPopulationNodeClick(nr, nc) {
  if (state.activationMode) {
    const availablePop = state.populationAvailable?.[nr]?.[nc] || 0;
    if (availablePop <= 0) {
      log("No available population on that node.");
      return;
    }
    state.activationSelection.pop = [nr, nc];
    renderBoard();
    highlightLocations();
    updateActionBanner();
    return;
  }
  if (!state.pendingPopulation || state.pendingPopulation.remaining <= 0) return;
  const eligible = nodesForCell(state.pendingPopulation.cell[0], state.pendingPopulation.cell[1]).some(
    ([r, c]) => r === nr && c === nc,
  );
  if (!eligible) {
    log("Population must be placed on an intersection touching the built plot.");
    return;
  }
  if ((state.populationNodes[nr][nc] || 0) > 0) {
    log("That population spot is already used.");
    return;
  }
  const { placed, grid } = allocatePopulationToNode(
    state.populationNodes,
    nr,
    nc,
    state.pendingPopulation.remaining,
    POP_CAPACITY,
  );
  if (placed <= 0) {
    log("That population spot is full.");
    return;
  }
  state.populationNodes = grid;
  const unplaced = state.pendingPopulation.remaining - placed;
  state.pendingPopulation = null;
  updateTracks();
  const scoreResult = computeScore(state.board, state.populationNodes, currentWorkerAllocationsForScore());
  updateScoreOverlay(scoreResult.breakdown, scoreResult.total);
  if (unplaced > 0) {
    log(`Placed ${placed} population; ${unplaced} could not be placed (spot full).`);
  } else {
    log(`Placed ${placed} population on row ${nr + 1}, col ${nc + 1}.`);
  }
  renderBoard();
  autoAdvance();
  maybeRollAfterLock();
  updateActionBanner();
}

function renderTopTracks() {
  renderDice();
}

function actionMessage() {
  if (state.bannerOverride) return state.bannerOverride;
  if (state.activationComplete) {
    const score = typeof state.finalScore === "number"
      ? state.finalScore
      : computeScore(state.board, state.populationNodes, currentWorkerAllocationsForScore()).total;
    return `Game over. Final score ${score}.`;
  }
  if (state.activationMode) {
    const anyRemaining = state.board.some((row, r) =>
      row.some((cell, c) => {
        if (!cell.building || cell.forfeited || cell.activationForfeit) return false;
        const req = Math.max(0, (BUILDING_RULES[cell.building]?.requirement || 0) - (Number(cell.springBoost) || 0));
        const filled = Math.max(0, state.workerAllocations?.[r]?.[c] || 0);
        return req > filled;
      }),
    );
    if (state.activationSelection.pop) {
      return "Activation: select an adjacent building to assign 1 worker.";
    }
    if (anyRemaining) return "Activation: select a population node to allocate workers.";
    return "Activation: finish allocation when ready.";
  }
  if (state.pendingSpringhouseTarget) {
    return "Select an adjacent building for Springhouse to reduce worker requirement by 1.";
  }
  if (state.pestilence || state.forceForfeit) {
    return "Forfeit an empty plot.";
  }
  if (state.pendingPopulation?.remaining > 0) {
    return `Place ${state.pendingPopulation.remaining} population on an adjacent intersection.`;
  }
  if (state.locationSelection.length < 2 && !(state.diceLocked && state.lockedLocationDice?.length === 2)) {
    return "Select two location dice in the Turn panel.";
  }
  if (!state.buildChoice) {
    return "Select a building from the Buildings overlay.";
  }
  return "Click a highlighted plot to place the chosen building.";
}

function updateActionBanner() {
  if (!actionBannerEl) return;
  const newText = actionMessage();
  const prevText = actionBannerEl.dataset.msg || "";
  const changed = prevText !== newText;
  actionBannerEl.dataset.msg = newText;
  actionBannerEl.textContent = newText;
  if (changed) {
    actionBannerEl.classList.remove("bump");
    void actionBannerEl.offsetWidth; // restart animation
    actionBannerEl.classList.add("bump");
  }
}

function renderRegionOverlay() {
  if (!regionOverlayEl) return;
  regionOverlayEl.innerHTML = "";
  const positions = {
    forest: { top: [100, 100], left: [258, 378] },
    mountain: { top: [292, 422], left: [55, 55] },
    sea: { top: [292, 410], left: [570, 570] },
    marsh: { top: [600, 600], left: [252, 378] },
  };
  Object.entries(pestilenceAssignments).forEach(([region, nums]) => {
    const pos = positions[region];
    if (!pos) return;
    const [low, high] = nums.length === 1 ? [nums[0], nums[0]] : nums;
    const coords = [
      { val: low, top: pos.top[0], left: pos.left[0] },
      { val: high, top: pos.top[1], left: pos.left[1] },
    ];
    coords.forEach((entry) => {
      const tag = document.createElement("div");
      tag.className = `region-tag ${region}`;
      tag.style.top = `${entry.top}px`;
      tag.style.left = `${entry.left}px`;
      tag.textContent = entry.val;
      regionOverlayEl.appendChild(tag);
    });
  });
}

function maybeRollAfterLock() {
  if (!state.diceLocked || !state.pendingNextRoll) return;
  if (state.pendingPopulation?.remaining > 0 || state.pestilence || state.forceForfeit || state.activationMode) return;
  // Unlock and roll next turn
  state.diceLocked = false;
  state.pendingNextRoll = false;
  state.lockedLocationDice = null;
  state.lockedBuildDice = null;
  state.lockedLocationPairs = null;
  rollDice();
}

function renderPopulationNodes() {
  const existingGrid = boardEl.querySelector(".pop-node-grid");
  if (existingGrid) existingGrid.remove();
  const gridSource =
    state.activationMode && state.populationAvailable ? state.populationAvailable : state.populationNodes;
  const rows = gridSource.length;
  const cols = gridSource[0]?.length || 0;
  const pendingCell = state.pendingPopulation?.cell || null;
  const eligibleNodes = pendingCell ? nodesForCell(pendingCell[0], pendingCell[1]) : [];
  const grid = document.createElement("div");
  grid.className = "pop-node-grid";
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const node = document.createElement("div");
      node.className = "population-node";
      const originalVal = state.populationNodes?.[r]?.[c] || 0;
      const availableVal = state.populationAvailable?.[r]?.[c];
      const val = state.activationMode ? availableVal || 0 : originalVal;
      node.dataset.nodeRow = r;
      node.dataset.nodeCol = c;
      if (state.activationMode) {
        if (val > 0) node.classList.add("has-pop");
        if (val > 0) {
          node.classList.add("highlight");
        } else {
          node.classList.add("disabled");
        }
        const selPop = state.activationSelection.pop;
        if (selPop && selPop[0] === r && selPop[1] === c) {
          node.classList.add("selected-pop");
        }
      } else {
        const isEligible = eligibleNodes.some(([nr, nc]) => nr === r && nc === c) && val === 0;
        if (state.pendingPopulation) {
          if (isEligible) {
            node.classList.add("highlight");
          } else {
            node.classList.add("disabled");
          }
        }
        if (originalVal > 0) {
          node.classList.add("disabled");
          node.classList.add("has-pop");
        }
      }
      if (originalVal > 0) {
        const pipGrid = document.createElement("div");
        pipGrid.className = "node-pip-grid";
        const pipLayouts = {
          1: [{ x: 50, y: 50 }],
          2: [
            { x: 26, y: 26 },
            { x: 74, y: 74 },
          ],
          3: [
            { x: 26, y: 26 },
            { x: 50, y: 50 },
            { x: 74, y: 74 },
          ],
          4: [
            { x: 26, y: 26 },
            { x: 74, y: 26 },
            { x: 26, y: 74 },
            { x: 74, y: 74 },
          ],
          5: [
            { x: 26, y: 26 },
            { x: 74, y: 26 },
            { x: 50, y: 50 },
            { x: 26, y: 74 },
            { x: 74, y: 74 },
          ],
          6: [
            { x: 30, y: 26 },
            { x: 70, y: 26 },
            { x: 30, y: 50 },
            { x: 70, y: 50 },
            { x: 30, y: 74 },
            { x: 70, y: 74 },
          ],
        };
        const positions = pipLayouts[Math.min(originalVal, 6)] || pipLayouts[6];
        const remaining = typeof availableVal === "number" ? availableVal : originalVal;
        positions.slice(0, originalVal).forEach((pos, idx) => {
          const pip = document.createElement("div");
          pip.className = "node-pip";
          if (idx >= remaining) pip.classList.add("spent");
          pip.style.left = `${pos.x}%`;
          pip.style.top = `${pos.y}%`;
          pipGrid.appendChild(pip);
        });
        node.appendChild(pipGrid);
      }
      node.onclick = () => onPopulationNodeClick(r, c);
      grid.appendChild(node);
    }
  }
  boardEl.appendChild(grid);
}

function renderSelectionDice(locationDice = [], buildDice = []) {
  const currentLocFromState = state.locationSelection.map((i) => state.dice[i]).filter(Boolean);
  const effectiveLoc =
    (locationDice && locationDice.length && locationDice) ||
    (currentLocFromState.length && currentLocFromState) ||
    (state.lockedLocationDice && state.lockedLocationDice.length && state.lockedLocationDice) ||
    (state.lastLocationDice && state.lastLocationDice.length && state.lastLocationDice) ||
    [];
  const currentBuildFromState = state.dice.filter((_, idx) => !state.locationSelection.includes(idx));
  const effectiveBuild =
    (buildDice && buildDice.length && buildDice) ||
    (currentBuildFromState.length && currentBuildFromState) ||
    (state.lockedBuildDice && state.lockedBuildDice.length && state.lockedBuildDice) ||
    (state.lastBuildDice && state.lastBuildDice.length && state.lastBuildDice) ||
    [];
  if (locDicePreview) {
    locDicePreview.classList.add("split-preview");
    locDicePreview.innerHTML = "";
    if (!effectiveLoc.length) {
      locDicePreview.innerHTML = '<span class="muted">Select 2 dice for location</span>';
    } else {
      effectiveLoc.forEach((die, idx) => {
        const badge = makeDieBadge(die, idx, {
          role: "location",
          locked: false,
          clickable: false,
          showRoleStyle: false,
        });
        locDicePreview.appendChild(badge);
      });
    }
  }
  if (buildDicePreview) {
    buildDicePreview.classList.add("split-preview");
    buildDicePreview.innerHTML = "";
    if (!effectiveBuild.length) {
      buildDicePreview.innerHTML = '<span class="muted">Remaining dice used for build</span>';
    } else {
      effectiveBuild.forEach((die, idx) => {
        const badge = makeDieBadge(die, idx, {
          role: "build",
          locked: false,
          clickable: false,
          showRoleStyle: false,
        });
        buildDicePreview.appendChild(badge);
      });
    }
  }
}

function pipGrid(val) {
  const pipPositions = {
    1: [5],
    2: [1, 9],
    3: [1, 5, 9],
    4: [1, 3, 7, 9],
    5: [1, 3, 5, 7, 9],
    6: [1, 3, 4, 6, 7, 9],
  };
  const filled = pipPositions[val] || [];
  const cells = Array.from({ length: 9 }, (_, i) =>
    filled.includes(i + 1) ? '<div class="pip"></div>' : "<div></div>",
  ).join("");
  return `<div class="die-pips">${cells}</div>`;
}

function addDieContent(el, die) {
  const faceLabel = document.createElement("span");
  faceLabel.className = "die-face-label";
  faceLabel.textContent = die.label;
  el.appendChild(faceLabel);
  if (die.face === "X") {
    const img = document.createElement("img");
    img.src = "assets/img/forfeit.svg";
    img.alt = "Forfeit";
    img.className = "die-forfeit-icon";
    el.appendChild(img);
    return;
  }
  if (die.face === "1/2" || die.face === "4/5") {
    renderSplitFace(el, die.face);
    return;
  }
  const val = typeof die.resolved === "number" ? die.resolved : Number(die.face);
  el.insertAdjacentHTML("beforeend", pipGrid(val || 0));
}

function renderSplitFace(el, faceStr) {
  const parts = faceStr.split("/").map((n) => Number(n));
  const low = Math.min(...parts);
  const high = Math.max(...parts);
  const split = document.createElement("div");
  split.className = "die-split";
  const line = document.createElement("div");
  line.className = "split-line";
  const lowSpan = document.createElement("span");
  lowSpan.className = "split-num split-low";
  lowSpan.textContent = String(low);
  const highSpan = document.createElement("span");
  highSpan.className = "split-num split-high";
  highSpan.textContent = String(high);
  split.appendChild(line);
  split.appendChild(lowSpan);
  split.appendChild(highSpan);
  el.appendChild(split);
}

function makeDieBadge(die, idx, { role = null, locked = false, clickable = true, showRoleStyle = true } = {}) {
  const badge = document.createElement("div");
  badge.className = "die-badge";
  badge.classList.add(die.label[0] === "X" ? "die-special" : "die-number");
  if (showRoleStyle) {
    if (role === "location") badge.classList.add("location-selected");
    if (role === "build") badge.classList.add("build-assigned");
  }
  if (locked) badge.classList.add("locked");
  badge.dataset.idx = idx;
  addDieContent(badge, die);
  if (clickable && !locked && die.face !== "X") {
    badge.addEventListener("click", () => onDieClick(idx));
  }
  return badge;
}

function onDieClick(idx) {
  if (state.activationMode || state.diceLocked || state.pestilence || state.forceForfeit || !state.activeTurn) return;
  const die = state.dice[idx];
  if (die.face === "X") return;
  const sel = state.locationSelection.slice();
  const existingIdx = sel.indexOf(idx);
  if (existingIdx >= 0) {
    sel.splice(existingIdx, 1);
  } else if (sel.length < 2) {
    sel.push(idx);
  } else {
    log("Unassign a location die before choosing another.");
    return;
  }
  state.locationSelection = sel;
  updateDiceAssignments();
}

function updateDiceAssignments() {
  const prevForce = state.forceForfeit;
  const locationDice = state.locationSelection.map((i) => state.dice[i]).filter(Boolean);
  const buildDice = state.dice.filter((_, idx) => !state.locationSelection.includes(idx));
  state.buildDice = buildDice;
  if (locationDice.length === 2) state.lastLocationDice = locationDice;
  if (buildDice.length) state.lastBuildDice = buildDice;

  const allPairs = filterAvailablePairs(uniqueLocationPairs(state.dice), state.board);
  let locationPairs = [];
  let forceForfeit = state.diceLocked ? state.forceForfeit : allPairs.length === 0;
  let invalidSelection = false;

  // If there are truly no available pairs at all, force forfeit and clear selections
  if (!state.diceLocked && allPairs.length === 0) {
    state.locationSelection = [];
    forceForfeit = true;
    invalidSelection = false;
    locationPairs = [];
    if (!prevForce) log("No valid location pairs; forfeit a plot.");
  }

  if (state.diceLocked) {
    if (state.lockedLocationPairs) locationPairs = state.lockedLocationPairs.map((p) => p.slice());
  } else if (state.activeTurn) {
    if (locationDice.length === 2) {
      const selectedPairs = filterAvailablePairs(uniqueLocationPairs(locationDice), state.board);
      if (selectedPairs.length) {
        locationPairs = selectedPairs;
      } else if (allPairs.length) {
        // Invalid selection; other pairs exist
        state.locationSelection = [];
        locationPairs = [];
        invalidSelection = true;
        if (!prevForce) log("No valid plots for that pair; choose a different location pair.");
      } else {
        forceForfeit = true;
        if (!prevForce) log("No valid location pairs; forfeit a plot.");
      }
    } else if (forceForfeit && !prevForce) {
      log("No valid location pairs; forfeit a plot.");
    }
  } else {
    // Non-active: use numbered dice only
    if (locationDice.length === 2) {
      const selectedPairs = filterAvailablePairs(uniqueLocationPairs(locationDice), state.board);
      if (selectedPairs.length) {
        locationPairs = selectedPairs;
      } else {
        forceForfeit = true;
      }
    }
  }

  state.locationPairs = locationPairs;
  state.forceForfeit = forceForfeit;
  state.invalidSelection = invalidSelection;
  if (turnHintEl) {
    if (state.activeTurn && invalidSelection) {
      turnHintEl.textContent = "No valid plots for that pair; choose a different location pair.";
    } else if (forceForfeit) {
      turnHintEl.textContent = "No valid location pairs; forfeit a plot.";
    } else if (!state.activeTurn) {
      turnHintEl.textContent = "Non-active turn. Dice automatically assigned.";
    } else {
      turnHintEl.textContent = "";
    }
  }

  const previewLocation =
    state.diceLocked && state.lockedLocationDice?.length
      ? state.lockedLocationDice
      : locationDice.length
        ? locationDice
        : [];
  const previewBuild =
    state.diceLocked && state.lockedBuildDice?.length
      ? state.lockedBuildDice
      : buildDice.length
        ? buildDice
        : state.lastBuildDice;

  renderSelectionDice(previewLocation, previewBuild);
  fillBuildings(buildDice);
  highlightLocations();
  updateActionBanner();
  renderDice();
}

function currentWorkerAllocationsForScore() {
  if (state.activationMode || state.activationComplete) return state.workerAllocations;
  const rows = state.board.length;
  const cols = state.board[0]?.length || 0;
  return Array.from({ length: rows }, () => Array(cols).fill(0));
}

function updateScoreOverlay(breakdown, total = 0) {
  if (!scoreOverlayEl) return;
  const chips = scoringSpots
    .map((spot) => {
      const topPos = spot.y ?? 20;
      const val =
        spot.key === "reputation"
          ? total
          : typeof breakdown[spot.key] === "number"
            ? breakdown[spot.key]
            : 0;
      const negative = typeof val === "number" && val < 0;
      const forceNegative = spot.key === "vagrants" || spot.key === "springhouse";
      const classes = ["score-chip"];
      if (negative || forceNegative) classes.push("negative");
      return `<div class="${classes.join(
        " ",
      )}" id="score-chip-${spot.key}" style="left:${spot.x}px;top:${topPos}px;">${Math.abs(val)}</div>`; // negative sign printed on the board
    })
    .join("");
  scoreOverlayEl.innerHTML = chips;
}


const sectionLabels = {
  forest: "Forest",
  sea: "Sea",
  mountain: "Mountain",
  marsh: "Marsh",
  centre: "Centre",
};

function renderPopHousingTrack(pop = 0, housing = 0, vagrants = 0) {
  if (!popHousingOverlay) return;
  popHousingOverlay.innerHTML = "";
  const grid = document.createElement("div");
  grid.className = "pop-grid";
  const housingUnits = Math.max(0, Math.floor(housing / 4));
  let remainingPop = Math.max(0, pop);

  for (let r = 0; r < POP_LAYOUT.rows; r++) {
    for (let c = 0; c < POP_LAYOUT.cols; c++) {
      const cellIdx = r * POP_LAYOUT.cols + c;
      const cell = document.createElement("div");
      cell.className = "pop-cell";
      if (cellIdx < housingUnits) cell.classList.add("has-housing");

      const pipGrid = document.createElement("div");
      pipGrid.className = "pip-grid";
      const pipsThisCell = Math.max(0, Math.min(POP_LAYOUT.pipsPerCell, remainingPop));
      for (let i = 0; i < pipsThisCell; i++) {
        const pip = document.createElement("div");
        pip.className = "pop-pip";
        pip.classList.add("filled-pop");
        pipGrid.appendChild(pip);
      }
      remainingPop -= pipsThisCell;
      cell.appendChild(pipGrid);
      grid.appendChild(cell);
    }
  }
  popHousingOverlay.appendChild(grid);
}

function adjacentCells(r, c) {
  return [
    [r - 1, c],
    [r + 1, c],
    [r, c - 1],
    [r, c + 1],
  ].filter(([rr, cc]) => rr >= 0 && cc >= 0 && rr < state.board.length && cc < state.board[0].length);
}
function allocateWorkersFromPop(popSel, buildingSel) {
  const [pr, pc] = popSel;
  const [br, bc] = buildingSel;
  const cell = state.board[br]?.[bc];
  if (!cell || !cell.building || cell.forfeited || cell.activationForfeit) {
    log("Select a valid building.");
    return;
  }
  const available = state.populationAvailable?.[pr]?.[pc] || 0;
  if (available <= 0) {
    log("No available population on that node.");
    return;
  }
  const adj = nodesForCell(br, bc).some(([nr, nc]) => nr === pr && nc === pc);
  if (!adj) {
    log("Population must be adjacent to the building.");
    return;
  }
  const req = Math.max(
    0,
    (BUILDING_RULES[cell.building]?.requirement || 0) - (Number(cell.springBoost) || 0),
  );
  const filled = Math.max(0, state.workerAllocations?.[br]?.[bc] || 0);
  const remaining = Math.max(0, req - filled);
  if (remaining <= 0) {
    log("Building already filled.");
    return;
  }
  const assign = 1;
  state.populationAvailable[pr][pc] = Math.max(0, available - assign);
  state.workerAllocations[br][bc] = filled + assign;
  if (state.workerAllocations[br][bc] >= req) {
    log(`Activated ${cell.building} at row ${br + 1}, col ${bc + 1}.`);
  }
  state.activationSelection.pop = state.populationAvailable[pr][pc] > 0 ? [pr, pc] : null;
  renderBoard();
  highlightLocations();
  updateTracks();
}

function autoForfeitUnfillable(finalize = false) {
  if (!state.populationAvailable || !state.workerAllocations) return;
  const rows = state.board.length;
  const cols = state.board[0]?.length || 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = state.board[r][c];
      if (!cell.building || cell.forfeited) continue;
      const rule = BUILDING_RULES[cell.building];
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
          log(`Could not activate ${cell.building} at row ${r + 1}, col ${c + 1}; marked forfeited for scoring.`);
        }
        cell.activationForfeit = true;
      } else if (!finalize) {
        delete cell.activationForfeit;
      }
    }
  }
}
