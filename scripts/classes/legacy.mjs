/* global game, foundry, ui, ChatMessage, CONST, fromUuid */
/**
 * The Foundry half of a player's legacy (docs/classes/MODEL.md, "Legacy"): the
 * ledger kept on the PLAYER's User, a will kept on the character, the writes
 * that record into them, and the window that shows both.
 *
 * Every ledger write is the Judge's — a GM seat writes any User — so a player
 * reads their own ledger and records nothing into it. A will is the
 * character's owner's to write; settling it is the Judge's.
 */
import { MODULE_ID, LANG_PREFIX } from "./constants.mjs";
import { getDoc, hasDoc } from "../lib/tables.mjs";
import { gmIds, makeLoc } from "../lib/util.mjs";
import { spendGold } from "../henchmen/acks-adapter.mjs";
import { payIntoVault } from "../location/vault-sweep.mjs";
import { EXPERIENCE_DOC } from "./xp-bonus.mjs";
import { LEGACY_KIND, legacyTotals, settleEstate, startingXp, xpForGp } from "./legacy-logic.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;
const classLoc = makeLoc(LANG_PREFIX);
/** This window's strings, under `ACKS-CLASSES.legacy.*`. */
const loc = (key, data) => classLoc(`legacy.${key}`, data);

/** User flag: `{entries: [{id, kind, gp, xp, actorUuid, actorName, note, at, claimedBy?}], starts: [...]}`. */
export const FLAG_LEGACY = "legacy";
/** Actor flag: the User id whose ledger this character belongs to, where no player owns it. */
export const FLAG_LEGACY_PLAYER = "legacyPlayer";
/** Actor flag: `{heirUuid, heirName, estateGp, note, settled?: {at, fee, net, heirName}}`. */
export const FLAG_WILL = "will";

/** The imported percentages, each null until read from a book. */
export function legacyRates() {
  const t = hasDoc(EXPERIENCE_DOC) ? getDoc(EXPERIENCE_DOC)?.tables ?? {} : {};
  const pct = (v) => (Number.isFinite(v) ? v : null);
  return { reserve: pct(t.reserveRate), funeral: pct(t.funeralRate), bankFee: pct(t.bankFee) };
}

/**
 * The player whose ledger a character feeds: the one the Judge named on it,
 * else the first non-GM owner, else null.
 */
export function playerOf(actor) {
  const named = game.users.get(actor?.getFlag?.(MODULE_ID, FLAG_LEGACY_PLAYER) ?? "");
  if (named) return named;
  return game.users.find((u) => !u.isGM && actor?.testUserPermission?.(u, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER)) ?? null;
}

/** A user's ledger, never null. */
export const ledgerOf = (user) => foundry.utils.deepClone(user?.getFlag(MODULE_ID, FLAG_LEGACY) ?? { entries: [], starts: [] });

const now = () => game.time?.worldTime ?? 0;

/** The tail of each key's queue of writes. */
const queues = new Map();

/**
 * Run `fn` after every earlier write under `key` has settled. Each write reads
 * the ledger (or the will) it changes and then writes it back; two clicks
 * close together must not both read the state before either wrote, or the
 * later write drops the earlier one's entry — or a will pays twice.
 */
function serial(key, fn) {
  const run = (queues.get(key) ?? Promise.resolve()).then(fn);
  queues.set(key, run.catch(() => null));
  return run;
}

/** Warn and answer null: the one shape of a refused legacy write. */
function refuse(key, data) {
  ui.notifications.warn(loc(key, data));
  return null;
}

/** Whisper a line to the Judges and the player it concerns. */
function announce(user, content, actor = null) {
  ChatMessage.create({
    content,
    speaker: actor ? ChatMessage.getSpeaker({ actor }) : undefined,
    whisper: [...new Set([...gmIds(), user?.id].filter(Boolean))],
  });
}

/**
 * Record gp spent for no tangible benefit (`kind` reserve) or on a heroic
 * funeral (`kind` funeral) against a character's player. With `pay`, the coin
 * leaves the character's purse first and nothing is recorded if it cannot.
 * @returns {Promise<object|null>} the entry, or null when refused
 */
export async function recordLegacy(actor, { kind, gp, note = "", pay = false } = {}) {
  if (!game.user.isGM) return null;
  const user = playerOf(actor);
  const rate = kind === LEGACY_KIND.funeral ? legacyRates().funeral : legacyRates().reserve;
  const amount = Math.max(0, Math.floor(Number(gp) || 0));
  if (!user) return refuse("noPlayer", { name: actor.name });
  if (rate == null) return refuse("notImported");
  if (!amount) return null;
  return serial(user.id, async () => {
    if (pay && !(await spendGold(actor, amount, loc(kind === LEGACY_KIND.funeral ? "kind.funeral" : "kind.reserve"), { chat: false, gate: false }))) return null;
    const entry = {
      id: foundry.utils.randomID(),
      kind,
      gp: amount,
      xp: xpForGp(amount, rate),
      actorUuid: actor.uuid,
      actorName: actor.name,
      note: String(note ?? "").trim(),
      at: now(),
    };
    const ledger = ledgerOf(user);
    ledger.entries = [...(ledger.entries ?? []), entry];
    await user.setFlag(MODULE_ID, FLAG_LEGACY, ledger);
    announce(user, loc(kind === LEGACY_KIND.funeral ? "card.funeral" : "card.reserve", { name: actor.name, gp: amount, xp: entry.xp, player: user.name }), actor);
    return entry;
  });
}

/** Strike one entry from a player's ledger (a Judge's correction). */
export async function deleteLegacyEntry(user, entryId) {
  if (!game.user.isGM || !user) return false;
  return serial(user.id, async () => {
    const ledger = ledgerOf(user);
    const before = ledger.entries?.length ?? 0;
    ledger.entries = (ledger.entries ?? []).filter((e) => e.id !== entryId);
    if (ledger.entries.length === before) return false;
    await user.setFlag(MODULE_ID, FLAG_LEGACY, ledger);
    return true;
  });
}

/**
 * Start `actor` from its player's legacy against `prior`, the character it
 * follows: its experience is raised to what the legacy grants and the
 * funerals it used are claimed. Refused, with nothing claimed, when the grant
 * would not raise it.
 * @returns {Promise<object|null>} the `startingXp` result, or null when refused
 */
export async function startFromLegacy(actor, prior) {
  if (!game.user.isGM || !prior) return null;
  const user = playerOf(actor);
  if (!user) return refuse("noPlayer", { name: actor.name });
  return serial(user.id, async () => {
    const ledger = ledgerOf(user);
    const result = startingXp(ledger, prior.system?.details?.xp?.value);
    const current = Number(actor.system?.details?.xp?.value) || 0;
    // Nothing to raise: refuse whole, so no funeral is claimed for a start that gave nothing.
    if (result.xp <= current) return refuse("nothingToGrant", { name: actor.name, xp: current, grant: result.xp });
    await actor.update({ "system.details.xp.value": result.xp });
    const claims = new Set(result.claims);
    ledger.entries = (ledger.entries ?? []).map((e) => (claims.has(e.id) ? { ...e, claimedBy: { uuid: actor.uuid, name: actor.name } } : e));
    ledger.starts = [...(ledger.starts ?? []), { actorUuid: actor.uuid, actorName: actor.name, priorName: prior.name, xp: result.xp, capped: result.capped, at: now() }];
    await user.setFlag(MODULE_ID, FLAG_LEGACY, ledger);
    announce(user, loc(result.capped ? "card.startCapped" : "card.start", { name: actor.name, xp: result.xp, prior: prior.name }), actor);
    return result;
  });
}

/** Name an heir and the estate a character's will leaves them. */
export async function saveWill(actor, { heirUuid = "", estateGp = 0, note = "" } = {}) {
  if (!actor?.isOwner) return false;
  const heir = heirUuid ? await fromUuid(heirUuid) : null;
  const will = {
    heirUuid: heir?.uuid ?? "",
    heirName: heir?.name ?? "",
    estateGp: Math.max(0, Math.floor(Number(estateGp) || 0)),
    note: String(note ?? "").trim(),
  };
  await actor.setFlag(MODULE_ID, FLAG_WILL, will);
  return true;
}

/**
 * Settle a will: the estate less the bank's charge is paid into the heir's
 * vault — the place their banked coin is kept — and the will is marked
 * settled so it cannot pay twice. The deceased's own belongings are not
 * touched.
 * @returns {Promise<object|null>} `{fee, net}`, or null when refused
 */
export async function settleWill(actor) {
  if (!game.user.isGM) return null;
  return serial(`will:${actor.uuid}`, async () => {
    const will = actor.getFlag(MODULE_ID, FLAG_WILL);
    const fee = legacyRates().bankFee;
    if (!will?.heirUuid || will.settled) return null;
    if (fee == null) return refuse("notImported");
    const heir = await fromUuid(will.heirUuid);
    if (!heir) return refuse("heirGone", { name: will.heirName });
    const result = settleEstate(will.estateGp, fee);
    // Paid before the will is marked: a vault that cannot be made refuses the
    // settlement whole, so nothing is recorded as paid that was not.
    if (result.net > 0 && !(await payIntoVault(heir, result.net))) return refuse("noVault", { name: heir.name });
    await actor.setFlag(MODULE_ID, FLAG_WILL, { ...will, settled: { at: now(), ...result, heirName: heir.name } });
    announce(playerOf(heir) ?? playerOf(actor), loc("card.settled", { name: actor.name, heir: heir.name, net: result.net, fee: result.fee }), actor);
    return result;
  });
}

/** Open (or bring forward) the Legacy window for a character. */
export function openLegacy(actor) {
  const id = `acks-extras-legacy-${actor.id}`;
  const open = foundry.applications.instances.get(id);
  if (open) return open.bringToFront?.() ?? open.render({ force: true });
  return new LegacyApp({ actor, id }).render({ force: true });
}

/**
 * The Legacy window: the player's reserve fund and funerals, starting a
 * character from them, and the character's will. Buttons act; the inputs are
 * read at the moment a button is pressed.
 */
export class LegacyApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @param {{actor: Actor}} options */
  constructor({ actor, ...options } = {}) {
    super(options);
    this.actor = actor;
  }

  static DEFAULT_OPTIONS = {
    classes: ["acks-ui", "acks", "acks-extras", "acks-extras-scroll", "acks-extras-legacy"],
    position: { width: 620, height: "auto" },
    window: { icon: "fa-solid fa-landmark", contentClasses: ["standard-form"], resizable: true },
    actions: {
      record: LegacyApp.#onRecord,
      deleteEntry: LegacyApp.#onDeleteEntry,
      start: LegacyApp.#onStart,
      saveWill: LegacyApp.#onSaveWill,
      settleWill: LegacyApp.#onSettleWill,
      setPlayer: LegacyApp.#onSetPlayer,
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/classes/legacy.hbs` },
  };

  /** @override */
  get title() {
    return loc("title", { name: this.actor.name });
  }

  /** @override */
  async _prepareContext() {
    const actor = this.actor;
    const isGM = game.user.isGM;
    const user = playerOf(actor);
    const ledger = ledgerOf(user);
    const totals = legacyTotals(ledger);
    const rates = legacyRates();
    const priors = user
      ? game.actors.filter((a) => a.type === "character" && a.id !== actor.id && a.testUserPermission(user, "OWNER"))
      : [];
    const will = actor.getFlag(MODULE_ID, FLAG_WILL) ?? {};
    const settle = rates.bankFee == null ? null : settleEstate(will.estateGp, rates.bankFee);
    return {
      isGM,
      canWill: actor.isOwner,
      actorName: actor.name,
      player: user ? { id: user.id, name: user.name } : null,
      players: isGM ? game.users.filter((u) => !u.isGM).map((u) => ({ id: u.id, name: u.name, selected: u.id === user?.id })) : [],
      imported: rates.reserve != null && rates.funeral != null,
      rates,
      fund: totals.fund,
      funerals: totals.funerals,
      entries: [...(ledger.entries ?? [])].reverse().map((e) => ({
        ...e,
        kindLabel: loc(`kind.${e.kind}`),
        claimed: e.claimedBy?.name ?? "",
      })),
      starts: [...(ledger.starts ?? [])].reverse(),
      priors: priors.map((a) => {
        const s = startingXp(ledger, a.system?.details?.xp?.value);
        return { uuid: a.uuid, label: loc("priorOption", { name: a.name, xp: Number(a.system?.details?.xp?.value) || 0, grant: s.xp }) };
      }),
      heirs: game.actors
        .filter((a) => a.type === "character" && a.id !== actor.id)
        .map((a) => ({ uuid: a.uuid, name: a.name, selected: a.uuid === will.heirUuid })),
      will: { estateGp: will.estateGp ?? 0, note: will.note ?? "", heirName: will.heirName ?? "", settled: will.settled ?? null },
      settle,
    };
  }

  /** The value of the named control inside the pressed button's section. */
  #read(target, name) {
    const scope = target.closest("[data-legacy-section]") ?? this.element;
    const el = scope.querySelector(`[name="${name}"]`);
    if (!el) return null;
    return el.type === "checkbox" ? el.checked : el.value;
  }

  static async #onRecord(_event, target) {
    const kind = target.dataset.kind;
    const entry = await recordLegacy(this.actor, {
      kind,
      gp: this.#read(target, "gp"),
      note: this.#read(target, "note"),
      pay: this.#read(target, "pay"),
    });
    if (entry) this.render();
  }

  static async #onDeleteEntry(_event, target) {
    if (await deleteLegacyEntry(playerOf(this.actor), target.dataset.entryId)) this.render();
  }

  static async #onStart(_event, target) {
    const prior = await fromUuid(this.#read(target, "prior") ?? "");
    if (await startFromLegacy(this.actor, prior)) this.render();
  }

  static async #onSaveWill(_event, target) {
    const ok = await saveWill(this.actor, {
      heirUuid: this.#read(target, "heir"),
      estateGp: this.#read(target, "estate"),
      note: this.#read(target, "willNote"),
    });
    if (ok) this.render();
  }

  static async #onSettleWill() {
    if (await settleWill(this.actor)) this.render();
  }

  static async #onSetPlayer(_event, target) {
    const id = this.#read(target, "player");
    if (!game.user.isGM || !id) return;
    await this.actor.setFlag(MODULE_ID, FLAG_LEGACY_PLAYER, id);
    this.render();
  }
}
