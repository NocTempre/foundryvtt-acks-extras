/* global game, fromUuid, fromUuidSync, ui, Roll, ChatMessage */
/**
 * The blood sacrifice as the live world has it (`sacrifice.mjs` is the model and decides every gate, figure and
 * order of writes): the facts of the caster and of each victim read from their documents, the imported tables,
 * the writes the act makes, the GM's half of a Player's mark, the result card and the API that opens the
 * window (`acksExtras.magic.sacrifice`). Magic owns the sacrifice; its window is `apps/sacrifice-window.mjs`.
 *
 * A victim is valued by lib's valuation (`bucket-value.mjs`): a creature by its component items, else by its XP
 * award where no bar applies, and a character blank until a Judge enters it, since no award-by-level table is
 * imported. Marking a victim dead is a write a Player's seat lacks, so the seat asks the GM's client, which
 * checks the sender against the caster before it writes (`checkMarkRequest`).
 */
import { MODULE_ID, LANG_PREFIX, SACRIFICE_HANDLER } from "./constants.mjs";
import { SACRIFICE_DIE, VICTIM_KINDS, sapientOf, planOf, performSacrifice, checkMarkRequest, SACRIFICE_SETTLE } from "./sacrifice.mjs";
import { readResearchTables } from "./research-tables.mjs";
import { levelOf, intBonusOf } from "./research-project-live.mjs";
import { actorAlignment, creatureKinds } from "../lib/actor-read.mjs";
import { creatureValue, characterValue } from "../lib/bucket-value.mjs";
import { summonerOf } from "../lib/summons-logic.mjs";
import { STATUS_DEAD } from "../lib/status-effects.mjs";
import { ANIMAL_TYPE } from "../lib/constants.mjs";
import { ACTOR_TYPE } from "../lib/vocab.mjs";
import { foldKey } from "./spell-logic.mjs";

/** A string of the sacrifice's lang group. */
export const loc = (key, data) => game.i18n.format(`${LANG_PREFIX}.sacrifice.${key}`, data ?? {});

/** A document of a uuid that resolves now, else null; a uuid into an unloaded pack throws. */
function resolve(uuid) {
  try {
    return uuid ? fromUuidSync(uuid) : null;
  } catch {
    return null;
  }
}

/** The creature a document is: an actor, or the actor of a token. Null for anything else. */
export const creatureOf = (doc) => (doc?.documentName === "Token" ? doc.actor ?? null : doc?.documentName === "Actor" ? doc : null);

/** The page the sacrifice's passage is cited by, for a tooltip and a hold. */
export const sacrificeCites = () => ({ sacrifice: loc("cite.sacrifice"), value: loc("cite.value"), power: loc("cite.power") });

/** Whether a casting tradition of the class is divine, by the tradition's own key. */
async function castsDivine(actor) {
  const { classForActor } = await import("../classes/registry.mjs");
  return (classForActor(actor)?.system?.casting ?? []).some((t) => foldKey(t?.key) === "divine");
}

/**
 * The caster as the model reads them: `{uuid, name, img, alignment, divine, level, intBonus}`. `divine` is whether a casting
 * tradition of the actor's class is divine; the level and the Intellect bonus are the research throw's own readers', null where unread.
 */
export async function casterFacts(actor) {
  return { uuid: actor.uuid, name: actor.name, img: actor.img ?? "", alignment: actorAlignment(actor), divine: await castsDivine(actor), level: levelOf(actor.uuid), intBonus: intBonusOf(actor.uuid) };
}

/** A creature's XP award, null where it is not read: the default zero is not an award. */
const xpOf = (actor) => {
  const xp = Number(actor?.system?.details?.xp);
  return Number.isFinite(xp) && xp > 0 ? xp : null;
};

/**
 * One victim as the model reads it, from the document its bucket row names (an actor or a token), or null where the
 * world no longer holds it. `young` is the Judge's mark, which bars the XP award (`creatureValue`'s `bars`).
 */
export async function victimFacts(uuid, { young = false } = {}) {
  const doc = await fromUuid(uuid).catch(() => null);
  const actor = creatureOf(doc);
  if (!actor) return null;
  const cite = loc("cite.value");
  const isCharacter = actor.type === ACTOR_TYPE.character;
  const value = isCharacter
    ? characterValue(levelOf(actor.uuid), { cite })
    : creatureValue(actor, {
        isComponent: (item) => Boolean(item?.flags?.[MODULE_ID]?.component),
        xpOf,
        bars: { isAnimal: (a) => a.type === ANIMAL_TYPE || creatureKinds(a).has("animal"), isSummoned: (a) => Boolean(summonerOf(a)), isYoung: () => young },
        cite,
      });
  return {
    uuid,
    name: actor.name,
    img: doc.texture?.src || actor.img || "",
    kind: doc.documentName === "Token" ? "token" : "actor",
    alignment: actorAlignment(actor),
    sapient: sapientOf({ isCharacter, intelligence: actor.getFlag?.(MODULE_ID, "extras")?.secondary?.intelligence ?? "" }),
    dead: actor.statuses?.has?.(STATUS_DEAD) === true,
    isMonster: !isCharacter,
    value,
  };
}

/**
 * Whether the creature a dropped document is already stands in the list: a token and its actor are one creature, so a
 * creature never yields twice for being held under two uuids.
 */
export async function holdsCreature(list, doc) {
  const mine = creatureOf(doc)?.uuid;
  if (!mine) return false;
  for (const row of list) {
    const held = creatureOf(await fromUuid(row.uuid).catch(() => null));
    if (held?.uuid === mine) return true;
  }
  return false;
}

/** Every victim the window's list names, read afresh; a row whose document is gone is left out. */
export async function victimsOf(list, state) {
  const out = [];
  for (const row of list) {
    const facts = await victimFacts(row.uuid, { young: state.victims?.[row.uuid]?.young === true });
    if (facts) out.push(facts);
  }
  return out;
}

/** The imported tables the sacrifice reads, whole. */
export const tablesNow = () => readResearchTables();

/** Whether Foundry lets this user update a creature, never whether the user owns it. */
const mayWrite = (actor) => game.user.isGM || actor?.canUserModify?.(game.user, "update") === true;

/**
 * Mark victims dead. Each is marked here where this seat may write it, and the rest go to the GM's client in one request, which checks them
 * against the caster (`checkMarkRequest`). Never a delete: the write is core's dead status as an overlay (lib's `applySettlement`).
 * @returns {Promise<{marked: string[], failed: string[], refused: string|null}>}
 */
export async function markVictims(caster, uuids) {
  const { applySettlement } = await import("../lib/bucket-apply.mjs");
  const steps = (list) => list.map((uuid) => ({ uuid, kind: resolve(uuid)?.documentName === "Token" ? "token" : "actor", qty: 1, action: SACRIFICE_SETTLE.success }));
  const mine = uuids.filter((uuid) => mayWrite(creatureOf(resolve(uuid))));
  const theirs = uuids.filter((uuid) => !mine.includes(uuid));
  const out = { marked: [], failed: [], refused: null };
  if (mine.length) {
    const done = await applySettlement(steps(mine), (uuid) => fromUuid(uuid).catch(() => null));
    out.marked.push(...done.marked);
    out.failed.push(...mine.filter((u) => !done.marked.includes(u)));
  }
  if (theirs.length) {
    const { executeAsGM } = await import("../lib/sockets.mjs");
    const answer = game.users.activeGM ? await executeAsGM(SACRIFICE_HANDLER, { casterUuid: caster.uuid, uuids: theirs }) : undefined;
    if (answer?.marked) out.marked.push(...answer.marked);
    out.failed.push(...theirs.filter((u) => !(answer?.marked ?? []).includes(u)));
    out.refused = answer === undefined ? "noGm" : answer.reason ?? null;
  }
  return out;
}

/**
 * The GM's client runs a request a Player's seat could not write, after it checks who sent it: the sender Foundry attested and
 * the caster they own, and each victim as this client reads it, never what the payload says.
 */
export async function sacrificeHandler(payload = {}) {
  const { judgeDeclares } = await import("../lib/sockets.mjs");
  const caster = resolve(payload.casterUuid);
  const fromJudge = judgeDeclares(payload.requestUserId);
  const user = game.users.get(payload.requestUserId);
  const uuids = Array.isArray(payload.uuids) ? payload.uuids.map(String) : [];
  const resolved = uuids.map((uuid) => {
    const actor = creatureOf(resolve(uuid));
    return { uuid, creature: Boolean(actor), dead: actor?.statuses?.has?.(STATUS_DEAD) === true };
  });
  const verdict = checkMarkRequest({ casterUuid: caster?.uuid, uuids }, { caster: creatureOf(caster), fromJudge, owns: fromJudge || caster?.testUserPermission?.(user, "OWNER") === true, resolved });
  if (verdict.refused) return { ok: false, reason: verdict.refused };
  const { applySettlement } = await import("../lib/bucket-apply.mjs");
  const done = await applySettlement(uuids.map((uuid) => ({ uuid, kind: resolve(uuid)?.documentName === "Token" ? "token" : "actor", qty: 1, action: SACRIFICE_SETTLE.success })), (uuid) => fromUuid(uuid).catch(() => null));
  return { ok: true, marked: done.marked };
}

let registered = false;

/** Register the GM's half of a Player's mark. Once, at `init`. */
export function registerSacrifice() {
  if (registered) return;
  registered = true;
  void import("../lib/sockets.mjs").then(({ registerHandler }) => registerHandler(SACRIFICE_HANDLER, sacrificeHandler));
}

/** The result as one card through lib's roll card, posted for everyone who sees the caster's rolls. */
export async function postCard(result, plan, { caster, tables }) {
  const { renderRollCard } = await import("../lib/roll-card.mjs");
  const actor = resolve(caster.uuid);
  const names = plan.rows.filter((r) => result.marked.includes(r.uuid)).map((r) => r.name);
  const lines = [];
  if (result.nothing) lines.push(loc("card.nothing"));
  else {
    if (result.auto) lines.push(loc("card.auto", { cite: tables.prose?.cite ?? "" }));
    if (result.amount > 0) lines.push(loc(`card.power.${result.kind}`, { n: result.amount }));
    if (names.length) lines.push(loc("card.dead", { names: names.join(", ") }));
    if (result.failed.length) lines.push(loc("card.failedMark", { n: result.failed.length }));
    if (result.amount > 0 && !result.gain?.ok) lines.push(loc("card.gainFailed"));
  }
  const signed = (n) => (n >= 0 ? `+${n}` : String(n));
  const row = result.nothing
    ? null
    : {
        name: caster.name,
        total: result.total,
        target: result.target,
        targetSuffix: "+",
        targetTooltip: loc("card.throwTip", { cite: tables.ladder?.cite ?? "" }),
        detail: plan.throw.int !== null ? loc("card.int", { n: signed(plan.throw.int) }) : "",
        tooltipText: loc("card.dieTip", { die: result.die, modifier: signed(plan.throw.modifier) }),
        outcome: result.success ? loc("card.success") : loc("card.failure"),
        emphasis: result.success ? "success" : "failure",
      };
  const content = renderRollCard({ title: loc("card.title"), subtitle: caster.name, sections: row ? [{ rows: [row] }] : [], footnote: result.nothing ? undefined : lines.join(" ") || undefined, empty: row ? undefined : loc("card.nothing") });
  const posted = await ChatMessage.create({ content, rolls: result.roll ? [result.roll] : [], speaker: actor ? ChatMessage.getSpeaker({ actor }) : undefined });
  return posted;
}

/** The dependencies of `performSacrifice` as this client has them. */
export function actDeps(caster, tables) {
  return {
    roll: async () => {
      const roll = await new Roll(SACRIFICE_DIE).evaluate();
      return { die: roll.total, roll };
    },
    mark: (uuids) => markVictims(caster, uuids),
    gain: async (kind, amount) => {
      const { powerApi } = await import("./power-ledger-live.mjs");
      return powerApi.gain(resolve(caster.uuid), kind, { amount, name: loc("ledgerName"), img: caster.img || undefined });
    },
    card: (result, plan) => postCard(result, plan, { caster, tables }),
  };
}

/**
 * Make the sacrifice from the window's state: the victims are read afresh and the gates are asked again, so the act
 * is made on what the world holds now. Answers `performSacrifice`'s result.
 * @param {Actor} actor the caster
 * @param {{list: object[], site: boolean, power: boolean, victims: object}} state the window's state
 */
export async function sacrifice(actor, state) {
  const caster = await casterFacts(actor);
  const tables = tablesNow();
  const victims = await victimsOf(state.list, state);
  const plan = planOf({ caster, victims, state, tables, judge: game.user.isGM === true, loc });
  return performSacrifice(plan, actDeps(caster, tables), { tables });
}

/** The API, `acksExtras.magic.sacrifice`: open the window for a caster. */
export const sacrificeApi = {
  VICTIM_KINDS,
  /** Open the Blood sacrifice window for a character; one window per caster. */
  async open(actor) {
    const { SacrificeWindow } = await import("./apps/sacrifice-window.mjs");
    return SacrificeWindow.open(actor);
  },
};

/** Tell the user why an act or a drop was refused. */
export const announce = (reason, data) => ui.notifications?.warn(loc(`refused.${reason}`, data));
