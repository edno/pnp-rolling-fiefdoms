// Solo challenge definitions (campaign chapters I-VI from the solo-challenges rulebook).
//
// Each challenge is a pure config object: i18n keys for display text, a
// `setup` patch applied once at game start, a `rules` patch consulted by
// game logic during play, an optional `turnLimit`, and a `victory()`
// predicate evaluated against the final score breakdown once the game ends.
//
// Reserved (not yet implemented) extension point for challenges VII/VIII,
// which each replace an existing building with a new one:
//   rules: { buildingOverrides: { C: "barracksConfig" } }

function countBuilding(board, code) {
  return board.flat().filter((cell) => cell.building === code).length;
}

export const CHALLENGES = {
  foundations: {
    id: "foundations",
    difficulty: 1,
    nameKey: "challenges.foundations.name",
    descKey: "challenges.foundations.description",
    setupKeys: [],
    ruleKeys: ["challenges.foundations.rule1", "challenges.foundations.rule2"],
    victoryKeys: ["challenges.foundations.victory1", "challenges.foundations.victory2"],
    setup: {},
    rules: { disabledBuildings: ["T", "U", "A", "G"], forceSplitOnAdvancedSum: true },
    turnLimit: null,
    requiredRP: 40,
    victory(scoreResult, state) {
      const cottages = countBuilding(state.board, "C");
      const repOk = scoreResult.total >= this.requiredRP;
      const cottagesOk = cottages >= 6 && scoreResult.breakdown.cottages >= 12;
      return {
        passed: repOk && cottagesOk,
        reasons: [
          { ok: repOk, textKey: "challenges.reasons.reputation", params: { have: scoreResult.total, need: this.requiredRP } },
          { ok: cottagesOk, textKey: "challenges.reasons.cottages", params: { have: cottages, need: 6 } },
        ],
      };
    },
    liveProgress(scoreResult, state) {
      return { have: countBuilding(state.board, "C"), need: 6, labelKey: "challenges.badgeLabels.cottages" };
    },
  },

  waterRights: {
    id: "waterRights",
    difficulty: 1,
    nameKey: "challenges.waterRights.name",
    descKey: "challenges.waterRights.description",
    setupKeys: [],
    ruleKeys: [],
    victoryKeys: ["challenges.waterRights.victory1", "challenges.waterRights.victory2", "challenges.waterRights.victory3"],
    setup: {},
    rules: {},
    turnLimit: null,
    requiredRP: 60,
    victory(scoreResult, state) {
      const springhouses = countBuilding(state.board, "S");
      const repOk = scoreResult.total >= this.requiredRP;
      const springhousesOk = springhouses >= 3;
      const penaltyOk = scoreResult.breakdown.springhouse === 0;
      return {
        passed: repOk && springhousesOk && penaltyOk,
        reasons: [
          { ok: repOk, textKey: "challenges.reasons.reputation", params: { have: scoreResult.total, need: this.requiredRP } },
          { ok: springhousesOk, textKey: "challenges.reasons.springhouses", params: { have: springhouses, need: 3 } },
          { ok: penaltyOk, textKey: "challenges.reasons.springhousePenalty", params: {} },
        ],
      };
    },
    liveProgress(scoreResult, state) {
      return { have: countBuilding(state.board, "S"), need: 3, labelKey: "challenges.badgeLabels.springhouses" };
    },
  },

  charters: {
    id: "charters",
    difficulty: 2,
    nameKey: "challenges.charters.name",
    descKey: "challenges.charters.description",
    setupKeys: ["challenges.charters.setup1"],
    ruleKeys: [],
    victoryKeys: ["challenges.charters.victory1", "challenges.charters.victory2"],
    setup: { startingInfluence: 1 },
    rules: {},
    turnLimit: null,
    requiredRP: 60,
    victory(scoreResult) {
      const repOk = scoreResult.total >= this.requiredRP;
      const guildsOk = scoreResult.breakdown.guilds >= 30;
      return {
        passed: repOk && guildsOk,
        reasons: [
          { ok: repOk, textKey: "challenges.reasons.reputation", params: { have: scoreResult.total, need: this.requiredRP } },
          { ok: guildsOk, textKey: "challenges.reasons.guilds", params: { have: scoreResult.breakdown.guilds, need: 30 } },
        ],
      };
    },
    liveProgress(scoreResult, state) {
      return { have: countBuilding(state.board, "G"), need: 2, labelKey: "challenges.badgeLabels.guilds" };
    },
  },

  socialContract: {
    id: "socialContract",
    difficulty: 2,
    nameKey: "challenges.socialContract.name",
    descKey: "challenges.socialContract.description",
    setupKeys: ["challenges.socialContract.setup1", "challenges.socialContract.setup2"],
    ruleKeys: ["challenges.socialContract.rule1"],
    victoryKeys: ["challenges.socialContract.victory1", "challenges.socialContract.victory2"],
    setup: { forcedCenterBuilding: { choices: ["T", "GF", "GQ", "GW", "GM"] } },
    rules: {},
    turnLimit: 24,
    requiredRP: 70,
    victory(scoreResult) {
      const vagrantPenalty = Math.abs(scoreResult.breakdown.vagrants);
      const repOk = scoreResult.total >= this.requiredRP;
      const vagrantsOk = vagrantPenalty === 0;
      return {
        passed: repOk && vagrantsOk,
        reasons: [
          { ok: repOk, textKey: "challenges.reasons.reputation", params: { have: scoreResult.total, need: this.requiredRP } },
          { ok: vagrantsOk, textKey: "challenges.reasons.vagrantPenalty", params: { have: vagrantPenalty, need: 0 } },
        ],
      };
    },
    liveProgress(scoreResult) {
      return {
        have: Math.abs(scoreResult.breakdown.vagrants),
        need: 0,
        labelKey: "challenges.badgeLabels.vagrantPenalty",
      };
    },
  },

  enlightenment: {
    id: "enlightenment",
    difficulty: 2,
    nameKey: "challenges.enlightenment.name",
    descKey: "challenges.enlightenment.description",
    setupKeys: [],
    ruleKeys: [],
    victoryKeys: ["challenges.enlightenment.victory1", "challenges.enlightenment.victory2"],
    setup: {},
    rules: {},
    turnLimit: null,
    requiredRP: 80,
    victory(scoreResult) {
      const repOk = scoreResult.total >= this.requiredRP;
      const universityOk = scoreResult.breakdown.university >= 15;
      return {
        passed: repOk && universityOk,
        reasons: [
          { ok: repOk, textKey: "challenges.reasons.reputation", params: { have: scoreResult.total, need: this.requiredRP } },
          { ok: universityOk, textKey: "challenges.reasons.university", params: { have: scoreResult.breakdown.university, need: 15 } },
        ],
      };
    },
    liveProgress(scoreResult) {
      return { have: scoreResult.breakdown.university, need: 15, labelKey: "challenges.badgeLabels.university" };
    },
  },

  embersOfRevolt: {
    id: "embersOfRevolt",
    difficulty: 3,
    nameKey: "challenges.embersOfRevolt.name",
    descKey: "challenges.embersOfRevolt.description",
    setupKeys: [],
    ruleKeys: [
      "challenges.embersOfRevolt.rule1",
      "challenges.embersOfRevolt.rule2",
      "challenges.embersOfRevolt.rule3",
    ],
    victoryKeys: ["challenges.embersOfRevolt.victory1"],
    setup: {},
    rules: { unrestTracking: true },
    turnLimit: null,
    requiredRP: 80,
    victory(scoreResult) {
      const repOk = scoreResult.total >= this.requiredRP;
      return {
        passed: repOk,
        reasons: [{ ok: repOk, textKey: "challenges.reasons.reputation", params: { have: scoreResult.total, need: this.requiredRP } }],
      };
    },
  },
};

export const CHALLENGE_ORDER = [
  "foundations",
  "waterRights",
  "charters",
  "socialContract",
  "enlightenment",
  "embersOfRevolt",
];
