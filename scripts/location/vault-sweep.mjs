/* global game, Actor, ChatMessage, CONST */
/**
 * Banked coin → a personal vault.
 *
 * The system's money items carry a second number, `system.quantitybank`: coin
 * that is yours, weighs nothing, and is nowhere. Storage answers that question
 * properly, so the field is retired — and retiring a field that holds a party's
 * savings means moving the money somewhere real first. Every character with a
 * banked balance gets a vault (a location actor flagged as theirs), the balance
 * lands there attributed to them, and the field is zeroed.
 *
 * The sweep is IDEMPOTENT and SELF-HEALING: it runs at every ready, does nothing
 * when there is nothing banked, and picks up any stray value that arrives later
 * from an import or a hand-edited actor. A GM who would rather have one shared
 * treasury than a vault per character merges them with the storage manager —
 * that is the tool's first job.
 *
 * CRASH SAFETY. Zeroing the field and depositing the coin are two writes to two
 * documents, and a client that dies between them would destroy the balance. So
 * the ledger of what is owed is written to the character in the SAME update that
 * zeroes the field, and cleared only once the coin has landed. A resume pass
 * reads the ledger, not the (now zero) field.
 */
import { makeLoc, libStorage as storage } from "../lib/util.mjs";
import { MODULE_ID, LANG_PREFIX, LOCATION_TYPE, FLAG_PENDING_DEPOSIT } from "./constants.mjs";
import { ITEM_TYPE, ACTOR_TYPE } from "../lib/vocab.mjs";

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
 * THE ONE DEFINITION OF A VAULT — name, art, ownership and the `vaultOf` flag
 * that binds it to its character. The sweep is not its only caller: a GM who
 * deletes a vault gets the goods back but no vault, and nothing regenerates it
 * (the sweep only ever visits a character with a banked balance, and by then
 * there is none). The storage manager's "give a character a vault" builds on
 * this rather than on a second copy of these four decisions.
 *
 * Idempotent: a character who already has one gets that one back.
 */
export async function vaultFor(character) {
  const existing = storage().findVaultOf(character.uuid);
  if (existing) return existing;
  return Actor.create({
    name: loc("vault.name", { name: character.name }),
    type: LOCATION_TYPE,
    img: "icons/svg/coins.svg",
    // Explicit ownership means the module's own OWNER-for-everyone default for
    // new locations does not apply: a personal vault is not a public bulletin
    // board. (Attribution is still a UI convention, not a security boundary.)
    ownership: vaultOwnership(character),
    flags: { "acks-extras": { storage: { provider: true, vaultOf: character.uuid } } },
    system: { region: loc("vault.region") },
  });
}

/** What this character has banked, as ledger entries. */
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
    await storage().depositCoin(vault, {
      ownerUuid: character.uuid,
      ownerName: character.name,
      coppervalue: entry.coppervalue,
      quantity: entry.quantity,
      name: entry.name,
      img: entry.img,
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

/**
 * Move every banked balance in the world into vaults. GM-elected; safe to run
 * again at any time (the storage manager's macro does exactly that).
 * @returns {Promise<{swept: number, gp: number}>}
 */
export async function runVaultSweep({ announce = true } = {}) {
  const moved = [];

  // Resume first: a ledger means a previous run zeroed the field but died
  // before the coin landed. The ledger is the truth, not the (now zero) field.
  for (const character of game.actors.filter((a) => a.type === ACTOR_TYPE.character)) {
    const pending = character.getFlag(MODULE_ID, FLAG_PENDING_DEPOSIT);
    if (!pending?.length) continue;
    const vault = await depositLedger(character, pending);
    moved.push({ character, vault, ledger: pending, resumed: true });
  }

  for (const character of game.actors.filter((a) => a.type === ACTOR_TYPE.character)) {
    const ledger = bankedLedger(character);
    if (!ledger.length) continue;

    // Claim and zero in ONE write, so there is no instant where the coin is
    // neither on the character nor promised to the vault.
    await character.update({
      [`flags.${MODULE_ID}.${FLAG_PENDING_DEPOSIT}`]: ledger,
      items: ledger.map((e) => ({ _id: e.sourceItemId, "system.quantitybank": 0 })),
    });

    const vault = await depositLedger(character, ledger);
    moved.push({ character, vault, ledger, resumed: false });
  }

  const gp = moved.reduce((sum, m) => sum + m.ledger.reduce((s, e) => s + (e.quantity * e.coppervalue) / 100, 0), 0);
  if (announce && moved.length) {
    const lines = moved
      .map((m) => `<li><b>${m.character.name}</b> → ${m.vault?.name ?? "—"}: ${m.ledger.map((e) => `${e.quantity} ${e.name}`).join(", ")}</li>`)
      .join("");
    await ChatMessage.create({
      content: `<p><b>${loc("sweep.chatTitle")}</b></p><ul>${lines}</ul><p class="notes">${loc("sweep.chatHint")}</p>`,
      whisper: game.users.filter((u) => u.isGM).map((u) => u.id),
    });
  }
  return { swept: moved.length, gp };
}
