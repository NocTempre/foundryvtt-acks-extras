/**
 * Live walk, equipment-weapon-rows: the weapon rows are the book's, read
 * through the weapon seam, and a world that lacks the grid or the lists says
 * "not imported". Walks docs/equipment/TESTING.md "Weapon rows read from the
 * book" on the GM seat, with the Player seat reading the same rows.
 *
 * Nothing ships a weapon, so the rows a walk meets are the ones the world
 * imported from the Judge's own copy. The walk picks its weapons from them
 * (a row a list places on a class, a second row of another class), builds its
 * fixtures from those, and prints booleans and counts only: no weapon's name,
 * die or size leaves the page.
 *
 * Fixtures, kept and found by marker (each step brings its shape back first):
 *   equipment/rows-core-axe  a character with one weapon named for a placed row
 *   equipment/rows-legacy    the same, wearing the stamps an old Annotate wrote
 *   equipment/rows-trained   a character the Player seat owns: two placed
 *                            weapons of different classes, one no row names,
 *                            and a one-class weapon-proficiency list
 *   equipment/rows-holy      a character with the throwables kinds the lists name
 * The annotate step's item is built under the core-axe actor, tracked, and
 * swept by uuid. The absent cases unregister the `weaponLists` and `weapons`
 * layers on this client only and put the very same documents back in a
 * `finally`. Machine values arrive through ./_env.mjs.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const MARKERS = {
  axe: "equipment/rows-core-axe",
  legacy: "equipment/rows-legacy",
  trained: "equipment/rows-trained",
  holy: "equipment/rows-holy",
};

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};
const notReached = [];
const skip = (label, why) => {
  notReached.push(label);
  console.log(`SKIP  ${label}  ${why}`);
};

/** Records a page's throws from before its first script: the only way to see init, setup and ready. */
const RECORDER = `(() => {
  const R = (globalThis.__wrBoot = { phase: "load", phases: [], errors: [] });
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

const NAMES = { unplaced: "QA Rows Unplaced Thing" };

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in a seat's page.  */
/* ------------------------------------------------------------------ */
const P = {
  install: async () => {
    const H = (globalThis.__wr = globalThis.__wr ?? {});
    const base = "/modules/acks-extras/scripts/";
    H.W = await import(`${base}lib/weapons.mjs`);
    H.T = await import(`${base}lib/tables.mjs`);
    H.SRC = await import(`${base}equipment/weapon-source.mjs`);
    H.PR = await import(`${base}equipment/profiles.mjs`);
    await (await import(`${base}equipment/weapon-rows.mjs`)).rowsReady();
    H.PF = await import(`${base}equipment/proficiency.mjs`);
    H.AB = await import(`${base}equipment/abilities-bridge.mjs`);
    H.FIG = await import(`${base}equipment/weapon-figures.mjs`);
    H.CONST = await import(`${base}equipment/constants.mjs`);
    H.API = await import(`${base}equipment/api.mjs`);
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 40, every = 150 } = {}) => {
      for (let n = 0; n < tries; n++) {
        const v = await fn();
        if (v) return v;
        await H.sleep(every);
      }
      return null;
    };
    H.root = (app) => (app?.element?.nodeType === 1 ? app.element : app?.element?.[0]) ?? null;
    H.text = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    H.opened = H.opened ?? [];
    H.closeAll = async () => {
      let n = 0;
      for (const app of H.opened) { try { await app.close({ force: true }); n++; } catch { /* already closed */ } }
      H.opened = [];
      return n;
    };
    if (!H.patched) {
      H.patched = true;
      H.errors = [];
      H.consoleError = console.error;
      console.error = (...args) => { H.errors.push(args.map((a) => a?.message ?? String(a)).join(" ").slice(0, 300)); H.consoleError(...args); };
    }
    /** What a classifier answer looks like, as booleans and enum words only. */
    H.shape = (item) => {
      const p = H.PR.classifyWeapon(item);
      return { key: p.key ?? null, cat: p.cat ?? null, size: p.size ?? null, type: p.type || null, thrown: !!p.thrown, handy: !!p.handy, anyone: !!p.anyoneThrows, light: (p.special ?? []).includes("light"), splash: (p.special ?? []).includes("splash"), die: !!p.damage };
    };
    /** Open a fresh item sheet and read the class row: its tooltip and its words. */
    H.openClassRow = async (actorId, itemId) => {
      const item = game.actors.get(actorId)?.items.get(itemId);
      if (!item) return { rendered: false };
      try { await item.sheet.close(); } catch { /* not open */ }
      await item.sheet.render(true);
      H.opened.push(item.sheet);
      const loc = (k) => game.i18n.localize(k);
      const rows = () => [...(H.root(item.sheet)?.querySelectorAll(".acks-extras-item-sheet__props .acks-extras-item-sheet__prop") ?? [])]
        .filter((p) => H.text(p.querySelector(".acks-extras-item-sheet__prop-label")) === loc("ACKS-EQUIPMENT.props.weaponClass"));
      let found = await H.poll(() => rows()[0]);
      if (!found) {
        try { item.sheet.changeTab?.("details", "primary"); } catch { /* the tab is not offered */ }
        found = await H.poll(() => rows()[0]);
      }
      await H.sleep(300);
      const row = rows()[0] ?? null;
      if (!row) return { rendered: !!H.root(item.sheet), panel: false };
      const identity = H.PR.weaponIdentity(item);
      const state = H.FIG.figureState({ key: identity.key, field: "cat", declared: item.getFlag("acks-extras", H.CONST.ITEM_FLAGS.CATEGORY) ?? null });
      const expected = H.FIG.figureTip(state, loc("ACKS-EQUIPMENT.props.weaponClass"));
      return {
        rendered: true,
        panel: true,
        one: rows().length === 1,
        state: state.state,
        tipIsFigureTip: row.dataset.tooltipText === expected,
        tipOnRowNotSelect: !!row.dataset.tooltipText && !row.querySelector("select")?.dataset.tooltipText,
        saysNotImported: H.text(row).includes(loc("ACKS-EQUIPMENT.printed.notImported")),
        showsClassWords: (cat) => cat != null && H.text(row).includes(loc(`ACKS-LIB.weaponCat.${cat}`)),
        rowText: H.text(row),
      };
    };
    return { isGM: game.user.isGM, role: game.user.role, activeGMIsSelf: !!game.users.activeGM?.isSelf, boot: globalThis.__wrBoot ?? null };
  },
  userId: async ({ name }) => game.users.find((u) => u.name === name)?.id ?? null,

  /** Which weapons the world's rows offer the walk, as keys and enum words; names stay on the page. */
  census: async () => {
    const H = globalThis.__wr;
    const grid = H.T.hasDoc(H.SRC.WEAPONS_DOC) ? (H.T.getDoc(H.SRC.WEAPONS_DOC).tables?.[H.SRC.WEAPONS_TABLE] ?? null) : null;
    const gridKeys = grid ? Object.keys(grid) : [];
    const keys = H.W.weaponKeys();
    const rows = keys.map((k) => [k, H.W.weaponRow(k)]);
    const lists = H.W.weaponLists();
    const placed = rows.filter(([k, r]) => r?.name && r?.cat && H.W.keyForName(r.name) === k);
    const first = placed[0] ?? null;
    const other = first ? placed.find(([, r]) => r.cat !== first[1].cat) ?? null : null;
    H.pick = { axe: first?.[0] ?? null, other: other?.[0] ?? null };
    H.pickNames = { axe: first?.[1].name ?? null, other: other?.[1].name ?? null };
    const thr = (kind) => keys.find((k) => H.W.weaponRow(k)?.throwable?.kind === kind) ?? null;
    H.pick.holy = thr("holyWater");
    H.pick.torch = thr("torch");
    return {
      hasRows: H.W.hasWeaponRows(),
      gridRows: gridKeys.length,
      keys: keys.length,
      everyGridRowNamed: gridKeys.every((k) => !!H.W.weaponRow(k)?.name),
      listsImported: !!lists,
      listTables: lists ? Object.keys(lists).sort() : [],
      placedByClass: rows.filter(([, r]) => r?.cat).length,
      kindRows: rows.filter(([, r]) => r?.kind).length,
      withFocus: keys.filter((k) => H.W.weaponFocusGroup(k)).length,
      pickedAxe: !!first,
      pickedOther: !!other,
      pickedHoly: !!H.pick.holy,
      pickedTorch: !!H.pick.torch,
      names: H.pickNames,
    };
  },

  /**
   * Bring the four kept fixtures to their shapes: each weapon item named for
   * the row it stands for, the legacy item bare of stamps, the trained actor
   * on its one-class list and owned by the player.
   */
  shapeAll: async ({ ids, playerId, names }) => {
    const H = globalThis.__wr;
    const wrote = [];
    const named = async (actorId, name) => {
      const actor = game.actors.get(actorId);
      const item = actor?.items.find((i) => i.type === "weapon" && i.name === name) ?? actor?.items.find((i) => i.type === "weapon") ?? null;
      if (!item) return null;
      if (item.name !== name) { await item.update({ name }); wrote.push("rename"); }
      return item;
    };
    const axe = await named(ids.axe, names.axe);
    const legacy = await named(ids.legacy, names.axe);
    const stamps = [H.CONST.ITEM_FLAGS.SIZE, H.CONST.ITEM_FLAGS.DAMAGE_TYPE, H.CONST.ITEM_FLAGS.THROWN, H.CONST.ITEM_FLAGS.HANDY, H.CONST.ITEM_FLAGS.PROFILE_KEY, H.CONST.ITEM_FLAGS.CATEGORY];
    for (const item of [axe, legacy]) {
      const dirty = stamps.filter((f) => item?.getFlag("acks-extras", f) != null);
      if (dirty.length) {
        await item.update(Object.fromEntries(dirty.map((f) => [`flags.acks-extras.${f}`, new foundry.data.operators.ForcedDeletion()])));
        wrote.push("stamps");
      }
    }
    const trained = game.actors.get(ids.trained);
    const tAxe = await named(ids.trained, names.axe);
    let tOther = trained?.items.find((i) => i.type === "weapon" && i.name === names.other) ?? null;
    let tUnplaced = trained?.items.find((i) => i.type === "weapon" && i.name === names.unplaced) ?? null;
    if (trained && !tOther) { tOther = (await trained.createEmbeddedDocuments("Item", [{ name: names.other, type: "weapon", system: { melee: true } }]))[0]; wrote.push("other"); }
    if (trained && !tUnplaced) { tUnplaced = (await trained.createEmbeddedDocuments("Item", [{ name: names.unplaced, type: "weapon", system: { melee: true } }]))[0]; wrote.push("unplaced"); }
    const cat = H.W.weaponRow(H.pick.axe)?.cat ?? null;
    if (trained && cat && trained.getFlag("acks-extras", H.CONST.ACTOR_FLAGS.WEAPON_PROF) !== cat) { await trained.setFlag("acks-extras", H.CONST.ACTOR_FLAGS.WEAPON_PROF, cat); wrote.push("list"); }
    if (trained && (trained.ownership?.[playerId] ?? 0) < 3) { await trained.update({ [`ownership.${playerId}`]: 3 }); wrote.push("ownership"); }
    const holy = game.actors.get(ids.holy);
    for (const [name, kind] of [["Holy Water", "holy"], ["Torch", "torch"]]) {
      if (holy && !holy.items.find((i) => i.name === name)) { await holy.createEmbeddedDocuments("Item", [{ name, type: "weapon", system: { melee: kind === "torch" } }]); wrote.push(kind); }
    }
    return {
      ok: !!(axe && legacy && tAxe && tOther && tUnplaced && trained && holy),
      wrote,
      itemIds: { axe: axe?.id, legacy: legacy?.id, tAxe: tAxe?.id, tOther: tOther?.id, tUnplaced: tUnplaced?.id },
      holyIds: { holy: holy?.items.find((i) => i.name === "Holy Water")?.id ?? null, torch: holy?.items.find((i) => i.name === "Torch")?.id ?? null },
    };
  },

  /** Step 3: the placed weapon reads its class and size from the imported row, on the sheet too. */
  coreAxe: async ({ actorId, itemId }) => {
    const H = globalThis.__wr;
    const item = game.actors.get(actorId).items.get(itemId);
    const row = H.W.weaponRow(H.pick.axe);
    const shape = H.shape(item);
    const sheet = await H.openClassRow(actorId, itemId);
    await H.closeAll();
    return {
      keyIsTheRow: shape.key === H.pick.axe,
      catIsTheRow: shape.cat === row.cat,
      sizeIsTheRow: shape.size === (row.size ?? null),
      sheet: { rendered: sheet.rendered, panel: sheet.panel, one: sheet.one, state: sheet.state, tipIsFigureTip: sheet.tipIsFigureTip, tipOnRowNotSelect: sheet.tipOnRowNotSelect, saysNotImported: sheet.saysNotImported, showsClassWords: sheet.showsClassWords?.(row.cat) ?? false },
    };
  },

  /** Step 4: stamps outrank a row, come off, and Annotate writes the identity alone. */
  legacy: async ({ actorId, itemId, transientUuid }) => {
    const H = globalThis.__wr;
    const F = H.CONST.ITEM_FLAGS;
    const item = game.actors.get(actorId).items.get(itemId);
    const row = H.W.weaponRow(H.pick.axe);
    const before = H.shape(item);
    const stampSize = row.size === "large" ? "tiny" : "large";
    await item.update({
      [`flags.acks-extras.${F.PROFILE_KEY}`]: H.pick.axe,
      [`flags.acks-extras.${F.SIZE}`]: stampSize,
      [`flags.acks-extras.${F.DAMAGE_TYPE}`]: "qa-stamped",
      [`flags.acks-extras.${F.THROWN}`]: true,
      [`flags.acks-extras.${F.HANDY}`]: true,
    });
    const stamped = H.shape(item);
    await item.update(Object.fromEntries([F.SIZE, F.DAMAGE_TYPE, F.THROWN, F.HANDY, F.PROFILE_KEY].map((f) => [`flags.acks-extras.${f}`, new foundry.data.operators.ForcedDeletion()])));
    const cleared = H.shape(item);
    const fresh = await fromUuid(transientUuid);
    const wrote = await H.API.annotateItem(fresh);
    const flags = fresh.flags?.["acks-extras"] ?? {};
    return {
      beforeIsTheRow: before.size === (row.size ?? null),
      stampedOutranks: stamped.size === stampSize && stamped.type === "qa-stamped" && stamped.thrown === true && stamped.handy === true && stamped.key === H.pick.axe,
      clearedIsTheRow: cleared.size === before.size && cleared.type === before.type && cleared.thrown === before.thrown && cleared.handy === before.handy,
      annotatedKeyIsTheRow: wrote === H.pick.axe && flags[F.PROFILE_KEY] === H.pick.axe,
      annotateStampedNoFigure: [F.SIZE, F.DAMAGE_TYPE, F.THROWN, F.HANDY].every((f) => flags[f] == null),
    };
  },

  /** Step 5: grants against imported classes, undecided never refused, picks placed by the imported lists. */
  trained: async ({ actorId, ids }) => {
    const H = globalThis.__wr;
    const actor = game.actors.get(actorId);
    const profile = (id) => H.PR.classifyWeapon(actor.items.get(id));
    const pa = profile(ids.tAxe);
    const po = profile(ids.tOther);
    const pu = profile(ids.tUnplaced);
    const lists = H.W.weaponLists();
    const catKey = H.W.weaponRow(H.pick.axe).cat;
    const noun = lists?.category?.[catKey]?.[0] ?? null;
    const focusKey = lists?.focus ? Object.keys(lists.focus)[0] ?? null : null;
    const focusNoun = focusKey ? lists.focus[focusKey]?.[0] ?? null : null;
    const enforced = H.PF.enforcementActive?.() ?? true;
    return {
      enforcementOn: !!enforced,
      listIsOneClass: actor.getFlag("acks-extras", H.CONST.ACTOR_FLAGS.WEAPON_PROF) === catKey,
      listedWeaponProficient: H.PF.isWeaponProficient(actor, pa) === true && H.PF.weaponProficiencyDecided(actor, pa) === true,
      otherClassRefused: H.PF.weaponProficiencyDecided(actor, po) === true && H.PF.isWeaponProficient(actor, po) === false,
      otherClassDecided: po.cat != null && po.cat !== pa.cat,
      unplacedHasNoClass: pu.cat === null && pu.key === null,
      unplacedIsUndecidedNotRefused: H.PF.isWeaponProficient(actor, pu) === true && H.PF.weaponProficiencyDecided(actor, pu) === false,
      pickByNounIsTheClass: noun != null && H.AB.resolveWeaponGroupPick(noun) === String(catKey).toLowerCase(),
      focusByNounIsTheFocus: focusKey != null && H.AB.resolveFocusPick(focusNoun) === focusKey,
      focusNounNamed: !!focusNoun,
    };
  },

  /** Step 6: the throwables kinds throw as anyone, and a torch is a light. */
  holy: async ({ actorId, holyIds }) => {
    const H = globalThis.__wr;
    const actor = game.actors.get(actorId);
    const hw = H.shape(actor.items.get(holyIds.holy));
    const tc = H.shape(actor.items.get(holyIds.torch));
    const eh = H.PR.equipmentClass("Holy Water");
    const et = H.PR.equipmentClass("Torch");
    const rowH = H.W.weaponRow(H.pick.holy);
    const rowT = H.W.weaponRow(H.pick.torch);
    return {
      holyIsTheKindRow: hw.key === H.pick.holy && hw.anyone && hw.splash,
      torchIsTheKindRow: tc.key === H.pick.torch && tc.anyone && tc.light,
      holyDieIsTheImportedDie: !!eh && eh.damage === (rowH?.damage ?? "") && !!eh.splash && !!eh.consumable,
      torchReadiesFromItsRow: !!et && et.damage === (rowT?.damage ?? "") && !!et.light && !!et.melee && !!et.thrown,
      holyTypeFromTheLists: (rowH?.type ?? null) === (H.W.weaponLists()?.throwables?.holyWater?.types?.[0] ?? null),
    };
  },

  /**
   * Step 7, client-local: the lists layers go, then the grid layers, each put
   * back as the very same document in a finally. The registry is per client, so
   * nothing here reaches the world or another seat.
   */
  absent: async ({ actorId, itemId }) => {
    const H = globalThis.__wr;
    const { PRIORITY, getLayer, registerTable, unregisterTable } = H.T;
    const layersOf = (id) => Object.values(PRIORITY).map((p) => [p, getLayer(id, p)]).filter(([, d]) => d);
    const before = { keys: H.W.weaponKeys().length, firstKey: H.W.weaponKeys()[0], firstRow: JSON.stringify(H.W.weaponRow(H.W.weaponKeys()[0])) };
    const rowCat = H.W.weaponRow(H.pick.axe).cat;
    const out = {};
    const take = (id) => { const held = layersOf(id); for (const [p] of held) unregisterTable(id, { priority: p }); return held; };
    const give = (id, held) => { for (const [p, doc] of held) registerTable(doc, { priority: p }); };
    const lists = take(H.W.WEAPON_LISTS_DOC);
    H.heldLists = lists;
    try {
      const item = game.actors.get(actorId).items.get(itemId);
      const shape = H.shape(item);
      const sheet = await H.openClassRow(actorId, itemId);
      await H.closeAll();
      out.noLists = {
        layersHeld: lists.length,
        listsGone: H.W.weaponLists() === null,
        rowsStay: H.W.hasWeaponRows() && Object.keys(H.T.getDoc(H.SRC.WEAPONS_DOC).tables[H.SRC.WEAPONS_TABLE]).every((k) => !!H.W.weaponRow(k)),
        classNotImported: shape.cat === null,
        keyStays: shape.key === H.pick.axe,
        listedKindNull: H.W.listedKind("category", "anything") === null,
        focusPickNull: H.AB.resolveFocusPick("anything") === null,
        sheetSaysNotImported: sheet.saysNotImported && sheet.state === "missing",
      };
    } finally {
      give(H.W.WEAPON_LISTS_DOC, lists);
      H.heldLists = null;
    }
    out.listsBack = { lists: H.W.weaponLists() !== null, classIsTheRowAgain: H.shape(game.actors.get(actorId).items.get(itemId)).cat === rowCat };

    const grid = take(H.SRC.WEAPONS_DOC);
    H.heldGrid = grid;
    try {
      const item = game.actors.get(actorId).items.get(itemId);
      const shape = H.shape(item);
      out.noGrid = {
        layersHeld: grid.length,
        noRows: H.W.hasWeaponRows() === false && H.W.weaponKeys().length === 0,
        noKey: shape.key === null && shape.cat === null && shape.size === null,
        unitsEmpty: (await import("/modules/acks-extras/scripts/equipment/training-view.mjs")).weaponUnits().length === 0,
      };
    } finally {
      give(H.SRC.WEAPONS_DOC, grid);
      H.heldGrid = null;
    }
    out.back = {
      keys: H.W.weaponKeys().length === before.keys,
      firstRowSame: JSON.stringify(H.W.weaponRow(before.firstKey)) === before.firstRow,
      classIsTheRowAgain: H.shape(game.actors.get(actorId).items.get(itemId)).cat === rowCat,
    };
    return out;
  },
  /** Put the layers back if the walk died inside the absent step; a no-op after its own finally. */
  restoreLayers: async () => {
    const H = globalThis.__wr;
    if (!H) return "never installed";
    const done = [];
    for (const [name, id] of [["heldLists", H.W.WEAPON_LISTS_DOC], ["heldGrid", H.SRC.WEAPONS_DOC]]) {
      if (H[name]) { for (const [p, doc] of H[name]) H.T.registerTable(doc, { priority: p }); H[name] = null; done.push(id); }
    }
    return done.length ? `put back: ${done.join(", ")}` : "nothing was left out";
  },

  /** Step 8: what a seat sees of the rows and of the trained actor's weapons. */
  seatView: async ({ actorId, ids }) => {
    const H = globalThis.__wr;
    const actor = game.actors.get(actorId);
    return {
      visible: !!actor,
      keys: H.W.weaponKeys().length,
      hasRows: H.W.hasWeaponRows(),
      listsImported: !!H.W.weaponLists(),
      axe: actor ? H.shape(actor.items.get(ids.tAxe)) : null,
      other: actor ? H.shape(actor.items.get(ids.tOther)) : null,
    };
  },

  closeAll: async () => globalThis.__wr?.closeAll?.() ?? 0,
  drain: async () => ({ errors: globalThis.__wr.errors.slice() }),
  restore: async () => {
    const H = globalThis.__wr;
    if (!H?.patched) return "never installed";
    console.error = H.consoleError;
    H.patched = false;
    return "restored";
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
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.equipment`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}
/** A CDP session on the seat's page, for the boot recorder. */
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
/** The recorder has to be in the page before it loads, so it goes in over the seat's own CDP target. */
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

let gm = null;
let player = null;
let layersMaybeOut = false;
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
  check("the GM seat is the active GM and the player seat is a player", installed.isGM && installed.activeGMIsSelf && !seated.isGM && seated.role <= 2, { gm: installed.role, player: seated.role });

  section("1. boot: init, setup and ready, on both seats");
  for (const [key, c] of Object.entries({ gm: installed, player: seated })) {
    const phases = c.boot?.phases ?? [];
    const errors = c.boot?.errors ?? [];
    const naming = errors.filter((e) => /equipment|weapon|rowsReady|weaponLists/i.test(e.text));
    note(`${key}: errors recorded from load through ready (any text)`, errors.length);
    check(`${key}: init, setup and ready ran and no error names equipment, the weapon seam or its lists`, ["init", "setup", "ready"].every((p) => phases.includes(p)) && naming.length === 0, { phases, naming: naming.length });
  }

  section("2. the rows are the import's");
  const census = await run(gm, P.census);
  note("census", { ...census, names: undefined });
  check("the registry holds an imported weapons grid and the seam answers a row for every one of its rows", census.hasRows && census.gridRows > 0 && census.keys >= census.gridRows && census.everyGridRowNamed, { grid: census.gridRows, keys: census.keys });
  if (!census.listsImported) skip("the lists place rows on classes", "the weaponLists document is not imported in this world: import the RR and JJ weapon lists and run again");
  check("the imported lists place rows on a class, and on a Weapon Focus", census.listsImported && census.placedByClass > 0 && census.withFocus > 0, { lists: census.listTables, byClass: census.placedByClass, withFocus: census.withFocus });
  if (!census.pickedAxe || !census.pickedOther) throw new Error(`the world's rows do not offer two named, placed weapons of different classes: ${JSON.stringify({ axe: census.pickedAxe, other: census.pickedOther })}`);
  const names = census.names;

  section("fixtures");
  const playerId = await run(gm, P.userId, { name: MACHINE.player });
  const ids = {};
  for (const [slot, marker, actorName, items, ownership] of [
    ["axe", MARKERS.axe, "QA Rows Core Axe", [{ name: names.axe, type: "weapon", system: { melee: true } }], { default: 0 }],
    ["legacy", MARKERS.legacy, "QA Rows Legacy", [{ name: names.axe, type: "weapon", system: { melee: true } }], { default: 0 }],
    ["trained", MARKERS.trained, "QA Rows Trained", [{ name: names.axe, type: "weapon", system: { melee: true } }], { default: 0, [playerId]: 3 }],
    ["holy", MARKERS.holy, "QA Rows Holy", [], { default: 0 }],
  ]) {
    const fx = await gm.fixture(marker, "Actor", { name: actorName, type: "character", prototypeToken: { actorLink: true }, ownership, items });
    ids[slot] = fx.id;
  }
  const shaped = await run(gm, P.shapeAll, { ids, playerId, names: { ...names, unplaced: NAMES.unplaced } });
  check("the four kept fixtures are at their shape: named weapons, no stamps, the one-class list, the player's ownership", shaped.ok, { ok: shaped.ok, wrote: shaped.wrote });
  if (!shaped.ok) throw new Error(`fixture shape: ${JSON.stringify(shaped)}`);
  await sleep(500);

  section("3. a placed weapon reads its class and size from the row");
  const a = await run(gm, P.coreAxe, { actorId: ids.axe, itemId: shaped.itemIds.axe });
  check("a weapon named for an imported row is that row, with its class and its size", a.keyIsTheRow && a.catIsTheRow && a.sizeIsTheRow, a);
  check("its item sheet's class row shows the class, with the row's tooltip on the row and not on the select", a.sheet.rendered && a.sheet.panel && a.sheet.one && a.sheet.state === "row" && a.sheet.tipIsFigureTip && a.sheet.tipOnRowNotSelect && a.sheet.showsClassWords && !a.sheet.saysNotImported, a.sheet);

  section("4. stamps outrank a row, then come off; Annotate writes the identity alone");
  const transient = await gm.create("Item", { name: names.axe, type: "weapon", system: { melee: true } }, { parent: `Actor.${ids.axe}` });
  const l = await run(gm, P.legacy, { actorId: ids.legacy, itemId: shaped.itemIds.legacy, transientUuid: transient.uuid }).catch(async (err) => { console.error("legacy step:", err?.message ?? err); return {}; });
  check("before any stamp the item reads the row's size", l.beforeIsTheRow === true);
  check("an old Annotate's stamps outrank the row: size, damage type, thrown, handy", l.stampedOutranks === true);
  check("with the stamps taken off the item reads the row again", l.clearedIsTheRow === true);
  check("Annotate on a fresh item writes the profile key and no size, damage type, thrown or handy", l.annotatedKeyIsTheRow === true && l.annotateStampedNoFigure === true, l);
  { const swept = await gm.sweepTracked({ only: [transient.uuid] }); note("sweep of the annotate item", { removed: swept.removed.map((r) => r.uuid), missing: swept.missing, failed: swept.failed }); }

  section("5. grants against imported classes; undecided is not refused");
  const t = await run(gm, P.trained, { actorId: ids.trained, ids: shaped.itemIds });
  check("the actor's list is the one class and its listed weapon is proficient and decided", t.listIsOneClass && t.listedWeaponProficient, t);
  check("a weapon of another imported class is decided", t.otherClassDecided, t);
  if (t.enforcementOn) check("and refused, since the list does not cover it", t.otherClassRefused, t);
  else skip("a weapon of another class is refused", "proficiency enforcement is off in this world");
  check("a weapon no row names has no class, and is proficient and undecided, never refused", t.unplacedHasNoClass && t.unplacedIsUndecidedNotRefused, t);
  check("a Martial Training pick worded as the imported category's own noun resolves to that class", t.pickByNounIsTheClass, t);
  if (t.focusNounNamed) check("a Weapon Focus pick worded as an imported focus's noun resolves to that focus", t.focusByNounIsTheFocus, t);
  else skip("a Weapon Focus pick resolves to its focus", "the imported focus list names no noun");

  section("6. the throwables kinds");
  if (census.pickedHoly && census.pickedTorch) {
    const h = await run(gm, P.holy, { actorId: ids.holy, holyIds: shaped.holyIds });
    check("holy water and a torch are the lists' kind rows and throw as anyone; the torch is a light", h.holyIsTheKindRow && h.torchIsTheKindRow, h);
    check("holy water's and the torch's readied figures are the imported ones", h.holyDieIsTheImportedDie && h.torchReadiesFromItsRow && h.holyTypeFromTheLists, h);
  } else {
    skip("holy water and the torch are the lists' kind rows", `throwables not imported in this world: ${JSON.stringify({ holy: census.pickedHoly, torch: census.pickedTorch })}`);
  }

  section("7. the absent cases, on this client only");
  layersMaybeOut = true;
  const ab = await run(gm, P.absent, { actorId: ids.axe, itemId: shaped.itemIds.axe });
  layersMaybeOut = false;
  check("with the lists unregistered the rows stay and the class is not imported: no class, the key kept, no pick placed", ab.noLists.layersHeld > 0 && ab.noLists.listsGone && ab.noLists.rowsStay && ab.noLists.classNotImported && ab.noLists.keyStays && ab.noLists.listedKindNull && ab.noLists.focusPickNull, ab.noLists);
  check("the item sheet says so: its class row reads not imported and carries the missing-figure tooltip", ab.noLists.sheetSaysNotImported, ab.noLists);
  check("registering the lists again gives the class back", ab.listsBack.lists && ab.listsBack.classIsTheRowAgain, ab.listsBack);
  check("with the grid unregistered no weapon has a row, a key, a class or a size, and the training units are empty", ab.noGrid.layersHeld > 0 && ab.noGrid.noRows && ab.noGrid.noKey && ab.noGrid.unitsEmpty, ab.noGrid);
  check("registering the grid again restores the same keys and the same first row", ab.back.keys && ab.back.firstRowSame && ab.back.classIsTheRowAgain, ab.back);

  section("8. the Player seat reads the same rows");
  const g = await run(gm, P.seatView, { actorId: ids.trained, ids: shaped.itemIds });
  const pl = await run(player, P.seatView, { actorId: ids.trained, ids: shaped.itemIds });
  check("the Player seat holds the same number of rows as the GM seat, and the lists", pl.hasRows && pl.keys === g.keys && pl.listsImported === g.listsImported, { gm: g.keys, player: pl.keys });
  check("the Player seat sees the owned actor and classifies its two placed weapons as the GM seat does", pl.visible && JSON.stringify(pl.axe) === JSON.stringify(g.axe) && JSON.stringify(pl.other) === JSON.stringify(g.other), { sameAxe: JSON.stringify(pl.axe) === JSON.stringify(g.axe), sameOther: JSON.stringify(pl.other) === JSON.stringify(g.other) });

  section("9. console");
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
    try { note("registry layers", await run(gm, P.restoreLayers)); } catch (err) { console.error("restoreLayers:", err?.message ?? err); }
    try { await run(gm, P.closeAll); } catch {}
    try { note("restored", await run(gm, P.restore)); } catch (err) { console.error("restore:", err?.message ?? err); }
  }
  if (player) {
    try { await run(player, P.closeAll); } catch {}
    try { note("restored (player)", await run(player, P.restore)); } catch (err) { console.error("restore:", err?.message ?? err); }
  }
  if (layersMaybeOut) checks.push(["the absent step ended with its layers put back", false]);
  for (const marker of Object.values(MARKERS)) console.log(`fixture kept: ${marker}`);
  // The kept fixtures stay; the annotate item was swept by uuid in step 4. This sweep names nothing.
  try { if (gm) note("sweep", await gm.sweepTracked({ only: [] })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  try { if (player) await player.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  for (const label of notReached) console.log(`SKIP  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed, ${notReached.length} not reached`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
