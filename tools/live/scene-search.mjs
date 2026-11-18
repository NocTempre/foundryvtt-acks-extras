/**
 * Live walk, scene search: the haul dealt when a scene opens, slice S3. Walks
 * docs/scene-search/TESTING.md on both seats. The GM seat deals a scene's haul
 * through `dealSceneHaul` and marks lots found through `markSceneFound`; the
 * Player seat's own client renders the pot's window and sends a relay
 * request, so the found-only rule is read where it applies, on the player's
 * client. Every observable is a boolean or a count. Machine values arrive
 * through ./_env.mjs.
 *
 * Covers: boot on both seats; the kept fixtures; Judge 1 (the deal and what it
 * writes), 2 (the Judge's window, every lot dashed), 3 (one lot found, bands
 * unchanged), 4 (a found-nothing answer marks nothing), 7 (a declined lair
 * leaves no pile); Player 1 (no tile before a find), 2 (one tile after), 3
 * (the relay refuses an unfound lot); teardown by tracked id.
 *
 * Scripted, not gestured: the deal and the marks are API calls (the scene
 * screen, S4, does not exist yet); the relay request is sent from the Player
 * page (no control offers a flip of an unfound lot, which is the point).
 *
 * Fixtures, kept and found by marker: `scene-search/place` (a location whose
 * things are a floor `den` and a container `chest`) and
 * `scene-search/player-character` (a character the Player seat owns). The pot
 * is the run's own: retired by marker first, marked `scene-search/pot` after
 * the deal, swept by tracked id at the end.
 *
 * Not reached: step 6 (a world with no treasure tables; this one has them),
 * the doorway card, Quick grab with a mixed pot, a close with unfound lots,
 * and a Take (the treasure walk's Take covers the path).
 */
import { connect } from "./_driver.mjs";
import { walkDone, blocked } from "./_walk.mjs";
import { MACHINE, PORTS, P as K, section, check, note, finish, watchdog, openSeats, run, idOf, sleep } from "./_treasure-kit.mjs";

const MARKS = { place: "scene-search/place", player: "scene-search/player-character", pot: "scene-search/pot" };
const THINGS = [
  { id: "den", kind: "floor", ref: null, hidden: false, hint: null, point: null, params: {}, layers: {}, state: {} },
  { id: "chest", kind: "container", ref: null, hidden: false, hint: null, point: null, params: {}, layers: {}, state: {} },
];

const P = {
  ...K,
  pickLetter: async () => {
    const T = await import("/modules/acks-extras/scripts/lib/tables.mjs");
    const B = await import("/modules/acks-extras/scripts/importer/treasure-binding.mjs");
    const Hd = await import("/modules/acks-extras/scripts/treasure/hoard.mjs");
    if (!T.hasDoc(B.TREASURE_DOC_ID)) return { imported: false, letter: null };
    const keys = Object.keys(T.getDoc(B.TREASURE_DOC_ID).tables?.typeClassic ?? {});
    const orig = CONFIG.Dice.randomUniform;
    CONFIG.Dice.randomUniform = () => 0.025;
    try {
      for (const letter of keys) {
        const d = await Hd.dealHoard({ letter, style: "classic", toggles: {} });
        if ((d.truths ?? []).length >= 1) return { imported: true, letter };
      }
    } finally {
      CONFIG.Dice.randomUniform = orig;
    }
    return { imported: true, letter: null };
  },
  shapePlace: async ({ placeId, things }) => {
    const a = game.actors.get(placeId);
    await a.update({ "flags.acks-extras.things": foundry.data.operators.ForcedReplacement.create(things) });
    return { type: a.type, things: (a.getFlag("acks-extras", "things") ?? []).map((t) => t.id) };
  },
  shapeOwner: async ({ actorId, playerId }) => {
    const a = game.actors.get(actorId);
    await a.update({ ownership: { default: 0, [playerId]: 3 } });
    return a.testUserPermission(game.users.get(playerId), "OWNER");
  },
  potIds: async () => {
    const Pm = await import("/modules/acks-extras/scripts/treasure/pot.mjs");
    return game.cards.filter((c) => Pm.isPot(c)).map((c) => c.id);
  },
  deal: async ({ letter, placeUuid, metInLair, decline }) => {
    const H = await import("/modules/acks-extras/scripts/scene-search/haul.mjs");
    const sceneId = canvas.scene?.id ?? game.scenes.viewed?.id ?? game.scenes.contents[0]?.id ?? null;
    const orig = CONFIG.Dice.randomUniform;
    CONFIG.Dice.randomUniform = () => 0.025;
    try {
      return await H.dealSceneHaul({
        sources: [{ thing: "den", letters: [letter] }, { thing: "chest", layer: "methodical", letters: [letter] }],
        metInLair,
        confirmLair: decline ? async () => false : undefined,
        scene: { sceneId, placeUuid },
      });
    } finally {
      CONFIG.Dice.randomUniform = orig;
    }
  },
  pileState: async ({ potId }) => {
    const Pm = await import("/modules/acks-extras/scripts/treasure/pot.mjs");
    const pile = game.cards.get(potId);
    if (!pile) return null;
    const view = Pm.viewOf(pile);
    const cards = view.cards.map((c) => ({ id: c.id, found: c.truth?.found, lot: c.truth?.lot ?? null, value: c.value, face: c.face }));
    const doors = game.messages.filter((m) => JSON.stringify(m.flags?.["acks-extras"] ?? {}).includes(pile.id)).length;
    return { phase: view.pot.phase, origin: view.pot.origin?.kind ?? null, messageId: view.pot.messageId ?? null, cards, doors };
  },
  render: async ({ potId }) => {
    const H = globalThis.__tk;
    await H.poll(() => game.cards.get(potId)?.visible);
    const sheet = game.cards.get(potId)?.sheet;
    if (!sheet) return { rendered: false };
    if (!H.opened.includes(sheet)) H.opened.push(sheet);
    await sheet.render({ force: true });
    await H.poll(() => sheet.rendered && H.root(sheet));
    await H.sleep(400);
    return { rendered: !!sheet.rendered };
  },
  readWindow: async ({ potId, judge }) => {
    const H = globalThis.__tk;
    const sheet = game.cards.get(potId)?.sheet;
    const root = H.root(sheet);
    if (!root) return { found: false };
    const sel = judge ? ".acks-extras-treasure-card--judge" : ".acks-extras-treasure__grid > li, .acks-extras-treasure__grid .acks-extras-treasure-back";
    const tiles = [...root.querySelectorAll(sel)];
    const unfound = [...root.querySelectorAll(".is-unfound")];
    const header = root.querySelector(".acks-extras-treasure__turned");
    return {
      found: true,
      tiles: tiles.length,
      tileIds: [...new Set(tiles.map((el) => el.dataset.cardId ?? el.closest("[data-card-id]")?.dataset.cardId).filter(Boolean))],
      unfound: unfound.length,
      unfoundNote: unfound.filter((el) => H.text(el).includes(H.t("card.unfound"))).length,
      header: H.text(header),
      headerTip: header?.dataset.tooltipText ?? "",
      turnButtons: root.querySelectorAll("button[data-action='flip']").length,
    };
  },
  mark: async ({ potId, outcome }) => {
    const H = await import("/modules/acks-extras/scripts/scene-search/haul.mjs");
    const r = await H.markSceneFound(game.cards.get(potId), outcome);
    return r ?? null;
  },
};

let gm = null;
let player = null;
watchdog(() => [gm, player]);
try {
  section("seats");
  gm = await connect({ browser: MACHINE.browser, origin: MACHINE.origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  player = await connect({ browser: MACHINE.browser, origin: MACHINE.origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  await openSeats({ gm, player, blocked, pattern: /scene-search|haul|treasure|pot-sheet/i });

  section("fixtures");
  const playerId = await run(gm, P.userId, { name: MACHINE.player });
  const picked = await run(gm, P.pickLetter);
  if (!picked.imported) blocked("the world's treasure registry is not imported (recipe step 6); import the Treasure Tome first");
  if (!picked.letter) blocked("no treasure type in the imported classic table deals a card under the rigged die");
  const LETTER = picked.letter;
  const fxPlace = await gm.fixture(MARKS.place, "Actor", { name: "QA Scene Place", type: "acks-extras.location" });
  const fxPlayer = await gm.fixture(MARKS.player, "Actor", { name: "QA Scene Player Character", type: "character", ownership: { default: 0, [playerId]: 3 } });
  const shaped = await run(gm, P.shapePlace, { placeId: idOf(fxPlace), things: THINGS });
  const owns = await run(gm, P.shapeOwner, { actorId: idOf(fxPlayer), playerId });
  check("the kept fixtures stand in shape: the place is a location carrying the things den and chest, and the Player seat owns its character", shaped.type === "acks-extras.location" && shaped.things.join() === "den,chest" && owns, shaped);
  const placeUuid = fxPlace.uuid ?? `Actor.${idOf(fxPlace)}`;
  await gm.retire(MARKS.pot, "Cards").catch(() => null);

  section("Judge 7: a declined lair leaves no pile");
  const before7 = await run(gm, P.potIds);
  const r7 = await run(gm, P.deal, { letter: LETTER, placeUuid, metInLair: false, decline: true });
  const after7 = await run(gm, P.potIds);
  check("a declined lair warning answers lairDeclined and leaves no new pile", r7?.ok === false && r7.reason === "lairDeclined" && after7.length === before7.length, { reason: r7?.reason, piles: [before7.length, after7.length] });

  section("Judge 1: the deal");
  const r1 = await run(gm, P.deal, { letter: LETTER, placeUuid, metInLair: true, decline: false });
  if (!r1?.ok) blocked(`the deal refused: ${r1?.reason}`);
  const potId = r1.potId;
  await gm.track(r1.potUuid, "Cards");
  await gm.mark(r1.potUuid, MARKS.pot);
  const s1 = await run(gm, P.pileState, { potId });
  const keys = r1.lots.map((l) => l.key);
  check("the deal answers ok with one lot per card, keyed by entry (den/n, chest/n)", s1.cards.length > 0 && r1.lots.length === s1.cards.length && keys.some((k) => k.startsWith("den/")) && keys.every((k) => /^(den|chest)\/\d+$/.test(k)), { cards: s1.cards.length, lots: keys });
  check("the pile is open, its origin is the scene, and it posted no doorway card", s1.phase === "open" && s1.origin === "scene" && s1.messageId === null && s1.doors === 0, { phase: s1.phase, origin: s1.origin, messageId: s1.messageId, doors: s1.doors });
  check("every card is unfound, carries its lot key, and has its band set", s1.cards.every((c) => c.found === false && !!c.lot && c.value !== null && c.value !== undefined), s1.cards.map((c) => [c.found, !!c.lot, c.value !== null]));
  const bands = Object.fromEntries(s1.cards.map((c) => [c.id, c.value]));

  section("Player 1: before any lot is found");
  await run(player, P.render, { potId });
  const p1 = await run(player, P.readWindow, { potId, judge: false });
  check("the player's window shows no tile and counts none found", p1.found && p1.tileIds.length === 0 && p1.header === (await run(player, P.t, { key: "bar.found", data: { n: 0 } })), p1);

  section("Judge 2: the Judge's window");
  await run(gm, P.render, { potId });
  const j2 = await run(gm, P.readWindow, { potId, judge: true });
  check("the Judge sees every lot, each dashed with the Judge-only line, and no Turn button", j2.tiles === s1.cards.length && j2.unfound === s1.cards.length && j2.unfoundNote === s1.cards.length && j2.turnButtons === 0, j2);
  check("the header counts none found, and its tooltip adds how many are not found yet", j2.headerTip.includes(String(s1.cards.length)), { header: j2.header, tip: j2.headerTip });

  section("Judge 3: one lot found");
  const denKey = keys.find((k) => k.startsWith("den/"));
  const denCard = r1.lots.find((l) => l.key === denKey)?.cardId;
  const m3 = await run(gm, P.mark, { potId, outcome: { code: "scene:found", lots: [denKey] } });
  await sleep(800);
  const s3 = await run(gm, P.pileState, { potId });
  const j3 = await run(gm, P.readWindow, { potId, judge: true });
  check("the find marks exactly that lot's card found", (m3?.ids ?? []).length === 1 && s3.cards.filter((c) => c.found === true).map((c) => c.id).join() === denCard, { m3, denKey, denCard, found: s3.cards.filter((c) => c.found === true).map((c) => [c.id, c.lot]) });
  check("on the Judge's window one tile lost its dashed mark", j3.unfound === s1.cards.length - 1, { unfound: j3.unfound });
  check("no card's band changed after the find", s3.cards.every((c) => bands[c.id] === c.value));

  section("Player 2: after the find");
  await run(player, P.render, { potId });
  const p2 = await run(player, P.readWindow, { potId, judge: false });
  check("the player's window shows exactly the found lot's card, with a Turn control, and counts one found", p2.tileIds.length === 1 && p2.tileIds[0] === denCard && p2.turnButtons >= 1 && p2.header === (await run(player, P.t, { key: "bar.foundOne" })), { ...p2, denCard, want: await run(player, P.t, { key: "bar.foundOne" }) });

  section("Judge 4: a found-nothing answer marks nothing");
  const chestKey = keys.find((k) => k.startsWith("chest/"));
  if (chestKey) {
    const m4 = await run(gm, P.mark, { potId, outcome: { code: "scene:foundNothing", lots: [chestKey] } });
    await sleep(500);
    const s4 = await run(gm, P.pileState, { potId });
    check("a found-nothing answer marks no card", (m4?.ids ?? []).length === 0 && s4.cards.filter((c) => c.found === true).length === 1);
  } else note("no chest lot was dealt, so Judge 4 is not reached", chestKey);

  section("Player 3: the relay refuses an unfound lot");
  const unfoundCard = s3.cards.find((c) => c.found === false)?.id;
  if (unfoundCard) {
    const rr = await run(player, P.relay, { potId, op: "flip", cardId: unfoundCard });
    await sleep(500);
    const s5 = await run(gm, P.pileState, { potId });
    check("a flip of an unfound lot from the Player seat is refused notInPot and the card stays face down", rr?.reason === "notInPot" && s5.cards.find((c) => c.id === unfoundCard)?.face == null, { reason: rr?.reason });
  } else note("every dealt card is found, so Player 3 is not reached", unfoundCard);

  section("console");
  for (const [key, api] of Object.entries({ gm, player })) {
    const drained = await run(api, P.drain);
    check(`${key}: no console error over the walk`, !drained.errors.length, drained.errors.slice(0, 3).map((e) => e.slice(0, 120)));
  }

  section("teardown");
  await run(player, P.closeAll);
  await run(gm, P.closeAll);
  const swept = await gm.sweepTracked({ only: [r1.potUuid] });
  note("swept", swept);
  check("the run's pot was swept by tracked id, and the kept fixtures stand", (swept?.removed ?? []).length === 1 && swept.removed[0].uuid === r1.potUuid, swept);
  walkDone();
} catch (err) {
  if (err?.name !== "WalkBlocked") console.log(`WALK ERROR: ${err?.stack ?? err}`);
  process.exitCode = 1;
} finally {
  try { if (gm) await run(gm, P.restore); } catch {}
  try { if (player) await run(player, P.restore); } catch {}
  finish();
  try { gm?.close(); } catch {}
  try { player?.close(); } catch {}
}
