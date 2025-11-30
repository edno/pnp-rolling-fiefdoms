// Rule helper utilities

// Return unique location pairs (unordered) expanding paired faces (1/2, 4/5) and excluding X
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
  if (die.face === "1/2") return [1, 2];
  if (die.face === "4/5") return [4, 5];
  if (typeof die?.resolved === "number") return [die.resolved];
  return [];
}

// Map build dice to building options (die1, die2, sum)
export const BUILDING_RULES = {
  C: { name: "Cottage", requirement: 0, base: 0, category: "special" },
  F: { name: "Farm", requirement: 2, base: 3, category: "basic" },
  Q: { name: "Quarry", requirement: 2, base: 3, category: "basic" },
  W: { name: "Windmill", requirement: 2, base: 3, category: "basic" },
  M: { name: "Market", requirement: 3, base: 0, category: "basic" },
  S: { name: "Springhouse", requirement: 0, base: 0, category: "special" },
  T: { name: "Townhall", requirement: 4, base: 5, category: "advanced" },
  U: { name: "University", requirement: 3, base: 0, category: "advanced" },
  A: { name: "Almshouse", requirement: 2, base: 0, category: "advanced" },
  G: { name: "Guild", requirement: 4, base: 0, category: "advanced" },
};

export function buildingOptions(buildVals, buildings = BUILDING_RULES) {
  const buildDice = buildVals.map((v) => ({ resolved: v }));
  return buildingOptionsFromDice(buildDice, buildings);
}

// Derive building options from dice objects, allowing paired faces (1/2, 4/5) to stay flexible.
export function buildingOptionsFromDice(buildDice, buildings = BUILDING_RULES) {
  const map = {
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
      const dieLabelA = buildDice[0]?.label || "die A";
      const dieLabelB = buildDice[1]?.label || "die B";
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
              sourceLabel: `sum ${sum}`,
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
export function restrictBuildOptionsForBoard(options, board) {
  if (!Array.isArray(options) || !Array.isArray(board)) return options || [];
  const advancedLimit = new Set(["T", "U", "A"]);
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

export function computeActivationMap(board, populationNodes, workerAllocations = null) {
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
      } else {
        const popAroundCell = popAround(r, c, populationNodes);
        activation.set(key(r, c), popAroundCell >= req);
      }
    }
  }
  return activation;
}

export function computeScore(board, populationNodes, workerAllocations = null) {
  const rows = board.length;
  const cols = board[0]?.length || 0;
  const popTotal = populationNodes.flat().reduce((a, b) => a + b, 0);
  const cottages = board.flat().filter((c) => c.building === "C").length;
  const housing = cottages * 4;
  const forfeitsCount = board.flat().filter((c) => c.forfeited || c.activationForfeit).length;

  const activation = computeActivationMap(board, populationNodes, workerAllocations);

  let scores = {
    cottages: scoreCottages(board, populationNodes),
    farm: 0,
    quarry: 0,
    windmill: 0,
    market: 0,
    springhouse: 0,
    townhall: 0,
    university: 0,
    almshouse: 0,
    guilds: 0,
    forfeits: 0,
    vagrants: -calcVagrants(popTotal, housing),
  };

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = board[r][c];
      if (!cell.building) continue;
      const active = activation.get(key(r, c));
      switch (cell.building) {
        case "F": {
          const base = BUILDING_RULES.F.base;
          const bonus = adjHasBuilding(board, r, c, "S") ? 2 : 0;
          if (active) scores.farm += base + bonus;
          break;
        }
        case "Q": {
          const base = BUILDING_RULES.Q.base;
          const bonus = rowColHas(board, r, c, "Q") ? 1 : 0;
          if (active) scores.quarry += base + bonus;
          break;
        }
        case "W": {
          const base = BUILDING_RULES.W.base;
          const bonus = adjCountBuilding(board, r, c, "W");
          if (active) scores.windmill += base + bonus;
          break;
        }
        case "M": {
          const popAdj = popAround(r, c, populationNodes);
          if (activation.get(key(r, c))) scores.market += popAdj;
          break;
    }
    case "S": {
      if (activation.get(key(r, c))) {
        const base = BUILDING_RULES.S.base;
        const forfeitsAdj = adjCountForfeits(board, r, c);
        scores.springhouse += base - forfeitsAdj;
      }
      break;
    }
        case "T": {
          if (activation.get(key(r, c))) {
            const base = BUILDING_RULES.T.base;
            const uniqueBasics = uniqueBasicsRowCol(board, activation, r, c);
            scores.townhall += base + 2 * uniqueBasics.size;
          }
          break;
        }
        case "U": {
          if (activation.get(key(r, c))) {
            const uniqueAdv = countAdvanced(board);
            scores.university += uniPoints(uniqueAdv);
          }
          break;
        }
        case "A": {
          // Only used to cancel vagrants later
          break;
        }
        case "G": {
          // No base points; handled in guilds
          break;
        }
        default:
          break;
      }
    }
  }

  scores.guilds = guildBonuses(board, activation);

  // Almshouse cancels up to 12 vagrant penalty if active
  const almshouseActive = board.some((row, r) =>
    row.some((cell, c) => cell.building === "A" && activation.get(key(r, c))),
  );
  if (almshouseActive) {
    if (scores.vagrants < 0) {
      scores.vagrants = Math.min(0, scores.vagrants + 12);
    }
  }

  const total =
    scores.cottages +
    scores.farm +
    scores.quarry +
    scores.windmill +
    scores.market +
    scores.springhouse +
    scores.townhall +
    scores.university +
    scores.guilds +
    scores.vagrants;

  return { total, breakdown: scores, pop: popTotal, housing, forfeits: forfeitsCount };
}

function scoreCottages(board, populationNodes) {
  const pop = populationNodes.flat().reduce((a, b) => a + b, 0);
  const cottages = board.flat().filter((c) => c.building === "C").length;
  const occupied = Math.min(cottages, Math.floor(pop / 4));
  return occupied * 2;
}

export function scoreBuildingAt(board, populationNodes, workerAllocations, r, c, activation = null) {
  const cell = board[r]?.[c];
  if (!cell || !cell.building || cell.forfeited || cell.activationForfeit) return 0;
  const actMap = activation || computeActivationMap(board, populationNodes, workerAllocations);
  const active = actMap.get(key(r, c));
  if (!active) return 0;

  switch (cell.building) {
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
      return popAround(r, c, populationNodes);
    }
    case "S": {
      const base = BUILDING_RULES.S.base;
      const forfeitsAdj = adjCountForfeits(board, r, c);
      return base - forfeitsAdj;
    }
    case "T": {
      const base = BUILDING_RULES.T.base;
      const uniqueBasics = uniqueBasicsRowCol(board, actMap, r, c);
      return base + 2 * uniqueBasics.size;
    }
    case "U": {
      const uniqueAdv = countAdvanced(board);
      return uniPoints(uniqueAdv);
    }
    case "A": {
      return 0; // affects vagrants only
    }
    case "G": {
      const target = guildTargetFromLabel((cell.buildingLabel || "G").toUpperCase());
      if (!target) return 0;
      return meetsGuildCondition(board, actMap, target) ? 15 : 0;
    }
    default:
      return 0;
  }
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
  let bonus = 0;
  for (let r = 0; r < board.length; r++) {
    for (let c = 0; c < board[0].length; c++) {
      const cell = board[r][c];
      if (cell.building !== "G") continue;
      const active = activation.get(key(r, c));
      if (!active) continue;
      const guildLabel = (cell.buildingLabel || "G").toUpperCase();
      const target = guildTargetFromLabel(guildLabel);
      if (!target) continue;
      if (meetsGuildCondition(board, activation, target)) {
        bonus += 15;
      }
    }
  }
  return bonus;
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

function guildTargetFromLabel(label) {
  if (label === "GF") return "F";
  if (label === "GQ") return "Q";
  if (label === "GW") return "W";
  if (label === "GM") return "M";
  return null;
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

function key(r, c) {
  return `${r},${c}`;
}

function orthNeighbors(r, c, rows, cols) {
  return [
    [r - 1, c],
    [r + 1, c],
    [r, c - 1],
    [r, c + 1],
  ].filter(([rr, cc]) => rr >= 0 && cc >= 0 && rr < rows && cc < cols);
}

// Pestilence helpers (regions overlap per sheet: forest rows 1-2, marsh rows 4-5, mountain cols 1-2, sea cols 4-5, centre is middle 3x3).
export const pestilenceAssignments = {
  forest: [2, 3],
  sea: [4, 5],
  mountain: [7, 8],
  marsh: [9, 10],
  centre: [6],
};

export function cellSections(r, c, rows = 5, cols = 5) {
  const sections = new Set();
  if (r >= 1 && r <= 3 && c >= 1 && c <= 3) sections.add("centre");
  if (r <= 1) sections.add("forest");
  if (r >= rows - 2) sections.add("marsh");
  if (c <= 1) sections.add("mountain");
  if (c >= cols - 2) sections.add("sea");
  return sections;
}

export function pestilenceSectionForSum(sum) {
  if (sum === 6) return "centre";
  return Object.entries(pestilenceAssignments).find(([, vals]) => vals.includes(sum))?.[0] || null;
}

export function computePestilenceInfo(dice, board) {
  const numbered = dice.filter((d) => d.label && d.label.startsWith("N"));
  const sum = numbered.reduce(
    (acc, d) => acc + (typeof d.resolved === "number" ? d.resolved : 0),
    0,
  );
  const section = pestilenceSectionForSum(sum);
  const targetCells = [];
  if (section) {
    for (let r = 0; r < board.length; r++) {
      for (let c = 0; c < board[0].length; c++) {
        const cell = board[r][c];
        if (cell.building || cell.forfeited) continue;
        if (cellSections(r, c, board.length, board[0].length).has(section)) {
          targetCells.push([r, c]);
        }
      }
    }
  }
  return { sum, section, targetCells };
}

// Convenience helper for UI logic: all valid location pairs for current dice/board.
export function availableLocationPairs(dice, board) {
  return filterAvailablePairs(uniqueLocationPairs(dice), board);
}
