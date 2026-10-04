/**
 * building-info.js - Pure helper that builds the hover/focus tooltip text shown
 * for a building, both in the Buildings/Guilds sheet overlays (`context: "sheet"`)
 * and for buildings placed on the board (`context: "board"`).
 *
 * Kept separate from app.js/rules.js so the tooltip copy can be unit tested without
 * pulling in DOM/game-state code. All strings come from i18n (see `buildingInfo.*`
 * in app/locales/en.js and app/locales/fr.js).
 */
import { t } from "./i18n.js";
import { BUILDING_RULES, guildTargetFromLabel } from "./rules.js";

/**
 * Builds the multi-line tooltip text for a building.
 *
 * @param {string} code - base building code (C, B, F, Q, W, P, M, S, T, U, A, G).
 * @param {Object} [options]
 * @param {"sheet"|"board"} [options.context="sheet"] - "sheet" shows the base worker
 *   requirement and (for Springhouse) the on-build effect; "board" shows the
 *   Springhouse-adjusted requirement and, during activation, filled/required.
 * @param {string} [options.guildLabel] - for code "G": which guild slot (GF/GQ/GW/GM).
 *   Omitted for the generic Guild row on the sheet.
 * @param {number} [options.springBoost=0] - board only: this cell's `springBoost`
 *   (worker requirement reduction already applied by an adjacent Springhouse).
 * @param {number} [options.filled] - board only, activation mode: workers filled so far.
 * @param {Object} [options.buildingOverrides] - active challenge's `rules.buildingOverrides`
 *   (e.g. { W: "P" }), so a guild's target and name follow the swapped building.
 * @returns {string} tooltip text, lines joined with "\n" (`.rf-popover` renders
 *   these with `white-space: pre-line`).
 */
export function buildingTooltip(code, options = {}) {
  const { context = "sheet", guildLabel, springBoost = 0, filled, buildingOverrides = {} } = options;
  const rule = BUILDING_RULES[code];
  if (!rule) return "";

  const lines = [];
  lines.push(buildingName(code, guildLabel, buildingOverrides));
  lines.push(...workersLines(code, rule, { context, springBoost, filled }));
  lines.push(scoringLine(code, guildLabel, buildingOverrides));
  if (context === "sheet") {
    if (code === "S") lines.push(t("buildingInfo.onBuildSpringhouse"));
    if (rule.category === "advanced") {
      lines.push(code === "G" ? t("buildingInfo.guildsLimit") : t("buildingInfo.onceBuilt"));
    }
  }
  return lines.filter(Boolean).join("\n");
}

function buildingName(code, guildLabel, buildingOverrides) {
  if (code !== "G") return t(`buildings.${code}`);
  const target = guildLabel ? guildTargetFromLabel(guildLabel, buildingOverrides) : null;
  if (!target) return t("buildings.G");
  return t(`buildingInfo.guildNameByTarget.${target}`);
}

function workersLines(code, rule, { context, springBoost, filled }) {
  const base = rule.requirement || 0;
  if (context !== "board") {
    return [t("buildingInfo.workers", { req: base })];
  }
  const boost = Math.max(0, Number(springBoost) || 0);
  const req = Math.max(0, base - boost);
  const lines = [
    boost > 0 ? t("buildingInfo.workersReduced", { req, base, boost }) : t("buildingInfo.workers", { req }),
  ];
  if (typeof filled === "number") {
    lines.push(t("buildingInfo.filled", { filled, req }));
  }
  return lines;
}

function scoringLine(code, guildLabel, buildingOverrides) {
  if (code !== "G") return t(`buildingInfo.scoring.${code}`);
  const target = guildLabel ? guildTargetFromLabel(guildLabel, buildingOverrides) : null;
  if (!target) return t("buildingInfo.guildConditionGeneric");
  return t(`buildingInfo.guildCondition.${target}`);
}
