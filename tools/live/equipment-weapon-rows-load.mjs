/**
 * Live walk, equipment-weapon-rows-load: the weapon rows published after a page
 * load. Walks docs/equipment/TESTING.md step 2f (a Draw and an attack pressed in
 * the load window wait for the rows and land after them), step 2g (a sheet open
 * in the load window redraws by itself when the rows land, and a window closed
 * before they land is not drawn) and the printed-layers section's step 6 (a
 * library weapon edited after the shelf's cache lifetime keeps its row count).
 * Machine values arrive through ./_env.mjs. Every figure typed into a fixture is
 * invented; the damage formula the walk writes to a library weapon is an
 * invented marker and is restored. Prints booleans, counts and timings, never
 * an imported name's figure.
 *
 * The load window is reached from inside the page. A recorder is attached over a
 * second DevTools session (`Page.addScriptToEvaluateOnNewDocument`), the walk
 * reloads the seat with `location.reload()`, and the recorder polls for
 * `game.ready`, opens the windows, presses the control and reads the registry
 * with synchronous reads on one page clock (`performance.now()`), so the press
 * is not at the mercy of a round trip through the driver. A press counts as in
 * the window only when the first publication had not settled at the click
 * (`rowsReady()`), and a missed window is retried up to three reloads, then
 * fails "the press landed in the load window" with its marks.
 *
 * Needs imported weapon rows (a "Sword, Two-Handed" and a "Dagger" among them);
 * with none, or with rows that do not classify the fixture's weapons, each step
 * prints SKIP with its reason. The empty-world variants of 2f and 2g are not
 * walked. Under an invented training restriction on the fixture (a tracked
 * effect declaring one weapon class), the Dagger's attack carries the
 * Non-proficient row only once the rows classify it; the walk asserts that at
 * rest before it reloads, so a green load-window result means the wait.
 *
 * Fixture, kept and found by marker: `equipment/hands-probe` (the character
 * tools/live/equipment.mjs drives). The run sets its Strength to an invented
 * figure so the Non-proficient row has a size without any imported figure, and
 * puts the stored Strength back; the restriction effect is the run's own,
 * tracked and swept by id; the attack cards the run's client made are swept by
 * id. The proficiency enforcement setting is set to on and put back. Every weapon
 * on the fixture is left sheathed.
 *
 * Duration: about 12 to 20 minutes. Three reloads, a foreground wait of 300 s
 * with its elapsed seconds logged, then a poll (at most 300 s more) for Foundry
 * to evict the shelf's documents.
 *
 * fresh-page: the subject is the seat's own page load after location.reload(), with a recorder attached before its first script
 */
import { connect, sleep, Cdp } from "./_driver.mjs";
import { walkDone, blocked, WalkBlocked } from "./_walk.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const MARKER = "equipment/hands-probe";
/** The walk's own effect on the fixture; a standing one from a dead run stops the walk. */
const EFFECT_NAME = "QA Weapon Rows Load Restriction";
/** One weapon class the restriction trains; the Dagger is outside it. */
const TRAINED_CLASS = "axe";
/** The Strength the fixture is given for the run, an invented figure. */
const STR_PROBE = 16;
/** The marker damage formula written to one library weapon and restored, an invented figure. */
const MARKER_FORMULA = "9d2";
const TWO_HANDED = "Sword, Two-Handed";
/** The foreground wait of step 6, in seconds, and the longest the poll for eviction runs after it. */
const WAIT_S = 300;
const EVICT_CAP_S = 300;
/** A draw after the rows have long since settled answers within this, in milliseconds (the walk's own bound, not the module's). */
const DRAW_FAST_MS = 3000;
/** A window redraws within this of the rows landing, in milliseconds (TESTING says about a second). */
const REDRAW_LAG_MS = 3000;
const ATTEMPTS = 3;

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};
const skip = (label, reason) => console.log(`SKIP  ${label}  ${reason}`);

/** The kept fixture's items, as tools/live/equipment.mjs builds them. */
const FIXTURE = {
  name: "QA Hands Probe",
  type: "character",
  items: [
    { name: "Long Bow", type: "weapon", system: { melee: false, missile: true, damage: { base: { formula: "1d6" } } } },
    { name: TWO_HANDED, type: "weapon", system: { melee: true, missile: false, damage: { base: { formula: "1d10" } } } },
    { name: "Dagger", type: "weapon", system: { melee: true, missile: true, damage: { base: { formula: "1d4" } } } },
    { name: "Torches (6)", type: "item", system: { quantity: 6, cost: 1, weight6: 6 } },
    { name: "Quill, writing", type: "item", system: { quantity: 1, cost: 1 } },
    { name: "Parchment", type: "item", system: { quantity: 1, cost: 1 } },
  ],
};

/* ------------------------------------------------------------------ */
/*  The recorder: stringified, run in the page before its first script  */
/* ------------------------------------------------------------------ */

/**
 * Installed with `Page.addScriptToEvaluateOnNewDocument`. Keeps `globalThis.__wrl`:
 * every mark carries the page clock and the synchronous `hasDoc("weapons")` and
 * rows-settled reads at that instant. Modes: `observe` (only records), `draw`
 * (opens the character sheet, presses Draw on the sword's row and rolls the
 * Dagger's attack in the same tick), `sheets` (opens three windows, closes one,
 * touches none).
 */
function recorder(cfg) {
  if (globalThis.top !== globalThis) return;
  const T = (globalThis.__wrl = { token: cfg.token, mode: cfg.mode, marks: [], rowsChanged: [], cards: [], renders: {}, errors: [], settled: false, done: false });
  const now = () => Math.round(performance.now());
  const hasDoc = () => {
    try {
      const v = globalThis.acksExtras?.lib?.tables?.hasDoc?.("weapons");
      return typeof v === "boolean" ? v : null;
    } catch { return null; }
  };
  const mark = (name, extra = {}) => { T.marks.push({ name, t: now(), hasDoc: hasDoc(), settled: T.settled, ...extra }); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms = 20000, every = 20) => {
    const t0 = performance.now();
    for (;;) {
      const v = fn();
      if (v) return v;
      if (performance.now() - t0 > ms) return null;
      await sleep(every);
    }
  };
  const root = (app) => (app?.element?.nodeType === 1 ? app.element : app?.element?.[0]) ?? null;
  const text = (app) => (root(app)?.textContent ?? "").replace(/\s+/g, " ").trim();
  const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h; };
  const base = "/modules/acks-extras/scripts/";

  // Listeners go on as soon as Hooks exists, long before ready, so the rows-changed announcement cannot be missed.
  const arm = setInterval(() => {
    if (!globalThis.Hooks?.on) return;
    clearInterval(arm);
    Hooks.on("acksExtras.weaponRowsChanged", () => { T.rowsChanged.push(now()); mark("rowsChanged"); });
    Hooks.on("createChatMessage", (m) => { if (m.speaker?.actor === cfg.actorId) T.cards.push(m.id); });
    Hooks.on("updateItem", (item, change) => {
      if (item.id === cfg.swordId && change?.system && "equipped" in change.system) mark("write", { equipped: !!change.system.equipped });
    });
    // While `T.watch` is set, every write to the fixture (the actor, its items, their effects) is listed: a write makes the sheets redraw on their own.
    T.writes = [];
    const onFixture = (doc) => doc?.id === cfg.actorId || doc?.parent?.id === cfg.actorId || doc?.parent?.parent?.id === cfg.actorId;
    for (const hook of ["updateActor", "createItem", "updateItem", "deleteItem", "createActiveEffect", "updateActiveEffect", "deleteActiveEffect"]) {
      Hooks.on(hook, (doc) => { if (T.watch && onFixture(doc)) T.writes.push({ t: now(), hook }); });
    }
  }, 2);

  async function start() {
    mark("ready");
    import(`${base}equipment/weapon-rows.mjs`).then((m) => m.rowsReady()).then(() => { T.settled = true; mark("rowsReady"); }, (err) => T.errors.push(`rowsReady: ${err?.message ?? err}`));
    if (cfg.mode === "observe") return;
    const actor = game.actors.get(cfg.actorId);
    const sword = actor.items.get(cfg.swordId);
    const dagger = actor.items.get(cfg.daggerId);
    if (!(await until(() => globalThis.acksExtras?.characterSheet?.Sheet, 15000))) throw new Error("the character sheet class is not published");
    const sheet = new acksExtras.characterSheet.Sheet({ document: actor });
    sheet.tabGroups.primary = "equipment";

    if (cfg.mode === "draw") {
      const label = game.i18n.has("ACKS-EQUIPMENT.attack.nonProficient") ? game.i18n.localize("ACKS-EQUIPMENT.attack.nonProficient") : "Non-proficient";
      sheet.render(true);
      const btn = await until(() => root(sheet)?.querySelector(`[data-item-id='${cfg.swordId}'] button[data-action='toggleEquip']`), 30000, 10);
      if (!btn) throw new Error("the Draw control is not on the sword's row");
      mark("press");
      btn.click();
      mark("attack");
      const outcome = await actor.makeAttackThrow({ item: dagger, attackType: "melee", skipDialog: true });
      const rolled = !!outcome;
      const row = (outcome?.result?.attack?.modifiers ?? []).some((m) => m.label === label);
      const card = await until(() => T.cards.length > 0 && game.messages.get(T.cards.at(-1)), 4000, 100);
      mark("attackResolved", { rolled, row, cardRow: !!card && String(card.content ?? "").includes(label) });
      await until(() => T.marks.some((m) => m.name === "write"), 90000, 50);
      await sleep(800);
      T.done = true;
      return;
    }

    if (cfg.mode === "sheets") {
      const itemSheet = sword.sheet;
      const closedSheet = dagger.sheet;
      const watch = (app, key) => {
        T.renders[key] = [];
        const orig = app.render.bind(app);
        app.render = (...args) => { T.renders[key].push(now()); return orig(...args); };
      };
      watch(sheet, "actor");
      watch(itemSheet, "item");
      watch(closedSheet, "closed");
      const imports = Promise.all([import(`${base}lib/proficiency-strip.mjs`), import(`${base}equipment/profiles.mjs`)]);
      await Promise.all([sheet.render(true), itemSheet.render(true), closedSheet.render(true)]);
      const [strip, profiles] = await imports;
      const stamp = () => ({
        actorDom: hash(text(sheet)),
        strips: hash(JSON.stringify(strip.profileStrips(actor))),
        itemDom: hash(text(itemSheet)),
        classified: hash(JSON.stringify(profiles.classifyWeapon(sword))),
      });
      T.before = stamp();
      T.watch = true;
      mark("drawn", { rendered: [sheet.rendered, itemSheet.rendered, closedSheet.rendered] });
      await closedSheet.close({ animate: false });
      mark("closedWindow", { rendered: closedSheet.rendered, renders: T.renders.closed.length });
      await until(() => T.rowsChanged.length > 0, 120000, 50);
      await sleep(3000);
      T.after = stamp();
      T.watch = false;
      T.final = { closedRendered: closedSheet.rendered, closedRenders: T.renders.closed.length, actorRendered: sheet.rendered, itemRendered: itemSheet.rendered };
      T.done = true;
    }
  }

  const wait = setInterval(() => {
    if (!globalThis.game?.ready) return;
    clearInterval(wait);
    start().catch((err) => { T.errors.push(String(err?.message ?? err)); T.done = true; });
  }, 10);
}

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in the seat's page  */
/* ------------------------------------------------------------------ */

const P = {
  install: async () => {
    const H = (globalThis.__wrlH = globalThis.__wrlH ?? {});
    const base = "/modules/acks-extras/scripts/";
    H.wr = await import(`${base}equipment/weapon-rows.mjs`);
    H.am = await import(`${base}equipment/attack-mods.mjs`);
    H.wear = await import(`${base}equipment/wear.mjs`);
    H.lib = await import(`${base}lib/library.mjs`);
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.until = async (fn, ms = 20000, every = 50) => {
      const t0 = performance.now();
      for (;;) {
        const v = fn();
        if (v) return v;
        if (performance.now() - t0 > ms) return null;
        await H.sleep(every);
      }
    };
    H.root = (app) => (app?.element?.nodeType === 1 ? app.element : app?.element?.[0]) ?? null;
    H.label = () => (game.i18n.has("ACKS-EQUIPMENT.attack.nonProficient") ? game.i18n.localize("ACKS-EQUIPMENT.attack.nonProficient") : "Non-proficient");
    H.opened = H.opened ?? [];
    return { isGM: game.user.isGM, activeGMIsSelf: !!game.users.activeGM?.isSelf };
  },

  setting: async ({ value }) => {
    const prior = game.settings.get("acks-extras", "proficiencyEnforcement");
    if (value != null && value !== prior) await game.settings.set("acks-extras", "proficiencyEnforcement", value);
    return prior;
  },

  /** Whether the effect of this name already stands on the fixture (a dead run's), by id. */
  standingEffects: async ({ actorId, name }) => game.actors.get(actorId).effects.filter((e) => e.name === name).map((e) => e.id),

  /** Bring the fixture to its start shape: the rows present, every weapon sheathed with no hand flag, the Strength at `str`. Reports the stored Strength it found. */
  shape: async ({ actorId, items, str }) => {
    const H = globalThis.__wrlH;
    const actor = game.actors.get(actorId);
    const missing = items.filter((row) => !actor.items.some((i) => i.name === row.name && i.type === row.type));
    if (missing.length) await actor.createEmbeddedDocuments("Item", missing);
    const updates = actor.items.filter((i) => i.system?.equipped || i.getFlag("acks-extras", "hand") || i.getFlag("acks-extras", "gear")?.wornAt).map((i) => ({ _id: i.id, "system.equipped": false, "flags.acks-extras.-=hand": null, "flags.acks-extras.gear.wornAt": "" }));
    if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
    const strBefore = actor._source.system.scores.str.value;
    if (str != null && strBefore !== str) await actor.update({ "system.scores.str.value": str });
    await H.sleep(600);
    const sword = actor.items.find((i) => i.type === "weapon" && /two-handed/i.test(i.name));
    const dagger = actor.items.find((i) => i.type === "weapon" && /^dagger/i.test(i.name));
    return { swordId: sword?.id ?? null, daggerId: dagger?.id ?? null, strBefore, drawn: actor.items.filter((i) => i.system?.equipped).length };
  },

  setStr: async ({ actorId, str }) => {
    const actor = game.actors.get(actorId);
    if (actor._source.system.scores.str.value !== str) await actor.update({ "system.scores.str.value": str });
    return actor._source.system.scores.str.value;
  },

  /** The registry's weapon rows: whether the document is registered and how many rows it holds. */
  rows: async () => {
    const t = globalThis.acksExtras.lib.tables;
    if (!t.hasDoc("weapons")) return { hasDoc: false, n: 0 };
    return { hasDoc: true, n: Object.keys(t.getTable("weapons", "grid") ?? {}).length };
  },

  /** At rest on a settled page: does the Dagger's melee throw carry the Non-proficient row, and does a drawn sword read two-handed. */
  atRest: async ({ actorId, swordId, daggerId }) => {
    const H = globalThis.__wrlH;
    await H.wr.rowsReady();
    const actor = game.actors.get(actorId);
    const sword = actor.items.get(swordId);
    const dagger = actor.items.get(daggerId);
    const row = () => H.am.attackThrowRows(actor, dagger, "melee").some((r) => r.label === H.label());
    const daggerRow = row();
    await acksExtras.equipment.drawItem(sword);
    await H.sleep(600);
    const lo = acksExtras.equipment.getLoadout(actor);
    const w = lo.weapons.find((x) => x.item.id === swordId);
    const two = { wield: !!w?.wieldTwoHanded, used: lo.handsUsed, where: H.wear.wearLocation(actor, sword, lo) };
    await acksExtras.equipment.sheatheItem(sword);
    await H.sleep(600);
    return { daggerRow, two, effects: actor.effects.size };
  },

  /** The sword's loadout reading, as the sheet's wear places answer it. */
  loadout: async ({ actorId, swordId }) => {
    const H = globalThis.__wrlH;
    const actor = game.actors.get(actorId);
    const sword = actor.items.get(swordId);
    const lo = acksExtras.equipment.getLoadout(actor);
    const w = lo.weapons.find((x) => x.item.id === swordId);
    return { equipped: !!sword.system.equipped, wield: !!w?.wieldTwoHanded, used: lo.handsUsed, where: H.wear.wearLocation(actor, sword, lo) };
  },

  /** The recorder's state, whole. */
  readT: async () => globalThis.__wrl ?? null,

  /** The one library weapon named `name` among the shelves' index rows, and its key among the published rows. */
  shelfProbe: async ({ name }) => {
    const H = globalThis.__wrlH;
    const hits = [];
    for (const pack of H.lib.libraryPacks("Item")) {
      await pack.getIndex();
      for (const row of [...pack.index.values()]) {
        if (row.type === "weapon" && row.name === name && H.lib.cookbookId(row).startsWith("def.weapon.")) hits.push({ collection: pack.collection, id: row._id });
      }
    }
    const t = globalThis.acksExtras.lib.tables;
    const grid = t.hasDoc("weapons") ? (t.getTable("weapons", "grid") ?? {}) : {};
    const keys = Object.keys(grid).filter((k) => grid[k].name === name);
    return { hits, key: keys.length === 1 ? keys[0] : null, keys: keys.length };
  },

  /** How many documents the shelf holds loaded, against how many its index lists. Loads nothing. */
  shelf: async ({ collection }) => {
    const pack = game.packs.get(collection);
    return { loaded: pack.contents?.length ?? null, indexed: pack.index.size };
  },

  /** Edit the library weapon's damage from its shelf and keep its document for the restore's comparison. */
  editShelf: async ({ collection, id, formula }) => {
    const H = globalThis.__wrlH;
    const pack = game.packs.get(collection);
    const doc = await pack.getDocument(id);
    const original = doc.system.damage.base.formula;
    const snapshot = doc.toObject();
    delete snapshot._stats;
    H.snapshot = snapshot;
    await doc.update({ "system.damage.base.formula": formula });
    return { uuid: doc.uuid, original };
  },

  /** Put the damage back and compare the document with the one read before the edit (paths only). */
  restoreShelf: async ({ collection, id, original }) => {
    const H = globalThis.__wrlH;
    const pack = game.packs.get(collection);
    const doc = await pack.getDocument(id);
    await doc.update({ "system.damage.base.formula": original });
    const now = doc.toObject();
    delete now._stats;
    const diff = H?.snapshot ? Object.keys(foundry.utils.flattenObject(foundry.utils.diffObject(H.snapshot, now))) : null;
    return { restored: doc.system.damage.base.formula === original, diffPaths: diff };
  },

  /** Does the published row under `key` carry `formula` as its damage. */
  rowDamageIs: async ({ key, formula }) => {
    const t = globalThis.acksExtras.lib.tables;
    const grid = t.hasDoc("weapons") ? (t.getTable("weapons", "grid") ?? {}) : {};
    return { n: Object.keys(grid).length, is: grid[key]?.damage === formula };
  },

  /** Open the fixture's sheet, press Draw on the sword's row and time the write on the page clock. */
  press: async ({ actorId, swordId }) => {
    const H = globalThis.__wrlH;
    const T = globalThis.__wrl;
    const actor = game.actors.get(actorId);
    const app = new acksExtras.characterSheet.Sheet({ document: actor });
    H.opened.push(app);
    app.tabGroups.primary = "equipment";
    await app.render(true);
    const btn = await H.until(() => H.root(app)?.querySelector(`[data-item-id='${swordId}'] button[data-action='toggleEquip']`), 20000);
    if (!btn) return { found: false };
    const writes = () => T.marks.filter((m) => m.name === "write");
    const before = writes().length;
    const t0 = Math.round(performance.now());
    btn.click();
    const w = await H.until(() => writes().length > before && writes().at(-1), 30000, 10);
    return { found: true, elapsed: w ? w.t - t0 : null, equipped: w?.equipped ?? null };
  },

  closeAll: async () => {
    const H = globalThis.__wrlH;
    let n = 0;
    for (const app of H?.opened ?? []) { try { await app.close({ force: true }); n++; } catch {} }
    if (H) H.opened = [];
    return n;
  },
};

/* ------------------------------------------------------------------ */
/*  Driver side                                                         */
/* ------------------------------------------------------------------ */

async function run(api, fn, ...args) {
  const text = await api.eval(`(${fn.toString()})(...${JSON.stringify(args)}).then((v) => JSON.stringify(v === undefined ? null : v))`);
  return JSON.parse(text);
}

async function ready(api, label, seconds = 240) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.equipment?.getLoadout && !!globalThis.acksExtras?.characterSheet?.Sheet && !!globalThis.acksExtras?.lib?.tables`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}

/** A second DevTools client on the seat's game page, for the recorder: it has to be in before the page's first script. */
async function rawSeat(port) {
  const { webSocketDebuggerUrl } = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json());
  const ws = await new Promise((resolve, reject) => {
    const w = new WebSocket(webSocketDebuggerUrl);
    w.addEventListener("open", () => resolve(w));
    w.addEventListener("error", () => reject(new Error("raw seat: socket error")));
  });
  const cdp = new Cdp(ws);
  const isGame = (u) => { try { return new URL(u).pathname.endsWith("/game"); } catch { return false; } };
  const { targetInfos } = await cdp.send("Target.getTargets");
  const pages = targetInfos.filter((t) => t.type === "page" && isGame(t.url));
  if (pages.length !== 1) { ws.close(); throw new Error(`raw seat: ${pages.length} game pages`); }
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: pages[0].targetId, flatten: true });
  const send = (method, params = {}) => cdp.send(method, params, sessionId);
  await send("Page.enable");
  return { send, close() { try { ws.close(); } catch { /* closed */ } } };
}

const WALL_MS = Number(process.env.WALK_WALL_MS ?? 1_800_000);
let gm = null;
let raw = null;
let scriptId = null;
setTimeout(() => {
  console.error(`WALK ERROR: wall clock of ${WALL_MS} ms reached; closing the seat`);
  try { raw?.close(); } catch { /* closed */ }
  try { gm?.close(); } catch { /* closed */ }
  process.exit(1);
}, WALL_MS).unref();

/** After a reload: wait for the game to be ready and put the page-side helpers back. */
async function settle() {
  await ready(gm, "gm");
  await run(gm, P.install);
}

/**
 * Install the recorder with `cfg`, reload the seat with `location.reload()`, and poll the recorder's state
 * (read by its token) until `done(T)` or `timeoutS`. Resolves to the state last read, or null.
 */
async function reloadUnder(cfg, { done, timeoutS }) {
  if (scriptId) { try { await raw.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: scriptId }); } catch { /* gone with the page */ } }
  const token = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const source = `(${recorder.toString()})(${JSON.stringify({ ...cfg, token })})`;
  ({ identifier: scriptId } = await raw.send("Page.addScriptToEvaluateOnNewDocument", { source }));
  await raw.send("Page.bringToFront");
  await gm.eval(`setTimeout(() => location.reload(), 100); "scheduled"`);
  const t0 = Date.now();
  let last = null;
  for (;;) {
    await sleep(250);
    try {
      const text = await gm.eval(`JSON.stringify(globalThis.__wrl && globalThis.__wrl.token === ${JSON.stringify(token)} ? globalThis.__wrl : null)`);
      last = JSON.parse(text) ?? last;
    } catch { /* the page is between documents */ }
    if (last && done(last)) return last;
    if (Date.now() - t0 > timeoutS * 1000) return last;
  }
}

/** The recorder's marks, in page-clock order, as `name@ms[hasDoc/settled]` for the log. */
const timeline = (T) => (T?.marks ?? []).slice().sort((a, b) => a.t - b.t).map((m) => `${m.name}@${m.t}[doc=${m.hasDoc},settled=${m.settled}]`).join("  ");
const markOf = (T, name) => (T?.marks ?? []).find((m) => m.name === name) ?? null;

const cards = [];
const effectUuids = [];
let priorMode = null;
let strOriginal;
let actorId = null;
let edited = null;
let editRestored = true;

try {
  section("seat");
  gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  note("gm ready after (s)", await ready(gm, "gm"));
  const installed = await run(gm, P.install);
  if (!installed.isGM || !installed.activeGMIsSelf) blocked("the GM seat is not the active GM");
  raw = await rawSeat(PORTS.gm);
  priorMode = await run(gm, P.setting, { value: "on" });
  note("enforcement before the walk", priorMode);

  section("fixture and shape at rest");
  const fixture = await gm.fixture(MARKER, "Actor", FIXTURE);
  actorId = fixture.id ?? String(fixture.uuid).split(".").pop();
  note("fixture", { marker: MARKER, id: actorId });
  const standing = await run(gm, P.standingEffects, { actorId, name: EFFECT_NAME });
  if (standing.length) blocked(`the fixture carries ${standing.length} effect(s) named ${EFFECT_NAME} from an earlier run (ids ${standing.join(", ")}); remove them by id`);
  const shaped = await run(gm, P.shape, { actorId, items: FIXTURE.items, str: STR_PROBE });
  strOriginal = shaped.strBefore;
  const { swordId, daggerId } = shaped;
  if (!swordId || !daggerId) blocked("the fixture holds no two-handed sword and dagger rows");
  const rows0 = await run(gm, P.rows);
  note("weapon rows at rest", rows0);
  const importedRows = rows0.hasDoc && rows0.n > 0;

  let rest = null;
  let walkable = false;
  if (!importedRows) {
    skip("2f/2g/6: every step", "the world holds no imported weapon rows");
  } else {
    const unrestricted = await run(gm, P.atRest, { actorId, swordId, daggerId });
    const effect = await gm.create("ActiveEffect", { name: EFFECT_NAME, changes: [{ key: "flags.acks-extras.weaponProf", type: "add", mode: 2, value: TRAINED_CLASS }] }, { parent: fixture.uuid });
    effectUuids.push(effect.uuid);
    note("restriction effect", { uuid: effect.uuid });
    await sleep(1000);
    rest = await run(gm, P.atRest, { actorId, swordId, daggerId });
    note("at rest", { unrestrictedDaggerRow: unrestricted.daggerRow, restrictedDaggerRow: rest.daggerRow, sword: rest.two });
    if (unrestricted.daggerRow) skip("2f/2g: every step", "the Dagger's attack carries the Non-proficient row without the restriction, so the shape cannot tell the wait from its absence");
    else if (!rest.daggerRow) skip("2f/2g: every step", "the restriction does not make the Dagger's attack carry the Non-proficient row (the rows do not classify it), so the attack half has no observable");
    else if (!rest.two.wield || rest.two.used !== 2 || rest.two.where !== "bothHands") skip("2f/2g: every step", "the imported rows do not make the sword two-handed at rest, so the draw half has no observable");
    else walkable = true;
  }

  if (walkable) {
    section("2f. a Draw and an attack pressed in the load window wait for the rows");
    let hit = null;
    let lastT = null;
    for (let attempt = 1; attempt <= ATTEMPTS && !hit; attempt++) {
      await run(gm, P.shape, { actorId, items: FIXTURE.items, str: STR_PROBE });
      const T = await reloadUnder({ mode: "draw", actorId, swordId, daggerId }, { done: (s) => s.done, timeoutS: 180 });
      lastT = T;
      note(`attempt ${attempt} marks`, timeline(T));
      if (T?.errors?.length) note(`attempt ${attempt} recorder errors`, T.errors);
      for (const id of T?.cards ?? []) { await gm.track(id, "ChatMessage"); cards.push(id); }
      const press = markOf(T, "press");
      if (press && press.settled === false && press.hasDoc !== true) hit = T;
      else note(`attempt ${attempt}`, "the press was not in the load window (the rows had settled at the click); reloading");
      await settle();
    }
    const T = hit ?? lastT;
    const press = markOf(T, "press");
    const write = markOf(T, "write");
    const attack = markOf(T, "attackResolved");
    const rowsReadyMark = markOf(T, "rowsReady");
    note("order (page clock, ms)", { ready: markOf(T, "ready")?.t, firstHasDocReadFalse: markOf(T, "ready")?.hasDoc, press: press?.t, write: write?.t, attackResolved: attack?.t, rowsReady: rowsReadyMark?.t, writeAfterRowsReady: write && rowsReadyMark ? write.t >= rowsReadyMark.t : null });
    check("2f: the Draw was pressed in the load window, with the first publication unsettled and no weapons document registered at the click", !!hit, { press, attempts: ATTEMPTS });
    check("2f: the draw's write landed only after the weapons document registered: hasDoc and the settled flag were true inside the write's hook", !!write && write.equipped === true && write.hasDoc === true && write.settled === true && !!press && write.t >= press.t, { write, press });
    const lo = await run(gm, P.loadout, { actorId, swordId });
    check("2f: the loadout reads the sword wielded two-handed, two hands used, wear location both hands, as long after load", lo.equipped && lo.wield && lo.used === 2 && lo.where === "bothHands", lo);
    check("2f: the attack pressed in the same tick resolved only after the rows settled, and its roll and its card carry the Non-proficient row", !!attack && attack.rolled === true && attack.settled === true && attack.hasDoc === true && attack.row === true && attack.cardRow === true, attack);
    check("2f: the recorder reported no error", (T?.errors ?? []).length === 0, T?.errors);
    if (cards.length) {
      const swept = await gm.sweepTracked({ only: cards.map((id) => `ChatMessage.${id}`) });
      note("cards swept (2f)", swept);
      cards.length = 0;
    }
    note("closed", await run(gm, P.closeAll));

    section("2g. a sheet open in the load window redraws when the rows land");
    let hitG = null;
    let lastG = null;
    for (let attempt = 1; attempt <= ATTEMPTS && !hitG; attempt++) {
      await run(gm, P.shape, { actorId, items: FIXTURE.items, str: STR_PROBE });
      const G = await reloadUnder({ mode: "sheets", actorId, swordId, daggerId }, { done: (s) => s.done, timeoutS: 240 });
      lastG = G;
      note(`attempt ${attempt} marks`, timeline(G));
      if (G?.errors?.length) note(`attempt ${attempt} recorder errors`, G.errors);
      const drawn = markOf(G, "drawn");
      const closedMark = markOf(G, "closedWindow");
      const firstChange = G?.rowsChanged?.[0] ?? null;
      if (drawn && closedMark && drawn.settled === false && drawn.hasDoc !== true && closedMark.hasDoc !== true && firstChange != null && firstChange > closedMark.t) hitG = G;
      else note(`attempt ${attempt}`, "the windows were not both drawn and the third closed before the rows landed; reloading");
      await settle();
    }
    const G = hitG ?? lastG;
    const drawn = markOf(G, "drawn");
    const closedMark = markOf(G, "closedWindow");
    const landed = G?.rowsChanged?.[0] ?? null;
    const redrawn = (key) => (G?.renders?.[key] ?? []).filter((t) => landed != null && t >= landed - 1);
    const lag = (key) => (redrawn(key).length && landed != null ? redrawn(key)[0] - landed : null);
    note("redraw lag after the rows landed (ms)", { actor: lag("actor"), item: lag("item") });
    check("2g: the character sheet, the weapon's sheet and a third sheet were drawn, and the third closed, all before the first publication settled", !!hitG, { drawn, closedMark, landed });
    check("2g: with nothing touched, the character sheet and the weapon's sheet each re-rendered by themselves within the redraw bound once the rows landed", landed != null && redrawn("actor").length >= 1 && redrawn("item").length >= 1 && lag("actor") <= REDRAW_LAG_MS && lag("item") <= REDRAW_LAG_MS, { landed, actor: lag("actor"), item: lag("item") });
    check("2g: nothing wrote to the fixture, its items or their effects between the first reading and the second, so each redraw came from the rows landing", (G?.writes ?? []).length === 0, G?.writes);
    check("2g: the character sheet as drawn (its weapon rows and proficiency strip) reads differently once the rows landed", !!G?.before && !!G?.after && G.before.actorDom !== G.after.actorDom, { library: { strips: G?.before?.strips !== G?.after?.strips } });
    check("2g: the weapon sheet as drawn (its snapshot) reads differently once the rows landed", !!G?.before && !!G?.after && G.before.itemDom !== G.after.itemDom, { library: { classified: G?.before?.classified !== G?.after?.classified } });
    check("2g: the window closed before the rows landed was not drawn: its rendered stays false and no render fired on it", !!G?.final && G.final.closedRendered === false && G.final.closedRenders === closedMark?.renders, { final: G?.final, atClose: closedMark?.renders });
    check("2g: the recorder reported no error", (G?.errors ?? []).length === 0, G?.errors);
    note("closed", await run(gm, P.closeAll));
  }

  if (importedRows) {
    section("6. a library weapon edited after the shelf's cache lifetime keeps its row count");
    await run(gm, P.shape, { actorId, items: FIXTURE.items, str: STR_PROBE });
    const probe = await run(gm, P.shelfProbe, { name: TWO_HANDED });
    note("shelf probe", { hits: probe.hits.length, keyFound: !!probe.key, keys: probe.keys });
    if (probe.hits.length !== 1 || !probe.key) {
      skip("6: every observable", `the shelves hold ${probe.hits.length} minted weapon(s) named as the fixture's sword and the rows hold ${probe.keys} under that name; the step needs exactly one of each`);
    } else {
      const target = probe.hits[0];
      const O = await reloadUnder({ mode: "observe", actorId, swordId, daggerId }, { done: (s) => s.rowsChanged.length > 0 || s.errors.length > 0, timeoutS: 240 });
      note("observe marks", timeline(O));
      await settle();
      const N =(await run(gm, P.rows)).n;
      check("6: after the reload the rows announced themselves (weaponRowsChanged) and the count is what it was before the reload", (O?.rowsChanged?.length ?? 0) >= 1 && N > 0 && N === rows0.n, { announced: O?.rowsChanged?.length ?? 0, n: N, before: rows0.n });

      // The shelf's documents are dropped after it idles: wait in the foreground, touching none.
      await raw.send("Page.bringToFront");
      const t0 = Date.now();
      let nextLog = 60;
      for (;;) {
        const elapsed = Math.round((Date.now() - t0) / 1000);
        if (elapsed >= nextLog) { console.log(`waiting (foreground): ${elapsed} s of ${WAIT_S} s`); nextLog += 60; await raw.send("Page.bringToFront"); }
        if (elapsed >= WAIT_S) break;
        await sleep(5000);
      }
      console.log(`waited ${Math.round((Date.now() - t0) / 1000)} s in the foreground`);
      let shelf = await run(gm, P.shelf, { collection: target.collection });
      const evictStart = Date.now();
      while (!(shelf.loaded !== null && shelf.loaded < shelf.indexed) && (Date.now() - evictStart) / 1000 < EVICT_CAP_S) {
        await sleep(15000);
        shelf = await run(gm, P.shelf, { collection: target.collection });
        console.log(`evict poll after ${Math.round((Date.now() - t0) / 1000)} s since the reload: loaded ${shelf.loaded} of ${shelf.indexed}`);
      }
      check("6: the weapons shelf holds fewer documents than its index lists (Foundry has evicted them)", shelf.loaded !== null && shelf.loaded < shelf.indexed, { ...shelf, elapsedS: Math.round((Date.now() - t0) / 1000) });

      const changesBefore = (await run(gm, P.readT)).rowsChanged.length;
      const edit = await run(gm, P.editShelf, { collection: target.collection, id: target.id, formula: MARKER_FORMULA });
      edited = { ...target, original: edit.original };
      editRestored = false;
      note("edited library weapon (restore by this uuid if the walk dies)", { uuid: edit.uuid });
      const landedEdit = await (async () => {
        const t1 = Date.now();
        while (Date.now() - t1 < 30000) {
          if ((await run(gm, P.readT)).rowsChanged.length > changesBefore) return true;
          await sleep(200);
        }
        return false;
      })();
      const afterEdit = await run(gm, P.rowDamageIs, { key: probe.key, formula: MARKER_FORMULA });
      check("6: after weaponRowsChanged the count is still N and the edited weapon's row carries the new damage", landedEdit && afterEdit.n === N && afterEdit.is, { announced: landedEdit, n: afterEdit.n, was: N, carriesNew: afterEdit.is });

      const drawn = await run(gm, P.press, { actorId, swordId });
      check("6: a Draw on the weapon's row from a character sheet answers without the first-load wait", drawn.found && drawn.elapsed !== null && drawn.elapsed < DRAW_FAST_MS && drawn.equipped === true, { ...drawn, boundMs: DRAW_FAST_MS });
      note("closed", await run(gm, P.closeAll));

      const changesMid = (await run(gm, P.readT)).rowsChanged.length;
      const back = await run(gm, P.restoreShelf, { collection: target.collection, id: target.id, original: edited.original });
      editRestored = back.restored;
      const landedBack = await (async () => {
        const t1 = Date.now();
        while (Date.now() - t1 < 30000) {
          if ((await run(gm, P.readT)).rowsChanged.length > changesMid) return true;
          await sleep(200);
        }
        return false;
      })();
      const rowBack = await run(gm, P.rowDamageIs, { key: probe.key, formula: MARKER_FORMULA });
      note("restore compared with the document read before the edit (paths that differ)", back.diffPaths);
      check("6: the damage is restored on the shelf's weapon, the rows announced it, and the row no longer carries the marker", back.restored && landedBack && rowBack.is === false && rowBack.n === N, { restored: back.restored, announced: landedBack, n: rowBack.n, markerStillOnRow: rowBack.is });
    }
  }
  walkDone();
} catch (err) {
  if (!(err instanceof WalkBlocked)) {
    console.error("WALK ERROR:", err?.stack ?? err);
    checks.push(["walk ran to the end", false]);
  }
} finally {
  section("teardown");
  if (gm) {
    if (edited && !editRestored) {
      try { note("library weapon restored", await run(gm, P.restoreShelf, { collection: edited.collection, id: edited.id, original: edited.original })); editRestored = true; } catch (err) { console.error("library restore:", err?.message ?? err); }
    }
    try { await run(gm, P.install); } catch (err) { console.error("install:", err?.message ?? err); }
    try { await run(gm, P.closeAll); } catch (err) { console.error("closeAll:", err?.message ?? err); }
    if (actorId) {
      try {
        const reshaped = await run(gm, P.shape, { actorId, items: FIXTURE.items, str: strOriginal });
        note("fixture reshaped (every weapon sheathed, stored Strength back)", { drawn: reshaped.drawn });
        if (strOriginal !== undefined) note("stored Strength restored", await run(gm, P.setStr, { actorId, str: strOriginal }));
      } catch (err) { console.error("reshape:", err?.message ?? err); }
    }
    if (priorMode != null && priorMode !== "on") {
      try { await run(gm, P.setting, { value: priorMode }); note("enforcement restored", priorMode); } catch (err) { console.error("setting restore:", err?.message ?? err); }
    }
    const own = [...effectUuids, ...cards.map((id) => `ChatMessage.${id}`)];
    if (own.length) {
      try { note("sweep", await gm.sweepTracked({ only: own })); } catch (err) { console.error("sweep:", err?.message ?? err); }
    }
  }
  if (raw) {
    if (scriptId) { try { await raw.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: scriptId }); } catch { /* gone */ } }
    raw.close();
  }
  try { if (gm) await gm.close(); } catch { /* closed */ }
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`checks: ${passed} passed, ${checks.length - passed} failed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
