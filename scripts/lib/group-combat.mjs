/* global game, foundry, Hooks, ChatMessage */
/**
 * A group's token in a fight. Adding it to a combat sends out every body its stacks
 * hold, as a row dragged onto the map does, gives each body its own combatant, drops
 * the group's own and hides the token; ending the combat recalls the bodies and puts
 * the token back. Adding the token again while it fights gathers them early. See
 * docs/lib/GROUPS.md, "In a fight".
 *
 * Only the primary GM acts, since a deploy places tokens and a recall writes the
 * group. `deploy` and `recall` arrive as arguments to `registerGroupCombat`, so this
 * file imports nothing from group.mjs, which registers it.
 *
 * A party's group is left to the party: lib cannot import the formation, so the
 * party token's flag and the formation setting are read here by key.
 */
import { GROUP_LANG_PREFIX, MODULE_ID } from "./constants.mjs";
import { MEMBER_FLAG, deployedBodies, isGroupActor } from "./group-logic.mjs";
import { gmIds, isPrimaryGM, makeLoc, unset } from "./util.mjs";

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
async function whisperJudges(group, text) {
  await ChatMessage.create({
    content: `<p><em>${foundry.utils.escapeHTML(text)}</em></p>`,
    speaker: { alias: group.name },
    whisper: gmIds(),
  });
}

/** The token's write that ends its fight: back to the visibility it had, flag gone. */
const released = (fight) => ({ hidden: !!fight.wasHidden, [`flags.${MODULE_ID}.${COMBAT_FLAG}`]: unset() });

/**
 * Put every body the group's stacks hold on the group token's scene, from the
 * token's square, five abreast and one stack after another. A body already out
 * stays where it stands.
 * @returns {Promise<number>} how many bodies were placed
 */
async function placeBodies(token, group, deploy) {
  const scene = token.parent;
  const step = scene.grid?.size ?? 100;
  const spot = (i) => ({ x: token.x + (i % ABREAST) * step, y: token.y + Math.floor(i / ABREAST) * step });
  const keys = (group.system.stacks ?? []).filter((s) => (s.size?.current ?? 0) > 0).map((s) => s.key);
  let placed = 0;
  for (const stackKey of keys) {
    const first = placed;
    const made = await deploy(group, scene, { stackKey, count: Infinity, place: (k) => spot(first + k) });
    placed += made.length;
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
  const bodies = deployedBodies(group, [scene]);
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
}

/**
 * The group token joined the combat its bodies already fight in: bring them back.
 * Their combatants leave the combat first, the bodies fold into their stacks and the
 * token is put back. The combatant just added stays, so the group fights as one token.
 */
async function gather(combatant, token, group, recall) {
  const combat = combatant.parent;
  const scene = token.parent;
  const ids = new Set(deployedBodies(group, [scene]).map((b) => b.id));
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
