/**
 * Live walk, lib/aura-bearer: the Item Reach Region behavior and the item
 * carrier, from a launch that registers the sub-type to a hand-deleted Region.
 * Walks docs/lib/TESTING.md, "The aura reach and the item carrier", steps 1 to 8:
 * the `acks-extras.aura` sub-type and its label with a clean init, setup and
 * ready (1); `support()` (2); a raise through `Item#use` that attaches one Region
 * to the token, which follows, hides and shows with it, goes with a deleted
 * token, and is refused on a blank radius (3); a hand-made aura behavior with an
 * empty config that does nothing (4); the bearer down by hit points and by the
 * defeated status, on a linked and an unlinked body (5); the token and point
 * snapshots (6); a Region deleted by hand clearing the toggle's state (7); and
 * an unflagged item and an ability with no activation acting as the system's own
 * (8). Machine values arrive through ./_env.mjs. The GM seat drives; no Player
 * seat is taken. The seat reloads under a load recorder added before the page's
 * first script, so what `init`, `setup` and `ready` log is read.
 *
 * Fixtures, kept and found by marker (`api.fixture`): the scene
 * `lib/aura-scene`, gridded and viewed; the actors `lib/aura-bearer` (a monster
 * with a linked prototype token), `lib/aura-ally`, `lib/aura-foe`, `lib/aura-far`
 * and `lib/aura-unlinked`; the bearer's gear items `lib/aura-gear` (a 10-foot
 * standing reach, a toggle) and `lib/aura-gear-blank` (the same with a blank
 * radius), and `lib/aura-unlinked-gear` on the unlinked actor; and the tokens
 * `lib/aura-bearer-token`, `lib/aura-ally-token`, `lib/aura-foe-token`,
 * `lib/aura-far-token` (linked) and `lib/aura-unlinked-token` (unlinked). The
 * walk asserts the shape it needs once, before step 3: tokens placed and shown,
 * no reach standing on a bearer, no defeated status, hit points full, each
 * gear's toggle state cleared. Nothing is rolled back at the end.
 *
 * The run's own products are tracked and swept by id: the disposable token whose
 * deletion step 3 proves, the hand-made Region (swept as step 4 ends), the plain
 * item and ability step 8 uses, every card their use posts, and any aura Region
 * left on the fixture scene. The fixtures stay.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";
import { walkDone, blocked } from "./_walk.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const SEATS = { gm: MACHINE.gm };

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/** The module whose flags the fixtures carry. */
const MOD = "acks-extras";
/** A one-row toggle carrier with a 10-foot standing reach, and the same row with a blank radius. */
const run10 = { activation: { kind: "toggle" }, rows: [{ key: "r1", reach: { pulse: "standing", radius: { value: "10" }, filter: {} } }] };
const runBlank = { activation: { kind: "toggle" }, rows: [{ key: "r1", reach: { pulse: "standing", radius: {}, filter: {} } }] };

/** Added to every document the seat loads: errors from the first script on, each with the phase it landed in. */
const RECORDER = `(() => {
  const R = (globalThis.__auraBoot = { phase: "load", phases: [], errors: [], warns: [] });
  const push = (list, kind, text) => R[list].push({ phase: R.phase, kind, text: String(text).slice(0, 300) });
  const error = console.error.bind(console);
  console.error = (...args) => { push("errors", "console", args.map((a) => a?.message ?? a).join(" ")); error(...args); };
  addEventListener("error", (e) => push("errors", "error", e.message));
  addEventListener("unhandledrejection", (e) => push("errors", "rejection", e.reason?.message ?? e.reason));
  const arm = setInterval(() => {
    if (!globalThis.Hooks?.once) return;
    clearInterval(arm);
    for (const phase of ["init", "setup", "ready"]) Hooks.once(phase, () => { R.phase = phase; R.phases.push(phase); });
  }, 2);
})()`;

async function ready(api, seconds = 150) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.lib`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`not ready after ${seconds}s`);
    await sleep(1000);
  }
}

/**
 * Reload the seat's page under the load recorder. A second DevTools session adds
 * it to every new document and stays open until the page is ready, since the
 * script lasts no longer than the session that added it.
 */
async function reloadRecorded(api, port) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((t) => t.type === "page" && t.url.startsWith(origin));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let next = 0;
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++next;
    const on = (event) => { const reply = JSON.parse(event.data); if (reply.id === id) { ws.removeEventListener("message", on); resolve(reply.result); } };
    ws.addEventListener("message", on);
    ws.send(JSON.stringify({ id, method, params }));
  });
  await send("Page.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: RECORDER });
  await send("Page.reload");
  await sleep(1500);
  const seconds = await ready(api);
  ws.close();
  return seconds;
}

let gm = null;
/** The uuids of what the run itself made and sweeps: the fixtures are never in it. */
const disposables = [];
let sceneUuid = null;
const run = (fn, arg) => gm.eval(`(${fn.toString()})(${JSON.stringify(arg ?? null)})`);
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 570_000);
setTimeout(() => {
  console.error(`WALK ERROR: wall clock of ${WALL_MS} ms reached; closing the seat`);
  try { gm?.close(); } catch {}
  process.exit(1);
}, WALL_MS).unref();
try {
  section("seat");
  gm = await connect({ browser, origin, user: SEATS.gm, port: PORTS.gm, own: MACHINE.own });
  note("ready after reload (s)", await reloadRecorded(gm, PORTS.gm));

  section("1. the sub-type, the label, the load console");
  const boot = await run(() => ({
    user: game.user.name,
    active: game.users.filter((u) => u.active).map((u) => u.name),
    activeGMIsSelf: !!game.users.activeGM?.isSelf,
    extras: game.modules.get("acks-extras")?.version,
    lib: acksExtras.lib.apiVersion,
    regionBehaviorTypes: game.documentTypes.RegionBehavior,
    label: game.i18n.localize(CONFIG.RegionBehavior.typeLabels?.["acks-extras.aura"] ?? "TYPES.RegionBehavior.acks-extras.aura"),
    boot: globalThis.__auraBoot,
  }));
  note("boot", boot);
  check("1 aura sub-type registered at launch", boot.regionBehaviorTypes.includes("acks-extras.aura"), { types: boot.regionBehaviorTypes });
  check("1 label is ACKS Item Reach", boot.label === "ACKS Item Reach", { label: boot.label });
  check("1 init/setup/ready reached with no console error", ["init", "setup", "ready"].every((p) => boot.boot?.phases.includes(p)) && boot.boot.errors.length === 0, { phases: boot.boot?.phases, errors: boot.boot?.errors });
  check("1 this seat is the active GM", boot.activeGMIsSelf, { active: boot.active });
  if (!boot.activeGMIsSelf) blocked("another client is the active GM; the automation would run there");

  section("2. support");
  const support = await run(() => acksExtras.lib.auraReach.support());
  check("2 support() ok", support.ok === true && support.missing.length === 0, support);

  section("fixtures");
  const scene = await gm.fixture("lib/aura-scene", "Scene", { name: "Aura Walk", width: 1600, height: 1000, grid: { size: 100, distance: 5, units: "ft", type: 1 } });
  sceneUuid = scene.uuid;
  const bearer = await gm.fixture("lib/aura-bearer", "Actor", { name: "Aura Bearer", type: "monster", prototypeToken: { actorLink: true, disposition: -1 } });
  const ally = await gm.fixture("lib/aura-ally", "Actor", { name: "Aura Ally", type: "monster" });
  const foe = await gm.fixture("lib/aura-foe", "Actor", { name: "Aura Foe", type: "monster" });
  const far = await gm.fixture("lib/aura-far", "Actor", { name: "Aura Far", type: "monster" });
  const loose = await gm.fixture("lib/aura-unlinked", "Actor", { name: "Aura Unlinked", type: "monster" });
  const gear = await gm.fixture("lib/aura-gear", "Item", { name: "Aura Gear", type: "item", flags: { [MOD]: { itemRun: run10 } } }, { parent: bearer.uuid });
  const blank = await gm.fixture("lib/aura-gear-blank", "Item", { name: "Aura Gear Blank", type: "item", flags: { [MOD]: { itemRun: runBlank } } }, { parent: bearer.uuid });
  const looseGear = await gm.fixture("lib/aura-unlinked-gear", "Item", { name: "Aura Gear", type: "item", flags: { [MOD]: { itemRun: run10 } } }, { parent: loose.uuid });
  const tok = (marker, a, x, y, disposition, actorLink = true) => gm.fixture(marker, "Token", { name: a.name, actorId: a.id, actorLink, x, y, disposition }, { parent: scene.uuid });
  const tBearer = await tok("lib/aura-bearer-token", bearer, 500, 500, -1);
  const tAlly = await tok("lib/aura-ally-token", ally, 600, 500, -1);
  const tFoe = await tok("lib/aura-foe-token", foe, 700, 500, 1);
  const tFar = await tok("lib/aura-far-token", far, 1100, 500, 1);
  const tLoose = await tok("lib/aura-unlinked-token", loose, 500, 800, -1, false);

  // Shape the kept fixtures need at the start: positions, visible, alive, no reach up, no defeated status.
  await run(async (a) => {
    const scene = fromUuidSync(a.scene);
    if (canvas.scene?.id !== scene.id) { await scene.view(); for (let i = 0; i < 40 && canvas.scene?.id !== scene.id; i++) await new Promise((r) => setTimeout(r, 250)); }
    const place = { [a.tBearer]: [500, 500], [a.tAlly]: [600, 500], [a.tFoe]: [700, 500], [a.tFar]: [1100, 500], [a.tLoose]: [500, 800] };
    for (const [id, [x, y]] of Object.entries(place)) await scene.tokens.get(id).update({ x, y, hidden: false }, { animate: false });
    for (const id of [a.tBearer, a.tLoose]) {
      const t = scene.tokens.get(id);
      for (const r of [...(t.attachments?.regions ?? [])]) await r.delete();
      const dead = CONFIG.specialStatusEffects.DEFEATED;
      if (t.actor.statuses.has(dead)) await t.actor.toggleStatusEffect(dead, { active: false });
      await t.actor.update({ "system.hp.value": 8, "system.hp.max": 8 });
    }
    for (const u of [a.gear, a.looseGear]) await fromUuidSync(u).update({ "flags.acks-extras.itemRun.activation.state": { active: false, activationId: "", regionId: "" } });
  }, { scene: scene.uuid, tBearer: tBearer.id, tAlly: tAlly.id, tFoe: tFoe.id, tFar: tFar.id, tLoose: tLoose.id, gear: gear.uuid, looseGear: looseGear.uuid });

  section("3. raise through Item#use, follow, hide, delete, refusal on a blank radius");
  const raised = await run(async (a) => {
    const scene = fromUuidSync(a.scene);
    const t = scene.tokens.get(a.tBearer);
    const item = fromUuidSync(a.gear);
    const res = await item.use();
    await new Promise((r) => setTimeout(r, 500));
    const regions = [...(t.attachments?.regions ?? [])];
    const r = regions[0];
    return {
      res: res && typeof res === "object" ? { ok: res.ok ?? null, reason: res.reason ?? null, regionId: res.regionId ?? null } : (res ?? null),
      count: regions.length,
      behaviors: r ? [...r.behaviors].map((b) => b.type) : [],
      shape: r?.shapes?.[0] ? { type: r.shapes[0].type, radius: r.shapes[0].radius, base: { x: r.shapes[0].base?.x, y: r.shapes[0].base?.y } } : null,
      visibility: r?.visibility, hidden: r?.hidden, attachedTo: r?.attachment?.token ?? null,
      state: item.flags?.["acks-extras"]?.itemRun?.activation?.state ?? null,
      gridPx: scene.dimensions.distancePixels,
    };
  }, { scene: scene.uuid, tBearer: tBearer.id, gear: gear.uuid });
  note("raise", raised);
  check("3 Item#use raises one Region with one aura behavior, attached to the token", raised.count === 1 && raised.behaviors.length === 1 && raised.behaviors[0] === "acks-extras.aura" && raised.attachedTo === tBearer.id, raised);
  check("3 ring radius is 10 ft in pixels on a 5 ft grid (2 squares)", raised.shape && Math.round(raised.shape.radius) === Math.round(10 * raised.gridPx), raised.shape);
  check("3 GM-visible", raised.visibility === 1, { visibility: raised.visibility });

  const follow = await run(async (a) => {
    const scene = fromUuidSync(a.scene);
    const t = scene.tokens.get(a.tBearer);
    await t.update({ x: 400, y: 400 }, { animate: false });
    await new Promise((r) => setTimeout(r, 400));
    const r = [...t.attachments.regions][0];
    const moved = { x: r?.shapes?.[0]?.base?.x, y: r?.shapes?.[0]?.base?.y };
    await t.update({ hidden: true });
    await new Promise((r) => setTimeout(r, 300));
    const hidden = r?.hidden;
    await t.update({ hidden: false });
    await new Promise((r) => setTimeout(r, 300));
    const shown = r?.hidden;
    await t.update({ x: 500, y: 500 }, { animate: false });
    return { moved, hidden, shown };
  }, { scene: scene.uuid, tBearer: tBearer.id });
  check("3 Region follows the token", follow.moved.x === 400 && follow.moved.y === 400, follow.moved);
  check("3 Region hides and shows with the token", follow.hidden === true && follow.shown === false, follow);

  const refused = await run(async (a) => {
    const scene = fromUuidSync(a.scene);
    const t = scene.tokens.get(a.tBearer);
    const before = t.attachments.regions.size;
    const res = await acksExtras.lib.auraReach.raise({ tokenUuid: t.uuid, sourceUuid: a.blank, rowKey: "r1", activationId: "walk-blank" });
    return { res: { ok: res?.ok ?? null, reason: res?.reason ?? null }, before, after: t.attachments.regions.size };
  }, { scene: scene.uuid, tBearer: tBearer.id, blank: blank.uuid });
  check("3 blank radius refused, nothing created", refused.res?.ok === false && refused.after === refused.before, refused);

  // Deleting a token takes its Region with it; the token is the run's own, tracked.
  const disp = await gm.create("Token", { name: "Aura Disposable", actorId: loose.id, actorLink: false, x: 1300, y: 800 }, { parent: scene.uuid });
  disposables.push(disp.uuid);
  const delTok = await run(async (a) => {
    const scene = fromUuidSync(a.scene);
    const t = scene.tokens.get(a.id);
    const res = await acksExtras.lib.auraReach.raise({ tokenUuid: t.uuid, sourceUuid: t.actor.items.find((i) => i.name === "Aura Gear").uuid, rowKey: "r1", activationId: "walk-disp" });
    const rid = res.regionId;
    const had = !!scene.regions.get(rid);
    await t.delete();
    await new Promise((r) => setTimeout(r, 500));
    return { res: { ok: res?.ok ?? null, regionId: res?.regionId ?? null }, had, after: !!scene.regions.get(rid) };
  }, { scene: scene.uuid, id: disp.id });
  check("3 deleting the token removes its Region", delTok.had && delTok.after === false, delTok);

  section("4. a hand-made aura behavior with an empty config");
  const hand = await gm.create("Region", { name: "Aura Hand-made", shapes: [{ type: "rectangle", x: 1000, y: 100, width: 300, height: 300 }], behaviors: [{ type: "acks-extras.aura", name: "hand", system: {} }] }, { parent: scene.uuid });
  const handRes = await run(async (a) => {
    const scene = fromUuidSync(a.scene);
    const t = scene.tokens.get(a.tFar);
    const effectsBefore = t.actor.effects.size;
    const errs = globalThis.__auraBoot.errors.length;
    await t.update({ x: 1100, y: 200 }, { animate: false });
    await new Promise((r) => setTimeout(r, 600));
    await t.update({ x: 1100, y: 500 }, { animate: false });
    await new Promise((r) => setTimeout(r, 600));
    return { effectsBefore, effectsAfter: t.actor.effects.size, newErrors: globalThis.__auraBoot.errors.slice(errs) };
  }, { scene: scene.uuid, tFar: tFar.id });
  check("4 hand-made aura behavior does nothing, throws nothing", handRes.effectsAfter === handRes.effectsBefore && handRes.newErrors.length === 0, handRes);
  const swHand = await gm.sweepTracked({ only: [hand.uuid] });
  note("sweep (the hand-made Region)", { removed: swHand.removed.length, missing: swHand.missing.length, failed: swHand.failed.map((e) => ({ uuid: e.uuid, error: e.error })) });

  section("5. the bearer down by hit points and by the defeated status; an unlinked body");
  const down = await run(async (a) => {
    const scene = fromUuidSync(a.scene);
    const t = scene.tokens.get(a.tBearer);
    const heard = [];
    const id = Hooks.on("acksExtras.bearerDown", (token, { cause }) => heard.push({ token: token.id, cause }));
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const out = {};
    out.hpBefore = t.attachments.regions.size;
    await t.actor.update({ "system.hp.value": 0 });
    await wait(700);
    out.hpAfter = t.attachments.regions.size;
    await t.actor.update({ "system.hp.value": 8 });
    await fromUuidSync(a.gear).use();
    await wait(500);
    out.defBefore = t.attachments.regions.size;
    const dead = CONFIG.specialStatusEffects.DEFEATED;
    await t.actor.toggleStatusEffect(dead, { active: true });
    await wait(700);
    out.defAfter = t.attachments.regions.size;
    await t.actor.toggleStatusEffect(dead, { active: false });
    const lt = scene.tokens.get(a.tLoose);
    const lr = await acksExtras.lib.auraReach.raise({ tokenUuid: lt.uuid, sourceUuid: lt.actor.items.find((i) => i.name === "Aura Gear").uuid, rowKey: "r1", activationId: "walk-loose" });
    await wait(400);
    out.looseRaise = lr;
    out.looseBefore = lt.attachments.regions.size;
    const effect = await lt.actor.toggleStatusEffect(dead, { active: true });
    await wait(700);
    out.looseAfter = lt.attachments.regions.size;
    const fx = lt.actor.effects.find((e) => e.statuses.has(dead));
    out.looseEffectParent = fx?.parent?.documentName ?? null;
    out.looseEffectParentIsToken = fx?.parent?.isToken ?? null;
    await lt.actor.toggleStatusEffect(dead, { active: false });
    Hooks.off("acksExtras.bearerDown", id);
    out.heard = heard;
    return out;
  }, { scene: scene.uuid, tBearer: tBearer.id, tLoose: tLoose.id, gear: gear.uuid });
  note("down", down);
  check("5 hp 0 lowers the reach, hook cause hp", down.hpBefore === 1 && down.hpAfter === 0 && down.heard.some((h) => h.token === tBearer.id && h.cause === "hp"), down);
  check("5 defeated status lowers the reach, hook cause defeated", down.defBefore === 1 && down.defAfter === 0 && down.heard.some((h) => h.token === tBearer.id && h.cause === "defeated"), down);
  check("5 unlinked body: defeated lowers its reach", down.looseBefore === 1 && down.looseAfter === 0 && down.heard.some((h) => h.token === tLoose.id && h.cause === "defeated"), { parent: down.looseEffectParent, isToken: down.looseEffectParentIsToken, heard: down.heard });

  section("6. snapshot by token and by point");
  const snap = await run((a) => {
    const scene = fromUuidSync(a.scene);
    const t = scene.tokens.get(a.tBearer);
    const ids = (r) => (r.ok ? r.tokens.map((x) => x.id).sort() : r);
    return {
      byToken: ids(acksExtras.lib.auraReach.snapshot(scene, { token: t }, 10)),
      byPoint: ids(acksExtras.lib.auraReach.snapshot(scene, { point: { x: 1150, y: 550, elevation: 0 } }, 5)),
    };
  }, { scene: scene.uuid, tBearer: tBearer.id });
  const want = [tAlly.id, tFoe.id].sort();
  check("6 token snapshot holds the two within 10 ft, not the bearer nor the far one", JSON.stringify(snap.byToken) === JSON.stringify(want), { got: snap.byToken, want });
  check("6 point snapshot holds the far token", Array.isArray(snap.byPoint) && snap.byPoint.includes(tFar.id) && !snap.byPoint.includes(tBearer.id), { got: snap.byPoint });

  section("7. a Region deleted by hand while the toggle is up");
  const hand7 = await run(async (a) => {
    const scene = fromUuidSync(a.scene);
    const t = scene.tokens.get(a.tBearer);
    const item = fromUuidSync(a.gear);
    if (!t.attachments.regions.size) await item.use();
    await new Promise((r) => setTimeout(r, 500));
    const stateUp = foundry.utils.deepClone(item.flags?.["acks-extras"]?.itemRun?.activation?.state ?? null);
    const r = [...t.attachments.regions][0];
    await r.delete();
    await new Promise((r) => setTimeout(r, 700));
    return { stateUp, stateAfter: item.flags?.["acks-extras"]?.itemRun?.activation?.state ?? null, regions: t.attachments.regions.size };
  }, { scene: scene.uuid, tBearer: tBearer.id, gear: gear.uuid });
  note("hand delete", hand7);
  check("7 a hand delete clears the toggle state", hand7.regions === 0 && hand7.stateUp?.active === true && !hand7.stateAfter?.active, hand7);

  section("8. an unflagged item and an ability with no activation");
  const plain = await gm.create("Item", { name: "Aura Plain", type: "item" }, { parent: bearer.uuid });
  const ability = await gm.create("Item", { name: "Aura Ability", type: "ability" }, { parent: bearer.uuid });
  disposables.push(plain.uuid, ability.uuid);
  const unclaimed = await run(async (a) => {
    const out = {};
    for (const [k, u] of Object.entries(a)) {
      const item = fromUuidSync(u);
      const before = new Set(game.messages.map((m) => m.id));
      let threw = null;
      try { await item.use(); } catch (e) { threw = e.message; }
      await new Promise((r) => setTimeout(r, 800));
      out[k] = { threw, posted: game.messages.filter((m) => !before.has(m.id)).map((m) => m.uuid), regions: 0 };
    }
    return out;
  }, { plain: plain.uuid, ability: ability.uuid });
  for (const v of Object.values(unclaimed)) for (const u of v.posted) disposables.push(gm.track(u, "ChatMessage"));
  check("8 unflagged item and plain ability: system use, no throw, no reach", Object.values(unclaimed).every((v) => !v.threw), unclaimed);

  const late = await run(() => globalThis.__auraBoot.errors.filter((e) => e.phase === "ready"));
  note("errors after ready during the walk", late);
  walkDone();
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  try {
    if (gm) {
      const left = sceneUuid
        ? await run((uuid) => [...(fromUuidSync(uuid)?.regions ?? [])].filter((r) => [...r.behaviors].some((b) => b.type === "acks-extras.aura")).map((r) => r.uuid), sceneUuid)
        : [];
      for (const u of left) disposables.push(gm.track(u, "Region"));
      const tracked = new Set(gm.tracked().map((e) => e.uuid));
      const sw = await gm.sweepTracked({ only: disposables.filter((u) => tracked.has(u)) });
      note("sweep (gm)", { removed: sw.removed.length, missing: sw.missing.map((e) => e.uuid), failed: sw.failed.map((e) => ({ uuid: e.uuid, error: e.error })) });
    }
  } catch (err) { console.error("sweep:", err?.message ?? err); }
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  const failed = checks.filter(([, ok]) => !ok).map(([label]) => label);
  console.log(`SUMMARY lib/aura-bearer: ${passed}/${checks.length} checks passed${failed.length ? `; failed: ${failed.join(" | ")}` : ""}`);
  process.exitCode = failed.length ? 1 : 0;
}
