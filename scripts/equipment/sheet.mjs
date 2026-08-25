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
import { WEAR_ICONS, SHIELD_VARIANTS } from "./config.mjs";
import { getLoadout, cycleGrip, heldHandsClause } from "./loadout.mjs";
import {
  prepareTorch, rollUnarmed, setMasterwork, masterworkTiersFor, drawItem, sheatheItem,
  scavengeItem, clearScavenged, setScavengedRow, scavengedOptions, setShieldVariant, SHIELD_VARIANT_KEYS,
  setGearSlots, setGearAccess, setGearCapacity, wearItem, removeItem, SLOT_AUTO, SLOT_NONE,
} from "./actions.mjs";
import { masterworkTierOf, scavengedOf, layerSummary, silveredFlagOf } from "./properties.mjs";
import { concealVariation, removeVariation, revealVariation, variationItemsOf } from "./variation-items.mjs";
import { canBeSilvered, isSilvered, setSilvered } from "./silver.mjs";
import { classifyWeapon, isHelmet, inferGear } from "./profiles.mjs";
import { STONE, declaresSlots, slotsOf, gearOf, isWorn, isEquippable, capacityOf } from "../lib/item-model.mjs";
import { WEAR_SLOT_ORDER, ACCESS_COSTS, slotCapacity, ITEM_TYPE, ACTOR_TYPE } from "../lib/vocab.mjs";
import { profileStripElement } from "../lib/proficiency-strip.mjs";
import { cycleStrap, strapOf, variantOf, overlayEnabled as shieldOverlayEnabled } from "./overlays/shield-variants.mjs";
import { overlayEnabled as scavengedOverlayEnabled, tableFor } from "./overlays/scavenged.mjs";
import { helmetType } from "./overlays/enclosing-helm.mjs";
import { MATERIALS, MATERIALS_BY_DAMAGE_TYPE, setMaterial, materialOf } from "./overlays/item-loss.mjs";
import { wearBuckets, wearLabel } from "./wear.mjs";
import {
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
    bucket.append(bucketHeader(key, wearLabel(key)), list);
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
 * WEAPON (RR: 1d4), lanterns/candles are items — so match by name, not type. */
function lightTypeOf(item) {
  const n = String(item?.name ?? "").toLowerCase();
  if (/lantern/.test(n)) return "lantern";
  if (/torch/.test(n)) return "torch";
  if (/candle/.test(n)) return "candle";
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


/** Chat card summarising a scavenged roll (d20s + the mechanical condition). */
async function postScavengeCard(item, { rolls, cond }) {
  const mech = [];
  if (cond.attack) mech.push(`${cond.attack} attack`);
  if (cond.damage) mech.push(`${cond.damage} damage`);
  if (cond.ac) mech.push(`${cond.ac} AC`);
  if (cond.encumbrance) mech.push(`+${cond.encumbrance} stone`);
  if (cond.initiative) mech.push(`${cond.initiative} initiative`);
  if (cond.breaks) mech.push("breaks on a natural 1");
  if (cond.cannotSneak) mech.push("cannot sneak/hide");
  const labels = cond.labels.length ? cond.labels.join("; ") : "Serviceable";
  const content =
    `<div class="acks-equipment-scavenge-card"><strong>${item.name}</strong> — ` +
    `${game.i18n.localize("ACKS-EQUIPMENT.action.scavenge")} (d20: ${rolls.join(", ")})<br>${labels}` +
    `${mech.length ? `<br><em>${mech.join(", ")}</em>` : ""}` +
    `<br>${Math.round(cond.valueMultiplier * 100)}% of normal value</div>`;
  await ChatMessage.create({ content, speaker: ChatMessage.getSpeaker({ actor: item.parent }) });
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
 * Build the CONSTRUCTION panel for an item — what the item IS: masterwork, the
 * scavenged condition, material, a shield's variant, a helmet's weight, plus the
 * net-effect line. Exported for the item sheet, which mounts it under the
 * Construction rule of its Details tab (item-sheet/sheet.mjs). The spell book
 * and the named/disguise identities have their own panels there and do NOT
 * live here.
 */
export function buildConstructionPanel(item) {
  const section = el("section", "acks-equipment-props");
  const row = (labelKey, control) => {
    const g = el("div", "acks-equipment-props__row");
    g.append(el("label", "acks-equipment-props__label", labelKey ? game.i18n.localize(labelKey) : ""), control);
    section.append(g);
  };
  const guard = (fn) => Promise.resolve(fn()).catch((e) => console.error(`${MODULE_ID} | item property`, e));
  /** A small inline button (an ACTION — rolling, applying). */
  const button = (text, tooltipKey, onClick, extraClass = "") => {
    const b = el("button", `acks-equipment-props__btn ${extraClass}`.trim(), text);
    b.type = "button";
    if (tooltipKey) b.dataset.tooltip = game.i18n.localize(tooltipKey);
    b.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      guard(onClick);
    });
    return b;
  };
  // OUR CONTROLS LIVE INSIDE CORE'S <form>, and an ApplicationV2 sheet submits
  // on change: an un-stopped change event bubbles to core's delegated handler,
  // which re-renders the sheet from ITS form data — throwing away the write we
  // were in the middle of making. So every control's change is stopped here
  // before it reaches the form.
  const onChange = (node, handler) =>
    node.addEventListener("change", (ev) => {
      ev.stopPropagation();
      guard(handler);
    });
  /** A dropdown bucket — the default control for "which one is this?". */
  const select = (options, current, onPick) => {
    const s = el("select", "acks-equipment-props__select");
    s.innerHTML = options.map((o) => `<option value="${o.value}">${foundry.utils.escapeHTML?.(o.label) ?? o.label}</option>`).join("");
    s.value = current;
    onChange(s, () => onPick(s.value));
    return s;
  };

  if (item.type === ITEM_TYPE.weapon || item.type === ITEM_TYPE.armor) {
    // MASTERWORK — a bucket of the RR p159 tiers.
    const tier = masterworkTierOf(item) ?? "none";
    row("ACKS-EQUIPMENT.props.masterwork", select(
      [{ value: "none", label: game.i18n.localize("ACKS-EQUIPMENT.masterwork.none") },
        ...masterworkTiersFor(item.type).map((t) => ({ value: t, label: game.i18n.localize(`ACKS-EQUIPMENT.masterwork.${t}`) }))],
      tier,
      (v) => setMasterwork(item, v),
    ));

    // CONDITION — pick a row of the applicable scavenged table directly, or
    // roll it. Both read the reader's OWN imported table (RR p160, extracted
    // by acks-content) when the world has one; the built-in RAW table is the
    // fallback. "Pristine" clears.
    const profile = item.type === ITEM_TYPE.weapon ? classifyWeapon(item) : null;
    const tableKey = tableFor(item, profile);
    const opts = scavengedOptions(tableKey);
    const sc = scavengedOf(item);
    const cur = sc?.labels?.length === 1 ? String(opts.find((o) => o.label === sc.labels[0])?.value ?? "none") : "none";
    const picker = select(
      [{ value: "none", label: game.i18n.localize("ACKS-EQUIPMENT.props.pristine") },
        ...opts.map((o) => ({ value: String(o.value), label: o.label }))],
      cur,
      (v) => (v === "none" ? clearScavenged(item) : setScavengedRow(item, tableKey, v)),
    );
    // A stacked condition (a 19-20 reroll produced several) has no single row —
    // say so rather than showing one of them as if it were the whole story.
    if (sc?.labels?.length > 1) picker.dataset.tooltip = sc.labels.join("; ");
    const g = el("div", "acks-equipment-props__group");
    g.append(picker, button(game.i18n.localize("ACKS-EQUIPMENT.action.scavengeRoll"), "ACKS-EQUIPMENT.action.scavengeHint",
      async () => { const r = await scavengeItem(item); if (r) await postScavengeCard(item, r); }, "narrow"));
    row("ACKS-EQUIPMENT.props.condition", g);

    // Masterwork buys numbers, never eligibility: a masterwork blade still
    // cannot touch a magical monster "unless forged of a material otherwise
    // capable of doing so (e.g. silver)" (RR p159). Said here because the tier
    // picker is exactly where a reader forms the opposite impression.
    if (item.type === ITEM_TYPE.weapon && tier !== "none" && !isSilvered(item)) {
      row("", el("span", "acks-equipment-props__note", game.i18n.localize("ACKS-EQUIPMENT.props.masterworkReachNote")));
    }

    const summary = layerSummary(item);
    if (summary) row("ACKS-EQUIPMENT.props.net", el("span", "acks-equipment-props__note", summary));
  }

  // SILVER (RR ch.4) — a weapon quality, so weapons and ammunition only. "Auto"
  // hands the answer back to the weapon table and the name; picking Silvered
  // outright is what applies the 10× price, since the RAW list already charges
  // a Silver Dagger its silvered price and must not be billed twice.
  if (canBeSilvered(item)) {
    const flag = silveredFlagOf(item);
    row("ACKS-EQUIPMENT.props.silver", select(
      [{ value: "auto", label: game.i18n.format("ACKS-EQUIPMENT.props.silverAuto", {
        guess: game.i18n.localize(isSilvered(item) ? "ACKS-EQUIPMENT.props.silverYes" : "ACKS-EQUIPMENT.props.silverNo") }) },
      { value: "true", label: game.i18n.localize("ACKS-EQUIPMENT.props.silverYes") },
      { value: "false", label: game.i18n.localize("ACKS-EQUIPMENT.props.silverNo") }],
      flag === null ? "auto" : String(flag),
      (v) => setSilvered(item, v === "auto" ? "auto" : v === "true"),
    ));
    // Silver moves no number — it decides what the blade COUNTS AS. Saying so
    // stops it reading as a picker that silently does nothing.
    row("", el("span", "acks-equipment-props__note",
      game.i18n.localize(isSilvered(item)
        ? "ACKS-EQUIPMENT.props.silverNote"
        : "ACKS-EQUIPMENT.props.silverNoneNote")));
  }

  // MATERIAL (any physical item) — "Auto" clears the flag → the name/type guess.
  row("ACKS-EQUIPMENT.props.material", select(
    [{ value: "auto", label: game.i18n.format("ACKS-EQUIPMENT.props.materialAuto", { guess: materialOf(item) }) },
      ...MATERIALS.map((m) => ({ value: m, label: m }))],
    String(item.getFlag(MODULE_ID, ITEM_FLAGS.MATERIAL) ?? "auto").toLowerCase(),
    (v) => setMaterial(item, v),
  ));
  // Material has no standing modifier — it decides WHICH damage types can
  // destroy the item (JJ p398 item loss). Saying so stops it reading as a
  // setting that silently does nothing.
  const mat = materialOf(item);
  const harms = Object.entries(MATERIALS_BY_DAMAGE_TYPE).filter(([, list]) => list.includes(mat)).map(([dt]) => dt);
  row("", el("span", "acks-equipment-props__note",
    harms.length
      ? game.i18n.format("ACKS-EQUIPMENT.props.materialNote", { types: harms.join(", ") })
      : game.i18n.localize("ACKS-EQUIPMENT.props.materialNoneNote")));

  if (item.type === ITEM_TYPE.armor && item.system?.type === "shield") {
    row("ACKS-EQUIPMENT.props.variant", select(
      SHIELD_VARIANT_KEYS.map((k) => ({ value: k, label: SHIELD_VARIANTS[k]?.label ?? k })),
      item.getFlag(MODULE_ID, ITEM_FLAGS.SHIELD_VARIANT) ?? "standard",
      (v) => setShieldVariant(item, v),
    ));
  }
  if (isHelmet(item)) {
    row("ACKS-EQUIPMENT.props.helm", select(
      [{ value: "light", label: game.i18n.localize("ACKS-EQUIPMENT.helm.light") },
        { value: "heavy", label: game.i18n.localize("ACKS-EQUIPMENT.helm.heavy") }],
      helmetType(item),
      (v) => item.setFlag(MODULE_ID, ITEM_FLAGS.HELMET, v),
    ));
  }

  // WHERE IT SITS. The annotate pass infers this and is sometimes wrong, so the
  // control is the correction: "Auto" hands it back to inference, "Carried"
  // declares that it is worn nowhere — which is a real answer, and one that
  // stops the name heuristics putting a "Great Helm" back on the head.
  const inferred = inferGear(item);
  const declared = declaresSlots(item);
  const current = declared ? (slotsOf(item)[0] ?? SLOT_NONE) : SLOT_AUTO;
  const autoLabel = inferred.slots.length
    ? game.i18n.format("ACKS-EQUIPMENT.props.slotAuto", { guess: wearLabel(inferred.slots[0]) })
    : game.i18n.localize("ACKS-EQUIPMENT.props.slotAutoNone");
  row("ACKS-EQUIPMENT.props.slot", select(
    [{ value: SLOT_AUTO, label: autoLabel },
      { value: SLOT_NONE, label: game.i18n.localize("ACKS-EQUIPMENT.props.slotNone") },
      ...WEAR_SLOT_ORDER.map((k) => ({ value: k, label: wearLabel(k) }))],
    current,
    (v) => setGearSlots(item, v),
  ));
  // A slot with a capacity is the only mechanic RAW hangs on one (TT: you
  // cannot wear two of the same thing), so say what it is rather than leaving
  // the control looking decorative.
  const slotKey = declared ? slotsOf(item)[0] : inferred.slots[0];
  if (slotKey) {
    const cap = slotCapacity(slotKey);
    if (Number.isFinite(cap)) {
      row("", el("span", "acks-equipment-props__note",
        game.i18n.format("ACKS-EQUIPMENT.props.slotCapacity", { n: cap, slot: wearLabel(slotKey) })));
    }
  }

  // CAPACITY — on ANY gear, not only on things called containers. A coat with
  // hidden pockets holds a dagger; whether it does is a ruling about that coat,
  // so it is set here rather than guessed from a name. Blank = holds nothing.
  const capBox = el("input", "acks-equipment-props__input");
  capBox.type = "number";
  capBox.min = "0";
  capBox.step = "0.5";
  capBox.placeholder = game.i18n.localize("ACKS-EQUIPMENT.props.capacityNone");
  const cap = capacityOf(item);
  capBox.value = cap === null ? "" : String(cap);
  onChange(capBox, () => setGearCapacity(item, capBox.value));
  row("ACKS-EQUIPMENT.props.capacity", capBox);

  // RETRIEVAL COST — only meaningful once something can be inside it.
  if (isContainer(item)) {
    row("ACKS-EQUIPMENT.props.access", select(
      [{ value: SLOT_AUTO, label: game.i18n.localize("ACKS-EQUIPMENT.props.accessUnset") },
        ...Object.keys(ACCESS_COSTS).map((k) => ({ value: k, label: game.i18n.localize(`ACKS-EQUIPMENT.access.${k}`) }))],
      gearOf(item).access || SLOT_AUTO,
      (v) => setGearAccess(item, v),
    ));
  }

  // APPLIED VARIATIONS — the documents currently on this item. It offers no
  // choices of its own: a variation arrives by being dragged on, so this is a
  // list of what is there, not a second way to set what the controls above
  // already set. When nothing is applied it renders nothing at all.
  const applied = variationItemsOf(item);
  if (applied.length) {
    section.append(el("h4", "acks-equipment-props__head", game.i18n.localize("ACKS-EQUIPMENT.variations.applied")));
    const list = el("ul", "acks-equipment-variations");
    for (const v of applied) {
      const li = el("li", `acks-equipment-variations__row${v.system?.hidden ? " is-hidden" : ""}`);
      li.append(el("span", "acks-equipment-variations__name", v.name));
      if (v.system?.key) li.append(el("code", "acks-equipment-variations__key", v.system.key));
      if (game.user?.isGM) {
        li.append(button(
          game.i18n.localize(v.system?.hidden ? "ACKS-EQUIPMENT.variations.reveal" : "ACKS-EQUIPMENT.variations.conceal"),
          "ACKS-EQUIPMENT.variations.concealHint",
          () => (v.system?.hidden ? revealVariation(v) : concealVariation(v)),
        ));
      }
      li.append(button("×", "ACKS-EQUIPMENT.variations.removeHint", () => removeVariation(v), "is-remove"));
      list.append(li);
    }
    section.append(list);
  }
  return section;
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
