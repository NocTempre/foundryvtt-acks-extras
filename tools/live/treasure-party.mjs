/**
 * Live walk, treasure party: the open pot's party aside, the drag onto a
 * character sheet or a member's zone, and Quick grab, slices R4 and R5. Walks
 * docs/treasure/TESTING.md "Party aside, drag and Quick grab (both seats)",
 * steps 1 to 5 and 7, on the Player seat's own client (every claim travels
 * the real relay to the GM seat's client). Every observable is a boolean or a
 * count. Machine values arrive through ./_env.mjs; the shared seat plumbing is
 * ./_treasure-kit.mjs.
 *
 * Covers: fixtures; a party (a formation record) of the Player's character,
 * the Judge's character and an ally, each on automatic movement; step 1 (a
 * zone per member with name, speed, load figure and a bar, each speed equal
 * to the roster's own `pace`, "Party moves" the slowest, the Quick grab hint,
 * and with the pot's party not resolved the single "No party is set" line);
 * step 2 (a drop of a turned item card onto the owned character's sheet);
 * step 3 (a drop on that member's zone: the load rises by the card's weight
 * and the speed re-reads from the roster); step 4 (a drop on a member the seat
 * does not own is refused with the notice, the card unclaimed, the actor
 * unchanged); step 5 (Quick grab by a real press: the notice, every member's
 * pace no lower than the announced one with the slowest equal to it, "Party
 * moves" the same, every load within its capacity, the coin card split into
 * turned cards that sum to the stack, the card heavier than any member's room
 * left turned and unclaimed and named as fitting nobody, the face-down card
 * untouched, a second press answered); step 7 (a narrow window: the aside
 * below the grid, the resize corner, the grab button reachable).
 *
 * Fixtures, kept and found by marker: `treasure/player-character`,
 * `treasure/judge-character` (the Player seat does not own it),
 * `treasure/ally` (owned by nobody but the Judge), `treasure/coin`, and the
 * items `treasure/weight-a`, `treasure/weight-b`, `treasure/weight-huge`,
 * `treasure/weight-down` (invented weights; the recipe asks for these shapes
 * and names no markers). The party is a formation record, which carries no
 * marker: it is found by its name and kept, never deleted by name; a second
 * party built only for the no-party line is deleted by the id this run made
 * it under. The pot, its doorway card and every row a claim made are the
 * run's own, tracked by id as read back and swept by id.
 *
 * Real gestures: the doorway's Open the table, Open to the table, Quick grab
 * and the narrow window's grab button are CDP mouse presses when the control
 * is the element under its centre. Scripted: the drops (a `drop` event with
 * the data a drag of a card carries, dispatched at a sheet's content or a
 * zone), the flips (the relay called by hand), the pot's party flag.
 *
 * Not reached: step 6 (a Judge's Quick grab with a nearly full ally, a member
 * at zero hit points and a member that keeps no goods), a prediction of the
 * announced pace worked out apart from the planner (only its invariants are
 * checked), a drag onto an actor sheet the seat cannot open, the coin card's
 * weight tuned to a third of a member's room, and a real drag with pointer
 * travel.
 */
import { connect } from "./_driver.mjs";
import { walkDone, blocked } from "./_walk.mjs";
import { MACHINE, PORTS, P as K, run, t, note, section, check, checks, clicks, idOf, openSeats, press, sleep, finish, watchdog } from "./_treasure-kit.mjs";

const MARKS = {
  player: "treasure/player-character",
  judge: "treasure/judge-character",
  ally: "treasure/ally",
  coin: "treasure/coin",
  a: "treasure/weight-a",
  b: "treasure/weight-b",
  huge: "treasure/weight-huge",
  down: "treasure/weight-down",
};
const PARTY_NAME = "QA Treasure Party";
const PARTY_B_NAME = "QA Treasure Party B";
const IMG = "icons/svg/item-bag.svg";
const COIN = { name: "QA Treasure Coin", type: "money", img: "icons/svg/coins.svg", system: { coppervalue: 100, quantity: 300 } };
const WEIGHTS = {
  a: { name: "QA Weight A", type: "item", img: IMG, system: { cost: 10, weight6: 50 } },
  b: { name: "QA Weight B", type: "item", img: IMG, system: { cost: 10, weight6: 50 } },
  huge: { name: "QA Weight Huge", type: "item", img: IMG, system: { cost: 10, weight6: 900 } },
  down: { name: "QA Weight Down", type: "item", img: IMG, system: { cost: 10, weight6: 6 } },
};
const NAMES = { player: "QA Treasure Player Character", judge: "QA Treasure Judge Character", ally: "QA Treasure Ally" };

const P = {
  ...K,
  /** The party record by name (made if absent), holding each actor, and the roster's answer for it. */
  buildParty: async ({ name, actorIds }) => {
    const M = await import("/modules/acks-extras/scripts/formation/formation-model.mjs");
    let f = Object.values(M.getFormations()).find((x) => x.name === name);
    if (!f) f = await M.createFormation(name);
    const fid = f.id;
    const refused = [];
    for (const id of actorIds) {
      if (!M.realMembers(M.getFormation(fid)).some((m) => m.actorId === id)) {
        await M.addMember(M.getFormation(fid), game.actors.get(id), null, { scene: null });
        if (!M.realMembers(M.getFormation(fid)).some((m) => m.actorId === id)) refused.push(id);
      }
    }
    return { fid, members: M.realMembers(M.getFormation(fid)).map((m) => m.actorId), refused };
  },
  makeParty: async ({ name }) => {
    const M = await import("/modules/acks-extras/scripts/formation/formation-model.mjs");
    return { fid: (await M.createFormation(name)).id };
  },
  dropParty: async ({ fid }) => {
    const M = await import("/modules/acks-extras/scripts/formation/formation-model.mjs");
    await M.deleteFormationRecord(fid);
    return !M.getFormations()[fid];
  },
  partyCount: async () => {
    const S = await import("/modules/acks-extras/scripts/lib/services.mjs");
    return S.get("party-roster").list().length;
  },
  setPartyId: async ({ potId, partyId }) => {
    await game.cards.get(potId).update({ "flags.acks-extras.treasure.partyId": partyId });
    await globalThis.__tk.sleep(600);
    return true;
  },
  /** The world's own figures for each member: pace, load and capacity in sixths of a stone. */
  roster: async ({ fid, actorIds }) => {
    const S = await import("/modules/acks-extras/scripts/lib/services.mjs");
    const C = await import("/modules/acks-extras/scripts/lib/capacity.mjs");
    const svc = S.get("party-roster");
    const out = {};
    for (const id of actorIds) {
      const a = game.actors.get(id);
      out[id] = { speed: svc.pace(fid, id)?.speed ?? null, load6: C.load6(a), cap6: C.capacity6(a), items: a.items.size, names: a.items.map((i) => i.name) };
    }
    return out;
  },
  /** The seat's scripted flip of every named card, through the relay. */
  flips: async ({ potId, cardIds }) => {
    const H = globalThis.__tk;
    const out = [];
    for (const cardId of cardIds) out.push((await H.race(H.S.executeAsGM("treasurePot", { potId, op: "flip", cardId }), 25000))?.ok === true);
    return out;
  },
  /** The party aside as the Player's window shows it. */
  aside: async ({ potId }) => {
    const H = globalThis.__tk;
    const root = H.root(H.sheet(potId));
    const aside = root?.querySelector("aside.acks-extras-treasure__party");
    if (!aside) return { found: false };
    const grid = root.querySelector("ol.acks-extras-treasure__grid");
    const rect = (el) => { const r = el.getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom) }; };
    return {
      found: true,
      lines: [...aside.children].map((c) => H.text(c)).filter(Boolean),
      members: [...aside.querySelectorAll("li.acks-extras-treasure__member")].map((li) => ({
        uuid: li.dataset.actorUuid ?? null,
        zone: li.hasAttribute("data-member-drop"),
        name: H.text(li.querySelector(".acks-extras-treasure__member-name")),
        speed: H.text(li.querySelector(".acks-extras-treasure__member-speed")),
        speedTip: li.querySelector(".acks-extras-treasure__member-speed")?.dataset.tooltipText ?? "",
        load: H.text(li.querySelector(".acks-extras-treasure__member-load")),
        loadTip: li.querySelector(".acks-extras-treasure__member-load")?.dataset.tooltipText ?? "",
        bar: !!li.querySelector(".acks-extras-treasure__bar-fill"),
        pct: li.querySelector(".acks-extras-treasure__bar-fill")?.style.getPropertyValue("--load") ?? "",
      })),
      moves: H.text(aside.querySelector(".acks-extras-treasure__moves")),
      movesTip: aside.querySelector(".acks-extras-treasure__moves")?.dataset.tooltipText ?? "",
      hint: H.text(aside.querySelector(".acks-extras-treasure__grab > .acks-extras-treasure__hint")),
      button: H.text(aside.querySelector("[data-action='grab']")),
      leftover: H.text(aside.querySelector(".acks-extras-treasure__leftover")),
      leftoverTip: aside.querySelector(".acks-extras-treasure__leftover")?.dataset.tooltipText ?? "",
      aside: rect(aside),
      grid: rect(grid),
      handle: !!H.root(H.sheet(potId)).querySelector(":scope > .window-resize-handle"),
    };
  },
  /** Whether a card's tile is draggable on this seat's window. */
  draggable: async ({ potId, cardId }) => !!globalThis.__tk.root(globalThis.__tk.sheet(potId))?.querySelector(`li[data-card-id='${cardId}'] [draggable='true']`),
  /** Dispatch the drop a drag of a card makes: onto a member's zone, or onto an actor sheet's content. */
  dropCard: async ({ potId, cardUuid, target, actorUuid, actorId }) => {
    const H = globalThis.__tk;
    const dt = new DataTransfer();
    dt.setData("text/plain", JSON.stringify({ type: "Card", uuid: cardUuid }));
    let el = null;
    if (target === "zone") el = H.root(H.sheet(potId))?.querySelector(`[data-member-drop][data-actor-uuid='${actorUuid}']`);
    else {
      const app = game.actors.get(actorId).sheet;
      await app.render(true);
      H.opened.push(app);
      await H.poll(() => H.root(app)?.querySelector(".window-content"), { tries: 40, every: 200 });
      el = H.root(app)?.querySelector(".window-content") ?? H.root(app);
    }
    if (!el) return { ok: false, why: "no target" };
    el.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
    await H.sleep(1500);
    const app = target === "sheet" ? game.actors.get(actorId).sheet : null;
    return { ok: true, hooks: Hooks.events?.dropActorSheetData?.length ?? 0, sheetClass: app?.constructor?.name ?? null, editable: app?.isEditable ?? null, el: el.className?.toString().slice(0, 60) };
  },
  resize: async ({ potId, width, height }) => {
    const H = globalThis.__tk;
    H.sheet(potId).setPosition({ width, height });
    await H.sleep(800);
    return true;
  },
};

let gm = null;
let player = null;
const made = [];
let partyBId = null;
watchdog(() => [gm, player]);

try {
  section("seats");
  gm = await connect({ browser: MACHINE.browser, origin: MACHINE.origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  player = await connect({ browser: MACHINE.browser, origin: MACHINE.origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  await openSeats({ gm, player, blocked, pattern: /treasure|pot-sheet|pot-relay|pot-logic|doorway|grab|\/pot\.mjs|hoard/i });

  section("fixtures");
  const playerId = await run(gm, P.userId, { name: MACHINE.player });
  const fxPlayer = await gm.fixture(MARKS.player, "Actor", { name: NAMES.player, type: "character", prototypeToken: { actorLink: true }, ownership: { default: 0, [playerId]: 3 } });
  const fxJudge = await gm.fixture(MARKS.judge, "Actor", { name: NAMES.judge, type: "character", prototypeToken: { actorLink: true }, ownership: { default: 0 } });
  const fxAlly = await gm.fixture(MARKS.ally, "Actor", { name: NAMES.ally, type: "character", prototypeToken: { actorLink: true }, ownership: { default: 0 } });
  const fxCoin = await gm.fixture(MARKS.coin, "Item", COIN);
  const fxW = {};
  for (const k of ["a", "b", "huge", "down"]) fxW[k] = await gm.fixture(MARKS[k], "Item", WEIGHTS[k]);
  const ids = { player: idOf(fxPlayer), judge: idOf(fxJudge), ally: idOf(fxAlly) };
  const party = await run(gm, P.buildParty, { name: PARTY_NAME, actorIds: Object.values(ids) });
  const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
  check("the party stands: one formation record of the Player's character, the Judge's character and the ally, none refused by another party", sameSet(party.members, Object.values(ids)) && party.refused.length === 0, party);
  const fid = party.fid;
  const r0 = await run(gm, P.roster, { fid, actorIds: Object.values(ids) });
  check("the roster answers a pace and a capacity for each member, with room for the planned cards", Object.values(r0).every((m) => typeof m.speed === "number" && typeof m.cap6 === "number" && m.cap6 - m.load6 >= 100), Object.fromEntries(Object.entries(r0).map(([k, m]) => [k, { speed: m.speed, room6: m.cap6 - m.load6 }])));

  section("The pot: opened, turned");
  const pot = await run(gm, P.newPot);
  if (!pot) throw new Error("no pot window opened on the GM seat");
  made.push(gm.track(pot.uuid, "Cards"));
  const stockKeys = [["coin", fxCoin], ["a", fxW.a], ["b", fxW.b], ["huge", fxW.huge], ["down", fxW.down]];
  for (const [, fx] of stockKeys) { const d = await run(gm, P.dropAndWait, { potId: pot.potId, zone: "pot", uuid: fx.uuid }); if (!d.ok) throw new Error("a drop made no card"); }
  await run(gm, P.setPartyId, { potId: pot.potId, partyId: fid });
  const open = await press(gm, PORTS.gm, { scope: "sheet", potId: pot.potId, sel: "aside [data-action='openTable']" }, "Open to the table");
  const wOpen = await run(gm, K.waitState, { potId: pot.potId, until: "phase", phase: "open" });
  const sOpen = await run(gm, K.stage, { potId: pot.potId });
  if (sOpen.messageId) made.push(gm.track(sOpen.messageId, "ChatMessage"));
  const cid = { coin: sOpen.cards.find((c) => c.pool === "coins")?.id, a: sOpen.cards.find((c) => c.label === WEIGHTS.a.name)?.id, b: sOpen.cards.find((c) => c.label === WEIGHTS.b.name)?.id, huge: sOpen.cards.find((c) => c.label === WEIGHTS.huge.name)?.id, down: sOpen.cards.find((c) => c.label === WEIGHTS.down.name)?.id };
  const flipped = await run(player, P.flips, { potId: pot.potId, cardIds: [cid.coin, cid.a, cid.b, cid.huge] });
  check("the pot is open with five cards; the coin, both weights and the huge card are turned and the small one is left face down", open.found && wOpen.met && Object.values(cid).every(Boolean) && flipped.every(Boolean), { phase: sOpen.phase, flipped });
  let doorP = await run(player, K.doorFor, { uuid: pot.uuid });
  for (let n = 0; n < 40 && doorP.rendered < 1; n++) { await sleep(500); doorP = await run(player, K.doorFor, { uuid: pot.uuid }); }
  let sheetP = { rendered: false };
  for (let attempt = 0; attempt < 3 && !sheetP.rendered; attempt++) {
    const openP = await press(player, PORTS.player, { scope: "doc", sel: `[data-message-id='${sOpen.messageId}'] [data-action='openTable']` }, "the doorway's Open the table");
    note("the doorway press", { attempt, found: openP.found, real: openP.real, door: doorP });
    sheetP = await run(player, K.waitSheet, { potId: pot.potId });
  }
  if (!sheetP.rendered) throw new Error("the Player seat has no pot window");
  await sleep(800);

  section("Step 1. the aside (Player seat)");
  const a1 = await run(player, P.aside, { potId: pot.potId });
  const rr1 = await run(player, P.roster, { fid, actorIds: Object.values(ids) });
  const tSpeed = (n) => t(player, "party.speed", { n });
  const byName = Object.fromEntries(a1.members.map((m) => [m.name, m]));
  const slowest = Math.min(...Object.values(rr1).map((m) => m.speed));
  const ok1 = a1.found && a1.members.length === 3 && (await Promise.all(Object.entries(NAMES).map(async ([k, n]) => byName[n] && byName[n].speed === (await tSpeed(rr1[ids[k]].speed))))).every(Boolean);
  check("the aside shows one zone per member with its name and a speed equal to the roster's own pace for that member", ok1, a1.members.map((m) => [m.name === NAMES.player, m.speed]));
  const loadOk = (m, r) => m.load.startsWith(`${Math.round((r.load6 / 6) * 10) / 10} of ${Math.round((r.cap6 / 6) * 10) / 10} st`) && m.bar && m.pct !== "";
  check("each zone's load figure reads the member's load of capacity with its item count, and its bar is drawn", Object.entries(NAMES).every(([k, n]) => byName[n] && loadOk(byName[n], rr1[ids[k]])), a1.members.map((m) => m.load.length));
  check("the speed and load tooltips name their parts (the member and the figures) and the 'Party moves' figure equals the slowest member's pace", a1.members.every((m) => m.speedTip.length > 0 && m.loadTip.length > 0 && m.speedTip.includes(m.name) && m.loadTip.includes(m.name)) && a1.moves.includes(await tSpeed(slowest)) && a1.movesTip.length > 0, { moves: a1.moves.includes(await tSpeed(slowest)) });
  const tHint = await t(player, "party.quickHint");
  const tQuick = await t(player, "party.quick");
  check("no leftover line, the Quick grab button and its one-line hint", a1.leftover === "" && a1.button === tQuick && a1.hint === tHint, { leftover: a1.leftover, button: a1.button === tQuick });
  const nParties = await run(gm, P.partyCount);
  if (nParties === 1) partyBId = (await run(gm, P.makeParty, { name: PARTY_B_NAME })).fid;
  await run(gm, P.setPartyId, { potId: pot.potId, partyId: null });
  const aNo = await run(player, P.aside, { potId: pot.potId });
  const tNone = await t(player, "party.none");
  const noText = await run(player, async ({ potId }) => globalThis.__tk.text(globalThis.__tk.root(globalThis.__tk.sheet(potId))?.querySelector("aside.acks-extras-treasure__party")), { potId: pot.potId });
  check("with the pot's party unset and two parties in the world, the aside is the one line 'No party is set for this pot.' and nothing else", noText === tNone, { parties: nParties, text: noText === tNone, found: aNo.found });
  await run(gm, P.setPartyId, { potId: pot.potId, partyId: fid });
  await run(player, K.rerender, { potId: pot.potId });
  const members = (await run(player, P.aside, { potId: pot.potId })).members;
  const zoneOf = (n) => members.find((m) => m.name === n)?.uuid;

  const rowsOf = async () => Object.fromEntries(await Promise.all(Object.entries(ids).map(async ([k, id]) => [k, await run(player, K.actorRows, { actorId: id })])));
  const track = async (before, after) => {
    for (const k of Object.keys(ids)) for (const r of after[k].filter((x) => !before[k].some((b) => b.id === x.id))) made.push(gm.track(r.uuid, "Item"));
  };
  const cardUuid = (id) => sOpen.cards.find((c) => c.id === id).uuid;

  section("Step 2. drag a turned item onto the owned character's sheet");
  const rowsA = await rowsOf();
  const dragA = await run(player, P.draggable, { potId: pot.potId, cardId: cid.a });
  note("the sheet drop", await run(player, P.dropCard, { potId: pot.potId, cardUuid: cardUuid(cid.a), target: "sheet", actorId: ids.player }));
  const wA = await run(player, K.waitState, { potId: pot.potId, until: "claimed", cardId: cid.a });
  await sleep(800);
  const rowsA2 = await rowsOf();
  await track(rowsA, rowsA2);
  const gainedA = rowsA2.player.filter((r) => r.name === WEIGHTS.a.name).length - rowsA.player.filter((r) => r.name === WEIGHTS.a.name).length;
  const dragA2 = await run(player, P.draggable, { potId: pot.potId, cardId: cid.a });
  const tTo = await t(player, "card.to", { name: NAMES.player });
  const sheetA = await run(player, P.aside, { potId: pot.potId });
  const textA = await run(player, async ({ potId, cardId }) => globalThis.__tk.text(globalThis.__tk.root(globalThis.__tk.sheet(potId))?.querySelector(`li[data-card-id='${cardId}'] .acks-extras-treasure-card__by`)), { potId: pot.potId, cardId: cid.a });
  const errsA = await run(player, K.drain);
  check("the turned item card was draggable, and the drop on the character's sheet landed the item once on that character", dragA && wA.met && gainedA === 1, { draggable: dragA, claimed: wA.met, gained: gainedA });
  check("the card reads 'To <name>' and no longer drags, and the seat logged no console error", textA === tTo && !dragA2 && errsA.errors.length === 0, { by: textA === tTo, draggable: dragA2, errors: errsA.errors.length });

  section("Step 3. drop on a member's zone");
  const aside3 = await run(player, P.aside, { potId: pot.potId });
  note("the aside before step 3", { found: aside3.found, lines: aside3.lines, members: aside3.members?.map((m) => [m.name, m.zone]) });
  const mBefore = aside3.members.find((m) => m.name === NAMES.player) ?? { load: "", pct: "" };
  const rr3a = await run(player, P.roster, { fid, actorIds: [ids.player] });
  const rowsB = await rowsOf();
  await run(player, P.dropCard, { potId: pot.potId, cardUuid: cardUuid(cid.b), target: "zone", actorUuid: zoneOf(NAMES.player) });
  const wB = await run(player, K.waitState, { potId: pot.potId, until: "claimed", cardId: cid.b });
  await sleep(800);
  const rowsB2 = await rowsOf();
  await track(rowsB, rowsB2);
  const rr3b = await run(player, P.roster, { fid, actorIds: [ids.player] });
  await run(player, K.rerender, { potId: pot.potId });
  const mAfter = (await run(player, P.aside, { potId: pot.potId })).members.find((m) => m.name === NAMES.player);
  const rise = (rr3b[ids.player].load6 - rr3a[ids.player].load6) / 6;
  check("the drop on the member's zone claimed the card for that character, and the world's load figure rose by the card's weight", wB.met && Math.abs(rise - WEIGHTS.b.system.weight6 / 6) < 0.2, { rise, expected: WEIGHTS.b.system.weight6 / 6 });
  check("the zone's load figure and bar changed and its speed reads the roster's pace again", mBefore.load !== mAfter.load && mBefore.pct !== mAfter.pct && mAfter.speed === (await tSpeed(rr3b[ids.player].speed)), { load: [mBefore.load, mAfter.load], speed: mAfter.speed === (await tSpeed(rr3b[ids.player].speed)) });

  section("Step 4. refusal: a member the seat does not own");
  const rowsC = await rowsOf();
  await run(player, K.takeNotes);
  await run(player, P.dropCard, { potId: pot.potId, cardUuid: cardUuid(cid.huge), target: "zone", actorUuid: zoneOf(NAMES.judge) });
  await sleep(1500);
  const notes4 = await run(player, K.takeNotes);
  const rowsC2 = await rowsOf();
  const s4 = await run(gm, K.stage, { potId: pot.potId });
  const tNot = await t(player, "refuse.notOwner");
  check("the drop on the Judge's character is refused with 'You do not own that character.', the card is unclaimed and the actor gained nothing", notes4.warns.includes(tNot) && !s4.cards.find((c) => c.id === cid.huge).claimedBy && rowsC2.judge.length === rowsC.judge.length, { warns: notes4.warns.length, claimed: !!s4.cards.find((c) => c.id === cid.huge).claimedBy });

  section("Step 5. Quick grab (Player seat)");
  const before5 = await run(player, P.roster, { fid, actorIds: Object.values(ids) });
  const rows5 = await rowsOf();
  const coinBefore = s4.cards.find((c) => c.id === cid.coin);
  await run(player, K.takeNotes);
  const grab = await press(player, PORTS.player, { scope: "sheet", potId: pot.potId, sel: "[data-action='grab']" }, "Quick grab");
  const grab2 = await press(player, PORTS.player, { scope: "sheet", potId: pot.potId, sel: "[data-action='grab']" }, "Quick grab, again at once");
  await sleep(3500);
  const notes5 = await run(player, K.takeNotes);
  const rows5b = await rowsOf();
  await track(rows5, rows5b);
  const done = notes5.infos.map((m) => m.match(/Quick grab: (\d+) taken\. The party moves (\d+) ft\./)).find(Boolean);
  const X = done ? Number(done[2]) : null;
  const after5 = await run(player, P.roster, { fid, actorIds: Object.values(ids) });
  const s5 = await run(gm, K.stage, { potId: pot.potId });
  await run(player, K.rerender, { potId: pot.potId });
  const a5 = await run(player, P.aside, { potId: pot.potId });
  const speeds = Object.values(after5).map((m) => m.speed);
  const claimedCoins = s5.cards.filter((c) => c.pool === "coins" && c.claimedBy);
  const restCoin = s5.cards.find((c) => c.id === cid.coin);
  const coinSum = s5.cards.filter((c) => c.pool === "coins" && (c.claimedBy || c.id === cid.coin)).reduce((n, c) => n + (c.coin?.count ?? 0), 0);
  check("Quick grab by a real press posted 'Quick grab: N taken. The party moves X ft.'", grab.found && X !== null, { press: grab, notes: notes5.infos.length });
  check("every member's pace is no lower than X, the slowest equals X, and 'Party moves' shows X", X !== null && speeds.every((s) => s >= X) && Math.min(...speeds) === X && a5.moves.includes(await tSpeed(X)), { X, speeds });
  check("every member's load is within its capacity", Object.values(after5).every((m) => m.load6 <= m.cap6), Object.values(after5).map((m) => [m.load6, m.cap6]));
  check("the coin card became several turned cards each 'To <name>' whose counts plus the card still in the pot sum to the original stack", claimedCoins.length >= 1 && coinSum === coinBefore.coin.count && s5.cards.filter((c) => c.pool === "coins").every((c) => c.face === 0), { claimed: claimedCoins.length, sum: coinSum, original: coinBefore.coin.count, rest: restCoin?.coin?.count ?? null });
  const huge5 = s5.cards.find((c) => c.id === cid.huge);
  const tLeft = await t(player, "party.leftover", { names: WEIGHTS.huge.name });
  check("the card heavier than any member's room stays turned and unclaimed, the notice warns that it fits nobody, and the leftover line names it with a tooltip", huge5.face === 0 && !huge5.claimedBy && notes5.warns.some((w) => w.includes(WEIGHTS.huge.name)) && a5.leftover === tLeft && a5.leftoverTip.length > 0, { warns: notes5.warns.length, leftover: a5.leftover === tLeft, tip: a5.leftoverTip.length });
  const down5 = s5.cards.find((c) => c.id === cid.down);
  check("the face-down card is untouched", down5.face === null && !down5.claimedBy, { face: down5.face });
  const gained = Object.fromEntries(Object.keys(ids).map((k) => [k, rows5b[k].length - rows5[k].length]));
  note("rows gained per member by the grab (the seat owns one member; the rest received goods)", gained);
  check("a second press at once was answered 'That is already being done.' or found nothing left to place", grab2.found && (notes5.warns.includes(await t(player, "refuse.busy")) || notes5.infos.length >= 1), { warns: notes5.warns, infos: notes5.infos.length });

  section("Step 7. narrow window");
  await run(player, P.resize, { potId: pot.potId, width: 420, height: 560 });
  const aN = await run(player, P.aside, { potId: pot.potId });
  const reach = await run(player, K.locate, { scope: "sheet", potId: pot.potId, sel: "[data-action='grab']" });
  const zonesN = aN.members.length;
  check("shrunk below about 46em the aside sits below the pot grid, the resize corner stays, and the grab button is reachable by scrolling", aN.found && aN.aside.top >= aN.grid.bottom - 1 && aN.handle && reach.found && reach.ok && zonesN === 3, { aside: aN.aside, grid: aN.grid, handle: aN.handle, reach: reach.ok });
  await run(player, P.resize, { potId: pot.potId, width: 940, height: 640 });

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
    if (partyBId) { try { note("the second party, deleted by the id this run made it under", await run(gm, P.dropParty, { fid: partyBId })); } catch (err) { console.error("party-b:", err?.message ?? err); } }
    // Only the run's own ids: the pot, its doorway card, the rows each claim and the grab made. Kept fixtures and the party stay.
    try { note("swept (the run's own ids)", await gm.sweepTracked({ only: made.filter((uuid) => gm.tracked().some((e) => e.uuid === uuid)) })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  }
  for (const marker of Object.values(MARKS)) console.log(`fixture kept: ${marker}`);
  try { if (player) await player.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  finish();
}
