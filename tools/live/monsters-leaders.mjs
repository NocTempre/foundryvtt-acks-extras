/**
 * Live walk, leaders and kits: docs/monsters/TESTING.md "A family's roles",
 * "Leaders outside a family" and "A beastman's kit". A family template's Role
 * axis offers what each kind's page prints and generates the rank and file by
 * default; a leader takes its own figures, with the attack throw moved by the
 * imported ladder and the saves by its Hit Dice, and the Statblock names where
 * each came from; a creature outside a family gets a "(leaders)" template; a
 * beastman family gains a Kit axis whose troop rows dress a generated creature;
 * a family imported before the tables gains the axes on Repair in place; and
 * an observer pins without writing. Machine values arrive through ./_env.mjs,
 * the books through ACKS_TEST_BOOKS ("rr", "mm"). A check prints ids, shapes
 * and booleans, never a book's words or figures; every figure the walk types
 * is invented.
 *
 * Stages (`STAGE`, default every one in order; each fits one bounded run):
 *   1  setup: the boot recorder, the family's shape before any write (a
 *      family imported before the kit tables has no Kit axis), the
 *      rulebook's `monsters` tables, a repair with the ladder unregistered on
 *      this seat (roles 4b), the family's Repair in place (roles 10), and the
 *      creature outside a family with its leaders template.
 *   2  roles: "A family's roles" steps 1-9 and 4a-4c.
 *   3  standalone and kit: "Leaders outside a family" 2-4 and 6-8, "A
 *      beastman's kit" 1-5, 9 and 10, and the Player seat's reads of both.
 *   4  the AXIOMS procedure: roles 11-13 and 12a, and the Leader figures plate.
 *   5  the Judge's own chieftain factor: roles 12b.
 *   6  a procedure missing a figure: roles 14.
 *   7  the procedure's reach: standalone 5, kit 5 on the procedure, kit 6-8.
 * The Player seat closes every stage from 2 on (roles 9 and 15, standalone 8,
 * kit 10).
 *
 * With `axc` on ACKS_TEST_BOOKS, stage 1 connects the AXIOMS Compendium too
 * and its import brings `leaderLadder`, `leaderSteps`, `beastmenByType` and
 * `damageDieConversion` in with the rulebook's tables. Without it, roles
 * 11-15, standalone 5, kit 6-8 and stages 4-7 print a note each and check
 * nothing they cannot reach. A run stops opening sections after nine
 * minutes, so its teardown fits a ten-minute attempt.
 *
 * Fixtures: an import lands in the library compendium, where a marker cannot
 * go (`api.mark` takes world documents only), so the family and the creature
 * are found by their cookbook id, world or library, and two claimants stop
 * the walk. The walk writes them only through Repair in place, the recipe's
 * own route, and a run that leaves the family repaired with the ladder out of
 * shape repairs it back in its finally. A leaders template the run mints by
 * repairing the creature is tracked and swept; one held before the run is
 * read and never deleted. Every generated creature and posted card is
 * tracked and swept. Writes outside the ledger: the rulebook's `monsters`
 * tables (an import the recipe needs), the ruledata overrides of roles 4c,
 * 12b and 14 and kit 8, each cleared in a finally when the run set it and the
 * family repaired back after, and Observer for the Player seat
 * on the generated trooper, which the sweep removes. The books open on this
 * seat only (`remember: false`).
 */
import { Cdp, connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS, books, shotDir } from "./_env.mjs";
import { walkDone, blocked } from "./_walk.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const SHOTS = process.env.SHOTS === "1";
const STAGES = process.env.STAGE ? String(process.env.STAGE).split(",").map(Number) : [1, 2, 3];
const BOOKS = Object.fromEntries(books(["rr", "mm", "axc"]).map((b) => [b.id, b]));
const AXC = !!BOOKS.axc;

const FAMILY_ID = "mm.familyBeastman";
/** The family's overview entry, read as its prose and never a variant. */
const OVERVIEW_ID = "mm.beastman";
/** Creatures outside the family whose pages name leaders, the first one the world holds taken. */
const STANDALONE_IDS = ["mm.ogre", "mm.lizardman", "mm.centaur", "mm.troll"];
/** Beastman-type creatures outside the family whose pages name no leader: the procedure's alone. */
const NO_LEADER_IDS = ["mm.minotaur", "mm.hobgholl"];
/** An invented throw and armour class typed over a generated figure. */
const TYPED_THROW = 17;
const TYPED_AC = 13;
/** How far the invented ladder override moves one row. */
const OVERRIDE_SHIFT = 5;
/** An invented chieftain's bonus factor, for the override of step 12b. */
const INVENTED_FACTOR = 7;
/** A run stops taking new sections past this, so its teardown fits the attempt. */
const BUDGET_MS = 540_000;
const T0 = Date.now();
let tearing = false;

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => {
  console.log(`\n== ${title} ==  (+${Math.round((Date.now() - T0) / 1000)}s)`);
  if (!tearing && Date.now() - T0 > BUDGET_MS) throw new Error(`the run's time budget ran out before "${title}"`);
};
const checks = [];
// The detail is always an object or absent: a bare string would reach the console with a figure in it.
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + JSON.stringify(typeof detail === "object" && detail !== null ? detail : { detail })}`);
};
const unreachable = (what) => note("not reachable", what);

/** In the page before it loads, so `init`, `setup` and `ready` are all recorded. */
const RECORDER = `(() => {
  const R = (globalThis.__mlBoot = { phase: "load", phases: [], errors: [] });
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
/*  Page side                                                           */
/* ------------------------------------------------------------------ */

const P = {
  install: async () => {
    const H = (globalThis.__ml = globalThis.__ml ?? {});
    H.T = await import("/modules/acks-extras/scripts/lib/tables.mjs");
    H.RD = await import("/modules/acks-extras/scripts/lib/ruledata.mjs");
    H.LR = await import("/modules/acks-extras/scripts/importer/leader-roles.mjs");
    H.CB = await import("/modules/acks-extras/scripts/importer/cookbook.mjs");
    H.KITS = await import("/modules/acks-extras/scripts/monsters/kits.mjs");
    H.LD = await import("/modules/acks-extras/scripts/monsters/leader-derive.mjs");
    H.TS = await import("/modules/acks-extras/scripts/location/table-store.mjs");
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
    H.text = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    H.opened = H.opened ?? [];
    H.marker = (a) => a?.flags?.world?.fixture ?? null;
    H.cb = (a) => a?.flags?.["acks-extras"]?.cookbook ?? {};
    H.FMS = () => Object.values(CONFIG.Actor.sheetClasses.monster).map((e) => e.cls).find((c) => c.name === "FullMonsterSheet");
    // A template the importer made lives in the library compendium; a generated creature in the world.
    H.get = async (ref) => (String(ref).includes(".") ? await fromUuid(ref) : game.actors.get(ref));
    return {
      module: game.modules.get("acks-extras")?.version ?? null,
      isGM: game.user.isGM,
      activeGMIsSelf: !!game.users.activeGM?.isSelf,
      boot: globalThis.__mlBoot ?? null,
    };
  },

  /** What the registry holds for `monsters`, and what it says is missing. */
  tables: async () => {
    const { T, RD } = globalThis.__ml;
    const has = T.hasDoc("monsters");
    const doc = has ? T.getDoc("monsters") : null;
    const out = {};
    for (const id of ["attackThrowByHd", "leaderLadder", "leaderSteps", "beastmanTroops", "beastmenByType", "damageDieConversion"]) {
      const t = doc?.tables?.[id];
      const cite = T.citeOf("monsters", id) ?? "";
      out[id] = t ? { rows: Object.keys(t.rows ?? t).length, cited: !!cite, axioms: /AXIOMS/i.test(cite) } : null;
    }
    const steps = doc?.tables?.leaderSteps ?? null;
    const factor = steps?.bonusFactorChieftain;
    const cover = T.missingCoverage(["monsters"])[0] ?? null;
    return {
      has,
      tables: out,
      factorListed: steps ? Object.prototype.hasOwnProperty.call(steps, "bonusFactorChieftain") : null,
      factorNumber: factor != null && factor !== "" && Number.isFinite(Number(factor)),
      missing: cover?.missing ?? [],
      listed: RD.missingTablesList(["monsters"]),
    };
  },

  connectBook: async ({ id, path }) => {
    if (globalThis.__ml.CB.cookbookSessionDoc(id)) return { already: true };
    globalThis.__mlBook = { done: false };
    acksExtras.importer.connectBookUrl(id, path, { remember: false, bridge: false })
      .then(() => { globalThis.__mlBook = { done: true, ok: true }; })
      .catch((e) => { globalThis.__mlBook = { done: true, ok: false, error: String(e?.message ?? e) }; });
    return { started: true };
  },
  bookState: async ({ id }) => ({ ...globalThis.__mlBook, open: !!globalThis.__ml.CB.cookbookSessionDoc(id) }),

  /** Fire a long call into a global; `job` reads it back. */
  start: async ({ what, args }) => {
    globalThis.__mlJob = { done: false };
    const calls = {
      importIds: () => acksExtras.importer.cookbookImportIds(args.ids),
      importTables: () => acksExtras.importer.cookbookImportTables(args.only),
    };
    calls[what]()
      .then((v) => { globalThis.__mlJob = { done: true, ok: true, value: typeof v === "object" ? JSON.parse(JSON.stringify(v ?? null)) : v ?? null }; })
      .catch((e) => { globalThis.__mlJob = { done: true, ok: false, error: String(e?.message ?? e) }; });
    return { started: true };
  },
  job: async () => {
    const j = globalThis.__mlJob ?? { done: false };
    // A report object can hold row figures; hand back only its shape.
    return { done: j.done, ok: j.ok ?? null, error: j.error ?? null, kind: j.value == null ? null : typeof j.value };
  },

  /** Actors claiming a cookbook id, in the world and every Actor compendium: `{id, uuid, type, pack, leadersOf, name, created}` each. */
  claimants: async ({ cbId }) => {
    const H = globalThis.__ml;
    const docs = [...game.actors];
    for (const pack of game.packs.filter((p) => p.documentName === "Actor")) docs.push(...(await pack.getDocuments().catch(() => [])));
    return docs.filter((a) => H.cb(a).id === cbId).map((a) => ({ id: a.id, uuid: a.uuid, type: a.type, pack: a.pack ?? null, marker: H.marker(a), leadersOf: H.cb(a).leadersOf ?? null, name: a.name, created: a._stats?.createdTime ?? null }));
  },
  markedActor: async ({ marker }) => {
    const hits = game.actors.filter((a) => globalThis.__ml.marker(a) === marker);
    return hits.map((a) => ({ id: a.id, uuid: a.uuid, cb: globalThis.__ml.cb(a).id ?? null }));
  },
  heldIds: async ({ ids }) => {
    const held = new Set(game.actors.map((a) => globalThis.__ml.cb(a).id).filter(Boolean));
    return ids.filter((id) => held.has(id));
  },
  actorIds: async () => game.actors.map((a) => a.id),

  /** Unregister the `monsters` doc on this seat only, or mirror the world's store back. */
  tablesOff: async () => ({ dropped: globalThis.__ml.T.unregisterTable("monsters"), has: globalThis.__ml.T.hasDoc("monsters") }),
  tablesOn: async () => {
    await globalThis.__ml.TS.registerPersisted();
    return { has: globalThis.__ml.T.hasDoc("monsters") };
  },

  /** A template's axes and cells as shapes, never figures. */
  shape: async ({ actorId }) => {
    const a = (await globalThis.__ml.get(actorId));
    const sys = a.system;
    const axes = (sys.axes ?? []).map((x) => ({ key: x.key, default: x.default ?? "", options: (x.options ?? []).map((o) => o.key) }));
    const cells = (sys.cells ?? []).map((c) => c.key);
    const throwMissing = (sys.cells ?? []).filter((c) => c.flags?.["acks-extras"]?.extras?.derived?.throw?.missing).length;
    const throwMoved = (sys.cells ?? []).filter((c) => c.flags?.["acks-extras"]?.extras?.derived?.throw?.value != null).length;
    return { id: a.id, name: a.name, type: a.type, axes, cells, throwMissing, throwMoved, cbId: globalThis.__ml.cb(a).id ?? null, leadersOf: globalThis.__ml.cb(a).leadersOf ?? null };
  },

  /**
   * The roles each variant has a cell for, and the leaders whose cell prints
   * Hit Dice of its own: what the availability and the leader steps pick from.
   */
  roleMap: async ({ actorId }) => {
    const a = (await globalThis.__ml.get(actorId));
    const cells = a.system.cells ?? [];
    const byRole = {};
    const leaders = [];
    const casters = [];
    const dependants = [];
    for (const c of cells) {
      if ((c.by ?? []).join("|") !== "variant|role") continue;
      const [variant, role] = String(c.key).split("|");
      (byRole[role] ??= []).push(variant);
      const ex = c.flags?.["acks-extras"]?.extras ?? {};
      // A procedure cell is the AXIOMS steps' subject; the printed leaders are these.
      if (ex.derived?.leader?.source === "axioms") continue;
      if (ex.spellcasting) casters.push({ variant, role });
      else if (ex.noncombatant) dependants.push({ variant, role });
      else if (c.merge?.hp?.hd && ["champion", "subChieftain", "chieftain"].includes(role)) leaders.push({ variant, role, xp: c.merge?.details?.xp != null });
    }
    return { byRole, leaders, casters, dependants };
  },

  /** Open a template's builder sheet and read every axis select as it renders. */
  openTemplate: async ({ actorId }) => {
    const H = globalThis.__ml;
    const actor = await H.get(actorId);
    // A pin is per window: the walk always starts from a freshly opened sheet.
    for (const app of [...foundry.applications.instances.values()]) if (app.document?.uuid === actor.uuid) { try { await app.close({ animate: false }); } catch {} }
    H.opened = H.opened.filter((x) => x.document?.uuid !== actor.uuid);
    await H.sleep(200);
    const app = actor.sheet;
    H.opened.push(app);
    H.tsheet = app;
    await app.render(true);
    const root = await H.poll(() => H.root(app)?.querySelector(".acks-lib-template-body"));
    return { rendered: !!root, id: app.id };
  },
  selects: async () => {
    const H = globalThis.__ml;
    const root = H.root(H.tsheet);
    return [...(root?.querySelectorAll("select.acks-lib-template-pin") ?? [])].map((s) => ({
      axis: s.dataset.axis,
      name: s.getAttribute("name"),
      value: s.value,
      blank: H.text(s.options[0]),
      options: [...s.options].slice(1).map((o) => ({ key: o.value, disabled: o.disabled, marked: /\(.+\)$/.test(o.textContent.trim()), tip: o.dataset.tooltip ?? null, label: o.textContent.trim() })),
    }));
  },
  generateShown: async () => !!globalThis.__ml.root(globalThis.__ml.tsheet)?.querySelector("[data-action='generate']"),

  /** Pin `pins` in order the way a hand does — the select's value and its change — after clearing every pin. */
  pin: async ({ pins }) => {
    const H = globalThis.__ml;
    const sel = (axis) => H.root(H.tsheet)?.querySelector(`select.acks-lib-template-pin[data-axis='${axis}']`);
    const set = async (s, value) => {
      const axis = s.dataset.axis;
      s.value = value;
      s.dispatchEvent(new Event("change", { bubbles: true }));
      await H.sleep(250);
      await H.poll(() => (sel(axis) ? sel(axis).value === value : value === ""), { tries: 30, every: 100 });
    };
    for (let n = 0; n < 4; n++) {
      const stale = [...(H.root(H.tsheet)?.querySelectorAll("select.acks-lib-template-pin") ?? [])].find((s) => s.value);
      if (!stale) break;
      await set(stale, "");
    }
    for (const [axis, value] of pins) {
      const s = sel(axis);
      if (!s) return { ok: false, missing: axis };
      const opt = [...s.options].find((o) => o.value === value);
      if (!opt) return { ok: false, noOption: `${axis}=${value}` };
      if (opt.disabled) return { ok: false, disabled: `${axis}=${value}` };
      await set(s, value);
    }
    return { ok: true };
  },

  /** Press Generate and read back the creature this client's create made. */
  generate: async ({ templateId }) => {
    const H = globalThis.__ml;
    const template = (await globalThis.__ml.get(templateId));
    const made = [];
    const hook = Hooks.on("createActor", (a) => { if (a.flags?.["acks-extras"]?.generated?.templateUuid === template.uuid) made.push(a.id); });
    H.root(H.tsheet).querySelector("[data-action='generate']").click();
    await H.poll(() => made.length > 0, { tries: 60, every: 200 });
    Hooks.off("createActor", hook);
    // The sheet Generate opens for the new creature is closed here; the walk opens its own.
    for (const id of made) {
      await H.sleep(300);
      for (const app of foundry.applications.instances.values()) if (app.document?.id === id) { try { await app.close({ animate: false }); } catch {} }
    }
    return { ids: made };
  },

  /** A generated caster's slots against its class's row at its rolled level, and how many spells it drew: booleans and counts only. */
  casterSlots: async ({ actorId }) => {
    const R = await import("/modules/acks-extras/scripts/magic/repertoire.mjs");
    const a = await globalThis.__ml.get(actorId);
    const sc = a?.flags?.["acks-extras"]?.extras?.spellcasting ?? {};
    const cls = R.classNamed(sc.class);
    if (!cls) return { classHeld: false };
    const want = R.slotsOfClass(cls, sc.level);
    const got = R.slotsOfSystem(a.system?.spells);
    return {
      classHeld: true,
      rowAtLevel: !!want,
      enabled: !!a.system?.spells?.enabled,
      match: JSON.stringify(want) === JSON.stringify(got),
      spells: a.items.filter((i) => i.type === "spell").length,
      slotTotal: Object.values(want ?? {}).reduce((s, n) => s + n, 0),
    };
  },

  /** A generated creature's figures, beside its template's cells, compared in the page. */
  read: async ({ actorId }) => {
    const a = (await globalThis.__ml.get(actorId));
    const s = a.system;
    const ex = a.flags?.["acks-extras"]?.extras ?? {};
    const gen = a.flags?.["acks-extras"]?.generated ?? {};
    return {
      name: a.name,
      choices: gen.choices ?? {},
      log: (gen.log ?? []).map((l) => ({ axis: l.axis, source: l.source })),
      hd: s.hp?.hd ?? null,
      hp: s.hp?.max ?? null,
      ac: s.ac?.value ?? null,
      throw: s.attack?.throw ?? null,
      xp: s.details?.xp ?? null,
      morale: s.details?.morale ?? null,
      move: s.movement?.base ?? null,
      mod: s.damage?.mod ?? null,
      saves: Object.fromEntries(Object.entries(s.saves ?? {}).map(([k, v]) => [k, v?.value ?? null])),
      ex: { hd: ex.hd ?? null, saveAs: ex.saveAs ?? null, derived: ex.derived ?? null, kit: ex.kit ?? null, spellcasting: ex.spellcasting ?? null, noncombatant: !!ex.noncombatant, notes: ex.description?.notes ?? "" },
      bio: s.details?.biography ?? "",
      items: a.items.map((i) => `${i.type}:${i.name}`).sort(),
      // A weapon with a damage formula first: a card check needs one that deals damage.
      weapons: a.items.filter((i) => i.type === "weapon").sort((x, y) => Number(!!y.system?.damage?.base?.formula) - Number(!!x.system?.damage?.base?.formula)).map((i) => i.id),
    };
  },

  /**
   * One leader against its own cell and its member: every comparison made in
   * the page, booleans out. The throw is the member's moved by what the
   * world's ladder adds between the two rows, worked from the ladder here.
   */
  leaderFigures: async ({ templateId, actorId, variant, role }) => {
    const { LR } = globalThis.__ml;
    const t = (await globalThis.__ml.get(templateId));
    const a = (await globalThis.__ml.get(actorId));
    const cell = (t.system.cells ?? []).find((c) => c.key === `${variant}|${role}`);
    const member = (t.system.axes ?? []).find((x) => x.key === "variant")?.options?.find((o) => o.key === variant);
    const cm = cell?.merge ?? {};
    const cx = cell?.flags?.["acks-extras"]?.extras ?? {};
    const mx = member?.flags?.["acks-extras"]?.extras ?? {};
    const ax = a.flags?.["acks-extras"]?.extras ?? {};
    const s = a.system;
    const ladder = LR.importedThrowLadder();
    const row = (hd) => {
      const v = ladder.rows?.[LR.ladderKey(LR.throwStep(hd))];
      return v == null ? null : Number(typeof v === "object" ? v.throw : v);
    };
    const memberThrow = member?.merge?.attack?.throw;
    const fromRow = row(mx.hd);
    const toRow = row(cx.hd ?? ax.hd);
    const expected = Number.isFinite(memberThrow) && fromRow != null && toRow != null ? memberThrow + (toRow - fromRow) : null;
    const saveExpected = mx.saveAs && Number.isInteger(mx.saveAs.level) ? mx.saveAs.level + ((LR.saveLevelOf(cx.hd) ?? 0) - (LR.saveLevelOf(mx.hd) ?? 0)) : null;
    const savesMatch = Object.entries(cm.saves ?? {}).every(([k, v]) => s.saves?.[k]?.value === v?.value);
    return {
      cellFound: !!cell,
      ladder: !!ladder.rows,
      hdIsCell: !!cm.hp?.hd && s.hp?.hd === cm.hp.hd,
      // A rating is compared by its parts: the stored shape may drop a null bonus or add fields.
      extrasHd: !!ax.hd && !!cx.hd && Number(ax.hd.count) === Number(cx.hd.count) && Number(ax.hd.bonus ?? 0) === Number(cx.hd.bonus ?? 0),
      extrasShape: { actor: Object.keys(ax.hd ?? {}).sort(), cell: Object.keys(cx.hd ?? {}).sort() },
      hdDiffers: JSON.stringify(cx.hd) !== JSON.stringify(mx.hd),
      acIsCell: cm.ac?.value != null && s.ac?.value === cm.ac.value,
      hpIsCell: cm.hp?.max != null ? s.hp?.max === cm.hp.max : null,
      throwIsCell: cm.attack?.throw != null && s.attack?.throw === cm.attack.throw,
      throwIsLadder: expected != null && s.attack?.throw === expected,
      throwIsMember: Number.isFinite(memberThrow) && s.attack?.throw === memberThrow,
      throwMissing: !!ax.derived?.throw?.missing,
      savesMatch: !!cm.saves && savesMatch,
      saveLevel: saveExpected != null && ax.saveAs?.level === saveExpected,
      xpIsCell: cm.details?.xp != null ? s.details?.xp === cm.details.xp : null,
      xpIsMember: s.details?.xp === member?.merge?.details?.xp,
      cellXp: cm.details?.xp != null,
      modIsCell: JSON.stringify(s.damage?.mod ?? null) === JSON.stringify(cm.damage?.mod ?? null),
      modTotal: Number(s.damage?.mod?.melee ?? 0),
    };
  },

  /** The Full Monster Sheet on a creature, at a tab. */
  openFms: async ({ actorId, tab = "statblock" }) => {
    const H = globalThis.__ml;
    const actor = (await globalThis.__ml.get(actorId));
    for (const app of foundry.applications.instances.values()) if (app.document?.id === actorId) { try { await app.close({ animate: false }); } catch {} }
    const Cls = H.FMS();
    const app = new Cls({ document: actor });
    H.opened.push(app);
    H.fms = app;
    await app.render(true);
    await H.poll(() => H.root(app)?.querySelector(".acks-extras-frame__rail"));
    await app.changeTab(tab, "primary");
    await H.sleep(300);
    return { rendered: !!H.root(app), id: app.id };
  },

  /** The tooltips the Statblock and the rail carry, read off the attributes the tooltip manager shows. */
  tips: async () => {
    const H = globalThis.__ml;
    const root = H.root(H.fms);
    await H.fms.changeTab("statblock", "primary");
    await H.poll(() => root.querySelector("[data-roll^='save:']"));
    const atk = [...root.querySelectorAll("[data-roll^='atk:']")].map((r) => ({
      id: r.dataset.roll.slice(4),
      tag: H.text(r.querySelector(".acksm-dmg-tag")),
      dmgTip: r.querySelector(".acksm-dmg-tag")?.dataset.tooltipText ?? "",
      throwTip: r.querySelector(".acks-extras-frame__row-value")?.dataset.tooltipText ?? "",
    }));
    const save = root.querySelector("[data-roll^='save:'] .acks-extras-frame__row-value")?.dataset.tooltipText ?? "";
    const morale = root.querySelector("[data-roll='morale'] .acks-extras-frame__row-value")?.dataset.tooltipText ?? "";
    const acCell = root.querySelector(".acks-extras-frame__rail i.fa-shield-halved")?.closest("button");
    const hpNote = [...root.querySelectorAll(".acks-extras-frame__rule-note")].map((n) => n.dataset.tooltipText ?? "").filter(Boolean);
    return { atk, save, morale, ac: acCell?.dataset.tooltip ?? "", hpNote };
  },

  /** Words a tooltip should and should not carry, compared in the page. */
  tipHas: async ({ text, keys = [], words = [] }) => {
    const out = {};
    for (const k of keys) out[k] = String(text).includes(k);
    for (const w of words) out[w] = String(text).includes(w);
    return out;
  },

  /** Type into a Classification field the way a hand does, and wait for the write. */
  typeField: async ({ actorId, name, value }) => {
    const H = globalThis.__ml;
    const actor = (await globalThis.__ml.get(actorId));
    await H.fms.changeTab("classification", "primary");
    const input = await H.poll(() => H.root(H.fms)?.querySelector(`input[name='${name}']`));
    if (!input) return { found: false };
    input.value = String(value);
    input.dispatchEvent(new Event("change", { bubbles: true }));
    const landed = await H.poll(() => Number(foundry.utils.getProperty(actor, name)) === Number(value));
    await H.sleep(400);
    return { found: true, landed: !!landed };
  },

  /** Roll one weapon attack from the Statblock with the skip-dialog key held, and read the card's formulas. */
  rollAttack: async ({ actorId, itemId }) => {
    const H = globalThis.__ml;
    const actor = await H.get(actorId);
    // A "by weapon" attack has no die for core to roll: the creature is handed a weapon that has one.
    if (!/\d*d\d+/.test(String(actor.items.get(itemId)?.system?.damage?.base?.formula ?? ""))) {
      const [made] = await actor.createEmbeddedDocuments("Item", [{ name: "Walk test weapon", type: "weapon", system: { damage: { base: { formula: "1d6" } } } }]);
      itemId = made.id;
      await H.fms.render();
      await H.sleep(600);
      await H.fms.changeTab("statblock", "primary");
      await H.poll(() => H.root(H.fms)?.querySelector(`[data-roll='atk:${itemId}']`));
    }
    const root = H.root(H.fms);
    const row = root.querySelector(`[data-roll='atk:${itemId}']`);
    if (!row) return { found: false, posted: [] };
    const key = game.settings.get("acks", "skip-dialog-key");
    const posted = [];
    const hook = Hooks.on("createChatMessage", (m) => { if (m.speaker?.actor === actorId) posted.push(m.id); });
    // Core rolls damage only on a hit, so the dice are rigged to a natural 20 on this page for the one click.
    const uniform = CONFIG.Dice.randomUniform;
    CONFIG.Dice.randomUniform = () => 0.025;
    try {
      (row.querySelector(".acks-extras-frame__row-label") ?? row).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, [key]: true }));
      await H.poll(() => posted.length > 0, { tries: 30, every: 200 });
      await H.sleep(500);
    } finally {
      CONFIG.Dice.randomUniform = uniform;
      Hooks.off("createChatMessage", hook);
    }
    const formulas = [];
    for (const id of posted) {
      const m = game.messages.get(id);
      for (const r of m?.rolls ?? []) formulas.push(r.formula);
      const card = document.createElement("div");
      card.innerHTML = m?.content ?? "";
      for (const f of card.querySelectorAll(".dice-formula")) formulas.push(H.text(f));
    }
    return { found: true, posted, formulas };
  },

  /** Does a formula carry the modifier exactly once, as a term of its own? */
  modOnce: async ({ formulas, mod }) => {
    if (!mod) return { any: false };
    const n = Math.abs(mod);
    const sign = mod > 0 ? "\\+" : "-";
    const re = new RegExp(`${sign}\\s*${n}(?![\\d])`, "g");
    const counts = formulas.map((f) => (String(f).match(re) ?? []).length);
    return { any: counts.some((c) => c === 1), never2: counts.every((c) => c <= 1) };
  },

  grantObserver: async ({ actorId, name }) => {
    const actor = (await globalThis.__ml.get(actorId));
    const user = game.users.find((u) => u.name === name);
    await actor.update({ ownership: { ...actor.ownership, [user.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER } });
    return actor.ownership[user.id] === CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
  },

  /** On an observing seat: pin and count every write the client attempts on the actor. */
  observePin: async ({ actorId, pins }) => {
    const H = globalThis.__ml;
    const attempted = [];
    const hook = Hooks.on("preUpdateActor", (doc) => { if (doc.id === actorId) attempted.push(doc.id); });
    const before = JSON.stringify((await globalThis.__ml.get(actorId)).toObject().system);
    const pinned = await (async () => {
      const sel = (axis) => H.root(H.tsheet)?.querySelector(`select.acks-lib-template-pin[data-axis='${axis}']`);
      for (const [axis, value] of pins) {
        const s = sel(axis);
        if (!s) return { ok: false, missing: axis };
        s.value = value;
        s.dispatchEvent(new Event("change", { bubbles: true }));
        await H.sleep(500);
        await H.poll(() => sel(axis)?.value === value, { tries: 20, every: 100 });
      }
      return { ok: true };
    })();
    await H.sleep(800);
    Hooks.off("preUpdateActor", hook);
    return { ...pinned, attempted: attempted.length, unchanged: JSON.stringify((await globalThis.__ml.get(actorId)).toObject().system) === before };
  },

  /** Kit tables and rows as the world holds them, as shapes. */
  kitRows: async () => {
    const { KITS, T } = globalThis.__ml;
    const k = KITS.importedKits();
    const raw = T.hasDoc("monsters") ? T.getDoc("monsters")?.tables?.beastmanTroops ?? null : null;
    const rows = raw ? Object.values(raw.rows ?? raw) : [];
    const whole = (r) => ["ac", "move", "hd", "damage", "morale"].every((f) => r?.[f] != null && r[f] !== "") && !!r.kind && !!r.troop;
    return {
      troops: k.troops.length,
      raw: rows.length,
      allWhole: rows.length > 0 && rows.every(whole),
      withNote: rows.filter((r) => String(r?.note ?? "").trim()).length,
      kinds: [...new Set(k.troops.map((t) => t.kind))],
      troopsByKind: Object.fromEntries([...new Set(k.troops.map((t) => t.kind))].map((kind) => [kind, k.troops.filter((t) => t.kind === kind).map((t) => t.troop)])),
      mounted: rows.filter((r) => /mount|cavalry|rider/i.test(String(r?.troop ?? ""))).length,
      troopsCited: !!k.troopsCite,
      byType: Object.keys(k.byType).length,
      dice: Object.keys(k.dice).length,
      byTypeAxioms: /AXIOMS/i.test(k.byTypeCite ?? ""),
      diceAxioms: /AXIOMS/i.test(k.diceCite ?? ""),
      diceHeader: !!k.dice.header,
      byTypeKinds: Object.keys(k.byType).map((x) => x.toLowerCase()),
    };
  },

  /**
   * The procedure's cells on a template, as shapes: which variant and role,
   * whether it stands under the Leader figures axis, and how the member's
   * hit-point bonus came along.
   */
  derivedCells: async ({ templateId }) => {
    const t = await globalThis.__ml.get(templateId);
    return (t.system.cells ?? [])
      .filter((c) => c.flags?.["acks-extras"]?.extras?.derived?.leader?.source === "axioms")
      .map((c) => {
        const l = c.flags["acks-extras"].extras.derived.leader;
        const [variant, role] = String(c.key).split("|");
        return { key: c.key, variant, role, underSource: (c.by ?? []).length === 3, carried: l.carried ?? "", factored: l.bonusFactor != null, rollHp: !!c.rollHp };
      });
  },

  /** Where a family member came from: its cookbook id and book, and whether its own block has figures. */
  memberCb: async ({ templateId, variant }) => {
    const t = await globalThis.__ml.get(templateId);
    const member = (t.system.axes ?? []).find((x) => x.key === "variant")?.options?.find((o) => o.key === variant);
    const cb = member?.flags?.["acks-extras"]?.cookbook ?? {};
    return { id: cb.id ?? null, book: cb.book ?? null, hasHd: !!member?.merge?.hp?.hd };
  },

  /** The page a family member was imported from, as its cookbook stamp cites it. */
  memberCite: async ({ templateId, variant }) => {
    const t = await globalThis.__ml.get(templateId);
    const member = (t.system.axes ?? []).find((x) => x.key === "variant")?.options?.find((o) => o.key === variant);
    return member?.flags?.["acks-extras"]?.cookbook?.cite ?? "";
  },
  /** The roles a variant's own page prints: its two-key cells that are no procedure's. */
  printedRoles: async ({ templateId, variant }) => {
    const t = await globalThis.__ml.get(templateId);
    return (t.system.cells ?? [])
      .filter((c) => (c.by ?? []).length === 2 && String(c.key).startsWith(`${variant}|`) && c.flags?.["acks-extras"]?.extras?.derived?.leader?.source !== "axioms")
      .map((c) => String(c.key).split("|")[1]);
  },

  /** A procedure leader against its cell, its member and the world's steps, compared in the page. */
  derivedFigures: async ({ templateId, actorId, cellKey, variant }) => {
    const H = globalThis.__ml;
    const t = await H.get(templateId);
    const a = await H.get(actorId);
    const s = a.system;
    const cell = (t.system.cells ?? []).find((c) => c.key === cellKey);
    const member = (t.system.axes ?? []).find((x) => x.key === "variant")?.options?.find((o) => o.key === variant);
    const cx = cell?.flags?.["acks-extras"]?.extras ?? {};
    const ax = a.flags?.["acks-extras"]?.extras ?? {};
    const l = ax.derived?.leader ?? {};
    const steps = H.T.hasDoc("monsters") ? H.T.getDoc("monsters")?.tables?.leaderSteps ?? {} : {};
    const log = a.flags?.["acks-extras"]?.generated?.log ?? [];
    const memberAc = Number(member?.merge?.ac?.value);
    const memberDmg = Number(member?.merge?.damage?.mod?.melee) || 0;
    const was = H.LD.parseRung(l.baseHd)?.bonus ?? null;
    const now = H.LD.parseRung(l.hd)?.bonus ?? null;
    return {
      cellFound: !!cell,
      source: l.source === "axioms",
      hdIsCell: !!cell?.merge?.hp?.hd && s.hp?.hd === cell.merge.hp.hd,
      extrasHd: !!ax.hd && !!cx.hd && Number(ax.hd.count) === Number(cx.hd.count) && Number(ax.hd.bonus ?? 0) === Number(cx.hd.bonus ?? 0),
      acParts: Number.isFinite(memberAc) && l.baseAc === memberAc && l.ac === memberAc + Number(l.acAdd),
      acHeld: s.ac?.value === l.ac,
      damageParts: l.baseDamage === memberDmg && l.damage === memberDmg + Number(l.damageAdd),
      damageHeld: s.damage?.mod?.melee === l.damage && s.damage?.mod?.missile === l.damage,
      hpRolled: log.some((x) => (x.axis ?? x.key) === "hitPoints" && x.source === "rolled"),
      carried: l.carried ?? "",
      factorIsSteps: l.bonusFactor != null && Number(l.bonusFactor) === Number(steps.bonusFactorChieftain),
      factorIs: l.bonusFactor != null ? Number(l.bonusFactor) : null,
      bonusMultiplied: was != null && now != null && l.bonusFactor != null && now === was * Number(l.bonusFactor),
      cite: l.cite ?? "",
      citeAxioms: /AXIOMS/i.test(l.cite ?? ""),
    };
  },

  /**
   * Override one figure of a world table with an invented value, as the
   * Ruledata Browser's manual edit does: a top-level field, or a field of the
   * row whose kind is `rowKind`. Refuses where the Judge already holds an
   * override of that table.
   */
  overrideTable: async ({ table, field, value, rowKind = null }) => {
    const { T, TS } = globalThis.__ml;
    if (TS.hasOverride("monsters", table)) return { had: true };
    const copy = foundry.utils.deepClone(T.getDoc("monsters").tables[table]);
    let target = copy;
    if (rowKind) {
      const hit = Object.entries(copy).find(([key, r]) => r && typeof r === "object" && String(r.kind ?? key).toLowerCase() === String(rowKind).toLowerCase());
      if (!hit) return { had: false, noRow: true };
      target = hit[1];
    }
    if (!(field in target)) return { had: false, noField: true };
    target[field] = value;
    await TS.setOverride("monsters", table, copy, { sourceName: "manual edit" });
    const landed = await globalThis.__ml.poll(() => {
      const now = T.getDoc("monsters").tables[table];
      const at = rowKind ? Object.entries(now).find(([key, r]) => r && typeof r === "object" && String(r.kind ?? key).toLowerCase() === String(rowKind).toLowerCase())?.[1] : now;
      return String(at?.[field] ?? "") === String(value);
    });
    return { had: false, set: true, landed: !!landed };
  },
  clearTable: async ({ table }) => {
    const { TS } = globalThis.__ml;
    await TS.clearOverride("monsters", table);
    return { cleared: !TS.hasOverride("monsters", table) };
  },

  /** The natural armour class a kind's row gives, compared in the page with a generated creature's. */
  naturalAc: async ({ actorId, variant }) => {
    const { KITS } = globalThis.__ml;
    const a = await globalThis.__ml.get(actorId);
    const k = KITS.importedKits();
    const hit = Object.entries(k.byType).find(([kind]) => kind.toLowerCase() === String(variant).toLowerCase())?.[1];
    return { row: !!hit, isNatural: !!hit && a.system.ac?.value === hit.naturalAc, cite: k.byTypeCite ?? "" };
  },

  /**
   * A weapon on the creature whose die the conversion table prints for its
   * modifier, adding one with such a die where it carries none, and the
   * tooltip that die's row should carry.
   */
  convertible: async ({ actorId }) => {
    const { KITS } = globalThis.__ml;
    const a = await globalThis.__ml.get(actorId);
    const k = KITS.importedKits();
    const mod = Number(a.system.damage?.mod?.melee ?? 0);
    if (!mod) return { mod: false };
    const formula = (i) => String(i.system?.damage?.base?.formula ?? "");
    let item = a.items.find((i) => i.type === "weapon" && KITS.convertedDie(k.dice, formula(i), mod));
    let added = false;
    if (!item) {
      const die = Object.entries(k.dice).filter(([key]) => key !== "header").map(([, r]) => String(r?.die ?? "")).find((d) => d && KITS.convertedDie(k.dice, d, mod));
      if (!die) return { mod: true, die: false };
      const [made] = await a.createEmbeddedDocuments("Item", [{ name: "Walk test weapon", type: "weapon", system: { damage: { base: { formula: die } } } }]);
      item = made;
      added = true;
    }
    const want = game.i18n.format("ACKS-MONSTERS.statblock.tip.dieConverted", { die: KITS.convertedDie(k.dice, formula(item), mod), cite: k.diceCite || "—" });
    globalThis.__ml.wantDie = want;
    return { mod: true, die: true, added, itemId: item.id };
  },
  dieTipShown: async ({ itemId }) => {
    const H = globalThis.__ml;
    const row = H.root(H.fms)?.querySelector(`[data-roll='atk:${itemId}'] .acksm-dmg-tag`);
    return { row: !!row, said: !!row && String(row.dataset.tooltipText ?? "").includes(H.wantDie ?? "\u0000") };
  },

  /** A trooper against its troop row and its kit cell, compared in the page. */
  kitFigures: async ({ templateId, actorId, variant, role, troop, cellKey = null }) => {
    const { KITS } = globalThis.__ml;
    const t = (await globalThis.__ml.get(templateId));
    const a = (await globalThis.__ml.get(actorId));
    const s = a.system;
    const k = KITS.importedKits();
    const kind = String(variant).toLowerCase();
    const row = k.troops.find((r) => r.kind === kind && r.troop === troop);
    const cells = t.system.cells ?? [];
    const leaderCell = cells.find((c) => c.key === (cellKey ?? `${variant}|${role}`));
    const member = (t.system.axes ?? []).find((x) => x.key === "variant")?.options?.find((o) => o.key === variant);
    const memberAc = member?.merge?.ac?.value;
    const leaderAc = leaderCell?.merge?.ac?.value;
    const leader = role !== "standard";
    const expectedAc = row ? (leader && Number.isFinite(leaderAc) && Number.isFinite(memberAc) ? row.ac + (leaderAc - memberAc) : row.ac) : null;
    const ex = a.flags?.["acks-extras"]?.extras ?? {};
    // The kit line is written escaped, so its words are compared escaped.
    const esc = (t) => foundry.utils.escapeHTML(String(t));
    const said = (html) => !!row && html.includes(esc(row.note || "—")) && html.includes(esc(k.troopsCite ?? "\u0000"));
    return {
      row: !!row,
      ac: expectedAc != null && s.ac?.value === expectedAc,
      modRow: row ? s.damage?.mod?.melee === row.damage && s.damage?.mod?.missile === row.damage : false,
      // The modifier is compared by its melee and missile figures: the stored object can carry keys the cell's does not.
      modLeader: leaderCell ? ["melee", "missile"].every((k) => Number(s.damage?.mod?.[k] ?? 0) === Number(leaderCell.merge?.damage?.mod?.[k] ?? 0)) : null,
      modKeys: { actor: Object.keys(s.damage?.mod ?? {}).sort(), cell: Object.keys(leaderCell?.merge?.damage?.mod ?? {}).sort() },
      move: row?.move != null ? s.movement?.base === row.move : null,
      morale: row?.morale != null ? s.details?.morale === row.morale : null,
      kitOnActor: ex.kit?.troop === troop,
      derivedKit: ex.derived?.kit ? { value: ex.derived.kit.value === s.ac?.value, step: ex.derived.kit.step === (leader ? leaderAc - memberAc : 0) } : null,
      notesKit: said(String(ex.description?.notes ?? "")),
      bioKit: said(String(s.details?.biography ?? "")),
      cite: k.troopsCite ?? null,
      modTotal: Number(s.damage?.mod?.melee ?? 0),
    };
  },

  /** Fire the entry picker's repair on the given rows, tick them, and confirm; a choice it puts is closed (keep every edit). */
  repair: async ({ rows }) => {
    const H = globalThis.__ml;
    const known = new Set(foundry.applications.instances.keys());
    globalThis.__mlRepair = { done: false };
    acksExtras.importer.cookbookReimportEntries()
      .then((v) => { globalThis.__mlRepair = { done: true, ok: true, value: v ? { mode: v.mode ?? null, picked: v.picked ?? null } : null }; })
      .catch((e) => { globalThis.__mlRepair = { done: true, ok: false, error: String(e?.message ?? e) }; });
    const fresh = () => [...foundry.applications.instances.values()].filter((a) => !known.has(a.id) && a.rendered);
    const picker = await H.poll(() => fresh().find((a) => H.root(a)?.querySelector("input[name='sel']")), { tries: 100, every: 200 });
    if (!picker) return { opened: false };
    const root = H.root(picker);
    const ticked = [];
    for (const value of rows) {
      const box = root.querySelector(`input[name='sel'][value='${value}']`);
      if (box) { box.checked = true; box.dispatchEvent(new Event("change", { bubbles: true })); ticked.push(value); }
    }
    if (ticked.length !== rows.length) {
      await picker.close({ animate: false });
      return { opened: true, ticked, confirmed: false, missingRows: rows.filter((r) => !ticked.includes(r)) };
    }
    known.add(picker.id);
    root.querySelector("button[data-action='ok']").click();
    const confirm = await H.poll(() => fresh().find((a) => H.root(a)?.querySelector("button[data-action='yes']")), { tries: 50, every: 200 });
    if (!confirm) return { opened: true, ticked, confirmed: false };
    H.root(confirm).querySelector("button[data-action='yes']").click();
    (async () => {
      for (let n = 0; n < 2400 && !globalThis.__mlRepair.done; n++) {
        const chooser = fresh().find((a) => H.root(a)?.querySelector(".acks-extras-held-list"));
        if (chooser) await chooser.close();
        await new Promise((r) => setTimeout(r, 250));
      }
    })();
    return { opened: true, ticked, confirmed: true };
  },
  repairState: async () => globalThis.__mlRepair ?? { done: false },

  /** Override one row of the world's ladder with an invented shift, as the Ruledata Browser's manual edit does. */
  overrideLadder: async ({ key, shift }) => {
    const { T, TS } = globalThis.__ml;
    const had = TS.hasOverride("monsters", "attackThrowByHd");
    if (had) return { had: true };
    const table = foundry.utils.deepClone(T.getDoc("monsters").tables.attackThrowByHd);
    const rows = table.rows ?? table;
    const cur = rows[key];
    if (cur == null) return { had: false, noRow: true };
    rows[key] = typeof cur === "object" ? { ...cur, throw: Number(cur.throw) + shift } : Number(cur) + shift;
    await TS.setOverride("monsters", "attackThrowByHd", table, { sourceName: "manual edit" });
    const landed = await globalThis.__ml.poll(() => {
      const now = T.getDoc("monsters").tables.attackThrowByHd;
      const v = (now.rows ?? now)[key];
      return Number(typeof v === "object" ? v.throw : v) === Number(typeof cur === "object" ? cur.throw : cur) + shift;
    });
    return { had: false, set: true, landed: !!landed, cited: !!T.citeOf("monsters", "attackThrowByHd") };
  },
  clearLadder: async () => {
    const { TS } = globalThis.__ml;
    await TS.clearOverride("monsters", "attackThrowByHd");
    return { cleared: !TS.hasOverride("monsters", "attackThrowByHd") };
  },
  ladderKeyOf: async ({ templateId, variant, role }) => {
    const { LR } = globalThis.__ml;
    const cell = ((await globalThis.__ml.get(templateId)).system.cells ?? []).find((c) => c.key === `${variant}|${role}`);
    const hd = cell?.flags?.["acks-extras"]?.extras?.hd;
    return hd ? LR.ladderKey(LR.throwStep(hd)) : null;
  },

  /**
   * A transparent box over what a plate frames, for the driver's selector
   * clip: a template sheet from its title bar to its Generate and Edit
   * structure buttons, leaving the family's prose below them out; or a Full
   * Monster Sheet together with the tooltip open beside it.
   */
  clipBox: async ({ of }) => {
    const H = globalThis.__ml;
    document.getElementById("ml-clip")?.remove();
    const rects = [];
    if (of === "template") {
      const root = H.root(H.tsheet);
      const win = root.getBoundingClientRect();
      const gen = root.querySelector("[data-action='generate']");
      const near = [...root.querySelectorAll("button")].map((b) => b.getBoundingClientRect()).filter((r) => r.height && gen && r.top < gen.getBoundingClientRect().bottom + 80);
      rects.push({ left: win.left, top: win.top, right: win.right, bottom: Math.max(...near.map((r) => r.bottom)) + 10 });
    } else {
      rects.push(H.root(H.fms).getBoundingClientRect());
      const tip = document.getElementById("tooltip");
      if (tip && tip.getBoundingClientRect().height) rects.push(tip.getBoundingClientRect());
    }
    const box = { left: Math.min(...rects.map((r) => r.left)), top: Math.min(...rects.map((r) => r.top)), right: Math.max(...rects.map((r) => r.right)), bottom: Math.max(...rects.map((r) => r.bottom)) };
    const el = document.createElement("div");
    el.id = "ml-clip";
    Object.assign(el.style, { position: "fixed", left: `${box.left}px`, top: `${box.top}px`, width: `${box.right - box.left}px`, height: `${box.bottom - box.top}px`, pointerEvents: "none", zIndex: "-1" });
    document.body.append(el);
    return { width: Math.round(box.right - box.left), height: Math.round(box.bottom - box.top), tip: rects.length > 1 };
  },
  clipDone: async () => { document.getElementById("ml-clip")?.remove(); try { game.tooltip.deactivate(); } catch {} return true; },
  /** Open the rail's armour class tooltip as a hover does, through core's tooltip manager. */
  showAcTip: async () => {
    const H = globalThis.__ml;
    const cell = H.root(H.fms)?.querySelector(".acks-extras-frame__rail i.fa-shield-halved")?.closest("button");
    if (!cell) return { cell: false };
    game.tooltip.activate(cell);
    await H.sleep(600);
    return { cell: true, shown: !!document.getElementById("tooltip")?.textContent?.includes("troop row") };
  },

  closeAll: async () => {
    const H = globalThis.__ml;
    let n = 0;
    for (const app of H?.opened ?? []) { try { await app.close({ animate: false, force: true }); n++; } catch {} }
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
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.importer?.connectBookUrl`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}

/** A second DevTools client on a seat, for the boot recorder the driver has no API for. */
async function rawSeat(port, token) {
  const { webSocketDebuggerUrl } = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json());
  const ws = await new Promise((resolve, reject) => {
    const w = new WebSocket(webSocketDebuggerUrl);
    w.addEventListener("open", () => resolve(w));
    w.addEventListener("error", () => reject(new Error("raw seat: socket error")));
  });
  const cdp = new Cdp(ws);
  const isGame = (u) => { try { return new URL(u).pathname.endsWith("/game"); } catch { return false; } };
  const { targetInfos } = await cdp.send("Target.getTargets");
  // The browser can hold a game page besides the driver's; the driver's carries the token the walk set in it.
  const pages = targetInfos.filter((t) => t.type === "page" && isGame(t.url));
  for (const page of pages) {
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: page.targetId, flatten: true });
    const r = await cdp.send("Runtime.evaluate", { expression: "globalThis.__mlToken ?? null", returnByValue: true }, sessionId).catch(() => null);
    if (r?.result?.value === token) return { send: (method, params = {}) => cdp.send(method, params, sessionId), close() { try { ws.close(); } catch {} } };
    await cdp.send("Target.detachFromTarget", { sessionId }).catch(() => {});
  }
  ws.close();
  throw new Error(`raw seat: none of ${pages.length} game pages is the driver's`);
}

/** Wait on a job fired into the page, polling in short calls. */
async function waitJob(api, fn, label, seconds = 420) {
  const t0 = Date.now();
  for (;;) {
    const s = await run(api, fn);
    if (s.done) return s;
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not done after ${seconds}s`);
    await sleep(2000);
  }
}

async function openBooks(api, ids) {
  for (const id of ids) {
    const book = BOOKS[id];
    if (!book) throw new Error(`ACKS_TEST_BOOKS names no path for ${id}`);
    note(`connect ${id}`, await run(api, P.connectBook, book));
    let state = await run(api, P.bookState, { id });
    for (let n = 0; n < 90 && !state.open && !state.done; n++) { await sleep(2000); state = await run(api, P.bookState, { id }); }
    note(`book ${id}`, state);
    if (!state.open) throw new Error(`${id} did not open: ${state.error ?? "timed out"}`);
  }
}

/** Shoot a plate through a box over its subject, and take the box away. */
async function plate(api, file, of) {
  const box = await run(api, P.clipBox, { of });
  try {
    return { ...(await api.shot(`${shotDir()}/${file}`, "#ml-clip")), box };
  } finally {
    await run(api, P.clipDone);
  }
}

/** Repair in place through the entry picker, waited to its end. */
async function repairRows(api, rows) {
  const t0 = Date.now();
  const fired = await run(api, P.repair, { rows });
  note("repair fired", fired);
  if (!fired.confirmed) return { ...fired, done: false };
  const end = await waitJob(api, P.repairState, "repair", 360);
  note("repair done", { ...end, seconds: Math.round((Date.now() - t0) / 1000) });
  return { ...fired, ...end };
}

/**
 * The one document claiming `cbId` (of `type` when given), world or library,
 * as `{id, uuid, ...}` with `id` the uuid every page helper resolves; null
 * when none does. Two is a fault, and the walk stops on it.
 */
async function held(api, cbId, type = null) {
  const hits = (await run(api, P.claimants, { cbId })).filter((a) => !type || a.type === type);
  if (hits.length > 1) throw new Error(`${hits.length} documents claim ${cbId}`);
  return hits[0] ? { ...hits[0], id: hits[0].uuid } : null;
}

const TEMPLATE = "acks-extras.template";
const generated = [];
const cards = [];
const minted = [];
/** What the run left out of shape and owes back, put right in the finally. */
const owed = { tablesOn: false, ladder: false, familyRepair: false, overrides: new Set() };

/** Override a table figure, recording the debt; the repair that follows is the caller's. */
async function override(api, args) {
  const ov = await run(api, P.overrideTable, args);
  note(`override ${args.table}`, ov);
  if (ov.set) owed.overrides.add(args.table);
  return ov;
}
async function revert(api, table) {
  const r = await run(api, P.clearTable, { table });
  note(`override ${table} cleared`, r);
  if (r.cleared) owed.overrides.delete(table);
  return r;
}

/** Pin, generate, track, read. */
async function gen(api, templateId, pins) {
  const pinned = await run(api, P.pin, { pins });
  if (!pinned.ok) return { pinned, ids: [] };
  const made = await run(api, P.generate, { templateId });
  for (const id of made.ids) generated.push(api.track(id, "Actor"));
  return { pinned, ids: made.ids, read: made.ids[0] ? await run(api, P.read, { actorId: made.ids[0] }) : null };
}

/** The leaders template of a creature outside a family, minted by a Repair in place on the creature where none is held, and tracked. */
async function leadersOf(api, creature) {
  let tpl = await held(api, `${creature.cb}.leaders`, TEMPLATE);
  if (tpl) return { tpl, minted: false };
  const done = await repairRows(api, [`Monsters|${creature.cb}`]);
  tpl = await held(api, `${creature.cb}.leaders`, TEMPLATE);
  if (tpl) minted.push(api.track(tpl.uuid));
  return { tpl, minted: !!tpl, repaired: !!done.ok };
}

/* ------------------------------------------------------------------ */
/*  Stage 1: setup                                                      */
/* ------------------------------------------------------------------ */

async function stageSetup(gm) {
  section("the boot recorder in the world as it stands");
  const tablesBefore = await run(gm, P.tables);
  note("tables before", tablesBefore);
  const boot = (await run(gm, P.install)).boot;
  check("init, setup and ready ran under the recorder with no error", boot?.phases?.length === 3 && boot.errors.length === 0, boot);
  if (!tablesBefore.has) {
    check("with no monster tables, the registry names attackThrowByHd, leaderLadder and leaderSteps missing", ["attackThrowByHd", "leaderLadder", "leaderSteps"].every((t) => tablesBefore.missing.includes(t)), { missing: tablesBefore.missing });
    check("and the missing-tables list names monsters", tablesBefore.listed.some((l) => String(l).startsWith("monsters")), { listed: tablesBefore.listed });
  } else {
    note("not walked this run", "the world held the monster tables at load, so the missing-tables list at boot is not the subject (roles step 10a)");
  }

  await openBooks(gm, AXC ? ["rr", "mm", "axc"] : ["rr", "mm"]);

  section("the family as the world holds it");
  const family = await held(gm, FAMILY_ID, TEMPLATE);
  if (!family) throw new Error(`the world holds no ${FAMILY_ID} template; this walk repairs the library's, and an import of one is the importer walk's subject`);
  const first = await run(gm, P.shape, { actorId: family.id });
  const overviewKeys = [];
  for (const v of first.axes.find((a) => a.key === "variant")?.options ?? []) if ((await run(gm, P.memberCb, { templateId: family.id, variant: v })).id === OVERVIEW_ID) overviewKeys.push(v);
  note("family before any write", { uuid: family.uuid, pack: family.pack, created: family.created, axes: first.axes.map((a) => `${a.key}:${a.options.length}`), cells: first.cells.length, throwMissing: first.throwMissing, throwMoved: first.throwMoved });
  const hasKit = (sh) => sh.axes.some((a) => a.key === "kit");
  if (!hasKit(first)) {
    check("the family imported before the kit tables has no Kit axis", true, { axes: first.axes.map((a) => a.key) });
  } else {
    note("not walked this run", "the family already carries its Kit axis: the pre-upgrade shape was repaired by an earlier run");
  }

  section("the rulebook's monster tables");
  let tables = await run(gm, P.tables);
  const AX_TABLES = ["leaderLadder", "leaderSteps", "beastmenByType", "damageDieConversion"];
  // A world that imported the compendium before the chieftain's factor was read holds steps without it.
  const stale = (t) => !t.tables.attackThrowByHd || !t.tables.beastmanTroops || (AXC && (AX_TABLES.some((id) => !t.tables[id]) || !t.factorListed));
  if (stale(tables)) {
    await run(gm, P.start, { what: "importTables", args: { only: ["monsters"] } });
    note("tables import", await waitJob(gm, P.job, "tables import", 480));
    tables = await run(gm, P.tables);
  }
  note("tables", tables);
  check("the ladder imports with the rulebook's tables, cited", tables.tables.attackThrowByHd?.rows > 0 && tables.tables.attackThrowByHd.cited, tables.tables.attackThrowByHd ?? {});
  check("and so do the beastman troops", tables.tables.beastmanTroops?.rows > 0 && tables.tables.beastmanTroops.cited, tables.tables.beastmanTroops ?? {});
  if (AXC) {
    check("roles 11: with the compendium connected, leaderLadder, leaderSteps, beastmenByType and damageDieConversion import, each citing AXIOMS", AX_TABLES.every((id) => tables.tables[id]?.rows > 0 && tables.tables[id].axioms), Object.fromEntries(AX_TABLES.map((id) => [id, tables.tables[id]])));
    check("12b: leaderSteps lists bonusFactorChieftain beside the other steps, read as a number", tables.factorListed && tables.factorNumber, { listed: tables.factorListed, number: tables.factorNumber });
    check("the missing-tables list names none of the monster tables", tables.missing.length === 0, { missing: tables.missing });
  } else {
    for (const t of AX_TABLES) if (!tables.tables[t]) unreachable(`${t}: an AXIOMS Compendium table, and the compendium is not mapped`);
    check("the missing-tables list now names only the compendium's tables", tables.missing.every((t) => AX_TABLES.includes(t)), { missing: tables.missing });
  }

  section("roles 4b: a repair with the ladder not imported");
  // The recipe's own route to the not-imported shape: the world layer unregistered in this page.
  note("monster tables unregistered on this seat", await run(gm, P.tablesOff));
  owed.tablesOn = true;
  owed.familyRepair = true;
  const blind = await repairRows(gm, [`Monsters|${FAMILY_ID}`]);
  const unladdered = await run(gm, P.shape, { actorId: family.id });
  check("repaired with no ladder, the leader cells record that it was not imported", blind.ok && unladdered.throwMissing > 0 && unladdered.throwMoved === 0, { ok: blind.ok, missing: unladdered.throwMissing, moved: unladdered.throwMoved });
  const map0 = await run(gm, P.roleMap, { actorId: family.id });
  const leader0 = map0.leaders[0];
  if (leader0) {
    await run(gm, P.openTemplate, { actorId: family.id });
    const g = await gen(gm, family.id, [["variant", leader0.variant], ["role", leader0.role]]);
    const fig = g.ids[0] ? await run(gm, P.leaderFigures, { templateId: family.id, actorId: g.ids[0], ...leader0 }) : null;
    check("a leader generated now keeps the member's throw", !!fig && fig.throwIsMember && fig.throwMissing, fig ?? g.pinned);
    if (g.ids[0]) {
      await run(gm, P.openFms, { actorId: g.ids[0] });
      const tips = await run(gm, P.tips);
      const said = await run(gm, P.tipHas, { text: tips.atk[0]?.throwTip ?? "", words: ["RR ch. 6"] });
      check("and its throw's tooltip says the ladder is not imported", !!tips.atk[0]?.throwTip && said["RR ch. 6"], { tip: !!tips.atk[0]?.throwTip });
    }
    await run(gm, P.closeAll);
  } else {
    check("the family has a leader whose cell prints its own Hit Dice", false, {});
  }
  note("monster tables mirrored back", await run(gm, P.tablesOn));
  owed.tablesOn = false;

  section("roles 10: the family's Repair in place");
  const done = await repairRows(gm, [`Monsters|${FAMILY_ID}`]);
  check("the entry picker ran Repair in place on the family row", done.confirmed && done.done && done.ok && done.ticked.length === 1, { ticked: done.ticked?.length, ok: done.ok });
  if (done.ok) owed.familyRepair = false;
  const after = await run(gm, P.shape, { actorId: family.id });
  note("family after repair", { axes: after.axes.map((a) => `${a.key}:${a.options.length}`), cells: after.cells.length, throwMissing: after.throwMissing, throwMoved: after.throwMoved });
  const claim = await run(gm, P.claimants, { cbId: FAMILY_ID });
  check("the same id, the one template", claim.length === 1 && claim[0].uuid === family.uuid, { held: claim.length });
  check("the Role axis and its cells as an import writes them, every throw moved by the ladder", after.axes.some((a) => a.key === "role") && after.throwMissing === 0 && after.throwMoved > 0, { missing: after.throwMissing, moved: after.throwMoved });
  check(hasKit(first) ? "the Kit axis stands after the repair, chosen last" : "the family imported before the kit tables gains the Kit axis on Repair in place, chosen last", after.axes.at(-1)?.key === "kit" && after.axes.at(-1).default === "own", { axes: after.axes.map((a) => a.key) });
  // The overview member is the family's prose, which a repair drops; every other held variant stays.
  const afterVariants = after.axes.find((a) => a.key === "variant")?.options ?? [];
  const variantsKept = first.axes.find((a) => a.key === "variant")?.options.filter((k) => !overviewKeys.includes(k)).every((k) => afterVariants.includes(k));
  check("and every variant the template held is still there, its overview member aside", !!variantsKept, {});
  const afterIds = [];
  for (const v of afterVariants) afterIds.push((await run(gm, P.memberCb, { templateId: family.id, variant: v })).id);
  check(overviewKeys.length ? "the overview member the template held is gone from the Variant axis" : "no overview member stands on the Variant axis", !afterIds.includes(OVERVIEW_ID), { heldBefore: overviewKeys.length });
  if (AXC) {
    const at = (k) => after.axes.findIndex((a) => a.key === k);
    const src = after.axes.find((a) => a.key === "leaderSource");
    check("roles 11: re-imported with the compendium's tables, a Leader figures axis stands before Role, its default As printed", !!src && at("leaderSource") < at("role") && src.default === "printed" && src.options.join() === "printed,axioms", { axes: after.axes.map((a) => a.key) });
  }

  section("standalone 1: a creature outside a family");
  const pick = [];
  for (const id of STANDALONE_IDS) {
    const c = await held(gm, id, "monster");
    if (c) pick.push({ ...c, cb: id });
  }
  const creature = pick[0] ?? null;
  if (!creature) {
    unreachable("standalone: the world holds none of the creatures whose pages name leaders, and importing one is the importer walk's subject");
    return;
  }
  note("standalone creature", { cb: creature.cb, uuid: creature.uuid, created: creature.created });
  const lt = await leadersOf(gm, creature);
  note("leaders template", { found: !!lt.tpl, minted: lt.minted });
  check("beside the creature, a leaders template under its id with .leaders, minted by Repair in place where none was held", !!lt.tpl && lt.tpl.leadersOf === creature.cb, { found: !!lt.tpl, minted: lt.minted });
  if (lt.tpl) {
    const sh = await run(gm, P.shape, { actorId: lt.tpl.id });
    const cr = await held(gm, creature.cb, "monster");
    check("the creature keeps its own id; the template names it under leadersOf", cr?.uuid === creature.uuid && sh.cbId === `${creature.cb}.leaders` && sh.leadersOf === creature.cb, { same: cr?.uuid === creature.uuid });
    check("and the template is named with the (leaders) suffix", / \(leaders\)$/.test(sh.name), {});
    const variant = sh.axes.find((a) => a.key === "variant");
    check("standalone 7: beside the family, the leaders template holds the creature alone and is no family's", variant?.options.length === 1 && sh.cbId !== FAMILY_ID, { variants: variant?.options.length });
  }
  note("not checked", "a creature whose page names no leader minting no template: the world holds those creatures already, and repairing one more corpus document is not this walk's to do");
}

/* ------------------------------------------------------------------ */
/*  Stage 2: a family's roles                                           */
/* ------------------------------------------------------------------ */

async function stageRoles(gm) {
  const family = await held(gm, FAMILY_ID, TEMPLATE);
  if (!family) throw new Error(`no ${FAMILY_ID} template in the world`);
  const map = await run(gm, P.roleMap, { actorId: family.id });
  note("role map", map);
  const shape = await run(gm, P.shape, { actorId: family.id });

  section("roles 1: the Role axis");
  await run(gm, P.openTemplate, { actorId: family.id });
  await run(gm, P.pin, { pins: [] });
  let sel = await run(gm, P.selects);
  const role = sel.find((s) => s.axis === "role");
  const ORDER = ["standard", "champion", "subChieftain", "chieftain", "shaman", "witchDoctor", "drudge", "whelp"];
  const keys = role?.options.map((o) => o.key) ?? [];
  check("the Role axis lists Standard first and the printed roles in MODEL's order", keys[0] === "standard" && keys.every((k, i) => i === 0 || ORDER.indexOf(k) > ORDER.indexOf(keys[i - 1])), { keys });
  check("every role on the axis is one some kind's page prints", keys.slice(1).every((k) => map.byRole[k]?.length > 0), { keys });
  check("its roll line reads the default, Standard", /Standard/.test(role?.blank ?? "") && !/d\d/.test(role?.blank ?? ""), { blank: role?.blank });

  section("roles 2: what a kind prints");
  const variants = shape.axes.find((a) => a.key === "variant").options;
  // The family's overview member is its prose, never a variant, and a repair does not carry it back.
  const memberIds = [];
  for (const v of variants) memberIds.push((await run(gm, P.memberCb, { templateId: family.id, variant: v })).id);
  check("the Variant axis holds no overview member: every option is a kind with a page of its own", !memberIds.includes(OVERVIEW_ID), { variants: variants.length });
  const onlyFor = (v) => Object.entries(map.byRole).filter(([, vs]) => vs.length === 1 && vs[0] === v).map(([r]) => r);
  const elsewhere = (v) => Object.entries(map.byRole).filter(([, vs]) => !vs.includes(v)).map(([r]) => r);
  // Failing a kind that prints a role of its own, one that prints none of the roles shows the disabled marks.
  const kind = variants.find((v) => onlyFor(v).length && elsewhere(v).length) ?? variants.find((v) => elsewhere(v).length && map.byRole.champion?.includes(v)) ?? variants.find((v) => elsewhere(v).length);
  note("kind pinned", { kind, own: kind ? onlyFor(kind) : [], others: kind ? elsewhere(kind) : [] });
  if (kind) {
    await run(gm, P.pin, { pins: [["variant", kind]] });
    sel = await run(gm, P.selects);
    const opts = sel.find((s) => s.axis === "role")?.options ?? [];
    const of = (k) => opts.find((o) => o.key === k);
    const own = onlyFor(kind);
    if (own.length) check("a role printed for this kind alone is enabled", own.every((k) => of(k) && !of(k).disabled), { own });
    else note("not walked this run", "no role is printed for one kind alone; every enabled role checked instead");
    check("every role this kind's page prints is enabled", (map.byRole ? Object.entries(map.byRole).filter(([, vs]) => vs.includes(kind)).map(([r]) => r) : []).every((k) => of(k) && !of(k).disabled), {});
    const other = elsewhere(kind);
    check("a role printed only for other kinds is disabled, its label saying so, with a tooltip", other.length > 0 && other.every((k) => of(k)?.disabled && of(k).marked && of(k).tip === "ACKS-LIB.template.unavailableTip"), { other: other.map((k) => ({ k, shown: !!of(k), disabled: of(k)?.disabled ?? null, marked: of(k)?.marked ?? null, tip: of(k)?.tip ?? null })), member: await run(gm, P.memberCb, { templateId: family.id, variant: kind }) });
  } else {
    if (Object.values(map.byRole).every((vs) => vs.length === variants.length)) note("not walked this run", "every kind's page prints every role, so no role is unavailable for one kind and not another");
    else check("some kind's page prints a role another's does not", false, { byRole: Object.keys(map.byRole) });
  }
  if (SHOTS) {
    const plateKind = kind ?? variants[0];
    await gm.compose(`#${(await run(gm, P.openTemplate, { actorId: family.id })).id}`);
    await run(gm, P.pin, { pins: [["variant", plateKind], ["role", map.leaders.find((l) => l.variant === plateKind)?.role ?? "standard"]] });
    await sleep(800);
    note("plate", await plate(gm, "monsters-roles.png", "template"));
  }

  section("roles 3: the rank and file by default");
  const standardKind = kind ?? variants[0];
  const stdReads = [];
  for (let n = 0; n < 5; n++) {
    const g = await gen(gm, family.id, [["variant", standardKind]]);
    if (g.read) stdReads.push(g.read);
  }
  check("five generations with Role blank make five", stdReads.length === 5, { made: stdReads.length });
  check("each is the Standard member, the log sourcing role from the default", stdReads.every((r) => r.choices.role === "standard" && r.log.some((l) => l.axis === "role" && l.source === "default") && !r.log.some((l) => l.axis === "role" && l.source === "rolled")), { logs: stdReads.map((r) => r.log.find((l) => l.axis === "role")?.source ?? null) });

  section("roles 4: a leader's own figures");
  const leader = map.leaders.find((l) => l.variant === kind) ?? map.leaders[0];
  note("leader pinned", leader ?? null);
  let leaderId = null;
  if (leader) {
    const g = await gen(gm, family.id, [["variant", leader.variant], ["role", leader.role]]);
    leaderId = g.ids[0] ?? null;
    const fig = leaderId ? await run(gm, P.leaderFigures, { templateId: family.id, actorId: leaderId, ...leader }) : null;
    note("leader figures", fig);
    check("hp.hd and extras.hd hold the leader's Hit Dice, which are its own", !!fig && fig.hdIsCell && fig.extrasHd && fig.hdDiffers, fig ?? g.pinned);
    check("its armour class and hit points are the leader's", !!fig && fig.acIsCell && fig.hpIsCell !== false, fig ?? {});
    check("its throw is the member's moved by what the world's ladder adds between the two rows", !!fig && fig.throwIsCell && fig.throwIsLadder, fig ?? {});
    check("its saves are the cell's, at the save level MODEL derives", !!fig && fig.savesMatch && fig.saveLevel, fig ?? {});
    check("roles 6: its XP is the role's figure where the cell prints one, else the member's", !!fig && (fig.cellXp ? fig.xpIsCell : fig.xpIsMember), { cellXp: fig?.cellXp });

    section("roles 4a and 5: what the Statblock names");
    await run(gm, P.openFms, { actorId: leaderId });
    const tips = await run(gm, P.tips);
    const throwSaid = await run(gm, P.tipHas, { text: tips.atk[0]?.throwTip ?? "", words: ["member's", "rows", "HD"] });
    check("the throw's tooltip names the member's throw and HD, the rows moved and the leader's HD", tips.atk.length > 0 && Object.values(throwSaid).every(Boolean), { said: throwSaid });
    const cite = await gm.eval(`globalThis.__ml.T.citeOf("monsters", "attackThrowByHd") ?? ""`);
    check("and the ladder's citation", !!cite && (await run(gm, P.tipHas, { text: tips.atk[0]?.throwTip ?? "", words: [cite] }))[cite], {});
    const saveSaid = await run(gm, P.tipHas, { text: tips.save, words: ["member's level", "HD"] });
    check("the save's tooltip names the member's save level and HD and the leader's", Object.values(saveSaid).every(Boolean), { said: saveSaid });
    if (fig?.modTotal) {
      // An attack row with no damage formula shows a dash and has no formula to add to.
      const dealt = tips.atk.filter((a) => a.tag && a.tag !== "—");
      check("roles 5: a role printing a damage bonus shows it after each attack's formula, the tooltip naming both", dealt.length > 0 && dealt.every((a) => /[+-]\s*\d+$/.test(a.tag) && !!a.dmgTip), { rows: tips.atk.map((a) => ({ signed: /[+-]\s*\d+$/.test(a.tag), tip: !!a.dmgTip, dash: a.tag === "—" || a.tag === "" })) });
    } else {
      check("roles 5: a role printing no damage bonus shows the bare formula", tips.atk.every((a) => !a.dmgTip), { tags: tips.atk.length });
    }
    const weapon = (await run(gm, P.read, { actorId: leaderId })).weapons[0];
    if (weapon && fig?.modTotal) {
      const rolled = await run(gm, P.rollAttack, { actorId: leaderId, itemId: weapon });
      for (const id of rolled.posted ?? []) cards.push(gm.track(id, "ChatMessage"));
      const once = await run(gm, P.modOnce, { formulas: rolled.formulas ?? [], mod: fig.modTotal });
      check("a weapon attack's damage card carries the modifier once", rolled.posted?.length > 0 && once.any && once.never2, { posted: rolled.posted?.length, formulas: (rolled.formulas ?? []).length, d20: (rolled.formulas ?? []).map((x) => /d20/.test(String(x))), signed: (rolled.formulas ?? []).map((x) => /[+-]\s*\d+(?!\d*d)/.test(String(x))), ...once });
    } else {
      note("not walked this run", "the leader rolled has no weapon or no damage bonus; the card check needs both");
    }
    const typed = await run(gm, P.typeField, { actorId: leaderId, name: "system.attack.throw", value: TYPED_THROW });
    const after = await run(gm, P.tips);
    check("a throw typed on Classification loses the throw's tooltip", typed.landed && after.atk.every((a) => !a.throwTip), { landed: typed.landed });
    await run(gm, P.closeAll);
  } else {
    check("the family has a leader whose cell prints its own Hit Dice", false, {});
  }

  section("roles 4c: the Judge's own ladder");
  if (leader) {
    const key = await run(gm, P.ladderKeyOf, { templateId: family.id, ...leader });
    const ov = await run(gm, P.overrideLadder, { key, shift: OVERRIDE_SHIFT });
    note("override", ov);
    if (ov.had) {
      note("not walked this run", "the world already holds a Judge's override of the ladder; the run will not write over it");
    } else if (ov.set) {
      owed.ladder = true;
      owed.familyRepair = true;
      check("the override stands in the registry, with no page cited", ov.landed && !ov.cited, ov);
      const done = await repairRows(gm, [`Monsters|${FAMILY_ID}`]);
      await run(gm, P.openTemplate, { actorId: family.id });
      const g = await gen(gm, family.id, [["variant", leader.variant], ["role", leader.role]]);
      const fig = g.ids[0] ? await run(gm, P.leaderFigures, { templateId: family.id, actorId: g.ids[0], ...leader }) : null;
      check("after a repair the leader's throw follows the overridden row", done.ok && !!fig && fig.throwIsLadder, fig ?? {});
      if (g.ids[0]) {
        await run(gm, P.openFms, { actorId: g.ids[0] });
        const tips = await run(gm, P.tips);
        const said = await run(gm, P.tipHas, { text: tips.atk[0]?.throwTip ?? "", words: ["the Judge's own ladder"] });
        check("and its tooltip names the Judge's own ladder in place of a page", said["the Judge's own ladder"], {});
        await run(gm, P.closeAll);
      }
      note("override cleared", await run(gm, P.clearLadder));
      owed.ladder = false;
      const back = await repairRows(gm, [`Monsters|${FAMILY_ID}`]);
      if (back.ok) owed.familyRepair = false;
      const sh = await run(gm, P.shape, { actorId: family.id });
      check("the override reverted and the template repaired back onto the imported ladder", back.ok && sh.throwMissing === 0, { ok: back.ok });
    }
  }

  section("roles 7: a caster");
  const caster = map.casters.find((c) => c.variant === kind) ?? map.casters[0];
  if (caster) {
    await run(gm, P.openTemplate, { actorId: family.id });
    const a = await gen(gm, family.id, [["variant", caster.variant], ["role", caster.role]]);
    const b = await gen(gm, family.id, [["variant", caster.variant], ["role", caster.role]]);
    const ok = (r) => !!r && typeof r.ex.spellcasting?.class === "string" && !!r.ex.spellcasting.class && Number.isInteger(r.ex.spellcasting.level) && r.log.some((l) => l.axis === "casterLevel" && l.source === "rolled");
    check("a caster carries its class word and an integer level, the log its roll", ok(a.read) && ok(b.read), { a: ok(a.read), b: ok(b.read) });
    note("caster levels differ this run", a.read?.ex.spellcasting?.level !== b.read?.ex.spellcasting?.level);
    const s = a.ids[0] ? await run(gm, P.casterSlots, { actorId: a.ids[0] }) : null;
    if (!s?.classHeld) note("not checked", "the slot maxes: no imported class document answers the caster's class word in this world");
    else if (!s.rowAtLevel) note("not checked", "the slot maxes: the class prints no slot row at the rolled level");
    else {
      check("a caster's slots are its class's row at its rolled level, with the slot block on", s.enabled && s.match, { enabled: s.enabled, match: s.match });
      check("its spells are drawn from the imported ones within its slots", s.spells > 0 && s.spells <= s.slotTotal, { spells: s.spells, slots: s.slotTotal });
    }
  } else {
    note("not walked this run", "no kind's page prints a caster");
  }

  section("roles 8: a dependant that does not fight");
  const dep = map.dependants[0];
  if (dep) {
    await run(gm, P.openTemplate, { actorId: family.id });
    const g = await gen(gm, family.id, [["variant", dep.variant], ["role", dep.role]]);
    const r = g.read;
    check("no attacks, the damage total zero, noncombatant", !!r && r.weapons.length === 0 && Number(r.mod?.melee ?? 0) === 0 && Number(r.mod?.missile ?? 0) === 0 && r.ex.noncombatant, { weapons: r?.weapons.length, noncombatant: r?.ex.noncombatant });
  } else {
    note("not walked this run", "no kind's page prints a dependant with figures of its own");
  }
  await run(gm, P.closeAll);
  return { family, kind, map };
}

/* ------------------------------------------------------------------ */
/*  Stage 3: leaders outside a family, and the kit                      */
/* ------------------------------------------------------------------ */

async function stageKit(gm) {
  const family = await held(gm, FAMILY_ID, TEMPLATE);
  if (!family) throw new Error(`no ${FAMILY_ID} template in the world`);
  let creature = null;
  for (const id of STANDALONE_IDS) {
    const c = await held(gm, id, "monster");
    if (c) { creature = { ...c, cb: id }; break; }
  }
  const lt = creature ? await leadersOf(gm, creature) : { tpl: null };
  let leaders = lt.tpl;
  if (!leaders) unreachable("standalone 2-8: no creature outside a family with a leaders template");
  if (leaders) {

  section("standalone 2-4: the leaders template");
  const sh = await run(gm, P.shape, { actorId: leaders.id });
  const lmap = await run(gm, P.roleMap, { actorId: leaders.id });
  await run(gm, P.openTemplate, { actorId: leaders.id });
  await run(gm, P.pin, { pins: [] });
  let sel = await run(gm, P.selects);
  check("no Variant select, a Role select reading Standard, and the printed roles", !sel.some((s) => s.axis === "variant") && /Standard/.test(sel.find((s) => s.axis === "role")?.blank ?? "") && (sel.find((s) => s.axis === "role")?.options.length ?? 0) > 1, { axes: sel.map((s) => s.axis) });
  if (SHOTS) {
    const id = await gm.eval(`globalThis.__ml.tsheet.id`);
    await gm.compose(`#${id}`);
    await run(gm, P.openTemplate, { actorId: leaders.id });
    const sid = await gm.eval(`globalThis.__ml.tsheet.id`);
    await sleep(800);
    note("plate", await gm.shot(`${shotDir()}/monsters-standalone-leaders.png`, `#${sid}`));
  }
  const variantKey = sh.axes.find((a) => a.key === "variant").options[0];
  const plain = await gen(gm, leaders.id, []);
  const crName = creature.name;
  check("generated with nothing pinned: the creature itself, named as the import, role from the default", !!plain.read && plain.read.name === crName && plain.read.log.some((l) => l.axis === "role" && l.source === "default"), { named: plain.read?.name === crName });
  const sLeader = lmap.leaders[0];
  if (sLeader) {
    const g = await gen(gm, leaders.id, [["role", sLeader.role]]);
    const fig = g.ids[0] ? await run(gm, P.leaderFigures, { templateId: leaders.id, actorId: g.ids[0], ...sLeader }) : null;
    note("standalone leader", fig);
    check("the printed leader's armour class, hit points and own Hit Dice", !!fig && fig.acIsCell && fig.hpIsCell !== false && fig.hdIsCell && fig.extrasHd, fig ?? g.pinned);
    check("its throw and saves moved as a family leader's", !!fig && fig.throwIsLadder && fig.savesMatch && fig.saveLevel, fig ?? {});
    if (g.ids[0]) {
      await run(gm, P.openFms, { actorId: g.ids[0] });
      const tips = await run(gm, P.tips);
      const cite = await gm.eval(`fromUuid(${JSON.stringify(creature.uuid)}).then((a) => a.flags["acks-extras"].cookbook.cite ?? "")`);
      const said = await run(gm, P.tipHas, { text: tips.ac, words: [cite] });
      check("the rail's armour class tooltip names the MM page", !!cite && said[cite], {});
      await run(gm, P.closeAll);
    }
  } else {
    check("the leaders template holds a printed leader", false, { roles: Object.keys(lmap.byRole) });
  }
  if (!AXC) unreachable("standalone 5: a beastman-type creature's procedure leaders need the AXIOMS Compendium's tables");
  else note("walked in stage 7", "standalone 5");
  note("variant", variantKey);

  section("standalone 6: Repair in place on the creature");
  const before = await run(gm, P.shape, { actorId: leaders.id });
  const r1 = await repairRows(gm, [`Monsters|${creature.cb}`]);
  const after = await run(gm, P.shape, { actorId: leaders.id });
  check("the template keeps its id and its cells", r1.ok && after.id === before.id && JSON.stringify(after.cells) === JSON.stringify(before.cells), { ok: r1.ok, same: after.id === before.id });
  if (minted.includes(leaders.uuid)) {
    // Only a template this run minted is this run's to delete.
    note("deleted", await gm.sweepTracked({ only: [leaders.uuid] }));
    minted.splice(minted.indexOf(leaders.uuid), 1);
    const r2 = await repairRows(gm, [`Monsters|${creature.cb}`]);
    const back = await held(gm, `${creature.cb}.leaders`, TEMPLATE);
    check("deleted, the template comes back on the next repair", r2.ok && !!back && back.leadersOf === creature.cb, { ok: r2.ok, back: !!back });
    if (back) {
      minted.push(gm.track(back.uuid));
      leaders = back;
      const again = await run(gm, P.shape, { actorId: leaders.id });
      check("with the cells a fresh import writes", JSON.stringify(again.cells) === JSON.stringify(before.cells), {});
    }
  } else {
    note("not walked this run", "the leaders template was held before the run, so deleting it is not this run's to do");
  }
  }

  section("kit 1: the troop rows");
  const rows = await run(gm, P.kitRows);
  note("kit rows", rows);
  check("beastmanTroops holds whole rows, cited, each kind's kit words read", rows.raw > 0 && rows.troops === rows.raw && rows.allWhole && rows.troopsCited && rows.withNote > 0, { raw: rows.raw, troops: rows.troops, whole: rows.allWhole });
  check("and no mounted rows", rows.mounted === 0, {});
  note("not checked", "three troop rows against the printed page: a walk prints no page figure, so that comparison is the reader's with the book open");
  if (!rows.byType) unreachable("kit 1: beastmenByType and damageDieConversion are the AXIOMS Compendium's");
  else check("beastmenByType holds a natural armour class per kind and damageDieConversion its header row and dice, both citing AXIOMS", rows.byType > 0 && rows.byTypeAxioms && rows.dice > 1 && rows.diceHeader && rows.diceAxioms, { byType: rows.byType, dice: rows.dice, header: rows.diceHeader });

  section("kit 2-3: the Kit axis");
  const fshape = await run(gm, P.shape, { actorId: family.id });
  const fmap = await run(gm, P.roleMap, { actorId: family.id });
  const kitAxis = fshape.axes.find((a) => a.key === "kit");
  check("the family has a Kit axis after Role, its default Stat block", !!kitAxis && fshape.axes.findIndex((a) => a.key === "kit") > fshape.axes.findIndex((a) => a.key === "role") && kitAxis.default === "own", { axes: fshape.axes.map((a) => a.key) });
  await run(gm, P.openTemplate, { actorId: family.id });
  await run(gm, P.pin, { pins: [] });
  let sel = await run(gm, P.selects);
  check("its roll line reads the default, Stat block", /Stat block/.test(sel.find((s) => s.axis === "kit")?.blank ?? ""), { blank: sel.find((s) => s.axis === "kit")?.blank });
  const kinds = fshape.axes.find((a) => a.key === "variant").options;
  const kind = kinds.find((v) => (rows.troopsByKind[v.toLowerCase()] ?? []).length > 0 && fmap.leaders.some((l) => l.variant === v)) ?? kinds.find((v) => (rows.troopsByKind[v.toLowerCase()] ?? []).length > 0);
  const own = rows.troopsByKind[kind?.toLowerCase()] ?? [];
  note("kit kind", { kind, troops: own });
  let trooperId = null;
  if (kind) {
    await run(gm, P.pin, { pins: [["variant", kind], ["role", "standard"]] });
    sel = await run(gm, P.selects);
    const kopts = sel.find((s) => s.axis === "kit")?.options ?? [];
    const others = kopts.filter((o) => o.key !== "own" && o.key !== "unarmoured" && !own.includes(o.key));
    check("the troop types this kind's row prints are enabled", own.every((t) => kopts.find((o) => o.key === t && !o.disabled)), { own });
    check("a troop type printed only for another kind is disabled", others.length === 0 || others.every((o) => o.disabled), { others: others.length });
    if (!rows.byType) unreachable("kit 3: Unarmoured is offered only with the AXIOMS Compendium's natural armour classes");
    else if (rows.byTypeKinds.includes(kind.toLowerCase())) check("and so is Unarmoured", !!kopts.find((o) => o.key === "unarmoured" && !o.disabled), {});
    else note("not walked this run", "the natural armour class table has no row for this kind");
    const dep = fmap.dependants.find((d) => d.variant === kind) ?? fmap.dependants[0];
    if (dep) {
      await run(gm, P.pin, { pins: [["variant", dep.variant], ["role", dep.role]] });
      sel = await run(gm, P.selects);
      const k = sel.find((s) => s.axis === "kit");
      check("pinning a dependant leaves the Kit axis offering Stat block alone", !k || k.options.every((o) => o.key === "own" || o.disabled), { shown: !!k });
    } else {
      note("not walked this run", "no dependant role to pin");
    }

    section("kit 4: a trooper");
    const troop = own[0];
    const plainStd = await gen(gm, family.id, [["variant", kind], ["role", "standard"]]);
    const g = await gen(gm, family.id, [["variant", kind], ["role", "standard"], ["kit", troop]]);
    trooperId = g.ids[0] ?? null;
    const kf = trooperId ? await run(gm, P.kitFigures, { templateId: family.id, actorId: trooperId, variant: kind, role: "standard", troop }) : null;
    note("trooper", kf);
    check("armour class, damage modifier (melee and missile), move and morale are the row's", !!kf && kf.row && kf.ac && kf.modRow && kf.move !== false && kf.morale !== false, kf ?? g.pinned);
    check("it carries no item the stat block did not", !!g.read && JSON.stringify(g.read.items) === JSON.stringify(plainStd.read?.items ?? []), {});
    check("its notes and its biography carry the kit's words and the rulebook's citation", !!kf && kf.notesKit && kf.bioKit, { notes: kf?.notesKit, bio: kf?.bioKit });
    if (trooperId) {
      await run(gm, P.openFms, { actorId: trooperId });
      const tips = await run(gm, P.tips);
      const cite = kf?.cite ?? "\u0000";
      const has = async (text) => (await run(gm, P.tipHas, { text, words: [cite, "troop row"] }));
      const ac = await has(tips.ac);
      const mo = await has(tips.morale);
      const dm = await has(tips.atk.map((a) => a.dmgTip).join(" "));
      check("the rail's armour class and the morale row each name the troop row and its page", ac[cite] && mo[cite] && ac["troop row"] && mo["troop row"], { ac: ac[cite], morale: mo[cite] });
      // A row whose modifier is zero adds nothing to a damage roll, so its tag carries no tooltip to name it.
      if (kf?.modTotal) check("and a weapon's damage tag names the troop row and its page", dm[cite] && dm["troop row"], { damage: dm[cite] });
      else note("not walked this run", "the troop row's damage modifier is zero, so no damage tag names it");
      if (SHOTS) {
        const id = await gm.eval(`globalThis.__ml.fms.id`);
        await gm.compose(`#${id}`);
        await run(gm, P.openFms, { actorId: trooperId });
        await sleep(1000);
        const tip = await run(gm, P.showAcTip);
        check("plate: the rail's armour class tooltip is open, naming the troop row", tip.cell && tip.shown, tip);
        note("plate", await plate(gm, "monsters-kit.png", "fms"));
      }
    }

    section("kit 5: a printed leader in a troop's kit");
    const kl = fmap.leaders.find((l) => l.variant === kind);
    if (kl) {
      await run(gm, P.openTemplate, { actorId: family.id });
      const lg = await gen(gm, family.id, [["variant", kind], ["role", kl.role], ["kit", troop]]);
      const lf = lg.ids[0] ? await run(gm, P.kitFigures, { templateId: family.id, actorId: lg.ids[0], variant: kind, role: kl.role, troop }) : null;
      note("kit leader", lf);
      check("armour class is the row's plus the leader's over its warrior's, its parts recorded", !!lf && lf.ac && lf.derivedKit?.value && lf.derivedKit?.step, lf ?? lg.pinned);
      check("the damage modifier is the leader's own; move and morale are the row's", !!lf && lf.modLeader && lf.move !== false && lf.morale !== false, lf ?? {});
      if (lg.ids[0]) {
        await run(gm, P.openFms, { actorId: lg.ids[0] });
        const tips = await run(gm, P.tips);
        const said = await run(gm, P.tipHas, { text: tips.ac, words: [lf?.cite ?? "\u0000", "worked out at generation", "over its warrior's"] });
        check("the rail's tooltip names the four figures and the row's page", Object.values(said).every(Boolean), { said });
        await run(gm, P.closeAll);
      }
      if (!AXC) unreachable("kit 5: the same with Leader figures on the AXIOMS procedure needs the compendium");
    } else {
      note("not walked this run", "this kind's page prints no leader");
    }
    if (!AXC) unreachable("kit 6-8: Unarmoured, the die conversion and the natural-armour override are the AXIOMS Compendium's");
    else note("walked in stage 7", "kit 5 on the AXIOMS procedure, and kit 6-8");

    section("kit 9: a typed armour class");
    if (trooperId) {
      await run(gm, P.openFms, { actorId: trooperId });
      const typed = await run(gm, P.typeField, { actorId: trooperId, name: "system.ac.value", value: TYPED_AC });
      const tips = await run(gm, P.tips);
      const plainLabel = await gm.eval(`game.i18n.format("ACKS-MONSTERS.frame.rail.ac", { n: ${TYPED_AC} })`);
      check("the rail's cell then reads its plain label", typed.landed && tips.ac === plainLabel, { landed: typed.landed });
      await run(gm, P.closeAll);
    }
  } else {
    check("some kind of the family has troop rows", false, { kinds: Object.keys(rows.troopsByKind) });
  }
  return { family, leaders, trooperId, troop: own[0], kind };
}

/* ------------------------------------------------------------------ */
/*  Stages 4 and 5: the AXIOMS procedure                                */
/* ------------------------------------------------------------------ */

/** The pins that generate one procedure cell. */
const derivedPins = (c) => (c.alone ? [["role", c.role]] : c.underSource ?[["variant", c.variant], ["leaderSource", "axioms"], ["role", c.role]] : [["variant", c.variant], ["role", c.role]]);

/** Generate one procedure cell's leader and compare it in the page. */
async function genDerived(api, templateId, c) {
  await run(api, P.openTemplate, { actorId: templateId });
  const g = await gen(api, templateId, derivedPins(c));
  const fig = g.ids[0] ? await run(api, P.derivedFigures, { templateId, actorId: g.ids[0], cellKey: c.key, variant: c.variant }) : null;
  return { id: g.ids[0] ?? null, fig, pinned: g.pinned };
}

/** Repair the family and wait; the debt is recorded while an override shapes it. */
async function repairFamily(api) {
  const r = await repairRows(api, [`Monsters|${FAMILY_ID}`]);
  owed.familyRepair = owed.overrides.size > 0 || !r.ok;
  return r;
}

async function stageAxioms(gm) {
  const family = await held(gm, FAMILY_ID, TEMPLATE);
  if (!family) throw new Error(`no ${FAMILY_ID} template in the world`);
  const tables = await run(gm, P.tables);
  if (!tables.tables.leaderSteps) throw new Error("the compendium's tables are not imported: run STAGE=1 first");
  const cells = await run(gm, P.derivedCells, { templateId: family.id });
  note("procedure cells", { total: cells.length, underSource: cells.filter((c) => c.underSource).length, multiplied: cells.filter((c) => c.carried === "multiplied").length });

  section("roles 11: the Leader figures axis on the sheet");
  await run(gm, P.openTemplate, { actorId: family.id });
  await run(gm, P.pin, { pins: [] });
  let sel = await run(gm, P.selects);
  const at = (k) => sel.findIndex((s) => s.axis === k);
  const srcSel = sel.find((s) => s.axis === "leaderSource");
  check("the sheet shows Leader figures before Role, its roll line reading As printed", !!srcSel && at("leaderSource") < at("role") && /As printed/.test(srcSel.blank) && !/d\d/.test(srcSel.blank), { axes: sel.map((s) => s.axis) });

  section("roles 12: a chieftain by the procedure, and as printed");
  const chiefs = cells.filter((c) => c.role === "chieftain" && c.underSource);
  // A kind under the axis prints at least one leader, not always a chieftain: the printed leg pins one it prints.
  const printedOf = {};
  for (const c of chiefs) printedOf[c.variant] = (await run(gm, P.printedRoles, { templateId: family.id, variant: c.variant })).filter((r) => ["champion", "subChieftain", "chieftain"].includes(r));
  const chief = chiefs.find((c) => c.carried === "multiplied" && printedOf[c.variant].includes("chieftain")) ?? chiefs.find((c) => printedOf[c.variant].includes("chieftain")) ?? chiefs.find((c) => c.carried === "multiplied") ?? chiefs[0];
  note("chieftain cell", chief ?? null);
  let axId = null;
  let prId = null;
  if (chief) {
    const d = await genDerived(gm, family.id, chief);
    axId = d.id;
    note("derived chieftain", d.fig);
    const f = d.fig;
    check("hp.hd and extras.hd hold the derived rating", !!f && f.source && f.hdIsCell && f.extrasHd, f ?? d.pinned);
    check("armour class and damage are the member's plus the role's additions, on the system's fields", !!f && f.acParts && f.acHeld && f.damageParts && f.damageHeld, f ?? {});
    check("the hit points are a roll of those dice, the log's hitPoints line rolled", !!f && f.hpRolled, {});
    if (axId) {
      await run(gm, P.openFms, { actorId: axId });
      const tips = await run(gm, P.tips);
      const hp = tips.hpNote.join(" ");
      const words = ["AXIOMS", "rungs", "member's", f?.cite || "\u0000"];
      if (f?.carried === "multiplied") words.push(`multiplied by ${f.factorIs}`);
      const said = await run(gm, P.tipHas, { text: hp, words });
      check(`the hit-point note names the member's rating, armour and damage, the rungs, the AXIOMS citation${f?.carried === "multiplied" ? " and the factor the bonus was multiplied by" : ""}`, Object.values(said).every(Boolean), { said: Object.fromEntries(Object.entries(said).map(([k, v]) => [k === f?.cite ? "cite" : k.startsWith("multiplied") ? "factor" : k, v])) });
      if (f?.carried === "multiplied") check("the factor is the imported bonusFactorChieftain, and the bonus the member's times it", f.factorIsSteps && f.bonusMultiplied, { factor: f.factorIsSteps, bonus: f.bonusMultiplied });
      else note("not walked this run", "no kind under the Leader figures axis has a member whose hit-point bonus carries, so the factor is stage 5's");
      section("roles 12a: the rail's armour class, derived");
      const acSaid = await run(gm, P.tipHas, { text: tips.ac, words: ["member's", f?.cite || "\u0000"] });
      check("the derived one names the member's armour class, the rank's addition and the AXIOMS citation", acSaid["member's"] && acSaid[f?.cite || "\u0000"], { member: acSaid["member's"] });
      await run(gm, P.closeAll);
    }
    await run(gm, P.openTemplate, { actorId: family.id });
    const printedRole = printedOf[chief.variant].includes("chieftain") ? "chieftain" : printedOf[chief.variant].at(-1);
    note("printed leg", { role: printedRole ?? null });
    const p = await gen(gm, family.id, [["variant", chief.variant], ["leaderSource", "printed"], ["role", printedRole]]);
    prId = p.ids[0] ?? null;
    const memberCite = await run(gm, P.memberCite, { templateId: family.id, variant: chief.variant });
    const printedLeader = p.read?.ex.derived?.leader?.source === "printed";
    check("pinned As printed instead, the printed leader's figures", printedLeader, { source: p.read?.ex.derived?.leader?.source ?? null });
    if (prId) {
      await run(gm, P.openFms, { actorId: prId });
      const tips = await run(gm, P.tips);
      const hpSaid = await run(gm, P.tipHas, { text: tips.hpNote.join(" "), words: [memberCite || "\u0000"] });
      const acSaid = await run(gm, P.tipHas, { text: tips.ac, words: [memberCite || "\u0000"] });
      check("and the note's tooltip names the MM page", !!memberCite && hpSaid[memberCite], {});
      check("12a: the As printed one's armour class names the MM page", !!memberCite && acSaid[memberCite], {});
      await run(gm, P.closeAll);
    }
    if (axId) {
      section("roles 12a: a typed armour class");
      await run(gm, P.openFms, { actorId: axId });
      const typed = await run(gm, P.typeField, { actorId: axId, name: "system.ac.value", value: TYPED_AC });
      const tips = await run(gm, P.tips);
      const plainLabel = await gm.eval(`game.i18n.format("ACKS-MONSTERS.frame.rail.ac", { n: ${TYPED_AC} })`);
      check("typed on Classification, the cell reads its plain label", typed.landed && tips.ac === plainLabel, { landed: typed.landed });
      await run(gm, P.closeAll);
    }
  } else {
    check("some kind whose page prints leaders has a procedure chieftain under Leader figures", false, { cells: cells.length });
  }

  section("roles 13: a kind whose page prints no leaders");
  const bare = cells.filter((c) => !c.underSource);
  const bareKind = bare.find((c) => c.role === "chieftain")?.variant ?? bare[0]?.variant;
  note("kind", bareKind ?? null);
  if (bareKind) {
    await run(gm, P.openTemplate, { actorId: family.id });
    await run(gm, P.pin, { pins: [["variant", bareKind]] });
    sel = await run(gm, P.selects);
    const opts = sel.find((s) => s.axis === "role")?.options ?? [];
    const printedRoles = await run(gm, P.printedRoles, { templateId: family.id, variant: bareKind });
    const of = (k) => opts.find((o) => o.key === k);
    check("the Leader figures axis is gone", !sel.some((s) => s.axis === "leaderSource"), { axes: sel.map((s) => s.axis) });
    check("champion, sub-chieftain and chieftain are enabled on Role", ["champion", "subChieftain", "chieftain"].filter((k) => bare.some((c) => c.variant === bareKind && c.role === k)).every((k) => of(k) && !of(k).disabled), { roles: opts.map((o) => o.key) });
    check("shaman, witch doctor, drudge and whelp are disabled unless the page prints them", ["shaman", "witchDoctor", "drudge", "whelp"].every((k) => !of(k) || of(k).disabled === !printedRoles.includes(k)), { printed: printedRoles.length });
    const c = bare.find((x) => x.variant === bareKind && x.role === "chieftain") ?? bare.find((x) => x.variant === bareKind);
    const d = await genDerived(gm, family.id, c);
    if (d.id) {
      await run(gm, P.openFms, { actorId: d.id });
      const tips = await run(gm, P.tips);
      const cite = d.fig?.cite || "\u0000";
      const hp = await run(gm, P.tipHas, { text: tips.hpNote.join(" "), words: [cite, "AXIOMS"] });
      const ac = await run(gm, P.tipHas, { text: tips.ac, words: [cite] });
      check(`a generated ${c.role}'s hit-point note and armour class name the AXIOMS procedure, never the printed page`, d.fig?.citeAxioms && hp[cite] && hp.AXIOMS && ac[cite], { hp: hp[cite], ac: ac[cite] });
      await run(gm, P.closeAll);
    }
    await run(gm, P.openTemplate, { actorId: family.id });
    await run(gm, P.pin, { pins: [] });
    sel = await run(gm, P.selects);
    check("the kind pin cleared, the Leader figures axis is back, reading As printed", /As printed/.test(sel.find((s) => s.axis === "leaderSource")?.blank ?? ""), {});
  } else {
    // Every kind of the family may print leaders; the procedure-only shape is then the standalone template's (stage 7).
    if (cells.length && cells.every((c) => c.underSource)) note("not reachable", "roles 13: every kind of the family prints leaders, so none has the procedure's cells alone");
    else check("some kind's page prints no leaders and has procedure cells", false, {});
  }

  if (SHOTS && chief) {
    section("plate: monsters-leader-figures");
    await run(gm, P.openTemplate, { actorId: family.id });
    const id = await gm.eval(`globalThis.__ml.tsheet.id`);
    await gm.compose(`#${id}`);
    await run(gm, P.openTemplate, { actorId: family.id });
    await run(gm, P.pin, { pins: derivedPins(chief) });
    await sleep(800);
    note("plate", await plate(gm, "monsters-leader-figures.png", "template"));
  }
  await run(gm, P.closeAll);
  return { family, chief };
}

async function stageAxiomsOverrides(gm) {
  const family = await held(gm, FAMILY_ID, TEMPLATE);
  if (!family) throw new Error(`no ${FAMILY_ID} template in the world`);
  let cells = await run(gm, P.derivedCells, { templateId: family.id });
  if (!cells.length) throw new Error("the family holds no procedure cell: run STAGE=1 first");

  section("roles 12b: the Judge's own chieftain factor");
  const pick = cells.find((c) => c.role === "chieftain" && c.carried === "multiplied");
  if (!pick) {
    check("some kind's member carries a hit-point bonus a chieftain multiplies", false, { chieftains: cells.filter((c) => c.role === "chieftain").length });
  } else {
    const ov = await override(gm, { table: "leaderSteps", field: "bonusFactorChieftain", value: INVENTED_FACTOR });
    if (ov.had) note("not walked this run", "the world already holds a Judge's override of leaderSteps; the run will not write over it");
    else if (!ov.set) check("leaderSteps carries bonusFactorChieftain to override", false, ov);
    else {
      await repairFamily(gm);
      const d = await genDerived(gm, family.id, pick);
      note("overridden chieftain", d.fig);
      check("the chieftain's bonus is the member's times the overriding factor", !!d.fig && d.fig.factorIs === INVENTED_FACTOR && d.fig.bonusMultiplied, d.fig ?? d.pinned);
      if (d.id) {
        await run(gm, P.openFms, { actorId: d.id });
        const tips = await run(gm, P.tips);
        const said = await run(gm, P.tipHas, { text: tips.hpNote.join(" "), words: [`multiplied by ${INVENTED_FACTOR}`] });
        check("and the tooltip names the override's factor", said[`multiplied by ${INVENTED_FACTOR}`], {});
        await run(gm, P.closeAll);
      }
      await revert(gm, "leaderSteps");
      const back = await repairFamily(gm);
      cells = await run(gm, P.derivedCells, { templateId: family.id });
      check("reverted and repaired, the chieftain is the imported factor's again", back.ok && cells.some((c) => c.key === pick.key && c.carried === "multiplied"), { ok: back.ok });
    }
  }
  await run(gm, P.closeAll);
}

async function stageAxiomsBlank(gm) {
  const family = await held(gm, FAMILY_ID, TEMPLATE);
  if (!family) throw new Error(`no ${FAMILY_ID} template in the world`);
  let cells = await run(gm, P.derivedCells, { templateId: family.id });

  section("roles 14: a procedure missing a figure");
  const printedBefore = (await run(gm, P.roleMap, { actorId: family.id })).leaders.length;
  const ov14 = await override(gm, { table: "leaderSteps", field: "rowsChampion", value: "" });
  if (ov14.had) note("not walked this run", "the world already holds a Judge's override of leaderSteps");
  else if (!ov14.set) check("leaderSteps carries a champion's rungs to blank", false, ov14);
  else {
    const r = await repairFamily(gm);
    const sh = await run(gm, P.shape, { actorId: family.id });
    const none = await run(gm, P.derivedCells, { templateId: family.id });
    const printedAfter = (await run(gm, P.roleMap, { actorId: family.id })).leaders.length;
    check("no derived cell and no AXIOMS option; the printed leaders stand", r.ok && none.length === 0 && !sh.axes.some((a) => a.key === "leaderSource") && printedAfter === printedBefore && printedAfter > 0, { cells: none.length, printed: printedAfter === printedBefore });
    await revert(gm, "leaderSteps");
    const back = await repairFamily(gm);
    cells = await run(gm, P.derivedCells, { templateId: family.id });
    check("reverted and repaired, the procedure's cells are back", back.ok && cells.length > 0, { ok: back.ok });
  }
  await run(gm, P.closeAll);
}

async function stageAxiomsKit(gm) {
  const family = await held(gm, FAMILY_ID, TEMPLATE);
  if (!family) throw new Error(`no ${FAMILY_ID} template in the world`);
  const cells = await run(gm, P.derivedCells, { templateId: family.id });
  if (!cells.length) throw new Error("the family holds no procedure cell: run STAGE=1 first");

  section("standalone 5: a beastman-type creature whose page prints no leader");
  let creature = null;
  for (const id of NO_LEADER_IDS) {
    const c = await held(gm, id, "monster");
    if (c) { creature = { ...c, cb: id }; break; }
  }
  if (!creature) {
    unreachable("standalone 5: the world holds none of the beastman-type creatures whose page names no leader");
  } else {
    const lt = await leadersOf(gm, creature);
    note("derived leaders template", { found: !!lt.tpl, minted: lt.minted });
    if (lt.tpl) {
      const sh = await run(gm, P.shape, { actorId: lt.tpl.id });
      const role = sh.axes.find((a) => a.key === "role")?.options ?? [];
      check("champion, sub-chieftain and chieftain on Role, no Leader figures axis", ["champion", "subChieftain", "chieftain"].every((k) => role.includes(k)) && !sh.axes.some((a) => a.key === "leaderSource"), { roles: role, axes: sh.axes.map((a) => a.key) });
      const sc = (await run(gm, P.derivedCells, { templateId: lt.tpl.id })).find((c) => c.role === "chieftain");
      if (sc) {
        // The template's Variant axis holds the creature alone, so the builder renders no Variant select to pin.
        const d = await genDerived(gm, lt.tpl.id, { ...sc, underSource: false, alone: true });
        if (!d.id) check("the procedure chieftain generates", false, d.pinned ?? {});
        if (d.id) {
          await run(gm, P.openFms, { actorId: d.id });
          const tips = await run(gm, P.tips);
          const cite = d.fig?.cite || "\u0000";
          const hp = await run(gm, P.tipHas, { text: tips.hpNote.join(" "), words: [cite] });
          const ac = await run(gm, P.tipHas, { text: tips.ac, words: [cite] });
          check("a generated chieftain's tooltips name the AXIOMS procedure, and its hit points are rolled", d.fig?.citeAxioms && hp[cite] && ac[cite] && d.fig.hpRolled, { hp: hp[cite], ac: ac[cite], rolled: d.fig?.hpRolled });
          await run(gm, P.closeAll);
        }
      } else {
        check("the template holds a procedure chieftain", false, {});
      }
    } else {
      check("with the procedure imported, a repair mints the creature a leaders template", false, {});
    }
  }

  section("kit 5, 6 and 7: the procedure's leader in a troop's kit, Unarmoured, the die");
  const rows = await run(gm, P.kitRows);
  const kitKind = cells.find((c) => c.role === "chieftain" && (rows.troopsByKind[c.variant.toLowerCase()] ?? []).length && rows.byTypeKinds.includes(c.variant.toLowerCase()));
  note("kit kind", kitKind ? { variant: kitKind.variant, underSource: kitKind.underSource } : null);
  let unarmouredStd = null;
  if (kitKind) {
    const troop = rows.troopsByKind[kitKind.variant.toLowerCase()][0];
    await run(gm, P.openTemplate, { actorId: family.id });
    const lg = await gen(gm, family.id, [...derivedPins(kitKind), ["kit", troop]]);
    const lf = lg.ids[0] ? await run(gm, P.kitFigures, { templateId: family.id, actorId: lg.ids[0], variant: kitKind.variant, role: "chieftain", troop, cellKey: kitKind.key }) : null;
    note("kit leader, procedure", lf);
    check("kit 5: on the AXIOMS procedure, the leader's derived armour class is the one moved", !!lf && lf.ac && lf.derivedKit?.value && lf.derivedKit?.step, lf ?? lg.pinned);

    await run(gm, P.openTemplate, { actorId: family.id });
    const std = await gen(gm, family.id, [["variant", kitKind.variant], ["role", "standard"]]);
    const un = await gen(gm, family.id, [["variant", kitKind.variant], ["role", "standard"], ["kit", "unarmoured"]]);
    unarmouredStd = un.ids[0] ?? null;
    if (unarmouredStd) {
      const nat = await run(gm, P.naturalAc, { actorId: unarmouredStd, variant: kitKind.variant });
      check("kit 6: Unarmoured on Standard takes the kind's natural armour class", nat.row && nat.isNatural, { row: nat.row });
      check("the damage modifier and move are the stat block's", JSON.stringify(un.read?.mod) === JSON.stringify(std.read?.mod) && un.read?.move === std.read?.move, {});
      await run(gm, P.openFms, { actorId: unarmouredStd });
      const tips = await run(gm, P.tips);
      const said = await run(gm, P.tipHas, { text: tips.ac, words: [nat.cite || "\u0000"] });
      check("its armour class tooltip names the AXIOMS page", !!nat.cite && said[nat.cite], {});
      await run(gm, P.closeAll);
    } else {
      check("Unarmoured is offered for a kind the natural table prints", false, un.pinned);
    }

    const holder = lg.ids[0] ?? null;
    const conv = holder ? await run(gm, P.convertible, { actorId: holder }) : { mod: false };
    note("die conversion", conv);
    if (conv.die) {
      await run(gm, P.openFms, { actorId: holder });
      const shown = await run(gm, P.dieTipShown, { itemId: conv.itemId });
      check("kit 7: a weapon's damage tag ends with the die the table prints for its die and modifier, and the AXIOMS page", shown.row && shown.said, shown);
      await run(gm, P.closeAll);
    } else {
      check("kit 7: the leader carries a damage modifier the conversion table prints a die for", false, conv);
    }

    section("kit 8: the natural armour class blanked");
    const ov8 = await override(gm, { table: "beastmenByType", rowKind: kitKind.variant, field: "naturalAc", value: "" });
    if (ov8.had) note("not walked this run", "the world already holds a Judge's override of beastmenByType");
    else if (!ov8.set) check("beastmenByType has the kind's row to blank", false, ov8);
    else {
      // The recipe generates again with no repair; a repair under the override is walked after it, apart.
      const unarmouredAgain = async (label) => {
        await run(gm, P.openTemplate, { actorId: family.id });
        const again = await gen(gm, family.id, [["variant", kitKind.variant], ["role", "standard"], ["kit", "unarmoured"]]);
        if (!again.ids[0]) return { offered: false, pinned: again.pinned };
        await run(gm, P.openFms, { actorId: again.ids[0] });
        const tips = await run(gm, P.tips);
        const said = await run(gm, P.tipHas, { text: tips.ac, words: ["unarmoured", "natural", "troop row"] });
        await run(gm, P.closeAll);
        const out = { offered: true, statBlock: again.read?.ac === std.read?.ac, noKitPart: !Object.values(said).some(Boolean) };
        note(label, out);
        return out;
      };
      const plain = await unarmouredAgain("generated with no repair");
      check("generated again with the figure blanked: the stat block's armour class, and a tooltip that names no kit part", plain.offered && plain.statBlock && plain.noKitPart, plain);
      await repairFamily(gm);
      const repaired = await unarmouredAgain("generated after a repair under the override");
      note("after a repair under the override", repaired.offered ? repaired : { offered: false });
      await revert(gm, "beastmenByType");
      const back = await repairFamily(gm);
      const sel = await (async () => { await run(gm, P.openTemplate, { actorId: family.id }); await run(gm, P.pin, { pins: [["variant", kitKind.variant], ["role", "standard"]] }); return run(gm, P.selects); })();
      check("reverted and repaired, Unarmoured is offered again", back.ok && !!sel.find((s) => s.axis === "kit")?.options.find((o) => o.key === "unarmoured" && !o.disabled), { ok: back.ok });
    }
  } else {
    check("some kind has a procedure chieftain, troop rows and a natural armour class", false, {});
  }
  await run(gm, P.closeAll);
}

/* ------------------------------------------------------------------ */
/*  The Player seat                                                     */
/* ------------------------------------------------------------------ */

async function stagePlayer(gm, ctx) {
  section("the Player seat, observing");
  // The family and the leaders template live in the library pack, which the
  // Player observes through the pack's own ownership; only the generated
  // trooper, a world document this run built, needs a grant.
  const family = ctx?.family ?? await held(gm, FAMILY_ID, TEMPLATE);
  let leaders = ctx?.leaders ?? null;
  if (!leaders) for (const id of STANDALONE_IDS) { leaders = await held(gm, `${id}.leaders`, TEMPLATE); if (leaders) break; }
  if (ctx?.trooperId) note("granted Observer", { trooper: await run(gm, P.grantObserver, { actorId: ctx.trooperId, name: MACHINE.player }) });
  const player = await connect({ browser, origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  try {
    note("player ready after (s)", await ready(player, "player"));
    const census = await run(player, P.install);
    check("the Player seat is no GM", !census.isGM, {});
    if (family) {
      await run(player, P.openTemplate, { actorId: family.id });
      const map = await run(gm, P.roleMap, { actorId: family.id });
      const sel = await run(player, P.selects);
      const role = sel.find((s) => s.axis === "role");
      check("roles 9: the Role select renders, Generate is absent, the select carries no name", !!role && !(await run(player, P.generateShown)) && sel.every((s) => !s.name), { role: !!role });
      const kind = ctx?.kind ?? Object.values(map.byRole)[0]?.[0];
      const pinned = await run(player, P.observePin, { actorId: family.id, pins: [["variant", kind]] });
      const after = await run(player, P.selects);
      const remarked = after.find((s) => s.axis === "role")?.options.some((o) => o.disabled && o.marked);
      const unavailable = Object.values(map.byRole).some((vs) => !vs.includes(kind));
      if (unavailable) check("pinning the kind re-marks the Role options with nothing written", pinned.ok && pinned.attempted === 0 && pinned.unchanged && remarked, { ...pinned, remarked });
      else check("pinning the kind writes nothing; every role is printed for every kind, so none is re-marked", pinned.ok && pinned.attempted === 0 && pinned.unchanged, { ...pinned });
      const chief = (await run(gm, P.derivedCells, { templateId: family.id })).find((c) => c.underSource);
      if (chief) {
        await run(player, P.openTemplate, { actorId: family.id });
        const src = (await run(player, P.selects)).find((s) => s.axis === "leaderSource");
        const p15 = await run(player, P.observePin, { actorId: family.id, pins: [["variant", chief.variant], ["leaderSource", "axioms"]] });
        check("roles 15: the Leader figures select renders and pins without writing", !!src && !src.name && p15.ok && p15.attempted === 0 && p15.unchanged && !(await run(player, P.generateShown)), { shown: !!src, ...p15 });
      } else if (!AXC) {
        unreachable("roles 15: the Leader figures select is the AXIOMS Compendium's");
      } else {
        check("roles 15: the family has a Leader figures axis to observe", false, {});
      }
    }
    if (leaders) {
      await run(player, P.openTemplate, { actorId: leaders.id });
      const sel = await run(player, P.selects);
      const role = sel.find((s) => s.axis === "role");
      const pinned = role?.options.find((o) => !o.disabled) ? await run(player, P.observePin, { actorId: leaders.id, pins: [["role", role.options.find((o) => !o.disabled).key]] }) : { ok: false };
      check("standalone 8: the Role select renders and pins without writing, and Generate is absent", !!role && pinned.ok && pinned.attempted === 0 && pinned.unchanged && !(await run(player, P.generateShown)), { ...pinned });
    }
    if (ctx?.trooperId) {
      const gmTips = await (async () => { await run(gm, P.openFms, { actorId: ctx.trooperId }); const t = await run(gm, P.tips); await run(gm, P.closeAll); return t; })();
      await run(player, P.openFms, { actorId: ctx.trooperId });
      const pTips = await run(player, P.tips);
      check("kit 10: the armour class, morale and damage tooltips render as on the GM seat", !!pTips.morale && pTips.ac === gmTips.ac && pTips.morale === gmTips.morale && JSON.stringify(pTips.atk.map((a) => a.dmgTip)) === JSON.stringify(gmTips.atk.map((a) => a.dmgTip)), {});
      const notes = await player.eval(`(() => { const a = game.actors.get(${JSON.stringify(ctx.trooperId)}); return String(a.flags["acks-extras"]?.extras?.description?.notes ?? "").length > 0 && !!globalThis.__ml.root(globalThis.__ml.fms); })()`);
      const shown = await player.eval(`(async () => { const H = globalThis.__ml; const a = game.actors.get(${JSON.stringify(ctx.trooperId)}); const notes = String(a.flags["acks-extras"]?.extras?.description?.notes ?? ""); const probe = document.createElement("div"); probe.innerHTML = notes; const words = H.text(probe).slice(0, 24); for (const tab of ["description", "notes", "lore"]) { try { await H.fms.changeTab(tab, "primary"); } catch {} await H.sleep(300); if (H.text(H.root(H.fms)).includes(words)) return true; } return false; })()`);
      check("and the notes show the kit line", notes && shown, { notes, shown });
    }
    await run(player, P.closeAll);
  } finally {
    try { await player.close(); } catch {}
  }
}

/* ------------------------------------------------------------------ */
/*  Walk                                                                */
/* ------------------------------------------------------------------ */

let gm = null;
let raw = null;
try {
  section("seat");
  gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  note("gm ready after (s)", await ready(gm, "gm"));
  if (STAGES.includes(1)) {
    const token = `ml-${Date.now()}`;
    await gm.eval(`globalThis.__mlToken = ${JSON.stringify(token)}`);
    raw = await rawSeat(PORTS.gm, token);
    await raw.send("Page.enable");
    await raw.send("Page.addScriptToEvaluateOnNewDocument", { source: RECORDER });
    await raw.send("Page.reload");
    await sleep(1500);
    note("reloaded under the recorder, ready after (s)", await ready(gm, "gm"));
  }
  const installed = await run(gm, P.install);
  note("install", { module: installed.module, isGM: installed.isGM, activeGMIsSelf: installed.activeGMIsSelf });
  check("the GM seat is the active GM", installed.isGM && installed.activeGMIsSelf, {});
  if (!installed.activeGMIsSelf) blocked("another GM client is the active GM");

  if (STAGES.includes(1)) await stageSetup(gm);
  if (STAGES.includes(2)) {
    if (!STAGES.includes(1)) await openBooks(gm, ["mm"]);
    await stageRoles(gm);
  }
  let ctx = null;
  if (STAGES.includes(3)) {
    if (!STAGES.includes(1) && !STAGES.includes(2)) await openBooks(gm, ["mm"]);
    ctx = await stageKit(gm);
  }
  const axStages = STAGES.filter((s) => s >= 4);
  if (axStages.length && !AXC) unreachable("stages 4-7: no map names axc");
  else if (axStages.length) {
    // A repair reads the member pages again, so the books it reads stay open on this seat.
    if (!STAGES.some((s) => s <= 3)) await openBooks(gm, ["mm", "axc"]);
    else if (!STAGES.includes(1)) await openBooks(gm, ["axc"]);
    if (STAGES.includes(4)) await stageAxioms(gm);
    if (STAGES.includes(5)) await stageAxiomsOverrides(gm);
    if (STAGES.includes(6)) await stageAxiomsBlank(gm);
    if (STAGES.includes(7)) await stageAxiomsKit(gm);
  }
  if (STAGES.some((s) => s >= 2)) await stagePlayer(gm, ctx);
  walkDone();
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err?.message ?? err);
  checks.push(["the walk ran to its end", false]);
} finally {
  tearing = true;
  section("teardown");
  if (raw) raw.close();
  if (gm) {
    for (const table of [...owed.overrides]) {
      try { note(`override ${table} cleared`, await run(gm, P.clearTable, { table })); owed.familyRepair = true; } catch (err) { console.error(`clear ${table}:`, err?.message ?? err); }
    }
    if (owed.ladder) {
      try { note("override cleared", await run(gm, P.clearLadder)); } catch (err) { console.error("clear override:", err?.message ?? err); }
    }
    if (owed.tablesOn) {
      try { note("monster tables mirrored back", await run(gm, P.tablesOn)); } catch (err) { console.error("tables on:", err?.message ?? err); }
    }
    if (owed.familyRepair) {
      // The family was last repaired with the ladder out of shape; repair it again with the tables as they stand.
      try { await run(gm, P.closeAll); note("family repaired back", await repairRows(gm, [`Monsters|${FAMILY_ID}`])); } catch (err) { console.error("family repair:", err?.message ?? err); }
    }
    try { note("closed", await run(gm, P.closeAll)); } catch (err) { console.error("closeAll:", err?.message ?? err); }
    try { note("swept", await gm.sweepTracked({ only: [...generated, ...cards, ...minted] })); } catch (err) { console.error("sweep:", err?.message ?? err); }
    try { gm.close(); } catch {}
  }
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
