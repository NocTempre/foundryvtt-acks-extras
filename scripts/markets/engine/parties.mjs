/* global game, fromUuidSync */
/**
 * Party resolution for market caps. The availability values are per party
 * (RR §IV.3), so every trade is charged to a party ledger.
 *
 * Default: every PC belongs to ONE implicit party (user ruling) whose size —
 * for the 12-or-more-adventurers rule — counts the player characters AND
 * their henchmen, because the book counts adventurers, not players. The
 * `marketParties` world setting overrides with explicit rosters.
 */
import { ACTOR_TYPE } from "../../lib/vocab.mjs";
import { getHenchmenIds } from "../../henchmen/acks-adapter.mjs";
import { getSetting } from "../settings.mjs";

/** The implicit whole-table party id. */
export const DEFAULT_PARTY_ID = "default";

/** Explicit party rosters from settings ([] = implicit single party). */
export function partiesConfig() {
  try {
    const list = getSetting("marketParties");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** Player-owned adventuring characters (the implicit party's core). */
function playerCharacters() {
  return game.actors.filter(
    (a) => a.type === ACTOR_TYPE.character && a.hasPlayerOwner && !a.system?.retainer?.enabled
  );
}

/** The party an actor trades under. */
export function partyOf(actor) {
  const uuid = actor?.uuid ?? "";
  for (const party of partiesConfig()) {
    if ((party.memberUuids ?? []).includes(uuid)) return { id: party.id, name: party.name ?? party.id };
  }
  return { id: DEFAULT_PARTY_ID, name: "" };
}

/**
 * Adventurer head-count for the very-large-party rule (12 or more
 * adventurers who devote a dedicated activity to shopping purchase twice as
 * much): members plus their henchmen.
 */
export function partySize(partyId) {
  const explicit = partiesConfig().find((p) => p.id === partyId);
  const members = explicit
    ? (explicit.memberUuids ?? [])
        .map((u) => fromUuidSync(u)?.actor ?? fromUuidSync(u))
        .filter(Boolean)
    : playerCharacters();
  let n = 0;
  for (const actor of members) n += 1 + getHenchmenIds(actor).length;
  return n;
}
