/* global game, ui, fromUuidSync, Roll */
/**
 * Casting a spell that has effect rows. A claimant on the cast seam
 * (`lib/patches/spell-use.mjs`), registered after the summoning's, takes the
 * cast of a flagged spell on an actor this seat owns, whichever door the player
 * pressed, and declines everything else: a spell with no rows, a summoning
 * spell, an actor this seat does not own. A monster's attack item is no spell
 * and stays the system's.
 *
 * The cast asks (`apps/cast-dialog.mjs`), refuses before it spends where a
 * Player is blocked and warns a Judge, spends once (`spend()` and, for a
 * vancian tradition, its pool), rolls each row once, has each target's seat
 * roll the save, posts the cast card and applies what the seat may and the GM's
 * client what it may not (`cast-apply.mjs`). A cancel spends nothing.
 *
 * A row with a throw rides the system's own attack pipeline as the `magic`
 * attack type on a carrier (`lib/patches/attack-throw.mjs`); a row with none
 * is rolled through the same modifier question (`magicDamageSpec`). Both are
 * applied by the cast, never by the system's Apply button.
 */
import { MODULE_ID, FLAG_SPELL, SPELL_TYPE } from "./constants.mjs";
import { rowsOf, rowsForMode, rowNeedsThrow, hasReversedRows, spellSaves, saveGoverns, keyedRows, effectRowsOf, pickGroups, aimedAtSelf, resistedDamage, rowsOfMode, optionTokenOf, resolvesAtCast, isRecurring, castersTurnRecurs, recurringRows, CAST_MODES } from "./cast-rows.mjs";import { casterLevel, levelNeeded } from "./cast-level.mjs";
import { castAbilityLevel } from "./cast-abilities.mjs";
import { castAbilitiesOf, castSaveParts, abilityDamageContributor } from "./cast-ability-use.mjs";
import { castCapacity, traditionFor, spendsFromPool } from "./cast-capacity.mjs";
import { castVerdicts, blocked } from "./cast-plan.mjs";
import { castDuration } from "./cast-duration.mjs";
import { roundsCount, roundsFormulaOf } from "./cast-life.mjs";
import { castMoment, declarationOf, fightHolding, MOMENT } from "./cast-moment.mjs";
import { heldStatusOf, endCasterHeld } from "./cast-held.mjs";
import { liveDeclare } from "./cast-declare.mjs";
import { spellEffectData, spellEffectOf, newCastId } from "./spell-effect.mjs";
import { describeSpellEffect } from "./describe.mjs";
import { requestApply, registerCastRelay, undoEntries, liveApplyDeps, entryId } from "./cast-apply.mjs";
import { cardOf, postCastCard, updateEntry, addTargets, newTargetKey, registerCastCardHooks, CARD_ACTIONS, canPressCard } from "./cast-card.mjs";
import { isModRow, modParts, needsBearer, dryYields, modifierFigure, ownSaveRows, ROW_ON } from "./cast-mods.mjs";
import { rangeFeet, rangeVerdicts } from "./cast-range.mjs";
import { instanceCount, instanceRow, allocate, assignedOf, wholeSplit } from "./cast-instances.mjs";
import { OFF_SCENE, withOnlyTarget, waitingInstances, instancesState, throwInstances, splitFor, pendingRequests, requestOf } from "./cast-throw.mjs";
import { areaExtent } from "./cast-area.mjs";
import { placeOf, kindOf, rowOpens, rowResisted, livesKind, entryOf } from "./cast-kinds.mjs";
import { targetGate, noSaveResist } from "./cast-gates.mjs";
import { levelUnder } from "./spell-names.mjs";
import { isSummonSpell } from "./summon-spell.mjs";
import { byCookbookId, cookbookId, whenReady } from "../lib/library.mjs";
import { addSpellUseClaimant, removeSpellUseClaimant } from "../lib/patches/spell-use.mjs";
import { MAGIC_ATTACK_TYPE, spellCarrier, magicDamageSpec, actorToken, addAttackContributor } from "../lib/patches/attack-throw.mjs";
import { saveThrow } from "../lib/saves.mjs";
import { defenseCite } from "../lib/defenses.mjs";
import { actorAlignment } from "../lib/actor-read.mjs";
import { tokenGapFeet } from "../lib/distance-units.mjs";
import { isMagical } from "../lib/item-model.mjs";

/** The claimant's key on the cast seam. */
export const CAST_SPELL_KEY = `${MODULE_ID}.magic.castSpell`;

/** The world lookups the rows and the twin need. */
const worldLookups = () => ({ byCookbookId, fromUuidSync: (uuid) => fromUuidSync(uuid) });

/** The cast's strings. */
const loc = (key, data = {}) => game.i18n.format(`ACKS-MAGIC.cast.${key}`, data);

/** The raw spell flag of an item. */
const flagOf = (item) => item?.flags?.[MODULE_ID]?.[FLAG_SPELL] ?? {};

/** Does the spell hold a summon row, or print as a summoning? The summoning cast owns those. */
const summoning = (item) => isSummonSpell(item) || effectRowsOf(item).some((row) => row.type === "summon");

/**
 * Does this claimant take this cast? A flagged spell item on an actor this
 * seat owns, no summoning, with rows of its own or its twin's.
 * @param {Item} item
 * @param {{byCookbookId: Function, fromUuidSync: Function}} [lookups]
 */
export function castSpellClaims(item, lookups = worldLookups()) {
  if (item?.type !== SPELL_TYPE || item.parent?.isOwner !== true) return false;
  const flag = item.flags?.[MODULE_ID]?.[FLAG_SPELL];
  if (!flag || typeof flag !== "object" || !Object.keys(flag).length) return false;
  if (summoning(item)) return false;
  return rowsOf(item, lookups).rows.length > 0;
}

/**
 * The duration of a cast: the spell's own duration object, else its twin's, with the
 * resolved level. In the reversed mode the reverse's own duration (`reversedDuration`,
 * the copy's else its twin's) stands where it prints a shape, and the plain duration
 * where it does not.
 */
export function castDurationOf(spell, lookups, level, roll, mode = CAST_MODES.normal) {
  const own = flagOf(spell);
  const id = spell.flags?.[MODULE_ID]?.cookbook?.id;
  const twin = id ? lookups?.byCookbookId?.("Item", id) : null;
  if (mode === CAST_MODES.reversed) {
    const reverse = own.reversedDuration?.shape ? own.reversedDuration : flagOf(twin).reversedDuration;
    if (reverse?.shape) return castDuration(reverse, { casterLevel: level, roll });
  }
  const duration = own.duration?.shape ? own.duration : (flagOf(twin).duration ?? own.duration);
  return castDuration(duration, { casterLevel: level, roll });
}

/**
 * The roll spec of one row, as the cast and its relay both read it: a damage row
 * through lib's magic question, a heal row its own dice. A row with no throw
 * rolls once for all its instances, so its roll is scaled by its count at the
 * card's caster level (`cast-instances.mjs`), here, where both clients read it,
 * so the roll and its bounds are one formula. A row with a throw is the spec of
 * one instance.
 */
export async function rowSpecOf(caster, spell, card, keyed) {
  const row = rowNeedsThrow(keyed.row) ? keyed.row : instanceRow(keyed.row, card.casterLevel?.value);
  const { key } = keyed;
  if (row.type === "heal") return row.roll ? { formula: String(row.roll), data: caster.getRollData?.() ?? {} } : null;
  if (row.type !== "damage") return null;
  const carrier = spellCarrier(caster, row, { spell, castId: card.castId, rowKey: key });
  return magicDamageSpec(caster, carrier);
}

/** The begun fight that holds this actor, with the actor's combatant in it; null where there is none. */
const castFight = (actor) => fightHolding([game.combat, ...(game.combats ?? [])], { actor });

/**
 * The spell's range and target figures: the copy's own, else its library
 * twin's where the copy prints none (the twin is read as the duration's is).
 */
export function castFiguresOf(spell, lookups) {
  const own = flagOf(spell);
  const id = spell?.flags?.[MODULE_ID]?.cookbook?.id;
  const twin = (!own.range?.shape || !own.target?.model) && id ? flagOf(lookups?.byCookbookId?.("Item", id)) : {};
  return {
    range: own.range?.shape ? own.range : (twin.range ?? own.range ?? null),
    target: own.target?.model ? own.target : (twin.target ?? own.target ?? null),
    // The page reference of whichever copy the range is read from.
    cite: (own.range?.shape ? own.cite : (twin.cite || own.cite)) ?? "",
  };
}

/**
 * The figures the target gates read (`cast-gates.mjs`): the Hit Dice cap from the
 * target figures (the copy's own, else its twin's, as `castFiguresOf` reads
 * them) and the Hit Dice below which no save is made from the copy's own save.
 * The cast, the card's presses and the relay's GM client all read them here, so
 * a gate is the same on each. `spell` is the spell as a record's immunity names
 * it (`{id}`, the definition id the record stacks as), null for a spell with none.
 */
export function castGateExtrasOf(spell, lookups) {
  const id = cookbookId(spell) || null;
  return { target: castFiguresOf(spell, lookups).target, save: flagOf(spell).save ?? null, spell: id ? { id, provides: [] } : null };
}

/**
 * What the spell's range and target count say of the targeted tokens at a caster
 * level: the range verdict inputs (`cast-range.mjs`) and the count cap, each
 * null or empty where the import read nothing. A per-level figure reads only
 * once a level is known.
 * @param {{figures: {range: object|null, target: object|null}, level: number|null, tokens: object[], gaps?: Record<string, number|null>}} from
 * @returns {{range: ReturnType<typeof rangeVerdicts>, count: number|null}}
 */
export function castReach({ figures, level, tokens, gaps = {} }) {
  const target = figures?.target ?? {};
  const area = target.area ?? {};
  const figure = (value) => modifierFigure({ value }, level);
  const extent = areaExtent({ measure: area.measure, size: figure(area.size), width: figure(area.width), height: area.height, unit: area.unit });
  const range = rangeVerdicts({
    targets: tokens.map((token) => ({ key: token.uuid, name: targetOf(token).name })),
    gaps,
    rangeFeet: rangeFeet(figures?.range, level),
    extent,
    model: target.model,
  });
  return { range, count: figure(target.count) };
}

/** The reading of the live world a cast needs, in one place. */
async function readWorld(spell) {
  const actor = spell.parent;
  const { classForActor } = await import("../classes/registry.mjs");
  const { poolState } = await import("../classes/casting.mjs");
  const extras = flagOf(spell);
  const classItem = classForActor(actor);
  const found = traditionFor(classItem?.system?.casting, { extras, lvl: spell.system?.lvl, class: spell.system?.class });
  const spellLevel = found?.spellLevel ?? levelUnder(extras, spell.system?.lvl, new Set());
  const castsAtLevel = actor.items.filter((i) => i.type === SPELL_TYPE && Number(i.system?.lvl) === spellLevel).reduce((sum, i) => sum + (Number(i.system?.cast) || 0), 0);
  const capacity = castCapacity({ pools: poolState(actor), coreSpells: actor.system?.spells, castsAtLevel, tradition: found?.tradition?.key ?? null, spellLevel });
  const ladderKey = found?.tradition?.casterLevel;
  const ladder = ladderKey ? ((classItem?.system?.ladders ?? []).find((l) => l.key === ladderKey) ?? { values: [] }) : null;
  const tokens = [...(game.user.targets ?? [])].map((t) => t.document ?? t).filter((t) => t?.actor);
  const records = [...(actor.effects ?? [])].map((e) => spellEffectOf(e)).filter(Boolean);
  const fight = castFight(actor);
  const casterToken = actorToken(actor);
  return {
    actor,
    tokens,
    casterToken,
    // The centre-to-centre gap in feet to each targeted token; null where it cannot be measured (no caster token, another scene).
    gaps: Object.fromEntries(tokens.map((t) => [t.uuid, tokenGapFeet(casterToken, t)])),
    combat: fight?.combat ?? null,
    combatant: fight?.combatant ?? null,
    held: records.some((r) => r.role === "caster" && r.held),
    declarations: records.filter((r) => r.pending),
    prepareSpell: fight?.combatant?.flags?.acks?.prepareSpell === true,
    statuses: [...(actor.statuses ?? [])],
    capacity,
    level: {
      matched: Boolean(found),
      classLevel: actor.system?.details?.level,
      ladder,
      monsterLevel: actor.getFlag?.(MODULE_ID, "extras")?.spellcasting?.level,
    },
  };
}

/** A target as the card keeps it. */
const targetOf = (token) => ({ uuid: token.uuid, name: token.name || token.actor?.name || "" });

// The ruling-14 kinds that write the recipient's record are the dispatch's (`cast-kinds.mjs`); the cast's tests reach them here.
export { RECORD_KINDS, writesRecipientRecord } from "./cast-kinds.mjs";

/** The Roll of one non-thrown row, with the figures the card shows. */
export async function rollRow(caster, spell, card, keyed) {
  const spec = await rowSpecOf(caster, spell, card, keyed);
  if (!spec) return { total: null, formula: "", detail: "", roll: null };
  const roll = await new Roll(spec.formula, spec.data).evaluate();
  return { total: roll.total, formula: spec.formula, detail: String(roll.result ?? roll.total), roll };
}

/**
 * A save's resist, as the card keeps it, or null where the creature has no
 * stored target. `against` is the caster and its token, what the throw is made
 * against, and `bearerToken` the saver's own; the relay recomputes the target
 * with the same two, so a scoped figure never reads as a forged one.
 *
 * `damage` is what the save resists (`cast-rows.mjs` `resistedDamage`): the
 * target's defenses against it join the throw (`lib/saves.mjs`). A target immune
 * to all of it passes with no roll, and its resist is `{success: true, total:
 * null, auto: {label, source, types, cite}}`. A defense case the module does not
 * price is listed as `defensePending` and changes nothing in the throw.
 *
 * `gate` is the spell-wide gate of this target (`cast-gates.mjs`): a target it
 * leaves unaffected rolls nothing and keeps no resist, and a target below the Hit
 * Dice that save rolls nothing and keeps a failed save marked as no save
 * (`noSaveResist`).
 *
 * `parts` are the caster's abilities' parts on the throw (`castSaveParts`): the
 * relay and every press that rolls a cast's save pass the same ones.
 *
 * `ownRows` are the spell's own save rows (`ownSaveRows`): each is tested for this
 * saver by lib, a row that holds is a part of the throw, and one that cannot be
 * told yet is kept on the resist as `pendingParts`, never added to the number.
 */
export async function rollResist(actor, save, situational, { against = null, bearerToken = null, damage = null, gate = null, parts = [], ownRows = [] } = {}) {
  if (gate?.affected === false) return { resist: null, roll: null };
  if (gate?.noSave === true) return { resist: noSaveResist(save, gate.why), roll: null };
  const made = await saveThrow(actor, save.category, { situational, against, bearerToken, damage, parts, ownRows });
  const auto = made.auto ?? null;
  if (!auto && (made.target == null || made.total == null)) return { resist: null, roll: null };
  const { roll, ...kept } = made;
  const pending = (kept.pending ?? []).filter((p) => p.when === "defense").map(({ label, why }) => ({ label, ...(why ? { why } : {}) }));
  const undecided = (kept.pending ?? []).filter((p) => p.label && p.when !== "defense").map(({ label, value, when }) => ({ label, value, when }));
  const resist = {
    kind: "save",
    category: save.category,
    formula: kept.formula,
    total: auto ? null : kept.total,
    target: kept.target,
    baseTarget: kept.baseTarget,
    success: kept.success,
    ...(auto ? { auto: { label: auto.label, source: auto.source, types: [...auto.types], cite: defenseCite() } } : {}),
    parts: kept.parts.map(({ key, label, value }) => ({ key, label, value })),
    ...(pending.length ? { defensePending: pending } : {}),
    ...(undecided.length ? { pendingParts: undecided } : {}),
  };
  return { resist, roll };
}

/**
 * The targets, each with the resist it rolled, and the entries each row opens:
 * a thrown row waits for its throw and the rest wait for their application.
 * Targets the cast is aimed at take the rows that are not the caster's own;
 * the caster, where a row is, takes the rest.
 *
 * `extras` are the gates' figures (`castGateExtrasOf`) and the card's caster level
 * is the level they are read at. A condition row that lasts a number of rounds
 * opens its entry with `life {kind, count, formula, detail}`, the formula rolled
 * once for that target's record (`count` null where it is blank or will not
 * roll). A target a row's gate leaves unaffected has the
 * entry `{state: "exempt", gate}` for that row, a thrown row's included: nothing
 * is rolled, written or recorded for it. A target the spell's gate leaves with
 * no save keeps the failed resist that says so (`rollResist`). The caster's own
 * target is gated by none. With no `extras` nothing is gated. `saveParts` are
 * the caster's abilities' parts on each target's save (`castSaveParts`).
 */
export async function buildTargets({ tokens, card, rows, save, situational, caster, casterToken = null, randomID, extras = null, saveParts = [] }) {
  const targets = {};
  const entries = {};
  const rolls = [];
  const level = card.casterLevel?.value ?? null;
  const opens = (r) => (isModRow(r) ? r.blank !== true : kindOf(r.type) ? rowOpens(r) : r.total != null);
  const open = rows.filter(({ key }) => card.rows[key] && opens(card.rows[key]));
  // A thrown row's entry opens at its throw, so it is listed with the rows that open one only to be marked exempt.
  const entered = rows.filter(({ key, row }) => card.rows[key] && (opens(card.rows[key]) || (rowNeedsThrow(row) && card.rows[key].blank !== true)));
  const hasSelf = rows.some(({ row }) => aimedAtSelf(row));
  // A condition that lasts a number of rounds opens with its count rolled, once for this target's record and shown on the card; a formula the import left blank, or one that will not roll, opens with no count.
  const opened = async (row) => {
    if (!livesKind(row.type) || row.lasts !== "rounds") return {};
    const formula = roundsFormulaOf(row);
    const none = { life: { kind: "rounds", count: null, formula } };
    if (!formula) return none;
    try {
      const roll = await new Roll(formula).evaluate();
      const count = roundsCount(roll.total);
      if (count == null) return none;
      rolls.push(roll);
      return { life: { kind: "rounds", count, formula, detail: String(roll.result ?? roll.total) } };
    } catch {
      return none;
    }
  };
  const add = async (key, target, forRow, gates = null, actor = null) => {
    targets[key] = target;
    for (const { key: rowKey, row } of entered) {
      if (!forRow(row)) continue;
      const gate = gates?.[rowKey];
      if (gate && !gate.affected) entries[entryId(key, rowKey)] = { state: "exempt", gate: gate.why };
      else if (open.some((o) => o.key === rowKey) && !rowNeedsThrow(row)) entries[entryId(key, rowKey)] = { state: "pending", ...(await opened(row)), ...entryOf(row, actor) };
    }
  };
  // A save is rolled only where it governs an entry this cast opens on the target: a damage, heal or condition row that the target takes, no
  // throw decides, no gate exempts and no `none` effect frees from it. A buff, the caster's own row, a thrown row and a row that is only a card line (its type opens no entry, or its figure was left unread) call for none.
  const saves = spellSaves(save);
  // What the save resists is read from the spell's rows for the mode and picks, as the relay reads it, so a defense joins the throw the same way on both clients.
  const damage = resistedDamage(rows);
  for (const token of tokens) {
    const gates = Object.fromEntries(entered.map(({ key, row }) => [key, targetGate({ actor: token.actor, extras, row, level })]));
    const resisting = saves && open.some(({ row, key }) => !isModRow(row) && rowResisted(row, token.actor) && !aimedAtSelf(row) && !rowNeedsThrow(row) && saveGoverns(row, save) && gates[key].affected);
    const made = resisting
      ? await rollResist(token.actor, save, situational, { against: caster ? { actor: caster, token: casterToken } : null, bearerToken: token, damage, parts: saveParts, ownRows: ownSaveRows(rows, { level, label: card.spellName, cite: card.cite }), gate: targetGate({ actor: token.actor, extras, level }) })
      : { resist: null, roll: null };
    if (made.roll) rolls.push(made.roll);
    await add(newTargetKey(randomID), { ...targetOf(token), resist: made.resist }, (row) => !aimedAtSelf(row), gates, token.actor);
  }
  if (hasSelf && caster) await add(newTargetKey(randomID), { uuid: caster.uuid, name: caster.name, self: true, resist: null }, aimedAtSelf, null, caster);
  return { targets, entries, rolls };
}

/** The dependencies a cast uses, as the live world gives them; a test supplies its own. */
const liveDeps = () => ({
  ready: whenReady,
  lookups: worldLookups(),
  read: readWorld,
  ask: async (ctx) => (await import("./apps/cast-dialog.mjs")).CastDialog.wait(ctx),
  notify: (level, key, data) => ui.notifications?.[level]?.(loc(`notice.${key}`, data ?? {})),
  adjustPool: async (actor, tradition, slotKey) => (await import("../classes/casting.mjs")).adjustPool(actor, tradition, slotKey, 1),
  castId: () => newCastId(),
  roll: (formula) => new Roll(formula).evaluateSync().total,
  post: postCastCard,
  apply: requestApply,
  record: async (caster, data) => caster.createEmbeddedDocuments("ActiveEffect", [data]),
  endHeld: endCasterHeld,
  declare: liveDeclare(),
  // One core throw, with the seat's targets narrowed to the token it is for and restored after; a token off the viewed scene is not thrown at.
  throwRow: async (caster, carrier, skipDialog, token = null) => {
    const run = () => caster.makeAttackThrow({ item: carrier, attackType: MAGIC_ATTACK_TYPE, skipDialog });
    if (!token) return run();
    const done = await withOnlyTarget(token, run);
    return done.ok ? done.value : OFF_SCENE;
  },
  now: () => game.time.worldTime,
  isGM: () => game.user.isGM,
});

/** The card's row, as the card keeps it; `count` is a damage or heal row's instance count (`cast-instances.mjs`). */
const cardRow = (keyed, rolled, count = null) => ({
  type: keyed.row.type,
  key: keyed.key,
  ...(count ? { count } : {}),
  types: Array.from(keyed.row.damage ?? []),
  extraordinary: keyed.row.extraordinary === true,
  formula: rolled.formula ?? "",
  total: rolled.total ?? null,
  detail: rolled.detail ?? "",
  delivery: rowNeedsThrow(keyed.row) ? keyed.row.delivery : "",
  saveEffect: keyed.row.saveEffect ?? "",
  conditions: Array.from(keyed.row.conditions ?? []),
  lasts: keyed.row.lasts ?? "",
  healKind: keyed.row.healKind ?? "",
});

/** The card's row for a modifier or ward row: its figure where it has one, `blank` where the import left it unread. */
const modCardRow = (keyed, part) => ({
  type: keyed.row.type,
  key: keyed.key,
  on: part?.on ?? (keyed.row.type === "ward" ? "ward" : (ROW_ON[keyed.row.target] ?? "")),
  types: [],
  extraordinary: false,
  formula: "",
  total: Number.isFinite(part?.value) ? part.value : null,
  detail: "",
  delivery: "",
  saveEffect: "",
  conditions: [],
  lasts: keyed.row.lasts ?? "",
  healKind: "",
  blank: !part,
  weapon: Boolean(part?.itemId),
  ...(part?.mode === "set" ? { mode: "set" } : {}),
});

/** The weapons an actor carries, as the dialog lists them: each marked where it is magic. */
const weaponsOf = (actor) => [...(actor?.items ?? [])].filter((i) => i.type === "weapon").map((i) => ({ id: i.id, name: i.name, magic: isMagical(i) }));

/**
 * The cast of one spell with rows. Asks, then refuses or spends, rolls,
 * posts and applies. `spend()` runs once and only after the dialog confirms
 * and the verdicts allow it, before any dice.
 *
 * @param {Item} spell
 * @param {() => Promise<boolean>} spend  the seam's once-only door to the system's cast
 * @param {object} [deps]  see `liveDeps`
 * @param {{skipDialog?: boolean}} [options]  the cast's options from the seam
 * @returns {Promise<{ok: boolean, reason?: string, castId?: string, messageId?: string}>}
 */
export async function castSpellRun(spell, spend, deps = liveDeps(), options = {}) {
  const caster = spell.parent;
  await deps.ready?.();
  const { rows: all } = rowsOf(spell, deps.lookups);
  const extras = flagOf(spell);
  const world = await deps.read(spell);
  const isGM = deps.isGM();
  const groupsFor = (mode) => pickGroups(all, mode);
  const modeKeys = hasReversedRows(all) ? [CAST_MODES.normal, CAST_MODES.reversed] : [CAST_MODES.normal];
  // Where the cast falls in a fight, and the declaration it resolves.
  const moment = castMoment({ combat: world.combat, combatant: world.combatant });
  const declaration = declarationOf(world.declarations ?? [], { spellUuid: spell.uuid, combatId: world.combat?.id ?? null, prepareSpell: world.prepareSpell === true });
  const resolving = moment === MOMENT.resolve && Boolean(declaration.valid);
  const figures = castFiguresOf(spell, deps.lookups);
  // The caster's abilities that apply to this spell: they add to the caster level, the targets' saves and the damage, never to the slots or the uses.
  const abilities = castAbilitiesOf(caster, spell, deps.lookups);
  const known = castAbilityLevel(casterLevel(world.level), abilities.casterLevel);
  // What the range and the target count say of the targeted tokens at a caster level.
  const reachAt = (levelValue) => castReach({ figures, level: levelValue, tokens: world.tokens, gaps: world.gaps });
  // Each thrown row's instance count at a caster level, and how many throws the seat's split assigns it (the default split assigns the count).
  const instancesFor = (mode, picks, levelValue, typed = null) => {
    const counts = {};
    const assigned = {};
    for (const { row, key } of rowsForMode(all, mode, picks)) {
      if (!rowNeedsThrow(row)) continue;
      counts[key] = instanceCount(row, levelValue).value;
      const split = counts[key] > 1 && typed?.[key] ? wholeSplit(typed[key]) : null;
      // A typed split counts only the targets the seat has.
      assigned[key] = split ? assignedOf(Object.fromEntries(Object.entries(split).filter(([i]) => Number(i) < world.tokens.length))) : (counts[key] ?? 0);
    }
    return { counts, assigned };
  };
  const verdictsFor = (mode, picks, levelValue, typed = null) => {
    const reach = reachAt(levelValue);
    return castVerdicts({ capacity: world.capacity, targets: world.tokens, rows: rowsForMode(all, mode, picks), statuses: world.statuses, isGM, held: world.held === true, moment, declaration, range: reach.range, count: reach.count, instances: instancesFor(mode, picks, levelValue, typed) });
  };
  // The thrown rows whose count is above one and that several targets could share: the dialog offers a split of each.
  const splitsFor = (mode) =>
    world.tokens.length < 2
      ? []
      : rowsOfMode(all, mode).flatMap(({ row, key }) => {
          if (!rowNeedsThrow(row)) return [];
          const count = instanceCount(row, known.value);
          return count.value > 1 ? [{ key, row, count, pick: String(row.pick ?? "").trim(), option: optionTokenOf(row, key), split: allocate(count.value, world.tokens.map((_, i) => String(i))) }] : [];
        });
  // One targeted token can bear a weapon buff, and the dialog lists its weapons.
  const bearerToken = world.tokens.length === 1 ? world.tokens[0] : null;
  // A declaration being resolved answers for itself; the dialog opens only where its stored weapon is not one of the one target's.
  const stored = resolving ? declaration.valid.pending : null;
  const storedFits =
    stored && (!needsBearer(rowsForMode(all, stored.mode, stored.picks ?? {})) || bearerToken?.actor?.items?.get?.(stored.item)?.type === "weapon");
  const askContext = () => ({
    spell,
    caster,
    moment,
    modes: modeKeys,
    rows: all,
    groups: Object.fromEntries(modeKeys.map((m) => [m, groupsFor(m)])),
    level: known,
    // `levelNeeded` reads the rows themselves, not the keyed pairs.
    levelNeeded: [CAST_MODES.normal, CAST_MODES.reversed].some((m) => levelNeeded({ ...extras, ...figures }, rowsForMode(all, m).map(({ row }) => row))),
    weapons: bearerToken ? weaponsOf(bearerToken.actor) : [],
    needsWeapon: Object.fromEntries(modeKeys.map((m) => [m, needsBearer(rowsForMode(all, m, {}))])),
    targets: world.tokens.map(targetOf),
    saves: spellSaves(extras.save),
    capacity: world.capacity,
    verdicts: Object.fromEntries(modeKeys.map((m) => [m, verdictsFor(m, {}, known.value)])),
    // Per form, the thrown rows a seat with several targets may split, each with its count and the default split by target position.
    instances: Object.fromEntries(modeKeys.map((m) => [m, splitsFor(m)])),
    rangeUnmeasured: moment !== MOMENT.declare && reachAt(known.value).range.unmeasured,
    cite: figures.cite || extras.cite || "",
    isGM,
  });
  const answer = storedFits
    ? { mode: stored.mode, picks: stored.picks ?? {}, item: stored.item ?? "", casterLevel: stored.casterLevel ?? "", situational: stored.situational ?? "", visibility: stored.visibility || "public" }
    : await deps.ask(askContext());
  if (!answer) return { ok: false, reason: "cancelled" };

  const mode = modeKeys.includes(answer.mode) ? answer.mode : CAST_MODES.normal;
  const kept = rowsForMode(all, mode, answer.picks);
  const level = castAbilityLevel(casterLevel({ ...world.level, override: answer.casterLevel }), abilities.casterLevel);
  const verdicts = verdictsFor(mode, answer.picks, level.value, answer.allocation);
  const stop = verdicts.find((v) => v.severity === "block");
  const detail = (v) => ({ name: caster.name, names: (v.out ?? []).map((t) => t.name).join(", "), max: v.max ?? "", over: v.over ?? "" });
  if (blocked(verdicts)) {
    deps.notify("warn", `blocked.${stop.key}`, detail(stop));
    return { ok: false, reason: stop.key };
  }
  for (const v of verdicts) deps.notify("warn", `verdict.${v.key}`, detail(v));

  // A declaration being resolved was spent at its declaring.
  if (!resolving) {
    await spend();
    if (spendsFromPool(world.capacity)) await deps.adjustPool(caster, world.capacity.tradition, world.capacity.slotKey);
  }
  // The cast, or the declaring of it, ends what the caster holds by concentration, before any record of this cast.
  await deps.endHeld?.(caster);
  if (resolving) await deps.declare?.finish({ caster, record: declaration.valid, combat: world.combat, combatant: world.combatant });
  else if (moment === MOMENT.resolve && declaration.lost) await deps.declare?.finish({ caster, record: declaration.lost, combat: world.combat, combatant: world.combatant });
  else if (declaration.hand) await deps.declare?.clearHand({ combat: world.combat, combatant: world.combatant });
  if (moment === MOMENT.declare) {
    const made = await deps.declare?.declare({ caster, spell, answer, combat: world.combat, combatant: world.combatant });
    return { ok: true, declared: true, castId: made?.castId };
  }

  const castId = deps.castId();
  const card = {
    castId,
    spellUuid: spell.uuid,
    spellName: spell.name,
    casterUuid: caster.uuid,
    casterName: caster.name,
    mode,
    picks: answer.picks ?? {},
    // The level with the abilities' deltas on it, and the parts that made it: the relay trusts this value.
    casterLevel: { value: level.value, source: level.source, base: level.base, parts: level.parts, listed: level.listed },
    ...(abilities.save.length || abilities.damage.length ? { abilities: { save: abilities.save, damage: abilities.damage } } : {}),
    save: { category: extras.save?.category ?? "", effect: extras.save?.effect ?? "", kind: extras.save?.kind ?? "" },
    situational: Number.isFinite(Number(answer.situational)) && answer.situational !== "" ? Number(answer.situational) : null,
    cite: extras.cite ?? "",
    duration: castDurationOf(spell, deps.lookups, level.value, deps.roll, mode),
    casterTokenUuid: world.casterToken?.uuid ?? null,
    rows: {},
    order: [],
    targets: {},
    entries: {},
    // A thrown row's throws by target key: `{[rowKey]: {[targetKey]: throws}}`.
    allocation: {},
    lines: [],
  };
  // The weapon the seat named, kept only where exactly one token is targeted and the weapon is one of its own.
  const picked = bearerToken && answer.item ? bearerToken.actor?.items?.get?.(answer.item) : null;
  const weapon = picked?.type === "weapon" ? picked : null;
  const made = modParts(kept, { level: level.value, itemId: weapon?.id ?? null, save: card.save, kind: answer.pickKind ?? null });
  // The creature kind a `pickKind` row was narrowed to is stored on the card, which the relay reads: until the dialog offers the pick, the first authored kind stands and the card says so.
  if (made.kind) card.pickKind = { key: made.kind.key, defaulted: made.kind.defaulted };
  const rolls = [];
  for (const keyed of kept) {
    const { row } = keyed;
    if (isModRow(row)) continue;
    if ((row.type === "damage" || row.type === "heal") && !resolvesAtCast(row)) {
      // A row that recurs from the later rounds waits for its first moment (`cast-recur.mjs`); the card says so in a line.
      card.lines.push(describeSpellEffect(row).text);
    } else if (row.type === "damage" || row.type === "heal") {
      const count = instanceCount(row, level.value);
      if (rowNeedsThrow(row)) {
        // A thrown row whose count the import left blank is thrown at nobody: the card carries the page reference alone.
        card.rows[keyed.key] = { ...cardRow(keyed, {}, count), ...(count.value == null ? { blank: true } : {}) };
      } else {
        const rolled = await rollRow(caster, spell, card, keyed);
        if (rolled.roll) rolls.push(rolled.roll);
        card.rows[keyed.key] = cardRow(keyed, rolled, count);
      }
      card.order.push(keyed.key);
    } else if (placeOf(row) === "row" || placeOf(row) === "rowAndLine") {
      // A kind of the dispatch (`cast-kinds.mjs`): a section with an entry per target, and where its place says so a line, which says what the Judge settles by hand.
      card.rows[keyed.key] = cardRow(keyed, {});
      card.order.push(keyed.key);
      if (placeOf(row) === "rowAndLine") card.lines.push(kindOf(row.type).lineKey ? loc(kindOf(row.type).lineKey) : describeSpellEffect(row).text);
    } else {
      card.lines.push(describeSpellEffect(row).text);
    }
  }
  // A modifier or ward row is a section of the card where it becomes a part or its figure is unread; any other is a line.
  for (const keyed of kept) {
    if (!isModRow(keyed.row)) continue;
    const part = made.parts.find((p) => p.key === keyed.key);
    if (part || made.blank.includes(keyed.key)) {
      card.rows[keyed.key] = modCardRow(keyed, part);
      card.order.push(keyed.key);
    } else card.lines.push(describeSpellEffect(keyed.row).text);
  }
  if (card.pickKind) card.lines.push(loc(card.pickKind.defaulted ? "line.pickKindDefault" : "line.pickKind", { kind: card.pickKind.key }));

  const built = await buildTargets({ tokens: world.tokens, card, rows: kept, save: card.save, situational: card.situational, caster, casterToken: world.casterToken ?? null, extras: castGateExtrasOf(spell, deps.lookups), saveParts: castSaveParts(abilities) });
  rolls.push(...built.rolls);
  card.targets = built.targets;
  card.entries = built.entries;
  const bearerKey = bearerToken ? Object.entries(card.targets).find(([, t]) => !t.self && t.uuid === bearerToken.uuid)?.[0] : null;
  if (weapon && bearerKey) {
    card.item = { targetKey: bearerKey, id: weapon.id, name: weapon.name };
    // The dry run: which of the weapon's parts would yield, told on the card; the roll decides again.
    const yields = dryYields(made.parts, { item: weapon, bearer: bearerToken.actor, spell: { id: cookbookId(spell) || null, name: spell.name, cite: card.cite }, sourceAlignment: actorAlignment(caster) || null });
    card.yields = Object.fromEntries(Object.entries(yields).map(([rowKey, to]) => [entryId(bearerKey, rowKey), to]));
  }

  // A thrown row is thrown as many times as its count, split among the targets (the seat's split, else round-robin), one at a time; with no target its card carries a Throw press.
  const thrown = kept.filter(({ row }) => rowNeedsThrow(row));
  const targetKeys = Object.entries(card.targets).filter(([, t]) => !t.self).map(([k]) => k);
  for (const keyed of thrown) {
    const count = card.rows[keyed.key].count.value;
    if (!targetKeys.length || count == null) continue;
    // A target the row's gate exempts is thrown at never: the default split deals only among the others, and a throw a typed split assigns to an exempt target is spent.
    const exempt = (k) => card.entries[entryId(k, keyed.key)]?.state === "exempt";
    const typed = answer.allocation?.[keyed.key];
    const dealt = count > 1 && typed ? splitFor(count, targetKeys, typed) : splitFor(count, targetKeys.filter((k) => !exempt(k)), null);
    const split = Object.fromEntries(targetKeys.map((k) => [k, exempt(k) ? 0 : (dealt[k] ?? 0)]));
    card.allocation[keyed.key] = Object.fromEntries(Object.entries(split).filter(([, n]) => n > 0));
    for (const targetKey of targetKeys) {
      if (!split[targetKey]) continue;
      const token = world.tokens.find((t) => t.uuid === card.targets[targetKey].uuid) ?? null;
      const made = await throwEntry({ caster, spell, card, keyed, deps, skipDialog: options.skipDialog === true, token, instances: waitingInstances(split[targetKey]) });
      card.entries[entryId(targetKey, keyed.key)] = made.entry;
      Object.assign(card.rows[keyed.key], made.row);
    }
  }

  // A concentration leaves a caster record whatever the rows are: the status held, the tail it outlasts by, flag-timed by its cap where it has one.
  const held = card.duration?.held;
  // A row that recurs on the caster's turn recurs while the caster's record stands (`cast-recur.mjs`), so it counts as lasting. An untimed cast writes the record only where such a row asks a cast-wide save: that save's pass ends it (`endCast` in `cast-recur.mjs`), so the record needs no clock and carries no start and no duration. Any other untimed record would never end.
  const timed = card.duration && !card.duration.none && (castersTurnRecurs(kept) || kept.some(({ row }) => row.lasts === "duration"));
  const untimedRecord = !held && !timed && recurringRows(kept, "casterTurn").some(({ row }) => row.recurSave === "cast");
  card.recurs = kept.some(({ row }) => isRecurring(row));
  if (held || timed || untimedRecord) {
    const mark = { spell: { uuid: spell.uuid, name: spell.name, img: spell.img }, caster: { uuid: caster.uuid }, castId, role: "caster" };
    const data = held
      ? spellEffectData({ ...mark, startTime: deps.now(), statuses: [heldStatusOf(held)], held, tail: card.duration.tail, duration: card.duration.cap })
      : spellEffectData(untimedRecord ? mark : { ...mark, startTime: deps.now(), duration: card.duration });
    try {
      await deps.record(caster, data);
    } catch (err) {
      console.error(`${MODULE_ID} | the cast record was not written`, err);
    }
  }

  const message = await deps.post(card, { rolls, mode: answer.visibility || "public", speaker: undefined });
  const results = await applyAll(message, deps);
  return { ok: true, castId, messageId: message?.id, applied: results };
}

/**
 * One thrown row at one target: its instances thrown in turn, each core throw
 * aimed at that one token, and the entry they leave with what it adds to the
 * card's row. An instance whose throw is cancelled, or whose token is off the
 * viewed scene (said in a notice), stays at Throw with those after it. The card
 * row takes the damage roll's figures where the row is one throw; a count above
 * one has no single roll to show, so only the formula is kept.
 */
async function throwEntry({ caster, spell, card, keyed, deps, skipDialog, token, instances }) {
  const done = await throwInstances(instances, () => {
    const carrier = spellCarrier(caster, keyed.row, { spell, castId: card.castId, rowKey: keyed.key });
    return deps.throwRow(caster, carrier, skipDialog, token);
  });
  if (done.stopped === "offScene") deps.notify?.("warn", "offScene", { name: token?.name ?? "" });
  const single = (card.rows?.[keyed.key]?.count?.value ?? 1) === 1;
  const row = !done.damage ? {} : single ? done.damage : { formula: done.damage.formula };
  return { entry: { state: instancesState(done.instances), instances: done.instances }, row };
}

/** The notice an apply the relay did not take is told with: no GM, a weapon the card no longer names (a Player's press is blocked there), or the entry staying pending. */
export const applyNotice = (reason) => (reason === "noGm" || reason === "badItem" ? reason : "pendingApply");

/** Apply every target's open entries, on the right client each. An entry that cannot be applied stays pending. */
async function applyAll(message, deps) {
  const results = [];
  for (const [targetKey] of Object.entries(cardOf(message)?.targets ?? {})) {
    const card = cardOf(message);
    const requests = pendingRequests(card, targetKey);
    if (!requests.length) continue;
    const done = await deps.apply(message, targetKey, requests);
    if (!done?.ok) deps.notify("warn", applyNotice(done?.reason), { name: card.targets[targetKey].name });
    results.push({ targetKey, ...done });
  }
  return results;
}

/**
 * The claimant for the cast seam. `claims` is synchronous.
 * @param {object} [deps]  see `liveDeps`
 */
export function castSpellClaimant(deps) {
  return {
    key: CAST_SPELL_KEY,
    claims: (item) => castSpellClaims(item, deps?.lookups),
    cast: (item, options, spend) => castSpellRun(item, spend, deps, options),
  };
}

/* -------------------------------------------- */
/*  The card's buttons                           */
/* -------------------------------------------- */

/** The spell of a card and the keyed row it names, from the caster's own spell. */
function rowOfCard(card, rowKey) {
  const spell = fromUuidSync(card.spellUuid);
  const caster = fromUuidSync(card.casterUuid);
  const keyed = spell ? keyedRows(rowsOf(spell, worldLookups()).rows).find((r) => r.key === rowKey) : null;
  return { spell, caster, keyed };
}

/** The writes of a card's entries, from this client. */
const writer = (message) => (id, entry) => updateEntry(message, id, entry);

/** Apply on a press: the card's targets stand, or the presser's targeted tokens become them (the card had none). */
async function pressApply(message, { target, row }) {
  const card = cardOf(message);
  if (!canPressCard(message)) return;
  if (target) {
    const entry = card.entries[entryId(target, row)];
    const result = await requestApply(message, target, [requestOf(row, entry, card)]);
    if (!result.ok) ui.notifications?.warn(loc(`notice.${applyNotice(result.reason)}`, { name: card.targets[target]?.name ?? "" }));
  }
}

/** Apply with no target on the card: the presser's targets take the rolled rows. */
async function pressApplyTargets(message) {
  const card = cardOf(message);
  const tokens = [...(game.user.targets ?? [])].map((t) => t.document ?? t).filter((t) => t?.actor);
  if (!canPressCard(message) || !tokens.length) {
    ui.notifications?.warn(loc("notice.noTargets"));
    return;
  }
  const { spell, caster } = rowOfCard(card, "");
  if (!spell || !caster) return;
  const kept = rowsForMode(rowsOf(spell, worldLookups()).rows, card.mode, card.picks);
  const built = await buildTargets({ tokens, card, rows: kept, save: card.save, situational: card.situational, caster, casterToken: actorToken(caster), extras: castGateExtrasOf(spell, worldLookups()), saveParts: castSaveParts(castAbilitiesOf(caster, spell, worldLookups())) });
  await addTargets(message, built.targets, built.entries);
  const fresh = cardOf(message);
  for (const targetKey of Object.keys(built.targets)) {
    const requests = pendingRequests(fresh, targetKey);
    if (requests.length) await requestApply(message, targetKey, requests);
  }
}

/**
 * A Throw press: the instances still waiting at the target are thrown, each at
 * that one token, and the hits apply once none waits. With no target on the card
 * the presser's first target takes all the row's throws, and the card keeps that
 * split.
 */
async function pressThrow(message, { target, row }) {
  const card = cardOf(message);
  const { spell, caster, keyed } = rowOfCard(card, row);
  const token = target ? fromUuidSync(card.targets[target]?.uuid) : ([...(game.user.targets ?? [])][0]?.document ?? null);
  if (!canPressCard(message) || !spell || !caster?.isOwner || !keyed || !token?.actor) {
    ui.notifications?.warn(loc("notice.noTargets"));
    return;
  }
  // With no target on the card the row's gate is read here, before a throw is spent on a creature the spell does not reach.
  if (!target && !targetGate({ actor: token.actor, extras: castGateExtrasOf(spell, worldLookups()), row: keyed.row, level: card.casterLevel?.value ?? null }).affected) {
    ui.notifications?.warn(loc("notice.exempt", { name: token.name ?? token.actor.name }));
    return;
  }
  const targetKey = target || newTargetKey();
  const held = target ? card.entries?.[entryId(target, row)] : null;
  // An entry from before instances held one throw waiting; a row with no target yet takes all its throws at the presser's token.
  const instances = Array.isArray(held?.instances) ? held.instances : waitingInstances(held ? 1 : (card.rows[row]?.count?.value ?? 1));
  const made = await throwEntry({ caster, spell, card, keyed, deps: liveDeps(), skipDialog: false, token, instances });
  if (!target) {
    await addTargets(message, { [targetKey]: { ...targetOf(token), resist: null } }, {});
    await message.update({ [`flags.${MODULE_ID}.castCard.allocation.${row}.${targetKey}`]: instances.length });
  }
  await updateEntry(message, entryId(targetKey, row), made.entry);
  if (Object.keys(made.row).length) await message.update({ [`flags.${MODULE_ID}.castCard.rows.${row}`]: { ...card.rows[row], ...made.row } });
  if (made.entry.state === "pending") await requestApply(message, targetKey, [requestOf(row, made.entry, card)]);
}

/** An Undo press: the Judge's. */
async function pressUndo(message, { target, row }) {
  if (!game.user.isGM) return;
  const card = cardOf(message);
  const deps = await liveApplyDeps(message.id, { writeEntry: writer(message) });
  const next = await undoEntries(card, target, row, deps);
  for (const [id, entry] of Object.entries(next)) await updateEntry(message, id, entry);
}

let unregister = null;

/**
 * Register the claimant after the summoning's, the card's buttons and the
 * relay. Once, at `init`; a second call replaces the first.
 * @returns {() => void}
 */
export function registerCastSpell() {
  unregister?.();
  addSpellUseClaimant(castSpellClaimant());
  addAttackContributor(abilityDamageContributor);
  registerCastCardHooks({
    [CARD_ACTIONS.apply]: pressApply,
    [CARD_ACTIONS.applyTargets]: pressApplyTargets,
    [CARD_ACTIONS.throw]: pressThrow,
    [CARD_ACTIONS.undo]: pressUndo,
  });
  void registerCastRelay();
  let done = false;
  const off = () => {
    if (done) return;
    done = true;
    removeSpellUseClaimant(CAST_SPELL_KEY);
    if (unregister === off) unregister = null;
  };
  unregister = off;
  return off;
}

