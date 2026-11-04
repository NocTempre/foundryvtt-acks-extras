/* global game, foundry, Actor, CONST, Hooks, Roll, fromUuid */
/**
 * An encounter: a group a Judge rolled up from its creatures' ecology. Each
 * monster's row has its own Roll, which sizes that stack at once from the side
 * the Judge chose, writes the noun and the token defaults, and posts one whispered
 * card with every step, and touches no other stack. The reveal decides what each
 * seat reads off the token. See docs/lib/GROUPS.md, "The Roll" and "The reveal";
 * the decisions are group-encounter-logic.mjs.
 *
 * The Roll writes `size.current` and nothing of any one body: a rolled stack
 * stays pristine until `materializeMembers` rolls each body's own hit points.
 */
import { GROUP_LANG_PREFIX, GROUP_TYPE, MODULE_ID } from "./constants.mjs";
import { isGroupActor } from "./group-logic.mjs";
import { addStack } from "./group.mjs";
import {
  BY_LAIR_CHANCE,
  REVEAL,
  ROLL_CONTEXT_HOOK,
  ROLL_KIND,
  encounterFace,
  fullCaption,
  isCreatureStack,
  lairChanceOf,
  nextNoun,
  planStack,
  rollsOver,
  stackHeld,
} from "./group-encounter-logic.mjs";
import { postToJudges } from "./roll-audience.mjs";
import { actorFolder, isPrimaryGM, makeLoc } from "./util.mjs";

export { ROLL_CONTEXT_HOOK };

const loc = makeLoc(GROUP_LANG_PREFIX);

/** What a token shows until the reveal names it. Core's own default art names nothing. */
const mask = () => CONST.DEFAULT_TOKEN;

/** `fullCaption`'s and `encounterFace`'s formatter over this file's lang block. */
const tokenWords = (key, data) => loc(`token.${key}`, data);

/** The noun a group reads as: its own, else its category's. */
export function groupNoun(group) {
  const sys = group.system;
  if (sys.noun) return sys.noun;
  const key = `ACKS-LIB.group.noun.${sys.unit?.category || "monster"}`;
  return game.i18n.has(key) ? game.i18n.localize(key) : "group";
}

/** The name and the count, as the Judge reads them whatever a player can. */
export const judgeCaption = (group) => fullCaption(group.system.stacks, groupNoun(group), tokenWords);

/** What every seat reads off this group's token. */
function faceOf(group) {
  const sys = group.system;
  return encounterFace({ reveal: sys.reveal, noun: groupNoun(group), stacks: sys.stacks, img: group.img, mask: mask() }, tokenWords);
}

/** A creature's art, its token's first; a wildcard token names no single image, so its portrait stands in. */
const artOf = (source) => {
  const token = source?.prototypeToken;
  const src = token?.texture?.src;
  return (token?.randomImg || String(src ?? "").includes("*") ? "" : src) || source?.img || "";
};

/** The token defaults an encounter takes, the party token's shape on the other side. */
const tokenDefaults = () => ({
  actorLink: true,
  disposition: CONST.TOKEN_DISPOSITIONS.HOSTILE,
  displayName: CONST.TOKEN_DISPLAY_MODES.HOVER,
});

/**
 * The creature behind a stack: the live document, so an edited line reads as it
 * stands now, else the snapshot the stack holds.
 * @returns {Promise<object|null>}
 */
export async function stackSource(stack) {
  const uuid = stack?.template?.uuid;
  const live = uuid ? await fromUuid(uuid).catch(() => null) : null;
  return live ?? stack?.template?.snapshot ?? null;
}

/**
 * The line a Roll opens on: what the viewed scene and any party on it say
 * (`ROLL_CONTEXT_HOOK`), else wilderness. A feature answers by writing `context`.
 * @returns {"dungeon"|"wilderness"}
 */
export function defaultRollContext() {
  const answer = { scene: game.scenes?.viewed ?? null, context: "wilderness" };
  Hooks.callAll(ROLL_CONTEXT_HOOK, answer);
  return answer.context;
}

/**
 * Why this stack cannot be rolled now, or null. A synthetic actor would write
 * its stacks to a token delta, and a new count would erase bodies a roll sized.
 * @returns {{reason: string, name?: string}|null}
 */
export function rollRefusal(group, stack) {
  if (group.isToken) return { reason: "unlinked" };
  if (rollsOver(stack) && stackHeld(stack)) return { reason: "held", name: stack.template?.label ?? "" };
  return null;
}

/** Throw a formula on Foundry's own Roll. */
const throwFormula = (formula) => new Roll(formula).evaluate();

/** The label of a Roll's choice. */
const contextLabel = (context) => loc(`roll.context.${context}`);
const stateLabel = (state) => loc(`roll.state.${state}`);

/** Why a plan threw no die, in the words of its kind. */
const whyNot = (plan) => loc(`roll.kind.${plan.kind}`, { count: plan.count, unit: plan.unit });

/** The card's line for the stack, whatever the Roll made of it. */
function stackLine(plan) {
  const line = { label: plan.stack.template?.label ?? "", kind: plan.kind, cite: plan.cite };
  if (plan.die) return { ...line, formula: plan.formula, dice: plan.die.result, total: plan.total };
  return { ...line, note: whyNot(plan) };
}

/**
 * One whispered card with every step: the lair throw, then the stack's die or
 * why it has none. A Judge-only card attaches no rolls (`postToJudges`).
 */
async function postRollCard(group, { context, found, lair, plan, noun }) {
  const content = await foundry.applications.handlebars.renderTemplate(`modules/${MODULE_ID}/templates/lib/group-roll-card.hbs`, {
    title: group.name,
    where: contextLabel(context),
    found: stateLabel(found),
    noun,
    lair: lair ? { chance: lair.chance, total: lair.die.total, inLair: lair.inLair, name: lair.name } : null,
    stack: stackLine(plan),
  });
  return postToJudges({
    content,
    speaker: { alias: loc("roll.speaker") },
    rolls: [lair?.die, plan.die].filter(Boolean),
    flags: {
      [MODULE_ID]: {
        groupRoll: {
          group: group.uuid,
          stack: plan.stack.key,
          context,
          state: found,
          inLair: lair ? lair.inLair : null,
          formula: plan.die ? plan.formula : "",
          total: plan.total ?? null,
        },
      },
    },
  });
}

/** A creature's page, where the importer recorded one. */
export const citeOf = (source) => source?.getFlag?.(MODULE_ID, "cookbook")?.cite ?? source?.flags?.[MODULE_ID]?.cookbook?.cite ?? "";

/**
 * What the first Roll adds to an encounter's update: the reveal, the art and the
 * token defaults. A group a Judge already made an encounter keeps what it has.
 */
function firstRollPatch(group, source) {
  if (group.system.reveal) return {};
  const art = artOf(source);
  const bare = !group.img || group.img === Actor.implementation.DEFAULT_ICON;
  return {
    "system.reveal": REVEAL.noun,
    ...(art && bare ? { img: art } : {}),
    ...Object.fromEntries(Object.entries(tokenDefaults()).map(([key, value]) => [`prototypeToken.${key}`, value])),
  };
}

/**
 * Size one monster's stack from its ecology, at once, and post the card. No other
 * stack is written, and the group's noun moves only if this monster's roll wrote it.
 *
 * @param {Actor} group
 * @param {string} stackKey
 * @param {object} [choice]
 * @param {"dungeon"|"wilderness"} [choice.context] which line
 * @param {"wandering"|"lair"|"chance"} [choice.state] which side, or the lair chance to choose it
 * @param {(formula: string) => Promise<{total: number, result: string}>} [choice.roll] the dice
 * @returns {Promise<{ok: boolean, reason?: string, name?: string, why?: string, found?: string, total?: number|null, message?: object}>}
 */
export async function rollEncounter(group, stackKey, { context = "wilderness", state = "wandering", roll = throwFormula } = {}) {
  if (!isGroupActor(group)) return { ok: false, reason: "notGroup" };
  const stacks = group.system.toObject().stacks;
  const stack = stacks.find((s) => s.key === stackKey);
  if (!isCreatureStack(stack)) return { ok: false, reason: "notStack" };
  const refusal = rollRefusal(group, stack);
  if (refusal) return { ok: false, ...refusal };
  const source = await stackSource(stack);

  // The book's order: the lair throw decides the side, and the number follows.
  let found = state;
  let lair = null;
  if (state === BY_LAIR_CHANCE) {
    const chance = lairChanceOf(source);
    if (chance == null) return { ok: false, reason: "noChance" };
    const die = await roll("1d100");
    found = die.total <= chance ? "lair" : "wandering";
    lair = { chance, die, inLair: found === "lair", name: stack.template?.label ?? "" };
  }

  const plan = { stack, cite: citeOf(source), ...planStack(stack, source, { context, state: found }) };
  if (plan.kind === ROLL_KIND.roll) {
    try {
      plan.die = await roll(plan.formula);
      plan.total = Math.max(0, Math.floor(plan.die.total));
    } catch {
      plan.kind = ROLL_KIND.invalid;
    }
  }
  if (!plan.die && !lair) return { ok: false, reason: "side", name: stack.template?.label ?? "", why: whyNot(plan) };

  const update = { "system.stacks": stacks, ...firstRollPatch(group, source) };
  if (plan.die) {
    update["system.noun"] = nextNoun(group.system.noun, stack.rolled?.noun, plan.noun);
    stack.size.current = plan.total;
    stack.size.initial = plan.total;
    stack.size.formula = plan.formula;
    stack.rolled = { total: plan.total, state: found, context, noun: plan.noun };
  }
  await group.update(update);

  const message = await postRollCard(group, { context, found, lair, plan, noun: groupNoun(group) });
  return { ok: true, found, total: plan.total ?? null, message };
}

/**
 * Make a group with this creature in it: one press from the monster sheet.
 * Filed in the encounters folder, its token masked from the start, so a token
 * placed before the Roll gives nothing away.
 *
 * @param {Actor} source the creature; an unlinked token's actor gives its world actor
 * @returns {Promise<Actor|null>} the new group
 */
export async function makeEncounter(source) {
  const creature = source.isToken ? (source.token?.baseActor ?? source) : source;
  const folder = await actorFolder(loc("folder"));
  const noun = game.i18n.localize("ACKS-LIB.group.noun.monster");
  const img = artOf(creature);
  const face = encounterFace({ reveal: REVEAL.noun, noun, stacks: [], img, mask: mask() }, tokenWords);
  const group = await Actor.implementation.create({
    name: loc("encounterName", { name: creature.name }),
    type: GROUP_TYPE,
    ...(img ? { img } : {}),
    folder: folder?.id ?? null,
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
    prototypeToken: { ...tokenDefaults(), name: face.name, texture: { src: face.src } },
    // Items present, so the system's create keeps `system` (its override replaces it otherwise).
    items: [],
    system: { reveal: REVEAL.noun },
  });
  if (group) await addStack(group, creature);
  return group ?? null;
}

/** Bring the prototype and every placed token to the face the group calls for. */
async function syncFace(group) {
  const face = faceOf(group);
  const proto = group.prototypeToken;
  if (proto.name !== face.name || proto.texture.src !== face.src) {
    await group.update({ "prototypeToken.name": face.name, "prototypeToken.texture.src": face.src });
  }
  for (const scene of game.scenes ?? []) {
    const stale = [...scene.tokens].filter((t) => t.actorId === group.id && (t.name !== face.name || t.texture.src !== face.src));
    if (!stale.length) continue;
    await scene.updateEmbeddedDocuments("Token", stale.map((t) => ({ _id: t.id, name: face.name, "texture.src": face.src })));
  }
}

/** The tail of this client's face writes, which run one at a time. */
let facing = Promise.resolve();

/**
 * Keep every encounter's token true to its reveal and its count. The token's
 * name is the document's, so the tracker and a chat speaker read what the map
 * does, and the primary GM alone writes it. The Judge's own nameplate reads the
 * name and the count whatever the reveal, so two masked tokens stay two.
 */
export function registerEncounterTokens() {
  Hooks.on("updateActor", (actor) => {
    if (!isPrimaryGM() || !isGroupActor(actor) || actor.isToken || !actor.system?.reveal) return;
    facing = facing
      .then(() => syncFace(actor))
      .catch((err) => console.error(`${MODULE_ID} | encounter token write failed`, err));
  });
  Hooks.on("refreshToken", (token) => {
    if (!game.user.isGM || !token.nameplate) return;
    const actor = token.actor;
    if (isGroupActor(actor) && actor.system?.reveal === REVEAL.noun) token.nameplate.text = judgeCaption(actor);
  });
}
