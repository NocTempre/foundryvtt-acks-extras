/**
 * What an adventure NPC's actor holds for a figure its picture read left unread:
 * `unreadRecord` names each such actor figure with the value core gave it, and
 * the sheet draws it blank while the actor still holds it (`monsters/unread-figures.mjs`).
 * Foundry-free.
 */

/**
 * The actor data paths each parse figure stands for: the fields `bindNpc` writes
 * from it; a parent path stands for all beneath it.
 */
export const UNREAD_FIGURES = Object.freeze({
  save: Object.freeze([
    "system.saves.paralysis.value",
    "system.saves.death.value",
    "system.saves.blast.value",
    "system.saves.implements.value",
    "system.saves.spell.value",
  ]),
  hd: Object.freeze(["system.hp.hd"]),
  hp: Object.freeze(["system.hp.value", "system.hp.max"]),
  ac: Object.freeze(["system.ac.value"]),
  ml: Object.freeze(["system.details.morale"]),
  xp: Object.freeze(["system.details.xp"]),
  mv: Object.freeze(["system.movement.base"]),
  atk: Object.freeze(["system.attack.throw"]),
});

/**
 * The actor paths the unread parse paths stand for, each once, in map order.
 */
export function unreadActorPaths(unread) {
  const paths = Array.isArray(unread) ? unread.filter((u) => typeof u === "string" && u) : [];
  const gone = (p) => paths.some((u) => u === p || u.startsWith(`${p}.`) || p.startsWith(`${u}.`));
  const out = new Set();
  for (const [figure, actorPaths] of Object.entries(UNREAD_FIGURES)) if (gone(figure)) for (const p of actorPaths) out.add(p);
  return [...out];
}

/**
 * A parsed stat line's unread paths, with hit points added where the hit dice
 * are unread and none are printed.
 *
 * @param {object|undefined} statline the parse, carrying `unread` and `hp`
 * @returns {string[]}
 */
export function unreadOfStatline(statline) {
  const unread = Array.isArray(statline?.unread) ? statline.unread.filter((u) => typeof u === "string" && u) : [];
  if (statline?.hp == null && unreadActorPaths(unread).includes("system.hp.hd") && !unread.includes("hp")) unread.push("hp");
  return unread;
}

/**
 * The `derived.unread` list for an imported actor: each figure an unread path
 * stands for, with the value the actor held when created and the page reference
 * the tooltip shows. A figure an earlier import listed keeps its listed value, so
 * a repair never takes a Judge's edit for core's; `[]` where nothing is unread.
 *
 * @param {string[]|undefined} unread the statline's `unread` paths
 * @param {(path: string) => any} read the actor's value at an actor path
 * @param {string} [cite] the entry's page reference
 * @param {{path: string, held: any}[]} [earlier] the list an earlier import wrote
 * @returns {{path: string, held: any, cite: string}[]}
 */
export function unreadRecord(unread, read, cite = "", earlier = []) {
  const before = new Map((Array.isArray(earlier) ? earlier : []).filter((e) => typeof e?.path === "string").map((e) => [e.path, e.held ?? null]));
  return unreadActorPaths(unread).map((path) => ({ path, held: before.has(path) ? before.get(path) : read(path) ?? null, cite: cite || "" }));
}
