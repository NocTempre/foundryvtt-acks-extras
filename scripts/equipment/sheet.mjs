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
import { getLoadout, cycleGrip } from "./loadout.mjs";
import {
  prepareTorch, rollUnarmed, setMasterwork, masterworkTiersFor, drawItem, sheatheItem,
  scavengeItem, clearScavenged, setScavengedRow, scavengedOptions, setShieldVariant, SHIELD_VARIANT_KEYS,
} from "./actions.mjs";
import { masterworkTierOf, scavengedOf, layerSummary } from "./properties.mjs";
import { classifyWeapon } from "./profiles.mjs";
import { cycleStrap, strapOf, variantOf, overlayEnabled as shieldOverlayEnabled } from "./overlays/shield-variants.mjs";
import { overlayEnabled as scavengedOverlayEnabled, tableFor } from "./overlays/scavenged.mjs";
import { helmetType, isHelmet } from "./overlays/enclosing-helm.mjs";
import { MATERIALS, MATERIALS_BY_DAMAGE_TYPE, setMaterial, materialOf } from "./overlays/item-loss.mjs";
import { wearBuckets, wearLabel } from "./wear.mjs";
import {
  containerReport,
  contentsOf,
  STONE,
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
import { injectDollHeaderButton } from "./paperdoll.mjs";

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
  head.append(
    el(
      "span",
      `acks-equipment-wear__status${loadout.styleProficient ? "" : " advisory"}`,
      game.i18n.format("ACKS-EQUIPMENT.wear.status", {
        used: loadout.handsUsed,
        budget: loadout.handBudget,
        style: wearLabel(`style.${loadout.activeStyle}`),
      }) + style,
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
 * Put light controls on each equipped light source — Light / Douse, plus Shutter
 * for a lantern. These drive acks-formation's light state by actor (the module
 * owns it; this is the sheet-side control the two-way hook enables). No
 * formation module, or the actor is not in a party formation → no controls
 * (nothing to hold the light record). GM/owner authoritative, like the party
 * sheet's own light buttons.
 */
function injectLightControls(list, actor) {
  const fm = globalThis.acksFormation;
  if (!fm?.getFormationForActor) return;
  const formation = fm.getFormationForActor(actor.id);
  if (!formation) return;
  const mine = (formation.lights ?? []).filter((l) => l.bearerId === actor.id);
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
    if (type === "torch" && item.type === "item") continue;
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
      add("fa-fire", "ACKS-EQUIPMENT.light.douse", () => fm.toggleLight(fm.getFormationForActor(actor.id), held.id));
      if (type === "lantern") add("fa-lightbulb", "ACKS-EQUIPMENT.light.shutter", () => fm.toggleShield(fm.getFormationForActor(actor.id), held.id));
    } else {
      add("fa-fire-flame-curved", "ACKS-EQUIPMENT.light.light", () => fm.addLight(fm.getFormationForActor(actor.id), type, actor.id));
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
    if (item?.type !== "item" || lightTypeOf(item) !== "torch" || li.querySelector(".acks-equipment-ready")) continue;
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
    if (item?.type !== "weapon" || li.querySelector(".acks-equipment-draw")) continue;
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
    if (item?.type !== "armor" || item.system?.type !== "shield" || li.querySelector(".acks-equipment-strap")) continue;
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
          if (item.type !== "item" || isContainer(item)) continue;
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

  // ALWAYS render. This used to return null unless a row had actually been
  // moved into a bucket, which deadlocked the whole feature: a container you had
  // just created was empty, so the section vanished — taking with it the bucket,
  // its controls, its drop zone, and the button that creates containers. The only
  // way to fill a container is to drop onto its bucket, so a container that
  // hides until it is non-empty can never become non-empty. A bucket is content
  // whether or not anything is in it, and `moved` was never the right question.
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
  for (const zone of root.querySelectorAll("[data-drop-target]")) {
    zone.addEventListener("dragover", (ev) => {
      ev.preventDefault();
      zone.classList.add("drop-hover");
    });
    zone.addEventListener("dragleave", () => zone.classList.remove("drop-hover"));
    zone.addEventListener("drop", async (ev) => {
      ev.preventDefault();
      zone.classList.remove("drop-hover");
      let data;
      try {
        data = JSON.parse(ev.dataTransfer.getData("text/plain"));
      } catch {
        return; // not a Foundry drag payload
      }
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
    });
  }
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
  // item back down to the ordinary inventory un-stows it.
  const loose = column.querySelector(".item-list-section:not(.acks-equipment-wear)");
  if (loose) loose.dataset.dropTarget = "loose";

  if (actor.isOwner) wireDropTargets(actor, column);
}

/**
 * Build the CONSTRUCTION panel for an item — what the item IS: masterwork, the
 * scavenged condition, material, a shield's variant, a helmet's weight, plus the
 * net-effect line. Exported for the equipment item sheet, which mounts it on its
 * own Construction tab (item-sheet.mjs). The spell book (a specific item class
 * with its own Spells tab) and the identity overlays (header badges) do NOT live
 * here.
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

  if (item.type === "weapon" || item.type === "armor") {
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
    const profile = item.type === "weapon" ? classifyWeapon(item) : null;
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

    const summary = layerSummary(item);
    if (summary) row("ACKS-EQUIPMENT.props.net", el("span", "acks-equipment-props__note", summary));
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

  if (item.type === "armor" && item.system?.type === "shield") {
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
  return section;
}

function onRenderCharacterSheet(app, element) {
  try {
    // `renderApplicationV2` offers EVERY ApplicationV2, and plenty of other
    // modules' windows expose an `.actor` (Paper Doll's own does) — so the gate
    // is "this is an Actor's sheet", not "this has an actor". Without it a
    // foreign window reaches the injectors below and gets dressed as a sheet.
    if (app?.document?.documentName !== "Actor" || app.document.type !== "character") return;
    // Restore a visible Paper Doll button (self-guards on strategy + settings).
    injectDollHeaderButton(app, element);
    const tab = element?.querySelector?.(".sheet-inventory");
    // Dedupe: ApplicationV2 fires a render hook per class in the chain, and we
    // listen on three of them so the system's class name can change freely.
    if (!tab || tab.querySelector(".acks-equipment-wear")) return;
    regroup(app.actor, tab);
    // These controls attach to gear WHEREVER it renders — a torch stack and a
    // carried weapon stay in core's own lists, not a worn bucket — so each scans
    // the whole tab with its own per-row dedupe.
    injectLightControls(tab, app.actor); // Light a lantern/candle/torch-weapon (needs formation)
    injectTorchReady(tab, app.actor); // Ready a torch from a stack (formation-independent)
    injectDrawSheathe(tab, app.actor); // Draw / sheathe every weapon
    injectStrapControls(tab, app.actor); // Sling a shield (overlay-gated)
    // NOTE masterwork, the scavenged condition and a shield's VARIANT describe
    // what the item IS, not how it is being carried — they live on the item
    // sheet's Construction tab (item-sheet.mjs).
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
  // NOTE the item-sheet property panel is no longer hook-injected: the module
  // registers its own equipment item sheet (item-sheet.mjs) whose Construction
  // tab mounts buildConstructionPanel.
  console.debug(`${MODULE_ID} | inventory wear buckets registered.`);
}
