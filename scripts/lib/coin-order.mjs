/* global ui, Hooks */
/**
 * The coin-order controls a sheet draws: the store a payment draws on first,
 * the store arriving coin lands in, and the fold of duplicate rows. One view
 * (`coinOrderView`), one partial (`COIN_ORDER_TEMPLATE`) and one listener
 * (`bindCoinOrder`) serve every sheet that lists a holder's coin.
 *
 * The selects carry no `name`. A choice is written by the listener through
 * `setCoinOrder`, and its `change` is stopped at the block, so a form that
 * submits on change neither writes the choice nor submits for it.
 */
import { MODULE_ID, LANG_PREFIX } from "./constants.mjs";
import { elementOf, makeLoc } from "./util.mjs";
import { LOOSE_STORE, coinKind, coinOrderOf, coinTotalCp, placeStoreKey } from "./money-logic.mjs";
import { coinStores, gatherCoin, keepsCoinElsewhere, setCoinOrder, standingCoinScope } from "./money.mjs";
import { resolveActorSync } from "./storage.mjs";

const loc = makeLoc(LANG_PREFIX);

/** The partial every sheet includes, handed a `coinOrderView`. */
export const COIN_ORDER_TEMPLATE = `modules/${MODULE_ID}/templates/lib/coin-order.hbs`;

/**
 * What the coin-order partial draws for a holder.
 *
 * Every store the holder has is offered (`coinStores` at its widest reach),
 * and so is each of `places` — the places the sheet lists for them — that
 * keeps none of their coin yet, where a place may keep coin for them at all.
 * A payment may be drawn first from any store no lock shuts; arriving coin may
 * be sent to any that takes coin. A stated key whose store is gone stays an
 * option of its own, so the control shows what the flag says.
 *
 * @param {Actor} holder
 * @param {{places?: Array<{uuid: string, name: string}>}} [opts]
 * @returns {{uuid: string, editable: boolean, shown: boolean, choice: boolean,
 *   payFrom: Array<{key: string, label: string, selected: boolean}>,
 *   receiveInto: Array<{key: string, label: string, selected: boolean}>,
 *   foldable: number, onHandGp: number, keptGp: number, reachNote: string}}
 *   `choice` is whether there is more than coin carried loose to choose from;
 *   `foldable` how many rows a fold would take away (`gatherCoin`), counted
 *   only for a seat that may fold them; `shown` whether the block has
 *   anything to draw
 */
export function coinOrderView(holder, { places = [] } = {}) {
  const order = coinOrderOf(holder);
  const stores = coinStores(holder, { within: "all" });
  const listed = new Set(stores.map((s) => s.key));
  const offered = keepsCoinElsewhere(holder)
    ? places
        .filter((p) => p?.uuid && p.uuid !== holder.uuid && !listed.has(placeStoreKey(p.uuid)))
        .map((p) => ({ key: placeStoreKey(p.uuid), kind: "place", name: p.name, rows: [], shut: false, takesCoin: true }))
    : [];
  const all = [...stores, ...offered];
  const labelOf = (store) => (store.kind === "loose" ? loc("money.order.loose") : store.name);
  const optionsFor = (chosen, fits) => {
    const options = all.filter(fits).map((s) => ({ key: s.key, label: labelOf(s), selected: s.key === chosen }));
    if (!options.some((o) => o.selected)) options.push({ key: chosen, label: loc("money.order.gone"), selected: true });
    return options;
  };
  const gp = (kept) => coinTotalCp(stores.filter((s) => (s.kind === "place") === kept).flatMap((s) => s.rows)) / 100;
  // Rows beyond the first of each kind in one store are what a fold removes.
  const foldable = holder.isOwner
    ? stores.filter((s) => s.writable).reduce((n, s) => n + s.rows.length - new Set(s.rows.map(coinKind)).size, 0)
    : 0;
  const choice = all.length > 1 || order.payFrom !== LOOSE_STORE || order.receiveInto !== LOOSE_STORE;
  const standing = standingCoinScope();
  return {
    uuid: holder.uuid,
    editable: !!holder.isOwner,
    // An actor on a compendium shelf pays nobody and is paid by nobody.
    shown: !holder.pack && (choice || foldable > 0),
    choice,
    payFrom: optionsFor(order.payFrom, (s) => !s.shut),
    receiveInto: optionsFor(order.receiveInto, (s) => s.takesCoin),
    foldable,
    onHandGp: gp(false),
    keptGp: gp(true),
    reachNote: choice && standing !== "all" ? loc(`money.order.reach.${standing}`) : "",
  };
}

/**
 * Bind every coin-order block under `root`: a select writes its half of the
 * holder's order, and the gather control folds their duplicate rows and says
 * how many. A block is bound once, however often a render hook reaches it.
 * @param {HTMLElement|null} root
 */
export function bindCoinOrder(root) {
  for (const block of root?.querySelectorAll?.("[data-coin-order]") ?? []) {
    if (block.dataset.coinOrderBound) continue;
    block.dataset.coinOrderBound = "1";
    const holderOf = () => resolveActorSync(block.dataset.coinOrder);
    block.addEventListener("change", (event) => {
      const half = event.target?.dataset?.coinOrderHalf;
      if (!half) return;
      event.stopPropagation();
      const holder = holderOf();
      if (!holder?.isOwner) return;
      setCoinOrder(holder, { [half]: event.target.value }).catch((err) => console.error(`${MODULE_ID} | coin order not written`, err));
    });
    block.addEventListener("click", (event) => {
      if (!event.target?.closest?.("[data-coin-order-gather]")) return;
      event.preventDefault();
      event.stopPropagation();
      const holder = holderOf();
      if (!holder) return;
      gatherCoin(holder)
        .then(({ merged }) => ui.notifications?.info(loc(merged ? "money.order.gathered" : "money.order.nothingToGather", { n: merged, name: holder.name })))
        .catch((err) => console.error(`${MODULE_ID} | coin not gathered`, err));
    });
  }
}

/**
 * Bind the blocks of every actor sheet as it renders. A sheet that injects a
 * block after its render hooks have run binds that one itself.
 */
export function installCoinOrder() {
  Hooks.on("renderActorSheetV2", (_app, element) => {
    try {
      bindCoinOrder(elementOf(element));
    } catch (err) {
      console.error(`${MODULE_ID} | coin order controls not bound`, err);
    }
  });
}
