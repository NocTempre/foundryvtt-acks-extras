/**
 * Live walk, equipment-weapon-quantity: a resting weapon or armour stack is
 * offered the count controls gear has, and every list that shows a count shows
 * it. Walks docs/equipment/TESTING.md, "The item sheet", steps 18 to 25 (this
 * file's sections 1 to 8, in order), on both seats. The GM seat drives: the item sheet's Quantity (a weapon and a
 * suit of armour, the pencil, the band's count); the Equipment tab's count
 * and its tooltip, Divide through its prompt, Draw and Sheathe; the stash
 * picker and the location sheet's take-how-many through a real stash and a
 * real take; the storage manager's list; a drawn weapon and a worn suit of
 * armour, which no surface offers a count control; the Follower Card's wear
 * control; a pack's Contents list and a monster's Inventory; the market sale
 * dialog, opened as a window and submitted through its own button. The Player
 * seat opens the same Equipment tab and divides the stack from there. Machine
 * values arrive through ./_env.mjs.
 *
 * Fixtures, kept and found by marker: `equipment/s11-holder`, a character
 * every seat owns; `equipment/s11-place`, a location that holds goods and has
 * a market; `equipment/s11-monster`, a monster. Every row each carries has
 * `flags.world.fixtureItem` set to `equipment/s11`, and a step's shape deletes
 * the tagged rows by id and writes the baseline again, so each step opens on a
 * known shape and a divide, a draw or a stash leaves nothing behind. The sale
 * is the one write outside the fixtures' own rows: the coin it pays and the
 * chat cards it posts are made by the run's own client, tracked by id as they
 * appear and swept with `sweepTracked({only})`. The kept fixtures are never
 * swept.
 *
 * Not reached: a real pointer click on the Trade tab's sell control (the
 * dialog is built as `tools/live/window-contract.mjs` builds it, with the
 * place, seller and row, and the Trade tab's trader pick is not driven); the
 * character sheet's own injected Storage tab and the vehicle Hold tab, whose
 * count controls read the same `offersCount`. The sale needs the importer's
 * price tables: a world without them stops the walk blocked.
 */
import { connect, sleep } from "./_driver.mjs";
import { walkDone, blocked } from "./_walk.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const MARKS = { hero: "equipment/s11-holder", place: "equipment/s11-place", beast: "equipment/s11-monster" };
const TAG = "equipment/s11";
const N = {
  spear: "S11 spear stack",
  single: "S11 spear single",
  mail: "S11 mail stack",
  held: "S11 stash spear",
  sale: "S11 sale spear",
  pack: "S11 pack",
  packed: "S11 packed spear",
  packedOne: "S11 packed rope",
  sack: "S11 monster sack",
  rope: "S11 monster rope",
  stored: "S11 stored drawn spear",
};

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/** One baseline row; every figure is invented, and the tag is how a shape finds the walk's own rows. */
const row = (name, type, quantity, system = {}, flags = {}) => ({
  name,
  type,
  system: { quantity, equipped: false, weight6: 6, cost: 3, ...system },
  flags: { ...flags, world: { fixtureItem: TAG } },
});
const weapon = (name, quantity, system = {}) => row(name, "weapon", quantity, { damage: { base: { formula: "1d6" } }, ...system });
const HERO_ROWS = [
  weapon(N.spear, 3),
  weapon(N.single, 1),
  row(N.mail, "armor", 2, { type: "medium", ac: { value: 2 } }),
  weapon(N.held, 4),
  weapon(N.sale, 3),
  row(N.pack, "item", 1, {}, { "acks-extras": { container: {}, gear: { holds: true } } }),
];
const PACKED_ROWS = [weapon(N.packed, 3), row(N.packedOne, "item", 1)];
const BEAST_ROWS = [row(N.sack, "item", 3), row(N.rope, "item", 1)];

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in the seat's page. */
/* ------------------------------------------------------------------ */
const P = {
  install: async ({ tag }) => {
    const H = (globalThis.__s11 = globalThis.__s11 ?? {});
    H.tag = tag;
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 40, every = 150 } = {}) => {
      for (let n = 0; n < tries; n++) {
        const v = await fn();
        if (v) return v;
        await H.sleep(every);
      }
      return null;
    };
    H.root = (app) => (app?.element?.nodeType === 1 ? app.element : app?.element?.[0]) ?? null;
    H.apps = () => [...foundry.applications.instances.values()];
    H.dialogWith = (selector) => H.apps().find((a) => H.root(a)?.querySelector?.(selector)) ?? null;
    H.text = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    H.opened = H.opened ?? [];
    H.char = H.char ?? {};
    H.rows = (actor, name) =>
      actor.items
        .filter((i) => i.name === name)
        .map((i) => ({ id: i.id, qty: i.system.quantity, eq: !!i.system.equipped, in: i.getFlag("acks-extras", "containedIn") ?? null, stored: !!i.getFlag("acks-extras", "storage") }));
    // Rows of one name, read until three reads in a row agree and `want` rows stand (a divide or a fold is two writes).
    H.settled = async (actor, name, want = null) => {
      let last = "";
      let same = 0;
      for (let n = 0; n < 100 && same < 3; n++) {
        await H.sleep(200);
        const rows = H.rows(actor, name);
        const now = JSON.stringify(rows);
        same = now === last && (want === null || rows.length === want || n >= 96) ? same + 1 : 0;
        last = now;
      }
      return H.rows(actor, name);
    };
    H.closeAll = async () => {
      for (const app of H.opened.splice(0)) { try { await app.close({ force: true }); } catch { /* already closed */ } }
    };
    H.notices = [];
    if (!H.patched) {
      H.patched = true;
      H.errors = [];
      H.consoleError = console.error;
      console.error = (...args) => { H.errors.push(args.map((a) => a?.message ?? String(a)).join(" ").slice(0, 300)); H.consoleError(...args); };
      H.warn = ui.notifications.warn;
      ui.notifications.warn = function (message, ...rest) { H.notices.push(String(message)); return H.warn.call(this, message, ...rest); };
    }
    if (game.user.isGM) {
      H.S = acksExtras.lib.storage;
      H.LD = await import("/modules/acks-extras/scripts/location/data/location-data.mjs");
      H.TR = await import("/modules/acks-extras/scripts/markets/engine/trade.mjs");
      H.SD = await import("/modules/acks-extras/scripts/markets/apps/sell-dialog.mjs");
    }
    return { isGM: game.user.isGM, activeGMIsSelf: !!game.users.activeGM?.isSelf, role: game.user.role };
  },

  /** The lang strings the checks compare a rendered attribute against, formatted with the figures the driver expects. */
  strings: async ({ rest, n }) => {
    const f = (k, d) => game.i18n.format(k, d);
    return {
      countTip: f("ACKS-LIB.stack.countTip", { n }),
      drawOne: f("ACKS-EQUIPMENT.action.drawOne", { rest }),
      equipOne: f("ACKS-EQUIPMENT.action.equipOne", { rest }),
      sheathe: game.i18n.localize("ACKS-EQUIPMENT.action.sheathe"),
      unequip: game.i18n.localize("ACKS.items.Unequip"),
      divide: game.i18n.localize("ACKS-LIB.stack.divide"),
      carriedOne: f("ACKS-LIB.followerCard.carriedOne", { rest }),
      carried: game.i18n.localize("ACKS-LIB.followerCard.carried"),
      quantity: game.i18n.localize("ACKS-EQUIPMENT.itemSheet.field.quantity"),
      quantityHint: game.i18n.localize("ACKS-EQUIPMENT.itemSheet.band.quantity"),
      takePrompt: game.i18n.localize("ACKS-LOCATION.storage.quantityPrompt"),
    };
  },

  /** Delete the actor's tagged rows by id and write the baseline again; `after` rows are put inside the baseline's container. */
  shape: async ({ actorId, rows, after = [] }) => {
    const H = globalThis.__s11;
    const actor = game.actors.get(actorId);
    await H.closeAll();
    const old = actor.items.filter((i) => i.flags?.world?.fixtureItem === H.tag).map((i) => i.id);
    if (old.length) await actor.deleteEmbeddedDocuments("Item", old);
    const made = rows.length ? await actor.createEmbeddedDocuments("Item", rows) : [];
    const pack = made.find((i) => i.flags?.["acks-extras"]?.container);
    if (pack && after.length) {
      await actor.createEmbeddedDocuments("Item", after.map((d) => foundry.utils.mergeObject(d, { flags: { "acks-extras": { containedIn: pack.id } } })));
    }
    await H.sleep(500);
    const own = actor.items.filter((i) => i.flags?.world?.fixtureItem === H.tag);
    return {
      deleted: old.length,
      tagged: own.length,
      strays: actor.items.filter((i) => !i.flags?.world?.fixtureItem).length,
      ids: Object.fromEntries(own.map((i) => [i.name, i.id])),
      qty: Object.fromEntries(own.map((i) => [i.name, i.system.quantity])),
    };
  },

  /** The place: its tagged rows gone, storage on, a market with its ledger empty and a class set. */
  shapePlace: async ({ placeId }) => {
    const H = globalThis.__s11;
    const place = game.actors.get(placeId);
    await H.closeAll();
    const old = place.items.filter((i) => i.flags?.world?.fixtureItem === H.tag).map((i) => i.id);
    if (old.length) await place.deleteEmbeddedDocuments("Item", old);
    await H.S.setProvider(place, true);
    await place.update({ "system.market": H.LD.emptyMarket() });
    await place.update({ "system.market.marketClassOverride": 3 });
    await H.sleep(400);
    return { deleted: old.length, provider: H.S.isProvider(place), hasMarket: !!place.system.hasMarket, klass: place.system.marketClass ?? null, strays: place.items.filter((i) => !i.flags?.world?.fixtureItem).length };
  },

  /** Rows of one name on an actor, as the page holds them. */
  read: async ({ actorId, name, want = null }) => {
    const H = globalThis.__s11;
    return H.settled(game.actors.get(actorId), name, want);
  },

  /** One tagged document's own write: quantity, equipped, or a flag, as a hand or a sheet makes it. */
  write: async ({ actorId, itemId, changes, name = null, want = null }) => {
    const H = globalThis.__s11;
    const actor = game.actors.get(actorId);
    await actor.items.get(itemId).update(changes);
    return { rows: name ? await H.settled(actor, name, want) : [] };
  },

  /** Open the module's character sheet on its Equipment tab, never `actor.sheet`. */
  openChar: async ({ actorId }) => {
    const H = globalThis.__s11;
    const actor = game.actors.get(actorId);
    try { await H.char[actorId]?.close({ force: true }); } catch { /* not open */ }
    const app = (H.char[actorId] = new acksExtras.characterSheet.Sheet({ document: actor }));
    H.opened.push(app);
    app.tabGroups.primary = "equipment";
    await app.render(true);
    const root = await H.poll(() => { const r = H.root(app); return r?.querySelector(".acks-extras-frame__gear") ? r : null; }, { tries: 80 });
    if (root && !root.querySelector("[data-drop='slot:mainHand']")) app.changeTab("equipment", "primary");
    await H.sleep(500);
    return { rendered: !!root, sheet: app.constructor.name };
  },

  /** What one Equipment tab row draws: its count and tooltip, which controls it offers, and the name each carries. */
  rowView: async ({ actorId, itemId }) => {
    const H = globalThis.__s11;
    // The sheet redraws a beat behind the write that changed it.
    await H.sleep(700);
    const root = H.root(H.char[actorId]);
    const g = root?.querySelector(`.acks-extras-frame__gear[data-item-id="${itemId}"]`);
    if (!g) return { found: false };
    const count = g.querySelector(".acks-extras-frame__gear-name .acks-nums");
    const btn = (a) => g.querySelector(`button[data-action="${a}"]`);
    const eq = btn("toggleEquip");
    const dv = btn("divideStack");
    return {
      found: true,
      count: count ? count.textContent.trim() : null,
      countTip: count?.dataset.tooltipText ?? null,
      divide: !!dv,
      divideLabel: dv?.getAttribute("aria-label") ?? null,
      equipTip: eq?.dataset.tooltip ?? null,
      equipLabel: eq?.getAttribute("aria-label") ?? null,
      unlabelled: [...g.querySelectorAll("button[data-action]")].filter((b) => !b.getAttribute("aria-label")).length,
    };
  },

  /** Press one control on a row of the open sheet, then read the rows of `name` once they hold still. */
  press: async ({ actorId, itemId, action, name, want = null }) => {
    const H = globalThis.__s11;
    const actor = game.actors.get(actorId);
    const b = H.root(H.char[actorId])?.querySelector(`.acks-extras-frame__gear[data-item-id="${itemId}"] button[data-action="${action}"]`);
    if (!b) return { found: false };
    b.click();
    return { found: true, rows: await H.settled(actor, name, want) };
  },

  /** Press Divide on a row, read the prompt, type `count`, and press its OK. */
  divide: async ({ actorId, itemId, count, name, want }) => {
    const H = globalThis.__s11;
    const actor = game.actors.get(actorId);
    const b = H.root(H.char[actorId])?.querySelector(`.acks-extras-frame__gear[data-item-id="${itemId}"] button[data-action="divideStack"]`);
    if (!b) return { found: false };
    b.click();
    const dlg = await H.poll(() => H.dialogWith('input[name="count"]'), { tries: 50 });
    if (!dlg) return { found: true, prompt: false };
    H.opened.push(dlg);
    const input = H.root(dlg).querySelector('input[name="count"]');
    const prompt = { min: input.min, max: input.max, value: input.value, title: dlg.options?.window?.title ?? null };
    input.value = String(count);
    H.root(dlg).querySelector('button[data-action="ok"]').click();
    return { found: true, prompt, rows: await H.settled(actor, name, want) };
  },

  /** Open an item's module sheet on a tab; read Quantity, the band's count, the pencil. */
  sheetOpen: async ({ actorId, itemId, tab }) => {
    const H = globalThis.__s11;
    const item = game.actors.get(actorId).items.get(itemId);
    try { await item.sheet.close({ animate: false }); } catch { /* not open */ }
    await item.sheet.render({ force: true });
    H.opened.push(item.sheet);
    await H.poll(() => H.root(item.sheet)?.querySelector(".acks-extras-item-sheet__stack, [data-tab]"));
    try { item.sheet.changeTab(tab, "primary"); } catch { /* not offered */ }
    await H.sleep(500);
    return globalThis.__s11.sheetRead({ item });
  },
  sheetRead: ({ item }) => {
    const H = globalThis.__s11;
    const root = H.root(item.sheet);
    // The Record list: the fields that follow the rule titled Record, so the Construction panel's own fields are not mistaken for it.
    const title = [...(root?.querySelectorAll(".acks-extras-item-sheet__rule-title") ?? [])].find((t) => t.textContent.trim() === game.i18n.localize("ACKS-EQUIPMENT.itemSheet.record.title"));
    const fields = title?.closest(".acks-extras-item-sheet__rule")?.nextElementSibling ?? null;
    const first = fields?.querySelector(".acks-extras-item-sheet__field input, .acks-extras-item-sheet__field select") ?? null;
    const qty = root?.querySelector('input[name="system.quantity"]');
    const band = root?.querySelector('input[name="acksBandQty"]');
    const label = qty?.closest("label")?.querySelector(".acks-extras-item-sheet__field-label");
    return {
      rendered: !!root,
      firstName: first?.name ?? null,
      value: qty?.value ?? null,
      disabled: !!qty?.disabled,
      min: qty?.min ?? null,
      step: qty?.step ?? null,
      label: label ? label.textContent.trim() : null,
      labelTip: label?.dataset.tooltip ?? null,
      bandShown: !!band,
      bandValue: band?.value ?? null,
      armed: root?.querySelector('[data-action="edit"]')?.getAttribute("aria-pressed") ?? null,
      docQty: item.system.quantity,
    };
  },
  sheetPencil: async ({ actorId, itemId }) => {
    const H = globalThis.__s11;
    const item = game.actors.get(actorId).items.get(itemId);
    H.root(item.sheet)?.querySelector('[data-action="edit"]')?.click();
    await H.sleep(700);
    return H.sheetRead({ item });
  },
  sheetType: async ({ actorId, itemId, value }) => {
    const H = globalThis.__s11;
    const item = game.actors.get(actorId).items.get(itemId);
    const qty = H.root(item.sheet)?.querySelector('input[name="system.quantity"]');
    if (!qty) return { found: false };
    qty.value = String(value);
    qty.dispatchEvent(new Event("change", { bubbles: true }));
    await H.poll(() => item.system.quantity === value, { tries: 40 });
    await H.sleep(700);
    return { found: true, ...H.sheetRead({ item }) };
  },

  /** A pack's Contents tab: each listed row's count text and tooltip. */
  contents: async ({ actorId, packId }) => {
    const H = globalThis.__s11;
    const item = game.actors.get(actorId).items.get(packId);
    try { await item.sheet.close({ animate: false }); } catch { /* not open */ }
    await item.sheet.render({ force: true });
    H.opened.push(item.sheet);
    await H.poll(() => H.root(item.sheet)?.querySelector("[data-tab]"));
    try { item.sheet.changeTab("contents", "primary"); } catch { /* not offered: the rows read empty */ }
    await H.sleep(700);
    const rows = [...(H.root(item.sheet)?.querySelectorAll(".acks-extras-item-sheet__row") ?? [])].map((r) => ({
      name: H.text(r.querySelector(".acks-extras-item-sheet__row-name")),
      count: r.querySelector(".acks-extras-item-sheet__row-line") ? H.text(r.querySelector(".acks-extras-item-sheet__row-line")) : null,
      tip: r.querySelector(".acks-extras-item-sheet__row-line")?.dataset.tooltipText ?? null,
    }));
    return { rows };
  },

  /** The place sheet's Storage tab: every row, its count and tooltip, and the take field's presence and bounds. */
  placeRows: async ({ placeId }) => {
    const H = globalThis.__s11;
    const place = game.actors.get(placeId);
    const sheet = place.sheet;
    if (!sheet.rendered) await sheet.render({ force: true });
    H.opened.push(sheet);
    await H.poll(() => sheet.rendered && H.root(sheet));
    try { sheet.changeTab("storage", "primary"); } catch { /* not offered: the rows read empty */ }
    await H.sleep(600);
    const rows = [...(H.root(sheet)?.querySelectorAll('section[data-tab="storage"] .acks-location-row') ?? [])].map((r) => {
      const id = r.dataset.itemId;
      const take = r.querySelector(`input[data-pick="qty-${id}"]`);
      const qty = r.querySelector(".acks-location-row-qty");
      return { id, name: H.text(r.querySelector(".acks-location-row-name")), count: qty ? H.text(qty) : null, tip: qty?.dataset.tooltipText ?? null, take: !!take, takeMax: take?.max ?? null, takeLabel: take?.getAttribute("aria-label") ?? null, retrieve: !!r.querySelector('[data-action="retrieveRow"]') };
    });
    return { rows };
  },

  /** The Judge's storage manager: the rows of one place, each with its count, tooltip and take field. */
  manager: async ({ placeId }) => {
    const H = globalThis.__s11;
    const place = game.actors.get(placeId);
    for (const app of H.apps()) if (app.id === "acks-location-storage-manager") await app.close();
    const app = acksExtras.location.openStorageManager(place);
    H.opened.push(app);
    await H.poll(() => app.rendered);
    await H.sleep(700);
    const root = document.getElementById("acks-location-storage-manager");
    const rows = [...(root?.querySelectorAll("li input[type=checkbox][data-item-id]") ?? [])].map((c) => {
      const li = c.closest("li");
      const id = c.dataset.itemId;
      const qty = li.querySelector(".acks-location-row-qty");
      const take = li.querySelector(`input[data-quantity-for="${id}"]`);
      return { id, count: qty ? H.text(qty) : null, tip: qty?.dataset.tooltipText ?? null, take: !!take, takeLabel: take?.getAttribute("aria-label") ?? null };
    });
    return { rendered: !!root, rows };
  },

  /** Stash `quantity` of one hero row at the place through the Leave something here picker, as a user does. */
  stash: async ({ actorId, placeId, itemId, quantity }) => {
    const H = globalThis.__s11;
    const place = game.actors.get(placeId);
    const hero = game.actors.get(actorId);
    const sheet = place.sheet;
    if (!sheet.rendered) await sheet.render({ force: true });
    H.opened.push(sheet);
    await H.poll(() => sheet.rendered && H.root(sheet));
    try { sheet.changeTab("storage", "primary"); } catch { /* not offered: the picker is not opened */ }
    await H.sleep(500);
    const open = H.root(sheet)?.querySelector('section[data-tab="storage"] [data-action="depositHere"]');
    if (!open) return { opened: false };
    open.click();
    const dlg = await H.poll(() => H.dialogWith(".acks-location-stash-dialog"), { tries: 50 });
    if (!dlg) return { opened: true, picker: false };
    H.opened.push(dlg);
    const el = H.root(dlg);
    const source = el.querySelector('select[name="source"]');
    if (source) {
      source.value = actorId;
      source.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const box = await H.poll(() => el.querySelector(`input[name="pick_${itemId}"]`), { tries: 40 });
    if (!box) return { opened: true, picker: true, listed: false };
    const li = box.closest("li");
    const qtyEl = li.querySelector(".acks-location-pick-qty");
    const take = li.querySelector(`input[name="qty_${itemId}"]`);
    const view = { count: qtyEl ? H.text(qtyEl) : null, tip: qtyEl?.dataset.tooltipText ?? null, take: !!take, takeMax: take?.max ?? null, takeLabel: take?.getAttribute("aria-label") ?? null };
    if (quantity == null) {
      await H.closeAll();
      return { opened: true, picker: true, listed: true, ...view };
    }
    box.checked = true;
    take.value = String(quantity);
    el.querySelector('button[data-action="ok"]').click();
    await H.poll(() => H.S.storedItems(place, { ownerUuid: hero.uuid }).length > 0, { tries: 60 });
    await H.sleep(900);
    return {
      opened: true, picker: true, listed: true, ...view,
      stored: H.S.storedItems(place, { ownerUuid: hero.uuid }).map((i) => ({ id: i.id, name: i.name, qty: i.system.quantity })),
    };
  },

  /** Type `quantity` into a stored row's take field on the place sheet and press its take control. */
  takeBack: async ({ actorId, placeId, itemId, quantity, name }) => {
    const H = globalThis.__s11;
    const place = game.actors.get(placeId);
    const hero = game.actors.get(actorId);
    const r = H.root(place.sheet)?.querySelector(`section[data-tab="storage"] .acks-location-row[data-item-id="${itemId}"]`);
    const take = r?.querySelector(`input[data-pick="qty-${itemId}"]`);
    const button = r?.querySelector('[data-action="retrieveRow"]');
    if (!take || !button) return { found: false };
    take.value = String(quantity);
    button.click();
    await H.poll(() => !H.S.storedItems(place, { ownerUuid: hero.uuid }).some((i) => i.id === itemId && i.system.quantity === 3), { tries: 60 });
    await H.sleep(1000);
    return {
      found: true,
      hero: await H.settled(hero, name),
      stored: H.S.storedItems(place, { ownerUuid: hero.uuid }).map((i) => ({ id: i.id, name: i.name, qty: i.system.quantity })),
    };
  },

  /** Put a drawn row of three on the place, kept for the hero: an in-use row, stored. */
  storeInUse: async ({ actorId, placeId, name }) => {
    const H = globalThis.__s11;
    const place = game.actors.get(placeId);
    const hero = game.actors.get(actorId);
    const data = { name, type: "weapon", system: { quantity: 3, equipped: true, weight6: 6, cost: 3, damage: { base: { formula: "1d6" } } }, flags: { world: { fixtureItem: H.tag }, "acks-extras": { storage: { ownerUuid: hero.uuid, ownerName: hero.name } } } };
    const [made] = await place.createEmbeddedDocuments("Item", [data]);
    await H.sleep(500);
    return { id: made?.id ?? null };
  },

  /** The Follower Card of an actor: each named row's wear tooltip, accessible name and Divide. */
  card: async ({ actorId, itemIds }) => {
    const H = globalThis.__s11;
    const app = new acksExtras.lib.followerCard.Sheet({ document: game.actors.get(actorId) });
    H.opened.push(app);
    app.render(true);
    const root = await H.poll(() => { const r = H.root(app); return r?.querySelector(".acks-lib-follower-card") ? r : null; }, { tries: 60 });
    if (!root) return { rendered: false };
    const rows = {};
    for (const id of itemIds) {
      const wear = root.querySelector(`[data-action="fcToggleEquip"][data-item-id="${id}"]`);
      const label = wear?.closest(".acks-extras-frame__row")?.querySelector(".acks-extras-frame__row-label");
      rows[id] = {
        wear: !!wear,
        tip: wear?.dataset.tooltipText ?? null,
        aria: wear?.getAttribute("aria-label") ?? null,
        label: label ? H.text(label) : null,
        divide: !!root.querySelector(`[data-action="fcDivide"][data-stack-id="${id}"]`),
      };
    }
    return { rendered: true, editable: !!root.querySelector(".acks-lib-follower-card:not(.readonly)"), rows };
  },

  /** A monster's Inventory tab: each row's meta line, the count span in it and the span's tooltip. */
  inventory: async ({ actorId, itemIds }) => {
    const H = globalThis.__s11;
    const actor = game.actors.get(actorId);
    // A monster opens on the Follower Card by default; its Inventory tab belongs to the Full Monster sheet, opened by class as the monsters walks do.
    const Full = Object.values(CONFIG.Actor.sheetClasses.monster ?? {}).map((e) => e.cls).find((c) => c.name === "FullMonsterSheet");
    const sheet = Full ? new Full({ document: actor }) : actor.sheet;
    await sheet.render({ force: true });
    H.opened.push(sheet);
    await H.poll(() => sheet.rendered && H.root(sheet));
    try { sheet.changeTab("inventory", "primary"); } catch { /* not offered: the rows read empty */ }
    await H.sleep(700);
    const rows = {};
    for (const id of itemIds) {
      const r = H.root(sheet)?.querySelector(`li.item[data-item-id="${id}"]`);
      const span = r?.querySelector(".acksm-inv-meta [data-tooltip-text]");
      rows[id] = { row: !!r, meta: r ? H.text(r.querySelector(".acksm-inv-meta")) : null, count: span ? H.text(span) : null, tip: span?.dataset.tooltipText ?? null };
    }
    return { sheet: sheet.constructor.name, rows };
  },

  /** Whether the seller's row can be priced at this place, read before any write. */
  saleProbe: async ({ actorId, placeId, itemId }) => {
    const H = globalThis.__s11;
    const place = game.actors.get(placeId);
    const hero = game.actors.get(actorId);
    const data = hero.items.get(itemId).toObject();
    const goods = place.system.market?.goods;
    if (!goods) return { stop: "the place has no market goods" };
    const plan = H.TR.salePlan(data, { demandSteps: H.TR.demandStepsFor(goods, H.TR.categoryOf(data)) });
    if (plan.missing) return { stop: "the sale price needs an import the world lacks" };
    if (!(plan.unitCp > 0) || !(plan.bandValueGp > 0)) return { stop: "the row prices at nothing" };
    const avail = H.TR.availabilityFor(place, { itemName: data.name, costGp: plan.bandValueGp, trader: hero, direction: "sold", magic: plan.magic, magicBaseGp: plan.bandValueGp });
    if (["noMarket", "tablesMissing", "untradeable", "unavailable"].includes(avail?.status)) return { stop: `the market's availability reads ${avail.status}` };
    // The sale's own reach test, asked the way the Judge's seat asks it (no relayed user).
    const away = H.TR.awayFromMarket(hero, place, null);
    if (away) return { stop: `the seller is refused at the market (${away.error ?? "away"})` };
    return { stop: null, status: avail?.status ?? null };
  },

  /** Open the sale dialog for one row and read its Quantity field. */
  saleOpen: async ({ actorId, placeId, itemId }) => {
    const H = globalThis.__s11;
    const place = game.actors.get(placeId);
    const hero = game.actors.get(actorId);
    const app = new H.SD.SellDialog({ location: place, seller: hero, item: hero.items.get(itemId) });
    H.opened.push(app);
    await app.render({ force: true });
    await H.sleep(700);
    const qty = H.root(app)?.querySelector('input[name="qty"]');
    return {
      rendered: !!H.root(app),
      type: qty?.type ?? null,
      min: qty?.min ?? null,
      max: qty?.max ?? null,
      value: qty?.value ?? null,
      label: H.text(qty?.closest(".form-group")?.querySelector("label")),
    };
  },

  /**
   * Type `quantity` into the open dialog's field and press its Sell button,
   * then wait for the row. The coin it pays and the cards it posts are caught
   * by the run's own client for the driver to track.
   */
  saleSubmit: async ({ actorId, placeId, quantity, name, leaves }) => {
    const H = globalThis.__s11;
    const hero = game.actors.get(actorId);
    const place = game.actors.get(placeId);
    const app = H.apps().find((a) => a.constructor.name === "SellDialog");
    const before = new Set([...hero.items, ...place.items].map((i) => i.id));
    const cards = [];
    const catcher = (message, _options, userId) => { if (userId === game.user.id) cards.push({ id: message.id, actor: message.speaker?.actor ?? null, text: String(message.content ?? "") }); };
    Hooks.on("createChatMessage", catcher);
    H.notices.length = 0;
    const el = H.root(app);
    el.querySelector('input[name="qty"]').value = String(quantity);
    el.querySelector('button[type="submit"]').click();
    // The wait ends on the row, never on the warning tray: another warning is not this sale's, and a waived cap warns on a sale that lands.
    await H.poll(() => H.rows(hero, name).some((r) => r.qty === leaves), { tries: 100, every: 200 });
    await H.sleep(3000);
    Hooks.off("createChatMessage", catcher);
    const fresh = [...hero.items, ...place.items].filter((i) => !before.has(i.id) && !i.flags?.world?.fixtureItem);
    const mine = cards.filter((c) => c.actor === actorId || c.actor === placeId || c.text.includes(name));
    return {
      rows: H.rows(hero, name),
      notices: H.notices.slice(),
      newItems: fresh.map((i) => i.uuid),
      cards: mine.map((c) => `ChatMessage.${c.id}`),
      cardsNotClaimed: cards.length - mine.length,
    };
  },

  drain: async () => ({ errors: globalThis.__s11.errors.slice() }),
  restore: async () => {
    const H = globalThis.__s11;
    if (!H?.patched) return "never installed";
    await H.closeAll();
    console.error = H.consoleError;
    ui.notifications.warn = H.warn;
    H.patched = false;
    return "restored";
  },
};

/* ------------------------------------------------------------------ */
/*  Driver side                                                         */
/* ------------------------------------------------------------------ */
async function run(api, fn, ...args) {
  const text = await api.eval(`(${fn.toString()})(...${JSON.stringify(args)}).then((v) => JSON.stringify(v === undefined ? null : v))`);
  return JSON.parse(text);
}

/** Page-side helpers that are not entry points are written onto the helper object once, then called by name. */
async function plant(api) {
  await api.eval(`(() => { const H = globalThis.__s11; H.sheetRead = ${P.sheetRead.toString()}; return true; })()`);
}

async function ready(api, label, seconds = 240) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.equipment && !!globalThis.acksExtras?.characterSheet?.Sheet`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}

const drawn = (rows) => rows.filter((r) => r.eq);
const resting = (rows) => rows.filter((r) => !r.eq);
const total = (rows) => rows.reduce((n, r) => n + Number(r.qty ?? 0), 0);

const seats = {};
const products = [];
let actorId = null;
let placeId = null;
let beastId = null;
let ids = {};
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 600_000);
setTimeout(() => {
  console.error(`WALK ERROR: wall clock of ${WALL_MS} ms reached; closing the seats`);
  for (const api of Object.values(seats)) { try { api.close(); } catch {} }
  process.exit(1);
}, WALL_MS).unref();

/** Bring the hero to the baseline and answer the ids by row name; asserts the shape the step starts from. */
async function bring(gm, label) {
  const s = await run(gm, P.shape, { actorId, rows: HERO_ROWS, after: PACKED_ROWS });
  ids = s.ids;
  check(`${label}: the holder carries the baseline, tagged rows only: spear 3, single 1, mail 2, held 4, sale 3`, s.qty[N.spear] === 3 && s.qty[N.single] === 1 && s.qty[N.mail] === 2 && s.qty[N.held] === 4 && s.qty[N.sale] === 3, { qty: s.qty, deleted: s.deleted, strays: s.strays });
  return s;
}

try {
  section("seats");
  const gm = (seats.gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own }));
  note("gm ready after (s)", await ready(gm, "gm"));
  const installed = await run(gm, P.install, { tag: TAG });
  await plant(gm);
  check("the GM seat is the active GM", installed.isGM && installed.activeGMIsSelf, installed);

  section("fixtures");
  const hero = await gm.fixture(MARKS.hero, "Actor", { name: "Walk: S11 holder", type: "character", ownership: { default: 3 }, system: { scores: { str: { value: 12 } } } });
  actorId = hero.id ?? String(hero.uuid).split(".").pop();
  // Made a storage provider from its first write: the GM seat's empty-location prune runs a moment after ready and takes an empty place.
  const place = await gm.fixture(MARKS.place, "Actor", { name: "Walk: S11 place", type: "acks-extras.location", flags: { "acks-extras": { storage: { provider: true } } } });
  placeId = place.id ?? String(place.uuid).split(".").pop();
  const beast = await gm.fixture(MARKS.beast, "Actor", { name: "Walk: S11 monster", type: "monster" });
  beastId = beast.id ?? String(beast.uuid).split(".").pop();
  const T3 = await run(gm, P.strings, { rest: 2, n: 3 });

  section("sale preconditions");
  await bring(gm, "0");
  const market0 = await run(gm, P.shapePlace, { placeId });
  check("0: the place holds goods, has a market and a class", market0.provider && market0.hasMarket && market0.klass === 3, market0);
  // Read before any write that a step would be recorded over: a world that cannot price the sale stops the walk here.
  const probe = await run(gm, P.saleProbe, { actorId, placeId, itemId: ids[N.sale] });
  if (probe.stop) blocked(probe.stop);

  /* ---------------------------------------------------------------- */
  section("1. the item sheet: Quantity");
  await bring(gm, "1");
  let s = await run(gm, P.sheetOpen, { actorId, itemId: ids[N.single], tab: "details" });
  check("a resting weapon of one: Details opens with Quantity, first, reading 1, no count in the title band", s.rendered && s.firstName === "system.quantity" && s.value === "1" && !s.bandShown, s);
  check("the field is named and tipped from the band's one string, whole numbers from 0", s.label === T3.quantity && s.labelTip === T3.quantityHint && s.min === "0" && s.step === "1", { label: s.label, labelTip: s.labelTip, min: s.min, step: s.step });
  check("locked until the pencil: the field is disabled and the pencil is not pressed", s.disabled && s.armed !== "true", s);
  s = await run(gm, P.sheetPencil, { actorId, itemId: ids[N.single] });
  check("the pencil arms it: enabled, and the pencil reads pressed", !s.disabled && s.armed === "true", s);
  s = await run(gm, P.sheetType, { actorId, itemId: ids[N.single], value: 3 });
  check("typing 3 writes system.quantity 3, and the title band shows 3", s.found && s.docQty === 3 && s.value === "3" && s.bandShown && s.bandValue === "3", s);
  s = await run(gm, P.sheetPencil, { actorId, itemId: ids[N.single] });
  check("the pencil again locks it: disabled, still 3", s.disabled && s.value === "3" && s.docQty === 3, s);
  s = await run(gm, P.sheetOpen, { actorId, itemId: ids[N.mail], tab: "details" });
  check("a suit of armour: Details opens with Quantity first, reading 2, the band showing 2, locked", s.firstName === "system.quantity" && s.value === "2" && s.bandShown && s.bandValue === "2" && s.disabled, s);
  await run(gm, P.sheetPencil, { actorId, itemId: ids[N.mail] });
  s = await run(gm, P.sheetType, { actorId, itemId: ids[N.mail], value: 5 });
  check("typing 5 on the armour writes 5 and the band shows 5", s.found && s.docQty === 5 && s.value === "5" && s.bandValue === "5", s);

  /* ---------------------------------------------------------------- */
  section("2. the Equipment tab: count, Divide, Draw, Sheathe");
  await bring(gm, "2");
  const opened = await run(gm, P.openChar, { actorId });
  check("the module's own character sheet opened on the Equipment tab", opened.rendered, opened);
  let v = await run(gm, P.rowView, { actorId, itemId: ids[N.spear] });
  check("a resting spear stack of 3 reads ×3, its tooltip names the item's Quantity", v.found && v.count === "×3" && v.countTip === T3.countTip && /\b3\b/.test(v.countTip), v);
  check("it offers Divide, named for a screen reader", v.divide && v.divideLabel === T3.divide, v);
  check("Draw says it takes one and the stack keeps 2, and carries the same name", v.equipTip === T3.drawOne && v.equipLabel === T3.drawOne && /\b2\b/.test(v.equipTip), v);
  check("every state control on the row carries an aria-label", v.unlabelled === 0, v);
  let m = await run(gm, P.rowView, { actorId, itemId: ids[N.mail] });
  const T2 = await run(gm, P.strings, { rest: 1, n: 2 });
  check("the resting armour of 2 reads ×2 with its tooltip, offers Divide, and Equip says the stack keeps 1", m.count === "×2" && m.countTip === T2.countTip && m.divide && m.equipTip === T2.equipOne && /\b1\b/.test(m.equipTip), m);
  let r = await run(gm, P.divide, { actorId, itemId: ids[N.spear], count: 1, name: N.spear, want: 2 });
  check("the Divide prompt offers 1 to 2 of 3 and Divide 1 gives two resting rows, 1 and 2, side by side", r.prompt && r.prompt.min === "1" && r.prompt.max === "2" && r.rows.length === 2 && resting(r.rows).length === 2 && r.rows.map((x) => x.qty).sort().join() === "1,2" && total(r.rows) === 3, r);
  const two = r.rows.find((x) => x.qty === 2);
  r = await run(gm, P.press, { actorId, itemId: two.id, action: "toggleEquip", name: N.spear });
  check("Draw on the 2: exactly one drawn row, of 1, the row pressed; the rest rest and the whole is still 3", r.found && drawn(r.rows).length === 1 && drawn(r.rows)[0].qty === 1 && drawn(r.rows)[0].id === two.id && total(resting(r.rows)) === 2 && total(r.rows) === 3, r.rows);
  const rowsDrawn = r.rows.length;
  v = await run(gm, P.rowView, { actorId, itemId: two.id });
  check("the drawn row offers no Divide and no ×n, and its control reads Sheathe", !v.divide && v.count === null && v.equipTip === T3.sheathe && v.equipLabel === T3.sheathe, v);
  const put = await run(gm, P.write, { actorId, itemId: two.id, changes: { "system.quantity": 3 }, name: N.spear });
  v = await run(gm, P.rowView, { actorId, itemId: two.id });
  check("a drawn row whose Quantity is typed to 3 still reads ×3 with its tooltip and is still offered no Divide", put.rows.some((x) => x.id === two.id && x.qty === 3 && x.eq) && v.count === "×3" && v.countTip === T3.countTip && !v.divide, v);
  await run(gm, P.write, { actorId, itemId: two.id, changes: { "system.quantity": 1 }, name: N.spear });
  r = await run(gm, P.press, { actorId, itemId: two.id, action: "toggleEquip", name: N.spear });
  check("Sheathe folds it back: no drawn row, all three accounted for, and fewer rows than while it was drawn", r.found && drawn(r.rows).length === 0 && total(r.rows) === 3 && r.rows.length < rowsDrawn, { drawnRows: rowsDrawn, rows: r.rows });

  /* ---------------------------------------------------------------- */
  section("3. stash part of a stack, then take back 2 of 3");
  await bring(gm, "3");
  const placeShape = await run(gm, P.shapePlace, { placeId });
  check("3: the place holds goods, has a market and a class, and none of the walk's rows", placeShape.provider && placeShape.hasMarket && placeShape.klass === 3, placeShape);
  let st = await run(gm, P.stash, { actorId, placeId, itemId: ids[N.held], quantity: null });
  check("the picker lists the held stack of 4 as ×4 with the count's tooltip, and a how-many box up to 4", st.listed && st.count === "×4" && st.tip === (await run(gm, P.strings, { rest: 3, n: 4 })).countTip && st.take && st.takeMax === "4", st);
  st = await run(gm, P.stash, { actorId, placeId, itemId: ids[N.held], quantity: 3 });
  const held1 = await run(gm, P.read, { actorId, name: N.held, want: 1 });
  check("stashing 3 of 4 leaves 1 held and stores a row of 3", st.stored?.length === 1 && st.stored[0].qty === 3 && held1.length === 1 && held1[0].qty === 1 && !held1[0].stored, { stored: st.stored, held: held1 });
  const storedId = st.stored?.[0]?.id;
  let pr = await run(gm, P.placeRows, { placeId });
  let prow = pr.rows.find((x) => x.id === storedId);
  const T4 = await run(gm, P.strings, { rest: 0, n: 3 });
  check("the place sheet's Storage tab reads ×3 with the tooltip, a take field up to 3 named by its prompt, and the take control", !!prow && prow.count === "×3" && prow.tip === T4.countTip && prow.take && prow.takeMax === "3" && prow.takeLabel === T4.takePrompt && prow.retrieve, prow);
  const mgr = await run(gm, P.manager, { placeId });
  const mrow = mgr.rows.find((x) => x.id === storedId);
  check("the storage manager lists the same row ×3 with the tooltip and a take field named by its prompt", !!mrow && mrow.count === "×3" && mrow.tip === T4.countTip && mrow.take && mrow.takeLabel === T4.takePrompt, mrow ?? mgr);
  const taken = await run(gm, P.takeBack, { actorId, placeId, itemId: storedId, quantity: 2, name: N.held });
  check("taking 2 of 3 back: they fold into the held resting row, one row of 3, and 1 stays stored", taken.found && taken.hero.length === 1 && taken.hero[0].qty === 3 && !taken.hero[0].eq && taken.stored.length === 1 && taken.stored[0].qty === 1, taken);
  pr = await run(gm, P.placeRows, { placeId });
  prow = pr.rows.find((x) => x.id === storedId);
  check("the stored row of 1 reads no count: a count shows only above one", !!prow && prow.count === null, prow);

  /* ---------------------------------------------------------------- */
  section("4. a row in use is offered no count control");
  await bring(gm, "4");
  await run(gm, P.shapePlace, { placeId });
  let rr = await run(gm, P.write, { actorId, itemId: ids[N.spear], changes: { "system.equipped": true }, name: N.spear, want: 2 });
  const drawnRow = drawn(rr.rows)[0];
  await run(gm, P.write, { actorId, itemId: drawnRow.id, changes: { "system.quantity": 3 }, name: N.spear });
  rr = await run(gm, P.write, { actorId, itemId: ids[N.mail], changes: { "system.equipped": true }, name: N.mail, want: 2 });
  const wornRow = drawn(rr.rows)[0];
  await run(gm, P.write, { actorId, itemId: wornRow.id, changes: { "system.quantity": 3 }, name: N.mail });
  check("4: the shape: a drawn spear row of 3 and a worn mail row of 3", !!drawnRow && !!wornRow);
  await run(gm, P.openChar, { actorId });
  let dv = await run(gm, P.rowView, { actorId, itemId: drawnRow.id });
  let wv = await run(gm, P.rowView, { actorId, itemId: wornRow.id });
  check("Equipment tab: the drawn spear row reads ×3 and offers no Divide; the worn mail row reads ×3, offers no Divide, and its control reads Unequip", dv.count === "×3" && !dv.divide && wv.count === "×3" && !wv.divide && wv.equipTip === T3.unequip, { drawn: dv, worn: wv });
  const pick = await run(gm, P.stash, { actorId, placeId, itemId: drawnRow.id, quantity: null });
  check("the stash picker lists the drawn row as ×3 and gives it no how-many box", pick.listed && pick.count === "×3" && pick.tip === T4.countTip && !pick.take, pick);
  const inUse = await run(gm, P.storeInUse, { actorId, placeId, name: N.stored });
  const pr2 = await run(gm, P.placeRows, { placeId });
  const ur = pr2.rows.find((x) => x.id === inUse.id);
  check("the place sheet's Storage tab lists a stored drawn row as ×3 with the tooltip and no take field", !!ur && ur.count === "×3" && ur.tip === T4.countTip && !ur.take, ur);
  const mgr2 = await run(gm, P.manager, { placeId });
  const ur2 = mgr2.rows.find((x) => x.id === inUse.id);
  check("the storage manager lists it ×3 and gives it no take field", !!ur2 && ur2.count === "×3" && !ur2.take, ur2);
  const sale0 = await run(gm, P.saleOpen, { actorId, placeId, itemId: drawnRow.id });
  check("the sale dialog for the drawn row holds its quantity as a hidden field, one, with no count to choose", sale0.rendered && sale0.type === "hidden" && sale0.value === "1", sale0);
  await run(gm, P.shape, { actorId, rows: [], after: [] });

  /* ---------------------------------------------------------------- */
  section("5. the Follower Card's wear control");
  await bring(gm, "5");
  let fc = await run(gm, P.card, { actorId, itemIds: [ids[N.spear], ids[N.single]] });
  const sp = fc.rows?.[ids[N.spear]];
  const sg = fc.rows?.[ids[N.single]];
  check("a resting stack of 3: the wear control says it wears one and the stack keeps 2, and carries that name; the row reads ×3", fc.rendered && sp?.wear && sp.tip === T3.carriedOne && sp.aria === T3.carriedOne && /\b2\b/.test(sp.tip) && /×3$/.test(sp.label ?? ""), fc);
  check("a single weapon's wear control keeps the plain tooltip, which names no rest", !!sg?.wear && sg.tip === T3.carried && sg.aria === T3.carried, sg);

  /* ---------------------------------------------------------------- */
  section("6. a pack's Contents and a monster's Inventory");
  await bring(gm, "6");
  const pc = await run(gm, P.contents, { actorId, packId: ids[N.pack] });
  const pack3 = pc.rows.find((x) => x.name === N.packed);
  const pack1 = pc.rows.find((x) => x.name === N.packedOne);
  check("Contents prints ×3 beside the stored spear stack with the tooltip, and nothing beside the single rope", pack3?.count === "×3" && pack3.tip === T3.countTip && pack1 && pack1.count === null, pc);
  const bs = await run(gm, P.shape, { actorId: beastId, rows: BEAST_ROWS });
  check("6: the monster carries a sack of 3 and a rope of 1", bs.qty[N.sack] === 3 && bs.qty[N.rope] === 1, bs.qty);
  const inv = await run(gm, P.inventory, { actorId: beastId, itemIds: [bs.ids[N.sack], bs.ids[N.rope]] });
  const sack = inv.rows[bs.ids[N.sack]];
  const rope = inv.rows[bs.ids[N.rope]];
  check("the monster's Inventory prints ×3 beside the sack with the tooltip, and no count beside the rope", sack.row && sack.count === "×3" && sack.tip === T3.countTip && rope.row && rope.count === null && !/×/.test(rope.meta ?? ""), { sheet: inv.sheet, sack, rope });
  await run(gm, P.shape, { actorId: beastId, rows: [] });

  /* ---------------------------------------------------------------- */
  section("7. the Player seat");
  await bring(gm, "7");
  const player = (seats.player = await connect({ browser, origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own }));
  note("player ready after (s)", await ready(player, "player"));
  const seated = await run(player, P.install, { tag: TAG });
  await plant(player);
  check("the Player seat is no GM", !seated.isGM, seated);
  await sleep(1500);
  const popen = await run(player, P.openChar, { actorId });
  check("the Player seat opened the module's character sheet on the Equipment tab", popen.rendered, popen);
  const pv = await run(player, P.rowView, { actorId, itemId: ids[N.spear] });
  check("as a Player who owns the character: the stack reads ×3 with its tooltip, offers Divide, and Draw says the stack keeps 2", pv.found && pv.count === "×3" && pv.countTip === T3.countTip && pv.divide && pv.equipTip === T3.drawOne, pv);
  const pd = await run(player, P.divide, { actorId, itemId: ids[N.spear], count: 1, name: N.spear, want: 2 });
  const seenByGm = await run(gm, P.read, { actorId, name: N.spear, want: 2 });
  check("the Player's Divide 1 gives rows of 1 and 2, and the GM seat reads the same two", pd.prompt && pd.rows.length === 2 && pd.rows.map((x) => x.qty).sort().join() === "1,2" && seenByGm.map((x) => x.qty).sort().join() === "1,2", { player: pd.rows, gm: seenByGm });

  /* ---------------------------------------------------------------- */
  section("8. the sale dialog");
  await bring(gm, "8");
  const marketShape = await run(gm, P.shapePlace, { placeId });
  check("8: the place holds goods, has a market and a class, with its ledger empty", marketShape.provider && marketShape.hasMarket && marketShape.klass === 3, marketShape);
  const open = await run(gm, P.saleOpen, { actorId, placeId, itemId: ids[N.sale] });
  check("the dialog's Quantity field is a number from 1 to 3, with 3 named as carried", open.rendered && open.type === "number" && open.min === "1" && open.max === "3" && /3/.test(open.label), open);
  const sold = await run(gm, P.saleSubmit, { actorId, placeId, quantity: 2, name: N.sale, leaves: 1 });
  for (const uuid of [...sold.newItems, ...sold.cards]) products.push(gm.track(uuid));
  check("selling 2 of 3 leaves one row holding 1", sold.rows.length === 1 && sold.rows[0].qty === 1, { rows: sold.rows, warnings: sold.notices });
  note("sale products tracked", { items: sold.newItems.length, cards: sold.cards.length, cardsNotClaimed: sold.cardsNotClaimed });

  const drained = [await run(gm, P.drain), await run(player, P.drain)];
  check("no console error on either seat from install to the end", drained.every((d) => !d.errors.length), drained.flatMap((d) => d.errors).slice(0, 4));
  walkDone();
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err?.message ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  const gm = seats.gm;
  if (gm) {
    try {
      const swept = await gm.sweepTracked({ only: products });
      note("sweep of the run's own products", swept);
    } catch (err) { console.error("sweep:", err?.message ?? err); }
    for (const [id, rows] of [[actorId, HERO_ROWS], [beastId, BEAST_ROWS]]) {
      if (!id) continue;
      try { note("start shape restored", (await run(gm, P.shape, { actorId: id, rows, after: id === actorId ? PACKED_ROWS : [] })).qty); } catch (err) { console.error("shape restore:", err?.message ?? err); }
    }
    if (placeId) { try { note("place restored", await run(gm, P.shapePlace, { placeId })); } catch (err) { console.error("place restore:", err?.message ?? err); } }
    for (const line of gm.report?.() ?? []) console.log(line);
  }
  for (const api of Object.values(seats)) {
    try { note("restored", await run(api, P.restore)); } catch (err) { console.error("restore:", err?.message ?? err); }
  }
  for (const marker of Object.values(MARKS)) console.log(`fixture kept: ${marker}`);
  for (const api of Object.values(seats)) { try { await api.close(); } catch {} }
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
