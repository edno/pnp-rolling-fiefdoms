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

function addPips(svg, value) {
  const filled = pipPositions[value] || [];
  const coords = {
    1: [14, 14],
    2: [32, 14],
    3: [50, 14],
    4: [14, 32],
    5: [32, 32],
    6: [50, 32],
    7: [14, 50],
    8: [32, 50],
    9: [50, 50],
  };
  filled.forEach((idx) => {
    const [cx, cy] = coords[idx] || [];
    if (!cx || !cy) return;
    const pip = createSvg("circle", { cx, cy, r: 8, class: "pip pip-svg" });
    svg.appendChild(pip);
  });
}

function addCross(svg) {
  const img = createSvg("image", {
    href: "assets/img/forfeit.svg",
    x: 5,
    y: 5,
    width: 54,
    height: 54,
    class: "die-icon die-icon-forfeit",
    role: "presentation",
  });
  svg.appendChild(img);
}

function addWindrose(svg) {
  const img = createSvg("image", {
    href: "assets/img/windrose.svg",
    x: 5,
    y: 5,
    width: 54,
    height: 54,
    class: "die-icon die-icon-windrose",
    role: "presentation",
  });
  svg.appendChild(img);
}

export function createDieFaceSVG(die, { showLabel = true } = {}) {
  const svg = createSvg("svg", { viewBox: "0 0 64 64", class: "die-face", "aria-hidden": "true" });
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
