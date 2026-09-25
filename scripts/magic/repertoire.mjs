/* global game */
/**
 * Repertoires drawn from the imported spells — what a spellcasting creature
 * carries when the page prints a slot count and no names.
 *
 * Two readers of a slot count and one draw. `slotsFromCells` reads a
 * template grid's slot column ("2 1 - - -") and `slotsOfClass` a class
 * document's grid at a level; both answer `{1: n, …, 6: n}`, which
 * `coreSlotsPatch` writes onto the system's `spells` block and
 * `slotsOfSystem` reads back. `repertoireFor` draws as many spells of each
 * level as the slots say, at random, from the class picker's own list for a
 * class document or from every spell of a tradition when only the tradition
 * is named; `spellPayload` is the embedded copy a creature carries;
 * `spellsByName` resolves a printed name against the world's spells. See
 * docs/magic/DECISIONS.md, "A creature's repertoire is drawn to its slots".
 */
import { MODULE_ID, FLAG_SPELL } from "./constants.mjs";
import { ITEM_TYPE } from "../lib/vocab.mjs";
import { libraryItems } from "../lib/library.mjs";
import { CLASS_TYPE } from "../classes/constants.mjs";
import { choosableSpells } from "../classes/grants.mjs";
import { slotRowAt } from "../classes/casting.mjs";
import { foldKey } from "./spell-logic.mjs";
import { levelUnder, titleIndex } from "./spell-names.mjs";

/** The spell levels the system's slot block carries. */
export const SLOT_LEVELS = Object.freeze([1, 2, 3, 4, 5, 6]);

/**
 * "2 1 - - -" as a slot map: one count per spell level in printed order, a
 * dash or a blank for none. Null when the text holds no count at all.
 */
export function slotsFromCells(text) {
  const cells = String(text ?? "")
    .trim()
    .split(/[\s/|]+/)
    .filter(Boolean);
  const out = {};
  let any = false;
  cells.forEach((cell, i) => {
    const n = /^\d+$/.test(cell) ? parseInt(cell, 10) : 0;
    if (i < SLOT_LEVELS.length && n > 0) {
      out[i + 1] = n;
      any = true;
    }
  });
  return any ? out : null;
}

/**
 * The slots a class grants at `level`: its one tradition's grid, or the
 * arcane one of two — the rule `applyClass` writes core's grid by. Null for
 * a class whose grid says nothing at that level.
 */
export function slotsOfClass(classItem, level) {
  const traditions = classItem?.system?.casting ?? [];
  const source = traditions.length === 1 ? traditions[0] : traditions.find((t) => foldKey(t.key) === "arcane");
  if (!source || (source.kind && source.kind !== "vancian")) return null;
  const row = slotRowAt(source, level);
  if (!row) return null;
  const out = {};
  let any = false;
  for (const n of SLOT_LEVELS) {
    const max = row[`s${n}`];
    if (typeof max === "number" && max > 0) {
      out[n] = max;
      any = true;
    }
  }
  return any ? out : null;
}

/** The system's `spells` block for a slot map: every level's max, enabled when any is set. */
export function coreSlotsPatch(slots) {
  const spells = { enabled: false };
  for (const n of SLOT_LEVELS) {
    const max = slots?.[n] ?? 0;
    spells[n] = { max };
    if (max > 0) spells.enabled = true;
  }
  return { spells };
}

/** The slot map a system `spells` block states, or null when every max is empty. */
export function slotsOfSystem(spells) {
  const out = {};
  let any = false;
  for (const n of SLOT_LEVELS) {
    const max = Number(spells?.[n]?.max ?? 0);
    if (max > 0) {
      out[n] = max;
      any = true;
    }
  }
  return any ? out : null;
}

/** The imported class document a word names — by name or key, the plural of either — or null. */
export function classNamed(name) {
  const k = foldKey(name);
  if (!k) return null;
  const keys = new Set([k, k.replace(/s$/, "")]);
  return (
    libraryItems().find((i) => i.type === CLASS_TYPE && (keys.has(foldKey(i.name)) || keys.has(foldKey(i.system?.key)))) ??
    null
  );
}

/** A class-shaped object for a bare tradition key, so the picker's rules serve it. */
const traditionOnly = (key) => ({ system: { casting: [{ key, label: key, kind: "vancian", slots: [], spellList: [] }] } });

/** A class document for a source word: the class it names, else the tradition it names. */
const casterFor = (source) => (typeof source === "string" ? (classNamed(source) ?? traditionOnly(foldKey(source))) : source);

/** The level a candidate holds under a caster's traditions, for the draw. */
const levelOfFor = (cls) => {
  const keys = new Set((cls?.system?.casting ?? []).flatMap((t) => [foldKey(t.key), foldKey(t.label)]).filter(Boolean));
  return (doc) => levelUnder(doc.flags?.[MODULE_ID]?.[FLAG_SPELL], doc.system?.lvl, keys);
};

/**
 * As many distinct spells of each level as `slots` says, drawn at random
 * from `candidates`; a level with fewer candidates than slots yields what
 * there is. `levelOf` reads a candidate's level; `random` is `Math.random`
 * unless a test supplies its own.
 */
export function drawRepertoire(candidates, slots, { levelOf, random = Math.random } = {}) {
  const out = [];
  for (const [lvl, count] of Object.entries(slots ?? {})) {
    const pool = candidates.filter((c) => levelOf(c) === Number(lvl));
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    out.push(...pool.slice(0, Math.max(0, Math.trunc(count) || 0)));
  }
  return out;
}

/**
 * A creature's repertoire for a `source` — a class document, a class name or
 * a tradition key — and a slot map: the picker's list for that caster at
 * `level` (the class's own list where it has one, capped at what the level
 * casts), drawn to the slots.
 */
export function repertoireFor(source, slots, { level = null, random } = {}) {
  const cls = casterFor(source);
  if (!cls || !slots) return [];
  return drawRepertoire(choosableSpells(cls, { level }), slots, { levelOf: levelOfFor(cls), random });
}

/** The embedded copy of a spell document a creature carries: everything but the identity that belongs to the source. */
export function spellPayload(doc) {
  const data = doc.toObject();
  delete data._id;
  delete data.folder;
  delete data.sort;
  delete data.ownership;
  return data;
}

/**
 * A resolver over the world's spells by printed name — the library's first,
 * then every loaded pack's — so a printed name meets the imported document
 * before a compendium's namesake. A class's own template copy is not a
 * source.
 */
export function spellsByName() {
  const packed = (game.packs ?? [])
    .filter((p) => p.documentName === "Item")
    .flatMap((p) => [...p.contents].filter((i) => i.type === ITEM_TYPE.spell));
  const docs = [
    ...libraryItems().filter((i) => i.type === ITEM_TYPE.spell && !i.flags?.[MODULE_ID]?.templatePart),
    ...packed,
  ];
  const index = titleIndex(docs.map((d) => [d.uuid, d.name]));
  const byUuid = new Map(docs.map((d) => [d.uuid, d]));
  return {
    has: index.has,
    resolve: (name) => {
      const uuid = index.resolve(name);
      return uuid ? (byUuid.get(uuid) ?? null) : null;
    },
  };
}

/**
 * Fill a generated creature's repertoire before it is written: when the
 * resolved payload enables the system's slot block, carries no spell yet,
 * and its spellcasting fields name what it casts as, the slots are drawn
 * from the imported spells and the copies pushed onto its items. Returns
 * how many were drawn.
 */
export function fillGeneratedRepertoire(resolved) {
  const spells = resolved?.system?.spells;
  const slots = spells?.enabled ? slotsOfSystem(spells) : null;
  if (!slots) return 0;
  resolved.items ??= [];
  if (resolved.items.some((i) => i?.type === ITEM_TYPE.spell)) return 0;
  const casting = resolved.flags?.[MODULE_ID]?.extras?.spellcasting ?? {};
  if (!casting.class) return 0;
  const level = Number.isInteger(casting.level) ? casting.level : null;
  const drawn = repertoireFor(casting.class, slots, { level });
  for (const doc of drawn) resolved.items.push(spellPayload(doc));
  return drawn.length;
}
