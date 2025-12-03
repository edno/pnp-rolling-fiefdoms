/* @vitest-environment jsdom */

import { describe, expect, it, vi } from "vitest";

// Shared queues used by the dice mock to produce deterministic rolls.
const numberedQueue = [];
const xQueue = [];

vi.mock("../app/dice.js", () => {
  return {
    rollNumberedDie: vi.fn((label) => {
      const entry = numberedQueue.length ? numberedQueue.shift() : 1;
      const face = typeof entry === "object" ? entry.face ?? entry.resolved ?? 1 : entry;
      const resolved = typeof entry === "object" ? entry.resolved ?? face : face;
      const choices = Array.isArray(entry?.choices) ? entry.choices : [];
      return { label, face, resolved, choices };
    }),
    rollXDie: vi.fn((label) => {
      const entry = xQueue.length ? xQueue.shift() : "X";
      const face = typeof entry === "object" ? entry.face ?? entry.resolved ?? "X" : entry;
      const resolved = typeof face === "number" ? face : null;
      return { label, face, resolved, choices: [] };
    }),
    __queues: { numberedQueue, xQueue },
  };
});

const baseHtml = `
  <div id="loadingOverlay"></div>
  <div id="sheet"></div>
  <div id="board"></div>
  <div id="diceView"></div>
  <div id="turnHint"></div>
  <div id="locDicePreview"></div>
  <div id="buildDicePreview"></div>
  <ul id="log"></ul>
  <div id="scoreOverlay"></div>
  <div id="popHousingOverlay"></div>
  <button id="finishActivation"></button>
  <button id="newGameBtn"></button>
  <button id="fullscreenToggle"></button>
  <button id="themeToggle"><span id="themeToggleIcon"></span><span id="themeToggleText"></span></button>
  <div id="actionBanner"></div>
  <span id="turnStatusChip"></span>
  <div id="regionOverlay"></div>
  <button id="rollBtn"></button>
  <input id="fiefdomInput" />
  <div id="buildingsOverlay"></div>
  <div id="guildsOverlay"></div>
`;

async function flushMicrotasks() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function stubEnvironment() {
  document.body.innerHTML = baseHtml;
  document.body.classList.add("loading");
  if (!window.matchMedia) {
    window.matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} });
  }
  class InstantImage {
    set src(val) {
      this._src = val;
      if (typeof this.onload === "function") this.onload();
    }
  }
  // eslint-disable-next-line no-global-assign
  Image = InstantImage;
}

async function setupApp({ numbered = [], x = [], debug = false } = {}) {
  vi.resetModules();
  numberedQueue.length = 0;
  xQueue.length = 0;
  stubEnvironment();
  if (debug) {
    const url = new URL("http://localhost/?debug");
    // eslint-disable-next-line no-global-assign
    location = url;
  }
  const dice = await import("../app/dice.js");
  dice.__queues.numberedQueue.push(...numbered);
  dice.__queues.xQueue.push(...x);
  await import("../app/app.js");
  await flushMicrotasks();
}

function clickDie(idx) {
  const badge = document.querySelector(`.die-badge[data-idx="${idx}"]`);
  if (!badge) throw new Error(`Die badge ${idx} not found`);
  badge.click();
}

function selectBuilding(code, source) {
  const selector = source ? `.building-hit[data-code="${code}"][data-source="${source}"]` : `.building-hit[data-code="${code}"]`;
  const hit = document.querySelector(selector);
  if (!hit) throw new Error(`Building hit ${selector} not found`);
  hit.click();
}

function clickRoll() {
  const btn = document.getElementById("rollBtn");
  if (!btn) throw new Error("Roll button not found");
  btn.click();
}

function clickBoardCell(r, c) {
  const cell = document.querySelector(`.cell[data-row="${r}"][data-col="${c}"]`);
  if (!cell) throw new Error(`Board cell ${r},${c} not found`);
  cell.click();
}

function clickPopNode(r, c) {
  const node = document.querySelector(`.population-node[data-node-row="${r}"][data-node-col="${c}"]`);
  if (!node) throw new Error(`Population node ${r},${c} not found`);
  node.click();
}

function selectGuildType(code) {
  const hit = document.querySelector(`.guild-hit[data-code="${code}"]`);
  if (!hit) throw new Error(`Guild hit ${code} not found`);
  hit.click();
}

function latestLogs() {
  return Array.from(document.querySelectorAll("#log li")).map((li) => li.textContent);
}

describe("pestilence UI flow (jsdom)", () => {
  it("advances after forfeiting during pestilence", async () => {
    await setupApp({
      numbered: [3, 4, 1, 2, 1, 1], // pestilence (sum=7) then a normal roll, plus padding
      x: ["X", "X", 2, 5, 1, 1],
    });
    clickRoll();
    const turnHint = document.getElementById("turnHint");
    expect(turnHint.textContent).toContain("Pestilence");
    const targetCell = document.querySelector('.cell[data-row="0"][data-col="0"]');
    expect(targetCell).toBeTruthy();
    targetCell.click();
    await flushMicrotasks();

    clickRoll(); // next turn roll
    await flushMicrotasks();

    const logs = latestLogs();
    expect(logs.some((m) => m.includes("Forfeited row 1, col 1"))).toBe(true);
    expect(logs.some((m) => /Rolled N1:1, N2:2/i.test(m))).toBe(true);
    expect(document.getElementById("turnHint").textContent).not.toContain("Pestilence");
  });
});

describe("windrose handling (jsdom)", () => {
  it("locks windrose into the location pair and keeps it out of build dice", async () => {
    await setupApp({
      numbered: [{ face: "windrose", resolved: 1, choices: [1, 2, 3, 4, 5] }, 4, 2, 2],
      x: [3, 3, 1, 1],
    });
    clickRoll();

    const windroseBadge = document.querySelector('.die-badge[data-idx="0"]');
    expect(windroseBadge.classList.contains("dice-locked")).toBe(true);
    clickDie(0); // attempt to deselect windrose
    await flushMicrotasks();
    const logsAfterClick = latestLogs();
    expect(logsAfterClick.some((m) => m.includes("Windrose dice must stay in the location pair"))).toBe(true);

    clickDie(1); // complete location selection with another die
    await flushMicrotasks();
    const locBadges = document.querySelectorAll("#locDicePreview .die-badge");
    expect(locBadges.length).toBe(2);
    const buildForced = document.querySelector("#buildDicePreview .dice-locked");
    expect(buildForced).toBeFalsy();
  });
});

describe("pestilence windrose reroll (jsdom)", () => {
  it("rerolls when pestilence shows two windroses and uses the next roll", async () => {
    await setupApp({
      numbered: [
        { face: "windrose", resolved: 0, choices: [1, 2, 3, 4, 5] },
        { face: "windrose", resolved: 0, choices: [1, 2, 3, 4, 5] },
        2,
        3,
      ],
      x: ["X", "X", "X", "X"], // first triggers pestilence, reroll also pestilence but valid
    });
    clickRoll(); // first roll: double windrose -> prompt reroll
    let logs = latestLogs();
    expect(logs.some((m) => m.toLowerCase().includes("double windrose rolled"))).toBe(true);
    expect(document.querySelectorAll("#locDicePreview .die-badge").length).toBe(0);
    expect(document.querySelectorAll("#buildDicePreview .die-badge").length).toBe(0);
    clickRoll(); // reroll manually
    logs = latestLogs();
    expect(logs.some((m) => m.toLowerCase().includes("windrose") && m.toLowerCase().includes("reroll"))).toBe(true);
    expect(document.getElementById("turnHint").textContent).toContain("Pestilence");
    expect(logs.some((m) => m.includes("Rolled N1:2") && m.includes("N2:3"))).toBe(true);
  });

  it("rerolls double windrose even without pestilence", async () => {
    await setupApp({
      numbered: [
        { face: "windrose", resolved: 1, choices: [1, 2, 3, 4, 5] },
        { face: "windrose", resolved: 1, choices: [1, 2, 3, 4, 5] },
        4,
        5,
      ],
      x: [2, 3, 1, 1],
    });
    clickRoll(); // first roll shows double windrose -> no turn started
    let logs = latestLogs();
    expect(logs.some((m) => m.toLowerCase().includes("double windrose rolled"))).toBe(true);
    clickRoll(); // second roll should proceed
    logs = latestLogs();
    expect(logs.some((m) => m.includes("Rolled N1:4") && m.includes("N2:5"))).toBe(true);
  });
});

describe("logging integrity (jsdom)", () => {
  it("logs a single roll entry per normal roll", async () => {
    await setupApp({
      numbered: [1, 2],
      x: [1, 2],
    });
    clickRoll();
    const logs = latestLogs();
    const rolledLogs = logs.filter((m) => m.startsWith("Rolled N1:1, N2:2"));
    expect(rolledLogs).toHaveLength(1);
  });

  it("orders game start < turn status < roll (oldest at bottom)", async () => {
    await setupApp({
      numbered: [5, 2],
      x: [4, 3],
    });
    clickRoll();
    const logs = latestLogs();
    const gameIdx = logs.findIndex((m) => m.includes("Game started."));
    const statusIdx = logs.findIndex((m) => /Active turn\.|Non-active turn\./.test(m));
    const rollIdx = logs.findIndex((m) => m.startsWith("Rolled N1:5, N2:2"));
    expect(rollIdx).toBe(0); // newest first
    expect(statusIdx).toBe(1);
    expect(gameIdx).toBe(2);
  });

  it("resets UI and logs when starting a new game", async () => {
    await setupApp({
      numbered: [3, 4],
      x: [2, 2],
    });
    clickRoll(); // populate dice/logs
    const newGameBtn = document.getElementById("newGameBtn");
    newGameBtn.style.display = "inline-block";
    newGameBtn.click();
    await flushMicrotasks();

    expect(document.querySelectorAll("#diceView .die-badge").length).toBe(0);
    expect(document.querySelector("#locDicePreview").textContent).toContain("Select 2 dice for location");
    expect(document.querySelector("#buildDicePreview").textContent).toContain("Remaining dice used for build");
    const logs = latestLogs();
    expect(logs).toEqual(["Game started."]);
    const actionBanner = document.getElementById("actionBanner");
    expect(actionBanner.textContent).toContain("Press Roll Dice");
  });

  it("clears forfeit/pestilence prompts when restarting via Play again", async () => {
    await setupApp({
      numbered: [2, 3, 1, 1], // pestilence then padding
      x: ["X", "X", 1, 1],
    });

    clickRoll(); // trigger pestilence (forces forfeit prompt)
    expect(document.getElementById("actionBanner").textContent).toContain("Forfeit");
    expect(document.getElementById("turnHint").textContent).toMatch(/forfeit/i);
    const newGameBtn = document.getElementById("newGameBtn");
    newGameBtn.style.display = "inline-block";
    newGameBtn.click();
    await flushMicrotasks();

    const actionBanner = document.getElementById("actionBanner");
    expect(actionBanner.textContent).toContain("Press Roll Dice");
    expect(actionBanner.textContent).not.toContain("Select two location dice");
    expect(actionBanner.textContent).not.toContain("Forfeit");
    expect(document.getElementById("turnHint").textContent.trim()).toBe("");
    expect(document.querySelectorAll("#diceView .die-badge").length).toBe(0);
    expect(document.querySelectorAll("#locDicePreview .die-badge").length).toBe(0);
    expect(document.querySelectorAll("#buildDicePreview .die-badge").length).toBe(0);
    const logs = latestLogs();
    expect(logs).toEqual(["Game started."]);
  });

  it("orders logs as status -> roll -> windrose for windrose rolls", async () => {
    await setupApp({
      numbered: [{ face: "windrose", resolved: 1, choices: [1, 2, 3, 4, 5] }, 4],
      x: [2, 3],
    });
    clickRoll();
    const logs = latestLogs();
    const statusIdx = logs.findIndex((m) => m.startsWith("Active turn."));
    const rollIdx = logs.findIndex((m) => m.startsWith("Rolled N1:windrose, N2:4"));
    const windroseIdx = logs.findIndex((m) => m.includes("Windrose rolled"));
    expect(windroseIdx).toBe(0); // newest
    expect(rollIdx).toBeGreaterThan(windroseIdx);
    expect(statusIdx).toBeGreaterThan(rollIdx);
  });

  it("logs a single roll entry for each double-windrose reroll attempt", async () => {
    await setupApp({
      numbered: [
        { face: "windrose", resolved: 1, choices: [1, 2, 3, 4, 5] },
        { face: "windrose", resolved: 1, choices: [1, 2, 3, 4, 5] },
        4,
        5,
      ],
      x: [2, 3, 1, 1],
    });
    clickRoll(); // double windrose -> reroll prompt
    let logs = latestLogs();
    const firstRolls = logs.filter((m) => m.startsWith("Rolled N1:windrose, N2:windrose"));
    expect(firstRolls).toHaveLength(1);
    const rollIdx = logs.findIndex((m) => m.startsWith("Rolled N1:windrose, N2:windrose"));
    const promptIdx = logs.findIndex((m) => m.toLowerCase().includes("double windrose rolled"));
    expect(promptIdx).toBeGreaterThan(-1);
    expect(promptIdx).toBeLessThan(rollIdx); // newest first

    clickRoll(); // valid roll
    logs = latestLogs();
    expect(logs.filter((m) => m.startsWith("Rolled N1:4, N2:5"))).toHaveLength(1);
    const statusIdx = logs.findIndex((m) => /Active turn|Non-active turn/.test(m));
    const rollIdxValid = logs.findIndex((m) => m.startsWith("Rolled N1:4, N2:5"));
    expect(rollIdxValid).toBe(0); // newest
    expect(statusIdx).toBeGreaterThan(rollIdxValid);
  });

  it("orders windrose and double-windrose reroll messages correctly", async () => {
    await setupApp({
      numbered: [
        2,
        { face: "windrose", resolved: 1, choices: [1, 2, 3, 4, 5] },
        { face: "windrose", resolved: 1, choices: [1, 2, 3, 4, 5] }, // double windrose -> reroll
        { face: "windrose", resolved: 1, choices: [1, 2, 3, 4, 5] },
        { face: "windrose", resolved: 1, choices: [1, 2, 3, 4, 5] },
        1,
      ],
      x: [3, "X", "X", 4, 1],
      debug: true, // allow multiple rolls without turn progression for ordering check
    });

    clickRoll(); // first roll windrose+2
    let logs = latestLogs();
    const firstRollIdx = logs.findIndex((m) => m.startsWith("Rolled N1:2, N2:windrose"));
    const firstWindroseIdx = logs.findIndex((m) => m.includes("Windrose rolled"));
    const firstStatusIdx = logs.findIndex((m) => /Active turn|Non-active turn/.test(m));
    expect(firstWindroseIdx).toBe(0);
    expect(firstRollIdx).toBeGreaterThan(firstWindroseIdx);
    expect(firstStatusIdx).toBeGreaterThan(firstRollIdx);

    clickRoll(); // double windrose -> prompt reroll
    logs = latestLogs();
    const doubleRollIdx = logs.findIndex((m) => m.startsWith("Rolled N1:windrose, N2:windrose"));
    const doublePromptIdx = logs.findIndex((m) => m.toLowerCase().includes("double windrose rolled"));
    expect(doubleRollIdx).toBeGreaterThan(-1);
    expect(doublePromptIdx).toBeGreaterThan(-1);
    expect(doublePromptIdx).toBeLessThan(doubleRollIdx); // prompt newer than its roll

    clickRoll(); // reroll resolves (order should keep windrose message older than the roll)
    logs = latestLogs();
    const rerollRollIdx = logs.findIndex((m) => m.startsWith("Rolled N1:"));
    const rerollWindroseIdx = logs.findIndex((m, idx) => idx < rerollRollIdx && m.includes("Windrose rolled"));
    expect(rerollRollIdx).toBeGreaterThan(-1);
    expect(rerollWindroseIdx).toBeGreaterThan(-1);
    expect(rerollWindroseIdx).toBeLessThan(rerollRollIdx);
  });

  it("keeps windrose newer than roll and status on non-active turns", async () => {
    await setupApp({
      numbered: [3, 3, { face: "windrose", resolved: 1, choices: [1, 2, 3, 4, 5] }, 1],
      x: [2, 2, 3, 4],
      debug: true,
    });
    clickRoll(); // roll 1 (active), ignore ordering
    clickRoll(); // roll 2 should be non-active with windrose
    const logs = latestLogs();
    const windroseIdx = logs.findIndex((m) => m.includes("Windrose rolled"));
    const rollIdx = logs.findIndex((m) => m.startsWith("Rolled N1:windrose, N2:1"));
    const statusIdx = logs.findIndex((m) => /Non-active turn/.test(m));
    expect(windroseIdx).toBe(0);
    expect(rollIdx).toBeGreaterThan(windroseIdx);
    expect(statusIdx).toBeGreaterThan(rollIdx);
  });
});

describe("turn status chip (jsdom)", () => {
  it("is hidden before the first roll", async () => {
    await setupApp();
    const chip = document.getElementById("turnStatusChip");
    expect(chip).toBeTruthy();
    expect(chip.classList.contains("hidden")).toBe(true);
  });

  it("shows Active after the first roll and Non-active after the next", async () => {
    await setupApp({ numbered: [2, 3, 4, 5, 1, 1], x: [1, 1, 1, 1, 1, 1], debug: true });
    const chip = document.getElementById("turnStatusChip");
    clickRoll();
    await flushMicrotasks();
    expect(chip.classList.contains("hidden")).toBe(false);
    expect(chip.textContent).toContain("Active turn");
    clickRoll(); // debug mode allows immediate next roll; turn index advances
    await flushMicrotasks();
    expect(chip.textContent).toContain("Non-active turn");
  });
});

describe("guild selection (jsdom)", () => {
  it("requires choosing a guild type before placement", async () => {
    await setupApp({
      numbered: [2, 3, 1, 1], // guild roll then padding
      x: [5, 5, 1, 1], // build dice 5/5 -> Guild via sum 10
    });
    clickRoll();

    clickDie(0);
    clickDie(1);
    await flushMicrotasks();
    selectBuilding("G", "sum");
    const logsAfterSelect = latestLogs();
    expect(logsAfterSelect.some((m) => m.includes("Select a guild type"))).toBe(true);

    selectGuildType("GF");
    clickBoardCell(1, 2); // place Guild
    await flushMicrotasks();

    const logs = latestLogs();
    expect(logs.some((m) => m.includes("Placed FG at row 2, col 3"))).toBe(true);
  });
});

describe("springhouse targeting (jsdom)", () => {
  it("allows selecting an adjacent building for the Springhouse effect", async () => {
    await setupApp({
      numbered: [1, 3, 1, 2], // roll 1: Townhall, roll 2: Springhouse (sum 6)
      x: [4, 3, 5, 1], // roll 1 build dice 4/3 -> Townhall (sum 7), roll 2 build dice 5/1 -> Springhouse
    });
    clickRoll(); // first roll

    // First roll: place a Windmill at row 1, col 3 (pair 1/3)
    clickDie(0); // select N1
    clickDie(1); // select N2
    await flushMicrotasks();
    selectBuilding("T");
    clickBoardCell(0, 2);
    await flushMicrotasks(); // end of turn 1
    const logsAfterWindmill = latestLogs();
    expect(logsAfterWindmill.some((m) => m.includes("Placed T at row 1, col 3"))).toBe(true);

    // Roll for Springhouse
    const rollBtn = document.getElementById("rollBtn");
    rollBtn.click(); // roll 2 (Springhouse)
    await flushMicrotasks();

    // Third roll: place Springhouse adjacent (row 1, col 2) and target the Windmill
    clickDie(0);
    clickDie(1);
    await flushMicrotasks();
    selectBuilding("S");
    clickBoardCell(0, 1);
    await flushMicrotasks();
    const logsAfterSpringPlacement = latestLogs();
    // Debug helper: uncomment to inspect logs when troubleshooting failures
    expect(logsAfterSpringPlacement.some((m) => m.includes("Placed S at row 1, col 2"))).toBe(true);
    expect(logsAfterSpringPlacement.some((m) => m.includes("Choose an adjacent building"))).toBe(true);
    clickBoardCell(0, 2); // target the Windmill for the boost
    await flushMicrotasks();

    const logs = latestLogs();
    expect(logs.some((m) => m.includes("Springhouse reduced worker requirement for row 1, col 3 by 1."))).toBe(
      true,
    );
  });
});

describe("split population placement (jsdom)", () => {
  it("prompts and accepts population placement for split builds", async () => {
    await setupApp({
      numbered: [2, 3, 1, 1], // location pair 2/3, padding roll 2
      x: [5, 3, 1, 1], // build dice 5/3 -> choose Market via die1, pop gain 3
    });
    clickRoll();

    clickDie(0);
    clickDie(1);
    await flushMicrotasks();
    selectBuilding("M", "die1");
    clickBoardCell(1, 2);
    await flushMicrotasks();

    const logsAfterBuild = latestLogs();
    expect(logsAfterBuild.some((m) => m.includes("Place 3 population"))).toBe(true);
    clickPopNode(0, 1);
    await flushMicrotasks();

    const node = document.querySelector('.population-node[data-node-row="0"][data-node-col="1"]');
    const pips = node?.querySelectorAll(".node-pip") || [];
    expect(pips.length).toBe(3);
    const logs = latestLogs();
    expect(logs.some((m) => m.includes("Placed 3 population"))).toBe(true);
  });
});

describe("score overlay display (jsdom)", () => {
  it("shows a negative sign for negative reputation totals", async () => {
    await setupApp({
      numbered: [2, 3],
      x: [5, 3],
    });
    clickRoll();

    clickDie(0);
    clickDie(1);
    await flushMicrotasks();
    selectBuilding("M", "die1");
    clickBoardCell(1, 2);
    await flushMicrotasks();

    clickPopNode(0, 1);
    await flushMicrotasks();

    const reputationChip = document.getElementById("score-chip-reputation");
    expect(reputationChip).toBeTruthy();
    expect(reputationChip.textContent.trim()).toBe("-3");
  });
});
