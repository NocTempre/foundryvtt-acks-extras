/* global foundry, game */
/**
 * System compatibility stubs for module-provided actor sub-types, and the
 * family's one owner of the BOOK↔SYSTEM saving-throw key mapping (the
 * builders and repair pass at the bottom of this file).
 *
 * The acks system's `AcksActor` document class runs for EVERY actor, and a few
 * of its methods touch fields unguarded (the rest bail on `type !== "character"`):
 *
 *  - `computeAdditionnalData`   — `initiative.value`, `movement.encounter`
 *                                 (derived from `movement.base`)
 *  - `AcksActor.create`         — seeds `system.isNew`
 *  - the attack throw           — `attack.throw`, `ac.value` on the target, and
 *                                 `getAttackThrowModifiers` / `getDamageModifiers`
 *                                 on the attacker's data model
 *  - the migration runner       — stamps `_schemaVersion` on every actor it
 *                                 visits; a model that does not declare the
 *                                 field drops the stamp and is visited again at
 *                                 every launch.
 *
 * Any actor sub-type a module registers must carry these fields whether or not
 * they mean anything for it.
 *
 * See docs/lib/API.md, "`acksCompatStubs()` / `savingThrowFields()`".
 */

import { ITEM_TYPE } from "./vocab.mjs";
import { unset } from "./util.mjs";
const F = () => foundry.data.fields;
const int = (initial) => new (F().NumberField)({ required: true, integer: true, initial });

/**
 * The fields the system touches on every actor.
 *
 * Spread into a sub-type's `defineSchema()`. A sub-type that has a REAL value
 * for one of these (an animal genuinely has movement and an Armor Class) should
 * spread this first and then declare its own — later keys win, so the stub is
 * only ever a floor.
 *
 * @returns {object} schema fields
 */
export function acksCompatStubs() {
  const { BooleanField, NumberField, SchemaField } = F();
  return {
    _schemaVersion: new NumberField({ required: true, initial: 0, integer: true, min: 0 }),
    isNew: new BooleanField({ initial: false }),
    attack: new SchemaField({
      throw: int(10),
      mod: new SchemaField({
        missile: int(0),
        melee: int(0),
      }),
    }),
    ac: new SchemaField({
      value: int(0),
      mod: int(0),
    }),
    initiative: new SchemaField({
      value: int(0),
      mod: int(0),
    }),
    movement: new SchemaField({
      base: int(0),
      encounter: int(0),
    }),
  };
}

/**
 * The system's five saving throws, for a sub-type that actually saves.
 *
 * Separate from the stubs above because most module actors (a domain, a party,
 * a location) never save and should not pretend to — but a creature does, and
 * it needs the same field paths the system's own monsters use so anything
 * reading a monster's saves reads an animal's identically.
 *
 * @returns {object} schema fields
 */
export function savingThrowFields() {
  const { NumberField, SchemaField } = F();
  const save = (initial) => new SchemaField({ value: new NumberField({ required: true, initial }) });
  return {
    saves: new SchemaField({
      paralysis: save(13),
      death: save(14),
      blast: save(15),
      implements: save(16),
      spell: save(17),
    }),
    save: new SchemaField({ mod: new NumberField({ initial: 0 }) }),
  };
}

/**
 * The attack-throw and damage modifiers a creature data model answers the
 * system's attack throw with: its Tweaks adjustment for the attack's kind, as
 * `CharacterData` and `MonsterData` answer it. Missile and thrown attacks take
 * the missile adjustment.
 *
 * @param {object} system  a data model carrying `attack.mod` and `damage.mod`
 * @param {string} attackType  `melee`, `missile` or `thrown`
 * @returns {{attack: Array<{label: string, value: number}>, damage: Array<{label: string, value: number}>}}
 */
export function creatureAttackModifiers(system, attackType) {
  const missile = attackType === "missile" || attackType === "thrown";
  const side = missile ? "missile" : "melee";
  const L = (key) => (game?.i18n?.localize ? game.i18n.localize(key) : key);
  return {
    attack: [{ label: L(missile ? "ACKS.MissileBonus" : "ACKS.MeleeBonus"), value: Number(system?.attack?.mod?.[side] ?? 0) }],
    damage: [{ label: L(missile ? "ACKS.MissileDamageBonus" : "ACKS.MeleeDamageBonus"), value: Number(system?.damage?.mod?.[side] ?? 0) }],
  };
}

/**
 * Carry a creature's stored source from the fields the system used to name
 * onto the ones it names now: `thac0.throw` → `attack.throw`, `thac0.mod` →
 * `attack.mod`, `aac` → `ac`, and the saves `breath` → `blast`, `wand` →
 * `implements`. Idempotent: a source already on the new names is left as it
 * is, and a value already present under the new name is never overwritten.
 * Called from a module data model's `migrateData`.
 */
export function migrateLegacyCombatSource(source) {
  if (!source || typeof source !== "object") return source;
  const thac0 = source.thac0;
  if (thac0 && typeof thac0 === "object") {
    source.attack ??= {};
    if (source.attack.throw == null && thac0.throw != null) source.attack.throw = thac0.throw;
    if (thac0.mod && typeof thac0.mod === "object") {
      source.attack.mod ??= {};
      for (const side of ["melee", "missile"]) {
        if (source.attack.mod[side] == null && thac0.mod[side] != null) source.attack.mod[side] = thac0.mod[side];
      }
    }
  }
  const aac = source.aac;
  if (aac && typeof aac === "object") {
    source.ac ??= {};
    for (const key of ["value", "mod"]) if (source.ac[key] == null && aac[key] != null) source.ac[key] = aac[key];
  }
  const saves = source.saves;
  if (saves && typeof saves === "object") {
    for (const [from, to] of Object.entries(LEGACY_SAVE_KEYS)) {
      if (saves[from] && typeof saves[from] === "object" && saves[to]?.value == null && saves[from].value != null) {
        saves[to] = { ...(saves[to] ?? {}), value: saves[from].value };
      }
    }
  }
  return source;
}

/* ------------------------------------------------------------------ */
/*  Book ↔ system save keys: the write layer                           */
/* ------------------------------------------------------------------ */

/**
 * The BOOK's five save names → the system's actor keys. ACKS II prints
 * Spells where the schema says `spell`; the other four share their name.
 */
export const BOOK_TO_RELEASED_SAVES = Object.freeze({
  paralysis: "paralysis",
  death: "death",
  blast: "blast",
  implements: "implements",
  spells: "spell",
});

/** Every save key the system's actor schema carries. */
export const RELEASED_SAVE_KEYS = Object.freeze(["paralysis", "death", "blast", "implements", "spell"]);

/**
 * The keys an earlier system schema spelled otherwise, and the key each is
 * now. Blast was stored as `breath`; wands folded into Implements.
 */
export const LEGACY_SAVE_KEYS = Object.freeze({ breath: "blast", wand: "implements" });
// The saving throw a save key rolls, as the conditions name it (`conditions.mjs`
// `SAVE_KINDS`): a current key answers itself, and an earlier schema's `breath`
// or `wand` reaches the Blast or Implements rows, so a stored effect or a world
// not yet migrated still lands on the right throw.
export const saveKindOf = (systemKey) => LEGACY_SAVE_KEYS[systemKey] ?? systemKey;
/**
 * An Active Effect change key under the system's earlier field names, and the
 * key it is now. The system's own migration rewrites stored values and not
 * effect changes, so a key here reaches nothing until it is rewritten.
 */
const LEGACY_CHANGE_KEYS = Object.freeze({
  "system.aac.value": "system.ac.value",
  "system.aac.mod": "system.ac.mod",
  "system.thac0.throw": "system.attack.throw",
  "system.thac0.mod.melee": "system.attack.mod.melee",
  "system.thac0.mod.missile": "system.attack.mod.missile",
  "system.saves.breath.value": "system.saves.blast.value",
  "system.saves.wand.value": "system.saves.implements.value",
});

/** The earlier field roots an effect change key can start with. */
const LEGACY_CHANGE_ROOTS = ["system.aac.", "system.thac0.", "system.saves.breath", "system.saves.wand", "system.surprise.mod", "system.exploration."];

/** Whether a change key names a field the system no longer has. */
export const isLegacyChangeKey = (key) => LEGACY_CHANGE_ROOTS.some((root) => String(key ?? "").startsWith(root));

/**
 * The current key for an earlier one, or null where the field has no
 * counterpart (a derived base attack bonus, a surprise adjustment).
 */
export const migrateChangeKey = (key) => LEGACY_CHANGE_KEYS[String(key ?? "")] ?? null;

/**
 * Update paths for one set of book-vocabulary save values. Null/undefined
 * values are skipped (a band that does not print a cell must not zero the
 * actor), so the result is always safe to spread into a larger update.
 *
 * @param {object} book - `{paralysis, death, blast, implements, spells}`
 * @returns {object} `{"system.saves.<systemKey>.value": number, …}`
 */
export function savesUpdateData(book = {}) {
  const update = {};
  for (const [bookKey, systemKey] of Object.entries(BOOK_TO_RELEASED_SAVES)) {
    const value = book[bookKey];
    if (typeof value === "number" && Number.isFinite(value)) {
      update[`system.saves.${systemKey}.value`] = value;
    }
  }
  return update;
}

/* Aliases a dangling reference may carry: the earlier schema's names, and
 * the book's plural. */
const SAVE_KEY_ALIASES = Object.freeze({ ...LEGACY_SAVE_KEYS, spells: "spell" });

/**
 * Find (and optionally fix) references to save keys the system's schema does
 * not carry: stray `system.saves.breath` / `.wand` data on actors (an earlier
 * schema), ability items whose `system.save` names such a key, and Active
 * Effects whose change keys target an aliased save path.
 *
 * Dry-run by default: returns the report without writing. With
 * `{dryRun: false}` (GM only) each finding is repaired in place and the
 * report says so. Entries: `{uuid, name, kind, from, to, applied}`.
 */
export async function repairSaveReferences({ dryRun = true } = {}) {
  const report = [];
  const canWrite = !dryRun && game.user?.isGM;

  const effectFindings = (doc) => {
    const out = [];
    for (const effect of doc.effects ?? []) {
      (effect.changes ?? []).forEach((change, index) => {
        const m = /^system\.saves\.([a-z]+)\b/.exec(change.key ?? "");
        const alias = m && SAVE_KEY_ALIASES[m[1]];
        if (alias) out.push({ effect, index, from: change.key, to: change.key.replace(`.${m[1]}`, `.${alias}`) });
      });
    }
    return out;
  };

  const scanAbility = async (item) => {
    const save = String(item.system?.save ?? "");
    const alias = SAVE_KEY_ALIASES[save];
    if (alias) {
      const entry = { uuid: item.uuid, name: item.name, kind: "item-save", from: save, to: alias, applied: false };
      if (canWrite) {
        await item.update({ "system.save": alias });
        entry.applied = true;
      }
      report.push(entry);
    }
    for (const f of effectFindings(item)) {
      const entry = { uuid: item.uuid, name: item.name, kind: "effect-key", from: f.from, to: f.to, applied: false };
      if (canWrite) {
        const changes = f.effect.changes.map((c, i) => (i === f.index ? { ...c, key: f.to } : c));
        await f.effect.update({ changes });
        entry.applied = true;
      }
      report.push(entry);
    }
  };

  for (const actor of game.actors ?? []) {
    // Stray earlier-schema keys in the stored source (a schema field would have
    // filtered them; these survive only as loose data on older worlds).
    const savesSource = actor._source?.system?.saves ?? {};
    for (const [key, alias] of Object.entries(SAVE_KEY_ALIASES)) {
      if (!(key in savesSource)) continue;
      const value = savesSource[key]?.value;
      const entry = { uuid: actor.uuid, name: actor.name, kind: "actor-save-key", from: key, to: alias, applied: false };
      if (canWrite) {
        const update = { [`system.saves.${key}`]: unset() };
        if (typeof value === "number") update[`system.saves.${alias}.value`] = value;
        await actor.update(update);
        entry.applied = true;
      }
      report.push(entry);
    }
    for (const f of effectFindings(actor)) {
      const entry = { uuid: actor.uuid, name: actor.name, kind: "effect-key", from: f.from, to: f.to, applied: false };
      if (canWrite) {
        const changes = f.effect.changes.map((c, i) => (i === f.index ? { ...c, key: f.to } : c));
        await f.effect.update({ changes });
        entry.applied = true;
      }
      report.push(entry);
    }
    for (const item of actor.items ?? []) if (item.type === ITEM_TYPE.ability) await scanAbility(item);
  }
  for (const item of game.items ?? []) if (item.type === ITEM_TYPE.ability) await scanAbility(item);

  return report;
}
