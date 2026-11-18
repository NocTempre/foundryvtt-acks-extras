/**
 * Live walk, treasure faces: the treasure pot's bands, backs, faces and deal
 * toggles, slice R2. Walks docs/treasure/TESTING.md "Bands, backs, faces and
 * deal toggles (both seats)". The GM seat stocks and opens pots the way a
 * Judge does; the Player seat's own client reads backs and faces, and turns
 * cards by a real press, so a flip travels the real relay. Every observable is
 * a boolean or a count. Machine values arrive through ./_env.mjs; the shared
 * seat plumbing is ./_treasure-kit.mjs.
 *
 * Covers: fixtures; step 1 (each Judge tile's band swatch and pips agree with
 * the legend and with each other, the cheapest cards are the lowest band, the
 * tiles preview bands the Cards do not yet hold); step 2 (the deal freezes
 * each band onto its Card equal to the preview, and a source item's cost
 * changed in the world moves no band on a reopened window); step 3 (the
 * Player seat's backs: the masked card and the plain card of one band share
 * icon, label, pips, band colour, accessible name and tooltip and the Card's
 * own back and suit; the detected card's back wears the aura icon and names
 * it); step 4 (turned faces: masked plain, detected plain with the Aura tag,
 * a known curse Cursed, an unknown curse the magic colour, and the Judge's
 * tiles magic or cursed, face down and face up); step 5 (the toggles by real
 * press: aria-pressed and the keyboard reach, the struck tiles, a pot of magic
 * only refused at Open, the deal, the whisper to the Judges only, the Player
 * seat not seeing it, a force-cursed item landing cursed with the curse not
 * shown, a force-cursed card identified in full landing with the curse known,
 * both toggles with the second row reading none); the panel's layout
 * wide and narrow; step 7's dress (with no texture wired, no grime, foil or
 * vignette layer in either seat's window; each back's frame, corners and
 * breaks by band, and the detected back's gold frame; with a reader wired in
 * the Player page that finds a raster for the texture side, the lowest band's
 * back carries a grime layer that thins by band, the top band none and a foil,
 * and the undetected masked back and the plain back carry the same layers;
 * the reader put back and the layers gone again).
 *
 * Fixtures, kept and found by marker: `treasure/item-plain`,
 * `treasure/item-masked-cheap`, `treasure/item-detected`,
 * `treasure/item-identified`, `treasure/item-expensive`, `treasure/coin` and
 * `treasure/player-character` (a character the Player seat owns), plus one the
 * recipe does not list, `treasure/item-identified-unknown` (identified in full,
 * cursed, the curse not known), which the recipe's "clear curseKnown and
 * repeat" needs in the same pot. Each step brings a fixture to its shape
 * before its first check. The pots, their doorway and whisper cards, and the
 * rows a Take made are the run's own, tracked by id as read back and swept by
 * id; kept fixtures stay.
 *
 * Real gestures: the doorway's Open the table, a card's flip, each toggle and
 * Open to the table are CDP mouse presses at the control's centre when the
 * control is the element under that point. Scripted: the drops (a `drop`
 * event with the data a drag of an item carries), the cost change, the
 * window's resize (setPosition), and the Take of the force-cursed check (the
 * relay called by hand).
 *
 * Scripted in step 7: the reader (`setArtReader` on the loaded module's own
 * card-art instance, in the Player page only, with a world raster the page
 * finds on a document and confirms with a request; it is put back in the step
 * and again in the teardown).
 *
 * Not reached: the reduced-motion preference, a Tab walk through the cards,
 * and a Player seat reading its back from the pile's own Card data for a
 * card it was never shown. From recipe step 7: a turned card whose item has a
 * world raster picture (framed slot) against one with a core icon (lozenge),
 * the disguise with a name and no picture (the Judge tile's leak note, and the
 * pool icon on the Player seat's face and the Card's `faces[0].img`), and the
 * header reading "In the pot" and "You found".
 */
import { connect } from "./_driver.mjs";
import { walkDone, blocked } from "./_walk.mjs";
import { MACHINE, PORTS, P as K, run, t, note, section, check, checks, clicks, idOf, openSeats, press, sleep, finish, watchdog } from "./_treasure-kit.mjs";

const MARKS = {
  plain: "treasure/item-plain",
  masked: "treasure/item-masked-cheap",
  detected: "treasure/item-detected",
  identified: "treasure/item-identified",
  unknown: "treasure/item-identified-unknown",
  expensive: "treasure/item-expensive",
  coin: "treasure/coin",
  player: "treasure/player-character",
};
const IMG = "icons/svg/item-bag.svg";
const MK = (extra) => ({ "acks-extras": { markets: { magic: true, aura: "arcane", ...extra } } });
const ITEMS = {
  plain: { name: "QA Faces Plain", type: "item", img: IMG, system: { cost: 5 } },
  detected: { name: "QA Faces Detected", type: "item", img: IMG, system: { cost: 100 }, flags: MK({ identified: "none", detected: true }) },
  identified: { name: "QA Faces Identified", type: "item", img: IMG, system: { cost: 2000 }, flags: MK({ identified: "full", detected: true, cursed: true, curseKnown: true }) },
  unknown: { name: "QA Faces Unknown", type: "item", img: IMG, system: { cost: 2000 }, flags: MK({ identified: "full", detected: true, cursed: true, curseKnown: false }) },
  expensive: { name: "QA Faces Expensive", type: "item", img: IMG, system: { cost: 500 } },
};
const TRUE_MASKED = { name: "QA Faces Masked", type: "item", img: IMG, system: { cost: 5000 }, flags: MK({ identified: "none", detected: false }) };
const APPARENT = { name: "Plain thing", img: IMG, cost: 5 };
const COIN = { name: "QA Treasure Coin", type: "money", img: "icons/svg/coins.svg", system: { coppervalue: 100, quantity: 40 } };
const LABEL = { plain: ITEMS.plain.name, masked: TRUE_MASKED.name, detected: ITEMS.detected.name, identified: ITEMS.identified.name, unknown: ITEMS.unknown.name, expensive: ITEMS.expensive.name };

const P = {
  ...K,
  maskedData: async ({ truth, apparent }) => {
    const DL = await import("/modules/acks-extras/scripts/equipment/disguise-logic.mjs");
    return DL.disguiseData(truth, apparent);
  },
  /** Bring each kept item to the paths a step needs, and say which were written. */
  shapeItems: async ({ wants, playerId, playerCharId }) => {
    const wrote = [];
    for (const [id, patch] of Object.entries(wants)) {
      const item = game.items.get(id);
      if (!item) return { ok: false, missing: id };
      const diff = {};
      for (const [path, value] of Object.entries(patch)) if (JSON.stringify(foundry.utils.getProperty(item._source, path)) !== JSON.stringify(value)) diff[path] = value;
      if (Object.keys(diff).length) { await item.update(diff); wrote.push(id); }
    }
    const pc = game.actors.get(playerCharId);
    if ((pc?.ownership?.[playerId] ?? 0) < 3) { await pc.update({ [`ownership.${playerId}`]: 3 }); wrote.push("playerOwnership"); }
    return { ok: true, wrote, playerOwns: !!pc?.testUserPermission(game.users.get(playerId), "OWNER") };
  },
  /** Wait until no copy of a doorway card is moving: the chat notification's copy slides in, and a press located on it mid-slide lands beside it. */
  settleDoor: async () => {
    const moving = () => [...document.querySelectorAll(".acks-extras-treasure-door")].some((el) => (el.closest(".message") ?? el).getAnimations({ subtree: true }).some((a) => a.playState === "running"));
    for (let n = 0; n < 40 && moving(); n++) await new Promise((r) => setTimeout(r, 100));
    return !moving();
  },
  /** Record every click that reaches a doorway's Open button, and which copy of the card it was (the chat log's, or the chat notification's). */
  watchDoorClicks: async () => {
    globalThis.__doorClicks = [];
    if (globalThis.__doorWatch) return true;
    globalThis.__doorWatch = true;
    document.addEventListener("click", (event) => {
      const btn = event.target?.closest?.(".acks-extras-treasure-door [data-action='openTable']");
      if (!btn) return;
      const copies = document.querySelectorAll(".acks-extras-treasure-door [data-action='openTable']").length;
      globalThis.__doorClicks.push({ inNotification: !!btn.closest("#chat-notifications"), inLog: !!btn.closest(".chat-log"), copies, connected: btn.isConnected });
    }, true);
    return true;
  },
  /** Why a seat's doorway press opened no window: the seat's sight of the pile, the sheet's state, the last notifications shown, and the clicks the doorway heard. */
  doorDiag: async ({ potId }) => {
    const pile = game.cards.get(potId);
    return {
      clicks: globalThis.__doorClicks ?? null,
      copies: [...document.querySelectorAll(".acks-extras-treasure-door [data-action='openTable']")].map((b) => (b.closest("#chat-notifications") ? "notification" : b.closest(".chat-log") ? "log" : "other")),
      limited: pile ? pile.testUserPermission(game.user, "LIMITED") : null,
      own: pile?.ownership?.[game.user.id] ?? null,
      byDefault: pile?.ownership?.default ?? null,
      sheet: pile?.sheet ? { rendered: !!pile.sheet.rendered, state: pile.sheet.state ?? null } : null,
      shown: [...document.querySelectorAll("#notifications li, #notifications .notification")].map((li) => li.textContent.replace(/\s+/g, " ").trim()).slice(-5),
    };
  },
  setCost: async ({ id, cost }) => { await game.items.get(id).update({ "system.cost": cost }); return game.items.get(id).system.cost; },
  /** The pot window's tiles or slots, for either seat. */
  tiles: async ({ potId }) => {
    const H = globalThis.__tk;
    const root = H.root(H.sheet(potId));
    if (!root) return { rendered: false };
    const m = (el, re) => (el?.className ?? "").toString().match(re)?.[1] ?? null;
    const items = [...root.querySelectorAll("ol.acks-extras-treasure__grid > li[data-card-id]")].map((li) => {
      const judge = li.matches(".acks-extras-treasure-card--judge");
      const back = li.querySelector(".acks-extras-treasure-back");
      const face = judge ? li : li.querySelector(".acks-extras-treasure-card");
      const swatch = li.querySelector(".acks-extras-treasure__swatch");
      const bandN = back ? m(back, /is-band-(\d)/) : m(swatch, /is-band-(\d)/);
      return {
        id: li.dataset.cardId, judge, down: !!back,
        look: m(face, /is-look-(\w+)/),
        band: bandN === null ? null : Number(bandN),
        pips: H.text(back ? back.querySelector(".acks-extras-treasure-back__pips") : li.querySelector(".acks-extras-treasure__pips")),
        pipsLabel: li.querySelector(".acks-extras-treasure__pips")?.getAttribute("aria-label") ?? null,
        icon: back?.querySelector("img")?.getAttribute("src") ?? null,
        ariaBack: back?.getAttribute("aria-label") ?? null,
        tip: back?.dataset.tooltipText ?? null,
        poolTag: H.text(back ? back.querySelector(".acks-extras-treasure-back__pool") : li.querySelector(".acks-extras-treasure-card__tag span")),
        name: H.text(li.querySelector(".acks-extras-treasure-card__name")),
        aura: !!li.querySelector(".acks-tag"),
        struck: li.className.includes("is-struck"),
        warns: [...li.querySelectorAll(".acks-extras-treasure-card__warn")].map(H.text),
        flip: !!li.querySelector("[data-action='flip']"),
      };
    });
    return { rendered: true, items, legend: [...root.querySelectorAll(".acks-extras-treasure__legend-item")].map(H.text), text: H.text(root) };
  },
  /** The deal toggles as a keyboard and a reader meet them, and where the panel stands. */
  toggleRead: async ({ potId }) => {
    const H = globalThis.__tk;
    const root = H.root(H.sheet(potId));
    const side = root?.querySelector(".acks-extras-treasure__toggles");
    const main = root?.querySelector(".acks-extras-treasure__main");
    if (!side || !main) return { found: false };
    const rect = (el) => { const r = el.getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom) }; };
    const buttons = [...side.querySelectorAll("button[data-action='toggleDeal']")];
    const focusable = buttons.map((b) => { b.focus(); return document.activeElement === b; });
    return {
      found: true,
      buttons: buttons.map((b) => ({ key: b.dataset.toggle, pressed: b.getAttribute("aria-pressed"), tab: b.tabIndex, named: H.text(b).length > 0 })),
      focusable,
      side: rect(side),
      main: rect(main),
      right: rect(side).left >= rect(main).right - 1,
      below: rect(side).top >= rect(main).bottom - 1,
    };
  },
  resize: async ({ potId, width, height }) => {
    const H = globalThis.__tk;
    H.sheet(potId).setPosition({ width, height });
    await H.sleep(700);
    return true;
  },
  watchChat: async () => {
    const H = globalThis.__tk;
    H.chatSeen = [];
    H.chatHook = Hooks.on("createChatMessage", (m, _o, userId) => {
      if (userId !== game.user.id) return;
      H.chatSeen.push({ id: m.id, whisper: [...(m.whisper ?? [])], door: !!m.flags?.["acks-extras"]?.treasure?.uuid, text: (m.content ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(), rows: (m.content ?? "").split("<li>").length - 1 });
    });
    return true;
  },
  readChat: async () => {
    const H = globalThis.__tk;
    if (H.chatHook != null) { Hooks.off("createChatMessage", H.chatHook); H.chatHook = null; }
    return { seen: H.chatSeen ?? [], gmIds: game.users.filter((u) => u.isGM).map((u) => u.id) };
  },
  /** A message as this seat holds and renders it. */
  messageFor: async ({ id }) => {
    const m = game.messages.get(id);
    return { inCollection: !!m, visible: m ? !!m.visible : null, rendered: !!document.querySelector(`[data-message-id='${id}']`) };
  },
  /** The texture layers standing in the pot's window. */
  windowLayers: async ({ potId }) => {
    const H = globalThis.__tk;
    const root = H.root(H.sheet(potId));
    if (!root) return { rendered: false };
    const n = (sel) => root.querySelectorAll(sel).length;
    return { rendered: true, grime: n(".acks-extras-treasure-grime"), foil: n(".acks-extras-treasure-foil"), vignette: n(".acks-extras-treasure-vignette"), backs: n(".acks-extras-treasure-back") };
  },
  /** Each face-down card's back as dressed: band, frame, corners, breaks, grime step, foil, and its classes and layers as strings. */
  backLayers: async ({ potId }) => {
    const H = globalThis.__tk;
    const root = H.root(H.sheet(potId));
    if (!root) return { rendered: false, backs: [] };
    const backs = [...root.querySelectorAll("li[data-card-id]")].map((li) => {
      const back = li.querySelector(".acks-extras-treasure-back");
      if (!back) return { id: li.dataset.cardId, down: false };
      const cls = back.className.toString();
      const m = (re) => cls.match(re)?.[1] ?? null;
      const grimeEl = back.querySelector(".acks-extras-treasure-grime");
      return {
        id: li.dataset.cardId,
        down: true,
        band: Number(m(/is-band-(\d)/)),
        frame: m(/is-frame-(\w+)/),
        corners: !!back.querySelector(".acks-extras-treasure-corners"),
        breaks: !!back.querySelector(".acks-extras-treasure-breaks"),
        grime: grimeEl ? Number(grimeEl.className.toString().match(/is-grime-(\d)/)?.[1]) : null,
        foil: !!back.querySelector(".acks-extras-treasure-foil"),
        cls,
        layers: [...back.children].map((c) => c.className.toString()).join("|"),
      };
    });
    return { rendered: true, backs };
  },
  /** A raster the world holds, confirmed to be served: a document's picture, else nothing. The path stays in the page. */
  findRaster: async () => {
    const H = globalThis.__tk;
    const seen = new Set();
    for (const coll of [game.items, game.actors]) for (const d of coll) if (typeof d.img === "string") seen.add(d.img);
    const raster = [...seen].filter((p) => /\.(png|jpe?g|webp|avif|gif)$/i.test(p.split(/[?#]/)[0]) && !/^(data:|https?:|\/\/)/i.test(p));
    for (const p of raster.slice(0, 40)) {
      try {
        const r = await fetch(p.startsWith("/") ? p : "/" + p, { method: "HEAD" });
        if (r.ok) { H.raster = p; return { found: true, tried: raster.length }; }
      } catch { /* the next one */ }
    }
    return { found: false, tried: raster.length };
  },
  /** Wire a reader that finds the raster for the texture side and nothing for any other, on this page's loaded card-art module. */
  wireArt: async () => {
    const H = globalThis.__tk;
    H.CA = await import("/modules/acks-extras/scripts/treasure/card-art.mjs");
    H.CA.setArtReader(({ side }) => (side === "texture" ? H.raster : null));
    H.artWired = true;
    return true;
  },
  /** Put the reader back to no art. Safe to call on a page that never wired one. */
  unwireArt: async () => {
    const H = globalThis.__tk;
    if (H?.CA) H.CA.setArtReader(null);
    if (H) H.artWired = false;
    return true;
  },
  /** The Player's item sheet of a row, read for any mention of a curse. */
  curseOnSheet: async ({ actorId, itemId }) => {
    const H = globalThis.__tk;
    const item = game.actors.get(actorId)?.items.get(itemId);
    if (!item) return { rendered: false };
    await item.sheet.render(true);
    H.opened.push(item.sheet);
    await H.poll(() => H.root(item.sheet)?.querySelector(".window-title"), { tries: 40, every: 200 });
    await H.sleep(600);
    const root = H.root(item.sheet);
    if (!root) return { rendered: false };
    return { rendered: true, curseNode: !!root.querySelector("[class*='curse'], [data-mount='curse']"), cursedWord: H.text(root).toLowerCase().includes(H.t("card.cursed").toLowerCase()) };
  },
};

let gm = null;
let player = null;
const made = [];
watchdog(() => [gm, player]);

const byLabel = (stage) => Object.fromEntries(Object.entries(LABEL).map(([k, label]) => [k, stage.cards.find((c) => c.label === label)?.id ?? null]));

try {
  section("seats");
  gm = await connect({ browser: MACHINE.browser, origin: MACHINE.origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  player = await connect({ browser: MACHINE.browser, origin: MACHINE.origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  await openSeats({ gm, player, blocked, pattern: /treasure|pot-sheet|pot-relay|pot-logic|doorway|\/pot\.mjs|hoard/i });

  section("fixtures");
  const playerId = await run(gm, P.userId, { name: MACHINE.player });
  const fx = {};
  for (const key of ["plain", "detected", "identified", "unknown", "expensive"]) fx[key] = await gm.fixture(MARKS[key], "Item", ITEMS[key]);
  const maskedWant = await run(gm, P.maskedData, { truth: TRUE_MASKED, apparent: APPARENT });
  fx.masked = await gm.fixture(MARKS.masked, "Item", maskedWant);
  fx.coin = await gm.fixture(MARKS.coin, "Item", COIN);
  const fxPlayer = await gm.fixture(MARKS.player, "Actor", { name: "QA Treasure Player Character", type: "character", prototypeToken: { actorLink: true }, ownership: { default: 0, [playerId]: 3 } });
  const wants = {};
  for (const key of ["plain", "detected", "identified", "unknown", "expensive"]) {
    const patch = { name: ITEMS[key].name, "system.cost": ITEMS[key].system.cost };
    for (const [k, v] of Object.entries(ITEMS[key].flags?.["acks-extras"]?.markets ?? {})) patch[`flags.acks-extras.markets.${k}`] = v;
    wants[idOf(fx[key])] = patch;
  }
  wants[idOf(fx.masked)] = { name: APPARENT.name, "system.cost": APPARENT.cost, "flags.acks-extras.disguise": maskedWant.flags["acks-extras"].disguise, "flags.acks-extras.markets.magic": true, "flags.acks-extras.markets.identified": "none", "flags.acks-extras.markets.detected": false };
  wants[idOf(fx.coin)] = { "system.quantity": COIN.system.quantity, "system.coppervalue": COIN.system.coppervalue };
  const shaped = await run(gm, P.shapeItems, { wants, playerId, playerCharId: idOf(fxPlayer) });
  check("the kept fixtures stand in the shape the steps start from: the plain item cheap, the masked one disguised as a cost-5 plain item, the detected one detected, the identified pair cursed (one known), and the Player seat owns its character", shaped.ok && shaped.playerOwns, shaped);
  const uuid = (k) => fx[k].uuid;
  const DROP = ["plain", "masked", "detected", "identified", "unknown", "expensive", "coin"];

  /** Make a pot and stock it with the named fixtures, in that order; returns its handle. */
  const stock = async (keys) => {
    const pot = await run(gm, P.newPot);
    if (!pot) throw new Error("no pot window opened on the GM seat");
    made.push(gm.track(pot.uuid, "Cards"));
    for (const k of keys) {
      const d = await run(gm, P.dropAndWait, { potId: pot.potId, zone: "pot", uuid: uuid(k) });
      if (!d.ok) throw new Error(`the drop of ${k} made no card`);
    }
    return pot;
  };

  section("Step 1. bands and pips on the Judge's tiles");
  const pot1 = await stock(DROP);
  const s1 = await run(gm, P.stage, { potId: pot1.potId });
  const ids1 = byLabel(s1);
  const coinId = s1.cards.find((c) => c.pool === "coins")?.id;
  const tiles1 = await run(gm, P.tiles, { potId: pot1.potId });
  const bandNames = [await t(gm, "band.0"), await t(gm, "band.1"), await t(gm, "band.2"), await t(gm, "band.3")];
  const tileOf = (tiles, id) => tiles.items.find((x) => x.id === id);
  const preview = Object.fromEntries(tiles1.items.map((x) => [x.id, x.band]));
  check("the window's legend names the four bands Low, Middling, High and Highest, in order", tiles1.legend.join("|") === bandNames.join("|"), tiles1.legend);
  check("seven Judge tiles, each with a swatch band, pips of band plus one marks and an accessible name that is its band's name", tiles1.items.length === 7 && tiles1.items.every((x) => x.judge && Number.isInteger(x.band) && x.pips === "◆".repeat(x.band + 1) && x.pipsLabel === bandNames[x.band]), tiles1.items.map((x) => [x.band, x.pips.length]));
  check("the lowest-worth cards, the plain cost-5 item and the masked item whose mask costs 5, are band Low and share it", tileOf(tiles1, ids1.plain)?.band === 0 && tileOf(tiles1, ids1.masked)?.band === 0, { plain: tileOf(tiles1, ids1.plain)?.band, masked: tileOf(tiles1, ids1.masked)?.band });
  check("the cards fall into at least three distinct bands, and the dearest items sit above the cheapest", new Set(tiles1.items.map((x) => x.band)).size >= 3 && tileOf(tiles1, ids1.identified)?.band > tileOf(tiles1, ids1.plain)?.band && tileOf(tiles1, ids1.expensive)?.band > tileOf(tiles1, ids1.plain)?.band, [...new Set(tiles1.items.map((x) => x.band))]);
  check("the tiles hold the staging preview: every Card's stored value is still 0 in the pile", s1.cards.length === 7 && s1.cards.every((c) => c.value === 0), s1.cards.map((c) => c.value));
  check("on the Judge's tiles the magic cards wear the magic colour (the masked and the detected one), a cursed one the cursed colour (both identified items, the curse known or not), the rest plain, all face down", tileOf(tiles1, ids1.masked)?.look === "magic" && tileOf(tiles1, ids1.detected)?.look === "magic" && tileOf(tiles1, ids1.identified)?.look === "cursed" && tileOf(tiles1, ids1.unknown)?.look === "cursed" && tileOf(tiles1, ids1.plain)?.look === "plain" && tileOf(tiles1, ids1.expensive)?.look === "plain" && tileOf(tiles1, coinId)?.look === "plain", tiles1.items.map((x) => x.look));

  section("Step 2. frozen at open");
  const open1 = await press(gm, PORTS.gm, { scope: "sheet", potId: pot1.potId, sel: "aside [data-action='openTable']" }, "Open to the table");
  const w1 = await run(gm, K.waitState, { potId: pot1.potId, until: "phase", phase: "open" });
  const s2 = await run(gm, K.stage, { potId: pot1.potId });
  if (s2.messageId) made.push(gm.track(s2.messageId, "ChatMessage"));
  check("Open to the table was pressed, and every Card's value is now the band its tile previewed", open1.found && w1.met && s2.cards.length === 7 && s2.cards.every((c) => c.value === preview[c.id]), { phase: s2.phase, values: s2.cards.map((c) => c.value) });
  const was = await run(gm, P.setCost, { id: idOf(fx.plain), cost: 99999 });
  await run(gm, P.rerender, { potId: pot1.potId });
  const tiles2 = await run(gm, P.tiles, { potId: pot1.potId });
  const s2b = await run(gm, K.stage, { potId: pot1.potId });
  check("the plain item's cost raised in the world and the window rendered again: no card's band changed, on the tiles or in the pile", was === 99999 && tiles2.items.every((x) => x.band === preview[x.id]) && s2b.cards.every((c) => c.value === preview[c.id]), { cost: was });
  await run(gm, P.setCost, { id: idOf(fx.plain), cost: ITEMS.plain.system.cost });

  section("Step 3. backs on the Player seat");
  let doorP = await run(player, K.doorFor, { uuid: pot1.uuid });
  for (let n = 0; n < 40 && doorP.rendered < 1; n++) { await sleep(500); doorP = await run(player, K.doorFor, { uuid: pot1.uuid }); }
  await run(player, P.watchDoorClicks);
  await run(player, P.settleDoor);
  const openP = await press(player, PORTS.player, { scope: "doc", sel: `[data-message-id='${s2.messageId}'] [data-action='openTable']` }, "the doorway's Open the table");
  const sheetP = await run(player, K.waitSheet, { potId: pot1.potId });
  check("the Player seat's doorway card opened the pot window", doorP.messages === 1 && openP.found && sheetP.rendered, { door: doorP.messages, doorRendered: doorP.rendered, pressed: openP.found, ...sheetP });
  if (!sheetP.rendered) {
    note("step 3, the Player seat after the doorway press", await run(player, P.doorDiag, { potId: pot1.potId }));
    throw new Error("the Player seat has no pot window");
  }
  const tp = await run(player, P.tiles, { potId: pot1.potId });
  const slot = (id) => tileOf(tp, id);
  const sp = await run(player, K.stage, { potId: pot1.potId });
  const card = (id) => sp.cards.find((c) => c.id === id);
  const plainB = slot(ids1.plain);
  const maskedB = slot(ids1.masked);
  const detectedB = slot(ids1.detected);
  const tItem = await t(player, "pool.item");
  check("every card is face down on the Player seat's window", tp.items.length === 7 && tp.items.every((x) => x.down && !x.judge), tp.items.length);
  check("the masked card's back and the plain card's back, both band Low, are the same: icon, pool name, pips, band colour, accessible name and tooltip", plainB.band === maskedB.band && plainB.icon === maskedB.icon && plainB.poolTag === maskedB.poolTag && plainB.pips === maskedB.pips && plainB.ariaBack === maskedB.ariaBack && plainB.tip === maskedB.tip && plainB.poolTag === tItem, { band: [plainB.band, maskedB.band], icon: plainB.icon === maskedB.icon, aria: plainB.ariaBack === maskedB.ariaBack, tip: plainB.tip === maskedB.tip });
  check("the pile's own Card data as the Player seat reads it gives the masked card and the plain card one back image and one suit", card(ids1.masked).backImg === card(ids1.plain).backImg && card(ids1.masked).suit === card(ids1.plain).suit && card(ids1.masked).suit === "item", { img: card(ids1.masked).backImg === card(ids1.plain).backImg, suit: card(ids1.masked).suit });
  const auraLabel = await t(player, "card.backLabelAura", { pool: tItem, band: bandNames[detectedB.band] });
  check("the detected card's back wears a different icon than the plain card's, and its accessible name adds that an aura was detected", detectedB.icon !== plainB.icon && detectedB.ariaBack === auraLabel && detectedB.ariaBack !== plainB.ariaBack && card(ids1.detected).backImg !== card(ids1.plain).backImg, { icon: detectedB.icon !== plainB.icon, aria: detectedB.ariaBack === auraLabel });

  section("Step 4. faces, turned by a real press on the Player seat");
  for (const key of ["masked", "detected", "identified", "unknown"]) {
    const p = await press(player, PORTS.player, { scope: "sheet", potId: pot1.potId, sel: `li[data-card-id='${ids1[key]}'] [data-action='flip']` }, `flip ${key}`);
    const w = await run(player, K.waitState, { potId: pot1.potId, until: "up", cardId: ids1[key] });
    if (!p.found || !w.met) note(`flip of ${key} did not land`, { press: p, wait: w });
  }
  await run(player, K.rerender, { potId: pot1.potId });
  const faces = await run(player, P.tiles, { potId: pot1.potId });
  const fc = (k) => tileOf(faces, ids1[k]);
  const tCursed = await t(player, "card.cursed");
  const tMagic = await t(player, "pool.magic");
  check("the masked card turned plain: 'Plain thing', the Item tag, no Aura tag, no magic colour", !fc("masked").down && fc("masked").look === "plain" && fc("masked").name === APPARENT.name && fc("masked").poolTag === tItem && !fc("masked").aura, { look: fc("masked").look, name: fc("masked").name === APPARENT.name, aura: fc("masked").aura });
  check("the detected card turned plain with the Aura tag", fc("detected").look === "plain" && fc("detected").aura, { look: fc("detected").look, aura: fc("detected").aura });
  check("the identified card whose curse is known turned in the cursed colour with 'Cursed' as its tag", fc("identified").look === "cursed" && fc("identified").poolTag === tCursed, { look: fc("identified").look, tag: fc("identified").poolTag === tCursed });
  check("the identified card whose curse is not known turned in the magic colour and not the cursed one, tagged Magic", fc("unknown").look === "magic" && fc("unknown").poolTag === tMagic && fc("unknown").poolTag !== tCursed, { look: fc("unknown").look, tag: fc("unknown").poolTag === tMagic });
  await run(gm, P.rerender, { potId: pot1.potId });
  const jUp = await run(gm, P.tiles, { potId: pot1.potId });
  check("the Judge's tiles, now some face up, still read magic for the masked and detected, cursed for both identified, plain for the plain card", ["masked", "detected"].every((k) => tileOf(jUp, ids1[k])?.look === "magic") && ["identified", "unknown"].every((k) => tileOf(jUp, ids1[k])?.look === "cursed") && tileOf(jUp, ids1.plain)?.look === "plain", jUp.items.map((x) => x.look));
  await run(player, K.closeAll);

  section("Step 5. deal toggles (Judge seat, staging)");
  const pot2 = await stock(["masked", "detected"]);
  const tgl = await run(gm, P.toggleRead, { potId: pot2.potId });
  check("the two toggles are buttons the keyboard reaches (tab stop, focusable), named, and read aria-pressed false", tgl.found && tgl.buttons.length === 2 && tgl.buttons.every((b) => b.tab === 0 && b.named && b.pressed === "false") && tgl.focusable.every(Boolean), tgl.buttons);
  check("at the default width the panel stands to the right of the pot", tgl.right && !tgl.below, { side: tgl.side, main: tgl.main });
  await run(gm, P.resize, { potId: pot2.potId, width: 420, height: 640 });
  const tglN = await run(gm, P.toggleRead, { potId: pot2.potId });
  check("dragged narrow, the panel drops below the pot", tglN.found && tglN.below, { side: tglN.side, main: tglN.main });
  await run(gm, P.resize, { potId: pot2.potId, width: 940, height: 640 });
  const noMagic = await press(gm, PORTS.gm, { scope: "sheet", potId: pot2.potId, sel: "button[data-action='toggleDeal'][data-toggle='noMagic']" }, "No magic");
  await sleep(800);
  const tglOn = await run(gm, P.toggleRead, { potId: pot2.potId });
  const tilesStruck = await run(gm, P.tiles, { potId: pot2.potId });
  const tStruck = await t(gm, "card.struck");
  const sOn = await run(gm, K.stage, { potId: pot2.potId });
  check("No magic pressed: aria-pressed reads true, the pot's toggle is on, and both magic tiles say 'Removed when the pot opens'", noMagic.found && tglOn.buttons.find((b) => b.key === "noMagic")?.pressed === "true" && sOn.toggles?.noMagic === true && tilesStruck.items.length === 2 && tilesStruck.items.every((x) => x.struck && x.warns.includes(tStruck)), { pressed: tglOn.buttons.map((b) => b.pressed), struck: tilesStruck.items.map((x) => x.struck) });
  await run(gm, K.takeNotes);
  const openMagicOnly = await press(gm, PORTS.gm, { scope: "sheet", potId: pot2.potId, sel: "aside [data-action='openTable']" }, "Open to the table (magic only)");
  await sleep(1200);
  const refusal = await run(gm, K.takeNotes);
  const sRefused = await run(gm, K.stage, { potId: pot2.potId });
  const tEmpty = await t(gm, "refuse.dealEmpty");
  check("a pot of magic cards only refuses to open with No magic on: the notice says the toggles would leave nothing, and the pot stays in staging", openMagicOnly.found && refusal.warns.includes(tEmpty) && sRefused.phase === "staging" && sRefused.cards.length === 2, { warns: refusal.warns.length, phase: sRefused.phase });
  for (const k of ["plain", "coin"]) await run(gm, P.dropAndWait, { potId: pot2.potId, zone: "pot", uuid: uuid(k) });
  const s2pre = await run(gm, K.stage, { potId: pot2.potId });
  const ids2 = byLabel(s2pre);
  await run(gm, P.watchChat);
  const open2 = await press(gm, PORTS.gm, { scope: "sheet", potId: pot2.potId, sel: "aside [data-action='openTable']" }, "Open to the table (No magic)");
  const w2 = await run(gm, K.waitState, { potId: pot2.potId, until: "phase", phase: "open" });
  await sleep(800);
  const chat2 = await run(gm, P.readChat);
  const s2o = await run(gm, K.stage, { potId: pot2.potId });
  if (s2o.messageId) made.push(gm.track(s2o.messageId, "ChatMessage"));
  const audits = chat2.seen.filter((m) => !m.door);
  for (const m of audits) made.push(gm.track(m.id, "ChatMessage"));
  const tAuditTitle = await t(gm, "audit.title", { name: s2o.name });
  check("No magic then Open: both magic cards are gone from the pile and the plain item and coin remain", open2.found && w2.met && s2o.cards.length === 2 && !s2o.cards.some((c) => c.label === LABEL.masked || c.label === LABEL.detected) && s2o.cards.some((c) => c.label === LABEL.plain) && s2o.cards.some((c) => c.pool === "coins") && !!ids2.plain, { cards: s2o.cards.length });
  check("exactly one whisper to the Judges only, titled for the toggle audit, naming the two removed cards by their true names", audits.length === 1 && audits[0].whisper.length > 0 && audits[0].whisper.every((id) => chat2.gmIds.includes(id)) && audits[0].text.includes(tAuditTitle) && audits[0].text.includes(LABEL.masked) && audits[0].text.includes(LABEL.detected), { whispers: audits.length, to: audits[0]?.whisper.length });
  await sleep(500);
  const seenByPlayer = audits.length ? await run(player, P.messageFor, { id: audits[0].id }) : { visible: null };
  check("the Player seat does not see the whisper: not visible to it, not in its chat log", audits.length === 1 && !seenByPlayer.visible && !seenByPlayer.rendered, seenByPlayer);

  const pot3 = await stock(["masked", "plain", "unknown"]);
  const forceCursed = await press(gm, PORTS.gm, { scope: "sheet", potId: pot3.potId, sel: "button[data-action='toggleDeal'][data-toggle='forceCursed']" }, "Force cursed");
  await sleep(800);
  const s3pre = await run(gm, K.stage, { potId: pot3.potId });
  const ids3 = byLabel(s3pre);
  const open3 = await press(gm, PORTS.gm, { scope: "sheet", potId: pot3.potId, sel: "aside [data-action='openTable']" }, "Open to the table (Force cursed)");
  const w3 = await run(gm, K.waitState, { potId: pot3.potId, until: "phase", phase: "open" });
  const s3 = await run(gm, K.stage, { potId: pot3.potId });
  if (s3.messageId) made.push(gm.track(s3.messageId, "ChatMessage"));
  check("Force cursed then Open: the magic card stays and now carries the curse in the pile's snapshot, the plain card does not", forceCursed.found && open3.found && w3.met && s3.toggles?.forceCursed === true && s3.cards.find((c) => c.id === ids3.masked)?.cursed === true && s3.cards.find((c) => c.id === ids3.plain)?.cursed !== true, { toggle: s3.toggles?.forceCursed, cursed: s3.cards.find((c) => c.id === ids3.masked)?.cursed });
  const rowsBefore = await run(player, K.actorRows, { actorId: idOf(fxPlayer) });
  const flip3 = await run(player, K.relay, { potId: pot3.potId, op: "flip", cardId: ids3.masked });
  const claim3 = await run(player, K.relay, { potId: pot3.potId, op: "claim", cardId: ids3.masked, actorUuid: fxPlayer.uuid });
  const rowsAfter = await run(player, K.actorRows, { actorId: idOf(fxPlayer) });
  const fresh3 = rowsAfter.filter((r) => !rowsBefore.some((b) => b.id === r.id));
  for (const r of fresh3) made.push(gm.track(r.uuid, "Item"));
  const landed = fresh3.find((r) => r.name === APPARENT.name);
  check("the Player seat took the masked card: the item that lands on the character is cursed and the curse is not marked known", flip3.ok === true && claim3.ok === true && !!landed && landed.cursed === true && landed.curseKnown !== true, { flip: flip3.ok, claim: claim3.ok, cursed: landed?.cursed, known: landed?.curseKnown });
  const sheet3 = landed ? await run(player, P.curseOnSheet, { actorId: idOf(fxPlayer), itemId: landed.id }) : { rendered: false };
  check("the Player's sheet of that item shows no curse: no curse element and no 'Cursed' on it", sheet3.rendered && !sheet3.curseNode && !sheet3.cursedWord, sheet3);
  await run(player, K.closeAll);

  const unknown3 = s3.cards.find((c) => c.id === ids3.unknown);
  check("Force cursed then Open: the card identified in full, whose curse was not known, now carries the curse known in the pile's snapshot, while the unidentified masked card's stays unknown", !!ids3.unknown && unknown3?.cursed === true && unknown3?.curseKnown === true && s3.cards.find((c) => c.id === ids3.masked)?.curseKnown !== true, { cursed: unknown3?.cursed, known: unknown3?.curseKnown });
  const rowsBefore3b = await run(player, K.actorRows, { actorId: idOf(fxPlayer) });
  const flip3b = await run(player, K.relay, { potId: pot3.potId, op: "flip", cardId: ids3.unknown });
  const claim3b = await run(player, K.relay, { potId: pot3.potId, op: "claim", cardId: ids3.unknown, actorUuid: fxPlayer.uuid });
  const rowsAfter3b = await run(player, K.actorRows, { actorId: idOf(fxPlayer) });
  const fresh3b = rowsAfter3b.filter((r) => !rowsBefore3b.some((b) => b.id === r.id));
  for (const r of fresh3b) made.push(gm.track(r.uuid, "Item"));
  const landed3b = fresh3b.find((r) => r.name === LABEL.unknown);
  check("the Player seat took the identified card: the item that lands on the character is cursed and the curse is marked known", flip3b.ok === true && claim3b.ok === true && !!landed3b && landed3b.cursed === true && landed3b.curseKnown === true, { flip: flip3b.ok, claim: claim3b.ok, cursed: landed3b?.cursed, known: landed3b?.curseKnown });

  const pot4 = await stock(["masked", "plain", "detected"]);
  await press(gm, PORTS.gm, { scope: "sheet", potId: pot4.potId, sel: "button[data-action='toggleDeal'][data-toggle='noMagic']" }, "No magic");
  await sleep(500);
  await press(gm, PORTS.gm, { scope: "sheet", potId: pot4.potId, sel: "button[data-action='toggleDeal'][data-toggle='forceCursed']" }, "Force cursed");
  await sleep(500);
  await run(gm, P.watchChat);
  const open4 = await press(gm, PORTS.gm, { scope: "sheet", potId: pot4.potId, sel: "aside [data-action='openTable']" }, "Open to the table (both)");
  const w4 = await run(gm, K.waitState, { potId: pot4.potId, until: "phase", phase: "open" });
  await sleep(800);
  const chat4 = await run(gm, P.readChat);
  const s4 = await run(gm, K.stage, { potId: pot4.potId });
  if (s4.messageId) made.push(gm.track(s4.messageId, "ChatMessage"));
  const audits4 = chat4.seen.filter((m) => !m.door);
  for (const m of audits4) made.push(gm.track(m.id, "ChatMessage"));
  const tNone = await t(gm, "audit.none");
  const tForceRow = await t(gm, "audit.forceCursed", { n: 0 });
  check("both toggles on then Open: no magic card remains in the pile", open4.found && w4.met && s4.toggles?.noMagic === true && s4.toggles?.forceCursed === true && s4.cards.length === 1 && s4.cards[0].label === LABEL.plain, { cards: s4.cards.length });
  check("the whisper's two rows: the first names the removed cards, the second reads 'none' because nothing was left to curse", audits4.length === 1 && audits4[0].rows === 2 && audits4[0].text.includes(`${tForceRow} ${tNone}`), { whispers: audits4.length, rows: audits4[0]?.rows });

  section("Step 7. dress and pictures");
  // The identified pair tie at the dearest worth, and a tie shares a rank, so with seven cards neither reaches the top band. One is made dearer until the pot opens (bands freeze there, step 2); the fixture check at the next run's start writes its cost back.
  await run(gm, P.setCost, { id: idOf(fx.identified), cost: ITEMS.identified.system.cost * 2 });
  const pot7 = await stock(DROP);
  const s7pre = await run(gm, P.stage, { potId: pot7.potId });
  const ids7 = byLabel(s7pre);
  const open7 = await press(gm, PORTS.gm, { scope: "sheet", potId: pot7.potId, sel: "aside [data-action='openTable']" }, "Open to the table");
  const w7 = await run(gm, K.waitState, { potId: pot7.potId, until: "phase", phase: "open" });
  await run(gm, P.setCost, { id: idOf(fx.identified), cost: ITEMS.identified.system.cost });
  const s7 = await run(gm, K.stage, { potId: pot7.potId });
  if (s7.messageId) made.push(gm.track(s7.messageId, "ChatMessage"));
  let door7 = await run(player, K.doorFor, { uuid: pot7.uuid });
  for (let n = 0; n < 40 && door7.rendered < 1; n++) { await sleep(500); door7 = await run(player, K.doorFor, { uuid: pot7.uuid }); }
  await run(player, P.settleDoor);
  const openP7 = await press(player, PORTS.player, { scope: "doc", sel: `[data-message-id='${s7.messageId}'] [data-action='openTable']` }, "the doorway's Open the table");
  const sheetP7 = await run(player, K.waitSheet, { potId: pot7.potId });
  check("a fresh pot is open to the table, and the Player seat's doorway card opened its window", open7.found && w7.met && door7.messages === 1 && openP7.found && sheetP7.rendered, { phase: s7.phase, door: door7.messages });
  if (!sheetP7.rendered) throw new Error("the Player seat has no pot window for the step 7 pot");
  await run(gm, K.rerender, { potId: pot7.potId });
  const gmL0 = await run(gm, P.windowLayers, { potId: pot7.potId });
  const plL0 = await run(player, P.windowLayers, { potId: pot7.potId });
  check("with no texture wired, neither seat's window carries a grime, foil or vignette layer, and the Player seat's window shows its seven backs", gmL0.rendered && plL0.rendered && gmL0.grime === 0 && gmL0.foil === 0 && gmL0.vignette === 0 && plL0.grime === 0 && plL0.foil === 0 && plL0.vignette === 0 && plL0.backs === 7, { gm: [gmL0.grime, gmL0.foil, gmL0.vignette], player: [plL0.grime, plL0.foil, plL0.vignette], backs: plL0.backs });

  const dress0 = await run(player, P.backLayers, { potId: pot7.potId });
  const by0 = (id) => dress0.backs.find((b) => b.id === id);
  const plain0 = by0(ids7.plain);
  const masked0 = by0(ids7.masked);
  const bandsPresent = new Set(dress0.backs.map((b) => b.band));
  check("the pot has a back in the lowest band and one in the top band, so the dress checks below are not vacuous", bandsPresent.has(0) && bandsPresent.has(3), [...bandsPresent].sort());
  check("each back's ornaments follow its band: lozenge corners from the third band, breaks at the top only, a hairline frame at the lowest band and a double rule above it, and the detected back's frame gold", dress0.backs.every((b) => b.down && b.corners === (b.band >= 2) && b.breaks === (b.band === 3) && (b.id === ids7.detected ? b.frame === "gold" : b.frame === (b.band === 0 ? "hair" : "double"))), dress0.backs.map((b) => [b.band, b.frame, b.corners, b.breaks]));
  check("the masked card's back and the plain card's back, both band Low, carry the same frame, corners and layers before any texture is wired", !!plain0 && !!masked0 && plain0.band === 0 && masked0.band === 0 && plain0.cls === masked0.cls && plain0.layers === masked0.layers, { band: [plain0?.band, masked0?.band], same: plain0?.cls === masked0?.cls && plain0?.layers === masked0?.layers });

  const raster = await run(player, P.findRaster);
  check("the Player page finds a world raster picture that is served, to stand in for a texture", raster.found, { tried: raster.tried });
  if (raster.found) {
    await run(player, P.wireArt);
    await run(player, K.rerender, { potId: pot7.potId });
    const plL1 = await run(player, P.windowLayers, { potId: pot7.potId });
    const dress1 = await run(player, P.backLayers, { potId: pot7.potId });
    const by1 = (id) => dress1.backs.find((b) => b.id === id);
    const low = dress1.backs.filter((b) => b.band === 0);
    const top = dress1.backs.filter((b) => b.band === 3);
    check("with the reader wired, every lowest-band back carries the grimiest layer and no foil", low.length > 0 && low.every((b) => b.grime === 3 && !b.foil), low.map((b) => [b.grime, b.foil]));
    check("every top-band back carries no grime layer and a foil", top.length > 0 && top.every((b) => b.grime === null && b.foil), top.map((b) => [b.grime, b.foil]));
    check("the grime thins by band across every back: band 0 the grimiest, band 1 and 2 less, band 3 none, and a foil only at the top", dress1.backs.every((b) => b.grime === (b.band < 3 ? 3 - b.band : null) && b.foil === (b.band === 3)), dress1.backs.map((b) => [b.band, b.grime, b.foil]));
    check("the undetected masked card's back still matches the plain card's, layers included, with the textures drawn", !!by1(ids7.plain) && !!by1(ids7.masked) && by1(ids7.plain).cls === by1(ids7.masked).cls && by1(ids7.plain).layers === by1(ids7.masked).layers && by1(ids7.masked).grime === 3 && by1(ids7.plain).grime === 3, { same: by1(ids7.plain)?.layers === by1(ids7.masked)?.layers });
    const gmL1 = await run(gm, P.windowLayers, { potId: pot7.potId });
    check("the wired reader made layers appear in the Player's window, and only there (the Judge's window, with no reader, is unchanged)", plL1.grime > 0 && plL1.foil > 0 && gmL1.grime === 0 && gmL1.foil === 0, { grime: plL1.grime, foil: plL1.foil });
    await run(player, P.unwireArt);
    await run(player, K.rerender, { potId: pot7.potId });
    const plL2 = await run(player, P.windowLayers, { potId: pot7.potId });
    check("with the reader put back, the layers are gone again", plL2.grime === 0 && plL2.foil === 0 && plL2.vignette === 0 && plL2.backs === 7, { grime: plL2.grime, foil: plL2.foil });
  }

  section("console");
  for (const [key, api] of [["gm", gm], ["player", player]]) {
    const drained = await run(api, K.drain);
    check(`${key}: no console error over the walk`, !drained.errors.length, drained.errors.slice(0, 3));
  }
  note("clicks (real pointer presses / pressed with click())", clicks);
  walkDone();
} catch (err) {
  if (err?.name !== "WalkBlocked") console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  for (const [key, api] of [["player", player], ["gm", gm]]) {
    if (!api) continue;
    try { await run(api, K.closeAll); } catch {}
    try { await run(api, P.unwireArt); } catch {}
    try { note(`restored (${key})`, await run(api, K.restore)); } catch (err) { console.error("restore:", err?.message ?? err); }
  }
  if (gm) {
    // Only the run's own ids: the pots, their doorway and whisper cards, the rows a Take made. Kept fixtures stay.
    try { note("swept (the run's own ids)", await gm.sweepTracked({ only: made.filter((uuid) => gm.tracked().some((e) => e.uuid === uuid)) })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  }
  for (const marker of Object.values(MARKS)) console.log(`fixture kept: ${marker}`);
  try { if (player) await player.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  finish();
}
