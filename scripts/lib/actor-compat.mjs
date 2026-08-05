/* global foundry, game */
/**
 * System compatibility stubs for module-provided actor sub-types, and the
 * family's one owner of the BOOK↔RELEASED saving-throw key mapping (the
 * builders and repair pass at the bottom of this file).
 *
 * The acks system's `AcksActor` document class runs for EVERY actor, and a few
 * of its methods touch fields unguarded (the rest bail on `type !== "character"`):
 *
 *  - `computeAAB`               — `thac0.bba = 10 - thac0.throw`
 *  - `computeAdditionnalData`   — `initiative.value`, `movement.encounter`
 *                                 (derived from `movement.base`)
 *  - `AcksActor.create`         — seeds `system.isNew`
 *  - the setup-time `updateWeightsLanguages` sweep, whose `updateImplements()`
 *    reads `system.saves.implements` / `.wand` on every actor in the world.
 *    Without the stub it throws and aborts the system's own ready work — so a
 *    single module actor with an incomplete schema breaks the whole world, not
 *    just that actor.
 *
 * So any actor sub-type a module registers must carry these fields whether or
 * not they mean anything for it. This is the family's ONE definition of that
 * set: acks-domains, acks-formation and acks-henchmen each grew their own copy
 * (four in total, already drifting), and a system patch that four modules
 * maintain separately is one system update away from three of them being wrong.
 *
 * `saves` values are 0 rather than -1 deliberately: that makes the system's
 * implements/wand migration a no-op on these actors.
 *
 * @see docs/API.md — "actorCompat"
 */

const F = () => foundry.data.fields;
const int = (initial) => new (F().NumberField)({ required: true, integer: true, initial });

/**
 * The fields the system touches on every actor.
 *
 * Spread into a sub-type's `defineSchema()`. A sub-type that has a REAL value
 * for one of these (an animal genuinely has movement and saving throws) should
 * spread this first and then declare its own — later keys win, so the stub is
 * only ever a floor.
 *
 * @returns {object} schema fields
 */
export function acksCompatStubs() {
  const { BooleanField, SchemaField } = F();
  return {
    isNew: new BooleanField({ initial: false }),
    thac0: new SchemaField({
      throw: int(10),
      bba: int(0),
    }),
    initiative: new SchemaField({
      value: int(0),
      mod: int(0),
    }),
    movement: new SchemaField({
      base: int(0),
      encounter: int(0),
    }),
    saves: new SchemaField({
      implements: new SchemaField({ value: int(0) }),
      wand: new SchemaField({ value: int(0) }),
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
  // Keys and initials mirror the RELEASED acks system's saving-throw schema
  // exactly, verified live against a fresh monster in acks 14.0.1:
  // {paralysis:13, death:14, breath:15, implements:16, spell:17, wand:16} + save.mod.
  // So an animal reuses the system's monster SHEET with every save field present
  // (the sheet reads `saves.breath` and `saves.wand`; a `blast` key — the
  // system's DEV-branch rename that has NOT shipped — would leave the sheet's
  // Blast box blank and add a stray field). Flip breath→blast and drop wand
  // only when the system RELEASES that migration; the modules target the
  // released system, not its dev branch.
  const save = (initial) => new SchemaField({ value: new NumberField({ required: true, initial }) });
  return {
    saves: new SchemaField({
      paralysis: save(13),
      death: save(14),
      breath: save(15),
      implements: save(16),
      spell: save(17),
      wand: save(16),
    }),
    save: new SchemaField({ mod: new NumberField({ initial: 0 }) }),
  };
}

/* ------------------------------------------------------------------ */
/*  Book ↔ released save keys: the write layer                         */
/* ------------------------------------------------------------------ */

/**
 * The BOOK's five save names → the RELEASED system's actor keys. ACKS II
 * prints Blast where the released schema still says `breath`, and Spells
 * where it says `spell`; `wand` has no book column (wands folded into
 * Implements) and is deliberately not written. When the system releases its
 * breath→blast rename, this map is the one place that changes.
 */
export const BOOK_TO_RELEASED_SAVES = Object.freeze({
  paralysis: "paralysis",
  death: "death",
  blast: "breath",
  implements: "implements",
  spells: "spell",
});

/** Every save key the released actor schema carries. */
export const RELEASED_SAVE_KEYS = Object.freeze(["paralysis", "death", "breath", "implements", "spell", "wand"]);

/**
 * Update paths for one set of book-vocabulary save values. Null/undefined
 * values are skipped (a band that does not print a cell must not zero the
 * actor), so the result is always safe to spread into a larger update.
 *
 * @param {object} book - `{paralysis, death, blast, implements, spells}`
 * @returns {object} `{"system.saves.<releasedKey>.value": number, …}`
 */
export function savesUpdateData(book = {}) {
  const update = {};
  for (const [bookKey, releasedKey] of Object.entries(BOOK_TO_RELEASED_SAVES)) {
    const value = book[bookKey];
    if (typeof value === "number" && Number.isFinite(value)) {
      update[`system.saves.${releasedKey}.value`] = value;
    }
  }
  return update;
}

/* Aliases a dangling reference may carry: the book/dev-branch names for keys
 * the released schema spells differently. `wand` stays: it is released. */
const SAVE_KEY_ALIASES = Object.freeze({ blast: "breath", spells: "spell" });

/**
 * Find (and optionally fix) references to save keys the released schema does
 * not carry: stray `system.saves.blast` data on actors (dev-schema drift),
 * ability items whose `system.save` names a book key, and Active Effects
 * whose change keys target an aliased save path.
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
    // Stray dev-schema keys in the stored source (a schema field would have
    // filtered them; these survive only as loose data on older worlds).
    const savesSource = actor._source?.system?.saves ?? {};
    for (const [key, alias] of Object.entries(SAVE_KEY_ALIASES)) {
      if (!(key in savesSource)) continue;
      const value = savesSource[key]?.value;
      const entry = { uuid: actor.uuid, name: actor.name, kind: "actor-save-key", from: key, to: alias, applied: false };
      if (canWrite) {
        const update = { [`system.saves.-=${key}`]: null };
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
    for (const item of actor.items ?? []) if (item.type === "ability") await scanAbility(item);
  }
  for (const item of game.items ?? []) if (item.type === "ability") await scanAbility(item);

  return report;
}
