/**
 * What an adventure NPC's actor holds for a figure its picture read left
 * unread. A row's `unread` paths (`picture-text.mjs`) name parse figures the
 * import writes nothing for (`bindNpc`), so the actor shows the value core
 * gave the field at creation. `unreadRecord` names each such actor figure with
 * that value, and the sheet draws the figure blank while the actor still holds
 * it (`monsters/unread-figures.mjs`). Foundry-free.
 */

/**
 * The actor data paths each parse figure stands for: the fields `bindNpc`
 * writes from it. A path into the parse (`save.level`, `atk.throw`) stands for
 * the figure it sits under, and a figure's parent stands for all of them.
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
 * A path the map does not know stands for nothing.
 */
export function unreadActorPaths(unread) {
  const paths = Array.isArray(unread) ? unread.filter((u) => typeof u === "string" && u) : [];
  const gone = (p) => paths.some((u) => u === p || u.startsWith(`${p}.`) || p.startsWith(`${u}.`));
  const out = new Set();
  for (const [figure, actorPaths] of Object.entries(UNREAD_FIGURES)) if (gone(figure)) for (const p of actorPaths) out.add(p);
  return [...out];
}

/**
 * A parsed stat line's unread parse paths, with the hit points added where the
 * hit dice are unread and no hit points are printed: `bindNpc` then binds
 * neither, so both are core's.
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
 * The `derived.unread` list for an imported actor: each actor figure an unread
 * parse path stands for, with the value the actor held there when created and
 * the page reference the sheet's tooltip shows. A figure an earlier import
 * already listed keeps the value listed then, so a repair over a Judge's edit
 * does not take the edit for core's value; any other is read off the document
 * (`read(path)`). `[]` where nothing is unread.
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
