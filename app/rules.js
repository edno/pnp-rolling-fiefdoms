// Rule helper utilities
import { t } from "./i18n.js";

// Return unique location pairs (unordered) expanding flexible faces (windrose, paired faces) and excluding X
export function uniqueLocationPairs(dice) {
  const values = dice.map(possibleValues);
  const set = new Set();
  for (let i = 0; i < values.length; i++) {
    for (let j = i + 1; j < values.length; j++) {
      values[i].forEach((a) => {
        values[j].forEach((b) => {
          const pair = [a, b].sort((x, y) => x - y).join(",");
          set.add(pair);
        });
      });
    }
  }
  return Array.from(set)
    .map((p) => p.split(",").map(Number))
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

// Compute build dice as the remaining numeric dice after selecting a location pair, respecting paired faces.
// Returns both the build dice and the location dice used for the split.
export function computeBuildDice(locPair, dice) {
  const choices = dice.map((d, idx) => ({ idx, vals: possibleValues(d), die: d }));
  const candidates = [];
  for (let i = 0; i < choices.length; i++) {
    for (let j = i + 1; j < choices.length; j++) {
      for (const a of choices[i].vals) {
        for (const b of choices[j].vals) {
          if ((a === locPair[0] && b === locPair[1]) || (a === locPair[1] && b === locPair[0])) {
            const remainingFlex = choices
              .filter((c, idx) => idx !== i && idx !== j)
              .reduce((acc, c) => acc + Math.max(c.vals.length, typeof c.die.resolved === "number" ? 1 : 0), 0);
            const usedFlex = (choices[i].vals.length > 1 ? 1 : 0) + (choices[j].vals.length > 1 ? 1 : 0);
            candidates.push({ used: [choices[i], choices[j]], locValues: [a, b], remainingFlex, usedFlex });
          }
        }
      }
    }
  }
  // Prefer keeping flexible dice (paired faces) for build by choosing the candidate with the most remaining flexibility.
  const best =
    candidates.sort((a, b) => b.remainingFlex - a.remainingFlex || a.usedFlex - b.usedFlex)[0] || null;
  const resolvedDice = dice.map((d) => ({ ...d }));
  if (best) {
    best.used.forEach((u, idx) => {
      resolvedDice[u.idx].resolved = best.locValues[idx];
    });
  }
  const buildDice = resolvedDice.filter((d, idx) => !best?.used.find((u) => u.idx === idx));
  const locationDice = best ? best.used.map((u) => ({ ...resolvedDice[u.idx] })) : [];
  return { buildDice: buildDice.slice(0, 2), locationDice };
}

export function filterAvailablePairs(pairs, board) {
  const rows = board.length;
  const cols = board[0]?.length || 0;
  const isOpen = (r, c) =>
    r >= 0 && c >= 0 && r < rows && c < cols && !board[r][c].building && !board[r][c].forfeited;
  return pairs.filter((pair) => {
    const [a, b] = pair;
    const r1 = a - 1;
    const c1 = b - 1;
    const r2 = b - 1;
    const c2 = a - 1;
    return isOpen(r1, c1) || isOpen(r2, c2);
  });
}

function possibleValues(die) {
  if (!die) return [];
  if (die.face === "windrose") return [1, 2, 3, 4, 5];
  if (Array.isArray(die.choices) && die.choices.length) return die.choices;
  if (typeof die?.resolved === "number") return [die.resolved];
  return [];
}

// Map build dice to building options (die1, die2, sum)
// `name` is a getter so it re-evaluates against the active locale on each
// access, rather than freezing in whatever locale was active when this
// module was first imported.
export const BUILDING_RULES = {
  C: { get name() { return t("buildings.C"); }, requirement: 0, base: 0, category: "special" },
  B: { get name() { return t("buildings.B"); }, requirement: 3, base: 0, category: "basic" },
  F: { get name() { return t("buildings.F"); }, requirement: 2, base: 3, category: "basic" },
  Q: { get name() { return t("buildings.Q"); }, requirement: 2, base: 3, category: "basic" },
  W: { get name() { return t("buildings.W"); }, requirement: 2, base: 3, category: "basic" },
  M: { get name() { return t("buildings.M"); }, requirement: 3, base: 0, category: "basic" },
  S: { get name() { return t("buildings.S"); }, requirement: 0, base: 0, category: "special" },
  T: { get name() { return t("buildings.T"); }, requirement: 4, base: 5, category: "advanced" },
  U: { get name() { return t("buildings.U"); }, requirement: 3, base: 0, category: "advanced" },
  A: { get name() { return t("buildings.A"); }, requirement: 2, base: 0, category: "advanced" },
  G: { get name() { return t("buildings.G"); }, requirement: 4, base: 0, category: "advanced" },
};

const GUILD_LABEL_CONFIG = {
  GF: { target: "F", scoreKey: "guilds-gf" },
  GQ: { target: "Q", scoreKey: "guilds-gq" },
  GW: { target: "W", scoreKey: "guilds-gw" },
  GM: { target: "M", scoreKey: "guilds-gm" },
};

export function buildingOptions(buildVals, buildings = BUILDING_RULES) {
  const buildDice = buildVals.map((v) => ({ resolved: v }));
  return buildingOptionsFromDice(buildDice, buildings);
}

// Derive building options from dice objects, allowing flexible faces (windrose or legacy paired faces) to stay flexible.
// `codeOverrides` lets an active challenge swap one building code for another (e.g. Challenge VII's
// Barracks-replaces-Cottage: { C: "B" }) without touching the die-value mapping itself.
export function buildingOptionsFromDice(buildDice, buildings = BUILDING_RULES, codeOverrides = {}) {
  const baseMap = {
    1: "C",
    2: "F",
    3: "Q",
    4: "W",
    5: "M",
    6: "S",
    7: "T",
    8: "U",
    9: "A",
    10: "G",
  };
  const map = Object.fromEntries(
    Object.entries(baseMap).map(([value, code]) => [value, codeOverrides?.[code] || code]),
  );
  const opts = new Map();
  const valuesPerDie = buildDice.map((die) => {
    const vals = possibleValues(die);
    if (vals.length) return vals;
    if (typeof die.resolved === "number") return [die.resolved];
    return [null];
  });

  const combos = [];
  const dfs = (idx, acc) => {
    if (idx === valuesPerDie.length) {
      combos.push(acc.slice());
      return;
    }
    valuesPerDie[idx].forEach((v) => {
      acc.push(v);
      dfs(idx + 1, acc);
      acc.pop();
    });
  };
  dfs(0, []);

  combos
    .filter((combo) => combo.some((v) => typeof v === "number"))
    .forEach((combo) => {
      const a = combo[0];
      const b = combo[1];
      const dieLabelA = buildDice[0]?.label || t("build.dieAFallback");
      const dieLabelB = buildDice[1]?.label || t("build.dieBFallback");
      const die1 = typeof a === "number" ? map[a] : null;
      const die2 = typeof b === "number" ? map[b] : null;
      if (die1) {
        const key = `die1-${dieLabelA}-${die1}-${b || 0}`;
        if (!opts.has(key))
          opts.set(key, {
            code: die1,
            name: buildings[die1].name,
            source: "die1",
            sourceLabel: `${dieLabelA} (${a})`,
            popGain: typeof b === "number" ? b : 0,
          });
      }
      if (die2 && combo.length > 1) {
        const key = `die2-${dieLabelB}-${die2}-${a || 0}`;
        if (!opts.has(key))
          opts.set(key, {
            code: die2,
            name: buildings[die2].name,
            source: "die2",
            sourceLabel: `${dieLabelB} (${b})`,
            popGain: typeof a === "number" ? a : 0,
          });
      }
      if (typeof a === "number" && typeof b === "number") {
        const sum = a + b;
        const sumCode = map[sum];
        if (sumCode) {
          const key = `sum-${sumCode}`;
          if (!opts.has(key))
            opts.set(key, {
              code: sumCode,
              name: buildings[sumCode].name,
              source: "sum",
              sourceLabel: t("build.sumSource", { sum }),
              popGain: 0,
            });
        }
      }
    });

  return Array.from(opts.values());
}

export function calcVagrants(pop, housing) {
  return Math.max(0, pop - housing);
}

// Filter build options to respect one-per-game advanced buildings (T, U, A) and two guilds max, with unique guild types.
// `disabledCodes` additionally excludes building codes disallowed by an active challenge (e.g. Foundations
// bans all Advanced buildings). Excluding a code here also removes it from `sum` combo options in
// buildingOptionsFromDice, which is how "must use Split instead" (challenge I) is satisfied without
// separate logic: the sum-based advanced-building option simply won't be offered.
export function restrictBuildOptionsForBoard(options, board, disabledCodes = []) {
  if (!Array.isArray(options) || !Array.isArray(board)) return options || [];
  const advancedLimit = new Set(["T", "U", "A"]);
  const disabled = new Set(Array.isArray(disabledCodes) ? disabledCodes : []);
  const builtAdvanced = new Set();
  const builtGuildTypes = new Set();
  let guildCount = 0;
  board.flat().forEach((cell) => {
    if (!cell) return;
    if (advancedLimit.has(cell.building)) {
      builtAdvanced.add(cell.building);
    }
    if (cell.building === "G") {
      guildCount += 1;
      if (cell.buildingLabel) builtGuildTypes.add(String(cell.buildingLabel).toUpperCase());
    }
  });
  const remainingGuildSlots = Math.max(0, 2 - guildCount);
  return options.filter((opt) => {
    if (disabled.has(opt.code)) return false;
    if (advancedLimit.has(opt.code)) return !builtAdvanced.has(opt.code);
    if (opt.code === "G") return remainingGuildSlots > 0 && builtGuildTypes.size < 4;
    return true;
  });
}

// Allocate a population amount onto a single node with a capacity cap. Returns placed count and a new grid.
export function allocatePopulationToNode(popGrid, row, col, amount, cap = 5) {
  if (!Array.isArray(popGrid) || row < 0 || col < 0) return { placed: 0, grid: popGrid };
  const rows = popGrid.length;
  const cols = popGrid[0]?.length || 0;
  if (row >= rows || col >= cols) return { placed: 0, grid: popGrid };
  const current = popGrid[row][col] || 0;
  // Once a node has any population, it cannot be used again.
  if (current > 0) return { placed: 0, grid: popGrid };
  const space = Math.max(0, cap);
  const placed = Math.max(0, Math.min(amount, space));
  const grid = popGrid.map((r) => r.slice());
  grid[row][col] = current + placed;
  return { placed, grid };
}

export function computeActivationMap(
  board,
  populationNodes,
  workerAllocations = null,
  { allowPopulationActivation = true } = {},
) {
  const rows = board.length;
  const cols = board[0]?.length || 0;
  const activation = new Map();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = board[r][c];
      if (!cell.building || cell.forfeited || cell.activationForfeit) {
        activation.set(key(r, c), false);
        continue;
      }
      const rule = BUILDING_RULES[cell.building];
      const springBoost = Math.max(0, Number(cell.springBoost) || 0);
      const req = Math.max(0, rule.requirement - springBoost);
      if (req <= 0) {
        activation.set(key(r, c), true);
        continue;
      }
      if (workerAllocations) {
        const assigned = Math.max(0, workerAllocations?.[r]?.[c] || 0);
        activation.set(key(r, c), assigned >= req);
        continue;
      }
      if (!allowPopulationActivation) {
        activation.set(key(r, c), false);
        continue;
      }
      const popAroundCell = popAround(r, c, populationNodes);
      activation.set(key(r, c), popAroundCell >= req);
    }
  }
  return activation;
}

export function computeScore(board, populationNodes, workerAllocations = null, options = {}) {
  const rows = board.length;
  const cols = board[0]?.length || 0;
  const popTotal = populationNodes.flat().reduce((a, b) => a + b, 0);
  const cottages = board.flat().filter((c) => c.building === "C").length;
  const forfeitsCount = board.flat().filter((c) => c.forfeited || c.activationForfeit).length;

  const activation = computeActivationMap(board, populationNodes, workerAllocations, options);
  // Barracks (Challenge VII) provides 2 Housing units (8 Housing) only once activated, unlike
  // Cottage's flat 4 (its requirement of 0 makes it trivially always active).
  const housing = cottages * 4 + activeBuildingCount(board, activation, "B") * 8;
  const marketAllocations = resolveMarketAllocations(board, populationNodes, activation);
  const nodeToMarket = buildNodeToMarketMap(board, populationNodes, activation);

  let scores = {
    cottages: scoreCottages(board, populationNodes),
    barracks: 0,
    farm: 0,
    quarry: 0,
    windmill: 0,
    market: 0,
    springhouse: 0,
    townhall: 0,
    university: 0,
    guilds: 0,
    "guilds-gf": 0,
    "guilds-gq": 0,
    "guilds-gw": 0,
    "guilds-gm": 0,
    forfeits: 0,
    vagrants: -calcVagrants(popTotal, housing),
  };

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = board[r][c];
      if (!cell.building) continue;
      const points = scoreBuildingCell(board, populationNodes, activation, r, c, {
        marketAllocations,
      });
      switch (cell.building) {
        case "B":
          scores.barracks += points;
          break;
        case "F":
          scores.farm += points;
          break;
        case "Q":
          scores.quarry += points;
          break;
        case "W":
          scores.windmill += points;
          break;
        case "M":
          scores.market += points;
          break;
        case "S":
          scores.springhouse += points;
          break;
        case "T":
          scores.townhall += points;
          break;
        case "U":
          scores.university += points;
          break;
        case "A":
          // Only used to cancel vagrants later
          break;
        case "G":
          // No base points; handled in guilds
          break;
        default:
          break;
      }
    }
  }

  const guildScore = guildBonuses(board, activation);
  scores.guilds = guildScore.total;
  Object.entries(guildScore.breakdown).forEach(([key, val]) => {
    scores[key] = val;
  });

  // Almshouse cancels up to 12 vagrant penalty if active
  const almshouseActive = board.some((row, r) =>
    row.some((cell, c) => cell.building === "A" && activation.get(key(r, c))),
  );
  if (almshouseActive) {
    if (scores.vagrants < 0) {
      scores.vagrants = Math.min(0, scores.vagrants + 12);
    }
  }

  const buildingsTotal =
    scores.cottages +
    scores.barracks +
    scores.farm +
    scores.quarry +
    scores.windmill +
    scores.market +
    scores.springhouse +
    scores.townhall +
    scores.university +
    scores.guilds;
  scores["buildings-total"] = buildingsTotal;

  const total = buildingsTotal + scores.vagrants;

  // Build per-market details
  const marketDetails = [];
  marketAllocations.forEach((points, marketKey) => {
    const [r, c] = marketKey.split(',').map(Number);
    marketDetails.push({ row: r, col: c, points });
  });

  return {
    total,
    breakdown: scores,
    pop: popTotal,
    housing,
    forfeits: forfeitsCount,
    marketDetails,
    nodeToMarket,
  };
}

// Count cells with the given building code that are currently active. Shared by computeScore's
// housing calc and game-state.js's live recalcTracks so both agree on active-Barracks housing.
export function activeBuildingCount(board, activation, code) {
  let count = 0;
  for (let r = 0; r < board.length; r++) {
    for (let c = 0; c < board[0].length; c++) {
      if (board[r][c].building === code && activation.get(key(r, c))) count++;
    }
  }
  return count;
}

function scoreCottages(board, populationNodes) {
  const pop = populationNodes.flat().reduce((a, b) => a + b, 0);
  const cottages = board.flat().filter((c) => c.building === "C").length;
  // Each cottage is worth 2 VP if at least one population exists to occupy it; limit by population count.
  const occupied = Math.min(cottages, pop);
  return occupied * 2;
}

export function scoreBuildingAt(board, populationNodes, workerAllocations, r, c, activation = null) {
  const actMap = activation || computeActivationMap(board, populationNodes, workerAllocations);
  const marketAllocations = resolveMarketAllocations(board, populationNodes, actMap);
  return scoreBuildingCell(board, populationNodes, actMap, r, c, { marketAllocations });
}

function popAround(r, c, popGrid) {
  if (!popGrid?.length) return 0;
  const rows = popGrid.length;
  const cols = popGrid[0]?.length || 0;
  let total = 0;
  [
    [r - 1, c - 1],
    [r - 1, c],
    [r, c - 1],
    [r, c],
  ].forEach(([nr, nc]) => {
    if (nr >= 0 && nc >= 0 && nr < rows && nc < cols) {
      total += popGrid[nr][nc] || 0;
    }
  });
  return total;
}

function resolveMarketAllocations(board, populationNodes, activation = new Map()) {
  const rawTotals = new Map();
  if (!Array.isArray(populationNodes) || !populationNodes.length) return new Map();
  const nodeRows = populationNodes.length;
  const nodeCols = populationNodes[0]?.length || 0;
  for (let nr = 0; nr < nodeRows; nr++) {
    for (let nc = 0; nc < nodeCols; nc++) {
      const popVal = populationNodes[nr][nc] || 0;
      if (!popVal) continue;
      const candidateMarkets = [];
      [
        [nr, nc],
        [nr + 1, nc],
        [nr, nc + 1],
        [nr + 1, nc + 1],
      ].forEach(([br, bc]) => {
        const cell = board[br]?.[bc];
        if (!cell || cell.building !== "M" || cell.forfeited || cell.activationForfeit) return;
        if (activation && !activation.get(key(br, bc))) return;
        candidateMarkets.push([br, bc]);
      });
      if (!candidateMarkets.length) continue;
      candidateMarkets.forEach(([mr, mc]) => {
        const mKey = key(mr, mc);
        rawTotals.set(mKey, (rawTotals.get(mKey) || 0) + popVal);
      });
    }
  }
  const allocations = new Map();
  rawTotals.forEach((val, marketKey) => {
    allocations.set(marketKey, Math.floor(val / 2));
  });
  return allocations;
}

function buildNodeToMarketMap(board, populationNodes, activation = new Map()) {
  const nodeMap = new Map();
  if (!Array.isArray(populationNodes) || !populationNodes.length) return nodeMap;
  const nodeRows = populationNodes.length;
  const nodeCols = populationNodes[0]?.length || 0;
  for (let nr = 0; nr < nodeRows; nr++) {
    for (let nc = 0; nc < nodeCols; nc++) {
      const popVal = populationNodes[nr][nc] || 0;
      if (!popVal) continue;
      const candidateMarkets = [];
      [
        [nr, nc],
        [nr + 1, nc],
        [nr, nc + 1],
        [nr + 1, nc + 1],
      ].forEach(([br, bc]) => {
        const cell = board[br]?.[bc];
        if (!cell || cell.building !== "M" || cell.forfeited || cell.activationForfeit) return;
        if (activation && !activation.get(key(br, bc))) return;
        candidateMarkets.push([br, bc]);
      });
      if (!candidateMarkets.length) continue;
      const nodeKey = key(nr, nc);
      const current = nodeMap.get(nodeKey) || [];
      candidateMarkets.forEach(([mr, mc]) => {
        current.push({ marketRow: mr, marketCol: mc, pop: popVal });
      });
      nodeMap.set(nodeKey, current);
    }
  }
  return nodeMap;
}

function adjHasBuilding(board, r, c, code) {
  return orthNeighbors(r, c, board.length, board[0].length).some(
    ([nr, nc]) => board[nr][nc].building === code,
  );
}

function adjCountBuilding(board, r, c, code) {
  return orthNeighbors(r, c, board.length, board[0].length).filter(
    ([nr, nc]) => board[nr][nc].building === code,
  ).length;
}

function rowColHas(board, r, c, code) {
  return (
    board[r].some((cell, idx) => idx !== c && cell.building === code) ||
    board.some((row, idx) => idx !== r && row[c].building === code)
  );
}

function uniqueBasicsRowCol(board, activation, r, c) {
  const basics = new Set();
  const eligibleTypes = new Set(["basic", "special"]); // include Cottage and Springhouse
  for (let cc = 0; cc < board[0].length; cc++) {
    const cell = board[r][cc];
    if (
      cell.building &&
      eligibleTypes.has(BUILDING_RULES[cell.building].category) &&
      activation.get(key(r, cc))
    ) {
      basics.add(cell.building);
    }
  }
  for (let rr = 0; rr < board.length; rr++) {
    const cell = board[rr][c];
    if (
      cell.building &&
      eligibleTypes.has(BUILDING_RULES[cell.building].category) &&
      activation.get(key(rr, c))
    ) {
      basics.add(cell.building);
    }
  }
  return basics;
}

function countAdvanced(board) {
  const adv = new Set();
  board.flat().forEach((cell) => {
    if (cell.building && BUILDING_RULES[cell.building].category === "advanced") {
      adv.add(cell.building);
    }
  });
  return adv.size;
}

function uniPoints(uniqueAdv) {
  if (uniqueAdv === 0) return 0;
  if (uniqueAdv === 1) return 5;
  if (uniqueAdv === 2) return 8;
  if (uniqueAdv === 3) return 12;
  return 15;
}

function guildBonuses(board, activation) {
  const breakdown = {
    "guilds-gf": 0,
    "guilds-gq": 0,
    "guilds-gw": 0,
    "guilds-gm": 0,
  };
  let total = 0;
  for (let r = 0; r < board.length; r++) {
    for (let c = 0; c < board[0].length; c++) {
      const cell = board[r][c];
      if (cell.building !== "G") continue;
      const active = activation.get(key(r, c));
      if (!active) continue;
      const guildLabel = (cell.buildingLabel || "G").toUpperCase();
      const config = guildConfigForLabel(guildLabel);
      if (!config) continue;
      if (meetsGuildCondition(board, activation, config.target)) {
        breakdown[config.scoreKey] += 15;
        total += 15;
      }
    }
  }
  return { total, breakdown };
}

function maxContiguous(board, activation, code) {
  const rows = board.length;
  const cols = board[0].length;
  const visited = new Set();
  let best = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (visited.has(key(r, c))) continue;
      const cell = board[r][c];
      if (cell.building === code && activation.get(key(r, c))) {
        const size = flood(board, activation, r, c, code, visited);
        best = Math.max(best, size);
      }
    }
  }
  return best;
}

function flood(board, activation, r, c, code, visited) {
  const stack = [[r, c]];
  visited.add(key(r, c));
  let size = 0;
  while (stack.length) {
    const [cr, cc] = stack.pop();
    size++;
    orthNeighbors(cr, cc, board.length, board[0].length).forEach(([nr, nc]) => {
      if (!visited.has(key(nr, nc))) {
        const cell = board[nr][nc];
        if (cell.building === code && activation.get(key(nr, nc))) {
          visited.add(key(nr, nc));
          stack.push([nr, nc]);
        }
      }
    });
  }
  return size;
}

function edgeCount(board, activation, code) {
  const rows = board.length;
  const cols = board[0].length;
  let count = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (r === 0 || c === 0 || r === rows - 1 || c === cols - 1) {
        if (board[r][c].building === code && activation.get(key(r, c))) count++;
      }
    }
  }
  return count;
}

function centerCount(board, activation, code) {
  let count = 0;
  for (let r = 1; r < board.length - 1; r++) {
    for (let c = 1; c < board[0].length - 1; c++) {
      if (board[r][c].building === code && activation.get(key(r, c))) count++;
    }
  }
  return count;
}

function guildConfigForLabel(label) {
  return GUILD_LABEL_CONFIG[label] || null;
}

export function guildTargetFromLabel(label) {
  return guildConfigForLabel(label)?.target || null;
}

function meetsGuildCondition(board, activation, targetCode) {
  switch (targetCode) {
    case "F":
      return maxContiguous(board, activation, "F") >= 4;
    case "Q":
      return maxContiguous(board, activation, "Q") >= 4;
    case "W":
      return edgeCount(board, activation, "W") >= 4;
    case "M":
      return centerCount(board, activation, "M") >= 4;
    default:
      return false;
  }
}

function adjCountForfeits(board, r, c) {
  return orthNeighbors(r, c, board.length, board[0].length).filter(([nr, nc]) => board[nr][nc].forfeited).length;
}

function scoreBuildingCell(board, populationNodes, activation, r, c, { marketAllocations = null } = {}) {
  const cell = board[r]?.[c];
  if (!cell || !cell.building || cell.forfeited || cell.activationForfeit) return 0;
  const active = activation.get(key(r, c));
  if (!active) return 0;

  switch (cell.building) {
    case "B": {
      return isDiagonalPlot(r, c, board.length, board[0].length) ? 5 : 0;
    }
    case "F": {
      const base = BUILDING_RULES.F.base;
      const bonus = adjHasBuilding(board, r, c, "S") ? 2 : 0;
      return base + bonus;
    }
    case "Q": {
      const base = BUILDING_RULES.Q.base;
      const bonus = rowColHas(board, r, c, "Q") ? 1 : 0;
      return base + bonus;
    }
    case "W": {
      const base = BUILDING_RULES.W.base;
      const bonus = adjCountBuilding(board, r, c, "W");
      return base + bonus;
    }
    case "M": {
      if (marketAllocations) {
        return marketAllocations.get(key(r, c)) || 0;
      }
      return popAround(r, c, populationNodes);
    }
    case "S": {
      const base = BUILDING_RULES.S.base;
      const forfeitsAdj = adjCountForfeits(board, r, c);
      return base - forfeitsAdj;
    }
    case "T": {
      const base = BUILDING_RULES.T.base;
      const uniqueBasics = uniqueBasicsRowCol(board, activation, r, c);
      return base + 2 * uniqueBasics.size;
    }
    case "U": {
      const uniqueAdv = countAdvanced(board);
      return uniPoints(uniqueAdv);
    }
    case "A":
      return 0; // affects vagrants only
    case "G": {
      const target = guildTargetFromLabel((cell.buildingLabel || "G").toUpperCase());
      if (!target) return 0;
      return meetsGuildCondition(board, activation, target) ? 15 : 0;
    }
    default:
      return 0;
  }
}

function key(r, c) {
  return `${r},${c}`;
}

// The board's two corner-to-corner diagonals (Challenge VII: Barracks scores only here).
function isDiagonalPlot(r, c, rows, cols) {
  return r === c || r + c === rows - 1;
}

function orthNeighbors(r, c, rows, cols) {
  return [
    [r - 1, c],
    [r + 1, c],
    [r, c - 1],
    [r, c + 1],
  ].filter(([rr, cc]) => rr >= 0 && cc >= 0 && rr < rows && cc < cols);
}

export function computePestilenceInfo(dice) {
  const numbered = dice.filter((d) => d.label && d.label.startsWith("N"));
  const sum = numbered.reduce((acc, d) => {
    if (!d) return acc;
    if (d.face === "windrose") return acc; // windrose counts as 0 during pestilence
    const val = typeof d.resolved === "number" ? d.resolved : 0;
    return acc + val;
  }, 0);
  return { sum, section: null, targetCells: [] };
}

// Convenience helper for UI logic: all valid location pairs for current dice/board.
export function availableLocationPairs(dice, board) {
  return filterAvailablePairs(uniqueLocationPairs(dice), board);
}
