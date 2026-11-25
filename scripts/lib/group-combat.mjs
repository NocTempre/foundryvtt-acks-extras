/* global game, foundry, Hooks, ChatMessage */
/**
 * A group's token in a fight. Adding it to a combat sends out every body its stacks
 * hold, as a row dragged onto the map does, gives each body its own combatant, drops
 * the group's own and hides the token; ending the combat recalls the bodies and puts
 * the token back. Adding the token again while it fights gathers them early. See
 * docs/lib/GROUPS.md, "In a fight".
 *
 * Only the primary GM acts, since a deploy places tokens and a recall writes the
 * group. Each gang among the bodies, a group of two or more, is then grouped for
 * initiative by the system's own tracker call, `groupGangs`; a group inside the one
 * that joined, already in the combat, fights as one of its gangs. `deploy` and `recall` arrive as arguments to `registerGroupCombat`, so this
 * file imports nothing from group.mjs, which registers it.
 *
 * A party's group is left to the party: lib cannot import the formation, so the
 * party token's flag and the formation setting are read here by key.
 */
import { GROUP_LANG_PREFIX, MODULE_ID } from "./constants.mjs";
import { MEMBER_FLAG, deployedTree, gangPartition, groupTree, isGroupActor } from "./group-logic.mjs";
import { gmIds, isPrimaryGM, makeLoc, unset } from "./util.mjs";
import { noticeOnce, tokenlessNames } from "./patches/tokenless-combat.mjs";

const loc = makeLoc(GROUP_LANG_PREFIX);

/**
 * The flag a group token carries while its bodies fight: `{combatId, wasHidden}`,
 * the combat that sent them out and whether the Judge had hidden the token before.
 */
export const COMBAT_FLAG = "groupCombat";

/** The flag the formation's party token carries (formation/constants.mjs, `FLAG_FORMATION_ID`). */
const PARTY_TOKEN_FLAG = "formationId";

/** The world setting holding the formations' records (formation/constants.mjs, `SETTING_FORMATIONS`). */
const FORMATIONS_SETTING = "formations";

/** The bodies a deploy lays out abreast before it starts a new rank. */
const ABREAST = 5;

/**
 * Does a party own this group? Its own token is the party's, and an actor a
 * formation records as a member is deployed and fought by that formation.
 */
function belongsToParty(token, group) {
  if (token.getFlag(MODULE_ID, PARTY_TOKEN_FLAG)) return true;
  if (!game.settings?.settings?.has(`${MODULE_ID}.${FORMATIONS_SETTING}`)) return false;
  const formations = game.settings.get(MODULE_ID, FORMATIONS_SETTING) ?? {};
  return Object.values(formations).some((f) => f?.members?.some((m) => m?.actorId === group.id));
}

/** One whispered line to the GMs, spoken by the group. */
export async function whisperJudges(group, text) {
  await ChatMessage.create({
    content: `<p><em>${foundry.utils.escapeHTML(text)}</em></p>`,
    speaker: { alias: group.name },
    whisper: gmIds(),
  });
}

/** The token's write that ends its fight: back to the visibility it had, flag gone. */
const released = (fight) => ({ hidden: !!fight.wasHidden, [`flags.${MODULE_ID}.${COMBAT_FLAG}`]: unset() });

/**
 * Put every body the group's stacks hold, and every body of every group inside
 * it, on the group token's scene, from the token's square, five abreast and one
 * stack after another. A body already out stays where it stands.
 * @returns {Promise<number>} how many bodies were placed
 */
async function placeBodies(token, group, deploy) {
  const scene = token.parent;
  const step = scene.grid?.size ?? 100;
  const spot = (i) => ({ x: token.x + (i % ABREAST) * step, y: token.y + Math.floor(i / ABREAST) * step });
  let placed = 0;
  for (const owner of groupTree(group)) {
    const keys = (owner.system.stacks ?? []).filter((s) => (s.size?.current ?? 0) > 0).map((s) => s.key);
    for (const stackKey of keys) {
      const first = placed;
      const made = await deploy(owner, scene, { stackKey, count: Infinity, place: (k) => spot(first + k) });
      placed += made.length;
    }
  }
  return placed;
}

/**
 * The group token joined a combat that none of its bodies fight in: send them all
 * out, one combatant each, and take the group's own combatant and the token off the
 * field. The token is flagged before the combatants exist, so a failure part way
 * still leaves the combat's end something to gather the bodies by.
 */
async function sendOut(combatant, token, group, deploy) {
  const combat = combatant.parent;
  const scene = token.parent;
  await placeBodies(token, group, deploy);
  const bodies = deployedTree(group, [scene]);
  if (!bodies.length) {
    await whisperJudges(group, loc("combat.nothing", { name: group.name }));
    return;
  }

  await token.update({
    hidden: true,
    flags: { [MODULE_ID]: { [COMBAT_FLAG]: { combatId: combat.id, wasHidden: !!token.hidden } } },
  });
  const fighting = new Set([...combat.combatants].map((c) => c.tokenId));
  const created = bodies
    .filter((b) => !fighting.has(b.id))
    .map((b) => ({ tokenId: b.id, actorId: b.actorId, sceneId: scene.id, hidden: combatant.hidden }));
  if (created.length) await combat.createEmbeddedDocuments("Combatant", created);
  if (combat.combatants.has(combatant.id)) await combatant.delete();
  await absorbNested(combat, group, deploy);
  await groupGangs(combat, group, deployedTree(group, [scene]));
}

/**
 * A group inside the one that joined whose own token is a combatant here fights as one
 * of the joining group's gangs: it goes out the way a token added to the combat does,
 * which leaves it no entry of its own. A token fighting in another combat is left to
 * it, and so is a party's.
 */
async function absorbNested(combat, group, deploy) {
  const inside = new Set(groupTree(group).slice(1).map((g) => g.uuid));
  if (!inside.size) return;
  const rows = [...combat.combatants].filter((c) => {
    const token = c.token;
    return inside.has(token?.actor?.uuid) && !token.getFlag(MODULE_ID, MEMBER_FLAG) && !belongsToParty(token, token.actor);
  });
  for (const row of rows) {
    const token = row.token;
    const fight = token.getFlag(MODULE_ID, COMBAT_FLAG);
    if (fight && game.combats.has(fight.combatId)) continue;
    await sendOut(row, token, token.actor, deploy);
  }
}

/** The groups the system's tracker holds for `combat`; a plain read, since the namespace is the system's. */
const storedGroups = (combat) => combat.flags?.acks?.groups ?? [];

/** Does the stored list hold a group of exactly these token ids? */
function holdsGroup(combat, ids) {
  return storedGroups(combat).some((g) => g?.tokens?.length === ids.length && ids.every((id) => g.tokens.includes(id)));
}

/** Poll `test` every `interval` ms until it holds or `timeout` ms pass; says whether it held. */
async function until(test, { interval, timeout }) {
  const end = Date.now() + timeout;
  while (!test()) {
    if (Date.now() >= end) return false;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  return true;
}

/**
 * Group each gang of a fight for initiative by the system's own call, the one the
 * tracker's group control makes, `combat.manageGroup(tokens)`, once for each group in
 * `group`'s tree that has two bodies fighting. A group the stored list already holds as
 * it is stands untouched, because a call replaces it and clears the roll it carried.
 *
 * Each call is awaited: patches/group-initiative.mjs makes the call return its write, so
 * the next call starts from a list that has the group. The stored list is then read until
 * it holds the group, which passes at once when the write landed and still orders the calls
 * where that patch stands down and the system's call returns nothing. That wait writes
 * nothing. Where the list never holds the group the wait ends at `timeout` and the next
 * gang goes on.
 * @param {Combat} combat
 * @param {object} group the group actor whose token joined
 * @param {Iterable<TokenDocument>} bodies the tokens of the group's tree on the scene
 * @param {{interval?: number, timeout?: number}} [options] polling step and limit, in ms
 */
export async function groupGangs(combat, group, bodies, { interval = 10, timeout = 3000 } = {}) {
  if (typeof combat?.manageGroup !== "function") return;
  // The group control is refused while the combat holds a combatant with no token; the Judge sees its notice once.
  if (tokenlessNames(combat).length) return noticeOnce(combat);
  try {
    const fighting = new Set([...combat.combatants].map((c) => c.tokenId));
    for (const { group: gang, tokens } of gangPartition(group, bodies, fighting)) {
      const ids = tokens.map((t) => t.id);
      if (holdsGroup(combat, ids)) continue;
      await combat.manageGroup(tokens);
      if (!(await until(() => holdsGroup(combat, ids), { interval, timeout }))) {
        console.warn(`${MODULE_ID} | the tracker never stored a group for ${gang.name}`);
      }
    }
  } catch (err) {
    console.error(`${MODULE_ID} | grouping a fight's gangs failed`, err);
  }
}

/**
 * The group token joined the combat its bodies already fight in: bring them back.
 * Their combatants leave the combat first, the bodies fold into their stacks and the
 * token is put back. The combatant just added stays, so the group fights as one token.
 */
async function gather(combatant, token, group, recall) {
  const combat = combatant.parent;
  const scene = token.parent;
  const ids = new Set(deployedTree(group, [scene]).map((b) => b.id));
  const held = [...combat.combatants].filter((c) => ids.has(c.tokenId)).map((c) => c.id);
  if (held.length) await combat.deleteEmbeddedDocuments("Combatant", held);
  await recall(group, { scene });
  await token.update(released(token.getFlag(MODULE_ID, COMBAT_FLAG)));
}

/**
 * A combatant was created: act on it if it is a group's own token. Bodies carry the
 * member flag, a body's actor is no group, and a party's group is the party's.
 */
async function onCombatantCreated(combatant, { deploy, recall }) {
  const token = combatant.token;
  const group = token?.actor;
  if (!isGroupActor(group) || token.getFlag(MODULE_ID, MEMBER_FLAG) || belongsToParty(token, group)) return;

  const fight = token.getFlag(MODULE_ID, COMBAT_FLAG);
  if (fight?.combatId === combatant.parent.id) return gather(combatant, token, group, recall);
  if (fight && game.combats.has(fight.combatId)) {
    await combatant.delete();
    await whisperJudges(group, loc("combat.elsewhere", { name: group.name }));
    return;
  }
  return sendOut(combatant, token, group, deploy);
}

/**
 * A combat ended: every group token its flag names recalls its bodies and goes back
 * as it was. A token whose group is gone only loses the flag.
 */
async function onCombatDeleted(combat, { recall }) {
  for (const scene of game.scenes ?? []) {
    for (const token of [...scene.tokens]) {
      const fight = token.getFlag(MODULE_ID, COMBAT_FLAG);
      if (fight?.combatId !== combat.id) continue;
      if (isGroupActor(token.actor)) await recall(token.actor, { scene });
      await token.update(released(fight));
    }
  }
}

/** The tail of this client's combat work, which runs one at a time. */
let turn = Promise.resolve();

/**
 * Install the combat hooks. `ops` carries the lifecycle `deploy` and `recall` of
 * group.mjs. Each runs in turn on the primary GM's window, which the trigger reads
 * once: a deploy, an early gather and an end never overlap.
 * @param {{deploy: Function, recall: Function}} ops
 */
export function registerGroupCombat(ops) {
  const inTurn = (work) => {
    turn = turn.then(work).catch((err) => console.error(`${MODULE_ID} | group combat failed`, err));
  };
  Hooks.on("createCombatant", (combatant) => {
    if (isPrimaryGM()) inTurn(() => onCombatantCreated(combatant, ops));
  });
  Hooks.on("deleteCombat", (combat) => {
    if (isPrimaryGM()) inTurn(() => onCombatDeleted(combat, ops));
  });
}
