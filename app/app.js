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
};

function logP2P(...args) {
  if (typeof console !== "undefined" && typeof console.info === "function") {
    console.info("[P2P]", ...args);
  }
}

function resetSecretField() {
  const fresh = randomPasscode();
  if (p2pSecretEl) p2pSecretEl.value = fresh;
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
  const hidden = state.activationMode || state.activationComplete;
  const awaitingRoll = !debugMode && state.rollAvailable;
  const showButton = !hidden && (awaitingRoll || debugMode);
  rollBtn.style.display = showButton ? "inline-block" : "none";
  const enabled = debugMode || state.rollAvailable;
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
const fullscreenBtn = document.getElementById("fullscreenToggle");
const themeToggleBtn = document.getElementById("themeToggle");
const themeToggleIcon = document.getElementById("themeToggleIcon");
const themeToggleText = document.getElementById("themeToggleText");
const actionBannerEl = document.getElementById("actionBanner");
const turnStatusChip = document.getElementById("turnStatusChip");
const loadingOverlay = document.getElementById("loadingOverlay");
const sheetEl = document.getElementById("sheet");
const regionOverlayEl = document.getElementById("regionOverlay");
const p2pPanel = document.getElementById("p2pPanel");
const p2pStatusEl = document.getElementById("p2pStatus");
const p2pCodeEl = document.getElementById("p2pCode");
const p2pSecretEl = document.getElementById("p2pSecret");
const p2pCopyBtn = document.getElementById("p2pCopyBtn");
const p2pApplyBtn = document.getElementById("p2pApplyBtn");
const p2pHostBtn = document.getElementById("p2pHostBtn");
const p2pJoinBtn = document.getElementById("p2pJoinBtn");
const p2pDisconnectBtn = document.getElementById("p2pDisconnectBtn");
const p2pSendAnswerBtn = document.getElementById("p2pSendAnswerBtn");
const p2pHintEl = document.getElementById("p2pHint");
const p2pQrImg = document.getElementById("p2pQrImg");
const p2pQrCaption = document.getElementById("p2pQrCaption");
const p2pQrModal = document.getElementById("p2pQrModal");
const p2pQrClose = document.getElementById("p2pQrClose");
const p2pShowQrBtn = document.getElementById("p2pShowQrBtn");
const SHEET_VERSION = "v1.1";
const POP_CAPACITY = 5;
const POP_LAYOUT = { cols: 7, rows: 2, pipsPerCell: 4 };
const debugMode = new URLSearchParams(window.location.search).has("debug");
const THEME_STORAGE_KEY = "rolling-fiefdoms-theme";
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
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = sheetImageUrl();
  });
}

function sheetImageUrl() {
  return new URL(`resources/rolling-fiefdoms-player-sheet.png?v=${SHEET_VERSION}`, window.location.href).toString();
}

setupThemeToggle();

preloadSheet().then(() => {
  document.body.classList.remove("loading");
  if (loadingOverlay) loadingOverlay.remove();
  if (sheetEl) {
    sheetEl.style.setProperty("--sheet-image", `url("${sheetImageUrl()}")`);
  }
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
  setupP2PControls();
}

function captureP2PSnapshot() {
  const snapshotScore = currentScore({ allowPopulationActivation: false });
  return {
    fiefdomName: state.fiefdomName || "",
    turnIndex: state.turnIndex || 0,
    activeTurn: Boolean(state.activeTurn),
    rollAvailable: Boolean(state.rollAvailable),
    score: snapshotScore?.total ?? 0,
  };
}

function handleP2PMessage(message) {
  if (!message || typeof message !== "object") return;
  if (message.type === "hello") {
    p2pUiState.remoteSnapshot = message.payload?.snapshot || null;
    updateP2PStatus("Peer handshake received. Manual state sync only.");
    logP2P("Peer handshake received.");
  }
}

function handleP2PStatus(status) {
  const channelJustOpened = !p2pUiState.channelOpen && status?.channelOpen;
  p2pUiState.channelOpen = Boolean(status?.channelOpen);
  p2pUiState.lastError = status?.lastError || null;
  if (status?.sessionId) p2pUiState.sessionId = status.sessionId;
  if (p2pUiState.channelOpen && p2pUiState.awaitingAnswer) p2pUiState.awaitingAnswer = false;
  if (channelJustOpened) {
    logP2P("Connected to peer.");
  }
  if (status?.lastError) {
    logP2P(status.lastError);
  }
  updateP2PStatus();
}

function updateP2PStatus(hintOverride = null) {
  if (!p2pPanel) return;
  if (p2pUiState.signallingDisabled) {
    if (p2pStatusEl) p2pStatusEl.textContent = "P2P disabled: signalling unavailable.";
    if (p2pHintEl) p2pHintEl.textContent = "Signalling must be reachable to use P2P.";
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

  const defaultHint = !status.supported
    ? "Use a browser with WebRTC data channels to try manual invites."
    : status.channelOpen
      ? "Manual copy/paste only; keep playing locally. Game actions are not auto-synced yet."
      : p2pUiState.awaitingAnswer
        ? "Share your invite, then paste their answer code here and apply it."
        : p2pUiState.mode === "answerReady"
          ? "Send this answer to the host; the link opens once they apply it."
          : "Host to generate an invite, or paste an invite to produce an answer.";

  const errorText = status.lastError ? ` (${status.lastError})` : "";
  const remoteText =
    status.channelOpen && p2pUiState.remoteSnapshot ? describeRemoteSnapshot(p2pUiState.remoteSnapshot) : "";
  if (p2pStatusEl) p2pStatusEl.textContent = `${main}${remoteText}${errorText}`;
  if (p2pHintEl) p2pHintEl.textContent = hintOverride || defaultHint;
  updateP2PControlsVisibility(status);
}

function readP2PSecret() {
  return (p2pSecretEl?.value || "").trim();
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

function buildInviteUrl({ sessionId, secret, signallingUrl }) {
  try {
    const url = new URL(window.location.href);
    url.search = "";
    const params = new URLSearchParams();
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
  try {
    const parsed = parseSessionLink(window.location.href);
    if (parsed && p2pCodeEl) {
      if (parsed.sessionId) p2pUiState.sessionId = parsed.sessionId;
      if (parsed.secret && p2pSecretEl) p2pSecretEl.value = parsed.secret;
      p2pCodeEl.value = buildInviteUrl({
        sessionId: parsed.sessionId,
        secret: parsed.secret,
        signallingUrl: p2pUiState.signallingUrl,
      });
      p2pUiState.loadedFromUrl = true;
      setP2PMode("joining");
      updateP2PStatus("Invite loaded from link. Generating your answer…");
      renderP2PQr(p2pCodeEl.value);
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
  const turn =
    typeof snapshot.turnIndex === "number" ? ` · Turn ${Math.max(1, Number(snapshot.turnIndex) + 1)}` : "";
  const active = snapshot.activeTurn ? " (Active)" : "";
  return `${name}${turn}${active}`;
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
  p2pUiState.remoteSnapshot = null;
  setP2PMode("idle");
  p2pUiState.sessionId = freshSessionId();
  p2pUiState.signallingDisabled = false;
  if (p2pCodeEl) p2pCodeEl.value = "";
  renderP2PQr("");
  resetSecretField();
  if (p2pCopyBtn) p2pCopyBtn.disabled = true;
  if (p2pShowQrBtn) p2pShowQrBtn.disabled = true;
  updateP2PStatus(reason || "P2P link reset.");
}

function setupP2PControls() {
  if (!p2pPanel) return;
  p2pUiState.signallingUrl = resolveSignallingUrl();
  if (!p2pUiState.signallingUrl) {
    disableP2P("P2P disabled: signalling URL unavailable.");
    return;
  }
  const supported = Boolean(p2p?.supported);
  const controls = [p2pHostBtn, p2pJoinBtn, p2pApplyBtn, p2pCopyBtn, p2pDisconnectBtn, p2pCodeEl, p2pSecretEl];
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
  if (p2pSecretEl && !p2pSecretEl.value) {
    resetSecretField();
  }
  maybeLoadInviteFromUrl();
  updateP2PStatus();
}

function updateP2PControlsVisibility(status = {}) {
  if (p2pUiState.signallingDisabled) {
    const all = [p2pHostBtn, p2pJoinBtn, p2pApplyBtn, p2pCopyBtn, p2pDisconnectBtn, p2pSendAnswerBtn, p2pSecretEl, p2pCodeEl, p2pQrImg, p2pQrCaption];
    all.forEach((el) => {
      if (!el) return;
      el.style.display = "none";
      el.disabled = true;
    });
    return;
  }
  // Manual code/answer UI hidden; only host button and passcode remain.
  if (p2pHostBtn) p2pHostBtn.style.display = "inline-block";
  if (p2pJoinBtn) p2pJoinBtn.style.display = "none";
  if (p2pApplyBtn) p2pApplyBtn.style.display = "none";
  if (p2pCopyBtn) p2pCopyBtn.style.display = "inline-block";
  if (p2pShowQrBtn) p2pShowQrBtn.style.display = "inline-block";
  if (p2pSendAnswerBtn) p2pSendAnswerBtn.style.display = "none";
  if (p2pSecretEl) p2pSecretEl.style.display = "inline-block";
  if (p2pCodeEl) p2pCodeEl.style.display = "inline-block";
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
  logP2P("P2P disabled:", reason);
  if (p2pCopyBtn) p2pCopyBtn.disabled = true;
  updateP2PStatus(reason);
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
  const n1 = rollNumberedDie("N1");
  const n2 = rollNumberedDie("N2");
  const x1 = rollXDie("X1");
  const x2 = rollXDie("X2");
  const dice = [n1, n2, x1, x2];
  const needsDoubleReroll = shouldRerollDoubleWindrose(dice);
  const turnIndexOverride = typeof state.pendingTurnIndex === "number" ? state.pendingTurnIndex : null;
  const activeTurnOverride = typeof state.pendingActiveTurn === "boolean" ? state.pendingActiveTurn : null;

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
    lockDiceSnapshot(state, { uniqueLocationPairs });
  } else if (turnHintEl) {
    turnHintEl.textContent = state.activeTurn ? "" : "Non-active turn. Dice automatically assigned.";
  }
  updateTurnStatusChip();
  updateDiceAssignments();
  renderDice();
  updateActionBanner();
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
      forcedLocation: (state.forcedLocationDice || []).includes(idx),
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
  const allowed = restrictBuildOptionsForBoard(buildingOptionsFromDice(buildDice), state.board);
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
    const fallback = restrictBuildOptionsForBoard(buildingOptionsFromDice(state.buildDice), state.board);
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
  refreshScoreOverlay();
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
      : currentScore({ allowPopulationActivation: true }).total;
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
  const awaitingRoll = !debugMode && state.rollAvailable;
  if (awaitingRoll) return "Press Roll Dice to start your turn.";
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

function updateTurnStatusChip() {
  if (!turnStatusChip) return;
  const hasDice = Array.isArray(state.dice) && state.dice.length >= 4;
  const awaitingRoll = !debugMode && state.rollAvailable;
  const show = hasDice && !state.activationComplete && !awaitingRoll;
  const active = Boolean(state.activeTurn);
  const label = active ? "Active turn" : "Non-active turn";
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

function renderSelectionDice(locationDice = [], buildDice = []) {
  const currentLocFromState = state.locationSelection.map((i) => state.dice[i]).filter(Boolean);
  const forcedMode =
    state.pestilence ||
    state.forceForfeit ||
    (!state.activeTurn && (!state.locationPairs || state.locationPairs.length === 0));
  const forcedSplit = forcedMode ? splitForcedDice(state.dice || []) : null;
  const doubleWindrose = shouldRerollDoubleWindrose(state.dice || []);

  const effectiveLoc =
    (doubleWindrose
      ? []
      : (forcedSplit && forcedSplit.locationDice.length && forcedSplit.locationDice) ||
        (locationDice && locationDice.length && locationDice) ||
        (currentLocFromState.length && currentLocFromState) ||
        (state.lockedLocationDice && state.lockedLocationDice.length && state.lockedLocationDice) ||
        []);

  const currentBuildFromState = state.dice.filter((_, idx) => !state.locationSelection.includes(idx));
  const forcedXs = state.dice.filter((d) => d.face === "X"); // normal flow: only X faces show in build before selection
  const effectiveBuild =
    doubleWindrose
      ? []
      : (forcedSplit && forcedSplit.buildDice.length)
        ? forcedSplit.buildDice
        : state.locationSelection.length === 2
          ? (buildDice && buildDice.length && buildDice) ||
            (currentBuildFromState.length && currentBuildFromState) ||
            (state.lockedBuildDice && state.lockedBuildDice.length && state.lockedBuildDice) ||
            (state.lastBuildDice && state.lastBuildDice.length && state.lastBuildDice) ||
            []
          : forcedXs;

  if (locDicePreview) {
    renderDicePreview(locDicePreview, effectiveLoc, "location", "Select 2 dice for location");
  }
  if (buildDicePreview) {
    renderDicePreview(buildDicePreview, effectiveBuild, "build", "Remaining dice used for build");
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
  if (die.face === "windrose") {
    const img = document.createElement("img");
    img.src = "assets/img/windrose.svg";
    img.alt = "Windrose";
    img.className = "die-windrose-icon";
    el.appendChild(img);
    return;
  }
  const val = typeof die.resolved === "number" ? die.resolved : Number(die.face);
  el.insertAdjacentHTML("beforeend", pipGrid(val || 0));
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
  addDieContent(badge, die);
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
  const { message } = selectLocationDie(state, idx, {
    uniqueLocationPairs,
    filterAvailablePairs,
    board: state.board,
  });
  if (message) log(message);
  updateDiceAssignments();
}

function updateDiceAssignments() {
  const locationDice = state.locationSelection.map((i) => state.dice[i]).filter(Boolean);
  const buildDice = state.dice.filter((_, idx) => !state.locationSelection.includes(idx));
  if (locationDice.length === 2) state.lastLocationDice = locationDice;
  if (buildDice.length) state.lastBuildDice = buildDice;

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
