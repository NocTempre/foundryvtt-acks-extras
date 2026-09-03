/* global game */
/**
 * The Followers tab's data: the employer's hirelings as Follower Cards —
 * the system's character henchmen and this module's monster henchmen in the
 * same buckets the henchmen feature's grid uses — with the roster chip and
 * the wage line beside them.
 */
import { MODULE_ID, LANG } from "../constants.mjs";
import { makeLoc } from "../../lib/util.mjs";
import { renderFollowerCard } from "../../lib/follower-card.mjs";
import { FLAG_MONSTER_LIST } from "../../henchmen/constants.mjs";
import { ACTOR_TYPE } from "../../lib/vocab.mjs";

const loc = makeLoc(LANG);

/** Build the tab's data (async: the cards render through a template). */
export async function buildFollowersTab(actor) {
  // Core's getHirelings returns duplicated snapshots; resolve each to its live document.
  const live = (h) => game.actors.get(h?._id ?? h?.id) ?? null;
  const raw = actor.getHirelings?.() ?? {};
  const buckets = Object.fromEntries(Object.entries(raw).map(([k, list]) => [k, (list ?? []).map(live).filter(Boolean)]));
  const monsters = (actor.getFlag(MODULE_ID, FLAG_MONSTER_LIST) ?? [])
    .map((id) => game.actors.get(id))
    .filter((a) => a && a.type === ACTOR_TYPE.monster);
  const defs = [
    { key: "henchmen", title: game.i18n.localize("ACKS-HENCHMEN.bucket.henchmen"), list: [...(buckets.henchman ?? []), ...monsters] },
    { key: "mercenaries", title: game.i18n.localize("ACKS-HENCHMEN.bucket.mercenaries"), list: buckets.mercenary ?? [] },
    { key: "specialists", title: game.i18n.localize("ACKS-HENCHMEN.bucket.specialists"), list: buckets.specialist ?? [] },
  ].filter((g) => g.list.length);

  const groups = [];
  for (const g of defs) {
    const cards = await Promise.all(
      g.list.map(async (h) => {
        let html = "";
        try {
          html = await renderFollowerCard(h, { editable: false });
        } catch (err) {
          console.warn(`${MODULE_ID} | follower card failed for ${h.name}`, err);
        }
        return { id: h.id, name: h.name, img: h.img, isMonster: h.type === ACTOR_TYPE.monster, html };
      }),
    );
    groups.push({ key: g.key, title: g.title, cards });
  }
  const count = groups.reduce((n, g) => n + g.cards.length, 0);
  return {
    groups,
    count,
    wages: actor.getTotalWages?.() ?? 0,
    editable: actor.isOwner,
    isRetainer: !!actor.system?.retainer?.enabled,
    emptyHint: loc("followers.empty"),
  };
}
