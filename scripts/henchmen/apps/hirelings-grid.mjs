/* global game, Hooks, document, foundry, globalThis, console */
/**
 * Re-skin the core character sheet's Hirelings tab as a grid of Follower Cards.
 *
 * Pure runtime DOM augmentation of the SYSTEM sheet (the acks-domains / acks-influence
 * injection pattern) — no core files are touched. The grid is built from the
 * employer's DATA (not core's rendered rows) so it can include BOTH the core
 * character henchmen (`henchmenList`, via getHirelings) and this module's monster
 * henchmen (`FLAG_MONSTER_LIST`) — a monster hireling is category "henchman", so it
 * joins the Henchmen bucket alongside the rest.
 *
 * Actions: character cards keep the system's own hireling actions
 * (hirelingShow/Loyalty/Morale/Delete), resolved through ApplicationV2's delegated
 * dispatch by the data-item-id on the card's `.item` wrapper. Monster cards can't use
 * those (delHenchman touches henchmenList, not the monster list), so their actions
 * are re-tagged to a private `acksHmMon*` prefix the system ignores and handled here.
 * Degrades to the stock list when acks-lib is too old to expose `followerCard`.
 */
import { MODULE_ID, FLAG_MONSTER_LIST, HOOKS } from "../constants.mjs";
import { openLoyaltyRoll } from "../engine/events.mjs";
import * as adapter from "../acks-adapter.mjs";
import HenchmanRecord from "../data/henchman-record.mjs";

const GRID_CLASS = "acks-henchmen-follower-grid";

async function gridifyHirelings(app, element) {
  if (game.system?.id !== "acks") return;
  const api = globalThis.acksLib?.followerCard;
  if (!api?.render) return; // older acks-lib — leave the stock list intact
  const employer = app.actor ?? app.document;
  if (employer?.type !== "character") return;
  const root = element instanceof HTMLElement ? element : element?.[0];
  const tab = root?.querySelector('.tab[data-tab="hirelings"]');
  if (!tab) return;
  const col = tab.querySelector(".flexcol") || tab;
  if (col.dataset.acksGrid) return; // claimed this render (sync, before await)
  col.dataset.acksGrid = "1";

  // Buckets from the employer: character hirelings + monster henchmen (category
  // "henchman"), so monsters appear in the list alongside the rest.
  // Core's getHirelings returns `foundry.utils.duplicate()` SNAPSHOTS, not live
  // actors: no Item collection and no prepared derived data, so a card built from
  // one shows AC 0, no encumbrance and an unarmed/improvised attack list while the
  // hireling's own sheet shows its real gear. Resolve each back to its document.
  const live = (h) => game.actors.get(h?._id ?? h?.id) ?? null;
  const rawBuckets = employer.getHirelings?.() ?? {};
  const buckets = Object.fromEntries(
    Object.entries(rawBuckets).map(([k, list]) => [k, (list ?? []).map(live).filter(Boolean)]),
  );
  const monsters = (employer.getFlag(MODULE_ID, FLAG_MONSTER_LIST) ?? [])
    .map((id) => game.actors.get(id))
    .filter((a) => a && a.type === "monster");
  const groups = [
    { title: "Henchmen", list: [...(buckets.henchman ?? []), ...monsters] },
    { title: "Mercenaries", list: buckets.mercenary ?? [] },
    { title: "Specialists", list: buckets.specialist ?? [] },
  ].filter((g) => g.list.length);
  if (!groups.length) return; // nothing to show — leave core's own empty state

  for (const s of tab.querySelectorAll(".item-list-section")) s.remove();

  for (const g of groups) {
    const head = document.createElement("div");
    head.className = "acks-henchmen-grid-head";
    head.textContent = g.title;
    const grid = document.createElement("div");
    grid.className = GRID_CLASS;
    const cells = await Promise.all(
      g.list.map(async (h) => {
        let card = await api.render(h, { editable: false });
        if (h.type === "monster") card = card.replaceAll('data-action="hireling', 'data-action="acksHmMon');
        // The .item wrapper carries data-item-id so both the system's hireling
        // actions (characters) and this module's handler (monsters) resolve the
        // hireling via closest(".item").dataset.itemId.
        return `<div class="item acks-henchmen-fc-cell" data-item-id="${h.id}">${card}</div>`;
      }),
    );
    grid.innerHTML = cells.join("");
    col.append(head, grid);
  }

  // Route monster cards' re-tagged actions; character cards fall through to the
  // system's own delegated dispatch untouched.
  col.addEventListener("click", (ev) => onMonsterAction(ev, employer));
}

function onMonsterAction(ev, employer) {
  const link = ev.target.closest('[data-action^="acksHmMon"]');
  if (!link) return;
  const actor = game.actors.get(link.closest(".item[data-item-id]")?.dataset.itemId);
  if (!actor) return;
  ev.preventDefault();
  ev.stopPropagation();
  switch (link.dataset.action) {
    case "acksHmMonShow":
      actor.sheet.render(true);
      break;
    case "acksHmMonLoyalty":
      openLoyaltyRoll(actor);
      break;
    case "acksHmMonMorale":
      actor.rollMorale?.({ event: ev });
      break;
    case "acksHmMonDelete":
      dismissMonster(employer, actor);
      break;
  }
}

async function dismissMonster(employer, monster) {
  const confirmed = await foundry.applications.api.DialogV2.confirm({
    window: { title: game.i18n.format("ACKS-HENCHMEN.roster.dismissTitle", { name: monster.name }) },
    content: `<p>${game.i18n.format("ACKS-HENCHMEN.roster.dismissBody", { name: monster.name })}</p>`,
  }).catch(() => false);
  if (!confirmed) return;
  await HenchmanRecord.logEvent(monster, { type: "dismissed", note: "" });
  const list = (employer.getFlag(MODULE_ID, FLAG_MONSTER_LIST) ?? []).filter((id) => id !== monster.id);
  await employer.setFlag(MODULE_ID, FLAG_MONSTER_LIST, list);
  await adapter.setRetainer(monster, { enabled: false, managerid: "" });
  Hooks.callAll(HOOKS.ROSTER_CHANGED, { employer }); // employer update re-renders its sheet → grid rebuilds
}

export function installHirelingsGrid() {
  Hooks.on("renderActorSheetV2", (app, element) => {
    gridifyHirelings(app, element).catch((err) => console.warn(`${MODULE_ID} | hirelings grid failed`, err));
  });
}
