/**
 * Live walk, lib-missing-images: the `lib.missingImages` repair check against
 * real files and a real server. Walks docs/lib/TESTING.md, "An image whose
 * file is gone, and the check that replaces it", on the GM seat. Machine
 * values arrive through ./_env.mjs. Only booleans and counts are printed: a
 * dead path is built from the world's own folder and never printed.
 *
 * Fixtures, kept and found by marker: the world item `lib/missing-image-item`
 * and its effect `lib/missing-image-item-effect`; the character
 * `lib/missing-image-actor` with its item `lib/missing-image-bearer-item` and
 * that item's effect `lib/missing-image-bearer-effect`; the world item
 * `lib/missing-image-fine`; the scene `lib/missing-image-scene` with its token
 * `lib/missing-image-token` and its first level `lib/missing-image-level`; the
 * journal `lib/missing-image-journal` and its page `lib/missing-image-page`;
 * the table `lib/missing-image-table` and its result `lib/missing-image-result`.
 * Each step writes the shape it needs first, and the walk ends by writing the
 * report-only fixtures back to a present image or none, since a check that
 * cannot fix them would leave a dead path in the world's console. The run's own
 * products (the repair report's whisper) are tracked and swept; no file is
 * uploaded or deleted: a dead path is one that names nothing.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";
import { walkDone } from "./_walk.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
/** Two core icons, each present and neither the default of any kind. */
const ALT = "icons/svg/skull.svg";
const ALT2 = "icons/svg/sword.svg";

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in the seat's page. */
/* ------------------------------------------------------------------ */
const P = {
  install: async () => {
    const H = (globalThis.__mi = globalThis.__mi ?? {});
    H.RP = await import("/modules/acks-extras/scripts/lib/repair.mjs");
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 80, every = 200 } = {}) => {
      for (let n = 0; n < tries; n++) { const v = await fn(); if (v) return v; await H.sleep(every); }
      return null;
    };
    H.root = (app) => { const el = app?.element; return el?.nodeType === 1 ? el : (el?.[0] ?? null); };
    if (!H.patched) {
      H.patched = true;
      H.errors = [];
      H.consoleError = console.error;
      console.error = (...args) => { H.errors.push(args.map((a) => a?.message ?? String(a)).join(" ").slice(0, 300)); H.consoleError(...args); };
      // HEAD requests by route, and updates by document uuid, while a step watches.
      H.heads = {};
      H.fetch = globalThis.fetch;
      globalThis.fetch = (url, init) => {
        if (H.watching && init?.method === "HEAD") H.heads[String(url)] = (H.heads[String(url)] ?? 0) + 1;
        return H.fetch.call(globalThis, url, init);
      };
      H.updates = {};
      H.hooks = ["updateActor", "updateItem", "updateActiveEffect", "updateToken"].map((name) => [name, Hooks.on(name, (doc) => { if (H.watching) H.updates[doc.uuid] = (H.updates[doc.uuid] ?? 0) + 1; })]);
      H.chatHook = Hooks.on("createChatMessage", (m) => { if (H.catching && m.author?.isSelf) H.posted.push(m.id); });
      H.posted = [];
    }
    return { isGM: game.user.isGM, activeGMIsSelf: !!game.users.activeGM?.isSelf };
  },
  /** The dead paths, built under the world's own folder, and the default image of each kind. */
  facts: async () => {
    const world = `worlds/${game.world.id}`;
    const icon = (k) => CONFIG[k]?.documentClass?.DEFAULT_ICON ?? null;
    return {
      deadA: `${world}/qq-missing-image-a.png`,
      deadB: `${world}/qq-missing-image-b.png`,
      defaults: Object.fromEntries(["Actor", "Item", "ActiveEffect", "Macro", "RollTable", "Token", "TableResult", "Scene", "JournalEntryPage", "Level"].map((k) => [k, icon(k)])),
    };
  },
  /** What the server answers a HEAD for a path: status, redirected, ok. */
  head: async ({ path }) => {
    const res = await fetch(foundry.utils.getRoute(path), { method: "HEAD" });
    return { status: res.status, ok: res.ok, redirected: res.redirected };
  },
  /** The uuid of a scene's first level. */
  levelOf: async ({ uuid }) => (await fromUuid(uuid)).levels.contents[0].uuid,
  /** Write each `{uuid, update}`; returns the count written. */
  write: async ({ writes }) => {
    for (const { uuid, update } of writes) {
      const doc = await fromUuid(uuid);
      if (!doc) throw new Error("a write names a document that is gone");
      await doc.update(update);
    }
    return writes.length;
  },
  /** Read the named fields (dotted paths into `_source`) of each uuid. */
  read: async ({ reads }) => {
    const out = {};
    for (const { uuid, fields } of reads) {
      const doc = await fromUuid(uuid);
      out[uuid] = doc ? Object.fromEntries(fields.map((f) => [f, foundry.utils.getProperty(doc._source, f) ?? null])) : null;
    }
    return out;
  },
  /** Scan the check and report on the named fixtures; `watch` counts HEAD requests during the scan. */
  scan: async ({ uuids }) => {
    const CHECK = "lib.missingImages";
    const H = globalThis.__mi;
    H.heads = {};
    H.watching = true;
    const [res] = await H.RP.scanRepairs({ only: CHECK });
    H.watching = false;
    const mine = (res?.findings ?? []).filter((f) => uuids.includes(f.key));
    return {
      error: res?.error ?? null,
      total: res?.findings?.length ?? 0,
      heads: H.heads,
      mine: mine.map((f) => ({ uuid: f.key, fixable: f.fixable !== false, hasUpdate: !!f.update, update: f.update ?? null, reason: f.reason ?? null, detail: f.detail })),
      noDefault: game.i18n.format("ACKS-LIB.repair.check.missingImages.noDefault"),
    };
  },
  detail: async ({ paths }) => game.i18n.format("ACKS-LIB.repair.check.missingImages.detail", { paths: paths.join(", ") }),
  route: async ({ path }) => foundry.utils.getRoute(path),
  /** Fix named keys through the module's own entry point, counting each document's updates. */
  fix: async ({ keys }) => {
    const CHECK = "lib.missingImages";
    const H = globalThis.__mi;
    H.updates = {};
    H.watching = true;
    const out = await H.RP.fixRepairs(CHECK, keys, { report: false });
    H.watching = false;
    return { fixed: out.fixed.map((f) => f.key), failed: out.failed.map((f) => ({ key: f.key, why: f.why })), gone: out.gone, rescan: out.rescan.findings.map((f) => f.key), updates: H.updates };
  },
  /** The repair window scanning this check, the named rows ticked and Fix selected pressed and confirmed. */
  windowFix: async ({ uuids }) => {
    const CHECK = "lib.missingImages";
    const H = globalThis.__mi;
    H.updates = {};
    const app = acksExtras.lib.repair.open({ only: CHECK, scan: true });
    const table = await H.poll(() => app.rendered && H.root(app)?.querySelector(`[data-check='${CHECK}'] .acks-extras-repair-findings`), { tries: 300 });
    if (!table) return { table: false };
    const root = H.root(app);
    const rows = {};
    let ticked = 0;
    for (const uuid of uuids) {
      const box = root.querySelector(`input[data-pick='${CHECK}|${uuid}']`);
      rows[uuid] = !!box;
      if (box) { box.checked = true; box.dispatchEvent(new Event("change", { bubbles: true })); ticked++; }
    }
    // A report-only row has no tick box at all.
    const reportOnlyHasBox = uuids.some((u) => !rows[u]);
    const go = await H.poll(() => { const b = H.root(app)?.querySelector("[data-action='fixSelected']"); return b && !b.disabled ? b : null; });
    if (!go) return { table: true, ticked, rows, enabled: false };
    H.posted = [];
    H.catching = true;
    H.watching = true;
    const before = [...foundry.applications.instances.keys()];
    go.click();
    const ask = await H.poll(() => [...foundry.applications.instances.values()].find((a) => !before.includes(a.id) && a instanceof foundry.applications.api.DialogV2 && H.root(a)?.querySelector("button[data-action='yes']")));
    if (!ask) { H.catching = false; H.watching = false; return { table: true, ticked, rows, asked: false }; }
    H.root(ask).querySelector("button[data-action='yes']").click();
    const outcome = await H.poll(() => H.root(app)?.querySelector(`[data-check='${CHECK}'] .acks-extras-repair-outcome`), { tries: 300 });
    await H.sleep(800);
    H.catching = false;
    H.watching = false;
    const still = uuids.filter((u) => H.root(app)?.querySelector(`input[data-pick='${CHECK}|${u}']`));
    await app.close({ animate: false });
    const report = H.posted.map((id) => game.messages.get(id)).filter(Boolean);
    return { table: true, ticked, rows, reportOnlyHasBox, outcome: !!outcome, still, posted: H.posted.slice(), reportWhisper: report.length === 1 && report[0].whisper.length > 0, updates: H.updates };
  },
  /** An open sheet shows the image: some `<img>` in it ends with `src`. */
  sheet: async ({ uuid, src }) => {
    const H = globalThis.__mi;
    const doc = await fromUuid(uuid);
    await doc.sheet.render(true);
    const root = await H.poll(() => H.root(doc.sheet)?.isConnected && H.root(doc.sheet));
    await H.sleep(400);
    const shown = !!root && [...root.querySelectorAll("img")].some((i) => (i.getAttribute("src") ?? "").split("?")[0].endsWith(src));
    await doc.sheet.close({ animate: false });
    return { rendered: !!root, shown };
  },
  drain: async () => ({ errors: globalThis.__mi.errors.slice() }),
  restore: async () => {
    const H = globalThis.__mi;
    if (!H?.patched) return "never installed";
    console.error = H.consoleError;
    globalThis.fetch = H.fetch;
    for (const [name, id] of H.hooks) Hooks.off(name, id);
    if (H.chatHook) Hooks.off("createChatMessage", H.chatHook);
    H.patched = false;
    return "restored";
  },
};

/* ------------------------------------------------------------------ */
/*  Driver side                                                         */
/* ------------------------------------------------------------------ */
async function run(api, fn, arg) {
  const text = await api.eval(`(${fn.toString()})(${JSON.stringify(arg ?? null)}).then((v) => JSON.stringify(v === undefined ? null : v))`);
  return JSON.parse(text);
}

async function ready(api, label, seconds = 240) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.lib?.repair`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}

let gm = null;
let reset = null;
const swept = [];
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 420_000);
setTimeout(() => {
  console.error(`WALK ERROR: wall clock of ${WALL_MS} ms reached; closing the seat`);
  try { gm?.close(); } catch {}
  process.exit(1);
}, WALL_MS).unref();

try {
  section("seat");
  gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  note("gm ready after (s)", await ready(gm, "gm"));
  const seat = await run(gm, P.install);
  check("the seat is the active GM", seat.isGM && seat.activeGMIsSelf, seat);

  const facts = await run(gm, P.facts);
  const A = facts.deadA;
  const B = facts.deadB;
  const D = facts.defaults;

  section("the platform");
  const dead = await run(gm, P.head, { path: A });
  const dead2 = await run(gm, P.head, { path: B });
  const here = await run(gm, P.head, { path: ALT });
  check("a HEAD for a path under the world's folder that names nothing answers a plain 404, not a redirect", dead.status === 404 && !dead.ok && !dead.redirected && dead2.status === 404 && !dead2.redirected, { status: dead.status, redirected: dead.redirected });
  check("a HEAD for a present core icon answers 200", here.status === 200 && here.ok && !here.redirected, { status: here.status });
  check("the live classes give every repairable kind a default image, ActiveEffect and Token included", ["Actor", "Item", "ActiveEffect", "Macro", "RollTable", "Token"].every((k) => typeof D[k] === "string" && D[k]), Object.fromEntries(Object.entries(D).map(([k, v]) => [k, !!v])));
  check("a roll-table result, a scene, a level and a journal page have none, so the check lists them only", ["TableResult", "Scene", "JournalEntryPage", "Level"].every((k) => !D[k]), Object.fromEntries(["TableResult", "Scene", "JournalEntryPage", "Level"].map((k) => [k, !!D[k]])));
  check("the two stand-in icons are present and are the default of no kind", ALT !== ALT2 && ![ALT, ALT2].some((p) => Object.values(D).includes(p)));

  section("fixtures");
  const item = await gm.fixture("lib/missing-image-item", "Item", { name: "QA Dead Image Item", type: "item", img: A });
  const itemFx = await gm.fixture("lib/missing-image-item-effect", "ActiveEffect", { name: "QA Dead Image Effect", img: A }, { parent: item.uuid });
  const actor = await gm.fixture("lib/missing-image-actor", "Actor", { name: "QA Dead Image Actor", type: "character", img: A, prototypeToken: { texture: { src: ALT2 } } });
  const bearerItem = await gm.fixture("lib/missing-image-bearer-item", "Item", { name: "QA Dead Image Carried", type: "item", img: A }, { parent: actor.uuid });
  const bearerFx = await gm.fixture("lib/missing-image-bearer-effect", "ActiveEffect", { name: "QA Dead Image Carried Effect", img: A }, { parent: bearerItem.uuid });
  const fine = await gm.fixture("lib/missing-image-fine", "Item", { name: "QA Present Image Item", type: "item", img: ALT });
  const scene = await gm.fixture("lib/missing-image-scene", "Scene", { name: "QA Dead Image Scene", width: 1000, height: 600, grid: { size: 100 }, ownership: { default: 2 } });
  const token = await gm.fixture("lib/missing-image-token", "Token", { name: "QA Dead Image Token", actorId: actor.id, actorLink: false, x: 100, y: 100, texture: { src: A } }, { parent: scene.uuid });
  const levelUuid = await run(gm, P.levelOf, { uuid: scene.uuid });
  await gm.mark(levelUuid, "lib/missing-image-level");
  const journal = await gm.fixture("lib/missing-image-journal", "JournalEntry", { name: "QA Dead Image Journal" });
  const page = await gm.fixture("lib/missing-image-page", "JournalEntryPage", { name: "QA Dead Image Page", type: "image", src: A }, { parent: journal.uuid });
  const table = await gm.fixture("lib/missing-image-table", "RollTable", { name: "QA Dead Image Table", formula: "1d1" });
  const result = await gm.fixture("lib/missing-image-result", "TableResult", { name: "QA Dead Image Result", type: "text", range: [1, 1], img: A }, { parent: table.uuid });

  const FIXABLE = [item.uuid, itemFx.uuid, actor.uuid, bearerItem.uuid, bearerFx.uuid, token.uuid];
  const LISTED = [scene.uuid, levelUuid, page.uuid, result.uuid];
  const ALL = [...FIXABLE, ...LISTED, fine.uuid];
  const shape = () => [
    { uuid: item.uuid, update: { img: A } },
    { uuid: itemFx.uuid, update: { img: A } },
    { uuid: actor.uuid, update: { img: A, "prototypeToken.texture.src": ALT2 } },
    { uuid: bearerItem.uuid, update: { img: A } },
    { uuid: bearerFx.uuid, update: { img: A } },
    { uuid: token.uuid, update: { "texture.src": A } },
    { uuid: fine.uuid, update: { img: ALT } },
    { uuid: scene.uuid, update: { thumb: A } },
    { uuid: levelUuid, update: { "background.src": A, "foreground.src": B } },
    { uuid: page.uuid, update: { src: A } },
    { uuid: result.uuid, update: { img: A } },
  ];
  reset = async () => run(gm, P.write, {
    writes: [
      { uuid: scene.uuid, update: { thumb: null } },
      { uuid: levelUuid, update: { "background.src": null, "foreground.src": null, "fog.src": null } },
      { uuid: page.uuid, update: { src: ALT } },
      { uuid: result.uuid, update: { img: null } },
    ],
  });
  await run(gm, P.write, { writes: shape() });
  const written = await run(gm, P.read, {
    reads: [
      { uuid: scene.uuid, fields: ["thumb"] },
      { uuid: levelUuid, fields: ["background.src", "foreground.src"] },
      { uuid: page.uuid, fields: ["src"] },
      { uuid: result.uuid, fields: ["img"] },
      { uuid: token.uuid, fields: ["texture.src"] },
    ],
  });
  check("the shapes hold: a scene's thumb, a level's background and foreground, a page's src, a result's img and a token's texture read back what was written", written[scene.uuid].thumb === A && written[levelUuid]["background.src"] === A && written[levelUuid]["foreground.src"] === B && written[page.uuid].src === A && written[result.uuid].img === A && written[token.uuid]["texture.src"] === A);

  section("1. the scan");
  const scan = await run(gm, P.scan, { uuids: ALL });
  const byUuid = Object.fromEntries(scan.mine.map((f) => [f.uuid, f]));
  note("scan", { total: scan.total, mine: scan.mine.length });
  check("1: no scan error", scan.error === null);
  check("1: the six repairable fixtures are listed, each fixable with an update; the present item is absent", FIXABLE.every((u) => byUuid[u]?.fixable && byUuid[u].hasUpdate) && !byUuid[fine.uuid], FIXABLE.map((u) => !!byUuid[u]));
  check("1: the scene, its level, the page and the result are listed, none fixable, each with the reason and no update", LISTED.every((u) => byUuid[u] && !byUuid[u].fixable && !byUuid[u].hasUpdate && byUuid[u].reason === scan.noDefault), LISTED.map((u) => !!byUuid[u]));
  check("1: the actor's finding names the missing path, and the level's names both of its", byUuid[actor.uuid]?.detail === (await run(gm, P.detail, { paths: [A] })) && byUuid[levelUuid]?.detail === (await run(gm, P.detail, { paths: [A, B] })), { actor: byUuid[actor.uuid]?.detail === (await run(gm, P.detail, { paths: [A] })) });
  const routeA = await run(gm, P.route, { path: A });
  check("1: the path ten fixtures name was asked for once, as a HEAD, by the whole scan", scan.heads[routeA] === 1, { asked: scan.heads[routeA] });
  const loose = Object.entries(scan.heads).filter(([, n]) => n !== 1).length;
  check("1: every other path the scan asked for was asked for once", loose === 0, { repeated: loose });

  section("2. the window");
  const win = await run(gm, P.windowFix, { uuids: [...FIXABLE, ...LISTED] });
  for (const id of win.posted ?? []) swept.push(gm.track(id, "ChatMessage"));
  note("window", { ticked: win.ticked, still: win.still?.length, posted: win.posted?.length });
  check("2: the six repairable rows have a tick box and the four listed ones have none", win.table && FIXABLE.every((u) => win.rows[u]) && LISTED.every((u) => !win.rows[u]), { ticked: win.ticked });
  check("2: Fix selected, confirmed: a whispered report, and none of the six is listed after", win.ticked === FIXABLE.length && win.reportWhisper && FIXABLE.every((u) => !win.still.includes(u)), { whisper: win.reportWhisper, still: win.still?.length });
  check("2: each fixed document was written by one update", FIXABLE.every((u) => win.updates[u] === 1), FIXABLE.map((u) => win.updates[u] ?? 0));

  section("3. the write");
  const after = await run(gm, P.read, {
    reads: [
      { uuid: item.uuid, fields: ["img"] }, { uuid: itemFx.uuid, fields: ["img"] },
      { uuid: actor.uuid, fields: ["img", "prototypeToken.texture.src"] },
      { uuid: bearerItem.uuid, fields: ["img"] }, { uuid: bearerFx.uuid, fields: ["img"] },
      { uuid: token.uuid, fields: ["texture.src"] }, { uuid: fine.uuid, fields: ["img"] },
      { uuid: scene.uuid, fields: ["thumb"] }, { uuid: levelUuid, fields: ["background.src", "foreground.src"] },
      { uuid: page.uuid, fields: ["src"] }, { uuid: result.uuid, fields: ["img"] },
    ],
  });
  check("3: the world item and its effect hold their class defaults", after[item.uuid].img === D.Item && after[itemFx.uuid].img === D.ActiveEffect);
  check("3: the actor's image is its class default and its token art, a present file, is untouched", after[actor.uuid].img === D.Actor && after[actor.uuid]["prototypeToken.texture.src"] === ALT2);
  check("3: an item carried by an actor and the effect inside it, an effect embedded in an actor's item, hold their defaults", after[bearerItem.uuid].img === D.Item && after[bearerFx.uuid].img === D.ActiveEffect);
  check("3: the scene token takes the token default, its actor's image being missing too", after[token.uuid]["texture.src"] === D.Token);
  check("3: the present item still carries its file", after[fine.uuid].img === ALT);
  check("3: the four listed fixtures are untouched", after[scene.uuid].thumb === A && after[levelUuid]["background.src"] === A && after[levelUuid]["foreground.src"] === B && after[page.uuid].src === A && after[result.uuid].img === A);
  const rescan = await run(gm, P.scan, { uuids: ALL });
  check("3: a fresh scan lists none of the six and still lists the four", FIXABLE.every((u) => !rescan.mine.some((f) => f.uuid === u)) && LISTED.every((u) => rescan.mine.some((f) => f.uuid === u)), { mine: rescan.mine.length });

  section("4. token art follows the actor");
  await run(gm, P.write, {
    writes: [
      { uuid: actor.uuid, update: { img: ALT, "prototypeToken.texture.src": A } },
      { uuid: token.uuid, update: { "texture.src": A } },
    ],
  });
  const scan4 = await run(gm, P.scan, { uuids: [actor.uuid, token.uuid] });
  check("4: the actor, its image present, and the token are listed", scan4.mine.length === 2 && scan4.mine.every((f) => f.fixable), scan4.mine.map((f) => Object.keys(f.update ?? {})));
  const fix4 = await run(gm, P.fix, { keys: [actor.uuid, token.uuid] });
  const after4 = await run(gm, P.read, { reads: [{ uuid: actor.uuid, fields: ["img", "prototypeToken.texture.src"] }, { uuid: token.uuid, fields: ["texture.src"] }] });
  check("4: both fixed, one update each, nothing failed, and the rescan lists neither", fix4.fixed.length === 2 && !fix4.failed.length && !fix4.rescan.includes(actor.uuid) && !fix4.rescan.includes(token.uuid) && fix4.updates[actor.uuid] === 1 && fix4.updates[token.uuid] === 1, { fixed: fix4.fixed.length, failed: fix4.failed });
  check("4: the prototype token and the scene token take the actor's present image, and the actor's own image is not written", after4[actor.uuid]["prototypeToken.texture.src"] === ALT && after4[token.uuid]["texture.src"] === ALT && after4[actor.uuid].img === ALT, { token: after4[token.uuid]["texture.src"] === ALT });

  section("5. a document gone before the fix");
  await run(gm, P.write, { writes: [{ uuid: item.uuid, update: { img: A } }] });
  const keys5 = (await run(gm, P.scan, { uuids: [item.uuid] })).mine.map((f) => f.uuid);
  check("5: the item is listed again once its path is dead", keys5.length === 1 && keys5[0] === item.uuid);
  const fix5 = await run(gm, P.fix, { keys: [item.uuid, `${item.uuid}-gone`] });
  check("5: a key the fresh scan no longer reports is left alone, and the item is fixed", fix5.gone.length === 1 && fix5.fixed.length === 1 && fix5.fixed[0] === item.uuid, { gone: fix5.gone.length, fixed: fix5.fixed.length });

  section("6. the sheets");
  const s1 = await run(gm, P.sheet, { uuid: item.uuid, src: D.Item });
  const s2 = await run(gm, P.sheet, { uuid: actor.uuid, src: ALT });
  check("6: the item's sheet shows its default image and the actor's sheet its own", s1.rendered && s1.shown && s2.rendered && s2.shown, { item: s1, actor: s2 });

  const drained = await run(gm, P.drain);
  check("no console.error call over the walk", !drained.errors.length, drained.errors.slice(0, 3));
  walkDone();
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  try { if (gm && reset) note("report-only fixtures written back", await reset()); } catch (err) { console.error("reset:", err?.message ?? err); }
  try {
    if (gm && swept.length) {
      const sw = await gm.sweepTracked({ only: swept });
      note("sweep (gm)", { removed: sw.removed.map((e) => e.uuid), missing: sw.missing.map((e) => e.uuid), failed: sw.failed.map((e) => ({ uuid: e.uuid, error: e.error })) });
    }
  } catch (err) { console.error("sweep gm:", err?.message ?? err); }
  try { if (gm) note("restored", await run(gm, P.restore)); } catch (err) { console.error("restore:", err?.message ?? err); }
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
