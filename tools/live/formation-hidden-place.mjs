/**
 * Live walk, formation-hidden-place: a place made from a point nobody has
 * found is the Judge's until its token is shown. Walks docs/formation/TESTING.md,
 * "A place made from an unfound point", on the GM seat (the active GM) and the
 * Player seat. Machine values arrive through ./_env.mjs; nothing here names a
 * port, a world or a seat. Every name and note is invented.
 *
 * Fixtures, kept and found again by marker: the hex scene
 * `formation/hidden-place-scene`, written back to its grid before step 1; the
 * party `formation/hidden-place-party` and its token
 * `formation/hidden-place-party-token`, brought back to hex C and to journey
 * mode. The hex's stock is a flag on the scene, written again every run.
 *
 * Setup is the subject: each step makes a place, so the places and their
 * tokens are tracked by uuid as they are read back and swept at teardown, and
 * nothing else is deleted. The party is returned to delve, since a journeying
 * record is billed on every clock advance any walk makes. The walk advances no
 * clock and posts no card.
 */
import { connect } from "./_driver.mjs";
import { walkDone, blocked } from "./_walk.mjs";
import { MACHINE, PORTS, run, note, section, check, finish, sleep, watchdog } from "./_treasure-kit.mjs";

const MOD = "acks-extras";
const LOCATION = "acks-extras.location";
const CELL = 100;
const NOTE = "QA note for the Judge's eyes";

const P = {
  census: async ({ mod }) => {
    let lead = null;
    try {
      const ac = await import(`/modules/${mod}/scripts/lib/automation-client.mjs`);
      await Promise.race([ac.automationSettled(), new Promise((r) => setTimeout(r, 5000))]);
      lead = ac.isLeadClient();
    } catch (_e) { lead = null; }
    const logic = await import(`/modules/${mod}/scripts/formation/poi-logic.mjs`);
    const place = await import(`/modules/${mod}/scripts/lib/place.mjs`);
    return {
      isGM: game.user.isGM,
      role: game.user.role,
      userId: game.user.id,
      activeGMIsSelf: !!game.users.activeGM?.isSelf,
      lead,
      // The seat must run the working tree: these two exports are the change's own.
      fresh: typeof logic.revealOutcome === "function" && typeof place.placeOpensToTable === "function",
    };
  },

  shapeScene: async ({ uuid, data }) => {
    const scene = await fromUuid(uuid);
    await scene.update(data);
    const rect = scene.dimensions.sceneRect;
    const offset = scene.grid.getOffset({ x: rect.x + scene.grid.sizeX * 2.5, y: rect.y + scene.grid.sizeY * 2.5 });
    const centre = scene.grid.getCenterPoint(offset);
    const corner = scene.grid.getTopLeftPoint(offset);
    return { offset: { i: offset.i, j: offset.j }, centre: { x: centre.x, y: centre.y }, corner: { x: corner.x, y: corner.y }, type: scene.grid.type };
  },

  tokenData: async ({ partyId, xy }) => {
    const td = await game.actors.get(partyId).getTokenDocument({ x: xy.x, y: xy.y });
    const data = td.toObject();
    delete data._id;
    return data;
  },

  /** The party's record with its token adopted, the token on hex C, journeying on the scene. */
  party: async ({ partyId, sceneId, tokenId, xy }) => {
    const F = acksExtras.formation;
    const poll = async (fn, tries = 60) => {
      for (let n = 0; n < tries; n++) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 200)); }
      return null;
    };
    const record = await poll(() => Object.values(F.getFormations()).find((f) => f.actorId === partyId));
    if (!record) return { error: "no formation for the party actor" };
    const adopted = await poll(() => F.getFormations()[record.id]?.tokenId === tokenId);
    if (!adopted) return { error: `the formation's token is ${F.getFormations()[record.id]?.tokenId}, not the kept ${tokenId}` };
    await game.scenes.get(sceneId).tokens.get(tokenId).update({ x: xy.x, y: xy.y }, { animate: false });
    await F.travel.setJourneyMode(record.id, "journey", { sceneId });
    await new Promise((r) => setTimeout(r, 800));
    const now = F.getFormations()[record.id];
    const here = F.hexStock.trueHexOf(now);
    return { formationId: record.id, mode: now.travel?.mode ?? null, key: here?.key ?? null, centre: here?.center ? { x: here.center.x, y: here.center.y } : null, astray: here?.astray ?? null };
  },

  /** Hex C stocked by hand: P found by this formation; Q and R by nobody. Each carries a note. */
  stock: async ({ sceneId, key, label, fid, text }) => {
    const F = acksExtras.formation;
    const scene = game.scenes.get(sceneId);
    const point = (id, name, found) => ({ id, kind: "placed", name, sub: null, rarity: null, creature: null, draw: null, found, placeUuid: null, note: `${text} (${name})` });
    const points = [point("hiddenplace-p", "QA Point P", { [fid]: game.time.worldTime }), point("hiddenplace-q", "QA Point Q", {}), point("hiddenplace-r", "QA Point R", {})];
    await F.hexStock.writeStock(scene, key, { label: label ?? key, stocked: true, stockedAt: game.time.worldTime, terrain: "grassland", territory: "outlands", count: 3, judgeCount: 3, substitute: false, points, searches: {}, assessments: {} });
    await new Promise((r) => setTimeout(r, 400));
    const back = F.hexStock.readStock(scene, key);
    return { points: (back?.points ?? []).map((p) => ({ id: p.id, found: Object.keys(p.found ?? {}).length, placeUuid: p.placeUuid })) };
  },

  /** Press the point's own Make it a place on the party sheet, and wait for the stock to name the place. */
  makePlace: async ({ partyId, sceneId, key, pointId }) => {
    const F = acksExtras.formation;
    const app = await game.actors.get(partyId).sheet.render(true);
    await new Promise((r) => setTimeout(r, 1500));
    const el = app.element?.nodeType === 1 ? app.element : app.element?.[0];
    el?.querySelector('.tabs [data-group="primary"][data-tab="mode"]')?.click();
    await new Promise((r) => setTimeout(r, 600));
    const button = el?.querySelector(`[data-section="poi"] [data-action="hexPlace"][data-point-id="${pointId}"]`);
    if (!button) return { found: false, section: !!el?.querySelector('[data-section="poi"]'), buttons: el?.querySelectorAll('[data-action="hexPlace"]').length ?? 0 };
    button.click();
    const scene = game.scenes.get(sceneId);
    let placeUuid = null;
    for (let n = 0; n < 60 && !placeUuid; n++) {
      placeUuid = F.hexStock.readStock(scene, key)?.points?.find((p) => p.id === pointId)?.placeUuid ?? null;
      if (!placeUuid) await new Promise((r) => setTimeout(r, 200));
    }
    await new Promise((r) => setTimeout(r, 600));
    return { found: true, placeUuid };
  },

  /** The place as the GM stores it, and its tokens on the scene. */
  gmRead: async ({ placeUuid, sceneId, mod, text }) => {
    const actor = await fromUuid(placeUuid);
    if (!actor) return { actor: false };
    const tokens = game.scenes.get(sceneId).tokens.filter((t) => t.actorId === actor.id).map((t) => ({ uuid: t.uuid, id: t.id, hidden: t.hidden, actorLink: t.actorLink }));
    return {
      actor: true, id: actor.id, type: actor.type, name: actor.name,
      ownership: { ...actor._source.ownership },
      flag: actor.getFlag(mod, "hiddenPlace") ?? null,
      note: String(actor.system?.notes ?? "").includes(text),
      tokens,
    };
  },

  /** What this seat's user has of the place: the level, the directory row, and whether its sheet opens. */
  seatRead: async ({ actorId, trySheet = false }) => {
    const actor = game.actors.get(actorId);
    if (!actor) return { known: false };
    const dir = ui.actors?.element?.nodeType === 1 ? ui.actors.element : ui.actors?.element?.[0] ?? null;
    const out = {
      known: true,
      level: actor.getUserLevel(game.user),
      limited: actor.testUserPermission(game.user, "LIMITED"),
      owner: actor.isOwner,
      visible: actor.visible,
      directory: !!dir,
      row: !!dir?.querySelector(`[data-entry-id="${actorId}"]`),
      noteOnWire: !!actor._source?.system?.notes,
    };
    if (trySheet) {
      try {
        await actor.sheet.render({ force: true });
        await new Promise((r) => setTimeout(r, 800));
        out.sheet = !!actor.sheet.rendered;
        if (out.sheet) await actor.sheet.close({ animate: false });
      } catch (err) {
        out.sheet = false;
        out.refusal = String(err?.message ?? err).slice(0, 160);
      }
    }
    return out;
  },

  /** Show or hide a token as the token HUD's eye does: one embedded update on its scene. */
  setHidden: async ({ sceneId, tokenId, hidden }) => {
    await game.scenes.get(sceneId).updateEmbeddedDocuments("Token", [{ _id: tokenId, hidden }]);
    return { hidden: game.scenes.get(sceneId).tokens.get(tokenId)?.hidden ?? null };
  },

  raise: async ({ placeUuid, userId, level }) => {
    const actor = await fromUuid(placeUuid);
    await actor.update({ [`ownership.${userId}`]: level });
    return { ...actor._source.ownership };
  },

  /** A place made by hand, with or without the importer's stamp; nothing names its ownership. */
  handMade: async ({ name, type, mod, stamped }) => {
    const actor = await Actor.create({ name, type, ...(stamped ? { flags: { [mod]: { cookbook: { id: "def.invented.hiddenPlaceWalk", book: "inv", kind: "kind.location" } } } } : {}) });
    return { uuid: actor.uuid, default: actor._source.ownership?.default ?? null, stamp: actor.flags?.[mod]?.cookbook?.id ?? null, ownership: { ...actor._source.ownership } };
  },

  /** A plain actor of the system's monster type naming no ownership: the leak as a Judge meets it after a hand-made place on the same page. */
  plainMonster: async ({ name }) => {
    const actor = await Actor.create({ name, type: "monster" });
    return { uuid: actor.uuid, default: actor._source.ownership?.default ?? null };
  },

  /** An imported place dragged out of its shelf, where the world holds one. */
  dragOut: async ({ type, mod }) => {
    for (const pack of game.packs.filter((p) => p.documentName === "Actor")) {
      const index = await pack.getIndex({ fields: ["type", `flags.${mod}.cookbook.id`] });
      const hit = index.find((e) => e.type === type && e.flags?.[mod]?.cookbook?.id);
      if (!hit) continue;
      const actor = await game.actors.importFromCompendium(pack, hit._id);
      return { found: true, uuid: actor.uuid, default: actor._source.ownership?.default ?? null, stamped: !!actor.flags?.[mod]?.cookbook?.id };
    }
    return { found: false };
  },

  delve: async ({ fid }) => {
    const F = acksExtras.formation;
    await F.travel.setJourneyMode(fid, "delve");
    await new Promise((r) => setTimeout(r, 400));
    return F.getFormations()[fid]?.travel?.mode ?? null;
  },

  closeSheet: async ({ partyId }) => {
    try { await game.actors.get(partyId)?.sheet?.close({ animate: false }); } catch (_e) { /* closed */ }
    return null;
  },
};

async function ready(api, label, seconds = 240) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.formation?.hexStock?.trueHexOf`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}

/** Poll a seat's read of a place until `want` answers true of it, and return the last read. */
async function until(api, args, want, tries = 30) {
  let last = null;
  for (let n = 0; n < tries; n++) {
    last = await run(api, P.seatRead, args);
    if (want(last)) return last;
    await sleep(300);
  }
  return last;
}

let gm;
let player;
let fid = null;
let partyId = null;
const own = [];
watchdog(() => [gm, player]);
try {
  section("seats");
  gm = await connect({ browser: MACHINE.browser, origin: MACHINE.origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  note("gm ready after (s)", await ready(gm, "gm"));
  player = await connect({ browser: MACHINE.browser, origin: MACHINE.origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  note("player ready after (s)", await ready(player, "player"));
  const g = await run(gm, P.census, { mod: MOD });
  const p = await run(player, P.census, { mod: MOD });
  note("gm", { isGM: g.isGM, activeGMIsSelf: g.activeGMIsSelf, lead: g.lead, fresh: g.fresh });
  note("player", { isGM: p.isGM, role: p.role, fresh: p.fresh });
  if (!g.isGM) blocked("the GM seat joined a user that is not a GM");
  if (p.isGM) blocked("the Player seat joined a GM");
  if (!g.fresh || !p.fresh) blocked("a seat loaded module code without revealOutcome or placeOpensToTable; the page did not pick up the working tree");
  if (!g.activeGMIsSelf || g.lead !== true) blocked("another GM window is the one that runs the automation; the reveal would run there, on whatever code it loaded");
  const playerId = p.userId;

  section("fixtures");
  const sceneData = {
    name: "QA Hidden place", active: false, navigation: false, width: 2200, height: 1600, padding: 0, tokenVision: false, backgroundColor: "#8a8a8a",
    grid: { type: 2, size: CELL, distance: 7, units: "mi" }, ownership: { default: 2 },
  };
  const scene = await gm.fixture("formation/hidden-place-scene", "Scene", sceneData);
  const { name: _n, active: _a, ...shape } = sceneData;
  const C = await run(gm, P.shapeScene, { uuid: scene.uuid, data: shape });
  note("hex C", C);
  const party = await gm.fixture("formation/hidden-place-party", "Actor", { name: "QA Hidden Place Company", type: "acks-extras.party", ownership: { default: 0, [playerId]: 2 } });
  partyId = party.id;
  const tokenData = await run(gm, P.tokenData, { partyId, xy: C.corner });
  const partyToken = await gm.fixture("formation/hidden-place-party-token", "Token", tokenData, { parent: scene.uuid });
  const built = await run(gm, P.party, { partyId, sceneId: scene.id, tokenId: partyToken.id, xy: C.corner });
  note("party", built);
  if (built.error) throw new Error(built.error);
  fid = built.formationId;
  check("the party journeys in hex C, where the hex has a centre and no lost episode is open", built.mode === "journey" && !!built.key && !!built.centre && built.astray === false, built);
  const stock = await run(gm, P.stock, { sceneId: scene.id, key: built.key, label: null, fid, text: NOTE });
  note("stock", stock);
  check("hex C is stocked with P (found) and Q and R (found by nobody), none of them placed", stock.points.length === 3 && stock.points[0].found === 1 && stock.points[1].found === 0 && stock.points[2].found === 0 && stock.points.every((x) => !x.placeUuid), stock.points);

  /** Press Make it a place for a point, read the place back on the GM seat, and track what was made. */
  const make = async (pointId) => {
    const pressed = await run(gm, P.makePlace, { partyId, sceneId: scene.id, key: built.key, pointId });
    note(`pressed ${pointId}`, pressed);
    if (!pressed.found || !pressed.placeUuid) return { pressed, read: null };
    gm.track(pressed.placeUuid, "Actor");
    own.push(pressed.placeUuid);
    const read = await run(gm, P.gmRead, { placeUuid: pressed.placeUuid, sceneId: scene.id, mod: MOD, text: NOTE });
    for (const t of read.tokens ?? []) { gm.track(t.uuid, "Token"); own.push(t.uuid); }
    return { pressed, read };
  };

  section("1. a point nobody has found is made a place: the Judge's, behind a hidden token");
  const q = await make("hiddenplace-q");
  note("Q on the GM seat", q.read);
  check("Make it a place is on the Points of interest section for the unfound point, and the stock names the place", q.pressed.found && !!q.pressed.placeUuid, q.pressed);
  if (!q.read?.actor) throw new Error("the unfound point's place was not made; nothing after this can be read");
  check("the place is a location carrying the point's note", q.read.type === LOCATION && q.read.note === true, { type: q.read.type, note: q.read.note });
  check("its one token is hidden", q.read.tokens.length === 1 && q.read.tokens[0].hidden === true, q.read.tokens);
  check("its ownership names default None, and it carries the hidden-place flag", q.read.ownership.default === 0 && q.read.flag === true, { ownership: q.read.ownership, flag: q.read.flag });

  section("2. the Player seat has nothing of it but the document on the wire");
  const q2 = await until(player, { actorId: q.read.id, trySheet: true }, (r) => r.known);
  note("Q on the Player seat", q2);
  check("the Player's level on the place is None, below Limited", q2.known && q2.level === 0 && q2.limited === false && q2.owner === false, q2);
  check("the place is not visible to the Player, so the Actors tab does not list it", q2.visible === false && q2.directory === true && q2.row === false, { visible: q2.visible, directory: q2.directory, row: q2.row });
  check("the Player's seat does not open its sheet", q2.sheet === false, { sheet: q2.sheet, refusal: q2.refusal ?? null });
  note("the stated limit: the place's data still reaches the Player's client", { noteOnWire: q2.noteOnWire });

  section("3. control: a point the party has found is made a place for the table");
  const pt = await make("hiddenplace-p");
  note("P on the GM seat", pt.read);
  if (!pt.read?.actor) throw new Error("the found point's place was not made");
  check("its token is shown, its ownership default is Owner, and it carries no flag", pt.read.tokens.length === 1 && pt.read.tokens[0].hidden === false && pt.read.ownership.default === 3 && pt.read.flag === null, { tokens: pt.read.tokens, ownership: pt.read.ownership, flag: pt.read.flag });
  const p3 = await until(player, { actorId: pt.read.id }, (r) => r.known && r.row);
  note("P on the Player seat", p3);
  check("the Player owns it and the Actors tab lists it, on the same directory that does not list Q", p3.level === 3 && p3.visible === true && p3.row === true, p3);

  section("4. the Judge shows Q's token: the place opens to the table");
  note("shown", await run(gm, P.setHidden, { sceneId: scene.id, tokenId: q.read.tokens[0].id, hidden: false }));
  await until(player, { actorId: q.read.id }, (r) => r.level === 3 && r.row, 40);
  const q4gm = await run(gm, P.gmRead, { placeUuid: q.pressed.placeUuid, sceneId: scene.id, mod: MOD, text: NOTE });
  const q4 = await run(player, P.seatRead, { actorId: q.read.id, trySheet: true });
  note("Q on the GM seat", { ownership: q4gm.ownership, flag: q4gm.flag, tokens: q4gm.tokens });
  note("Q on the Player seat", q4);
  check("the place's ownership default is Owner and the flag is gone", q4gm.ownership.default === 3 && q4gm.flag === null, { ownership: q4gm.ownership, flag: q4gm.flag });
  check("the Player owns it, the Actors tab lists it and its sheet opens", q4.level === 3 && q4.visible === true && q4.row === true && q4.sheet === true, q4);

  section("5. one way: hiding the token again closes nothing");
  note("hidden", await run(gm, P.setHidden, { sceneId: scene.id, tokenId: q.read.tokens[0].id, hidden: true }));
  await sleep(2000);
  const q5gm = await run(gm, P.gmRead, { placeUuid: q.pressed.placeUuid, sceneId: scene.id, mod: MOD, text: NOTE });
  const q5 = await run(player, P.seatRead, { actorId: q.read.id });
  check("the token is hidden again and the place is still the table's", q5gm.tokens[0].hidden === true && q5gm.ownership.default === 3 && q5.level === 3 && q5.row === true, { gm: q5gm.ownership, player: q5 });

  section("6. a place the Judge has opened to one player by hand keeps that, and only loses the flag");
  const r = await make("hiddenplace-r");
  if (!r.read?.actor) throw new Error("the third point's place was not made");
  check("R starts as Q did: default None, flagged, behind a hidden token", r.read.ownership.default === 0 && r.read.flag === true && r.read.tokens[0]?.hidden === true, { ownership: r.read.ownership, flag: r.read.flag, tokens: r.read.tokens });
  note("raised by hand", await run(gm, P.raise, { placeUuid: r.pressed.placeUuid, userId: playerId, level: 2 }));
  await until(player, { actorId: r.read.id }, (x) => x.level === 2);
  note("shown", await run(gm, P.setHidden, { sceneId: scene.id, tokenId: r.read.tokens[0].id, hidden: false }));
  let r6gm = null;
  for (let n = 0; n < 30; n++) {
    r6gm = await run(gm, P.gmRead, { placeUuid: r.pressed.placeUuid, sceneId: scene.id, mod: MOD, text: NOTE });
    if (r6gm.flag === null) break;
    await sleep(300);
  }
  await sleep(1500);
  r6gm = await run(gm, P.gmRead, { placeUuid: r.pressed.placeUuid, sceneId: scene.id, mod: MOD, text: NOTE });
  const r6 = await run(player, P.seatRead, { actorId: r.read.id });
  note("R on the GM seat", { ownership: r6gm.ownership, flag: r6gm.flag });
  note("R on the Player seat", r6);
  check("the flag is gone, the default is still None and the Player is still an Observer", r6gm.flag === null && r6gm.ownership.default === 0 && r6gm.ownership[playerId] === 2 && r6.level === 2, { ownership: r6gm.ownership, flag: r6gm.flag, level: r6.level });

  section("7. the table default for a new place: a hand-made one takes it, one carrying the importer's stamp does not");
  const plain = await run(gm, P.handMade, { name: "QA Hand-made place", type: LOCATION, mod: MOD, stamped: false });
  gm.track(plain.uuid, "Actor");
  own.push(plain.uuid);
  const stamped = await run(gm, P.handMade, { name: "QA Stamped place", type: LOCATION, mod: MOD, stamped: true });
  gm.track(stamped.uuid, "Actor");
  own.push(stamped.uuid);
  note("hand-made", plain);
  note("stamped and naming no ownership, the shape the importer writes to the Actors tab", stamped);
  check("a place made by hand with no stamp is the table's: default Owner", plain.default === 3, plain);
  check("a place carrying the importer's stamp keeps core's default, None", stamped.default === 0, stamped);
  const monster = await run(gm, P.plainMonster, { name: "QA Plain monster after a hand-made place" });
  gm.track(monster.uuid, "Actor");
  own.push(monster.uuid);
  check("a plain monster made on the same page, naming no ownership, starts at None", monster.default === 0, monster);
  const dragged = await run(gm, P.dragOut, { type: LOCATION, mod: MOD });
  note("an imported place dragged out of its shelf", dragged);
  if (dragged.found) {
    gm.track(dragged.uuid, "Actor");
    own.push(dragged.uuid);
    check("control: the copy dragged out of a shelf carries the stamp and reads None, which core's own import names", dragged.stamped === true && dragged.default === 0, dragged);
  } else {
    note("not exercised", "no compendium in this world holds an imported place, so the drag out of a shelf, a control, was not walked");
  }
  walkDone();
} catch (err) {
  if (err?.name !== "WalkBlocked") console.error(`WALK ERROR: ${err?.stack ?? err}`);
  process.exitCode = 1;
} finally {
  const threw = process.exitCode === 1;
  if (gm) {
    try {
      if (partyId) await run(gm, P.closeSheet, { partyId });
      if (fid) note("party back in", await run(gm, P.delve, { fid }));
    } catch (e) { console.error(`WALK ERROR: the party was not returned to delve: ${e}`); process.exitCode = 1; }
    try {
      const swept = own.length ? await gm.sweepTracked({ only: own }) : { removed: [], missing: [], failed: [] };
      note("swept", { removed: swept.removed.length, missing: swept.missing.length, failed: swept.failed.length, asked: own.length });
      if (swept.failed.length) { note("not removed", swept.failed); process.exitCode = 1; }
    } catch (e) { console.error(`WALK ERROR: sweep failed: ${e}`); process.exitCode = 1; }
  }
  const failed = process.exitCode === 1;
  finish();
  if (threw || failed) process.exitCode = 1;
  try { if (player) await player.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
}
