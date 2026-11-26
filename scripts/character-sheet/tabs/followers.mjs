/* global game */
/**
 * The Followers tab's data: the employer's hirelings as Follower Cards —
 * the system's character henchmen and this module's monster henchmen in the
 * same buckets the henchmen feature's grid uses — with the roster chip and
 * the wage line beside them. The wage line reads the wage engine's bill, so
 * it names what the Pay control beside it would pay, and with nothing to pay
 * the days until there is.
 */
import { MODULE_ID, LANG } from "../constants.mjs";
import { makeLoc } from "../../lib/util.mjs";
import { renderFollowerCard } from "../../lib/follower-card.mjs";
import { wageBill } from "../../henchmen/engine/events.mjs";
import { serviceNodes, serviceReads } from "../../henchmen/engine/service-tree.mjs";
import { daysUntil } from "../../henchmen/time.mjs";
import { ACTOR_TYPE } from "../../lib/vocab.mjs";

const loc = makeLoc(LANG);

/**
 * The figures `actor`'s wage line reads, as one string: what is due, and the
 * days until more is. Two that are equal draw the same line and the same
 * Pay control.
 */
export function wageLineKey(actor) {
  const bill = wageBill(actor);
  return `${bill.due}|${bill.nextDue == null ? "" : daysUntil(bill.nextDue)}`;
}

/** The views of the tab, in the order its switch draws them: the flat cards, the tree by who serves whom, and the places. */
export const FOLLOWERS_VIEWS = Object.freeze(["cards", "chart", "locations"]);

/**
 * Whether a lord has a follower to draw by who serves whom or by place: the service
 * nodes (`serviceNodes`) hold something besides the lord itself, which is the root.
 * @param {{key: string}[]} nodes
 * @returns {boolean}
 */
export function hasServiceFollowers(nodes) {
  return (nodes ?? []).length > 1;
}

/**
 * The view the tab draws: the kept choice where it names a view and there is something to
 * show it with, else the cards. A choice kept while a view was possible falls back to the
 * cards once the last follower is gone, so the tab is never left on a view with no switch.
 * @param {string} [choice]
 * @param {{key: string}[]} nodes
 * @returns {"cards"|"chart"|"locations"}
 */
export function followersViewOf(choice, nodes) {
  return hasServiceFollowers(nodes) && FOLLOWERS_VIEWS.includes(choice) ? choice : "cards";
}

/**
 * The switch's buttons, one per view, the current one pressed; null where the lord has
 * nothing to draw but the cards and the switch is not drawn.
 * @param {string} view the view in use (`followersViewOf`)
 * @param {{key: string}[]} nodes
 * @returns {{label: string, buttons: {key: string, label: string, tip: string, on: boolean}[]}|null}
 */
export function followersSwitch(view, nodes) {
  if (!hasServiceFollowers(nodes)) return null;
  return {
    label: loc("followers.view.label"),
    buttons: FOLLOWERS_VIEWS.map((key) => ({ key, label: loc(`followers.view.${key}`), tip: loc(`followers.view.${key}Tip`), on: key === view })),
  };
}

/**
 * Build the tab's data (async: the cards render through a template).
 * @param {Actor} actor
 * @param {{view?: string, nodes?: object[], reads?: ReturnType<typeof serviceReads>}} [options] the kept view choice, the lord's service nodes (which the sheet reads once for both this and the lib view it draws) and the memo of hireling reads those nodes came from, so the lord's hirelings are read once for the render
 */
export async function buildFollowersTab(actor, { view = "cards", reads = serviceReads(), nodes = serviceNodes(actor, reads) } = {}) {
  const current = followersViewOf(view, nodes);
  const buckets = reads.buckets(actor);
  const defs = [
    { key: "henchmen", title: game.i18n.localize("ACKS-HENCHMEN.bucket.henchmen"), list: buckets.henchmen },
    { key: "mercenaries", title: game.i18n.localize("ACKS-HENCHMEN.bucket.mercenaries"), list: buckets.mercenaries },
    { key: "specialists", title: game.i18n.localize("ACKS-HENCHMEN.bucket.specialists"), list: buckets.specialists },
  ].filter((g) => g.list.length);

  const groups = [];
  for (const g of defs) {
    const cards = await Promise.all(
      g.list.map(async (h) => {
        let html = "";
        try {
          // The card draws the employer's controls itself (dismissal, the two
          // throws) for an owner; Show for every seat.
          html = await renderFollowerCard(h, { editable: false, controls: actor.isOwner });
        } catch (err) {
          console.warn(`${MODULE_ID} | follower card failed for ${h.name}`, err);
        }
        return { id: h.id, name: h.name, img: h.img, isMonster: h.type === ACTOR_TYPE.monster, html };
      }),
    );
    groups.push({ key: g.key, title: g.title, cards });
  }
  const count = groups.reduce((n, g) => n + g.cards.length, 0);
  const bill = wageBill(actor);
  return {
    view: current,
    showCards: current === "cards",
    showChart: current === "chart",
    showLocations: current === "locations",
    switch: followersSwitch(current, nodes),
    groups,
    count,
    payroll: count > 0 || bill.monthly > 0,
    wages: bill.monthly,
    due: bill.due,
    nextDueDays: bill.nextDue == null ? null : daysUntil(bill.nextDue),
    editable: actor.isOwner,
    isRetainer: !!actor.system?.retainer?.enabled,
    emptyHint: loc("followers.empty"),
  };
}
