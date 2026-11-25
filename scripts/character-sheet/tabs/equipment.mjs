/* global game, foundry */
/**
 * The Equipment tab's data: the printed sheet's body map made a list. Places
 * on the left (every wear slot, head to foot then off-body, empty ones as
 * drop targets), loose gear on the right filed by kind, containers carried
 * rather than worn under Stowed, and what is kept at a place under Kept
 * elsewhere. The Load bar is the one place encumbrance is written.
 *
 * Every fact is read through the equipment feature's own model — the loadout
 * for the hands, `wearLocation` for where a thing sits, the container report
 * for what is inside what — so this tab and the item sheet cannot disagree.
 */
import { MODULE_ID, LANG } from "../constants.mjs";
import { loadBar, bridgeHands, slotBadge } from "../view-model.mjs";
import { makeLoc } from "../../lib/util.mjs";
import { companionSlots } from "../../abilities/companions.mjs";
import { carriedWeight6, capacity6, load6, riderBodyTip } from "../../lib/capacity.mjs";
import { mountOf } from "../../lib/mount.mjs";
import { getLoadout, heldHandsClause } from "../../equipment/loadout.mjs";
import { heldGrip } from "../../equipment/attack-mods.mjs";
import { heldDieTip } from "../../equipment/weapon-figures.mjs";
import { wearLocation, wearLabel } from "../../equipment/wear.mjs";
import { WEAR, WEAR_ICONS } from "../../equipment/config.mjs";
import { containerReport, containedIn, contentsOf, isContainer } from "../../equipment/containers.mjs";
import { canPick, canBash } from "../../equipment/locks.mjs";
import { ITEM_FLAGS } from "../../equipment/constants.mjs";
import { strapOf, overlayEnabled as shieldOverlayEnabled } from "../../equipment/overlays/shield-variants.mjs";
import { lightTypeOf } from "../../equipment/sheet.mjs";
import { bearerLights } from "../../lib/light.mjs";
import { canSplit, divertsEquip } from "../../equipment/item-sheet/stack.mjs";
import { stoneLabel, gpLabel } from "../../equipment/item-sheet/format.mjs";
import { isEquippable, isWorn, weight6Of, isGoods, isClothing, isCurrency, stackCountOf, slotUse, STONE } from "../../lib/item-model.mjs";
import { offersCount } from "../../lib/storage-logic.mjs";
import { countView } from "../../lib/stack-count.mjs";
import { wearableSlots } from "../../equipment/profiles.mjs";
import { coinTotalGC } from "../../lib/money-logic.mjs";
import { coinOrderView } from "../../lib/coin-order.mjs";
import { WEAR_SLOT_ORDER, WEAR_SLOTS, ITEM_TYPE, slotCapacitySource } from "../../lib/vocab.mjs";
import { libStorage } from "../../lib/util.mjs";
import { depositReach, listsWhenEmpty, pinnedPlaces, reachScan } from "../../location/reach.mjs";
import { GROUND_FLAG, isGroundPile } from "../../lib/place.mjs";
import { SET_DOWN_FLAG } from "../../location/ground.mjs";
import { pileRowFacts } from "../../location/ground-logic.mjs";
import { spendPicks } from "../../lib/picks.mjs";

const loc = makeLoc(LANG);
const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

/** What a row says under its name: damage for a weapon, AC for armour, worth for coin, weight for goods. */
function lineOf(item, held) {
  const parts = [];
  if (item.type === ITEM_TYPE.weapon) parts.push(held?.formula ?? "");
  if (item.type === ITEM_TYPE.armor) parts.push(`AC ${num(item.system?.ac?.value)}`);
  if (isCurrency(item)) parts.push(gpLabel(coinTotalGC([item])));
  // `weight6Of` already weighs the whole stack (it reads the bundle size, and
  // a coin's count against how many make a stone).
  const w6 = weight6Of(item);
  if (w6 > 0 && !isClothing(item)) parts.push(`${stoneLabel(w6)} st`);
  return parts.filter(Boolean).join(" · ");
}

/** `{lightId: "x"}` → `data-light-id="x"`: the attributes the sheet's action reads back off `dataset`. */
const attrsOf = (data) =>
  Object.entries(data)
    .map(([k, v]) => `data-${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}="${foundry.utils.escapeHTML(String(v))}"`)
    .join(" ");

/** One control on a row. `data` becomes `data-*` attributes the sheet's action reads. */
const ctl = (action, icon, title, data = {}, cls = "") => ({ action, icon, title, cls, attrs: attrsOf(data) });

/**
 * What the stack keeps when this row's equip control is pressed, or null when
 * the press takes none off a stack. It asks the very test the equip write
 * itself is diverted by (`divertsEquip`), so a tooltip never promises a divide
 * the press will not make.
 */
function stackKeptOnEquip(item) {
  return divertsEquip(item, { system: { equipped: true } }) ? (stackCountOf(item) ?? 0) - 1 : null;
}

/**
 * One state control's tooltip: `plain` where the press takes nothing off a
 * stack, `one` (which names what the stack keeps) where it takes one.
 */
function equipTitle(item, plain, one) {
  const rest = stackKeptOnEquip(item);
  return rest === null ? game.i18n.localize(plain) : game.i18n.format(one, { rest });
}

/**
 * The controls a row offers its owner, in three groups: the roll, the state
 * toggles, and the housekeeping.
 */
function rowControls(actor, item, loadout, lights) {
  const roll = item.type === ITEM_TYPE.weapon ? `wpn:${item.id}:${item.system?.melee || !item.system?.missile ? "atk:melee" : "atk:missile"}` : null;
  const state = [];
  const keep = [];
  if (!actor.isOwner) return { roll, state, keep };

  const stowed = !!containedIn(item);
  if (stowed) state.push(ctl("takeOut", "fa-solid fa-arrow-up-from-bracket", game.i18n.localize("ACKS-EQUIPMENT.container.takeOut")));

  if (item.type === ITEM_TYPE.weapon && !item.getFlag(MODULE_ID, ITEM_FLAGS.THROWN_STATE)) {
    const equipped = !!item.system?.equipped;
    const title = equipped ? game.i18n.localize("ACKS-EQUIPMENT.action.sheathe") : equipTitle(item, "ACKS-EQUIPMENT.action.draw", "ACKS-EQUIPMENT.action.drawOne");
    state.push(ctl("toggleEquip", equipped ? "fa-solid fa-box-archive" : "fa-solid fa-hand-fist", title));
    const entry = loadout.weapons.find((w) => w.item.id === item.id);
    if (entry?.canTwoHand) {
      const gripState = entry.gripBlocked ? "blocked" : entry.wieldTwoHanded ? "twoHand" : "oneHand";
      state.push(
        ctl("cycleGrip", "fa-solid fa-hands", game.i18n.format(entry.gripBlocked ? "ACKS-EQUIPMENT.grip.blocked" : "ACKS-EQUIPMENT.grip.cycle", {
          grip: game.i18n.localize(`ACKS-EQUIPMENT.grip.${entry.grip}`),
        }), {}, `is-${gripState}`),
      );
    }
  } else if (item.type === ITEM_TYPE.armor) {
    const equipped = !!item.system?.equipped;
    const title = equipped ? game.i18n.localize("ACKS.items.Unequip") : equipTitle(item, "ACKS.items.Equip", "ACKS-EQUIPMENT.action.equipOne");
    state.push(ctl("toggleEquip", equipped ? "fa-solid fa-shirt" : "fa-regular fa-shirt", title));
    if (item.system?.type === "shield" && shieldOverlayEnabled() && !stowed) {
      const strap = strapOf(item);
      state.push(ctl("cycleStrap", strap === "hand" ? "fa-solid fa-hand" : "fa-solid fa-shield-halved", game.i18n.localize("ACKS-EQUIPMENT.strap.cycle"), {}, `is-${strap}`));
    }
  } else if (!isEquippable(item) && wearableSlots(item).length) {
    const worn = isWorn(item);
    const slot = wearableSlots(item)[0];
    state.push(ctl("toggleWear", worn ? "fa-solid fa-circle-minus" : "fa-solid fa-circle-plus", game.i18n.format(`ACKS-EQUIPMENT.action.${worn ? "remove" : "wear"}`, { slot: wearLabel(slot) }), { slot }));
  }

  // Light controls: the source itself, never a stowed one; a torch STACK
  // readies a torch instead.
  const lightType = lightTypeOf(item);
  if (lightType && !stowed) {
    if (lightType === "torch" && item.type === ITEM_TYPE.item) {
      state.push(ctl("readyTorch", "fa-solid fa-fire-flame-simple", game.i18n.localize("ACKS-EQUIPMENT.action.readyHint")));
    } else {
      const lit = lights.find((l) => l.type === lightType && l.lit);
      const held = lit || lights.find((l) => l.type === lightType && l.shielded);
      if (held) {
        state.push(ctl("lightAction", "fa-solid fa-fire", game.i18n.localize("ACKS-EQUIPMENT.light.douse"), { light: "lightToggle", lightId: held.id }));
        if (lightType === "lantern") state.push(ctl("lightAction", "fa-solid fa-lightbulb", game.i18n.localize("ACKS-EQUIPMENT.light.shutter"), { light: "lightShield", lightId: held.id }));
      } else {
        state.push(ctl("lightAction", "fa-solid fa-fire-flame-curved", game.i18n.localize("ACKS-EQUIPMENT.light.light"), { light: "light", lightType }));
      }
    }
  }

  // A stack with somewhere to be worn splits ONE out to wear it; any other
  // stack divides, a count of the owner's choosing into a row of its own.
  if (canSplit(item)) state.push(ctl("splitStack", "fa-solid fa-scissors", loc("equipment.split")));
  else if (offersCount(item) && (stackCountOf(item) ?? 0) > 1) state.push(ctl("divideStack", "fa-solid fa-scissors", game.i18n.localize("ACKS-LIB.stack.divide")));
  if ("favorite" in (item.system ?? {})) {
    state.push(ctl("itemFavorite", item.system.favorite ? "fa-solid fa-star" : "fa-regular fa-star", game.i18n.localize(item.system.favorite ? "ACKS.items.RemoveFromFavorites" : "ACKS.items.AddToFavorites"), {}, item.system.favorite ? "is-on" : ""));
  }
  keep.push(ctl("itemEdit", "fa-solid fa-pen-to-square", game.i18n.localize("ACKS.Edit")));
  keep.push(ctl("itemDelete", "fa-solid fa-trash", game.i18n.localize("ACKS.Delete")));
  return { roll, state, keep };
}

/**
 * May the viewer set this container down on the ground? Its owner may, on a
 * character's own actor (an unlinked token's actor is refused for every seat,
 * `location/ground-logic.mjs`), and only a container carried at the top level:
 * one inside another goes down with the container it is in.
 */
export const canSetDown = (actor, item) => !!actor?.isOwner && !actor.isToken && !containedIn(item);

/** The container header's own controls: fold, the lock, pick and bash, empty, set down. */
export function containerControls(actor, report) {
  const out = [];
  const mayBypass = !report.locked || game.user.isGM;
  // Folding a container writes its record, so it is the owner's like the rest.
  if (!actor.isOwner) return out;
  if (report.visible) {
    out.push(ctl("containerToggle", report.concealed ? "fa-solid fa-chevron-right" : "fa-solid fa-chevron-down", game.i18n.localize(report.concealed ? "ACKS-EQUIPMENT.container.expand" : "ACKS-EQUIPMENT.container.collapse")));
  }
  if (mayBypass) out.push(ctl("containerLock", report.locked ? "fa-solid fa-unlock" : "fa-solid fa-lock", game.i18n.localize(report.locked ? "ACKS-EQUIPMENT.container.unlock" : "ACKS-EQUIPMENT.container.lock")));
  if (report.locked) {
    if (canPick(actor)) out.push(ctl("containerPick", "fa-solid fa-key", game.i18n.localize("ACKS-EQUIPMENT.container.pick")));
    if (canBash(actor)) out.push(ctl("containerBash", "fa-solid fa-hammer", game.i18n.localize("ACKS-EQUIPMENT.container.bash")));
  }
  if (mayBypass) out.push(ctl("containerEmpty", "fa-solid fa-box-open", game.i18n.localize("ACKS-EQUIPMENT.container.empty")));
  // A locked container goes down whole, its lock in its flags: storage never refuses a shut one.
  if (canSetDown(actor, report.item)) out.push(ctl("containerSetDown", "fa-solid fa-arrow-down-to-line", game.i18n.localize("ACKS-EQUIPMENT.container.setDown")));
  return out;
}

/** One gear row. A container row carries its contents and its capacity bar. */
function rowOf(actor, item, ctx, depth = 0) {
  const { loadout, lights, reports, wieldedIds } = ctx;
  // The mapper's quill and parchment are listed at the hands while the role is
  // held; the row says why a plain item sits there.
  const kit = loadout.mappingKit.some((k) => k.id === item.id);
  // A weapon's die is the one its row rolls: the grip it is held in.
  const held = item.type === ITEM_TYPE.weapon ? heldGrip(actor, item) : null;
  const { qty, stack, countTip } = countView(item);
  const row = {
    id: item.id,
    name: item.name,
    img: item.img,
    line: [lineOf(item, held), kit ? loc("equipment.kitInHand") : ""].filter(Boolean).join(" · "),
    lineTip: held ? heldDieTip(held) : "",
    qty,
    stack,
    countTip,
    wielded: wieldedIds.has(item.id),
    controls: rowControls(actor, item, loadout, lights),
    isMoney: isCurrency(item),
    container: null,
  };
  const report = reports.get(item.id);
  if (report && depth < 3) {
    const cap6 = report.capacityStone * STONE;
    const rows = report.visible && !report.concealed ? report.contents.map((c) => rowOf(actor, c, ctx, depth + 1)) : [];
    row.container = {
      pct: cap6 > 0 ? Math.min(100, Math.round((report.load6 / cap6) * 100)) : 0,
      ticks: cap6 > 0 ? [25, 50, 75] : [],
      // A container that declares it holds gear and states no size: no limit is
      // counted, and the row shows the load alone.
      load: `${stoneLabel(report.load6)}${report.capacityStone ? ` / ${report.capacityStone}` : ""} st`,
      capacityTip: "",
      over: report.over,
      locked: report.locked,
      concealed: report.concealed,
      visible: report.visible,
      rows,
      count: report.contents.length,
      hint: !report.visible ? game.i18n.localize("ACKS-EQUIPMENT.container.lockedHint") : !report.concealed && !rows.length ? game.i18n.localize("ACKS-EQUIPMENT.container.emptyHint") : "",
      controls: containerControls(actor, report),
    };
  }
  return row;
}

/**
 * The staging-pick key of one line on a pile. It carries the pile's id and the
 * item's, so two piles listing like-named rows never share a typed amount
 * across a redraw (`lib/picks.mjs`).
 */
export const pileTakePick = (pile, itemId) => `take-${pile?.id}-${itemId}`;

/**
 * One line per row the pile holds, as its Take control reads it. A line is
 * takeable by the viewer's own seat (the sheet is editable) and either stamped
 * to the viewer, who takes their own goods from anywhere, or the viewer
 * reaches the pile, where anyone standing at it takes any row
 * (docs/location/MODEL.md, "Who may take"). A row inside a container names it.
 * @param {Actor} actor the viewer's character
 * @param {Actor} pile the pile
 * @param {Item[]} stored the goods on the pile, as `storedItems` lists them
 * @param {boolean} reaches whether the viewer reaches the pile
 */
function pileLines(actor, pile, stored, reaches) {
  const api = libStorage();
  const names = new Map(stored.map((i) => [i.id, i.name]));
  return stored.map((i) => {
    const qty = stackCountOf(i) ?? 1;
    const boxId = containedIn(i);
    return {
      id: i.id,
      name: i.name,
      qty,
      stack: qty > 1,
      inName: boxId && names.has(boxId) ? names.get(boxId) : "",
      pick: pileTakePick(pile, i.id),
      canTake: !!actor.isOwner && (api?.ownerOf?.(i)?.uuid === actor.uuid || reaches),
    };
  });
}

/**
 * The words of a ground pile's row, from the facts `pileRowFacts` reads off the
 * pile: its label (the container's name now, else the one it had when set
 * down), whether it is at risk, the goods as "name ×qty" for the line's
 * tooltip, where Pick up puts the container back, and the lines the row
 * unfolds to.
 *
 * The owner's row (`bystander` false) speaks of the viewer's goods; a
 * bystander's row, a pile at which the viewer stands holding none of theirs,
 * names whose pack it is and speaks of everything on it.
 * @param {Actor} actor the viewer's character
 * @param {Actor} provider the pile
 * @param {Item[]} items what the pile holds of the viewer's, as `providersFor` lists it; empty for a bystander
 * @param {object} [opts]
 * @param {Item[]} [opts.stored] every good on the pile, for the lines
 * @param {boolean} [opts.bystander] the row is a pile of someone else's
 * @param {boolean} [opts.reaches] the viewer reaches the pile
 */
export function groundRowOf(actor, provider, items, { stored = [], bystander = false, reaches = false } = {}) {
  const api = libStorage();
  const flag = provider.getFlag?.(MODULE_ID, GROUND_FLAG) ?? null;
  const factsOf = (list, viewerUuid) =>
    pileRowFacts({
      flag,
      items: list.map((i) => ({
        name: i.name,
        quantity: stackCountOf(i) ?? 1,
        ownerUuid: api?.ownerOf?.(i)?.uuid ?? null,
        setDown: i.getFlag?.(MODULE_ID, SET_DOWN_FLAG) ?? null,
      })),
      viewerUuid,
    });
  const lines = pileLines(actor, provider, stored, reaches);
  const listed = lines.map((l) => `${l.name} ×${l.qty}`).join(" · ");
  const base = { lines, canTake: lines.some((l) => l.canTake), bystander };

  if (bystander) {
    // The container is read as the owner's view of the pile reads it.
    const facts = factsOf(stored, flag?.ownerUuid ?? null);
    const owner = api?.resolveActorSync?.(flag?.ownerUuid)?.name || flag?.ownerName || "";
    return {
      ...base,
      label: owner
        ? loc("equipment.groundOf", { owner, container: facts.container })
        : game.i18n.format("ACKS-LOCATION.ground.name", { name: facts.container }),
      container: facts.container,
      count: lines.length,
      atRisk: true,
      atRiskTip: loc("equipment.atRiskTipOther"),
      lineTip: listed,
      pickUpTip: "",
    };
  }

  const facts = factsOf(items, actor.uuid);
  return {
    ...base,
    label: game.i18n.format("ACKS-LOCATION.ground.name", { name: facts.container }),
    container: facts.container,
    count: facts.count,
    atRisk: facts.atRisk,
    atRiskTip: facts.atRisk ? loc("equipment.atRiskTip") : "",
    lineTip: facts.lines.map((l) => `${l.name} ×${l.quantity}`).join(" · "),
    pickUpTip: facts.worn && facts.slot ? loc("equipment.pickUp", { slot: wearLabel(facts.slot) }) : loc("equipment.pickUpCarried"),
  };
}

/**
 * A place kept off-person, as the Kept elsewhere rule lists it. A ground pile
 * carries a `ground` block of its own words, takes no deposit from anyone (a
 * Judge included) and is never pinned: a pin would give reach to it from
 * anywhere. Its Open is the Judge's alone, since the pile's own sheet shows a
 * Player nothing of it. `items` is what the place holds of the viewer's; a
 * pile row with none (`bystander`) is one the viewer stands at.
 */
function placeRow(actor, provider, items, coinGC, pinned, scan, { bystander = false } = {}) {
  const api = libStorage();
  const reach = depositReach(actor, provider, { scan });
  const ground = isGroundPile(provider)
    ? groundRowOf(actor, provider, items, { stored: (api?.storedItems?.(provider) ?? []).filter(isGoods), bystander, reaches: reach.can })
    : null;
  return {
    uuid: provider.uuid,
    name: provider.name,
    img: provider.img,
    isVault: !!api.vaultOwnerUuid(provider),
    count: ground && bystander ? ground.count : items.length,
    coinGC,
    canReach: reach.can,
    canDeposit: !ground && (reach.can || !!game.user?.isGM),
    reachReason: reach.can || ground ? "" : game.i18n.format(`ACKS-LOCATION.storage.reach.${reach.reason}`, { scene: reach.scene?.name ?? "" }),
    pinned,
    canPin: !ground,
    canOpen: !ground || !!game.user?.isGM,
    ground,
    // Pick up is the owner's, from anywhere: it moves what is stamped to the
    // viewer, so a row with none of the viewer's goods has nothing to pick up.
    canRetrieve: items.length > 0,
  };
}

/**
 * Take one line off a pile onto the character. A stack takes the amount typed
 * in its staging pick, the whole stack when the box is blank; the pick is
 * spent before the move so the redraw shows what the pile holds now. The move
 * is storage's own `retrieve`, which relays to the Judge's seat where this seat
 * does not own the pile, and lands what it takes loose (what a container held
 * goes with it, whole).
 * @param {Actor} actor the character taking
 * @param {Actor} pile the pile
 * @param {string} itemId the line's row on the pile
 * @param {ParentNode|null} row the element holding the line's pick
 * @returns {Promise<object|null>} what `retrieve` answered, or null when nothing was asked
 */
export async function takeFromPile(actor, pile, itemId, row = null) {
  const api = libStorage();
  if (!api || !pile || !itemId) return null;
  const pick = pileTakePick(pile, itemId);
  const raw = row?.querySelector?.(`input[data-pick="${pick}"]`)?.value ?? "";
  const quantity = raw === "" || !Number.isFinite(Number(raw)) ? null : Number(raw);
  spendPicks(row, [pick]);
  return api.retrieve(pile, actor, [{ id: itemId, quantity }]);
}

/** The token fields a move changes: where it stands. */
const MOVE_KEYS = Object.freeze(["x", "y", "elevation"]);

/**
 * Does this token update move the character or a pile? Only such a move can
 * change which piles the character stands at; every other token's move is
 * answered with nothing, so a live scene's steps cost an open sheet one
 * comparison each.
 * @param {Actor} actor the sheet's character
 * @param {TokenDocument} token the token updated
 * @param {object} changes the update's changes
 */
export function movesForPiles(actor, token, changes) {
  if (!MOVE_KEYS.some((k) => k in (changes ?? {}))) return false;
  const ours = actor?.isToken ? token?.uuid === actor.token?.uuid : !!token?.actorId && token.actorId === actor?.id;
  return ours || isGroundPile(token?.actor);
}

/**
 * The piles the character reaches that hold anything, as one string the sheet
 * compares across a move: the bystander rows the tab lists and the lines Take
 * is offered on both follow it, so a move that leaves it unchanged changes
 * nothing the tab draws.
 * @param {Actor} actor
 * @param {object} [scan] a `reachScan` already taken
 */
export function pileReachKey(actor, scan = null) {
  const storage = libStorage();
  const piles = (storage?.providers?.() ?? []).filter(isGroundPile);
  if (!piles.length) return "";
  const pass = scan ?? reachScan(actor);
  return piles
    .filter((p) => depositReach(actor, p, { scan: pass }).can && (storage?.storedItems?.(p) ?? []).some(isGoods))
    .map((p) => p.uuid)
    .sort()
    .join("|");
}

/**
 * The creature the character rides, as the Mount rule lists it, or null on
 * foot. Its line is what it bears, the rider and their kit included, against
 * what it can where that is stated. The load is blank where the rider's body
 * weight is not known; the line's tooltip names where that weight is read from.
 */
function mountRow(actor) {
  const mount = mountOf(actor);
  if (!mount) return null;
  const cap6 = capacity6(mount);
  const load = load6(mount);
  const figures = { load: load === null ? "" : stoneLabel(load), max: cap6 === null ? "" : stoneLabel(cap6) };
  const line = load === null
    ? loc("equipment.mountLoadBlank")
    : loc(cap6 === null ? "equipment.mountLoad" : "equipment.mountLoadOf", figures);
  return {
    uuid: mount.uuid,
    name: mount.name,
    img: mount.img,
    line,
    lineTip: riderBodyTip(actor),
  };
}

/**
 * The companion slots the character's abilities confer, as rows: the creature
 * in the slot or the empty slot, and the ability that confers it. The slot and
 * its pointer are the abilities feature's (`abilities/companions.mjs`).
 */
function companionRows(actor) {
  return companionSlots(actor).map((s) => ({
    abilityId: s.item.id,
    index: s.index,
    empty: !s.companion,
    name: s.companion?.name ?? "",
    img: s.companion?.img ?? s.item.img,
    via: game.i18n.format("ACKS-EQUIPMENT.companion.via", { ability: s.item.name }),
  }));
}

/**
 * Build the tab's data.
 * @param {Actor} actor
 * @param {object} [opts]
 * @param {Set<string>} [opts.openPiles] the uuids of the piles whose list the sheet has unfolded
 */
export function buildEquipmentTab(actor, { openPiles = new Set() } = {}) {
  const companions = companionRows(actor);
  const sys = actor.system ?? {};
  const loadout = getLoadout(actor);
  const lights = bearerLights(actor);
  const reports = new Map(containerReport(actor).map((r) => [r.item.id, r]));
  const wieldedIds = new Set(loadout.weapons.map((w) => w.item.id));
  const ctx = { loadout, lights, reports, wieldedIds };

  // Where everything sits, decided once by the feature's own resolver.
  const where = new Map();
  for (const item of actor.items) {
    if (!isGoods(item)) continue;
    where.set(item.id, wearLocation(actor, item, loadout));
  }

  // Every slot in the lib's order; a weapon in both hands then folds the two
  // hand places into one row rather than taking a place of its own.
  const places = bridgeHands(WEAR_SLOT_ORDER.map((key) => {
    const items = actor.items.filter((i) => where.get(i.id) === key);
    // Two counts against two rules — magic by form, armour and weapons by
    // the body — and clothing against neither; the badge shows the larger. A
    // piece of the mapper's kit takes the hand it is listed at like a weapon.
    // The counts shown are the viewer's: magic not yet detected is not counted
    // for a player, and `use.full` is read against the same count, so a place
    // never reads full beside a badge under its cap.
    const use = slotUse(key, items, { viewer: { isGM: !!game.user?.isGM } });
    const kit = items.filter((i) => loadout.mappingKit.some((k) => k.id === i.id)).length;
    if (kit) {
      use.equip += kit;
      use.used = Math.max(use.equip, use.magic);
      use.full = use.full || (use.cap !== null && use.cap !== Infinity && use.equip > 1);
    }
    return {
      key,
      label: wearLabel(key),
      icon: `fa-solid ${WEAR_ICONS[key] ?? WEAR_SLOTS[key]?.icon ?? "fa-circle"}`,
      rows: items.map((i) => rowOf(actor, i, ctx)),
      empty: !items.length,
      hint: loc(`equipment.slotHint.${key}`),
      ...slotBadge(key, use, slotCapacitySource(key), loc),
      full: use.full,
      equip: use.equip,
      magic: use.magic,
    };
  }));

  const loose = actor.items.filter((i) => where.get(i.id) === WEAR.carried);
  const stowedContainers = loose.filter(isContainer);
  const carriedItems = loose.filter((i) => !isContainer(i));
  const kinds = [
    { key: "weapons", label: game.i18n.localize("ACKS.items.Weapons"), test: (i) => i.type === ITEM_TYPE.weapon },
    { key: "armour", label: game.i18n.localize("ACKS.items.Armors"), test: (i) => i.type === ITEM_TYPE.armor },
    { key: "coin", label: loc("equipment.coin"), test: (i) => isCurrency(i) || !!i.system?.treasure },
    { key: "gear", label: loc("equipment.gear"), test: () => true },
  ];
  const carried = [];
  const taken = new Set();
  for (const kind of kinds) {
    const rows = carriedItems.filter((i) => !taken.has(i.id) && kind.test(i)).map((i) => {
      taken.add(i.id);
      return rowOf(actor, i, ctx);
    });
    if (rows.length) carried.push({ key: kind.key, label: kind.label, rows, note: kind.key === "coin" ? loc("equipment.coinNote") : "" });
  }

  const storage = libStorage();
  const held = storage?.providersFor?.(actor) ?? [];
  const pinned = pinnedPlaces(actor);
  // One token pass for every place on the tab (reach.mjs `reachScan`).
  const scan = reachScan(actor);
  const elsewhere = held.map(({ provider, items, coinGC }) => placeRow(actor, provider, items, coinGC, pinned.has(provider.uuid), scan));
  // A place with nothing of this character's at it is listed on the narrow
  // rule (`reach.mjs` `listsWhenEmpty`): their vault, their pins, and where
  // they are standing. Anything wider puts a whole imported city on the tab.
  for (const p of storage?.providers?.() ?? []) {
    if (elsewhere.some((e) => e.uuid === p.uuid)) continue;
    // A pile is never pinned and never listed on the narrow rule: it is listed
    // for the character whose goods are in it (above) and for one that reaches
    // it while it holds anything, as a bystander's row, where Take is offered
    // on every line.
    if (isGroundPile(p)) {
      if (depositReach(actor, p, { scan }).can && (storage?.storedItems?.(p) ?? []).some(isGoods)) {
        elsewhere.push(placeRow(actor, p, [], 0, false, scan, { bystander: true }));
      }
      continue;
    }
    if (listsWhenEmpty(actor, p, { scan, pinned })) {
      elsewhere.push(placeRow(actor, p, [], 0, pinned.has(p.uuid), scan));
    }
  }
  // A pile's list is folded until the sheet opens it (`openPiles`, the sheet's
  // own state), so a redraw keeps what the viewer unfolded.
  for (const e of elsewhere) {
    if (!e.ground) continue;
    e.ground.open = e.ground.lines.length > 0 && openPiles.has(e.uuid);
    e.ground.foldLabel = loc(e.ground.open ? "equipment.pileHide" : "equipment.pileShow");
  }
  // The coin order is offered every store the tab lists: loose, the
  // containers, and each place under Kept elsewhere, a ground pile excepted:
  // arriving coin is never sent to the ground.
  const order = coinOrderView(actor, { places: elsewhere.filter((e) => !e.ground) });
  const purse = order.shown
    ? { ...order, note: loc("equipment.purseNote", { hand: gpLabel(order.onHandGp), kept: gpLabel(order.keptGp) }) }
    : null;

  // The Load figure leaves out the character's own set-down packs; a pile of
  // someone else's they stand at was never counted in it.
  const setDownNames = elsewhere.filter((e) => e.ground?.count && !e.ground.bystander).map((e) => e.ground.container);
  const enc = sys.encumbrance ?? {};
  const pct = num(enc.pct);
  const bp = enc.breakpoints ?? {};
  // The system's own bands: past the maximum is overburdened; each breakpoint
  // below it slows the character a step further.
  const state = enc.encumbered
    ? "overburdened"
    : pct > num(bp.high, 100) ? "heavy" : pct > num(bp.mid, 100) ? "loaded" : pct > num(bp.low, 0) ? "light" : "unencumbered";
  // The burden is core's figure after the carrying rules; the mass is summed
  // here, and the bar draws the difference as its phantom.
  const true6 = carriedWeight6(actor);
  const bar = loadBar({ value6: enc.value6, true6, max6: enc.max6, pct, breakpoints: bp });
  const figures = { load: stoneLabel(num(enc.value6)), max: stoneLabel(num(enc.max6)), carried: stoneLabel(true6) };
  return {
    load: {
      pct: bar.pct,
      phantom: bar.phantom,
      ticks: bar.ticks,
      label: loc(bar.eased6 > 0 ? "equipment.loadLabelEased" : "equipment.loadLabel", figures),
      hint: bar.eased6 > 0 ? loc("equipment.loadEased", { eased: stoneLabel(bar.eased6) }) : "",
      // What is set down on the ground is not in the figure; the tooltip names it.
      tip: setDownNames.length ? loc("equipment.loadGround", { names: setDownNames.join(" · ") }) : "",
      state: loc(`equipment.loadState.${state}`),
      tone: state === "overburdened" || state === "heavy" ? "bad" : state === "unencumbered" ? null : "warn",
    },
    hands: {
      used: loadout.handsUsed,
      budget: loadout.handBudget,
      style: wearLabel(`style.${loadout.activeStyle}`),
      clause: heldHandsClause(loadout),
      untrained: !loadout.styleProficient,
    },
    places,
    carried,
    carriedCount: carriedItems.length,
    stowed: stowedContainers.map((i) => rowOf(actor, i, ctx)),
    elsewhere,
    purse,
    mount: mountRow(actor),
    companions,
    companionsNote: companions.length
      ? game.i18n.format("ACKS-EQUIPMENT.companion.count", { n: companions.filter((c) => !c.empty).length, of: companions.length })
      : "",
    hasContainers: reports.size > 0,
    unarmed: !loadout.weapons.length,
    editable: actor.isOwner,
  };
}

export { contentsOf };
