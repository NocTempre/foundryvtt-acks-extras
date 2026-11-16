/**
 * A record's modifiers at the roll: the figures an Active Effect carries in
 * `flags["acks-extras"].rollMods` that no field a change can write holds, read
 * when the roll that wants them is made.
 *
 * The flag is `{id, label, cite, sourceAlignment, parts}`. A part is `{key,
 * on, value, itemId, gate, stacksWith, notStacksWith, provides}` plus the scope
 * fields `scopeApplies` reads (`vsKinds`, `vsAlignment`, `vsAlignmentOf`,
 * `vsAlignmentMode`, `vsEnemy`, `anyOf`). `on` names the roll: `attack` and
 * `damage` on the weapon the bearer attacks with, `ac` on an attack made against
 * the bearer, `save` on a saving throw, `ward` for a protection that is told and
 * never added. The feature that writes a record resolves the figures; lib reads
 * them and owns the stacking, so a part is only ever built by `stackingPart`
 * (`resolveStacking` reads its capabilities and throws on a bare one, and the
 * attack seam drops a contributor that throws without a word).
 *
 * The attack seam's contributor puts the attacker's parts on its weapon's
 * attack and damage and the target's `ac` parts on the attack against it. A
 * weapon's own bonus is already among core's rows, so the parts are resolved
 * against what `registerItemBonusSource` reports for that weapon: a spell part
 * that wins is a row of its own, an item part that yields is taken back by a row
 * of its negative, and a pair that stacks adds both. Scope is settled against
 * the roll's other party; one that cannot be settled adds nothing and is told.
 * Foundry-free except for the notices (`ui`) and the translations (`game`).
 */
import { MODULE_ID, LANG_PREFIX, FLAG_ROLL_MODS } from "./constants.mjs";
import { addAttackContributor } from "./patches/attack-throw.mjs";
import { gateVerdict, registerGate, resolveStacking, stackingPart } from "./typed-modifiers.mjs";
import { hasScope, scopeApplies } from "./vocab.mjs";
import { actorAlignment, areEnemies, creatureKinds } from "./actor-read.mjs";
import { appliedEffects } from "./effect-scan.mjs";
import { isMagical } from "./item-model.mjs";
import { signed } from "./frame-model.mjs";

/** The rolls a part is read on. */
export const ROLL_MODS_ON = Object.freeze(["attack", "damage", "ac", "save", "ward"]);

/** Where a part came from, as `resolveItemParts` marks it: the weapon's own bonus or a record's. */
const FROM_ITEM = "item";
const FROM_SPELL = "spell";

/** One notice or label, localized under this file's lang root. */
function loc(key, data = {}) {
  const full = `${LANG_PREFIX}.rollMods.${key}`;
  const i18n = globalThis.game?.i18n;
  return i18n?.format ? i18n.format(full, data) : [full, ...Object.values(data)].join(" ");
}

/* -------------------------------------------- */
/*  Reading the records                          */
/* -------------------------------------------- */

const flagOf = (effect) => effect?.getFlag?.(MODULE_ID, FLAG_ROLL_MODS) ?? effect?.flags?.[MODULE_ID]?.[FLAG_ROLL_MODS] ?? null;

/**
 * Every roll-mod part the actor's applicable, active effects carry:
 * `[{effect, id, label, cite, sourceAlignment, part}]`, one entry per part. A
 * disabled effect, or one the system reports as not active, adds none, and a
 * part whose `on` is not a `ROLL_MODS_ON` value is skipped.
 */
export function rollModsOf(actor) {
  const out = [];
  for (const effect of appliedEffects(actor)) {
    if (!effect || effect.disabled || effect.active === false) continue;
    const flag = flagOf(effect);
    if (!Array.isArray(flag?.parts)) continue;
    for (const part of flag.parts) {
      if (!part || !ROLL_MODS_ON.includes(part.on)) continue;
      out.push({
        effect,
        id: flag.id ?? null,
        label: String(flag.label ?? ""),
        cite: String(flag.cite ?? ""),
        sourceAlignment: flag.sourceAlignment ?? null,
        part,
      });
    }
  }
  return out;
}

/* -------------------------------------------- */
/*  The weapon's own bonus                       */
/* -------------------------------------------- */

const sources = new Set();

/**
 * Register a reader of the bonus a weapon already carries in core's rows.
 * `source(item, on)` answers `[{key, label, value, provides, cite}]` for `on`
 * `attack` or `damage`: the parts of that bonus, each with the capabilities it
 * provides, so a record's part that names one in `notStacksWith` can yield to it
 * or take it back. Returns the function that removes the registration.
 */
export function registerItemBonusSource(source) {
  if (typeof source !== "function") return () => {};
  sources.add(source);
  return () => void sources.delete(source);
}

/**
 * The parts every registered source reports for a weapon on one field, as
 * `stackingPart`s with zero figures dropped. A source that throws is reported and
 * leaves its parts out.
 */
export function itemBonusParts(item, on) {
  const out = [];
  if (!item) return out;
  for (const source of sources) {
    let entries = [];
    try {
      entries = source(item, on);
    } catch (err) {
      console.error(`${MODULE_ID} | an item bonus source failed; its figures are left out`, err);
    }
    for (const entry of Array.isArray(entries) ? entries : []) {
      const value = Number(entry?.value);
      if (!Number.isFinite(value) || value === 0) continue;
      out.push(
        stackingPart({
          value,
          label: String(entry.label ?? ""),
          ref: { provides: entry.provides ?? [] },
          key: entry.key ?? null,
          cite: String(entry.cite ?? ""),
          on,
        }),
      );
    }
  }
  return out;
}

/* -------------------------------------------- */
/*  Parts and their stacking                     */
/* -------------------------------------------- */

/**
 * The `stackingPart` for one `rollModsOf` entry. Its reference is the record's
 * `id` (the spell's definition id, so a printed `stacksWith` naming another
 * spell matches) with the capabilities the part provides, and every field of the
 * part rides along. `sign` multiplies the figure: -1 where a scope reverses it.
 */
export function spellStackingPart(entry, sign = 1) {
  const { value, stacksWith, notStacksWith, provides, ref: _ref, caps: _caps, label: _label, ...rest } = entry.part;
  return stackingPart({
    ...rest,
    value: Number(value) * sign,
    label: entry.label,
    ref: { id: entry.id, provides },
    stacksWith,
    notStacksWith,
    cite: entry.cite,
    sourceAlignment: entry.sourceAlignment,
    effect: entry.effect,
  });
}

/** Whether a part was built by `stackingPart` and carries a finite, nonzero figure. */
const usable = (p) => Array.isArray(p?.caps) && p.ref && typeof p.ref === "object" && Number.isFinite(p.value) && p.value !== 0;

const withCite = (part) => (part.cite ? `${part.label} (${part.cite})` : part.label);

/**
 * Resolve a weapon's own bonus parts and a record's parts on one field, item
 * parts first, so a tie keeps the weapon's. Pure.
 *
 * A part not built by `stackingPart`, or with no figure, is left out of
 * everything. Returns the rows to add to core's, `kept` and the parts that
 * yielded (`droppedItems`, `droppedSpells`, each carrying `yieldsTo`, the label
 * of what it yielded to). A kept spell part is a row labelled `{name} ({cite})`
 * of its figure; a dropped item part is a row of minus its figure, because core's
 * rows already carry it; a kept item part adds nothing.
 *
 * @param {object[]} itemParts  from `itemBonusParts`
 * @param {object[]} spellParts  from `spellStackingPart`
 * @returns {{rows: {label: string, value: number}[], kept: object[], droppedItems: object[], droppedSpells: object[]}}
 */
export function resolveItemParts(itemParts, spellParts) {
  const items = (itemParts ?? []).filter(usable).map((p) => ({ ...p, from: FROM_ITEM }));
  const spells = (spellParts ?? []).filter(usable).map((p) => ({ ...p, from: FROM_SPELL }));
  const { kept, dropped } = resolveStacking([...items, ...spells]);
  const rows = kept.filter((p) => p.from === FROM_SPELL).map((p) => ({ label: withCite(p), value: p.value }));
  const droppedItems = dropped.filter((p) => p.from === FROM_ITEM);
  for (const p of droppedItems) rows.push({ label: loc("yields", { name: p.label, to: p.yieldsTo }), value: -p.value });
  return { rows, kept, droppedItems, droppedSpells: dropped.filter((p) => p.from === FROM_SPELL) };
}

/* -------------------------------------------- */
/*  Scope                                        */
/* -------------------------------------------- */

/**
 * What `scopeApplies` reads of the roll's other party: its kinds and alignment,
 * the alignment of whoever the record came from and whether the two sides are
 * enemies (`areEnemies`, null where unknown).
 */
export function scopeCtxFor(other, { sourceAlignment = null, enemy = null } = {}) {
  return { kinds: creatureKinds(other), alignment: actorAlignment(other), sourceAlignment, enemy };
}

/** The scope verdict of one entry against `other`, the bearer's token and the other's deciding `enemy`. */
function settle(entry, other, enemy) {
  return scopeApplies(entry.part, scopeCtxFor(other, { sourceAlignment: entry.sourceAlignment, enemy }));
}

/** A notice to tell once per attack: `{key, level, lang, data}`. */
function note(entry, lang, level, data, extra = "") {
  return { key: `${lang}|${entry.effect?.id ?? entry.id}|${entry.part.key ?? ""}|${entry.part.on}|${extra ?? ""}`, level, lang, data };
}

/** Whether an entry's gate, if it names one, answers yes for the actor and this roll. */
const gateHolds = (actor, part, ctx) => !part.gate?.kind || gateVerdict(actor, part.gate, ctx) === true;

/* -------------------------------------------- */
/*  The attack seam                              */
/* -------------------------------------------- */

/** The attacker's own parts on one field of its weapon's roll. */
function attackerSide(ctx, on, rows, told) {
  const { actor, item, token, target, targetActor } = ctx;
  const own = rollModsOf(actor).filter((e) => e.part.on === on);
  if (!own.length) return;
  const applying = [];
  for (const entry of own) {
    const { part } = entry;
    if (part.itemId && part.itemId !== item?.id) continue;
    if (!gateHolds(actor, part, { item, token })) continue;
    const verdict = settle(entry, targetActor, areEnemies(token, target));
    if (verdict.undetermined) {
      told.push(note(entry, "notice.undetermined", "warn", { spell: entry.label, target: actor?.name ?? "", attacker: ctx.targetName ?? "" }, targetActor?.uuid));
      continue;
    }
    if (verdict.applies) applying.push(spellStackingPart(entry, verdict.sign));
  }
  if (!applying.length) return;
  const resolved = resolveItemParts(itemBonusParts(item, on), applying);
  rows.push(...resolved.rows);
  for (const p of resolved.droppedSpells) {
    told.push({
      key: `notice.yielded|${p.effect?.id ?? p.ref?.id}|${p.key ?? ""}|${on}`,
      level: "info",
      lang: "notice.yielded",
      data: { spell: p.label, item: item?.name ?? "", to: p.yieldsTo },
    });
  }
}

/** The target's `ac` parts, as the minus terms they are on an attack against it, and its `ward` parts, told. */
function defenderSide(ctx, rows, told) {
  const { actor, token, target, targetActor } = ctx;
  const theirs = rollModsOf(targetActor).filter((e) => e.part.on === "ac" || e.part.on === "ward");
  if (!theirs.length) return;
  const enemy = areEnemies(token, target);
  const applying = [];
  for (const entry of theirs) {
    const verdict = settle(entry, actor, enemy);
    const data = { spell: entry.label, target: ctx.targetName ?? "", attacker: actor?.name ?? "" };
    if (entry.part.on === "ward") {
      if (verdict.applies || verdict.undetermined) told.push(note(entry, "notice.ward", "warn", data, actor?.uuid));
    } else if (verdict.undetermined) told.push(note(entry, "notice.undetermined", "warn", data, actor?.uuid));
    else if (verdict.applies) applying.push(spellStackingPart(entry, verdict.sign));
  }
  const { kept, dropped } = resolveStacking(applying.filter(usable));
  for (const p of kept) rows.push({ label: loc("onTarget", { name: withCite(p), target: ctx.targetName ?? "" }), value: -p.value });
  for (const p of dropped) {
    told.push({
      key: `notice.yielded|${p.effect?.id ?? p.ref?.id}|${p.key ?? ""}|ac`,
      level: "info",
      lang: "notice.yielded",
      data: { spell: p.label, item: ctx.targetName ?? "", to: p.yieldsTo },
    });
  }
}

/**
 * The rows a record's parts add to one question of the attack in flight, and
 * the notices to tell. `question` is `attack` or `damage`: the attacker's parts
 * on that field and, for `attack`, the target's `ac` parts as terms against the
 * attacker. Cached on `ctx.rollMods` by question and attack type, because the
 * dialog's preview asks again on every keystroke.
 *
 * @param {object} ctx  the attack's context (`attackContext`)
 * @param {string} attackType  the kind the question is asked for; a cache key only
 * @param {"attack"|"damage"} question
 * @returns {{rows: {label: string, value: number}[], told: {key: string, level: string, lang: string, data: object}[]}}
 */
export function rollModRows(ctx, attackType, question) {
  const cache = (ctx.rollMods ??= {});
  const key = `${question}:${attackType}`;
  if (cache[key]) return cache[key];
  const rows = [];
  const told = [];
  attackerSide(ctx, question, rows, told);
  if (question === "attack" && ctx.targetActor) defenderSide(ctx, rows, told);
  return (cache[key] = { rows, told });
}

/** Say each notice once per attack: a later question, or the preview asking again, finds its key already told. */
function tell(ctx, told) {
  const seen = (ctx.rollModsTold ??= new Set());
  for (const t of told) {
    if (seen.has(t.key)) continue;
    seen.add(t.key);
    globalThis.ui?.notifications?.[t.level]?.(loc(t.lang, t.data));
  }
}

/** The attack seam's contributor. A spell carrier's attack throw is read; its damage is the spell's own. */
const rollModsContributor = {
  carriers: ["attack"],
  attack(ctx, attackType, modifiers) {
    const { rows, told } = rollModRows(ctx, attackType, "attack");
    tell(ctx, told);
    return rows.length ? [...modifiers, ...rows] : modifiers;
  },
  damage(ctx, attackType, modifiers) {
    const { rows, told } = rollModRows(ctx, attackType, "damage");
    tell(ctx, told);
    return rows.length ? [...modifiers, ...rows] : modifiers;
  },
};

/** Put the records' parts on the attack throw and the damage roll. At `ready`, after the roll gates. */
export function installRollMods() {
  addAttackContributor(rollModsContributor);
}

/* -------------------------------------------- */
/*  Item gates                                   */
/* -------------------------------------------- */

// A weapon is magic by what it is (`isMagical`), never by what a spell was cast on it.
registerGate("weaponMundane", (_actor, _gate, ctx) => (ctx?.item ? !isMagical(ctx.item) : null), { at: "item" });
registerGate("weaponMagical", (_actor, _gate, ctx) => (ctx?.item ? isMagical(ctx.item) : null), { at: "item" });

/* -------------------------------------------- */
/*  Saving throws                                */
/* -------------------------------------------- */

/** Resolve applying save parts among themselves and give each kept one as a target part. */
function targetParts(applying) {
  return resolveStacking(applying.filter(usable)).kept.map((p) => ({ key: p.key ?? "rollMods", label: p.label, value: p.value, side: "target" }));
}

/**
 * The target parts a saving throw takes from the saver's `save` parts. A part
 * whose scope applies against `against` (`{actor, token}`, what the save is made
 * against) is a target part labelled as its record, a figure that lowers the
 * number to roll; one whose scope cannot be settled, or any scoped part with no
 * `against`, is returned in `pending` as `{label, value, when: "source"}` and
 * left out of the target. A part that fails adds nothing. Unscoped parts always
 * apply, and the applying ones are resolved among themselves, so two records of
 * one kind give one figure. Pure.
 *
 * @param {object} saver
 * @param {{against?: {actor: object, token?: object}|null, bearerToken?: object|null}} [options]
 *   `bearerToken` is the saver's token, read for `vsEnemy` against `against.token`
 * @returns {{parts: {key: string, label: string, value: number, side: "target"}[], pending: {label: string, value: number, when: "source"}[]}}
 */
export function saveModParts(saver, { against = null, bearerToken = null } = {}) {
  const applying = [];
  const pending = [];
  for (const entry of rollModsOf(saver).filter((e) => e.part.on === "save")) {
    const { part } = entry;
    if (part.gate?.kind) continue;
    if (!hasScope(part)) {
      applying.push(spellStackingPart(entry));
      continue;
    }
    if (!against?.actor) {
      pending.push({ label: entry.label, value: Number(part.value), when: "source" });
      continue;
    }
    const verdict = settle(entry, against.actor, areEnemies(bearerToken, against.token));
    if (verdict.undetermined) pending.push({ label: entry.label, value: Number(part.value), when: "source" });
    else if (verdict.applies) applying.push(spellStackingPart(entry, verdict.sign));
  }
  return { parts: targetParts(applying), pending };
}

/**
 * What a saving throw rolled from the sheet takes from the saver's `save` parts,
 * which know nothing of what is resisted: the unscoped, ungated ones, resolved
 * among themselves, lower the number to roll by `total`; each scoped one is
 * left out and told. `told` is a list of notices for `tellRollMods`.
 *
 * @returns {{total: number, parts: {key: string, label: string, value: number}[], told: {level: string, lang: string, data: object}[]}}
 */
export function sheetSaveShift(actor) {
  const applying = [];
  const told = [];
  for (const entry of rollModsOf(actor).filter((e) => e.part.on === "save")) {
    if (entry.part.gate?.kind) continue;
    if (hasScope(entry.part)) told.push({ level: "info", lang: "notice.saveScoped", data: { name: actor?.name ?? "", spell: entry.label } });
    else applying.push(spellStackingPart(entry));
  }
  const parts = targetParts(applying);
  const total = parts.reduce((sum, p) => sum + p.value, 0);
  if (parts.length) {
    const rows = parts.map((p) => `${p.label} ${signed(p.value)}`).join(", ");
    told.push({ level: "info", lang: "notice.saveApplied", data: { name: actor?.name ?? "", rows } });
  }
  return { total, parts, told };
}

/** Say notices `sheetSaveShift` returned, through the notification bar. */
export function tellRollMods(told) {
  for (const t of told ?? []) globalThis.ui?.notifications?.[t.level]?.(loc(t.lang, t.data));
}
