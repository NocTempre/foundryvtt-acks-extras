/**
 * Live walk, a chart row's verbs: docs/lib/TESTING.md "The row verbs", marker `lib/row-verbs`. Every step
 * presses the control a seat presses on the faction sheet's Org chart tab and reads what the press wrote:
 * Remove from chart (one row leaves, the rows beneath it move up, nothing is deleted), Delete…'s warning
 * (Cancel writes nothing, the tick on and off, "Don't warn me again"), a one-click Delete with no dialog,
 * Undo (the same ids back, the group's officer resolving, the rows merged), the strip's loss on a real
 * reload, and a Player seat that owns the host. Machine values arrive through ./_env.mjs. Every name
 * and figure here is invented.
 *
 * Fixture, kept and found again by marker (`api.fixture`): `lib/row-verbs`, a faction host whose rows the
 * walk rewrites at its start and again in its teardown. The groups, the linked officer and the minted
 * prototype are the run's own: made with `api.create`, tracked, and swept with `sweepTracked`; what an
 * Undo re-creates carries the ids already tracked and is tracked again by uuid.
 *
 * The three client settings the walk touches are read first and put back in a `finally`. The Player seat's
 * ownership is set by API and put back at the end.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";
import { walkDone, blocked } from "./_walk.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const TAG = MACHINE.own ? ` ${MACHINE.own}` : "";
const OBSERVER = 2;
const OWNER = 3;
const SETTINGS = ["confirmRemoveRows", "warnBeforeDeletingRows", "deleteLinkedWithRow"];
const tally = { pass: 0, fail: 0 };
const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const check = (label, ok, detail) => {
  tally[ok ? "pass" : "fail"] += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/* Page side: each function is stringified and run in a seat's page, so none names a node-side value. */
const P = {
  census: async () => ({ role: game.user.role, chartApi: !!globalThis.acksExtras?.lib?.org?.deletePreview, canCreate: game.user.can("ACTOR_CREATE") }),

  /** The library's family template by cookbook id, counted so a twin is seen. Read only. */
  template: async ({ family }) => {
    const CB = await import("/modules/acks-extras/scripts/importer/cookbook.mjs");
    const held = (await CB.importedDocs("Actor")).filter((d) => d.pack && d.getFlag("acks-extras", "cookbook")?.id === family);
    return { uuid: held.length === 1 ? held[0].uuid : null, twins: held.length };
  },

  /** A row carrying the family template over one empty row: the shape whose Remove passes the record down. Rewrites `system.units` of the kept host. */
  seedTemplated: async ({ id, w, template }) => {
    const row = (key, parentKey, holderUuid, gen) => ({ key, parentKey, label: key, holderUuid, kind: "", notes: "", hidden: false, gen });
    // The breed a Roll reads is the template's first variant that carries an encounter recipe, as a Judge's own Roll would have recorded it.
    const doc = await fromUuid(template);
    const variants = (doc?.system?.toObject?.().axes ?? doc?.system?.axes ?? []).find((a) => a.key === "variant")?.options ?? [];
    const variant = variants.find((o) => o.flags?.["acks-extras"]?.extras?.encounter)?.key ?? "";
    await game.actors.get(id).update({ "system.units": [row("w", "", w, { template, ...(variant ? { variant } : {}) }), row("e", "w", "", {})] });
    return game.actors.get(id).system.units.length;
  },

  /** One row's own template record. */
  genOf: async ({ id, key }) => game.actors.get(id).system.units.find((r) => r.key === key)?.gen ?? null,

  /** Roll an empty row through the page's own API, as the card's Roll does; the answer's made documents are returned for tracking. */
  rollRow: async ({ id, key }) => {
    // As the card's Roll press does: the template and breed come from the row's own record or its ancestors', passed in; the API reads only a row's ancestors (a lifted top row has none).
    const host = game.actors.get(id);
    const gen = host.system.units.find((r) => r.key === key)?.gen ?? {};
    const out = await globalThis.acksExtras.monsters.rollOrganisation({ host, rowKey: key, template: gen.template || null, variant: gen.variant || "", context: "dungeon", state: "wandering", card: false });
    const filled = game.actors.get(id).system.units.find((r) => r.key === key)?.holderUuid ?? "";
    return { ok: !!out?.ok, reason: out?.reason ?? "", created: out?.created ?? [], filled };
  },

  /** Wait for a condition in the page, polling, and answer whether it held. */
  until: async ({ expr, ms }) => {
    const end = Date.now() + (ms ?? 8000);
    while (Date.now() < end) {
      if (await (0, eval)(expr)) return true;
      await new Promise((r) => setTimeout(r, 150));
    }
    return false;
  },

  /** Read or write the module's client settings by key. */
  settings: async ({ set }) => {
    const keys = ["confirmRemoveRows", "warnBeforeDeletingRows", "deleteLinkedWithRow"];
    for (const [k, v] of Object.entries(set ?? {})) await game.settings.set("acks-extras", k, v);
    return Object.fromEntries(keys.map((k) => [k, game.settings.get("acks-extras", k)]));
  },

  /** Write the fixture's chart: a warband row over two gang rows, the officer on the first gang's group, the prototype named by the warband's stack. Rewrites `system.units` of the kept host and the groups' own fields. */
  seed: async ({ id, w, g1, g2, officer, proto }) => {
    const row = (key, parentKey, holderUuid, label) => ({ key, parentKey, label, holderUuid, kind: "", notes: "", hidden: false, gen: {} });
    const host = game.actors.get(id);
    await fromUuidSync(g1).update({ "system.unit.officerUuid": officer });
    await fromUuidSync(w).update({ "system.stacks": [{ key: "s1", template: { uuid: proto }, gen: {}, size: { initial: 1, current: 1 }, roster: [] }] });
    await host.update({ "system.units": [row("w", "", w, "Warband"), row("g1", "w", g1, "Gang one"), row("g2", "w", g2, "Gang two")], "system.leaderUuid": "" });
    return host.system.units.length;
  },

  /** The host's rows as keys with parents, and which documents of a list still exist. */
  state: async ({ id, uuids }) => ({
    rows: game.actors.get(id).system.units.map((r) => `${r.key}<${r.parentKey}`),
    exists: (uuids ?? []).map((u) => !!fromUuidSync(u)),
  }),

  /** What a group names as officer, and whether that actor resolves. */
  officerOf: async ({ uuid }) => {
    const o = fromUuidSync(uuid)?.system?.unit?.officerUuid ?? "";
    return { officer: o, resolves: o ? !!fromUuidSync(o) : false };
  },

  /** Reopen the host's sheet on the Org chart tab. */
  reopen: async ({ id }) => {
    const sheet = game.actors.get(id).sheet;
    if (sheet.rendered) await sheet.close({ animate: false });
    sheet.tabGroups.primary = "orgChart";
    await sheet.render({ force: true });
    await new Promise((r) => setTimeout(r, 900));
    return { rendered: sheet.rendered };
  },

  /** Press a control of a card by its action. */
  pressCard: async ({ id, key, action, wait }) => {
    const btn = game.actors.get(id).sheet.element?.querySelector(`li[data-key="${key}"] > div [data-action="${action}"]`);
    if (!btn) return { pressed: false };
    btn.click();
    await new Promise((r) => setTimeout(r, wait ?? 900));
    return { pressed: true };
  },

  /** The actions of a card's foot, and whether its pen form is open. */
  foot: async ({ id, key }) => {
    const card = game.actors.get(id).sheet.element?.querySelector(`li[data-key="${key}"] > div`);
    return { inEdit: !!card?.querySelector(".acks-extras-org-card__form"), actions: [...(card?.querySelectorAll(".acks-extras-org-card__foot [data-action]") ?? [])].map((b) => b.dataset.action) };
  },

  /** The two lines above the chart: the Remove line's text and the Undo strip's text and actions. */
  lines: async ({ id }) => {
    const el = game.actors.get(id).sheet.element;
    const strip = el?.querySelector(".acks-extras-org__undo");
    return {
      unlisted: el?.querySelector(".acks-extras-org__unlisted")?.innerText?.trim() ?? null,
      strip: strip?.innerText?.trim() ?? null,
      stripActions: [...(strip?.querySelectorAll("[data-action]") ?? [])].map((b) => b.dataset.action),
    };
  },

  /** Press a control of the strip by its action. */
  pressStrip: async ({ id, action, wait }) => {
    const btn = game.actors.get(id).sheet.element?.querySelector(`.acks-extras-org__undo [data-action="${action}"]`);
    if (!btn) return { pressed: false };
    btn.click();
    await new Promise((r) => setTimeout(r, wait ?? 1500));
    return { pressed: true };
  },

  dialogCount: async () => document.querySelectorAll("dialog.application, .application.dialog-v2").length,

  /** Set the open dialog's named checkboxes, then press one of its buttons by action. */
  dialog: async ({ fields, button }) => {
    await new Promise((r) => setTimeout(r, 600));
    const dlg = [...document.querySelectorAll("dialog.application, .application.dialog-v2")].at(-1);
    if (!dlg) return { answered: false };
    for (const [name, on] of Object.entries(fields ?? {})) {
      const box = dlg.querySelector(`[name="${name}"]`);
      if (box) box.checked = !!on;
    }
    const tick = dlg.querySelector('[name="linked"]');
    const model = { hasTick: !!tick, tickOn: !!tick?.checked, text: dlg.innerText.slice(0, 400) };
    dlg.querySelector(`[data-action="${button}"]`)?.click();
    await new Promise((r) => setTimeout(r, 1200));
    return { answered: true, ...model };
  },

  /** Set a user's ownership of a document, as a Judge does in its sheet. */
  setOwnership: async ({ uuid, player, level, defaultLevel }) => {
    const doc = fromUuidSync(uuid);
    const user = game.users.find((u) => u.name === player);
    await doc.update({ ownership: { ...(defaultLevel !== undefined ? { default: defaultLevel } : {}), [user.id]: level } });
    return true;
  },

  /** What this seat reads of its own permissions on the host and a group. */
  perm: async ({ id, groupUuid }) => ({
    isGM: game.user.isGM,
    hostOwner: game.actors.get(id).isOwner,
    groupOwner: !!fromUuidSync(groupUuid)?.isOwner,
    groupDelete: !!fromUuidSync(groupUuid)?.canUserModify(game.user, "delete"),
  }),
};

const run = (api, fn, arg) => api.eval(`(${fn.toString()})(${JSON.stringify(arg ?? null)})`);
const waitFor = (api, expr, ms) => run(api, P.until, { expr, ms });
const open = {};
/** Reads until `pred` holds and returns the last read, which is the failing one on a timeout. */
const until = async (api, fn, arg, pred, { tries = 40, every = 250 } = {}) => {
  let v = null;
  for (let n = 0; n < tries; n++) {
    v = await run(api, fn, arg);
    if (pred(v)) return v;
    await sleep(every);
  }
  return v;
};

/** Reload the seat's page with the browser's own reload, and wait for the world to be ready again. */
async function reload(api, seconds = 150) {
  try { await Promise.race([api.eval("setTimeout(() => location.reload(), 50); true"), sleep(3000)]); } catch { /* the page went away with the call */ }
  await sleep(2500);
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.lib`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`not ready after ${seconds}s`);
    await sleep(1000);
  }
}

let fid = null;
let before = null;
let owned = [];
try {
  section("seat");
  open.gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  const gm = open.gm;
  for (let n = 0; n < 60 && !(await gm.eval("!!globalThis.acksExtras?.importer?.connectBookUrl")); n++) await sleep(1000);
  const census = await run(gm, P.census);
  if (!census.chartApi) blocked("the org chart writers are not on the page: the module did not load");
  check("the seat is a GM, and may create actors", census.role >= 3 && census.canCreate === true, census);
  before = await run(gm, P.settings, {});
  note("the client settings as found, put back in the teardown", before);

  section("fixture: a faction host, three groups, a linked officer and a minted prototype");
  const host = await gm.fixture("lib/row-verbs", "Actor", { name: `QA Row verbs${TAG}`, type: "acks-extras.faction", items: [] });
  fid = host.id;
  const make = async (name, type, extra = {}) => (await gm.create("Actor", { name: `${name}${TAG}`, type, items: [], ...extra }));
  const W = await make("QA Row verbs warband", "acks-extras.group");
  const G1 = await make("QA Row verbs gang one", "acks-extras.group");
  const G2 = await make("QA Row verbs gang two", "acks-extras.group");
  const officer = await make("QA Row verbs officer", "character");
  const proto = await make("QA Row verbs prototype", "monster", { flags: { "acks-extras": { organisationPrototype: `row-verbs${TAG}` } } });
  note("fixture", { host: host.uuid, groups: [W.uuid, G1.uuid, G2.uuid], officer: officer.uuid, proto: proto.uuid });
  const seed = { id: fid, w: W.uuid, g1: G1.uuid, g2: G2.uuid, officer: officer.uuid, proto: proto.uuid };
  const all = [W.uuid, G1.uuid, G2.uuid, officer.uuid, proto.uuid];
  const trackAll = () => all.forEach((u) => gm.track(u));
  await run(gm, P.settings, { set: { confirmRemoveRows: true, warnBeforeDeletingRows: true, deleteLinkedWithRow: true } });
  await run(gm, P.seed, seed);
  await run(gm, P.reopen, { id: fid });

  section("1. Remove: one row leaves, the rows beneath it move up, nothing is deleted");
  check("the pen opens the warband's form, with Remove from chart and Delete… in its foot", (await run(gm, P.pressCard, { id: fid, key: "w", action: "orgEdit" })).pressed);
  const foot = await until(gm, P.foot, { id: fid, key: "w" }, (f) => f.inEdit);
  check("the foot offers Remove from chart and Delete…", hasAll(foot.actions, ["orgRemove", "orgDelete"]), foot);
  const d0 = await run(gm, P.dialogCount, null);
  await run(gm, P.pressCard, { id: fid, key: "w", action: "orgRemove", wait: 900 });
  check("a row with rows beneath it asks first", (await run(gm, P.dialogCount, null)) === d0 + 1);
  await run(gm, P.dialog, { fields: {}, button: "yes" });
  const afterRemove = await until(gm, P.state, { id: fid, uuids: all }, (s) => !s.rows.includes("w<"));
  check("only the warband's row left: the gangs stand at the top, and no document was deleted", afterRemove.rows.join() === "g1<,g2<" && afterRemove.exists.every(Boolean), afterRemove);
  const lines = await run(gm, P.lines, { id: fid });
  check("the line above the chart names the rows that moved", typeof lines.unlisted === "string" && lines.unlisted.length > 0, lines.unlisted);

  section("1b. Remove of the row carrying the chart's template: the lifted row keeps it and still rolls");
  const fam = await run(gm, P.template, { family: "mm.familyBeastman" });
  if (!fam.uuid) note("not walked", `the library's family template was not found once (twins: ${fam.twins}); import the monster book, then walk 1b`);
  else {
    await run(gm, P.seedTemplated, { id: fid, w: W.uuid, template: fam.uuid });
    await run(gm, P.reopen, { id: fid });
    await run(gm, P.pressCard, { id: fid, key: "w", action: "orgEdit", wait: 700 });
    await run(gm, P.pressCard, { id: fid, key: "w", action: "orgRemove", wait: 900 });
    await run(gm, P.dialog, { fields: {}, button: "yes" });
    const gen = await until(gm, P.genOf, { id: fid, key: "e" }, (g) => !!g?.template);
    check("the lifted empty row carries the removed row's template record", gen?.template === fam.uuid, gen);
    await run(gm, P.reopen, { id: fid });
    const eFoot = await run(gm, P.foot, { id: fid, key: "e" });
    check("the lifted row's card still offers Roll", eFoot.actions.includes("orgRoll"), eFoot);
    const rolled = await run(gm, P.rollRow, { id: fid, key: "e" });
    for (const u of rolled.created) gm.track(u);
    if (rolled.filled) gm.track(rolled.filled);
    check("the lifted row rolls: it is filled from the carried template", rolled.ok && !!rolled.filled, rolled);
  }
  await run(gm, P.seed, seed);
  await run(gm, P.reopen, { id: fid });

  section("2. Delete…'s warning");
  const delState = async (key = "w") => {
    await run(gm, P.pressCard, { id: fid, key, action: "orgEdit", wait: 700 });
    await until(gm, P.foot, { id: fid, key }, (f) => f.inEdit);
  };
  await delState();
  const d1 = await run(gm, P.dialogCount, null);
  await run(gm, P.pressCard, { id: fid, key: "w", action: "orgDelete", wait: 1200 });
  check("Delete… opens the warning", (await run(gm, P.dialogCount, null)) === d1 + 1);
  const cancel = await run(gm, P.dialog, { fields: {}, button: "cancel" });
  check("the warning offers one tick, on by default, and names the officer", cancel.hasTick && cancel.tickOn && cancel.text.includes("QA Row verbs officer"), cancel);
  const afterCancel = await run(gm, P.state, { id: fid, uuids: all });
  check("Cancel writes nothing: the rows and every document stand, and the settings are as they were", afterCancel.rows.length === 3 && afterCancel.exists.every(Boolean) && JSON.stringify(await run(gm, P.settings, {})) === JSON.stringify({ confirmRemoveRows: true, warnBeforeDeletingRows: true, deleteLinkedWithRow: true }), afterCancel);

  await delState();
  await run(gm, P.pressCard, { id: fid, key: "w", action: "orgDelete", wait: 1200 });
  await run(gm, P.dialog, { fields: { linked: true }, button: "delete" });
  const gone = await until(gm, P.state, { id: fid, uuids: all }, (s) => s.rows.length === 0);
  check("Delete with the tick on deleted the rows, their groups, the minted prototype and the officer", gone.rows.length === 0 && gone.exists.every((e) => !e), gone);
  const strip = await until(gm, P.lines, { id: fid }, (l) => !!l.strip);
  check("the strip offers Undo and a dismiss", hasAll(strip.stripActions, ["orgUndo", "orgDismissUndo"]), strip);
  await run(gm, P.pressStrip, { id: fid, action: "orgUndo" });
  const back = await until(gm, P.state, { id: fid, uuids: all }, (s) => s.rows.length === 3 && s.exists.every(Boolean));
  trackAll();
  check("Undo brought back every document with the same uuid, and the rows", back.rows.length === 3 && back.exists.every(Boolean), back);
  const resolved = await run(gm, P.officerOf, { uuid: G1.uuid });
  check("the gang's officerUuid resolves to the restored officer, the same id", resolved.officer === officer.uuid && resolved.resolves, resolved);
  check("the strip is gone after Undo", (await run(gm, P.lines, { id: fid })).strip === null);

  await run(gm, P.reopen, { id: fid });
  await delState();
  await run(gm, P.pressCard, { id: fid, key: "w", action: "orgDelete", wait: 1200 });
  await run(gm, P.dialog, { fields: { linked: false }, button: "delete" });
  const kept = await until(gm, P.state, { id: fid, uuids: all }, (s) => s.rows.length === 0);
  check("Delete with the tick off keeps the officer and takes the groups", kept.exists.join() === "false,false,false,true,false", kept.exists);
  await run(gm, P.pressStrip, { id: fid, action: "orgUndo" });
  await until(gm, P.state, { id: fid, uuids: all }, (s) => s.rows.length === 3 && s.exists.every(Boolean));
  trackAll();

  section("3. Don't warn me again: both settings written together");
  await run(gm, P.reopen, { id: fid });
  await delState();
  await run(gm, P.pressCard, { id: fid, key: "w", action: "orgDelete", wait: 1200 });
  await run(gm, P.dialog, { fields: { linked: true, dontWarn: true }, button: "delete" });
  await until(gm, P.state, { id: fid, uuids: all }, (s) => s.rows.length === 0);
  const written = await run(gm, P.settings, {});
  check("the warning setting is off and the linked-actor choice is on, as written", written.warnBeforeDeletingRows === false && written.deleteLinkedWithRow === true, written);
  await run(gm, P.pressStrip, { id: fid, action: "orgUndo" });
  await until(gm, P.state, { id: fid, uuids: all }, (s) => s.rows.length === 3 && s.exists.every(Boolean));
  trackAll();

  section("4. one-click Delete applies the saved choice with no dialog; Undo; a reload loses the strip");
  await run(gm, P.reopen, { id: fid });
  await delState();
  const d2 = await run(gm, P.dialogCount, null);
  await run(gm, P.pressCard, { id: fid, key: "w", action: "orgDelete", wait: 1500 });
  check("no dialog opened", (await run(gm, P.dialogCount, null)) === d2);
  const clicked = await until(gm, P.state, { id: fid, uuids: all }, (s) => s.rows.length === 0);
  check("the saved choice was applied: the officer is deleted with the rows", clicked.exists.every((e) => !e), clicked);
  check("the strip is shown", !!(await until(gm, P.lines, { id: fid }, (l) => !!l.strip)).strip);
  await run(gm, P.pressStrip, { id: fid, action: "orgUndo" });
  const restored = await until(gm, P.state, { id: fid, uuids: all }, (s) => s.rows.length === 3 && s.exists.every(Boolean));
  trackAll();
  check("Undo restored the officer and the rest by the same uuids", restored.exists.every(Boolean), restored);
  note("not walked", "a token on a scene whose actor link resolves again: the walk checks the restored actor by its original uuid, not a placed token");

  section("5. the Player seat: owns the host, may Remove, and is offered Delete only where it may delete the groups");
  owned = [host.uuid, W.uuid, G1.uuid, G2.uuid];
  await run(gm, P.setOwnership, { uuid: host.uuid, player: MACHINE.player, level: OWNER });
  for (const u of owned.slice(1)) await run(gm, P.setOwnership, { uuid: u, player: MACHINE.player, level: OBSERVER, defaultLevel: OBSERVER });
  open.player = await connect({ browser, origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  const player = open.player;
  const seeBy = async () => {
    await run(player, P.reopen, { id: fid });
    await run(player, P.pressCard, { id: fid, key: "w", action: "orgEdit", wait: 900 });
    return until(player, P.foot, { id: fid, key: "w" }, (f) => f.inEdit);
  };
  const p1 = await until(player, P.perm, { id: fid, groupUuid: W.uuid }, (p) => p.hostOwner && !p.isGM);
  const f1 = await seeBy();
  check("with the host owned and the groups only observed, the Player sees Remove from chart and no Delete…", p1.hostOwner && !p1.groupDelete && f1.actions.includes("orgRemove") && !f1.actions.includes("orgDelete"), { perm: p1, foot: f1 });
  for (const u of owned.slice(1)) await run(gm, P.setOwnership, { uuid: u, player: MACHINE.player, level: OWNER });
  const p2 = await until(player, P.perm, { id: fid, groupUuid: W.uuid }, (p) => p.groupOwner);
  const f2 = await seeBy();
  check(`with the groups owned, Delete… is drawn exactly where Foundry says the Player may delete them (canUserModify: ${p2.groupDelete})`, f2.actions.includes("orgDelete") === p2.groupDelete && f2.actions.includes("orgRemove"), { perm: p2, foot: f2 });

  section("6. a reload loses the strip");
  await run(gm, P.reopen, { id: fid });
  await delState();
  await run(gm, P.pressCard, { id: fid, key: "w", action: "orgDelete", wait: 1500 });
  await until(gm, P.state, { id: fid, uuids: all }, (s) => s.rows.length === 0);
  const seconds = await reload(gm);
  note("the seat reloaded with the browser's own reload; seconds until ready", seconds);
  await run(gm, P.reopen, { id: fid });
  check("a reload loses the strip", (await run(gm, P.lines, { id: fid })).strip === null);
  note("not walked", "Undo after the reload (memory only, by design), the host's own group deleted from under its sheet, and a Player's one-click or warned Delete press (the seat's control is read; the press is the GM's)");
  walkDone();
} catch (err) {
  if (err?.name !== "WalkBlocked") {
    console.log(`WALK ERROR: ${err?.message ?? err}`);
    console.error(err?.stack ?? err);
    process.exitCode = 1;
  }
} finally {
  section("teardown");
  const gm = open.gm;
  if (gm) {
    try { if (before) await run(gm, P.settings, { set: before }); } catch (err) { console.error("settings:", err?.message ?? err); }
    try { for (const uuid of owned) await run(gm, P.setOwnership, { uuid, player: MACHINE.player, level: 0, defaultLevel: 0 }); } catch (err) { console.error("ownership:", err?.message ?? err); }
    try { if (fid) await gm.eval(`game.actors.get("${fid}")?.update({"system.units": [], "system.leaderUuid": ""})`); } catch (err) { console.error("reset:", err?.message ?? err); }
    try { await gm.eval(`game.actors.get("${fid}")?.sheet.close({animate: false})`); } catch (_e) { /* closed */ }
    try { note("swept", await gm.sweepTracked({ only: gm.tracked().filter((e) => !e.marker).map((e) => e.uuid) })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  }
  console.log(`\nchecks: ${tally.pass} passed, ${tally.fail} failed`);
  if (tally.fail) process.exitCode = 1;
  for (const api of Object.values(open)) { try { api.close(); } catch (_e) { /* closed */ } }
}

function hasAll(have, want) {
  return want.every((a) => have.includes(a));
}
