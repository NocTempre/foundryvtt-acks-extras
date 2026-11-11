/**
 * Live walk, equipment-printed-figures: the figures equipment used to carry in
 * source, each read from the world and never supplied by code. Walks
 * docs/equipment/TESTING.md "Figures the book prints" on the GM seat with the
 * rules book open, and on the Player seat where it is cheap: the price grid's
 * rows that state what they hold are counted and one is bound through the
 * importer's own binder (`pricedDoc`), and the item sheet says where the
 * container's capacity came from (the page, the hand that typed over it, or
 * that none is imported) on its Details and Contents tabs; a container with no
 * stated capacity stays a container and shows no figure; the Holds other items
 * toggle writes the container declaration alone and clears the capacity on its
 * way off; the equipment document's Weapon Finesse list and unarmed strike die
 * are imported, the finesse gate refuses only a size the list does not name,
 * and with either table absent (a Judge's override layer, written through the
 * Ruledata Browser's own `setOverride`) the gate refuses nothing, the unarmed
 * strike carries no die and says so, and clearing the override gives the
 * imported figures back. Machine values arrive through ./_env.mjs.
 *
 * Fixture, kept and found by marker: `equipment/printed-figures-actor`, a
 * character the Player seat owns, carrying three items by name: a container
 * whose gear flag the walk brings to what the importer writes for a price row
 * that states a capacity, a container that only declares it holds gear, and a
 * plain sack. Each run brings all three to that shape before its first check.
 * The walk's own documents (the cards an unarmed throw posts) are tracked by
 * id and swept by that list; its override is cleared in a `finally`. Every
 * figure printed is a boolean or a count: no book figure and no book name
 * leaves the page.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, books, PORTS } from "./_env.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const MARKER = "equipment/printed-figures-actor";
const MOD = "acks-extras";
const DOC = "equipment";
const FINESSE = "weaponFinesse";
const UNARMED = "unarmedStrike";
const NAMES = { priced: "QA Priced Container", unlimited: "QA Unlimited Container", plain: "QA Plain Sack" };
/** Invented figures: no page prints these. */
const TYPED_CAPACITY = 17;
const HAND_CAPACITY = 5;
const INVENTED_DIE = "1d7";

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/** Records a page's throws from before its first script: the only way to see init, setup and ready. */
const RECORDER = `(() => {
  const R = (globalThis.__pfBoot = { phase: "load", phases: [], errors: [] });
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

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in a seat's page.  */
/* ------------------------------------------------------------------ */
const P = {
  install: async () => {
    const H = (globalThis.__pf = globalThis.__pf ?? {});
    H.T = acksExtras.lib.tables;
    H.CB = await import("/modules/acks-extras/scripts/importer/cookbook.mjs");
    H.EXT = await import("/modules/acks-extras/scripts/importer/extract.mjs");
    H.GP = await import("/modules/acks-extras/scripts/importer/gear-prices.mjs");
    H.AM = await import("/modules/acks-extras/scripts/equipment/attack-mods.mjs");
    H.ACT = await import("/modules/acks-extras/scripts/equipment/actions.mjs");
    H.PL = await import("/modules/acks-extras/scripts/equipment/printed-layers.mjs");
    H.IM = await import("/modules/acks-extras/scripts/lib/item-model.mjs");
    H.STORE = await import("/modules/acks-extras/scripts/location/table-store.mjs");
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 60, every = 200 } = {}) => {
      for (let n = 0; n < tries; n++) {
        const v = await fn();
        if (v) return v;
        await H.sleep(every);
      }
      return null;
    };
    H.root = (app) => (app?.element?.nodeType === 1 ? app.element : app?.element?.[0]) ?? null;
    H.opened = H.opened ?? [];
    H.closeAll = async () => {
      for (const app of H.opened) { try { await app.close({ animate: false }); } catch { /* already closed */ } }
      H.opened = [];
      return true;
    };
    H.mine = H.mine ?? { override: new Set() };
    if (!H.patched) {
      H.patched = true;
      H.notes = [];
      H.errors = [];
      H.orig = {};
      for (const k of ["info", "warn", "error"]) {
        H.orig[k] = ui.notifications[k];
        ui.notifications[k] = function (msg, ...rest) {
          H.notes.push({ kind: k, text: String(msg) });
          return H.orig[k].call(this, msg, ...rest);
        };
      }
      H.consoleError = console.error;
      console.error = (...args) => { H.errors.push(args.map((a) => a?.message ?? String(a)).join(" ").slice(0, 300)); H.consoleError(...args); };
      H.cards = [];
      H.hook = Hooks.on("createChatMessage", (m) => { if (m.author?.id === game.user.id) H.cards.push(m.id); });
    }
    return { isGM: game.user.isGM, role: game.user.role, activeGMIsSelf: !!game.users.activeGM?.isSelf, boot: globalThis.__pfBoot ?? null };
  },
  userId: async ({ name }) => game.users.find((u) => u.name === name)?.id ?? null,
  localize: async ({ key, data }) => (data ? game.i18n.format(key, data) : game.i18n.localize(key)),

  /* ---------------- the book, the import and the registry ---------------- */

  connectBook: async ({ id, path }) => {
    const H = globalThis.__pf;
    if (H.CB.cookbookSessionDoc(id)) return { already: true };
    globalThis.__pfBook = { done: false };
    acksExtras.importer.connectBookUrl(id, path, { remember: false, bridge: false })
      .then(() => { globalThis.__pfBook = { done: true, ok: true }; })
      .catch((e) => { globalThis.__pfBook = { done: true, ok: false, error: String(e?.message ?? e) }; });
    return { started: true };
  },
  bookState: async ({ id }) => {
    const H = globalThis.__pf;
    const open = !!H.CB.cookbookSessionDoc(id);
    return { ...(globalThis.__pfBook ?? {}), open, done: !!(globalThis.__pfBook?.done || open) };
  },
  importTables: async () => {
    globalThis.__pfImport = { done: false };
    acksExtras.importer.cookbookImportTables(["equipment"])
      .then((r) => { globalThis.__pfImport = { done: true, ok: !!r }; })
      .catch((e) => { globalThis.__pfImport = { done: true, ok: false, error: String(e?.message ?? e) }; });
    return { started: true };
  },
  importJob: async () => globalThis.__pfImport ?? { done: false },
  /** The two tables as this page's registry serves them, as booleans and counts. */
  tables: async () => {
    const H = globalThis.__pf;
    const SIZES = ["tiny", "small", "medium", "large"];
    const has = H.T.hasDoc("equipment");
    const tables = has ? H.T.getDoc("equipment").tables ?? {} : {};
    const sizes = tables.weaponFinesse?.sizes;
    const die = H.AM.unarmedStrikeDie();
    return {
      doc: has,
      finesseListed: Array.isArray(sizes) && sizes.length >= 1 && sizes.every((s) => SIZES.includes(s)),
      finesseSizesImported: H.AM.finesseSizesImported(),
      finesseOverrideStands: H.STORE.hasOverride("equipment", "weaponFinesse"),
      finesseServed: Array.isArray(sizes) ? `list of ${sizes.length}` : sizes === undefined ? "no sizes" : typeof sizes,
      takes: SIZES.filter((s) => H.AM.finesseTakes(s) === true).length,
      refuses: SIZES.filter((s) => H.AM.finesseTakes(s) === false).length,
      unknownSize: H.AM.finesseTakes(null) === null && H.AM.finesseTakes(undefined) === null,
      dieImported: die !== null,
      dataCarriesDie: die !== null && H.ACT.unarmedStrikeData().system.damage.base.formula === die,
    };
  },
  /** How many price rows state a capacity, and the first such row's index (never its name or figure). */
  priceRows: async () => {
    const H = globalThis.__pf;
    const doc = H.CB.cookbookSessionDoc("rr");
    if (!doc) return { open: false };
    const rows = await H.GP.extractPriceRowsFromDoc(doc, H.EXT.pageItems);
    const stated = rows.filter((r) => r.capacity != null);
    globalThis.__pfRow = stated[0] ?? null;
    return { open: true, rows: rows.length, stated: stated.length, tables: [...new Set(stated.map((r) => r.table))].length, allPositive: stated.every((r) => Number.isFinite(r.capacity) && r.capacity >= 0) };
  },
  /** An OVERRIDE of one table through the Ruledata Browser's own store, refused where one already stands. */
  override: async ({ table, data }) => {
    const H = globalThis.__pf;
    if (H.STORE.hasOverride("equipment", table) && !H.mine.override.has(table)) return { set: false, reason: "foreign override" };
    await H.STORE.setOverride("equipment", table, data, { sourceName: "qa-printed-figures" });
    H.mine.override.add(table);
    await H.poll(() => JSON.stringify(H.T.getDoc("equipment").tables?.[table] ?? null) === JSON.stringify(data));
    return { set: true, served: JSON.stringify(H.T.getDoc("equipment").tables?.[table] ?? null) === JSON.stringify(data) };
  },
  /** Remove this run's overrides, and wait for the registry to serve the imported tables again. */
  clearOverrides: async () => {
    const H = globalThis.__pf;
    const cleared = [];
    for (const table of [...(H?.mine?.override ?? [])]) {
      try { await H.STORE.clearOverride("equipment", table); H.mine.override.delete(table); cleared.push(table); } catch (e) { console.warn("clearOverride", e?.message ?? e); }
    }
    const left = ["weaponFinesse", "unarmedStrike"].filter((t) => H?.STORE?.hasOverride("equipment", t)).length;
    return { cleared: cleared.length, left };
  },

  /* ---------------- the kept fixture ---------------- */

  /** Bring the three items to the shape each section reads. */
  shape: async ({ actorId, playerId, names }) => {
    const H = globalThis.__pf;
    const actor = game.actors.get(actorId);
    const item = (n) => actor.items.find((i) => i.name === n) ?? null;
    const priced = item(names.priced);
    const unlimited = item(names.unlimited);
    const plain = item(names.plain);
    if (!priced || !unlimited || !plain) return { ok: false, found: { priced: !!priced, unlimited: !!unlimited, plain: !!plain } };
    const row = globalThis.__pfRow;
    if (!row) return { ok: false, reason: "no price row states a capacity (connect the rules book)" };
    const doc = H.CB.pricedDoc(row, "def.priced.qa-printed-figures", "RR p. 0");
    const flags = doc.flags["acks-extras"];
    const wipe = new foundry.data.operators.ForcedDeletion();
    // A container record (lock, keys, quality) declares a container on its own, so a sack that is to declare nothing carries none.
    for (const i of [priced, unlimited, plain]) await i.update({ "flags.acks-extras.gear": wipe, "flags.acks-extras.cookbook": wipe, "flags.acks-extras.container": wipe });
    // What the import writes for a price row that states a capacity, plus the declaration Annotate adds by name.
    await priced.update({ "flags.acks-extras.gear": { ...flags.gear, holds: true }, "flags.acks-extras.cookbook": { ...flags.cookbook, cite: "RR p. 0" } });
    await unlimited.update({ "flags.acks-extras.gear": { holds: true } });
    if ((actor.ownership?.[playerId] ?? 0) < 3) await actor.update({ [`ownership.${playerId}`]: 3 });
    const g = (i) => i.getFlag("acks-extras", "gear") ?? {};
    return {
      ok: true,
      ids: { priced: priced.id, unlimited: unlimited.id, plain: plain.id },
      pricedStatesPage: Number.isFinite(g(priced).capacity) && g(priced).capacity === row.capacity && priced.getFlag("acks-extras", "cookbook")?.read?.capacity === row.capacity,
      unlimitedStatesNone: g(unlimited).holds === true && !Number.isFinite(g(unlimited).capacity),
      plainDeclaresNothing: Object.keys(g(plain)).length === 0 && !plain.getFlag("acks-extras", "container"),
    };
  },
  /** The item's capacity as the model answers it and as its tooltip words it, against the localized sentences. */
  model: async ({ actorId, itemId }) => {
    const H = globalThis.__pf;
    const item = game.actors.get(actorId).items.get(itemId);
    const tip = H.PL.capacityTip(item);
    const name = item.name;
    const cite = item.getFlag("acks-extras", "cookbook")?.cite ?? "";
    const loc = (k, d) => game.i18n.format(`ACKS-EQUIPMENT.printed.${k}`, d ?? {});
    const kinds = {
      fromPage: loc("fromPage", { name, cite }),
      editedByHand: loc("editedByHand", { name, cite: cite || name }),
      byHand: loc("byHand", { name }),
      notImported: game.i18n.localize("ACKS-EQUIPMENT.printed.capacityNotImportedTip"),
    };
    const kind = Object.entries(kinds).find(([, v]) => v === tip)?.[0] ?? "other";
    return {
      holds: H.IM.holdsGear(item),
      stated: H.IM.capacityStated(item),
      figure: Number.isFinite(H.IM.capacityOf(item)),
      kind,
      tipHasDigit: /\d/.test(kind === "notImported" ? tip : ""),
    };
  },

  /* ---------------- the item sheet ---------------- */

  /** Open a fresh sheet and put it on a tab; read the capacity field and the tooltips as a user sees them. */
  sheet: async ({ actorId, itemId, tab, edit = false }) => {
    const H = globalThis.__pf;
    const item = game.actors.get(actorId).items.get(itemId);
    try { await item.sheet.close({ animate: false }); } catch { /* not open */ }
    await item.sheet.render({ force: true });
    H.opened.push(item.sheet);
    await H.poll(() => H.root(item.sheet)?.querySelector(".acks-extras-item-sheet__stack, [data-tab], [data-action='showDetails']"));
    // A plain item's sheet is the simple layout: its Details panel unfolds from the footer.
    if (tab === "details" && !H.root(item.sheet)?.querySelector(".acks-extras-item-sheet__stack")) {
      H.root(item.sheet)?.querySelector("[data-action='showDetails']")?.click();
      await H.poll(() => H.root(item.sheet)?.querySelector(".acks-extras-item-sheet__stack"));
    }
    if (edit) {
      H.root(item.sheet)?.querySelector('[data-action="edit"]')?.click();
      await H.poll(() => H.root(item.sheet)?.querySelector('input[name="flags.acks-extras.gear.capacity"]:not([disabled]), [data-action="toggleHolds"]:not([disabled])'));
    }
    try { item.sheet.changeTab(tab, "primary"); } catch { /* not offered */ }
    await H.sleep(500);
    return H.read({ item, tab });
  },
};

/** The sheet reader lives on the page object so every sheet call shares it. */
const READER = async () => {
  const H = globalThis.__pf;
  H.read = async ({ item, tab }) => {
    const root = H.root(item.sheet);
    if (!root) return { rendered: false };
    const input = root.querySelector('input[name="flags.acks-extras.gear.capacity"]');
    const toggle = root.querySelector('[data-action="toggleHolds"]');
    const tip = H.PL.capacityTip(item);
    const notImported = game.i18n.localize("ACKS-EQUIPMENT.printed.notImported");
    const facts = [...root.querySelectorAll('[data-drop="contents"] .acks-extras-item-sheet__fact-value[data-tooltip-text]')];
    const fact = facts.find((f) => f.dataset.tooltipText === tip) ?? null;
    return {
      rendered: true,
      tab,
      tabsOffered: [...root.querySelectorAll("[data-tab]")].map((t) => t.dataset.tab).filter((v, i, a) => a.indexOf(v) === i).includes("contents"),
      toggle: !!toggle,
      toggleChecked: !!toggle?.checked,
      toggleEnabled: !!toggle && !toggle.disabled,
      input: !!input,
      inputValue: input ? input.value : null,
      inputEnabled: !!input && !input.disabled,
      labelTipIsModel: !!input && input.closest("label")?.dataset.tooltipText === tip,
      contentsFact: !!fact,
      contentsSaysNotImported: !!fact && fact.textContent.includes(notImported),
      contentsHasFigure: !!fact && /\d/.test(fact.textContent.replace(/\s+/g, " ").replace(/[·].*$/, "")),
    };
  };
  return true;
};
/** The keys of an item's gear flag, and whether it declares a container: the shape a step starts from. */
P.gearShape = async ({ actorId, itemId, wipe = false }) => {
  const item = game.actors.get(actorId).items.get(itemId);
  if (wipe) await item.update({ "flags.acks-extras.gear": new foundry.data.operators.ForcedDeletion(), "flags.acks-extras.container": new foundry.data.operators.ForcedDeletion() });
  const gear = item.getFlag("acks-extras", "gear") ?? {};
  return { keys: Object.keys(gear), holds: gear.holds === true, containerRecord: !!item.getFlag("acks-extras", "container") };
};
/** Type into the capacity field as a user does, or press the Holds toggle, and wait for the document. */
P.type = async ({ actorId, itemId, value }) => {
  const H = globalThis.__pf;
  const item = game.actors.get(actorId).items.get(itemId);
  const input = H.root(item.sheet)?.querySelector('input[name="flags.acks-extras.gear.capacity"]');
  if (!input) return { found: false };
  input.value = value == null ? "" : String(value);
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await H.poll(() => (item.getFlag("acks-extras", "gear")?.capacity ?? null) === value, { tries: 40 });
  await H.sleep(500);
  return { found: true, stored: item.getFlag("acks-extras", "gear")?.capacity ?? null };
};
P.toggle = async ({ actorId, itemId, want }) => {
  const H = globalThis.__pf;
  const item = game.actors.get(actorId).items.get(itemId);
  const box = H.root(item.sheet)?.querySelector('[data-action="toggleHolds"]');
  if (!box) return { found: false };
  box.click();
  await H.poll(() => (item.getFlag("acks-extras", "gear")?.holds === true) === want, { tries: 40 });
  await H.sleep(500);
  const gear = item.getFlag("acks-extras", "gear") ?? {};
  return { found: true, holds: gear.holds === true, capacityCleared: !Number.isFinite(gear.capacity) };
};

/** The unarmed strike as the module builds it and as the throw reports it. */
P.unarmed = async ({ actorId, roll }) => {
  const H = globalThis.__pf;
  const actor = game.actors.get(actorId);
  const data = H.ACT.unarmedStrikeData();
  const before = H.notes.length;
  const cardsBefore = H.cards.length;
  let threw = null;
  if (roll) {
    try { await H.ACT.rollUnarmed(actor, { skipDialog: true }); } catch (e) { threw = String(e?.message ?? e).slice(0, 120); }
    await H.sleep(800);
  }
  const noDie = game.i18n.localize("ACKS-EQUIPMENT.action.unarmedNoDie");
  return {
    formula: data.system.damage.base.formula,
    die: H.AM.unarmedStrikeDie(),
    saidNoDie: H.notes.slice(before).some((n) => n.text === noDie),
    cards: H.cards.slice(cardsBefore),
    threw,
  };
};
P.drain = async () => ({ errors: globalThis.__pf.errors.slice(), cards: globalThis.__pf.cards.slice() });
P.closeAll = async () => globalThis.__pf.closeAll();
P.restore = async () => {
  const H = globalThis.__pf;
  if (!H?.patched) return "never installed";
  for (const k of ["info", "warn", "error"]) ui.notifications[k] = H.orig[k];
  console.error = H.consoleError;
  Hooks.off("createChatMessage", H.hook);
  H.patched = false;
  return "restored";
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
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.equipment && !!globalThis.acksExtras?.lib?.tables`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}
async function cdp(port) {
  const targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
  const page = targets.find((t) => t.type === "page" && t.url.startsWith(origin));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve) => { ws.onopen = resolve; });
  let next = 0;
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++next + 700000;
    const on = (event) => {
      const reply = JSON.parse(event.data);
      if (reply.id === id) { ws.removeEventListener("message", on); resolve(reply.result); }
    };
    ws.addEventListener("message", on);
    ws.send(JSON.stringify({ id, method, params }));
  });
  return { send, close: () => ws.close() };
}
async function record(port, label, api) {
  const s = await cdp(port);
  await s.send("Page.enable");
  await s.send("Page.addScriptToEvaluateOnNewDocument", { source: RECORDER });
  await s.send("Page.reload");
  await sleep(1500);
  const seconds = await ready(api, label);
  s.close();
  return seconds;
}
async function waitFor(api, fn, args, label, seconds = 300) {
  const t0 = Date.now();
  for (;;) {
    const state = await run(api, fn, args);
    if (state.done) return state;
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not done after ${seconds}s`);
    await sleep(2000);
  }
}

let gm = null;
let player = null;
/** The uuids of the cards this run's unarmed throws posted: the only documents teardown deletes. */
const own = [];
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 540_000);
setTimeout(() => {
  console.error(`WALK ERROR: wall clock of ${WALL_MS} ms reached; closing the seats`);
  try { player?.close(); } catch {}
  try { gm?.close(); } catch {}
  process.exit(1);
}, WALL_MS).unref();

try {
  section("seats");
  gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  player = await connect({ browser, origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  note("gm ready after (s)", await record(PORTS.gm, "gm", gm));
  note("player ready after (s)", await record(PORTS.player, "player", player));
  const installed = await run(gm, P.install);
  const seated = await run(player, P.install);
  await run(gm, READER);
  await run(player, READER);
  check("the GM seat is the active GM and the player seat is a player", installed.isGM && installed.activeGMIsSelf && !seated.isGM && seated.role <= 2, { gm: installed.role, player: seated.role });
  for (const [key, c] of Object.entries({ gm: installed, player: seated })) {
    const phases = c.boot?.phases ?? [];
    const errors = c.boot?.errors ?? [];
    const naming = errors.filter((e) => /equipment|weapon|capacity|finesse|unarmed/i.test(e.text));
    note(`${key}: errors recorded from load through ready (any text)`, errors.length);
    check(`${key}: init, setup and ready ran and no error names equipment`, ["init", "setup", "ready"].every((p) => phases.includes(p)) && naming.length === 0, { phases, naming: naming.length });
  }

  section("1. the book: the price grid and the equipment tables");
  const staged = books(["rr"]);
  check("the staged rules book is named", staged.length === 1, { n: staged.length });
  for (const { id, path } of staged) {
    await run(gm, P.connectBook, { id, path });
    await waitFor(gm, P.bookState, { id }, `connect ${id}`);
  }
  const rows = await run(gm, P.priceRows);
  check("the price grid is read, and rows state a capacity in their own label (7 expected)", rows.open && rows.rows > 100 && rows.stated === 7 && rows.allPositive, rows);
  check("every row that states one is on a single price page", rows.tables === 1, { pages: rows.tables });
  let tables = await run(gm, P.tables);
  note("tables before", tables);
  if (!tables.finesseListed || !tables.dieImported) {
    await run(gm, P.importTables);
    const job = await waitFor(gm, P.importJob, {}, "import equipment tables", 420);
    check("the Rules tables import ran for the equipment document", job.ok, { ok: job.ok, error: job.error ?? null });
    tables = await run(gm, P.tables);
    note("tables after", tables);
  }
  check("the world holds the Weapon Finesse list: sizes only, at least one taken and at least one refused", tables.doc && tables.finesseListed && tables.finesseSizesImported && tables.takes >= 1 && tables.refuses >= 1, tables);
  check("a size the walk cannot name decides nothing", tables.unknownSize, tables);
  check("the world holds the unarmed strike's die and the module's strike carries it", tables.dieImported && tables.dataCarriesDie, tables);
  const seen = await run(player, P.tables);
  check("the Player seat's registry holds the same", seen.finesseListed && seen.dieImported && seen.takes === tables.takes && seen.refuses === tables.refuses, seen);

  section("fixture");
  const playerId = await run(gm, P.userId, { name: MACHINE.player });
  const fixture = await gm.fixture(MARKER, "Actor", {
    name: "QA Printed Figures", type: "character", prototypeToken: { actorLink: true }, ownership: { default: 0, [playerId]: 3 },
    items: [
      { name: NAMES.priced, type: "item" },
      { name: NAMES.unlimited, type: "item" },
      { name: NAMES.plain, type: "item" },
    ],
  });
  const actorId = fixture.id;
  const shaped = await run(gm, P.shape, { actorId, playerId, names: NAMES });
  check("the kept fixture is at its shape: a container bound from a price row that states a capacity, one with none stated, a plain sack", shaped.ok && shaped.pricedStatesPage && shaped.unlimitedStatesNone && shaped.plainDeclaresNothing, shaped);
  if (!shaped.ok) throw new Error(`fixture shape: ${JSON.stringify(shaped)}`);
  const ids = shaped.ids;
  await sleep(500);

  section("2. a container whose price row states its capacity");
  let m = await run(gm, P.model, { actorId, itemId: ids.priced });
  check("it holds gear, its capacity is stated, and its tooltip cites the page", m.holds && m.stated && m.figure && m.kind === "fromPage", m);
  let s = await run(gm, P.sheet, { actorId, itemId: ids.priced, tab: "details" });
  check("the Details tab shows Holds other items ticked, the capacity field filled, its tooltip the page's", s.rendered && s.toggleChecked && s.input && s.inputValue !== "" && s.labelTipIsModel, s);
  s = await run(gm, P.sheet, { actorId, itemId: ids.priced, tab: "contents" });
  check("the Contents tab shows the capacity with the same tooltip and no \"not imported\"", s.rendered && s.tabsOffered && s.contentsFact && !s.contentsSaysNotImported && s.contentsHasFigure, s);
  s = await run(gm, P.sheet, { actorId, itemId: ids.priced, tab: "details", edit: true });
  const typed = await run(gm, P.type, { actorId, itemId: ids.priced, value: TYPED_CAPACITY });
  check("a capacity typed over it is stored", typed.found && typed.stored === TYPED_CAPACITY, typed);
  m = await run(gm, P.model, { actorId, itemId: ids.priced });
  check("and the tooltip says a hand changed the page's figure (editedByHand)", m.stated && m.kind === "editedByHand", m);
  const blank = await run(gm, P.type, { actorId, itemId: ids.priced, value: null });
  check("clearing the field stores no capacity, never a stand-in", blank.found && blank.stored === null, blank);
  m = await run(gm, P.model, { actorId, itemId: ids.priced });
  check("it is still a container, states no capacity, and its tooltip says so with no figure", m.holds && !m.stated && !m.figure && m.kind === "notImported" && !m.tipHasDigit, m);
  await run(gm, P.closeAll);
  let mp = null;
  for (let n = 0; n < 12; n++) {
    await sleep(1000);
    mp = await run(player, P.model, { actorId, itemId: ids.priced });
    if (mp.kind === "notImported") break;
  }
  check("the Player seat reads the same: a container with no stated capacity says it is not imported", mp.holds && !mp.stated && mp.kind === "notImported", mp);

  section("3. a container with no stated capacity");
  m = await run(gm, P.model, { actorId, itemId: ids.unlimited });
  check("it is a container with no limit, and its tooltip says not imported", m.holds && !m.stated && !m.figure && m.kind === "notImported", m);
  s = await run(gm, P.sheet, { actorId, itemId: ids.unlimited, tab: "details" });
  check("the Details tab shows the capacity field empty, its tooltip the not-imported one", s.rendered && s.toggleChecked && s.input && s.inputValue === "" && s.labelTipIsModel, s);
  s = await run(gm, P.sheet, { actorId, itemId: ids.unlimited, tab: "contents" });
  check("the Contents tab says \"not imported\" and shows no figure", s.rendered && s.contentsFact && s.contentsSaysNotImported && !s.contentsHasFigure, s);
  await run(gm, P.closeAll);
  note("plainAfterSection3", await run(gm, P.gearShape, { actorId, itemId: ids.plain }));

  section("4. the Holds other items toggle");
  // The step starts from a sack that declares nothing; a flag already there is reported, then cleared.
  const plainAtStart = await run(gm, P.gearShape, { actorId, itemId: ids.plain });
  note("plainAtStep4", plainAtStart);
  if (plainAtStart.keys.length || plainAtStart.containerRecord) await run(gm, P.gearShape, { actorId, itemId: ids.plain, wipe: true });
  s = await run(gm, P.sheet, { actorId, itemId: ids.plain, tab: "details", edit: true });
  check("a plain sack's Details tab offers the toggle, unticked, with no capacity field", s.rendered && s.toggle && s.toggleEnabled && !s.toggleChecked && !s.input, s);
  const on = await run(gm, P.toggle, { actorId, itemId: ids.plain, want: true });
  check("ticking it declares the sack a container", on.found && on.holds, on);
  m = await run(gm, P.model, { actorId, itemId: ids.plain });
  check("it holds gear with no stated capacity, and says not imported", m.holds && !m.stated && m.kind === "notImported", m);
  s = await run(gm, P.sheet, { actorId, itemId: ids.plain, tab: "details", edit: true });
  check("the capacity field appears, empty", s.input && s.inputValue === "", s);
  const hand = await run(gm, P.type, { actorId, itemId: ids.plain, value: HAND_CAPACITY });
  m = await run(gm, P.model, { actorId, itemId: ids.plain });
  check("a capacity typed on a container nothing imported reads as set by hand (byHand)", hand.stored === HAND_CAPACITY && m.stated && m.kind === "byHand", { stored: hand.stored, kind: m.kind });
  const off = await run(gm, P.toggle, { actorId, itemId: ids.plain, want: false });
  check("unticking it declares no container and takes the capacity with it", off.found && !off.holds && off.capacityCleared, off);
  await run(gm, P.closeAll);

  section("5. Weapon Finesse: the imported sizes decide, a size they do not name refuses");
  const base = await run(gm, P.tables);
  check("with the list imported the gate decides: some sizes taken, some refused", base.finesseSizesImported && base.takes >= 1 && base.refuses >= 1, base);
  const absent = await run(gm, P.override, { table: FINESSE, data: {} });
  check("a Judge's override that holds no sizes is served", absent.set && absent.served, absent);
  const noList = await run(gm, P.tables);
  check("with no sizes imported the gate refuses nothing and says it cannot decide", !noList.finesseSizesImported && noList.takes === 0 && noList.refuses === 0, noList);
  const one = await run(gm, P.override, { table: FINESSE, data: { sizes: ["large"] } });
  const oneTables = await run(gm, P.tables);
  check("an override listing one size takes that size and refuses the other three", one.set && oneTables.takes === 1 && oneTables.refuses === 3, oneTables);
  const junk = await run(gm, P.override, { table: FINESSE, data: { sizes: "large" } });
  const junkTables = await run(gm, P.tables);
  check("a list that is not a list counts as not imported and refuses nothing", junk.set && !junkTables.finesseSizesImported && junkTables.refuses === 0, junkTables);

  section("6. the unarmed strike: the imported die, none, a Judge's die");
  let u = await run(gm, P.unarmed, { actorId, roll: false });
  check("with the die imported the strike carries it", u.die !== null && u.formula === u.die, { hasDie: u.die !== null, agrees: u.formula === u.die });
  const noDie = await run(gm, P.override, { table: UNARMED, data: {} });
  check("a Judge's override that holds no die is served", noDie.set && noDie.served, noDie);
  u = await run(gm, P.unarmed, { actorId, roll: true });
  for (const id of u.cards) { await gm.track(id, "ChatMessage"); own.push(`ChatMessage.${id}`); }
  check("with no die imported the strike carries a blank formula and no figure", u.die === null && u.formula === "", { die: u.die, formula: u.formula });
  check("the throw says the die is not imported (unarmedNoDie)", u.saidNoDie, { saidNoDie: u.saidNoDie, threw: u.threw });
  const invented = await run(gm, P.override, { table: UNARMED, data: { damage: INVENTED_DIE } });
  u = await run(gm, P.unarmed, { actorId, roll: false });
  check("a Judge's own die wins over the page's", invented.set && u.die === INVENTED_DIE && u.formula === INVENTED_DIE, { set: invented.set, die: u.die === INVENTED_DIE });
  const garbage = await run(gm, P.override, { table: UNARMED, data: { damage: "a lot" } });
  u = await run(gm, P.unarmed, { actorId, roll: false });
  check("a die that is not NdM counts as not imported", garbage.set && u.die === null && u.formula === "", { die: u.die, formula: u.formula });

  section("7. the overrides are cleared and the imported figures come back");
  const cleared = await run(gm, P.clearOverrides);
  check("both of this run's overrides are cleared and none is left", cleared.cleared === 2 && cleared.left === 0, cleared);
  await sleep(800);
  const back = await run(gm, P.tables);
  check("the imported figures are served again, the same counts as before", back.finesseSizesImported && back.takes === base.takes && back.refuses === base.refuses && back.dieImported && back.dataCarriesDie, back);
  let backPlayer = null;
  const polled = Date.now();
  for (let n = 0; n < 12; n++) {
    backPlayer = await run(player, P.tables);
    if (backPlayer.finesseSizesImported && backPlayer.dieImported) break;
    await sleep(1000);
  }
  note("player registry after clear (s)", Math.round((Date.now() - polled) / 1000));
  check("and the Player seat's registry agrees", backPlayer.finesseSizesImported && backPlayer.takes === base.takes && backPlayer.dieImported, backPlayer);

  section("8. console");
  for (const [key, api] of [["gm", gm], ["player", player]]) {
    const drained = await run(api, P.drain);
    check(`${key}: no console error over the walk`, !drained.errors.length, drained.errors.slice(0, 3));
  }
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  if (gm) {
    try { note("overrides", await run(gm, P.clearOverrides)); } catch (err) { console.error("clearOverrides:", err?.message ?? err); }
    try { await run(gm, P.closeAll); } catch {}
    // Every card this page's user posted since the recorder armed is the run's own; one a throw kept from the step's return is tracked here.
    try {
      const posted = await run(gm, P.drain);
      for (const id of posted.cards) {
        if (own.includes(`ChatMessage.${id}`)) continue;
        await gm.track(id, "ChatMessage");
        own.push(`ChatMessage.${id}`);
      }
    } catch (err) { console.error("card drain:", err?.message ?? err); }
    try { note("restored", await run(gm, P.restore)); } catch (err) { console.error("restore:", err?.message ?? err); }
  }
  if (player) {
    try { await run(player, P.closeAll); } catch {}
    try { note("restored (player)", await run(player, P.restore)); } catch (err) { console.error("restore:", err?.message ?? err); }
  }
  console.log(`fixture kept: ${MARKER}`);
  try { if (gm) note("sweep", await gm.sweepTracked({ only: own })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  try { if (player) await player.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
