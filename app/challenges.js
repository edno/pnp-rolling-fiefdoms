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
    nameKey: "challenges.foundations.name",
    descKey: "challenges.foundations.description",
    victoryKeys: ["challenges.foundations.victory1", "challenges.foundations.victory2"],
    setup: {},
    rules: { disabledBuildings: ["T", "U", "A", "G"], forceSplitOnAdvancedSum: true },
    turnLimit: null,
    victory(scoreResult, state) {
      const cottages = countBuilding(state.board, "C");
      const repOk = scoreResult.total >= 40;
      const cottagesOk = cottages >= 6 && scoreResult.breakdown.cottages >= 12;
      return {
        passed: repOk && cottagesOk,
        reasons: [
          { ok: repOk, textKey: "challenges.reasons.reputation", params: { have: scoreResult.total, need: 40 } },
          { ok: cottagesOk, textKey: "challenges.reasons.cottages", params: { have: cottages, need: 6 } },
        ],
      };
    },
  },

  waterRights: {
    id: "waterRights",
    nameKey: "challenges.waterRights.name",
    descKey: "challenges.waterRights.description",
    victoryKeys: ["challenges.waterRights.victory1", "challenges.waterRights.victory2", "challenges.waterRights.victory3"],
    setup: {},
    rules: {},
    turnLimit: null,
    victory(scoreResult, state) {
      const springhouses = countBuilding(state.board, "S");
      const repOk = scoreResult.total >= 60;
      const springhousesOk = springhouses >= 3;
      const penaltyOk = scoreResult.breakdown.springhouse >= 0;
      return {
        passed: repOk && springhousesOk && penaltyOk,
        reasons: [
          { ok: repOk, textKey: "challenges.reasons.reputation", params: { have: scoreResult.total, need: 60 } },
          { ok: springhousesOk, textKey: "challenges.reasons.springhouses", params: { have: springhouses, need: 3 } },
          { ok: penaltyOk, textKey: "challenges.reasons.springhousePenalty", params: {} },
        ],
      };
    },
  },

  charters: {
    id: "charters",
    nameKey: "challenges.charters.name",
    descKey: "challenges.charters.description",
    victoryKeys: ["challenges.charters.victory1", "challenges.charters.victory2"],
    setup: { startingInfluence: 1 },
    rules: {},
    turnLimit: null,
    victory(scoreResult) {
      const repOk = scoreResult.total >= 60;
      const guildsOk = scoreResult.breakdown.guilds >= 30;
      return {
        passed: repOk && guildsOk,
        reasons: [
          { ok: repOk, textKey: "challenges.reasons.reputation", params: { have: scoreResult.total, need: 60 } },
          { ok: guildsOk, textKey: "challenges.reasons.guilds", params: { have: scoreResult.breakdown.guilds, need: 30 } },
        ],
      };
    },
  },

  socialContract: {
    id: "socialContract",
    nameKey: "challenges.socialContract.name",
    descKey: "challenges.socialContract.description",
    victoryKeys: ["challenges.socialContract.victory1", "challenges.socialContract.victory2"],
    setup: { forcedCenterBuilding: { code: "G", guildType: "GF" } },
    rules: {},
    turnLimit: 24,
    victory(scoreResult) {
      const repOk = scoreResult.total >= 70;
      const vagrantsOk = scoreResult.breakdown.vagrants >= 0;
      return {
        passed: repOk && vagrantsOk,
        reasons: [
          { ok: repOk, textKey: "challenges.reasons.reputation", params: { have: scoreResult.total, need: 70 } },
          { ok: vagrantsOk, textKey: "challenges.reasons.vagrantPenalty", params: {} },
        ],
      };
    },
  },

  enlightenment: {
    id: "enlightenment",
    nameKey: "challenges.enlightenment.name",
    descKey: "challenges.enlightenment.description",
    victoryKeys: ["challenges.enlightenment.victory1", "challenges.enlightenment.victory2"],
    setup: {},
    rules: {},
    turnLimit: null,
    victory(scoreResult) {
      const repOk = scoreResult.total >= 80;
      const universityOk = scoreResult.breakdown.university >= 15;
      return {
        passed: repOk && universityOk,
        reasons: [
          { ok: repOk, textKey: "challenges.reasons.reputation", params: { have: scoreResult.total, need: 80 } },
          { ok: universityOk, textKey: "challenges.reasons.university", params: { have: scoreResult.breakdown.university, need: 15 } },
        ],
      };
    },
  },

  embersOfRevolt: {
    id: "embersOfRevolt",
    nameKey: "challenges.embersOfRevolt.name",
    descKey: "challenges.embersOfRevolt.description",
    victoryKeys: ["challenges.embersOfRevolt.victory1"],
    setup: {},
    rules: { unrestTracking: true },
    turnLimit: null,
    victory(scoreResult) {
      const repOk = scoreResult.total >= 80;
      return {
        passed: repOk,
        reasons: [{ ok: repOk, textKey: "challenges.reasons.reputation", params: { have: scoreResult.total, need: 80 } }],
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
