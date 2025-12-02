export function getCryptoRange(min, max) {
  try {
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
      const range = max - min + 1;
      const mBits = Math.ceil(Math.log2(range));
      const mBytes = Math.ceil(mBits / 8);
      const nAllowed = Math.floor(256 ** mBytes / range) * range;
      const arBytes = new Uint8Array(mBytes);
      let value;
      do {
        crypto.getRandomValues(arBytes);
        value = arBytes.reduce((acc, x, n) => acc + x * 256 ** n, 0);
      } while (value >= nAllowed);
      return min + (value % range);
    }
  } catch (err) {
    console.warn("Crypto random unavailable, falling back to Math.random()", err);
  }
  return min + Math.floor(Math.random() * (max - min + 1));
}

export function rollNumberedDie(label) {
  const WINDROSE = "windrose";
  const faces = [1, 2, 3, 4, 5, WINDROSE];
  const face = faces[getCryptoRange(0, faces.length - 1)];
  const choices = face === WINDROSE ? [1, 2, 3, 4, 5] : [];
  const resolved = choices.length ? choices[0] : face;
  return { label, face, choices, resolved };
}

export function rollXDie(label) {
  const faces = [1, 2, 3, 4, 5, "X"];
  const face = faces[getCryptoRange(0, faces.length - 1)];
  return { label, face, choices: [], resolved: typeof face === "number" ? face : null };
}
