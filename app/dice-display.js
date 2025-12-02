export function isNumberedDie(die) {
  if (!die) return false;
  if (typeof die.label === "string") return die.label.startsWith("N");
  // Fallback: unlabeled, treat non-X faces as numbered
  return die.face !== "X";
}

export function isXDie(die) {
  if (!die) return false;
  if (typeof die.label === "string") return die.label.startsWith("X");
  return die.face === "X";
}

// Used only for forced flows (pestilence/forfeit) to keep numbered/windrose dice in Location and X dice in Build.
export function splitForcedDice(dice = []) {
  const locationDice = dice.filter((d) => isNumberedDie(d));
  const buildDice = dice.filter((d) => !isNumberedDie(d));
  return { locationDice, buildDice };
}
