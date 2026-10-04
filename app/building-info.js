/**
 * building-info.js - Pure helper that builds the hover/focus tooltip shown for a
 * building, both in the Buildings/Guilds sheet overlays (`context: "sheet"`) and
 * for buildings placed on the board (`context: "board"`).
 *
 * Kept separate from app.js/rules.js so the tooltip copy can be unit tested without
 * pulling in DOM/game-state code. All strings come from i18n (see `buildingInfo.*`
 * in app/locales/en.js and app/locales/fr.js).
 *
 * `buildingTooltipParts()` returns structured data (name/category/rows) that
 * `renderBuildingTooltip()` turns into DOM (bold name, muted category, a divider,
 * then rows - see assets/css/styles.css's `.rf-popover-*` rules), while
 * `buildingTooltip()` flattens the same parts into the "\n"-joined plain-text
 * string used for the `.rf-popover` accessibility description and for tests.
 */
import { t } from "./i18n.js";
import { BUILDING_RULES, guildTargetFromLabel } from "./rules.js";

/**
 * Builds the structured tooltip content for a building.
 *
 * @param {string} code - base building code (C, B, F, Q, W, P, M, S, T, U, A, G).
 * @param {Object} [options]
 * @param {"sheet"|"board"} [options.context="sheet"] - "sheet" shows the base Labourer
 *   requirement and (for Cottage/Springhouse) the on-build effect, plus a Sum-only/max-built
 *   note for Advanced buildings; "board" shows the Springhouse-adjusted requirement and,
 *   during activation, filled/required.
 * @param {string} [options.guildLabel] - for code "G": which guild slot (GF/GQ/GW/GM).
 *   Omitted for the generic Guild row on the sheet.
 * @param {number} [options.springBoost=0] - board only: this cell's `springBoost`
 *   (Labourer requirement reduction already applied by an adjacent Springhouse).
 * @param {number} [options.filled] - board only, activation mode: Labourers filled so far.
 * @param {Object} [options.buildingOverrides] - active challenge's `rules.buildingOverrides`
 *   (e.g. { W: "P" }), so a guild's target and name follow the swapped building.
 * @param {string} [options.forfeitedNote] - board only, activation mode: a note appended as
 *   a warning row when the cell's Labourer requirement went unfilled and was forfeited.
 * @returns {{name: string, category: string, categoryLabel: string, rows: Array<{kind: string, label: ?string, value: string}>}|null}
 *   `null` for an unknown code.
 */
export function buildingTooltipParts(code, options = {}) {
  const { context = "sheet", guildLabel, springBoost = 0, filled, buildingOverrides = {}, forfeitedNote } = options;
  const rule = BUILDING_RULES[code];
  if (!rule) return null;

  const rows = [];
  rows.push(...labourerRows(code, rule, { context, springBoost, filled }));
  rows.push({ kind: "scoring", label: null, value: scoringText(code, guildLabel, buildingOverrides) });
  if (context === "sheet") {
    if (code === "C") rows.push({ kind: "secondary", label: null, value: t("buildingInfo.onBuildCottage") });
    if (code === "S") rows.push({ kind: "secondary", label: null, value: t("buildingInfo.onBuildSpringhouse") });
    if (rule.category === "advanced") {
      rows.push({
        kind: "secondary",
        label: null,
        value: code === "G" ? t("buildingInfo.guildsNote") : t("buildingInfo.advancedNote"),
      });
    }
  }
  if (context === "board" && forfeitedNote) {
    rows.push({ kind: "warning", label: null, value: forfeitedNote });
  }

  return {
    name: buildingName(code, guildLabel, buildingOverrides),
    category: rule.category,
    categoryLabel: t(`buildingInfo.category.${rule.category}`),
    rows: rows.filter(Boolean),
  };
}

/**
 * Builds the multi-line plain-text tooltip for a building (title line + rows,
 * joined with "\n"; `.rf-popover` renders these with `white-space: pre-line`
 * for the non-rich description, and it backs the `.rf-popover`'s hidden
 * aria-describedby span even when a rich renderer is used).
 *
 * @param {string} code
 * @param {Object} [options] - see `buildingTooltipParts()`.
 * @returns {string}
 */
export function buildingTooltip(code, options = {}) {
  const parts = buildingTooltipParts(code, options);
  if (!parts) return "";
  const title = parts.categoryLabel ? `${parts.name} (${parts.categoryLabel})` : parts.name;
  return [title, ...parts.rows.map(rowToLine)].filter(Boolean).join("\n");
}

/**
 * Renders the rich tooltip DOM for a building into `container` (cleared first),
 * for use as a popover's `render` option (see app/popover.js's `setPopover`).
 *
 * @param {Element} container
 * @param {string} code
 * @param {Object} [options] - see `buildingTooltipParts()`.
 */
export function renderBuildingTooltip(container, code, options = {}) {
  container.textContent = "";
  const parts = buildingTooltipParts(code, options);
  if (!parts) return;

  const title = document.createElement("div");
  title.className = "rf-popover-title";
  const name = document.createElement("strong");
  name.className = "rf-popover-name";
  name.textContent = parts.name;
  title.appendChild(name);
  if (parts.categoryLabel) {
    const category = document.createElement("span");
    category.className = "rf-popover-category";
    category.textContent = `(${parts.categoryLabel})`;
    title.appendChild(category);
  }
  container.appendChild(title);

  const divider = document.createElement("hr");
  divider.className = "rf-popover-divider";
  container.appendChild(divider);

  parts.rows.forEach((row) => {
    const rowEl = document.createElement("div");
    rowEl.className = `rf-popover-row rf-popover-row-${row.kind}`;
    if (row.label) {
      const label = document.createElement("span");
      label.className = "rf-popover-label";
      label.textContent = `${row.label} `;
      rowEl.appendChild(label);
      const value = document.createElement("span");
      value.className = "rf-popover-value";
      value.textContent = row.value;
      rowEl.appendChild(value);
    } else {
      rowEl.textContent = row.value;
    }
    container.appendChild(rowEl);
  });
}

function rowToLine(row) {
  if (!row) return "";
  return row.label ? `${row.label}: ${row.value}` : row.value;
}

function buildingName(code, guildLabel, buildingOverrides) {
  if (code !== "G") return t(`buildings.${code}`);
  const target = guildLabel ? guildTargetFromLabel(guildLabel, buildingOverrides) : null;
  if (!target) return t("buildings.G");
  return t(`buildingInfo.guildNameByTarget.${target}`);
}

function labourerRows(code, rule, { context, springBoost, filled }) {
  const base = rule.requirement || 0;
  if (base === 0) {
    return [{ kind: "labourers", label: null, value: t("buildingInfo.labourersNone") }];
  }
  const label = t("buildingInfo.labels.labourers");
  if (context !== "board") {
    return [{ kind: "labourers", label, value: t("buildingInfo.labourersValue", { req: base }) }];
  }
  const boost = Math.max(0, Number(springBoost) || 0);
  const req = Math.max(0, base - boost);
  const rows = [
    {
      kind: "labourers",
      label,
      value:
        boost > 0
          ? t("buildingInfo.labourersReducedValue", { req, base, boost })
          : t("buildingInfo.labourersValue", { req }),
    },
  ];
  if (typeof filled === "number") {
    rows.push({
      kind: "filled",
      label: t("buildingInfo.labels.filled"),
      value: t("buildingInfo.filledValue", { filled, req }),
    });
  }
  return rows;
}

function scoringText(code, guildLabel, buildingOverrides) {
  if (code !== "G") return t(`buildingInfo.scoring.${code}`);
  const target = guildLabel ? guildTargetFromLabel(guildLabel, buildingOverrides) : null;
  if (!target) return t("buildingInfo.guildConditionGeneric");
  return t(`buildingInfo.guildCondition.${target}`);
}
