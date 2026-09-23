/* global game, Hooks, ChatMessage, CONFIG */
/**
 * Core patch: a round's initiative, gathered onto ONE chat card.
 *
 * Core's `AcksCombat#rollInitiative` posts a separate `ChatMessage` per
 * combatant. This replaces the pile with a single card, one row per roll,
 * ordered highest first — a combat group (`flags.acks.groups`) collapses to
 * one row naming its members, since core rolls one total for the group but
 * announces it under only the first member.
 *
 * The roll and the grouping are still core's; the seam is presentation only,
 * in three moves: (1) a libWrapper WRAPPER around `rollInitiative`, never a
 * re-implementation; (2) while it runs, a scoped `preCreateChatMessage` hook
 * captures and blocks its per-combatant messages, keeping each one's formula
 * and recipients; (3) rows are read back off the COMBATANTS once core has
 * written them, not off the captured messages, so a grouped member core kept
 * silent about still has a number and still belongs on the card.
 *
 * Privacy is preserved by splitting, not widening: a hidden combatant's row
 * travels on a second, Judges-only card. See docs/lib/DECISIONS.md,
 * "Initiative reuses the roll CARD, not an invented grouping".
 */
import { MODULE_ID, LANG_PREFIX } from "../constants.mjs";
import { gmIds, makeLoc } from "../util.mjs";
import { renderRollCard } from "../roll-card.mjs";

const loc = makeLoc(LANG_PREFIX);

/** World setting: off restores core's one-message-per-combatant behaviour. */
export const SETTING_INITIATIVE_CARD = "initiativeCard";

/**
 * A sentinel stood into the i18n template to find where the name landed. A
 * control character, so no translation can hold one by accident.
 */
const NAME_MARK = String.fromCharCode(1);

const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Recognizer for core's initiative flavor, built from the very template that
 * writes it — a sentinel in place of the name says exactly what shape the
 * sentence has, so the test follows any translation without holding a copy of
 * the English. An identity test only: the total is read off the combatant,
 * which is what keeps an unrelated message from being swallowed into the card.
 */
function flavorPattern() {
  const probe = game.i18n.format("ACKS.roll.individualInit", { name: NAME_MARK });
  if (!probe) return null;
  return new RegExp(`^${escapeRx(probe).replace(NAME_MARK, "[\\s\\S]*")}$`);
}

/** The dice formula behind a message, from the document or its source data. */
function formulaOf(message, data) {
  const raw = message?.rolls?.[0] ?? data?.rolls?.[0];
  if (!raw) return "";
  try {
    const roll = typeof raw === "string" ? JSON.parse(raw) : raw;
    return roll?.formula ?? "";
  } catch {
    return "";
  }
}

/**
 * A `preCreateChatMessage` listener that diverts core's initiative messages into
 * `captured`, plus the array it fills.
 *
 * The capture is deliberately narrow — this user's own message, speaking for a
 * token being rolled right now, carrying core's initiative sentence.
 */
function initiativeCapture(combat, rolledIds, pattern) {
  const tokenIds = new Set();
  for (const id of rolledIds) {
    const tokenId = combat.combatants.get(id)?.token?.id;
    if (tokenId) tokenIds.add(tokenId);
  }

  const captured = [];
  const capture = (message, data) => {
    if (data?.author !== game.user.id) return true;
    const tokenId = data?.speaker?.token;
    if (!tokenIds.has(tokenId)) return true;
    if (!pattern.test(data?.flavor ?? "")) return true;
    captured.push({
      tokenId,
      formula: formulaOf(message, data),
      whisper: Array.isArray(data.whisper) ? data.whisper : [],
    });
    return false; // captured — core's own message never reaches the log
  };

  return { captured, capture };
}

/**
 * One entry per roll that happened: a combat group collapses to a single entry
 * holding every member of it that was rolled, and everybody else stands alone.
 *
 * Read off the combatants AFTER core has updated them, so a member whose number
 * came from the group's roll — and about whom core printed nothing — is on the
 * card with the rest.
 */
function gatherEntries(combat, rolledIds, captured) {
  // Read straight off the document, not through the flag accessors: this is
  // core's namespace, not ours. See docs/lib/DECISIONS.md, "Initiative reuses
  // the roll CARD, not an invented grouping".
  const groups = combat.flags?.acks?.groups ?? [];
  const byToken = new Map(captured.map((c) => [c.tokenId, c]));
  const entries = new Map();

  for (const id of rolledIds) {
    const combatant = combat.combatants.get(id);
    if (!combatant) continue;
    const tokenId = combatant.token?.id ?? null;
    const index = tokenId ? groups.findIndex((g) => g?.tokens?.includes(tokenId)) : -1;
    const key = index >= 0 ? `g${index}` : `c${combatant.id}`;

    let entry = entries.get(key);
    if (!entry) {
      entry = {
        label: index >= 0 ? loc("initiative.group", { n: index }) : null,
        members: [],
        total: null,
        formula: "",
        whisper: [],
      };
      entries.set(key, entry);
    }

    entry.members.push({
      name: combatant.token?.name ?? combatant.name ?? "",
      hidden: !!(combatant.hidden || combatant.token?.hidden),
    });
    const initiative = Number(combatant.initiative);
    if (entry.total === null && Number.isFinite(initiative)) entry.total = initiative;

    const message = byToken.get(tokenId);
    if (message) {
      if (!entry.formula) entry.formula = message.formula;
      entry.whisper.push(...message.whisper);
    }
  }

  return [...entries.values()];
}

/**
 * The two audiences' rows. A group contributes a row to each audience that has a
 * member it may be told about; a lone combatant goes wholly to one or the other.
 */
function splitRows(entries) {
  const open = [];
  const secret = [];
  const whisper = new Set();

  const rowFor = (entry, members) => ({
    name: entry.label ?? members[0].name,
    detail: entry.label ? members.map((m) => m.name).join(", ") : undefined,
    total: entry.total ?? "",
    tooltip: entry.formula || undefined,
  });

  for (const entry of entries) {
    const shown = entry.members.filter((m) => !m.hidden);
    const hidden = entry.members.filter((m) => m.hidden);
    if (shown.length) open.push(rowFor(entry, shown));
    if (hidden.length) {
      secret.push(rowFor(entry, hidden));
      for (const id of entry.whisper) whisper.add(id);
    }
  }

  // Highest first — the card IS the order of battle.
  const byInitiative = (a, b) => Number(b.total) - Number(a.total);
  open.sort(byInitiative);
  secret.sort(byInitiative);
  return { open, secret, whisper: [...whisper] };
}

/** The whole card for one audience, or "" when that audience has no rows. */
function cardHtml(rows, { hidden = false } = {}) {
  return renderRollCard({
    title: loc("initiative.cardTitle"),
    subtitle: hidden ? loc("initiative.hiddenNote") : undefined,
    sections: [{ rows }],
  });
}

/** Post the public card, and the Judges-only card for rows core kept private. */
async function postCards({ open, secret, whisper }) {
  const openHtml = cardHtml(open);
  if (openHtml) await ChatMessage.create({ content: openHtml });

  const secretHtml = cardHtml(secret, { hidden: true });
  if (secretHtml) {
    // Core chose these recipients per row; where it printed nothing at all, the
    // Judges are who a hidden combatant's number was always for.
    await ChatMessage.create({ content: secretHtml, whisper: whisper.length ? whisper : gmIds() });
  }
}

/**
 * WRAPPER form: core rolls, and this only decides where its output is printed.
 *
 * Non-GM clients are passed straight through — core hands a player's click to
 * the GM over its own socket and returns, so there is nothing to gather there
 * and the card is posted once, by the client that did the rolling.
 *
 * Nothing is posted when core printed nothing (every combatant already carried
 * its group's number): a card where core was silent is noise this patch has no
 * business adding.
 */
async function onRollInitiative(wrapped, ids, options) {
  if (!game.user.isGM || !game.settings.get(MODULE_ID, SETTING_INITIATIVE_CARD)) return wrapped(ids, options);
  const pattern = flavorPattern();
  if (!pattern) return wrapped(ids, options);

  const rolled = typeof ids === "string" ? [ids] : [...(ids ?? [])];
  const { captured, capture } = initiativeCapture(this, rolled, pattern);

  Hooks.on("preCreateChatMessage", capture);
  let result;
  try {
    result = await wrapped(ids, options);
  } finally {
    Hooks.off("preCreateChatMessage", capture);
  }

  if (captured.length) {
    try {
      await postCards(splitRows(gatherEntries(this, rolled, captured)));
    } catch (err) {
      // The rolls landed on the combatants either way; a card that cannot be
      // built must not take the initiative roll down with it.
      console.warn(`${MODULE_ID} | could not post the consolidated initiative card`, err);
    }
  }
  return result;
}

/**
 * Install at `ready`, when the combat class is final.
 *
 * Installed UNCONDITIONALLY: the wrapper reads its own setting per roll and
 * defers to core untouched when off, so the toggle needs no reload.
 */
export function installInitiativeCardPatch() {
  const proto = CONFIG.Combat?.documentClass?.prototype;
  if (typeof proto?.rollInitiative !== "function") {
    console.warn(`${MODULE_ID} | no Combat#rollInitiative to wrap; initiative stays on core's messages.`);
    return;
  }
  if (globalThis.libWrapper?.register) {
    globalThis.libWrapper.register(
      MODULE_ID,
      "CONFIG.Combat.documentClass.prototype.rollInitiative",
      onRollInitiative,
      "WRAPPER",
    );
    return;
  }
  const original = proto.rollInitiative;
  proto.rollInitiative = function (ids, options) {
    return onRollInitiative.call(this, (i, o) => original.call(this, i, o), ids, options);
  };
}
