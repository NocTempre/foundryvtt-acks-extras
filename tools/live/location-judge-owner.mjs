/**
 * Live walk, location-judge-owner: a Judge named as an owner stands for no
 * character, so a pair a Judge made does not reach by that shared owner. Walks
 * docs/location/TESTING.md step 26. The decisive reads are the Player seat's,
 * because a GM seat is OWNER of every document and cannot test an ownership
 * gate; the GM seat is read beside it to show the two agree. A Judge-made
 * hero and place are refused on both seats, by `depositReach`, by `coinReach`
 * and by a relayed stash that leaves the goods where they were; an assistant
 * Judge named on both is refused the same way where the world has one; a pin
 * puts the same pair within reach, the stash lands and is retrieved; a player at
 * OWNER on both reaches; a character only a Judge owns does not reach a place
 * the world left open to everyone. Machine values arrive through ./_env.mjs.
 *
 * Fixtures, kept and found by marker: `location/judge-owner-place` (a location
 * that holds goods), `location/judge-owner-hero` (a character the Player seat
 * owns) and `location/judge-owner-npc` (a character only a Judge owns). The
 * step's start sets each one's ownership with `update({ownership}, {diff:
 * false, recursive: false})`, clears the hero's pin, and brings the walk's own
 * items (`flags.world.fixtureItem`) to one on the hero and none at the place.
 * Every figure printed is a count or a boolean. The walk builds nothing a sweep
 * would remove: its only builds are the kept fixtures.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";
import { walkDone, blocked } from "./_walk.mjs";

const MACHINE = machineSeats();
const LOCATION = "acks-extras.location";
/** The tag the walk's own embedded items carry, on both fixtures. */
const TAG = "location/judge-owner";

/** Added to every document a seat loads: errors from the first script on, each with the phase it landed in. */
const RECORDER = `(() => {
  const R = (globalThis.__ljoBoot = { phase: "load", phases: [], errors: [] });
  const push = (kind, text) => R.errors.push({ phase: R.phase, kind, text: String(text).slice(0, 300) });
  const error = console.error.bind(console);
  console.error = (...args) => { push("console", args.map((a) => a?.message ?? a).join(" ")); error(...args); };
  addEventListener("error", (e) => push("error", e.message));
  addEventListener("unhandledrejection", (e) => push("rejection", e.reason?.message ?? e.reason));
  const arm = setInterval(() => {
    if (!globalThis.Hooks?.once) return;
    clearInterval(arm);
    for (const phase of ["init", "setup", "ready"]) Hooks.once(phase, () => { R.phase = phase; R.phases.push(phase); });
  }, 2);
})()`;

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/* ------------------------------------------------------------------ */
/*  Page side                                                           */
/* ------------------------------------------------------------------ */

const P = {
  census: async () => ({
    role: game.user.role,
    userId: game.user.id,
    module: game.modules.get("acks-extras")?.version ?? null,
    activeGMIsSelf: !!game.users.activeGM?.isSelf,
    activeGM: game.users.activeGM?.id ?? null,
    assistantId: game.users.find((u) => u.role === CONST.USER_ROLES.ASSISTANT)?.id ?? null,
  }),

  /**
   * GM: bring the three fixtures to one shape. Each ownership map REPLACES the
   * stored one, the hero's pin is set as asked, the place holds goods, and the
   * hero carries one of the walk's items with none at the place.
   */
  shape: async ({ placeId, heroId, npcId, place, hero, npc, pin, tag }) => {
    const S = acksExtras.lib.storage;
    const R = acksExtras.location.reach;
    const placeDoc = game.actors.get(placeId);
    const heroDoc = game.actors.get(heroId);
    const npcDoc = game.actors.get(npcId);
    if (!placeDoc || !heroDoc || !npcDoc) throw new Error(`fixture missing: ${!!placeDoc}/${!!heroDoc}/${!!npcDoc}`);
    await placeDoc.update({ ownership: place }, { diff: false, recursive: false });
    await heroDoc.update({ ownership: hero }, { diff: false, recursive: false });
    await npcDoc.update({ ownership: npc }, { diff: false, recursive: false });
    await R.setPinnedPlace(heroDoc, placeDoc.uuid, false);
    await R.setPinnedPlace(npcDoc, placeDoc.uuid, false);
    await S.setProvider(placeDoc, true);
    for (const doc of [placeDoc, heroDoc]) {
      const own = doc.items.filter((i) => i.flags?.world?.fixtureItem === tag).map((i) => i.id);
      if (own.length) await doc.deleteEmbeddedDocuments("Item", own);
    }
    await heroDoc.createEmbeddedDocuments("Item", [{ name: "Judge Owner Walk Good", type: "item", flags: { world: { fixtureItem: tag } } }]);
    if (pin) await R.setPinnedPlace(heroDoc, placeDoc.uuid, true);
    const tokens = game.scenes.reduce((n, s) => n + s.tokens.filter((t) => [placeId, heroId, npcId].includes(t.actorId)).length, 0);
    return {
      provider: S.isProvider(placeDoc),
      placeMap: placeDoc.ownership,
      heroMap: heroDoc.ownership,
      pinned: R.pinnedPlaces(heroDoc).has(placeDoc.uuid),
      linkedScene: !!placeDoc.system?.sceneUuid,
      tokens,
      heroItems: heroDoc.items.filter((i) => i.flags?.world?.fixtureItem === tag).length,
      placeItems: placeDoc.items.filter((i) => i.flags?.world?.fixtureItem === tag).length,
    };
  },

  /**
   * Any seat: wait until this client holds the shape (ownership maps and pin),
   * then read what reach says about `subject` and the place.
   */
  read: async ({ placeId, subjectId, expectPlace, expectSubject, expectPin }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const R = acksExtras.location.reach;
    const place = game.actors.get(placeId);
    const subject = game.actors.get(subjectId);
    const norm = (m) => JSON.stringify(Object.entries(m ?? {}).sort(([a], [b]) => (a < b ? -1 : 1)));
    const held = () => norm(place?.ownership) === norm(expectPlace) && norm(subject?.ownership) === norm(expectSubject)
      && R.pinnedPlaces(subject).has(place.uuid) === expectPin;
    for (let i = 0; i < 80 && !held(); i++) await sleep(100);
    const deposit = R.depositReach(subject, place);
    const coin = acksExtras.lib.money.coinReach(subject, place);
    return {
      isGM: game.user.isGM,
      owns: subject.isOwner,
      held: held(),
      deposit: { can: !!deposit.can, reason: deposit.reason ?? null },
      coin: { can: !!coin.can, reason: coin.reason ?? null },
    };
  },

  /** Player seat: stash the hero's one item at the place, as the sheets' deposit does, and report where it is. */
  stash: async ({ placeId, heroId, tag, activeGM }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const S = acksExtras.lib.storage;
    const place = game.actors.get(placeId);
    const hero = game.actors.get(heroId);
    const item = hero.items.find((i) => i.flags?.world?.fixtureItem === tag);
    const answer = await S.stash(hero, place, [{ id: item.id }]);
    await sleep(1000);
    return {
      isGM: game.user.isGM,
      activeGMIsTheWalksSeat: game.users.activeGM?.id === activeGM,
      ok: !!answer?.ok,
      reason: answer?.reason ?? null,
      why: answer?.why ?? null,
      atPlace: place.items.filter((i) => i.flags?.world?.fixtureItem === tag).length,
      onHero: hero.items.filter((i) => i.flags?.world?.fixtureItem === tag).length,
    };
  },

  /** Player seat: take the walk's item back from the place, as the take button does. */
  retrieve: async ({ placeId, heroId, tag }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const S = acksExtras.lib.storage;
    const place = game.actors.get(placeId);
    const hero = game.actors.get(heroId);
    const row = place.items.find((i) => i.flags?.world?.fixtureItem === tag);
    const answer = row ? await S.retrieve(place, hero, [{ id: row.id }]) : null;
    await sleep(1000);
    return {
      ok: !!answer?.ok,
      reason: answer?.reason ?? null,
      atPlace: place.items.filter((i) => i.flags?.world?.fixtureItem === tag).length,
      onHero: hero.items.filter((i) => i.flags?.world?.fixtureItem === tag).length,
    };
  },

  /** GM: take the pin off, so the kept hero is left as the walk found it. */
  unpin: async ({ placeId, heroId }) => {
    const hero = game.actors.get(heroId);
    await acksExtras.location.reach.setPinnedPlace(hero, game.actors.get(placeId).uuid, false);
    return !acksExtras.location.reach.pinnedPlaces(hero).has(game.actors.get(placeId).uuid);
  },

  boot: async () => globalThis.__ljoBoot ?? null,
};

async function run(api, fn, ...args) {
  const text = await api.eval(`(${fn.toString()})(...${JSON.stringify(args)}).then((v) => JSON.stringify(v === undefined ? null : v))`);
  return JSON.parse(text);
}

async function ready(api, label, seconds = 240) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try {
      ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.location && !!globalThis.acksExtras?.lib?.storage`);
    } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}

/** Reload a seat's page under the load recorder, held by a second DevTools session until the page is ready. */
async function reloadRecorded(api, key) {
  const targets = await (await fetch(`http://127.0.0.1:${PORTS[key]}/json/list`)).json();
  const page = targets.find((t) => t.type === "page" && t.url.startsWith(MACHINE.origin));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let next = 0;
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++next;
    const on = (event) => {
      const reply = JSON.parse(event.data);
      if (reply.id === id) { ws.removeEventListener("message", on); resolve(reply.result); }
    };
    ws.addEventListener("message", on);
    ws.send(JSON.stringify({ id, method, params }));
  });
  await send("Page.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: RECORDER });
  await send("Page.reload");
  await sleep(1500);
  const seconds = await ready(api, key);
  ws.close();
  return seconds;
}

const seats = {};
async function seat(key) {
  const user = key === "gm" ? MACHINE.gm : MACHINE.player;
  const api = await connect({ browser: MACHINE.browser, origin: MACHINE.origin, user, port: PORTS[key], own: MACHINE.own });
  seats[key] = api;
  note(`ready (${key}) after (s)`, await ready(api, key));
  return api;
}

/** Shape the fixtures, wait for both seats to hold the shape, and read the subject's reach on each. */
async function stand(gm, player, ids, shape, subject) {
  const shaped = await run(gm, P.shape, { ...ids, ...shape, tag: TAG });
  const expect = { placeId: ids.placeId, subjectId: ids[subject], expectPlace: shape.place, expectSubject: shape[subject === "heroId" ? "hero" : "npc"], expectPin: !!shape.pin };
  const asPlayer = await run(player, P.read, expect);
  const asGM = await run(gm, P.read, expect);
  return { shaped, asPlayer, asGM };
}

try {
  section("seats");
  const gm = await seat("gm");
  const census = await run(gm, P.census);
  note("census", { role: census.role, module: !!census.module, assistant: !!census.assistantId });
  if (census.role !== 4) throw new Error("the GM seat is not a gamemaster");
  if (!census.activeGMIsSelf) blocked("another GM client is the active GM");
  const player = await seat("player");
  const pc = await run(player, P.census);
  if (pc.role >= 3) throw new Error("the player seat is not a player");
  const judge = census.userId;

  section("fixtures");
  const place = await gm.fixture("location/judge-owner-place", "Actor", { name: "Judge Owner Walk Place", type: LOCATION, ownership: { default: 0, [pc.userId]: 2 } });
  const hero = await gm.fixture("location/judge-owner-hero", "Actor", { name: "Judge Owner Walk Hero", type: "character", ownership: { default: 0, [pc.userId]: 3 } });
  const npc = await gm.fixture("location/judge-owner-npc", "Actor", { name: "Judge Owner Walk Npc", type: "character", ownership: { default: 0, [pc.userId]: 1 } });
  note("fixtures", { place: { built: place.built }, hero: { built: hero.built }, npc: { built: npc.built } });
  const ids = { placeId: place.id, heroId: hero.id, npcId: npc.id };
  const judgeBoth = { place: { default: 0, [judge]: 3, [pc.userId]: 2 }, hero: { default: 0, [judge]: 3, [pc.userId]: 3 }, npc: { default: 0, [judge]: 3, [pc.userId]: 1 } };
  // A bare location is pruned at the next primary-GM ready, so the place is a provider before the reload.
  await run(gm, P.shape, { ...ids, ...judgeBoth, tag: TAG });

  section("load recorder");
  note("gm recorded reload ready after (s)", await reloadRecorded(gm, "gm"));
  note("player recorded reload ready after (s)", await reloadRecorded(player, "player"));
  await sleep(3000);

  section("26. a Judge named on both is no one's player");
  const a =await stand(gm, player, ids, judgeBoth, "heroId");
  note("shape", { provider: a.shaped.provider, linkedScene: a.shaped.linkedScene, tokens: a.shaped.tokens, heroItems: a.shaped.heroItems, placeItems: a.shaped.placeItems });
  check("the fixtures are in shape: a provider place on no map, one walk item on the hero and none at the place", a.shaped.provider && !a.shaped.linkedScene && a.shaped.tokens === 0 && a.shaped.heroItems === 1 && a.shaped.placeItems === 0 && !a.shaped.pinned, a.shaped);
  check("the Player seat holds the shape, owns the hero and is no Judge", a.asPlayer.held && a.asPlayer.owns && !a.asPlayer.isGM, a.asPlayer);
  check("depositReach on the Player seat is notYours", !a.asPlayer.deposit.can && a.asPlayer.deposit.reason === "notYours", a.asPlayer.deposit);
  check("depositReach on the GM seat agrees", a.asGM.isGM && a.asGM.held && a.asGM.deposit.can === a.asPlayer.deposit.can && a.asGM.deposit.reason === a.asPlayer.deposit.reason, a.asGM.deposit);
  check("coinReach from the hero to the place is false on the Player seat", !a.asPlayer.coin.can, a.asPlayer.coin);
  const refused = await run(player, P.stash, { ...ids, tag: TAG, activeGM: census.userId });
  note("player stash (Judge on both)", refused);
  check("the Player seat's stash is refused out of reach, and the item stays on the hero", refused.activeGMIsTheWalksSeat && !refused.isGM && !refused.ok && refused.reason === "outOfReach" && refused.why === "notYours" && refused.onHero === 1 && refused.atPlace === 0, refused);

  section("26. an assistant Judge named on both");
  if (census.assistantId) {
    const asst = census.assistantId;
    const shape = { place: { default: 0, [asst]: 3, [pc.userId]: 2 }, hero: { default: 0, [asst]: 3, [pc.userId]: 3 }, npc: judgeBoth.npc };
    const b = await stand(gm, player, ids, shape, "heroId");
    check("an assistant Judge named on both: notYours on the Player seat, and the GM seat agrees", b.asPlayer.held && !b.asPlayer.deposit.can && b.asPlayer.deposit.reason === "notYours" && b.asGM.deposit.reason === "notYours" && !b.asPlayer.coin.can, { player: b.asPlayer.deposit, gm: b.asGM.deposit });
  } else {
    console.log("NOT CHECKED  the world has no assistant-Judge user");
  }

  section("26. a pin puts the same pair within reach");
  const c = await stand(gm, player, ids, { ...judgeBoth, pin: true }, "heroId");
  check("pinned, the Judge-made pair reaches: depositReach and coinReach on the Player seat, depositReach on the GM seat", c.shaped.pinned && c.asPlayer.held && c.asPlayer.deposit.can && c.asPlayer.coin.can && c.asGM.deposit.can, { player: c.asPlayer, gm: c.asGM.deposit });
  const landed = await run(player, P.stash, { ...ids, tag: TAG, activeGM: census.userId });
  note("player stash (pinned)", landed);
  check("the stash lands: the item leaves the hero and sits at the place", landed.ok && landed.atPlace === 1 && landed.onHero === 0, landed);
  const back = await run(player, P.retrieve, { ...ids, tag: TAG });
  check("a retrieval is ungated and brings the item back to the hero", back.ok && back.atPlace === 0 && back.onHero === 1, back);
  check("the pin comes off, so the kept hero is left unpinned", await run(gm, P.unpin, ids));

  section("26. a player at OWNER on the place");
  const d = await stand(gm, player, ids, { ...judgeBoth, place: { default: 0, [judge]: 3, [pc.userId]: 3 } }, "heroId");
  check("a player at OWNER on both reaches, by depositReach and coinReach, on both seats", d.asPlayer.held && d.asPlayer.deposit.can && d.asPlayer.coin.can && d.asGM.deposit.can, { player: d.asPlayer, gm: d.asGM.deposit });

  section("26. a Judge-only character beside a place open to everyone");
  const e = await stand(gm, player, ids, { place: { default: 3, [judge]: 3 }, hero: judgeBoth.hero, npc: { default: 0, [judge]: 3, [pc.userId]: 1 } }, "npcId");
  check("the Judge-only character is notYours at a place with default OWNER, on the Player seat and the GM seat", e.asPlayer.held && !e.asPlayer.owns && !e.asPlayer.deposit.can && e.asPlayer.deposit.reason === "notYours" && e.asGM.deposit.reason === "notYours", { player: e.asPlayer, gm: e.asGM.deposit });

  section("console");
  for (const [key, api] of Object.entries(seats)) {
    const boot = await run(api, P.boot);
    check(`${key}: the recorder saw init, setup and ready and no error from load to the walk's end`, boot && ["init", "setup", "ready"].every((x) => boot.phases.includes(x)) && boot.errors.length === 0, boot && { phases: boot.phases, errors: boot.errors.length });
  }
  walkDone();
} catch (err) {
  if (err?.name !== "WalkBlocked") console.error("WALK ERROR:", err?.stack ?? err?.message ?? err);
  checks.push(["the walk ran to its end", false]);
} finally {
  section("teardown");
  for (const api of Object.values(seats)) {
    try { await api.close(); } catch {}
  }
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
