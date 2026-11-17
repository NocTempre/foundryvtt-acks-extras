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
import { rowsOf, rowsForMode, rowNeedsThrow, hasReversedRows, spellSaves, keyedRows, effectRowsOf, pickGroups, CAST_MODES } from "./cast-rows.mjs";
import { casterLevel, levelNeeded } from "./cast-level.mjs";
import { castCapacity, traditionFor, spendsFromPool } from "./cast-capacity.mjs";
import { castVerdicts, blocked } from "./cast-plan.mjs";
import { castDuration } from "./cast-duration.mjs";
import { spellEffectData, newCastId } from "./spell-effect.mjs";
import { describeSpellEffect } from "./describe.mjs";
import { requestApply, registerCastRelay, undoEntries, liveApplyDeps, entryId } from "./cast-apply.mjs";
import { cardOf, postCastCard, updateEntry, addTargets, newTargetKey, registerCastCardHooks, CARD_ACTIONS, canPressCard } from "./cast-card.mjs";
import { isModRow, modParts, needsBearer, dryYields, ROW_ON } from "./cast-mods.mjs";
import { levelUnder } from "./spell-names.mjs";
import { isSummonSpell } from "./summon-spell.mjs";
import { byCookbookId, cookbookId, whenReady } from "../lib/library.mjs";
import { addSpellUseClaimant, removeSpellUseClaimant } from "../lib/patches/spell-use.mjs";
import { MAGIC_ATTACK_TYPE, spellCarrier, magicDamageSpec, actorToken } from "../lib/patches/attack-throw.mjs";
import { saveThrow } from "../lib/saves.mjs";
import { actorAlignment } from "../lib/actor-read.mjs";
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

/** The duration of a cast: the spell's own duration object, else its twin's, with the resolved level. */
export function castDurationOf(spell, lookups, level, roll) {
  const own = flagOf(spell).duration;
  let duration = own;
  if (!own?.shape) {
    const id = spell.flags?.[MODULE_ID]?.cookbook?.id;
    const twin = id ? lookups.byCookbookId("Item", id) : null;
    duration = flagOf(twin).duration ?? own;
  }
  return castDuration(duration, { casterLevel: level, roll });
}

/** The roll spec of one row, as the cast and its relay both read it: a damage row through lib's magic question, a heal row its own dice. */
export async function rowSpecOf(caster, spell, card, { row, key }) {
  if (row.type === "heal") return row.roll ? { formula: String(row.roll), data: caster.getRollData?.() ?? {} } : null;
  if (row.type !== "damage") return null;
  const carrier = spellCarrier(caster, row, { spell, castId: card.castId, rowKey: key });
  return magicDamageSpec(caster, carrier);
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
  return {
    actor,
    tokens,
    casterToken: actorToken(actor),
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

/** Does this row apply to the caster rather than to what the cast is aimed at? */
const aimedAtSelf = (row) => row?.appliesTo === "self";

/** The Roll of one non-thrown row, with the figures the card shows. */
async function rollRow(caster, spell, card, keyed) {
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
 */
export async function rollResist(actor, save, situational, { against = null, bearerToken = null } = {}) {
  const made = await saveThrow(actor, save.category, { situational, against, bearerToken });
  if (made.target == null || made.total == null) return { resist: null, roll: null };
  const { roll, ...kept } = made;
  const resist = {
    kind: "save",
    category: save.category,
    formula: kept.formula,
    total: kept.total,
    target: kept.target,
    baseTarget: kept.baseTarget,
    success: kept.success,
    parts: kept.parts.map(({ label, value }) => ({ label, value })),
  };
  return { resist, roll };
}

/**
 * The targets, each with the resist it rolled, and the entries each row opens:
 * a thrown row waits for its throw and the rest wait for their application.
 * Targets the cast is aimed at take the rows that are not the caster's own;
 * the caster, where a row is, takes the rest.
 */
export async function buildTargets({ tokens, card, rows, save, situational, caster, casterToken = null, randomID }) {
  const targets = {};
  const entries = {};
  const rolls = [];
  const opens = (r) => (r.type === "conditionGrant" ? r.conditions.length : isModRow(r) ? r.blank !== true : r.total != null);
  const open = rows.filter(({ key }) => card.rows[key] && opens(card.rows[key]));
  const hasSelf = rows.some(({ row }) => aimedAtSelf(row));
  const add = (key, target, forRow) => {
    targets[key] = target;
    for (const { key: rowKey, row } of open) if (forRow(row) && !rowNeedsThrow(row)) entries[entryId(key, rowKey)] = { state: "pending" };
  };
  for (const token of tokens) {
    // A buff is not resisted: only a row that does something to the target calls for the save.
    const resisting = spellSaves(save) && rows.some(({ row }) => !isModRow(row) && !aimedAtSelf(row) && !rowNeedsThrow(row));
    const made = resisting ? await rollResist(token.actor, save, situational, { against: caster ? { actor: caster, token: casterToken } : null, bearerToken: token }) : { resist: null, roll: null };
    if (made.roll) rolls.push(made.roll);
    add(newTargetKey(randomID), { ...targetOf(token), resist: made.resist }, (row) => !aimedAtSelf(row));
  }
  if (hasSelf && caster) add(newTargetKey(randomID), { uuid: caster.uuid, name: caster.name, self: true, resist: null }, aimedAtSelf);
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
  throwRow: async (caster, carrier, skipDialog) => caster.makeAttackThrow({ item: carrier, attackType: MAGIC_ATTACK_TYPE, skipDialog }),
  now: () => game.time.worldTime,
  isGM: () => game.user.isGM,
});

/** The card's row, as the card keeps it. */
const cardRow = (keyed, rolled) => ({
  type: keyed.row.type,
  key: keyed.key,
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
  const verdictsFor = (mode, picks) => castVerdicts({ capacity: world.capacity, targets: world.tokens, rows: rowsForMode(all, mode, picks), statuses: world.statuses, isGM });
  const known = casterLevel(world.level);
  // One targeted token can bear a weapon buff, and the dialog lists its weapons.
  const bearerToken = world.tokens.length === 1 ? world.tokens[0] : null;
  const answer = await deps.ask({
    spell,
    caster,
    modes: modeKeys,
    rows: all,
    groups: Object.fromEntries(modeKeys.map((m) => [m, groupsFor(m)])),
    level: known,
    levelNeeded: levelNeeded(extras, rowsForMode(all, CAST_MODES.normal)) || levelNeeded(extras, rowsForMode(all, CAST_MODES.reversed)),
    weapons: bearerToken ? weaponsOf(bearerToken.actor) : [],
    needsWeapon: Object.fromEntries(modeKeys.map((m) => [m, needsBearer(rowsForMode(all, m, {}))])),
    targets: world.tokens.map(targetOf),
    saves: spellSaves(extras.save),
    capacity: world.capacity,
    verdicts: Object.fromEntries(modeKeys.map((m) => [m, verdictsFor(m, {})])),
    isGM,
  });
  if (!answer) return { ok: false, reason: "cancelled" };

  const mode = modeKeys.includes(answer.mode) ? answer.mode : CAST_MODES.normal;
  const kept = rowsForMode(all, mode, answer.picks);
  const verdicts = verdictsFor(mode, answer.picks);
  const stop = verdicts.find((v) => v.severity === "block");
  if (blocked(verdicts)) {
    deps.notify("warn", `blocked.${stop.key}`);
    return { ok: false, reason: stop.key };
  }
  for (const v of verdicts) deps.notify("warn", `verdict.${v.key}`);

  const level = casterLevel({ ...world.level, override: answer.casterLevel });
  await spend();
  if (spendsFromPool(world.capacity)) await deps.adjustPool(caster, world.capacity.tradition, world.capacity.slotKey);

  const castId = deps.castId();
  const card = {
    castId,
    spellUuid: spell.uuid,
    spellName: spell.name,
    casterUuid: caster.uuid,
    casterName: caster.name,
    mode,
    picks: answer.picks ?? {},
    casterLevel: { value: level.value, source: level.source },
    save: { category: extras.save?.category ?? "", effect: extras.save?.effect ?? "", kind: extras.save?.kind ?? "" },
    situational: Number.isFinite(Number(answer.situational)) && answer.situational !== "" ? Number(answer.situational) : null,
    cite: extras.cite ?? "",
    duration: castDurationOf(spell, deps.lookups, level.value, deps.roll),
    casterTokenUuid: world.casterToken?.uuid ?? null,
    rows: {},
    order: [],
    targets: {},
    entries: {},
    lines: [],
  };
  // The weapon the seat named, kept only where exactly one token is targeted and the weapon is one of its own.
  const picked = bearerToken && answer.item ? bearerToken.actor?.items?.get?.(answer.item) : null;
  const weapon = picked?.type === "weapon" ? picked : null;
  const made = modParts(kept, { level: level.value, itemId: weapon?.id ?? null });
  const rolls = [];
  for (const keyed of kept) {
    const { row } = keyed;
    if (isModRow(row)) continue;
    if (row.type === "damage" || row.type === "heal") {
      if (rowNeedsThrow(row)) {
        card.rows[keyed.key] = cardRow(keyed, {});
      } else {
        const rolled = await rollRow(caster, spell, card, keyed);
        if (rolled.roll) rolls.push(rolled.roll);
        card.rows[keyed.key] = cardRow(keyed, rolled);
      }
      card.order.push(keyed.key);
    } else if (row.type === "conditionGrant") {
      card.rows[keyed.key] = cardRow(keyed, {});
      card.order.push(keyed.key);
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

  const built = await buildTargets({ tokens: world.tokens, card, rows: kept, save: card.save, situational: card.situational, caster, casterToken: world.casterToken ?? null });
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

  // A thrown row is thrown at the one target the seat has; with none its card carries a Throw press.
  const thrown = kept.filter(({ row }) => rowNeedsThrow(row));
  const first = Object.entries(card.targets).find(([, t]) => !t.self);
  for (const keyed of thrown) {
    if (!first) continue;
    const entry = await throwEntry({ caster, spell, card, keyed, deps, skipDialog: options.skipDialog === true });
    card.entries[entryId(first[0], keyed.key)] = entry.entry;
    Object.assign(card.rows[keyed.key], entry.row);
  }

  const timed = card.duration && !card.duration.none && kept.some(({ row }) => row.lasts === "duration");
  if (timed) {
    const data = spellEffectData({ spell: { uuid: spell.uuid, name: spell.name, img: spell.img }, caster: { uuid: caster.uuid }, castId, role: "caster", duration: card.duration, startTime: deps.now() });
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

/** One thrown row at the first target: the throw's entry and what it adds to the card's row. */
async function throwEntry({ caster, spell, card, keyed, deps, skipDialog }) {
  const carrier = spellCarrier(caster, keyed.row, { spell, castId: card.castId, rowKey: keyed.key });
  const outcome = await deps.throwRow(caster, carrier, skipDialog);
  if (!outcome) return { entry: { state: "throw" }, row: {} };
  const resolution = outcome.resolution ?? {};
  const made = { total: Number(outcome.attackRoll?.total), target: Number(resolution.targetValue) };
  const throwFigures = { ...made, hit: resolution.isHit === true, critical: resolution.isCritical === true };
  if (!resolution.isHit) return { entry: { state: "missed", throw: throwFigures }, row: {} };
  const damage = outcome.damageRoll;
  return {
    entry: { state: "pending", rolled: outcome.damageTotal, critical: throwFigures.critical, throw: throwFigures },
    row: { formula: damage?.formula ?? "", total: outcome.damageTotal, detail: String(damage?.result ?? outcome.damageTotal) },
  };
}

/** Apply every target's open entries, on the right client each. An entry that cannot be applied stays pending. */
async function applyAll(message, deps) {
  const results = [];
  for (const [targetKey] of Object.entries(cardOf(message)?.targets ?? {})) {
    const card = cardOf(message);
    const requests = Object.entries(card.entries)
      .filter(([id, e]) => id.startsWith(`${targetKey}_`) && e.state === "pending")
      .map(([id, e]) => ({ rowKey: id.slice(targetKey.length + 1), rolled: e.rolled ?? card.rows[id.slice(targetKey.length + 1)]?.total, critical: e.critical === true }));
    if (!requests.length) continue;
    const done = await deps.apply(message, targetKey, requests);
    if (!done?.ok) deps.notify("warn", done?.reason === "noGm" ? "noGm" : "pendingApply", { name: card.targets[targetKey].name });
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
    const result = await requestApply(message, target, [{ rowKey: row, rolled: entry?.rolled ?? card.rows[row]?.total, critical: entry?.critical === true }]);
    if (!result.ok) ui.notifications?.warn(loc(`notice.${result.reason === "noGm" ? "noGm" : "pendingApply"}`, { name: card.targets[target]?.name ?? "" }));
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
  const built = await buildTargets({ tokens, card, rows: kept, save: card.save, situational: card.situational, caster, casterToken: actorToken(caster) });
  await addTargets(message, built.targets, built.entries);
  const fresh = cardOf(message);
  for (const targetKey of Object.keys(built.targets)) {
    const requests = Object.entries(fresh.entries)
      .filter(([id, e]) => id.startsWith(`${targetKey}_`) && e.state === "pending")
      .map(([id]) => ({ rowKey: id.slice(targetKey.length + 1), rolled: fresh.rows[id.slice(targetKey.length + 1)]?.total }));
    if (requests.length) await requestApply(message, targetKey, requests);
  }
}

/** A Throw press: the presser's first target is thrown at, and a hit applies. */
async function pressThrow(message, { target, row }) {
  const card = cardOf(message);
  const { spell, caster, keyed } = rowOfCard(card, row);
  const token = target ? fromUuidSync(card.targets[target]?.uuid) : ([...(game.user.targets ?? [])][0]?.document ?? null);
  if (!canPressCard(message) || !spell || !caster?.isOwner || !keyed || !token?.actor) {
    ui.notifications?.warn(loc("notice.noTargets"));
    return;
  }
  const made = await throwEntry({ caster, spell, card, keyed, deps: liveDeps(), skipDialog: false });
  const targetKey = target || newTargetKey();
  if (!target) await addTargets(message, { [targetKey]: { ...targetOf(token), resist: null } }, {});
  await updateEntry(message, entryId(targetKey, row), made.entry);
  if (made.row.total != null) await message.update({ [`flags.${MODULE_ID}.castCard.rows.${row}`]: { ...card.rows[row], ...made.row } });
  if (made.entry.state === "pending") await requestApply(message, targetKey, [{ rowKey: row, rolled: made.entry.rolled, critical: made.entry.critical === true }]);
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

