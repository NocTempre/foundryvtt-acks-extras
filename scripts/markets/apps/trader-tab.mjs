/* global game, ui, foundry, fromUuid */
/**
 * The Trade tab on the character sheet, for a trader (the magic-tab precedent:
 * the sheet owns the tab strip and one mount line per hook; markets owns what
 * the tab prepares and every handler behind its buttons).
 *
 * Two sections. Research lists the character's market reports and their
 * party's, grouped by market, with Open, Give to and Discard. Compare sets two
 * markets' believed demand side by side. Both read reports only: a belief, never
 * the market's true demand. Routes and holdings are not built.
 *
 * A player sees the tab on a character they own; the Judge sees it on every
 * character, which is where the Judge marks one a trader.
 */
import { MODULE_ID, LANG, ITEM_FLAG, TRADER_FLAG } from "../constants.mjs";
import { ITEM_TYPE, ACTOR_TYPE } from "../../lib/vocab.mjs";
import { makeLoc } from "../../lib/util.mjs";
import { hasEffectFlag } from "../../henchmen/effects.mjs";
import { partyOf, partyMembers } from "../engine/parties.mjs";
import { merchandiseFor } from "../engine/merchandise.mjs";
import { objectsOf, allReports, plainReport, performGive, performRetire } from "../engine/trade-objects.mjs";
import { beliefsFor, compareBeliefs, groupByMarket, heldByParty, isTraderProfile } from "../rules/reports.mjs";
import { resolveActorSync } from "../../lib/storage.mjs";
import { outcomeLabel, reportDay, ownsReport } from "./report-sheet.mjs";

const loc = makeLoc(LANG);
const signed = (n) => (n > 0 ? `+${n}` : `${n}`);
const goodName = (category) => merchandiseFor(category)?.label ?? category;

/** Dialog classes every prompt this tab opens carries (the scroll contract). */
const DIALOG_CLASSES = ["acks-ui", "acks-extras", "acks-extras-scroll"];

/**
 * Is this character a trader? Any of: a Bargaining ability, a merchant
 * Profession, the Mercantile Network effect (read as the henchmen feature's
 * market-class shift reads it), a report of their own on the trade house, or
 * the Judge's flag on the actor.
 * @param {Actor} actor
 * @returns {boolean}
 */
export function isTrader(actor) {
  if (!actor) return false;
  return isTraderProfile({
    abilityNames: [...(actor.items ?? [])].filter((i) => i.type === ITEM_TYPE.ability).map((i) => i.name),
    hasNetwork: hasEffectFlag(actor, "marketClass"),
    ownsReport: objectsOf(actor.uuid).length > 0,
    flagged: !!actor.getFlag?.(MODULE_ID, ITEM_FLAG)?.[TRADER_FLAG],
  });
}

/**
 * Does the viewer's sheet for this character carry the Trade tab? The Judge
 * always; anyone else only on a trader they own.
 * @param {Actor} actor
 * @returns {boolean}
 */
export const traderTabShown = (actor) => game.user.isGM || (actor.isOwner && isTrader(actor));

/** The characters a report can be handed to: the actor's party, the actor excepted. */
function giveTargets(actor) {
  return partyMembers(partyOf(actor).id).filter((a) => a.type === ACTOR_TYPE.character && a.uuid !== actor.uuid);
}

/**
 * Everything the Trade tab renders.
 * @param {Actor} actor
 * @param {object} [state]
 * @param {{a?: string, b?: string}|null} [state.compare]  The two markets picked in Compare.
 */
export function buildTraderTab(actor, { compare = null } = {}) {
  const isGM = game.user.isGM;
  const partyId = partyOf(actor).id;
  const who = { partyId, memberUuids: [...partyMembers(partyId).map((a) => a.uuid), actor.uuid] };

  // The character's own reports and every other report their party holds.
  const mine = new Map(objectsOf(actor.uuid).map((item) => [item.uuid, item]));
  for (const item of allReports()) if (!mine.has(item.uuid) && heldByParty(plainReport(item), who)) mine.set(item.uuid, item);
  const items = [...mine.values()];
  const plainRows = items.map(plainReport);

  const groups = groupByMarket(plainRows).map((group) => ({
    marketUuid: group.marketUuid,
    marketName: group.marketName,
    reports: group.reports.map((r) => {
      const item = items.find((i) => i.uuid === r.uuid);
      return {
        uuid: r.uuid,
        when: reportDay(r.time),
        assessorName: resolveActorSync(r.assessorUuid)?.name ?? "",
        ownerName: r.ownerName,
        outcomeLabel: outcomeLabel(r.outcome, isGM),
        count: r.beliefs.length,
        beliefs: r.beliefs.map((b) => ({ label: goodName(b.category), dm: signed(b.dm) })),
        // The Judge always may; a player only on a report stamped to a character they own.
        canManage: !!item && ownsReport(item),
      };
    }),
  }));

  const markets = groups.filter((g) => g.marketUuid).map((g) => ({ uuid: g.marketUuid, name: g.marketName }));
  const pick = (side) => (markets.some((m) => m.uuid === compare?.[side]) ? compare[side] : "");
  const a = pick("a");
  const b = pick("b");
  const beliefsAt = (uuid) => beliefsFor(plainRows, { ...who, marketUuid: uuid });
  const options = (chosen) => markets.map((m) => ({ ...m, selected: m.uuid === chosen }));
  const rows = a && b ? compareBeliefs(beliefsAt(a), beliefsAt(b)) : [];

  return {
    isGM,
    flagged: !!actor.getFlag(MODULE_ID, ITEM_FLAG)?.[TRADER_FLAG],
    hasResearch: groups.length > 0,
    groups,
    compare: {
      available: markets.length >= 2,
      optionsA: options(a),
      optionsB: options(b),
      ready: !!(a && b),
      nameA: markets.find((m) => m.uuid === a)?.name ?? "",
      nameB: markets.find((m) => m.uuid === b)?.name ?? "",
      rows: rows.map((r) => ({
        label: goodName(r.category),
        a: r.a === null ? "—" : signed(r.a),
        b: r.b === null ? "—" : signed(r.b),
        diff: r.diff === null ? "—" : signed(r.diff),
      })),
    },
  };
}

/**
 * Wire the controls a click action cannot reach: the two Compare pickers store
 * their choice on the sheet and re-render. The change is kept from the sheet's
 * submit-on-change form, which has nothing to save from it.
 * @param {Application} sheet  The character sheet, after a render.
 */
export function bindTraderTab(sheet) {
  for (const picker of sheet.element?.querySelectorAll("[data-trader-compare]") ?? []) {
    picker.addEventListener("change", (event) => {
      event.stopPropagation();
      sheet._traderCompare = { ...(sheet._traderCompare ?? {}), [picker.dataset.traderCompare]: picker.value };
      sheet.render();
    });
  }
}

/** The report a control names, or null. */
async function reportOf(target) {
  const item = await fromUuid(target?.dataset?.uuid).catch(() => null);
  return item ?? null;
}

/** Report what a hand-over came back with: an error warns; no answer means it was relayed. */
function reportResult(result, successMessage) {
  if (result?.error) ui.notifications.warn(loc(`report.error.${result.error}`));
  else if (result?.ok) ui.notifications.info(successMessage);
}

/**
 * The Trade tab's action handlers, keyed by their `data-action` names. Each is
 * invoked by AppV2 with the character sheet as `this`.
 */
export const TRADER_TAB_ACTIONS = {
  /** Open a report's sheet. */
  async traderOpen(_event, target) {
    (await reportOf(target))?.sheet?.render(true);
  },

  /** Hand a report to a character of this character's party. */
  async traderGive(_event, target) {
    const item = await reportOf(target);
    const targets = giveTargets(this.actor);
    if (!item) return;
    if (!targets.length) {
      ui.notifications.warn(loc("trader.noTargets"));
      return;
    }
    const options = targets.map((t) => `<option value="${t.uuid}">${foundry.utils.escapeHTML(t.name)}</option>`).join("");
    const chosen = await foundry.applications.api.DialogV2.prompt({
      classes: DIALOG_CLASSES,
      window: { title: loc("trader.giveTitle") },
      content: `<label class="form-group"><span>${loc("trader.giveTo")}</span><select name="to">${options}</select></label>`,
      ok: { label: loc("trader.give"), callback: (_ev, button) => button.form.elements.to.value },
    }).catch(() => null);
    const recipient = chosen ? targets.find((t) => t.uuid === chosen) : null;
    if (!recipient) return;
    reportResult(await performGive(item, recipient), loc("trader.given", { name: recipient.name }));
  },

  /** Discard a report, after a confirmation. */
  async traderDiscard(_event, target) {
    const item = await reportOf(target);
    if (!item) return;
    const sure = await foundry.applications.api.DialogV2.confirm({
      classes: DIALOG_CLASSES,
      window: { title: loc("trader.discardTitle") },
      content: `<p>${loc("trader.discardBody")}</p>`,
      rejectClose: false,
    }).catch(() => false);
    if (!sure) return;
    reportResult(await performRetire(item), loc("trader.discarded"));
  },

  /** GM: mark this character a trader (or not), so the tab is theirs. */
  async traderFlag() {
    if (!game.user.isGM) return;
    const current = !!this.actor.getFlag(MODULE_ID, ITEM_FLAG)?.[TRADER_FLAG];
    await this.actor.update({ [`flags.${MODULE_ID}.${ITEM_FLAG}.${TRADER_FLAG}`]: !current });
  },
};
