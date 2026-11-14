/* global game, Hooks, document, ui, foundry, fromUuid */
/**
 * ACKS character-sheet integration — wear-location buckets on the Inventory tab.
 *
 * Core groups inventory strictly by ITEM TYPE (weapons / armour / items /
 * clothing / money); this shows what a character is wearing, and where, on the
 * sheet every table already has.
 *
 * Technique: core's sheet is an ApplicationV2 whose `[data-action]` handlers
 * are bound by DELEGATION on the application root, so core's own `<li>` rows are
 * MOVED into our buckets, never re-rendered, re-templated or cloned. Every core
 * control on those rows keeps working, the next re-render rebuilds core's markup
 * from scratch, and rows we do not claim stay where core put them. See
 * docs/equipment/DECISIONS.md, "Our controls get their own box in the inventory row".
 */
import { MODULE_ID, ITEM_FLAGS } from "./constants.mjs";
import { WEAR, WEAR_ICONS } from "./config.mjs";
import { getLoadout, cycleGrip, heldHandsClause } from "./loadout.mjs";
import { prepareTorch, rollUnarmed, drawItem, sheatheItem, wearItem, removeItem } from "./actions.mjs";
import { STONE, isWorn, isEquippable, isCurrency } from "../lib/item-model.mjs";
import { wearableSlots } from "./profiles.mjs";
import { armourLimitSource } from "./armour-limits.mjs";
import { ITEM_TYPE, ACTOR_TYPE } from "../lib/vocab.mjs";
import { el } from "../lib/util.mjs";
import { lightTypeOf } from "../lib/light.mjs";
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
import { ROWS_CHANGED_HOOK } from "./weapon-rows.mjs";
import { capacityTip } from "./printed-layers.mjs";
import { companionSlots, openCompanionPicker, releaseCompanion } from "../abilities/companions.mjs";

/** Stone display shared with the container app. */
function st(weight6) {
  return String(Number(weight6 / STONE).toFixed(2)).replace(/\.?0+$/, "") || "0";
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
    // Scoped to core's own lists so a row already moved is never re-claimed.
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

  const style = loadout.styleProficient ? "" : ` — ${game.i18n.localize("ACKS-EQUIPMENT.wear.untrained")}`;
  // Hands held by a torch or the mapper's kit hold nothing this section lists,
  // so the total names them.
  const held = heldHandsClause(loadout);
  const status = el(
    "span",
    `acks-equipment-wear__status${loadout.styleProficient ? "" : " advisory"}`,
    game.i18n.format("ACKS-EQUIPMENT.wear.status", {
      used: loadout.handsUsed,
      budget: loadout.handBudget,
      style: wearLabel(`style.${loadout.activeStyle}`),
    }) + (held ? ` · ${held}` : "") + style,
  );
  // Where the armour limits were read from: the import's page, the Judge's own
  // edit, or nothing yet. Composed at render, so text rather than a lang key.
  const source = armourLimitSource();
  status.dataset.tooltipText = source?.judge
    ? game.i18n.localize("ACKS-EQUIPMENT.wear.armourSourceJudge")
    : source?.cite
      ? game.i18n.format("ACKS-EQUIPMENT.wear.armourSourceCite", { cite: source.cite })
      : game.i18n.localize("ACKS-EQUIPMENT.wear.armourSourceNone");
  head.append(status);
  const limits = loadout.armourLimits ?? { blocked: [], undecided: [] };
  if (limits.blocked.length) {
    head.append(el("span", "acks-equipment-wear__status advisory", game.i18n.format("ACKS-EQUIPMENT.wear.armourBlocked", { abilities: limits.blocked.join(", ") })));
  }
  if (limits.undecided.length) {
    head.append(el("span", "acks-equipment-wear__status advisory", game.i18n.format("ACKS-EQUIPMENT.wear.armourUndecided", { abilities: limits.undecided.join(", ") })));
  }
  section.append(head);

  let moved = 0;
  for (const { key, items } of buckets) {
    const bucket = el("div", `acks-equipment-wear__bucket acks-equipment-wear__bucket--${key}`);
    const list = el("ul", "item-list unlist");
    const claimed = claimRows(tab, items, list, key);
    if (!claimed) continue;
    moved += claimed;
    injectGripControls(list, loadout);
    // A weapon in both hands is headed by the two hands it spans, with the grip
    // as the note.
    const header = key === WEAR.bothHands
      ? bucketHeader(WEAR.mainHand, `${wearLabel(WEAR.mainHand)} · ${wearLabel(WEAR.offHand)}`, wearLabel(key))
      : bucketHeader(key, wearLabel(key));
    bucket.append(header, list);
    section.append(bucket);
  }

  // Unarmed (RR p. 299): shown whenever no weapon is wielded, even for a
  // character carrying nothing.
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

/** Which light source an item is, by name (lib/light.mjs `lightTypeOf`); re-exported for the character sheet, which offers the same controls. */
export { lightTypeOf };

/**
 * The same three actions for a character in no formation, written to their own
 * actor flag. Same record shape and verbs, but no burn-down, since there is no
 * dungeon-turn clock outside a formation.
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
 * The light record lives in a formation, a **world setting only a GM may
 * write**, so a player DECLARES: `requestPartyAction` relays to the active GM's
 * client, which validates ownership against the declaring user and executes
 * there. A GM calls straight through, which keeps their own click out of the
 * public "declared" card. The formation is re-read on every click.
 *
 * @param {string} type              a party-request type: light | lightToggle | lightShield
 * @param {object} payload           `{lightType, bearerId}` to light, `{lightId}` to douse/shutter
 */
export function declareLightAction(actor, type, payload) {
  const fm = globalThis.acksExtras?.formation;
  const formation = fm?.getFormationForActor?.(actor.id);
  // No formation, no relay: a lone character's lights are a flag on their own
  // actor, so the write needs no GM and no declaration card.
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
 * Never gate these on a formation: a lone character lights their own flame.
 * `bearerLights` answers "whose record owns this actor's lights" for every
 * reader. Owner-gated like every injector here.
 */
function injectLightControls(list, actor) {
  if (!actor?.isOwner) return;
  const mine = globalThis.acksExtras?.lib?.light?.bearerLights?.(actor) ?? [];
  for (const li of list.querySelectorAll("li.item[data-item-id]")) {
    const item = actor.items.get(li.dataset.itemId);
    const type = lightTypeOf(item);
    // A light source is type `item` with no `equipped` field; "held" is the
    // formation light record, below.
    if (!type || li.querySelector(".acks-equipment-light")) continue;
    // Nothing is lit inside a pack: the control names a light TYPE, not this
    // document, so the row offers Take out instead.
    if (containedIn(item)) continue;
    // A torch STACK gets "Ready" from injectTorchReady instead, never a
    // formation Light control.
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
 * Put a grip control on each versatile weapon's row: it shows the resolved grip
 * and cycles the player's choice (Auto → 1H → 2H). A "2H" choice that cannot be
 * honoured (a shield or second weapon is in the way) shows as BLOCKED.
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
 * The box our injected controls go in, created on first use just before
 * core's own controls in the row. Never core's `.list-header__controls`, whose
 * fixed width (`.controls__weapon`, `.controls__armor`, `.controls__item`)
 * would clip anything added. See docs/equipment/DECISIONS.md, "Our controls get their own box in the inventory row".
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
 * out as a wieldable light-weapon (prepareTorch) and decrements the bundle.
 * Renders whether or not the actor is in a party formation.
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
 * carried one a Draw control (core's equip toggle with a combat verb). A
 * thrown-away weapon is skipped: it is recovered when picked up, not re-drawn.
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
 * Core renders its equip toggle on weapons and armours only, since
 * `system.equipped` exists on those two types alone; this is the control for
 * the rest (a cloak, gloves, a harness, a backpack).
 *
 * Only rows with somewhere to be worn get one, declared or inferred
 * (`wearableSlots`); plain goods keep core's layout. A multi-slot item is worn
 * in the first of its slots, the one the sheet groups it under.
 */
function injectWearControls(tab, actor) {
  if (!actor?.isOwner) return;
  for (const li of tab.querySelectorAll("li.item[data-item-id]")) {
    const item = actor.items.get(li.dataset.itemId);
    if (!item || li.querySelector(".acks-equipment-wear-toggle")) continue;
    // Core already draws a toggle wherever it owns the field.
    if (isEquippable(item) || !wearableSlots(item).length) continue;
    const worn = isWorn(item);
    const slot = wearableSlots(item)[0];
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
 * Strap control on every shield row (gated on the shield-variant overlay): a
 * shield is carried IN HAND or slung to BACK / FRONT, and strapped it costs no
 * hand (RR/JJ p407). Cycles hand → back → front, skipping any position the
 * shield cannot take.
 */
function injectStrapControls(tab, actor) {
  if (!actor?.isOwner || !shieldOverlayEnabled()) return;
  for (const li of tab.querySelectorAll("li.item[data-item-id]")) {
    const item = actor.items.get(li.dataset.itemId);
    if (item?.type !== ITEM_TYPE.armor || item.system?.type !== "shield" || li.querySelector(".acks-equipment-strap")) continue;
    // Hand, back and front are places on the BODY; a stowed shield has none.
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
 * Take-out control on every stowed row: the one-click form of dragging the row
 * onto one of core's type lists. `takeOut` only clears `containedIn`, so the
 * item lands loose in core's list for its type and no destination is needed.
 *
 * Only rendered inside a bucket whose contents are already on screen, so the
 * lock rule is inherited: a locked container shows its contents to the GM
 * alone.
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
 * One container's header: name, load, and its controls.
 */
function containerHeader(actor, c, onRerender) {
  const header = el("header", "acks-equipment-wear__bucket-header acks-equipment-container__header");

  // A locked container has nothing to show, so it does not fold.
  const foldable = c.visible;
  const icon = el("i", `fas ${c.locked ? "fa-lock" : c.concealed ? "fa-box" : "fa-box-open"}`);
  header.append(icon, el("span", "acks-equipment-wear__bucket-label", c.item.name));

  const note = c.capacityStone ? `${st(c.load6)} / ${c.capacityStone} st` : `${st(c.load6)} st`;
  const noteEl = el("span", "acks-equipment-wear__bucket-note", c.capacityUnimported ? `${note} · ${game.i18n.localize("ACKS-EQUIPMENT.printed.capacityNotImported")}` : note);
  noteEl.dataset.tooltipText = capacityTip(c.item);
  header.append(noteEl);

  const controls = el("div", "acks-equipment-container__controls");

  // The lock is the Judge's: Unlock, Empty and Unmake each open a locked
  // container in one click, so only the GM gets them; a player gets pick and
  // bash, which roll. See docs/equipment/DECISIONS.md, "The lock is the Judge's, and a player has to beat it".
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
    // Locking is always available; unlocking follows the lock rule above.
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
      // Only offered when the character has the proficiency.
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
            // Bashing destroys the container (a fragile one takes its contents
            // with it) and cannot be undone, so it is confirmed.
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

  // A bulk action over the whole inventory, so it sits at section level. Coin is
  // swept too: the same pass reads its weight declaration off its own text.
  if (actor.isOwner) {
    head.append(
      ctrl("fa-wand-magic-sparkles", "ACKS-EQUIPMENT.container.annotateAll", async () => {
        let n = 0;
        for (const item of actor.items) {
          if (!isCurrency(item) && (item.type !== ITEM_TYPE.item || isContainer(item))) continue;
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
      // An empty container says so, since a bare header over a drop zone reads
      // as broken.
      if (!claimed) bucket.append(el("p", "acks-equipment-wear__hint", game.i18n.localize("ACKS-EQUIPMENT.container.emptyHint")));
    } else if (!c.visible) {
      // A locked container hides its contents, so its rows are claimed into a
      // list that is never attached, taking them out of core's list. The
      // report's `c.contents` is empty here, so ask the model directly. The
      // header's load still shows.
      claimRows(tab, contentsOf(actor, c.item.id), el("ul", "item-list unlist"), "stowed");
      bucket.append(el("p", "acks-equipment-wear__hint", game.i18n.localize("ACKS-EQUIPMENT.container.lockedHint")));
    }

    section.append(bucket);
  }

  // With no containers at all, say how to make one.
  if (!report.length) {
    const hint = el("p", "acks-equipment-wear__hint", game.i18n.localize("ACKS-EQUIPMENT.wear.noContainers"));
    section.append(hint);
  }

  // Always renders, even with nothing in a bucket. See docs/equipment/DECISIONS.md, "Container sections always render (bug-driven)".
  return section;
}

/**
 * Make the container buckets accept dropped gear. Core's rows already emit the
 * standard `{type:"Item", uuid}` payload; dropping onto the "loose" zone takes
 * an item back out.
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
        // Only this actor's own embedded items are stowed; a drop from
        // elsewhere would be a copy, which is refused.
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

/**
 * One companion slot as an inventory row, built (a companion is not an Item)
 * in core's row anatomy: icon, name, which ability confers it, and the controls
 * (open the creature's sheet and release it, or choose one).
 */
function companionRow(actor, slot) {
  const li = el("li", "item acks-equipment-companion");
  li.dataset.abilityId = slot.item.id;
  li.dataset.slot = String(slot.index);
  const row = el("div", "item-row");
  const icon = el("div", "item__icon");
  const img = document.createElement("img");
  img.className = "item__image";
  img.src = slot.companion?.img ?? slot.item.img;
  img.alt = "";
  icon.append(img);
  const name = el("div", "item__name");
  if (slot.companion) {
    const open = el("a", "", slot.companion.name);
    open.addEventListener("click", (ev) => {
      ev.preventDefault();
      slot.companion.sheet?.render(true);
    });
    name.append(open);
  } else {
    name.append(el("span", "acks-equipment-companion__empty", game.i18n.localize("ACKS-EQUIPMENT.companion.empty")));
  }
  row.append(icon, name, el("div", "item__tags acks-equipment-companion__via", game.i18n.format("ACKS-EQUIPMENT.companion.via", { ability: slot.item.name })));
  if (actor.isOwner) {
    const controls = el("div", "list-header__controls");
    if (slot.companion) {
      controls.append(
        ctrl("fa-paw", "ACKS-EQUIPMENT.companion.open", () => slot.companion.sheet?.render(true), "acks-equipment-companion__ctrl"),
        ctrl("fa-link-slash", "ACKS-EQUIPMENT.companion.release", () => releaseCompanion(actor, slot.item, slot.index), "acks-equipment-companion__ctrl"),
      );
    } else {
      controls.append(ctrl("fa-plus", "ACKS-EQUIPMENT.companion.choose", () => openCompanionPicker(actor, slot.item, slot.index), "acks-equipment-companion__ctrl"));
    }
    row.append(controls);
  }
  li.append(row);
  return li;
}

/**
 * Build the "Companions" section — one row per slot an ability confers — or
 * null when the character holds no such ability. The slot and its pointer are
 * the abilities feature's (`abilities/companions.mjs`); this only lays them out.
 */
function buildCompanionSection(actor, tab) {
  const slots = companionSlots(actor);
  if (!slots.length) return null;
  const section = el("section", "acks-equipment-wear acks-equipment-companions item-list-section");
  const head = el("div", "acks-equipment-wear__title");
  head.append(el("span", "acks-equipment-wear__title-text", game.i18n.localize("ACKS-EQUIPMENT.companion.section")));
  section.append(head);
  const bucket = el("div", "acks-equipment-wear__bucket");
  const filled = slots.filter((s) => s.companion).length;
  bucket.append(bucketHeader(WEAR.companion, game.i18n.localize("ACKS-EQUIPMENT.companion.section"), game.i18n.format("ACKS-EQUIPMENT.companion.count", { n: filled, of: slots.length })));
  const list = el("ul", "item-list unlist");
  for (const slot of slots) list.append(companionRow(actor, slot));
  bucket.append(list);
  section.append(bucket);
  return section;
}

function regroup(actor, tab) {
  const loadout = getLoadout(actor);
  const worn = buildWornSection(actor, tab, loadout);
  const companions = buildCompanionSection(actor, tab);
  const stowed = buildStowedSection(actor, tab);
  if (!worn && !stowed && !companions) return;

  // Slot in below the encumbrance bar, above core's type lists.
  const column = tab.querySelector(".content > .flexcol") ?? tab.querySelector(".content") ?? tab;
  const anchor = column.querySelector(".encumbrance-panel");
  const after = anchor?.nextSibling ?? column.firstChild;
  for (const node of [worn, companions, stowed].filter(Boolean)) column.insertBefore(node, after);

  // Core's own type lists are the "take it back out" target. Each carries the
  // module class too, which the drop-hover rendering keys on, since the bare
  // `[data-drop-target]` selector would reach every feature's drop zone.
  // EVERY such list is wired, never the first found: they are split by item
  // type, and a drop on any of them must un-stow.
  for (const loose of column.querySelectorAll(".item-list-section:not(.acks-equipment-wear)")) {
    loose.dataset.dropTarget = "loose";
    loose.classList.add("acks-equipment-drop-loose");
  }

  if (actor.isOwner) wireDropTargets(actor, column);
}

/**
 * TRAINING row: the follower card's build strip (fighting styles, weapon
 * classes, armour ladder) at the top of the Inventory tab. The strip is lib's
 * (proficiency-strip.mjs); this only frames it as an inventory section.
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
    // `renderApplicationV2` offers EVERY ApplicationV2, and other modules'
    // windows expose an `.actor`, so the gate is "this is an Actor's sheet".
    if (app?.document?.documentName !== "Actor" || app.document.type !== ACTOR_TYPE.character) return;
    const tab = element?.querySelector?.(".sheet-inventory");
    // Dedupe: ApplicationV2 fires a render hook per class in the chain, and we
    // listen on three of them so the system's class name can change freely.
    if (!tab || tab.querySelector(".acks-equipment-wear")) return;
    regroup(app.actor, tab);
    injectTrainingStrip(app.actor, tab); // After regroup: lands between encumbrance and Worn.
    // These controls attach to gear wherever it renders (a torch stack and a
    // carried weapon stay in core's lists), so each scans the whole tab with its
    // own per-row dedupe.
    injectLightControls(tab, app.actor); // Light a lantern/candle/torch-weapon (needs formation)
    injectTorchReady(tab, app.actor); // Ready a torch from a stack (formation-independent)
    injectDrawSheathe(tab, app.actor); // Draw / sheathe every weapon
    injectWearControls(tab, app.actor); // Wear / remove the gear core cannot equip
    injectStrapControls(tab, app.actor); // Sling a shield (overlay-gated)
    // Masterwork, the scavenged condition and a shield's variant describe what
    // the item IS; they live on the item sheet's Details tab (item-sheet/sheet.mjs).
  } catch (err) {
    console.error(`${MODULE_ID} | inventory regrouping failed; core's layout stands`, err);
  }
}

/**
 * Does this window draw an answer read from the weapon rows? An actor's sheet
 * does (the weapon pills, the proficiency strip, the stats and roll panels), and
 * so does a weapon's own sheet (its snapshot, damage type, rolls and
 * construction panels).
 */
function readsWeaponRows(app) {
  const doc = app?.document;
  if (doc?.documentName === "Actor") return true;
  return doc?.documentName === "Item" && doc.type === ITEM_TYPE.weapon;
}

/**
 * Re-render every OPEN window that reads weapon rows, once. The publisher
 * announces `ROWS_CHANGED_HOOK` once per burst of publications, so a sheet
 * drawn before the first publication (a seat's first seconds after load)
 * answers from the rows afterwards without being reopened. Only a rendered
 * window is touched, and the render does not force a closed one open.
 */
export function redrawWeaponReaders() {
  for (const app of [...foundry.applications.instances.values()]) {
    if (!app?.rendered || !readsWeaponRows(app)) continue;
    try {
      Promise.resolve(app.render()).catch((err) => console.error(`${MODULE_ID} | weapon-row redraw failed`, err));
    } catch (err) {
      console.error(`${MODULE_ID} | weapon-row redraw failed`, err);
    }
  }
}

/** Hook the inventory regrouping into the character sheet's render, and the weapon-row redraw into the rows-changed hook. */
export function registerSheet() {
  // ApplicationV2 fires render hooks across the inheritance chain; the
  // base-class names fire whatever the system sheet's class is called, and the
  // handler dedupes.
  Hooks.on("renderApplicationV2", onRenderCharacterSheet);
  Hooks.on("renderActorSheetV2", onRenderCharacterSheet);
  Hooks.on("renderACKSCharacterSheetV2", onRenderCharacterSheet);
  Hooks.on(ROWS_CHANGED_HOOK, redrawWeaponReaders);
  console.debug(`${MODULE_ID} | inventory wear buckets registered.`);
}
