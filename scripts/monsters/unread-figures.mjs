/**
 * The Statblock's rows for a figure an import's picture read left unread.
 * The actor holds core's value for such a figure; the extras `derived.unread`
 * list (`importer/unread-figures.mjs`) names it with the value it held when
 * created and the page reference. While the actor still holds that value the
 * figure draws blank and its tooltip is the page reference alone; once it is
 * edited it draws as any figure. A row whose actor has no list is untouched.
 * Foundry-free.
 */

/**
 * The unread figures an actor still holds at the value they were created with.
 *
 * @param {{path: string, held: any, cite?: string}[]|undefined} unread the extras `derived.unread` list
 * @param {(path: string) => any} read the actor's value at an actor path
 * @returns {Map<string, string>} each blank figure's actor path to its page reference
 */
export function blankedFigures(unread, read) {
  const blank = new Map();
  if (!Array.isArray(unread)) return blank;
  for (const entry of unread) {
    if (!entry || typeof entry.path !== "string" || !entry.path) continue;
    const now = read(entry.path);
    const held = entry.held ?? null;
    if (held === (now ?? null)) blank.set(entry.path, entry.cite || "");
  }
  return blank;
}

/**
 * Draws the blank figures' rows blank, in place: the figure's text goes, the
 * row's tooltip becomes the page reference, and the row is marked `blank`. The
 * saves, morale, attack throw, hit points and hit dice rows are the Statblock's
 * unread-capable figures; the attack and hit-dice notes read the same figures
 * and go with them.
 *
 * @param {object[][]} columns the Statblock's columns (`statblockColumns`)
 * @param {Map<string, string>} blank from `blankedFigures`
 * @param {Record<string, string>} saveKeys a save row's key to the actor's save key
 */
export function blankUnreadRows(columns, blank, saveKeys = {}) {
  if (!blank?.size) return;
  const groups = Object.fromEntries(columns.flat().map((g) => [g.key, g]));
  const draw = (row, path, { line = false } = {}) => {
    if (!blank.has(path)) return;
    row.value = "";
    if (line) row.line = "";
    row.valueTip = blank.get(path);
    row.blank = true;
  };
  for (const row of groups.saves?.rows ?? []) draw(row, `system.saves.${saveKeys[row.id.slice("save:".length)]}.value`);
  for (const row of groups.reactions?.rows ?? []) if (row.id === "morale") draw(row, "system.details.morale");
  const attacks = groups.attacks;
  if (attacks && blank.has("system.attack.throw")) {
    for (const row of attacks.rows) draw(row, "system.attack.throw");
    attacks.note = "";
    attacks.noteTip = "";
  }
  const hitPoints = groups.hitPoints;
  if (hitPoints) {
    for (const row of hitPoints.rows) {
      if (row.id === "hp") draw(row, "system.hp.value");
      else if (row.id === "hd") draw(row, "system.hp.hd", { line: true });
    }
    if (blank.has("system.hp.hd")) {
      hitPoints.note = "";
      hitPoints.noteTip = "";
    }
  }
}
