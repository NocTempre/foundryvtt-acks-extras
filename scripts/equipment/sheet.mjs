/* global game, Hooks, document, ui, foundry, fromUuid */
/**
 * ACKS character-sheet integration — wear-location buckets on the Inventory tab.
 *
 * Core groups inventory strictly by ITEM TYPE (weapons / armour / items /
 * clothing / money), so "what is this character actually wearing, and where?"
 * was only answerable through theripper93's Paper Doll — a separate premium
 * module — or the Loadout Inspector macro. This puts the same information on
 * the sheet every table already has.
 *
 * Technique (deliberately non-invasive): core's sheet is an ApplicationV2 whose
 * `[data-action]` handlers are bound by DELEGATION on the application root. So
 * we do not re-render, re-template, or clone anything — we MOVE core's own
 * `<li>` rows into our buckets. Every core control on those rows (equip toggle,
 * favourite, summary expand, delete, drag) keeps working untouched, and the
 * next re-render rebuilds core's markup from scratch, so nothing is persisted
 * or corrupted. Rows we do not claim stay exactly where core put them.
 *
 * HANDOFF: if the system ever groups inventory by an extensible bucket list of
 * its own, this file should be deleted in favour of contributing to it.
 */
import { MODULE_ID, ITEM_FLAGS } from "./constants.mjs";
import { WEAR, WEAR_ICONS } from "./config.mjs";
import { getLoadout, cycleGrip, heldHandsClause } from "./loadout.mjs";
import { prepareTorch, rollUnarmed, drawItem, sheatheItem, wearItem, removeItem } from "./actions.mjs";
import { STONE, slotsOf, isWorn, isEquippable } from "../lib/item-model.mjs";
import { ITEM_TYPE, ACTOR_TYPE } from "../lib/vocab.mjs";
import { LIGHT_SOURCES } from "../lib/light.mjs";
import { profileStripElement } from "../lib/proficiency-strip.mjs";
import { cycleStrap, strapOf, overlayEnabled as shieldOverlayEnabled } from "./overlays/shield-variants.mjs";
import { wearBuckets, wearLabel } from "./wear.mjs";
import {
  containedIn,
  containerReport,
  contentsOf,
  isContainer,
  emptyContainer,
  setConcealed,
  setLocked,
  setOpened,
  storeIn,
  takeOut,
} from "./containers.mjs";
import { pickLock, bashOpen, canPick, canBash } from "./locks.mjs";
import { annotateItem } from "./api.mjs";

/** Stone display shared with the container app. */
function st(weight6) {
  return String(Number(weight6 / STONE).toFixed(2)).replace(/\.?0+$/, "") || "0";
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A bucket header: icon, label, and an optional right-aligned note. */
function bucketHeader(iconKey, label, note) {
  const header = el("header", "acks-equipment-wear__bucket-header");
  const icon = el("i", `fas ${WEAR_ICONS[iconKey] ?? "fa-circle"}`);
  header.append(icon, el("span", "acks-equipment-wear__bucket-label", label));
  if (note) header.append(el("span", "acks-equipment-wear__bucket-note", note));
  return header;
}

/**
 * Move the rows for `items` out of core's type lists into `list`.
 * @returns {number} how many rows were actually claimed
 */
function claimRows(tab, items, list, wearKey) {
  let claimed = 0;
  for (const item of items) {
    // Scope the lookup to core's own lists so we never re-claim a row we have
    // already moved (which would reorder buckets on a double fire).
    const row = tab.querySelector(`.item-list > li.item[data-item-id="${item.id}"]`);
    if (!row) continue;
    row.dataset.wear = wearKey;
    list.appendChild(row);
    claimed++;
  }
  return claimed;
}

/** Build the "Worn & Wielded" section, or null when nothing is equipped. */
function buildWornSection(actor, tab, loadout) {
  const buckets = wearBuckets(actor, loadout);

  const section = el("section", "acks-equipment-wear item-list-section");
  const head = el("div", "acks-equipment-wear__title");
  head.append(el("span", "acks-equipment-wear__title-text", game.i18n.localize("ACKS-EQUIPMENT.wear.section")));

  // The two facts a player checks constantly, next to the gear that drives them.
  const style = loadout.styleProficient ? "" : ` — ${game.i18n.localize("ACKS-EQUIPMENT.wear.untrained")}`;
  // The hands a torch or the mapper's kit is using hold nothing this section
  // lists, so the total has to name them or it cannot be reconciled with the
  // gear under it.
  const held = heldHandsClause(loadout);
  head.append(
    el(
      "span",
      `acks-equipment-wear__status${loadout.styleProficient ? "" : " advisory"}`,
      game.i18n.format("ACKS-EQUIPMENT.wear.status", {
        used: loadout.handsUsed,
        budget: loadout.handBudget,
        style: wearLabel(`style.${loadout.activeStyle}`),
      }) + (held ? ` · ${held}` : "") + style,
    ),
  );
  section.append(head);

  let moved = 0;
  for (const { key, items } of buckets) {
    const bucket = el("div", `acks-equipment-wear__bucket acks-equipment-wear__bucket--${key}`);
    const list = el("ul", "item-list unlist");
    const claimed = claimRows(tab, items, list, key);
    if (!claimed) continue;
    moved += claimed;
    injectGripControls(list, loadout);
    // A weapon in both hands has no place of its own: its bucket is headed by
    // the two hands it spans, with the grip named as the note.
    const header = key === WEAR.bothHands
      ? bucketHeader(WEAR.mainHand, `${wearLabel(WEAR.mainHand)} · ${wearLabel(WEAR.offHand)}`, wearLabel(key))
      : bucketHeader(key, wearLabel(key));
    bucket.append(header, list);
    section.append(bucket);
  }

  // Unarmed: an empty-handed character always has a strike (RR p299, 1d3
  // nonlethal) — a mode, not the absence of one. Shown whenever no weapon is
  // wielded, so it appears even for a character carrying nothing at all.
  let unarmed = false;
  if (!loadout.weapons.length) {
    const bucket = el("div", "acks-equipment-wear__bucket acks-equipment-wear__bucket--unarmed");
    const list = el("ul", "item-list unlist");
    const row = el("li", "item acks-equipment-unarmed");
    row.append(el("span", "acks-equipment-unarmed__label", game.i18n.localize("ACKS-EQUIPMENT.action.unarmed")));
    if (actor.isOwner) {
      const strike = el("a", "item-control acks-equipment-unarmed__strike");
      strike.innerHTML = `<i class="fas fa-hand-fist"></i>`;
      strike.dataset.tooltip = game.i18n.localize("ACKS-EQUIPMENT.action.unarmedHint");
      strike.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        rollUnarmed(actor);
      });
      row.append(strike);
    }
    list.append(row);
    bucket.append(bucketHeader("mainHand", game.i18n.localize("ACKS-EQUIPMENT.action.unarmed")), list);
    section.append(bucket);
    unarmed = true;
  }
  return moved || unarmed ? section : null;
}

/** A light source's formation light type from its name, or null. A torch is a
 * WEAPON (RR: 1d4), lanterns/candles are items — so match by name, not type.
 * The name test is the light model's own — the device's pattern where the
 * source has one (a lantern is named for the lamp, not the oil it burns), the
 * fuel's otherwise — so the controls this gates and the ready step they lead
 * to recognise the same items. Exported for the character sheet, which offers
 * the same controls. */
export function lightTypeOf(item) {
  const n = String(item?.name ?? "");
  for (const [type, cfg] of Object.entries(LIGHT_SOURCES)) {
    if ((cfg.holder ?? cfg.consumes).test(n)) return type;
  }
  return null;
}

/**
 * The same three actions for a character in no formation, written to their own
 * actor flag. Same record shape, same three verbs; what it does NOT do is track
 * burn-down, because outside a formation there is no dungeon-turn clock to burn
 * against. The flame lights, shutters and goes out when told.
 */
function lightAlone(actor, type, payload) {
  const lights = globalThis.acksExtras?.lib?.light;
  if (!lights) return;
  switch (type) {
    case "light":
      return lights.addActorLight(actor, payload.lightType);
    case "lightToggle":
      return lights.toggleActorLight(actor, payload.lightId);
    case "lightShield":
      return lights.toggleActorShield(actor, payload.lightId);
  }
}

/**
 * Declare one light action on `actor`'s behalf, by the route the party sheet
 * uses for the same three buttons.
 *
 * The light record lives in a formation, which lives in a **world setting only a
 * GM may write**. So a player cannot call the mutators at all — the write is
 * refused and the button does nothing, silently. A player DECLARES instead:
 * `requestPartyAction` relays to the active GM's client, which validates
 * ownership against the declaring user and executes there.
 *
 * A GM calls straight through. The relay would execute a GM's declaration too,
 * but only the direct call keeps their own click out of the public "so-and-so
 * declared" card — a Judge lighting a lamp is narration, not a request.
 *
 * The formation is re-read on every click: the record these rows were built from
 * may be many renders old.
 *
 * @param {string} type              a party-request type: light | lightToggle | lightShield
 * @param {object} payload           `{lightType, bearerId}` to light, `{lightId}` to douse/shutter
 */
export function declareLightAction(actor, type, payload) {
  const fm = globalThis.acksExtras?.formation;
  const formation = fm?.getFormationForActor?.(actor.id);
  // NO FORMATION, NO RELAY. The lights of a character marching with nobody are
  // their own — a flag on their own actor — so the write needs no GM and no
  // declaration card. This is the whole reason the lone path exists rather
  // than being a formation of one: a player alone in a corridor can strike a
  // light, which through the party record they never could.
  if (!formation) return lightAlone(actor, type, payload);
  // NEVER gate this on the executing client: a relayed declaration runs on a GM
  // client, where `game.user.isGM` is true for whoever declared it.
  if (!game.user.isGM) return fm.requestPartyAction(formation.id, type, payload);
  switch (type) {
    case "light":
      // A GM lighting from a character's own sheet carries the same authority as
      // the party sheet's light panel: gear supplied, a hand emptied.
      return fm.addLight(formation, payload.lightType, payload.bearerId, { override: true });
    case "lightToggle":
      return fm.toggleLight(formation, payload.lightId);
    case "lightShield":
      return fm.toggleShield(formation, payload.lightId);
  }
}

/**
 * Put light controls on each carried light source — Light / Douse, plus Shutter
 * for a lantern. Every click goes through declareLightAction, which routes to
 * the formation's light record when the actor is in one and to the actor's own
 * flag when they are not.
 *
 * NEVER GATE THESE ON A FORMATION. A character alone with a lantern is the
 * ordinary case, not the exceptional one, and requiring a party record to hold
 * the state meant a lone character had no way to light anything at all — the
 * lantern simply showed no control. `bearerLights` already answers "whose
 * record owns this actor's lights" for every reader; the controls ask it too.
 *
 * Owner-gated like every other injector here: an observer's click could only be
 * refused GM-side, and a control that answers "request sent" then nothing is
 * worse than no control.
 */
function injectLightControls(list, actor) {
  if (!actor?.isOwner) return;
  const mine = globalThis.acksExtras?.lib?.light?.bearerLights?.(actor) ?? [];
  for (const li of list.querySelectorAll("li.item[data-item-id]")) {
    const item = actor.items.get(li.dataset.itemId);
    const type = lightTypeOf(item);
    // A light source is type `item` and has no `equipped` field — the control
    // shows on the item itself; "held" is the formation light record, below.
    if (!type || li.querySelector(".acks-equipment-light")) continue;
    // Nothing is lit inside a pack. This control names a light TYPE rather than
    // this document, so it cannot bring this lantern out on the way — the row
    // offers Take out instead, and the flame follows.
    if (containedIn(item)) continue;
    // A TORCH carried as a STACK (an `item`, not a wielded weapon) gets a "Ready"
    // control instead — but that is a pure equipment action, so it lives in
    // injectTorchReady (which runs without acks-formation). Skip it here so a
    // torch bundle never also picks up a formation Light control.
    if (type === "torch" && item.type === ITEM_TYPE.item) continue;
    const lit = mine.find((l) => l.type === type && l.lit);
    const held = lit || mine.find((l) => l.type === type && l.shielded);
    const add = (icon, key, run) => {
      const a = el("a", "item-control acks-equipment-light");
      a.innerHTML = `<i class="fas ${icon}"></i>`;
      a.dataset.tooltip = game.i18n.localize(key);
      a.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        Promise.resolve(run()).catch((err) => console.error(`${MODULE_ID} | light control failed`, err));
      });
      rowControls(li).append(a);
    };
    if (held) {
      // Douse (and re-light) the held source; shutter a lantern.
      add("fa-fire", "ACKS-EQUIPMENT.light.douse", () => declareLightAction(actor, "lightToggle", { lightId: held.id }));
      if (type === "lantern") {
        add("fa-lightbulb", "ACKS-EQUIPMENT.light.shutter", () => declareLightAction(actor, "lightShield", { lightId: held.id }));
      }
    } else {
      add("fa-fire-flame-curved", "ACKS-EQUIPMENT.light.light", () =>
        declareLightAction(actor, "light", { lightType: type, bearerId: actor.id }));
    }
  }
}

/**
 * Put a grip control on each versatile weapon's row. A versatile weapon can be
 * wielded one- or two-handed; the control shows the resolved grip and cycles
 * the player's choice (Auto → 1H → 2H). Two-handing needs both hands free — a
 * "2H" choice that cannot be honoured (a shield or second weapon is in the way)
 * shows as BLOCKED, which is the visible "check against free hands".
 */
function injectGripControls(list, loadout) {
  for (const li of list.querySelectorAll("li.item[data-item-id]")) {
    const entry = loadout.weapons.find((w) => w.item.id === li.dataset.itemId);
    if (!entry?.canTwoHand || li.querySelector(".acks-equipment-grip")) continue;
    const state = entry.gripBlocked ? "blocked" : entry.wieldTwoHanded ? "twoHand" : "oneHand";
    const label = { blocked: "2H ✗", twoHand: "2H", oneHand: "1H" }[state];
    const badge = entry.grip === "auto" ? " · auto" : "";
    const a = el("a", `item-control acks-equipment-grip acks-equipment-grip--${state}`);
    a.innerHTML = `<i class="fas fa-hands"></i> ${label}${badge}`;
    a.dataset.tooltip = game.i18n.format(
      entry.gripBlocked ? "ACKS-EQUIPMENT.grip.blocked" : "ACKS-EQUIPMENT.grip.cycle",
      { grip: game.i18n.localize(`ACKS-EQUIPMENT.grip.${entry.grip}`) },
    );
    a.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      // The flag change fires updateItem → the sheet re-renders → fresh buckets.
      cycleGrip(entry.item).catch((err) => console.error(`${MODULE_ID} | grip cycle failed`, err));
    });
    rowControls(li).append(a);
  }
}

/**
 * The box our injected controls go in — created on first use, sitting just
 * before core's own controls in the row.
 *
 * Deliberately NOT core's `.list-header__controls`: core gives that column a
 * FIXED width sized to fit exactly its own icons and nothing more
 * (`.controls__weapon { width: 84px }`, `.controls__armor { 60px }`,
 * `.controls__item { 35px }`, none of which grow). Anything we add there
 * overflows it, and because the box is centred the overflow spills past the
 * row's right edge, where the sheet clips it — which is how Delete became a
 * sliver. Widening the window never helped: the column is a fixed width, so the
 * extra space all goes to the flexible name/tag columns instead.
 *
 * With our controls in their own auto-sized box, core's column holds exactly
 * the four controls it was measured for and every one of them stays clickable.
 */
function rowControls(li) {
  const existing = li.querySelector(".acks-equipment-row-controls");
  if (existing) return existing;
  const box = el("div", "acks-equipment-row-controls");
  const row = li.querySelector(".item-row");
  if (!row) {
    li.append(box);
    return box;
  }
  row.insertBefore(box, row.querySelector(".list-header__controls"));
  return box;
}

/**
 * "Ready" control on every torch STACK (a light `item` bundle). Pulls one torch
 * out as a wieldable 1d4 light-weapon (prepareTorch) and decrements the bundle.
 * Independent of acks-formation — readying a torch is a pure equipment action —
 * so unlike the light/douse controls it renders whether or not the actor is in a
 * party formation.
 */
function injectTorchReady(tab, actor) {
  if (!actor?.isOwner) return;
  for (const li of tab.querySelectorAll("li.item[data-item-id]")) {
    const item = actor.items.get(li.dataset.itemId);
    if (item?.type !== ITEM_TYPE.item || lightTypeOf(item) !== "torch" || li.querySelector(".acks-equipment-ready")) continue;
    const a = el("a", "item-control acks-equipment-ready");
    a.innerHTML = `<i class="fas fa-fire-flame-simple"></i>`;
    a.dataset.tooltip = game.i18n.localize("ACKS-EQUIPMENT.action.readyHint");
    a.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      prepareTorch(actor, item).catch((err) => console.error(`${MODULE_ID} | ready torch failed`, err));
    });
    rowControls(li).append(a);
  }
}

/**
 * Draw / sheathe every weapon row: a wielded weapon gets a Sheathe control, a
 * carried one a Draw control — core's equip toggle with a combat verb, sitting in
 * the same control row as grip and masterwork (the "Equip / Unequip on a separate
 * button" of the grip UI brief). A thrown-away weapon is skipped: it is recovered
 * when picked up, not re-drawn.
 */
function injectDrawSheathe(tab, actor) {
  if (!actor?.isOwner) return;
  for (const li of tab.querySelectorAll("li.item[data-item-id]")) {
    const item = actor.items.get(li.dataset.itemId);
    if (item?.type !== ITEM_TYPE.weapon || li.querySelector(".acks-equipment-draw")) continue;
    if (item.getFlag?.(MODULE_ID, ITEM_FLAGS.THROWN_STATE)) continue;
    const equipped = !!item.system?.equipped;
    const a = el("a", `item-control acks-equipment-draw acks-equipment-draw--${equipped ? "sheathe" : "draw"}`);
    a.innerHTML = `<i class="fas ${equipped ? "fa-box-archive" : "fa-hand-fist"}"></i>`;
    a.dataset.tooltip = game.i18n.localize(`ACKS-EQUIPMENT.action.${equipped ? "sheathe" : "draw"}`);
    a.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      (equipped ? sheatheItem(item) : drawItem(item)).catch((err) => console.error(`${MODULE_ID} | draw/sheathe failed`, err));
    });
    rowControls(li).append(a);
  }
}

/**
 * Wear / remove control on every row core cannot equip.
 *
 * Core renders its equip toggle in the weapons and armours sections only,
 * because `system.equipped` exists on those two types alone. So a cloak, a pair
 * of gloves, an adventurer's harness and a backpack — all worn in the books —
 * have no control anywhere, and the RAW rules that ask whether they are worn
 * (harness encumbrance, gloves blocking lockpicks) could never fire. This is
 * that control.
 *
 * Only rows that DECLARE a slot get one; plain goods keep core's layout
 * untouched. A multi-slot item puts it in the first slot it declares, which is
 * the one the sheet groups it under.
 */
function injectWearControls(tab, actor) {
  if (!actor?.isOwner) return;
  for (const li of tab.querySelectorAll("li.item[data-item-id]")) {
    const item = actor.items.get(li.dataset.itemId);
    if (!item || li.querySelector(".acks-equipment-wear-toggle")) continue;
    // Core already draws a toggle wherever it owns the field.
    if (isEquippable(item) || !slotsOf(item).length) continue;
    const worn = isWorn(item);
    const slot = slotsOf(item)[0];
    const a = el("a", `item-control acks-equipment-wear-toggle acks-equipment-wear-toggle--${worn ? "remove" : "wear"}`);
    a.innerHTML = `<i class="fas ${worn ? "fa-circle-minus" : "fa-circle-plus"}"></i>`;
    a.dataset.tooltip = game.i18n.format(`ACKS-EQUIPMENT.action.${worn ? "remove" : "wear"}`, { slot: wearLabel(slot) });
    a.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      (worn ? removeItem(item) : wearItem(item, slot)).catch((err) => console.error(`${MODULE_ID} | wear toggle failed`, err));
    });
    rowControls(li).append(a);
  }
}

/**
 * Strap control on every shield row (gated on the shield-variant overlay). A
 * shield can be carried IN HAND (ready) or slung to BACK / FRONT; strapped it
 * costs no hand (RR/JJ p407), which is how a hand is freed for a torch while the
 * shield still rides. Cycles hand → back → front, skipping any position the
 * shield cannot take (a kite/phalanx shield has no back).
 */
function injectStrapControls(tab, actor) {
  if (!actor?.isOwner || !shieldOverlayEnabled()) return;
  for (const li of tab.querySelectorAll("li.item[data-item-id]")) {
    const item = actor.items.get(li.dataset.itemId);
    if (item?.type !== ITEM_TYPE.armor || item.system?.type !== "shield" || li.querySelector(".acks-equipment-strap")) continue;
    // Hand, back or front are places on the BODY. A shield in a chest is in
    // none of them, so there is no position to cycle between.
    if (containedIn(item)) continue;
    const strap = strapOf(item);
    const a = el("a", `item-control acks-equipment-strap acks-equipment-strap--${strap}`);
    a.innerHTML = `<i class="fas ${strap === "hand" ? "fa-hand" : "fa-shield-halved"}"></i> ${game.i18n.localize(`ACKS-EQUIPMENT.strap.${strap}`)}`;
    a.dataset.tooltip = game.i18n.localize("ACKS-EQUIPMENT.strap.cycle");
    a.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      cycleStrap(item).catch((err) => console.error(`${MODULE_ID} | strap cycle failed`, err));
    });
    rowControls(li).append(a);
  }
}


/**
 * Take-out control on every stowed row.
 *
 * Taking gear back out is otherwise a DRAG — the row has to be dropped on one
 * of core's type lists, which is a long gesture past every bucket in between,
 * onto a target that gives no sign it is a target until the drop lands. The
 * control performs the same write in one click.
 *
 * It takes no destination, and does not need one: `takeOut` only clears
 * `containedIn`, so the item lands loose in core's own list for its type. An
 * unworn item occupies no wear slot, so there is nothing to choose between —
 * the item sheet's Contents tab offers the same one-click control, and this is
 * that control where the gear is actually read.
 *
 * Only rendered inside a bucket whose contents are already on screen, so the
 * lock rule is inherited rather than restated: a locked container shows its
 * contents to the GM alone, and only the GM gets a control to empty it a row
 * at a time.
 */
function injectTakeOutControls(list, actor) {
  if (!actor?.isOwner) return;
  for (const li of list.querySelectorAll("li.item[data-item-id]")) {
    const item = actor.items.get(li.dataset.itemId);
    if (!item || li.querySelector(".acks-equipment-takeout")) continue;
    const a = el("a", "item-control acks-equipment-takeout");
    a.innerHTML = `<i class="fas fa-arrow-up-from-bracket"></i>`;
    a.dataset.tooltip = game.i18n.localize("ACKS-EQUIPMENT.container.takeOut");
    a.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      // The flag change fires updateItem → the sheet re-renders → fresh buckets.
      takeOut(item).catch((err) => console.error(`${MODULE_ID} | take out failed`, err));
    });
    rowControls(li).append(a);
  }
}


/** A small icon control in a container's header. */
function ctrl(icon, tooltipKey, onClick, extraClass = "") {
  const a = el("a", `item-control acks-equipment-container__ctrl ${extraClass}`.trim());
  a.innerHTML = `<i class="fas ${icon}"></i>`;
  a.dataset.tooltip = game.i18n.localize(tooltipKey);
  a.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    Promise.resolve(onClick()).catch((err) => console.error(`${MODULE_ID} | container control failed`, err));
  });
  return a;
}

/**
 * One container's header: name, load, and every control that used to live in
 * the popout window.
 *
 * The popout existed because there was nowhere else to put these. There is now:
 * the container sits on the equipment tab next to the gear it holds, and
 * "opening" it here is the same gesture as opening it at the table.
 */
function containerHeader(actor, c, onRerender) {
  const header = el("header", "acks-equipment-wear__bucket-header acks-equipment-container__header");

  // Open/collapse is the primary gesture, so the whole header toggles it — but
  // a locked container has nothing to show, so it does not pretend to open.
  const foldable = c.visible;
  const icon = el("i", `fas ${c.locked ? "fa-lock" : c.concealed ? "fa-box" : "fa-box-open"}`);
  header.append(icon, el("span", "acks-equipment-wear__bucket-label", c.item.name));

  const note = c.capacityStone ? `${st(c.load6)} / ${c.capacityStone} st` : `${st(c.load6)} st`;
  header.append(el("span", "acks-equipment-wear__bucket-note", note));

  const controls = el("div", "acks-equipment-container__controls");

  // THE LOCK IS THE JUDGE'S. Three owner controls each open a locked container
  // in one click — Unlock (there is no key item to check, so it is a free
  // pass), Empty, and Unmake — which is the whole feature undone: why pick a
  // lock you can simply click off? A player facing a locked container gets the
  // two controls that have to BEAT it, pick and bash, both of which roll. The
  // GM keeps all three, because at a table the Judge is who opens it for you
  // (including when the character legitimately holds the key).
  const mayBypassLock = !c.locked || game.user.isGM;

  if (foldable) {
    controls.append(
      ctrl(
        c.concealed ? "fa-chevron-right" : "fa-chevron-down",
        c.concealed ? "ACKS-EQUIPMENT.container.expand" : "ACKS-EQUIPMENT.container.collapse",
        async () => {
          await setConcealed(c.item, !c.concealed);
          onRerender();
        },
      ),
    );
  }

  if (actor.isOwner) {
    // Lock / unlock. Locking is always available (shutting your own box is not
    // a bypass); UNlocking is the free pass, so it follows the lock rule above.
    if (mayBypassLock) {
      controls.append(
        ctrl(c.locked ? "fa-unlock" : "fa-lock", c.locked ? "ACKS-EQUIPMENT.container.unlock" : "ACKS-EQUIPMENT.container.lock", async () => {
          if (c.locked) await setOpened(c.item, true);
          else await setLocked(c.item, true);
          onRerender();
        }),
      );
    }

    if (c.locked) {
      // Only offered when the character actually has the proficiency — a
      // control that always fails teaches nothing.
      if (canPick(actor)) {
        controls.append(
          ctrl("fa-key", "ACKS-EQUIPMENT.container.pick", async () => {
            await pickLock(actor, c.item);
            onRerender();
          }),
        );
      }
      if (canBash(actor)) {
        controls.append(
          ctrl("fa-hammer", "ACKS-EQUIPMENT.container.bash", async () => {
            // Bashing destroys the container, and a fragile one takes its
            // contents with it. That is not undoable, so it is confirmed.
            const warning = c.fragile
              ? game.i18n.format("ACKS-EQUIPMENT.container.bashConfirmFragile", { name: c.item.name })
              : game.i18n.format("ACKS-EQUIPMENT.container.bashConfirm", { name: c.item.name });
            const ok = await foundry.applications.api.DialogV2.confirm({
              classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
              window: { title: game.i18n.localize("ACKS-EQUIPMENT.container.bash") },
              content: `<p>${warning}</p>`,
              rejectClose: false,
            });
            if (ok) {
              await bashOpen(actor, c.item);
              onRerender();
            }
          }),
        );
      }
    }

    // Both of these empty the container, so both are lock bypasses.
    if (mayBypassLock) {
      controls.append(
        ctrl("fa-box-open", "ACKS-EQUIPMENT.container.empty", async () => {
          const n = await emptyContainer(actor, c.item);
          if (n) ui.notifications.info(game.i18n.format("ACKS-EQUIPMENT.container.emptied", { n, name: c.item.name }));
          onRerender();
        }),
        ctrl("fa-times", "ACKS-EQUIPMENT.container.unmake", async () => {
          await emptyContainer(actor, c.item);
          await c.item.unsetFlag(MODULE_ID, "container");
          onRerender();
        }),
      );
    }
  }

  header.append(controls);
  return header;
}

/** Build the "Stowed" section — one bucket per container, with its controls. */
function buildStowedSection(actor, tab) {
  const report = containerReport(actor);
  const section = el("section", "acks-equipment-wear acks-equipment-stowed item-list-section");
  const rerender = () => {}; // re-render is driven by the document update hooks

  const head = el("div", "acks-equipment-wear__title");
  head.append(el("span", "acks-equipment-wear__title-text", game.i18n.localize("ACKS-EQUIPMENT.wear.stowedSection")));

  // Turning gear into containers is a bulk action over the whole inventory, so
  // it stays at the section level rather than repeating on every row.
  if (actor.isOwner) {
    head.append(
      ctrl("fa-wand-magic-sparkles", "ACKS-EQUIPMENT.container.annotateAll", async () => {
        let n = 0;
        for (const item of actor.items) {
          if (item.type !== ITEM_TYPE.item || isContainer(item)) continue;
          if (await annotateItem(item)) n++;
        }
        ui.notifications.info(game.i18n.format("ACKS-EQUIPMENT.container.annotated", { n }));
      }),
    );
  }
  section.append(head);

  for (const c of report) {
    const bucket = el("div", `acks-equipment-wear__bucket acks-equipment-container${c.over ? " over" : ""}${c.locked ? " locked" : ""}`);
    bucket.dataset.dropTarget = c.item.id;
    bucket.append(containerHeader(actor, c, rerender));

    if (c.visible && !c.concealed) {
      const list = el("ul", "item-list unlist");
      const claimed = claimRows(tab, c.contents, list, "stowed");
      injectTakeOutControls(list, actor);
      bucket.append(list);
      // An empty container is a place to put things, so say so on the thing you
      // put them on. Without this the bucket is a bare header with a silent drop
      // zone under it, which reads as "broken", not "empty".
      if (!claimed) bucket.append(el("p", "acks-equipment-wear__hint", game.i18n.localize("ACKS-EQUIPMENT.container.emptyHint")));
    } else if (!c.visible) {
      // A locked container HIDES ITS CONTENTS — and a content row still sitting
      // in core's ordinary inventory list IS the contents, in plain sight. The
      // rows are claimed into a list that is never attached, so the gear is out
      // of view for whoever cannot see inside. `c.contents` is deliberately
      // empty in the report for this case, so ask the model directly.
      // The header's LOAD still shows: you cannot see inside a locked chest,
      // but you can feel that it is heavy, which is exactly right.
      claimRows(tab, contentsOf(actor, c.item.id), el("ul", "item-list unlist"), "stowed");
      // Say WHY it is empty. A locked chest showing nothing looks like a bug;
      // a locked chest saying it is locked is the game working.
      bucket.append(el("p", "acks-equipment-wear__hint", game.i18n.localize("ACKS-EQUIPMENT.container.lockedHint")));
    }

    section.append(bucket);
  }

  // With no containers at all, say how to make one rather than showing a box.
  if (!report.length) {
    const hint = el("p", "acks-equipment-wear__hint", game.i18n.localize("ACKS-EQUIPMENT.wear.noContainers"));
    section.append(hint);
  }

  // ALWAYS render, even with nothing in a bucket. The only way to fill a
  // container is to drop onto its bucket, so a section that hides until it is
  // non-empty can never become non-empty — it would take the bucket, its
  // controls, its drop zone and the create-container button with it.
  return section;
}

/**
 * Make the container buckets accept dropped gear.
 *
 * Core's own inventory rows are already draggable and emit the standard
 * `{type:"Item", uuid}` payload, so dragging from the type lists into a
 * container works without touching how core builds those rows. Dropping onto
 * the "loose" zone takes an item back out.
 */
function wireDropTargets(actor, root) {
  // The framework helper owns the drop wiring and the payload parse; a non-item
  // or non-Foundry payload reads as an empty object and falls through. Handlers
  // land by IDL property, so wiring per regroup never stacks listeners.
  new foundry.applications.ux.DragDrop.implementation({
    dropSelector: "[data-drop-target]",
    callbacks: {
      dragover: (ev) => ev.currentTarget.classList.add("drop-hover"),
      dragleave: (ev) => ev.currentTarget.classList.remove("drop-hover"),
      drop: async (ev) => {
        const zone = ev.currentTarget;
        zone.classList.remove("drop-hover");
        const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(ev);
        if (data?.type !== "Item" || !data.uuid) return;

        const item = await fromUuid(data.uuid);
        // Only this actor's own embedded items are stowed. A drop from a
        // compendium or another actor is a copy operation we deliberately
        // do not perform behind the player's back.
        if (!item || item.parent?.id !== actor.id) {
          ui.notifications.warn(game.i18n.localize("ACKS-EQUIPMENT.container.foreignItem"));
          return;
        }
        const target = zone.dataset.dropTarget;
        if (target === "loose") await takeOut(item);
        else await storeIn(actor, item, actor.items.get(target));
      },
    },
  }).bind(root);
}

function regroup(actor, tab) {
  const loadout = getLoadout(actor);
  const worn = buildWornSection(actor, tab, loadout);
  const stowed = buildStowedSection(actor, tab);
  if (!worn && !stowed) return;

  // Slot in below the encumbrance bar, above core's type lists.
  const column = tab.querySelector(".content > .flexcol") ?? tab.querySelector(".content") ?? tab;
  const anchor = column.querySelector(".encumbrance-panel");
  const after = anchor?.nextSibling ?? column.firstChild;
  for (const node of [worn, stowed].filter(Boolean)) column.insertBefore(node, after);

  // Core's own type lists are the "take it back out" target: dragging a stowed
  // item back down to the ordinary inventory un-stows it. The section belongs to
  // core, so it is also tagged with the module class: the drop-hover rendering
  // keys on that class rather than on the bare `[data-drop-target]` attribute,
  // which as a selector would reach every feature's drop zone.
  //
  // EVERY such list, never the first one found. The lists are split by item type
  // — Weapons, Armor, Items, Clothes, Money — and a player drags a rope back to
  // Items, which is where a rope lives. Wiring one of them makes un-stowing work
  // only when the gesture happens to land on whichever list core printed first,
  // and reads as a drag-out that does nothing.
  for (const loose of column.querySelectorAll(".item-list-section:not(.acks-equipment-wear)")) {
    loose.dataset.dropTarget = "loose";
    loose.classList.add("acks-equipment-drop-loose");
  }

  if (actor.isOwner) wireDropTargets(actor, column);
}

/**
 * TRAINING row — the follower card's build strip (fighting styles, weapon
 * classes, armour ladder) at the top of the Inventory tab, beside the gear it
 * governs. The strip is lib's (proficiency-strip.mjs builds it from the same
 * profile API the card reads); this only frames it as an inventory section.
 * Renders nothing when the actor has no profile to state.
 */
function injectTrainingStrip(actor, tab) {
  if (tab.querySelector(".acks-equipment-training")) return;
  const strip = profileStripElement(actor);
  if (!strip) return;
  const section = el("section", "acks-equipment-training item-list-section");
  const head = el("div", "acks-equipment-wear__title");
  head.append(el("span", "acks-equipment-wear__title-text", game.i18n.localize("ACKS-EQUIPMENT.training.section")));
  section.append(head, strip);
  const column = tab.querySelector(".content > .flexcol") ?? tab.querySelector(".content") ?? tab;
  const anchor = column.querySelector(".encumbrance-panel");
  column.insertBefore(section, anchor?.nextSibling ?? column.firstChild);
}

function onRenderCharacterSheet(app, element) {
  try {
    // `renderApplicationV2` offers EVERY ApplicationV2, and plenty of other
    // modules' windows expose an `.actor` (Paper Doll's own does) — so the gate
    // is "this is an Actor's sheet", not "this has an actor". Without it a
    // foreign window reaches the injectors below and gets dressed as a sheet.
    if (app?.document?.documentName !== "Actor" || app.document.type !== ACTOR_TYPE.character) return;
    const tab = element?.querySelector?.(".sheet-inventory");
    // Dedupe: ApplicationV2 fires a render hook per class in the chain, and we
    // listen on three of them so the system's class name can change freely.
    if (!tab || tab.querySelector(".acks-equipment-wear")) return;
    regroup(app.actor, tab);
    injectTrainingStrip(app.actor, tab); // After regroup: lands between encumbrance and Worn.
    // These controls attach to gear WHEREVER it renders — a torch stack and a
    // carried weapon stay in core's own lists, not a worn bucket — so each scans
    // the whole tab with its own per-row dedupe.
    injectLightControls(tab, app.actor); // Light a lantern/candle/torch-weapon (needs formation)
    injectTorchReady(tab, app.actor); // Ready a torch from a stack (formation-independent)
    injectDrawSheathe(tab, app.actor); // Draw / sheathe every weapon
    injectWearControls(tab, app.actor); // Wear / remove the gear core cannot equip
    injectStrapControls(tab, app.actor); // Sling a shield (overlay-gated)
    // NOTE masterwork, the scavenged condition and a shield's VARIANT describe
    // what the item IS, not how it is being carried — they live on the item
    // sheet's Details tab (item-sheet/sheet.mjs).
  } catch (err) {
    console.error(`${MODULE_ID} | inventory regrouping failed; core's layout stands`, err);
  }
}

export function registerSheet() {
  // v13/v14 ApplicationV2 fires render hooks across the inheritance chain; the
  // base-class names fire regardless of the system sheet's class name, and the
  // handler dedupes, so multiple firings are harmless.
  Hooks.on("renderApplicationV2", onRenderCharacterSheet);
  Hooks.on("renderActorSheetV2", onRenderCharacterSheet);
  Hooks.on("renderACKSCharacterSheetV2", onRenderCharacterSheet);
  console.debug(`${MODULE_ID} | inventory wear buckets registered.`);
}
