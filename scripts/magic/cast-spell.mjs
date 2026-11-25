/* global game, ui, fromUuid, fromUuidSync, Roll */
/**
 * Casting a spell that has effect rows, and every summoning spell. A claimant
 * on the cast seam (`lib/patches/spell-use.mjs`) takes the cast of a flagged
 * spell on an actor this seat owns, whichever door the player pressed, and
 * declines everything else: a spell with no rows, an actor this seat does not
 * own. A spell whose tradition has a registered procedure
 * (`cast-procedure.mjs`) is taken whatever its rows, and so is a summoning
 * spell of a character, a rowless one too. A monster's attack item is no spell
 * and stays the system's.
 *
 * The cast asks (`apps/cast-dialog.mjs`), refuses before it spends where a
 * Player is blocked and warns a Judge, spends once (`spend()` and, for a
 * vancian tradition, its pool), rolls each row once, has each target's seat
 * roll the save, posts the cast card and applies what the seat may and the GM's
 * client what it may not (`cast-apply.mjs`). A cancel spends nothing.
 *
 * A summoning declares like any cast and asks for its creature and count (the
 * answer's `summon`; the shelf prompt where the dialog gave none). Every
 * refusal lib's placement gives before a click (`summonVerdict`) and a count over
 * the ceiling are verdicts, so they come before the spend. The seat's clicks
 * (`pickPlacement`) come next and make nothing; a cancel there spends nothing,
 * and a declared summons clicks at its turn, where a cancel leaves the
 * declaration standing. The creatures are made only after the spend, the end of
 * the caster's concentration and the tradition's step, and only when the cast
 * proceeds (`APPLY_KINDS.summon.step`). A refusal at the placement is a card
 * line, and the spend stands. The cast leaves the caster a record: the held one
 * for a concentration, else a core-timed one with no clock of this module's own,
 * so its end is announced with Dismiss (`cast-expiry.mjs`).
 *
 * A spell with a seal row has its door picked at the same point, before the
 * spend (`deps.pickDoor`, `lib/door-pick.mjs`): a cancel spends nothing and
 * Enter goes on with the spell's own record and line. A picked door is sealed
 * after the spend (`APPLY_KINDS.seal.step`, `cast-seal-live.mjs`), and the
 * caster's record carries the wall (`sealMark`) whether or not the spell is timed.
 *
 * A row with a throw rides the system's own attack pipeline as the `magic`
 * attack type on a carrier (`lib/patches/attack-throw.mjs`); a row with none
 * is rolled through the same modifier question (`magicDamageSpec`). Both are
 * applied by the cast, never by the system's Apply button.
 */
import { MODULE_ID, FLAG_SPELL, SPELL_TYPE } from "./constants.mjs";
import { rowsOf, rowsForMode, rowNeedsThrow, hasReversedRows, spellSaves, saveGoverns, keyedRows, effectRowsOf, pickGroups, aimedAtSelf, resistedDamage, rowsOfMode, optionTokenOf, resolvesAtCast, awaitsFail, isRecurring, castersTurnRecurs, recurringRows, castAt, flattenAt, readsInvocation, CAST_MODES } from "./cast-rows.mjs";
import { casterLevel, levelNeeded, invocationLevel, invocationFigure, invocationOffered } from "./cast-level.mjs";
import { castAbilityLevel } from "./cast-abilities.mjs";
import { castAbilitiesOf, castSaveParts, abilityDamageContributor } from "./cast-ability-use.mjs";
import { castCapacity, traditionFor, spendsFromPool } from "./cast-capacity.mjs";
import { castVerdicts, blocked } from "./cast-plan.mjs";
import { castDuration, heldByConjuration } from "./cast-duration.mjs";
import { roundsCount, roundsFormulaOf } from "./cast-life.mjs";
import { castMoment, declarationOf, fightHolding, MOMENT } from "./cast-moment.mjs";
import { procedureFor, procedureView, procedureVerdicts, procedureTime, runPerform, runRevert, spellProcedureKind, withoutMissing, BUCKETS_KEY } from "./cast-procedure.mjs";
import { heldRecordData, endCasterHeld } from "./cast-held.mjs";
import { liveDeclare, answerFromPending, ANSWER_FIELDS } from "./cast-declare.mjs";
import { spellEffectData, spellEffectOf, newCastId } from "./spell-effect.mjs";
import { describeSpellEffect } from "./describe.mjs";
import { requestApply, registerCastRelay, undoEntries, liveApplyDeps, entryId } from "./cast-apply.mjs";
import { cardOf, postCastCard, updateEntry, addTargets, newTargetKey, registerCastCardHooks, CARD_ACTIONS, canPressCard, markReverted } from "./cast-card.mjs";
import { isModRow, modParts, needsBearer, dryYields, modifierFigure, ownSaveRows, spellSaveParts, saveModifierOf, ROW_ON } from "./cast-mods.mjs";
import { rangeFeet, rangeVerdicts } from "./cast-range.mjs";
import { instanceCount, instanceRow, allocate, assignedOf, wholeSplit } from "./cast-instances.mjs";
import { OFF_SCENE, withOnlyTarget, waitingInstances, instancesState, throwInstances, splitFor, pendingRequests, requestOf } from "./cast-throw.mjs";
import { areaExtent } from "./cast-area.mjs";
import { placeOf, kindOf, rowOpens, rowResisted, livesKind, entryOf, pickWeapon, takesTargets, stepOf } from "./cast-kinds.mjs";
import { targetGate, noSaveResist } from "./cast-gates.mjs";
import { levelUnder } from "./spell-names.mjs";
import { isSummonSpell, resolveSummonRef } from "./summon-spell.mjs";
import { summonRowsOf, summonOffer, judgeSummon, summonIsConjuration } from "./cast-summon.mjs";
import { SEAL_ROW_TYPE } from "./cast-seal.mjs";
import { displayDuration } from "./spell-logic.mjs";
import { byCookbookId, cookbookId, whenReady } from "../lib/library.mjs";
import { sourceReadable } from "../lib/summons-logic.mjs";
import { addSpellUseClaimant, removeSpellUseClaimant } from "../lib/patches/spell-use.mjs";
import { MAGIC_ATTACK_TYPE, spellCarrier, magicDamageSpec, actorToken, addAttackContributor } from "../lib/patches/attack-throw.mjs";
import { saveThrow, saveSpec } from "../lib/saves.mjs";
import { defenseCite } from "../lib/defenses.mjs";
import { actorAlignment } from "../lib/actor-read.mjs";
import { tokenGapFeet } from "../lib/distance-units.mjs";
import { isMagical } from "../lib/item-model.mjs";
import { TEMPLATE_TYPE } from "../lib/constants.mjs";

/** The claimant's key on the cast seam. */
export const CAST_SPELL_KEY = `${MODULE_ID}.magic.castSpell`;

/** The world lookups the rows and the twin need. */
const worldLookups = () => ({ byCookbookId, fromUuidSync: (uuid) => fromUuidSync(uuid) });

/** The cast's strings. */
const loc = (key, data = {}) => game.i18n.format(`ACKS-MAGIC.cast.${key}`, data);

/** The door seal's strings: its pick's words and the reasons a seal is refused. */
const sealLoc = (key, data = {}) => game.i18n.format(`ACKS-MAGIC.castSeal.${key}`, data);

/** The raw spell flag of an item. */
const flagOf = (item) => item?.flags?.[MODULE_ID]?.[FLAG_SPELL] ?? {};

/** Does the spell hold a summon row, or print as a summoning? A summon row on an item that is no character's summoning spell is declined. */
const summoning = (item) => isSummonSpell(item) || effectRowsOf(item).some((row) => row.type === "summon");

/**
 * Does this claimant take this cast? A flagged spell item on an actor this
 * seat owns whose tradition has a registered procedure (rows or not), that is
 * marked a ritual (rows or not), or that is a character's summoning spell
 * (rows or not), else one with rows of its own or its twin's and no summon row.
 * @param {Item} item
 * @param {{byCookbookId: Function, fromUuidSync: Function}} [lookups]
 * @param {((actor: object) => object|null)|null} [classFor]  the classes feature's `classForActor`, which tells the tradition that cast the spell; without it no procedure is found
 */
export function castSpellClaims(item, lookups = worldLookups(), classFor = null) {
  if (item?.type !== SPELL_TYPE || item.parent?.isOwner !== true) return false;
  const flag = item.flags?.[MODULE_ID]?.[FLAG_SPELL];
  if (!flag || typeof flag !== "object" || !Object.keys(flag).length) return false;
  if (spellProcedureKind(item, classFor)) return true;
  // A ritual is opened as a project whatever rows it has and whichever tradition cast it.
  if (flag.ritual === true) return true;
  if (isSummonSpell(item)) return true;
  if (summoning(item)) return false;
  return rowsOf(item, lookups).rows.length > 0;
}

/** The casting time the spell prints: the copy's own, else its library twin's where the copy prints none. */
export function castTimeOf(spell, lookups) {
  const own = flagOf(spell).castingTime;
  if (own?.shape) return own;
  const id = spell?.flags?.[MODULE_ID]?.cookbook?.id;
  const twin = id ? lookups?.byCookbookId?.("Item", id) : null;
  return flagOf(twin).castingTime ?? own ?? null;
}

/**
 * The duration of a cast: the spell's own duration object, else its twin's, with the
 * resolved level. In the reversed mode the reverse's own duration (`reversedDuration`,
 * the copy's else its twin's) stands where it prints a shape, and the plain duration
 * where it does not.
 */
export function castDurationOf(spell, lookups, level, roll, mode = CAST_MODES.normal) {
  return castDuration(durationShapeOf(spell, lookups, mode), { casterLevel: level, roll });
}

/** The duration object a cast reads (the spell's own, else its twin's; the reverse's in the reversed mode where it prints one): the imported shape, not yet resolved at a level. */
export function durationShapeOf(spell, lookups, mode = CAST_MODES.normal) {
  const own = flagOf(spell);
  const id = spell.flags?.[MODULE_ID]?.cookbook?.id;
  const twin = id ? lookups?.byCookbookId?.("Item", id) : null;
  if (mode === CAST_MODES.reversed) {
    const reverse = own.reversedDuration?.shape ? own.reversedDuration : flagOf(twin).reversedDuration;
    if (reverse?.shape) return reverse;
  }
  return own.duration?.shape ? own.duration : (flagOf(twin).duration ?? own.duration);
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

/** The figures of `castFiguresOf` as the spell prints them, before the invocation scale is read. */
function rawFiguresOf(spell, lookups) {
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
 * The spell's range and target figures: the copy's own, else its library
 * twin's where the copy prints none (the twin is read as the duration's is).
 * A figure keyed on the invocation level is read at `at` (`flattenAt`): null
 * below its first rung and with no level set. A range is a distance and never
 * follows the level.
 *
 * @param {{invocationLevel?: number|null}|null} [at]
 */
export function castFiguresOf(spell, lookups, at = null) {
  const { range, target, cite } = rawFiguresOf(spell, lookups);
  return { ...flattenAt({ range, target }, at), cite };
}

/**
 * The figures the target gates read (`cast-gates.mjs`): the Hit Dice cap from the
 * target figures (the copy's own, else its twin's, as `castFiguresOf` reads
 * them) and the Hit Dice below which no save is made from the copy's own save.
 * The cast, the card's presses and the relay's GM client all read them here, so
 * a gate is the same on each. `spell` is the spell as a record's immunity names
 * it (`{id}`, the definition id the record stacks as), null for a spell with none.
 * The figures are read at `at`, the invocation level (`castFiguresOf`).
 *
 * @param {{invocationLevel?: number|null}|null} [at]
 */
export function castGateExtrasOf(spell, lookups, at = null) {
  const id = cookbookId(spell) || null;
  return { target: castFiguresOf(spell, lookups, at).target, save: flattenAt(flagOf(spell).save ?? null, at), spell: id ? { id, provides: [] } : null };
}

/**
 * Does a cast of this spell read the invocation level: a row bounded by it or
 * keyed on it among the spell's `rows`, or a range, target or save figure
 * keyed on it? Read off the raw rows and figures, which a gate and a flatten
 * leave no sign in with no level set.
 *
 * @param {object[]} rows  the spell's rows (`rowsOf`), the cast's mode's or all of them
 */
export const castReadsInvocation = (spell, lookups, rows) => {
  const { range, target } = rawFiguresOf(spell, lookups);
  return readsInvocation([rows, range, target, flagOf(spell).save]);
};

/**
 * What the spell's range and target count say of the targeted tokens at a caster
 * level: the range verdict inputs (`cast-range.mjs`) and the count cap, each
 * null or empty where the import read nothing. A per-level figure reads only
 * once a level is known.
 * A cast whose rows open no entry for a target (`takesTargets`) measures none:
 * `takes` false answers no range verdict and no count.
 * @param {{figures: {range: object|null, target: object|null}, level: number|null, tokens: object[], gaps?: Record<string, number|null>, takes?: boolean}} from
 * @returns {{range: ReturnType<typeof rangeVerdicts>, count: number|null}}
 */
export function castReach({ figures, level, tokens, gaps = {}, takes = true }) {
  if (!takes) return { range: rangeVerdicts({}), count: null };
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

/**
 * What a cast reads of its caster before any target: the tradition that cast the
 * spell, what that tradition has left of the spell's level (`capacity`), and the
 * figures the caster level resolves from (`level`, which `casterLevel` takes).
 * Synchronous and free of the seat, so the castable-spell register reads it too
 * (`repertoire.mjs`). The caller reads the actor's class and pools, which
 * need the classes feature this file does not import.
 *
 * @param {Actor} actor  the caster
 * @param {Item} spell
 * @param {{classItem?: object|null, pools?: object[], capAt?: ((classItem: object|null, tradition: object|null, level: number) => number|null)|null}} [from]  `classForActor(actor)` and `poolState(actor)`, and the classes feature's `traditionCapAt` where it has one; with none the tradition has no cap
 * @returns {{found: {tradition: object, spellLevel: number|null}|null, spellLevel: number|null, capacity: ReturnType<typeof castCapacity>, cap: number|null, level: {matched: boolean, classLevel: number, ladder: object|null, monsterLevel: number}}}
 */
export function castReading(actor, spell, { classItem = null, pools = [], capAt = null, ladderOf = null } = {}) {
  const extras = flagOf(spell);
  const found = traditionFor(classItem?.system?.casting, { extras, lvl: spell.system?.lvl, class: spell.system?.class });
  const spellLevel = found?.spellLevel ?? levelUnder(extras, spell.system?.lvl, new Set());
  const castsAtLevel = actor.items.filter((i) => i.type === SPELL_TYPE && Number(i.system?.lvl) === spellLevel).reduce((sum, i) => sum + (Number(i.system?.cast) || 0), 0);
  const capacity = castCapacity({ pools, coreSpells: actor.system?.spells, castsAtLevel, tradition: found?.tradition?.key ?? null, spellLevel });
  const ladderKey = found?.tradition?.casterLevel;
  const ladder = ladderKey ? ((classItem?.system?.ladders ?? []).find((l) => l.key === ladderKey) ?? { values: [] }) : null;
  // The tradition's invocation-level cap at the class level, where the classes feature reads one.
  const cap = found && typeof capAt === "function" ? invocationFigure(capAt(classItem, found.tradition, actor.system?.details?.level)) : null;
  return {
    found,
    spellLevel,
    capacity,
    cap,
    // The ladder the tradition's cap is read from, `{key, label, top}`, which bounds the invocation-level menu; null where it names none.
    ladder: found && typeof ladderOf === "function" ? (ladderOf(classItem, found.tradition) ?? null) : null,
    level: {
      matched: Boolean(found),
      classLevel: actor.system?.details?.level,
      ladder,
      monsterLevel: actor.getFlag?.(MODULE_ID, "extras")?.spellcasting?.level,
    },
  };
}

/** The reading of the live world a cast needs, in one place. */
async function readWorld(spell) {
  const actor = spell.parent;
  const { classForActor } = await import("../classes/registry.mjs");
  // A namespace, so the cap reads where the classes feature has one and is null where it has not.
  const casting = await import("../classes/casting.mjs");
  const classItem = classForActor(actor);
  const { found, capacity, level, cap, ladder } = castReading(actor, spell, { classItem, pools: casting.poolState(actor), capAt: casting.traditionCapAt, ladderOf: casting.traditionCapLadder });
  const records = [...(actor.effects ?? [])].map((e) => spellEffectOf(e)).filter(Boolean);
  const fight = castFight(actor);
  const casterToken = actorToken(actor);
  return {
    actor,
    casterToken,
    combat: fight?.combat ?? null,
    combatant: fight?.combatant ?? null,
    held: records.some((r) => r.role === "caster" && r.held),
    declarations: records.filter((r) => r.pending),
    prepareSpell: fight?.combatant?.flags?.acks?.prepareSpell === true,
    statuses: [...(actor.statuses ?? [])],
    capacity,
    cap,
    ladder,
    level,
    // The class and the tradition that cast the spell: the tradition's kind is what finds its procedure.
    classItem: classItem ?? null,
    tradition: found?.tradition ?? null,
  };
}

/**
 * The tokens this seat has targeted (token documents with an actor), and the
 * centre-to-centre gap in feet from the caster's token to each; null where it
 * cannot be measured (no caster token, another scene). `game.user.targets` is
 * per user, so a Player's seat reads its own.
 *
 * @param {object|null} casterToken
 * @returns {{tokens: object[], gaps: Record<string, number|null>}}
 */
export function readTargets(casterToken) {
  return seatOf(casterToken, [...(game.user.targets ?? [])].map((t) => t.document ?? t).filter((t) => t?.actor));
}

/** A seat's tokens with the gap in feet from the caster's token to each. */
const seatOf = (casterToken, tokens) => ({ tokens, gaps: Object.fromEntries(tokens.map((t) => [t.uuid, tokenGapFeet(casterToken, t)])) });

/**
 * The tokens a declaration named, found again at the caster's turn: the seat they
 * make, and the uuids of those that are gone (a deleted token, scene or actor).
 *
 * @param {string[]} uuids  the declaration's stored targets
 * @param {object|null} casterToken
 * @returns {Promise<{tokens: object[], gaps: Record<string, number|null>, gone: string[]}>}
 */
export async function declaredSeat(uuids, casterToken) {
  const tokens = [];
  const gone = [];
  for (const uuid of uuids) {
    const found = await fromUuid(uuid).catch(() => null);
    if (found?.documentName === "Token" && found.actor) tokens.push(found);
    else gone.push(uuid);
  }
  return { ...seatOf(casterToken, tokens), gone };
}

/**
 * Make the given tokens this user's targets and no others, so the canvas shows
 * the seat the card is made for. A token with no canvas object (another scene)
 * has nothing to target and stays in the seat only.
 * @param {object[]} tokens  token documents
 */
export function retarget(tokens) {
  const objects = tokens.map((t) => t.object).filter((o) => o?.setTarget);
  if (!objects.length) {
    for (const t of [...(game.user.targets ?? [])]) t.setTarget?.(false, { releaseOthers: false });
    return;
  }
  objects.forEach((object, i) => object.setTarget(true, { releaseOthers: i === 0 }));
}

/** A target as the card keeps it. */
const targetOf = (token) => ({ uuid: token.uuid, name: token.name || token.actor?.name || "" });

/** A target as the dialog's bucket draws it: the card's fields and the token's picture. */
const bucketOf = (token) => ({ ...targetOf(token), img: token.texture?.src || token.actor?.img || "" });

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
 * the caster's abilities' parts on each target's save (`castSaveParts`), with the
 * spell's own save modifier where the seat switched it on (`spellSaveParts`).
 * `items` is the weapon picked for each holder, by token uuid: a row of a kind that
 * names a weapon opens that holder's entry with it.
 */
export async function buildTargets({ tokens, card, rows, save, situational, caster, casterToken = null, randomID, extras = null, saveParts = [], items = {} }) {
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
    if (!livesKind(row.type) || row.lasts !== "rounds" || awaitsFail(row)) return {};
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
  const add = async (key, target, forRow, gates = null, actor = null, pick = null) => {
    targets[key] = target;
    for (const { key: rowKey, row } of entered) {
      if (!forRow(row)) continue;
      const gate = gates?.[rowKey];
      if (gate && !gate.affected) entries[entryId(key, rowKey)] = { state: "exempt", gate: gate.why };
      else if (open.some((o) => o.key === rowKey) && !rowNeedsThrow(row)) entries[entryId(key, rowKey)] = { state: "pending", ...(await opened(row)), ...entryOf(row, actor, pick) };
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
    await add(newTargetKey(randomID), { ...targetOf(token), resist: made.resist }, (row) => !aimedAtSelf(row), gates, token.actor, items?.[token.uuid] ?? null);
  }
  if (hasSelf && caster) await add(newTargetKey(randomID), { uuid: caster.uuid, name: caster.name, self: true, resist: null }, aimedAtSelf, null, caster);
  return { targets, entries, rolls };
}

/** The dependencies a cast uses, as the live world gives them; a test supplies its own. */
const liveDeps = () => ({
  ready: whenReady,
  lookups: worldLookups(),
  read: readWorld,
  targets: (world) => readTargets(world.casterToken),
  declaredTargets: (uuids, world) => declaredSeat(uuids, world.casterToken),
  retarget,
  ask: async (ctx) => (await import("./apps/cast-dialog.mjs")).CastDialog.wait(ctx),
  notify: (level, key, data) => ui.notifications?.[level]?.(loc(`notice.${key}`, data ?? {})),
  // A finding a tradition's procedure worded itself.
  notifyText: (level, text) => ui.notifications?.[level]?.(text),
  // Does the world still hold this document? (a stored bucket entry is read again where its cast resolves)
  holds: async (uuid) => Boolean(await fromUuid(uuid).catch(() => null)),
  adjustPool: async (actor, tradition, slotKey) => (await import("../classes/casting.mjs")).adjustPool(actor, tradition, slotKey, 1),
  castId: () => newCastId(),
  // The locations a caster is linked to, and the opening of a ritual's project at one of them.
  ritualLocations: async (caster) => (await import("./research-project-live.mjs")).locationsOf(caster),
  ritualOpen: async ({ location, spell, caster }) => (await import("./research-project-live.mjs")).openRitual(location, { spell, caster }),
  roll: (formula) => new Roll(formula).evaluateSync().total,
  post: postCastCard,
  apply: requestApply,
  record: async (caster, data) => caster.createEmbeddedDocuments("ActiveEffect", [data]),
  endHeld: endCasterHeld,
  declare: liveDeclare(),
  // A summoning's creature prompt, the ref's creature, lib's pre-click checks, the seat's clicks and the placement (`lib/summons.mjs`, loaded where a summoning is cast).
  pickSummon: async (caster, o) => (await import("../lib/summons.mjs")).pickSummon(caster, o),
  summonVariant: async (caster, family, o) => (await import("../lib/summons.mjs")).summonVariant(caster, family, o),
  // Of several documents carrying a row's id, the seat is offered the one its user observes, as lib's own lookup takes it.
  resolveRef: (ref) => resolveSummonRef(ref, { fromUuid: (uuid) => fromUuid(uuid), byCookbookId: (type, id) => byCookbookId(type, id, { prefer: (doc) => sourceReadable(doc, game.user) }) }),
  summonVerdict: async (caster, o) => {
    const lib = await import("../lib/summons.mjs");
    const verdict = await lib.summonVerdict(caster, o);
    return verdict.ok ? verdict : { ...verdict, notice: lib.refusalText(verdict.reason) };
  },
  familyReadable: async (family) => {
    const lib = await import("../lib/summons.mjs");
    return sourceReadable(family, game.user) ? { ok: true } : { ok: false, reason: "unreadable", notice: lib.refusalText("unreadable") };
  },
  pickPlacement: async (caster, o) => (await import("../lib/summons.mjs")).pickPlacement(caster, o),
  summon: async (ctx) => {
    const lib = await import("../lib/summons.mjs");
    const result = (await lib.placeSummons(ctx.caster, { sourceUuid: ctx.pick.ref, count: ctx.positions.length, spellId: ctx.spell.id, positions: ctx.positions, castId: ctx.castId, cast: ctx.cast, rangeFeet: ctx.rangeFeet, calling: ctx.calling, casterToken: ctx.casterToken })) ?? { ok: false, reason: "noGm" };
    lib.announceSummon(result);
    // lib words every refusal but a missing GM; the card says that one itself.
    return result.ok || result.reason === "noGm" ? result : { ...result, notice: lib.refusalText(result.reason) };
  },
  // A seal's door is picked on the scene in view (`lib/door-pick.mjs`), and the seal is written by this seat or the GM's client (`cast-seal-live.mjs`). The words are the cast's own.
  pickDoor: async ({ cite, ...o }) =>
    (await import("../lib/door-pick.mjs")).pickDoor({
      ...o,
      text: {
        banner: sealLoc("pick.banner"),
        tip: sealLoc(cite ? "pick.tip" : "pick.tipBare", { cite }),
        far: sealLoc("pick.far"),
        refused: (reason) => sealLoc(`refused.${reason}`),
      },
    }),
  seal: async (ctx) => (await import("./cast-seal-live.mjs")).writeSeal(ctx.request),
  // One core throw, with the seat's targets narrowed to the token it is for and restored after; a token off the viewed scene is not thrown at.
  throwRow: async (caster, carrier, skipDialog, token = null) => {
    const run = () => caster.makeAttackThrow({ item: carrier, attackType: MAGIC_ATTACK_TYPE, skipDialog });
    if (!token) return run();
    const done = await withOnlyTarget(token, run);
    return done.ok ? done.value : OFF_SCENE;
  },
  now: () => game.time.worldTime,
  isGM: () => game.user.isGM,
  // The seat's own user, whose level on a creature decides whether the Summon band names it.
  user: () => game.user,
  // Is a GM connected to make a Player's creatures?
  gmOnline: () => Boolean(game.users?.activeGM),
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
 * The cast of a ritual spell: the dialog offers the locations the caster is linked to, and the answer opens a research project
 * of kind ritual there (`deps.ritualOpen`). Nothing is spent and no turn is read: the cast is the project, worked at the location.
 * @returns {Promise<{ok: boolean, reason?: string, ritual?: boolean, projectId?: string, locationUuid?: string}>}
 */
async function castRitual(spell, deps) {
  const caster = spell.parent;
  const locations = (await deps.ritualLocations?.(caster)) ?? [];
  const answer = await deps.ask({ spell, caster, isGM: deps.isGM(), ritual: { locations, level: spell.system?.lvl ?? null } });
  if (!answer) return { ok: false, reason: "cancelled" };
  const location = locations.find((l) => l.uuid === answer.ritual?.locationUuid);
  if (!location) return { ok: false, reason: "noLocation" };
  const made = await deps.ritualOpen({ location, spell, caster });
  return made?.ok ? { ok: true, ritual: true, projectId: made.id, locationUuid: location.uuid } : { ok: false, reason: made?.reason ?? "ritual" };
}

/**
 * The cast of one spell with rows. Asks, then refuses or spends, rolls,
 * posts and applies. `spend()` runs once and only after the dialog confirms
 * and the verdicts allow it, before any dice.
 *
 * @param {Item} spell
 * @param {() => Promise<boolean>} spend  the seam's once-only door to the system's cast
 * @param {object} [deps]  see `liveDeps`
 * @param {{skipDialog?: boolean, fromProject?: boolean}} [options]  the cast's options from the seam; `fromProject` resolves the effect of a ritual a finished project cast (`castFromProject`): the ritual is not claimed again, and the cast takes no slot, reads no turn and leaves no declaration
 * @returns {Promise<{ok: boolean, reason?: string, castId?: string, messageId?: string}>}
 */
export async function castSpellRun(spell, spend, deps = liveDeps(), options = {}) {
  const caster = spell.parent;
  await deps.ready?.();
  const extras = flagOf(spell);
  // A ritual is not cast from a slot or a turn: its dialog names a location and the cast opens a project there.
  const fromProject = options.fromProject === true;
  if (extras.ritual === true && !fromProject) return castRitual(spell, deps);
  const { rows: all } = rowsOf(spell, deps.lookups);
  const read = await deps.read(spell);
  // A cast from a project was the project: no slot, no turn, no declaration and no tradition procedure (its throw and its spends) stand behind it, so none is read.
  const world = fromProject ? { ...read, capacity: null, cap: null, tradition: null, combat: null, combatant: null, declarations: [], prepareSpell: false } : read;
  // The seat's targets are read apart from the world: the dialog is a bucket the seat fills and empties, and the cast reads them again once it is answered.
  const readSeat = () => deps.targets?.(world) ?? { tokens: world.tokens ?? [], gaps: world.gaps ?? {} };
  let seat = readSeat();
  const isGM = deps.isGM();
  const modeKeys = hasReversedRows(all) ? [CAST_MODES.normal, CAST_MODES.reversed] : [CAST_MODES.normal];
  // The invocation level a form of the spell is cast at (`cast-level.mjs`). It is asked where the tradition has a cap or a row or figure reads the scale, judged on the raw rows of the form: with no level set a gate drops the rows that bound it and a flatten blanks the figures, so the kept ones show no sign of it. `inv` is the level the seat holds, a number or what a field of it types.
  const levelFor = (mode, inv) => {
    const ctx = { cap: world.cap ?? null, reads: castReadsInvocation(spell, deps.lookups, all.filter((row) => Boolean(row.reversed) === (mode === CAST_MODES.reversed))) };
    return { ...invocationLevel(ctx, { invocationLevel: inv }), reads: ctx.reads, offered: invocationOffered(ctx), ladder: world.ladder ?? null, classLevel: world.level?.classLevel ?? null };
  };
  const atFor = (mode, inv) => ({ invocationLevel: levelFor(mode, inv).value });
  const groupsFor = (mode, inv) => pickGroups(all, mode, atFor(mode, inv));
  // Where the cast falls in a fight at its turn, apart from how long it takes, and the declaration it resolves.
  const turnMoment = castMoment({ combat: world.combat, combatant: world.combatant });
  const declaration = declarationOf(world.declarations ?? [], { spellUuid: spell.uuid, combatId: world.combat?.id ?? null, prepareSpell: world.prepareSpell === true });
  const resolving = turnMoment === MOMENT.resolve && Boolean(declaration.valid);
  // A declaration being resolved answers for itself (below), invocation level included, and the context starts from it.
  const declared = resolving ? answerFromPending(declaration.valid.pending) : null;
  // A stored bucket entry whose document the world no longer holds is dropped without a word: the strip on a lost item (`cast-declare.mjs`) takes most, and what it missed is dropped here. The bucket's own verdicts judge what is left.
  if (declared && BUCKETS_KEY in declared.procedure) declared.procedure = { ...declared.procedure, [BUCKETS_KEY]: await withoutMissing(declared.procedure, deps.holds) };
  const startInv = declared?.invocationLevel;
  const figuresAt = (mode, inv) => castFiguresOf(spell, deps.lookups, atFor(mode, inv));
  const figures = figuresAt(modeKeys[0], startInv);
  // The caster's abilities that apply to this spell: they add to the caster level, the targets' saves and the damage, never to the slots or the uses.
  const abilities = castAbilitiesOf(caster, spell, deps.lookups);
  const known = castAbilityLevel(casterLevel(world.level), abilities.casterLevel);
  // The tradition's procedure (`cast-procedure.mjs`), where it has one, and what a ctx of it reads. Its answer is held apart from the rows' choices.
  const procedure = procedureFor({ source: "spell", tradition: world.tradition ?? null });
  const procedureKind = procedure ? world.tradition.kind : null;
  const spellTime = castTimeOf(spell, deps.lookups);
  const procCtx = (inv, levelValue, at) => ({
    actor: caster,
    spell,
    tradition: world.tradition ?? null,
    classItem: world.classItem ?? null,
    invocationLevel: inv ?? null,
    casterLevel: levelValue ?? null,
    isGM,
    moment: at,
    combat: world.combat ?? null,
    source: "spell",
    roll: deps.roll,
    now: deps.now,
    // A bucket's rows are read from the documents its stored uuids name, synchronously (a stored declaration is judged at its turn with no dialog).
    resolve: (uuid) => deps.lookups?.fromUuidSync?.(uuid) ?? null,
  });
  // The procedure's answer as the dialog holds it (`raw`), coerced to its fields. A cast with no procedure has none.
  const procViewAt = (mode, inv, levelValue, praw, at = turnMoment) => procedureView(procedure, procCtx(levelFor(mode, inv).value, levelValue, at), praw);
  // How long the cast takes: the procedure's time, else the spell's.
  const timeAt = (mode, inv, levelValue, praw) => {
    const view = procViewAt(mode, inv, levelValue, praw);
    return procedureTime(procedure, procCtx(levelFor(mode, inv).value, levelValue, turnMoment), view?.answer ?? {}, spellTime);
  };
  // Where the cast falls, given how long it takes: a stored declaration resolves as it was declared, and any other cast over a round is `long`.
  const momentAt = (mode, inv, levelValue, praw) => (resolving ? MOMENT.resolve : castMoment({ combat: world.combat, combatant: world.combatant, castingTime: timeAt(mode, inv, levelValue, praw) }));
  let moment = momentAt(modeKeys[0], startInv, known.value, declared?.procedure);
  // What the range and the target count say of the targeted tokens at a caster level, for the rows the picks keep: a cast whose rows open no entry measures no target.
  const reachAt = (levelValue, inv = startInv, mode = modeKeys[0], picks = {}) =>
    castReach({ figures: figuresAt(mode, inv), level: levelValue, tokens: seat.tokens, gaps: seat.gaps, takes: takesTargets(rowsForMode(all, mode, picks, atFor(mode, inv))) });
  // Each thrown row's instance count at a caster level, and how many throws the seat's split assigns it (the default split assigns the count). A split is typed by token uuid.
  const instancesFor = (mode, picks, levelValue, typed = null, inv = startInv) => {
    const counts = {};
    const assigned = {};
    const here = new Set(seat.tokens.map((t) => t.uuid));
    for (const { row, key } of rowsForMode(all, mode, picks, atFor(mode, inv))) {
      if (!rowNeedsThrow(row)) continue;
      counts[key] = instanceCount(row, levelValue).value;
      const split = counts[key] > 1 && typed?.[key] ? wholeSplit(typed[key]) : null;
      // A typed split counts only the targets the seat has.
      assigned[key] = split ? assignedOf(Object.fromEntries(Object.entries(split).filter(([uuid]) => here.has(uuid)))) : (counts[key] ?? 0);
    }
    return { counts, assigned };
  };
  const verdictsFor = (mode, picks, levelValue, typed = null, inv = startInv, praw = declared?.procedure ?? {}, summon = null) => {
    const reach = reachAt(levelValue, inv, mode, picks);
    const { value, cap, reads } = levelFor(mode, inv);
    const at = momentAt(mode, inv, levelValue, praw);
    const view = procViewAt(mode, inv, levelValue, praw, at);
    return castVerdicts({
      capacity: world.capacity,
      targets: seat.tokens,
      rows: rowsForMode(all, mode, picks, atFor(mode, inv)),
      statuses: world.statuses,
      isGM,
      held: world.held === true,
      moment: at,
      declaration,
      range: reach.range,
      count: reach.count,
      instances: instancesFor(mode, picks, levelValue, typed, inv),
      invocation: { value, cap, reads },
      procedure: view ? [...procedureVerdicts(procedure, procCtx(value, levelValue, at), view.answer), ...view.findings] : [],
      summon,
    });
  };
  // The thrown rows whose count is above one and that several targets could share: the dialog offers a split of each, one figure per target, by token uuid.
  const splitsFor = (mode, inv = startInv) =>
    seat.tokens.length < 2
      ? []
      : rowsOfMode(all, mode, atFor(mode, inv)).flatMap(({ row, key }) => {
          if (!rowNeedsThrow(row)) return [];
          const count = instanceCount(row, known.value);
          return count.value > 1 ? [{ key, row, count, pick: String(row.pick ?? "").trim(), option: optionTokenOf(row, key), split: allocate(count.value, seat.tokens.map((t) => t.uuid)) }] : [];
        });
  // One targeted token can bear a weapon buff.
  const bearerOf = () => (seat.tokens.length === 1 ? seat.tokens[0] : null);
  // A declaration being resolved answers for itself, on the targets it declared: they are found again by uuid, are the seat's targets from here on (the canvas shows them) and are not read from the user's targets again unless the dialog opens. A record written before targets were stored reads the seat's targets as they stand.
  let gone = [];
  if (declared?.targets) {
    const found = deps.declaredTargets ? await deps.declaredTargets(declared.targets, world) : { tokens: (world.tokens ?? []).filter((t) => declared.targets.includes(t.uuid)), gaps: world.gaps ?? {}, gone: declared.targets.filter((u) => !(world.tokens ?? []).some((t) => t.uuid === u)) };
    seat = { tokens: found.tokens, gaps: found.gaps ?? {} };
    gone = found.gone ?? [];
    await deps.retarget?.(seat.tokens);
  }
  // The dialog opens only where a declared target is gone or its stored weapon is not one of the one target's.
  const itemsFit = !declared || !needsBearer(rowsForMode(all, declared?.mode, declared?.picks ?? {}, atFor(declared?.mode, declared?.invocationLevel))) || bearerOf()?.actor?.items?.get?.(declared?.items?.[bearerOf().uuid])?.type === "weapon";
  const storedFits = Boolean(declared) && !gone.length && itemsFit;
  if (declared && !storedFits) {
    const why = gone.length ? "resolveGone" : "resolveItem";
    deps.notify(gone.length ? "warn" : "info", why, { name: caster.name, n: gone.length });
  }
  const gateExtras = (inv = startInv) => castGateExtrasOf(spell, deps.lookups, atFor(modeKeys[0], inv));
  // A summoning's creatures: its rows' own, each resolved once. The dialog's Summon band offers them and answers one; with none, it answers the creature dropped on it.
  const summoning = isSummonSpell(spell) && !fromProject;
  const summonRows = summoning ? summonRowsOf(spell, deps.lookups) : [];
  // No shelf list is offered: a spell whose rows name no creature takes one dropped on the Summon band.
  const offer = summoning ? await summonOffer(summonRows, { resolveRef: deps.resolveRef, user: deps.user?.() ?? { isGM: deps.isGM() } }) : null;
  const openRow = summonRows.find((row) => !String(row?.ref ?? "").trim()) ?? null;
  // A Player's creatures are made by the GM's client: with none connected the placement would be refused after the spend. A Judge's own seat needs no relay.
  const gmMissing = () => !deps.isGM() && Boolean(deps.gmOnline) && !deps.gmOnline();
  const noGm = () => ({ reason: "noGm", notice: loc("notice.summonNoGm") });
  // The refusal lib gives a request for a creature its user cannot open, read before the press for a pick the band flags `opens: false`; a Judge's seat opens every creature.
  const unreadable = () => ({ reason: "unreadable", notice: game.i18n.localize("ACKS-LIB.summons.refused.unreadable") });
  // The pick as the band holds it, weighed at the level and invocation level the seat holds, for the dialog's footer: the reading the confirm takes, less lib's own checks (they wait for the click), but for the one that says the seat cannot open the creature.
  const summonAt = (picked, { mode: form, level: levelValue, inv, declaring = false }) => ({
    ...judgeSummon(summonRows, picked, { source: picked.source ?? null, level: levelValue, at: { invocationLevel: inv }, refused: !deps.isGM() && picked.opens !== true ? unreadable() : !declaring && gmMissing() ? noGm() : null }),
    range: rangeFeet(figuresAt(form ?? modeKeys[0], inv).range, levelValue)?.value ?? null,
  });
  const askContext = () => ({
    spell,
    caster,
    moment,
    // A summoning's creatures and the judge of a pick; null where the cast summons nothing.
    summon: summoning ? { creatures: offer.creatures, open: !offer.creatures.length ? { amount: Number(openRow?.amount) || 0 } : null, at: summonAt } : null,
    // Where the cast falls with the seat's own answer (the procedure's casting time can lengthen it past a round).
    momentAt: (mode, levelValue, praw, inv = startInv) => momentAt(mode ?? modeKeys[0], inv, levelValue ?? known.value, praw ?? declared?.procedure ?? {}),
    // The tradition's procedure as the dialog draws it: its fields, the answer they make and its band, read against the seat's answer so far (and the invocation level it holds); null where the tradition has none.
    procedure: procedure ? { kind: procedureKind, label: procedure.label ?? null, traditionLabel: world.tradition?.label ?? "", at: (mode, praw, levelValue, inv = startInv) => procViewAt(mode ?? modeKeys[0], inv, levelValue ?? known.value, praw ?? declared?.procedure ?? {}, momentAt(mode ?? modeKeys[0], inv, levelValue ?? known.value, praw ?? declared?.procedure ?? {})) } : null,
    // The band's heading where the tradition has no procedure of its own to name it.
    traditionLabel: world.tradition?.label ?? "",
    modes: modeKeys,
    rows: all,
    groups: Object.fromEntries(modeKeys.map((m) => [m, groupsFor(m, startInv)])),
    // The same at the invocation level the seat holds.
    groupsAt: (mode, inv = startInv) => groupsFor(mode ?? modeKeys[0], inv),
    instancesAt: (mode, inv = startInv) => splitsFor(mode ?? modeKeys[0], inv),
    // The invocation level as a figure the seat holds reads (`levelFor`): its value, source, cap, ladder and whether it is offered.
    invocationAt: (mode, inv) => levelFor(mode ?? modeKeys[0], inv),
    resolve: (uuid) => deps.lookups?.fromUuidSync?.(uuid) ?? null,
    level: known,
    // The invocation level, per form: the cap the tradition gives, whether a row or figure reads the scale, whether it is asked, and the level it stands at (a declaration's, else none).
    invocation: Object.fromEntries(modeKeys.map((m) => [m, levelFor(m, startInv)])),
    // `levelNeeded` reads the rows themselves, not the keyed pairs.
    levelNeeded: [CAST_MODES.normal, CAST_MODES.reversed].some((m) => levelNeeded({ ...extras, ...figures }, rowsForMode(all, m, {}, atFor(m, startInv)).map(({ row }) => row))),
    // Each targeted holder's weapons, and the one a pick starts on (the equipped weapon, else the first).
    holders: seat.tokens.map((t) => ({ uuid: t.uuid, weapons: weaponsOf(t.actor), pick: pickWeapon(t.actor)?.id ?? "" })),
    needsWeapon: Object.fromEntries(modeKeys.map((m) => [m, needsBearer(rowsForMode(all, m, {}, atFor(m, startInv)))])),
    targets: seat.tokens.map(bucketOf),
    gaps: seat.gaps,
    saves: spellSaves(extras.save),
    // The spell's own modifier on the save, as imported (a level value), and the caster's abilities' parts on it.
    saveModifier: extras.save?.modifier ?? null,
    saveParts: castSaveParts(abilities),
    capacity: world.capacity,
    verdicts: Object.fromEntries(modeKeys.map((m) => [m, verdictsFor(m, {}, known.value)])),
    // Per form, the thrown rows a seat with several targets may split, each with its count and the default split by target.
    instances: Object.fromEntries(modeKeys.map((m) => [m, splitsFor(m)])),
    rangeUnmeasured: moment !== MOMENT.declare && reachAt(known.value).range.unmeasured,
    cite: figures.cite || extras.cite || "",
    isGM,
    // What the dialog asks again as the seat types or changes its bucket.
    levelAt: (typed) => castAbilityLevel(casterLevel({ ...world.level, override: typed }), abilities.casterLevel),
    verdictsAt: verdictsFor,
    reachAt,
    gatesAt: (levelValue, inv = startInv) => Object.fromEntries(seat.tokens.map((t) => [t.uuid, targetGate({ actor: t.actor, extras: gateExtras(inv), level: levelValue })])),
    // The spell's own save rows a target's throw cannot yet decide, by token uuid (`saveSpec`'s pending).
    pendingAt: (mode, picks, levelValue, inv = startInv) => {
      const ownRows = ownSaveRows(rowsForMode(all, mode, picks, atFor(mode, inv)), { level: levelValue, label: spell.name, cite: extras.cite ?? "" });
      if (!ownRows.length || !extras.save?.category) return {};
      return Object.fromEntries(seat.tokens.map((t) => [t.uuid, (saveSpec(t.actor, extras.save.category, { ownRows, bearerToken: t, against: caster ? { actor: caster, token: world.casterToken ?? null } : null }).pending ?? []).filter((q) => q.when !== "defense").map((q) => q.label)]));
    },
    // The bucket was changed in the dialog: read the seat's targets again.
    refresh: () => {
      seat = readSeat();
      return askContext();
    },
    // A declaration that no longer fits reopens on what the seat declared, less what is gone.
    ...(declared ? { initial: declared } : {}),
  });
  let answer = storedFits ? declared : await deps.ask(askContext());
  if (!answer) return { ok: false, reason: "cancelled" };
  // What the seat's answer names is held to the world as the stored one is: a missing document is dropped.
  if (answer.procedure && BUCKETS_KEY in answer.procedure) answer = { ...answer, procedure: { ...answer.procedure, [BUCKETS_KEY]: await withoutMissing(answer.procedure, deps.holds) } };
  // The bucket may have changed while the dialog was open, and a cast reads the seat's targets as they stand now. A declaration that fits keeps the seat it declared.
  if (!storedFits) seat = readSeat();

  // A summoning's pick: the answer's own, else the declaration's, else the shelf prompt. A cancel ends the cast with nothing spent.
  let pick = null;
  if (summoning) {
    pick = ANSWER_FIELDS.summon(answer.summon ?? declared?.summon);
    if (!pick) {
      const chosen = await deps.pickSummon?.(caster, { spell, options: summonRows, resolveRef: deps.resolveRef });
      pick = ANSWER_FIELDS.summon(chosen ? { ref: chosen.sourceUuid, count: chosen.count } : null);
    }
    if (!pick) return { ok: false, reason: "cancelled" };
    answer = { ...answer, summon: pick };
  }
  // The pick weighed: its count against the ceiling the rows state at this caster level, whether the creature is called from where it stands, and the refusal lib gives a request before any click (a declaring is asked too, so a creature the seat cannot observe is refused before the spend; only a declaring's canvas and pause reasons are dropped). The creature's name is the card's.
  const summonJudged = async ({ pick: picked, level: casterLvl, at: invAt, declaring }) => {
    const source = (await deps.resolveRef?.(picked.ref)) ?? null;
    // A declared family is made one creature at its turn, so no creature exists yet for lib to weigh: the seat's own level on the family is asked instead, as the relay asks it at the turn.
    const familyDeclared = declaring && source?.type === TEMPLATE_TYPE;
    let asked = { ok: true };
    if (familyDeclared) asked = (await deps.familyReadable?.(source)) ?? asked;
    else if (deps.summonVerdict) asked = await deps.summonVerdict(caster, { sourceUuid: picked.ref, count: picked.count, spellId: spell.id });
    // A declaring places nothing, so a canvas that is not ready or a paused game does not stop it; every other refusal does, before the slot is spent.
    if (declaring && (asked?.reason === "noCanvas" || asked?.reason === "paused")) asked = { ok: true };
    if (asked?.ok !== false && !declaring && gmMissing()) asked = { ok: false, ...noGm() };
    const refused = asked?.ok === false ? { reason: asked.reason, notice: asked.notice || asked.reason } : null;
    // A conjured creature serves while its caster holds the cast, so the cast is held (`heldByConjuration`).
    return { ...judgeSummon(summonRows, picked, { source, level: casterLvl, at: invAt, refused }), conjuration: summonIsConjuration(summonRows, { source, sourceRef: picked.ref }), name: String(source?.name ?? offer.creatures.find((c) => c.value === picked.ref)?.name ?? "").trim() };
  };

  const mode =modeKeys.includes(answer.mode) ? answer.mode : CAST_MODES.normal;
  // The rows are kept at the invocation level the answer holds, and the figures the gates read are taken at it.
  const invocation = levelFor(mode, answer.invocationLevel);
  const at = { invocationLevel: invocation.value };
  const kept = rowsForMode(all, mode, answer.picks, at);
  const level = castAbilityLevel(casterLevel({ ...world.level, override: answer.casterLevel }), abilities.casterLevel);
  // The save modifier counts only where a save is made and the import read a figure for it at this level.
  const saveMod = answer.saveMod === true && spellSaves(extras.save) && saveModifierOf(extras.save, level.value) != null;
  // The level the answer resolved to, never the declaration's default: a null stays null, so the verdicts and the kept rows read one level.
  // Where the cast falls given the final answer: the procedure's casting time is read from it.
  moment = momentAt(mode, invocation.value, level.value, answer.procedure);
  // A family picked for a cast that places now is made one creature first: the seat picks its variant and the client that may create actors makes it. A declaring keeps the family, made at its turn; a closed variant dialog ends the cast with nothing spent.
  if (pick && moment !== MOMENT.declare && deps.summonVariant) {
    const family = (await deps.resolveRef?.(pick.ref)) ?? null;
    if (family?.type === TEMPLATE_TYPE) {
      const made = await deps.summonVariant(caster, family, { spellId: spell.id });
      if (!made) return { ok: false, reason: "cancelled" };
      pick = { ...pick, ref: made.uuid };
      answer = { ...answer, summon: pick };
    }
  }
  const procedureAnswer = procViewAt(mode, invocation.value, level.value, answer.procedure, moment)?.answer ?? {};
  // A summoning's creature and count, judged on the final answer: the ceiling at this caster level, and lib's own refusal before any click. Nothing is placed in a declaring, so its click waits for the turn.
  const summon = pick ? await summonJudged({ pick, level: level.value, at, declaring: moment === MOMENT.declare }) : null;
  const verdicts = verdictsFor(mode, answer.picks, level.value, answer.allocation, invocation.value, answer.procedure, summon);
  const stop = verdicts.find((v) => v.severity === "block");
  const detail = (v) => ({ name: caster.name, names: (v.out ?? []).map((t) => t.name).join(", "), max: v.max ?? "", over: v.over ?? "" });
  // A finding a procedure worded itself is told in its own words; every other has a key of the cast's own.
  const tell = (v, prefix) => (v.notice ? (deps.notifyText ?? ((level, text) => ui.notifications?.[level]?.(text)))("warn", v.notice) : deps.notify("warn", `${prefix}.${v.key}`, detail(v)));
  if (blocked(verdicts)) {
    tell(stop, "blocked");
    return { ok: false, reason: stop.key };
  }
  for (const v of verdicts) tell(v, "verdict");

  // A summoning's clicks come before the spend and make nothing: a cancel costs the cast nothing, and a declared summons clicks at its turn, where a cancel leaves the declaration standing. A declaring places nothing, so it clicks nothing. The range is the spell's figure in feet, a number or none.
  let positions = null;
  let rangeLimit = null;
  if (summon && moment !== MOMENT.declare) {
    rangeLimit = rangeFeet(figuresAt(mode, invocation.value).range, level.value)?.value ?? null;
    const picked = await deps.pickPlacement?.(caster, { sourceUuid: pick.ref, count: pick.count, spellId: spell.id, rangeFeet: rangeLimit, calling: summon.calling, casterToken: world.casterToken ?? null });
    if (!picked?.positions?.length) return { ok: false, reason: "cancelled" };
    positions = picked.positions;
  }

  // A seal's door is picked at the same point, on the same terms: a cancel spends nothing, a declaring asks nothing, and no pick (Enter, or a seat with no scene to pick on) goes on with the spell's own record and line. An absent `pickDoor` is no pick. The range is the spell's figure at this cast, a number or none.
  let sealPick = null;
  let sealRange = null;
  if (moment !== MOMENT.declare && deps.pickDoor && kept.some(({ row }) => row.type === SEAL_ROW_TYPE)) {
    // A Player's seal is written by the GM's client, so with none connected it is refused here, before the pick and the spend, as a summons is.
    if (gmMissing()) {
      deps.notify("warn", "sealNoGm");
      return { ok: false, reason: "noGm" };
    }
    sealRange = rangeFeet(figuresAt(mode, invocation.value).range, level.value)?.value ?? null;
    const door = await deps.pickDoor({ caster, casterToken: world.casterToken ?? null, rangeFeet: sealRange, isGM, cite: extras.cite ?? "" });
    if (door === null) return { ok: false, reason: "cancelled" };
    if (door?.wallId && door?.sceneId) sealPick = door;
  }

  // A declaration being resolved was spent at its declaring, and a cast from a project at the project.
  if (!resolving && !fromProject) {
    await spend();
    if (spendsFromPool(world.capacity)) await deps.adjustPool(caster, world.capacity.tradition, world.capacity.slotKey);
  }
  // The cast, or the declaring of it, ends what the caster holds by concentration, before any record of this cast.
  try {
    await deps.endHeld?.(caster);
  } catch (err) {
    console.error(`${MODULE_ID} | the caster's concentration could not be ended by a cast`, err);
  }
  if (resolving) await deps.declare?.finish({ caster, record: declaration.valid, combat: world.combat, combatant: world.combatant });
  else if (moment === MOMENT.resolve && declaration.lost) await deps.declare?.finish({ caster, record: declaration.lost, combat: world.combat, combatant: world.combatant });
  else if (declaration.hand) await deps.declare?.clearHand({ combat: world.combat, combatant: world.combatant });
  if (moment === MOMENT.declare) {
    const made = await deps.declare?.declare({ caster, spell, answer: { ...answer, targets: seat.tokens.map((t) => t.uuid), procedureKind }, combat: world.combat, combatant: world.combatant });
    return { ok: true, declared: true, castId: made?.castId };
  }

  const castId = deps.castId();
  // How long a cast over a round takes, for its card.
  const longTime = moment === MOMENT.long ? timeAt(mode, invocation.value, level.value, answer.procedure) : null;
  const card = {
    castId,
    spellUuid: spell.uuid,
    spellName: spell.name,
    casterUuid: caster.uuid,
    casterName: caster.name,
    mode,
    picks: answer.picks ?? {},
    // A cast longer than a round names its time, and whose time it is.
    ...(longTime ? { castingTime: { value: longTime.value ?? null, unit: longTime.unit ?? "", source: longTime === spellTime ? "spell" : "procedure" } } : {}),
    // The level with the abilities' deltas on it, and the parts that made it: the relay trusts this value.
    casterLevel: { value: level.value, source: level.source, base: level.base, parts: level.parts, listed: level.listed },
    // The invocation level the rows were read at, and where it came from (a figure chosen under the tradition's cap, or set by hand); the relay and every press read the card's spell again at it (`castAt`).
    ...(invocation.value !== null ? { invocationLevel: invocation.value, invocation: { source: invocation.source, cap: invocation.cap } } : {}),
    ...(abilities.save.length || abilities.damage.length ? { abilities: { save: abilities.save, damage: abilities.damage } } : {}),
    save: { category: extras.save?.category ?? "", effect: extras.save?.effect ?? "", kind: extras.save?.kind ?? "" },
    situational: Number.isFinite(Number(answer.situational)) && answer.situational !== "" ? Number(answer.situational) : null,
    // The spell's own save modifier the seat switched on for every target; the figure is read again from the spell at the card's caster level wherever the card is read.
    ...(saveMod ? { saveMod: true } : {}),
    cite: extras.cite ?? "",
    duration: heldByConjuration(castDurationOf(spell, deps.lookups, level.value, deps.roll, mode), summon?.conjuration === true),
    casterTokenUuid: world.casterToken?.uuid ?? null,
    rows: {},
    order: [],
    targets: {},
    entries: {},
    // A thrown row's throws by target key: `{[rowKey]: {[targetKey]: throws}}`.
    allocation: {},
    lines: [],
  };
  // The weapon a buff is cast on: the one the seat picked for the one targeted holder, where the rows wait on a weapon and the weapon is one of its own.
  const bearerToken = bearerOf();
  const picked = bearerToken && needsBearer(kept) ? bearerToken.actor?.items?.get?.(answer.items?.[bearerToken.uuid]) : null;
  const weapon = picked?.type === "weapon" ? picked : null;
  const made = modParts(kept, { level: level.value, itemId: weapon?.id ?? null, save: card.save, kind: answer.pickKind ?? null });
  // The creature kind the `pickKind` rows were narrowed to is stored on the card, which the relay reads: the seat's pick where one of the rows authored it, else the first authored kind stands and the card says so.
  if (made.kind) {
    const key = made.kind.authored.includes(answer.pickKind) ? answer.pickKind : made.kind.key;
    card.pickKind = { key, defaulted: key !== answer.pickKind };
  }
  const rolls = [];
  // The tradition's procedure performs once the cast has its id and before its first row. What it returned is on the card; a step it did not take, or threw in, posts only its section.
  if (procedure?.perform) {
    const done = await runPerform(procedure, { ...procCtx(invocation.value, level.value, moment), castId }, procedureAnswer);
    card.procedure = { kind: procedureKind, section: done.section, undo: done.undo };
    rolls.push(...done.rolls);
    if (!done.proceed) {
      const message = await deps.post({ ...card, lines: done.failed ? [loc("line.procedureFailed")] : [] }, { rolls, mode: answer.visibility || "public", speaker: undefined });
      return { ok: true, castId, messageId: message?.id, applied: [], performed: false };
    }
  }
  // The creatures stand only once the cast proceeds. The placement is the summon kind's own step (`cast-kinds.mjs`); a refusal now is a line on the card, and the spend stands.
  let placed = null;
  if (positions) {
    placed = await stepOf("summon")({ caster, spell, castId, pick, positions, cast: { castId, casterLevel: level.value, invocationLevel: invocation.value }, rangeFeet: rangeLimit, calling: summon.calling, casterToken: world.casterToken ?? null, card }, deps);
    if (placed?.ok) {
      // The line names the creature, how many stand and how long the spell lasts; any click that made no creature is its own line.
      const made = placed.tokenUuids?.length ?? positions.length;
      // The spell's own printed length (a level-scaled or concentration one reads as written), none for an instant.
      const shape = durationShapeOf(spell, deps.lookups, mode);
      const lasts = shape?.shape === "instantaneous" ? "" : displayDuration(shape);
      card.lines.push(loc(lasts ? "line.summoned" : "line.summonedOpen", { name: summon.name || loc("dialog.summonCreature"), n: made, duration: lasts }));
      if (made < positions.length) card.lines.push(loc("line.summonShort", { n: positions.length - made }));
    } else card.lines.push(placed?.reason === "noGm" || !placed ? loc("line.summonNoGm") : loc("line.summonRefused", { reason: placed.notice || placed.reason || "" }));
  }
  // The door is sealed only once the cast proceeds. The write is the seal kind's own step (`cast-kinds.mjs`) and carries this cast's id, which the caster's record keeps; a refusal is a line on the card and a notice to the seat, and the spend stands. A Judge's pick past the range states no range, since the GM's client measures any it is given.
  let sealed = null;
  if (sealPick) {
    const request = { casterUuid: caster.uuid, spellUuid: spell.uuid, castId, sceneId: sealPick.sceneId, wallId: sealPick.wallId, rangeFeet: sealPick.over ? null : sealRange };
    try {
      sealed = (await stepOf(SEAL_ROW_TYPE)({ request, caster, spell, castId }, deps)) ?? { ok: false, reason: "noGm" };
    } catch (err) {
      console.error(`${MODULE_ID} | the seal was not written`, err);
      sealed = { ok: false, reason: "failed" };
    }
    if (!sealed.ok) {
      const why = sealLoc(`refused.${sealed.reason}`);
      card.lines.push(loc("line.sealRefused", { reason: why }));
      (deps.notifyText ?? ((level, text) => ui.notifications?.[level]?.(text)))("warn", why);
    }
  }
  let sealLined = false;
  for (const keyed of kept) {
    const { row } = keyed;
    if (isModRow(row)) continue;
    if (row.type === SEAL_ROW_TYPE && sealed?.ok && !sealLined) {
      // The one door this cast sealed, in place of the spell's own line: where it stands and how long it holds, and what its end does to it.
      sealLined = true;
      const shape = durationShapeOf(spell, deps.lookups, mode);
      const lasts = shape?.shape === "instantaneous" ? "" : displayDuration(shape);
      card.lines.push(loc(lasts ? "line.sealed" : "line.sealedOpen", { duration: lasts }), loc("line.sealEnd"));
    } else if ((row.type === "damage" || row.type === "heal") && !resolvesAtCast(row)) {
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

  const built = await buildTargets({
    tokens: seat.tokens,
    card,
    rows: kept,
    save: card.save,
    situational: card.situational,
    caster,
    casterToken: world.casterToken ?? null,
    extras: castGateExtrasOf(spell, deps.lookups, at),
    saveParts: [...castSaveParts(abilities), ...spellSaveParts(extras.save, { level: level.value, applied: saveMod, label: spell.name })],
    items: answer.items ?? {},
  });
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
    // A typed split is by token uuid, and a target key stands for the token its card names.
    const dealt = count > 1 && typed ? splitFor(count, targetKeys, typed, targetKeys.map((k) => card.targets[k].uuid)) : splitFor(count, targetKeys.filter((k) => !exempt(k)), null);
    const split = Object.fromEntries(targetKeys.map((k) => [k, exempt(k) ? 0 : (dealt[k] ?? 0)]));
    card.allocation[keyed.key] = Object.fromEntries(Object.entries(split).filter(([, n]) => n > 0));
    for (const targetKey of targetKeys) {
      if (!split[targetKey]) continue;
      const token = seat.tokens.find((t) => t.uuid === card.targets[targetKey].uuid) ?? null;
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
  // A summoning leaves its record whatever its rows are, carrying the id its creatures carry. Unless held it is core-timed with no `startTime` of this module's own, so its end is announced with Dismiss and never deleted silently (`cast-expiry.mjs`).
  // A door sealed leaves its record too, whatever the rows are, since the wall's stamp is ended by that record's deletion and a stamp with no record is ended at the next GM `ready`. It carries the id the stamp carries and names the wall. With no clock of its own to run on, the seal holds until its owner deletes the record.
  if (held || summon || timed || untimedRecord || sealed?.ok) {
    const mark = { spell: { uuid: spell.uuid, name: spell.name, img: spell.img }, caster: { uuid: caster.uuid }, castId: sealed?.ok ? castId : placed?.castId || castId, role: "caster", ...(invocation.value !== null ? { invocationLevel: invocation.value } : {}), ...(sealed?.ok ? { seal: { sceneId: sealPick.sceneId, wallId: sealPick.wallId } } : {}) };
    const bare = untimedRecord || (sealed?.ok && !timed && !summon);
    const data = held
      ? heldRecordData(mark, { held, now: deps.now(), tail: card.duration.tail, cap: card.duration.cap })
      : spellEffectData(summon ? { ...mark, duration: card.duration } : bare ? mark : { ...mark, startTime: deps.now(), duration: card.duration });
    try {
      await deps.record(caster, data);
    } catch (err) {
      console.error(`${MODULE_ID} | the cast record was not written`, err);
    }
  }

  const message = await deps.post(card, { rolls, mode: answer.visibility || "public", speaker: undefined });
  const results = await applyAll(message, deps);
  return { ok: true, castId, messageId: message?.id, applied: results, ...(placed ? { placed } : {}) };
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
 * Resolve the effect of a ritual a finished project cast (board 17 part C, "Take effect now"): the ordinary cast dialog and
 * card for the researcher's own spell item, with nothing spent, no throw made for the cast and no turn read.
 * @param {Item} spell  the researcher's own ritual spell item
 * @param {object} [deps]  see `liveDeps`
 * @returns {Promise<{ok: boolean, reason?: string, castId?: string, messageId?: string}>}
 */
export const castFromProject = (spell, deps = liveDeps()) => castSpellRun(spell, async () => true, deps, { fromProject: true });

/**
 * The claimant for the cast seam. `claims` is synchronous.
 * @param {object} [deps]  see `liveDeps`
 * @param {{classFor?: ((actor: object) => object|null)|null}} [claim]  the classes feature's `classForActor`, kept apart from `deps` since the claimant hands `deps` to the cast whole
 */
export function castSpellClaimant(deps, { classFor = null } = {}) {
  return {
    key: CAST_SPELL_KEY,
    claims: (item) => castSpellClaims(item, deps?.lookups, classFor),
    cast: (item, options, spend) => castSpellRun(item, spend, deps, options),
  };
}

/* -------------------------------------------- */
/*  The card's buttons                           */
/* -------------------------------------------- */

/** The spell of a card and the keyed row it names, from the caster's own spell, read at the card's invocation level (`castAt`). */
function rowOfCard(card, rowKey) {
  const spell = fromUuidSync(card.spellUuid);
  const caster = fromUuidSync(card.casterUuid);
  const found = spell ? keyedRows(rowsOf(spell, worldLookups()).rows).find((r) => r.key === rowKey) : null;
  const keyed = found ? { ...found, row: flattenAt(found.row, castAt(card)) } : null;
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
  const kept = rowsForMode(rowsOf(spell, worldLookups()).rows, card.mode, card.picks, castAt(card));
  const built = await buildTargets({ tokens, card, rows: kept, save: card.save, situational: card.situational, caster, casterToken: actorToken(caster), extras: castGateExtrasOf(spell, worldLookups(), castAt(card)), saveParts: [...castSaveParts(castAbilitiesOf(caster, spell, worldLookups())), ...spellSaveParts(flagOf(spell).save, { level: card.casterLevel?.value ?? null, applied: card.saveMod === true, label: card.spellName })] });
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
  if (!target && !targetGate({ actor: token.actor, extras: castGateExtrasOf(spell, worldLookups(), castAt(card)), row: keyed.row, level: card.casterLevel?.value ?? null }).affected) {
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

/** A Revert press: the Judge's. The tradition's procedure puts back what its performed step did, once. */
async function pressRevert(message) {
  if (!game.user.isGM) return;
  const card = cardOf(message);
  const done = await runRevert(card, {
    actor: fromUuidSync(card?.casterUuid),
    spell: fromUuidSync(card?.spellUuid),
    isGM: game.user.isGM,
    kind: card?.procedure?.kind,
    castId: card?.castId,
    now: () => game.time.worldTime,
    roll: (formula) => new Roll(formula).evaluateSync().total,
  });
  if (done.ok) await markReverted(message);
  else ui.notifications?.warn(loc(`notice.revert.${done.reason}`));
}

let unregister = null;

/**
 * Register the claimant after the summoning's, the card's buttons and the
 * relay. Once, at `init`; a second call replaces the first.
 * @param {{classFor?: ((actor: object) => object|null)|null}} [claim]  the classes feature's `classForActor`; without it no tradition's procedure is found
 * @returns {() => void}
 */
export function registerCastSpell(claim = {}) {
  unregister?.();
  addSpellUseClaimant(castSpellClaimant(undefined, claim));
  addAttackContributor(abilityDamageContributor);
  registerCastCardHooks({
    [CARD_ACTIONS.apply]: pressApply,
    [CARD_ACTIONS.applyTargets]: pressApplyTargets,
    [CARD_ACTIONS.throw]: pressThrow,
    [CARD_ACTIONS.undo]: pressUndo,
    [CARD_ACTIONS.revert]: pressRevert,
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

