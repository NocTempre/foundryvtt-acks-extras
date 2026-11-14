/**
 * A lair: a place that is the lair of one library monster. The place carries
 * `flags["acks-extras"].lair` (`{of, group, noted}`), and this file is the only
 * one that writes it. `of` is the monster's cookbook id, written at import and
 * resolved here whenever the monster is in the library; `group` is the
 * encounter group the lair rolled, which a lair rolls once; `noted` is the
 * reason the Judges were last told nothing could be rolled.
 *
 * A roll sizes a group from the monster's imported in-lair side
 * (`planLair`), makes it with `makeEncounter`, throws its lair side with
 * `rollEncounter`, and links it from the place by `lair.group` and a hidden
 * roster row. The roster row names the group, whose headcount is the bodies it
 * rolled; the monster itself is never a row. The decisions are lair-logic.mjs.
 */
import { MODULE_ID, LAIR_LANG_PREFIX } from "./constants.mjs";
import { byCookbookId, whenReady } from "./library.mjs";
import { citeOf, countTip, makeEncounter, rollEncounter } from "./group-encounter.mjs";
import { LAIR_KEY, lairOf, planLair } from "./lair-logic.mjs";
import { occupantRow } from "./place.mjs";
import { postToJudges } from "./roll-audience.mjs";
import { docOf, escape as esc, makeLoc } from "./util.mjs";

export { LAIR_KEY, lairData, lairOf, planLair } from "./lair-logic.mjs";

const loc = makeLoc(LAIR_LANG_PREFIX);

/** The line a lair rolls on unless the caller names another: the wilderness line. */
const DEFAULT_CONTEXT = "wilderness";

/**
 * The library's own actor of the monster a place is the lair of, or null where
 * it is not imported. A world copy and a group's base actor carry the monster's
 * stamp and are skipped (`byCookbookId`'s `original`).
 * @param {object} place
 * @returns {Promise<Actor|null>}
 */
export async function lairMonster(place) {
  const of = lairOf(place)?.of;
  if (!of) return null;
  await whenReady();
  return byCookbookId("Actor", of, { original: true });
}

/** The words for a refusal: why a lair made no group. */
export function lairWhy(reason, { count = "", unit = "" } = {}) {
  return loc(`why.${reason}`, { count, unit });
}

/** The group a lair holds, or null where it holds none or the Judge deleted it. */
const heldGroup = (lair) => (lair?.group ? docOf(lair.group) : null);

/**
 * Tell the Judges once why a lair made nothing. The reason is written before
 * the card is posted, so a failed post cannot say it twice.
 */
async function note(place, lair, refusal) {
  if (lair.noted === refusal.reason) return;
  await place.update({ [`flags.${MODULE_ID}.${LAIR_KEY}.noted`]: refusal.reason });
  await postToJudges({
    content: `<p>${esc(loc("noted", { place: place.name, why: lairWhy(refusal.reason, refusal) }))}</p>`,
    speaker: { alias: loc("speaker") },
  });
}

/** One roll of one lair; `rollLair` queues these per place. */
async function rollOnce(place, { context }) {
  const lair = lairOf(place);
  if (!lair) return { ok: false, reason: "notLair" };
  const held = heldGroup(lair);
  if (held) return { ok: false, reason: "rolled", group: held, text: lairWhy("rolled") };

  const monster = await lairMonster(place);
  const plan = planLair(monster, context);
  if (!plan.ok) {
    await note(place, lair, plan);
    return { ok: false, reason: plan.reason, text: lairWhy(plan.reason, plan) };
  }

  const group = await makeEncounter(monster);
  const stackKey = group?.system?.stacks?.[0]?.key;
  const rolled = stackKey ? await rollEncounter(group, stackKey, { context, state: "lair" }) : { ok: false, reason: "made" };
  if (!rolled.ok) {
    // A group that rolled nothing is not left behind to answer for a lair.
    await group?.delete?.();
    const reason = rolled.reason === "side" ? "invalid" : "failed";
    await note(place, lair, { reason });
    return { ok: false, reason, text: lairWhy(reason) };
  }

  // The previous group's row stays on the roster after the Judge deleted it; it goes with the new row's write.
  const kept = (place.system?.roster ?? [])
    .map((row) => row.toObject?.() ?? row)
    .filter((row) => row.uuid !== lair.group && row.uuid !== group.uuid);
  await place.update({
    "system.roster": [...kept, occupantRow(group, { hidden: true })],
    [`flags.${MODULE_ID}.${LAIR_KEY}.group`]: group.uuid,
    [`flags.${MODULE_ID}.${LAIR_KEY}.noted`]: "",
  });
  return { ok: true, group, total: rolled.total };
}

/** The tail of each place's rolls, which run one at a time. */
const queues = new Map();

/**
 * Roll a lair's encounter, once. Refused where the place already holds a group
 * that still exists, so a lair rolls again only after the Judge deleted it. A
 * monster whose in-lair side gives no number of bodies makes nothing, and the
 * Judges are told why the first time. Calls for one place run one at a time, so
 * two arrivals in a burst make one group. The caller is a GM's window: the
 * place and the group are world documents it writes.
 *
 * @param {Actor} place the lair
 * @param {object} [options]
 * @param {"dungeon"|"wilderness"} [options.context] the encounter line
 * @returns {Promise<{ok: boolean, reason?: string, text?: string, group?: Actor, total?: number}>}
 */
export function rollLair(place, { context = DEFAULT_CONTEXT } = {}) {
  const key = place?.uuid ?? "";
  const run = (queues.get(key) ?? Promise.resolve()).then(() => rollOnce(place, { context }));
  const tail = run.catch(() => {});
  queues.set(key, tail);
  tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key);
  });
  return run;
}

/**
 * What the location sheet shows of a lair: its monster (with the page the
 * importer read it from), its group (with the count it rolled and where that
 * count came from), and whether a Roll would do anything and why not. Null for
 * a place that is no lair.
 * @param {Actor} place
 * @param {{context?: "dungeon"|"wilderness"}} [options]
 */
export async function lairState(place, { context = DEFAULT_CONTEXT } = {}) {
  const lair = lairOf(place);
  if (!lair) return null;
  const monster = await lairMonster(place);
  const held = heldGroup(lair);
  const plan = planLair(monster, context);
  const stack = held?.system?.stacks?.[0];
  return {
    monster: monster ? { uuid: monster.uuid, name: monster.name, cite: citeOf(monster) } : null,
    group: held ? { uuid: held.uuid, name: held.name, total: stack?.rolled?.total ?? null, tip: stack ? countTip(stack, monster) : "" } : null,
    canRoll: plan.ok && !held,
    why: held ? lairWhy("rolled") : plan.ok ? "" : lairWhy(plan.reason, plan),
  };
}
