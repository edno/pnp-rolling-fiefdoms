/**
 * Rolling Fiefdoms - Main Application
 * 
 * TABLE OF CONTENTS:
 * - Imports & Constants (lines 1-110)
 * - Helper Functions (lines 115-215) - Utilities for state checks and DOM
 * - P2P Multiplayer (lines 790-1740) - WebRTC signalling and multiplayer state
 * - Event Handlers (lines 730-780) - DOM event setup and user interaction  
 * - Game Logic (lines 1750-2820) - Turn flow, dice rolling, building
 * - Rendering Functions (lines 2085-2820) - UI rendering and DOM updates
 * - State Updates (lines 2830-3050) - Track recalculation and sync
 * - UI Messages & Feedback (lines 3070+) - Action banners and user feedback
 */

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
  computeActivationMap,
  scoreBuildingAt,
} from "./rules.js";
import { createState, resetTurnState, lockDiceSnapshot } from "./state-controller.js";
import {
  ensureBuildDoneMap,
  ensureSplitUsedMap,
  resetBuildDoneMap as createResetBuildDoneMap,
  sanitizeBuildDoneMap,
  allBuildsMarkedDone as checkAllBuildsMarkedDone,
  shouldAutoMarkBuildDone,
  mergeStateMap,
  validateMultiplayerState as validateMultiplayerStateFromModule,
} from "./multiplayer-state.js";
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
  canRescueLocationWithInfluence,
} from "./game-state.js";
import { rollNumberedDie, rollXDie } from "./dice.js";
import {
  applyInfluenceToDie,
  applyInfluenceToDice,
  isInfluenceEligibleDie,
  DICE_MIN_VALUE,
  DICE_MAX_VALUE,
  totalInfluenceSpent,
  earnedInfluenceFromPopulation,
  isInfluenceMilestone,
} from "./influence.js";
import { splitForcedDice } from "./dice-display.js";
import { createDieFaceSVG } from "./dice-face.js";
import { compressToBase64Url, decompressFromBase64Url } from "./compact.js";

// Lazy-loaded modules for performance (loaded on demand)
let createManualP2P = null;
let createQrDataUrl = null;
const loadP2P = async () => {
  if (!createManualP2P) {
    const module = await import("./p2p.js");
    createManualP2P = module.createManualP2P;
  }
  return createManualP2P;
};
const loadQR = async () => {
  if (!createQrDataUrl) {
    const module = await import("./qr.js");
    createQrDataUrl = module.createQrDataUrl;
  }
  return createQrDataUrl;
};
import {
  boardEl,
  diceView,
  turnHintEl,
  locDicePreview,
  buildDicePreview,
  logEl,
  scoreOverlayBuildingsEl,
  scoreOverlayGuildsEl,
  scoreOverlayReputationEl,
  popHousingOverlay,
  influenceOverlay,
  turnTrackOverlay,
  finishActivationBtn,
  newGameBtn,
  finishSplitBtn,
  swapPairBtn,
  fullscreenBtn,
  turnStatusChip,
  loadingOverlay,
  sheetBaseImage,
  p2pPanel,
  p2pStatusEl,
  p2pCodeEl,
  p2pCodeLabel,
  p2pCopyBtn,
  p2pApplyBtn,
  p2pHostBtn,
  p2pJoinBtn,
  p2pDisconnectBtn,
  p2pSendAnswerBtn,
  p2pHintEl,
  p2pMeeplesEl,
  p2pInviteRow,
  p2pQrImg,
  p2pQrCaption,
  p2pQrModal,
  p2pQrClose,
  p2pShowQrBtn,
  forEachCell,
  createOctagon,
  clearElement,
  debugLog as debugLogUtil,
} from "./dom-manager.js";
import {
  ICONS,
  buildingHitboxes,
  guildHitboxes,
  scoringSpots,
  TURN_TRACK_LENGTH,
  countGuilds,
  builtGuildTypes,
} from "./ui-renderer.js";
import {
  nonActiveAutoHintText as generateNonActiveHint,
  actionMessage as generateActionMessage,
  updateActionBanner as updateBannerUI,
} from "./ui-feedback.js";

const BOARD_SIZE = 5;
const POPULATION_GRID_SIZE = 4;
const SFX_PATH = "assets/sounds/sfx.mp3";
const DICE_SFX_PATH = "assets/sounds/dice.mp3";
const DEFAULT_DICE_ANIM_MS = 1200;

const state = createState();

let controlsReady = false;
const urlParams = new URLSearchParams(window.location.search);
const debugMode = urlParams.has("debug");
const sfxEnabled = urlParams.has("sfx");
let p2pFeatureEnabled = false;
const MAX_P2P_SEATS = 2; // Only 2 players supported in current P2P implementation
const P2P_SEAT_COLORS = {
  1: "#e74c3c", // red
  2: "#2980b9", // blue
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

function enableDebugOverlayOutlines() {
  if (!debugMode || typeof document === "undefined") return;
  [
    "buildingsOverlay",
    "guildsOverlay",
    "popHousingOverlay",
    "influenceOverlay",
    "scoreOverlayBuildings",
    "scoreOverlayGuilds",
    "scoreOverlayReputation",
    "turnTrackOverlay",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.classList.add("overlay-debug");
  });
}

enableDebugOverlayOutlines();

let sfxAudio = null;
let diceAudio = null;
let diceAudioDurationMs = DEFAULT_DICE_ANIM_MS;

function safePlayAudio(instance, source, { onCreate } = {}) {
  if (!sfxEnabled || typeof Audio === "undefined") return null;
  if (!instance) {
    instance = new Audio(source);
    instance.preload = "auto";
    if (typeof onCreate === "function") {
      onCreate(instance);
    }
  }
  try {
    instance.currentTime = 0;
    const playPromise = instance.play();
    if (playPromise?.catch) {
      playPromise.catch(() => {});
    }
  } catch (err) {
    // Ignore playback failures (e.g., autoplay restrictions).
  }
  return instance;
}

function playSfx() {
  if (!sfxEnabled) return;
  sfxAudio = safePlayAudio(sfxAudio, SFX_PATH);
}

function playDiceSfx() {
  if (!sfxEnabled) return;
  const updateDuration = (audio) => {
    if (!audio) return;
    const duration = typeof audio.duration === "number" ? audio.duration : NaN;
    if (Number.isFinite(duration) && duration > 0) {
      diceAudioDurationMs = Math.max(200, Math.round(duration * 1000));
    }
  };
  diceAudio = safePlayAudio(diceAudio, DICE_SFX_PATH, {
    onCreate: (audio) => {
      audio.addEventListener("loadedmetadata", () => updateDuration(audio), { once: true });
    },
  });
  updateDuration(diceAudio);
}

function diceAnimationDuration(offsetMs = 0, tailMs = 0) {
  const base = diceAudioDurationMs || DEFAULT_DICE_ANIM_MS;
  const extra = 500;
  return Math.max(200, base + extra + Math.max(0, tailMs) - Math.max(0, offsetMs));
}

// ============================================================================
// HELPER FUNCTIONS - Utilities for state checks and DOM manipulation
// ============================================================================

// Wrapper for debug logging using the utility from dom-manager
function debugLog(...args) {
  debugLogUtil(debugMode, ...args);
}

function isMultiplayerActive() {
  return p2pUiState.signallingActive && p2pUiState.seatsTotal > 1;
}

function isMyBuildDone() {
  return isMultiplayerActive() && p2pUiState.buildDone?.[p2pUiState.seatId];
}

function isMySplitUsed() {
  return isMultiplayerActive() && p2pUiState.splitUsed?.[p2pUiState.seatId];
}

function isAwaitingSplit() {
  return isMultiplayerActive() && !p2pUiState.splitLocked && !state.pestilence && !forceForfeitActive();
}

function isNonActiveMultiplayer() {
  return isMultiplayerActive() && p2pUiState.activeSeat !== p2pUiState.seatId;
}

function awaitingSplitNonActive(snapshotActiveSeat = null) {
  const activeSeat = snapshotActiveSeat ?? p2pUiState.activeSeat;
  const nonActive = isMultiplayerActive() && activeSeat !== p2pUiState.seatId;
  return nonActive && !p2pUiState.splitLocked && !state.pestilence && !forceForfeitActive();
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
  if (forceForfeitActive()) return TURN_PHASE.FORFEIT;
  const allowDebugBypass = debugMode && !isMultiplayerActive();
  if (state.rollAvailable && !allowDebugBypass) return TURN_PHASE.AWAIT_ROLL;
  if (state.diceLocked || state.locationSelection.length === 2) return TURN_PHASE.BUILDING;
  if (state.dice?.length) return TURN_PHASE.SPLITTING;
  return TURN_PHASE.AWAIT_ROLL;
}

function effectiveLockedLocationPairs() {
  if (!p2pUiState.splitLocked || !state.lockedLocationDice || state.lockedLocationDice.length !== 2) return [];
  const choice = lockedPairChoice();
  const locDice = choice.locDice || state.lockedLocationDice;
  return uniqueLocationPairs(applyInfluenceToDice(state, locDice || []));
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
  p2pUiState.buildDone = createResetBuildDoneMap(total);
}

function nextSeatId() {
  const total = Math.max(1, Number(p2pUiState.seatsTotal) || 1);
  return ((p2pUiState.activeSeat || 1) % total) + 1;
}

function allBuildsMarkedDone() {
  const map = ensureBuildDoneMap(null, null, p2pUiState);
  const total = Math.max(1, Number(p2pUiState.seatsTotal) || 1);
  return checkAllBuildsMarkedDone(map, total);
}

function logP2P(...args) {
  if (typeof console !== "undefined" && typeof console.info === "function") {
    console.info("[P2P]", ...args);
  }
}

// ========================================
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
    const version = hashParams.get("v") || "1";
    return sessionId || secret ? { sessionId, secret, version } : null;
  } catch (err) {
    return null;
  }
}

// P2P is initialized lazily when first needed
let p2p = null;
async function ensureP2P() {
  if (!p2p) {
    const factory = await loadP2P();
    p2p = factory({
      onLog: (msg) => logP2P(msg),
      onStatus: (status) => handleP2PStatus(status),
      onMessage: (message) => handleP2PMessage(message),
      captureState: () => captureP2PSnapshot(),
    });
  }
  return p2p;
}

function prepareNextRoll() {
  state.rollAvailable = true;
  state.dice = [];
  state.locationSelection = [];
  state.locationPairs = [];
  state.buildDice = [];
  p2pUiState.splitLocked = false;
  p2pUiState.lockedPairSwap = false;
  p2pUiState.splitUsed = ensureSplitUsedMap(null, null, p2pUiState);
  Object.keys(p2pUiState.splitUsed).forEach((k) => {
    p2pUiState.splitUsed[k] = false;
  });
  resetBuildDoneMap();
  state.forceForfeit = false;
  state.forceForfeitAdvisory = false;
  state.forceForfeitAdvisory = false;
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
  clearElement(diceView);
  updateRollButton();
  updateActionBanner();
  updateMultiplayerButtons();
  refreshDiceVisibility();
  highlightLocations();
}

function validateMultiplayerState() {
  if (!isMultiplayerActive()) return { valid: true };
  
  const result = validateMultiplayerStateFromModule({ p2pUiState, state });
  
  if (debugMode && !result.valid) {
    console.warn('[validateMultiplayerState] Inconsistencies detected:', result.errors);
  }
  
  return result;
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
  const allowDebugBypass = debugMode && !isMultiplayerActive();
  const awaitingRoll = !allowDebugBypass && state.rollAvailable;
  const showButton = !hidden && (awaitingRoll || allowDebugBypass);
  rollBtn.style.display = showButton ? "inline-block" : "none";
  const enabled = (allowDebugBypass || state.rollAvailable) && isActiveSeat;
  rollBtn.disabled = !enabled;
  rollBtn.classList.toggle("dice-locked", !enabled && !debugMode);
  rollBtn.title = enabled ? "Roll dice" : "Roll used; complete the turn to roll again.";
}

function refreshDiceVisibility() {
  const hidden = state.activationMode || state.activationComplete;
  const allowDebugBypass = debugMode && !isMultiplayerActive();
  const awaitingRoll = !allowDebugBypass && state.rollAvailable;
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

// DOM element state (not from dom-manager, app-specific state)
const guildTypes = ["GF", "GQ", "GW", "GM"];
let swapBtnPulseTimeout = null;
let swapBtnLastVisible = false;

const SHEET_VERSION = "v1.13";
const POP_CAPACITY = 5;
const POP_LAYOUT = { rows: [3, 3, 3, 3, 3, 3], pipsPerCell: 4 };
const POP_TRACK_TOTAL_CELLS = POP_LAYOUT.rows.reduce((sum, len) => sum + len, 0);
const POP_TRACK_TOTAL_PIPS = POP_TRACK_TOTAL_CELLS * POP_LAYOUT.pipsPerCell;
const INFLUENCE_TRACK_SLOTS = Math.max(1, earnedInfluenceFromPopulation(POP_TRACK_TOTAL_PIPS));
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
const SIGNALLING_RETRY_COUNT = 3;
const SIGNALLING_RETRY_BACKOFF_MS = 1000;
const SIGNALLING_MAX_BACKOFF_MS = 5000;
const SIGNALLING_POLL_TIMEOUT_MS = 20000;
const SIGNALLING_POLL_INTERVAL_MS = 1200;
const SIGNALLING_POLL_MAX_INTERVAL_MS = 5000;

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
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing;
          newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
              // Check if safe to update - not during critical game actions
              const isSafeToUpdate = !state.activationMode && 
                                     !state.diceLocked && 
                                     !state.diceRolling && 
                                     !rollingInProgress;
              
              if (isSafeToUpdate) {
                newWorker.postMessage({ type: "SKIP_WAITING" });
              } else {
                console.log("SW update available but game in progress. Will update after turn.");
                // Store flag to update after current action completes
                if (typeof window !== "undefined") {
                  window.__pendingServiceWorkerUpdate = newWorker;
                }
              }
            }
          });
        });
        reg.update();
      })
      .catch((err) => console.warn("SW registration failed", err));

    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });
  });
}

async function init() {
  resetState();
  renderBoard();
  updateTracks();
  updateTurnStatusChip();
  updateActionBanner();
  refreshDiceVisibility();
  renderMeeples();
  updateInviteVisibility(p2pUiState.inviteVisible);
  if (!controlsReady) {
    await setupControls();
    controlsReady = true;
  }
}

function resetState() {
  state.board = Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => ({ building: null, buildingLabel: null, forfeited: false, springBoost: 0 })),
  );
  state.populationNodes = Array.from({ length: POPULATION_GRID_SIZE }, () => Array(POPULATION_GRID_SIZE).fill(0));
  state.populationAvailable = null;
  state.workerAllocations = null;
  state.activationMode = false;
  state.influence = { earned: 0, spent: 0, pending: 0 };
  state.influenceAdjustments = {};
  state.influenceTarget = null;
  state.tracks.population = 0;
  state.tracks.housing = 0;
  state.tracks.influence = 0;
  state.turnIndex = 0;
  state.turnTrack = 0;
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
  clearElement(logEl);
  if (finishActivationBtn) finishActivationBtn.style.display = "none";
  if (newGameBtn) newGameBtn.style.display = "none";
  renderTurnTrack(state.turnTrack);
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

async function fetchConfig() {
  try {
    const response = await fetch("/api/config");
    if (response.ok) {
      const config = await response.json();
      p2pFeatureEnabled = urlParams.has("p2p") || config.p2pEnabled;
      debugLog("[Config] Loaded from server:", config);
    } else if (response.status === 404) {
      // Local development without Cloudflare Pages Functions
      debugLog("[Config] Running in local mode, using defaults");
      p2pFeatureEnabled = urlParams.has("p2p");
    }
  } catch (err) {
    // Network error or config unavailable, fall back to URL params only
    if (debugMode) console.warn("[Config] Fetch failed:", err);
    p2pFeatureEnabled = urlParams.has("p2p");
  }
}

registerServiceWorker();

async function initializeApp() {
  try {
    // Wait for sheet to preload before continuing
    await preloadSheet();
    
    // Wait for fonts to load to prevent layout shifts
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    }
    
    // Fetch config
    await fetchConfig();
    
    // Initialize the game
    await init();
    
    // Remove loading state only after everything is ready
    document.body.classList.remove("loading");
    if (loadingOverlay) loadingOverlay.remove();
  } catch (err) {
    console.error("Initialization failed:", err);
    // Show error to user
    if (loadingOverlay) {
      const loadingText = loadingOverlay.querySelector(".loading-text");
      if (loadingText) {
        loadingText.textContent = "Failed to load game. Please refresh.";
      }
    }
  }
}

initializeApp();

// ============================================================================
// EVENT HANDLERS - DOM event setup and user interaction
// ============================================================================

async function setupControls() {
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
  if (swapPairBtn) {
    swapPairBtn.onclick = () => toggleLockedPairChoice();
    swapPairBtn.style.display = "none";
  }
  if (p2pFeatureEnabled) {
    await setupP2PControls();
  }
}

// ============================================================================
// P2P MULTIPLAYER - WebRTC signalling and multiplayer state management
// ============================================================================

function captureP2PSnapshot() {
  const snapshotScore = currentScore({ allowPopulationActivation: false });
  return {
    fiefdomName: state.fiefdomName || "",
    turnIndex: state.turnIndex || 0,
    turnTrack: state.turnTrack || 0,
    activeTurn: Boolean(state.activeTurn),
    rollAvailable: Boolean(state.rollAvailable),
    score: snapshotScore?.total ?? 0,
    seatsTotal: p2pUiState.seatsTotal,
    activeSeat: p2pUiState.activeSeat,
    splitLocked: p2pUiState.splitLocked,
    buildDone: ensureBuildDoneMap(null, null, p2pUiState),
  };
}

let processingP2PMessage = false;
const p2pMessageQueue = [];

function handleP2PMessage(message) {
  p2pMessageQueue.push(message);
  if (processingP2PMessage) return;
  
  processingP2PMessage = true;
  while (p2pMessageQueue.length > 0) {
    const msg = p2pMessageQueue.shift();
    processP2PMessage(msg);
  }
  processingP2PMessage = false;
}

function processP2PMessage(message) {
  if (!message || typeof message !== "object") return;
  if (debugMode) logP2P(`Received message type: ${message.type}`);
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
    if (debugMode) logP2P(`Received state:request, my role: ${status.role}`);
    if (status.role === "host") {
      if (debugMode) logP2P("Sending state:full in response to request");
      sendStateSnapshot();
    } else {
      if (debugMode) logP2P("Ignoring state:request (not host)");
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
      // NOTE: Current P2P implementation only supports 2 players (host + 1 joiner)
      // For 3+ players, would need mesh networking or relay server
      p2pUiState.seatId = 2;
      p2pUiState.seatsTotal = 2; // Locked to 2 players maximum
      p2pUiState.connectedSeats[2] = true;
      setActiveSeat(p2pUiState.activeSeat || 1);
      if (debugMode) logP2P("Sending state:request to host");
      sendAppMessage("state:request", {});
    } else if (status?.role === "host") {
      p2pUiState.seatId = 1;
      p2pUiState.seatsTotal = 2; // Locked to 2 players maximum
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
        ? "Connected via P2P (2 players maximum)."
        : p2pUiState.awaitingAnswer
          ? "Hosting: waiting for 1 player to join (2 players max)."
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

function encodeSignalParam(url) {
  if (!url) return "";
  try {
    const b64 =
      typeof btoa === "function"
        ? btoa(url)
        : typeof globalThis !== "undefined" && globalThis.Buffer
          ? globalThis.Buffer.from(url, "utf-8").toString("base64")
          : "";
    if (!b64) return url;
    return `~${b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")}`;
  } catch (err) {
    return url;
  }
}

function decodeSignalParam(param) {
  if (!param) return null;
  if (!param.startsWith("~")) return param;
  const payload = param.slice(1);
  const padded = payload.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((payload.length + 3) % 4);
  try {
    if (typeof atob === "function") return atob(padded);
    if (typeof globalThis !== "undefined" && globalThis.Buffer) {
      return globalThis.Buffer.from(padded, "base64").toString("utf-8");
    }
    return null;
  } catch (err) {
    return null;
  }
}

function buildInviteUrl({ sessionId, secret, signallingUrl }) {
  try {
    const url = new URL(window.location.href);
    url.search = "";
    const params = new URLSearchParams();
    params.set("p2p", "");
    if (debugMode) params.set("debug", "");
    if (signallingUrl) params.set("signal", encodeSignalParam(signallingUrl));
    url.search = params.toString();
    const hashParams = new URLSearchParams();
    if (sessionId) hashParams.set("s", sessionId);
    if (secret) hashParams.set("k", secret);
    hashParams.set("v", "1");
    url.hash = `#${hashParams.toString()}`;
    return url.toString();
  } catch (err) {
    return null;
  }
}

async function renderP2PQr(link) {
  if (!p2pQrImg || !p2pQrCaption) return;
  if (!link) {
    p2pUiState.lastInviteLink = "";
    p2pUiState.lastQrDataUrl = "";
    return;
  }
  const qrGenerator = await loadQR();
  const dataUrl = qrGenerator(link, { size: 400, margin: 6, errorCorrection: "L" });
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
      const joinTimeout = setTimeout(() => {
        joinViaSignalling(parsed.sessionId, parsed.secret);
      }, 20);
      // Store for potential cleanup
      if (typeof window !== "undefined") window.__p2pJoinTimeout = joinTimeout;
    }
  } catch (err) {
    // ignore malformed URLs
  }
}

function describeRemoteSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return "";
  const name = snapshot.fiefdomName ? ` ${snapshot.fiefdomName}` : "";
  return `${name}`;
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
  return clean.length ? clean : [];
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

function sanitizeSnapshot(raw) {
  const clone = deepClone(raw);
  if (!clone || typeof clone !== "object") return { ok: false, reason: "invalid object" };
  if (clone.version && clone.version !== "1") return { ok: false, reason: "unsupported snapshot version" };

  const seatsTotal = Math.max(1, Number(clone.seatsTotal || 1) || 1);
  const dice = sanitizeDice(clone.dice);
  if (!dice) return { ok: false, reason: "invalid dice array" };
  const sanitizedTurnTrack = isFiniteNumber(clone.turnTrack) ? Math.max(0, Math.min(TURN_TRACK_LENGTH, Math.floor(clone.turnTrack))) : 0;

  return {
    ok: true,
    snapshot: {
      version: clone.version || "1",
      sessionId: clone.sessionId || null,
      turnIndex: isFiniteNumber(clone.turnIndex) ? clone.turnIndex : 0,
      turnTrack: sanitizedTurnTrack,
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
      forceForfeitAdvisory: Boolean(clone.forceForfeitAdvisory),
      pendingNextRoll: Boolean(clone.pendingNextRoll),
      bannerOverride: typeof clone.bannerOverride === "string" ? clone.bannerOverride : null,
      seatsTotal,
      activeSeat: isFiniteNumber(clone.activeSeat) ? clone.activeSeat : null,
      splitLocked: Boolean(clone.splitLocked),
      buildDone: sanitizeBuildDoneMap(clone.buildDone, seatsTotal),
      splitUsed: sanitizeBuildDoneMap(clone.splitUsed, seatsTotal) || null,
      fiefdomName: typeof clone.fiefdomName === "string" ? clone.fiefdomName : "",
      invalidSelectionMessage: typeof clone.invalidSelectionMessage === "string" ? clone.invalidSelectionMessage : null,
    },
  };
}

function buildFullSnapshot() {
  const base = {
    version: "1",
    sessionId: p2pUiState.sessionId,
    turnIndex: state.turnIndex,
    turnTrack: state.turnTrack,
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
    buildDone: ensureBuildDoneMap(null, null, p2pUiState),
    splitUsed: p2pUiState.splitUsed || {},
    forceForfeitAdvisory: state.forceForfeitAdvisory,
    invalidSelectionMessage: state.invalidSelectionMessage,
    pendingPopulation: state.pendingPopulation,
  };
  return base;
}

function applyFullSnapshot(snapshot) {
  const validation = sanitizeSnapshot(snapshot);
  if (!validation.ok) {
    logP2P(`Snapshot rejected: ${validation.reason || "invalid"}.`);
    console.warn("Peer sync failed: invalid snapshot.", validation.reason || "");
    return;
  }
  const snap = validation.snapshot;
  if (debugMode) logP2P(`Applying snapshot with ${snap.dice?.length || 0} dice`);
  const seatsTotal = snap.seatsTotal || p2pUiState.seatsTotal;
  p2pUiState.splitUsed = ensureSplitUsedMap(seatsTotal, p2pUiState.splitUsed);
  state.turnIndex = typeof snap.turnIndex === "number" ? snap.turnIndex : state.turnIndex;
  if (typeof snap.turnTrack === "number") {
    state.turnTrack = Math.max(0, Math.min(TURN_TRACK_LENGTH, Math.floor(snap.turnTrack)));
    renderTurnTrack(state.turnTrack);
  }
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
  state.forceForfeitAdvisory = Boolean(snap.forceForfeitAdvisory);
  state.invalidSelectionMessage = typeof snap.invalidSelectionMessage === "string" ? snap.invalidSelectionMessage : null;
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
  state.pendingPopulation = snap.pendingPopulation || null;
  if (snap.seatsTotal) p2pUiState.seatsTotal = snap.seatsTotal;
  // Detect if this is a turn reset (new turn starting, no dice rolled yet)
  const isTurnReset = snap.rollAvailable && (!snap.dice || snap.dice.length === 0);
  
  // Merge buildDone: NEVER downgrade local true to false except on turn reset
  // This ensures player's own build completion is preserved when receiving peer updates
  const incomingBuildDone = snap.buildDone 
    ? ensureBuildDoneMap(seatsTotal, snap.buildDone, p2pUiState) 
    : ensureBuildDoneMap(seatsTotal, p2pUiState.buildDone, p2pUiState);
  if (isTurnReset) {
    p2pUiState.buildDone = incomingBuildDone;
  } else {
    p2pUiState.buildDone = mergeStateMap(
      p2pUiState.buildDone,
      incomingBuildDone,
      seatsTotal,
      p2pUiState.seatId
    );
  }
  
  // Merge splitUsed: NEVER downgrade local true to false except on turn reset
  // This ensures player's own split usage is preserved when receiving peer updates
  const incomingSplitUsed = snap.splitUsed
    ? ensureSplitUsedMap(seatsTotal, snap.splitUsed, p2pUiState)
    : ensureSplitUsedMap(seatsTotal, p2pUiState.splitUsed, p2pUiState);
  if (isTurnReset) {
    p2pUiState.splitUsed = incomingSplitUsed;
  } else {
    p2pUiState.splitUsed = mergeStateMap(
      p2pUiState.splitUsed,
      incomingSplitUsed,
      seatsTotal,
      p2pUiState.seatId
    );
  }
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
      state.forceForfeitAdvisory = false;
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
  renderDice();
  if (state.pendingPopulation) {
    renderBoard();
  } else {
    highlightLocations();
  }
  updateTurnStatusChip();
  updateMultiplayerButtons();
  p2pUiState.remoteSnapshot = snap;
  
  // Validate state consistency after applying snapshot
  if (debugMode) {
    const validation = validateMultiplayerState();
    if (!validation.valid) {
      console.error('[applyFullSnapshot] State validation failed:', validation.errors);
    }
  }
}

async function sendAppMessage(type, payload = {}) {
  const p2pInstance = p2p || await ensureP2P();
  if (!p2pInstance?.sendMessage) return { ok: false };
  try {
    const res = p2pInstance.sendMessage(type, payload);
    return res;
  } catch (err) {
    logP2P("send message failed", err?.message || err);
    return { ok: false, error: err?.message };
  }
}

function sendStateSnapshot() {
  const snapshot = buildFullSnapshot();
  if (debugMode) logP2P(`Sending snapshot with ${snapshot.dice?.length || 0} dice`);
  const result = sendAppMessage("state:full", { snapshot });
  if (debugMode && !result.ok) logP2P("Failed to send snapshot:", result.error);
}

function syncStateToPeer() {
  if (!isMultiplayerActive()) return;
  sendStateSnapshot();
}

async function startP2PHosting() {
  const p2pInstance = await ensureP2P();
  if (!p2pInstance?.supported) {
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
    const { code, error } = await p2pInstance.startHosting(readP2PSecret());
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
      // Add small delay to ensure joiner has time to start polling
      await new Promise((r) => setTimeout(r, 500));
      pollSignal("host", secret, { timeoutMs: 90000, intervalMs: 1500 }).then(async (answerCompact) => {
        if (!answerCompact) {
          logP2P("poll timeout waiting for answer");
          updateP2PStatus("Signalling timeout. Invite still active via QR/link.");
          return;
        }
        const answerCode = await decompressFromBase64Url(answerCompact).catch(() => null);
        if (!answerCode) {
          logP2P("invalid answer from signalling");
          return;
        }
        await p2pInstance.applyAnswer(answerCode, secret);
        updateP2PStatus("Answer received via signalling. Completing link…");
      });
    } else {
      logP2P("Signalling unavailable, falling back to manual mode");
      updateP2PStatus("Signalling unavailable. Use QR code or share link manually.");
    }
  } catch (err) {
    setP2PMode("idle");
    const message = err?.message || "Unable to create invite.";
    updateP2PStatus(message);
    logP2P(message);
  }
}

function disconnectP2P(reason = "") {
  if (p2p?.disconnect) {
    p2p.disconnect(reason);
  }
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

async function setupP2PControls() {
  if (!p2pFeatureEnabled) {
    p2pUiState.signallingDisabled = true;
    return;
  }
  // Reset signallingDisabled in case it was set before config loaded
  p2pUiState.signallingDisabled = false;
  if (!p2pPanel) return;
  // Show the panel now that P2P is enabled
  p2pPanel.classList.remove("hidden");
  if (p2pHintEl) p2pHintEl.style.display = "none";
  updateInviteVisibility(false);
  p2pUiState.signallingUrl = await resolveSignallingUrl();
  if (!p2pUiState.signallingUrl) {
    disableP2P("P2P disabled: signalling URL unavailable.");
    return;
  }
  const supported = Boolean(p2p?.supported);
  debugLog("[P2P] WebRTC supported:", supported);
  const controls = [p2pHostBtn, p2pJoinBtn, p2pApplyBtn, p2pCopyBtn, p2pDisconnectBtn, p2pCodeEl];
  if (!supported) {
    if (debugMode) console.warn("[P2P] WebRTC not supported - P2P will be limited");
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

async function resolveSignallingUrl() {
  const paramUrl = new URLSearchParams(window.location.search).get("signal");
  if (paramUrl) {
    const decoded = decodeSignalParam(paramUrl);
    const result = decoded || paramUrl;
    debugLog("[P2P] Using signalling URL from ?signal param:", result);
    return result;
  }
  const dataUrl = document.body?.dataset?.signallingUrl;
  if (dataUrl) {
    debugLog("[P2P] Using signalling URL from data attribute:", dataUrl);
    return dataUrl;
  }
  
  // Try to fetch from API config
  try {
    const response = await fetch("/api/config");
    if (response.ok) {
      const config = await response.json();
      debugLog("[P2P] Received config:", config);
      if (config.signalingUrl) {
        debugLog("[P2P] Using signalling URL from /api/config:", config.signalingUrl);
        return config.signalingUrl;
      }
    } else {
      debugLog("[P2P] Config fetch returned status:", response.status);
    }
  } catch (err) {
    // API unavailable, fall through to fallback logic
    if (debugMode) console.warn("[P2P] Config fetch failed:", err);
  }
  
  const host = window.location.hostname || "";
  const isLoopback = host === "localhost" || host === "127.0.0.1";
  const isPrivateIp =
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ||
    host.endsWith(".local");
  if (isLoopback || isPrivateIp) {
    const fallbackUrl = `http://${host}:8787`;
    debugLog("[P2P] Using fallback signalling URL (local/private IP):", fallbackUrl);
    return fallbackUrl;
  }
  if (debugMode) console.log("[P2P] No signalling URL available (production deployment without config)");
  return null;
}

function disableP2P(reason = "P2P disabled") {
  if (debugMode) {
    console.log("[P2P] disableP2P called:", reason);
    console.trace("[P2P] Call stack:");
  }
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
  if (p2pPanel) p2pPanel.classList.add("hidden");
}

async function sendSignalBlob(role, compactCode, secret, retries = SIGNALLING_RETRY_COUNT) {
  if (!p2pUiState.signallingUrl || !compactCode) return { ok: false };
  const safeSecret = secret || readP2PSecretOrDefault();
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const url = new URL(`/session/${p2pUiState.sessionId || "session"}`, p2pUiState.signallingUrl);
      url.searchParams.set("role", role);
      url.searchParams.set("secret", safeSecret);
      logP2P(`sending signal (attempt ${attempt}/${retries})`, { role, url: url.toString() });
      const resp = await fetch(url.toString(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sdp: compactCode, ice: [] }),
      });
      if (resp.ok) {
        return { ok: true, status: resp.status };
      }
      logP2P("signal send failed", resp.status);
      if (resp.status === 403) return { ok: false, status: resp.status }; // Don't retry auth errors
    } catch (err) {
      logP2P("signal send error", err?.message || err);
      if (attempt === retries) {
        return { ok: false, error: err?.message };
      }
    }
    // Wait before retry with exponential backoff
    if (attempt < retries) {
      await new Promise((r) => setTimeout(r, Math.min(SIGNALLING_RETRY_BACKOFF_MS * Math.pow(2, attempt - 1), SIGNALLING_MAX_BACKOFF_MS)));
    }
  }
  return { ok: false, error: "Max retries exceeded" };
}

async function pollSignal(role, secret, { timeoutMs = SIGNALLING_POLL_TIMEOUT_MS, intervalMs = SIGNALLING_POLL_INTERVAL_MS, maxIntervalMs = SIGNALLING_POLL_MAX_INTERVAL_MS } = {}) {
  if (!p2pUiState.signallingUrl) return null;
  const safeSecret = secret || readP2PSecretOrDefault();
  const start = Date.now();
  let timer = null;
  let currentInterval = intervalMs;
  let attempts = 0;
  
  while (Date.now() - start < timeoutMs) {
    attempts++;
    try {
      const url = new URL(`/session/${p2pUiState.sessionId || "session"}`, p2pUiState.signallingUrl);
      url.searchParams.set("role", role);
      url.searchParams.set("secret", safeSecret);
      if (debugMode) logP2P(`polling signal (attempt ${attempts})`, { role, url: url.toString() });
      const controller = new AbortController();
      const fetchTimeout = setTimeout(() => controller.abort(), 10000);
      const resp = await fetch(url.toString(), {
        signal: controller.signal,
      }).finally(() => clearTimeout(fetchTimeout));
      if (resp.status === 200) {
        const data = await resp.json();
        if (data?.sdp) {
          logP2P(`received answer after ${attempts} attempts`);
          return data.sdp;
        }
      } else if (resp.status === 403) {
        logP2P("poll forbidden");
        return null;
      } else if (resp.status === 404) {
        logP2P("session not found");
        return null;
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        logP2P("poll error", err?.message || err);
      }
    }
    
    // Exponential backoff: start at intervalMs, double each time up to maxIntervalMs
    currentInterval = Math.min(currentInterval * 1.5, maxIntervalMs);
    
    await new Promise((r) => {
      timer = setTimeout(r, currentInterval);
      p2pUiState.signallingPoll = timer;
    });
  }
  logP2P(`poll timeout after ${attempts} attempts`);
  return null;
}

async function joinViaSignalling(sessionId, secret) {
  if (!sessionId || !p2pUiState.signallingUrl) {
    disableP2P("P2P disabled: missing session or signalling.");
    return;
  }
  p2pUiState.sessionId = sessionId;
  // NOTE: Current P2P implementation only supports 2 players (host + 1 joiner)
  p2pUiState.seatId = 2;
  p2pUiState.seatsTotal = 2; // Locked to 2 players maximum
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
  const hostOfferCompact = await pollSignal("join", safeSecret, { timeoutMs: 90000, intervalMs: 1500 });
  if (!hostOfferCompact) {
    updateP2PStatus("Signalling timeout. Check invite link or try manual connection.");
    logP2P("Failed to receive host offer via signalling");
    return;
  }
  const hostOffer = await decompressFromBase64Url(hostOfferCompact).catch(() => null);
  if (!hostOffer) {
    disableP2P("Invalid host invite from signalling.");
    return;
  }
  const p2pInstance = await ensureP2P();
  const result = await p2pInstance.acceptInvite(hostOffer, safeSecret);
  if (result?.error) {
    logP2P("Failed to send answer via signalling");
    updateP2PStatus("Signalling unavailable. Connection may not complete automatically.");
    // Don't disable P2P completely - the WebRTC connection might still work
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
  updateP2PStatus("Answer sent via signalling. Waiting for host to connect. (Note: Only 2 players supported)");
}

// ============================================================================
// GAME LOGIC - Turn flow, dice rolling, building, and scoring
// ============================================================================

let rollingInProgress = false;

function rollDice() {
  if (rollingInProgress) {
    return;
  }
  rollingInProgress = true;
  
  try {
    if (state.activationMode) return;
    if (!debugMode && !state.rollAvailable) {
      log("Roll already used this turn. Finish the turn to roll again.");
      return;
    }
    if (p2pUiState.seatsTotal > 1 && p2pUiState.activeSeat !== p2pUiState.seatId) {
      logP2P("Roll ignored: not your turn.");
      return;
    }
    
    // If hosting but no one joined yet and this is the first roll, cancel hosting and go solo
  // Also cancel if WebRTC is not available
  const isFirstRoll = state.turnIndex === 0;
  const isHostingAlone = p2pUiState.mode === "host" && !p2pUiState.channelOpen && p2pUiState.awaitingAnswer;
  const webrtcUnavailable = p2pUiState.mode === "host" && p2p && !p2p?.supported;
  if (isFirstRoll && (isHostingAlone || webrtcUnavailable)) {
    const reason = webrtcUnavailable ? "WebRTC not available" : "Starting solo game";
    logP2P(`${reason} - canceling P2P hosting`);
    disableP2P(reason);
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
  const activeTurnOverride = isMultiplayerActive()
    ? p2pUiState.seatId === p2pUiState.activeSeat
    : baseActiveTurn;
  p2pUiState.splitLocked = false;
  p2pUiState.buildDone = { ...p2pUiState.buildDone };
  updateMultiplayerButtons();

  state.bannerOverride = null;
  if (!needsDoubleReroll) {
    triggerDiceAnimation();
    const allowDebugBypass = debugMode && !isMultiplayerActive();
    state.rollAvailable = allowDebugBypass ? true : false;
    updateRollButton();
  }
  const { messages } = beginTurn(state, dice, state.board, {
    uniqueLocationPairs,
    computePestilenceInfo,
    filterAvailablePairs,
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
    if (turnHintEl) turnHintEl.textContent = "Pestilence! Forfeit any empty plot.";
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
    state.forceForfeitAdvisory = false;
    state.diceLocked = true;
  } else if (turnHintEl) {
    turnHintEl.textContent = state.activeTurn
      ? ""
      : isMultiplayerActive()
        ? "Waiting for the active player to finish the split."
        : nonActiveAutoHintText();
  }
  updateTurnStatusChip();
  const nonActiveMultiplayer = isNonActiveMultiplayer();
  if (nonActiveMultiplayer && !state.pestilence && !forceForfeitActive()) {
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
  } finally {
    rollingInProgress = false;
  }
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
  playDiceSfx();
  const isTest = typeof window !== "undefined" && window.__RF_ENABLE_TEST_HOOKS__;
  const startDelay = isTest ? 0 : 500;

  const startAnimation = () => {
    state.diceRolling = true;
    diceView.classList.add("dice-rolling");
    const rollingMsg = "Rolling dice...";
    state.bannerOverride = rollingMsg;
    updateActionBanner();
    const animDuration = isTest ? 0 : diceAnimationDuration(startDelay, 200);
    const animTimeout = setTimeout(() => {
      state.diceRolling = false;
      diceView.classList.remove("dice-rolling");
      if (state.bannerOverride === rollingMsg) state.bannerOverride = null;
      updateActionBanner();
    }, animDuration);
    if (typeof window !== "undefined") window.__diceAnimTimeout = animTimeout;
  };

  if (startDelay > 0) {
    const delayTimeout = setTimeout(startAnimation, startDelay);
    if (typeof window !== "undefined") window.__diceAnimDelayTimeout = delayTimeout;
  } else {
    startAnimation();
  }
}

function dieMaxValue(die) {
  if (!die) return 0;
  if (Array.isArray(die.choices) && die.choices.length) {
    return Math.max(...die.choices);
  }
  if (typeof die.resolved === "number") return die.resolved;
  return 0;
}

function dieSourceIndex(die) {
  if (!die || !state?.dice) return -1;
  const exact = state.dice.indexOf(die);
  if (exact >= 0) return exact;
  if (die.label) {
    const byLabel = state.dice.findIndex((d) => d?.label === die.label);
    if (byLabel >= 0) return byLabel;
  }
  return -1;
}

function forceForfeitActive() {
  return Boolean(state.forceForfeit) && !state.forceForfeitAdvisory;
}

function influenceAvailable() {
  const earned = Math.max(0, state.influence?.earned || 0);
  const committed = Math.min(earned, Math.max(0, state.influence?.spent || 0));
  const remaining = Math.max(0, earned - committed);
  let pending = state.influence?.pending;
  if (typeof pending !== "number" || Number.isNaN(pending)) {
    pending = totalInfluenceSpent(state.influenceAdjustments);
  }
  const pendingClamped = Math.min(Math.max(0, pending || 0), remaining);
  return Math.max(0, earned - committed - pendingClamped);
}

function influenceAdjustmentDelta(label) {
  if (!label || !state.influenceAdjustments) return 0;
  return typeof state.influenceAdjustments[label]?.delta === "number"
    ? state.influenceAdjustments[label].delta
    : 0;
}

function influenceAdjustmentsEmpty() {
  return !state.influenceAdjustments || Object.keys(state.influenceAdjustments).length === 0;
}

function canonicalSelectionKey(selection = null) {
  const source = Array.isArray(selection) ? selection : state.locationSelection;
  if (!Array.isArray(source)) return "";
  return source
    .slice()
    .sort((a, b) => a - b)
    .join("-");
}

function clearInfluenceAdjustments({ label = null } = {}) {
  if (!state.influenceAdjustments) state.influenceAdjustments = {};
  let changed = false;
  if (label) {
    if (state.influenceAdjustments[label]) {
      delete state.influenceAdjustments[label];
      changed = true;
    }
  } else if (!influenceAdjustmentsEmpty()) {
    state.influenceAdjustments = {};
    changed = true;
  }
  if (!changed) return false;
  if (influenceAdjustmentsEmpty()) {
    state.influenceTarget = null;
    state.influenceSelectionKey = null;
    return true;
  }
  if (label && state.influenceTarget === label) {
    const remaining = Object.keys(state.influenceAdjustments || {}).find(
      (key) => influenceAdjustmentDelta(key) !== 0,
    );
    state.influenceTarget = remaining || null;
  }
  return true;
}

function influenceTargetBlocked(label) {
  const target = state.influenceTarget;
  if (!target || target === label) return false;
  const entry = state.influenceAdjustments?.[target];
  return Boolean(entry && typeof entry.delta === "number" && entry.delta !== 0);
}

function canAdjustDieValue(die, direction = 0) {
  if (!isInfluenceEligibleDie(die)) return false;
  const base = typeof die.resolved === "number" ? die.resolved : null;
  if (base === null) return false;
  if (direction === 0) return !influenceTargetBlocked(die.label);
  if (influenceTargetBlocked(die.label)) return false;
  const delta = influenceAdjustmentDelta(die.label);
  const nextDelta = delta + direction;
  const target = base + nextDelta;
  if (target < DICE_MIN_VALUE || target > DICE_MAX_VALUE) return false;
  const reducesMagnitude = Math.abs(nextDelta) < Math.abs(delta);
  if (reducesMagnitude) return true;
  return influenceAvailable() > 0;
}

function adjustDieWithInfluence(idx, direction) {
  if (!state.dice || !state.dice[idx]) return;
  const die = state.dice[idx];
  if (!isInfluenceEligibleDie(die)) {
    log("Influence can only adjust numbered dice.");
    return;
  }
  if (influenceTargetBlocked(die.label)) {
    log("Influence can only adjust one die per roll. Reset previous adjustments first.");
    return;
  }
  const base = typeof die.resolved === "number" ? die.resolved : null;
  if (base === null) {
    log("That die cannot be adjusted.");
    return;
  }
  const delta = influenceAdjustmentDelta(die.label);
  const nextDelta = delta + direction;
  if (nextDelta === delta) return;
  const target = base + nextDelta;
  if (target < DICE_MIN_VALUE || target > DICE_MAX_VALUE) {
    log("Influence cannot adjust dice beyond 1–5.");
    return;
  }
  const reducesMagnitude = Math.abs(nextDelta) < Math.abs(delta);
  if (!reducesMagnitude && influenceAvailable() <= 0) {
    log("No Influence available.");
    return;
  }
  if (!state.influenceAdjustments) state.influenceAdjustments = {};
  if (nextDelta === 0) {
    delete state.influenceAdjustments[die.label];
  } else {
    state.influenceAdjustments[die.label] = { delta: nextDelta };
    state.influenceTarget = die.label;
  }
  if (influenceAdjustmentsEmpty()) {
    state.influenceTarget = null;
  } else if (!state.influenceTarget) {
    state.influenceTarget = die.label;
  }
  state.influenceSelectionKey =
    state.locationSelection.length >= 1 ? canonicalSelectionKey(state.locationSelection) : null;
  log(`Influence adjustment: ${die.label} now ${target}.`);
  updateTracks();
  updateDiceAssignments();
  refreshDiceVisibility();
}

function resetDieInfluence(idx) {
  if (!state.dice || !state.dice[idx]) return;
  const die = state.dice[idx];
  if (!isInfluenceEligibleDie(die)) return;
  const delta = influenceAdjustmentDelta(die.label);
  if (!delta) return;
  const cleared = clearInfluenceAdjustments({ label: die.label });
  if (!cleared) return;
  const base =
    typeof die.resolved === "number"
      ? die.resolved
      : typeof die.face === "number"
        ? die.face
        : die.face === "windrose"
          ? "windrose"
          : die.face;
  log(`Influence reset: ${die.label} restored to ${base}.`);
  updateTracks();
  updateDiceAssignments();
  refreshDiceVisibility();
}

// ============================================================================
// RENDERING FUNCTIONS - UI rendering and DOM updates
// ============================================================================

function renderDice() {
  if (!diceView) return;
  refreshDiceVisibility();
  const awaitingRoll = state.rollAvailable && (!state.dice || state.dice.length === 0);
  if (state.activationMode || state.activationComplete || awaitingRoll) return;
  clearElement(diceView);
  if (turnHintEl) {
    if (state.pestilence) {
      turnHintEl.textContent = "Pestilence! Forfeit any empty plot.";
    } else if (state.activeTurn && state.invalidSelection) {
      turnHintEl.textContent =
        state.invalidSelectionMessage || "No valid plots for that pair; choose a different location pair.";
    } else if (state.forceForfeitAdvisory && !state.forceForfeit) {
      turnHintEl.textContent = "No valid location pairs; spend Influence or forfeit a plot.";
    } else if (forceForfeitActive()) {
      turnHintEl.textContent = "No valid location pairs; forfeit a plot.";
    } else if (!state.activeTurn) {
      const waitingSplit = awaitingSplitNonActive();
      if (waitingSplit && (state.pestilence || forceForfeitActive())) {
        turnHintEl.textContent = "Forfeit a plot.";
      } else if (p2pUiState.splitLocked) {
        turnHintEl.textContent = "";
      } else {
        turnHintEl.textContent = isMultiplayerActive()
          ? "Waiting for the active player to finish the split."
          : nonActiveAutoHintText();
      }
    } else {
      turnHintEl.textContent = "";
    }
  }
  const field = document.createElement("div");
  field.className = "field dice-field";
  const row = document.createElement("div");
  row.className = "dice-row";
  const turnLocked = state.diceLocked || state.activationMode || state.pestilence || forceForfeitActive();
  if (turnLocked) row.classList.add("dice-locked");
  const baseSelection = Array.isArray(state.locationSelection) ? state.locationSelection.slice() : [];
  const storedLocationDice = turnLocked
    ? state.diceLocked && Array.isArray(state.lockedLocationDice) && state.lockedLocationDice.length === 2
      ? state.lockedLocationDice
      : Array.isArray(state.lastLocationDice) && state.lastLocationDice.length === 2
        ? state.lastLocationDice
        : null
    : null;
  const storedBuildDice = turnLocked
    ? state.diceLocked && Array.isArray(state.lockedBuildDice) && state.lockedBuildDice.length === 2
      ? state.lockedBuildDice
      : Array.isArray(state.lastBuildDice) && state.lastBuildDice.length === 2
        ? state.lastBuildDice
        : null
    : null;
  const lockedLocIdx = storedLocationDice
    ? storedLocationDice.map((die) => dieSourceIndex(die)).filter((idx) => idx >= 0)
    : null;
  const lockedBuildIdx = storedBuildDice
    ? storedBuildDice.map((die) => dieSourceIndex(die)).filter((idx) => idx >= 0)
    : null;
  const effectiveLocSelection =
    Array.isArray(lockedLocIdx) && lockedLocIdx.length === 2 ? lockedLocIdx : baseSelection;
  const buildSelection =
    lockedBuildIdx && lockedBuildIdx.length === 2 && effectiveLocSelection.length === 2
      ? lockedBuildIdx
      : effectiveLocSelection.length === 2
        ? state.dice.map((_, idx) => idx).filter((idx) => !effectiveLocSelection.includes(idx))
        : [];
  state.dice.forEach((die, idx) => {
    const isLocation = effectiveLocSelection.includes(idx);
    // X dice with resolved numeric values can be location dice
    const isXWithoutNumber = die.face === "X" && typeof die.resolved !== "number";
    const isBuildAssigned =
      effectiveLocSelection.length === 2 ? buildSelection.includes(idx) : baseSelection.length === 2 || isXWithoutNumber;
    const locked = turnLocked;
    const badge = makeDieBadge(die, idx, {
      role: isLocation ? "location" : isBuildAssigned ? "build" : null,
      locked: locked || turnLocked || isXWithoutNumber,
      clickable: !turnLocked,
      showRoleStyle: !turnLocked,
      forcedLocation: (state.forcedLocationDice || []).includes(idx),
      allowInfluence: false,
      useAdjustedFace: false,
    });
    row.appendChild(badge);
  });
  field.appendChild(row);
  diceView.appendChild(field);
  diceView.classList.toggle("dice-rolling", state.diceRolling);
}

function fillBuildings(buildDice) {
  const hasLockedLocation = p2pUiState.splitLocked && Array.isArray(state.lockedLocationDice) && state.lockedLocationDice.length === 2;
  const lockedPairs = hasLockedLocation ? effectiveLockedLocationPairs() : [];
  const availablePairs = hasLockedLocation ? lockedPairs : state.locationPairs || [];
  const readyForBuild =
    (hasLockedLocation && lockedPairs.length > 0) || (state.locationSelection.length === 2 && availablePairs.length > 0);
  let effectiveBuildDice = hasLockedLocation && state.lockedBuildDice?.length === 2 ? state.lockedBuildDice : buildDice;
  if (hasLockedLocation) {
    const choice = lockedPairChoice();
    effectiveBuildDice = choice.buildDice || effectiveBuildDice;
    // keep state in sync so downstream pop calculation has the swapped build dice
    state.buildDice = effectiveBuildDice;
  }

  if (!readyForBuild) {
    state.buildChoice = null;
    state.selectedGuildType = null;
    renderBuildingOverlay([], true);
    return;
  }
  if (state.activationMode || forceForfeitActive() || state.pestilence) {
    renderBuildingOverlay([], true);
    return;
  }
  const adjustedBuildDice = applyInfluenceToDice(state, effectiveBuildDice);
  const allowed = restrictBuildOptionsForBoard(buildingOptionsFromDice(adjustedBuildDice), state.board);
  const availableGuildTypes = guildTypes.filter((t) => !builtGuildTypes(state.board).has(t));
  const options = allowed.filter((opt) => {
    if (opt.code !== "G") return true;
    return availableGuildTypes.length > 0;
  });
  if (!options.length && !state.forceForfeit && !state.pestilence) {
    if (!state.noBuildOptionsLogged) {
      log("No valid buildings for this split; forfeit a plot.");
      state.noBuildOptionsLogged = true;
    }
    state.buildChoice = null;
    state.selectedGuildType = null;
    state.forceForfeit = true;
    lockDiceSnapshot(state, { uniqueLocationPairs });
    state.bannerOverride = "No valid builds; forfeit an empty plot.";
    updateActionBanner();
    renderSelectionDice(state.lockedLocationDice || [], state.lockedBuildDice || []);
    highlightLocations();
    renderBoard();
    return;
  }
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
  // In multiplayer, disable building overlay if this player has already built or used their split
  const myBuildAlreadyDone = isMyBuildDone();
  const mySplitUsed = isMySplitUsed();
  const forceDisabled =
    disabled ||
    (!hasLockedLocation && state.locationSelection.length !== 2) ||
    diceLockedForBuild ||
    state.activationMode ||
    forceForfeitActive() ||
    state.forceForfeitAdvisory ||
    state.pestilence ||
    myBuildAlreadyDone ||
    mySplitUsed;
  
  if (debugMode && isMultiplayerActive() && (myBuildAlreadyDone || mySplitUsed)) {
    console.log('[renderBuildingOverlay] Player already done, disabling overlay:', {
      seatId: p2pUiState.seatId,
      buildDone: myBuildAlreadyDone,
      splitUsed: mySplitUsed
    });
  }
  const buildDice =
    hasLockedLocation && state.lockedBuildDice?.length === 2
      ? (lockedPairChoice().buildDice || state.lockedBuildDice)
      : state.buildDice;
  if ((!options || !options.length) && buildDice?.length && !forceDisabled) {
    const fallback = restrictBuildOptionsForBoard(buildingOptionsFromDice(buildDice), state.board);
    options = fallback;
  }
  clearElement(overlay);
  const disableOverlay = forceDisabled || !options?.length;
  overlay.classList.toggle("disabled", disableOverlay);
  const optionMap = new Map(options.map((o) => [o.code, o]));
  buildingHitboxes.forEach((hit) => {
    const opt = disableOverlay ? null : optionMap.get(hit.code);
    const div = document.createElement("div");
    div.className = "building-hit";
    div.dataset.code = hit.code;
    div.style.gridArea = `${hit.row} / ${hit.col}`;
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
      const awaitingSplitConfirmation = isAwaitingSplit();
      if ((!hasLockedLocation && state.locationSelection.length !== 2) || diceLockedForBuild) return;
      if (awaitingSplitConfirmation) {
        log("Confirm your dice split first before selecting a building.");
        return;
      }
      document.querySelectorAll(".building-hit.selected").forEach((el) => el.classList.remove("selected"));
      div.classList.add("selected");
      handleBuildingChoice();
      renderSelectionDice();
    });
    div.setAttribute("aria-label", `${hit.code}${opt?.sourceLabel ? ` via ${opt.sourceLabel}` : ""}`);
    overlay.appendChild(div);
  });
}

function highlightMarketClaims(marketRow, marketCol) {
  if (!state.currentNodeToMarket) return;
  
  // Find all nodes claimed by this market
  state.currentNodeToMarket.forEach((data, nodeKey) => {
    const claims = Array.isArray(data) ? data : data ? [data] : [];
    if (claims.some((entry) => entry.marketRow === marketRow && entry.marketCol === marketCol)) {
      const [nr, nc] = nodeKey.split(',').map(Number);
      const nodeEl = document.querySelector(`.population-node[data-node-row="${nr}"][data-node-col="${nc}"]`);
      if (nodeEl) {
        nodeEl.classList.add("market-claimed");
      }
    }
  });
}

function clearMarketHighlights() {
  document.querySelectorAll('.population-node.market-claimed').forEach(node => {
    node.classList.remove('market-claimed');
  });
}

function renderBoard() {
  clearElement(boardEl);
  const activationMap =
    state.activationMode || state.activationComplete
      ? computeActivationMap(state.board, state.populationNodes, currentWorkerAllocationsForScore())
      : null;
  state.board.forEach((row, r) => {
    row.forEach((data, c) => {
      const cell = document.createElement("div");
      cell.className = "cell terrain";
      cell.dataset.row = r;
      cell.dataset.col = c;
      cell.style.gridRowStart = r + 1;
      cell.style.gridColumnStart = c + 1;
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
        // Add market hover to highlight claimed nodes
        if (data.building === "M") {
          cell.onmouseenter = () => highlightMarketClaims(r, c);
          cell.onmouseleave = () => clearMarketHighlights();
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
          const outline = document.createElement("img");
          outline.className = "plot-outline";
          outline.src = ICONS.plotOutline;
          outline.alt = "";
          cell.appendChild(outline);
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
  // Allow pestilence/forfeit clicks even during animation (they are mandatory actions)
  const isPestilenceOrForfeit = state.pestilence || state.forceForfeit || state.forceForfeitAdvisory;
  if (state.diceRolling && !isPestilenceOrForfeit) return;
  
  const hasLockedLocation = state.diceLocked && Array.isArray(state.lockedLocationDice) && state.lockedLocationDice.length === 2;
  const awaitingSplit = isAwaitingSplit();
  const phase = currentTurnPhase();
  const myBuildAlreadyDone = isMyBuildDone();
  if (myBuildAlreadyDone && !state.activationMode && !state.pendingPopulation?.remaining) {
    log("Build already completed. Waiting for other players.");
    return;
  }
  if (state.locationSelection.length < 2 && !hasLockedLocation && !state.pestilence && !forceForfeitActive() && !state.activationMode) {
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
  if (isPestilenceOrForfeit) {
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
  forEachCell((cell) => {
    cell.classList.remove("highlight", "disabled");
    const oct = cell.querySelector(".octagon");
    if (oct) oct.remove();
  });
  if (state.activationMode) {
    const selPop = state.activationSelection.pop;
      forEachCell((cell) => {
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
          cell.title = `Workers ${filled}/${req}`;
        } else {
          cell.classList.add("disabled");
          if (data.building && req > 0) {
            cell.title = `Workers ${filled}/${req}${data.activationForfeit ? " (forfeited)" : ""}`;
          }
        }
        if ((req === 0 && data.building) || filled >= req) {
          cell.classList.add("activated-building");
        }
      });
    return;
  }
  if (state.activationMode) {
    const sel = state.activationSelection.building;
    forEachCell((cell) => {
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
    forEachCell((cell) => {
      const r = parseInt(cell.dataset.row, 10);
      const c = parseInt(cell.dataset.col, 10);
      const data = state.board[r][c];
      const match = options.some(([rr, cc]) => rr === r && cc === c);
      if (match && data.building && !data.forfeited) {
        cell.classList.add("highlight");
        cell.appendChild(createOctagon());
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
    forEachCell((cell) => {
      const r = parseInt(cell.dataset.row, 10);
      const c = parseInt(cell.dataset.col, 10);
      const data = state.board[r][c];
      const match =
        (!data.building && !data.forfeited && highlightAny) ||
        targetCells.some(([tr, tc]) => tr === r && tc === c);
      if (match && !data.building && !data.forfeited) {
        cell.classList.add("highlight");
        cell.appendChild(createOctagon());
      } else {
        cell.classList.add("disabled");
      }
    });
    return;
  }
  
  // In multiplayer, don't highlight if this player has already built or used their split
  // This check must come BEFORE forfeit highlighting to prevent showing forfeits to players who are done
  const myBuildAlreadyDone = isMyBuildDone();
  const mySplitUsed = isMySplitUsed();
  if (myBuildAlreadyDone || mySplitUsed) {
    return;
  }
  
  if (state.forceForfeitHighlight) {
    forEachCell((cell) => {
      const r = parseInt(cell.dataset.row, 10);
      const c = parseInt(cell.dataset.col, 10);
      const data = state.board[r][c];
      if (!data.building && !data.forfeited) {
        cell.classList.add("highlight");
        cell.appendChild(createOctagon());
      } else {
        cell.classList.add("disabled");
      }
    });
    return;
  }
  // Regular location highlighting for building placement
  const showLockedHighlight =
    p2pUiState.splitLocked && Array.isArray(state.lockedLocationDice) && state.lockedLocationDice.length === 2;
  const locPairs = showLockedHighlight ? effectiveLockedLocationPairs() : state.locationPairs;
  if ((state.locationSelection.length !== 2 && !showLockedHighlight) || !locPairs?.length) return;
  forEachCell((cell) => {
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
      cell.appendChild(createOctagon());
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
  playSfx();
  if (code === "C") {
    const previousHousing = state.tracks.housing;
    state.tracks.housing += 4;
    if (state.tracks.housing > previousHousing) {
      playSfx();
    }
  }
  const buildPool =
    p2pUiState.splitLocked && Array.isArray(state.lockedBuildDice) && state.lockedBuildDice.length === 2
      ? (lockedPairChoice().buildDice || state.lockedBuildDice)
      : state.buildDice;
  const adjustedBuildPool = applyInfluenceToDice(state, buildPool || []);
  let popGain = 0;
  if (state.buildChoice?.source === "die1") {
    popGain = dieMaxValue(adjustedBuildPool?.[1]);
  } else if (state.buildChoice?.source === "die2") {
    popGain = dieMaxValue(adjustedBuildPool?.[0]);
  }
  if (!popGain && typeof state.buildChoice?.popGain === "number") {
    popGain = state.buildChoice.popGain;
  }
  lockDiceSnapshot(state, { markPendingNextRoll: true, uniqueLocationPairs });
  renderBoard();
  updateTracks();
  const displayLabel =
    code === "G"
      ? (() => {
          const map = { GF: "FG", GQ: "QG", GW: "WG" };
          const raw = (buildingLabel || "G").toUpperCase();
          return map[raw] || raw;
        })()
      : code;
  log(`Placed ${displayLabel} at row ${r + 1}, col ${c + 1}`);
  if (isMultiplayerActive()) {
    const map = ensureSplitUsedMap(null, null, p2pUiState);
    map[p2pUiState.seatId] = true;
    p2pUiState.splitUsed = map;
    
    if (debugMode) {
      console.log('[placeBuilding] Set splitUsed for seat', p2pUiState.seatId, ':', p2pUiState.splitUsed);
      validateMultiplayerState();
    }
  } else {
    state.splitUsedForBuild = true;
  }
  updateDiceAssignments();
  updateMultiplayerButtons();
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
    if (isMultiplayerActive()) {
      syncStateToPeer();
    }
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
  const forcedFlow = state.pestilence || forceForfeitActive();
  cell.forfeited = true;
  playSfx();
  state.forceForfeit = false;
  state.forceForfeitAdvisory = false;
  state.forceForfeitHighlight = false;
  state.invalidSelection = false;
  state.invalidSelectionMessage = null;
  lockDiceSnapshot(state, { markPendingNextRoll: true, uniqueLocationPairs });
  updateDiceAssignments();
  renderBoard();
  const context = state.pestilence ? " during Pestilence" : "";
  log(`Forfeited row ${r + 1}, col ${c + 1}${context}`);
  // Resolve pestilence/forfeit state so the turn can advance
  state.pestilence = false;
  state.pestilenceInfo = null;
  refreshScoreOverlay();
  maybeRollAfterLock();
  autoAdvance();
  autoMarkBuildDoneIfReady({ force: forcedFlow });
}

// ============================================================================
// STATE UPDATES - Track recalculation and UI state synchronization
// ============================================================================

function updateTracks() {
  const { vagrants, scoreResult, influence } = recalcTracks(state, {
    computeScore,
    calcVagrants,
  });
  if (influence?.gained > 0) {
    log(
      influence.gained === 1
        ? "Population milestone reached: gained 1 Influence."
        : `Population milestone reached: gained ${influence.gained} Influence.`,
    );
  }
  updateScoreOverlays(
    scoreResult.breakdown,
    scoreResult.total,
    scoreResult.marketDetails,
    scoreResult.nodeToMarket,
  );
  const influenceEarned = state.influence?.earned || 0;
  const influenceSpent = (state.influence?.spent || 0) + (state.influence?.pending || 0);
  renderInfluenceTrack({ influenceEarned, influenceSpent });
  renderPopHousingTrack(state.tracks.population, state.tracks.housing, vagrants);
}

function log(msg) {
  state.log.unshift(msg);
  if (logEl) {
    logEl.innerHTML = state.log.map((m) => `<li>${m}</li>`).join("");
  }
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
  // Advance turn track for the final turn when entering activation
  if (!isMultiplayerActive()) {
    advanceTurnTrack();
  }
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
    forceForfeitActive() ||
    state.pestilence;
  overlay.style.pointerEvents = available.length && !locked ? "auto" : "none";
  clearElement(overlay);
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
  if (debugMode) {
    console.log('[beginPopulationPlacement] Starting with count =', count, 'at', r, c);
  }
  const result = startPopulationPlacement(state, [r, c], count, { nodesForCell });
  if (debugMode) {
    console.log('[beginPopulationPlacement] After startPopulationPlacement:', result, 'state.pendingPopulation =', state.pendingPopulation);
  }
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
  playSfx();
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

// ============================================================================
// UI MESSAGES & FEEDBACK - Action banners, turn hints, and user feedback
// ============================================================================

function updateActionBanner() {
  const phase = currentTurnPhase();
  updateBannerUI(state, p2pUiState, phase, {
    currentScore,
    lockedPairChoice,
    isMultiplayerActive,
  });
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
    !forceForfeitActive() &&
    !state.activationMode;
  finishSplitBtn.style.display = canFinishSplit ? "inline-block" : "none";
  finishSplitBtn.disabled = !canFinishSplit;

  if (swapPairBtn) {
    let showSwap = false;
    if (multiplayer && p2pUiState.splitLocked && !state.pestilence) {
      const choice = lockedPairChoice();
      showSwap = choice.swapAllowed;
    } else if (!multiplayer) {
      showSwap = soloSwapAvailable();
    }
    swapPairBtn.style.display = showSwap ? "inline-block" : "none";
    swapPairBtn.disabled = !showSwap;
    applySwapButtonPulse(showSwap);
  }
}

function applySwapButtonPulse(showSwap) {
  if (!swapPairBtn) return;
  const PULSE_DURATION = 4000;
  if (showSwap) {
    if (!swapBtnLastVisible) {
      swapPairBtn.classList.add("swap-pulse");
      if (swapBtnPulseTimeout) clearTimeout(swapBtnPulseTimeout);
      swapBtnPulseTimeout = setTimeout(() => {
        swapPairBtn.classList.remove("swap-pulse");
        swapBtnPulseTimeout = null;
      }, PULSE_DURATION);
    }
  } else {
    if (swapBtnPulseTimeout) {
      clearTimeout(swapBtnPulseTimeout);
      swapBtnPulseTimeout = null;
    }
    swapPairBtn.classList.remove("swap-pulse");
  }
  swapBtnLastVisible = showSwap;
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

function maybeRollAfterLock() {
  if (isMultiplayerActive()) return "wait";
  const action = maybeRollAfterLockState(state);
  if (action === "roll") {
    advanceTurnTrack();
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
            { x: 22, y: 22 },
            { x: 78, y: 78 },
          ],
          3: [
            { x: 22, y: 22 },
            { x: 50, y: 50 },
            { x: 78, y: 78 },
          ],
          4: [
            { x: 22, y: 22 },
            { x: 78, y: 22 },
            { x: 22, y: 78 },
            { x: 78, y: 78 },
          ],
          5: [
            { x: 22, y: 22 },
            { x: 78, y: 22 },
            { x: 50, y: 50 },
            { x: 22, y: 78 },
            { x: 78, y: 78 },
          ],
          6: [
            { x: 22, y: 22 },
            { x: 78, y: 22 },
            { x: 22, y: 50 },
            { x: 78, y: 50 },
            { x: 22, y: 78 },
            { x: 78, y: 78 },
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
      node.onclick = () => {
        if (state.diceRolling) return;
        onPopulationNodeClick(r, c);
      };
      grid.appendChild(node);
    }
  }
  boardEl.appendChild(grid);
}

function renderSelectionDice(locationDice = [], buildDice = [], { forceBuildPreview = false, ignoreState = false } = {}) {
  const clampDice = (arr) => (Array.isArray(arr) ? arr.slice(0, 2) : []);
  if (ignoreState) {
    const loc = clampDice(locationDice || []);
    const build = clampDice(forceBuildPreview ? buildDice || [] : buildDice || []);
    if (locDicePreview) renderDicePreview(locDicePreview, loc, "location", "Select 2 dice for location");
    if (buildDicePreview) renderDicePreview(buildDicePreview, build, "build", "Remaining dice used for build");
    return;
  }
  if (state.activationMode || state.activationComplete) {
    if (locDicePreview) renderDicePreview(locDicePreview, [], "location", "Select 2 dice for location");
    if (buildDicePreview) renderDicePreview(buildDicePreview, [], "build", "Remaining dice used for build");
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
  const forcedMode = state.pestilence || forceForfeitActive();
  const forcedSplit = forcedMode ? splitForcedDice(state.dice || []) : null;
  const doubleWindrose = shouldRerollDoubleWindrose(state.dice || []);

  let effectiveLoc =
    (doubleWindrose
      ? []
      : (forcedSplit && forcedSplit.locationDice.length && forcedSplit.locationDice) ||
        (locationDice && locationDice.length && locationDice) ||
        (currentLocFromState.length && currentLocFromState) ||
        (state.lockedLocationDice && state.lockedLocationDice.length && state.lockedLocationDice) ||
        []);

  const currentBuildFromState = state.dice.filter((_, idx) => !state.locationSelection.includes(idx));
  const buildReady = state.locationSelection.length === 2 || forceBuildPreview;
  let effectiveBuild =
    doubleWindrose
      ? []
      : (forcedSplit && forcedSplit.buildDice.length)
        ? forcedSplit.buildDice
        : buildReady
          ? (buildDice && buildDice.length && buildDice) ||
            (currentBuildFromState.length && currentBuildFromState) ||
            (state.lockedBuildDice && state.lockedBuildDice.length && state.lockedBuildDice) ||
            (state.lastBuildDice && state.lastBuildDice.length && state.lastBuildDice) ||
            []
          : [];

  const swapped = respectSwap();
  effectiveLoc = swapped.loc && swapped.loc.length ? swapped.loc : effectiveLoc;
  effectiveBuild = swapped.build && swapped.build.length ? swapped.build : effectiveBuild;

  const myBuildNotDone = !isMyBuildDone();
  const mySplitNotUsed = !p2pUiState.splitUsed?.[p2pUiState.seatId];
  const influenceSeatOk = !isMultiplayerActive() || (p2pUiState.splitLocked && myBuildNotDone && mySplitNotUsed);
  const multiplayerSplitConfirmed = isMultiplayerActive() && p2pUiState.splitLocked;
  const singlePlayerDiceNotLocked = !isMultiplayerActive() && !state.diceLocked;
  const hasInfluenceAdjustments = !influenceAdjustmentsEmpty();
  const showInfluenceControls =
    !ignoreState &&
    (multiplayerSplitConfirmed || singlePlayerDiceNotLocked) &&
    !state.activationMode &&
    !state.pestilence &&
    (!forceForfeitActive() || hasInfluenceAdjustments) &&
    state.locationSelection.length === 2 &&
    influenceSeatOk;

  if (locDicePreview) {
    renderDicePreview(
      locDicePreview,
      clampDice(effectiveLoc),
      "location",
      "Select 2 dice for location",
      { allowInfluence: showInfluenceControls },
    );
  }
  if (buildDicePreview) {
    renderDicePreview(
      buildDicePreview,
      clampDice(effectiveBuild),
      "build",
      "Remaining dice used for build",
      { allowInfluence: showInfluenceControls },
    );
  }
}

function makeDieBadge(
  die,
  idx,
  {
    role = null,
    locked = false,
    clickable = true,
    showRoleStyle = true,
    forcedLocation = false,
    allowInfluence = false,
    sourceIndex = idx,
    useAdjustedFace = true,
  } = {},
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
  const effectiveIdx = typeof sourceIndex === "number" ? sourceIndex : idx;
  if (effectiveIdx >= 0) badge.dataset.idx = effectiveIdx;
  const wrap = document.createElement("div");
  wrap.className = "face-wrap";
  const displayDie = useAdjustedFace ? applyInfluenceToDie(state, die) || die : die;
  const face = createDieFaceSVG(displayDie);
  wrap.appendChild(face);
  badge.appendChild(wrap);
  if (clickable && !locked && die.face !== "X" && effectiveIdx >= 0) {
    badge.addEventListener("click", () => {
      if (state.diceRolling) return;
      onDieClick(effectiveIdx);
    });
  }
  if (allowInfluence && isInfluenceEligibleDie(die) && effectiveIdx >= 0) {
    const canDecrease = canAdjustDieValue(die, -1);
    const canIncrease = canAdjustDieValue(die, 1);
    const hasAdjustment = influenceAdjustmentDelta(die.label) !== 0;
    const showControls = canDecrease || canIncrease || hasAdjustment;
    if (showControls) {
      const controls = document.createElement("div");
      controls.className = "die-influence-controls";
      badge.classList.add("has-influence-controls");
      if (canDecrease) {
        const minusBtn = document.createElement("button");
        minusBtn.type = "button";
        minusBtn.className = "influence-btn minus";
        minusBtn.textContent = "-";
        minusBtn.title = "Spend 1 Influence to decrease this die by 1.";
        minusBtn.addEventListener("click", (event) => {
          event.stopPropagation();
          adjustDieWithInfluence(effectiveIdx, -1);
        });
        controls.appendChild(minusBtn);
      }
      if (canIncrease) {
        const plusBtn = document.createElement("button");
        plusBtn.type = "button";
        plusBtn.className = "influence-btn plus";
        plusBtn.textContent = "+";
        plusBtn.title = "Spend 1 Influence to increase this die by 1.";
        plusBtn.addEventListener("click", (event) => {
          event.stopPropagation();
          adjustDieWithInfluence(effectiveIdx, 1);
        });
        controls.appendChild(plusBtn);
      }
      if (hasAdjustment) {
        const resetBtn = document.createElement("button");
        resetBtn.type = "button";
        resetBtn.className = "influence-btn reset";
        resetBtn.textContent = "↺";
        resetBtn.title = "Reset this die to its rolled value.";
        resetBtn.addEventListener("click", (event) => {
          event.stopPropagation();
          resetDieInfluence(effectiveIdx);
        });
        controls.appendChild(resetBtn);
      }
      badge.appendChild(controls);
    }
  }
  return badge;
}

function renderDicePreview(container, dice, role, emptyText, { allowInfluence = false } = {}) {
  if (!container) return;
  container.classList.add("split-preview");
  clearElement(container);
  if (!dice?.length) {
    container.innerHTML = `<span class="hint">${emptyText}</span>`;
    return;
  }
  dice.forEach((die, idx) => {
    const sourceIndex = dieSourceIndex(die);
    const badge = makeDieBadge(die, idx, {
      role,
      locked: false,
      clickable: false,
      showRoleStyle: false,
      forcedLocation: false,
      allowInfluence,
      sourceIndex,
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
    state.forceForfeitAdvisory = false;
    state.invalidSelection = false;
    state.invalidSelectionMessage = null;
    state.influenceSelectionKey = null;
    renderSelectionDice([], []);
    fillBuildings([]);
    highlightLocations();
    updateActionBanner();
    renderDice();
    updateMultiplayerButtons();
    return;
  }
  if (!influenceAdjustmentsEmpty()) {
    const selectionKey = canonicalSelectionKey(state.locationSelection);
    if (state.influenceSelectionKey && state.influenceSelectionKey !== selectionKey) {
      const cleared = clearInfluenceAdjustments();
      if (cleared) {
        log("Influence adjustments reset after changing dice selection.");
        updateTracks();
      }
    }
  } else if (state.influenceSelectionKey) {
    state.influenceSelectionKey = null;
  }
  if (isMultiplayerActive() && p2pUiState.splitLocked) {
    const myBuildDone = isMyBuildDone();
    const choice = lockedPairChoice();
    const lockedLoc = choice.locDice;
    const lockedBuild = choice.buildDice;
    
    // If this player has already built, skip forfeit evaluation and just wait
    if (myBuildDone) {
      state.forceForfeit = false;
      state.forceForfeitAdvisory = false;
      state.invalidSelection = false;
      state.invalidSelectionMessage = null;
      state.buildDice = lockedBuild;
      renderSelectionDice(lockedLoc, lockedBuild);
      fillBuildings(lockedBuild);
      highlightLocations();
      updateActionBanner();
      renderDice();
      updateMultiplayerButtons();
      return;
    }
    
    const adjustedLockedLoc = applyInfluenceToDice(state, lockedLoc || []);
    const pairsForBoard = filterAvailablePairs(uniqueLocationPairs(adjustedLockedLoc || []), state.board);
    const rescuePossible =
      !pairsForBoard.length &&
      adjustedLockedLoc?.length === 2 &&
      canRescueLocationWithInfluence(state, adjustedLockedLoc, state.board, {
        uniqueLocationPairs,
        filterAvailablePairs,
      });
    state.forceForfeit = pairsForBoard.length === 0 && !rescuePossible;
    state.forceForfeitAdvisory = rescuePossible && !pairsForBoard.length;
    if (!pairsForBoard.length && rescuePossible) {
      state.invalidSelection = true;
      state.invalidSelectionMessage = "No valid location pairs; spend Influence or forfeit a plot.";
    } else {
      state.invalidSelection = false;
      state.invalidSelectionMessage = null;
    }
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
    // Only X dice without resolved numbers are build dice
    const xDice = (state.dice || []).filter((d) => d && d.face === "X" && typeof d.resolved !== "number");
    state.locationSelection = (state.forcedLocationDice || []).filter((idx) => state.dice[idx]?.face === "windrose");
    state.locationPairs = [];
    state.buildDice = xDice;
    state.forceForfeit = false;
    state.forceForfeitAdvisory = false;
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
    // Only X dice without resolved numbers are build dice
    const xDice = (state.dice || []).filter((d) => d && d.face === "X" && typeof d.resolved !== "number");
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
  let locationDice = state.locationSelection.map((i) => state.dice[i]).filter(Boolean);
  let buildDice =
    state.locationSelection.length === 2 ? state.dice.filter((_, idx) => !state.locationSelection.includes(idx)) : [];

  const { message } = evaluateLocationSelection(state, {
    uniqueLocationPairs,
    filterAvailablePairs,
    board: state.board,
  });
  if (message) log(message);

  // Re-evaluate dice assignments in case the selection changed (e.g. auto-swap on non-active turns).
  locationDice = state.locationSelection.map((i) => state.dice[i]).filter(Boolean);
  buildDice =
    state.locationSelection.length === 2 ? state.dice.filter((_, idx) => !state.locationSelection.includes(idx)) : [];
  if (locationDice.length === 2) {
    state.lastLocationDice = locationDice;
    state.lastBuildDice = buildDice;
  }

  if (turnHintEl) {
    if (state.activeTurn && state.invalidSelection) {
      turnHintEl.textContent =
        state.invalidSelectionMessage || "No valid plots for that pair; choose a different location pair.";
    } else if (state.forceForfeitAdvisory) {
      turnHintEl.textContent = "No valid location pairs; spend Influence or forfeit a plot.";
    } else if (forceForfeitActive()) {
      turnHintEl.textContent = "No valid location pairs; forfeit a plot.";
    } else if (!state.activeTurn) {
      turnHintEl.textContent = isMultiplayerActive()
        ? "Waiting for the active player to finish the split."
        : nonActiveAutoHintText();
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
  fillBuildings(previewBuild);
  highlightLocations();
  updateActionBanner();
  renderDice();
  updateMultiplayerButtons();
  if (isMultiplayerActive() && p2pUiState.activeSeat === p2pUiState.seatId && !p2pUiState.splitLocked) {
    syncStateToPeer();
  }
}

function computeSwapChoice(baseLoc = [], baseBuild = [], swapFlag = false) {
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

function lockedPairChoice() {
  const baseLoc = (state.lockedLocationDice || []).slice(0, 2);
  const baseBuild = (state.lockedBuildDice || state.buildDice || []).slice(0, 2);
  return computeSwapChoice(baseLoc, baseBuild, p2pUiState.lockedPairSwap);
}

function soloBaseSelections() {
  if (isMultiplayerActive()) return null;
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

function soloPairChoice() {
  const base = soloBaseSelections();
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

function soloPairHasValidLocations(diceList = []) {
  if (!Array.isArray(diceList) || diceList.length !== 2) return false;
  if (!Array.isArray(state.board) || !state.board.length) return false;
  const adjusted = applyInfluenceToDice(state, diceList);
  const pairs = filterAvailablePairs(uniqueLocationPairs(adjusted), state.board);
  return pairs.length > 0;
}

function soloPairCanBeRescued(diceList = []) {
  if (!Array.isArray(diceList) || diceList.length !== 2) return false;
  if (!Array.isArray(state.board) || !state.board.length) return false;
  return canRescueLocationWithInfluence(state, diceList, state.board, {
    uniqueLocationPairs,
    filterAvailablePairs,
  });
}

function soloSwapAvailable() {
  if (isMultiplayerActive()) return false;
  if (state.activeTurn || state.pestilence || state.activationMode) return false;
  const choice = soloPairChoice();
  if (!choice.baseLocIdx || !choice.baseBuildIdx) return false;
  if (!choice.swapAllowed) return false;
  
  const baseValid = soloPairHasValidLocations(choice.baseLocDice);
  const altValid = soloPairHasValidLocations(choice.baseBuildDice);
  
  const baseCanBeRescued = !baseValid && soloPairCanBeRescued(choice.baseLocDice);
  const altCanBeRescued = !altValid && soloPairCanBeRescued(choice.baseBuildDice);
  const basePossible = baseValid || baseCanBeRescued;
  const altPossible = altValid || altCanBeRescued;
  if (!basePossible && !altPossible) return false;
  return true;
}

function nonActiveAutoHintText() {
  return generateNonActiveHint(soloSwapAvailable());
}

function toggleSoloPairChoice() {
  const base = soloBaseSelections();
  if (!base) return false;
  const choice = computeSwapChoice(base.baseLocDice, base.baseBuildDice, state.nonActiveSwap);
  if (!choice.swapAllowed) return false;
  state.nonActiveSwap = !state.nonActiveSwap;
  const target = state.nonActiveSwap ? base.baseBuildIdx : base.baseLocIdx;
  state.locationSelection = target.slice(0, 2);
  state.locationPairs = [];
  state.buildDice = [];
  return true;
}

function toggleLockedPairChoice() {
  if (isMultiplayerActive()) {
    const choice = lockedPairChoice();
    if (!choice.swapAllowed) return;
    p2pUiState.lockedPairSwap = !p2pUiState.lockedPairSwap;
  } else if (!state.activeTurn) {
    const toggled = toggleSoloPairChoice();
    if (!toggled) return;
  } else {
    return;
  }
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
  
  // Batch state updates atomically before sync
  Object.assign(state, {
    lockedLocationDice: locationDice,
    lockedBuildDice: buildDice,
    lockedLocationPairs: (state.locationPairs || []).map((p) => p.slice()),
    diceLocked: true,
  });
  
  Object.assign(p2pUiState, {
    splitLocked: true,
    lockedPairSwap: false,
  });
  
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
  const merged = ensureBuildDoneMap(null, null, p2pUiState);
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
  const ready = shouldAutoMarkBuildDone({
    force,
    isMultiplayerActive: isMultiplayerActive(),
    p2pUiState,
    state,
  });
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
  advanceTurnTrack();
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
  updateScoreOverlays(result.breakdown, result.total, result.marketDetails, result.nodeToMarket);
  return result;
}

function updateScoreOverlays(breakdown, total = 0, marketDetails = [], nodeToMarket = new Map()) {
  if (!scoreOverlayBuildingsEl || !scoreOverlayGuildsEl || !scoreOverlayReputationEl) return;
  const buildingTotals = breakdown["buildings-total"] || 0;
  const formatScoreValue = (value, key) => {
    if (typeof value !== "number") return "0";
    if (key === "reputation") return `${value}`; // reputation spot shows negatives
    return `${Math.abs(value)}`;
  };
  clearElement(scoreOverlayBuildingsEl);
  clearElement(scoreOverlayGuildsEl);
  clearElement(scoreOverlayReputationEl);
  scoringSpots.forEach((spot) => {
    const leftPos = typeof spot.x === "number" ? spot.x : 0;
    const topPos = typeof spot.y === "number" ? spot.y : 30;
    let val;
    if (spot.key === "reputation") {
      val = total;
    } else if (spot.key === "buildings-total") {
      val = buildingTotals;
    } else {
      val = typeof breakdown[spot.key] === "number" ? breakdown[spot.key] : 0;
    }
    const negative = typeof val === "number" && val < 0;
    const forceNegative = spot.key === "vagrants" || spot.key === "springhouse";
    const chip = document.createElement("div");
    chip.className = ["score-chip"]
      .concat(negative || forceNegative ? ["negative"] : [])
      .join(" ");
    chip.id = `score-chip-${spot.key}`;
    const isGuildSpot = spot.key.startsWith("guilds-");
    const isReputationSpot = spot.key === "reputation" || spot.key === "vagrants" || spot.key === "buildings-total";
    let targetEl = scoreOverlayBuildingsEl;
    if (isGuildSpot) {
      targetEl = scoreOverlayGuildsEl;
    } else if (isReputationSpot) {
      targetEl = scoreOverlayReputationEl;
    }
    chip.style.left = `${leftPos}px`;
    chip.style.top = `${topPos}px`;
    chip.textContent = formatScoreValue(val, spot.key); // board art includes negatives for most spots
    
    // Add market details tooltip
    if (spot.key === "market" && marketDetails.length > 0) {
      chip.title = marketDetails
        .map(m => `Row ${m.row + 1}, Col ${m.col + 1}: ${m.points}pts`)
        .join('\n');
    }
    
    targetEl.appendChild(chip);
  });
  
  // Store for hover interactions
  state.currentMarketDetails = marketDetails;
  state.currentNodeToMarket = nodeToMarket;
}


function renderPopHousingTrack(pop = 0, housing = 0, vagrants = 0) {
  if (!popHousingOverlay) return;
  clearElement(popHousingOverlay);
  const track = document.createElement("div");
  track.className = "pop-track";
  const housingUnits = Math.max(0, Math.floor(housing / 4));
  let remainingPop = Math.max(0, pop);
  let cellIdx = 0;
  POP_LAYOUT.rows.forEach((cols) => {
    for (let c = 0; c < cols; c += 1) {
      const cell = document.createElement("div");
      cell.className = "pop-cell";
      if (cellIdx < housingUnits) cell.classList.add("has-housing");

      const pipGrid = document.createElement("div");
      pipGrid.className = "pip-grid";
      const pipsThisCell = Math.max(0, Math.min(POP_LAYOUT.pipsPerCell, remainingPop));
      for (let i = 0; i < POP_LAYOUT.pipsPerCell; i += 1) {
        const pip = document.createElement("div");
        pip.className = "pop-pip";
        const pipIndex = cellIdx * POP_LAYOUT.pipsPerCell + i + 1;
        const milestone = isInfluenceMilestone(pipIndex);
        if (milestone) pip.classList.add("influence-marker");
        if (i < pipsThisCell) {
          pip.classList.add("filled-pop");
          if (milestone) {
            pip.classList.add("influence-bonus");
          }
        }
        pipGrid.appendChild(pip);
      }
      remainingPop -= pipsThisCell;
      cell.appendChild(pipGrid);
      track.appendChild(cell);
      cellIdx += 1;
    }
  });
  popHousingOverlay.appendChild(track);
}

function renderInfluenceTrack({ influenceEarned = 0, influenceSpent = 0 } = {}) {
  if (!influenceOverlay) return;
  clearElement(influenceOverlay);
  const track = document.createElement("div");
  track.className = "influence-track";
  const spentCount = Math.min(influenceEarned, influenceSpent);
  for (let i = 0; i < INFLUENCE_TRACK_SLOTS; i += 1) {
    const slot = document.createElement("div");
    slot.className = "influence-slot";
    if (i < influenceEarned) {
      const icon = document.createElement("img");
      icon.src = ICONS.influenceOutline;
      icon.alt = "";
      icon.className = "influence-icon";
      slot.appendChild(icon);
      slot.classList.add("earned");
      if (i < spentCount) {
        slot.classList.add("spent");
        const scribble = document.createElement("img");
        scribble.src = ICONS.influenceScribble;
        scribble.alt = "";
        scribble.className = "influence-scribble";
        slot.appendChild(scribble);
        slot.title = "Influence spent.";
      } else {
        slot.classList.add("available");
        slot.title = "Influence available.";
      }
    }
    track.appendChild(slot);
  }
  influenceOverlay.appendChild(track);
}

function renderTurnTrack(filled = 0) {
  if (!turnTrackOverlay) return;
  const count = Math.max(0, Math.min(TURN_TRACK_LENGTH, Number(filled) || 0));
  clearElement(turnTrackOverlay);
  for (let i = 0; i < TURN_TRACK_LENGTH; i += 1) {
    const slot = document.createElement("div");
    slot.className = "turn-slot";
    if (i < count) {
      const icon = document.createElement("img");
      icon.src = "assets/img/forfeit.svg";
      icon.alt = "";
      icon.setAttribute("aria-hidden", "true");
      slot.appendChild(icon);
    }
    turnTrackOverlay.appendChild(slot);
  }
}

function advanceTurnTrack() {
  state.turnTrack = Math.min(TURN_TRACK_LENGTH, (state.turnTrack || 0) + 1);
  renderTurnTrack(state.turnTrack);
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
  playSfx();
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
            const copyFeedbackTimeout = setTimeout(() => {
              p2pCopyBtn.textContent = original;
              p2pCopyBtn.classList.remove("copied");
            }, 1500);
            // Store for potential cleanup
            if (typeof window !== "undefined") window.__copyFeedbackTimeout = copyFeedbackTimeout;
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
    clearElement(p2pMeeplesEl);
    p2pMeeplesEl.classList.add("hidden");
    return;
  }
  p2pUiState.connectedSeats = ensureConnectedSeats(p2pUiState.connectedSeats);
  p2pMeeplesEl.classList.remove("hidden");
  clearElement(p2pMeeplesEl);
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

// Debug helper - always available in console
  if (typeof window !== "undefined") {
    window.debugBoard = () => {
      console.table(state.board.map((row, r) => {
        const rowData = {};
        row.forEach((cell, c) => {
          rowData[`Col ${c + 1}`] = cell.building || (cell.forfeited ? 'FORFEIT' : 'empty');
        });
        rowData['Row'] = r + 1;
        return rowData;
      }));
    };
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
      actionMessage: (stateArg, p2pUiStateArg, phase) => {
        const s = stateArg || state;
        const p = p2pUiStateArg || p2pUiState;
        const ph = phase || currentTurnPhase();
        return generateActionMessage(s, p, ph, { currentScore, lockedPairChoice, isMultiplayerActive });
      },
      renderTurnTrack,
      maybeRollAfterLock,
      placeBuilding,
      validateMultiplayerState,
    };
  }
