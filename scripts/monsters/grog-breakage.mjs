/* global Hooks, ChatMessage */
/**
 * A beastman's grog is lost when the beastman is defeated or dies (MM p. 56).
 * The trigger is the defeated or dead STATUS landing on the actor, read from
 * an Active Effect that is created or updated carrying it, and never the
 * actor's hit points. Only the primary GM's window acts, since core delivers
 * the hook to every seat. The decision (`grogToBreak`) is pure: which items
 * the actor carries whose `drink` flag names the beastman as its own kind,
 * given that the actor answers to that kind itself. The delete and the one
 * whispered line naming what broke are the runtime half.
 */
import { MODULE_ID } from "./constants.mjs";
import { ITEM_FLAGS } from "../equipment/constants.mjs";
import { creatureKinds } from "../lib/actor-read.mjs";
import { STATUS_DEAD } from "../lib/status-effects.mjs";
import { escape, gmIds, isPrimaryGM, makeLoc } from "../lib/util.mjs";
import { BEASTMAN_KIND } from "./organisation.mjs";

const loc = makeLoc("ACKS-MONSTERS");

/**
 * The items of an actor-like object that break with their bearer: each item
 * whose `drink` flag carries `ownKind` equal to `BEASTMAN_KIND`, and only where
 * the actor's own kinds (`creatureKinds`) hold `BEASTMAN_KIND`. Answers
 * `[{id, name}]`, empty for any other bearer.
 */
export function grogToBreak(actor) {
  if (!creatureKinds(actor).has(BEASTMAN_KIND)) return [];
  const out = [];
  for (const item of [...(actor?.items ?? [])]) {
    if (item?.flags?.[MODULE_ID]?.[ITEM_FLAGS.DRINK]?.ownKind === BEASTMAN_KIND) out.push({ id: item.id ?? item._id, name: item.name });
  }
  return out;
}

/** Whether an effect is enabled and names the defeated status or the dead one. */
export function carriesDownStatus(effect) {
  if (!effect || effect.disabled) return false;
  const statuses = effect.statuses;
  if (!statuses?.has) return false;
  const defeated = globalThis.CONFIG?.specialStatusEffects?.DEFEATED;
  return statuses.has(STATUS_DEAD) || (defeated != null && statuses.has(defeated));
}

/** The actor an effect sits on: its parent, or the token's actor where the parent is a token's delta; null for an effect on an item. */
function effectActor(effect) {
  const parent = effect?.parent;
  if (parent?.documentName === "ActorDelta") return parent.parent?.actor ?? null;
  return parent?.documentName === "Actor" ? parent : null;
}

/** Actor ids whose break is in flight, so a create and an update landing together delete and post once. */
const breaking = new Set();

/** Delete the actor's breaking grog and whisper the GMs one line naming it. */
async function breakGrog(actor) {
  if (!actor || breaking.has(actor.id)) return;
  const broken = grogToBreak(actor);
  if (!broken.length) return;
  breaking.add(actor.id);
  try {
    await actor.deleteEmbeddedDocuments("Item", broken.map((b) => b.id));
    const items = broken.map((b) => escape(b.name ?? "")).join(", ");
    await ChatMessage.create({
      content: `<p><em>${loc("grog.broke", { actor: escape(actor.name ?? ""), items })}</em></p>`,
      whisper: gmIds(),
    });
  } catch (err) {
    console.warn(`${MODULE_ID} | grog not broken`, err);
  } finally {
    breaking.delete(actor.id);
  }
}

let installed = false;

/**
 * Listen for the defeated or dead status landing on an actor and break its
 * beastman grog. Once only; acts on the primary GM's window alone.
 */
export function installGrogBreakage() {
  if (installed) return;
  installed = true;
  for (const name of ["createActiveEffect", "updateActiveEffect"]) {
    Hooks.on(name, (effect) => {
      if (!isPrimaryGM() || !carriesDownStatus(effect)) return;
      void breakGrog(effectActor(effect));
    });
  }
}
