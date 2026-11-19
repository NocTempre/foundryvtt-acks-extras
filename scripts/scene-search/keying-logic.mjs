/**
 * Keying a place's things, on plain data: the edits a field of the keying rail
 * makes to the stored list, and the models the rail and the Things here tab
 * draw from. No Foundry, no documents, no dice. Words arrive through `t(key,
 * data)` (every key is under `ROOT` or the screen's own roots) so a suite
 * supplies its own.
 *
 * Every field writes a key the thing already has (`lib/place-things-logic.mjs`):
 * `hidden`, `hint`, and one layer's `check`, `capability`, `anyone`, `tools`,
 * `turns` and `yields.clue`. "Behind a clue" is not a key of the hidden thing:
 * it is the other thing's `yields.reveal` naming this one, so a change of it
 * edits that other thing. Edits are computed against the list AS STORED and
 * name only the keys they change, so a view with a session's dealt lots laid
 * over its layers can never write those lots into the place.
 */
import { LAYER_NAMES } from "../lib/place-things-logic.mjs";
import { CHECK, LAYER } from "./constants.mjs";

/** The lang prefix of every word the rail and the Things here tab say. */
export const ROOT = "ACKS-LOCATION.sceneSearch.keying.";

const SCREEN = "ACKS-LOCATION.sceneSearch.screen.";
const KIND = "ACKS-LOCATION.sceneSearch.kind.";

const isPlain = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const CHECKS = Object.values(CHECK);

/** Why a change writes nothing, each a key under `ROOT` `refusal.`. */
export const KEYING_REFUSAL = Object.freeze({
  GONE: "gone",
  LAYER: "layer",
  CHECK: "check",
  TURNS: "turns",
  FRONT: "front",
  CYCLE: "cycle",
  FIELD: "field",
});

/** A whole number of turns of one or more, else null. */
function turnsOf(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : NaN;
}

/** The keys a thing of this stored list names in its layers' reveals. */
const revealsOf = (thing) => LAYER_NAMES.flatMap((name) => (Array.isArray(thing?.layers?.[name]?.yields?.reveal) ? thing.layers[name].yields.reveal : []));

/**
 * Every thing key a thing reaches by its reveals, directly or through other
 * things' reveals. A clue behind this thing's own reveal chain cannot also be
 * the clue in front of it.
 * @param {Array<{key: string, layers: object}>} items things or entries, each with a `key` and its layers
 * @param {string} from a key
 * @returns {Set<string>}
 */
export function reachedFrom(items, from) {
  const seen = new Set();
  const queue = [from];
  while (queue.length) {
    const at = queue.pop();
    const here = items.find((item) => item.key === at);
    for (const key of revealsOf(here)) {
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push(key);
    }
  }
  return seen;
}

/** The edits that put this thing behind one layer of another thing, or behind none. */
function behindEdits(list, id, ref) {
  const key = `thing:${id}`;
  let frontId = null;
  let frontLayer = null;
  if (ref) {
    [frontId, frontLayer] = String(ref).split(":");
    const front = list.find((thing) => thing.id === frontId);
    if (!front || frontId === id || !LAYER_NAMES.includes(frontLayer)) return { edits: [], refusal: KEYING_REFUSAL.FRONT };
    const items = list.map((thing) => ({ key: `thing:${thing.id}`, layers: thing.layers }));
    if (reachedFrom(items, key).has(`thing:${frontId}`)) return { edits: [], refusal: KEYING_REFUSAL.CYCLE };
  }
  const edits = [];
  for (const thing of list) {
    const layers = {};
    for (const name of LAYER_NAMES) {
      const reveal = Array.isArray(thing.layers[name]?.yields?.reveal) ? thing.layers[name].yields.reveal : [];
      const has = reveal.includes(key);
      const want = thing.id === frontId && name === frontLayer;
      if (has === want) continue;
      const next = want ? [...reveal, key] : reveal.filter((k) => k !== key);
      layers[name] = { yields: { reveal: next.length ? next : null } };
    }
    if (Object.keys(layers).length) edits.push({ id: thing.id, patch: { layers } });
  }
  return { edits, refusal: null };
}

/**
 * The edits one change of the rail makes, from the list as stored: `{edits,
 * refusal}`, `edits` being what lib's `reviseThings` takes and `refusal` a
 * `KEYING_REFUSAL` where the change writes nothing. A change is `{field,
 * layer?, value}`:
 *
 * - `hidden` (boolean) and `hint` (text; blank removes the line);
 * - per layer: `check` (one of `CHECK`; leaving `skill` drops the named
 *   capability, which a search would otherwise ask for), `capability` (a token,
 *   blank removes it), `anyone` (boolean), `clue` (text; blank removes it),
 *   `turns` (a whole number of one or more; blank removes it), `toolAdd` and
 *   `toolRemove` (an item uuid);
 * - `behind`: `"<thing id>:<layer>"` puts this thing behind that layer of that
 *   other thing and takes it from any other it was behind, `""` behind none.
 *
 * @param {object[]} list the place's things as stored
 * @param {string} id the thing being keyed
 * @param {{field: string, layer?: string, value?: *}} change
 */
export function editsFor(list, id, change) {
  const thing = (Array.isArray(list) ? list : []).find((held) => held.id === id);
  if (!thing) return { edits: [], refusal: KEYING_REFUSAL.GONE };
  const { field, layer, value } = change ?? {};
  const one = (patch) => ({ edits: [{ id, patch }], refusal: null });
  if (field === "hidden") return one({ hidden: value === true });
  if (field === "hint") return one({ hint: typeof value === "string" ? value.trim() || null : null });
  if (field === "behind") return behindEdits(list, id, value);
  if (!LAYER_NAMES.includes(layer)) return { edits: [], refusal: KEYING_REFUSAL.LAYER };
  const set = (patch) => one({ layers: { [layer]: patch } });
  const stored = Array.isArray(thing.layers[layer]?.tools) ? thing.layers[layer].tools : [];
  const text = typeof value === "string" ? value.trim() : "";
  switch (field) {
    case "check":
      if (!CHECKS.includes(value)) return { edits: [], refusal: KEYING_REFUSAL.CHECK };
      return set({ check: value, ...(value === CHECK.SKILL ? {} : { capability: null }) });
    case "capability":
      return set({ capability: text || null });
    case "anyone":
      return set({ anyone: value === true });
    case "clue":
      return set({ yields: { clue: text || null } });
    case "turns": {
      const turns = turnsOf(value);
      return Number.isNaN(turns) ? { edits: [], refusal: KEYING_REFUSAL.TURNS } : set({ turns });
    }
    case "toolAdd":
      return text ? set({ tools: [...new Set([...stored, text])] }) : { edits: [], refusal: KEYING_REFUSAL.FIELD };
    case "toolRemove":
      return set({ tools: stored.filter((uuid) => uuid !== text) });
    default:
      return { edits: [], refusal: KEYING_REFUSAL.FIELD };
  }
}

/**
 * The edits that take every reveal of a thing key out of a list: what a
 * removed thing leaves behind, so a later thing given its id is not shown by a
 * clue that named the old one.
 */
export function withoutReveals(list, key) {
  const edits = [];
  for (const thing of Array.isArray(list) ? list : []) {
    const layers = {};
    for (const name of LAYER_NAMES) {
      const reveal = Array.isArray(thing.layers?.[name]?.yields?.reveal) ? thing.layers[name].yields.reveal : [];
      if (!reveal.includes(key)) continue;
      const next = reveal.filter((k) => k !== key);
      layers[name] = { yields: { reveal: next.length ? next : null } };
    }
    if (Object.keys(layers).length) edits.push({ id: thing.id, patch: { layers } });
  }
  return edits;
}

/* -------------------------------------------- */
/*  The rail                                     */
/* -------------------------------------------- */

/** Where an entry that is not a thing of the list came from, as the word under `derived.` that says so. */
const derivedWord = (entry) => (entry.source === "door" ? "door" : entry.source === "oldTrap" ? "oldTrap" : "body");

/** The `how` word of a layer: hastily or methodically. */
const howOf = (name, t) => t(`${SCREEN}how.${name}`);

/** The select the Behind field is: nothing, then every other thing's each layer, minus those that would loop. */
function behindOf(entry, entries, t, names) {
  const reaches = reachedFrom(entries, entry.key);
  const options = [];
  for (const other of entries) {
    if (other.source !== "thing" || other.key === entry.key || reaches.has(other.key)) continue;
    for (const name of LAYER_NAMES) options.push({ value: `${other.id}:${name}`, label: t(`${ROOT}behind.option`, { name: names.get(other.key) ?? "", how: howOf(name, t) }) });
  }
  const current = entries.flatMap((other) => LAYER_NAMES.filter((name) => other.key !== entry.key && other.layers[name].yields.reveal.includes(entry.key)).map((name) => `${other.id}:${name}`))[0] ?? "";
  const listed = options.some((o) => o.value === current);
  const rows = [{ value: "", label: t(`${ROOT}behind.none`) }, ...options];
  return {
    disabled: !entry.hidden,
    value: listed ? current : "",
    options: rows.map((o) => ({ ...o, selected: o.value === (listed ? current : "") })),
  };
}

/** One layer's fields. */
function layerFieldsOf(entry, name, t, { proficiencies, nameOfRef }) {
  const layer = entry.layers[name];
  const checkOptions = [
    { value: CHECK.INSPECT, label: t(`${ROOT}check.inspect`) },
    { value: CHECK.SEARCH, label: t(`${ROOT}check.search.${name}`) },
    { value: CHECK.SKILL, label: t(`${ROOT}check.skill`) },
  ];
  const choices = proficiencies.some((p) => p.token === layer.capability) || !layer.capability ? proficiencies : [...proficiencies, { token: layer.capability, label: String(layer.capability).replace(/^kw:/i, "") }];
  const lots = layer.yields.lots.length;
  const reveals = layer.yields.reveal.length;
  return {
    layer: name,
    legend: t(`${SCREEN}layer.${name}`),
    check: { value: layer.check, options: checkOptions.map((o) => ({ ...o, selected: o.value === layer.check })) },
    skill: layer.check === CHECK.SKILL
      ? {
          value: layer.capability ?? "",
          unnamed: !layer.capability,
          options: [{ value: "", label: t(`${ROOT}skill.none`), selected: !layer.capability }, ...choices.map((p) => ({ value: p.token, label: p.label, selected: p.token === layer.capability }))],
        }
      : null,
    anyone: name === LAYER.HASTY ? { on: layer.anyone } : null,
    clue: layer.yields.clue ?? "",
    held: [
      ...(lots ? [t(`${ROOT}yields.lots.${lots === 1 ? "one" : "many"}`, { n: lots })] : []),
      ...(reveals ? [t(`${ROOT}yields.reveals.${reveals === 1 ? "one" : "many"}`, { n: reveals })] : []),
    ],
    tools: name === LAYER.METHODICAL ? { list: layer.tools.map((uuid) => ({ uuid, name: nameOfRef(uuid) || uuid })) } : null,
    turns: name === LAYER.METHODICAL ? { value: layer.turns ?? "" } : null,
  };
}

/**
 * The keying rail of one entry: its fields as they read now, ready to draw.
 * A thing of the list is keyable; a door, an old-style trap zone or a fight's
 * body is read from elsewhere and the rail says so and holds no field.
 *
 * @param {object} entry one of the scene's entries
 * @param {object[]} entries every entry of the scene, the Judge's view
 * @param {object} input
 * @param {Map<string, string>} input.names the plate name of each entry, by key
 * @param {Array<{token: string, label: string}>} [input.proficiencies] what a Proficiency check may name
 * @param {(uuid: string) => string} [input.nameOfRef] a document's name by uuid
 * @param {(key: string, data?: object) => string} input.t the words
 * @returns {object}
 */
export function railOf(entry, entries, { names, proficiencies = [], nameOfRef = () => "", t }) {
  const name = names.get(entry.key) ?? "";
  const head = { key: entry.key, name, kindWord: t(`${KIND}${entry.kind}`), title: t(`${ROOT}title`, { name }) };
  if (entry.source !== "thing") return { ...head, keyable: false, derivedNote: t(`${ROOT}derived.${derivedWord(entry)}`) };
  const shown = entry.state?.shown === true;
  return {
    ...head,
    keyable: true,
    id: entry.id,
    hidden: entry.hidden,
    canShow: entry.hidden && !shown,
    behind: behindOf(entry, entries, t, names),
    hint: entry.hint ?? "",
    hintPlaceholder: t(`${SCREEN}tell.generic`),
    layers: LAYER_NAMES.map((layerName) => layerFieldsOf(entry, layerName, t, { proficiencies, nameOfRef })),
  };
}

/* -------------------------------------------- */
/*  The Things here tab                          */
/* -------------------------------------------- */

/** One layer's line in a row: how it is made and what it holds. */
function summaryLine(entry, name, t, labelOf) {
  const layer = entry.layers[name];
  const label = layer.capability ? String(labelOf?.(layer.capability) ?? "").trim() || String(layer.capability).replace(/^kw:/i, "") : "";
  const how = layer.check === CHECK.SKILL ? t(`${ROOT}summary.skill`, { name: label || t(`${ROOT}summary.unnamed`) }) : t(`${ROOT}summary.${layer.check}`);
  const parts = [how];
  if (layer.yields.clue) parts.push(t(`${ROOT}summary.clue`));
  if (layer.yields.reveal.length) parts.push(t(`${ROOT}summary.reveal`, { n: layer.yields.reveal.length }));
  if (layer.tools.length) parts.push(t(`${ROOT}summary.tools.${layer.tools.length === 1 ? "one" : "many"}`, { n: layer.tools.length }));
  return t(`${ROOT}summary.layer`, { how: howOf(name, t), parts: parts.join(", ") });
}

/** The words that flag a row, joined. */
function flagOf(entry, t) {
  if (entry.source === "door") return t(`${ROOT}flag.${entry.hidden ? "secretDoor" : "door"}`);
  if (entry.source === "oldTrap") return t(`${ROOT}flag.${entry.hidden ? "oldTrapHidden" : "oldTrap"}`);
  const flags = [];
  if (entry.hidden) flags.push(t(`${ROOT}flag.hidden`));
  if (LAYER_NAMES.some((name) => entry.layers[name].yields.reveal.length)) flags.push(t(`${ROOT}flag.front`));
  if (entry.kind === "lot") flags.push(t(`${ROOT}flag.lot`));
  return flags.join(" · ");
}

/**
 * The Things here tab as two lists: the place's own things, each a row that
 * opens its rail, and what the map says (doors and old-style trap zones, read
 * and never keyed).
 *
 * @param {object[]} entries every entry of the place
 * @param {Map<string, string>} names the plate name of each entry, by key
 * @param {(key: string, data?: object) => string} t the words
 * @param {(token: string) => string} [labelOf] a capability token's label, for a
 *   proficiency check's summary; without one, or where it answers nothing, the
 *   token's own word stands
 * @returns {{things: object[], derived: object[]}}
 */
export function tabOf(entries, names, t, labelOf = null) {
  const row = (entry) => ({
    key: entry.key,
    kindWord: t(`${KIND}${entry.kind}`),
    name: names.get(entry.key) ?? "",
    flag: flagOf(entry, t),
    hidden: entry.hidden,
  });
  return {
    things: entries.filter((e) => e.source === "thing").map((e) => ({ ...row(e), summary: LAYER_NAMES.map((name) => summaryLine(e, name, t, labelOf)).join(" · ") })),
    derived: entries.filter((e) => e.source === "door" || e.source === "oldTrap").map(row),
  };
}
