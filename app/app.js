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
import { createState, resetTurnState, lockDiceSnapshot } from "./state-controller.js";
import {
  beginTurn,
  selectLocationDie,
  evaluateLocationSelection,
  startActivation as startActivationState,
  finishActivation as finishActivationState,
  startPopulationPlacement,
  placePopulationNode,
  allocateWorker,
  autoForfeitUnfillableState,
  autoAdvanceState,
  recalcTracks,
  maybeRollAfterLockState,
} from "./game-state.js";
import { rollNumberedDie, rollXDie } from "./dice.js";
import { splitForcedDice } from "./dice-display.js";
import { createDieFaceSVG } from "./dice-face.js";
import { createManualP2P } from "./p2p.js";
import { createQrDataUrl } from "./qr.js";
import { compressToBase64Url, decompressFromBase64Url } from "./compact.js";

const terrainLayout = [
  ["Mt", "Fo", "Fo", "Fo", "Se"],
  ["Mt", "..", "..", "..", "Se"],
  ["Mt", "..", "Vi", "..", "Se"],
  ["Mt", "..", "..", "..", "Se"],
  ["Mt", "Ma", "Ma", "Ma", "Se"],
];

const state = createState();

let controlsReady = false;
const urlParams = new URLSearchParams(window.location.search);
const debugMode = urlParams.has("debug");
const p2pFeatureEnabled = urlParams.has("p2p");
const MAX_P2P_SEATS = 5;
const P2P_SEAT_COLORS = {
  1: "#e74c3c", // red
  2: "#2980b9", // blue
  3: "#27ae60", // green
  4: "#f1c40f", // yellow
  5: "#8e44ad", // purple
};
const p2pUiState = {
  mode: "idle",
  lastError: null,
  remoteSnapshot: null,
  awaitingAnswer: false,
  channelOpen: false,
  sessionId: null,
  loadedFromUrl: false,
  signallingUrl: null,
  signallingActive: false,
  signallingPoll: null,
  signallingDisabled: false,
  lastInviteLink: "",
  lastQrDataUrl: "",
  passcode: "",
  seatId: 1,
  seatsTotal: 1,
  activeSeat: 1,
  inviteVisible: false,
  connectedSeats: {},
  hostCreated: false,
  splitLocked: false,
  buildDone: {},
  lockedPairSwap: false,
  splitUsed: {},
};
if (!p2pFeatureEnabled) {
  p2pUiState.signallingDisabled = true;
}

function isMultiplayerActive() {
  return p2pUiState.signallingActive && p2pUiState.seatsTotal > 1;
}

function awaitingSplitNonActive(snapshotActiveSeat = null) {
  const activeSeat = snapshotActiveSeat ?? p2pUiState.activeSeat;
  const nonActive = isMultiplayerActive() && activeSeat !== p2pUiState.seatId;
  return nonActive && !p2pUiState.splitLocked && !state.pestilence && !state.forceForfeit;
}

function ensureBuildDoneMap(total = null, seed = null) {
  const seats = Math.max(1, Number(total || p2pUiState.seatsTotal) || 1);
  const merged = {};
  const source = seed || p2pUiState.buildDone || {};
  for (let i = 1; i <= seats; i += 1) {
    merged[i] = Boolean(source[i]);
  }
  return merged;
}

function ensureSplitUsedMap(total = null, seed = null) {
  const seats = Math.max(1, Number(total || p2pUiState.seatsTotal) || 1);
  const merged = {};
  const source = seed || p2pUiState.splitUsed || {};
  for (let i = 1; i <= seats; i += 1) {
    merged[i] = Boolean(source[i]);
  }
  return merged;
}

function ensureConnectedSeats(seed = null) {
  const merged = {};
  for (let i = 1; i <= MAX_P2P_SEATS; i += 1) {
    merged[i] = Boolean(seed?.[i]);
  }
  return merged;
}

p2pUiState.connectedSeats = ensureConnectedSeats();

function currentTurnPhase() {
  if (state.activationComplete) return TURN_PHASE.ACTIVATION_DONE;
  if (state.activationMode) return TURN_PHASE.ACTIVATION;
  if (state.pendingPopulation?.remaining > 0) return TURN_PHASE.POPULATION;
  if (state.pestilence) return TURN_PHASE.PESTILENCE;
  if (state.forceForfeit) return TURN_PHASE.FORFEIT;
  if (state.rollAvailable && !debugMode) return TURN_PHASE.AWAIT_ROLL;
  if (state.diceLocked || state.locationSelection.length === 2) return TURN_PHASE.BUILDING;
  if (state.dice?.length) return TURN_PHASE.SPLITTING;
  return TURN_PHASE.AWAIT_ROLL;
}

function effectiveLockedLocationPairs() {
  if (!p2pUiState.splitLocked || !state.lockedLocationDice || state.lockedLocationDice.length !== 2) return [];
  const choice = lockedPairChoice();
  const locDice = choice.locDice || state.lockedLocationDice;
  return uniqueLocationPairs(locDice);
}

function setActiveSeat(nextSeat = 1) {
  const seat = Math.max(1, Number(nextSeat) || 1);
  p2pUiState.activeSeat = seat;
  state.activeTurn = p2pUiState.seatId === seat;
  updateRollButton();
  updateActionBanner();
  updateMultiplayerButtons();
}

function resetBuildDoneMap() {
  const total = Math.max(1, Number(p2pUiState.seatsTotal) || 1);
  const entries = {};
  for (let i = 1; i <= total; i += 1) entries[i] = false;
  p2pUiState.buildDone = entries;
}

function nextSeatId() {
  const total = Math.max(1, Number(p2pUiState.seatsTotal) || 1);
  return ((p2pUiState.activeSeat || 1) % total) + 1;
}

function allBuildsMarkedDone() {
  const map = ensureBuildDoneMap();
  const total = Math.max(1, Number(p2pUiState.seatsTotal) || 1);
  for (let i = 1; i <= total; i += 1) {
    if (!map[i]) return false;
  }
  return true;
}

function logP2P(...args) {
  if (typeof console !== "undefined" && typeof console.info === "function") {
    console.info("[P2P]", ...args);
  }
}

function resetSecretField() {
  const fresh = randomPasscode();
  p2pUiState.passcode = fresh;
  return fresh;
}

function freshSessionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `session-${crypto.randomUUID()}`;
  }
  return `session-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
}

function randomPasscode() {
  const words = [
    "oak",
    "river",
    "stone",
    "forge",
    "crown",
    "harbor",
    "ember",
    "meadow",
    "quill",
    "lantern",
    "willow",
    "bridge",
    "maple",
    "cobalt",
    "granite",
    "piper",
    "saddle",
    "glen",
    "harvest",
    "summit",
  ];
  const randomCase = (word) =>
    word
      .split("")
      .map((ch) => (Math.random() < 0.5 ? ch.toLowerCase() : ch.toUpperCase()))
      .join("");
  const maybeDigitWord = (word) => {
    if (Math.random() < 0.4) {
      const digit = Math.floor(Math.random() * 10);
      return Math.random() < 0.5 ? `${digit}${word}` : `${word}${digit}`;
    }
    return word;
  };
  const pick = () => maybeDigitWord(randomCase(words[Math.floor(Math.random() * words.length)]));
  return `${pick()}-${pick()}-${pick()}`;
}

function parseSessionLink(value) {
  if (!value) return null;
  try {
    const url = value.includes("://") ? new URL(value) : new URL(value, window.location.href);
    const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
    const sessionId = hashParams.get("s");
    const secret = hashParams.get("k");
    return sessionId || secret ? { sessionId, secret } : null;
  } catch (err) {
    return null;
  }
}

const p2p = createManualP2P({
  onLog: (msg) => logP2P(msg),
  onStatus: (status) => handleP2PStatus(status),
  onMessage: (message) => handleP2PMessage(message),
  captureState: () => captureP2PSnapshot(),
});

function prepareNextRoll() {
  state.rollAvailable = true;
  state.dice = [];
  state.locationSelection = [];
  state.locationPairs = [];
  state.buildDice = [];
  p2pUiState.splitLocked = false;
  p2pUiState.lockedPairSwap = false;
  p2pUiState.splitUsed = ensureSplitUsedMap();
  Object.keys(p2pUiState.splitUsed).forEach((k) => {
    p2pUiState.splitUsed[k] = false;
  });
  resetBuildDoneMap();
  state.forceForfeit = false;
  state.pestilence = false;
  state.pestilenceInfo = null;
  state.invalidSelection = false;
  state.lastLocationDice = [];
  state.lastBuildDice = [];
  state.diceLocked = false;
  state.lockedLocationDice = null;
  state.lockedBuildDice = null;
  state.lockedLocationPairs = null;
  state.pendingNextRoll = false;
  if (diceView) diceView.innerHTML = "";
  updateRollButton();
  updateActionBanner();
  updateMultiplayerButtons();
  refreshDiceVisibility();
  highlightLocations();
}

function shouldRerollDoubleWindrose(dice) {
  if (!Array.isArray(dice) || dice.length < 4) return false;
  const numbered = dice.filter((d) => d?.label?.startsWith("N"));
  if (numbered.length !== 2) return false;
  return numbered.every((d) => d.face === "windrose");
}

function updateRollButton() {
  const rollBtn = document.getElementById("rollBtn");
  if (!rollBtn) return;
  const isActiveSeat = p2pUiState.activeSeat === p2pUiState.seatId;
  const hidden = state.activationMode || state.activationComplete || (!isActiveSeat && p2pUiState.seatsTotal > 1);
  const awaitingRoll = !debugMode && state.rollAvailable;
  const showButton = !hidden && (awaitingRoll || debugMode);
  rollBtn.style.display = showButton ? "inline-block" : "none";
  const enabled = (debugMode || state.rollAvailable) && isActiveSeat;
  rollBtn.disabled = !enabled;
  rollBtn.classList.toggle("dice-locked", !enabled && !debugMode);
  rollBtn.title = enabled ? "Roll dice" : "Roll used; complete the turn to roll again.";
}

function refreshDiceVisibility() {
  const hidden = state.activationMode || state.activationComplete;
  const awaitingRoll = !debugMode && state.rollAvailable;
  if (diceView) diceView.style.display = hidden || awaitingRoll ? "none" : "";
  updateRollButton();
  updateTurnStatusChip();
  if (turnHintEl) {
    turnHintEl.style.display = hidden ? "none" : "";
    if (!hidden && !state.activationMode && !state.activationComplete && !awaitingRoll) {
      turnHintEl.style.display = "";
    }
    if (awaitingRoll) turnHintEl.textContent = "";
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

const boardEl = document.getElementById("board");
const diceView = document.getElementById("diceView");
const turnHintEl = document.getElementById("turnHint");
const locDicePreview = document.getElementById("locDicePreview");
const buildDicePreview = document.getElementById("buildDicePreview");
const logEl = document.getElementById("log");
const scoreOverlayEl = document.getElementById("scoreOverlay");
const popHousingOverlay = document.getElementById("popHousingOverlay");
const guildTypes = ["GF", "GQ", "GW", "GM"];
const sectionLabels = {
  forest: "Forest",
  sea: "Sea",
  mountain: "Mountain",
  marsh: "Marsh",
  centre: "Centre",
};
const finishActivationBtn = document.getElementById("finishActivation");
const newGameBtn = document.getElementById("newGameBtn");
const finishSplitBtn = document.getElementById("finishSplitBtn");
const swapPairBtn = document.getElementById("swapPairBtn");
// Done building button removed from UI.
const fullscreenBtn = document.getElementById("fullscreenToggle");
const themeToggleBtn = document.getElementById("themeToggle");
const themeToggleIcon = document.getElementById("themeToggleIcon");
const themeToggleText = document.getElementById("themeToggleText");
const actionBannerEl = document.getElementById("actionBanner");
const turnStatusChip = document.getElementById("turnStatusChip");
const loadingOverlay = document.getElementById("loadingOverlay");
const sheetBaseImage = document.getElementById("sheetBaseImage");
const regionOverlayEl = document.getElementById("regionOverlay");
const p2pPanel = document.getElementById("p2pPanel");
const p2pStatusEl = document.getElementById("p2pStatus");
const p2pCodeEl = document.getElementById("p2pCode");
const p2pCodeLabel = document.querySelector('label[for="p2pCode"]');
const p2pCopyBtn = document.getElementById("p2pCopyBtn");
const p2pApplyBtn = document.getElementById("p2pApplyBtn");
const p2pHostBtn = document.getElementById("p2pHostBtn");
const p2pJoinBtn = document.getElementById("p2pJoinBtn");
const p2pDisconnectBtn = document.getElementById("p2pDisconnectBtn");
const p2pSendAnswerBtn = document.getElementById("p2pSendAnswerBtn");
const p2pHintEl = document.getElementById("p2pHint");
const p2pMeeplesEl = document.getElementById("p2pMeeples");
const p2pInviteRow = p2pCodeEl ? p2pCodeEl.closest(".p2p-row") : null;
const p2pQrImg = document.getElementById("p2pQrImg");
const p2pQrCaption = document.getElementById("p2pQrCaption");
const p2pQrModal = document.getElementById("p2pQrModal");
const p2pQrClose = document.getElementById("p2pQrClose");
const p2pShowQrBtn = document.getElementById("p2pShowQrBtn");
const SHEET_VERSION = "v1.3";
const POP_CAPACITY = 5;
const POP_LAYOUT = { cols: 7, rows: 2, pipsPerCell: 4 };
const THEME_STORAGE_KEY = "rolling-fiefdoms-theme";
const TURN_PHASE = {
  AWAIT_ROLL: "awaiting-roll",
  SPLITTING: "splitting",
  BUILDING: "building",
  POPULATION: "population",
  FORFEIT: "forfeit",
  PESTILENCE: "pestilence",
  ACTIVATION: "activation",
  ACTIVATION_DONE: "activation-complete",
};

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const isLocalhost = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  const isLocalDev = isLocalhost && !location.pathname.includes("/dist");
  if (isLocalDev) {
    // Disable SW caching when developing locally outside of the dist build.
    navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((reg) => reg.unregister()));
    if (window.caches && caches.keys) {
      caches
        .keys()
        .then((keys) => Promise.all(keys.filter((k) => k.startsWith("rf-cache-")).map((k) => caches.delete(k))))
        .catch(() => {});
    }
    return;
  }
  if (!window.isSecureContext && !isLocalhost) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => console.warn("SW registration failed", err));
  });
}

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
  { key: "cottages", x: 22, y: 30 },
  { key: "farm", x: 68, y: 30 },
  { key: "quarry", x: 114, y: 30 },
  { key: "windmill", x: 158, y: 30 },
  { key: "market", x: 204, y: 30 },
  { key: "townhall", x: 246, y: 30 },
  { key: "university", x: 292, y: 30 },
  { key: "guilds", x: 336, y: 30 },
  { key: "springhouse", x: 384, y: 30 },
  { key: "vagrants", x: 428, y: 30 },
  { key: "reputation", x: 530, y: 30 },
];

function readStoredTheme() {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "dark" || stored === "light") return stored;
  } catch (err) {
    console.warn("Could not read theme preference", err);
  }
  return "light";
}

function updateThemeToggle() {
  if (!themeToggleBtn) return;
  const isDark = state.theme === "dark";
  if (themeToggleIcon) {
    themeToggleIcon.src = isDark ? "assets/img/moon.svg" : "assets/img/sun.svg";
  }
  if (themeToggleText) {
    themeToggleText.textContent = isDark ? "Dark" : "Light";
  }
  themeToggleBtn.setAttribute("aria-pressed", String(isDark));
  themeToggleBtn.title = isDark ? "Switch to light mode" : "Switch to dark mode";
}

function applyTheme(theme, persist = false) {
  const normalized = theme === "dark" ? "dark" : "light";
  state.theme = normalized;
  document.body.classList.toggle("theme-dark", normalized === "dark");
  if (persist) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, normalized);
    } catch (err) {
      console.warn("Could not store theme preference", err);
    }
  }
  updateThemeToggle();
}

function setupThemeToggle() {
  applyTheme(readStoredTheme());
  if (!themeToggleBtn) return;
  themeToggleBtn.onclick = () => applyTheme(state.theme === "dark" ? "light" : "dark", true);
}

function init() {
  resetState();
  renderBoard();
  renderRegionOverlay();
  updateTracks();
  updateTurnStatusChip();
  updateActionBanner();
  refreshDiceVisibility();
  renderMeeples();
  updateInviteVisibility(p2pUiState.inviteVisible);
  if (!controlsReady) {
    setupControls();
    controlsReady = true;
  }
}

function resetState() {
  state.board = terrainLayout.map((row) =>
    row.map((terrain) => ({ terrain, building: null, buildingLabel: null, forfeited: false, springBoost: 0 })),
  );
  state.populationNodes = Array.from({ length: 4 }, () => Array(4).fill(0));
  state.populationAvailable = null;
  state.workerAllocations = null;
  state.activationMode = false;
  state.turnIndex = 0;
  state.activeTurn = true;
  state.lastStatusTurnIndex = 0;
  state.finalScore = null;
  state.log = [];
  state.rollAvailable = true;
  state.pendingTurnIndex = null;
  state.pendingActiveTurn = null;
  p2pUiState.splitLocked = false;
  p2pUiState.lockedPairSwap = false;
  p2pUiState.inviteVisible = false;
  resetBuildDoneMap();
  resetTurnState(state);
  if (logEl) logEl.innerHTML = "";
  if (finishActivationBtn) finishActivationBtn.style.display = "none";
  if (newGameBtn) newGameBtn.style.display = "none";
  refreshDiceVisibility();
  updateTurnStatusChip();
  log("Game started.");
}

function preloadSheet() {
  return new Promise((resolve) => {
    const imgEl = sheetBaseImage;
    const src = sheetImageUrl();
    if (imgEl) {
      imgEl.src = src;
      if (imgEl.complete) {
        resolve(true);
        return;
      }
      imgEl.onload = () => resolve(true);
      imgEl.onerror = () => resolve(false);
      return;
    }
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = src;
  });
}

function sheetImageUrl() {
  return new URL(`resources/rolling-fiefdoms-player-sheet.webp?v=${SHEET_VERSION}`, window.location.href).toString();
}

setupThemeToggle();
registerServiceWorker();

preloadSheet().then(() => {
  document.body.classList.remove("loading");
  if (loadingOverlay) loadingOverlay.remove();
  init();
});

function setupControls() {
  const rollBtn = document.getElementById("rollBtn");
  if (rollBtn) {
    rollBtn.onclick = () => rollDice();
    rollBtn.style.display = "inline-block";
    updateRollButton();
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
  if (finishSplitBtn) {
    finishSplitBtn.onclick = () => finishDiceSplit();
    finishSplitBtn.style.display = "none";
  }
  // Done building button removed; completion is automatic after placement/population.
  if (swapPairBtn) {
    swapPairBtn.onclick = () => toggleLockedPairChoice();
    swapPairBtn.style.display = "none";
  }
  if (p2pFeatureEnabled) {
    setupP2PControls();
  } else if (p2pPanel) {
    p2pPanel.style.display = "none";
  }
}

function captureP2PSnapshot() {
  const snapshotScore = currentScore({ allowPopulationActivation: false });
  return {
    fiefdomName: state.fiefdomName || "",
    turnIndex: state.turnIndex || 0,
    activeTurn: Boolean(state.activeTurn),
    rollAvailable: Boolean(state.rollAvailable),
    score: snapshotScore?.total ?? 0,
    seatsTotal: p2pUiState.seatsTotal,
    activeSeat: p2pUiState.activeSeat,
    splitLocked: p2pUiState.splitLocked,
    buildDone: ensureBuildDoneMap(),
  };
}

function handleP2PMessage(message) {
  if (!message || typeof message !== "object") return;
  if (message.type === "session:seat" && message.payload) {
    const { seatId, seatsTotal, activeSeat } = message.payload;
    if (seatId) p2pUiState.seatId = seatId;
    if (seatsTotal) p2pUiState.seatsTotal = seatsTotal;
    if (typeof activeSeat === "number") setActiveSeat(activeSeat);
    updateMultiplayerButtons();
    updateP2PStatus("Seat assignment received.");
    return;
  }
  if (message.type === "hello") {
    p2pUiState.remoteSnapshot = message.payload?.snapshot || null;
    updateP2PStatus("Peer handshake received. Manual state sync only.");
    logP2P("Peer handshake received.");
  } else if (message.type === "state:request") {
    const status = typeof p2p?.getStatus === "function" ? p2p.getStatus() : {};
    if (status.role === "host") {
      sendStateSnapshot();
    }
  } else if (message.type === "state:full" && message.payload?.snapshot) {
    p2pUiState.remoteSnapshot = message.payload.snapshot;
    applyFullSnapshot(message.payload.snapshot);
    updateP2PStatus("Snapshot received from host.");
  }
}

function handleP2PStatus(status) {
  if (!p2pFeatureEnabled) return;
  const channelJustOpened = !p2pUiState.channelOpen && status?.channelOpen;
  p2pUiState.channelOpen = Boolean(status?.channelOpen);
  p2pUiState.lastError = status?.lastError || null;
  if (p2pUiState.channelOpen) p2pUiState.signallingActive = true;
  if (status?.sessionId) p2pUiState.sessionId = status.sessionId;
  if (p2pUiState.channelOpen && p2pUiState.awaitingAnswer) p2pUiState.awaitingAnswer = false;
  if (channelJustOpened) {
    logP2P("Connected to peer.");
    p2pUiState.hostCreated = true;
    p2pUiState.connectedSeats = ensureConnectedSeats(p2pUiState.connectedSeats);
    p2pUiState.connectedSeats[1] = true;
    if (status?.role === "join") {
      p2pUiState.seatId = 2;
      p2pUiState.seatsTotal = Math.max(2, p2pUiState.seatsTotal || 0);
      p2pUiState.connectedSeats[2] = true;
      setActiveSeat(p2pUiState.activeSeat || 1);
      sendAppMessage("state:request", {});
    } else if (status?.role === "host") {
      p2pUiState.seatId = 1;
      p2pUiState.seatsTotal = Math.max(2, p2pUiState.seatsTotal || 0);
      p2pUiState.connectedSeats[2] = true;
      setActiveSeat(p2pUiState.activeSeat || 1);
      sendAppMessage("session:seat", {
        seatId: 2,
        seatsTotal: p2pUiState.seatsTotal,
        activeSeat: p2pUiState.activeSeat,
      });
      sendStateSnapshot();
    }
    updateMultiplayerButtons();
  }
  if (status?.lastError) {
    logP2P(status.lastError);
  }
  updateP2PStatus();
  renderMeeples();
}

function updateP2PStatus(hintOverride = null) {
  if (!p2pFeatureEnabled) return;
  if (!p2pPanel) return;
  if (p2pUiState.signallingDisabled) {
    if (p2pStatusEl) p2pStatusEl.textContent = "P2P disabled: signalling unavailable.";
    if (p2pHintEl) {
      p2pHintEl.textContent = "";
      p2pHintEl.style.display = "none";
    }
    if (p2pPanel) p2pPanel.classList.add("disabled");
    updateP2PControlsVisibility({});
    return;
  }
  const status = typeof p2p?.getStatus === "function" ? p2p.getStatus() : { supported: false };
  const main =
    !status.supported
      ? "Manual P2P is not available in this browser."
      : status.channelOpen
        ? "Connected via manual P2P."
        : p2pUiState.awaitingAnswer
          ? "Hosting: waiting for the peer's answer."
          : p2pUiState.mode === "answerReady"
            ? "Answer generated. Send it back to the host."
            : p2pUiState.mode === "joining"
              ? "Joining: paste an invite code, then apply to craft your answer."
              : p2pUiState.mode === "hosting"
                ? "Preparing an invite…"
                : "Idle. Host to create an invite or join with one.";

  const errorText = status.lastError ? ` (${status.lastError})` : "";
  const remoteText =
    status.channelOpen && p2pUiState.remoteSnapshot ? describeRemoteSnapshot(p2pUiState.remoteSnapshot) : "";
  if (p2pStatusEl) p2pStatusEl.textContent = `${main}${remoteText}${errorText}`;
  if (p2pHintEl) {
    p2pHintEl.textContent = "";
    p2pHintEl.style.display = "none";
  }
  updateP2PControlsVisibility(status);
}

function readP2PSecret() {
  return (p2pUiState.passcode || "").trim();
}

function readP2PSecretOrDefault() {
  const provided = readP2PSecret();
  if (provided) return provided;
  if (p2pUiState.sessionId) return p2pUiState.sessionId;
  return "default";
}

function setP2PMode(mode, { awaitingAnswer = false } = {}) {
  p2pUiState.mode = mode;
  p2pUiState.awaitingAnswer = awaitingAnswer;
}

function updateInviteVisibility(show = false) {
  const display = show ? "" : "none";
  [p2pCodeEl, p2pCodeLabel, p2pInviteRow, p2pCopyBtn, p2pShowQrBtn, p2pHintEl].forEach((el) => {
    if (!el) return;
    el.style.display = display;
  });
}

function buildInviteUrl({ sessionId, secret, signallingUrl }) {
  try {
    const url = new URL(window.location.href);
    url.search = "";
    const params = new URLSearchParams();
    params.set("p2p", "");
    if (signallingUrl) params.set("signal", signallingUrl);
    url.search = params.toString();
    const hashParams = new URLSearchParams();
    if (sessionId) hashParams.set("s", sessionId);
    if (secret) hashParams.set("k", secret);
    url.hash = `#${hashParams.toString()}`;
    return url.toString();
  } catch (err) {
    return null;
  }
}

function renderP2PQr(link) {
  if (!p2pQrImg || !p2pQrCaption) return;
  if (!link) {
    p2pUiState.lastInviteLink = "";
    p2pUiState.lastQrDataUrl = "";
    return;
  }
  const dataUrl = createQrDataUrl(link, { size: 400, margin: 6, errorCorrection: "L" });
  p2pUiState.lastInviteLink = link;
  p2pUiState.lastQrDataUrl = dataUrl || "";
  if (p2pShowQrBtn) p2pShowQrBtn.disabled = !dataUrl;
}

function maybeLoadInviteFromUrl() {
  if (!p2pFeatureEnabled) return;
  try {
    const parsed = parseSessionLink(window.location.href);
    if (parsed && p2pCodeEl) {
      if (parsed.sessionId) p2pUiState.sessionId = parsed.sessionId;
      if (parsed.secret) p2pUiState.passcode = parsed.secret;
      p2pUiState.hostCreated = true;
      p2pUiState.inviteVisible = true;
      p2pUiState.connectedSeats = ensureConnectedSeats(p2pUiState.connectedSeats);
      p2pUiState.connectedSeats[1] = true;
      p2pCodeEl.value = buildInviteUrl({
        sessionId: parsed.sessionId,
        secret: parsed.secret,
        signallingUrl: p2pUiState.signallingUrl,
      });
      p2pUiState.loadedFromUrl = true;
      setP2PMode("joining");
      updateP2PStatus("Invite loaded from link. Generating your answer…");
      renderP2PQr(p2pCodeEl.value);
      updateInviteVisibility(true);
      renderMeeples();
      setTimeout(() => {
        joinViaSignalling(parsed.sessionId, parsed.secret);
      }, 20);
    }
  } catch (err) {
    // ignore malformed URLs
  }
}

function describeRemoteSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return "";
  const name = snapshot.fiefdomName ? ` ${snapshot.fiefdomName}` : "";
  const turn = typeof snapshot.turnIndex === "number" ? ` · Turn ${Math.max(1, Number(snapshot.turnIndex))}` : "";
  return `${name}${turn}`;
}

function deepClone(data) {
  try {
    if (typeof structuredClone === "function") return structuredClone(data);
  } catch (err) {
    // fall through to JSON copy
  }
  try {
    return JSON.parse(JSON.stringify(data));
  } catch (err) {
    return null;
  }
}

function isFiniteNumber(val) {
  return typeof val === "number" && Number.isFinite(val);
}

function sanitizeDie(die) {
  if (!die || typeof die !== "object") return null;
  const face = isFiniteNumber(die.face) || die.face === "X" || die.face === "windrose" ? die.face : null;
  const resolved = isFiniteNumber(die.resolved) ? die.resolved : null;
  const choices = Array.isArray(die.choices) ? die.choices.filter(isFiniteNumber) : [];
  const clean = { face, choices, resolved };
  if (typeof die.label === "string") clean.label = die.label;
  return clean;
}

function sanitizeDice(dice, limit = 4) {
  if (!Array.isArray(dice)) return null;
  const clean = dice.slice(0, limit).map((d) => sanitizeDie(d)).filter(Boolean);
  return clean.length ? clean : null;
}

function sanitizeNumberArray(arr, limit = 4) {
  if (!Array.isArray(arr)) return [];
  return arr.filter(isFiniteNumber).slice(0, limit);
}

function sanitizeLocationPairs(pairs) {
  if (!Array.isArray(pairs)) return [];
  return pairs
    .filter((p) => Array.isArray(p) && p.length === 2 && isFiniteNumber(p[0]) && isFiniteNumber(p[1]))
    .map((p) => [p[0], p[1]]);
}

function sanitizeBuildDoneMap(map, seats = 1) {
  const total = Math.max(1, Number(seats) || 1);
  const clean = {};
  for (let i = 1; i <= total; i += 1) {
    clean[i] = Boolean(map?.[i]);
  }
  return clean;
}

function sanitizeSnapshot(raw) {
  const clone = deepClone(raw);
  if (!clone || typeof clone !== "object") return { ok: false, reason: "invalid object" };
  if (clone.version && clone.version !== "1") return { ok: false, reason: "unsupported snapshot version" };

  const seatsTotal = Math.max(1, Number(clone.seatsTotal || 1) || 1);
  const dice = sanitizeDice(clone.dice);
  if (!dice) return { ok: false, reason: "invalid dice array" };

  return {
    ok: true,
    snapshot: {
      version: clone.version || "1",
      sessionId: clone.sessionId || null,
      turnIndex: isFiniteNumber(clone.turnIndex) ? clone.turnIndex : 0,
      activeTurn: typeof clone.activeTurn === "boolean" ? clone.activeTurn : true,
      rollAvailable: typeof clone.rollAvailable === "boolean" ? clone.rollAvailable : true,
      dice,
      locationSelection: sanitizeNumberArray(clone.locationSelection, 2),
      locationPairs: sanitizeLocationPairs(clone.locationPairs),
      lockedLocationDice: sanitizeDice(clone.lockedLocationDice, 2),
      lockedBuildDice: sanitizeDice(clone.lockedBuildDice, 2),
      lockedLocationPairs: sanitizeLocationPairs(clone.lockedLocationPairs),
      diceLocked: Boolean(clone.diceLocked),
      lastLocationDice: sanitizeDice(clone.lastLocationDice) || [],
      lastBuildDice: sanitizeDice(clone.lastBuildDice) || [],
      forcedLocationDice: sanitizeNumberArray(clone.forcedLocationDice, 2),
      pestilence: Boolean(clone.pestilence),
      pestilenceInfo: clone.pestilenceInfo && typeof clone.pestilenceInfo === "object" ? clone.pestilenceInfo : null,
      forceForfeit: Boolean(clone.forceForfeit),
      pendingNextRoll: Boolean(clone.pendingNextRoll),
      bannerOverride: typeof clone.bannerOverride === "string" ? clone.bannerOverride : null,
      seatsTotal,
      activeSeat: isFiniteNumber(clone.activeSeat) ? clone.activeSeat : null,
      splitLocked: Boolean(clone.splitLocked),
      buildDone: sanitizeBuildDoneMap(clone.buildDone, seatsTotal),
      fiefdomName: typeof clone.fiefdomName === "string" ? clone.fiefdomName : "",
    },
  };
}

function buildFullSnapshot() {
  const base = {
    version: "1",
    sessionId: p2pUiState.sessionId,
    turnIndex: state.turnIndex,
    activeTurn: state.activeTurn,
    rollAvailable: state.rollAvailable,
    dice: state.dice,
    locationSelection: state.locationSelection,
    locationPairs: state.locationPairs,
    lockedLocationDice: state.lockedLocationDice,
    lockedBuildDice: state.lockedBuildDice,
    lockedLocationPairs: state.lockedLocationPairs,
    diceLocked: state.diceLocked,
    lastLocationDice: state.lastLocationDice,
    lastBuildDice: state.lastBuildDice,
    forcedLocationDice: state.forcedLocationDice,
    pendingNextRoll: state.pendingNextRoll,
    bannerOverride: state.bannerOverride,
    seatsTotal: p2pUiState.seatsTotal,
    activeSeat: p2pUiState.activeSeat,
    splitLocked: p2pUiState.splitLocked,
    buildDone: ensureBuildDoneMap(),
  };
  return base;
}

function applyFullSnapshot(snapshot) {
  const validation = sanitizeSnapshot(snapshot);
  if (!validation.ok) {
    logP2P(`Snapshot rejected: ${validation.reason || "invalid"}.`);
    return;
  }
  const snap = validation.snapshot;
  const seatsTotal = snap.seatsTotal || p2pUiState.seatsTotal;
  p2pUiState.splitUsed = ensureSplitUsedMap(seatsTotal, p2pUiState.splitUsed);
  state.turnIndex = typeof snap.turnIndex === "number" ? snap.turnIndex : state.turnIndex;
  state.activeTurn = typeof snap.activeTurn === "boolean" ? snap.activeTurn : state.activeTurn;
  state.rollAvailable = typeof snap.rollAvailable === "boolean" ? snap.rollAvailable : state.rollAvailable;
  state.dice = snap.dice || state.dice;
  state.locationSelection = snap.locationSelection || state.locationSelection;
  state.locationPairs = snap.locationPairs || state.locationPairs;
  state.lockedLocationDice = snap.lockedLocationDice || null;
  state.lockedBuildDice = snap.lockedBuildDice || null;
  state.lockedLocationPairs = snap.lockedLocationPairs || null;
  state.diceLocked = Boolean(snap.diceLocked);
  state.lastLocationDice = snap.lastLocationDice || state.lastLocationDice;
  state.lastBuildDice = snap.lastBuildDice || state.lastBuildDice;
  state.forcedLocationDice = snap.forcedLocationDice || [];
  state.pestilence = Boolean(snap.pestilence);
  state.forceForfeit = Boolean(snap.forceForfeit);
  if (state.pestilence) {
    state.pestilenceInfo = computePestilenceInfo(state.dice, state.board);
    const locIdx = [];
    const buildIdx = [];
    (state.dice || []).forEach((die, idx) => {
      if (die?.label?.startsWith("N") || die?.face === "windrose") locIdx.push(idx);
      else buildIdx.push(idx);
    });
    state.locationSelection = locIdx.slice(0, 2);
    const forcedSplit = splitForcedDice(state.dice || []);
    state.locationPairs = uniqueLocationPairs(forcedSplit.locationDice);
    state.lockedLocationDice = forcedSplit.locationDice;
    state.lockedBuildDice = forcedSplit.buildDice;
    state.lockedLocationPairs = state.locationPairs;
    p2pUiState.splitLocked = true;
    state.diceLocked = true;
  } else if (snap.pestilenceInfo) {
    state.pestilenceInfo = snap.pestilenceInfo;
  }
  state.pendingNextRoll = Boolean(snap.pendingNextRoll);
  state.bannerOverride = snap.bannerOverride || null;
  if (snap.seatsTotal) p2pUiState.seatsTotal = snap.seatsTotal;
  const incomingBuildDone = snap.buildDone ? ensureBuildDoneMap(seatsTotal, snap.buildDone) : ensureBuildDoneMap(seatsTotal);
  p2pUiState.buildDone = incomingBuildDone;
  p2pUiState.splitLocked = Boolean(snap.splitLocked);
  if (typeof snap.activeSeat === "number") {
    setActiveSeat(snap.activeSeat);
  }
  const waitingNonActive = awaitingSplitNonActive(snap.activeSeat);
  if (p2pUiState.splitLocked) {
    state.diceLocked = true;
    if (snap.lockedLocationDice) state.lockedLocationDice = snap.lockedLocationDice;
    if (snap.lockedBuildDice) state.lockedBuildDice = snap.lockedBuildDice;
    if (snap.lockedLocationPairs) state.lockedLocationPairs = snap.lockedLocationPairs;
  } else {
    const doubleX = Array.isArray(state.dice) && state.dice.filter((d) => d?.face === "X").length === 2;
    if (doubleX) {
      state.pestilence = true;
      state.pestilenceInfo = computePestilenceInfo(state.dice, state.board);
    }
    const inPestilence = state.pestilence || doubleX;
    if (state.pestilence && state.lockedLocationDice?.length === 2 && state.lockedBuildDice?.length === 2) {
      p2pUiState.splitLocked = true;
      state.diceLocked = true;
    } else if (waitingNonActive && !state.diceLocked && !inPestilence) {
      // Active player has not locked the split; show only forced windrose, keep everything else unallocated for this player.
      const windroseIdx = (snapshot.forcedLocationDice || []).filter((idx) => snapshot.dice?.[idx]?.face === "windrose");
      state.locationSelection = windroseIdx.slice();
      state.forceForfeit = false;
      state.locationPairs = [];
      state.buildDice = [];
      state.lastBuildDice = [];
      state.lockedLocationDice = null;
      state.lockedBuildDice = null;
      state.lockedLocationPairs = null;
      p2pUiState.splitLocked = false;
      state.diceLocked = false;
    }
  }

  updateDiceAssignments();
  refreshDiceVisibility();
  highlightLocations();
  updateTurnStatusChip();
  updateMultiplayerButtons();
  p2pUiState.remoteSnapshot = snap;
}

function sendAppMessage(type, payload = {}) {
  if (!p2p?.sendMessage) return { ok: false };
  try {
    const res = p2p.sendMessage(type, payload);
    return res;
  } catch (err) {
    logP2P("send message failed", err?.message || err);
    return { ok: false, error: err?.message };
  }
}

function sendStateSnapshot() {
  const snapshot = buildFullSnapshot();
  sendAppMessage("state:full", { snapshot });
}

function syncStateToPeer() {
  if (!isMultiplayerActive()) return;
  sendStateSnapshot();
}

async function startP2PHosting() {
  if (!p2p?.supported) {
    updateP2PStatus("Manual P2P is not supported here.");
    return;
  }
  if (!p2pUiState.signallingUrl) {
    disableP2P("P2P disabled: signalling unavailable.");
    return;
  }
  p2pUiState.seatId = 1;
  p2pUiState.seatsTotal = Math.max(1, p2pUiState.seatsTotal || 1);
  setActiveSeat(p2pUiState.activeSeat || 1);
  resetBuildDoneMap();
  updateMultiplayerButtons();
  setP2PMode("hosting", { awaitingAnswer: true });
  updateP2PStatus("Building invite…");
  try {
    const { code, error } = await p2p.startHosting(readP2PSecret());
    if (error) {
      setP2PMode("idle");
      updateP2PStatus(error);
      logP2P(error);
      return;
    }
    const compact = await compressToBase64Url(code || "");
    if (!p2pUiState.sessionId) p2pUiState.sessionId = freshSessionId();
    p2pUiState.hostCreated = true;
    p2pUiState.inviteVisible = true;
    p2pUiState.connectedSeats = ensureConnectedSeats(p2pUiState.connectedSeats);
    p2pUiState.connectedSeats[1] = true;
    const secret = readP2PSecretOrDefault();
    const sessionId = p2pUiState.sessionId;
    const shareLink = buildInviteUrl({
      sessionId,
      secret,
      signallingUrl: p2pUiState.signallingUrl,
    });
    if (sessionId) p2pUiState.sessionId = sessionId;
    if (p2pCodeEl) p2pCodeEl.value = shareLink || "";
    renderP2PQr(shareLink);
    updateInviteVisibility(true);
    renderMeeples();
    if (p2pCopyBtn) p2pCopyBtn.disabled = false;
    const sent = await sendSignalBlob("host", compact, secret);
    if (sent.ok) {
      p2pUiState.signallingActive = true;
      setP2PMode("awaitingAnswer", { awaitingAnswer: true });
      updateP2PStatus("Invite ready. Waiting for answer via signalling… (QR/link sharing still works)");
      pollSignal("host", secret, { timeoutMs: 60000 }).then(async (answerCompact) => {
        if (!answerCompact) {
          logP2P("poll timeout waiting for answer");
          disconnectP2P("Signalling timeout. Resetting P2P.");
          return;
        }
        const answerCode = await decompressFromBase64Url(answerCompact).catch(() => null);
        if (!answerCode) return;
        await p2p.applyAnswer(answerCode, secret);
        updateP2PStatus("Answer received via signalling. Completing link…");
      });
    } else {
      disableP2P("Signalling unavailable. P2P disabled.");
    }
  } catch (err) {
    setP2PMode("idle");
    const message = err?.message || "Unable to create invite.";
    updateP2PStatus(message);
    logP2P(message);
  }
}

function disconnectP2P(reason = "") {
  if (p2p?.disconnect) p2p.disconnect(reason);
  if (p2pUiState.signallingPoll) {
    clearTimeout(p2pUiState.signallingPoll);
    p2pUiState.signallingPoll = null;
  }
  p2pUiState.signallingActive = false;
  p2pUiState.channelOpen = false;
  p2pUiState.remoteSnapshot = null;
  setP2PMode("idle");
  p2pUiState.sessionId = freshSessionId();
  p2pUiState.signallingDisabled = false;
  p2pUiState.seatsTotal = 1;
  p2pUiState.seatId = 1;
  p2pUiState.hostCreated = false;
  p2pUiState.inviteVisible = false;
  p2pUiState.connectedSeats = ensureConnectedSeats();
  setActiveSeat(1);
  p2pUiState.splitLocked = false;
  resetBuildDoneMap();
  resetSecretField();
  if (p2pCodeEl) p2pCodeEl.value = "";
  renderP2PQr("");
  if (p2pCopyBtn) p2pCopyBtn.disabled = true;
  if (p2pShowQrBtn) p2pShowQrBtn.disabled = true;
  updateP2PStatus(reason || "P2P link reset.");
  updateInviteVisibility(false);
  renderMeeples();
}

function setupP2PControls() {
  if (!p2pFeatureEnabled) return;
  if (!p2pPanel) return;
  if (p2pHintEl) p2pHintEl.style.display = "none";
  updateInviteVisibility(false);
  p2pUiState.signallingUrl = resolveSignallingUrl();
  if (!p2pUiState.signallingUrl) {
    disableP2P("P2P disabled: signalling URL unavailable.");
    return;
  }
  const supported = Boolean(p2p?.supported);
  const controls = [p2pHostBtn, p2pJoinBtn, p2pApplyBtn, p2pCopyBtn, p2pDisconnectBtn, p2pCodeEl];
  if (!supported) {
    controls.forEach((el) => {
      if (!el) return;
      el.disabled = true;
    });
    updateP2PStatus("Manual P2P is not available in this browser.");
    return;
  }
  if (p2pHostBtn) p2pHostBtn.onclick = () => startP2PHosting();
  if (p2pJoinBtn) p2pJoinBtn.style.display = "none";
  if (p2pApplyBtn) p2pApplyBtn.style.display = "none";
  if (p2pCopyBtn) {
    p2pCopyBtn.onclick = () => copyInviteLink();
    p2pCopyBtn.disabled = true;
  }
  if (p2pDisconnectBtn) p2pDisconnectBtn.onclick = () => disconnectP2P("P2P link reset.");
  if (p2pSendAnswerBtn) p2pSendAnswerBtn.style.display = "none";
  if (p2pCodeEl) p2pCodeEl.style.display = "none";
  if (p2pCodeLabel) p2pCodeLabel.style.display = "none";
  if (p2pShowQrBtn) {
    p2pShowQrBtn.onclick = () => toggleQrModal(true);
    p2pShowQrBtn.disabled = true;
  }
  if (p2pQrClose) p2pQrClose.onclick = () => toggleQrModal(false);
  if (p2pQrModal) {
    p2pQrModal.addEventListener("click", (e) => {
      if (e.target === p2pQrModal) toggleQrModal(false);
    });
  }
  resetSecretField();
  maybeLoadInviteFromUrl();
  updateP2PStatus();
  updateMultiplayerButtons();
}

function updateP2PControlsVisibility(status = {}) {
  if (!p2pFeatureEnabled) return;
  if (p2pUiState.signallingDisabled) {
    const all = [p2pHostBtn, p2pJoinBtn, p2pApplyBtn, p2pCopyBtn, p2pDisconnectBtn, p2pSendAnswerBtn, p2pCodeEl, p2pCodeLabel, p2pQrImg, p2pQrCaption];
    all.forEach((el) => {
      if (!el) return;
      el.style.display = "none";
      el.disabled = true;
    });
    return;
  }
  if (status && status.supported === false) {
    const all = [p2pHostBtn, p2pJoinBtn, p2pApplyBtn, p2pCopyBtn, p2pDisconnectBtn, p2pSendAnswerBtn, p2pCodeEl, p2pCodeLabel, p2pShowQrBtn];
    all.forEach((el) => {
      if (!el) return;
      el.disabled = true;
    });
    updateInviteVisibility(false);
    return;
  }
  const gameStarted = state.turnIndex > 0;
  const isJoiner = p2pUiState.seatId && p2pUiState.seatId > 1;
  const hideInvites = gameStarted || isJoiner;

  // Manual code/answer UI hidden; only host button and passcode remain (when allowed).
  if (p2pHostBtn) p2pHostBtn.style.display = hideInvites ? "none" : "inline-block";
  if (p2pJoinBtn) p2pJoinBtn.style.display = "none";
  if (p2pApplyBtn) p2pApplyBtn.style.display = "none";
  const showInviteFields = p2pUiState.inviteVisible && !hideInvites;
  if (p2pCopyBtn) p2pCopyBtn.style.display = showInviteFields ? "inline-block" : "none";
  if (p2pShowQrBtn) p2pShowQrBtn.style.display = showInviteFields ? "inline-block" : "none";
  if (p2pSendAnswerBtn) p2pSendAnswerBtn.style.display = "none";
  if (p2pCodeEl) p2pCodeEl.style.display = showInviteFields ? "inline-block" : "none";
  if (p2pCodeLabel) p2pCodeLabel.style.display = showInviteFields ? "inline-block" : "none";
  if (p2pInviteRow) p2pInviteRow.style.display = showInviteFields ? "grid" : "none";
  if (p2pHintEl) p2pHintEl.style.display = showInviteFields ? "block" : "none";
  if (p2pHostBtn) p2pHostBtn.disabled = gameStarted || hideInvites;
  if (p2pDisconnectBtn) p2pDisconnectBtn.disabled = gameStarted;
}

function resolveSignallingUrl() {
  const paramUrl = new URLSearchParams(window.location.search).get("signal");
  if (paramUrl) return paramUrl;
  const dataUrl = document.body?.dataset?.signallingUrl;
  if (dataUrl) return dataUrl;
  const host = window.location.hostname || "";
  const isLoopback = host === "localhost" || host === "127.0.0.1";
  const isPrivateIp =
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\\d|3[0-1])\./.test(host) ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ||
    host.endsWith(".local");
  if (isLoopback || isPrivateIp) {
    return `http://${host}:8787`;
  }
  return "https://signal.rolling-fiefdoms.edno.io";
}

function disableP2P(reason = "P2P disabled") {
  p2pUiState.signallingDisabled = true;
  p2pUiState.signallingActive = false;
  if (p2pUiState.signallingPoll) {
    clearTimeout(p2pUiState.signallingPoll);
    p2pUiState.signallingPoll = null;
  }
  p2pUiState.mode = "idle";
  p2pUiState.awaitingAnswer = false;
  p2pUiState.hostCreated = false;
  p2pUiState.inviteVisible = false;
  p2pUiState.connectedSeats = ensureConnectedSeats();
  logP2P("P2P disabled:", reason);
  if (p2pCopyBtn) p2pCopyBtn.disabled = true;
  updateP2PStatus(reason);
  updateInviteVisibility(false);
  renderMeeples();
}

async function sendSignalBlob(role, compactCode, secret) {
  if (!p2pUiState.signallingUrl || !compactCode) return { ok: false };
  const safeSecret = secret || readP2PSecretOrDefault();
  try {
    const url = new URL(`/session/${p2pUiState.sessionId || "session"}`, p2pUiState.signallingUrl);
    url.searchParams.set("role", role);
    url.searchParams.set("secret", safeSecret);
    logP2P("sending signal", { role, url: url.toString() });
    const resp = await fetch(url.toString(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sdp: compactCode, ice: [] }),
    });
    if (!resp.ok) logP2P("signal send failed", resp.status);
    return { ok: resp.ok, status: resp.status };
  } catch (err) {
    logP2P("signal send error", err?.message || err);
    return { ok: false, error: err?.message };
  }
}

async function pollSignal(role, secret, { timeoutMs = 20000, intervalMs = 1200 } = {}) {
  if (!p2pUiState.signallingUrl) return null;
  const safeSecret = secret || readP2PSecretOrDefault();
  const start = Date.now();
  let timer = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const url = new URL(`/session/${p2pUiState.sessionId || "session"}`, p2pUiState.signallingUrl);
      url.searchParams.set("role", role);
      url.searchParams.set("secret", safeSecret);
      logP2P("polling signal", { role, url: url.toString() });
      const resp = await fetch(url.toString());
      if (resp.status === 200) {
        const data = await resp.json();
        if (data?.sdp) return data.sdp;
      } else if (resp.status === 403) {
        logP2P("poll forbidden");
        return null;
      }
    } catch (err) {
      logP2P("poll error", err?.message || err);
    }
    await new Promise((r) => {
      timer = setTimeout(r, intervalMs);
      p2pUiState.signallingPoll = timer;
    });
  }
  logP2P("poll timeout");
  return null;
}

async function joinViaSignalling(sessionId, secret) {
  if (!sessionId || !p2pUiState.signallingUrl) {
    disableP2P("P2P disabled: missing session or signalling.");
    return;
  }
  p2pUiState.sessionId = sessionId;
  p2pUiState.seatId = 2;
  p2pUiState.seatsTotal = Math.max(2, p2pUiState.seatsTotal || 0);
  p2pUiState.hostCreated = true;
  p2pUiState.inviteVisible = true;
  p2pUiState.connectedSeats = ensureConnectedSeats(p2pUiState.connectedSeats);
  p2pUiState.connectedSeats[1] = true;
  p2pUiState.connectedSeats[2] = true;
  setActiveSeat(p2pUiState.activeSeat || 1);
  resetBuildDoneMap();
  updateMultiplayerButtons();
  updateInviteVisibility(true);
  renderMeeples();
  const safeSecret = secret || readP2PSecretOrDefault();
  updateP2PStatus("Fetching host invite via signalling…");
  const hostOfferCompact = await pollSignal("join", safeSecret, { timeoutMs: 60000 });
  if (!hostOfferCompact) {
    disableP2P("Signalling failed to deliver host invite.");
    return;
  }
  const hostOffer = await decompressFromBase64Url(hostOfferCompact).catch(() => null);
  if (!hostOffer) {
    disableP2P("Invalid host invite from signalling.");
    return;
  }
  const result = await p2p.acceptInvite(hostOffer, safeSecret);
  if (result?.error) {
    disableP2P(result.error || "Failed to accept invite.");
    return;
  }
  const answerCode = result?.code || "";
  const compactAnswer = await compressToBase64Url(answerCode);
  const sent = await sendSignalBlob("join", compactAnswer, safeSecret);
  if (!sent.ok) {
    disableP2P("Signalling unavailable when sending answer.");
    return;
  }
  p2pUiState.signallingActive = true;
  setP2PMode("connecting");
  updateP2PStatus("Answer sent via signalling. Waiting for host to connect.");
}

function rollDice() {
  if (state.activationMode) return;
  if (!debugMode && !state.rollAvailable) {
    log("Roll already used this turn. Finish the turn to roll again.");
    return;
  }
  if (p2pUiState.seatsTotal > 1 && p2pUiState.activeSeat !== p2pUiState.seatId) {
    logP2P("Roll ignored: not your turn.");
    return;
  }
  resetBuildDoneMap();
  const n1 = rollNumberedDie("N1");
  const n2 = rollNumberedDie("N2");
  const x1 = rollXDie("X1");
  const x2 = rollXDie("X2");
  const dice = [n1, n2, x1, x2];
  const needsDoubleReroll = shouldRerollDoubleWindrose(dice);
  const turnIndexOverride = typeof state.pendingTurnIndex === "number" ? state.pendingTurnIndex : null;
  const baseActiveTurn = typeof state.pendingActiveTurn === "boolean" ? state.pendingActiveTurn : null;
  const activeTurnOverride = isMultiplayerActive() ? true : baseActiveTurn;
  p2pUiState.splitLocked = false;
  p2pUiState.buildDone = { ...p2pUiState.buildDone };
  updateMultiplayerButtons();

  state.bannerOverride = null;
  if (!needsDoubleReroll) {
    triggerDiceAnimation();
    state.rollAvailable = debugMode ? true : false;
    updateRollButton();
  }
  const { messages } = beginTurn(state, dice, state.board, {
    uniqueLocationPairs,
    computePestilenceInfo,
    filterAvailablePairs,
    sectionLabels,
    turnIndexOverride,
    activeTurnOverride,
  });
  if (isMultiplayerActive()) {
    syncStateToPeer();
  }
  state.pendingTurnIndex = null;
  state.pendingActiveTurn = null;
  const rollMsg = `Rolled ${describeDice(dice)}`;
  if (Array.isArray(messages) && messages.length) {
    const statusPattern = /^(Active|Non-active) turn/;
    const status = statusPattern.test(messages[0]) ? messages[0] : null;
    let extras = status ? messages.slice(1) : messages.slice(); // windrose/pestilence/etc
    if (needsDoubleReroll) {
      extras = extras.filter((m) => !m.startsWith("Windrose rolled"));
    }
    if (status) log(status);
    log(rollMsg); // mid-layer
    extras.forEach((m) => log(m)); // newest
  } else {
    log(rollMsg);
  }
  if (needsDoubleReroll) {
    const msg = "Double windrose rolled; press Roll Dice to reroll.";
    log(msg);
    state.bannerOverride =
      'Double <img src="assets/img/windrose.svg" alt="windrose" class="inline-icon"> rolled; press Roll Dice to reroll.';
    updateActionBanner();
    state.pendingTurnIndex = state.turnIndex;
    state.pendingActiveTurn = state.activeTurn;
    prepareNextRoll();
    renderSelectionDice([], []);
    return;
  }
  if (state.pestilence) {
    const target = state.pestilenceInfo?.sectionLabel || "any section";
    if (turnHintEl) turnHintEl.textContent = `Pestilence! Forfeit a plot in ${target}.`;
    if (state.pestilenceInfo?.sectionLabel && state.pestilenceInfo.targetCells.length === 0) {
      log("Target section is full; forfeit any empty plot.");
    }
    // Auto-assign the split for pestilence: numbered/windrose stay in location, X dice in build.
    const forcedSplit = splitForcedDice(state.dice || []);
    const locIdx = [];
    const buildIdx = [];
    (state.dice || []).forEach((die, idx) => {
      if (die?.label?.startsWith("N") || die?.face === "windrose") locIdx.push(idx);
      else buildIdx.push(idx);
    });
    state.locationSelection = locIdx.slice(0, 2);
    state.locationPairs = uniqueLocationPairs(forcedSplit.locationDice);
    state.lockedLocationDice = forcedSplit.locationDice;
    state.lockedBuildDice = forcedSplit.buildDice;
    state.lockedLocationPairs = state.locationPairs;
    p2pUiState.splitLocked = true;
    state.forceForfeit = true;
    state.diceLocked = true;
  } else if (turnHintEl) {
    turnHintEl.textContent = state.activeTurn
      ? ""
      : isMultiplayerActive()
        ? "Waiting for the active player to finish the split."
        : "Non-active turn. Dice automatically assigned.";
  }
  updateTurnStatusChip();
  const nonActiveMultiplayer = isMultiplayerActive() && p2pUiState.activeSeat !== p2pUiState.seatId;
  if (nonActiveMultiplayer && !state.pestilence && !state.forceForfeit) {
    state.locationSelection = [];
    state.locationPairs = [];
    state.buildDice = [];
    state.lockedLocationDice = null;
    state.lockedBuildDice = null;
    state.lockedLocationPairs = null;
    p2pUiState.splitLocked = false;
    state.diceLocked = false;
  }
  updateDiceAssignments();
  renderDice();
  updateActionBanner();
  syncStateToPeer();
}

function describeDice(dice) {
  return dice
    .map((d) => {
      const face =
        d.face === "X"
          ? "X"
          : d.face === "windrose"
            ? "windrose"
            : d.face;
      return `${d.label}:${face}`;
    })
    .join(", ");
}

function triggerDiceAnimation() {
  if (!diceView) return;
  state.diceRolling = true;
  diceView.classList.add("dice-rolling");
  const rollingMsg = "Rolling dice...";
  state.bannerOverride = rollingMsg;
  updateActionBanner();
  setTimeout(() => {
    state.diceRolling = false;
    diceView.classList.remove("dice-rolling");
    if (state.bannerOverride === rollingMsg) state.bannerOverride = null;
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
  const awaitingRoll = state.rollAvailable && (!state.dice || state.dice.length === 0);
  if (state.activationMode || state.activationComplete || awaitingRoll) return;
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
      const waitingSplit = awaitingSplitNonActive();
      if (waitingSplit && (state.pestilence || state.forceForfeit)) {
        turnHintEl.textContent = "Forfeit a plot.";
      } else if (p2pUiState.splitLocked) {
        turnHintEl.textContent = "";
      } else {
        turnHintEl.textContent = isMultiplayerActive()
          ? "Waiting for the active player to finish the split."
          : "Non-active turn. Dice automatically assigned.";
      }
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
      forcedLocation: (state.forcedLocationDice || []).includes(idx),
    });
    row.appendChild(badge);
  });
  field.appendChild(row);
  diceView.appendChild(field);
  diceView.classList.toggle("dice-rolling", state.diceRolling);
}

function fillBuildings(buildDice) {
  const hasLockedLocation = p2pUiState.splitLocked && Array.isArray(state.lockedLocationDice) && state.lockedLocationDice.length === 2;
  const diceLockedForBuild = state.diceLocked && !p2pUiState.splitLocked;
  let effectiveBuildDice = hasLockedLocation && state.lockedBuildDice?.length === 2 ? state.lockedBuildDice : buildDice;
  if (hasLockedLocation) {
    const choice = lockedPairChoice();
    effectiveBuildDice = choice.buildDice || effectiveBuildDice;
    // keep state in sync so downstream pop calculation has the swapped build dice
    state.buildDice = effectiveBuildDice;
  }

  if ((!hasLockedLocation && state.locationSelection.length !== 2) || diceLockedForBuild) {
    state.buildChoice = null;
    state.selectedGuildType = null;
    renderBuildingOverlay([], true);
    return;
  }
  if (state.activationMode || state.forceForfeit || state.pestilence) {
    renderBuildingOverlay([], true);
    return;
  }
  const allowed = restrictBuildOptionsForBoard(buildingOptionsFromDice(effectiveBuildDice), state.board);
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
  const hasLockedLocation = p2pUiState.splitLocked && Array.isArray(state.lockedLocationDice) && state.lockedLocationDice.length === 2;
  const diceLockedForBuild = state.diceLocked && !p2pUiState.splitLocked;
  const forceDisabled =
    disabled ||
    (!hasLockedLocation && state.locationSelection.length !== 2) ||
    diceLockedForBuild ||
    state.activationMode ||
    state.forceForfeit ||
    state.pestilence;
  const buildDice =
    hasLockedLocation && state.lockedBuildDice?.length === 2
      ? (lockedPairChoice().buildDice || state.lockedBuildDice)
      : state.buildDice;
  if ((!options || !options.length) && buildDice?.length && !forceDisabled) {
    const fallback = restrictBuildOptionsForBoard(buildingOptionsFromDice(buildDice), state.board);
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
      const hasLockedLocation = p2pUiState.splitLocked && Array.isArray(state.lockedLocationDice) && state.lockedLocationDice.length === 2;
      const diceLockedForBuild = state.diceLocked && !p2pUiState.splitLocked;
      if ((!hasLockedLocation && state.locationSelection.length !== 2) || diceLockedForBuild) return;
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
  const hasLockedLocation = state.diceLocked && Array.isArray(state.lockedLocationDice) && state.lockedLocationDice.length === 2;
  const awaitingSplit = isMultiplayerActive() && !p2pUiState.splitLocked && !state.pestilence && !state.forceForfeit;
  const phase = currentTurnPhase();
  if (state.locationSelection.length < 2 && !hasLockedLocation && !state.pestilence && !state.forceForfeit && !state.activationMode) {
    log("Split the dice first, then pick a plot.");
    return;
  }
  if (awaitingSplit) {
    log("Wait for the active player to finish the split.");
    return;
  }
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
  const locPairs =
    p2pUiState.splitLocked && Array.isArray(state.lockedLocationDice) && state.lockedLocationDice.length === 2
      ? effectiveLockedLocationPairs()
      : state.locationPairs;
  if (!locPairs?.length) {
    log("Select two dice for Location first.");
    return;
  }
  const matches = locPairs.some(([a, b]) => {
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
  if (phase !== TURN_PHASE.BUILDING && phase !== TURN_PHASE.SPLITTING) {
    log("Finish the current step before building.");
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
  const lockedAgainstPlacement = state.pestilence || (state.diceLocked && !p2pUiState.splitLocked);
  if (lockedAgainstPlacement) {
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
  const showLockedHighlight =
    p2pUiState.splitLocked && Array.isArray(state.lockedLocationDice) && state.lockedLocationDice.length === 2;
  const locPairs = showLockedHighlight ? effectiveLockedLocationPairs() : state.locationPairs;
  if ((state.locationSelection.length !== 2 && !showLockedHighlight) || !locPairs?.length) return;
  boardEl.querySelectorAll(".cell").forEach((cell) => {
    const r = parseInt(cell.dataset.row, 10);
    const c = parseInt(cell.dataset.col, 10);
    const data = state.board[r][c];
    const match = locPairs.some(([a, b]) => {
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
  const buildPool =
    p2pUiState.splitLocked && Array.isArray(state.lockedBuildDice) && state.lockedBuildDice.length === 2
      ? (lockedPairChoice().buildDice || state.lockedBuildDice)
      : state.buildDice;
  const popGain =
    state.buildChoice?.source === "die1"
      ? dieMaxValue(buildPool[1])
      : state.buildChoice?.source === "die2"
        ? dieMaxValue(buildPool[0])
        : 0;
  lockDiceSnapshot(state, { markPendingNextRoll: true, uniqueLocationPairs });
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
  if (isMultiplayerActive()) {
    const map = ensureSplitUsedMap();
    map[p2pUiState.seatId] = true;
    p2pUiState.splitUsed = map;
  } else {
    state.splitUsedForBuild = true;
  }
  p2pUiState.lockedPairSwap = false;
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
    autoMarkBuildDoneIfReady({ force: true });
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
  refreshScoreOverlay();
  state.pendingSpringhouseTarget = null;
  autoAdvance();
  maybeRollAfterLock();
  autoMarkBuildDoneIfReady();
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
  const forcedFlow = state.pestilence || state.forceForfeit;
  cell.forfeited = true;
  lockDiceSnapshot(state, { markPendingNextRoll: true, uniqueLocationPairs });
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
  refreshScoreOverlay();
  autoAdvance();
  maybeRollAfterLock();
  autoMarkBuildDoneIfReady({ force: forcedFlow });
}

function updateTracks() {
  const { vagrants, scoreResult } = recalcTracks(state, {
    computeScore,
    calcVagrants,
  });
  updateScoreOverlay(scoreResult.breakdown, scoreResult.total);
  renderPopHousingTrack(state.tracks.population, state.tracks.housing, vagrants);
}

function log(msg) {
  state.log.unshift(msg);
  logEl.innerHTML = state.log.map((m) => `<li>${m}</li>`).join("");
}

function autoAdvance() {
  if (isMultiplayerActive()) return;
  const { action, message } = autoAdvanceState(state, state.board);
  if (action === "activate") {
    if (message) log(message);
    enterActivationMode();
    return;
  }
  if (action === "roll") {
    prepareNextRoll();
    state.bannerOverride = state.pestilence ? "Press Roll Dice to continue after pestilence." : null;
    updateActionBanner();
  }
}

function enterActivationMode() {
  if (state.activationMode) return;
  startActivationState(state);
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
  finishActivationState(state);
  state.finalScore = currentScore({ allowPopulationActivation: true }).total;
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
  updateTurnStatusChip();
}

function newGame() {
  resetState();
  renderBoard();
  renderRegionOverlay();
  prepareNextRoll();
  renderSelectionDice([], []);
  updateTracks();
  state.pendingTurnIndex = null;
  state.pendingActiveTurn = null;
  state.deferStatusAppend = false;
  state.bannerOverride = null;
  if (turnHintEl) turnHintEl.textContent = "";
  updateActionBanner();
  if (newGameBtn) newGameBtn.style.display = "none";
  refreshDiceVisibility();
}

function handleBuildingChoice() {
  const selected = document.querySelector(".building-hit.selected");
  const hasLockedLocation = p2pUiState.splitLocked && Array.isArray(state.lockedLocationDice) && state.lockedLocationDice.length === 2;
  const diceLockedForBuild = state.diceLocked && !p2pUiState.splitLocked;
  const hasLocationReady = hasLockedLocation || state.locationSelection.length === 2;
  if (!hasLocationReady || diceLockedForBuild) {
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
  const hasLockedLocation = p2pUiState.splitLocked && Array.isArray(state.lockedLocationDice) && state.lockedLocationDice.length === 2;
  const locationReady = hasLockedLocation || state.locationSelection.length === 2;
  const locked =
    !locationReady ||
    (state.diceLocked && !p2pUiState.splitLocked) ||
    state.activationMode ||
    state.forceForfeit ||
    state.pestilence;
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
  const result = startPopulationPlacement(state, [r, c], count, { nodesForCell });
  if (!result.started) {
    if (result.message) log(result.message);
    autoAdvance();
    maybeRollAfterLock();
    return;
  }
  renderBoard();
  if (result.message) log(result.message);
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
  const result = placePopulationNode(state, nr, nc, {
    nodesForCell,
    allocatePopulationToNode,
    popCapacity: POP_CAPACITY,
  });
  if (result.message) log(result.message);
  if (!result.placed) return;
  updateTracks();
  refreshScoreOverlay();
  renderBoard();
  autoMarkBuildDoneIfReady();
  autoAdvance();
  maybeRollAfterLock();
  updateActionBanner();
}

function renderTopTracks() {
  renderDice();
}

function actionMessage() {
  if (state.bannerOverride) return state.bannerOverride;
  const isMultiplayer = p2pUiState.seatsTotal > 1 && p2pUiState.signallingActive;
  const phase = currentTurnPhase();

  if (phase === TURN_PHASE.ACTIVATION_DONE) {
    const score = typeof state.finalScore === "number"
      ? state.finalScore
      : currentScore({ allowPopulationActivation: true }).total;
    return `Game over. Final score ${score}.`;
  }
  if (phase === TURN_PHASE.ACTIVATION) {
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
  if (phase === TURN_PHASE.PESTILENCE || phase === TURN_PHASE.FORFEIT) {
    return "Forfeit an empty plot.";
  }
  if (phase === TURN_PHASE.POPULATION) {
    return `Place ${state.pendingPopulation.remaining} population on an adjacent intersection.`;
  }
  if (phase === TURN_PHASE.AWAIT_ROLL) {
    if (isMultiplayer && p2pUiState.activeSeat !== p2pUiState.seatId) {
      return "Waiting for the active player to roll dice.";
    }
    return "Press Roll Dice to start your turn.";
  }
  if (isMultiplayer && !p2pUiState.splitLocked && p2pUiState.activeSeat !== p2pUiState.seatId) {
    return "Waiting for the active player to finish the split.";
  }
  if (isMultiplayer && p2pUiState.splitLocked) {
    if (p2pUiState.buildDone?.[p2pUiState.seatId]) {
      return "Waiting for other players to finish building.";
    }
    return "Build with this split.";
  }
  if (phase === TURN_PHASE.SPLITTING) {
    if (state.locationSelection.length < 2 && !(state.diceLocked && state.lockedLocationDice?.length === 2)) {
      return "Select two location dice in the Turn panel.";
    }
    return "Lock the split to continue building.";
  }
  if (phase === TURN_PHASE.BUILDING) {
    if (!state.buildChoice) {
      return "Select a building from the Buildings overlay.";
    }
    return "Click a highlighted plot to place the chosen building.";
  }
  if (!state.activeTurn) return "Waiting for the active player.";
  return "Roll dice to begin.";
}

function updateActionBanner() {
  if (!actionBannerEl) return;
  const newText = actionMessage();
  const prevText = actionBannerEl.dataset.msg || "";
  const changed = prevText !== newText;
  actionBannerEl.dataset.msg = newText;
  if (newText && newText.includes("<")) {
    actionBannerEl.innerHTML = newText;
  } else {
    actionBannerEl.textContent = newText;
  }
  if (changed) {
    actionBannerEl.classList.remove("bump");
    void actionBannerEl.offsetWidth; // restart animation
    actionBannerEl.classList.add("bump");
  }
}

function updateMultiplayerButtons() {
  if (!finishSplitBtn) return;
  const multiplayer = isMultiplayerActive();
  const hasDice = Array.isArray(state.dice) && state.dice.length >= 4;
  const canFinishSplit =
    multiplayer &&
    p2pUiState.activeSeat === p2pUiState.seatId &&
    hasDice &&
    !p2pUiState.splitLocked &&
    state.locationSelection.length === 2 &&
    !state.pestilence &&
    !state.forceForfeit &&
    !state.activationMode;
  finishSplitBtn.style.display = canFinishSplit ? "inline-block" : "none";
  finishSplitBtn.disabled = !canFinishSplit;

  if (swapPairBtn) {
    const choice = lockedPairChoice();
    const showSwap =
      multiplayer &&
      p2pUiState.splitLocked &&
      choice.swapAllowed &&
      !state.pestilence;
    swapPairBtn.style.display = showSwap ? "inline-block" : "none";
    swapPairBtn.disabled = !showSwap;
  }

  // Done-building button removed; completion is automatic after placement/population.
}

function updateTurnStatusChip() {
  if (!turnStatusChip) return;
  const hasDice = Array.isArray(state.dice) && state.dice.length >= 4;
  const awaitingRoll = !debugMode && state.rollAvailable;
  const show = hasDice && !state.activationComplete && !awaitingRoll;
  const active = Boolean(state.activeTurn);
  const multiplayer = isMultiplayerActive();
  const isLocalActive = p2pUiState.seatId === p2pUiState.activeSeat;
  const label = multiplayer ? (isLocalActive ? "Your turn" : "Waiting turn") : active ? "Active turn" : "Non-active turn";
  if (!show) {
    turnStatusChip.classList.add("hidden");
    turnStatusChip.setAttribute("aria-hidden", "true");
  } else {
    turnStatusChip.textContent = label;
    turnStatusChip.setAttribute("aria-label", label);
    turnStatusChip.title = label;
    turnStatusChip.classList.remove("hidden");
    turnStatusChip.removeAttribute("aria-hidden");
    turnStatusChip.classList.toggle("status-active", active);
    turnStatusChip.classList.toggle("status-inactive", !active);
  }
}

function renderRegionOverlay() {
  if (!regionOverlayEl) return;
  regionOverlayEl.innerHTML = "";
  const positions = {
    forest: { top: [110, 110], left: [258, 378] },
    mountain: { top: [302, 432], left: [55, 55] },
    sea: { top: [302, 420], left: [570, 570] },
    marsh: { top: [610, 610], left: [252, 378] },
  };
  Object.entries(pestilenceAssignments).forEach(([region, nums]) => {
    const pos = positions[region];
    if (!pos || !Array.isArray(nums) || nums.length === 0) return;
    const minVal = Math.min(...nums);
    const maxVal = Math.max(...nums);
    const values = minVal === maxVal ? [minVal] : [minVal, maxVal];
    const coords = values.map((val, idx) => ({
      val,
      top: pos.top[Math.min(idx, pos.top.length - 1)],
      left: pos.left[Math.min(idx, pos.left.length - 1)],
    }));
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
  if (isMultiplayerActive()) return "wait";
  const action = maybeRollAfterLockState(state);
  if (action === "roll") {
    prepareNextRoll();
  }
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

function renderSelectionDice(locationDice = [], buildDice = [], { forceBuildPreview = false, ignoreState = false } = {}) {
  if (ignoreState) {
    const loc = locationDice || [];
    const build = forceBuildPreview ? buildDice || [] : buildDice || [];
    if (locDicePreview) renderDicePreview(locDicePreview, loc, "location", "Select 2 dice for location");
    if (buildDicePreview) renderDicePreview(buildDicePreview, build, "build", "Remaining dice used for build");
    return;
  }
  const respectSwap = () => {
    if (!(p2pUiState.splitLocked && Array.isArray(state.lockedLocationDice) && state.lockedLocationDice.length === 2)) {
      return { loc: locationDice, build: buildDice };
    }
    const choice = lockedPairChoice();
    return { loc: choice.locDice || locationDice, build: choice.buildDice || buildDice };
  };

  const currentLocFromState = state.locationSelection.map((i) => state.dice[i]).filter(Boolean);
  const forcedMode = state.pestilence || state.forceForfeit;
  const forcedSplit = forcedMode ? splitForcedDice(state.dice || []) : null;
  const doubleWindrose = shouldRerollDoubleWindrose(state.dice || []);
  const xDice = (state.dice || []).filter((d) => d && d.face === "X");

  let effectiveLoc =
    (doubleWindrose
      ? []
      : (forcedSplit && forcedSplit.locationDice.length && forcedSplit.locationDice) ||
        (locationDice && locationDice.length && locationDice) ||
        (currentLocFromState.length && currentLocFromState) ||
        (state.lockedLocationDice && state.lockedLocationDice.length && state.lockedLocationDice) ||
        []);

  const currentBuildFromState = state.dice.filter((_, idx) => !state.locationSelection.includes(idx));
  let effectiveBuild =
    doubleWindrose
      ? []
      : (forcedSplit && forcedSplit.buildDice.length)
        ? forcedSplit.buildDice
        : state.locationSelection.length === 2 || forceBuildPreview
          ? (buildDice && buildDice.length && buildDice) ||
            (currentBuildFromState.length && currentBuildFromState) ||
            (state.lockedBuildDice && state.lockedBuildDice.length && state.lockedBuildDice) ||
            (state.lastBuildDice && state.lastBuildDice.length && state.lastBuildDice) ||
            []
          : xDice;

  const swapped = respectSwap();
  effectiveLoc = swapped.loc && swapped.loc.length ? swapped.loc : effectiveLoc;
  effectiveBuild = swapped.build && swapped.build.length ? swapped.build : effectiveBuild;

  if (locDicePreview) {
    renderDicePreview(locDicePreview, effectiveLoc, "location", "Select 2 dice for location");
  }
  if (buildDicePreview) {
    renderDicePreview(buildDicePreview, effectiveBuild, "build", "Remaining dice used for build");
  }
}

function makeDieBadge(
  die,
  idx,
  { role = null, locked = false, clickable = true, showRoleStyle = true, forcedLocation = false } = {},
) {
  const badge = document.createElement("div");
  badge.className = "die-badge";
  const baseClass = die.label[0] === "X" ? "die-special" : "die-number";
  badge.classList.add(baseClass);
  const shouldLock = locked || (forcedLocation && baseClass === "die-number");
  if (shouldLock || (locked && die.face === "windrose" && baseClass === "die-number")) {
    badge.classList.add("dice-locked");
  }
  const allowRoles = showRoleStyle && !(shouldLock || (locked && die.face === "windrose"));
  if (allowRoles) {
    if (role === "location") badge.classList.add("location-selected");
    if (role === "build") badge.classList.add("build-assigned");
  }
  if (forcedLocation) badge.title = "Windrose stays in the location pair (acts as 1–5).";
  if (locked) badge.classList.add("dice-locked");
  badge.dataset.idx = idx;
  const wrap = document.createElement("div");
  wrap.className = "face-wrap";
  const face = createDieFaceSVG(die);
  wrap.appendChild(face);
  badge.appendChild(wrap);
  if (clickable && !locked && die.face !== "X") {
    badge.addEventListener("click", () => onDieClick(idx));
  }
  return badge;
}

function renderDicePreview(container, dice, role, emptyText) {
  if (!container) return;
  container.classList.add("split-preview");
  container.innerHTML = "";
  if (!dice?.length) {
    container.innerHTML = `<span class="hint">${emptyText}</span>`;
    return;
  }
  dice.forEach((die, idx) => {
    const badge = makeDieBadge(die, idx, {
      role,
      locked: false,
      clickable: false,
      showRoleStyle: false,
      forcedLocation: false,
    });
    container.appendChild(badge);
  });
}

function onDieClick(idx) {
  if (!state.activeTurn) return;
  if (p2pUiState.seatsTotal > 1 && p2pUiState.activeSeat !== p2pUiState.seatId) {
    logP2P("Dice click ignored: not active seat.");
    return;
  }
  const { message } = selectLocationDie(state, idx, {
    uniqueLocationPairs,
    filterAvailablePairs,
    board: state.board,
  });
  if (message) log(message);
  updateDiceAssignments();
}

function updateDiceAssignments() {
  if (!state.dice || !state.dice.length) {
    state.forceForfeit = false;
    state.invalidSelection = false;
    renderSelectionDice([], []);
    fillBuildings([]);
    highlightLocations();
    updateActionBanner();
    renderDice();
    updateMultiplayerButtons();
    return;
  }
  if (isMultiplayerActive() && p2pUiState.splitLocked) {
    const choice = lockedPairChoice();
    const lockedLoc = choice.locDice;
    const lockedBuild = choice.buildDice;
    const pairsForBoard = filterAvailablePairs(uniqueLocationPairs(lockedLoc || []), state.board);
    state.forceForfeit = pairsForBoard.length === 0;
    state.buildDice = lockedBuild;
    renderSelectionDice(lockedLoc, lockedBuild);
    fillBuildings(lockedBuild);
    highlightLocations();
    updateActionBanner();
    renderDice();
    updateMultiplayerButtons();
    return;
  }
  if (isMultiplayerActive() && p2pUiState.activeSeat !== p2pUiState.seatId && !p2pUiState.splitLocked) {
    const windroseOnly = (state.forcedLocationDice || [])
      .map((idx) => state.dice[idx])
      .filter((d) => d && d.face === "windrose");
    const xDice = (state.dice || []).filter((d) => d && d.face === "X");
    state.locationSelection = (state.forcedLocationDice || []).filter((idx) => state.dice[idx]?.face === "windrose");
    state.locationPairs = [];
    state.buildDice = xDice;
    state.forceForfeit = false;
    renderSelectionDice(windroseOnly, xDice, { forceBuildPreview: true, ignoreState: true });
    fillBuildings([]);
    highlightLocations();
    updateActionBanner();
    renderDice();
    updateMultiplayerButtons();
    return;
  }
  const waitingSplit = awaitingSplitNonActive();
  if (waitingSplit) {
    const windroseOnly = (state.forcedLocationDice || [])
      .map((idx) => state.dice[idx])
      .filter((d) => d && d.face === "windrose");
    const xDice = (state.dice || []).filter((d) => d && d.face === "X");
    state.locationSelection = (state.forcedLocationDice || []).filter((idx) => state.dice[idx]?.face === "windrose");
    state.locationPairs = [];
    state.buildDice = xDice;
    renderSelectionDice(windroseOnly, xDice, { forceBuildPreview: true, ignoreState: true });
    fillBuildings([]);
    highlightLocations();
    updateActionBanner();
    renderDice();
    updateMultiplayerButtons();
    return;
  }
  const locationDice = state.locationSelection.map((i) => state.dice[i]).filter(Boolean);
  const buildDice = state.locationSelection.length === 2 ? state.dice.filter((_, idx) => !state.locationSelection.includes(idx)) : [];
  if (locationDice.length === 2) {
    state.lastLocationDice = locationDice;
    state.lastBuildDice = buildDice;
  }

  const { message } = evaluateLocationSelection(state, {
    uniqueLocationPairs,
    filterAvailablePairs,
    board: state.board,
  });
  if (message) log(message);

  if (turnHintEl) {
    if (state.activeTurn && state.invalidSelection) {
      turnHintEl.textContent = "No valid plots for that pair; choose a different location pair.";
    } else if (state.forceForfeit) {
      turnHintEl.textContent = "No valid location pairs; forfeit a plot.";
    } else if (!state.activeTurn) {
      turnHintEl.textContent = isMultiplayerActive()
        ? "Waiting for the active player to finish the split."
        : "Non-active turn. Dice automatically assigned.";
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
  updateMultiplayerButtons();
  if (isMultiplayerActive() && p2pUiState.activeSeat === p2pUiState.seatId && !p2pUiState.splitLocked) {
    syncStateToPeer();
  }
}

function lockedPairChoice() {
  const baseLoc = state.lockedLocationDice || [];
  const baseBuild = state.lockedBuildDice || state.buildDice || [];
  const locHasX = baseLoc.some((d) => d?.face === "X");
  const buildHasX = baseBuild.some((d) => d?.face === "X");
  const locHasWindrose = baseLoc.some((d) => d?.face === "windrose");
  const buildHasWindrose = baseBuild.some((d) => d?.face === "windrose");

  let forcedSwap = false;
  if (locHasX && !buildHasX) forcedSwap = true;
  if (!locHasWindrose && buildHasWindrose) forcedSwap = true;

  const swapAllowed = !locHasX && !buildHasX && !forcedSwap && !(locHasWindrose && !buildHasWindrose);
  const doSwap = forcedSwap || (swapAllowed && p2pUiState.lockedPairSwap);
  return {
    locDice: doSwap ? baseBuild : baseLoc,
    buildDice: doSwap ? baseLoc : baseBuild,
    swapped: doSwap,
    swapAllowed,
  };
}

function toggleLockedPairChoice() {
  const choice = lockedPairChoice();
  if (!choice.swapAllowed) return;
  p2pUiState.lockedPairSwap = !p2pUiState.lockedPairSwap;
  updateDiceAssignments();
  updateMultiplayerButtons();
}

function finishDiceSplit() {
  if (!isMultiplayerActive()) return;
  if (p2pUiState.activeSeat !== p2pUiState.seatId) return;
  if (state.locationSelection.length !== 2) {
    log("Select two location dice before finishing the split.");
    return;
  }
  const locationDice = state.locationSelection.map((i) => state.dice[i]).filter(Boolean);
  const buildDice = state.dice.filter((_, idx) => !state.locationSelection.includes(idx));
  state.lockedLocationDice = locationDice;
  state.lockedBuildDice = buildDice;
  state.lockedLocationPairs = (state.locationPairs || []).map((p) => p.slice());
  state.diceLocked = true;
  p2pUiState.splitLocked = true;
  p2pUiState.lockedPairSwap = false;
  resetBuildDoneMap();
  renderSelectionDice(locationDice, buildDice);
  updateMultiplayerButtons();
  highlightLocations();
  updateActionBanner();
  syncStateToPeer();
}

function markBuildDone() {
  if (!isMultiplayerActive()) return;
  const allowForced = state.pestilence || state.forceForfeit;
  if (!p2pUiState.splitLocked && !allowForced) return;
  const merged = ensureBuildDoneMap();
  merged[p2pUiState.seatId] = true;
  p2pUiState.buildDone = merged;
  updateMultiplayerButtons();
  if (allBuildsMarkedDone()) {
    completeMultiplayerTurn();
  } else {
    syncStateToPeer();
  }
}

function autoMarkBuildDoneIfReady({ force = false } = {}) {
  const ready =
    isMultiplayerActive() &&
    ((p2pUiState.splitLocked || state.pestilence || state.forceForfeit) || force) &&
    !p2pUiState.buildDone?.[p2pUiState.seatId] &&
    !state.pendingPopulation?.remaining &&
    !state.pendingSpringhouseTarget;
  if (ready) {
    markBuildDone();
  }
}

function completeMultiplayerTurn() {
  if (!isMultiplayerActive()) return;
  p2pUiState.splitLocked = false;
  p2pUiState.lockedPairSwap = false;
  resetTurnState(state);
  state.rollAvailable = true;
  state.pendingTurnIndex = null;
  state.pendingActiveTurn = null;
  resetBuildDoneMap();
  setActiveSeat(nextSeatId());
  prepareNextRoll();
  updateMultiplayerButtons();
  syncStateToPeer();
}

function currentWorkerAllocationsForScore() {
  if (state.activationMode || state.activationComplete) return state.workerAllocations;
  const rows = state.board.length;
  const cols = state.board[0]?.length || 0;
  return Array.from({ length: rows }, () => Array(cols).fill(0));
}

function currentScore({ allowPopulationActivation } = {}) {
  const usePopActivation =
    typeof allowPopulationActivation === "boolean"
      ? allowPopulationActivation
      : state.activationMode || state.activationComplete;
  return computeScore(state.board, state.populationNodes, currentWorkerAllocationsForScore(), {
    allowPopulationActivation: usePopActivation,
  });
}

function refreshScoreOverlay(scoreResult = null) {
  const result = scoreResult || currentScore();
  updateScoreOverlay(result.breakdown, result.total);
  return result;
}

function updateScoreOverlay(breakdown, total = 0) {
  if (!scoreOverlayEl) return;
  const formatScoreValue = (value, key) => {
    if (typeof value !== "number") return "0";
    if (key === "reputation") return `${value}`; // reputation spot shows negatives
    return `${Math.abs(value)}`;
  };
  scoreOverlayEl.innerHTML = "";
  scoringSpots.forEach((spot) => {
      const topPos = spot.y ?? 30;
      const val =
        spot.key === "reputation"
          ? total
          : typeof breakdown[spot.key] === "number"
            ? breakdown[spot.key]
            : 0;
      const negative = typeof val === "number" && val < 0;
      const forceNegative = spot.key === "vagrants" || spot.key === "springhouse";
    const chip = document.createElement("div");
    chip.className = ["score-chip"]
      .concat(negative || forceNegative ? ["negative"] : [])
      .join(" ");
    chip.id = `score-chip-${spot.key}`;
    chip.style.left = `${spot.x}px`;
    chip.style.top = `${topPos}px`;
    chip.textContent = formatScoreValue(val, spot.key); // board art includes negatives for most spots
    scoreOverlayEl.appendChild(chip);
  });
}


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
  const result = allocateWorker(state, popSel, buildingSel, {
    nodesForCell,
    buildingRules: BUILDING_RULES,
  });
  if (result.message) log(result.message);
  if (!result.updated) return;
  renderBoard();
  highlightLocations();
  updateTracks();
}

function autoForfeitUnfillable(finalize = false) {
  const msgs = autoForfeitUnfillableState(state, {
    nodesForCell,
    buildingRules: BUILDING_RULES,
    finalize,
  });
  msgs.forEach((m) => log(m));
}
function copyInviteLink() {
  const link = (p2pCodeEl?.value || "").trim();
  if (!link) {
    updateP2PStatus("Nothing to copy yet.");
    return;
  }
  try {
    const doCopy = async () => {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
        return true;
      }
      if (p2pCodeEl && typeof p2pCodeEl.select === "function") {
        p2pCodeEl.focus();
        p2pCodeEl.select();
        return document.execCommand && document.execCommand("copy");
      }
      return false;
    };
    Promise.resolve(doCopy())
      .then((ok) => {
        if (ok) {
          if (p2pCopyBtn) {
            const original = p2pCopyBtn.textContent || "Copy";
            p2pCopyBtn.textContent = "Copied";
            p2pCopyBtn.classList.add("copied");
            setTimeout(() => {
              p2pCopyBtn.textContent = original;
              p2pCopyBtn.classList.remove("copied");
            }, 1500);
          }
          updateP2PStatus("Invite copied. Share it in chat.");
        } else {
          updateP2PStatus("Could not copy automatically. Copy the invite text manually.");
        }
      })
      .catch(() => {
        updateP2PStatus("Could not copy automatically. Copy the invite text manually.");
      });
  } catch (err) {
    updateP2PStatus("Could not copy automatically. Copy the invite text manually.");
  }
}

function renderMeeples() {
  if (!p2pMeeplesEl) return;
  if (!p2pUiState.hostCreated) {
    p2pMeeplesEl.innerHTML = "";
    p2pMeeplesEl.classList.add("hidden");
    return;
  }
  p2pUiState.connectedSeats = ensureConnectedSeats(p2pUiState.connectedSeats);
  p2pMeeplesEl.classList.remove("hidden");
  p2pMeeplesEl.innerHTML = "";
  for (let seat = 1; seat <= MAX_P2P_SEATS; seat += 1) {
    const meeple = document.createElement("span");
    const connected = Boolean(p2pUiState.connectedSeats[seat]);
    const color = P2P_SEAT_COLORS[seat] || "#ccc";
    meeple.className = "p2p-meeple";
    meeple.dataset.seat = String(seat);
    meeple.dataset.state = connected ? "connected" : "empty";
    meeple.style.setProperty("--meeple-fill", connected ? color : "#fff");
    meeple.style.setProperty("--meeple-outline", connected ? color : "var(--border)");
    meeple.setAttribute("role", "img");
    meeple.setAttribute("aria-label", connected ? `Player ${seat} connected` : `Player ${seat} open`);
    p2pMeeplesEl.appendChild(meeple);
  }
}

function toggleQrModal(show) {
  if (!p2pQrModal) return;
  if (show) {
    if (!p2pUiState.lastInviteLink || !p2pUiState.lastQrDataUrl) {
      updateP2PStatus("No invite available to show as QR.");
      return;
    }
    p2pQrImg.src = p2pUiState.lastQrDataUrl;
    p2pQrCaption.textContent = "Scan to open this invite on another device.";
    p2pQrModal.classList.remove("hidden");
  } else {
    p2pQrModal.classList.add("hidden");
  }
}

// Test-only hooks to inspect internal state in jsdom. Enabled by setting window.__RF_ENABLE_TEST_HOOKS__ before loading.
if (typeof window !== "undefined" && window.__RF_ENABLE_TEST_HOOKS__) {
  window.__rfTestHooks = {
    state,
    p2pUiState,
    updateDiceAssignments,
    renderSelectionDice,
    handleBuildingChoice,
    applyFullSnapshot,
    currentTurnPhase,
    TURN_PHASE,
    buildInviteUrl,
    updateInviteVisibility,
    updateP2PControlsVisibility,
    renderMeeples,
  };
}
