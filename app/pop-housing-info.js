/**
 * pop-housing-info.js - Pure helper that builds the hover/focus tooltip shown for the
 * player sheet's Population & Housing section (the pip track with the Cottage/Barracks
 * housing outlines).
 *
 * Mirrors app/building-info.js's shape (parts + plain-text + DOM renderer) so it can
 * reuse the same `.rf-popover-*` CSS and the same `setPopover(el, text, { render })`
 * wiring (see app/popover.js), and so the copy can be unit tested without pulling in
 * DOM/game-state code. All strings come from i18n (see `popHousingInfo.*` in
 * app/locales/en.js and app/locales/fr.js).
 */
import { t } from "./i18n.js";

/**
 * Builds the structured tooltip content for the Population & Housing section.
 *
 * @param {number} pop - current Population.
 * @param {number} housing - current Housing (in Population-equivalent units; see
 *   rules.js's computeScore, where housing = cottages*4 + active Barracks*8).
 * @param {number} vagrants - current Vagrants (Population above Housing).
 * @param {Object} [options]
 * @param {Object} [options.buildingOverrides] - active challenge's `rules.buildingOverrides`
 *   (e.g. { C: "B" } during Challenge VII, where Barracks replaces Cottage).
 * @returns {{title: string, stats: Array<{label: string, value: string, warning: boolean}>,
 *   rows: Array<{kind: string, value: string}>}}
 */
export function popHousingTooltipParts(pop = 0, housing = 0, vagrants = 0, options = {}) {
  const { buildingOverrides = {} } = options;
  const isBarracksChallenge = buildingOverrides?.C === "B";

  const stats = [
    { label: t("popHousingInfo.labels.population"), value: String(pop), warning: false },
    { label: t("popHousingInfo.labels.housing"), value: String(housing), warning: false },
    { label: t("popHousingInfo.labels.vagrants"), value: String(vagrants), warning: vagrants > 0 },
  ];

  const rows = [
    { kind: "body", value: isBarracksChallenge ? t("popHousingInfo.barracksLine") : t("popHousingInfo.cottageLine") },
    { kind: "body", value: t("popHousingInfo.vagrantLine") },
    { kind: "secondary", value: t("popHousingInfo.influenceNote") },
  ];

  return { title: t("popHousingInfo.title"), stats, rows };
}

/**
 * Builds the multi-line plain-text tooltip (title line + stats line + body/secondary
 * rows, joined with "\n"; see app/building-info.js's buildingTooltip() for the same
 * convention used by `.rf-popover`'s hidden aria-describedby span).
 *
 * @param {number} pop
 * @param {number} housing
 * @param {number} vagrants
 * @param {Object} [options] - see `popHousingTooltipParts()`.
 * @returns {string}
 */
export function popHousingTooltip(pop = 0, housing = 0, vagrants = 0, options = {}) {
  const parts = popHousingTooltipParts(pop, housing, vagrants, options);
  const statsLine = parts.stats.map((s) => `${s.label} ${s.value}`).join(" · ");
  return [parts.title, statsLine, ...parts.rows.map((row) => row.value)].join("\n");
}

/**
 * Renders the rich tooltip DOM for the Population & Housing section into `container`
 * (cleared first), for use as a popover's `render` option (see app/popover.js's
 * `setPopover`).
 *
 * @param {Element} container
 * @param {number} pop
 * @param {number} housing
 * @param {number} vagrants
 * @param {Object} [options] - see `popHousingTooltipParts()`.
 */
export function renderPopHousingTooltip(container, pop = 0, housing = 0, vagrants = 0, options = {}) {
  container.textContent = "";
  const parts = popHousingTooltipParts(pop, housing, vagrants, options);

  const title = document.createElement("div");
  title.className = "rf-popover-title";
  const name = document.createElement("strong");
  name.className = "rf-popover-name";
  name.textContent = parts.title;
  title.appendChild(name);
  container.appendChild(title);

  const divider = document.createElement("hr");
  divider.className = "rf-popover-divider";
  container.appendChild(divider);

  const statsRow = document.createElement("div");
  statsRow.className = "rf-popover-row rf-popover-row-stats";
  parts.stats.forEach((stat, i) => {
    if (i > 0) {
      statsRow.appendChild(document.createTextNode(" · "));
    }
    const label = document.createElement("span");
    label.className = "rf-popover-label";
    label.textContent = `${stat.label} `;
    statsRow.appendChild(label);
    const value = document.createElement("span");
    value.className = stat.warning ? "rf-popover-value rf-popover-value-warning" : "rf-popover-value";
    value.textContent = stat.value;
    statsRow.appendChild(value);
  });
  container.appendChild(statsRow);

  parts.rows.forEach((row) => {
    const rowEl = document.createElement("div");
    rowEl.className = `rf-popover-row rf-popover-row-${row.kind}`;
    rowEl.textContent = row.value;
    container.appendChild(rowEl);
  });
}
