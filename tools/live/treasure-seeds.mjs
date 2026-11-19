/**
 * Live walk, treasure seeds: docs/treasure/TESTING.md "Replace seeds at open
 * (both seats)", steps 1 to 7, and the doorway's Open the table pressed once
 * on the Player seat for every pot the walk opens. Every observable is a
 * boolean, a count or a string the module's own lang file produced. Machine
 * values arrive through ./_env.mjs; the shared seat plumbing is
 * ./_treasure-kit.mjs. Every figure typed into a fixture is invented.
 *
 * Covers: fixtures; step 1 (the struck 400 tile reads "Replaced by", the
 * seed's row reads "Takes … (… gp over)" with its tooltip, the other tiles
 * untouched, the pot value); step 2 (Open with the Judge dealing: `order`
 * holds the seed and not the lot, the pile keeps the lot's Card, `replaced`,
 * the bands ranked without the struck lot, the Judge-only whisper); step 3
 * (the same on a Table pot); step 4 (the Player sees one card fewer, none
 * names the struck lot, a relayed claim of it is refused, the closed pot's
 * record names no struck lot); step 5 (the seed's back differs from a lot's
 * only by band, and its position over the walk's pots is not always last);
 * step 6 (the shortfall row, an empty `struck` with `shortGp`, the Judge's
 * warning and none on the Player seat); step 7 (No magic: the masked magic lot
 * reads "Removed when the pot opens" and the plan ignores it). The doorway:
 * every pot's Player press is a first press after the card stops moving, and
 * five more one-lot pots repeat it, each counted.
 *
 * Fixtures, kept and found by marker: `treasure/lot-high`, `treasure/lot-mid`,
 * `treasure/lot-low` (coin cards worth 400, 150 and 100 gp, so their worths show), `treasure/seed-replace`, `treasure/seed-replace-big`,
 * `treasure/lot-magic` (a magic item disguised as a 150 gp one), `treasure/lot-plain`
 * (a plain item worth less than any lot, for step 5's back of the same pool) and
 * `treasure/player-character`. Each pot, its doorway card, its audit whisper
 * and its closed record are the run's own, tracked by id and swept by id.
 *
 * Real gestures: the doorway's Open the table, the pot's Open to the table,
 * the mode buttons, the No magic toggle and Close are CDP mouse presses when
 * the control is the element under its centre. Scripted: the drops (a `drop`
 * event with the data a drag of an item carries), the relayed claim.
 *
 * Not reached: a real drag with pointer travel; the Tab order of the buckets.
 */
import { connect } from "./_driver.mjs";
import { walkDone, blocked } from "./_walk.mjs";
import { MACHINE, PORTS, P as K, run, t, note, section, check, checks, clicks, idOf, openSeats, press, sleep, finish, watchdog } from "./_treasure-kit.mjs";

const IMG = "icons/svg/item-bag.svg";
const COINS = "icons/svg/coins.svg";
const MARKS = {
  high: "treasure/lot-high",
  mid: "treasure/lot-mid",
  low: "treasure/lot-low",
  seed: "treasure/seed-replace",
  big: "treasure/seed-replace-big",
  magic: "treasure/lot-magic",
  plain: "treasure/lot-plain",
  player: "treasure/player-character",
};
const ITEMS = {
  high: { name: "QA Seeds High Lot", type: "money", img: COINS, system: { coppervalue: 100, quantity: 400 } },
  mid: { name: "QA Seeds Mid Lot", type: "money", img: COINS, system: { coppervalue: 100, quantity: 150 } },
  low: { name: "QA Seeds Low Lot", type: "money", img: COINS, system: { coppervalue: 100, quantity: 100 } },
  plain: { name: "QA Seeds Plain Lot", type: "item", img: IMG, system: { cost: 50 } },
  seed: { name: "QA Seeds Replace", type: "item", img: IMG, system: { cost: 250 } },
  big: { name: "QA Seeds Replace Big", type: "item", img: IMG, system: { cost: 1000 } },
};
const MAGIC_TRUE = { name: "QA Seeds Magic Lot", type: "item", img: IMG, system: { cost: 3000 }, flags: { "acks-extras": { markets: { magic: true, aura: "arcane", identified: "none", detected: false } } } };
const MAGIC_APPARENT = { name: "Plain trinket", img: IMG, cost: 150 };

const P = {
  ...K,
  maskedData: async ({ truth, apparent }) => {
    const DL = await import("/modules/acks-extras/scripts/equipment/disguise-logic.mjs");
    return DL.disguiseData(truth, apparent);
  },
  setOwner: async ({ actorId, userId, level }) => {
    const a = game.actors.get(actorId);
    if ((a?.ownership?.[userId] ?? 0) !== level) await a.update({ [`ownership.${userId}`]: level });
    return a?.testUserPermission(game.users.get(userId), "OWNER") ?? false;
  },
  /** The staging window as the Judge reads it: each tile's name and warning, each bucket row's text and tooltip, the pot value. */
  stagingView: async ({ potId }) => {
    const H = globalThis.__tk;
    await H.sleep(400);
    const root = H.root(H.sheet(potId));
    if (!root) return { rendered: false };
    const tiles = [...root.querySelectorAll("li.acks-extras-treasure-card--judge")].map((li) => ({
      id: li.dataset.cardId,
      name: H.text(li.querySelector(".acks-extras-treasure-card__name")),
      warn: [...li.querySelectorAll(".acks-extras-treasure-card__warn")].map(H.text),
      struck: li.classList.contains("is-struck"),
      seed: !!li.querySelector(".acks-extras-treasure-card__seed"),
    }));
    const rows = [...root.querySelectorAll(".acks-extras-treasure__bucket[data-accept-drop='replace'] .acks-extras-treasure__bucket-row")].map((r) => ({
      name: H.text(r.querySelector(".acks-extras-treasure__bucket-name")),
      takes: H.text(r.querySelector(".acks-extras-treasure__bucket-takes")),
      tip: r.querySelector(".acks-extras-treasure__bucket-takes")?.dataset.tooltipText ?? "",
    }));
    return { rendered: true, tiles, rows, value: H.text(root.querySelector(".acks-extras-treasure__figure")), valueTip: root.querySelector(".acks-extras-treasure__figure")?.dataset.tooltipText ?? "" };
  },
  /** The flag after open, with every card's value and whether the pile still holds it. */
  openState: async ({ potId }) => {
    const pile = game.cards.get(potId);
    const f = pile?.getFlag("acks-extras", "treasure") ?? {};
    return {
      phase: f.phase ?? null, order: f.order ?? [], replaced: f.replaced ?? null, messageId: f.messageId ?? null,
      cards: pile ? pile.cards.contents.map((c) => ({ id: c.id, value: c.value, label: c.getFlag("acks-extras", "card")?.label ?? "" })) : [],
    };
  },
  /** Chat messages made since `since` that carry the audit's Replace seeds heading, as this seat can see them. */
  audits: async ({ since, word }) => game.messages.filter((m) => m.timestamp >= since && (m.content ?? "").includes("acks-extras-treasure-record") && (m.content ?? "").includes(word))
    .map((m) => ({ id: m.id, uuid: m.uuid, whisper: m.whisper ?? [], visible: m.visible, shown: !!document.querySelector(`.chat-log [data-message-id="${m.id}"], #chat-notifications [data-message-id="${m.id}"]`), content: m.content })),
  now: async () => Date.now(),
  /** The Player seat's pot window: how many card slots it shows, their backs' plates and its whole text. */
  playerView: async ({ potId }) => {
    const H = globalThis.__tk;
    const root = H.root(H.sheet(potId));
    if (!root) return { rendered: false, slots: [], text: "" };
    const slots = [...root.querySelectorAll("li.acks-extras-treasure__slot")].map((li) => ({
      id: li.dataset.cardId,
      band: [...li.classList].find((c) => c.startsWith("is-band-")) ?? null,
      back: li.querySelector(".acks-extras-treasure-back")?.className.replace(/is-band-\S+/g, "").replace(/\s+/g, " ").trim() ?? null,
      pool: H.text(li.querySelector(".acks-extras-treasure-back__pool")),
    }));
    return { rendered: true, slots, text: H.text(root) };
  },
  settleDoor: async () => {
    const moving = () => [...document.querySelectorAll(".acks-extras-treasure-door")].some((el) => (el.closest(".message") ?? el).getAnimations({ subtree: true }).some((a) => a.playState === "running"));
    for (let n = 0; n < 40 && moving(); n++) await new Promise((r) => setTimeout(r, 100));
    return !moving();
  },
  watchDoorClicks: async () => {
    globalThis.__doorClicks = [];
    if (globalThis.__doorWatch) return true;
    globalThis.__doorWatch = true;
    document.addEventListener("click", (event) => {
      const btn = event.target?.closest?.(".acks-extras-treasure-door [data-action='openTable']");
      if (!btn) return;
      globalThis.__doorClicks.push({ inNotification: !!btn.closest("#chat-notifications"), inLog: !!btn.closest(".chat-log"), connected: btn.isConnected });
    }, true);
    return true;
  },
  /** Why a doorway press opened no window: the clicks the doorway heard, the seat's sight of the pile, the sheet's state, the last notices. */
  doorDiag: async ({ potId }) => {
    const pile = game.cards.get(potId);
    return {
      clicks: globalThis.__doorClicks ?? null,
      limited: pile ? pile.testUserPermission(game.user, "LIMITED") : null,
      sheet: pile?.sheet ? { rendered: !!pile.sheet.rendered, state: pile.sheet.state ?? null } : null,
      shown: [...document.querySelectorAll("#notifications li, #notifications .notification")].map((li) => li.textContent.replace(/\s+/g, " ").trim()).slice(-3),
    };
  },
  /** The back each card would wear at its own band in the pool `poolOf`'s card shows, as card-art dresses it. */
  backsFor: async ({ potId, ids, poolOf }) => {
    const A = await import("/modules/acks-extras/scripts/treasure/card-art.mjs");
    const L = await import("/modules/acks-extras/scripts/treasure/pot-logic.mjs");
    const pile = game.cards.get(potId);
    const truth = (id) => pile.cards.get(id)?.getFlag("acks-extras", "card") ?? {};
    const backKey = L.shownPool(L.normalizeTruth(truth(poolOf)));
    return Object.fromEntries(ids.map((id) => [id, A.backDress({ backKey, band: pile.cards.get(id)?.value ?? 0, auraBack: false }).className]));
  },
  closeSheet: async ({ potId }) => {
    const H = globalThis.__tk;
    const s = H.sheet(potId);
    if (s?.rendered) await s.close({ animate: false });
    return true;
  },
  messageText: async ({ id }) => {
    const m = game.messages.get(id);
    return m ? { content: m.content, record: (m.content ?? "").includes("acks-extras-treasure-record") } : null;
  },
};

let gm = null;
let player = null;
const made = [];
const seedPositions = [];
const doorway = { pots: 0, firstPress: 0, notification: 0 };
watchdog(() => [gm, player], Number(process.env.WALK_WALL_MS ?? 900_000));

/** A fresh pot on the Judge seat, its lots on the pot and its seed in the Replace bucket. */
async function stagePot({ lots, seed = null }) {
  const pot = await run(gm, P.newPot);
  if (!pot) throw new Error("no pot window opened on the GM seat");
  made.push(gm.track(pot.uuid, "Cards"));
  const ids = {};
  for (const [key, fx] of lots) {
    const d = await run(gm, P.dropAndWait, { potId: pot.potId, zone: "pot", uuid: fx.uuid });
    if (!d.ok) throw new Error(`the drop of ${key} made no card`);
    ids[key] = d.ids[0];
  }
  if (seed) {
    const d = await run(gm, P.dropAndWait, { potId: pot.potId, zone: "replace", uuid: seed[1].uuid });
    if (!d.ok) throw new Error("the seed's drop made no card");
    ids[seed[0]] = d.ids[0];
  }
  return { pot, ids };
}

/** Open the pot to the table, then the Player's one press on the doorway. */
async function openPot(pot) {
  const since = await run(gm, P.now);
  const open = await press(gm, PORTS.gm, { scope: "sheet", potId: pot.potId, sel: "aside [data-action='openTable']" }, "Open to the table");
  const w = await run(gm, K.waitState, { potId: pot.potId, until: "phase", phase: "open" });
  const s = await run(gm, P.openState, { potId: pot.potId });
  if (s.messageId) made.push(gm.track(s.messageId, "ChatMessage"));
  let door = await run(player, K.doorFor, { uuid: pot.uuid });
  for (let n = 0; n < 40 && door.rendered < 1; n++) { await sleep(500); door = await run(player, K.doorFor, { uuid: pot.uuid }); }
  await run(player, P.settleDoor);
  const openP = await press(player, PORTS.player, { scope: "doc", sel: `[data-message-id='${s.messageId}'] [data-action='openTable']` }, "the doorway's Open the table");
  const sheetP = await run(player, K.waitSheet, { potId: pot.potId });
  doorway.pots++;
  if (openP.found && openP.real && sheetP.rendered) doorway.firstPress++;
  else note("the doorway press opened no window; the Player seat", await run(player, P.doorDiag, { potId: pot.potId }));
  await run(player, P.watchDoorClicks);
  return { since, open, opened: w.met, s, door, openP, sheetP };
}

/** The audit whispers since `since`, tracked; and what the Player seat sees of them. */
async function auditsSince(since) {
  const word = await t(gm, "toggle.replace");
  const g = await run(gm, P.audits, { since, word });
  for (const m of g) made.push(gm.track(m.uuid, "ChatMessage"));
  const p = await run(player, P.audits, { since, word });
  return { gm: g, player: p };
}

const foundry_escape = (x) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const gmIds = async () => JSON.parse(await gm.eval(`JSON.stringify(game.users.filter((u) => u.isGM).map((u) => u.id))`));

try {
  section("seats");
  gm = await connect({ browser: MACHINE.browser, origin: MACHINE.origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  player = await connect({ browser: MACHINE.browser, origin: MACHINE.origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  await openSeats({ gm, player, blocked, pattern: /treasure|pot-sheet|pot-relay|pot-logic|replace-logic|doorway|\/pot\.mjs/i });

  section("fixtures");
  const playerId = await run(gm, P.userId, { name: MACHINE.player });
  const fx = {};
  for (const k of ["high", "mid", "low", "plain", "seed", "big"]) fx[k] = await gm.fixture(MARKS[k], "Item", ITEMS[k]);
  fx.magic = await gm.fixture(MARKS.magic, "Item", await run(gm, P.maskedData, { truth: MAGIC_TRUE, apparent: MAGIC_APPARENT }));
  fx.player = await gm.fixture(MARKS.player, "Actor", { name: "QA Treasure Player", type: "character", prototypeToken: { actorLink: true }, ownership: { default: 0, [playerId]: 3 } });
  await run(player, P.watchDoorClicks);
  check("the Player seat owns its character", await run(gm, P.setOwner, { actorId: idOf(fx.player), userId: playerId, level: 3 }));
  const LOTS = [["high", fx.high], ["mid", fx.mid], ["low", fx.low]];
  const judges = await gmIds();

  // Steps 1, 2, 4, 5 on one pot the Judge deals.
  section("step 1: the plan shows (Judge seat, staging)");
  const A = await stagePot({ lots: [...LOTS, ["plain", fx.plain]], seed: ["seed", fx.seed] });
  const vA = await run(gm, P.stagingView, { potId: A.pot.potId });
  const tile = (v, id) => v.tiles.find((x) => x.id === id) ?? {};
  // A coin card's true name carries its count; the tile shows the name the plan and the audit use.
  const highName = tile(vA, A.ids.high).name;
  note("the 400 lot's true name, as the tile shows it", highName);
  const replacedBy = await t(gm, "card.replacedBy", { name: ITEMS.seed.name });
  const takesOver = await t(gm, "bucket.takesOver", { lots: highName, over: "150" });
  check("the 400 lot's tile is struck and reads \"Replaced by <seed> when the pot opens\"", tile(vA, A.ids.high).struck && tile(vA, A.ids.high).warn.includes(replacedBy), tile(vA, A.ids.high));
  check("the seed's Replace row reads \"Takes <lot> (150 gp over)\" and its tooltip carries the seed's worth and the lots taken", vA.rows.length === 1 && vA.rows[0].takes === takesOver && /250/.test(vA.rows[0].tip) && /400/.test(vA.rows[0].tip), vA.rows);
  check("the 150 and 100 tiles are untouched", !tile(vA, A.ids.mid).struck && !tile(vA, A.ids.low).struck && !tile(vA, A.ids.mid).warn.length && !tile(vA, A.ids.low).warn.length);
  check("the pot value leaves the struck 400 lot out: the 150 and 100 coin lots (250 gp); a plain item's worth, the seed's included, does not show", vA.value === "250 gp", { value: vA.value, tip: vA.valueTip });

  section("step 2: open, the Judge deals");
  const oA = await openPot(A.pot);
  const sA = oA.s;
  check("the pot opened", oA.open.found && oA.opened, { phase: sA.phase });
  check("`order` lists the seed and not the 400 lot", sA.order.includes(A.ids.seed) && !sA.order.includes(A.ids.high), { order: sA.order.length });
  check("the pile still holds the 400 lot's Card", sA.cards.some((c) => c.id === A.ids.high));
  const repA = sA.replaced ?? [];
  check("`replaced` is [{seedId, struck: [<400 lot>], shortGp: null}]", repA.length === 1 && repA[0].seedId === A.ids.seed && JSON.stringify(repA[0].struck) === JSON.stringify([A.ids.high]) && repA[0].shortGp === null, repA);
  const listedA = sA.cards.filter((c) => sA.order.includes(c.id));
  const rankA = (id) => sA.cards.find((c) => c.id === id)?.value;
  check("every listed Card's value is a band ranked without the struck lot (the seed outranks the 150, which outranks the 100)", listedA.every((c) => Number.isFinite(c.value)) && rankA(A.ids.seed) >= rankA(A.ids.mid) && rankA(A.ids.mid) >= rankA(A.ids.low), Object.fromEntries(listedA.map((c) => [c.label, c.value])));
  const auA = await auditsSince(oA.since);
  const tookA = await t(gm, "audit.replaceTook", { seed: ITEMS.seed.name, lots: highName, over: "150" });
  check("one audit whisper, to the Judges only, lists the seed, the lot's true name and the overshoot", auA.gm.length === 1 && auA.gm[0].whisper.length > 0 && auA.gm[0].whisper.every((id) => judges.includes(id)) && auA.gm[0].content.includes(foundry_escape(tookA)), { n: auA.gm.length, whisper: auA.gm[0]?.whisper.length, judges: judges.length, toJudges: auA.gm[0]?.whisper.every((id) => judges.includes(id)), lists: auA.gm[0]?.content.includes(foundry_escape(tookA)) });
  check("the Player seat sees no audit whisper (none visible, none in its chat log)", auA.player.every((m) => !m.visible && !m.shown), auA.player.map((m) => ({ visible: m.visible, shown: m.shown, whisper: m.whisper.length })));

  section("step 4: struck is never delivered (Player seat)");
  check("the doorway's Open the table opened the Player's window on the first press", oA.openP.found && oA.sheetP.rendered, { real: oA.openP.real });
  const pA = await run(player, P.playerView, { potId: A.pot.potId });
  check("the Player sees one card fewer than the lots dropped plus the seed (4 of 5)", pA.rendered && pA.slots.length === 4, { slots: pA.slots.length });
  check("no Player card carries the struck lot's name or worth", pA.rendered && !pA.text.includes(ITEMS.high.name) && !/\b400\b/.test(pA.text), { name: pA.text.includes(ITEMS.high.name) });
  const claim = await run(gm, K.relay, { potId: A.pot.potId, op: "claim", cardId: A.ids.high, actorUuid: fx.player.uuid });
  check("a relayed claim of the struck lot's Card is refused as not in the pot", claim && claim.ok === false, claim);
  seedPositions.push(sA.order.indexOf(A.ids.seed) === sA.order.length - 1 ? "last" : String(sA.order.indexOf(A.ids.seed)));

  section("step 5: a seed cannot be told apart (Player seat)");
  const seedSlot = pA.slots.find((x) => x.id === A.ids.seed);
  const lotSlot = pA.slots.find((x) => x.id === A.ids.plain);
  // The frame and the rich stone follow the band (card-art backDress), so each back is held to the dress of its own band in the lot's pool.
  const dress = await run(player, P.backsFor, { potId: A.pot.potId, ids: [A.ids.seed, A.ids.plain], poolOf: A.ids.plain });
  const asDressed = (slot) => !!slot && slot.back === `acks-extras-treasure-back ${dress[slot.id]}`;
  check("the seed's back and a plain lot's back differ only by band: each wears its band's dress in the same pool, under the same pool plate", asDressed(seedSlot) && asDressed(lotSlot) && seedSlot.pool === lotSlot.pool, { seed: seedSlot, lot: lotSlot, dress });
  check("no seed marker reaches the Player seat", pA.rendered && !pA.text.includes(await t(player, "card.seed")));

  section("step 4: close the pot");
  const closeG = await press(gm, PORTS.gm, { scope: "sheet", potId: A.pot.potId, sel: "[data-action='closePot']" }, "Close");
  await sleep(800);
  const yes = await press(gm, PORTS.gm, { scope: "dialog", sel: "button[data-action='yes'], button[data-action='ok'], button[data-action='confirm']" }, "the close confirm");
  const gone = await run(gm, K.waitState, { potId: A.pot.potId, until: "gone" });
  const rec = await run(gm, P.messageText, { id: sA.messageId });
  check("the pot closed and its doorway card is the record, which names no struck lot", closeG.found && gone.met && !!rec?.record && !rec.content.includes(ITEMS.high.name), { closed: gone.met, confirm: yes.found, record: rec?.record });

  section("step 3: open, the table rolls");
  const B = await stagePot({ lots: LOTS, seed: ["seed", fx.seed] });
  const mode = await press(gm, PORTS.gm, { scope: "sheet", potId: B.pot.potId, sel: "[data-action='setMode'][data-mode='table']" }, "Table mode");
  await sleep(500);
  const oB = await openPot(B.pot);
  const repB = oB.s.replaced ?? [];
  check("a Table pot opens on the same plan and the same record", mode.found && oB.opened && repB.length === 1 && repB[0].seedId === B.ids.seed && JSON.stringify(repB[0].struck) === JSON.stringify([B.ids.high]) && repB[0].shortGp === null && oB.s.order.includes(B.ids.seed) && !oB.s.order.includes(B.ids.high), repB);
  check("the doorway's Open the table opened the Player's window on the first press (Table pot)", oB.openP.found && oB.sheetP.rendered, { real: oB.openP.real });
  await auditsSince(oB.since);
  seedPositions.push(oB.s.order.indexOf(B.ids.seed) === oB.s.order.length - 1 ? "last" : String(oB.s.order.indexOf(B.ids.seed)));
  await run(player, P.closeSheet, { potId: B.pot.potId });

  section("step 6: a shortfall (Judge seat, staging)");
  await run(gm, P.takeNotes);
  await run(player, P.takeNotes);
  const C = await stagePot({ lots: LOTS, seed: ["big", fx.big] });
  const vC = await run(gm, P.stagingView, { potId: C.pot.potId });
  const takesShort = await t(gm, "bucket.takesShort", { short: "350" });
  check("the big seed's row reads \"No lots cover it (350 gp short); takes none\", and no tile is struck", vC.rows.length === 1 && vC.rows[0].takes === takesShort && vC.tiles.every((x) => !x.struck), { rows: vC.rows, struck: vC.tiles.filter((x) => x.struck).length });
  const oC = await openPot(C.pot);
  const repC = oC.s.replaced ?? [];
  check("`replaced` holds the seed with an empty `struck` and `shortGp` 350, and the pot keeps every lot", repC.length === 1 && repC[0].seedId === C.ids.big && repC[0].struck.length === 0 && repC[0].shortGp === 350 && ["high", "mid", "low"].every((k) => oC.s.order.includes(C.ids[k])), repC);
  const [warnHead] = (await t(gm, "audit.warnShort", { seeds: ITEMS.big.name, worth: "@@WORTH@@" })).split("@@WORTH@@");
  const notesG = await run(gm, P.takeNotes);
  const notesP = await run(player, P.takeNotes);
  check("the Judge seat shows one warning: \"<seed> took no lot, so the pot holds <worth> gp more than the table rolled\"", notesG.warns.filter((w) => w.startsWith(warnHead)).length === 1, { warns: notesG.warns });
  check("the Player seat's notifications hold no such line", !notesP.warns.some((w) => w.includes(ITEMS.big.name)) && !notesP.infos.some((w) => w.includes(ITEMS.big.name)), notesP);
  check("the doorway's Open the table opened the Player's window on the first press (shortfall pot)", oC.openP.found && oC.sheetP.rendered, { real: oC.openP.real });
  await auditsSince(oC.since);
  seedPositions.push(oC.s.order.indexOf(C.ids.big) === oC.s.order.length - 1 ? "last" : String(oC.s.order.indexOf(C.ids.big)));
  await run(player, P.closeSheet, { potId: C.pot.potId });

  section("step 7: no magic first");
  const D = await stagePot({ lots: [...LOTS, ["magic", fx.magic]], seed: ["seed", fx.seed] });
  const tog = await press(gm, PORTS.gm, { scope: "sheet", potId: D.pot.potId, sel: "[data-action='toggleDeal'][data-toggle='noMagic']" }, "No magic");
  await sleep(600);
  const vD = await run(gm, P.stagingView, { potId: D.pot.potId });
  const struckText = await t(gm, "card.struck");
  const dMagic = tile(vD, D.ids.magic);
  check("with No magic on, the magic lot's tile reads \"Removed when the pot opens\", not \"Replaced by\"", tog.found && dMagic.warn.includes(struckText) && !dMagic.warn.includes(replacedBy), dMagic);
  check("the plan ignores the magic lot: the seed still takes the 400 lot", tile(vD, D.ids.high).warn.includes(replacedBy) && vD.rows[0]?.takes === takesOver, { high: tile(vD, D.ids.high), row: vD.rows[0] });

  section("the doorway, repeated");
  const extra = [];
  for (let n = 0; n < 5; n++) {
    const E = await stagePot({ lots: [["low", fx.low]] });
    const oE = await openPot(E.pot);
    extra.push(oE.openP.found && oE.openP.real && oE.sheetP.rendered);
    await auditsSince(oE.since);
    await run(player, P.closeSheet, { potId: E.pot.potId });
  }
  note("doorway first presses (real pointer, window opened) / pots opened", `${doorway.firstPress}/${doorway.pots}`);
  check("every Player press on a doorway's Open the table opened the window the first time, over every pot this walk opened", doorway.firstPress === doorway.pots && extra.every(Boolean), { extra });
  note("the seed's position in `order`, per pot", seedPositions);

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
    try { note(`restored (${key})`, await run(api, K.restore)); } catch (err) { console.error("restore:", err?.message ?? err); }
  }
  if (gm) {
    try { note("swept (the run's own ids)", await gm.sweepTracked({ only: made.filter((uuid) => gm.tracked().some((e) => e.uuid === uuid)) })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  }
  for (const marker of Object.values(MARKS)) console.log(`fixture kept: ${marker}`);
  try { if (player) await player.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  finish();
}
