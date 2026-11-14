/* global game, Actor, ChatMessage, CONST */
/**
 * Banked coin → a personal vault.
 *
 * Money items carry `system.quantitybank`, the banked balance. Every character
 * with one gets a vault (a location actor flagged as theirs), the balance lands
 * there attributed to them, and the field is zeroed. An actor of any other
 * type, and a token that is its own copy of an actor, keep no vault: the
 * balance joins the coin they carry, on the row it was banked on.
 *
 * Idempotent: it runs at every ready and does nothing when nothing is banked.
 *
 * Crash safety: the ledger of what is owed is written to the character in the
 * SAME update that zeroes the field, and cleared once the coin has landed; a
 * resume pass reads the ledger.
 * See docs/location/DECISIONS.md, "The banked-coin column is retired, and the sweep is the migration (2026-08-01)".
 */
import { makeLoc, gmIds, libStorage as storage } from "../lib/util.mjs";
import { MODULE_ID, LANG_PREFIX, LOCATION_TYPE, FLAG_PENDING_DEPOSIT } from "./constants.mjs";
import { ITEM_TYPE, ACTOR_TYPE } from "../lib/vocab.mjs";
import { coinCount } from "../lib/money-logic.mjs";
import { mintCoin } from "../lib/money.mjs";

const loc = makeLoc(LANG_PREFIX);

/** Owner entries for a vault: the character's own players, and nobody else. */
function vaultOwnership(character) {
  const ownership = { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE };
  for (const [userId, level] of Object.entries(character.ownership ?? {})) {
    if (userId === "default") continue;
    if (level >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER) {
      ownership[userId] = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
    }
  }
  return ownership;
}

/**
 * This character's vault, made if they do not have one yet.
 *
 * The one definition of a vault — name, art, ownership and the `vaultOf` flag
 * that binds it to its character; the storage manager's "give a character a
 * vault" builds on it too. Idempotent: a character who already has one gets
 * that one back.
 */
export async function vaultFor(character) {
  const existing = storage().findVaultOf(character.uuid);
  if (existing) return existing;
  return Actor.create({
    name: loc("vault.name", { name: character.name }),
    type: LOCATION_TYPE,
    img: "icons/svg/coins.svg",
    // Explicit ownership overrides the OWNER-for-everyone default for new locations.
    ownership: vaultOwnership(character),
    flags: { "acks-extras": { storage: { provider: true, vaultOf: character.uuid } } },
    system: { region: loc("vault.region") },
  });
}

/**
 * Coin from nowhere, put in a character's vault as theirs — a bequest, a
 * banker's payment. The vault is made if they keep none.
 * @returns {Promise<Actor|null>} the vault, or null when none could be made
 */
export async function payIntoVault(character, gp) {
  const vault = await vaultFor(character);
  if (!vault) return null;
  await mintCoin(vault, gp, { ownerUuid: character.uuid, ownerName: character.name });
  return vault;
}

/** What this actor has banked, as ledger entries. */
function bankedLedger(character) {
  const ledger = [];
  for (const item of character.items) {
    if (item.type !== ITEM_TYPE.money) continue;
    const quantity = Number(item.system?.quantitybank ?? 0);
    if (!(quantity > 0)) continue;
    ledger.push({
      sourceItemId: item.id,
      name: item.name,
      img: item.img,
      coppervalue: Number(item.system?.coppervalue ?? 1),
      quantity,
    });
  }
  return ledger;
}

/** Put a ledger into the vault, then clear the claim. */
async function depositLedger(character, ledger) {
  const vault = await vaultFor(character);
  if (!vault) return null;
  for (const entry of ledger) {
    // The row the balance came off, where it still exists, says which coin it is.
    const row = character.items.get(entry.sourceItemId);
    await storage().depositCoin(vault, {
      ownerUuid: character.uuid,
      ownerName: character.name,
      coppervalue: entry.coppervalue,
      quantity: entry.quantity,
      name: entry.name,
      source: row?.type === ITEM_TYPE.money ? row.toObject() : null,
    });
  }
  await character.unsetFlag(MODULE_ID, FLAG_PENDING_DEPOSIT);

  // A coin row that was pure bank balance is now an empty stack; drop it.
  const spent = ledger.map((e) => e.sourceItemId);
  const empties = character.items
    .filter((i) => spent.includes(i.id) && i.type === ITEM_TYPE.money)
    .filter((i) => !(Number(i.system?.quantity ?? 0) > 0) && !(Number(i.system?.quantitybank ?? 0) > 0))
    .map((i) => i.id);
  if (empties.length) await character.deleteEmbeddedDocuments("Item", empties);
  return vault;
}

/** The world's characters, or those whose uuid is in `only`. */
function characters(only = null) {
  return game.actors.filter((a) => a.type === ACTOR_TYPE.character && (!only || only.has(a.uuid)));
}

/**
 * Every other actor — the ones that keep no vault — narrowed the same way: the
 * world's non-character actors, and an unlinked token's own actor where its
 * copy of a coin row still holds a balance (read off the scene's stored data).
 */
function carriers(only = null) {
  const out = game.actors.filter((a) => a.type !== ACTOR_TYPE.character);
  for (const scene of game.scenes ?? []) {
    for (const token of scene.tokens ?? []) {
      if (token.actorLink) continue;
      const rows = token._source?.delta?.items ?? [];
      if (!rows.some((i) => i?.type === ITEM_TYPE.money && Number(i.system?.quantitybank) > 0)) continue;
      if (token.actor) out.push(token.actor);
    }
  }
  return out.filter((a) => !only || only.has(a.uuid));
}

/**
 * Fold a banked balance into the coin its actor carries, in one write.
 */
async function unbank(actor, ledger) {
  await actor.updateEmbeddedDocuments(
    "Item",
    ledger.map((e) => ({
      _id: e.sourceItemId,
      "system.quantity": coinCount(actor.items.get(e.sourceItemId)) + e.quantity,
      "system.quantitybank": 0,
    })),
  );
}

/**
 * What `runVaultSweep` would move, without moving it: per actor, the ledger a
 * stopped sweep left owed to a vault and the balance still banked. `carried`
 * marks an actor that keeps no vault, whose balance joins the coin it carries.
 * @returns {{character: Actor, pending: object[], banked: object[], carried: boolean}[]}
 */
export function planVaultSweep() {
  const out = [];
  for (const character of characters()) {
    const pending = character.getFlag(MODULE_ID, FLAG_PENDING_DEPOSIT) ?? [];
    const banked = bankedLedger(character);
    if (pending.length || banked.length) out.push({ character, pending, banked, carried: false });
  }
  for (const actor of carriers()) {
    const banked = bankedLedger(actor);
    if (banked.length) out.push({ character: actor, pending: [], banked, carried: true });
  }
  return out;
}

/**
 * Move every banked balance in the world to where coin is kept now — a
 * character's into their vault, anyone else's into the coin they carry — or
 * only the balances of the actors whose uuids are in `only`. GM-elected; safe
 * to run again at any time.
 * @returns {Promise<{swept: number, gp: number}>}
 */
export async function runVaultSweep({ announce = true, only = null } = {}) {
  const moved = [];

  // Resume first: a ledger means a previous run died before the coin landed.
  for (const character of characters(only)) {
    const pending = character.getFlag(MODULE_ID, FLAG_PENDING_DEPOSIT);
    if (!pending?.length) continue;
    const vault = await depositLedger(character, pending);
    moved.push({ character, vault, ledger: pending, resumed: true });
  }

  for (const character of characters(only)) {
    const ledger = bankedLedger(character);
    if (!ledger.length) continue;

    // Claim and zero in ONE write.
    await character.update({
      [`flags.${MODULE_ID}.${FLAG_PENDING_DEPOSIT}`]: ledger,
      items: ledger.map((e) => ({ _id: e.sourceItemId, "system.quantitybank": 0 })),
    });

    const vault = await depositLedger(character, ledger);
    moved.push({ character, vault, ledger, resumed: false });
  }

  for (const actor of carriers(only)) {
    const ledger = bankedLedger(actor);
    if (!ledger.length) continue;
    await unbank(actor, ledger);
    moved.push({ character: actor, vault: null, ledger, resumed: false, carried: true });
  }

  const gp = moved.reduce((sum, m) => sum + m.ledger.reduce((s, e) => s + (e.quantity * e.coppervalue) / 100, 0), 0);
  if (announce && moved.length) {
    const where = (m) => (m.carried ? loc("sweep.carried") : m.vault?.name ?? "—");
    const lines = moved
      .map((m) => `<li><b>${m.character.name}</b> → ${where(m)}: ${m.ledger.map((e) => `${e.quantity} ${e.name}`).join(", ")}</li>`)
      .join("");
    await ChatMessage.create({
      content: `<p><b>${loc("sweep.chatTitle")}</b></p><ul>${lines}</ul><p class="notes">${loc("sweep.chatHint")}</p>`,
      whisper: gmIds(),
    });
  }
  return { swept: moved.length, gp };
}
