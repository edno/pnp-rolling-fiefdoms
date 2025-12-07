const DEFAULT_ICE_SERVERS = [{ urls: ["stun:stun.l.google.com:19302"] }];
const CHANNEL_LABEL = "rolling-fiefdoms-sync";
const INVITE_VERSION = 1;
const ICE_GATHER_TIMEOUT_MS = 8000;

function supportsWebRTC() {
  return typeof RTCPeerConnection !== "undefined" && typeof RTCSessionDescription !== "undefined";
}

function safeBase64Encode(str) {
  try {
    if (typeof btoa === "function") return btoa(unescape(encodeURIComponent(str)));
  } catch (err) {
    // continue to fallback
  }
  const buf = typeof globalThis !== "undefined" ? globalThis.Buffer : undefined;
  if (buf) {
    return buf.from(str, "utf-8").toString("base64");
  }
  throw new Error("No base64 encoder available");
}

function safeBase64Decode(str) {
  try {
    if (typeof atob === "function") return decodeURIComponent(escape(atob(str)));
  } catch (err) {
    // continue to fallback
  }
  const buf = typeof globalThis !== "undefined" ? globalThis.Buffer : undefined;
  if (buf) {
    return buf.from(str, "base64").toString("utf-8");
  }
  throw new Error("No base64 decoder available");
}

function encodeExchange(payload) {
  return safeBase64Encode(JSON.stringify(payload));
}

function decodeExchange(text) {
  try {
    return JSON.parse(safeBase64Decode(text.trim()));
  } catch (err) {
    return null;
  }
}

async function waitForIceGathering(pc, timeoutMs = ICE_GATHER_TIMEOUT_MS) {
  if (!pc) return [];
  if (pc.iceGatheringState === "complete") return pc.localDescription ? pc.localDescription.sdp : [];
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pc.onicegatheringstatechange = null;
      resolve(pc.localDescription ? pc.localDescription.sdp : []);
    }, timeoutMs);
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === "complete") {
        clearTimeout(timeout);
        pc.onicegatheringstatechange = null;
        resolve(pc.localDescription ? pc.localDescription.sdp : []);
      }
    };
  });
}

function randomId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `session-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
}

function addIceCandidates(pc, ice = []) {
  if (!pc || !ice?.length) return Promise.resolve();
  const tasks = ice.map((candidate) => {
    if (!candidate) return Promise.resolve();
    try {
      return pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      return Promise.resolve();
    }
  });
  return Promise.all(tasks);
}

export function createManualP2P({ onLog, onStatus, onMessage, captureState, iceServers = DEFAULT_ICE_SERVERS } = {}) {
  const supported = supportsWebRTC();
  const status = {
    supported,
    role: "idle",
    channelOpen: false,
    connectionState: "new",
    sessionId: null,
    lastError: null,
  };
  if (!supported) {
    const unsupportedResult = (error = "WebRTC is not available in this browser.") => ({ error });
    const noop = () => unsupportedResult();
    return {
      supported: false,
      startHosting: noop,
      acceptInvite: noop,
      applyAnswer: noop,
      disconnect: () => {},
      sendMessage: () => unsupportedResult(),
      getStatus: () => ({ ...status }),
    };
  }

  let pc = null;
  let channel = null;
  let secret = "";
  let awaitingAnswer = false;
  let gatheredIce = [];

  const emitStatus = (next = {}) => {
    Object.assign(status, next);
    if (typeof onStatus === "function") onStatus({ ...status });
  };

  const log = (msg) => {
    if (typeof onLog === "function") onLog(msg);
  };

  function reset(reason = "") {
    if (channel) {
      try {
        channel.close();
      } catch (err) {
        // ignore
      }
    }
    if (pc) {
      try {
        pc.close();
      } catch (err) {
        // ignore
      }
    }
    pc = null;
    channel = null;
    secret = "";
    awaitingAnswer = false;
    gatheredIce = [];
    emitStatus({
      role: "idle",
      channelOpen: false,
      connectionState: "new",
      sessionId: null,
      lastError: reason || null,
    });
  }

  function sendPayload(type, payload = {}) {
    if (!channel || channel.readyState !== "open") {
      return { error: "Channel is not open." };
    }
    try {
      const message = { type, payload, ts: Date.now() };
      channel.send(JSON.stringify(message));
      return { ok: true };
    } catch (err) {
      return { error: err.message || "Unable to send message." };
    }
  }

  function wirePeerEvents(currentPc) {
    currentPc.onconnectionstatechange = () => {
      emitStatus({ connectionState: currentPc.connectionState });
    };
    currentPc.oniceconnectionstatechange = () => {
      emitStatus({ connectionState: currentPc.iceConnectionState });
    };
  }

  function wireChannelEvents(currentChannel) {
    currentChannel.onopen = () => {
      emitStatus({ channelOpen: true });
      const snapshot = typeof captureState === "function" ? captureState() : {};
      sendPayload("hello", { sessionId: status.sessionId, snapshot });
      log("[P2P] Data channel open.");
    };
    currentChannel.onclose = () => {
      emitStatus({ channelOpen: false });
      log("[P2P] Data channel closed.");
    };
    currentChannel.onerror = (err) => {
      emitStatus({ channelOpen: false, lastError: err?.message || "Channel error" });
      log("[P2P] Channel error.");
    };
    currentChannel.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        if (typeof onMessage === "function") onMessage(parsed);
      } catch (err) {
        log("[P2P] Received unreadable message.");
      }
    };
  }

  async function buildExchangePayload(type) {
    const sdpText = await waitForIceGathering(pc);
    const local = pc?.localDescription;
    const payload = {
      version: INVITE_VERSION,
      type,
      sdp: local?.sdp || sdpText || "",
      sdpType: local?.type || type,
      ice: gatheredIce,
      sessionId: status.sessionId,
      secret: secret || "",
    };
    return encodeExchange(payload);
  }

  async function startHosting(inputSecret = "") {
    reset();
    secret = inputSecret?.trim() || "";
    status.sessionId = randomId();
    emitStatus({ role: "host", lastError: null, sessionId: status.sessionId });
    pc = new RTCPeerConnection({ iceServers });
    channel = pc.createDataChannel(CHANNEL_LABEL, { ordered: true });
    wireChannelEvents(channel);
    wirePeerEvents(pc);
    pc.onicecandidate = (evt) => {
      if (evt.candidate) {
        gatheredIce.push(evt.candidate.toJSON ? evt.candidate.toJSON() : evt.candidate);
      }
    };
    const offer = await pc.createOffer({ offerToReceiveAudio: false, offerToReceiveVideo: false, iceRestart: true });
    await pc.setLocalDescription(offer);
    awaitingAnswer = true;
    const code = await buildExchangePayload("offer");
    log("[P2P] Invite ready. Share the code and await an answer.");
    return { code, sessionId: status.sessionId };
  }

  async function acceptInvite(code, inputSecret = "") {
    reset();
    secret = inputSecret?.trim() || "";
    const parsed = decodeExchange(code);
    if (!parsed || parsed.type !== "offer" || !parsed.sdp) {
      return { error: "Invalid invite code." };
    }
    if (parsed.secret !== secret) {
      return { error: "Invite passcode mismatch." };
    }
    status.sessionId = parsed.sessionId || randomId();
    emitStatus({ role: "join", sessionId: status.sessionId, lastError: null });
    pc = new RTCPeerConnection({ iceServers });
    wirePeerEvents(pc);
    gatheredIce = [];
    pc.onicecandidate = (evt) => {
      if (evt.candidate) {
        gatheredIce.push(evt.candidate.toJSON ? evt.candidate.toJSON() : evt.candidate);
      }
    };
    pc.ondatachannel = (evt) => {
      channel = evt.channel;
      wireChannelEvents(channel);
    };
    await pc.setRemoteDescription(new RTCSessionDescription({ type: parsed.sdpType || "offer", sdp: parsed.sdp }));
    await addIceCandidates(pc, parsed.ice);
    const answer = await pc.createAnswer({ offerToReceiveAudio: false, offerToReceiveVideo: false });
    await pc.setLocalDescription(answer);
    const answerCode = await buildExchangePayload("answer");
    log("[P2P] Answer created. Send this back to the host.");
    return { code: answerCode, sessionId: status.sessionId };
  }

  async function applyAnswer(code, inputSecret = "") {
    if (!awaitingAnswer || status.role !== "host" || !pc) {
      return { error: "No pending host session to accept an answer." };
    }
    const parsed = decodeExchange(code);
    if (!parsed || parsed.type !== "answer" || !parsed.sdp) {
      return { error: "Invalid answer code." };
    }
    if (parsed.sessionId !== status.sessionId) {
      return { error: "Answer does not match the current invite." };
    }
    if ((parsed.secret || "") !== (secret || "")) {
      return { error: "Answer passcode mismatch." };
    }
    await pc.setRemoteDescription(new RTCSessionDescription({ type: parsed.sdpType || "answer", sdp: parsed.sdp }));
    await addIceCandidates(pc, parsed.ice);
    awaitingAnswer = false;
    emitStatus({ lastError: null });
    log("[P2P] Answer applied. Waiting for channel to open.");
    return { ok: true };
  }

  return {
    supported: true,
    startHosting,
    acceptInvite,
    applyAnswer,
    encodeForShare: encodeExchange,
    decodeFromShare: decodeExchange,
    disconnect: (reason = "") => reset(reason),
    sendMessage: sendPayload,
    getStatus: () => ({ ...status }),
  };
}
