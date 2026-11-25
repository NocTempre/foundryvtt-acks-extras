/* global game, Hooks, fromUuidSync, foundry, CONST */
/**
 * The "In reach of" strip a body reads on its own sheet (canvas 4, board 4c),
 * for the character sheet and the monster sheet alike. One row per reach an
 * item's bearer holds over the body's token on the scene this window views:
 * the item, its state (a save owed, one waiting for the body's moment, a
 * failed one, always on, or immune with the turns left), the source token's
 * name as core shows it to the viewer, the distance between the two tokens'
 * nearest edges, the reach, and the save's press. The strip is absent where
 * nothing reaches the body, and for a seat that does not own the body.
 *
 * - `reachStripFor(actor)` is the sheet's context entry; the template is
 *   `templates/lib/item-reach-strip.hbs`.
 * - A Save press is offered by ownership of the body's token (Foundry's own
 *   test, no role read), writes through the carrier's `pressRoll` onto the same
 *   moment-keyed entry the cards write, and is checked again by the primary
 *   GM's window on the relayed seat.
 * - A card change, a token's move or a Region's change re-renders the open
 *   sheets the strip could be on (`installItemRunStrip`).
 */
import { FLAG_ITEM_RUN, FLAG_ROLL_MODS, LANG_PREFIX, MODULE_ID, AURA_BEHAVIOR_TYPE, FLAG_ITEM_RUN_CARD } from "./constants.mjs";
import { figureNumber, readAuraConfig, readReach, reachAdmits } from "./aura-reach-logic.mjs";
import { behaviorsUnder } from "./regions.mjs";
import { itemCite, itemRunRowsOf, kindKeyOf } from "./item-run-logic.mjs";
import { blankTip, importTip, rowStateOf, safeKey, shownTokenName, stripModel, turnsLeft } from "./item-run-card-logic.mjs";
import { cardOf, pressRoll } from "./item-run.mjs";
import { messageIdFor, refusal, saveFigureOf } from "./item-run-presenter.mjs";
import { tokenEdgeGapFeet } from "./distance-units.mjs";
import { citeOf } from "./tables.mjs";
import { isMarkerActor } from "./place.mjs";
import { turnSeconds } from "./time-unit.mjs";
import { makeLoc } from "./util.mjs";

const loc = makeLoc(LANG_PREFIX);
const signed = (n) => `${n >= 0 ? "+" : "−"}${Math.abs(n)}`;

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
function radiusFigure(reach, item) {
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
  const bearerToken = region?.parent?.tokens?.get?.(region.attachment?.token) ?? null;
  if (!reach || !bearerToken || bearerToken.id === token.id || isMarkerActor(actor)) return null;
  const admitted = reachAdmits({ token: bearerToken, actor: bearerToken.actor }, { token, actor }, reach.filter, { isMarker: isMarkerActor });
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
  const out = { key: `${config.activationId}:${row.key}`, name: item.name, tag: "waiting", source, feet, radius, radiusTip, cite, feetTip: feet === null ? "" : loc("itemRun.card.tip.distance", { feet, name: source }) };

  const immune = immunityOf(actor, kindKey);
  if (immune) {
    const left = turnsLeft(immune.dueAt, game.time?.worldTime, turnSeconds());
    return { ...out, tag: "immune", left, leftTip: left === null ? "" : [item.name, loc("itemRun.strip.tip.window", { turns: left }), cite].filter(Boolean).join(" · ") };
  }
  if (reach.pulse === "standing") {
    const value = figureNumber(reach.modifier);
    const rolls = reach.on.map((key) => loc(`itemRun.strip.on.${key}`)).join(", ");
    const pieces = [item.name, loc("itemRun.strip.tip.from", { source }), feet === null ? "" : loc("itemRun.strip.tip.away", { feet }), radius === null ? "" : loc("itemRun.strip.tip.reach", { radius }), value === null ? "" : `${rolls} ${signed(value)}`, cite];
    return { ...out, tag: "always", part: value === null ? null : { value: signed(value), rolls, tip: pieces.filter(Boolean).join(" · ") } };
  }
  const messageId = messageIdFor(config.activationId);
  const card = messageId ? cardOf(messageId).card : null;
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
  const reaches = behaviorsUnder(token, AURA_BEHAVIOR_TYPE).map((found) => readReachOn(found, token, actor)).filter(Boolean);
  const strip = stripModel(reaches);
  if (!strip.count) return null;
  return {
    title: loc("itemRun.strip.title"),
    hint: loc("itemRun.strip.hint", { count: strip.count }),
    count: strip.count,
    saveLabel: loc("itemRun.card.save"),
    saveTip: loc("itemRun.card.saveTip"),
    rows: strip.rows.map((r) => ({
      ...r, tagLabel: loc(`itemRun.strip.tag.${r.tag}`), tagVariant: TAGS[r.tag], tagTip: loc(`itemRun.strip.tagTip.${r.tag}`),
      leftLabel: r.left === null ? "" : loc("itemRun.strip.left", { turns: r.left }), hasFeet: r.feet !== null, hasRadius: r.radius !== null, hasTarget: r.target !== null,
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

/** Re-render the open actor sheets whose body stands among `tokenUuids`, or every open actor sheet where none are named. */
function refreshSheets(tokenUuids = null) {
  for (const app of foundry.applications.instances?.values?.() ?? []) {
    const doc = app?.document;
    if (!app?.rendered || doc?.documentName !== "Actor") continue;
    const mine = doc.isToken ? [doc.token?.uuid] : (doc.getActiveTokens?.(false, true) ?? []).map((t) => t.uuid);
    if (tokenUuids && !mine.some((uuid) => tokenUuids.has(uuid))) continue;
    app.render();
  }
}

let installed = false;

/** Register the hooks that keep an open sheet's strip current: a raised card's change, a token's move and a Region's making or lifting. */
export function installItemRunStrip() {
  if (installed) return;
  installed = true;
  Hooks.on("updateChatMessage", (message) => {
    const card = message?.flags?.[MODULE_ID]?.[FLAG_ITEM_RUN_CARD];
    if (card) refreshSheets(new Set(Object.values(card.subjects ?? {}).map((s) => s.uuid)));
  });
  Hooks.on("updateToken", (token, change) => {
    if (["x", "y", "width", "height", "hidden"].some((key) => key in (change ?? {}))) refreshSheets();
  });
  for (const name of ["createRegion", "deleteRegion", "updateRegion"]) Hooks.on(name, () => refreshSheets());
}
