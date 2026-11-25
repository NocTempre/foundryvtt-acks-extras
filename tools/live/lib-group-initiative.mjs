/**
 * Live walk, a warband's token in a combat: docs/lib/TESTING.md "A warband's
 * token in a combat". A warband with two gangs nested in it joins a combat and
 * each gang is grouped for initiative by the system's own `combat.manageGroup`.
 * The walk checks that lib's partition is right (each stored group holds one
 * gang's bodies and no other), tells the system's bonus defect (T-0734) apart
 * from lib's, rolls the fight's initiative and a second round's, adds a gang's
 * own token before the warband's (the stored group keeps its roll), regroups
 * with the system's call as a Judge would (lib makes no call after it), joins a
 * group of one body (lib makes no call), and ends each combat (the bodies are
 * recalled, the group tokens visible and unflagged).
 * Machine values arrive through ./_env.mjs. Every name and figure here is invented.
 *
 * Group combat acts on the primary GM's window: the walk prints who the active
 * GM is, and a combat that places nothing names it in its FAIL.
 *
 * Fixtures, kept and found again by marker (`api.fixture`): the monsters
 * `lib/combat-monster-a` and `lib/combat-monster-b`, and the groups
 * `lib/combat-gang-a`, `lib/combat-gang-b` and `lib/combat-warband`. A step
 * asserts the shape it reads at its start: the monsters' initiative values differ,
 * each group holds one resting stack over its monster at its full count with no
 * record, both gangs' parent is the warband, the warband's is blank. Disposable,
 * by the run's own ledger: the scene, the tokens of the warband, of gang A and of
 * the one-body group, the combats, the one-body group, and every chat card this
 * client posted while the walk ran (caught by a wrapper on the message class, not
 * by author or time). The only write outside the ledger is the kept fixtures' own
 * shape, rewritten at the start and again at the end, and the GM seat's viewed
 * scene, which the walk sets to its own scene (the system's roll reads
 * `canvas.scene`) and puts back.
 *
 * Observed, not checked: T-0734 (the system's bonus is the last call's lowest),
 * and whether a group rolls again in a second round (the answer goes to the plan's
 * owner).
 *
 * Not driven: the tracker's HUD button, its group control and its Roll All button.
 * A combatant is made through the combat (which is what the hook reads), the
 * regroup is `combat.manageGroup` itself, and the roll is `combat.rollInitiative`
 * for the combatants whose initiative is blank, since the system's `rollAll`
 * refuses before a combat is started and starting it opens a dialog. Whether a
 * group's stored initiative reaches the server is not driven: the walk prints the
 * stored list as the page holds it and as the document's source holds it.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";
import { walkDone, blocked } from "./_walk.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const GROUP = "acks-extras.group";
const TAG = MACHINE.own ? ` ${MACHINE.own}` : "";
// Invented bodies: the warband's own stack, then each gang's.
const SIZES = { warband: 2, a: 3, b: 3 };
// Invented initiative values of the two monsters; they differ, so a bonus taken from the wrong gang shows.
const INIT = { a: 1, b: 3 };
const KEYS = ["warband", "a", "b"];
const NAMES = { warband: "the warband's own bodies", a: "gang A", b: "gang B", one: "the one-body group" };

const tally = { pass: 0, fail: 0 };
const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const check = (label, ok, detail) => {
  tally[ok ? "pass" : "fail"] += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/* Page side: each function is stringified and run in the GM seat's page. */
const P = {
  census: async () => {
    let persistence = null;
    try { persistence = game.settings.get("acks", "initiativePersistence"); } catch (_e) { persistence = "unreadable"; }
    return {
      user: game.user.name,
      role: game.user.role,
      activeGM: game.users.activeGM?.name ?? null,
      activeGMIsSelf: !!game.users.activeGM?.isSelf,
      api: !!globalThis.acksExtras?.lib?.groups,
      canvas: !!globalThis.canvas,
      viewing: globalThis.canvas?.scene?.id ?? null,
      persistence,
    };
  },

  /** Wrap the message class's create so every card this client posts is recorded; the ids are read back at teardown. */
  arm: async () => {
    const H = (globalThis.__groupInit = globalThis.__groupInit ?? { cards: [], undo: [] });
    if (H.undo.length) return true;
    const classes = new Set([CONFIG.ChatMessage.documentClass, globalThis.ChatMessage, foundry.documents.ChatMessage].filter(Boolean));
    for (const cls of classes) {
      const own = Object.hasOwn(cls, "create");
      const original = cls.create;
      cls.create = async function (...args) {
        const made = await original.apply(this, args);
        for (const m of [made].flat()) if (m?.id) H.cards.push(m.id);
        return made;
      };
      H.undo.push(() => { if (own) cls.create = original; else delete cls.create; });
    }
    return true;
  },
  cards: async () => [...new Set(globalThis.__groupInit?.cards ?? [])].filter((id) => game.messages.has(id)),
  disarm: async () => {
    const H = globalThis.__groupInit;
    for (const undo of H?.undo ?? []) undo();
    if (H) H.undo = [];
    return true;
  },

  /** The kept fixtures at their shape: monsters' values, stacks rebuilt where they differ, the nesting written. */
  shape: async ({ ids, monsters, init, sizes }) => {
    const groups = acksExtras.lib.groups;
    const mons = { a: game.actors.get(monsters.a), b: game.actors.get(monsters.b) };
    // The system derives `initiative.value` from `initiative.mod` on every prepare, so the mod is the field written.
    for (const k of ["a", "b"]) await mons[k].update({ "system.initiative.mod": init[k], "system.hp": { hd: "1d4", value: 6, max: 6 } });
    const over = { warband: mons.a, a: mons.a, b: mons.b };
    const actor = Object.fromEntries(Object.keys(ids).map((k) => [k, game.actors.get(ids[k])]));
    const rewrote = [];
    for (const k of Object.keys(sizes)) {
      const g = actor[k];
      const m = over[k];
      const [s, ...more] = g.system.toObject().stacks;
      const right = s && !more.length && s.template.uuid === m.uuid && s.template.snapshot?.system?.initiative?.mod === m.system.initiative.mod && s.size.current === sizes[k] && s.size.initial === sizes[k] && !s.roster.length && !s.fixedHp;
      if (right) continue;
      await g.update({ "system.stacks": [] });
      await groups.addStack(g, m, { count: sizes[k] });
      rewrote.push(g.name);
    }
    const links = [
      (await groups.setParentGroup(actor.a, actor.warband.uuid)).reason ?? "ok",
      (await groups.setParentGroup(actor.b, actor.warband.uuid)).reason ?? "ok",
      (await groups.setParentGroup(actor.warband, "")).reason ?? "ok",
    ];
    const flagged = (g) => game.scenes.reduce((n, sc) => n + sc.tokens.filter((t) => t.getFlag("acks-extras", "group") === g.uuid).length, 0);
    return {
      rewrote,
      links,
      parents: [actor.a.system.unit.parentGroupUuid === actor.warband.uuid, actor.b.system.unit.parentGroupUuid === actor.warband.uuid],
      warbandParent: actor.warband.system.unit.parentGroupUuid,
      stacks: ["warband", "a", "b"].map((k) => actor[k].system.toObject().stacks.length),
      bodies: ["warband", "a", "b"].map((k) => groups.bodyCount(actor[k])),
      bases: [mons.a.system.initiative.value, mons.b.system.initiative.value],
      strays: Object.values(actor).reduce((n, g) => n + flagged(g), 0),
    };
  },

  addOne: async ({ groupId, monsterId, count }) => {
    const key = await acksExtras.lib.groups.addStack(game.actors.get(groupId), game.actors.get(monsterId), { count });
    return key ?? null;
  },

  /** View the walk's scene on this seat: the system's roll reads `canvas.scene`. */
  view: async ({ sceneId }) => {
    await game.scenes.get(sceneId)?.view();
    return globalThis.canvas?.scene?.id ?? null;
  },

  token: async ({ sceneId, groupId, x, y }) => {
    const scene = game.scenes.get(sceneId);
    const td = await game.actors.get(groupId).getTokenDocument({ x, y }, { parent: scene });
    const [made] = await scene.createEmbeddedDocuments("Token", [td.toObject()]);
    return { id: made.id, uuid: made.uuid };
  },

  /** A fresh active combat on the scene, with a pass-through on its `manageGroup` that records every call's token ids. */
  combat: async ({ sceneId }) => {
    const combat = await Combat.create({ scene: sceneId, active: true });
    // A combat the world already holds may be the active one; activating this one makes it `game.combat`.
    await combat.activate();
    const H = (globalThis.__groupInit = globalThis.__groupInit ?? { cards: [], undo: [] });
    H.calls = H.calls ?? {};
    H.calls[combat.id] = [];
    H.mine = false;
    const original = combat.manageGroup;
    combat.manageGroup = function (tokens) {
      H.calls[combat.id].push({ ids: [...tokens].map((t) => t.id), mine: H.mine });
      return original.call(this, tokens);
    };
    return { id: combat.id, viewed: globalThis.canvas?.scene?.id === sceneId, current: game.combat?.id === combat.id };
  },

  /** The token joins the combat: a combatant it already holds goes first, which is the toggle's off half. */
  join: async ({ combatId, sceneId, tokenId }) => {
    const combat = game.combats.get(combatId);
    const had = combat.combatants.filter((c) => c.tokenId === tokenId).map((c) => c.id);
    if (had.length) await combat.deleteEmbeddedDocuments("Combatant", had);
    await combat.createEmbeddedDocuments("Combatant", [{ tokenId, sceneId, actorId: game.scenes.get(sceneId).tokens.get(tokenId).actorId }]);
    return had.length;
  },

  endCombat: async ({ combatId }) => {
    await game.combats.get(combatId)?.delete();
    return !game.combats.has(combatId);
  },

  /** The system's own roll for the named combatants, or for every combatant whose initiative is blank. */
  roll: async ({ combatId, ids }) => {
    const combat = game.combats.get(combatId);
    const list = ids ?? [...combat.combatants].filter((c) => c.initiative == null).map((c) => c.id);
    if (!list.length) return { rolled: 0 };
    try {
      await combat.rollInitiative(list);
      return { rolled: list.length, viewed: globalThis.canvas?.scene?.id === combat.scene?.id, current: game.combat?.id === combatId };
    } catch (err) { return { rolled: 0, threw: String(err?.message ?? err) }; }
  },

  nextRound: async ({ combatId }) => {
    try { await game.combats.get(combatId).nextRound(); return { ok: true }; } catch (err) { return { threw: String(err?.message ?? err) }; }
  },

  /** The Judge's regroup: the system's call, marked as the walk's own so lib's calls count apart. */
  regroup: async ({ combatId, tokenIds }) => {
    const combat = game.combats.get(combatId);
    const H = globalThis.__groupInit;
    const tokens = tokenIds.map((id) => combat.combatants.find((c) => c.tokenId === id)?.token).filter(Boolean);
    H.mine = true;
    try { combat.manageGroup(tokens); } finally { H.mine = false; }
    return tokens.length;
  },

  /** Every call `combat.manageGroup` took since the combat was made: its token ids and whether the walk made it. */
  calls: async ({ combatId }) => globalThis.__groupInit?.calls?.[combatId] ?? [],

  /** The scene, the combat and the stored groups as they stand. */
  state: async ({ sceneId, combatId, uuids, tokenIds }) => {
    const scene = game.scenes.get(sceneId);
    const combat = combatId ? game.combats.get(combatId) : null;
    const keyOf = (u) => (u ? Object.keys(uuids).find((k) => uuids[k] === u) ?? null : null);
    const bodies = scene.tokens
      .filter((t) => keyOf(t.getFlag("acks-extras", "group")))
      .map((t) => ({ id: t.id, group: keyOf(t.getFlag("acks-extras", "group")) }));
    const combatants = combat
      ? [...combat.combatants].map((c) => ({ id: c.id, tokenId: c.tokenId, initiative: c.initiative ?? null, actorType: c.actor?.type ?? null, base: c.actor?.system?.initiative?.value ?? null }))
      : [];
    const read = (raw) => (raw ?? []).map((g) => ({ initiative: g.initiative, bonus: g.initiativeBonus, tokens: [...(g.tokens ?? [])] }));
    const tokens = Object.fromEntries(Object.entries(tokenIds).map(([k, id]) => {
      const t = scene.tokens.get(id);
      return [k, t ? { hidden: t.hidden, flag: t.getFlag("acks-extras", "groupCombat") ?? null, combatants: combatants.filter((c) => c.tokenId === id).length } : null];
    }));
    return {
      exists: !!combat,
      round: combat?.round ?? null,
      bodies,
      combatants,
      stored: read(combat?.flags?.acks?.groups),
      source: read(combat?._source?.flags?.acks?.groups),
      unset: combat?.flags?.acks?.groups == null,
      tokens,
    };
  },
};

const run = (api, fn, arg) => api.eval(`(${fn.toString()})(${JSON.stringify(arg ?? null)})`);

/** Read a page function until `test` passes, or give the last reading back. */
async function until(api, fn, arg, test, { tries = 60, every = 250 } = {}) {
  let value;
  for (let n = 0; n < tries; n++) {
    value = await run(api, fn, arg);
    if (test(value)) return value;
    await sleep(every);
  }
  return value;
}

/* Reading a state, in Node. */

/** The sorted ids of the bodies that are combatants, by gang: what lib's partition says each gang's group is. */
function expectedGangs(s) {
  const fighting = new Set(s.combatants.map((c) => c.tokenId));
  const by = {};
  for (const b of s.bodies) if (fighting.has(b.id)) (by[b.group] = by[b.group] ?? []).push(b.id);
  return Object.fromEntries(Object.entries(by).filter(([, ids]) => ids.length > 1).map(([k, ids]) => [k, ids.sort()]));
}

/** Which gangs a stored group's tokens belong to, by the bodies' own group flags. */
function ownersOf(group, s) {
  const of = Object.fromEntries(s.bodies.map((b) => [b.id, b.group]));
  return [...new Set(group.tokens.map((id) => of[id] ?? "?"))];
}

/** Does the stored list hold exactly one group for each gang the partition names, each with that gang's bodies alone? */
function partitionHolds(s) {
  const expected = expectedGangs(s);
  const owners = s.stored.map((g) => ownersOf(g, s));
  const one = owners.every((o) => o.length === 1);
  const keys = owners.map((o) => o[0]);
  const same = one && keys.length === new Set(keys).size && keys.length === Object.keys(expected).length
    && s.stored.every((g, i) => JSON.stringify([...g.tokens].sort()) === JSON.stringify(expected[keys[i]]));
  return { ok: same, detail: { expected: Object.fromEntries(Object.entries(expected).map(([k, v]) => [k, v.length])), stored: s.stored.map((g, i) => ({ owners: owners[i], tokens: g.tokens.length })) } };
}

/** For each stored group: its gang, its stored bonus and roll, and the lowest `system.initiative.value` among its own bodies' actors. */
function describeStored(s) {
  const base = Object.fromEntries(s.combatants.map((c) => [c.tokenId, c.base]));
  return s.stored.map((g) => {
    const lows = g.tokens.map((id) => base[id]).filter((v) => typeof v === "number");
    return { owners: ownersOf(g, s), tokens: g.tokens.length, bonus: g.bonus, initiative: g.initiative, ownLow: lows.length ? Math.min(...lows) : null };
  });
}

/** The initiative values each gang's combatants show. */
function valuesBy(s) {
  const of = Object.fromEntries(s.bodies.map((b) => [b.id, b.group]));
  const out = {};
  for (const c of s.combatants) (out[of[c.tokenId] ?? "other"] = out[of[c.tokenId] ?? "other"] ?? []).push(c.initiative);
  return out;
}

const open = {};
const swept = [];
let shapeArgs = null;
let previousScene = null;

try {
  section("seats");
  open.gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  const gm = open.gm;
  const census = await run(gm, P.census);
  note("active GM", { name: census.activeGM, isThisSeat: census.activeGMIsSelf, seat: census.user });
  note("initiative persistence setting", census.persistence);
  if (!census.api || !census.canvas) blocked("acksExtras.lib.groups or the canvas is not on the page: the module did not load, or no scene is drawn");
  check("the seat is a GM", census.role >= 3, census.role);
  previousScene = census.viewing;
  await run(gm, P.arm);
  const stuck = () => (census.activeGMIsSelf ? `; the active GM is this seat (${census.activeGM}), so its lead window did not act` : `; the active GM is ${census.activeGM}, a client that is not this seat, so the deploy ran there or nowhere`);

  section("fixtures");
  const monA = await gm.fixture("lib/combat-monster-a", "Actor", { name: `QA Combat monster A${TAG}`, type: "monster", items: [] });
  const monB = await gm.fixture("lib/combat-monster-b", "Actor", { name: `QA Combat monster B${TAG}`, type: "monster", items: [] });
  const fx = {
    warband: await gm.fixture("lib/combat-warband", "Actor", { name: `QA Combat warband${TAG}`, type: GROUP, items: [] }),
    a: await gm.fixture("lib/combat-gang-a", "Actor", { name: `QA Combat gang A${TAG}`, type: GROUP, items: [] }),
    b: await gm.fixture("lib/combat-gang-b", "Actor", { name: `QA Combat gang B${TAG}`, type: GROUP, items: [] }),
  };
  const ids = { warband: fx.warband.id, a: fx.a.id, b: fx.b.id };
  shapeArgs = { ids, monsters: { a: monA.id, b: monB.id }, init: INIT, sizes: SIZES };
  const shape = await run(gm, P.shape, shapeArgs);
  note("shape", shape);
  const total = SIZES.warband + SIZES.a + SIZES.b;
  check("each group is at its shape: one stack, both gangs inside the warband, the warband inside none", shape.stacks.join() === "1,1,1" && shape.parents.every(Boolean) && shape.warbandParent === "" && shape.links.every((r) => r === "ok" || r === "same"), shape);
  check(`the warband counts ${total} bodies, each gang its own`, shape.bodies.join() === [total, SIZES.a, SIZES.b].join(), shape.bodies);
  check("the two monsters' initiative values differ, as the system holds them", typeof shape.bases[0] === "number" && typeof shape.bases[1] === "number" && shape.bases[0] !== shape.bases[1], shape.bases);
  check("no body token of any of the three stands on any scene", shape.strays === 0, shape.strays);

  const scene = await gm.create("Scene", { name: `QA Combat scene${TAG}`, width: 1200, height: 800, grid: { size: 100 } });
  swept.push(scene.uuid);
  const viewed = await until(gm, P.view, { sceneId: scene.id }, (v) => v === scene.id, { tries: 20 });
  check("this seat views the walk's scene, so the system's roll reads it", viewed === scene.id, viewed);
  const ctx = {
    sceneId: scene.id,
    uuids: { warband: `Actor.${ids.warband}`, a: `Actor.${ids.a}`, b: `Actor.${ids.b}` },
    tokenIds: {},
  };
  const warbandToken = await run(gm, P.token, { sceneId: scene.id, groupId: ids.warband, x: 200, y: 200 });
  swept.push(gm.track(warbandToken.uuid, "Token"));
  ctx.tokenIds.warband = warbandToken.id;

  /** A fresh combat on the walk's scene, tracked. */
  const newCombat = async () => {
    const made = await run(gm, P.combat, { sceneId: scene.id });
    swept.push(gm.track(made.id, "Combat"));
    check("the combat is the one this seat views and holds, so the roll's timer reaches it", made.viewed && made.current, made);
    return made;
  };
  const state = (combatId, test, options) => until(gm, P.state, { ...ctx, combatId }, test, options);
  const read = (combatId) => run(gm, P.state, { ...ctx, combatId });
  const libCalls = async (combatId) => (await run(gm, P.calls, { combatId })).filter((c) => !c.mine);

  /** Step 8: the combat is deleted and every body is recalled, the group tokens visible and unflagged. */
  const ending = async (label, combatId) => {
    await run(gm, P.endCombat, { combatId });
    // The rolls' own timer updates the combat 200 ms after a roll; let it pass before reading.
    await sleep(400);
    const s = await state(combatId, (st) => !st.bodies.length && Object.values(st.tokens).every((t) => !t || (t.hidden === false && t.flag === null)));
    check(`${label}: ending the combat recalls every body, and each group token is visible and unflagged`, !s.exists && !s.bodies.length && Object.values(s.tokens).every((t) => !t || (t.hidden === false && t.flag === null)), { bodies: s.bodies.length, tokens: s.tokens });
  };

  // ---- Steps 1 to 4: the warband's token joins a fresh combat -------------------------
  section("the warband's token joins a combat");
  const fight1 = await newCombat();
  await run(gm, P.join, { combatId: fight1.id, sceneId: scene.id, tokenId: warbandToken.id });
  const gangsExpected = [SIZES.warband, SIZES.a, SIZES.b].filter((n) => n > 1).length;
  let s = await state(fight1.id, (st) => st.bodies.length === total && st.combatants.length === total && st.stored.length >= gangsExpected, { tries: 100 });
  const placed = s.bodies.length === total;
  note("after the add", { bodies: s.bodies.length, combatants: s.combatants.length, stored: s.stored.length, libCalls: (await libCalls(fight1.id)).length });
  check(`${total} body tokens stand: ${SIZES.warband} flagged with the warband, ${SIZES.a} with gang A, ${SIZES.b} with gang B`, KEYS.every((k) => s.bodies.filter((b) => b.group === k).length === SIZES[k]), `${JSON.stringify(Object.fromEntries(KEYS.map((k) => [k, s.bodies.filter((b) => b.group === k).length])))}${placed ? "" : stuck()}`);
  if (placed) {
    check(`${total} combatants, each a body, none for any group`, s.combatants.length === total && s.combatants.every((c) => s.bodies.some((b) => b.id === c.tokenId)) && s.combatants.every((c) => c.actorType !== GROUP), { combatants: s.combatants.length });
    check("the warband's token is hidden and flagged with the combat", s.tokens.warband?.hidden === true && s.tokens.warband?.flag?.combatId === fight1.id && s.tokens.warband.combatants === 0, s.tokens.warband);

    section("the stored groups: lib's partition, and the system's bonus");
    const part = partitionHolds(s);
    note("expected groups: the gangs of two or more bodies", part.detail.expected);
    note("stored list", describeStored(s));
    note("stored list as the document's source holds it", s.source.length);
    check("the stored list holds one group for each gang of two or more bodies, each with that gang's bodies alone", part.ok, part.detail);
    for (const k of ["a", "b"]) {
      const g = s.stored.find((x) => ownersOf(x, s).join() === k);
      check(`${NAMES[k]}'s group holds exactly its ${SIZES[k]} bodies`, !!g && g.tokens.length === SIZES[k] && ownersOf(g, s).length === 1, g ? { tokens: g.tokens.length } : "no group stored for it");
    }
    note("the warband's own bodies", SIZES.warband > 1 ? `${SIZES.warband} bodies: a gang of two or more, so gangPartition names a group for them from the root group` : "one body: no group, the system refuses a group of one");
    const calls1 = await libCalls(fight1.id);
    check("lib called the system once for each gang the partition names", calls1.length === Object.keys(expectedGangs(s)).length, calls1.map((c) => c.ids.length));

    const lows = {};
    for (const g of describeStored(s)) if (g.owners.length === 1) lows[g.owners[0]] = g.ownLow;
    const wrong = describeStored(s).filter((g) => g.bonus !== g.ownLow);
    note("T-0734 reading: each group's stored bonus against the lowest initiative value among its own actors", describeStored(s).map((g) => ({ gang: g.owners.join("+"), bonus: g.bonus, ownLow: g.ownLow, bonusIsOwn: g.bonus === g.ownLow })));
    if (wrong.length) {
      note("T-0734", `present, the system's: ${wrong.map((g) => `${g.owners.join("+")} holds ${g.bonus} where its own lowest is ${g.ownLow}${Object.keys(lows).filter((k) => lows[k] === g.bonus).map((k) => `, which is ${NAMES[k]}'s lowest`).join("")}`).join("; ")}. manageGroup recomputes every stored group's bonus from the tokens of its latest call. Recorded, not fixed here.`);
    } else {
      note("T-0734", "absent: every group's bonus is the lowest among its own actors");
    }

    section("roll all");
    const rolled = await run(gm, P.roll, { combatId: fight1.id });
    note("roll", rolled);
    check("the roll ran", !rolled.threw && rolled.rolled === total, rolled);
    s = await state(fight1.id, (st) => st.combatants.length === total && st.combatants.every((c) => c.initiative !== null));
    const values = valuesBy(s);
    note("initiative by gang", values);
    note("stored groups after the roll (page / document source)", { page: s.stored.map((g) => g.initiative), source: s.source.map((g) => g.initiative) });
    check("every combatant holds an initiative", s.combatants.every((c) => c.initiative !== null), values);
    const groupOf = (g) => s.combatants.filter((c) => g.tokens.includes(c.tokenId)).map((c) => c.initiative);
    check("each stored group's combatants share one value", s.stored.length > 0 && s.stored.every((g) => new Set(groupOf(g)).size === 1), s.stored.map((g) => ({ gang: ownersOf(g, s).join("+"), values: groupOf(g) })));
    check("a body of a gang the partition leaves out is in no stored group", s.bodies.every((b) => s.stored.some((g) => g.tokens.includes(b.id)) === (b.group in expectedGangs(s))), s.bodies.length);
    check("the roll did not add or change a stored group's members", partitionHolds(s).ok, partitionHolds(s).detail);

    section("a second round");
    const before = { values: valuesBy(s), stored: s.stored.map((g) => ({ gang: ownersOf(g, s).join("+"), initiative: g.initiative })) };
    note("round 1, before", before);
    const turned = await run(gm, P.nextRound, { combatId: fight1.id });
    note("next round", turned);
    s = await state(fight1.id, (st) => st.round === 2 && st.combatants.every((c) => c.initiative === null), { tries: 24 });
    const cleared = s.round === 2 && s.combatants.every((c) => c.initiative === null);
    note("after the round turned", { round: s.round, initiatives: s.combatants.map((c) => c.initiative), persistence: census.persistence });
    const rerolled = await run(gm, P.roll, { combatId: fight1.id });
    note("roll again", rerolled);
    s = await state(fight1.id, (st) => st.combatants.every((c) => c.initiative !== null), { tries: 24 });
    const after = { values: valuesBy(s), stored: s.stored.map((g) => ({ gang: ownersOf(g, s).join("+"), initiative: g.initiative })) };
    note("round 2, after", after);
    note("NOTE", `the stored group initiatives are not compared: the system never writes a group's rolled figure back, so they read ${JSON.stringify(before.stored.map((g) => g.initiative))} before and ${JSON.stringify(after.stored.map((g) => g.initiative))} after`);
    const shared = (values) => Object.fromEntries(Object.entries(values).map(([k, v]) => [k, [...new Set(v)].join("/")]));
    const sharedBefore = shared(before.values);
    const sharedAfter = shared(after.values);
    const changed = Object.keys(sharedAfter).filter((k) => sharedBefore[k] !== sharedAfter[k]);
    const setting = `with the initiative persistence setting at ${JSON.stringify(census.persistence)}`;
    note("OBSERVATION: does a group roll again each round?", `${cleared ? "yes" : "no"}, ${setting}: the round turn ${cleared ? "cleared" : "did not clear"} every combatant's initiative; `
      + `${changed.length ? `${changed.map((k) => NAMES[k] ?? k).join(" and ")} took ${changed.length === 1 ? "a different shared value" : "different shared values"} from round 1 to round 2 (${JSON.stringify(sharedBefore)} then ${JSON.stringify(sharedAfter)})` : `no gang's shared value changed (${JSON.stringify(sharedAfter)})`}; `
      + "a matching value can be chance, since the roll is 1d6 plus the bonus");
  }
  await ending("the first combat", fight1.id);

  // ---- Step 5 and 6: a gang already in the fight, then the Judge's regroup -------------
  section("a gang already in the fight");
  const gangAToken = await run(gm, P.token, { sceneId: scene.id, groupId: ids.a, x: 200, y: 600 });
  swept.push(gm.track(gangAToken.uuid, "Token"));
  ctx.tokenIds.a = gangAToken.id;
  const fight2 = await newCombat();
  await run(gm, P.join, { combatId: fight2.id, sceneId: scene.id, tokenId: gangAToken.id });
  s = await state(fight2.id, (st) => st.bodies.length === SIZES.a && st.combatants.length === SIZES.a && st.stored.length >= 1, { tries: 100 });
  const aOut = s.bodies.length === SIZES.a;
  check(`gang A's own token sends out its ${SIZES.a} bodies, one combatant each, one stored group, its token hidden`, aOut && s.combatants.length === SIZES.a && s.stored.length === 1 && s.tokens.a?.hidden === true && s.tokens.a.combatants === 0, `${JSON.stringify({ bodies: s.bodies.length, combatants: s.combatants.length, stored: s.stored.length, token: s.tokens.a })}${aOut ? "" : stuck()}`);
  if (aOut && s.stored.length) {
    const aFirst = s.stored[0].tokens.slice().sort();
    // The system's roll gives a value only to the ids it is passed, and a group's rolled figure is shared
    // between them only inside one call, so all of gang A's bodies are rolled in one call.
    const aIds = s.combatants.filter((c) => aFirst.includes(c.tokenId)).map((c) => c.id);
    const rolledA = await run(gm, P.roll, { combatId: fight2.id, ids: aIds });
    note("roll of gang A's bodies in one call", rolledA);
    s = await state(fight2.id, (st) => st.combatants.length === SIZES.a && st.combatants.every((c) => c.initiative !== null), { tries: 20 });
    const aValues = s.combatants.map((c) => c.initiative);
    const rollA = aValues[0];
    note("gang A's combatants after the roll; its stored group (page / document source)", { combatants: aValues, page: s.stored[0]?.initiative, source: s.source[0]?.initiative });
    note("NOTE", `the system does not persist a group's rolled initiative: rollInitiative assigns it on the list it read from the flag and never writes the flag back, so the stored figure is ${s.stored[0]?.initiative} on the page and ${s.source[0]?.initiative} in the document's source after the roll`);
    check("precondition, the system's roll: every one of gang A's combatants shares one initiative value after the roll", aValues.length === SIZES.a && aValues.every((v) => v === rollA && typeof v === "number"), aValues);

    await run(gm, P.join, { combatId: fight2.id, sceneId: scene.id, tokenId: warbandToken.id });
    const want = total;
    s = await state(fight2.id, (st) => st.bodies.length === want && st.combatants.length === want && st.stored.length >= gangsExpected, { tries: 100 });
    const out2 = s.bodies.length === want;
    note("after the warband's token", { bodies: s.bodies.length, combatants: s.combatants.length, stored: describeStored(s), libCalls: (await libCalls(fight2.id)).map((c) => c.ids.length) });
    check(`the warband's token brings ${want - SIZES.a} more bodies out`, out2, `${JSON.stringify({ bodies: s.bodies.length })}${out2 ? "" : stuck()}`);
    if (out2) {
      const aGroups = s.stored.filter((g) => ownersOf(g, s).join() === "a");
      check("gang A's stored group keeps its three bodies and is stored once", aGroups.length === 1 && aGroups[0].tokens.length === SIZES.a && JSON.stringify([...aGroups[0].tokens].sort()) === JSON.stringify(aFirst), aGroups.map((g) => g.tokens.length));
      const aNow = s.combatants.filter((c) => aFirst.includes(c.tokenId)).map((c) => c.initiative);
      check("gang A's combatants still show the initiative they rolled once the warband has joined", aNow.length === SIZES.a && aNow.every((v) => v === rollA), { rolled: rollA, now: aNow });
      check("gang B is grouped with its bodies alone", s.stored.some((g) => ownersOf(g, s).join() === "b" && g.tokens.length === SIZES.b), s.stored.map((g) => ({ gang: ownersOf(g, s).join("+"), tokens: g.tokens.length })));
      check("the stored list still holds one group for each gang the partition names", partitionHolds(s).ok, partitionHolds(s).detail);
      check("no combatant stands for gang A's token or the warband's, and both tokens are hidden and flagged", s.tokens.a?.combatants === 0 && s.tokens.warband?.combatants === 0 && s.tokens.a?.hidden === true && s.tokens.warband?.hidden === true, { a: s.tokens.a, warband: s.tokens.warband });
      const gangCalls = (await libCalls(fight2.id)).map((c) => c.ids.length);
      check("lib called the system for gang A once (its own token) and, for the warband's token, for the gangs not yet stored only", gangCalls.length === 1 + Object.keys(expectedGangs(s)).filter((k) => k !== "a").length, gangCalls);

      // ---- Step 6: the Judge's regroup -----------------------------------------------
      section("the Judge's regroup");
      const aTok = s.bodies.find((b) => b.group === "a").id;
      const bTok = s.bodies.find((b) => b.group === "b").id;
      const regrouped = await run(gm, P.regroup, { combatId: fight2.id, tokenIds: [aTok, bTok] });
      note("regroup of one body of gang A and one of gang B", { tokens: regrouped });
      const exactly = (st) => st.stored.some((g) => g.tokens.length === 2 && g.tokens.includes(aTok) && g.tokens.includes(bTok));
      const first = await state(fight2.id, exactly, { tries: 40 });
      note("stored list right after the regroup", describeStored(first));
      check("the system stores the Judge's group: exactly those two bodies", exactly(first), first.stored.map((g) => g.tokens.length));
      await sleep(1500);
      const later = await read(fight2.id);
      note("stored list 1.5 s later", describeStored(later));
      check("nothing is added or changed in the stored list a second and a half later", JSON.stringify(first.stored) === JSON.stringify(later.stored), { before: first.stored.length, after: later.stored.length });
      const holders = later.stored.filter((g) => g.tokens.includes(aTok) || g.tokens.includes(bTok));
      const aLeft = later.stored.find((g) => ownersOf(g, later).join() === "a" && !g.tokens.includes(aTok));
      const bLeft = later.stored.find((g) => ownersOf(g, later).join() === "b" && !g.tokens.includes(bTok));
      check("only the Judge's group holds the two bodies: each gang's own group lost the one taken from it, and lib did not restore it", holders.length === 1 && holders[0].tokens.length === 2 && aLeft?.tokens.length === SIZES.a - 1 && bLeft?.tokens.length === SIZES.b - 1, later.stored.map((g) => ({ gang: ownersOf(g, later).join("+"), tokens: g.tokens.length })));
      const callsAfter = await run(gm, P.calls, { combatId: fight2.id });
      check("lib made no call after the Judge's: the walk's is the last call manageGroup took", callsAfter.length > 0 && callsAfter[callsAfter.length - 1].mine === true, callsAfter.map((c) => ({ ids: c.ids.length, mine: c.mine })));
    }
  }
  await ending("the second combat", fight2.id);

  // ---- Step 7: a group of one body ---------------------------------------------------
  section("a group of one body");
  const lone = await gm.create("Actor", { name: `QA Combat lone${TAG}`, type: GROUP, items: [] });
  swept.push(lone.uuid);
  const loneKey = await run(gm, P.addOne, { groupId: lone.id, monsterId: monA.id, count: 1 });
  check("the one-body group holds its stack", !!loneKey, loneKey);
  ctx.uuids.one = `Actor.${lone.id}`;
  const loneToken = await run(gm, P.token, { sceneId: scene.id, groupId: lone.id, x: 800, y: 600 });
  swept.push(gm.track(loneToken.uuid, "Token"));
  ctx.tokenIds.one = loneToken.id;
  const fight3 = await newCombat();
  await run(gm, P.join, { combatId: fight3.id, sceneId: scene.id, tokenId: loneToken.id });
  s = await state(fight3.id, (st) => st.bodies.length === 1 && st.combatants.length === 1 && st.tokens.one?.hidden === true, { tries: 100 });
  const oneOut = s.bodies.length === 1;
  check("the one body comes out with a combatant, and the group's token is hidden", oneOut && s.combatants.length === 1 && s.tokens.one?.hidden === true, `${JSON.stringify({ bodies: s.bodies.length, combatants: s.combatants.length, token: s.tokens.one })}${oneOut ? "" : stuck()}`);
  await sleep(1500);
  s = await read(fight3.id);
  const callsOne = await run(gm, P.calls, { combatId: fight3.id });
  check("no stored group: the combat's group list is unset or empty", s.unset || s.stored.length === 0, { unset: s.unset, stored: s.stored.length });
  check("lib made no call to the system's group control", callsOne.length === 0, callsOne);
  await ending("the third combat", fight3.id);

  walkDone();
} catch (err) {
  console.log(`WALK ERROR: ${err?.message ?? err}`);
  console.error(err?.stack ?? err);
  process.exitCode = 1;
} finally {
  section("teardown");
  try {
    if (open.gm) {
      for (const id of await run(open.gm, P.cards)) swept.push(open.gm.track(id, "ChatMessage"));
      await run(open.gm, P.disarm);
      if (previousScene) await run(open.gm, P.view, { sceneId: previousScene });
    }
  } catch (err) { console.error("cards:", err?.message ?? err); }
  try { if (open.gm && swept.length) note("swept", await open.gm.sweepTracked({ only: swept })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  try { if (open.gm && shapeArgs) note("shape at the end", await run(open.gm, P.shape, shapeArgs)); } catch (err) { console.error("shape:", err?.message ?? err); }
  console.log(`\nchecks: ${tally.pass} passed, ${tally.fail} failed`);
  if (tally.fail) process.exitCode = 1;
  for (const api of Object.values(open)) { try { api.close(); } catch (_e) { /* closed */ } }
}
