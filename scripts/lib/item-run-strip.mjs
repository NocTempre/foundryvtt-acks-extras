/* global game, Hooks, fromUuidSync, foundry, CONST */
/**
 * The "In reach of" strip a body reads on its own sheet (canvas 4, board 4c),
 * for the character sheet and the monster sheet alike. One row per reach an
 * item's bearer holds over the body's token on the scene this window views:
 * the item, its state (a save owed, one waiting for the body's moment, a
 * failed one, always on, or immune with the turns left), the source token's
 * name as core shows it to the viewer, the distance between the two tokens'
 * nearest edges, the reach, and the save's press; an engaged row also reads
 * "and n more" where other bearers of its kind cover the body, the tooltip
 * naming them as the viewer is shown them. The strip is absent where
 * nothing reaches the body, and for a seat that does not own the body.
 *
 * - `reachStripFor(actor)` is the sheet's context entry; the template is
 *   `templates/lib/item-reach-strip.hbs`.
 * - An always-on engaged reach (T10) has no raised card: its row reads the open
 *   entry the engaged card holds for this body and kind (owed, with the Save
 *   press on that card's entry), else the failed save's `lasts` record on the
 *   body (failed, with the turns left), else the immunity window (immune), else
 *   waits. Bearers of one kind collapse to one row, the nearest bearer's, with
 *   the count of the others (`more`); only engaged reaches collapse.
 * - A Save press is offered by ownership of the body's token (Foundry's own
 *   test, no role read), writes through the carrier's `pressRoll` onto the same
 *   moment-keyed entry the cards write, and is checked again by the primary
 *   GM's window on the relayed seat.
 * - A card change re-renders the open sheets of the bodies it lists. A token's
 *   move on a scene that holds a reach, or a reach Region's change, re-renders
 *   once per burst the character and monster sheets whose body has a token on
 *   that scene, which are the sheets that read the strip and the gear rows'
 *   ring counts (`installItemRunStrip`).
 */
import { FLAG_ITEM_RUN, FLAG_ROLL_MODS, LANG_PREFIX, MODULE_ID, AURA_BEHAVIOR_TYPE, FLAG_ITEM_RUN_CARD } from "./constants.mjs";
import { figureNumber, isEngagedActivation, readAuraConfig, readReach, reachAdmits } from "./aura-reach-logic.mjs";
import { attachedToken, behaviorsUnder } from "./regions.mjs";
import { itemCite, itemRunRowsOf, kindKeyOf, lastsRecordId } from "./item-run-logic.mjs";
import { admittedWithCount, blankTip, cardSubjectUuids, importTip, openEngagedEntryFor, rowStateOf, safeKey, shownTokenName, signedFigure, stripModel, turnsLeft } from "./item-run-card-logic.mjs";
import { cardOf, pressRoll } from "./item-run.mjs";
import { messageIdFor, refusal, saveFigureOf } from "./item-run-presenter.mjs";
import { tokenEdgeGapFeet } from "./distance-units.mjs";
import { citeOf } from "./tables.mjs";
import { isMarkerActor } from "./place.mjs";
import { turnSeconds } from "./time-unit.mjs";
import { makeLoc } from "./util.mjs";
// reach-glyph.mjs imports this file back; the binding is read only inside hook callbacks, after both modules have loaded.
import { sceneHasReach } from "./reach-glyph.mjs";

const loc = makeLoc(LANG_PREFIX);

/** The body's token on the scene this window views: a synthetic actor's own, else the first on the canvas. */
const viewedToken = (actor) => (actor?.isToken ? actor.token : (actor?.getActiveTokens?.(false, true)?.[0] ?? null));

/** The tag words and the variant each wears, by state. */
const TAGS = Object.freeze({ owed: "danger", waiting: "ghost", failed: "danger", always: "ghost", immune: "solid" });

/** The effect on an actor that grants immunity to an item kind, with its `itemRun.dueAt`, or null. */
function immunityOf(actor, kindKey) {
  for (const effect of actor?.effects ?? []) {
    const parts = effect.flags?.[MODULE_ID]?.[FLAG_ROLL_MODS]?.parts;
    if (effect.disabled || !Array.isArray(parts)) continue;
    if (parts.some((p) => p?.on === "immune" && Array.isArray(p.spells) && p.spells.includes(kindKey))) return { effect, dueAt: effect.flags?.[MODULE_ID]?.[FLAG_ITEM_RUN]?.dueAt ?? null };
  }
  return null;
}

/** The tooltip and page of a reach's radius: the imported table's row where it read one, else the item's own page alone. */
export function radiusFigure(reach, item) {
  const radius = figureNumber(reach.radius);
  const ref = reach.radius ?? {};
  const cite = (ref.doc && ref.table ? citeOf(ref.doc, ref.table) : null) ?? itemCite(item);
  const tip = radius === null ? blankTip({ cite }) : importTip({ label: item.name, figure: `${radius}′`, cite });
  return { radius, tip: tip ?? "" };
}

/** The state, press and figures one reach holds over the body's token, or null where the reach does not name it. */
function readReachOn({ behavior, region }, token, actor) {
  const config = readAuraConfig(behavior.system);
  const item = config ? fromUuidSync(config.sourceUuid) : null;
  const row = itemRunRowsOf(item).find((r) => r?.key === config?.rowKey);
  const reach = readReach(row?.reach);
  const bearerToken = attachedToken(region);
  if (!reach || !bearerToken || bearerToken.id === token.id || isMarkerActor(actor)) return null;
  const engaged = isEngagedActivation(config.activationId);
  // An always-on engaged reach raises no card: its prompts live on the engaged card of the subject's moment, found by subject and kind below.
  const messageId = engaged ? null : messageIdFor(config.activationId);
  const card = messageId ? cardOf(messageId).card : null;
  const admitted = admittedWithCount(reachAdmits({ token: bearerToken, actor: bearerToken.actor }, { token, actor }, reach.filter, { isMarker: isMarkerActor }), card, token.uuid);
  if (admitted !== true) return null;
  const kindKey = kindKeyOf(item, row);
  const shown = shownTokenName(
    { name: bearerToken.name, displayName: bearerToken.displayName, isOwner: bearerToken.testUserPermission?.(game.user, "OWNER") === true, isSecret: bearerToken.isSecret === true },
    CONST.TOKEN_DISPLAY_MODES,
  );
  const source = shown ?? loc("itemRun.strip.unseen");
  const gap = tokenEdgeGapFeet(bearerToken, token);
  const feet = gap === null ? null : Math.round(gap);
  const { radius, tip: radiusTip } = radiusFigure(reach, item);
  const cite = itemCite(item);
  const out = { key: `${config.activationId}:${row.key}`, engagedKind: engaged ? kindKey : "", bearerId: bearerToken.id, name: item.name, tag: "waiting", source, feet, radius, radiusTip, cite, feetTip: feet === null ? "" : loc("itemRun.card.tip.distance", { feet, name: source }) };

  const windowTip = (left) => (left === null ? "" : [item.name, loc("itemRun.strip.tip.window", { turns: left }), cite].filter(Boolean).join(" · "));
  const immune = immunityOf(actor, kindKey);
  if (immune) {
    const left = turnsLeft(immune.dueAt, game.time?.worldTime, turnSeconds());
    return { ...out, tag: "immune", left, leftTip: windowTip(left) };
  }
  if (engaged) {
    const asked = openEngagedEntryFor(game.messages, { subjectUuid: token.uuid, kindKey });
    if (asked) {
      // The entry names the item, row and activation it was asked of (the nearest bearer's may be another bearer's of the same kind), and the carrier's press accepts an engaged card only on the entry's own item.
      const { itemUuid, rowKey, activationId } = { itemUuid: item.uuid, rowKey: row.key, activationId: config.activationId, ...asked.entry };
      const askedItem = fromUuidSync(itemUuid) ?? item;
      const figure = saveFigureOf(actor, itemRunRowsOf(askedItem).find((r) => r?.key === rowKey) ?? row, askedItem);
      const owns = token.testUserPermission?.(game.user, "OWNER") === true;
      return {
        ...out, tag: "owed", target: figure.target, targetTip: figure.tip ?? "",
        press: owns ? { itemUuid, rowKey, activationId, subject: token.uuid, messageId: asked.messageId, entryKey: asked.entryKey } : null,
      };
    }
    const lasts = actor?.effects?.get?.(lastsRecordId(kindKey)) ?? null;
    if (!lasts) return out;
    const left = turnsLeft(lasts.flags?.[MODULE_ID]?.[FLAG_ITEM_RUN]?.dueAt, game.time?.worldTime, turnSeconds());
    return { ...out, tag: "failed", timed: true, left, leftTip: windowTip(left) };
  }
  if (reach.pulse === "standing") {
    const value = figureNumber(reach.modifier);
    const rolls = reach.on.map((key) => loc(`itemRun.strip.on.${key}`)).join(", ");
    const pieces = [item.name, loc("itemRun.strip.tip.from", { source }), feet === null ? "" : loc("itemRun.strip.tip.away", { feet }), radius === null ? "" : loc("itemRun.strip.tip.reach", { radius }), value === null ? "" : `${rolls} ${signedFigure(value)}`, cite];
    return { ...out, tag: "always", part: value === null ? null : { value: signedFigure(value), rolls, tip: pieces.filter(Boolean).join(" · ") } };
  }
  const state = card ? rowStateOf(card, token.uuid) : "waiting";
  const entryKey = card?.subjects?.[safeKey(token.uuid)]?.latest ?? "";
  const entry = card?.entries?.[entryKey] ?? null;
  if (state === "applied" && entry?.saved === false) return { ...out, tag: "failed" };
  if (state !== "open") return out;
  const figure = saveFigureOf(actor, row, item);
  const owns = token.testUserPermission?.(game.user, "OWNER") === true;
  return {
    ...out, tag: "owed", target: figure.target, targetTip: figure.tip ?? "",
    press: owns ? { itemUuid: item.uuid, rowKey: row.key, activationId: config.activationId, subject: token.uuid, messageId, entryKey } : null,
  };
}

/**
 * One engaged kind's rows as the single row the body reads: the nearest bearer's
 * (the first on a tie), carrying `more` and `moreNames` where other bearers of
 * the kind cover the body too. A bearer counts once however many Regions or items
 * of the kind it holds, and the nearest bearer is never counted among the rest.
 */
function collapsedKind(group) {
  const nearest = group.reduce((best, r) => ((r.feet ?? Infinity) < (best.feet ?? Infinity) ? r : best));
  const others = new Map();
  for (const r of [...group].sort((a, b) => (a.feet ?? Infinity) - (b.feet ?? Infinity))) {
    if (r.bearerId !== nearest.bearerId && !others.has(r.bearerId)) others.set(r.bearerId, r.source);
  }
  return others.size ? { ...nearest, more: others.size, moreNames: [...others.values()] } : nearest;
}

/** Each bearer of an engaged kind holds a Region of its own over the body, but the body is asked once per kind: those rows collapse to the nearest bearer's, and every other row stands (a raised or standing reach is one row per reach, never collapsed). */
function oneRowPerEngagedKind(rows) {
  const groups = new Map();
  for (const r of rows) if (r.engagedKind) groups.set(r.engagedKind, [...(groups.get(r.engagedKind) ?? []), r]);
  const out = [];
  const placed = new Set();
  for (const r of rows) {
    if (!r.engagedKind) { out.push(r); continue; }
    if (placed.has(r.engagedKind)) continue;
    placed.add(r.engagedKind);
    out.push(collapsedKind(groups.get(r.engagedKind)));
  }
  return out;
}

/**
 * The rows of the reaches that name a body's token, one per reach and one per
 * engaged kind, with no seat test: the strip and the canvas glyph's readout
 * both read them. `select` narrows the `{region, behavior}` pairs the token
 * stands in before any row is read, so a collapse to the nearest engaged bearer
 * never lets a pair the seat is not shown hide one it is.
 *
 * @param {TokenDocument} token  The body's token.
 * @param {Actor} actor  The body.
 * @param {(found: Array<{region: object, behavior: object}>) => Array<{region: object, behavior: object}>} [select]
 * @returns {object[]}
 */
export function reachRowsOn(token, actor, select = (found) => found) {
  const found = select(behaviorsUnder(token, AURA_BEHAVIOR_TYPE));
  return oneRowPerEngagedKind(found.map((pair) => readReachOn(pair, token, actor)).filter(Boolean));
}

/**
 * One reach's row as the single line the canvas readout shows: the item (and
 * its state, where `withTag`), the source and its distance, the reach and the
 * page, the standing figure. A radius left blank drops out and the page stays.
 *
 * @param {object} row  A `reachRowsOn` row.
 * @param {{withTag?: boolean}} [opts]  `withTag` adds the state and the turns left.
 * @returns {string}
 */
export function reachLineOf(row, { withTag = false } = {}) {
  const left = row.left === null || row.left === undefined ? "" : loc("itemRun.strip.left", { turns: row.left });
  const state = withTag ? [loc(`itemRun.strip.tag.${row.tag}`), left].filter(Boolean).join(" · ") : "";
  const pieces = [
    state ? `${row.name} (${state})` : row.name,
    `${row.source}${row.feet === null ? "" : `, ${row.feet}′ ${loc("itemRun.strip.away")}`}`,
    row.radius === null ? "" : `${loc("itemRun.strip.reach")} ${row.radius}′`,
    row.cite,
    row.part ? `${row.part.rolls} ${row.part.value}` : "",
    row.more > 0 ? loc("itemRun.strip.more", { n: row.more }) : "",
  ];
  return pieces.filter(Boolean).join(" · ");
}

/**
 * The strip model for a body, localized, or null where the strip is absent: the
 * seat does not own the body, the body has no token on the viewed scene, or no
 * reach names it.
 *
 * @param {Actor} actor
 * @returns {{title: string, hint: string, count: number, rows: object[]}|null}
 */
export function reachStripFor(actor) {
  if (!actor?.testUserPermission?.(game.user, "OWNER")) return null;
  const token = viewedToken(actor);
  if (!token) return null;
  const strip = stripModel(reachRowsOn(token, actor));
  if (!strip.count) return null;
  return {
    title: loc("itemRun.strip.title"),
    hint: loc("itemRun.strip.hint", { count: strip.count }),
    count: strip.count,
    saveLabel: loc("itemRun.card.save"),
    saveTip: loc("itemRun.card.saveTip"),
    rows: strip.rows.map((r) => ({
      ...r, tagLabel: loc(`itemRun.strip.tag.${r.tag}`), tagVariant: TAGS[r.tag], tagTip: loc(`itemRun.strip.tagTip.${r.timed ? "failedTimed" : r.tag}`),
      leftLabel: r.left === null ? "" : loc("itemRun.strip.left", { turns: r.left }), hasFeet: r.feet !== null, hasRadius: r.radius !== null, hasTarget: r.target !== null,
      ...(r.more > 0 ? { moreLabel: loc("itemRun.strip.more", { n: r.more }), moreTip: r.moreNames.join(", ") } : {}),
    })),
  };
}

/** The strip's Save press, from the sheet: the seat must own the body's token, and the carrier checks again on the relayed seat. */
export async function pressStripSave(button) {
  const d = button?.dataset ?? {};
  const token = fromUuidSync(d.subject ?? "");
  if (token?.testUserPermission?.(game.user, "OWNER") !== true) return refusal("notOwner");
  const out = await pressRoll({ itemUuid: d.itemUuid, rowKey: d.rowKey, activationId: d.activationId, subject: d.subject, messageId: d.messageId, entryKey: d.entryKey ?? "" });
  return out?.ok === false ? refusal(out.reason) : out;
}

/** Re-render the open actor sheets whose body stands among `tokenUuids`. */
function refreshSheets(tokenUuids) {
  for (const app of foundry.applications.instances?.values?.() ?? []) {
    const doc = app?.document;
    if (!app?.rendered || doc?.documentName !== "Actor") continue;
    const mine = doc.isToken ? [doc.token?.uuid] : (doc.getActiveTokens?.(false, true) ?? []).map((t) => t.uuid);
    if (!mine.some((uuid) => tokenUuids.has(uuid))) continue;
    app.render();
  }
}

/** The window classes of the sheets that read a body's reach: the strip, and the gear rows' ring counts. */
const READER_SHEET_CLASSES = Object.freeze(["acks-extras-character-sheet", "acks-extras-monster"]);

/** The milliseconds a burst of token moves and Region writes is gathered for before the sheets are re-rendered. */
const REACH_SETTLE_MS = 100;

/** The scenes whose reach readers wait to be re-rendered, and the timer that runs them. */
const pendingScenes = new Set();
let settleTimer = null;

/** Whether a Region holds an aura behavior, the mark of a reach. */
const isReachRegion = (region) => [...(region?.behaviors ?? [])].some((behavior) => behavior.type === AURA_BEHAVIOR_TYPE);

/** Re-render the open reader sheets whose body has a token on one of the pending scenes, then forget the scenes. */
function renderReaders() {
  settleTimer = null;
  const sceneIds = new Set(pendingScenes);
  pendingScenes.clear();
  for (const app of foundry.applications.instances?.values?.() ?? []) {
    const doc = app?.document;
    if (!app?.rendered || doc?.documentName !== "Actor" || !READER_SHEET_CLASSES.some((name) => app.options?.classes?.includes?.(name))) continue;
    const tokens = doc.isToken ? [doc.token] : (doc.getActiveTokens?.(false, true) ?? []);
    if (tokens.some((token) => sceneIds.has(token?.parent?.id))) app.render();
  }
}

/** Queue the reader sheets of a scene for one render at the end of the settle window. */
function queueReaders(scene) {
  if (!scene?.id) return;
  pendingScenes.add(scene.id);
  settleTimer ??= setTimeout(renderReaders, REACH_SETTLE_MS);
}

/** Re-render the open sheet of the actor that carries an item, by the item's uuid. */
function refreshItemSheets(itemUuid) {
  const actor = fromUuidSync(itemUuid)?.actor ?? null;
  if (!actor) return;
  for (const app of foundry.applications.instances?.values?.() ?? []) if (app?.rendered && app.document === actor) app.render();
}

let installed = false;

/** Register the hooks that keep an open sheet's strip current: a raised card's change, a token's move and a Region's making or lifting. */
export function installItemRunStrip() {
  if (installed) return;
  installed = true;
  Hooks.on("updateChatMessage", (message) => {
    const card = message?.flags?.[MODULE_ID]?.[FLAG_ITEM_RUN_CARD];
    if (!card) return;
    refreshSheets(new Set(cardSubjectUuids(card)));
    if (card.itemUuid) refreshItemSheets(card.itemUuid);
  });
  // A raised item's row on its bearer's sheet counts the card's listed bodies, and the card is posted after the write that raised the item.
  for (const name of ["createChatMessage", "deleteChatMessage"]) {
    Hooks.on(name, (message) => {
      const card = message?.flags?.[MODULE_ID]?.[FLAG_ITEM_RUN_CARD];
      if (card?.itemUuid) refreshItemSheets(card.itemUuid);
    });
  }
  // A move reaches a sheet only where its scene holds a reach; a reach Region's own change reaches it even when that was the scene's last.
  Hooks.on("updateToken", (token, change) => {
    if (["x", "y", "width", "height", "hidden"].some((key) => key in (change ?? {})) && sceneHasReach(token.parent)) queueReaders(token.parent);
  });
  for (const name of ["createRegion", "deleteRegion", "updateRegion"]) {
    Hooks.on(name, (region) => {
      if (isReachRegion(region)) queueReaders(region.parent);
    });
  }
}
