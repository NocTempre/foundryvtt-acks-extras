/* global game, Hooks, ui */
/**
 * The crossing's per-round driver: what the water or a squeeze asks at a member's
 * turn in a fight (RR ch. 6, Swimming and Drowning and Squeezing).
 *
 * On the primary GM's client, when a turn begins, it finds the crossing member
 * whose token is the current combatant's (`standsAs`: a member inside the party
 * token, or with no combatant, has no turn here) and
 *
 *  - for a member afloat with a throw to make, posts the prompt card
 *    (`crossing-prompt.mjs`), once for each round. Nothing rolls by itself: the
 *    card's Throw button, or the row's, throws.
 *  - for a squeezer, the same: the squeezing throw's prompt while they are
 *    working through, and a stuck member's escape prompt (one button for each
 *    way out) once for each round.
 *  - for a drowning member, counts one round of drowning, once for each round,
 *    and posts a card to the Judges the round the breath runs out, once. The
 *    module reports; hit points and a defeated status are the Judge's to write.
 *
 * A turn that is a step back, or the tracker re-sorting, does neither, and the
 * stamps on the member's record (`promptedAt`, `drownedAt`, `thrownAt`) keep a
 * round from being acted on twice. Outside a fight nothing counts.
 */
import { MODULE_ID } from "./constants.mjs";
import { standsAs } from "./deployment.mjs";
import { getFormation, getFormations } from "./formation-model.mjs";
import { DROWNING, ESCAPES, SQUEEZING, STUCK, SWIMMING, notLater, sameTurn, swimTick } from "./crossing-logic.mjs";
import {
  SQUEEZE_KIND, SWIM_KIND, crossingMembers, readCrossing, rowFor, squeezeTargetTip, swimTargetTip, throwFor, writeMemberPatches,
} from "./crossing.mjs";
import { PROMPT_ACTION, postPrompt } from "./crossing-prompt.mjs";
import { requestCrossingThrow } from "./player-requests.mjs";
import { postToJudges } from "../lib/roll-audience.mjs";
import { renderRollCard } from "../lib/roll-card.mjs";
import { elementOf, isPrimaryGM, makeLoc } from "../lib/util.mjs";

const loc = makeLoc("ACKS-FORMATION");

/**
 * Did a turn begin: the round advanced, or the turn moved forward in the round.
 * The tracker re-sorting after an initiative roll and the Judge stepping back
 * begin nothing. Pure.
 *
 * @param {{round: number, turn: number}|null|undefined} prior
 * @param {{round: number, turn: number, combatantId?: string}} current
 */
export function turnBegan(prior, current) {
  if (!current?.combatantId) return false;
  if (!prior) return true;
  // A round opens at turn null until initiative orders it, so the round's first
  // turn arrives as null to 0; `0 > null` is false, which would skip it.
  if (current.round > prior.round) return true;
  return current.round === prior.round && current.turn != null && (prior.turn == null || current.turn > prior.turn);
}

/** The breath-out card: to the Judges alone, saying whose breath it is and that nothing was written. */
function breathCard(name) {
  return renderRollCard({
    title: loc("crossing.prompt.breathTitle"),
    subtitle: name,
    empty: loc("crossing.prompt.breathOut", { name }),
  });
}

/**
 * A turn began on `combat`: for each open swim or squeeze crossing, act for the member whose
 * token is the combatant's. Only the primary GM's client acts.
 *
 * @param {Combat} combat
 * @param {object|null} prior the combat's turn before, as the hook passes it
 * @param {object} current the turn that began
 * @param {{primary?: Function}} [o] `primary` answers whether this client is the primary GM
 * @returns {Promise<{prompted: string[], counted: string[], breathOut: string[]}>} the member ids acted for
 */
export async function onTurnChange(combat, prior, current, { primary = isPrimaryGM } = {}) {
  const done = { prompted: [], counted: [], breathOut: [] };
  if (!primary() || !turnBegan(prior, current)) return done;
  const combatant = combat.combatants?.get?.(current.combatantId);
  if (!combatant) return done;
  const turn = { combatId: combat.id, round: current.round };
  for (const formation of Object.values(getFormations())) {
    const crossing = readCrossing(formation);
    if (crossing?.kind !== SWIM_KIND && crossing?.kind !== SQUEEZE_KIND) continue;
    const entry = crossingMembers(formation).find((e) => standsAs(formation, e.member, combatant.token));
    if (!entry) continue;
    const actorId = entry.member.actorId;
    const record = crossing.members?.[actorId] ?? null;
    const seen = { ...entry, ...rowFor(formation, crossing, entry, { judge: true }) };
    if (crossing.kind === SQUEEZE_KIND) {
      const state = record?.state ?? SQUEEZING;
      const stuck = state === STUCK;
      if (!(stuck ? seen.row.escape.can : state === SQUEEZING && seen.row.can)) continue;
      if (sameTurn(record?.thrownAt, turn) || notLater(record?.promptedAt, turn)) continue;
      if (!(await writeMemberPatches(formation, crossing.id, [{ id: actorId, set: { promptedAt: turn } }]))) continue;
      await postPrompt({
        actor: entry.actor, combatId: turn.combatId, round: turn.round, alias: formation.name, formationId: formation.id, crossingId: crossing.id, actorId,
        ...(stuck
          ? { target: null, targetTip: "", steps: ESCAPES.filter((step) => seen.row.escape[step].can), tries: seen.row.escape.tries }
          : { target: seen.row.target, targetTip: squeezeTargetTip(seen.row), targetKey: "crossing.prompt.squeezeTarget" }),
      });
      done.prompted.push(actorId);
      continue;
    }
    if (record?.state === DROWNING) {
      const tick = swimTick({ member: record, turn, rounds: seen.row.drown.rounds });
      if (!tick) continue;
      if (!(await writeMemberPatches(formation, crossing.id, [{ id: actorId, set: tick.set }]))) continue;
      done.counted.push(actorId);
      if (tick.breathOut) {
        await postToJudges({ content: breathCard(entry.actor.name), speaker: { alias: formation.name } });
        done.breathOut.push(actorId);
      }
      continue;
    }
    if ((record?.state ?? SWIMMING) !== SWIMMING || !seen.row.can) continue;
    if (sameTurn(record?.thrownAt, turn) || notLater(record?.promptedAt, turn)) continue;
    if (!(await writeMemberPatches(formation, crossing.id, [{ id: actorId, set: { promptedAt: turn } }]))) continue;
    await postPrompt({
      actor: entry.actor, combatId: turn.combatId, round: turn.round, alias: formation.name,
      formationId: formation.id, crossingId: crossing.id, actorId, target: seen.row.target, targetTip: swimTargetTip(seen),
    });
    done.prompted.push(actorId);
  }
  return done;
}

/**
 * A press on a prompt card's Throw: the Judge's seat throws, a player's seat
 * relays the press for a member they own. A card from an earlier crossing is
 * refused as stale.
 *
 * @returns {Promise<{ok: boolean, refused?: string}>}
 */
export async function pressPrompt({ formationId, crossingId, actorId, step = null }) {
  const formation = getFormation(formationId);
  const crossing = formation ? readCrossing(formation) : null;
  if (!crossing) return { ok: false, refused: "closed" };
  if (crossing.id !== crossingId) return { ok: false, refused: "stale" };
  if (!game.user.isGM) return requestCrossingThrow(formation, actorId, step);
  const result = await throwFor(formation, actorId, { crossingId, step });
  const key = `ACKS-FORMATION.crossing.refusal.${result.refused}`;
  if (!result.ok && game.i18n.has(key)) ui.notifications.warn(game.i18n.format(key, { name: game.actors?.get?.(actorId)?.name ?? "" }));
  return result;
}

/** Bind a rendered card's Throw button: any seat that sees the card may press it, and the press is checked where it is made. */
export function bindPromptCard(html) {
  const root = elementOf(html);
  if (!root) return;
  for (const button of root.querySelectorAll(`[data-action="${PROMPT_ACTION}"]`)) {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      button.disabled = true;
      pressPrompt({ formationId: button.dataset.formationId, crossingId: button.dataset.crossingId, actorId: button.dataset.actorId, step: button.dataset.step || null })
        .then((result) => { if (!result?.ok) button.disabled = false; })
        .catch((err) => {
          button.disabled = false;
          console.error(`${MODULE_ID} | a crossing prompt's throw failed`, err);
        });
    });
  }
}

let registered = false;

/** Register the driver's two hooks. Once, at `init`. */
export function registerCrossingDriver() {
  if (registered) return;
  registered = true;
  Hooks.on("combatTurnChange", (combat, prior, current) => onTurnChange(combat, prior, current)
    .catch((err) => console.error(`${MODULE_ID} | a swimmer's turn could not be driven`, err)));
  Hooks.on("renderChatMessageHTML", (_message, html) => bindPromptCard(html));
}
