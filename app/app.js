/**
 * Rolling Fiefdoms - Main Application
 * 
 * TABLE OF CONTENTS:
 * - Imports & Constants
 * - Helper Functions - Utilities for state checks and DOM
 * - Event Handlers - DOM event setup and user interaction  
 * - Game Logic - Turn flow, dice rolling, building
 * - Rendering Functions - UI rendering and DOM updates
 * - State Updates - Track recalculation and sync
 * - UI Messages & Feedback - Action banners and user feedback
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
  guildTargetFromLabel,
} from "./rules.js";
import { createState, resetTurnState, lockDiceSnapshot } from "./state-controller.js";
import {
  beginTurn,
  tallyUnrestAndCheckBarricade,
  selectLocationDie,
  evaluateLocationSelection,
  startActivation as startActivationState,
  finishActivation as finishActivationState,
  startPopulationPlacement,
  placePopulationNode,
  canPlacePopulationNode,
  chooseBarricadeNode,
  allocateWorker,
  autoForfeitUnfillableState,
  autoAdvanceState,
  recalcTracks,
  maybeRollAfterLockState,
  isReadyToRoll,
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
import { needsConfirmStep } from "./confirm-step.js";
import { guideTo } from "./scroll-guide.js";
import { isCompactLayout } from "./layout-mode.js";
import {
  boardEl,
  diceView,
  turnHintEl,
  turnHintPanelEl,
  actionBarEl,
  actionBarAuxEl,
  buildingPickerEl,
  locDicePreview,
  buildDicePreview,
  influenceStepper,
  influenceStepperFace,
  influenceStepperDieLabel,
  influenceStepperValue,
  influenceStepperMinus,
  influenceStepperPlus,
  influenceStepperReset,
  logEl,
  logDrawerEl,
  logUnreadBadge,
  scoreOverlayBuildingsEl,
  scoreOverlayGuildsEl,
  scoreOverlayReputationEl,
  popHousingOverlay,
  influenceOverlay,
  turnTrackOverlay,
  finishActivationBtn,
  newGameBtn,
  swapPairBtn,
  swapBtnWrap,
  confirmPlotBtn,
  cancelPlotBtn,
  fullscreenBtn,
  sfxToggleBtn,
  sfxToggleLabel,
  sfxToggleIcon,
  localeSelect,
  localeFlagIcon,
  turnStatusChip,
  unrestBadge,
  challengeProgressBadge,
  activeChallengeBadge,
  challengeInfoModal,
  challengeInfoTitle,
  challengeInfoDifficulty,
  challengeInfoDescription,
  challengeInfoVictory,
  challengeInfoRules,
  challengeInfoSetup,
  challengeInfoCloseBtn,
  loadingOverlay,
  sheetBaseImage,
  sheetBaseImages,
  challengePickerEl,
  challengeCardsEl,
  challengeConfirmBtn,
  challengeCancelBtn,
  challengePickerLocaleSelect,
  challengePickerLocaleFlagIcon,
  challengeCarouselPrev,
  challengeCarouselNext,
  challengeCarouselDots,
  challengeOutcomeOverlay,
  challengeOutcomeText,
  challengeOutcomeComparison,
  challengeOutcomeReasons,
  barricadeAlertOverlay,
  barricadeAlertText,
  forEachCell,
  createOctagon,
  clearElement,
  actionBannerEl,
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
  formatButtonLabelHtml,
  flashHint,
  syncInlineActionButtons,
  TURN_PHASE,
} from "./ui-feedback.js";
import {
  initI18n,
  applyStaticDom,
  setLocale,
  getLocale,
  supportedLocales,
  localeDisplayName,
  localeFlag,
  t,
  hasOwnTranslation,
  tEnglish,
  escapeHtml,
} from "./i18n.js";
import { CHALLENGES, CHALLENGE_ORDER } from "./challenges.js";
import { initSheetWindows } from "./sheet-layout.js";
import { onMouseHover } from "./hover.js";
import { initPopovers, setPopover } from "./popover.js";
import { updateScrollCue } from "./scroll-cue.js";
import { buildingTooltip } from "./building-info.js";

const BOARD_SIZE = 5;
const POPULATION_GRID_SIZE = 4;
const SFX_PATH = "assets/sounds/sfx.mp3";
const DICE_SFX_PATH = "assets/sounds/dice.mp3";
const SFX_ICON_ON = "assets/img/sfx-on.svg";
const SFX_ICON_OFF = "assets/img/sfx-off.svg";
const DEFAULT_DICE_ANIM_MS = 1200;
const SFX_STORAGE_KEY = "rf-sfx-enabled";

// Enable test hooks if ?autoplay is present in URL
const autoplayRequested =
  typeof window !== "undefined" && new URLSearchParams(window.location.search).has("autoplay");
if (autoplayRequested) {
  window.__RF_ENABLE_TEST_HOOKS__ = true;
}

// Autoplay must never play dice/build sound effects, at any speed, regardless of the player's
// saved SFX preference (SFX_STORAGE_KEY) — but it must not overwrite that saved preference
// either, so a later normal session (without ?autoplay) still sees whatever the player chose.
// This is a pure in-memory override, checked everywhere audio would otherwise play.
const autoplayMuted = autoplayRequested;

const state = createState();

let controlsReady = false;
const urlParams = new URLSearchParams(window.location.search);
const debugMode = urlParams.has("debug");
let sfxEnabled = true;
try {
  if (typeof window !== "undefined" && window.localStorage) {
    const stored = window.localStorage.getItem(SFX_STORAGE_KEY);
    if (stored !== null) {
      sfxEnabled = stored !== "false";
    }
  }
} catch {
  // ignore storage failures
}
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

function persistSfxPreference() {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(SFX_STORAGE_KEY, sfxEnabled ? "true" : "false");
  } catch {
    // ignore storage failures
  }
}

function updateSfxToggleButton() {
  if (!sfxToggleBtn) return;
  // Reflect the effective (autoplay-muted) state in the header toggle, without touching the
  // underlying sfxEnabled preference that gets persisted to localStorage.
  const effectiveOn = sfxEnabled && !autoplayMuted;
  sfxToggleBtn.setAttribute("aria-pressed", effectiveOn ? "true" : "false");
  sfxToggleBtn.classList.toggle("is-off", !effectiveOn);
  sfxToggleBtn.disabled = autoplayMuted;
  if (sfxToggleLabel) {
    sfxToggleLabel.textContent = effectiveOn ? t("sfx.on") : t("sfx.off");
  }
  if (sfxToggleIcon) {
    sfxToggleIcon.src = effectiveOn ? SFX_ICON_ON : SFX_ICON_OFF;
    sfxToggleIcon.alt = effectiveOn ? t("sfx.onAlt") : t("sfx.offAlt");
  }
}

function updateLocaleFlagIcon() {
  if (localeFlagIcon) localeFlagIcon.textContent = localeFlag(getLocale());
  if (challengePickerLocaleFlagIcon) challengePickerLocaleFlagIcon.textContent = localeFlag(getLocale());
}

function populateLocaleSelect(selectEl = localeSelect) {
  if (!selectEl) return;
  selectEl.innerHTML = "";
  supportedLocales().forEach((code) => {
    const option = document.createElement("option");
    option.value = code;
    option.textContent = localeDisplayName(code);
    selectEl.appendChild(option);
  });
  selectEl.value = getLocale();
  updateLocaleFlagIcon();
}

function applyLocaleChange(locale) {
  setLocale(locale);
  applyStaticDom();
  if (localeSelect) localeSelect.value = getLocale();
  updateLocaleFlagIcon();
  setAllSheetImageSources();
  updateSfxToggleButton();
  updateRollButton();
  renderBoard();
  updateTracks();
  updateDiceAssignments(true);
  updateTurnStatusChip();
  refreshDiceVisibility();
  updateActionBanner();
  if (challengePickerEl && !challengePickerEl.hidden) renderChallengeCards();
}

function stopAllSfx() {
  [sfxAudio, diceAudio].forEach((audio) => {
    if (audio && typeof audio.pause === "function") {
      try {
        audio.pause();
        audio.currentTime = 0;
      } catch {
        // ignore audio failures
      }
    }
  });
}

function setSfxEnabled(enabled) {
  const next = Boolean(enabled);
  if (sfxEnabled === next) return;
  sfxEnabled = next;
  if (!sfxEnabled) {
    stopAllSfx();
  }
  persistSfxPreference();
  updateSfxToggleButton();
}

function toggleSfxEnabled() {
  if (autoplayMuted) return;
  setSfxEnabled(!sfxEnabled);
}

updateSfxToggleButton();

function safePlayAudio(instance, source, { onCreate } = {}) {
  if (!sfxEnabled || autoplayMuted || typeof Audio === "undefined") return null;
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
  } catch {
    // Ignore playback failures (e.g., autoplay restrictions).
  }
  return instance;
}

function playSfx() {
  if (!sfxEnabled || autoplayMuted) return;
  sfxAudio = safePlayAudio(sfxAudio, SFX_PATH);
}

function playDiceSfx() {
  if (!sfxEnabled || autoplayMuted) return;
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

function currentTurnPhase() {
  if (state.activationComplete) return TURN_PHASE.ACTIVATION_DONE;
  if (state.activationMode) return TURN_PHASE.ACTIVATION;
  if (state.pendingCenterBuilding?.active) return TURN_PHASE.CENTER_BUILDING;
  if (state.pendingBarricade?.active) return TURN_PHASE.BARRICADE;
  if (state.pendingPopulation?.remaining > 0) return TURN_PHASE.POPULATION;
  if (state.pestilence) return TURN_PHASE.PESTILENCE;
  if (forceForfeitActive()) return TURN_PHASE.FORFEIT;
  const allowDebugBypass = debugMode;
  if (state.rollAvailable && !allowDebugBypass) return TURN_PHASE.AWAIT_ROLL;
  if (state.diceLocked || state.locationSelection.length === 2) return TURN_PHASE.BUILDING;
  if (state.dice?.length) return TURN_PHASE.SPLITTING;
  return TURN_PHASE.AWAIT_ROLL;
}

function effectiveLockedLocationPairs() {
  if (!state.lockedLocationDice || state.lockedLocationDice.length !== 2) return [];
  const choice = lockedPairChoice();
  const locDice = choice.locDice || state.lockedLocationDice;
  return uniqueLocationPairs(applyInfluenceToDice(state, locDice || []));
}
function prepareNextRoll() {
  state.rollAvailable = true;
  state.dice = [];
  state.locationSelection = [];
  state.locationPairs = [];
  state.buildDice = [];
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
  refreshDiceVisibility();
  highlightLocations();
  updateSwapButton();
}

function shouldRerollDoubleWindrose(dice) {
  if (!Array.isArray(dice) || dice.length < 4) return false;
  const numbered = dice.filter((d) => d?.label?.startsWith("N"));
  if (numbered.length !== 2) return false;
  return numbered.every((d) => d.face === "windrose");
}

function setTurnHint(text) {
  if (!turnHintEl) return;
  if (text && text.includes("<")) {
    turnHintEl.innerHTML = text;
  } else {
    turnHintEl.textContent = text;
  }
  // Mirrors the old `#turnHintPanel:has(#turnHint:empty)` CSS rule as a JS-managed
  // class, since WebKit doesn't reliably re-evaluate :has() after text mutations.
  if (turnHintPanelEl) turnHintPanelEl.classList.toggle("turn-hint-empty", !text);
}

function updateRollButton() {
  const rollBtn = document.getElementById("rollBtn");
  if (!rollBtn) return;
  const hidden = state.activationMode || state.activationComplete;
  const allowDebugBypass = debugMode;
  const awaitingRoll = !allowDebugBypass && state.rollAvailable;
  const showButton = !hidden && (awaitingRoll || allowDebugBypass);
  rollBtn.style.display = showButton ? "inline-block" : "none";
  const enabled =
    allowDebugBypass || (state.rollAvailable && !state.pendingCenterBuilding?.active && !state.pendingBarricade?.active);
  rollBtn.disabled = !enabled;
  rollBtn.classList.toggle("dice-locked", !enabled && !debugMode);
  rollBtn.title = enabled ? t("turn.rollIdleTitle") : t("turn.rollUsedTitle");
  syncInlineActionButtons();
}

function refreshDiceVisibility() {
  const hidden = state.activationMode || state.activationComplete;
  const allowDebugBypass = debugMode;
  const awaitingRoll = !allowDebugBypass && state.rollAvailable;
  if (diceView) diceView.style.display = hidden || awaitingRoll ? "none" : "";
  updateRollButton();
  updateTurnStatusChip();
  if (turnHintEl) {
    turnHintEl.style.display = hidden ? "none" : "";
    if (!hidden && !state.activationMode && !state.activationComplete && !awaitingRoll) {
      turnHintEl.style.display = "";
    }
    if (awaitingRoll) setTurnHint("");
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

const SHEET_VERSION = "v2.0";
const SHEET_BASE_PATH = "resources/rolling-fiefdoms-player-sheet";
// Locales with dedicated board artwork (baked-in translated text). Any
// locale not listed here falls back to the English board.
const LOCALIZED_SHEET_LOCALES = new Set(["fr"]);
const POP_CAPACITY = 5;
const POP_LAYOUT = { rows: [3, 3, 3, 3, 3, 3], pipsPerCell: 4 };
const POP_TRACK_TOTAL_CELLS = POP_LAYOUT.rows.reduce((sum, len) => sum + len, 0);
const POP_TRACK_TOTAL_PIPS = POP_TRACK_TOTAL_CELLS * POP_LAYOUT.pipsPerCell;
const INFLUENCE_TRACK_SLOTS = Math.max(1, earnedInfluenceFromPopulation(POP_TRACK_TOTAL_PIPS));
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
  updateTurnStatusChip();
  updateActionBanner();
  if (!controlsReady) {
    await setupControls();
    controlsReady = true;
  }
  // ?autoplay=N where N is a digit: 0 = normal game, 1-8 = challenge by 1-based index.
  // Skip the challenge picker and start the right game directly.
  const _apParam = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("autoplay");
  if (_apParam !== null && /^\d+$/.test(_apParam)) {
    const _apIdx = parseInt(_apParam, 10);
    const _apChallengeId = _apIdx === 0 ? null : (CHALLENGE_ORDER[_apIdx - 1] || null);
    newGame(_apChallengeId);
  } else {
    openChallengePicker();
  }
}

function activeChallenge() {
  return state.challengeId ? CHALLENGES[state.challengeId] || null : null;
}

// Challenge display names all start with a roman numeral ("I. Foundations", "VI. Embers
// of Revolt", ...); wrap just the numeral in a dedicated font (Roboto) distinct from the
// display font used for the rest of the name, for every render site that shows it.
function formatChallengeNameHtml(name) {
  const match = /^([IVXLCDM]+)(\.\s*)(.*)$/.exec(name);
  if (!match) return escapeHtml(name);
  const [, numeral, separator, rest] = match;
  return `<span class="challenge-name"><span class="challenge-roman-numeral">${escapeHtml(numeral)}</span>${escapeHtml(separator)}${escapeHtml(rest)}</span>`;
}

// A plain circle+"i" glyph (not a text/emoji character) so it renders identically across
// platforms instead of inheriting whatever font is active; uses currentColor so it always
// matches the badge's text color.
const CHALLENGE_INFO_ICON_HTML = `<span class="challenge-badge-info-icon" aria-hidden="true"><svg viewBox="0 0 16 16" width="13" height="13" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="4.6" r="1.05" fill="currentColor"/><rect x="7.15" y="7" width="1.7" height="5.3" rx="0.85" fill="currentColor"/></svg></span>`;

// Labels a Social Contract center-building choice ("T" or a guild code like "GF") for
// display in the picker chooser and the setup log line.
function centerBuildingLabel(choice) {
  if (choice === "T") return t("buildings.T");
  const target = { GF: "F", GQ: "Q", GW: "W", GM: "M" }[choice];
  return `${t("buildings.G")} · ${t(`buildings.${target}`)}`;
}

function resetState(challengeId = null) {
  const challenge = challengeId ? CHALLENGES[challengeId] || null : null;
  state.board = Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => ({ building: null, buildingLabel: null, forfeited: false, springBoost: 0 })),
  );
  state.populationNodes = Array.from({ length: POPULATION_GRID_SIZE }, () => Array(POPULATION_GRID_SIZE).fill(0));
  state.barricadedNodes = Array.from({ length: POPULATION_GRID_SIZE }, () => Array(POPULATION_GRID_SIZE).fill(false));
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
  unreadLogCount = 0;
  updateLogUnreadBadge();
  state.rollAvailable = true;
  state.pendingTurnIndex = null;
  state.pendingActiveTurn = null;
  state.challengeId = challenge?.id || null;
  state.turnLimit = challenge?.turnLimit ?? null;
  state.influenceBonus = challenge?.setup?.startingInfluence || 0;
  state.unrestTracking = Boolean(challenge?.rules?.unrestTracking);
  state.unrest = { progress: 0 };
  state.unrestCheckedTurnIndex = null;
  state.pendingBarricade = null;
  state.pendingCenterBuilding = challenge?.setup?.forcedCenterBuilding
    ? {
        active: true,
        awaitingGuildType: false,
        choices: challenge.setup.forcedCenterBuilding.choices || ["T", ...guildTypes],
      }
    : null;
  resetTurnState(state);
  clearElement(logEl);
  if (finishActivationBtn) finishActivationBtn.style.display = "none";
  if (newGameBtn) newGameBtn.style.display = "none";
  renderTurnTrack(state.turnTrack);
  refreshDiceVisibility();
  updateTurnStatusChip();
  log(t("game.started"));
  if (challenge) {
    log(formatChallengeNameHtml(t(challenge.nameKey)));
  }
  if (state.influenceBonus > 0) {
    log(
      state.influenceBonus === 1
        ? t("influence.startingSingle")
        : t("influence.startingPlural", { count: state.influenceBonus }),
    );
  }
}

function setSheetImageSources(el) {
  if (!el) return;
  const standardSrc = sheetImageUrl();
  const highSrc = sheetImageUrl(2);
  el.src = standardSrc;
  if ("srcset" in el) {
    el.srcset = `${standardSrc} 1x, ${highSrc} 2x`;
  }
  if ("sizes" in el) {
    el.sizes = "100vw";
  }
}

function setAllSheetImageSources() {
  (sheetBaseImages && sheetBaseImages.length ? sheetBaseImages : [sheetBaseImage]).forEach((el) =>
    setSheetImageSources(el),
  );
}

function preloadSheet() {
  return new Promise((resolve) => {
    const imgEl = sheetBaseImage;
    if (imgEl) {
      const cleanup = () => {
        imgEl.onload = null;
        imgEl.onerror = null;
      };
      imgEl.onload = () => {
        cleanup();
        resolve(true);
      };
      imgEl.onerror = () => {
        cleanup();
        resolve(false);
      };
      setAllSheetImageSources();
      if (imgEl.complete) {
        cleanup();
        resolve(true);
        return;
      }
      return;
    }
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    setSheetImageSources(img);
  });
}

function sheetBasePathForLocale() {
  const locale = getLocale();
  const variant = activeChallenge()?.sheetVariant;
  if (variant) {
    const localizedSuffix = variant.locales?.[locale];
    if (localizedSuffix) return `${SHEET_BASE_PATH}-${localizedSuffix}`;
    if (!LOCALIZED_SHEET_LOCALES.has(locale)) return `${SHEET_BASE_PATH}-${variant.default}`;
  }
  if (LOCALIZED_SHEET_LOCALES.has(locale)) return `${SHEET_BASE_PATH}-${locale}`;
  return SHEET_BASE_PATH;
}

function sheetImageUrl(scale = 1) {
  const suffix = scale > 1 ? "@2x" : "";
  return new URL(`${sheetBasePathForLocale()}${suffix}.webp?v=${SHEET_VERSION}`, window.location.href).toString();
}

registerServiceWorker();

async function initializeApp() {
  try {
    // Run after the module has executed (DOM is already parsed by then, since this
    // is a deferred `type="module"` script), but explicit rather than relying on that.
    initI18n();
    applyStaticDom();

    // Wait for sheet to preload before continuing
    await preloadSheet();
    
    // Wait for fonts to load to prevent layout shifts
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    }
    
    // Initialize the game
    await init();

    // Scale the sheet crop windows to fit their rendered width
    initSheetWindows();

    // Initialize popovers for tooltips
    initPopovers();

    // Remove loading state only after everything is ready
    document.body.classList.remove("loading");
    if (loadingOverlay) loadingOverlay.remove();
  } catch (err) {
    console.error("Initialization failed:", err);
    // Show error to user
    if (loadingOverlay) {
      const loadingText = loadingOverlay.querySelector(".loading-text");
      if (loadingText) {
        loadingText.textContent = t("game.loadFailed");
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
    newGameBtn.onclick = () => openChallengePicker();
    newGameBtn.style.display = "none";
  }
  if (actionBannerEl) {
    actionBannerEl.addEventListener("click", (event) => {
      const btn = event.target.closest(".btn-inline-action");
      if (!btn) return;
      const target = document.getElementById(btn.dataset.target);
      if (target && !target.disabled) target.click();
    });
  }
  setupChallengePicker();
  if (logDrawerEl) {
    if (isCompactLayout()) {
      logDrawerEl.open = false;
    }
    logDrawerEl.addEventListener("toggle", () => {
      if (logDrawerEl.open) {
        unreadLogCount = 0;
        updateLogUnreadBadge();
      }
    });
  }
  if (fullscreenBtn) {
    fullscreenBtn.onclick = () => toggleFullscreen();
  }
  if (sfxToggleBtn) {
    sfxToggleBtn.onclick = () => toggleSfxEnabled();
    updateSfxToggleButton();
  }
  if (localeSelect) {
    populateLocaleSelect();
    localeSelect.onchange = (e) => applyLocaleChange(e.target.value);
  }
  if (challengePickerLocaleSelect) {
    populateLocaleSelect(challengePickerLocaleSelect);
    challengePickerLocaleSelect.onchange = (e) => applyLocaleChange(e.target.value);
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
  if (swapPairBtn) {
    swapPairBtn.onclick = () => toggleLockedPairChoice();
  }
  if (swapBtnWrap) {
    swapBtnWrap.style.display = "none";
  }
  if (confirmPlotBtn) {
    confirmPlotBtn.onclick = () => confirmPendingPlot();
    confirmPlotBtn.style.display = "none";
  }
  if (cancelPlotBtn) {
    cancelPlotBtn.onclick = () => cancelPendingPlot();
    cancelPlotBtn.style.display = "none";
  }
  if (influenceStepperMinus) {
    influenceStepperMinus.onclick = () => {
      const idx = influenceUiDieIndex();
      if (idx >= 0) adjustDieWithInfluence(idx, -1);
    };
  }
  if (influenceStepperPlus) {
    influenceStepperPlus.onclick = () => {
      const idx = influenceUiDieIndex();
      if (idx >= 0) adjustDieWithInfluence(idx, 1);
    };
  }
  if (influenceStepperReset) {
    influenceStepperReset.onclick = () => {
      const idx = influenceUiDieIndex();
      if (idx >= 0) resetDieInfluence(idx);
    };
  }
}

// ============================================================================
// GAME LOGIC - Turn flow, dice rolling, building, and scoring
// ============================================================================

let rollingInProgress = false;

// Guided scrolling (see app/scroll-guide.js): tracks the last step we auto-scrolled for so
// re-renders of the same step don't keep yanking the viewport. Reset whenever a new roll
// starts a fresh turn.
let lastGuidedStep = null;

// UI-only selection of which die the influence stepper targets. This is distinct from
// state.influenceTarget (which has rule meaning for location-pair rescue) and never
// persists past a reroll or new game.
let influenceUiDie = null;

function guideToStep(stepKey, elGetter, options) {
  if (!stepKey || stepKey === lastGuidedStep) return;
  lastGuidedStep = stepKey;
  guideTo(elGetter(), options);
}

function rollDice() {
  if (rollingInProgress) {
    return;
  }
  rollingInProgress = true;
  lastGuidedStep = null;
  influenceUiDie = null;
  clearPendingPlot();

  try {
    if (state.activationMode) return;
    if (state.pendingCenterBuilding?.active) return;
    if (state.pendingBarricade?.active) return;
    if (!debugMode && !state.rollAvailable) {
      log(t("turn.rollAlreadyUsed"));
      return;
    }
  const n1 = rollNumberedDie("N1");
  const n2 = rollNumberedDie("N2");
  const x1 = rollXDie("X1");
  const x2 = rollXDie("X2");
  const dice = [n1, n2, x1, x2];
  const needsDoubleReroll = shouldRerollDoubleWindrose(dice);
  const turnIndexOverride = typeof state.pendingTurnIndex === "number" ? state.pendingTurnIndex : null;
  const baseActiveTurn = typeof state.pendingActiveTurn === "boolean" ? state.pendingActiveTurn : null;
  const activeTurnOverride = baseActiveTurn;

  state.bannerOverride = null;
  if (!needsDoubleReroll) {
    triggerDiceAnimation();
    const allowDebugBypass = debugMode;
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
  state.pendingTurnIndex = null;
  state.pendingActiveTurn = null;
  const rollMsg = t("turn.rolled", { dice: describeDice(dice) });
  if (Array.isArray(messages) && messages.length) {
    const status = messages[0]?.kind === "status" ? messages[0].text : null;
    let extras = status ? messages.slice(1) : messages.slice(); // windrose/pestilence/etc
    if (needsDoubleReroll) {
      extras = extras.filter((m) => m.kind !== "windrose");
    }
    if (status) log(status);
    log(rollMsg); // mid-layer
    extras.forEach((m) => log(m.text)); // newest
  } else {
    log(rollMsg);
  }
  if (needsDoubleReroll) {
    const msg = t("turn.doubleWindroseRolled");
    log(msg);
    state.bannerOverride = t("turn.doubleWindroseRolledBanner", { rollBtn: formatButtonLabelHtml(t("html.rollDice"), "rollBtn") });
    updateActionBanner();
    state.pendingTurnIndex = state.turnIndex;
    state.pendingActiveTurn = state.activeTurn;
    prepareNextRoll();
    renderSelectionDice([], []);
    return;
  }
  if (state.pestilence) {
    if (turnHintEl) setTurnHint(t("pestilence.forfeitEmptyPlot"));
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
    state.forceForfeit = true;
    state.forceForfeitAdvisory = false;
    state.diceLocked = true;
    guideToStep("pestilence-forfeit", () => document.querySelector(".sheet-window-board") || document.querySelector(".board"));
  } else if (turnHintEl) {
    setTurnHint(state.activeTurn ? "" : nonActiveAutoHintText());
  }
  updateTurnStatusChip();
  updateDiceAssignments();
  renderDice();
  updateActionBanner();
  } finally {
    rollingInProgress = false;
  }
}

function buildingDisplayLetter(code) {
  const name = t(`buildings.${code}`);
  return typeof name === "string" && name.length ? name[0].toUpperCase() : code;
}

function guildDisplayLabel(guildLabel) {
  const target = guildTargetFromLabel(guildLabel, activeChallenge()?.rules?.buildingOverrides);
  if (!target) return (guildLabel || "G").toUpperCase();
  return `${buildingDisplayLetter(target)}G`;
}

function formatDieLabelForLog(label) {
  if (typeof label !== "string" || !label.length) return label;
  if (label.startsWith("N")) return `${t("dice.windrosePrefix")}${label.slice(1)}`;
  if (label.startsWith("X")) return `${t("dice.eventPrefix")}${label.slice(1)}`;
  return label;
}

function describeDice(dice) {
  return dice
    .map((d) => {
      const label = formatDieLabelForLog(d.label || "");
      const face =
        d.face === "X"
          ? "X"
          : d.face === "windrose"
            ? t("dice.windroseFace")
            : d.face;
      return `${label}:${face}`;
    })
    .join(", ");
}

function formatDiceLabelsInMessage(message) {
  if (typeof message !== "string") return message;
  return message.replace(/\b([NX])(\d+)\b/g, (_, prefix, digits) => {
    if (prefix === "N") return `${t("dice.windrosePrefix")}${digits}`;
    if (prefix === "X") return `${t("dice.eventPrefix")}${digits}`;
    return `${prefix}${digits}`;
  });
}

function triggerDiceAnimation() {
  if (!diceView) return;
  playDiceSfx();
  const isTest = typeof window !== "undefined" && window.__RF_ENABLE_TEST_HOOKS__;
  const startDelay = isTest ? 0 : 500;

  // Set the "Rolling the dice" banner override immediately so it's already in place by
  // the time rollDice() calls updateActionBanner() at the end - otherwise the banner
  // briefly shows the next phase's hint (e.g. "Select a building...") until the delayed
  // animation start below catches up.
  const rollingMsg = t("turn.rollingDice");
  state.bannerOverride = rollingMsg;
  updateActionBanner();

  const startAnimation = () => {
    state.diceRolling = true;
    diceView.classList.add("dice-rolling");
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
    log(t("influence.numberedOnly"));
    return;
  }
  if (influenceTargetBlocked(die.label)) {
    log(t("influence.oneAdjustmentOnly"));
    return;
  }
  const base = typeof die.resolved === "number" ? die.resolved : null;
  if (base === null) {
    log(t("influence.cannotAdjustDie"));
    return;
  }
  const delta = influenceAdjustmentDelta(die.label);
  const nextDelta = delta + direction;
  if (nextDelta === delta) return;
  const target = base + nextDelta;
  if (target < DICE_MIN_VALUE || target > DICE_MAX_VALUE) {
    log(t("influence.outOfRange"));
    return;
  }
  const reducesMagnitude = Math.abs(nextDelta) < Math.abs(delta);
  if (!reducesMagnitude && influenceAvailable() <= 0) {
    log(t("influence.none"));
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
  influenceUiDie = die.label;
  state.influenceSelectionKey =
    state.locationSelection.length >= 1 ? canonicalSelectionKey(state.locationSelection) : null;
  log(t("influence.adjusted", { label: die.label, value: target }));
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
  log(t("influence.resetAdjustment", { label: die.label, value: base }));
  updateTracks();
  updateDiceAssignments();
  refreshDiceVisibility();
}

// Eligibility for showing the influence ± badge / being the stepper's target: same rules
// as canAdjustDieValue (at most one die adjusted, influence available, not pestilence/
// locked/activation), reused rather than duplicated.
function influenceBadgeEligible(die) {
  if (!isInfluenceEligibleDie(die)) return false;
  const canDecrease = canAdjustDieValue(die, -1);
  const canIncrease = canAdjustDieValue(die, 1);
  const hasAdjustment = influenceAdjustmentDelta(die.label) !== 0;
  return canDecrease || canIncrease || hasAdjustment;
}

function influenceUiDieIndex() {
  if (!influenceUiDie || !state.dice) return -1;
  return state.dice.findIndex((d) => d?.label === influenceUiDie);
}

// Resolves which die the stepper should target: a die with a nonzero adjustment wins,
// otherwise the current UI selection if still eligible, otherwise auto-select when exactly
// one die is eligible, otherwise none.
function resolveInfluenceUiDie() {
  if (!state.dice || !state.dice.length) return null;
  const adjustedLabel = Object.keys(state.influenceAdjustments || {}).find(
    (label) => influenceAdjustmentDelta(label) !== 0,
  );
  if (adjustedLabel && state.dice.some((d) => d?.label === adjustedLabel)) {
    return adjustedLabel;
  }
  if (influenceUiDie) {
    const current = state.dice.find((d) => d?.label === influenceUiDie);
    if (current && influenceBadgeEligible(current)) return influenceUiDie;
  }
  const eligible = state.dice.filter((d) => influenceBadgeEligible(d));
  if (eligible.length === 1) return eligible[0].label;
  return null;
}

function renderInfluenceStepper() {
  if (!influenceStepper) return;
  influenceUiDie = resolveInfluenceUiDie();
  const idx = influenceUiDieIndex();
  const die = idx >= 0 ? state.dice[idx] : null;
  if (!die) {
    influenceStepper.hidden = true;
    syncActionBarState();
    return;
  }
  influenceStepper.hidden = false;
  const base = typeof die.resolved === "number" ? die.resolved : null;
  const delta = influenceAdjustmentDelta(die.label);
  const adjustedDie = applyInfluenceToDie(state, die) || die;
  if (influenceStepperFace) {
    clearElement(influenceStepperFace);
    // Same die-type class as the dice row so pip/body colours resolve (cream X dice
    // have red pips via .die-special; without it the mini face renders blank).
    influenceStepperFace.classList.toggle("die-special", die.label[0] === "X");
    influenceStepperFace.classList.toggle("die-number", die.label[0] !== "X");
    influenceStepperFace.appendChild(createDieFaceSVG(adjustedDie, { showLabel: false }));
  }
  if (influenceStepperDieLabel) influenceStepperDieLabel.textContent = die.label;
  if (influenceStepperValue) {
    const adjusted = typeof adjustedDie.resolved === "number" ? adjustedDie.resolved : base;
    influenceStepperValue.textContent = delta !== 0 ? `${base} → ${adjusted}` : `${base}`;
  }
  if (influenceStepperMinus) influenceStepperMinus.disabled = !canAdjustDieValue(die, -1);
  if (influenceStepperPlus) influenceStepperPlus.disabled = !canAdjustDieValue(die, 1);
  if (influenceStepperReset) influenceStepperReset.hidden = delta === 0;
  syncActionBarState();
}

// ============================================================================
// RENDERING FUNCTIONS - UI rendering and DOM updates
// ============================================================================

function renderDice() {
  if (!diceView) return;
  refreshDiceVisibility();
  const awaitingRoll = state.rollAvailable && (!state.dice || state.dice.length === 0);
  if (state.activationMode || state.activationComplete || awaitingRoll) {
    if (influenceStepper) influenceStepper.hidden = true;
    syncActionBarState();
    return;
  }
  clearElement(diceView);
  // Resolve the influence target before building the badges, so the target ring is
  // drawn on the same die the stepper adjusts (e.g. after a reset re-targets).
  if (state.dice) influenceUiDie = resolveInfluenceUiDie();
  if (turnHintEl) {
    if (state.pestilence) {
      setTurnHint(t("pestilence.forfeitEmptyPlot"));
    } else if (state.activeTurn && state.invalidSelection) {
      setTurnHint(state.invalidSelectionMessage || t("location.noValidPlotsForPair"));
    } else if (state.forceForfeitAdvisory && !state.forceForfeit) {
      setTurnHint(t("location.noValidPairsSpendInfluence"));
    } else if (forceForfeitActive()) {
      setTurnHint(t("location.noValidPairsForfeit", { turn: state.turnIndex }));
    } else if (!state.activeTurn) {
      setTurnHint(nonActiveAutoHintText());
    } else {
      setTurnHint("");
    }
  }
  const field = document.createElement("div");
  field.className = "field dice-field";
  const row = document.createElement("div");
  row.className = "dice-row";
  const turnLocked = state.diceLocked || state.activationMode || state.pestilence || forceForfeitActive();
  if (turnLocked) row.classList.add("dice-locked");
  const hasInfluenceAdjustments = !influenceAdjustmentsEmpty();
  // During a forced forfeit, keep the stepper/± badges available if an influence
  // adjustment already exists so the player can undo (reset) the move that caused
  // the forced forfeit; selection/clicking stays locked as usual.
  // Like main's Pair & Build controls, influence is only offered once both location
  // dice are chosen (otherwise picking the 2nd die would wipe the adjustment); an
  // existing adjustment stays reachable so it can still be reset.
  const pairChosen = Array.isArray(state.locationSelection) && state.locationSelection.length === 2;
  const influenceLocked =
    state.diceLocked ||
    state.activationMode ||
    state.pestilence ||
    (forceForfeitActive() && !hasInfluenceAdjustments) ||
    (!pairChosen && !hasInfluenceAdjustments);
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
      allowInfluence: !influenceLocked,
      useAdjustedFace: !state.diceRolling,
    });
    row.appendChild(badge);
  });
  field.appendChild(row);
  diceView.appendChild(field);
  diceView.classList.toggle("dice-rolling", state.diceRolling);
  if (influenceLocked) {
    influenceUiDie = null;
    if (influenceStepper) influenceStepper.hidden = true;
  } else {
    renderInfluenceStepper();
  }
}

function fillBuildings(buildDice) {
  const hasLockedLocation = Array.isArray(state.lockedLocationDice) && state.lockedLocationDice.length === 2;
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
  const allowed = restrictBuildOptionsForBoard(
    buildingOptionsFromDice(adjustedBuildDice, BUILDING_RULES, activeChallenge()?.rules?.buildingOverrides),
    state.board,
    activeChallenge()?.rules?.disabledBuildings,
  );
  const availableGuildTypes = guildTypes.filter((gt) => !builtGuildTypes(state.board).has(gt));
  const options = allowed.filter((opt) => {
    if (opt.code !== "G") return true;
    return availableGuildTypes.length > 0;
  });
  if (!options.length && !state.forceForfeit && !state.pestilence) {
    if (!state.noBuildOptionsLogged) {
      log(t("build.noValidBuildingsForSplit"));
      state.noBuildOptionsLogged = true;
    }
    state.buildChoice = null;
    state.selectedGuildType = null;
    state.forceForfeit = true;
    lockDiceSnapshot(state, { uniqueLocationPairs });
    state.bannerOverride = t("build.noValidBuilds");
    updateActionBanner();
    renderSelectionDice(state.lockedLocationDice || [], state.lockedBuildDice || []);
    highlightLocations();
    renderBoard();
    guideToStep("forfeit", () => document.querySelector(".sheet-window-board") || document.querySelector(".board"));
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

// buildingHitboxes stacks two codes in the same sheet grid slot wherever a challenge's
// `rules.buildingOverrides` can swap one for the other (Cottage/Barracks, Windmill/Piscary):
// at most one of each pair is ever reachable in a given game, so only render the one that
// currently applies. This replaces the old "both rendered, the inactive one disabled" setup,
// which required `pointer-events: none` on disabled hits to stop them from swallowing
// hover/clicks meant for their sibling underneath.
const STACKED_BUILDING_SLOTS = [
  ["C", "B"],
  ["W", "P"],
];

function activeBuildingHitboxes() {
  const overrides = activeChallenge()?.rules?.buildingOverrides || {};
  const hidden = new Set();
  STACKED_BUILDING_SLOTS.forEach(([base, swapped]) => {
    hidden.add(overrides[base] === swapped ? base : swapped);
  });
  return buildingHitboxes.filter((hit) => !hidden.has(hit.code));
}

function renderBuildingOverlay(options = [], disabled = false) {
  const overlay = document.getElementById("buildingsOverlay");
  if (!overlay) return;
  const centerBuildingActive = state.pendingCenterBuilding?.active && !state.pendingCenterBuilding?.awaitingGuildType;
  if (centerBuildingActive) {
    const choices = state.pendingCenterBuilding.choices || ["T", ...guildTypes];
    options = [];
    if (choices.includes("T")) options.push({ code: "T" });
    if (choices.some((c) => guildTypes.includes(c))) options.push({ code: "G" });
  }
  const hasLockedLocation = Array.isArray(state.lockedLocationDice) && state.lockedLocationDice.length === 2;
  const diceLockedForBuild = state.diceLocked;
  const forceDisabled =
    !centerBuildingActive &&
    (disabled ||
      state.pendingBarricade?.active ||
      (!hasLockedLocation && state.locationSelection.length !== 2) ||
      diceLockedForBuild ||
      state.activationMode ||
      forceForfeitActive() ||
      state.forceForfeitAdvisory ||
      state.pestilence);
  const buildDice =
    hasLockedLocation && state.lockedBuildDice?.length === 2
      ? (lockedPairChoice().buildDice || state.lockedBuildDice)
      : state.buildDice;
  if ((!options || !options.length) && buildDice?.length && !forceDisabled) {
    const fallback = restrictBuildOptionsForBoard(
      buildingOptionsFromDice(buildDice, BUILDING_RULES, activeChallenge()?.rules?.buildingOverrides),
      state.board,
      activeChallenge()?.rules?.disabledBuildings,
    );
    options = fallback;
  }
  clearElement(overlay);
  const disableOverlay = forceDisabled || !options?.length;
  overlay.classList.toggle("disabled", disableOverlay);
  const optionMap = new Map(options.map((o) => [o.code, o]));
  activeBuildingHitboxes().forEach((hit) => {
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
    setPopover(div, buildingTooltip(hit.code, { context: "sheet", buildingOverrides: activeChallenge()?.rules?.buildingOverrides }), {
      tap: false,
    });
    div.addEventListener("click", (e) => {
      e.stopPropagation();
      if (div.classList.contains("disabled")) return;
      if (state.pendingCenterBuilding?.active) {
        handleCenterBuildingChoice(hit.code);
        return;
      }
      const hasLockedLocation = Array.isArray(state.lockedLocationDice) && state.lockedLocationDice.length === 2;
      const diceLockedForBuild = state.diceLocked;
      if ((!hasLockedLocation && state.locationSelection.length !== 2) || diceLockedForBuild) return;
      document.querySelectorAll(".building-hit.selected").forEach((el) => el.classList.remove("selected"));
      div.classList.add("selected");
      handleBuildingChoice();
      renderSelectionDice();
    });
    div.setAttribute(
      "aria-label",
      `${hit.code}${opt?.sourceLabel ? t("build.viaSource", { source: opt.sourceLabel }) : ""}`,
    );
    overlay.appendChild(div);
  });
  renderBuildingPicker();
}

/**
 * Mirrors the Buildings sheet overlay (and, when relevant, the guild overlay)
 * as touch-sized buttons in the sticky action bar for narrow screens. Reuses
 * the overlay's own DOM state (`.building-hit.available/.selected`,
 * `.guild-hit.available/.selected`) rather than recomputing the rules, and
 * delegates clicks to the matching hitbox so behavior stays identical.
 */
function renderBuildingPicker() {
  const picker = document.getElementById("buildingPicker");
  if (!picker) return;
  const overlay = document.getElementById("buildingsOverlay");
  const availableHits = overlay ? Array.from(overlay.querySelectorAll(".building-hit.available")) : [];
  const guildOverlayEl = document.getElementById("guildsOverlay");
  const guildHitsAvailable = guildOverlayEl ? Array.from(guildOverlayEl.querySelectorAll(".guild-hit.available")) : [];
  const awaitingCenterGuildType = Boolean(state.pendingCenterBuilding?.awaitingGuildType);
  clearElement(picker);
  if (!availableHits.length && !(awaitingCenterGuildType && guildHitsAvailable.length)) {
    picker.hidden = true;
    syncActionBarState();
    return;
  }
  picker.hidden = false;
  availableHits.forEach((hit) => {
    const code = hit.dataset.code;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "building-pick";
    btn.dataset.code = code;
    if (hit.dataset.source) btn.dataset.source = hit.dataset.source;
    if (hit.dataset.pop) btn.dataset.pop = hit.dataset.pop;
    const selected = hit.classList.contains("selected");
    btn.classList.toggle("selected", selected);
    btn.setAttribute("aria-pressed", selected ? "true" : "false");
    const label = t(`buildings.${code}`);
    if (hit.dataset.pop) {
      const pop = document.createElement("span");
      pop.className = "building-pick-pop";
      pop.textContent = `+${hit.dataset.pop}`;
      btn.append(label + " ", pop);
    } else {
      btn.textContent = label;
    }
    btn.addEventListener("click", () => hit.click());
    picker.appendChild(btn);
  });
  if (state.buildChoice?.code === "G" || awaitingCenterGuildType) {
    const guildHits = guildHitsAvailable;
    guildHits.forEach((hit) => {
      const code = hit.dataset.code;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "building-pick";
      btn.dataset.code = code;
      const selected = hit.classList.contains("selected");
      btn.classList.toggle("selected", selected);
      btn.setAttribute("aria-pressed", selected ? "true" : "false");
      btn.textContent = t(`buildings.${code}`);
      btn.addEventListener("click", () => hit.click());
      picker.appendChild(btn);
    });
  }
  syncActionBarState();
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
  // Dims other highlighted candidates while a plot/forfeit placement is pending
  // confirm (see #board.has-pending in styles.css); JS-managed rather than
  // :has(.cell-pending), which WebKit doesn't reliably re-evaluate on touch.
  const pendingKind = state.pendingPlot?.kind;
  if (boardEl) {
    boardEl.classList.toggle("has-pending", pendingKind === "build" || pendingKind === "forfeit");
  }
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
        forfeiture.alt = t("forfeit.forfeitedAlt");
        forfeiture.className = "forfeit-icon";
        cell.appendChild(forfeiture);
      } else if (data.building) {
        cell.classList.remove("terrain");
        const label = document.createElement("div");
        label.className = "label building";
        label.textContent =
          data.building === "G" ? guildDisplayLabel(data.buildingLabel) : buildingDisplayLetter(data.building);
        cell.appendChild(label);
        if (data.activationForfeit) {
          cell.classList.add("forfeit");
          cell.classList.add("disabled");
        }
        // Add market hover to highlight claimed nodes
        if (data.building === "M") {
          cell._hoverDispose = onMouseHover(
            cell,
            () => highlightMarketClaims(r, c),
            () => clearMarketHighlights()
          );
        }
        if (state.activationMode && state.activationSelection.building?.[0] === r && state.activationSelection.building?.[1] === c) {
          cell.classList.add("selected-building");
        }
        const req = Math.max(
          0,
          (BUILDING_RULES[data.building]?.requirement || 0) - (Number(data.springBoost) || 0),
        );
        const filled = Math.max(0, state.workerAllocations?.[r]?.[c] || 0);
        setPopover(
          cell,
          buildingTooltip(data.building, {
            context: "board",
            guildLabel: data.building === "G" ? data.buildingLabel : undefined,
            springBoost: data.springBoost,
            filled: state.activationMode ? filled : undefined,
            buildingOverrides: activeChallenge()?.rules?.buildingOverrides,
          }),
          { tap: false },
        );
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
              activeChallenge()?.rules?.buildingOverrides,
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
        const pending = state.pendingPlot;
        if (pending && (pending.kind === "build" || pending.kind === "forfeit") && pending.r === r && pending.c === c) {
          cell.classList.add("cell-pending");
          if (pending.kind === "build") {
            const label = document.createElement("div");
            label.className = "label building building-preview";
            label.textContent = buildingDisplayLetter(pending.code);
            cell.appendChild(label);
          }
        }
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
  const phase = currentTurnPhase();
  if (state.locationSelection.length < 2 && !hasLockedLocation && !state.pestilence && !forceForfeitActive() && !state.activationMode) {
    log(t("build.splitFirst"));
    flashHint(t("build.splitFirst"));
    return;
  }
  if (state.pendingPopulation?.remaining > 0) {
    log(t("population.placePendingFirst"));
    flashHint(t("population.placePendingFirst"));
    return;
  }
  if (state.activationMode) {
    const popSel = state.activationSelection.pop;
    if (!popSel) {
      log(t("population.selectNodeFirst"));
      flashHint(t("population.selectNodeFirst"));
      return;
    }
    allocateWorkersFromPop(popSel, [r, c]);
    return;
  }
  if (state.pendingSpringhouseTarget) {
    const { options } = state.pendingSpringhouseTarget;
    const isOption = options.some(([or, oc]) => or === r && oc === c);
    if (!isOption) {
      log(t("springhouse.chooseAdjacentBeforeBuilding"));
    flashHint(t("springhouse.chooseAdjacentBeforeBuilding"));
      return;
    }
    applySpringhouseTarget([r, c]);
    return;
  }
  if (isPestilenceOrForfeit) {
    const cell = state.board[r][c];
    if (cell.building || cell.forfeited) {
      log(t("forfeit.chooseEmptyPlot"));
    flashHint(t("forfeit.chooseEmptyPlot"));
      return;
    }
    commitOrPendPlot(r, c, "forfeit");
    return;
  }
  if (state.locationSelection.length !== 2 || !state.locationPairs.length) {
    log(t("location.selectTwoDice"));
    return;
  }
  const locPairs =
    Array.isArray(state.lockedLocationDice) && state.lockedLocationDice.length === 2
      ? effectiveLockedLocationPairs()
      : state.locationPairs;
  if (!locPairs?.length) {
    log(t("location.selectTwoDice"));
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
    log(t("location.cellMismatch"));
    return;
  }
  if (!state.buildChoice) {
    log(t("build.chooseBuildingFirst"));
    return;
  }
  if (phase !== TURN_PHASE.BUILDING && phase !== TURN_PHASE.SPLITTING) {
    log(t("build.finishStepBeforeBuilding"));
    return;
  }
  commitOrPendPlot(r, c, "build", state.buildChoice.code);
}

/**
 * Shared commit path for plot taps that place a building or forfeit a cell.
 * On coarse pointers (needsConfirmStep()) this only sets a preview and shows
 * Confirm/Change plot controls; the actual placeBuilding()/forfeitCell() call
 * happens from confirmPendingPlot(). On mouse devices it commits immediately,
 * matching the original one-click behavior exactly.
 */
function commitOrPendPlot(r, c, kind, code) {
  if (needsConfirmStep()) {
    state.pendingPlot = { r, c, kind, code };
    renderBoard();
    updateActionBanner();
    showPlotConfirmControls();
    return;
  }
  if (kind === "build") {
    placeBuilding(r, c, code);
  } else if (kind === "forfeit") {
    forfeitCell(r, c);
  }
}

/**
 * Clears any pending plot/forfeit/population preview and hides the
 * Confirm/Change plot controls. Called whenever the player changes dice
 * selection, building choice, swaps pairs, applies influence, or rolls again.
 */
function clearPendingPlot() {
  if (!state.pendingPlot) return;
  state.pendingPlot = null;
  hidePlotConfirmControls();
  renderBoard();
}

function pendingPlotBannerText(pending) {
  const row = pending.r + 1;
  const col = pending.c + 1;
  if (pending.kind === "build") {
    return t("confirm.pendingBuild", { building: t(`buildings.${pending.code}`), row, col });
  }
  if (pending.kind === "forfeit") {
    return t("confirm.pendingForfeit", { row, col });
  }
  return t("confirm.pendingPopulation", { row, col });
}

// Tracks the exact banner text the confirm-step prompt set, so hidePlotConfirmControls()
// only clears state.bannerOverride if nothing else has since overwritten it, and the
// override that was in place before the prompt ran (e.g. 'build.noValidBuilds'), so hiding
// the prompt restores it instead of losing it.
let confirmPromptBannerText = null;
let previousBannerOverride = null;

function showPlotConfirmControls() {
  if (!state.pendingPlot) return hidePlotConfirmControls();
  if (confirmPlotBtn) confirmPlotBtn.style.display = "inline-block";
  if (cancelPlotBtn) {
    cancelPlotBtn.style.display = "inline-block";
    cancelPlotBtn.textContent =
      state.pendingPlot.kind === "population" ? t("confirm.changeSquare") : t("confirm.changePlot");
  }
  const text = pendingPlotBannerText(state.pendingPlot);
  // Only capture the "previous" override the first time the prompt shows (i.e. it
  // isn't already showing its own text), so repeated re-renders of the same prompt
  // don't clobber the saved value with the prompt's own text.
  if (state.bannerOverride !== confirmPromptBannerText) {
    previousBannerOverride = state.bannerOverride ?? null;
  }
  state.bannerOverride = text;
  confirmPromptBannerText = text;
  updateActionBanner();
  syncActionBarState();
}

function hidePlotConfirmControls() {
  if (confirmPlotBtn) confirmPlotBtn.style.display = "none";
  if (cancelPlotBtn) cancelPlotBtn.style.display = "none";
  if (confirmPromptBannerText && state.bannerOverride === confirmPromptBannerText) {
    state.bannerOverride = previousBannerOverride;
  }
  confirmPromptBannerText = null;
  previousBannerOverride = null;
  syncActionBarState();
}

function confirmPendingPlot() {
  const pending = state.pendingPlot;
  if (!pending) return;
  state.pendingPlot = null;
  hidePlotConfirmControls();
  if (pending.kind === "build") {
    placeBuilding(pending.r, pending.c, pending.code);
  } else if (pending.kind === "forfeit") {
    forfeitCell(pending.r, pending.c);
  } else if (pending.kind === "population") {
    doPlacePopulationNode(pending.r, pending.c);
  }
}

function cancelPendingPlot() {
  if (!state.pendingPlot) return;
  state.pendingPlot = null;
  hidePlotConfirmControls();
  renderBoard();
  updateActionBanner();
}

function highlightLocations() {
  forEachCell((cell) => {
    cell.classList.remove("highlight", "disabled");
    const oct = cell.querySelector(".octagon");
    if (oct) oct.remove();
  });
  if (state.pendingCenterBuilding?.active) {
    const centerRow = Math.floor(BOARD_SIZE / 2);
    const centerCol = Math.floor(BOARD_SIZE / 2);
    forEachCell((cell) => {
      const r = parseInt(cell.dataset.row, 10);
      const c = parseInt(cell.dataset.col, 10);
      if (r === centerRow && c === centerCol) {
        cell.classList.add("highlight");
        cell.appendChild(createOctagon());
      } else {
        cell.classList.add("disabled");
      }
    });
    return;
  }
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
        } else {
          cell.classList.add("disabled");
        }
        // Merge the building-info tooltip renderBoard() already set on this cell with
        // activation-mode's filled/required (and, if applicable, forfeited) detail, rather
        // than overwriting it with workers-only text.
        if (data.building && !data.forfeited) {
          let tooltip = buildingTooltip(data.building, {
            context: "board",
            guildLabel: data.building === "G" ? data.buildingLabel : undefined,
            springBoost: data.springBoost,
            filled,
            buildingOverrides: activeChallenge()?.rules?.buildingOverrides,
          });
          if (data.activationForfeit) {
            tooltip = `${tooltip}\n${t("build.workersForfeitedTitle", { filled, req })}`;
          }
          setPopover(cell, tooltip, { tap: false });
        }
        if ((req === 0 && data.building) || filled >= req) {
          cell.classList.add("activated-building");
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
  const lockedAgainstPlacement = state.pestilence || (state.diceLocked);
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
    Array.isArray(state.lockedLocationDice) && state.lockedLocationDice.length === 2;
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

function markAdvancedBuiltIfNeeded(code) {
  if (BUILDING_RULES[code]?.category === "advanced") {
    state.turnFlags.advancedBuiltThisTurn = true;
  }
}

function placeBuilding(r, c, code) {
  const cell = state.board[r][c];
  if (cell.building || cell.forfeited) {
    log(t("build.cellOccupiedOrForfeited"));
    return;
  }
  const advancedLimit = new Set(["T", "U", "A"]);
  if (advancedLimit.has(code)) {
    const exists = state.board.flat().some((b) => b.building === code);
    if (exists) {
      log(t("build.advancedAlreadyBuilt"));
      return;
    }
  }
  if (code === "G") {
    if (!state.selectedGuildType) {
      log(t("build.selectGuildTypeFirst"));
      return;
    }
    const guildCount = countGuilds(state.board);
    if (guildCount >= 2) {
      log(t("build.maxGuildsBuilt"));
      return;
    }
    const available = guildTypes.filter((gt) => !builtGuildTypes(state.board).has(gt));
    if (!available.length) {
      log(t("build.noGuildTypesAvailable"));
      return;
    }
  }
  let buildingLabel = code;
  if (code === "G") {
    const selection = state.selectedGuildType || guildTypes.find((gt) => !builtGuildTypes(state.board).has(gt)) || "GF";
    const normalized = selection.toUpperCase().trim();
    const valid = ["GF", "GQ", "GW", "GM"];
    buildingLabel = valid.includes(normalized) ? normalized : "G";
  }
  cell.building = code;
  cell.buildingLabel = buildingLabel;
  markAdvancedBuiltIfNeeded(code);
  playSfx();
  if (code === "C") {
    const previousHousing = state.tracks.housing;
    state.tracks.housing += 4;
    if (state.tracks.housing > previousHousing) {
      playSfx();
    }
  }
  const buildPool =
    Array.isArray(state.lockedBuildDice) && state.lockedBuildDice.length === 2 ? state.lockedBuildDice : state.buildDice;
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
  const displayLabel = code === "G" ? guildDisplayLabel(buildingLabel) : buildingDisplayLetter(code);
  log(t("build.placed", { label: displayLabel, row: r + 1, col: c + 1 }));
  state.splitUsedForBuild = true;
  updateDiceAssignments();
  updateSwapButton();
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
    log(t("springhouse.noAdjacentBuildings"));
    return "none";
  }
  state.pendingSpringhouseTarget = { source: [r, c], options };
  renderBoard();
  log(t("springhouse.chooseAdjacentToReduce"));
  return "pending";
}

function applySpringhouseBoost(target) {
  const [tr, tc] = target;
  const targetCell = state.board[tr][tc];
  if (!targetCell.building || targetCell.forfeited) {
    log(t("springhouse.selectBuiltNonForfeited"));
    return;
  }
  const rule = BUILDING_RULES[targetCell.building];
  const maxBoost = Math.max(0, rule?.requirement || 0);
  const nextBoost = Math.min(maxBoost, (Number(targetCell.springBoost) || 0) + 1);
  targetCell.springBoost = nextBoost;
  log(t("springhouse.reduced", { row: tr + 1, col: tc + 1 }));
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
    log(t("build.cellOccupiedOrForfeited"));
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
  const context = state.pestilence ? t("forfeit.duringPestilence") : "";
  log(t("forfeit.forfeitedCell", { row: r + 1, col: c + 1, context }));
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
    buildingOverrides: activeChallenge()?.rules?.buildingOverrides,
  });
  if (influence?.gained > 0) {
    log(
      influence.gained === 1
        ? t("population.milestoneSingle")
        : t("population.milestonePlural", { count: influence.gained }),
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
  // Refresh the live challenge progress badge here too, not just from updateTurnStatusChip():
  // flows like worker allocation call updateTracks() without touching the turn chip, and the
  // badge should stay live wherever scoring-affecting board state changes.
  updateChallengeProgressBadge();
}

let unreadLogCount = 0;

function updateLogUnreadBadge() {
  if (!logUnreadBadge) return;
  if (unreadLogCount > 0) {
    logUnreadBadge.textContent = String(unreadLogCount);
    logUnreadBadge.classList.remove("hidden");
  } else {
    logUnreadBadge.textContent = "";
    logUnreadBadge.classList.add("hidden");
  }
}

function log(msg) {
  const formatted = formatDiceLabelsInMessage(msg);
  state.log.unshift(formatted);
  if (logEl) {
    logEl.innerHTML = state.log.map((m) => `<li>${m}</li>`).join("");
  }
  if (logDrawerEl && !logDrawerEl.open) {
    unreadLogCount += 1;
    updateLogUnreadBadge();
  }
}

// Tally Unrest for the just-completed turn here, the moment the turn is actually done -
// whether the game continues to the next roll or moves into the final activation phase -
// rather than deferring it to the next Roll Dice click (which wouldn't run at all on the
// game's final turn, and which the solo build flow often skips entirely via
// maybeRollAfterLock()). Returns true if a Barricade was triggered, meaning the caller must
// stop and let the player resolve it; onPopulationNodeClick() re-calls the turn-advance path
// once it's resolved, at which point this is skipped (same turnIndex already checked).
function tallyUnrestForCompletedTurnIfNeeded() {
  if (!(state.unrestTracking && state.turnIndex > 0 && state.unrestCheckedTurnIndex !== state.turnIndex)) {
    return false;
  }
  state.unrestCheckedTurnIndex = state.turnIndex;
  const unrestOutcome = tallyUnrestAndCheckBarricade(state, state.board);
  unrestOutcome.messages.forEach((m) => log(m.text));
  if (unrestOutcome.messages.length) {
    updateTracks();
    updateUnrestBadge();
  }
  if (unrestOutcome.triggered) {
    renderPopulationNodes();
    showBarricadeAlert();
    updateActionBanner();
    return true;
  }
  return false;
}

function autoAdvance() {
  const { action, message } = autoAdvanceState(state, state.board);
  if (action === "wait") return;

  if (tallyUnrestForCompletedTurnIfNeeded()) return;

  if (action === "activate") {
    if (message) log(message);
    enterActivationMode();
    return;
  }
  if (action === "roll") {
    prepareNextRoll();
    state.bannerOverride = state.pestilence
      ? t("hints.pressRollAfterPestilence", { rollBtn: formatButtonLabelHtml(t("html.rollDice"), "rollBtn") })
      : null;
    updateActionBanner();
  }
}

function enterActivationMode() {
  if (state.activationMode) return;
  // Advance turn track for the final turn when entering activation
  advanceTurnTrack();
  startActivationState(state);
  autoForfeitUnfillable(false);
  if (finishActivationBtn) finishActivationBtn.style.display = "block";
  renderBuildingOverlay([], true);
  renderGuildOverlay([]);
  renderBoard();
  highlightLocations();
  refreshDiceVisibility();
  log(t("activation.phaseHint"));
  updateActionBanner();
}

function finishActivation() {
  if (!state.activationMode) return;
  autoForfeitUnfillable(true);
  finishActivationState(state);
  const scoreResult = currentScore({ allowPopulationActivation: true });
  state.finalScore = scoreResult.total;
  state.activationSelection = { pop: null };
  if (finishActivationBtn) finishActivationBtn.style.display = "none";
  if (newGameBtn) newGameBtn.style.display = "inline-block";
  renderBoard();
  highlightLocations();
  refreshDiceVisibility();
  updateTracks();
  log(t("activation.finished"));
  log(t("game.endScore", { score: state.finalScore }));
  logChallengeOutcome(scoreResult);
  updateActionBanner();
  updateTurnStatusChip();
}

function logChallengeOutcome(scoreResult) {
  const challenge = activeChallenge();
  if (!challenge) return;
  const outcome = challenge.victory(scoreResult, state);
  const name = formatChallengeNameHtml(t(challenge.nameKey));
  const outcomeText = t(outcome.passed ? "challenges.result.passed" : "challenges.result.failed", { name });
  log(outcomeText);
  outcome.reasons.forEach((reason) => {
    if (!reason.ok) log(t(reason.textKey, reason.params));
  });
  showChallengeOutcomeOverlay(scoreResult, outcome, outcomeText);
}

function showChallengeOutcomeOverlay(scoreResult, outcome, outcomeText) {
  if (!challengeOutcomeOverlay || !challengeOutcomeText) return;
  challengeOutcomeText.innerHTML = outcomeText;
  if (challengeOutcomeComparison) {
    challengeOutcomeComparison.textContent = t("challenges.result.scoreComparison", { score: scoreResult.total });
  }
  if (challengeOutcomeReasons) {
    clearElement(challengeOutcomeReasons);
    outcome.reasons.forEach((reason) => {
      const li = document.createElement("li");
      li.textContent = `${reason.ok ? "✓" : "✗"} ${t(reason.textKey, reason.params)}`;
      li.classList.toggle("challenge-outcome-reason-ok", reason.ok);
      li.classList.toggle("challenge-outcome-reason-fail", !reason.ok);
      challengeOutcomeReasons.appendChild(li);
    });
  }
  challengeOutcomeOverlay.hidden = false;
}

function hideChallengeOutcomeOverlay() {
  if (!challengeOutcomeOverlay) return;
  challengeOutcomeOverlay.hidden = true;
}

let barricadeAlertTimeout = null;

// Briefly flashes a "Barricades raised!" banner (styled like the challenge outcome
// summary) when Barricades trigger, auto-dismissing after ~4s. Distinct from the
// permanent log line, which stays in the log for reference.
function showBarricadeAlert() {
  if (!barricadeAlertOverlay || !barricadeAlertText) return;
  barricadeAlertText.textContent = t("challenges.barricadesRaised");
  barricadeAlertOverlay.hidden = false;
  clearTimeout(barricadeAlertTimeout);
  barricadeAlertTimeout = setTimeout(() => {
    barricadeAlertOverlay.hidden = true;
  }, 4000);
}

// Places the Social Contract forced center-plot building once chosen live on the board
// (Townhall, or a Guild of the chosen subtype), clears the pending-choice gate, and logs it.
function placeCenterBuilding(code, guildType) {
  const centerRow = Math.floor(BOARD_SIZE / 2);
  const centerCol = Math.floor(BOARD_SIZE / 2);
  state.board[centerRow][centerCol] = { building: code, buildingLabel: guildType, forfeited: false, springBoost: 0 };
  markAdvancedBuiltIfNeeded(code);
  log(t("challenges.socialContract.centerBuildingLog", { building: centerBuildingLabel(code === "T" ? "T" : guildType) }));
  state.pendingCenterBuilding = null;
  renderBuildingOverlay([], true);
  renderGuildOverlay([]);
  renderBoard();
  updateTracks();
  refreshDiceVisibility();
  updateActionBanner();
}

function handleCenterBuildingChoice(code) {
  if (code === "T") {
    placeCenterBuilding("T", null);
    return;
  }
  if (code === "G") {
    state.pendingCenterBuilding.awaitingGuildType = true;
    const choices = state.pendingCenterBuilding.choices || ["T", ...guildTypes];
    const allowedGuildTypes = guildTypes.filter((gt) => choices.includes(gt));
    renderBuildingOverlay([], true);
    renderGuildOverlay(allowedGuildTypes);
    updateActionBanner();
  }
}

function newGame(challengeId = null) {
  hasStartedAnyGame = true;
  influenceUiDie = null;
  hideChallengeOutcomeOverlay();
  clearTimeout(barricadeAlertTimeout);
  if (barricadeAlertOverlay) barricadeAlertOverlay.hidden = true;
  resetState(challengeId);
  setAllSheetImageSources();
  renderBoard();
  prepareNextRoll();
  renderSelectionDice([], []);
  updateTracks();
  renderBuildingOverlay();
  renderGuildOverlay([]);
  state.pendingTurnIndex = null;
  state.pendingActiveTurn = null;
  state.deferStatusAppend = false;
  state.bannerOverride = null;
  if (turnHintEl) setTurnHint("");
  updateActionBanner();
  if (newGameBtn) newGameBtn.style.display = "none";
  refreshDiceVisibility();
  updateActiveChallengeBadge();
}

let pickedChallengeId = null;
let hasStartedAnyGame = false;

function setupChallengePicker() {
  if (challengeConfirmBtn) {
    challengeConfirmBtn.onclick = () => {
      closeChallengePicker();
      newGame(pickedChallengeId);
    };
  }
  if (challengeCancelBtn) {
    challengeCancelBtn.onclick = () => closeChallengePicker();
  }
  if (challengeCarouselPrev) {
    challengeCarouselPrev.onclick = () => scrollChallengeCarousel(-1);
  }
  if (challengeCarouselNext) {
    challengeCarouselNext.onclick = () => scrollChallengeCarousel(1);
  }
  if (challengeCardsEl) {
    let scrollRaf = null;
    let scrollSettleTimer = null;
    challengeCardsEl.addEventListener("scroll", () => {
      if (scrollRaf) return;
      scrollRaf = requestAnimationFrame(() => {
        scrollRaf = null;
        updateChallengeCarouselDots();
      });
      if (scrollSettleTimer) clearTimeout(scrollSettleTimer);
      scrollSettleTimer = setTimeout(() => {
        scrollSettleTimer = null;
        selectCenteredChallengeCardOnSmallScreens();
      }, 120);
    });
  }
  document.addEventListener("keydown", (e) => {
    if (!challengePickerEl || challengePickerEl.hidden) return;
    if (e.key === "ArrowRight") scrollChallengeCarousel(1);
    else if (e.key === "ArrowLeft") scrollChallengeCarousel(-1);
    else if (e.key === "Escape" && hasStartedAnyGame) closeChallengePicker();
  });
  if (challengeOutcomeOverlay) {
    challengeOutcomeOverlay.onclick = (e) => {
      if (e.target === challengeOutcomeOverlay) hideChallengeOutcomeOverlay();
    };
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !challengeOutcomeOverlay.hidden) hideChallengeOutcomeOverlay();
    });
  }
  if (activeChallengeBadge) {
    activeChallengeBadge.onclick = () => openChallengeInfoModal();
  }
  if (challengeInfoCloseBtn) {
    challengeInfoCloseBtn.onclick = () => closeChallengeInfoModal();
  }
  if (challengeInfoModal) {
    challengeInfoModal.onclick = (e) => {
      if (e.target === challengeInfoModal) closeChallengeInfoModal();
    };
  }
}

function openChallengeInfoModal() {
  const challenge = activeChallenge();
  if (!challenge || !challengeInfoModal) return;
  if (challengeInfoTitle) challengeInfoTitle.innerHTML = formatChallengeNameHtml(t(challenge.nameKey));
  if (challengeInfoDifficulty) {
    clearElement(challengeInfoDifficulty);
    appendDifficultyDots(challengeInfoDifficulty, challenge.difficulty);
  }
  if (challengeInfoDescription) challengeInfoDescription.textContent = t(challenge.descKey);
  if (challengeInfoVictory) {
    clearElement(challengeInfoVictory);
    appendChallengeCardSection(challengeInfoVictory, "challenges.picker.victoryLabel", challenge.victoryKeys);
  }
  if (challengeInfoRules) {
    clearElement(challengeInfoRules);
    appendChallengeCardSection(challengeInfoRules, "challenges.picker.rulesLabel", challenge.ruleKeys);
  }
  if (challengeInfoSetup) {
    clearElement(challengeInfoSetup);
    appendChallengeCardSection(challengeInfoSetup, "challenges.picker.setupLabel", challenge.setupKeys);
  }
  challengeInfoModal.hidden = false;
}

function closeChallengeInfoModal() {
  if (challengeInfoModal) challengeInfoModal.hidden = true;
}

function updateActiveChallengeBadge() {
  if (!activeChallengeBadge) return;
  const challenge = activeChallenge();
  if (!challenge) {
    activeChallengeBadge.classList.add("hidden");
    activeChallengeBadge.setAttribute("aria-hidden", "true");
    return;
  }
  const label = t(challenge.nameKey);
  const tooltip = t("challenges.picker.badgeTooltip");
  activeChallengeBadge.innerHTML = formatChallengeNameHtml(label) + CHALLENGE_INFO_ICON_HTML;
  activeChallengeBadge.setAttribute("aria-label", `${label} — ${tooltip}`);
  activeChallengeBadge.title = tooltip;
  activeChallengeBadge.classList.remove("hidden");
  activeChallengeBadge.removeAttribute("aria-hidden");
}

let cachedCarouselCardStep = null;
if (typeof window !== "undefined") {
  window.addEventListener("resize", () => {
    cachedCarouselCardStep = null;
  });
}

// The building picker's visibility in the aux drawer depends on isCompactLayout()
// (desktop never shows it even when populated), so crossing the 1100px breakpoint
// (e.g. rotating a tablet) must re-sync the drawer's open/closed state.
if (typeof window !== "undefined" && window.matchMedia) {
  const compactLayoutQuery = window.matchMedia("(max-width: 1100px)");
  const onCompactLayoutChange = () => {
    renderBuildingPicker();
    syncActionBarState();
  };
  if (typeof compactLayoutQuery.addEventListener === "function") {
    compactLayoutQuery.addEventListener("change", onCompactLayoutChange);
  } else if (typeof compactLayoutQuery.addListener === "function") {
    compactLayoutQuery.addListener(onCompactLayoutChange);
  }
}

// Cached to avoid forcing a layout (getBoundingClientRect) on every scroll-throttled
// animation frame while the picker carousel is being dragged/scrolled - the card width only
// changes on a window resize, which invalidates the cache above.
function carouselCardStep() {
  if (cachedCarouselCardStep !== null) return cachedCarouselCardStep;
  const card = challengeCardsEl?.querySelector(".challenge-card");
  cachedCarouselCardStep = card ? card.getBoundingClientRect().width + 14 : 264;
  return cachedCarouselCardStep;
}

function scrollChallengeCarousel(direction) {
  if (!challengeCardsEl) return;
  challengeCardsEl.scrollBy({ left: direction * carouselCardStep(), behavior: "smooth" });
}

function updateChallengeCarouselDots() {
  if (!challengeCarouselDots || !challengeCardsEl) return;
  const dots = challengeCarouselDots.querySelectorAll(".carousel-dot");
  const step = carouselCardStep();
  const maxScrollLeft = challengeCardsEl.scrollWidth - challengeCardsEl.clientWidth;
  let activeIndex = step ? Math.round(challengeCardsEl.scrollLeft / step) : 0;
  // Near-max scroll may fall short of the last dot's nominal step position (no trailing
  // gap after the final card), so snap to the last dot once we're effectively at the end.
  if (maxScrollLeft > 0 && challengeCardsEl.scrollLeft >= maxScrollLeft - 4) {
    activeIndex = dots.length - 1;
  }
  dots.forEach((dot, idx) => dot.classList.toggle("active", idx === activeIndex));
  // Edge fades only where there is more to scroll (see .challenge-carousel in styles.css).
  challengeCardsEl.classList.toggle("can-scroll-left", challengeCardsEl.scrollLeft > 4);
  challengeCardsEl.classList.toggle("can-scroll-right", challengeCardsEl.scrollLeft < maxScrollLeft - 4);
}

// On small screens (<=600px, see @media (max-width: 600px) in styles.css) the carousel
// arrows are hidden and cards snap-center on swipe/dot-tap, so there's no click to select
// the card the player ends up looking at. Once scroll settles on such screens, select the
// card nearest the carousel's horizontal center (matching click-to-select behavior),
// skipping disabled/placeholder cards so the previous selection is kept.
function selectCenteredChallengeCardOnSmallScreens() {
  if (!challengeCardsEl) return;
  if (!window.matchMedia || !window.matchMedia("(max-width: 600px)").matches) return;
  const cards = Array.from(challengeCardsEl.querySelectorAll(".challenge-card"));
  if (!cards.length) return;
  const containerRect = challengeCardsEl.getBoundingClientRect();
  const containerCenter = containerRect.left + containerRect.width / 2;
  let nearest = null;
  let nearestDist = Infinity;
  cards.forEach((card) => {
    if (card.classList.contains("challenge-card-disabled")) return;
    const rect = card.getBoundingClientRect();
    const cardCenter = rect.left + rect.width / 2;
    const dist = Math.abs(cardCenter - containerCenter);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = card;
    }
  });
  if (!nearest) return;
  nearest.dispatchEvent(new CustomEvent("challenge-select"));
}

// Same breakpoint as selectCenteredChallengeCardOnSmallScreens: the Start button is hidden
// there and tapping the (auto-selected) centred card starts the game instead.
function challengeCardTapStarts() {
  return Boolean(window.matchMedia && window.matchMedia("(max-width: 600px)").matches);
}

function openChallengePicker() {
  if (!challengePickerEl || !challengeCardsEl) {
    newGame();
    return;
  }
  pickedChallengeId = null;
  renderChallengeCards();
  if (challengePickerLocaleSelect) challengePickerLocaleSelect.value = getLocale();
  if (challengeCancelBtn) challengeCancelBtn.style.display = hasStartedAnyGame ? "inline-block" : "none";
  challengePickerEl.hidden = false;
  const dialog = challengePickerEl.querySelector(".modal-dialog");
  if (dialog) {
    updateScrollCue(dialog);
    if (!dialog.dataset.scrollCueBound) {
      dialog.dataset.scrollCueBound = "true";
      dialog.addEventListener("scroll", () => updateScrollCue(dialog));
      window.addEventListener("resize", () => {
        if (!challengePickerEl.hidden) updateScrollCue(dialog);
      });
    }
  }
  // The cards were measured while the modal was still [hidden] (all 0-height,
  // so every card was marked is-at-end); re-measure now that the reveal has
  // been applied, once layout has actually happened.
  requestAnimationFrame(() => {
    if (challengePickerEl.hidden) return;
    challengeCardsEl.querySelectorAll(".challenge-card").forEach((card) => updateScrollCue(card));
    updateChallengeCarouselDots();
  });
}

function closeChallengePicker() {
  if (challengePickerEl) challengePickerEl.hidden = true;
}

const UPCOMING_CHALLENGES = [];

// Appends a labeled bullet list (Setup / Rules / Victory) to a challenge card, skipped
// entirely when the challenge has no keys for that section (e.g. "no changes" challenges).
function appendChallengeCardSection(card, labelKey, keys) {
  if (!keys?.length) return;
  const label = document.createElement("p");
  label.className = "challenge-card-section-label";
  label.textContent = t(labelKey);
  card.appendChild(label);
  const list = document.createElement("ul");
  keys.forEach((key) => {
    const li = document.createElement("li");
    li.textContent = t(key);
    list.appendChild(li);
  });
  card.appendChild(list);
}

const DIFFICULTY_LABEL_KEYS = {
  1: "challenges.picker.difficultyEasy",
  2: "challenges.picker.difficultyMedium",
  3: "challenges.picker.difficultyHard",
};

// Small crown-icon row (1-3) matching the rulebook's difficulty rating per challenge.
function appendDifficultyDots(card, level) {
  if (!level) return;
  const wrap = document.createElement("div");
  wrap.className = "difficulty-dots";
  const label = `${t("challenges.picker.difficultyLabel")}: ${t(DIFFICULTY_LABEL_KEYS[level] || DIFFICULTY_LABEL_KEYS[3])}`;
  wrap.setAttribute("role", "img");
  wrap.setAttribute("aria-label", label);
  wrap.title = label;
  for (let i = 1; i <= 3; i++) {
    const icon = document.createElement("img");
    icon.src = "assets/img/crown.webp";
    icon.alt = "";
    icon.className = "difficulty-crown" + (i <= level ? " filled" : "");
    wrap.appendChild(icon);
  }
  card.appendChild(wrap);
}

// Renders a non-selectable card for content that either isn't implemented yet (VII/VIII)
// or isn't translated into the active locale. `titleText`/`descText` are already-resolved
// strings (not i18n keys) so callers can force the English fallback when a locale is missing.
function appendChallengePlaceholderCard(titleText, descText = null, difficulty = null) {
  const card = document.createElement("div");
  card.className = "challenge-card challenge-card-disabled";
  const badge = document.createElement("span");
  badge.className = "challenge-card-badge";
  badge.textContent = t("challenges.comingSoon");
  const title = document.createElement("h3");
  title.innerHTML = formatChallengeNameHtml(titleText);
  card.appendChild(badge);
  card.appendChild(title);
  appendDifficultyDots(card, difficulty);
  if (descText) {
    const desc = document.createElement("p");
    desc.textContent = descText;
    card.appendChild(desc);
  }
  card.addEventListener("scroll", () => updateScrollCue(card));
  challengeCardsEl.appendChild(card);
}

function renderChallengeCarouselDots(count) {
  if (!challengeCarouselDots) return;
  clearElement(challengeCarouselDots);
  for (let i = 0; i < count; i++) {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "carousel-dot" + (i === 0 ? " active" : "");
    dot.setAttribute("aria-label", `${i + 1}/${count}`);
    dot.onclick = () => {
      challengeCardsEl.scrollTo({ left: i * carouselCardStep(), behavior: "smooth" });
    };
    challengeCarouselDots.appendChild(dot);
  }
}

function renderChallengeCards() {
  cachedCarouselCardStep = null;
  clearElement(challengeCardsEl);
  const entries = [
    { id: null, nameKey: "challenges.picker.normalGameName", descKey: "challenges.picker.normalGameDescription" },
    ...CHALLENGE_ORDER.map((id) => CHALLENGES[id]),
  ];
  entries.forEach((entry) => {
    if (!hasOwnTranslation(entry.nameKey)) {
      appendChallengePlaceholderCard(tEnglish(entry.nameKey), null, entry.difficulty);
      return;
    }
    const card = document.createElement("button");
    card.type = "button";
    card.className = "challenge-card";
    if (entry.id === null) card.classList.add("challenge-card-normal");
    card.classList.toggle("selected", pickedChallengeId === entry.id);
    const title = document.createElement("h3");
    title.innerHTML = formatChallengeNameHtml(t(entry.nameKey));
    card.appendChild(title);
    appendDifficultyDots(card, entry.difficulty);
    const desc = document.createElement("p");
    desc.textContent = t(entry.descKey);
    card.appendChild(desc);
    appendChallengeCardSection(card, "challenges.picker.victoryLabel", entry.victoryKeys);
    appendChallengeCardSection(card, "challenges.picker.rulesLabel", entry.ruleKeys);
    appendChallengeCardSection(card, "challenges.picker.setupLabel", entry.setupKeys);
    const selectCard = () => {
      pickedChallengeId = entry.id;
      challengeCardsEl.querySelectorAll(".challenge-card").forEach((el) => el.classList.remove("selected"));
      card.classList.add("selected");
      card.scrollIntoView?.({ behavior: "smooth", inline: "center", block: "nearest" });
    };
    card.addEventListener("challenge-select", selectCard);
    card.onclick = () => {
      // Tapping a peeking neighbour only centres/selects it, so a stray tap never starts
      // a game the player wasn't looking at.
      if (challengeCardTapStarts() && card.classList.contains("selected")) {
        challengeConfirmBtn?.click();
        return;
      }
      selectCard();
    };
    card.addEventListener("scroll", () => updateScrollCue(card));
    challengeCardsEl.appendChild(card);
  });
  UPCOMING_CHALLENGES.forEach((entry) => {
    appendChallengePlaceholderCard(t(entry.nameKey), t(entry.descKey), entry.difficulty);
  });
  renderChallengeCarouselDots(challengeCardsEl.children.length);
  challengeCardsEl.querySelectorAll(".challenge-card").forEach((card) => updateScrollCue(card));
  if (!window.__rfChallengeCardResizeBound) {
    window.__rfChallengeCardResizeBound = true;
    window.addEventListener("resize", () => {
      challengeCardsEl.querySelectorAll(".challenge-card").forEach((card) => updateScrollCue(card));
    });
  }
}

function handleBuildingChoice() {
  clearPendingPlot();
  const selected = document.querySelector(".building-hit.selected");
  const hasLockedLocation = Array.isArray(state.lockedLocationDice) && state.lockedLocationDice.length === 2;
  const diceLockedForBuild = state.diceLocked;
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
    const available = guildTypes.filter((gt) => !builtGuildTypes(state.board).has(gt));
    renderGuildOverlay(available);
    if (!available.length) {
      log(t("build.noGuildTypesAvailable"));
      return;
    }
    if (!state.selectedGuildType) {
      log(t("build.selectGuildTypeFromOverlay"));
      flashHint(t("build.selectGuildTypeFromOverlay"));
      return;
    }
  } else {
    state.selectedGuildType = null;
    renderGuildOverlay([]);
  }
  updateActionBanner();
  renderSelectionDice();
  guideToStep("plot:" + code + ":" + (state.selectedGuildType || ""), () =>
    document.querySelector(".cell.highlight"),
  );
}

function renderGuildOverlay(available = []) {
  const overlay = document.getElementById("guildsOverlay");
  if (!overlay) return;
  const centerBuildingActive = Boolean(state.pendingCenterBuilding?.awaitingGuildType);
  if (centerBuildingActive) {
    const choices = state.pendingCenterBuilding.choices || ["T", ...guildTypes];
    available = guildTypes.filter((gt) => choices.includes(gt));
  }
  const hasLockedLocation = Array.isArray(state.lockedLocationDice) && state.lockedLocationDice.length === 2;
  const locationReady = hasLockedLocation || state.locationSelection.length === 2;
  const locked =
    !centerBuildingActive &&
    (state.pendingBarricade?.active ||
      !locationReady ||
      state.diceLocked ||
      state.activationMode ||
      forceForfeitActive() ||
      state.pestilence);
  // Always keep pointer events on so disabled hits can still show their tooltip on
  // hover/focus; onclick below already no-ops while locked/unavailable.
  overlay.style.pointerEvents = "auto";
  overlay.classList.toggle("disabled", locked || !available.length);
  clearElement(overlay);
  const availableSet = new Set(available);
  guildHitboxes.forEach((hit) => {
    const div = document.createElement("div");
    div.className = "guild-hit";
    div.dataset.code = hit.code;
    div.style.gridColumn = hit.col;
    div.style.gridRow = hit.row;
    if (!locked && availableSet.has(hit.code) && (centerBuildingActive || !builtGuildTypes(state.board).has(hit.code))) {
      div.classList.add("available");
    } else {
      div.classList.add("disabled");
    }
    if (state.selectedGuildType === hit.code) {
      div.classList.add("selected");
    }
    setPopover(
      div,
      buildingTooltip("G", { context: "sheet", guildLabel: hit.code, buildingOverrides: activeChallenge()?.rules?.buildingOverrides }),
      { tap: false },
    );
    div.onclick = () => {
      if (locked || !div.classList.contains("available")) return;
      if (centerBuildingActive) {
        placeCenterBuilding("G", hit.code);
        return;
      }
      const oldType = state.selectedGuildType;
      document.querySelectorAll(".guild-hit.selected").forEach((el) => el.classList.remove("selected"));
      div.classList.add("selected");
      state.selectedGuildType = hit.code;
      if (oldType !== hit.code) {
        clearPendingPlot();
      }
      renderBuildingPicker();
      updateActionBanner();
      guideToStep("plot:G:" + hit.code, () => document.querySelector(".cell.highlight"));
    };
    div.setAttribute("aria-label", hit.code);
    overlay.appendChild(div);
  });
  renderBuildingPicker();
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
  // Defer the population guide with requestAnimationFrame to ensure the DOM is settled
  // and the target node position is final (especially after placeBuilding's re-renders).
  if (typeof requestAnimationFrame !== "undefined") {
    requestAnimationFrame(() => {
      guideToStep("population:" + r + "," + c, () => document.querySelector(".population-node.highlight"));
    });
  } else {
    setTimeout(() => {
      guideToStep("population:" + r + "," + c, () => document.querySelector(".population-node.highlight"));
    }, 0);
  }
}

function onPopulationNodeClick(nr, nc) {
  if (state.pendingBarricade?.active) {
    const result = chooseBarricadeNode(state, nr, nc);
    if (result.message) log(result.message);
    if (!result.barricaded) return;
    playSfx();
    renderBoard();
    // The Unrest tally that raised this Barricade already ran (from maybeRollAfterLock(),
    // before diceLocked got a chance to flip false) and is now skipped by its own
    // once-per-turn guard, so this just needs to actually complete the turn transition that
    // was deferred while the Barricade was pending.
    autoAdvance();
    maybeRollAfterLock();
    return;
  }
  if (state.activationMode) {
    const availablePop = state.populationAvailable?.[nr]?.[nc] || 0;
    if (availablePop <= 0) {
      log(t("population.noAvailableNode"));
      return;
    }
    state.activationSelection.pop = [nr, nc];
    renderBoard();
    highlightLocations();
    updateActionBanner();
    return;
  }
  if (!state.pendingPopulation || state.pendingPopulation.remaining <= 0) return;
  if (needsConfirmStep()) {
    const { ok } = canPlacePopulationNode(state, nr, nc, { nodesForCell });
    if (!ok) {
      // Invalid taps fall through to the real function so the existing
      // message/log behavior stays identical; nothing to preview here.
      doPlacePopulationNode(nr, nc);
      return;
    }
    state.pendingPlot = { r: nr, c: nc, kind: "population" };
    renderBoard();
    updateActionBanner();
    showPlotConfirmControls();
    return;
  }
  doPlacePopulationNode(nr, nc);
}

/**
 * Actual population placement commit, shared by the direct (mouse) click
 * path and confirmPendingPlot() on coarse-pointer devices.
 */
function doPlacePopulationNode(nr, nc) {
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
  updateBannerUI(state, phase, {
    currentScore,
    lockedPairChoice,
  });
  syncPlotConfirmControls();
  syncActionBarState();
}

// Confirm/Change plot buttons are normally shown/hidden via showPlotConfirmControls()/
// hidePlotConfirmControls(), but some reset paths (e.g. resetTurnState(), called from a new
// roll or a new game) clear state.pendingPlot directly without going through either, which
// would otherwise leave the buttons stuck visible. Derive their visibility here, from
// updateActionBanner() (part of every render path), so any reset path hides them.
function syncPlotConfirmControls() {
  if (state.pendingPlot) return;
  if (confirmPlotBtn && confirmPlotBtn.style.display !== "none") confirmPlotBtn.style.display = "none";
  if (cancelPlotBtn && cancelPlotBtn.style.display !== "none") cancelPlotBtn.style.display = "none";
}

/**
 * Replaces the old `:has()`-based CSS rules that derived the aux drawer's
 * open/closed state and the pre-roll / inline-twin-hiding states from inline
 * styles and attributes (`.action-bar-aux:has(> #confirmPlotBtn:not([style*=
 * "display: none"]))`, etc.) - WebKit (iOS Chrome/Safari) doesn't reliably
 * re-evaluate `:has()` after inline style/attribute mutations, which left the
 * aux drawer looking like an empty tab, and the building picker invisible
 * even when `renderBuildingPicker()` had populated it. Sets JS-managed
 * classes instead; call after any change that affects these states.
 */
function syncActionBarState() {
  if (!actionBarEl) return;
  const confirmVisible = Boolean(confirmPlotBtn && confirmPlotBtn.style.display !== "none");
  const pickerVisible = Boolean(buildingPickerEl && !buildingPickerEl.hidden && isCompactLayout());
  const stepperVisible = Boolean(influenceStepper && !influenceStepper.hidden);
  const hasInlineRoll = Boolean(actionBannerEl?.querySelector('.btn-inline-action[data-target="rollBtn"]'));
  const hasInlineFinish = Boolean(
    actionBannerEl?.querySelector('.btn-inline-action[data-target="finishActivation"]'),
  );
  const hasDiceBadge = Boolean(diceView?.querySelector(".die-badge"));
  const preRoll = hasInlineRoll && !hasDiceBadge;

  if (actionBarAuxEl) {
    const isOpen = confirmVisible || pickerVisible || stepperVisible;
    actionBarAuxEl.classList.toggle("is-open", isOpen);
    actionBarAuxEl.classList.toggle("has-confirm", confirmVisible);
  }
  actionBarEl.classList.toggle("is-pre-roll", preRoll);
  actionBarEl.classList.toggle("has-inline-roll", hasInlineRoll);
  actionBarEl.classList.toggle("has-inline-finish", hasInlineFinish);
}

function updateSwapButton() {
  if (swapPairBtn && swapBtnWrap) {
    const reasonKey = soloSwapUnavailableReasonKey();
    const hidden = reasonKey === "hidden";
    const showSwap = reasonKey === null;
    swapBtnWrap.style.display = hidden ? "none" : "inline-flex";
    swapPairBtn.disabled = !showSwap;
    swapPairBtn.classList.toggle("icon-btn-disabled", !hidden && !showSwap);

    // When enabled, set popover on button with tap:false; when disabled, set on wrapper with default tap
    if (showSwap || hidden) {
      // Enabled or hidden: show title on button, disable tap
      setPopover(swapPairBtn, t("html.swapTitle"), { tap: false });
      setPopover(swapBtnWrap, null);
    } else {
      // Disabled: show reason on wrapper, allow tap to show popover
      setPopover(swapBtnWrap, t(reasonKey));
      setPopover(swapPairBtn, null);
    }
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
  const label = active ? t("turn.activeLabel") : t("turn.nonActiveLabel");
  if (!show) {
    turnStatusChip.classList.add("hidden");
    turnStatusChip.setAttribute("aria-hidden", "true");
  } else {
    turnStatusChip.textContent = label;
    turnStatusChip.setAttribute("aria-label", label);
    turnStatusChip.removeAttribute("title");
    turnStatusChip.classList.remove("hidden");
    turnStatusChip.removeAttribute("aria-hidden");
    turnStatusChip.classList.toggle("status-active", active);
    turnStatusChip.classList.toggle("status-inactive", !active);
  }
  updateUnrestBadge();
  updateActiveChallengeBadge();
  updateChallengeProgressBadge();
}

function updateUnrestBadge() {
  if (!unrestBadge) return;
  if (!state.unrestTracking) {
    unrestBadge.classList.add("hidden");
    unrestBadge.setAttribute("aria-hidden", "true");
    return;
  }
  const progress = state.unrest?.progress || 0;
  const label = `${t("challenges.unrestLabel")}: ${progress}/4`;
  unrestBadge.textContent = label;
  unrestBadge.setAttribute("aria-label", label);
  unrestBadge.title = t("challenges.unrestBadgeTooltip");
  unrestBadge.classList.remove("hidden");
  unrestBadge.removeAttribute("aria-hidden");
}

function updateChallengeProgressBadge() {
  if (!challengeProgressBadge) return;
  const challenge = activeChallenge();
  if (!challenge?.liveProgress) {
    challengeProgressBadge.classList.add("hidden");
    challengeProgressBadge.setAttribute("aria-hidden", "true");
    return;
  }
  const { have, need, labelKey } = challenge.liveProgress(currentScore(), state);
  const label = `${t(labelKey)}: ${have}/${need}`;
  challengeProgressBadge.textContent = label;
  challengeProgressBadge.setAttribute("aria-label", label);
  challengeProgressBadge.title = label;
  challengeProgressBadge.classList.remove("hidden");
  challengeProgressBadge.removeAttribute("aria-hidden");
}

function maybeRollAfterLock() {
  // Uses game-state.js's own isReadyToRoll() gate, checked here *before* calling
  // maybeRollAfterLockState() so the Unrest tally can run - and potentially raise a Barricade
  // that blocks the transition - before that function's side effect of flipping diceLocked
  // false. This is the actual turn-completion path for a normal build (autoAdvance() sees
  // diceLocked still true at that point and defers here), so skipping the tally here was
  // silently dropping Unrest gains (Advanced building / Influence spent / Vagrants) on every
  // turn that ended via a build rather than a barricade/forfeit/activation.
  if (isReadyToRoll(state) && tallyUnrestForCompletedTurnIfNeeded()) return;
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
      const isBarricaded = Boolean(state.barricadedNodes?.[r]?.[c]);
      node.dataset.nodeRow = r;
      node.dataset.nodeCol = c;
      if (isBarricaded) {
        node.classList.add("barricaded");
      }
      if (state.pendingPlot?.kind === "population" && state.pendingPlot.r === r && state.pendingPlot.c === c) {
        node.classList.add("cell-pending");
      }
      if (state.pendingBarricade?.active) {
        if (!isBarricaded && val === 0) {
          node.classList.add("highlight");
        } else {
          node.classList.add("disabled");
        }
      } else if (state.activationMode) {
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
        const isEligible = eligibleNodes.some(([nr, nc]) => nr === r && nc === c) && val === 0 && !isBarricaded;
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
    if (locDicePreview) renderDicePreview(locDicePreview, loc, "location", t("location.selectTwoPreview"));
    if (buildDicePreview) renderDicePreview(buildDicePreview, build, "build", t("location.remainingUsedForBuild"));
    return;
  }
  if (state.activationMode || state.activationComplete) {
    if (locDicePreview) renderDicePreview(locDicePreview, [], "location", t("location.selectTwoPreview"));
    if (buildDicePreview) renderDicePreview(buildDicePreview, [], "build", t("location.remainingUsedForBuild"));
    return;
  }
  const respectSwap = () => {
    if (!(Array.isArray(state.lockedLocationDice) && state.lockedLocationDice.length === 2)) {
      return { loc: locationDice, build: buildDice };
    }
    const choice = lockedPairChoice();
    return { loc: choice.locDice || locationDice, build: choice.buildDice || buildDice };
  };

  const currentLocFromState = state.locationSelection.map((i) => state.dice[i]).filter(Boolean);
  const forcedMode = state.pestilence || forceForfeitActive();
  const forcedSplit = forcedMode ? splitForcedDice(state.dice || []) : null;
  const doubleWindrose = shouldRerollDoubleWindrose(state.dice || []);
  // A double windrose forces a reroll, but the just-rolled dice should still be visible in
  // Split & Build (numbered/windrose dice in Location, X dice in Build) rather than blanked out.
  const doubleWindroseSplit = doubleWindrose ? splitForcedDice(state.dice || []) : null;

  let effectiveLoc =
    (doubleWindrose
      ? (doubleWindroseSplit.locationDice.length && doubleWindroseSplit.locationDice) || []
      : (forcedSplit && forcedSplit.locationDice.length && forcedSplit.locationDice) ||
        (locationDice && locationDice.length && locationDice) ||
        (currentLocFromState.length && currentLocFromState) ||
        (state.lockedLocationDice && state.lockedLocationDice.length && state.lockedLocationDice) ||
        []);

  const currentBuildFromState = state.dice.filter((_, idx) => !state.locationSelection.includes(idx));
  const buildReady = state.locationSelection.length === 2 || forceBuildPreview;
  let effectiveBuild =
    doubleWindrose
      ? (doubleWindroseSplit.buildDice.length && doubleWindroseSplit.buildDice) || []
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

  // The Pair & Build panel is a read-only preview: dice faces reflect influence
  // adjustments made via the action-bar dice, but no influence controls render here.
  if (locDicePreview) {
    renderDicePreview(
      locDicePreview,
      clampDice(effectiveLoc),
      "location",
      t("location.selectTwoPreview"),
    );
  }
  if (buildDicePreview) {
    renderDicePreview(
      buildDicePreview,
      clampDice(effectiveBuild),
      "build",
      t("location.remainingUsedForBuild"),
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
  if (forcedLocation) badge.title = t("turn.windroseStaysTitle");
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
  if (allowInfluence && influenceBadgeEligible(die) && effectiveIdx >= 0) {
    badge.classList.add("has-influence-target");
    const targetBtn = document.createElement("button");
    targetBtn.type = "button";
    targetBtn.className = "influence-target-btn";
    targetBtn.textContent = "±";
    targetBtn.setAttribute("aria-label", t("influence.useOnDie", { die: die.label }));
    targetBtn.title = t("influence.badgeTitle");
    if (influenceUiDie === die.label) targetBtn.classList.add("active");
    targetBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      influenceUiDie = die.label;
      // Re-render the dice too, so the target ring/active badge move to this die.
      renderDice();
    });
    badge.appendChild(targetBtn);
  }
  if (influenceUiDie === die.label && effectiveIdx >= 0) {
    badge.classList.add("influence-target");
  }
  return badge;
}

const DICE_PREVIEW_SLOTS = 2;

function renderDicePreview(container, dice, role, emptyText, { allowInfluence = false } = {}) {
  if (!container) return;
  container.classList.add("split-preview");
  clearElement(container);
  const diceList = dice || [];
  if (diceList.length < DICE_PREVIEW_SLOTS) {
    container.title = emptyText;
    const srText = document.createElement("span");
    srText.className = "visually-hidden";
    srText.textContent = emptyText;
    container.appendChild(srText);
  } else {
    container.removeAttribute("title");
  }
  diceList.forEach((die, idx) => {
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
  for (let i = diceList.length; i < DICE_PREVIEW_SLOTS; i += 1) {
    const placeholder = document.createElement("div");
    placeholder.className = "die-badge die-placeholder";
    placeholder.setAttribute("aria-hidden", "true");
    container.appendChild(placeholder);
  }
}

function onDieClick(idx) {
  if (!state.activeTurn) return;
  const { message } = selectLocationDie(state, idx, {
    uniqueLocationPairs,
    filterAvailablePairs,
    board: state.board,
  });
  if (message) log(message);
  updateDiceAssignments();
}

// `renderOnly` skips re-evaluating the current location selection (which can mutate turn
// state and log messages) and just re-renders from the existing state — used when
// refreshing the UI for a locale switch, which must not alter game state.
function updateDiceAssignments(renderOnly = false) {
  if (renderOnly) {
    if (state.pendingPlot) {
      showPlotConfirmControls();
    }
  } else {
    clearPendingPlot();
  }
  if (!state.dice || !state.dice.length) {
    if (!renderOnly) {
      state.forceForfeit = false;
      state.forceForfeitAdvisory = false;
      state.invalidSelection = false;
      state.invalidSelectionMessage = null;
      state.influenceSelectionKey = null;
    }
    renderSelectionDice([], []);
    fillBuildings([]);
    highlightLocations();
    updateActionBanner();
    renderDice();
    updateSwapButton();
    return;
  }
  // A Pestilence roll locks the location/build split directly (see rollDice()) and
  // forces a forfeit regardless of pairs; re-evaluating the selection here would
  // overwrite that locked state and log a stray "no valid pairs" message.
  if (!renderOnly && !state.pestilence) {
    if (!influenceAdjustmentsEmpty()) {
      const selectionKey = canonicalSelectionKey(state.locationSelection);
      if (state.influenceSelectionKey && state.influenceSelectionKey !== selectionKey) {
        const cleared = clearInfluenceAdjustments();
        if (cleared) {
          log(t("influence.resetOnSelectionChange"));
          updateTracks();
        }
      }
    } else if (state.influenceSelectionKey) {
      state.influenceSelectionKey = null;
    }

    const { message } = evaluateLocationSelection(state, {
      uniqueLocationPairs,
      filterAvailablePairs,
      board: state.board,
    });
    if (message) log(message);
  }

  // Dice assignments are evaluated after evaluateLocationSelection() in case the
  // selection changed (e.g. auto-swap on non-active turns).
  const locationDice = state.locationSelection.map((i) => state.dice[i]).filter(Boolean);
  const buildDice =
    state.locationSelection.length === 2 ? state.dice.filter((_, idx) => !state.locationSelection.includes(idx)) : [];
  if (locationDice.length === 2) {
    state.lastLocationDice = locationDice;
    state.lastBuildDice = buildDice;
  }

  if (turnHintEl) {
    if (state.activeTurn && state.invalidSelection) {
      setTurnHint(state.invalidSelectionMessage || t("location.noValidPlotsForPair"));
    } else if (state.forceForfeitAdvisory) {
      setTurnHint(t("location.noValidPairsSpendInfluence"));
    } else if (forceForfeitActive()) {
      setTurnHint(t("location.noValidPairsForfeit", { turn: state.turnIndex }));
    } else if (!state.activeTurn) {
      setTurnHint(nonActiveAutoHintText());
    } else {
      setTurnHint("");
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
      : state.diceLocked && state.lastBuildDice?.length
        ? state.lastBuildDice
        : buildDice.length
          ? buildDice
          : [];

  renderSelectionDice(previewLocation, previewBuild);
  fillBuildings(previewBuild);
  highlightLocations();
  updateActionBanner();
  renderDice();
  updateSwapButton();
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
  return computeSwapChoice(baseLoc, baseBuild, false);
}

function soloBaseSelections() {
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

// Returns "hidden" when the swap button doesn't apply to the current turn at all (no dice to
// swap), a locale key naming the reason it's disabled-but-visible, or null when swap is fully
// available. Centralizing this lets the button show a grey/disabled state with an explanatory
// tooltip instead of just disappearing (see updateSwapButton()).
let lastSwapDebugFingerprint = null;

function soloSwapUnavailableReasonKey() {
  if (state.activeTurn || state.pestilence || state.activationMode) return "hidden";
  const choice = soloPairChoice();
  if (!choice.baseLocIdx || !choice.baseBuildIdx) return "hidden";
  if (!choice.swapAllowed) {
    logSwapDebugTrace(choice, "html.swapUnavailableOnlyOnePairing", {});
    return "html.swapUnavailableOnlyOnePairing";
  }

  const baseValid = soloPairHasValidLocations(choice.baseLocDice);
  const altValid = soloPairHasValidLocations(choice.baseBuildDice);

  const baseCanBeRescued = !baseValid && soloPairCanBeRescued(choice.baseLocDice);
  const altCanBeRescued = !altValid && soloPairCanBeRescued(choice.baseBuildDice);
  const basePossible = baseValid || baseCanBeRescued;
  const altPossible = altValid || altCanBeRescued;
  const details = { baseValid, altValid, baseCanBeRescued, altCanBeRescued };
  if (!basePossible && !altPossible) {
    logSwapDebugTrace(choice, "html.swapUnavailableNoValidPairing", details);
    return "html.swapUnavailableNoValidPairing";
  }
  return null;
}

// Diagnostic trace for the swap-button availability decision, logged to the console whenever
// it computes "unavailable" - throttled so it only re-logs when the inputs actually change,
// since this is re-evaluated on nearly every render. Intended to help track down reports of
// the button appearing available/orange while this logic believes it's unavailable (or vice
// versa) without a way to reproduce the exact dice/board state that triggered it.
function logSwapDebugTrace(choice, reasonKey, details) {
  if (!debugMode) return;
  const fingerprint = JSON.stringify({
    loc: choice.baseLocDice?.map((d) => [d.label, d.face, d.resolved]),
    build: choice.baseBuildDice?.map((d) => [d.label, d.face, d.resolved]),
    reasonKey,
    influence: state.influence,
    adjustments: state.influenceAdjustments,
  });
  if (fingerprint === lastSwapDebugFingerprint) return;
  lastSwapDebugFingerprint = fingerprint;
  console.debug("[swap-button]", reasonKey, {
    baseLocDice: choice.baseLocDice,
    baseBuildDice: choice.baseBuildDice,
    influence: state.influence,
    influenceAdjustments: state.influenceAdjustments,
    ...details,
  });
}

function soloSwapAvailable() {
  return soloSwapUnavailableReasonKey() === null;
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
  if (state.activeTurn) return;
  const toggled = toggleSoloPairChoice();
  if (!toggled) return;
  updateDiceAssignments();
  updateSwapButton();
}

function autoMarkBuildDoneIfReady(_options = {}) {
  // Single-player flow auto advances via autoAdvance/maybeRollAfterLock; nothing additional needed.
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
    buildingOverrides: activeChallenge()?.rules?.buildingOverrides,
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
  const computedSpots = scoringSpots.map((spot) => {
    let val;
    if (spot.key === "reputation") {
      val = total;
    } else if (spot.key === "buildings-total") {
      val = buildingTotals;
    } else {
      val = typeof breakdown[spot.key] === "number" ? breakdown[spot.key] : 0;
    }
    return { spot, val };
  });
  // Some spots intentionally share coordinates when a challenge's building replaces another's
  // on the fixed scoresheet art (e.g. Barracks reusing Cottage's slot) — the score-chip text has
  // no background, so rendering both would visually overlap. Keep only the nonzero one per spot.
  const seenCoords = new Map();
  const spotsToRender = [];
  computedSpots.forEach((entry) => {
    const coordKey = `${entry.spot.x},${entry.spot.y}`;
    const existingIdx = seenCoords.get(coordKey);
    if (existingIdx === undefined) {
      seenCoords.set(coordKey, spotsToRender.length);
      spotsToRender.push(entry);
    } else if (entry.val !== 0 && spotsToRender[existingIdx].val === 0) {
      spotsToRender[existingIdx] = entry;
    }
  });
  spotsToRender.forEach(({ spot, val }) => {
    const leftPos = typeof spot.x === "number" ? spot.x : 0;
    const topPos = typeof spot.y === "number" ? spot.y : 30;
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
      setPopover(
        chip,
        marketDetails
          .map((m) => t("market.tooltipRow", { row: m.row + 1, col: m.col + 1, points: m.points }))
          .join('\n')
      );
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
        setPopover(slot, t("influence.spentTitle"));
      } else {
        slot.classList.add("available");
        setPopover(slot, t("influence.availableTitle"));
      }
    }
    track.appendChild(slot);
  }
  influenceOverlay.appendChild(track);
}

function renderTurnTrack(filled = 0) {
  if (!turnTrackOverlay) return;
  const count = Math.max(0, Math.min(TURN_TRACK_LENGTH, Number(filled) || 0));
  // Challenges with a shortened turn limit (e.g. Social Contract's 24) never play the
  // remaining track slots; cross those out in a distinct color so it's clear they're unused
  // rather than just "not reached yet".
  const turnLimit = Math.min(TURN_TRACK_LENGTH, state.turnLimit || TURN_TRACK_LENGTH);
  clearElement(turnTrackOverlay);
  for (let i = 0; i < TURN_TRACK_LENGTH; i += 1) {
    const slot = document.createElement("div");
    slot.className = "turn-slot";
    const unused = i >= turnLimit;
    if (unused) {
      slot.classList.add("turn-slot-unused");
      setPopover(slot, t("turn.unusedTurnMarkerTitle"));
    }
    if (i < count || unused) {
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
      updateDiceAssignments,
      renderSelectionDice,
      handleBuildingChoice,
      currentTurnPhase,
      TURN_PHASE,
      actionMessage: (stateArg, _unused, phase) => {
        const s = stateArg || state;
        const ph = phase || currentTurnPhase();
        return generateActionMessage(s, ph, { currentScore, lockedPairChoice });
      },
      renderTurnTrack,
      maybeRollAfterLock,
      placeBuilding,
      onPopulationNodeClick,
      adjustDieWithInfluence,
      handleCenterBuildingChoice,
      onCellClick,
      forfeitCell,
      confirmPendingPlot,
      cancelPendingPlot,
      rollDice,
      newGame,
      log,
      updateActionBanner,
      syncActionBarState,
      renderBuildingPicker,
      renderInfluenceStepper,
      renderDice,
      renderBoard,
      currentScore,
    };
  }

  if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("autoplay")) {
    const _params = new URLSearchParams(window.location.search);
    const autoplayParam = _params.get("autoplay");
    // When autoplay value is a game index (digit), read speed from ?speed= instead,
    // so ?autoplay=3 (challenge III) and ?autoplay=fast (speed only) both work.
    const isGameIndex = autoplayParam !== null && /^\d+$/.test(autoplayParam);
    const speedParam = isGameIndex
      ? (_params.get("speed") || "normal")
      : autoplayParam;
    import("./autoplay.js").then((mod) => {
      mod.initAutoplay({
        speed: speedParam,
        loop: autoplayParam === "loop" || _params.has("loop"),
      });
    }).catch((err) => {
      console.error("Failed to load autoplay module:", err);
    });
  }
