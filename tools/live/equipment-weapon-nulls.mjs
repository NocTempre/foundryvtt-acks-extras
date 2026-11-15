/**
 * Live walk, equipment-weapon-nulls: every weapon reader answers when the
 * weapon table holds no rows. Walks docs/equipment/TESTING.md "Weapon rows not
 * imported" on the GM seat, and on the Player seat where it is cheap: the boot
 * recorder sees no error naming equipment, the weapon seam or `rowsReady`; with
 * the imported rows registered a weapon's item sheet reads each figure from its
 * row (the tooltip rides the row, not the disabled select) and says nothing
 * about an import, and a container that states a capacity says so on the
 * character sheet's gear row; then, for the walk's duration only, an empty
 * source is registered through the seam, a fresh item sheet and a fresh
 * character sheet render, and what the rows would have spoken is blank, with
 * no tooltip and no wording about an import. The default source is put back in a `finally` and the
 * restore is asserted both by identity and by a re-render. Machine values
 * arrive through ./_env.mjs.
 *
 * Fixture, kept and found by marker: `equipment/weapon-nulls-actor`, a
 * character the Player seat owns, carrying an invented melee weapon (its type
 * declared by the walk's shape step, to a row of the imported rows, one that states
 * a class and a size), a container that states a capacity, a container that
 * only declares it holds gear, and a one-token weapon-proficiency list. Each
 * run brings that shape back before its first check. The walk writes no other
 * document; its sweep is empty by design and is printed. Every figure printed
 * is a boolean or a count; no weapon's name leaves the page.
 */
import { connect, sleep } from "./_driver.mjs";
import { walkDone } from "./_walk.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const MARKER = "equipment/weapon-nulls-actor";

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/** Records a page's throws from before its first script: the only way to see init, setup and ready. */
const RECORDER = `(() => {
  const R = (globalThis.__wnBoot = { phase: "load", phases: [], errors: [] });
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

const NAMES = { weapon: "QA Nulls Blade", pack: "QA Nulls Pack", satchel: "QA Nulls Satchel" };

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in a seat's page.  */
/* ------------------------------------------------------------------ */
const P = {
  install: async () => {
    const H = (globalThis.__wn = globalThis.__wn ?? {});
    H.W = await import("/modules/acks-extras/scripts/lib/weapons.mjs");
    H.FIG = await import("/modules/acks-extras/scripts/equipment/weapon-figures.mjs");
    H.ACT = await import("/modules/acks-extras/scripts/equipment/actions.mjs");
    H.CONST = await import("/modules/acks-extras/scripts/equipment/constants.mjs");
    H.PR = await import("/modules/acks-extras/scripts/equipment/profiles.mjs");
    await (await import("/modules/acks-extras/scripts/equipment/weapon-rows.mjs")).rowsReady();
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
    if (!H.base) {
      const key0 = H.W.weaponKeys()[0] ?? null;
      H.base = { keys: H.W.weaponKeys().length, key0, row0: key0 ? H.W.weaponRow(key0) : null };
    }
    if (!H.patched) {
      H.patched = true;
      H.errors = [];
      H.consoleError = console.error;
      console.error = (...args) => { H.errors.push(args.map((a) => a?.message ?? String(a)).join(" ").slice(0, 300)); H.consoleError(...args); };
    }
    /** What the tooltip on a row is, as one of the three things the module writes; a figure nothing states has none. */
    H.kindOf = (tip, label, state) => {
      const f = (k, extra = {}) => game.i18n.format(`ACKS-EQUIPMENT.props.${k}`, { figure: label, ...extra });
      if (!tip) return "none";
      if (tip === f("figureDeclared")) return "declared";
      if (state?.state === "row" && (tip === f("figureFromRow", state) || tip === f("figureFromRowNoPage", state))) return "row";
      return "other";
    };
    /** Open a fresh item sheet and read the construction panel and the Rolls tab as booleans. */
    H.openItem = async (actorId, itemId) => {
      const item = game.actors.get(actorId)?.items.get(itemId);
      if (!item) return { rendered: false };
      try { await item.sheet.close(); } catch { /* not open */ }
      await item.sheet.render(true);
      H.opened.push(item.sheet);
      const prop = () => H.root(item.sheet)?.querySelector(".acks-extras-item-sheet__props .acks-extras-item-sheet__prop");
      let found = await H.poll(prop);
      if (!found) {
        try { item.sheet.changeTab?.("details", "primary"); } catch { /* the tab is not offered */ }
        found = await H.poll(prop);
      }
      await H.sleep(400);
      const root = H.root(item.sheet);
      if (!root || !found) return { rendered: !!root, panel: false };
      const loc = (k) => game.i18n.localize(k);
      const props = [...root.querySelectorAll(".acks-extras-item-sheet__props .acks-extras-item-sheet__prop")];
      const rowOf = (labelKey) => props.filter((p) => H.text(p.querySelector(".acks-extras-item-sheet__prop-label")) === loc(labelKey));
      const identity = H.PR.weaponIdentity(item);
      const profile = H.PR.classifyWeapon(item);
      const flags = (k) => item.getFlag("acks-extras", k);
      const figures = {
        type: { rows: rowOf("ACKS-EQUIPMENT.props.weaponType"), label: "ACKS-EQUIPMENT.props.weaponType", field: null, declared: identity.source === "flag" ? identity.key : null },
        cls: { rows: rowOf("ACKS-EQUIPMENT.props.weaponClass"), label: "ACKS-EQUIPMENT.props.weaponClass", field: "cat", declared: flags(H.CONST.ITEM_FLAGS.CATEGORY) ?? null },
        size: { rows: rowOf("ACKS-EQUIPMENT.props.weaponSize"), label: "ACKS-EQUIPMENT.props.weaponSize", field: "size", declared: flags(H.CONST.ITEM_FLAGS.SIZE) ?? null },
        grips: { rows: rowOf("ACKS-EQUIPMENT.props.grips"), label: "ACKS-EQUIPMENT.props.grips", field: "size", declared: profile.grips ?? null },
      };
      const kinds = {};
      const rowText = {};
      for (const [name, f] of Object.entries(figures)) {
        const row = f.rows[0] ?? null;
        const state = H.FIG.figureState({ key: identity.key, field: f.field, declared: f.declared });
        kinds[name] = row ? { one: f.rows.length === 1, kind: H.kindOf(row.dataset.tooltipText, loc(f.label), state), onRow: !!row.dataset.tooltipText, selectTip: !!row.querySelector("select")?.dataset.tooltipText } : null;
        rowText[name] = H.text(row);
      }
      const autoWord = loc("ACKS-EQUIPMENT.props.auto");
      // The "Auto" option of a select, as printed: with no table answer it is the bare word, with one it carries a guess.
      const autoOption = (row) => H.text(row?.querySelector("select option[value='auto']") ?? null);
      const notes = [...root.querySelectorAll(".acks-extras-item-sheet__props .acks-extras-item-sheet__prop-note")].map((n) => H.text(n));
      const noSizeNotes = ["1h", "2h", "versatile"].map((k) => game.i18n.format("ACKS-EQUIPMENT.props.gripsAutoNoSize", { grips: loc(`ACKS-EQUIPMENT.grip.${k}`) }));
      const lines = [...root.querySelectorAll(".acks-extras-item-sheet__row-line")].map((n) => H.text(n));
      // The weapon's own attack rows (roll ids atk:*); a maneuver row answers to the maneuver tables.
      const attackLines = [...root.querySelectorAll(".acks-extras-item-sheet__row")]
        .filter((r) => r.querySelector("[data-roll^='atk:']"))
        .map((r) => H.text(r.querySelector(".acks-extras-item-sheet__row-line")));
      const mods = [...root.querySelectorAll(".acks-extras-item-sheet__row-mods .acks-tag")].map((n) => H.text(n));
      const panelText = H.text(root.querySelector(".acks-extras-item-sheet__props"));
      // No surface may say a table is missing: the words a missing-import placeholder used are searched for in the panel, the lines and the tags.
      const SAYS_MISSING = /not imported|unimported|unread|no weapon table/i;
      return {
        rendered: true,
        panel: true,
        identityKey: !!identity.key,
        identitySource: identity.source,
        kinds,
        // The class and size selects' Auto option carries no guess when the row states none.
        classAutoBare: autoOption(figures.cls.rows[0]) === autoWord,
        sizeAutoBare: autoOption(figures.size.rows[0]) === autoWord,
        gripsNoSizeNote: notes.some((t) => noSizeNotes.includes(t)),
        panelSaysMissing: SAYS_MISSING.test(panelText),
        linesSayMissing: lines.filter((t) => SAYS_MISSING.test(t)).length,
        tagsSayMissing: mods.filter((t) => SAYS_MISSING.test(t)).length,
        rollRows: root.querySelectorAll(".acks-extras-item-sheet__row").length,
        rollLines: lines.length,
        attackLines: attackLines.length,
        attackLinesBlank: attackLines.filter((t) => !t).length,
        rollLinesBlank: lines.filter((t) => !t).length,
        modCount: mods.length,
      };
    };
    /** Open a fresh character sheet on its Equipment tab and read the weapon row and the container rows. */
    H.openChar = async (actorId, ids) => {
      const actor = game.actors.get(actorId);
      const app = new acksExtras.characterSheet.Sheet({ document: actor });
      H.opened.push(app);
      app.tabGroups.primary = "equipment";
      await app.render(true);
      const ready = () => { const r = H.root(app); return r?.querySelector(".acks-extras-frame__badge") ? r : null; };
      let root = await H.poll(ready);
      if (root && !root.querySelector("[data-drop='slot:mainHand']")) {
        app.changeTab("equipment", "primary");
        await H.poll(() => (H.root(app)?.querySelector("[data-drop='slot:mainHand']") ? true : null));
      }
      root = H.root(app);
      if (!root) return { rendered: false };
      await H.poll(() => root.querySelector(`.acks-extras-frame__gear[data-item-id='${ids.pack}']`));
      const loc = (k) => game.i18n.localize(k);
      const gear = (id) => root.querySelector(`.acks-extras-frame__gear[data-item-id='${id}']`);
      const head = (id) => gear(id)?.querySelector(":scope > .acks-extras-frame__gear-head .acks-extras-frame__gear-line") ?? null;
      const SAYS_MISSING = /not imported|unimported|unread/i;
      return {
        rendered: true,
        weaponRow: !!gear(ids.weapon),
        pack: { found: !!head(ids.pack), saysMissing: SAYS_MISSING.test(H.text(head(ids.pack))), tip: head(ids.pack)?.dataset.tooltipText ?? "", stated: /\/\s*\d/.test(H.text(head(ids.pack))) },
        // A container that states no capacity shows its load alone: no "/ capacity", no note, no tooltip.
        satchel: { found: !!head(ids.satchel), saysMissing: SAYS_MISSING.test(H.text(head(ids.satchel))), stated: /\/\s*\d/.test(H.text(head(ids.satchel))), tip: head(ids.satchel)?.dataset.tooltipText ?? "" },
      };
    };
    return { isGM: game.user.isGM, role: game.user.role, activeGMIsSelf: !!game.users.activeGM?.isSelf, boot: globalThis.__wnBoot ?? null, base: { keys: H.base.keys } };
  },
  userId: async ({ name }) => game.users.find((u) => u.name === name)?.id ?? null,
  /**
   * Bring the kept fixture to the shape the walk reads: the weapon's type
   * declared to a row of the imported rows, one that states a class and a size, no
   * declared class, size or grips, one weapon-proficiency token, the player's
   * ownership, and the two containers' gear records.
   */
  shape: async ({ actorId, playerId, names }) => {
    const H = globalThis.__wn;
    const actor = game.actors.get(actorId);
    const item = (n) => actor.items.find((i) => i.name === n) ?? null;
    const weapon = item(names.weapon);
    const pack = item(names.pack);
    const satchel = item(names.satchel);
    if (!weapon || !pack || !satchel) return { ok: false, found: { weapon: !!weapon, pack: !!pack, satchel: !!satchel } };
    const key = H.W.weaponKeys().find((k) => { const r = H.W.weaponRow(k); return r?.cat && r?.size; }) ?? null;
    if (!key) return { ok: false, reason: "no row states both a class and a size" };
    const wrote = [];
    if (weapon.getFlag("acks-extras", H.CONST.ITEM_FLAGS.PROFILE_KEY) !== key) { await H.ACT.setWeaponProfile(weapon, key); wrote.push("profile"); }
    for (const [flag, setter] of [[H.CONST.ITEM_FLAGS.CATEGORY, H.ACT.setWeaponCategory], [H.CONST.ITEM_FLAGS.SIZE, H.ACT.setWeaponSize], [H.CONST.ITEM_FLAGS.GRIPS, H.ACT.setWeaponGrips]]) {
      if (weapon.getFlag("acks-extras", flag) != null) { await setter(weapon, H.ACT.SLOT_AUTO); wrote.push(flag); }
    }
    if (actor.getFlag("acks-extras", H.CONST.ACTOR_FLAGS.WEAPON_PROF) !== "small") { await actor.setFlag("acks-extras", H.CONST.ACTOR_FLAGS.WEAPON_PROF, "small"); wrote.push("proficiency"); }
    if ((actor.ownership?.[playerId] ?? 0) < 3) { await actor.update({ [`ownership.${playerId}`]: 3 }); wrote.push("ownership"); }
    const gear = (i) => i.getFlag("acks-extras", "gear") ?? {};
    if (gear(pack).capacity !== 3) { await pack.setFlag("acks-extras", "gear", { capacity: 3 }); wrote.push("pack"); }
    if (gear(satchel).holds !== true || Number.isFinite(gear(satchel).capacity)) { await satchel.update({ "flags.acks-extras.gear": { holds: true, capacity: new foundry.data.operators.ForcedDeletion() } }); wrote.push("satchel"); }
    const id = H.PR.weaponIdentity(weapon);
    return {
      ok: true,
      wrote,
      ids: { weapon: weapon.id, pack: pack.id, satchel: satchel.id },
      identityIsFlag: id.source === "flag" && !!id.key,
      melee: !!weapon.system?.melee,
      rowStatesClassAndSize: !!(H.W.weaponRow(key)?.cat && H.W.weaponRow(key)?.size),
    };
  },
  item: async ({ actorId, itemId }) => globalThis.__wn.openItem(actorId, itemId),
  char: async ({ actorId, ids }) => globalThis.__wn.openChar(actorId, ids),
  closeAll: async () => globalThis.__wn.closeAll(),
  /**
   * The null path, entirely inside one try/finally: an empty source is
   * registered through the seam, a fresh item sheet and a fresh character sheet
   * render and are read, and the default source goes back whatever happened.
   */
  nullWalk: async ({ actorId, ids }) => {
    const H = globalThis.__wn;
    await H.closeAll();
    const empty = { rows: {}, aliases: {}, focusGroups: {}, throwsAsAnyone: () => false };
    let out = null;
    H.prev = H.W.registerWeaponSource(empty);
    H.nulled = true;
    try {
      const during = { hasRows: H.W.hasWeaponRows(), keys: H.W.weaponKeys().length, rowOfFirst: H.base.key0 ? H.W.weaponRow(H.base.key0) : null };
      const item = await H.openItem(actorId, ids.weapon);
      await H.closeAll();
      const char = await H.openChar(actorId, ids);
      out = { during: { hasRows: during.hasRows, keys: during.keys, rowOfFirst: during.rowOfFirst !== null }, item, char };
    } finally {
      H.W.registerWeaponSource(H.prev);
      H.nulled = false;
      try { await H.closeAll(); } catch { /* nothing open */ }
    }
    return out;
  },
  /** Put the default source back if a walk left it out; a no-op after nullWalk's own finally. */
  restoreSource: async () => {
    const H = globalThis.__wn;
    if (!H?.nulled) return "source was not left out";
    H.W.registerWeaponSource(H.prev);
    H.nulled = false;
    return "source put back";
  },
  /** Is the default source what the walk found: the same row object, the same key count. */
  sourceState: async () => {
    const H = globalThis.__wn;
    return {
      keys: H.W.weaponKeys().length === H.base.keys,
      sameFirstRow: H.base.key0 ? H.W.weaponRow(H.base.key0) === H.base.row0 : true,
      hasRows: H.W.hasWeaponRows() === (H.base.keys > 0),
      notLeftOut: !H.nulled,
    };
  },
  drain: async () => ({ errors: globalThis.__wn.errors.slice() }),
  restore: async () => {
    const H = globalThis.__wn;
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
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.equipment && !!globalThis.acksExtras?.characterSheet`); } catch { ok = false; }
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

/** The three the construction panel's undeclared figures read from a row, the weapon's type read from the item's declaration. */
const registeredItem = (key, r) => {
  check(`${key}: the weapon's item sheet renders its construction panel and its Rolls rows`, r.rendered && r.panel && r.rollRows >= 1, { rendered: r.rendered, panel: r.panel, rollRows: r.rollRows });
  check(`${key}: the weapon's type reads as set on the item, the tooltip on the row and not on the select`, r.kinds?.type?.one && r.kinds.type.kind === "declared" && r.kinds.type.onRow && !r.kinds.type.selectTip, r.kinds?.type);
  check(`${key}: class, size and grips each read from the weapon table's row (figureFromRow), the tooltip on the row`, ["cls", "size", "grips"].every((f) => r.kinds?.[f]?.one && r.kinds[f].kind === "row" && r.kinds[f].onRow && !r.kinds[f].selectTip), { cls: r.kinds?.cls?.kind, size: r.kinds?.size?.kind, grips: r.kinds?.grips?.kind });
  check(`${key}: no text of any kind where a figure is missing: the panel, the attack rows' lines and the Rolls tags say nothing about an import, and the Auto options carry their guess`, !r.gripsNoSizeNote && !r.panelSaysMissing && !r.classAutoBare && !r.sizeAutoBare && r.attackLines >= 1 && r.linesSayMissing === 0 && r.tagsSayMissing === 0, { gripsNoSizeNote: r.gripsNoSizeNote, panel: r.panelSaysMissing, classAutoBare: r.classAutoBare, sizeAutoBare: r.sizeAutoBare, attackLines: r.attackLines, lines: r.linesSayMissing, tags: r.tagsSayMissing });
  check(`${key}: every Rolls line has text`, r.rollLines >= 1 && r.rollLinesBlank === 0, { lines: r.rollLines, blank: r.rollLinesBlank });
};
const registeredChar = (key, c) => {
  check(`${key}: the character sheet's gear rows render, with the weapon's row`, c.rendered && c.weaponRow && c.pack.found && c.satchel.found, { rendered: c.rendered, weapon: c.weaponRow, pack: c.pack?.found, satchel: c.satchel?.found });
  check(`${key}: a container that states a capacity shows it, with no note about an import`, c.pack.stated && !c.pack.saysMissing && c.pack.tip === "", { stated: c.pack.stated, saysMissing: c.pack.saysMissing, tip: !!c.pack.tip });
  check(`${key}: a container that only declares it holds gear shows its load with no capacity, no note and no tooltip`, c.satchel.found && !c.satchel.stated && !c.satchel.saysMissing && c.satchel.tip === "", c.satchel);
};

let gm = null;
let player = null;
let sourceLeftOut = false;
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
  check("the imported weapon rows are registered with rows on both seats", installed.base.keys > 0 && seated.base.keys > 0, { gm: installed.base.keys, player: seated.base.keys });
  for (const [key, c] of Object.entries({ gm: installed, player: seated })) {
    const phases = c.boot?.phases ?? [];
    const errors = c.boot?.errors ?? [];
    const naming = errors.filter((e) => /equipment|weapon|rowsReady/i.test(e.text));
    note(`${key}: errors recorded from load through ready (any text)`, errors.length);
    check(`${key}: init, setup and ready ran and no error names equipment, the weapon seam or rowsReady`, ["init", "setup", "ready"].every((p) => phases.includes(p)) && naming.length === 0, { phases, naming: naming.length });
  }

  section("fixture");
  const playerId = await run(gm, P.userId, { name: MACHINE.player });
  const fixture = await gm.fixture(MARKER, "Actor", {
    name: "QA Weapon Nulls", type: "character", prototypeToken: { actorLink: true }, ownership: { default: 0, [playerId]: 3 },
    items: [
      { name: NAMES.weapon, type: "weapon", system: { melee: true, missile: false } },
      { name: NAMES.pack, type: "item", flags: { "acks-extras": { gear: { capacity: 3 } } } },
      { name: NAMES.satchel, type: "item", flags: { "acks-extras": { gear: { holds: true } } } },
    ],
  });
  const shaped = await run(gm, P.shape, { actorId: fixture.id, playerId, names: NAMES });
  check("the kept fixture is at its shape: a melee weapon typed to a row that states class and size, two containers, one proficiency token", shaped.ok && shaped.identityIsFlag && shaped.melee && shaped.rowStatesClassAndSize, { ok: shaped.ok, wrote: shaped.wrote, identityIsFlag: shaped.identityIsFlag });
  if (!shaped.ok) throw new Error(`fixture shape: ${JSON.stringify(shaped)}`);
  const ids = shaped.ids;
  const actorId = fixture.id;
  await sleep(500);
  check("the player seat sees the fixture's three items", await player.eval(`game.actors.get(${JSON.stringify(actorId)})?.items.size === 3`));

  section("1. the imported rows registered: the GM seat");
  registeredItem("gm", await run(gm, P.item, { actorId, itemId: ids.weapon }));
  registeredChar("gm", await run(gm, P.char, { actorId, ids }));
  await run(gm, P.closeAll);

  section("1b. the imported rows registered: the Player seat");
  registeredItem("player", await run(player, P.item, { actorId, itemId: ids.weapon }));
  registeredChar("player", await run(player, P.char, { actorId, ids }));
  await run(player, P.closeAll);

  section("2. the null path: an empty source registered for the walk's duration");
  sourceLeftOut = true;
  const nulled = await run(gm, P.nullWalk, { actorId, ids });
  sourceLeftOut = false;
  check("the empty source answered: no rows, no keys, no row for the table's first key", nulled.during.hasRows === false && nulled.during.keys === 0 && nulled.during.rowOfFirst === false, nulled.during);
  const n = nulled.item;
  check("the item sheet rendered under the empty source, with its construction panel and Rolls rows", n.rendered && n.panel && n.rollRows >= 1, { rendered: n.rendered, panel: n.panel, rollRows: n.rollRows });
  check("the weapon names no row now, and no note and no text anywhere in the panel says a table is missing", !n.identityKey && !n.panelSaysMissing, { identityKey: n.identityKey, panelSaysMissing: n.panelSaysMissing });
  check("the grips note names the grips alone (gripsAutoNoSize), with no size cited", n.gripsNoSizeNote, { note: n.gripsNoSizeNote });
  check("the class and size rows show a bare Auto option with no guess", n.classAutoBare && n.sizeAutoBare, { cls: n.classAutoBare, size: n.sizeAutoBare });
  check("all four figures carry no tooltip: the row's tooltip is empty", ["type", "cls", "size", "grips"].every((f) => n.kinds?.[f]?.one && n.kinds[f].kind === "none" && !n.kinds[f].onRow), { type: n.kinds?.type?.kind, cls: n.kinds?.cls?.kind, size: n.kinds?.size?.kind, grips: n.kinds?.grips?.kind });
  check("the Rolls rows carry no proficiency tag and no import wording, and the weapon is not refused", n.tagsSayMissing === 0 && n.linesSayMissing === 0, { mods: n.modCount, tags: n.tagsSayMissing, lines: n.linesSayMissing });
  check("every attack row still has its throw line under the empty source (a blank die leaves the throw)", n.attackLines >= 1 && n.attackLinesBlank === 0, { attackLines: n.attackLines, blank: n.attackLinesBlank });
  const nc = nulled.char;
  check("the character sheet rendered under the empty source: the weapon's row and both containers", nc.rendered && nc.weaponRow && nc.pack.found && nc.satchel.found, { rendered: nc.rendered, weapon: nc.weaponRow, pack: nc.pack?.found, satchel: nc.satchel?.found });

  section("3. the default source is back");
  const back = await run(gm, P.sourceState);
  note("restore (page)", back);
  check("the default source is registered again: same key count, the very same first row, not left out", back.keys && back.sameFirstRow && back.hasRows && back.notLeftOut, back);
  const again = await run(gm, P.item, { actorId, itemId: ids.weapon });
  check("a fresh item sheet reads from the table again: class, size and grips from the row, the Auto options carry their guess", ["cls", "size", "grips"].every((f) => again.kinds?.[f]?.kind === "row") && !again.panelSaysMissing && !again.classAutoBare && !again.sizeAutoBare && !again.gripsNoSizeNote,{ cls: again.kinds?.cls?.kind, size: again.kinds?.size?.kind, grips: again.kinds?.grips?.kind });
  await run(gm, P.closeAll);

  section("4. console");
  for (const [key, api] of [["gm", gm], ["player", player]]) {
    const drained = await run(api, P.drain);
    check(`${key}: no console error over the walk`, !drained.errors.length, drained.errors.slice(0, 3));
  }
  walkDone();
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  if (gm) {
    try { note("weapon source", await run(gm, P.restoreSource)); } catch (err) { console.error("restoreSource:", err?.message ?? err); }
    try { note("weapon source state", await run(gm, P.sourceState)); } catch (err) { console.error("sourceState:", err?.message ?? err); }
    try { await run(gm, P.closeAll); } catch {}
    try { note("restored", await run(gm, P.restore)); } catch (err) { console.error("restore:", err?.message ?? err); }
  }
  if (player) {
    try { await run(player, P.closeAll); } catch {}
    try { note("restored (player)", await run(player, P.restore)); } catch (err) { console.error("restore:", err?.message ?? err); }
  }
  if (sourceLeftOut) checks.push(["the null path ended with the source put back", false]);
  console.log(`fixture kept: ${MARKER}`);
  // The kept fixture is the ledger's one entry when this run built it, and a kept fixture stays: the sweep names nothing.
  try { if (gm) note("sweep", await gm.sweepTracked({ only: [] })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  try { if (player) await player.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
