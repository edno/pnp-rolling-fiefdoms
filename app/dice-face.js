const svgNS = "http://www.w3.org/2000/svg";

const pipPositions = {
  1: [5],
  2: [1, 9],
  3: [1, 5, 9],
  4: [1, 3, 7, 9],
  5: [1, 3, 5, 7, 9],
  6: [1, 3, 4, 6, 7, 9],
};

function createSvg(tag, attrs = {}) {
  const el = document.createElementNS(svgNS, tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (value !== undefined && value !== null) el.setAttribute(key, String(value));
  });
  return el;
}

function addLabel(svg, text) {
  if (!text) return;
  const label = createSvg("text", {
    x: 6,
    y: 12,
    class: "die-face-label",
  });
  label.textContent = text;
  svg.appendChild(label);
}

function dieShapeAsset(die) {
  const label = typeof die?.label === "string" ? die.label : "";
  const isSpecial = label.startsWith("X");
  return isSpecial ? "assets/img/die-event.svg" : "assets/img/die-windrose.svg";
}

function addDieShape(svg, die) {
  const href = dieShapeAsset(die);
  if (!href) return;
  const shape = createSvg("image", {
    href,
    x: -3.2,
    y: -3.2,
    width: 70.4,
    height: 70.4,
    preserveAspectRatio: "xMidYMid slice",
    class: "die-shape",
  });
  svg.appendChild(shape);
}

function addPips(svg, value) {
  const filled = pipPositions[value] || [];
  const coords = {
    1: [12, 28],
    2: [24, 28],
    3: [36, 28],
    4: [12, 38],
    5: [24, 38],
    6: [36, 38],
    7: [12, 48],
    8: [24, 48],
    9: [36, 48],
  };
  filled.forEach((idx) => {
    const [cx, cy] = coords[idx] || [];
    if (!cx || !cy) return;
    const pip = createSvg("circle", { cx, cy, r: 6, class: "pip pip-svg" });
    svg.appendChild(pip);
  });
}

function addCross(svg) {
  const img = createSvg("image", {
    href: "assets/img/forfeit.svg",
    x: 5,
    y: 17,
    width: 42,
    height: 42,
    class: "die-icon die-icon-forfeit",
    role: "presentation",
  });
  svg.appendChild(img);
}

function addWindrose(svg) {
  const img = createSvg("image", {
    href: "assets/img/windrose.svg",
    x: 3,
    y: 17,
    width: 42,
    height: 42,
    class: "die-icon die-icon-windrose",
    role: "presentation",
  });
  svg.appendChild(img);
}

export function createDieFaceSVG(die, { showLabel = true } = {}) {
  const svg = createSvg("svg", { viewBox: "0 0 64 64", class: "die-face", "aria-hidden": "true" });
  addDieShape(svg, die);
  addLabel(svg, showLabel ? die?.label : null);

  if (die?.face === "X") {
    addCross(svg);
    return svg;
  }
  if (die?.face === "windrose") {
    addWindrose(svg);
    return svg;
  }

  const val = typeof die?.resolved === "number" ? die.resolved : Number(die?.face);
  if (val >= 1 && val <= 6) {
    addPips(svg, val);
  } else {
    const fallback = createSvg("text", { x: 32, y: 36, "text-anchor": "middle", class: "die-fallback" });
    fallback.textContent = "?";
    svg.appendChild(fallback);
  }
  return svg;
}
