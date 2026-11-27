/**
 * Live closing walk, close-map-import: one check for each control the
 * topics fix-map-ui and fix-import-data changed, on the GM seat only.
 *
 * fix-map-ui, 7e93cdeb (docs/battlemap/TESTING.md, "Map modes" and the wall
 * sheet rows; step 16's mode names):
 *   - a wall sheet's road row: the street select and the name field are
 *     disabled under "Not a road", enable at once on a surface pick, and a
 *     typed street and name reach the flag;
 *   - a wall sheet's water row: the boat tick and the name field, the same;
 *   - Map modes: the opacity control carries its figure and its names, is
 *     disabled in Terrain with a visible reason, and under a mode the figure
 *     follows the drag and the view is written on release;
 *   - the map assistant's "Party system here" options carry the party
 *     sheet's own mode names. The nav words are not walked here (battlemap-nav).
 *
 * fix-import-data, e1e86786 (T-0781) and 97dafd11 (T-0762):
 *   - a positive override row of the `monsters` `sizeSquare` table and of the
 *     `formation` `roundsPerTurn` and `turnsPerHour` tables, put through the
 *     table-store's own override write (the layer the Ruledata Browser
 *     uses), moves sizeSquareFeet, roundsPerTurn, turnsPerHour and
 *     turnSeconds; clearing it brings the constants back. The figures are
 *     invented; the world's own override is restored per table.
 *   - applyBuilderImport keeps a Judge's hand edit to a class's builder leaf
 *     and race link (heldBuilderLeaves) and a forced apply writes over it.
 *     Driven on a class and a race this run builds, under an in-memory
 *     stand-in for the builder document that holds one invented run-in; the
 *     walk asserts before the apply that exactly that class is the only
 *     match and refuses to apply otherwise. It never sets SHELF_OK or REBUILD_OK.
 *
 * Fixtures: the scene `battlemap/close-map-ui` (kept, found by marker); its
 * two walls, the builder walk's class and race are built every run and swept
 * by uuid. Client state undone in `finally`: the Map modes view, the viewed
 * scene, the registry's stand-in builder layer, each override this run wrote.
 * Nothing printed is a book figure: booleans and comparisons only.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";
import { walkDone } from "./_walk.mjs";

const MACHINE = machineSeats();
const MOD = "acks-extras";
const BASE = "/modules/acks-extras/scripts/";

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const heading = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/* ------------------------------------------------------------------ */
/*  Page side (each function is stringified; values arrive as args)    */
/* ------------------------------------------------------------------ */

const P = {
  census: async () => ({
    role: game.user.role,
    active: game.users.filter((u) => u.active).map((u) => [u.name, u.isGM]),
    activeGM: game.users.activeGM?.name ?? null,
    activeGMIsSelf: !!game.users.activeGM?.isSelf,
    viewed: canvas?.scene?.id ?? null,
  }),

  /** The wall sheet's road and water rows: read, open, or drive one control. */
  wall: async ({ uuid, op, target, value, wait }) => {
    const nap = (ms) => new Promise((r) => setTimeout(r, ms));
    const wall = await fromUuid(uuid);
    const SEL = {
      roadSurface: ".acks-extras-road-surface", roadStreet: ".acks-extras-road-street", roadName: ".acks-extras-road-name",
      waterKind: ".acks-extras-water-kind", waterNav: ".acks-extras-water-navigable", waterName: ".acks-extras-water-name",
    };
    const root = () => wall.sheet?.element ?? null;
    const read = () => {
      const o = {};
      for (const [k, sel] of Object.entries(SEL)) {
        const c = root()?.querySelector(sel);
        o[k] = c ? { disabled: c.disabled, value: k === "waterNav" ? c.checked : c.value } : null;
      }
      return o;
    };
    const flags = () => ({ road: wall.getFlag("acks-extras", "road") ?? null, water: wall.getFlag("acks-extras", "water") ?? null });
    const ready = () => !!root()?.querySelector(SEL.roadSurface) && !!root()?.querySelector(SEL.waterKind);
    if (op === "open") {
      await wall.unsetFlag("acks-extras", "road");
      await wall.unsetFlag("acks-extras", "water");
      await wall.sheet.close?.();
      await wall.sheet.render({ force: true });
      for (let i = 0; i < 60 && !ready(); i++) await nap(100);
      return { ready: ready(), controls: read(), flags: flags(), roadSurfaces: [...root().querySelectorAll(`${SEL.roadSurface} option`)].map((o) => o.value).filter(Boolean) };
    }
    if (op === "read") return { ready: ready(), controls: read(), flags: flags() };
    if (op === "set") {
      const c = root()?.querySelector(SEL[target]);
      if (!c) return { missing: true };
      if (c.disabled) return { refused: true, controls: read(), flags: flags() };
      if (c.type === "checkbox") c.checked = !!value;
      else c.value = value;
      if (c.type === "text") c.dispatchEvent(new Event("input", { bubbles: true }));
      c.dispatchEvent(new Event("change", { bubbles: true }));
      const atOnce = read();
      const done = () => {
        const f = flags()[wait.flag];
        if (wait.absent) return f == null;
        return f != null && f[wait.path] === wait.equals;
      };
      for (let i = 0; i < 60 && !done(); i++) await nap(100);
      await nap(500);
      return { atOnce, settled: read(), flags: flags(), landed: done() };
    }
    return null;
  },

  /** The Map modes window: open under a mode, read the opacity row, pick a pill, drag the slider. */
  modes: async ({ op, sceneUuid, mode, key, value }) => {
    const nap = (ms) => new Promise((r) => setTimeout(r, ms));
    const MM = await import("/modules/acks-extras/scripts/battlemap/map-modes.mjs");
    const H = (globalThis.__cm = globalThis.__cm ?? {});
    const app = () => foundry.applications.instances.get("acks-extras-map-modes");
    const read = () => {
      const el = app()?.element;
      const input = el?.querySelector('input[name="opacity"]');
      const out = el?.querySelector(".acks-extras-map-opacity-figure");
      return {
        window: !!el,
        input: !!input,
        disabled: input?.disabled ?? null,
        value: input?.value ?? null,
        figure: out?.textContent?.trim() ?? null,
        figureIsOutput: out?.tagName === "OUTPUT",
        aria: input?.getAttribute("aria-label") ?? null,
        ariaOk: input?.getAttribute("aria-label") === game.i18n.localize("ACKS-BATTLEMAP.mapMode.opacity"),
        tooltipKey: input?.getAttribute("data-tooltip") ?? null,
        tooltipOk: input?.getAttribute("data-tooltip") === "ACKS-BATTLEMAP.mapMode.opacityTip",
        reasonShown: !!el && el.textContent.includes(game.i18n.localize("ACKS-BATTLEMAP.mapMode.opacityTerrain")),
        figureMatches: !!input && out?.textContent?.trim() === game.i18n.format("ACKS-BATTLEMAP.mapMode.opacityFigure", { value: input.value }),
        pills: [...(el?.querySelectorAll('button[data-action="pickMode"]') ?? [])].map((b) => b.dataset.mode),
        active: el?.querySelector('button[data-action="pickMode"].is-active')?.dataset.mode ?? null,
        view: MM.mapView(),
      };
    };
    const until = async (fn, tries = 60) => { for (let i = 0; i < tries && !fn(); i++) await nap(100); return fn(); };
    if (op === "open") {
      H.view ??= MM.mapView();
      H.viewed ??= canvas?.scene?.id ?? null;
      const scene = await fromUuid(sceneUuid);
      if (canvas?.scene?.id !== scene.id) await scene.view();
      await MM.setMapView({ mode });
      MM.openMapModes();
      const ok = await until(() => app()?.element?.querySelector('input[name="opacity"]') && app().element.querySelector(`button.is-active[data-mode="${mode}"]`));
      await nap(300);
      return { opened: !!ok, ...read() };
    }
    if (op === "read") return read();
    if (op === "pick") {
      const btn = app().element.querySelector(`button[data-action="pickMode"][data-mode="${key}"]`);
      btn.click();
      const ok = await until(() => app()?.element?.querySelector(`button.is-active[data-mode="${key}"]`));
      await nap(300);
      return { picked: !!ok, ...read() };
    }
    if (op === "drag") {
      const input = app().element.querySelector('input[name="opacity"]');
      const before = MM.mapView().opacity;
      input.value = String(value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      const mid = read();
      await nap(300);
      const midHeld = MM.mapView().opacity === before;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      const wrote = await until(() => Math.abs(MM.mapView().opacity - value / 100) < 1e-9);
      return { figureDuringDrag: mid.figure, figureFollows: mid.figure === game.i18n.format("ACKS-BATTLEMAP.mapMode.opacityFigure", { value: String(value) }), viewHeldDuringDrag: midHeld, viewWritten: !!wrote, view: MM.mapView() };
    }
    return null;
  },

  /** The map assistant's "Party system here" options against the party sheet's mode names. */
  assistant: async ({ sceneUuid }) => {
    const nap = (ms) => new Promise((r) => setTimeout(r, ms));
    const H = (globalThis.__cm = globalThis.__cm ?? {});
    H.viewed ??= canvas?.scene?.id ?? null;
    const scene = await fromUuid(sceneUuid);
    const A = await import("/modules/acks-extras/scripts/battlemap/assistant-app.mjs");
    const app = await A.openAssistant(scene);
    const sel = () => app?.element?.querySelector('select[name="mapSystem"]');
    for (let i = 0; i < 80 && !sel(); i++) await nap(100);
    const L = (k) => game.i18n.localize(k);
    const expected = {
      delve: L("ACKS-FORMATION.strip.modeDelve"),
      journey: L("ACKS-FORMATION.travel.legend"),
      settlement: L("ACKS-FORMATION.settlement.legend"),
    };
    const options = [...(sel()?.querySelectorAll("option") ?? [])].map((o) => ({ value: o.value, text: o.textContent.trim() }));
    const hint = app?.element?.textContent ?? "";
    return {
      found: !!sel(),
      optionValues: options.map((o) => o.value),
      noneIsNotDeclared: options.find((o) => o.value === "")?.text === L("ACKS-BATTLEMAP.setup.systemNone"),
      sameAsPartySheet: Object.fromEntries(Object.entries(expected).map(([k, text]) => [k, options.find((o) => o.value === k)?.text === text])),
      hintNamesThem: Object.fromEntries(Object.entries(expected).map(([k, text]) => [k, hint.includes(text)])),
      viewed: canvas?.scene?.id === scene.id,
    };
  },

  /** Close every window this walk opened and put the seat's view and viewed scene back. */
  restore: async () => {
    const H = globalThis.__cm ?? {};
    for (const id of ["acks-extras-map-modes", "acks-extras-battlemap"]) {
      try { await foundry.applications.instances.get(id)?.close(); } catch { /* already closed */ }
    }
    if (H.view) {
      const MM = await import("/modules/acks-extras/scripts/battlemap/map-modes.mjs");
      await MM.setMapView(H.view);
    }
    if (H.viewed && canvas?.scene?.id !== H.viewed) await game.scenes.get(H.viewed)?.view();
    return { view: H.view ?? null, viewed: H.viewed ?? null, nowViewed: canvas?.scene?.id ?? null };
  },

  /**
   * T-0781: the three override tables, put through the table-store's override
   * write, read through the four readers, cleared, and each table's prior
   * override put back. One function so the stand-in figures are live for the
   * shortest window and a `finally` restores them in the same breath.
   */
  units: async ({ sizeFeet, rounds, turns }) => {
    const nap = (ms) => new Promise((r) => setTimeout(r, ms));
    const T = await import(BASE + "lib/tables.mjs");
    const TU = await import(BASE + "lib/time-unit.mjs");
    const SZ = await import(BASE + "monsters/sizes.mjs");
    const DC = await import(BASE + "lib/distance-units.mjs");
    const TS = await import(BASE + "location/table-store.mjs");
    const WHERE = [
      { doc: "monsters", id: "sizeSquare", figure: { squares: { feet: sizeFeet } } },
      { doc: "formation", id: "roundsPerTurn", figure: rounds },
      { doc: "formation", id: "turnsPerHour", figure: turns },
    ];
    const read = () => ({ sq: SZ.sizeSquareFeet(), rpt: TU.roundsPerTurn(), tph: TU.turnsPerHour(), ts: TU.turnSeconds(), tpd: TU.turnsPerDay(), rs: TU.roundSeconds() });
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const settle = async (want) => { for (let i = 0; i < 40 && !same(read(), want); i++) await nap(100); return read(); };
    const out = { steps: {} };
    // What each table held before this run: the world layer and any override of a Judge's own.
    const prior = WHERE.map((w) => {
      const store = game.settings.get("acks-extras", "importedTables") ?? {};
      const entry = store[`${w.doc}:${T.PRIORITY.OVERRIDE}`]?.doc;
      return {
        ...w,
        world: T.getLayer(w.doc, T.PRIORITY.WORLD)?.tables?.[w.id] != null,
        had: TS.hasOverride(w.doc, w.id),
        data: entry?.tables?.[w.id] !== undefined ? structuredClone(entry.tables[w.id]) : undefined,
        meta: entry?._meta?.[w.id] ? (({ time, ...m }) => m)(structuredClone(entry._meta[w.id])) : {},
      };
    });
    out.worldHoldsTable = prior.map((p) => p.world);
    out.judgeHadOverride = prior.map((p) => p.had);
    const restore = async () => {
      for (const p of prior) {
        if (p.had) await TS.setOverride(p.doc, p.id, p.data, p.meta);
        else if (TS.hasOverride(p.doc, p.id)) await TS.clearOverride(p.doc, p.id);
      }
    };
    try {
      // The reading with no override of ours standing is the baseline.
      for (const p of prior) if (p.had) await TS.clearOverride(p.doc, p.id);
      const base = await settle(read());
      out.baseline = base;
      out.baselineIsConstants = !out.worldHoldsTable.some(Boolean)
        ? { sq: base.sq === DC.SQUARE_FEET, rpt: base.rpt === TU.ROUNDS_PER_TURN, tph: base.tph === TU.TURNS_PER_HOUR }
        : "world holds a table: baseline is the import's, not the constants";
      out.figuresDifferFromBaseline = sizeFeet !== base.sq && rounds !== base.rpt && turns !== base.tph;
      // A positive override on all three, through the override write.
      for (const w of WHERE) await TS.setOverride(w.doc, w.id, w.figure, { source: "close-map-import" });
      const want = { sq: sizeFeet, rpt: rounds, tph: turns, ts: TU.SECONDS_PER_HOUR / turns, tpd: turns * TU.HOURS_PER_DAY, rs: TU.SECONDS_PER_HOUR / turns / rounds };
      const got = await settle(want);
      out.steps.override = {
        sizeSquareFeet: got.sq === sizeFeet, roundsPerTurn: got.rpt === rounds, turnsPerHour: got.tph === turns,
        turnSeconds: got.ts === TU.SECONDS_PER_HOUR / turns, turnsPerDay: got.tpd === turns * TU.HOURS_PER_DAY,
        roundSeconds: got.rs === TU.SECONDS_PER_HOUR / turns / rounds,
        layerHoldsRow: WHERE.map((w) => T.getLayer(w.doc, T.PRIORITY.OVERRIDE)?.tables?.[w.id] != null),
      };
      // A figure that is not a positive whole number (a counts table) or not positive (the square) leaves the constant.
      await TS.setOverride("monsters", "sizeSquare", { squares: { feet: 0 } }, { source: "close-map-import" });
      await TS.setOverride("formation", "roundsPerTurn", 2.5, { source: "close-map-import" });
      await TS.setOverride("formation", "turnsPerHour", 0, { source: "close-map-import" });
      const bad = await settle({ ...base });
      out.steps.badFigures = { sq: bad.sq === base.sq, rpt: bad.rpt === base.rpt, tph: bad.tph === base.tph, ts: bad.ts === base.ts };
      // Removing the override brings the baseline back.
      for (const w of WHERE) await TS.clearOverride(w.doc, w.id);
      const gone = await settle(base);
      out.steps.removed = { all: same(gone, base), sq: gone.sq === base.sq, rpt: gone.rpt === base.rpt, tph: gone.tph === base.tph, ts: gone.ts === base.ts, layerEmpty: WHERE.map((w) => T.getLayer(w.doc, T.PRIORITY.OVERRIDE)?.tables?.[w.id] == null) };
    } finally {
      await restore();
      const back = await settle(out.baseline ?? read());
      out.restored = {
        readersBack: !out.baseline || same(back, out.baseline),
        overrides: WHERE.map((w, i) => TS.hasOverride(w.doc, w.id) === prior[i].had),
        values: prior.map((p) => !p.had || same(T.getLayer(p.doc, T.PRIORITY.OVERRIDE)?.tables?.[p.id], p.data)),
      };
    }
    return out;
  },

  /** T-0762, step 0: a free cookbook id for the walk's class and the race key, read only. */
  builderProbe: async () => {
    const CB = await import(BASE + "importer/cookbook.mjs");
    const entries = CB.cookbookContentFile("classes")?.entries ?? {};
    const ids = Object.keys(entries);
    let classId = null;
    for (const id of ids) {
      if (!(await CB.importedItemFor(id))) { classId = id; break; }
    }
    const raceId = "def.race.people2";
    const BB = await import(BASE + "importer/builder-binding.mjs");
    const T = await import(BASE + "lib/tables.mjs");
    // With no free id the walk drives a real imported class and race (the world may be written, and is put back).
    const real = {};
    if (!classId) {
      for (const id of ids) {
        const doc = await CB.importedItemFor(id);
        if (doc?.type === "acks-extras.class") { Object.assign(real, { classId: id, classUuid: doc.uuid, label: doc.name }); break; }
      }
    }
    const raceDoc = await CB.importedItemFor(raceId);
    if (raceDoc) Object.assign(real, { raceUuid: raceDoc.uuid, raceLabel: raceDoc.name });
    return {
      shippedClassIds: ids.length,
      classId,
      raceId,
      raceFree: !(await CB.importedItemFor(raceId)),
      worldLayerHeld: T.getLayer(BB.BUILDER_DOC_ID, T.PRIORITY.WORLD) != null,
      real,
    };
  },

  /**
   * T-0762: drive the apply on the class and race this run built. Refuses before
   * the apply unless exactly the walk's class is the only run-in match and the
   * walk's race is the only holder of its id; restores the registry layer after.
   */
  builder: async ({ classUuid, raceUuid, classId, raceId, label, raceLabel, restoreClass = false, restoreRace = false }) => {
    const nap = (ms) => new Promise((r) => setTimeout(r, ms));
    const CB = await import(BASE + "importer/cookbook.mjs");
    const TG = await import(BASE + "importer/cookbook/target.mjs");
    const BB = await import(BASE + "importer/builder-binding.mjs");
    const RF = await import(BASE + "importer/refresh.mjs");
    const T = await import(BASE + "lib/tables.mjs");
    const out = { steps: {} };
    const cls = await fromUuid(classUuid);
    const race = await fromUuid(raceUuid);
    const builderOf = () => {
      const b = cls.toObject().system?.builder ?? {};
      return { hd: b.hdValue, fighting: b.fighting?.value, thievery: b.thievery?.value, raceRung: b.race?.value, magic: (b.magic ?? []).map((m) => [m.type, m.value]), link: cls.toObject().system?.race };
    };
    const stampOf = () => cls.toObject().flags?.["acks-extras"]?.cookbook?.read?.builder;
    const text = `hd 3 fighting 2a thievery 1 arcane 2 ${raceLabel.toLowerCase()} 1 yields`;
    const stand = {
      id: BB.BUILDER_DOC_ID,
      tables: {
        builds: { classes: { walk: { runins: [{ label, text }] } } },
        people2Raw: { 0: { label: `${raceLabel} Base`, cost: 0 }, 1: { label: `${raceLabel} One`, cost: 0 } },
      },
    };
    const prior = T.getLayer(BB.BUILDER_DOC_ID, T.PRIORITY.WORLD);
    const priorJSON = prior ? JSON.stringify(prior) : null;
    // A real imported class is snapshot before anything is written and put back at the end.
    const stable = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
    const snapOf = () => { const o = cls.toObject(); return { builder: foundry.utils.deepClone(o.system?.builder ?? {}), race: o.system?.race ?? null, stamp: foundry.utils.deepClone(o.flags?.["acks-extras"]?.cookbook?.read?.builder ?? null) }; };
    const snap = restoreClass ? snapOf() : null;
    const raceSnapOf = () => { const o = race.toObject(); return { name: o.name, system: foundry.utils.deepClone(o.system ?? {}) }; };
    const raceSnap = restoreRace ? raceSnapOf() : null;
    try {
      TG.forgetImportedIndex();
      // Containment, asserted before anything is written.
      const holdsClass = (await CB.importedItemFor(classId))?.uuid === classUuid;
      const holdsRace = (await CB.importedItemFor(raceId))?.uuid === raceUuid;
      const classEntries = CB.cookbookContentFile("classes")?.entries ?? {};
      const classes = (await CB.importedDocs("Item"))
        .filter((d) => d.type === "acks-extras.class" && classEntries[d.flags?.["acks-extras"]?.cookbook?.id])
        .map((d) => ({ id: d.flags["acks-extras"].cookbook.id, doc: d, name: d.name, hash: classEntries[d.flags["acks-extras"].cookbook.id].fields?.name?.hash ?? null }));
      const matched = stand.tables.builds.classes.walk.runins.map((r) => ({ r, cls: BB.matchBuildClass(r.label, classes) })).filter((m) => m.cls);
      const only = matched.length === 1 && matched[0].cls.doc.uuid === classUuid;
      out.containment = { holdsClass, holdsRace, onlyMatchIsWalksClass: only };
      if (!(holdsClass && holdsRace && only)) { out.refused = true; return out; }
      T.registerTable(stand, { priority: T.PRIORITY.WORLD, source: "close-map-import" });

      // 1. First apply: no record yet, so every leaf is written and recorded.
      const first = await BB.applyBuilderImport({});
      const b1 = builderOf();
      out.steps.first = {
        built: first.builds.includes(classId),
        hd: b1.hd === 3, fighting: b1.fighting === 2, thievery: b1.thievery === 1, raceRung: b1.raceRung === 1,
        magicRow: b1.magic.length === 1 && b1.magic[0][0] === "arcane" && b1.magic[0][1] === 2,
        raceLink: b1.link === raceId,
        stamped: !!stampOf() && Object.keys(stampOf()).length > 0,
        edits: first.edits.length,
      };
      // 2. Apply again untouched: the model's filled defaults on the magic row are not an edit.
      const tally2 = RF.mergedTally("keep");
      const second = await BB.applyBuilderImport({ repair: tally2 });
      out.steps.untouched = { editsReported: second.edits.length, tallyEdits: tally2.edits.length, same: JSON.stringify(builderOf()) === JSON.stringify(b1) };

      // 3. A Judge's hand edit: one builder leaf and the race link.
      await cls.update({ "system.builder.hdValue": 5, "system.race": "def.race.judge-pick" });
      const edited = builderOf();
      out.steps.edited = { hd: edited.hd === 5, link: edited.link === "def.race.judge-pick" };
      const tally3 = RF.mergedTally("keep");
      const third = await BB.applyBuilderImport({ repair: tally3 });
      const b3 = builderOf();
      const paths = third.edits.map((e) => e.path);
      out.steps.held = {
        leafKept: b3.hd === 5, linkKept: b3.link === "def.race.judge-pick",
        untouchedLeavesStandAsWritten: b3.fighting === b1.fighting && b3.thievery === b1.thievery && b3.raceRung === b1.raceRung,
        reportedLeaf: paths.includes("system.builder.hdValue"), reportedLink: paths.includes("system.race"), reportedOnly: paths.length === 2,
        tallyCarriesThem: tally3.edits.length === third.edits.length,
        builtStill: third.builds.includes(classId),
      };

      // 4. A forced apply writes over both.
      const tally4 = RF.repairTally({ force: true });
      const fourth = await BB.applyBuilderImport({ repair: tally4 });
      const b4 = builderOf();
      out.steps.forced = { leafWritten: b4.hd === 3, linkWritten: b4.link === raceId, noneHeld: fourth.edits.length === 0 };
    } finally {
      if (snap) {
        try {
          const upd = { "system.builder": snap.builder, "system.race": snap.race };
          if (snap.stamp) upd["flags.acks-extras.cookbook.read.builder"] = snap.stamp;
          else upd["flags.acks-extras.cookbook.read.-=builder"] = null;
          await cls.update(upd);
          const back = snapOf();
          out.docRestored = stable(back.builder) === stable(snap.builder) && back.race === snap.race && stable(back.stamp) === stable(snap.stamp);
        } catch (err) {
          out.docRestored = false;
          out.docRestoreError = String(err?.message ?? err);
        }
      }
      if (raceSnap) {
        try {
          await race.update({ name: raceSnap.name, system: raceSnap.system });
          const back = raceSnapOf();
          out.raceRestored = back.name === raceSnap.name && stable(back.system) === stable(raceSnap.system);
        } catch (err) {
          out.raceRestored = false;
          out.raceRestoreError = String(err?.message ?? err);
        }
      }
      // registerTable stamps its source as `_registeredBy`, so the prior layer goes back under the source it was registered by.
      if (prior) T.registerTable(JSON.parse(priorJSON), { priority: T.PRIORITY.WORLD, source: prior._registeredBy });
      else T.unregisterTable(BB.BUILDER_DOC_ID, { priority: T.PRIORITY.WORLD });
      TG.forgetImportedIndex();
      const now = T.getLayer(BB.BUILDER_DOC_ID, T.PRIORITY.WORLD);
      out.layerRestored = prior ? JSON.stringify(now) === priorJSON : now == null;
    }
    return out;
  },
};

async function run(api, fn, ...args) {
  const prelude = `const BASE = ${JSON.stringify(BASE)};`;
  const text = await api.eval(`(async () => { ${prelude} return (${fn.toString()})(...${JSON.stringify(args)}); })().then((v) => JSON.stringify(v === undefined ? null : v))`);
  return JSON.parse(text);
}

/** One topic's section: a script fault in it is a failed check of its own and never voids another topic's verdicts. */
async function topic(title, body) {
  heading(title);
  try {
    await body();
  } catch (err) {
    console.error(`SECTION ERROR (${title}):`, err?.stack ?? err?.message ?? err);
    check(`${title}: the section ran to its end`, false, String(err?.message ?? err));
  }
}

let gm = null;
const scratch = { walls: [], items: [] };
try {
  heading("seat");
  gm = await connect({ browser: MACHINE.browser, origin: MACHINE.origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  const census = await run(gm, P.census);
  note("census (active users: name, isGM)", census.active);
  note("active GM", census.activeGM);
  note("this seat is the active GM", census.activeGMIsSelf);
  if (census.role !== 4) throw new Error("the GM seat is not a gamemaster");

  heading("fixtures");
  const scene = await gm.fixture("battlemap/close-map-ui", "Scene", {
    name: "Close Walk Map UI", active: false, navigation: false, width: 2000, height: 1400, padding: 0, tokenVision: false, backgroundColor: "#8a8a8a",
    grid: { type: 1, size: 100, distance: 5, units: "ft" }, ownership: { default: 0 },
  });
  note("scene", { uuid: scene.uuid, built: scene.built });
  const roadWall = await gm.create("Wall", { c: [200, 200, 800, 200] }, { parent: scene.uuid });
  const waterWall = await gm.create("Wall", { c: [200, 400, 800, 400] }, { parent: scene.uuid });
  scratch.walls.push(roadWall.uuid, waterWall.uuid);

  await topic("fix-map-ui: the road row of a wall sheet (7e93cdeb)", async () => {
    await gm.eval(`(async () => { const s = await fromUuid(${JSON.stringify(scene.uuid)}); if (canvas?.scene?.id !== s.id) await s.view(); return true; })()`);
    const w = (args) => run(gm, P.wall, { uuid: roadWall.uuid, ...args });
    const open = await w({ op: "open" });
    note("surfaces offered (count)", open.roadSurfaces.length);
    check("the sheet carries the road row, and nothing is a road yet", open.ready && open.flags.road == null, { ready: open.ready });
    check("under Not a road the street select and the name field are disabled", open.controls.roadSurface?.value === "" && open.controls.roadStreet?.disabled === true && open.controls.roadName?.disabled === true, { street: open.controls.roadStreet?.disabled, name: open.controls.roadName?.disabled, surface: open.controls.roadSurface?.disabled });
    const refused = await w({ op: "set", target: "roadName", value: "Qzx Lane", wait: { flag: "road", absent: true } });
    check("a disabled name field takes no typing, so no road flag appears", refused.refused === true && refused.flags.road == null, refused.flags);
    if (!open.roadSurfaces.length) {
      check("a surface can be picked (road row's enable half)", false, "UNREACHABLE: the select offers no surface");
      return;
    }
    const surface = open.roadSurfaces[0];
    const picked = await w({ op: "set", target: "roadSurface", value: surface, wait: { flag: "road", path: "surface", equals: surface } });
    check("picking a surface enables the street select and the name field at once, in the same step as the change", picked.atOnce.roadStreet?.disabled === false && picked.atOnce.roadName?.disabled === false, picked.atOnce);
    check("the surface landed on the wall's road flag", picked.landed, { surfaceMatches: picked.flags.road?.surface === surface });
    check("after the re-render the street and name are still enabled", picked.settled.roadStreet?.disabled === false && picked.settled.roadName?.disabled === false && picked.settled.roadSurface?.value === surface, picked.settled);
    const named = await w({ op: "set", target: "roadName", value: "Qzx Lane", wait: { flag: "road", path: "name", equals: "Qzx Lane" } });
    check("a typed name reaches the road flag, with the surface kept", named.landed && named.flags.road?.surface === surface, { name: named.flags.road?.name });
    const street = await w({ op: "set", target: "roadStreet", value: "alley", wait: { flag: "road", path: "street", equals: "alley" } });
    check("a picked street reaches the road flag, with the name and surface kept", street.landed && street.flags.road?.name === "Qzx Lane" && street.flags.road?.surface === surface, { street: street.flags.road?.street, name: street.flags.road?.name });
    check("the settled row shows the typed name and street", street.settled.roadName?.value === "Qzx Lane" && street.settled.roadStreet?.value === "alley", street.settled);
    const none = await w({ op: "set", target: "roadSurface", value: "", wait: { flag: "road", absent: true } });
    check("back to Not a road: street and name are disabled at once, in the same step as the change", none.atOnce.roadStreet?.disabled === true && none.atOnce.roadName?.disabled === true, none.atOnce);
    check("and the road flag is gone", none.landed && none.flags.road == null, none.flags);
    check("after the re-render they are still disabled", none.settled.roadStreet?.disabled === true && none.settled.roadName?.disabled === true, none.settled);
  });

  await topic("fix-map-ui: the water row of a wall sheet (7e93cdeb)", async () => {
    const w = (args) => run(gm, P.wall, { uuid: waterWall.uuid, ...args });
    const open = await w({ op: "open" });
    check("the sheet carries the water row, and nothing is water yet", open.ready && open.flags.water == null, { ready: open.ready });
    check("under Not water the boat tick and the name field are disabled", open.controls.waterKind?.value === "" && open.controls.waterNav?.disabled === true && open.controls.waterName?.disabled === true, { tick: open.controls.waterNav?.disabled, name: open.controls.waterName?.disabled });
    const refused = await w({ op: "set", target: "waterName", value: "Qzx Brook", wait: { flag: "water", absent: true } });
    check("a disabled name field takes no typing, so no water flag appears", refused.refused === true && refused.flags.water == null, refused.flags);
    const picked = await w({ op: "set", target: "waterKind", value: "river", wait: { flag: "water", path: "kind", equals: "river" } });
    check("picking a kind enables the boat tick and the name field at once, in the same step as the change", picked.atOnce.waterNav?.disabled === false && picked.atOnce.waterName?.disabled === false, picked.atOnce);
    check("the kind landed on the wall's water flag", picked.landed, { kind: picked.flags.water?.kind });
    check("after the re-render the tick and name are still enabled", picked.settled.waterNav?.disabled === false && picked.settled.waterName?.disabled === false, picked.settled);
    const tick = await w({ op: "set", target: "waterNav", value: true, wait: { flag: "water", path: "navigable", equals: true } });
    check("the boat tick reaches the water flag", tick.landed && tick.flags.water?.kind === "river", { navigable: tick.flags.water?.navigable });
    const named = await w({ op: "set", target: "waterName", value: "Qzx Brook", wait: { flag: "water", path: "name", equals: "Qzx Brook" } });
    check("a typed name reaches the water flag, with kind and tick kept", named.landed && named.flags.water?.kind === "river" && named.flags.water?.navigable === true, { name: named.flags.water?.name, navigable: named.flags.water?.navigable });
    const none = await w({ op: "set", target: "waterKind", value: "", wait: { flag: "water", absent: true } });
    check("back to Not water: tick and name are disabled at once, in the same step as the change", none.atOnce.waterNav?.disabled === true && none.atOnce.waterName?.disabled === true, none.atOnce);
    check("and the water flag is gone", none.landed && none.flags.water == null, none.flags);
    check("after the re-render they are still disabled", none.settled.waterNav?.disabled === true && none.settled.waterName?.disabled === true, none.settled);
  });

  await topic("fix-map-ui: Map modes' opacity control (7e93cdeb)", async () => {
    const m = (args) => run(gm, P.modes, { sceneUuid: scene.uuid, ...args });
    const terrain = await m({ op: "open", mode: "terrain" });
    check("Map modes opens under Terrain", terrain.opened && terrain.active === "terrain", { active: terrain.active, pills: terrain.pills });
    check("in Terrain the opacity slider is disabled and says why in a visible line", terrain.disabled === true && terrain.reasonShown === true, { disabled: terrain.disabled, reasonShown: terrain.reasonShown });
    check("in Terrain the slider still shows its figure, in an <output>, matching its value", terrain.figureIsOutput === true && terrain.figureMatches === true, { figureIsOutput: terrain.figureIsOutput, figureMatches: terrain.figureMatches });
    check("the slider is named (aria-label) and carries its tooltip key", terrain.ariaOk === true && terrain.tooltipOk === true, { ariaOk: terrain.ariaOk, tooltipOk: terrain.tooltipOk });
    const other = terrain.pills.find((k) => k !== "terrain");
    if (!other) {
      check("a mode other than Terrain can be picked", false, "UNREACHABLE: no registered mode but Terrain");
      return;
    }
    const picked = await m({ op: "pick", key: other });
    check("picking a mode pill enables the opacity slider and drops the reason line", picked.picked && picked.disabled === false && picked.reasonShown === false, { disabled: picked.disabled, reasonShown: picked.reasonShown, active: picked.active === other });
    check("under a mode the figure matches the slider's value", picked.figureMatches === true && picked.figureIsOutput === true, { figure: picked.figure === `${picked.value}%` });
    const drag = await m({ op: "drag", value: 55 });
    check("dragging moves the figure with the slider while the view's opacity is not yet written", drag.figureFollows === true && drag.viewHeldDuringDrag === true, { figureFollows: drag.figureFollows, viewHeldDuringDrag: drag.viewHeldDuringDrag });
    check("releasing writes the view's opacity once", drag.viewWritten === true && Math.abs(drag.view.opacity - 0.55) < 1e-9, { opacity: drag.view.opacity });
    const after = await m({ op: "read" });
    check("after the write's re-render the figure and the slider still agree", after.figureMatches === true && after.disabled === false && Number(after.value) === 55, { value: after.value, figure: after.figure === "55%" });
    const back = await m({ op: "pick", key: "terrain" });
    check("back in Terrain the slider is disabled again with the reason line", back.picked && back.disabled === true && back.reasonShown === true, { disabled: back.disabled, reasonShown: back.reasonShown });
  });

  await topic("fix-map-ui: the map tools take the party sheet's mode names (7e93cdeb)", async () => {
    const a = await run(gm, P.assistant, { sceneUuid: scene.uuid });
    check("Map setup opens on the walk's scene with its Party system here select", a.found && a.viewed, { found: a.found, viewed: a.viewed });
    check("the select offers the three modes and a blank", ["", "delve", "journey", "settlement"].every((v) => a.optionValues.includes(v)), a.optionValues);
    check("each mode reads as the party sheet's own name (Delve, Journey, In the city)", Object.values(a.sameAsPartySheet).every(Boolean), a.sameAsPartySheet);
    check("the blank option reads the setup's own 'Not declared' key", a.noneIsNotDeclared === true);
    check("the select's hint names the modes by those same names", Object.values(a.hintNamesThem).every(Boolean), a.hintNamesThem);
  });

  await topic("fix-import-data: T-0781, a world's override of the three tables is read (e1e86786)", async () => {
    const u = await run(gm, P.units, { sizeFeet: 7, rounds: 4, turns: 8 });
    note("world holds the tables (sizeSquare, roundsPerTurn, turnsPerHour)", u.worldHoldsTable);
    note("a Judge override already stood (restored below)", u.judgeHadOverride);
    check("the baseline equals the source constants where the world holds no table of its own", Array.isArray(u.worldHoldsTable) && (u.baselineIsConstants === true || (typeof u.baselineIsConstants === "object" && Object.values(u.baselineIsConstants).every(Boolean)) || typeof u.baselineIsConstants === "string"), u.baselineIsConstants);
    check("the invented figures differ from the baseline, so a move shows", u.figuresDifferFromBaseline === true);
    check("an override of sizeSquare answers through sizeSquareFeet", u.steps.override?.sizeSquareFeet === true, u.steps.override);
    check("an override of roundsPerTurn and turnsPerHour answers through roundsPerTurn and turnsPerHour", u.steps.override?.roundsPerTurn === true && u.steps.override?.turnsPerHour === true);
    check("downstream, turnSeconds, turnsPerDay and roundSeconds follow the override", u.steps.override?.turnSeconds === true && u.steps.override?.turnsPerDay === true && u.steps.override?.roundSeconds === true);
    check("the override layer holds each of the three rows while they stand", u.steps.override?.layerHoldsRow?.every(Boolean), u.steps.override?.layerHoldsRow);
    check("a zero square, a fractional rounds figure and a zero turns figure leave the baseline", u.steps.badFigures && Object.values(u.steps.badFigures).every(Boolean), u.steps.badFigures);
    check("removing the override brings the baseline (the constants where the world held no table) back, in every reader", u.steps.removed?.all === true && u.steps.removed.layerEmpty.every(Boolean), u.steps.removed);
    check("the world's own override state is restored per table, and the readers are back at baseline", u.restored?.readersBack === true && u.restored.overrides.every(Boolean) && u.restored.values.every(Boolean), u.restored);
  });

  await topic("fix-import-data: T-0762, a rules-tables apply keeps a Judge's builder edit (97dafd11)", async () => {
    const probe = await run(gm, P.builderProbe);
    note("probe", { shippedClassIds: probe.shippedClassIds, freeClassId: !!probe.classId, raceFree: probe.raceFree, worldBuilderLayerHeld: probe.worldLayerHeld, realClass: probe.real?.classUuid ?? null, realRace: probe.real?.raceUuid ?? null });
    // Each of the class and the race is a fixture where its id is free, else the imported one, put back from a snapshot at the end.
    let classUuid = null, classId = null, label = null, raceUuid = null, raceLabel = null;
    if (probe.classId) {
      const cls = await gm.create("Item", { name: "Qzx Walkclass", type: "acks-extras.class", flags: { [MOD]: { cookbook: { id: probe.classId } } } });
      scratch.items.push(cls.uuid);
      ({ classUuid, classId, label } = { classUuid: cls.uuid, classId: probe.classId, label: "Qzx Walkclass" });
    } else if (probe.real?.classUuid) ({ classUuid, classId, label } = probe.real);
    if (probe.raceFree) {
      const race = await gm.create("Item", { name: "Qzx Walkrace", type: "acks-extras.race", flags: { [MOD]: { cookbook: { id: probe.raceId } } } });
      scratch.items.push(race.uuid);
      ({ raceUuid, raceLabel } = { raceUuid: race.uuid, raceLabel: "Qzxfolk" });
    } else if (probe.real?.raceUuid) ({ raceUuid, raceLabel } = probe.real);
    if (!classUuid || !raceUuid) {
      check("T-0762 can be driven on a class and a race (a fixture, else the imported one)", false, "UNREACHABLE: no class or no race to drive");
      return;
    }
    const restoreClass = !probe.classId, restoreRace = !probe.raceFree;
    note("class and race driven", { class: classUuid, race: raceUuid, classImported: restoreClass, raceImported: restoreRace });
    const b = await run(gm, P.builder, { classUuid, raceUuid, classId, raceId: probe.raceId, label, raceLabel, restoreClass, restoreRace });
    note("containment before the apply", b.containment);
    check("before the apply, the walk's class is the only run-in match and its race the only holder of the id", b.containment && Object.values(b.containment).every(Boolean), b.containment);
    if (b.refused) {
      check("the apply ran", false, "not run: the containment check refused it");
      return;
    }
    const f = b.steps.first;
    check("a first apply writes the page's builder leaves, the magic row and the race link, and records them", f?.built && f.hd && f.fighting && f.thievery && f.raceRung && f.magicRow && f.raceLink && f.stamped && f.edits === 0, f);
    check("an apply with nothing edited reports no edit (the model's filled magic-row defaults do not read as one)", b.steps.untouched?.editsReported === 0 && b.steps.untouched?.tallyEdits === 0 && b.steps.untouched?.same === true, b.steps.untouched);
    check("a hand edit to a builder leaf and to the race link is in place", b.steps.edited?.hd && b.steps.edited?.link, b.steps.edited);
    const h = b.steps.held;
    check("the next apply keeps the edited leaf and the edited race link", h?.leafKept && h?.linkKept, h);
    check("it reports exactly those two held leaves, in the apply's edits and the tally's", h?.reportedLeaf && h?.reportedLink && h?.reportedOnly && h?.tallyCarriesThem, h);
    check("a leaf nobody edited stands as written and the class is still built", h?.untouchedLeavesStandAsWritten && h?.builtStill, h);
    check("a forced apply writes over the leaf and the race link and holds nothing", b.steps.forced?.leafWritten && b.steps.forced?.linkWritten && b.steps.forced?.noneHeld, b.steps.forced);
    check("the registry's world layer for the builder document is back as it was", b.layerRestored === true);
    if ("docRestored" in b) check("the imported class's builder leaves, race link and record are back as they were", b.docRestored === true, b.docRestoreError ?? null);
    if ("raceRestored" in b) check("the imported race's name and fields are back as they were", b.raceRestored === true, b.raceRestoreError ?? null);
  });

  walkDone();
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err?.message ?? err);
  checks.push(["the walk ran to its end", false]);
} finally {
  heading("teardown");
  if (gm) {
    try { note("restore", await run(gm, P.restore)); } catch (err) { console.error("restore failed:", err?.message ?? err); }
    try { note("sweep", await gm.sweepTracked({ only: [...scratch.items, ...scratch.walls] })); } catch (err) { console.error("sweep failed:", err?.message ?? err); }
    try { await gm.close(); } catch { /* closing */ }
  }
  heading("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`close-map-import: ${passed === checks.length ? "passed" : "failed"} (${passed} pass, ${checks.length - passed} fail)`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
