/**
 * Live walk, battlemap. Recipes walked:
 *   docs/battlemap/TESTING.md  "The country's layers and water" 1-8 and 10, and the changed
 *                              step 1 of "Terrain painting"                       (part "layers")
 *   docs/battlemap/TESTING.md  "Map modes" 1-8                                    (part "modes")
 *   docs/formation/TESTING.md  "The country" 1-9, then on the same fixtures the changed
 *                              steps 5-7 of battlemap "Terrain painting" and step 12
 *                              of battlemap "Roads"                               (part "country")
 * and the release's six snapshots for those entries.
 *
 * Machine values arrive through ./_env.mjs; nothing here names a port, a world or
 * a seat. Every figure and name
 * is invented; no imported table is printed (factor lines are logged as booleans).
 *
 * Writes outside the fixture ledger, each undone at teardown and reported:
 *   - an invented `travel` document registered at priority 30 (unregistered);
 *   - the world setting `travelEncounters`, only if it was on (restored);
 *   - the GM seat's client state: dice rig, notification patches, country brush,
 *     the core wall preset (restored to what it read at start), the cursor layer;
 *   - both seats' map view (restored to what each read at start);
 *   - the world clock, which the journey advances (reported as a delta).
 *
 * WALK_PLAN names an optional plan file:
 *   { "parts": ["layers", "modes", "country"], "retrack": ["<uuid>", ...] }
 */
import fs from "node:fs";
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS, shotDir } from "./_env.mjs";

const MACHINE = machineSeats();
const browser = MACHINE.browser;
const origin = MACHINE.origin;
const SEATS = { gm: MACHINE.gm, player: MACHINE.player };
const NONCE = "rb" + Math.random().toString(36).slice(2, 7);
const MOD = "acks-extras";
const CELL = 100;
const MILES = 7; // invented cell width, equal to the invented cadence figure for X
const X = "outlands"; // cadence = one cell  -> "grid"
const Y = "unsettled"; // cadence = two cells -> "miles", one cell carried
const CLIMATE_A = "Csa"; // a map's own, and the one a map painted with climates folds into
const CLIMATE_SCENE = "BSk"; // the scene default's, and the fold's loser
const TARGET = 11; // invented navigation target; the dice are rigged to a natural 20 for the country walk
const SHOT_DIR = shotDir();

// WALK_PLAN names an optional plan file ({ "parts": ["layers", "modes", "country"], "retrack": ["<uuid>", ...] }).
let plan = { parts: ["layers", "modes", "country"], retrack: [] };
if (process.env.WALK_PLAN) plan = { ...plan, ...JSON.parse(fs.readFileSync(process.env.WALK_PLAN, "utf8")) };
const PARTS = new Set(plan.parts);

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const shots = [];

/* ------------------------------------------------------------------ */
/*  Page side (stringified and run in the seat's page)                  */
/* ------------------------------------------------------------------ */

const P = {
  census: async (mod) => ({
    foundry: game.version,
    module: game.modules.get(mod)?.version ?? null,
    role: game.user.role,
    userId: game.user.id,
    activeRoles: game.users.filter((u) => u.active).map((u) => u.role).sort(),
    activeGMIsSelf: !!game.users.activeGM?.isSelf,
    settings: {
      dawn: game.settings.get(mod, "dawnHour"),
      dusk: game.settings.get(mod, "duskHour"),
      travelEncounters: game.settings.get(mod, "travelEncounters"),
      advanceWorldTime: game.settings.get(mod, "advanceWorldTime"),
    },
    worldTime: game.time.worldTime,
    messages: game.messages.size,
  }),

  /** Helpers every other page function reaches through `globalThis.__rb`. */
  install: async ({ nonce = null } = {}) => {
    const H = (globalThis.__rb = globalThis.__rb ?? {});
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 25, every = 100 } = {}) => {
      for (let n = 0; n < tries; n++) {
        const v = await fn();
        if (v) return v;
        await H.sleep(every);
      }
      return null;
    };
    H.root = (app) => (app?.element?.nodeType === 1 ? app.element : app?.element?.[0]) ?? null;
    H.F = acksExtras.formation;
    H.T = acksExtras.formation.travel;
    H.B = acksExtras.battlemap;
    const base = "/modules/acks-extras/scripts/";
    H.m = {
      paint: await import(base + "battlemap/terrain-paint.mjs"),
      modes: await import(base + "battlemap/map-modes.mjs"),
      session: await import(base + "battlemap/session.mjs"),
      tables: await import(base + "lib/tables.mjs"),
      model: await import(base + "formation/formation-model.mjs"),
      enc: await import(base + "formation/encounter-card.mjs"),
      encT: await import(base + "formation/encounter-terrains.mjs"),
    };
    H.tableLabel = (key) => (H.m.encT.ENCOUNTER_TERRAINS[key] ? game.i18n.localize(H.m.encT.ENCOUNTER_TERRAINS[key].label) : null);
    // The public api carries getFormations (the map) and not getFormation (one record).
    H.formation = (id) => (typeof H.m.model.getFormation === "function" ? H.m.model.getFormation(id) : null) ?? H.F.getFormations()[id] ?? null;
    if (!H.notesPatched) {
      H.notes = [];
      H.orig = {};
      for (const k of ["info", "warn", "error"]) {
        H.orig[k] = ui.notifications[k];
        ui.notifications[k] = function (msg, ...rest) {
          H.notes.push({ kind: k, text: String(msg) });
          return H.orig[k].call(this, msg, ...rest);
        };
      }
      H.notesPatched = true;
    }
    H.takeNotes = () => H.notes.splice(0);
    H.nonce = nonce ?? H.nonce ?? null;
    if (!H.recorder) {
      // Console errors from here on: console.error, window errors, unhandled rejections; the origin scrubbed.
      H.errors = [];
      const scrub = (x) => String(x).split(location.origin).join("<origin>").slice(0, 600);
      H.origConsoleError = console.error;
      console.error = function (...args) {
        try { H.errors.push({ at: Date.now(), text: scrub(args.map((a) => a?.stack ?? (typeof a === "string" ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })())).join(" ")) }); } catch (_e) { /* the recorder never throws */ }
        return H.origConsoleError.apply(this, args);
      };
      H.onError = (ev) => H.errors.push({ at: Date.now(), text: scrub(`window error: ${ev?.error?.stack ?? ev?.message ?? ev}`) });
      H.onRejection = (ev) => H.errors.push({ at: Date.now(), text: scrub(`unhandled rejection: ${ev?.reason?.stack ?? ev?.reason ?? ev}`) });
      window.addEventListener("error", H.onError);
      window.addEventListener("unhandledrejection", H.onRejection);
      H.recorder = Date.now();
    }
    // The run's own chat cards. A message THIS client creates carries the run's nonce (and the action in
    // flight) in a world flag, so a peer seated as the same user is never mistaken for the run; a tagged
    // card is claimed when it speaks as one of the run's fixtures, names its formation, carries the nonce,
    // or is a navigation card thrown during one of the run's own moves.
    H.claimed = H.claimed ?? { aliases: new Set(), fids: new Set() };
    H.mine = H.mine ?? [];
    H.action = null;
    if (!H.msgHooks) {
      H.msgHooks = {
        pre: Hooks.on("preCreateChatMessage", (doc) => { if (H.nonce) { try { doc.updateSource({ flags: { world: { relb: { n: H.nonce, a: H.action ?? null } } } }); } catch (_e) { /* untagged */ } } }),
        post: Hooks.on("createChatMessage", (msg) => {
          const tag = msg.getFlag?.("world", "relb");
          if (!H.nonce || tag?.n !== H.nonce) return;
          H.mine.push({ uuid: msg.uuid, nav: /acks-extras-nav-card/.test(msg.content ?? ""), alias: msg.speaker?.alias ?? null, action: tag.a ?? null, fid: msg.getFlag?.("acks-extras", "encounter")?.formationId ?? null, hasNonce: (msg.content ?? "").includes(H.nonce) });
        }),
      };
    }
    H.collect = () => {
      const all = H.mine.splice(0);
      const isMine = (m) => H.claimed.aliases.has(m.alias) || (!!m.fid && H.claimed.fids.has(m.fid)) || m.hasNonce || (m.nav && !!m.action);
      return { all, claimed: all.filter(isMine).map((m) => m.uuid), unclaimed: all.filter((m) => !isMine(m)).map((m) => ({ alias: m.alias, nav: m.nav, action: m.action })) };
    };
    H.change = (el, value) => {
      el.value = value;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    H.screen = (point) => {
      const p = canvas.stage.worldTransform.apply(new PIXI.Point(point.x, point.y));
      const r = canvas.app.view.getBoundingClientRect();
      return { x: r.left + p.x, y: r.top + p.y };
    };
    H.pointer = (type, s, extra = {}) => {
      canvas.app.render();
      canvas.app.view.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, composed: true, view: window,
        clientX: s.x, clientY: s.y, screenX: s.x, screenY: s.y,
        pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, buttons: 0, ...extra,
      }));
    };
    H.clickCanvas = async (point) => {
      const s = H.screen(point);
      H.pointer("pointerover", s);
      H.pointer("pointermove", s);
      await H.sleep(40);
      H.pointer("pointerdown", s, { buttons: 1 });
      await H.sleep(40);
      H.pointer("pointerup", s);
      await H.sleep(250);
    };
    H.dragCanvas = async (from, to, steps = 8) => {
      const a = H.screen(from);
      const b = H.screen(to);
      H.pointer("pointerover", a);
      H.pointer("pointermove", a);
      await H.sleep(40);
      H.pointer("pointerdown", a, { buttons: 1 });
      await H.sleep(60);
      for (let k = 1; k <= steps; k++) {
        const s = { x: a.x + ((b.x - a.x) * k) / steps, y: a.y + ((b.y - a.y) * k) / steps };
        H.pointer("pointermove", s, { buttons: 1 });
        await H.sleep(40);
      }
      H.pointer("pointerup", b);
      await H.sleep(400);
    };
    H.countryCards = (el) => [...el.querySelectorAll('[data-section="country"] .acks-extras-country-card')].map((c) => ({
      key: c.dataset.key,
      value: c.querySelector(".acks-extras-country-value")?.textContent.trim() ?? null,
      source: c.querySelector(".acks-extras-country-source")?.textContent.trim() ?? null,
      provenance: c.querySelector(".acks-extras-country-source")?.dataset.provenance ?? null,
      override: !!c.querySelector(".acks-extras-country-chip.is-override"),
      overrideTip: c.querySelector(".acks-extras-country-chip.is-override")?.dataset.tooltip ?? null,
      declared: !!c.querySelector(".acks-extras-country-chip.is-declared"),
      paint: !!c.querySelector('[data-action="paintThisHex"]'),
      paintBrush: c.querySelector('[data-action="paintThisHex"]')?.dataset.brush ?? null,
      clear: !!c.querySelector('[data-action="clearOverride"]'),
      actions: [...c.querySelectorAll("[data-action]")].map((n) => n.dataset.action),
    }));
    if (H.cursorsWere === undefined) H.cursorsWere = canvas?.controls?.cursors?.visible ?? null;
    return { ok: true, version: game.modules.get("acks-extras")?.version ?? null };
  },

  viewScene: async (sceneId) => {
    const scene = game.scenes.get(sceneId);
    await scene.view();
    const t0 = performance.now();
    while (!(canvas.ready && canvas.scene?.id === sceneId) && performance.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 200));
    await new Promise((r) => setTimeout(r, 2500));
    return { viewed: canvas.scene?.id === sceneId, ready: canvas.ready };
  },

  setSetting: async ({ mod, key, value }) => {
    const before = game.settings.get(mod, key);
    await game.settings.set(mod, key, value);
    return { before, after: game.settings.get(mod, key) };
  },

  /** The core wall preset as it stands, and the setting's scope. */
  wallPreset: async () => {
    const palette = canvas?.walls?.constructor?.paletteClass;
    if (!palette?.SETTING_KEY) return { key: null };
    const cfg = game.settings.settings.get(`core.${palette.SETTING_KEY}`);
    return { key: palette.SETTING_KEY, scope: cfg?.scope ?? null, value: foundry.utils.deepClone(game.settings.get("core", palette.SETTING_KEY)) };
  },

  /** Rig the d20 so a throw lands on `want` (1 or 20), and read one roll back. */
  rig: async ({ want }) => {
    const H = globalThis.__rb;
    if (!H.origUniform) H.origUniform = CONFIG.Dice.randomUniform;
    const read = async () => (await new Roll("1d20").evaluate()).total;
    for (const v of [0.975, 0.025]) {
      CONFIG.Dice.randomUniform = () => v;
      const got = await read();
      if (got === want) return { want, got, value: v };
    }
    return { want, got: await read(), value: null };
  },

  unrig: async () => {
    const H = globalThis.__rb;
    if (H?.origUniform) { CONFIG.Dice.randomUniform = H.origUniform; H.origUniform = null; return { restored: true }; }
    return { restored: false };
  },

  /** The invented travel document, merged over whatever the world holds; nothing of it is returned. */
  registerTravel: async ({ X, Y, miles, target }) => {
    const H = globalThis.__rb;
    const ET = H.m.encT.ENCOUNTER_TERRAINS;
    const grounds = [...new Set(Object.values(ET).map((t) => t.ground).filter(Boolean))];
    const read = (id) => { try { return H.m.tables.getTable("travel", id); } catch (_e) { return {}; } };
    const cur = read("encounterFrequency");
    const freq = foundry.utils.mergeObject(cur, { traveling: { [X]: { kind: "perHex", mileHex: miles }, [Y]: { kind: "perHex", mileHex: miles * 2 } } }, { inplace: false });
    const lost = foundry.utils.mergeObject(read("gettingLost"), Object.fromEntries(grounds.map((g) => [g, target])), { inplace: false });
    H.m.tables.registerTable({ id: "travel", tables: { encounterFrequency: freq, gettingLost: lost } }, { priority: 30, source: "battlemap-walk" });
    return { cadX: H.m.enc.cadenceMilesFor(X), cadY: H.m.enc.cadenceMilesFor(Y), grounds: grounds.length, targetsSet: grounds.every((g) => H.m.tables.getTable("travel", "gettingLost")?.[g] === target) };
  },

  unregisterTravel: async () => globalThis.__rb.m.tables.unregisterTable("travel", { priority: 30 }),

  paintable: async () => {
    const H = globalThis.__rb;
    return { terrain: H.B.terrain.paintableValues("terrain"), territory: H.B.terrain.paintableValues("territory"), climate: H.B.terrain.paintableValues("climate").length };
  },

  paintAt: async ({ sceneId, point, value, layer }) => {
    const H = globalThis.__rb;
    const scene = game.scenes.get(sceneId);
    const ok = await H.B.terrain.paintHexAt(scene, point, value, layer);
    await H.sleep(300);
    return { ok, value: H.B.terrain.layerValueAt(scene, point, layer) };
  },

  /** Two layers painted on one hex in quick succession (one debounce burst). */
  paintTwo: async ({ sceneId, point, terrain, territory }) => {
    const H = globalThis.__rb;
    const scene = game.scenes.get(sceneId);
    const r = await Promise.all([
      H.B.terrain.paintHexAt(scene, point, terrain, "terrain"),
      H.B.terrain.paintHexAt(scene, point, territory, "territory"),
    ]);
    return { ok: r, terrain: H.B.terrain.layerValueAt(scene, point, "terrain"), territory: H.B.terrain.layerValueAt(scene, point, "territory") };
  },

  /** A climate painted on a hex as the brush wrote one before the climate was the map's: a GM-only region, flagged `climate` and `climateHexes`. */
  paintedClimate: async ({ sceneId, offsets, value }) => {
    const H = globalThis.__rb;
    const scene = game.scenes.get(sceneId);
    const [made] = await scene.createEmbeddedDocuments("Region", [{
      name: `QA painted climate ${value}`, color: "#4a8a3c", visibility: CONST.REGION_VISIBILITY?.GAMEMASTER ?? 1,
      shapes: offsets.map((o) => ({ type: "polygon", hole: false, points: scene.grid.getVertices(o).flatMap((v) => [v.x, v.y]) })),
      flags: { "acks-extras": { climate: value, climateHexes: offsets.map((o) => `${o.i}:${o.j}`) } },
    }]);
    await H.sleep(300);
    return { id: made.id, uuid: made.uuid };
  },

  /** What the fold left on a scene: its setup record's climate and mark, its painted climate regions, and the notifications since the last read. */
  foldState: async ({ sceneId, offset = null }) => {
    const H = globalThis.__rb;
    const scene = game.scenes.get(sceneId);
    const record = scene.getFlag("acks-extras", "battlemap") ?? {};
    const at = offset ? H.B.country.countryAt(scene, scene.grid.getCenterPoint(offset)) : null;
    return {
      climate: H.B.country.sceneCountry(scene).climate,
      folded: record.climateFolded === true,
      regions: scene.regions.filter((r) => !!r.getFlag("acks-extras", "climate")).length,
      at: at && { climate: at.climate, source: at.source.climate },
      notes: H.takeNotes().filter((n) => /climate/i.test(n.text)),
    };
  },

  regions: async ({ sceneId, layer }) => {
    const H = globalThis.__rb;
    const scene = game.scenes.get(sceneId);
    const spec = H.B.terrain.PAINT_LAYERS[layer];
    return H.B.terrain.layerRegionsOf(scene, layer).map((r) => ({
      id: r.id, uuid: r.uuid, value: r.getFlag("acks-extras", spec.flag), hexes: r.getFlag("acks-extras", spec.hexesFlag) ?? [],
      visibility: r.visibility, shapes: r.shapes?.length ?? 0,
    }));
  },

  layerValues: async ({ sceneId, point }) => {
    const H = globalThis.__rb;
    const scene = game.scenes.get(sceneId);
    return { terrain: H.B.terrain.layerValueAt(scene, point, "terrain"), territory: H.B.terrain.layerValueAt(scene, point, "territory") };
  },

  waterLine: async ({ sceneId, c, kind = "river" }) => {
    const H = globalThis.__rb;
    const scene = game.scenes.get(sceneId);
    const [wall] = await scene.createEmbeddedDocuments("Wall", [{ c, ...H.B.water.waterWallData({ kind }) }]);
    await H.sleep(300);
    return { id: wall.id, uuid: wall.uuid, water: wall.getFlag("acks-extras", "water") ?? null, move: wall.move, door: wall.door };
  },

  roadWall: async ({ sceneId, c, surface }) => {
    const H = globalThis.__rb;
    const scene = game.scenes.get(sceneId);
    const [wall] = await scene.createEmbeddedDocuments("Wall", [{ c, ...H.B.roads.roadWallData({ surface }) }]);
    await H.sleep(300);
    return { id: wall.id, uuid: wall.uuid, road: wall.getFlag("acks-extras", "road") ?? null };
  },

  /** A terrain region written by hand, as a map painted before the brush took its present vocabulary holds one. */
  handRegion: async ({ sceneId, offset, value }) => {
    const H = globalThis.__rb;
    const scene = game.scenes.get(sceneId);
    const key = `${offset.i}:${offset.j}`;
    const vertices = scene.grid.getVertices(offset);
    const [made] = await scene.createEmbeddedDocuments("Region", [{
      name: `QA hand-flagged ${value}`, color: "#7a7a7a", visibility: CONST.REGION_VISIBILITY?.GAMEMASTER ?? 1,
      shapes: [{ type: "polygon", hole: false, points: vertices.flatMap((v) => [v.x, v.y]) }],
      flags: { "acks-extras": { terrain: value, terrainHexes: [key] } },
    }]);
    await H.sleep(400);
    return { id: made.id, uuid: made.uuid, read: H.B.terrain.layerValueAt(scene, scene.grid.getCenterPoint(offset), "terrain") };
  },

  sceneDefault: async ({ sceneId, country }) => {
    const H = globalThis.__rb;
    const scene = game.scenes.get(sceneId);
    await H.B.country.writeSceneSetup(scene, { country });
    await H.sleep(300);
    return H.B.country.sceneCountry(scene);
  },

  countryAt: async ({ sceneId, point, waterBorne = false }) => globalThis.__rb.B.country.countryAt(game.scenes.get(sceneId), point, { waterBorne }),

  /** A ground's own encounter table, and how a hand-flagged key reads. */
  vocab: async ({ keys }) => {
    const H = globalThis.__rb;
    const ET = H.m.encT.ENCOUNTER_TERRAINS;
    return Object.fromEntries(keys.map((k) => [k, { fine: !!ET[k], ground: ET[k]?.ground ?? null, defaultTable: H.m.encT.encounterTerrainFor(k) || null }]));
  },

  /* ---------------- the battlemap layers ---------------- */

  /** Arm a calibration capture mode through the Battlemap group, as the toolbar does. */
  armCalibration: async ({ tool }) => {
    const H = globalThis.__rb;
    await ui.controls.render({ force: true });
    await H.sleep(300);
    ui.controls.activate({ control: "acksBattlemap", tool });
    await H.sleep(900);
    return { mode: H.m.session.session.mode ?? null, tool: ui.controls.tool?.name ?? null, control: ui.controls.control?.name ?? null };
  },

  /** Arm the toolbar's own country brush (the Battlemap group's terrain tool), as a Judge would. */
  armTool: async () => {
    const H = globalThis.__rb;
    await ui.controls.render({ force: true });
    await H.sleep(300);
    ui.controls.activate({ control: "acksBattlemap", tool: "terrain" });
    await H.sleep(900);
    const btn = document.querySelector('#scene-controls [data-tool="terrain"]');
    return {
      ...(await globalThis.__P.palette()),
      calibration: H.m.session.session.mode ?? null,
      toolDom: btn ? { cls: btn.className, pressed: btn.getAttribute("aria-pressed") } : null,
    };
  },

  palette: async () => {
    const H = globalThis.__rb;
    const pal = document.querySelector("#acks-extras-terrain-palette");
    const s = H.m.paint.terrainPaint;
    const app = foundry.applications.instances.get("acks-extras-terrain-palette") ?? null;
    const ctx = app ? await app._prepareContext() : null;
    return {
      palette: !!pal,
      pills: [...(pal?.querySelectorAll('button[data-action="pickLayer"]') ?? [])].map((b) => ({ layer: b.dataset.layer, pressed: b.getAttribute("aria-pressed") })),
      pressed: pal?.querySelector('button[data-action="pickLayer"][aria-pressed="true"]')?.dataset.layer ?? null,
      armedSwatch: pal?.querySelector("button[data-brush].is-active")?.dataset.brush ?? null,
      swatches: [...(pal?.querySelectorAll("button[data-brush]") ?? [])].map((b) => b.dataset.brush),
      groups: ctx ? ctx.groups.map((g) => ({ label: g.label, keys: g.swatches.map((x) => x.key), colors: [...new Set(g.swatches.map((x) => x.color))].length })) : null,
      state: { layer: s.layer, brush: s.brush, armedBy: s.armedBy },
      control: ui.controls?.control?.name ?? null,
      tool: ui.controls?.tool?.name ?? null,
    };
  },

  /** The terrain pill's swatches held to the vocabulary: fine kinds on a ground, no bare ground, no river. */
  terrainVocab: async () => {
    const H = globalThis.__rb;
    const ET = H.m.encT.ENCOUNTER_TERRAINS;
    const pal = document.querySelector("#acks-extras-terrain-palette");
    const swatches = [...(pal?.querySelectorAll("button[data-brush]") ?? [])].map((b) => b.dataset.brush);
    const keys = swatches.filter((k) => k !== "erase");
    const covered = new Set(Object.values(ET).map((t) => t.ground).filter(Boolean));
    return {
      swatchCount: keys.length,
      eraser: swatches.includes("erase"),
      fine: keys.filter((k) => ET[k]?.ground).length,
      fineAll: Object.keys(ET).filter((k) => ET[k].ground).length,
      rivers: keys.filter((k) => ET[k] && !ET[k].ground),
      bare: keys.filter((k) => !ET[k] && covered.has(k)),
      extras: keys.filter((k) => !ET[k] && !covered.has(k)).length,
      groundlessInVocabulary: Object.keys(ET).filter((k) => !ET[k].ground),
    };
  },

  pickLayer: async ({ layer }) => {
    const H = globalThis.__rb;
    const b = document.querySelector(`#acks-extras-terrain-palette button[data-action="pickLayer"][data-layer="${layer}"]`);
    if (!b) return { found: false };
    b.click();
    await H.sleep(700);
    return { found: true, ...(await globalThis.__P.palette()) };
  },

  pickBrush: async ({ value }) => {
    const H = globalThis.__rb;
    const b = document.querySelector(`#acks-extras-terrain-palette button[data-brush="${value}"]`);
    if (!b) return { found: false };
    b.click();
    await H.sleep(600);
    return { found: true, brush: H.m.paint.terrainPaint.brush, layer: H.m.paint.terrainPaint.layer };
  },

  /** A real click on the map at a point; reports what the two layers read there afterwards. */
  clickHex: async ({ sceneId, point }) => {
    const H = globalThis.__rb;
    H.takeNotes();
    await H.clickCanvas(point);
    await H.sleep(700);
    const scene = game.scenes.get(sceneId);
    return {
      terrain: H.B.terrain.layerValueAt(scene, point, "terrain"),
      territory: H.B.terrain.layerValueAt(scene, point, "territory"),
      notes: H.takeNotes().filter((n) => n.kind !== "info" || !/^Reading |entries available/.test(n.text)),
      state: { layer: H.m.paint.terrainPaint.layer, brush: H.m.paint.terrainPaint.brush, armedBy: H.m.paint.terrainPaint.armedBy },
    };
  },

  closePalette: async () => {
    const H = globalThis.__rb;
    const app = foundry.applications.instances.get("acks-extras-terrain-palette") ?? null;
    if (app) { try { await app.close({ animate: false }); } catch (_e) { /* closed */ } }
    await H.sleep(400);
    const s = H.m.paint.terrainPaint;
    return { closed: !document.querySelector("#acks-extras-terrain-palette"), state: { layer: s.layer, brush: s.brush, armedBy: s.armedBy } };
  },

  /**
   * The map modes as this seat holds them: the view; the overlay (its children,
   * its alpha, its border paths counted by colour) beside what `borderSegments`
   * says it should draw for the territory; the Map modes window; the control.
   */
  modeState: async ({ sceneId = null } = {}) => {
    const H = globalThis.__rb;
    const MM = H.m.modes;
    const scene = sceneId ? game.scenes.get(sceneId) : canvas.scene;
    const hex = (c) => "#" + (c ?? 0).toString(16).padStart(6, "0");
    const ov = canvas.regions?.getChildByName?.("acks-extras-map-modes") ?? null;
    const drawn = {};
    for (const g of ov?.children ?? []) {
      g.finishPoly?.();
      for (const d of g.geometry?.graphicsData ?? []) drawn[hex(d.lineStyle?.color)] = (drawn[hex(d.lineStyle?.color)] ?? 0) + 1;
    }
    const expected = {};
    if (scene) for (const s of MM.borderSegments(scene, MM.layerPlan(scene, "territory"))) expected[s.color] = (expected[s.color] ?? 0) + 1;
    const win = foundry.applications.instances.get("acks-extras-map-modes") ?? null;
    const el = win?.rendered ? H.root(win) : null;
    const ctx = el ? await win._prepareContext() : null;
    return {
      view: MM.mapView(),
      overlay: ov ? { children: ov.children.length, alpha: Math.round(ov.alpha * 100) / 100, drawn, inRegions: ov.parent === canvas.regions } : null,
      expected,
      window: el ? {
        pressed: el.querySelector('button[data-action="pickMode"][aria-pressed="true"]')?.dataset.mode ?? null,
        pills: [...el.querySelectorAll('button[data-action="pickMode"]')].map((b) => b.dataset.mode),
        rows: el.querySelectorAll(".acks-extras-map-legend li").length,
        unpainted: ctx.unpainted, climate: ctx.climate, hexScene: ctx.hexScene,
      } : null,
      roadMarkers: canvas.controls?.getChildByName?.("acks-extras-road-markers")?.children?.length ?? 0,
      control: ui.controls?.control?.name ?? null,
      brush: { layer: H.m.paint.terrainPaint.layer, brush: H.m.paint.terrainPaint.brush },
    };
  },

  /** This seat's view written whole, through the API. */
  setView: async (view) => {
    const H = globalThis.__rb;
    await H.B.mapModes.setMapView(view);
    await H.sleep(500);
    return H.B.mapModes.mapView();
  },

  /** One control of the Map modes window driven as a user drives it: a pill pressed, the slider or the switch changed. */
  modeWindow: async ({ mode = null, opacity = null, handout = null }) => {
    const H = globalThis.__rb;
    if (!foundry.applications.instances.get("acks-extras-map-modes")?.rendered) {
      H.B.mapModes.openMapModes();
      await H.sleep(700);
    }
    const el = H.root(foundry.applications.instances.get("acks-extras-map-modes"));
    const change = (input, set) => { set(input); input.dispatchEvent(new Event("change", { bubbles: true })); };
    if (mode) el.querySelector(`button[data-action="pickMode"][data-mode="${mode}"]`)?.click();
    if (opacity != null) change(el.querySelector('input[name="opacity"]'), (i) => { i.value = String(opacity); });
    if (handout != null) change(el.querySelector('input[name="handout"]'), (i) => { i.checked = handout; });
    await H.sleep(800);
    return globalThis.__P.modeState({});
  },

  controlTo: async ({ control, tool }) => {
    const H = globalThis.__rb;
    await ui.controls.render({ force: true });
    ui.controls.activate({ control, tool });
    await H.sleep(700);
    return ui.controls.control?.name ?? null;
  },

  /** A territory region as the brush made one before the territory moved to the Regions control: drawn for a GM. */
  oldTerritory: async ({ sceneId, offsets, value }) => {
    const H = globalThis.__rb;
    const scene = game.scenes.get(sceneId);
    const [made] = await scene.createEmbeddedDocuments("Region", [{
      name: `QA old territory ${value}`, color: "#c47a36", visibility: CONST.REGION_VISIBILITY?.GAMEMASTER ?? 1,
      shapes: offsets.map((o) => ({ type: "polygon", hole: false, points: scene.grid.getVertices(o).flatMap((v) => [v.x, v.y]) })),
      flags: { "acks-extras": { territory: value, territoryHexes: offsets.map((o) => `${o.i}:${o.j}`) } },
    }]);
    await H.sleep(300);
    return { id: made.id, uuid: made.uuid, visibility: made.visibility };
  },

  /** A scene's regions by id with their visibility, and its settle mark. */
  settleState: async ({ sceneId }) => {
    const scene = game.scenes.get(sceneId);
    return {
      regions: Object.fromEntries(scene.regions.map((r) => [r.id, r.visibility])),
      settled: scene.getFlag("acks-extras", "battlemap")?.regionsSettled === true,
    };
  },

  setVisibility: async ({ sceneId, regionId, visibility }) => {
    const region = game.scenes.get(sceneId).regions.get(regionId);
    await region.update({ visibility });
    return region.visibility;
  },

  /** Put an application at 16,16 in front, by its id; reports its box against the viewport. */
  placeApp: async ({ id, scrollTo = null }) => {
    const H = globalThis.__rb;
    const app = foundry.applications.instances.get(id) ?? null;
    if (!app) return { found: false };
    try { app.setPosition({ left: 16, top: 16 }); app.bringToFront?.(); } catch (_e) { /* fine */ }
    await H.sleep(500);
    const el = H.root(app);
    if (scrollTo) { el?.querySelector(scrollTo)?.scrollIntoView({ block: "nearest" }); await H.sleep(300); }
    const r = el?.getBoundingClientRect();
    return { found: true, rect: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null, viewport: { w: globalThis.innerWidth, h: globalThis.innerHeight } };
  },

  /** On the player seat: are these regions drawn, and does the overlay draw water? */
  playerCanvas: async ({ sceneId, regionIds }) => {
    const scene = game.scenes.get(sceneId);
    const regions = regionIds.map((id) => {
      const doc = scene?.regions.get(id) ?? null;
      const obj = doc?.object ?? null;
      return { id, doc: !!doc, visibility: doc?.visibility ?? null, placeable: !!obj, visible: obj ? !!obj.visible : null };
    });
    const graphics = (canvas.controls?.children ?? []).flatMap((c) => c.children ?? []).filter((g) => g instanceof PIXI.Graphics);
    const byColor = {};
    for (const g of graphics) for (const d of g.geometry.graphicsData) { const k = "#" + (d.lineStyle?.color ?? 0).toString(16).padStart(6, "0"); byColor[k] = (byColor[k] ?? 0) + 1; }
    return { regions, byColor, isGM: game.user.isGM, viewed: canvas.scene?.id === sceneId };
  },

  /** Press a tool button on the scene controls with a full pointer sequence. */
  pressTool: async ({ control, tool }) => {
    const H = globalThis.__rb;
    await ui.controls.render({ force: true });
    await H.sleep(300);
    ui.controls.activate({ control });
    await H.sleep(500);
    await ui.controls.render({ force: true });
    await H.sleep(300);
    const root = H.root(ui.controls) ?? document.querySelector("#scene-controls");
    const btn = root?.querySelector(`[data-tool="${tool}"]`);
    if (!btn) return { found: false, control: ui.controls.control?.name ?? null, tools: [...(root?.querySelectorAll("[data-tool]") ?? [])].map((b) => b.dataset.tool) };
    H.takeNotes();
    const r = btn.getBoundingClientRect();
    const at = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true, button: 0 };
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      btn.dispatchEvent(type.startsWith("pointer") ? new PointerEvent(type, { ...at, pointerId: 1, pointerType: "mouse", isPrimary: true }) : new MouseEvent(type, at));
    }
    await H.sleep(800);
    const palette = canvas?.walls?.constructor?.paletteClass;
    const preset = palette?.SETTING_KEY ? game.settings.get("core", palette.SETTING_KEY) : null;
    return {
      found: true, control: ui.controls.control?.name ?? null, tool: ui.controls.tool?.name ?? null,
      notes: H.takeNotes().filter((n) => n.kind !== "info" || !/^Reading |entries available/.test(n.text)),
      preset: preset ? { move: preset.move, sight: preset.sight, light: preset.light, sound: preset.sound, door: preset.door, water: preset.flags?.["acks-extras"]?.water ?? null } : null,
    };
  },

  /** Draw a wall with core's tool by a scripted drag; reports the wall it made, if any. */
  drawWall: async ({ sceneId, from, to }) => {
    const H = globalThis.__rb;
    const scene = game.scenes.get(sceneId);
    const before = new Set(scene.walls.map((w) => w.id));
    await H.dragCanvas(from, to);
    const made = await H.poll(() => scene.walls.find((w) => !before.has(w.id)) ?? null, { tries: 20, every: 150 });
    return made ? { id: made.id, uuid: made.uuid, c: made.c, move: made.move, sight: made.sight, light: made.light, sound: made.sound, door: made.door, water: made.getFlag("acks-extras", "water") ?? null } : null;
  },

  /** The GM overlay's water drawing: one Graphics entry per solid line, many per dashed one. */
  overlay: async () => {
    const graphics = (canvas.controls?.children ?? []).flatMap((c) => c.children ?? []).filter((g) => g instanceof PIXI.Graphics);
    const byColor = {};
    for (const g of graphics) for (const d of g.geometry.graphicsData) { const k = "#" + (d.lineStyle?.color ?? 0).toString(16).padStart(6, "0"); byColor[k] = (byColor[k] ?? 0) + 1; }
    return { graphics: graphics.length, byColor, control: ui.controls.control?.name ?? null };
  },

  /** Open a wall's sheet, optionally name its water, and place it at 16,16 for the camera. */
  wallSheetOpen: async ({ wallUuid, name = null }) => {
    const H = globalThis.__rb;
    const wall = await fromUuid(wallUuid);
    const app = await wall.sheet.render(true);
    await H.sleep(1500);
    let row = H.root(app)?.querySelector(".acks-extras-water-row");
    if (!row) return { row: false, id: app?.id ?? null };
    if (name != null) { H.change(row.querySelector(".acks-extras-water-name"), name); await H.sleep(900); }
    try { app.setPosition({ left: 16, top: 16 }); app.bringToFront?.(); } catch (_e) { /* fine */ }
    await H.sleep(500);
    row = H.root(app)?.querySelector(".acks-extras-water-row");
    row?.scrollIntoView({ block: "center" });
    await H.sleep(500);
    const r = H.root(app)?.getBoundingClientRect();
    const rr = row?.getBoundingClientRect();
    return {
      rowRect: rr ? { top: Math.round(rr.top), bottom: Math.round(rr.bottom) } : null,
      rowInWindow: !!rr && !!r && rr.top >= r.top && rr.bottom <= r.bottom,
      row: !!row, id: app.id, water: wall.getFlag("acks-extras", "water") ?? null,
      kind: row?.querySelector(".acks-extras-water-kind")?.value ?? null,
      navigable: row?.querySelector(".acks-extras-water-navigable")?.checked ?? null,
      nameField: row?.querySelector(".acks-extras-water-name")?.value ?? null,
      rows: H.root(app)?.querySelectorAll(".acks-extras-water-row").length ?? 0,
      rect: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null,
    };
  },

  /** The water row driven field by field on the OPEN sheet: kind, boat tick, name, then Not water. */
  wallSheetTrail: async ({ wallUuid }) => {
    const H = globalThis.__rb;
    const wall = await fromUuid(wallUuid);
    const app = wall.sheet;
    const row = () => H.root(app)?.querySelector(".acks-extras-water-row");
    if (!row()) return { row: false };
    const read = () => ({ water: wall.getFlag("acks-extras", "water") ?? null, move: wall.move, sight: wall.sight, kind: row()?.querySelector(".acks-extras-water-kind")?.value ?? null, navigable: row()?.querySelector(".acks-extras-water-navigable")?.checked ?? null, name: row()?.querySelector(".acks-extras-water-name")?.value ?? null, rows: H.root(app)?.querySelectorAll(".acks-extras-water-row").length ?? 0 });
    const trail = { opened: read() };
    H.change(row().querySelector(".acks-extras-water-kind"), "coast");
    await H.sleep(800);
    trail.coast = read();
    const nav = row().querySelector(".acks-extras-water-navigable");
    nav.checked = true;
    nav.dispatchEvent(new Event("change", { bubbles: true }));
    await H.sleep(800);
    trail.navigable = read();
    H.change(row().querySelector(".acks-extras-water-name"), "QA creek");
    await H.sleep(800);
    trail.named = read();
    H.change(row().querySelector(".acks-extras-water-kind"), "");
    await H.sleep(800);
    trail.notWater = read();
    try { await app.close({ animate: false }); } catch (_e) { /* closed */ }
    return { row: true, trail };
  },

  plainWall: async ({ sceneId, c }) => {
    const H = globalThis.__rb;
    const [wall] = await game.scenes.get(sceneId).createEmbeddedDocuments("Wall", [{ c }]);
    await H.sleep(300);
    return { id: wall.id, uuid: wall.uuid, move: wall.move, sight: wall.sight, water: wall.getFlag("acks-extras", "water") ?? null };
  },

  setWater: async ({ wallUuid, kind, navigable }) => {
    const H = globalThis.__rb;
    const wall = await fromUuid(wallUuid);
    await wall.setFlag("acks-extras", "water", { kind, navigable, name: "" });
    await H.sleep(300);
    return wall.getFlag("acks-extras", "water") ?? null;
  },

  /** Make the selected walls water through the Walls control's own tool. */
  markSelected: async ({ wallUuid }) => {
    const H = globalThis.__rb;
    const wall = await fromUuid(wallUuid);
    await ui.controls.render({ force: true });
    ui.controls.activate({ control: "walls", tool: "select" });
    await H.sleep(500);
    canvas.walls.activate();
    await H.sleep(600);
    wall.object?.control({ releaseOthers: true });
    await H.sleep(200);
    const controlled = canvas.walls.controlled.map((w) => w.id);
    H.takeNotes();
    const before = { move: wall.move, sight: wall.sight, light: wall.light, sound: wall.sound };
    const pressed = await globalThis.__P.pressTool({ control: "walls", tool: "acksWaterFromSelection" });
    await H.sleep(600);
    const after = { move: wall.move, sight: wall.sight, light: wall.light, sound: wall.sound };
    return { controlled, pressed: { found: pressed.found, control: pressed.control }, notes: [...(pressed.notes ?? []), ...H.takeNotes()], before, after, water: wall.getFlag("acks-extras", "water") ?? null };
  },

  /** The Battlemap window's three country selects, driven as a Judge would; the window left open at 16,16. */
  assistant: async ({ sceneId, country, clearKey = null }) => {
    const H = globalThis.__rb;
    const scene = game.scenes.get(sceneId);
    if (canvas.scene?.id !== sceneId) return { error: "scene not viewed" };
    H.B.openAssistant();
    await H.sleep(1500);
    const app = foundry.applications.instances.get("acks-extras-battlemap") ?? null;
    const el = H.root(app) ?? document.querySelector("#acks-extras-battlemap");
    const flagBefore = foundry.utils.deepClone(scene.getFlag("acks-extras", "battlemap") ?? {});
    const names = [...(el?.querySelectorAll("select[name^='country.']") ?? [])].map((s) => s.name);
    for (const [k, v] of Object.entries(country ?? {})) {
      const sel = (H.root(app) ?? document.querySelector("#acks-extras-battlemap"))?.querySelector(`select[name="country.${k}"]`);
      if (!sel) return { error: `no select for ${k}`, names };
      H.change(sel, v);
      await H.sleep(800);
    }
    if (clearKey) {
      H.change((H.root(app) ?? document.querySelector("#acks-extras-battlemap")).querySelector(`select[name="country.${clearKey}"]`), "");
      await H.sleep(800);
    }
    const flagAfter = foundry.utils.deepClone(scene.getFlag("acks-extras", "battlemap") ?? {});
    const otherKeys = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== "country"));
    const root = H.root(app) ?? document.querySelector("#acks-extras-battlemap");
    const selects = Object.fromEntries([...(root?.querySelectorAll("select[name^='country.']") ?? [])].map((s) => [s.name, s.value]));
    return { names, selects, flagCountry: flagAfter.country ?? null, othersUnchanged: JSON.stringify(otherKeys(flagBefore)) === JSON.stringify(otherKeys(flagAfter)), sceneCountry: H.B.country.sceneCountry(scene) };
  },

  closeAssistant: async () => {
    const app = foundry.applications.instances.get("acks-extras-battlemap") ?? null;
    if (app) { try { await app.close({ animate: false }); } catch (_e) { /* closed */ } }
    return !!app;
  },

  /* ---------------- the formation's country ---------------- */

  /** Hex C and neighbours, plus a row R and a pair S further off; every named pair is one hex step. */
  layout: async ({ sceneId, i = 6, j = 6 }) => {
    const scene = game.scenes.get(sceneId);
    const grid = scene.grid;
    const C = grid.getCenterPoint({ i, j });
    const w = grid.sizeX;
    const at = (off) => ({ offset: { i: off.i, j: off.j }, point: grid.getCenterPoint(off) });
    const near = (deg) => at(grid.getOffset({ x: C.x + w * Math.cos((deg * Math.PI) / 180), y: C.y + w * Math.sin((deg * Math.PI) / 180) }));
    const cells = {
      C: at({ i, j }), A: near(0), B: near(60), D: near(180), E: near(300),
      F: at({ i: i + 5, j: j + 5 }), G: at({ i: i + 6, j: Math.max(0, j - 4) }),
      R0: at({ i: 9, j: 2 }), R1: at({ i: 9, j: 3 }), R2: at({ i: 9, j: 4 }), R3: at({ i: 9, j: 5 }), R4: at({ i: 9, j: 6 }),
      S0: at({ i: 12, j: 3 }), S1: at({ i: 12, j: 4 }),
    };
    const one = (a, b) => grid.measurePath([cells[a].point, cells[b].point]).spaces ?? null;
    const steps = { CA: one("C", "A"), CB: one("C", "B"), CD: one("C", "D"), CE: one("C", "E"), R01: one("R0", "R1"), R12: one("R1", "R2"), R23: one("R2", "R3"), R34: one("R3", "R4"), S01: one("S0", "S1") };
    for (const v of Object.values(cells)) v.label = acksExtras.battlemap.terrain.hexLabelFromOffset(v.offset);
    return { cells, steps, size: { sizeX: grid.sizeX, sizeY: grid.sizeY, type: grid.type, distance: grid.distance, units: grid.units } };
  },

  /**
   * The party token placed and adopted, member A enrolled through the token HUD
   * (its own token is deleted by the enrolment), member B dropped on the sheet,
   * and the journey begun.
   */
  buildParty: async ({ partyId, sceneId, memberA, memberB, xy, hudXY }) => {
    const H = globalThis.__rb;
    const party = game.actors.get(partyId);
    const scene = game.scenes.get(sceneId);
    const f0 = await H.poll(() => Object.values(H.F.getFormations()).find((f) => f.actorId === partyId), { tries: 60, every: 200 });
    if (!f0) return { error: "no formation for the party actor" };
    H.claimed.aliases.add(f0.name);
    H.claimed.aliases.add(party.name);
    H.claimed.fids.add(f0.id);
    const td = await party.getTokenDocument({ x: xy.x, y: xy.y });
    const [token] = await scene.createEmbeddedDocuments("Token", [td.toObject()]);
    const adopted = await H.poll(() => { const r = H.F.getFormations()[f0.id]; return r?.tokenId === token.id && r?.sceneId === sceneId; }, { tries: 75, every: 200 });
    await H.sleep(1500);
    const out = { formationId: f0.id, tokenUuid: token.uuid, tokenId: token.id, adopted: !!adopted, hud: null, drop: null };
    // Member A through the token HUD.
    const mtd = await game.actors.get(memberA).getTokenDocument({ x: hudXY.x, y: hudXY.y });
    const [mt] = await scene.createEmbeddedDocuments("Token", [mtd.toObject()]);
    out.memberTokenUuid = mt.uuid;
    const placeable = await H.poll(() => canvas.tokens.get(mt.id), { tries: 50, every: 100 });
    try { canvas.tokens.activate(); } catch (_e) { /* fine */ }
    placeable?.control({ releaseOthers: true });
    await H.sleep(300);
    let hudError = null;
    try { await canvas.hud.token.bind(placeable); } catch (e) { hudError = String(e?.message ?? e); }
    const btn = await H.poll(() => document.querySelector("#token-hud .acks-formation-hud"), { tries: 30, every: 100 });
    btn?.click();
    const okA = await H.poll(() => H.F.getFormations()[f0.id]?.members?.some((m) => m?.actorId === memberA), { tries: 50, every: 200 });
    await H.sleep(800);
    out.hud = { button: !!btn, enrolled: !!okA, tokenGone: !scene.tokens.get(mt.id), hudError };
    try { await canvas.hud.token.close(); } catch (_e) { /* closed */ }
    try { canvas.tokens.releaseAll(); } catch (_e) { /* fine */ }
    // Member B dropped on the party sheet.
    const app = await party.sheet.render(true);
    await H.sleep(1500);
    const el = H.root(app);
    const dt = new DataTransfer();
    dt.setData("text/plain", JSON.stringify({ type: "Actor", uuid: game.actors.get(memberB).uuid }));
    el.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
    const okB = await H.poll(() => H.F.getFormations()[f0.id]?.members?.some((m) => m?.actorId === memberB), { tries: 40, every: 200 });
    out.drop = { enrolled: !!okB };
    await H.T.setJourneyMode(f0.id, "journey", { sceneId });
    await H.sleep(1000);
    try { await app.close({ animate: false }); } catch (_e) { /* closed */ }
    const f = H.F.getFormations()[f0.id];
    out.partyTokenOf = f.tokenId;
    out.mode = f.travel?.mode ?? null;
    out.members = (f.members ?? []).map((m) => m?.actorId ?? null);
    return out;
  },

  /** The record and its resolution, in the shape the recipes read. */
  record: async ({ fid }) => {
    const H = globalThis.__rb;
    const f = H.formation(fid);
    if (!f) return null;
    const t = H.T.travelOf(f);
    const c = H.T.countryOf(f);
    const pick = (o) => ({ ground: o.ground, encounterTerrain: o.encounterTerrain, territory: o.territory, climate: o.weather?.climate ?? o.climate, road: o.road, following: o.following });
    return {
      keys: Object.keys(f.travel ?? {}).sort(),
      map: f.travel?.map ?? null,
      override: f.travel?.override ?? null,
      hex: f.travel?.hex ?? null,
      day: { cadenceCarry: f.travel?.day?.cadenceCarry ?? null, hexesEntered: f.travel?.day?.hexesEntered ?? null, miles: f.travel?.day?.miles ?? null, hours: f.travel?.day?.hours ?? null },
      dayKey: H.T.journeyDayKey(t),
      dayCount: t.dayCount ?? null,
      movement: f.travel?.movement?.mode ?? null,
      lostPhase: t.lost?.phase ?? null,
      tokenId: f.tokenId ?? null,
      sceneId: f.sceneId ?? null,
      values: pick(t),
      provenance: t.provenance,
      mapValues: c.mapValues,
      worldTime: game.time.worldTime,
    };
  },

  /** Drag the party token to a top-left, centre to centre, and report what the journey did. */
  drag: async ({ fid, xy }) => {
    const H = globalThis.__rb;
    const f = H.formation(fid);
    const tok = H.F.getPartyToken(f);
    if (!tok) return { error: "no party token" };
    const entered = [];
    const hook = Hooks.on("acksExtras.hexEntered", (p) => entered.push({ cadence: p.cadence, territory: p.territory, hex: p.hex ? { i: p.hex.i, j: p.hex.j } : null, throwOwed: p.throwOwed }));
    H.action = "drag";
    const before = { worldTime: game.time.worldTime, dayKey: H.T.journeyDayKey(H.T.travelOf(f)) };
    await tok.update({ x: xy.x, y: xy.y }, { animate: false });
    await H.poll(() => {
      const r = H.formation(fid);
      return r?.clock?.lastPosition?.x === xy.x && r?.clock?.lastPosition?.y === xy.y;
    }, { tries: 50, every: 100 });
    await H.sleep(1200);
    Hooks.off("acksExtras.hexEntered", hook);
    let offer = null;
    const later = document.querySelector('dialog button[data-action="later"], .dialog button[data-action="later"], .application.dialog button[data-action="later"]');
    if (later) { later.click(); offer = "answered later"; await H.sleep(400); }
    H.action = null;
    const got = H.collect();
    const during = got.all.filter((m) => m.action === "drag");
    return { entered, messages: got.claimed, unclaimed: got.unclaimed, navCards: during.filter((m) => m.nav).length, messagesDelta: during.length, worldTimeDelta: game.time.worldTime - before.worldTime, offer, dayKeyBefore: before.dayKey, dayKeyAfter: H.T.journeyDayKey(H.T.travelOf(H.formation(fid))) };
  },

  /** Open the sheet and describe its country surfaces; closes unless `keep`. */
  sheet: async ({ partyId, keep = false }) => {
    const H = globalThis.__rb;
    const party = game.actors.get(partyId);
    const app = await party.sheet.render(true);
    await H.sleep(2000);
    const el = H.root(app);
    if (!el) return { rendered: false };
    const ctx = await app._prepareContext({});
    const country = ctx.travel?.country ?? null;
    const sky = el.querySelector('[data-section="sky"]');
    const camp = el.querySelector('[data-section="camp"]');
    const hand = el.querySelector('[data-section="hand"]');
    const out = {
      rendered: true,
      cards: H.countryCards(el),
      draw: el.querySelector('[data-section="country"] .acks-extras-country-draw')?.textContent.trim() ?? null,
      skyCard: sky?.querySelector(".acks-extras-country-card") ? {
        value: sky.querySelector(".acks-extras-country-value")?.textContent.trim() ?? null,
        provenance: sky.querySelector(".acks-extras-country-source")?.dataset.provenance ?? null,
        paint: !!sky.querySelector('[data-action="paintThisHex"]'),
        paintBrush: sky.querySelector('[data-action="paintThisHex"]')?.dataset.brush ?? null,
      } : null,
      camp: camp ? {
        waterAuto: !!ctx.travel?.camp?.waterAuto,
        waterHint: !!camp.querySelector('input[name="travel.camp.water"]')?.closest("label")?.nextElementSibling?.classList.contains("hint"),
        waterChecked: camp.querySelector('input[name="travel.camp.water"]')?.checked ?? null,
      } : null,
      labels: { riverLand: H.tableLabel("riverLand") },
      hand: hand ? [...hand.querySelectorAll(".acks-extras-country-hand-row")].map((r) => ({
        key: r.dataset.key, name: r.querySelector("select")?.name ?? null, value: r.querySelector("select")?.value ?? null,
        clear: !!r.querySelector('[data-action="clearOverride"]'), map: r.querySelector(".acks-extras-country-hand-map")?.textContent.trim() ?? null,
        options: [...(r.querySelector("select")?.options ?? [])].map((o) => o.value).filter(Boolean).slice(0, 40),
      })) : null,
      judge: !!el.querySelector('[data-application-part="judge"]'),
      chips: (ctx.frame?.reading?.chips ?? []).map((c) => ({ key: c.key, label: c.label })),
      ctx: country ? {
        cards: country.cards.map((c) => ({ key: c.key, value: c.value, provenance: c.provenance, chip: c.chip, mapValue: c.mapValue, mapLabel: c.mapLabel, paintable: c.paintable, paintBrush: c.paintBrush, valueLabel: c.valueLabel })),
        climate: { value: country.climate?.value, provenance: country.climate?.provenance, chip: country.climate?.chip, paintable: country.climate?.paintable },
        encountersDrawOn: country.encountersDrawOn,
        overrides: (ctx.countryOverrides ?? []).map((r) => ({ key: r.key, set: r.set, hasMap: r.hasMap })),
      } : null,
      partsLine: ctx.strip?.speed?.partsLine ?? null,
      movement: el.querySelector('select[name="travel.movement.mode"]')?.value ?? null,
    };
    if (!keep) { try { await app.close({ animate: false }); } catch (_e) { /* closed */ } }
    return out;
  },

  /** Activate a primary tab on the OPEN sheet and place it at 16,16 in front. */
  tab: async ({ partyId, tab = null, place = true }) => {
    const H = globalThis.__rb;
    const app = game.actors.get(partyId).sheet;
    const el = H.root(app);
    if (place) { try { app.setPosition({ left: 16, top: 16 }); app.bringToFront?.(); } catch (_e) { /* fine */ } }
    let found = null;
    if (tab) {
      const n = el?.querySelector(`.tabs [data-group="primary"][data-tab="${tab}"]`);
      found = !!n;
      n?.click();
    }
    await H.sleep(900);
    return { found, active: app.tabGroups?.primary ?? null, id: app.id };
  },

  /** Set a select on the OPEN sheet by name and let the form submit. */
  setSelect: async ({ partyId, name, value }) => {
    const H = globalThis.__rb;
    const app = game.actors.get(partyId).sheet;
    const el = H.root(app);
    const sel = el?.querySelector(`select[name="${name}"]`);
    if (!sel) return { found: false, names: [...(el?.querySelectorAll("select") ?? [])].map((s) => s.name).slice(0, 60) };
    const had = [...sel.options].some((o) => o.value === value);
    H.change(sel, value);
    await H.sleep(1000);
    return { found: true, had, value: sel.value };
  },

  /** Click a control on the OPEN sheet. */
  press: async ({ partyId, selector, settle = 1000 }) => {
    const H = globalThis.__rb;
    const app = game.actors.get(partyId).sheet;
    const el = H.root(app);
    const n = el?.querySelector(selector);
    if (!n) return { found: false };
    n.click();
    await H.sleep(settle);
    return { found: true };
  },

  /** Press a card's paint chip and describe the palette that opens. */
  paintChip: async ({ partyId, key, inSky = false }) => {
    const H = globalThis.__rb;
    const app = game.actors.get(partyId).sheet;
    const el = H.root(app);
    const btn = inSky
      ? el?.querySelector('[data-section="sky"] [data-action="paintThisHex"]')
      : el?.querySelector(`[data-section="country"] .acks-extras-country-card[data-key="${key}"] [data-action="paintThisHex"]`);
    if (!btn) return { found: false };
    btn.click();
    await H.poll(() => canvas.ready && !!document.querySelector("#acks-extras-terrain-palette"), { tries: 50, every: 150 });
    await H.sleep(2500);
    const pal = document.querySelector("#acks-extras-terrain-palette");
    const s = H.m.paint.terrainPaint;
    return {
      found: true,
      viewed: canvas.scene?.id ?? null,
      palette: !!pal,
      pressed: pal?.querySelector('button[data-action="pickLayer"][aria-pressed="true"]')?.dataset.layer ?? null,
      armedSwatch: pal?.querySelector("button[data-brush].is-active")?.dataset.brush ?? null,
      state: { layer: s.layer, brush: s.brush, armedBy: s.armedBy },
    };
  },

  /** Count the writes of this formation's map by the formations setting's updates (an observer). */
  watchRefresh: async ({ fid }) => {
    const H = globalThis.__rb;
    H.watch = { fid, writes: 0, updates: 0, last: JSON.stringify(H.formation(fid)?.travel?.map ?? null) };
    H.watchHook = Hooks.on("updateSetting", (setting) => {
      if (setting.key !== "acks-extras.formations") return;
      H.watch.updates++;
      const now = JSON.stringify(H.formation(fid)?.travel?.map ?? null);
      if (now !== H.watch.last) { H.watch.writes++; H.watch.last = now; }
    });
    return { armed: true };
  },

  readWatch: async ({ stop = false, waitMs = 0 } = {}) => {
    const H = globalThis.__rb;
    if (waitMs) await H.sleep(waitMs);
    const out = { writes: H.watch?.writes ?? null, updates: H.watch?.updates ?? null };
    if (stop && H.watchHook) { Hooks.off("updateSetting", H.watchHook); H.watchHook = null; }
    return out;
  },

  resetWatch: async () => { const H = globalThis.__rb; if (H.watch) { H.watch.writes = 0; H.watch.updates = 0; H.watch.last = JSON.stringify(H.formation(H.watch.fid)?.travel?.map ?? null); } return true; },

  deleteToken: async ({ fid }) => {
    const H = globalThis.__rb;
    const f = H.formation(fid);
    const tok = H.F.getPartyToken(f);
    if (!tok) return { error: "no party token" };
    await tok.delete();
    await H.poll(() => H.formation(fid)?.tokenId == null, { tries: 40, every: 150 });
    await H.sleep(500);
    return globalThis.__P.record({ fid });
  },

  placeToken: async ({ fid, partyId, sceneId, xy }) => {
    const H = globalThis.__rb;
    const scene = game.scenes.get(sceneId);
    const data = (await game.actors.get(partyId).getTokenDocument({ x: xy.x, y: xy.y })).toObject();
    delete data._id;
    const [tok] = await scene.createEmbeddedDocuments("Token", [data]);
    const seated = await H.poll(() => {
      const r = H.formation(fid);
      return r?.tokenId === tok.id && r?.travel?.map?.sceneId === sceneId && r?.travel?.map?.i != null ? r : null;
    }, { tries: 40, every: 150 });
    await H.sleep(600);
    return { tokenUuid: tok.uuid, tokenId: tok.id, seated: !!seated, ...(await globalThis.__P.record({ fid })) };
  },

  /** A token SET DOWN rather than walked: the truth option on the update, then the seat. */
  setDown: async ({ fid, xy }) => {
    const H = globalThis.__rb;
    const f = H.formation(fid);
    const tok = H.F.getPartyToken(f);
    if (!tok) return { error: "no party token" };
    const before = { hexesEntered: f.travel?.day?.hexesEntered ?? null, hex: f.travel?.hex ?? null };
    const entered = [];
    const hook = Hooks.on("acksExtras.hexEntered", (p) => entered.push(p.hex ?? null));
    H.action = "setDown";
    await tok.update({ x: xy.x, y: xy.y }, { animate: false, "acks-extras.lostTruth": true });
    await H.T.seatJourneyHex(tok, fid);
    await H.sleep(1200);
    H.action = null;
    Hooks.off("acksExtras.hexEntered", hook);
    const got = H.collect();
    return { before, entered: entered.length, messages: got.claimed, unclaimed: got.unclaimed, ...(await globalThis.__P.record({ fid })) };
  },

  /** Press Stock this hex on the OPEN sheet; the dialog is read by the next call. */
  stockPress: async ({ partyId }) => {
    const H = globalThis.__rb;
    const el = H.root(game.actors.get(partyId).sheet);
    const btn = el?.querySelector('[data-section="poi"] [data-action="hexStock"]') ?? el?.querySelector('[data-action="hexStock"]');
    if (!btn) return { found: false };
    btn.click();
    await H.sleep(1800);
    return { found: true };
  },

  stockRead: async () => {
    const H = globalThis.__rb;
    const dlg = [...document.querySelectorAll(".application.dialog, dialog, .application")].find((d) => d.querySelector('select[name="terrain"]') && d.querySelector('button[data-action="cancel"]'));
    if (!dlg) return { found: false };
    const out = { found: true, terrain: dlg.querySelector('select[name="terrain"]').value, territory: dlg.querySelector('select[name="territory"]')?.value ?? null };
    dlg.querySelector('button[data-action="cancel"]').click();
    await H.sleep(800);
    out.closed = !document.contains(dlg);
    return out;
  },

  /** The strip's factor line for the cell's tooltip, read against the imported table without printing a figure. */
  factorLine: async ({ partyId, fid, otherGround = null }) => {
    const H = globalThis.__rb;
    const app = game.actors.get(partyId).sheet;
    const ctx = await app._prepareContext({});
    const t = H.T.travelOf(H.formation(fid));
    let table = null;
    try { table = H.m.tables.getTable("travel", "terrainMultipliers"); } catch (_e) { table = null; }
    const line = ctx.strip?.speed?.partsLine ?? "";
    const factor = (g) => Number(table?.[g]);
    const shows = (g) => { const f = factor(g); return Number.isFinite(f) && f > 0 && f !== 1; };
    const label = (g) => game.i18n.localize(`ACKS-VEHICLES.reason.terrain.${g}`);
    return {
      imported: !!table && Object.keys(table).length > 0, ground: t.ground,
      expectShown: shows(t.ground), labelInLine: line.includes(label(t.ground)),
      other: otherGround ? { ground: otherGround, expectShown: shows(otherGround), labelInLine: line.includes(label(otherGround)) } : null,
      missingNote: line.includes(game.i18n.localize("ACKS-VEHICLES.reason.tablesMissing")),
    };
  },

  applyTravelForm: async ({ fid, tv }) => {
    const H = globalThis.__rb;
    await H.T.applyTravelForm(fid, tv);
    await H.sleep(600);
    return H.formation(fid)?.travel?.override ?? null;
  },

  /** On the player seat: what the party sheet shows a player. */
  playerSheet: async ({ partyId }) => {
    const H = globalThis.__rb;
    const party = game.actors.get(partyId);
    if (!party) return { rendered: false, reason: "no actor visible" };
    let app = null;
    try { app = await party.sheet.render(true); } catch (e) { return { rendered: false, reason: e.message }; }
    await H.sleep(2500);
    const el = H.root(app);
    const sec = el?.querySelector('[data-section="country"]');
    const out = {
      rendered: !!el,
      cards: sec ? H.countryCards(el) : null,
      sources: sec?.querySelectorAll(".acks-extras-country-source").length ?? null,
      chips: sec?.querySelectorAll(".acks-extras-country-chip").length ?? null,
      actions: sec ? [...sec.querySelectorAll("[data-action]")].map((n) => n.dataset.action) : null,
      skyCards: el?.querySelectorAll('[data-section="sky"] .acks-extras-country-card').length ?? null,
      judgePart: !!el?.querySelector('[data-application-part="judge"]'),
      judgeTab: !!el?.querySelector('.tabs [data-tab="judge"]'),
      hand: !!el?.querySelector('[data-section="hand"]'),
    };
    try { await app.close({ animate: false }); } catch (_e) { /* closed */ }
    return out;
  },

  /** Pause or unpause the journey as the clock's control does, the baseline at the token. */
  pause: async ({ fid, paused }) => {
    const H = globalThis.__rb;
    const f = H.formation(fid);
    const token = f ? H.F.getPartyToken(f) : null;
    await H.m.model.patchFormation(fid, (record) => {
      record.clock = { ...(record.clock ?? {}), paused, pausedBy: paused ? "judge" : null, ...(token ? { lastPosition: { x: token.x, y: token.y } } : {}) };
    });
    await H.sleep(400);
    const g = H.formation(fid);
    return { paused: g?.clock?.paused ?? null, pausedBy: g?.clock?.pausedBy ?? null };
  },

  /** Write a country key into the declared record, as an older record holds one. */
  declare: async ({ fid, key, value }) => {
    const H = globalThis.__rb;
    await H.m.model.patchFormation(fid, (record) => { record.travel = { ...(record.travel ?? {}), [key]: value }; });
    await H.sleep(400);
    return H.formation(fid)?.travel?.[key] ?? null;
  },

  /** A ground's own encounter table and its label, as the Encounters line prints it. */
  tableFor: async ({ ground }) => {
    const H = globalThis.__rb;
    const key = H.m.encT.encounterTerrainFor(ground);
    return { key, label: key ? H.tableLabel(key) : null };
  },

  label: async ({ key }) => globalThis.__rb.tableLabel(key),
  territoryLabel: async ({ key }) => game.i18n.localize(`ACKS-FORMATION.travel.territory.${key}`),
  provenanceLabel: async ({ key }) => game.i18n.localize(`ACKS-FORMATION.country.provenance.${key}`),

  /** Put the seat's own client state back: brush, palette, wall preset, cursors, notifications. */
  restoreSeat: async ({ preset = null } = {}) => {
    const H = globalThis.__rb;
    const out = {};
    const app = foundry.applications.instances.get("acks-extras-terrain-palette") ?? null;
    if (app) { try { await app.close({ animate: false }); } catch (_e) { /* closed */ } }
    try { H?.m?.paint?.terrainPaint?.disarm?.(); } catch (_e) { /* fine */ }
    try { H?.m?.session?.session?.disarm?.(); } catch (_e) { /* fine */ }
    out.brush = H?.m?.paint?.terrainPaint?.brush ?? null;
    const palette = canvas?.walls?.constructor?.paletteClass;
    if (palette?.SETTING_KEY && preset?.key === palette.SETTING_KEY) {
      const now = game.settings.get("core", palette.SETTING_KEY);
      if (JSON.stringify(now) !== JSON.stringify(preset.value)) {
        await game.settings.set("core", palette.SETTING_KEY, preset.value);
        out.wallPresetRestored = JSON.stringify(game.settings.get("core", palette.SETTING_KEY)) === JSON.stringify(preset.value);
      } else out.wallPresetUnchanged = true;
    }
    try { await ui.controls.render({ force: true }); ui.controls.activate({ control: "tokens", tool: "select" }); } catch (_e) { /* fine */ }
    try { if (canvas?.controls?.cursors && H?.cursorsWere != null) canvas.controls.cursors.visible = H.cursorsWere; } catch (_e) { /* fine */ }
    if (H?.watchHook) { Hooks.off("updateSetting", H.watchHook); H.watchHook = null; }
    if (H?.origUniform) { CONFIG.Dice.randomUniform = H.origUniform; H.origUniform = null; out.diceRestored = true; }
    if (H?.notesPatched) { for (const [k, fn] of Object.entries(H.orig)) ui.notifications[k] = fn; H.notesPatched = false; out.notesRestored = true; }
    if (H?.msgHooks) { Hooks.off("preCreateChatMessage", H.msgHooks.pre); Hooks.off("createChatMessage", H.msgHooks.post); H.msgHooks = null; out.messageHooksRemoved = true; }
    if (H?.recorder) { console.error = H.origConsoleError; window.removeEventListener("error", H.onError); window.removeEventListener("unhandledrejection", H.onRejection); H.recorder = null; out.recorderRemoved = true; }
    return out;
  },

  /** The run's tagged cards gathered since the last collection: claimed uuids, and what is left alone. */
  collectMessages: async () => { const got = globalThis.__rb.collect(); return { claimed: got.claimed, unclaimed: got.unclaimed }; },

  /** What the console recorder saw since install. */
  errors: async () => {
    const H = globalThis.__rb;
    return { recorderSince: H?.recorder ? new Date(H.recorder).toISOString() : null, count: H?.errors?.length ?? null, list: (H?.errors ?? []).slice(0, 15).map((e) => ({ at: new Date(e.at).toISOString(), text: e.text.slice(0, 400) })) };
  },

  /** Back to the token controls with both canvas sessions disarmed. */
  resetControls: async () => {
    const H = globalThis.__rb;
    try { H.m.paint.terrainPaint.disarm(); } catch (_e) { /* fine */ }
    try { H.m.session.session.disarm(); } catch (_e) { /* fine */ }
    await ui.controls.render({ force: true });
    ui.controls.activate({ control: "tokens", tool: "select" });
    await H.sleep(500);
    return { control: ui.controls.control?.name ?? null, tool: ui.controls.tool?.name ?? null };
  },

  closeAll: async () => {
    let n = 0;
    try { await canvas?.hud?.token?.close?.(); } catch (_e) { /* closed */ }
    for (const a of [...foundry.applications.instances.values()]) if (/Party|Formation|Dialog|Sheet|Config|Palette|Assistant|MapModes/.test(a.constructor.name)) { try { await a.close({ animate: false }); n++; } catch (_e) { /* closed */ } }
    return n;
  },
};

/* ------------------------------------------------------------------ */
/*  Node side                                                           */
/* ------------------------------------------------------------------ */

const page = async (api, fn, ...args) =>
  JSON.parse(await api.eval(`(${fn.toString()})(...${JSON.stringify(args)}).then((v) => JSON.stringify(v === undefined ? null : v))`));

async function ready(api, label, seconds = 240) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try {
      ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.formation?.getFormations && !!globalThis.acksExtras?.battlemap?.country`);
    } catch {
      ok = false;
    }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}

/* Every page function, installed in the page as `__P` so one can call another
 * (a stringified function carries no closure). */
const installP = (api) => api.eval(`globalThis.__P = {${Object.entries(P).map(([k, fn]) => `${k}: ${fn.toString()}`).join(",\n")}}; true`);

const seats = {};
async function seat(key) {
  const api = await connect({ browser, origin, user: SEATS[key], port: PORTS[key] });
  seats[key] = api;
  note(`${key} ready after (s)`, await ready(api, key));
  // The seat must run the working tree, not a cached copy: functions this release added are the marker.
  const fresh = await api.eval(`typeof globalThis.acksExtras?.formation?.travel?.trueTravelOf === "function" && typeof globalThis.acksExtras?.formation?.travel?.clearDeclaredCountry === "function" && globalThis.acksExtras?.formation?.apiVersion === 18`);
  if (!fresh) throw new Error(`${key}: stale module code loaded; the page did not pick up the working tree`);
  note(`${key} runs the working tree`, fresh);
  await installP(api);
  return api;
}

/** A section of the party sheet shot: the tab activated, the sheet at 16,16, the selector scoped to that window. */
async function sheetShot(api, partyId, tab, slug, sel) {
  const t = await page(api, P.tab, { partyId, tab });
  note(`tab ${tab}`, t);
  return shot(api, slug, t.id ? `[id="${t.id}"] ${sel}` : sel);
}

/** A release shot: cursors hidden, the subject scrolled into view, clipped, its box logged. */
async function shot(api, slug, selector) {
  try {
    const seen = await api.eval(`(() => {
      try { if (canvas?.controls?.cursors) canvas.controls.cursors.visible = false; } catch (e) {}
      try { game.tooltip?.deactivate?.(); } catch (e) {}
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      el.scrollIntoView({ block: "nearest" });
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), inside: r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight };
    })()`);
    await sleep(600);
    const r = await api.shot(`${SHOT_DIR}/${slug}.png`, selector);
    note(`shot ${slug}`, { seen, bytes: r.bytes, clip: r.clip });
    shots.push({ slug, bytes: r.bytes, inside: seen?.inside ?? null });
    return r;
  } catch (err) {
    note(`shot ${slug} FAILED`, err?.message ?? String(err));
    shots.push({ slug, failed: err?.message ?? String(err) });
    return null;
  }
}

const sceneData = (name, grid, extra = {}) => ({
  name, active: false, navigation: false, width: 2200, height: 1600, padding: 0, tokenVision: false, backgroundColor: "#8a8a8a",
  grid: { type: grid.type, size: CELL, distance: grid.distance ?? MILES, units: grid.units ?? "mi" },
  ownership: { default: 2 }, ...extra,
});

/* ------------------------------------------------------------------ */
/*  Part: the battlemap's country layers and water                      */
/* ------------------------------------------------------------------ */

async function walkLayers(W) {
  const { gm, player } = W;
  const hex = await gm.create("Scene", sceneData(`QA Layers hex ${NONCE}`, { type: 2 }));
  const square = await gm.create("Scene", sceneData(`QA Layers square ${NONCE}`, { type: 1 }));
  note("hex scene viewed", await page(gm, P.viewScene, hex.id));
  const L = await page(gm, P.layout, { sceneId: hex.id, i: 5, j: 5 });
  note("layout", { cells: Object.fromEntries(["C", "A", "B", "D", "E", "F", "G"].map((k) => [k, L.cells[k].offset])), steps: L.steps });
  const pt = (k) => L.cells[k].point;
  const paintable = await page(gm, P.paintable);
  const forest = ["forestTaiga", "forestDeciduous"].find((v) => paintable.terrain.includes(v)) ?? paintable.terrain[0];
  const tracked = new Set();
  const track = async () => {
    let n = 0;
    for (const layer of ["terrain", "territory"]) {
      for (const r of await page(gm, P.regions, { sceneId: hex.id, layer })) {
        if (tracked.has(r.uuid)) continue;
        gm.track(r.uuid, "Region");
        tracked.add(r.uuid);
        n++;
      }
    }
    return n;
  };
  let pal;
  let regs;
  W.preset = W.preset ?? await page(gm, P.wallPreset);
  note("wall preset at start", { key: W.preset.key, scope: W.preset.scope, flagged: !!W.preset.value?.flags?.["acks-extras"] });

  section("battlemap Terrain painting, step 1 (changed): the Country brush opens on the Terrain pill");
  const cal = await page(gm, P.armCalibration, { tool: "square" });
  note("calibration armed", cal);
  pal = await page(gm, P.armTool);
  note("brush armed by the tool", { pills: pal.pills, pressed: pal.pressed, state: pal.state, tool: pal.tool, control: pal.control, calibration: pal.calibration, toolDom: pal.toolDom, swatches: pal.swatches.length });
  const tv = await page(gm, P.terrainVocab);
  note("terrain vocabulary", tv);
  check("TP1: arming the Country brush disarms calibration (the square mode was armed, now none)", cal.mode === "square" && pal.calibration === null, { before: cal.mode, after: pal.calibration });
  check("TP1: the palette opens on the Terrain pill, the two pills terrain / territory", pal.palette && pal.pressed === "terrain" && same(pal.pills.map((p) => p.layer), ["terrain", "territory"]), pal.pills);
  check("TP1: one swatch per encounter terrain on a ground (21), no bare ground, no river, imported extras beside them, and the eraser", tv.fine === 21 && tv.fineAll === 21 && tv.rivers.length === 0 && tv.bare.length === 0 && tv.eraser && tv.swatchCount === tv.fine + tv.extras, tv);
  check("TP1: the toolbar shows the brush armed", pal.tool === "terrain" && pal.control === "acksBattlemap" && pal.state.armedBy === "tool" && !!pal.state.brush && !!pal.toolDom && (/\bactive\b/.test(pal.toolDom.cls) || pal.toolDom.pressed === "true"), { tool: pal.tool, control: pal.control, state: pal.state, toolDom: pal.toolDom });

  section("layers 1. the Territory pill");
  pal = await page(gm, P.pickLayer, { layer: "territory" });
  note("territory pill", { pressed: pal.pressed, groups: pal.groups, state: pal.state });
  check("L1: the swatches are the four territories, each its own colour, with the eraser", pal.pressed === "territory" && pal.groups?.length === 1 && pal.groups[0].keys.length === 4 && pal.groups[0].colors === 4 && pal.swatches.includes("erase"), pal.groups);
  note("A X (paintHexAt)", await page(gm, P.paintAt, { sceneId: hex.id, point: pt("A"), value: X, layer: "territory" }));
  note("pick X", await page(gm, P.pickBrush, { value: X }));
  const clickB = await page(gm, P.clickHex, { sceneId: hex.id, point: pt("B") });
  note("click B", clickB);
  check("L1: paintHexAt and a real click both paint a territory", clickB.territory === X, clickB);
  // The snapshot: the palette with its two pills, the Territory layer armed and X chosen.
  const palNow = await page(gm, P.palette);
  note("placed palette", await page(gm, P.placeApp, { id: "acks-extras-terrain-palette" }));
  check("shot state: Territory pressed and X the armed swatch", palNow.pressed === "territory" && palNow.armedSwatch === X && palNow.pills.length === 2, { pressed: palNow.pressed, armed: palNow.armedSwatch });
  await shot(gm, "battlemap-country-brush", "#acks-extras-terrain-palette");
  note("C terrain (paintHexAt)", await page(gm, P.paintAt, { sceneId: hex.id, point: pt("C"), value: forest, layer: "terrain" }));
  note("C Y (paintHexAt)", await page(gm, P.paintAt, { sceneId: hex.id, point: pt("C"), value: Y, layer: "territory" }));
  regs = await page(gm, P.regions, { sceneId: hex.id, layer: "territory" });
  note("territory regions", regs.map((g) => ({ value: g.value, hexes: g.hexes.length, visibility: g.visibility })));
  note("regions tracked", await track());
  check("L1: one region per territory value, flagged territory and territoryHexes, on the Regions control alone", regs.length === 2 && regs.find((g) => g.value === X)?.hexes.length === 2 && regs.find((g) => g.value === Y)?.hexes.length === 1 && regs.every((g) => g.visibility === 0), regs.map((g) => ({ value: g.value, hexes: g.hexes.length, visibility: g.visibility })));
  const lv = await page(gm, P.layerValues, { sceneId: hex.id, point: pt("C") });
  check("L1: the terrain region of the third hex still lists that hex", lv.terrain === forest && lv.territory === Y, lv);
  note("player views the hex scene", await page(player, P.viewScene, hex.id));
  const pc = await page(player, P.playerCanvas, { sceneId: hex.id, regionIds: regs.map((g) => g.id) });
  note("player canvas", pc);
  check("L1: a player seat sees no territory drawn", pc.viewed && !pc.isGM && pc.regions.every((g) => g.placeable === false || g.visible === false), pc.regions);

  section("layers 2. no climate on the brush");
  const climPress = await page(gm, P.pickLayer, { layer: "climate" });
  pal = await page(gm, P.palette);
  note("climate pill", { found: climPress.found, pressed: pal.pressed, pills: pal.pills.map((p) => p.layer) });
  const climPaint = await page(gm, P.paintAt, { sceneId: hex.id, point: pt("C"), value: CLIMATE_A, layer: "climate" });
  note("climate paintHexAt", climPaint);
  const climRegions = await page(gm, P.foldState, { sceneId: hex.id });
  check("L2: no Climate pill to press, the brush paints no climate, and no climate region appears", climPress.found === false && pal.pressed === "territory" && !pal.pills.some((p) => p.layer === "climate") && paintable.climate === 0 && climPaint.ok === false && climRegions.regions === 0, { found: climPress.found, pressed: pal.pressed, paintable: paintable.climate, ok: climPaint.ok, regions: climRegions.regions });

  section("layers 3. erase and repaint on the Territory pill");
  note("pick erase", await page(gm, P.pickBrush, { value: "erase" }));
  const eraseC = await page(gm, P.clickHex, { sceneId: hex.id, point: pt("C") });
  note("erase C", eraseC);
  check("L3: the erase removes the territory alone; the terrain stays", eraseC.territory === null && eraseC.terrain === forest, eraseC);
  regs = await page(gm, P.regions, { sceneId: hex.id, layer: "territory" });
  check("L3: a region left with no hex is deleted", regs.length === 1 && regs[0].value === X && regs[0].hexes.length === 2, regs.map((g) => ({ value: g.value, hexes: g.hexes.length })));
  note("pick Y", await page(gm, P.pickBrush, { value: Y }));
  const repaintA = await page(gm, P.clickHex, { sceneId: hex.id, point: pt("A") });
  note("repaint A", repaintA);
  regs = await page(gm, P.regions, { sceneId: hex.id, layer: "territory" });
  note("regions tracked", await track());
  check("L3: the repaint moves hex A between territory regions", repaintA.territory === Y && regs.find((g) => g.value === X)?.hexes.length === 1 && regs.find((g) => g.value === Y)?.hexes.length === 1, regs.map((g) => ({ value: g.value, hexes: g.hexes.length })));
  note("palette closed", await page(gm, P.closePalette));

  section("layers 4. the River and Coastline presets");
  const riverPress = await page(gm, P.pressTool, { control: "acksBattlemap", tool: "water-river" });
  note("river preset", riverPress);
  check("L4: the notification names what is armed; the preset holds all-NONE restrictions, door 0 and the river flag (navigable)", riverPress.found && riverPress.notes.some((n) => /river/i.test(n.text)) && riverPress.preset?.move === 0 && riverPress.preset?.sight === 0 && riverPress.preset?.light === 0 && riverPress.preset?.sound === 0 && riverPress.preset?.door === 0 && riverPress.preset?.water?.kind === "river" && riverPress.preset?.water?.navigable === true, { notes: riverPress.notes, preset: riverPress.preset, control: riverPress.control, tool: riverPress.tool });
  const D = pt("D");
  const E = pt("E");
  const riverEnd = { x: D.x - 1.5 * L.size.sizeX, y: D.y };
  const river = await page(gm, P.drawWall, { sceneId: hex.id, from: D, to: riverEnd });
  note("river drawn", river);
  let riverUuid = river?.uuid ?? null;
  if (river) gm.track(river.uuid, "Wall");
  check("L4: a DRAWN line is one Wall carrying the river flag and no restriction", !!river && river.water?.kind === "river" && river.water?.navigable === true && river.move === 0 && river.door === 0, river);
  if (!river) {
    const made = await page(gm, P.waterLine, { sceneId: hex.id, c: [riverEnd.x, riverEnd.y, D.x, D.y], kind: "river" });
    gm.track(made.uuid, "Wall");
    riverUuid = made.uuid;
    note("river made through the API instead (the scripted drag made no wall)", made);
  }
  const coastPress = await page(gm, P.pressTool, { control: "acksBattlemap", tool: "water-coast" });
  note("coast preset", coastPress);
  check("L4: the Coastline preset arms a coast, not navigable, and says so", coastPress.preset?.water?.kind === "coast" && coastPress.preset?.water?.navigable === false && coastPress.notes.some((n) => /coast/i.test(n.text)), { notes: coastPress.notes, preset: coastPress.preset });
  const coastEnd = { x: E.x + 1.5 * L.size.sizeX, y: E.y };
  const coast = await page(gm, P.drawWall, { sceneId: hex.id, from: E, to: coastEnd });
  note("coast drawn", coast);
  if (coast) gm.track(coast.uuid, "Wall");
  check("L4: a drawn coast is one Wall carrying the coast flag", !!coast && coast.water?.kind === "coast" && coast.water?.navigable === false, coast);
  if (!coast) {
    const made = await page(gm, P.waterLine, { sceneId: hex.id, c: [E.x, E.y, coastEnd.x, coastEnd.y], kind: "coast" });
    gm.track(made.uuid, "Wall");
    note("coast made through the API instead (the scripted drag made no wall)", made);
  }
  const ov = await page(gm, P.overlay);
  note("overlay (GM)", ov);
  check("L4: with a drawing control active the GM overlay draws the river solid (one run) and the coast dashed (many)", ["walls", "acksBattlemap"].includes(ov.control) && (ov.byColor["#3f7fb5"] ?? 0) === 1 && (ov.byColor["#2c5a85"] ?? 0) > 1, ov);
  const pov = await page(player, P.playerCanvas, { sceneId: hex.id, regionIds: [] });
  note("player canvas", pov);
  check("L4: a player seat draws neither water line", pov.viewed && !pov.isGM && !("#3f7fb5" in pov.byColor) && !("#2c5a85" in pov.byColor), pov.byColor);

  section("layers 5. the wall sheet and the Walls control");
  const opened = await page(gm, P.wallSheetOpen, { wallUuid: riverUuid, name: "QA brook" });
  note("wall sheet opened", opened);
  check("L5: the river's sheet carries one water row: river, the boat ticked, the name typed (written at once)", opened.row && opened.rows === 1 && opened.kind === "river" && opened.navigable === true && opened.nameField === "QA brook" && opened.water?.name === "QA brook", opened);
  if (opened.row) await shot(gm, "battlemap-water-lines", `[id="${opened.id}"]`);
  const sheet = await page(gm, P.wallSheetTrail, { wallUuid: riverUuid });
  note("wall sheet trail", sheet);
  check("L5: each change writes at once: kind, the boat tick, the name", sheet.row && sheet.trail.coast.water?.kind === "coast" && sheet.trail.navigable.water?.navigable === true && sheet.trail.named.water?.name === "QA creek" && Object.values(sheet.trail).every((s) => s.rows <= 1), sheet.trail);
  check("L5: Not water removes the flag and leaves the wall's own restrictions alone", sheet.trail?.notWater?.water === null && sheet.trail?.notWater?.move === sheet.trail?.opened?.move && sheet.trail?.notWater?.sight === sheet.trail?.opened?.sight, { notWater: sheet.trail?.notWater, opened: sheet.trail?.opened });
  note("river flag restored", await page(gm, P.setWater, { wallUuid: riverUuid, kind: "river", navigable: true }));
  const G = pt("G");
  const plain = await page(gm, P.plainWall, { sceneId: hex.id, c: [G.x - 40, G.y - 40, G.x + 40, G.y + 40] });
  gm.track(plain.uuid, "Wall");
  note("plain wall", plain);
  const marked = await page(gm, P.markSelected, { wallUuid: plain.uuid });
  note("marked", marked);
  check("L5: Mark the selected walls as water lands the flag, leaves the restrictions, and warns the party cannot cross it", marked.controlled?.length === 1 && marked.water?.kind === "river" && same(marked.before, marked.after) && marked.before.move !== 0 && marked.notes.some((n) => n.kind === "warn" && /cannot/i.test(n.text)), marked);
  note("river closed to boats", await page(gm, P.setWater, { wallUuid: riverUuid, kind: "river", navigable: false }));
  const remarked = await page(gm, P.markSelected, { wallUuid: riverUuid });
  note("re-marked", remarked);
  check("L5: pressing the tool again on the unticked river: updated 1, navigable still false", remarked.water?.kind === "river" && remarked.water?.navigable === false && remarked.notes.some((n) => /0 wall\(s\) made water, 1 updated/.test(n.text)), { water: remarked.water, notes: remarked.notes });
  note("river reopened", await page(gm, P.setWater, { wallUuid: riverUuid, kind: "river", navigable: true }));

  section("layers 6. the Battlemap window's country selects");
  const asst = await page(gm, P.assistant, { sceneId: hex.id, country: { ground: "scrublandSparse", territory: X, climate: CLIMATE_A } });
  note("assistant", asst);
  check("L6: the three keys land at once in the setup record with no apply, nothing else changed, and sceneCountry returns them", asst.flagCountry?.ground === "scrublandSparse" && asst.flagCountry?.territory === X && asst.flagCountry?.climate === CLIMATE_A && asst.othersUnchanged === true && asst.sceneCountry?.climate === CLIMATE_A && asst.sceneCountry?.ground === "scrublandSparse" && asst.sceneCountry?.territory === X, asst);
  note("placed assistant", await page(gm, P.placeApp, { id: "acks-extras-battlemap", scrollTo: 'select[name="country.ground"]' }));
  await shot(gm, "battlemap-scene-country", "#acks-extras-battlemap");
  const cleared = await page(gm, P.assistant, { sceneId: hex.id, country: {}, clearKey: "climate" });
  note("cleared", cleared);
  check("L6: setting a select back to Not said clears its key", cleared.flagCountry?.climate == null && cleared.sceneCountry?.climate === null && cleared.sceneCountry?.ground === "scrublandSparse" && cleared.sceneCountry?.territory === X, cleared);
  note("assistant closed", await page(gm, P.closeAssistant));

  section("layers 7. countryAt from the console");
  note("C territory X (paintHexAt)", await page(gm, P.paintAt, { sceneId: hex.id, point: pt("C"), value: X, layer: "territory" }));
  note("regions tracked", await track());
  note("scene default", await page(gm, P.sceneDefault, { sceneId: hex.id, country: { ground: "scrubland", territory: X, climate: CLIMATE_A } }));
  const at = (k, extra = {}) => page(gm, P.countryAt, { sceneId: hex.id, point: pt(k), ...extra });
  const cC = await at("C");
  note("C (both layers)", cC);
  check("L7: the painted hex answers its terrain's ground and table and its territory, each sourced map, and the map's climate sourced scene", cC.ground === "forest" && cC.encounterTerrain === forest && cC.territory === X && cC.climate === CLIMATE_A && ["ground", "encounterTerrain", "territory"].every((k) => cC.source[k] === "map") && cC.source.climate === "scene", cC);
  const far = await at("F");
  note("F (unpainted, off both lines)", far);
  check("L7: the unpainted hex answers the scene default's three with scene, following none with map, road null with null", far.ground === "scrubland" && far.territory === X && far.climate === CLIMATE_A && far.source.ground === "scene" && far.source.territory === "scene" && far.source.climate === "scene" && far.following === "none" && far.source.following === "map" && far.road === null && far.source.road === null, far);
  const rH = await at("D");
  note("D (river)", rH);
  check("L7: the river hex answers following river and navigable river water", rH.following === "river" && rH.water?.kind === "river" && rH.water?.navigable === true, rH);
  const kH = await at("E");
  note("E (coast)", kH);
  check("L7: the coast hex answers following none and water not navigable", kH.following === "none" && kH.water?.kind === "coast" && kH.water?.navigable === false, kH);
  const rV = await at("D", { waterBorne: true });
  check("L7: water-borne, the river hex's table is the land river table", rV.encounterTerrain === "riverLand" && rV.source.encounterTerrain === "map", rV);
  note("scene default desert", await page(gm, P.sceneDefault, { sceneId: hex.id, country: { ground: "desert", territory: X, climate: CLIMATE_A } }));
  const rVd = await at("D", { waterBorne: true });
  check("L7: on a desert ground the river table is the desert-and-jungle one", rVd.ground === "desert" && rVd.encounterTerrain === "riverDesertJungle", rVd);

  section("layers 8. the square scene");
  note("square viewed", await page(gm, P.viewScene, square.id));
  const sq = await page(gm, P.assistant, { sceneId: square.id, country: { ground: "grassland" } });
  note("square assistant", sq);
  note("assistant closed", await page(gm, P.closeAssistant));
  pal = await page(gm, P.armTool);
  note("armed on the square", { state: pal.state, tool: pal.tool });
  const sqPoint = { x: 650, y: 450 };
  const sqClick = await page(gm, P.clickHex, { sceneId: square.id, point: sqPoint });
  note("square click", sqClick);
  const sqRegions = await page(gm, P.regions, { sceneId: square.id, layer: "terrain" });
  check("L8: the hex-only warning once per stroke, and no region", sqClick.notes.filter((n) => n.kind === "warn").length === 1 && sqRegions.length === 0, { notes: sqClick.notes, regions: sqRegions.length });
  const sqAt = await page(gm, P.countryAt, { sceneId: square.id, point: sqPoint });
  note("square countryAt", sqAt);
  check("L8: the ground reads the default with source scene; territory and climate null with a null source", sq.flagCountry?.ground === "grassland" && sqAt.ground === "grassland" && sqAt.source.ground === "scene" && sqAt.territory === null && sqAt.source.territory === null && sqAt.climate === null && sqAt.source.climate === null, sqAt);
  note("palette closed", await page(gm, P.closePalette));

  section("layers 10. a map painted with climates folds into its one climate");
  const painted = await gm.create("Scene", sceneData(`QA Layers painted climate ${NONCE}`, { type: 2 }));
  const declared = await gm.create("Scene", sceneData(`QA Layers declared climate ${NONCE}`, { type: 2 }, { flags: { [MOD]: { battlemap: { country: { climate: CLIMATE_SCENE } } } } }));
  for (const [sceneId, offsets, value] of [
    [painted.id, [{ i: 5, j: 5 }, { i: 5, j: 6 }], CLIMATE_A],
    [painted.id, [{ i: 6, j: 5 }], CLIMATE_SCENE],
    [declared.id, [{ i: 5, j: 5 }], CLIMATE_A],
  ]) {
    const made = await page(gm, P.paintedClimate, { sceneId, offsets, value });
    gm.track(made.uuid, "Region");
  }
  const f0 = await page(gm, P.foldState, { sceneId: painted.id });
  check("fixture: the painted map holds two climate regions, no climate of its own, and is not folded", f0.regions === 2 && f0.climate === null && !f0.folded, f0);
  note("painted map viewed", await page(gm, P.viewScene, painted.id));
  const f1 = await page(gm, P.foldState, { sceneId: painted.id, offset: { i: 6, j: 5 } });
  note("fold", f1);
  check("L10: on first view the map takes the climate most of its hexes were painted, is marked folded, and says which", f1.climate === CLIMATE_A && f1.folded && f1.notes.length === 1 && f1.notes[0].text.includes(CLIMATE_A), f1);
  check("L10: the painted regions stay and nothing reads them: a hex painted the other climate answers the map's, sourced scene", f1.regions === 2 && f1.at?.climate === CLIMATE_A && f1.at?.source === "scene", f1.at);
  note("climate cleared", await page(gm, P.sceneDefault, { sceneId: painted.id, country: {} }));
  note("square viewed", await page(gm, P.viewScene, square.id));
  note("painted map viewed again", await page(gm, P.viewScene, painted.id));
  const f2 = await page(gm, P.foldState, { sceneId: painted.id });
  check("L10: a map is folded once: the climate cleared after the fold stays cleared, and nothing is said", f2.climate === null && f2.folded && f2.notes.length === 0, f2);
  note("declared map viewed", await page(gm, P.viewScene, declared.id));
  const f3 = await page(gm, P.foldState, { sceneId: declared.id });
  check("L10: a map that says its own climate keeps it, is marked folded, and nothing is said", f3.climate === CLIMATE_SCENE && f3.folded && f3.notes.length === 0, f3);
}

/* ------------------------------------------------------------------ */
/*  Part: the water-lines snapshot, re-taken with the row in view         */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  Part: the map modes                                                 */
/* ------------------------------------------------------------------ */

async function walkModes(W) {
  const { gm, player } = W;
  for (const api of [gm, player]) {
    if (!(await api.eval(`typeof globalThis.acksExtras?.battlemap?.mapModes?.setMapView === "function"`))) {
      throw new Error("modes: the seat runs module code without the map modes");
    }
  }
  const hex = await gm.create("Scene", sceneData(`QA Modes hex ${NONCE}`, { type: 2 }));
  const old = await gm.create("Scene", sceneData(`QA Modes old ${NONCE}`, { type: 2 }));
  const square = await gm.create("Scene", sceneData(`QA Modes square ${NONCE}`, { type: 1 }));
  const tracked = new Set();
  const trackRegions = async (sceneId) => {
    for (const layer of ["terrain", "territory"]) {
      for (const r of await page(gm, P.regions, { sceneId, layer })) {
        if (tracked.has(r.uuid)) continue;
        gm.track(r.uuid, "Region");
        tracked.add(r.uuid);
      }
    }
  };
  note("hex scene default", await page(gm, P.sceneDefault, { sceneId: hex.id, country: { territory: X, climate: CLIMATE_A } }));
  note("view Terrain", await page(gm, P.setView, { mode: "terrain", opacity: 0.85, handout: false }));
  note("hex scene viewed", await page(gm, P.viewScene, hex.id));
  const L = await page(gm, P.layout, { sceneId: hex.id, i: 5, j: 5 });
  const pt = (k) => L.cells[k].point;

  section("modes 1. the Territory pill shows the Territory mode");
  await page(gm, P.armTool);
  await page(gm, P.pickLayer, { layer: "territory" });
  note("pick X", await page(gm, P.pickBrush, { value: X }));
  for (const k of ["C", "A", "B"]) note(`click ${k}`, await page(gm, P.clickHex, { sceneId: hex.id, point: pt(k) }));
  note("pick Y", await page(gm, P.pickBrush, { value: Y }));
  note("click D", await page(gm, P.clickHex, { sceneId: hex.id, point: pt("D") }));
  await trackRegions(hex.id);
  let m = await page(gm, P.modeState, { sceneId: hex.id });
  note("mode state", m);
  const regs = await page(gm, P.regions, { sceneId: hex.id, layer: "territory" });
  check("M1: the Territory pill shows the Territory mode and opens the window on it", m.view.mode === "territory" && m.window?.pressed === "territory" && same(m.window?.pills, ["terrain", "territory"]), { view: m.view, window: m.window });
  check("M1: the legend lists the four territories, names the scene default for an unpainted hex and the map's climate", m.window?.rows === 4 && !!m.window?.unpainted && typeof m.window?.climate === "string" && m.window.climate.startsWith(CLIMATE_A), m.window);
  check("M1: the overlay sits in the regions layer and draws one border per side where the class changes, two classes meeting as two lines", m.overlay?.inRegions && m.overlay.children === 1 && same(m.overlay.drawn, m.expected) && Object.values(m.expected).reduce((s, n) => s + n, 0) === 18, { drawn: m.overlay?.drawn, expected: m.expected });
  check("M1: the territory regions are on the Regions control alone", regs.length === 2 && regs.every((g) => g.visibility === 0), regs.map((g) => g.visibility));
  note("placed window", await page(gm, P.placeApp, { id: "acks-extras-map-modes" }));
  await shot(gm, "battlemap-map-modes", "#acks-extras-map-modes");

  section("modes 2. the mode outlives the brush and the control");
  note("disarm", await page(gm, P.resetControls));
  note("control", await page(gm, P.controlTo, { control: "tokens", tool: "select" }));
  m = await page(gm, P.modeState, { sceneId: hex.id });
  check("M2: disarmed, on the Tokens control, the borders stay drawn", m.view.mode === "territory" && m.control === "tokens" && same(m.overlay?.drawn, m.expected), { view: m.view, control: m.control, drawn: m.overlay?.drawn });

  section("modes 3. opacity and the handout view");
  m = await page(gm, P.modeWindow, { opacity: 0 });
  check("M3: the slider's floor holds the overlay at 0.2", m.view.opacity === 0.2 && m.overlay?.alpha === 0.2, { view: m.view, alpha: m.overlay?.alpha });
  note("control", await page(gm, P.controlTo, { control: "walls", tool: "select" }));
  const line = await page(gm, P.waterLine, { sceneId: hex.id, c: [100, 900, 900, 900] });
  gm.track(line.uuid, "Wall");
  note("water line for the markers", line);
  const withMarkers = await page(gm, P.modeState, { sceneId: hex.id });
  m = await page(gm, P.modeWindow, { handout: true });
  check("M3: the handout view empties the overlay and the road and water markers", m.view.handout === true && m.overlay?.children === 0 && withMarkers.roadMarkers > 0 && m.roadMarkers === 0, { before: withMarkers.roadMarkers, after: m.roadMarkers, overlay: m.overlay });
  m = await page(gm, P.modeWindow, { handout: false });
  check("M3: unticked, both come back", m.view.handout === false && same(m.overlay?.drawn, m.expected) && m.roadMarkers > 0, { overlay: m.overlay?.drawn, markers: m.roadMarkers });
  note("opacity back", (await page(gm, P.modeWindow, { opacity: 85 })).view);

  section("modes 4. a player is drawn none");
  note("player views the hex scene", await page(player, P.viewScene, hex.id));
  note("player view Territory", await page(player, P.setView, { mode: "territory", opacity: 0.85, handout: false }));
  const pm = await page(player, P.modeState, { sceneId: hex.id });
  const pc = await page(player, P.playerCanvas, { sceneId: hex.id, regionIds: regs.map((g) => g.id) });
  check("M4: a player holding the Territory mode is drawn no border and no territory region", pm.view.mode === "territory" && (!pm.overlay || pm.overlay.children === 0) && pc.regions.every((g) => g.placeable === false || g.visible === false), { overlay: pm.overlay, regions: pc.regions });

  section("modes 5. back to Terrain, and the brush's way in");
  m = await page(gm, P.modeWindow, { mode: "terrain" });
  check("M5: Terrain empties the overlay and lists no legend", m.view.mode === "terrain" && m.overlay?.children === 0 && m.window?.rows === 0, { view: m.view, overlay: m.overlay, rows: m.window?.rows });
  await page(gm, P.armTool);
  m = await page(gm, P.modeState, { sceneId: hex.id });
  check("M5: the brush armed again on its last layer, territory, shows that layer's mode", m.view.mode === "territory" && m.brush.layer === "territory", { view: m.view, brush: m.brush });
  await page(gm, P.pickLayer, { layer: "terrain" });
  m = await page(gm, P.modeState, { sceneId: hex.id });
  check("M5: the Terrain pill returns the map to Terrain", m.view.mode === "terrain" && m.overlay?.children === 0, { view: m.view, overlay: m.overlay });
  await page(gm, P.pickLayer, { layer: "territory" });
  m = await page(gm, P.modeState, { sceneId: hex.id });
  check("M5: the Territory pill brings the borders back", m.view.mode === "territory" && same(m.overlay?.drawn, m.expected), { view: m.view, drawn: m.overlay?.drawn });

  section("modes 6. a repaint redraws");
  note("pick Y", await page(gm, P.pickBrush, { value: Y }));
  note("click B", await page(gm, P.clickHex, { sceneId: hex.id, point: pt("B") }));
  await trackRegions(hex.id);
  m = await page(gm, P.modeState, { sceneId: hex.id });
  check("M6: repainting a hex the other class moves its borders", same(m.overlay?.drawn, m.expected) && Object.values(m.expected).reduce((s, n) => s + n, 0) !== 18, { drawn: m.overlay?.drawn, expected: m.expected });
  note("closed palette", await page(gm, P.closePalette));

  section("modes 7. a map painted before is settled once");
  const o1 = await page(gm, P.oldTerritory, { sceneId: old.id, offsets: [{ i: 3, j: 3 }, { i: 3, j: 4 }], value: X });
  const o2 = await page(gm, P.oldTerritory, { sceneId: old.id, offsets: [{ i: 4, j: 3 }], value: Y });
  const t1 = await page(gm, P.handRegion, { sceneId: old.id, offset: { i: 6, j: 6 }, value: "forestTaiga" });
  for (const r of [o1, o2, t1]) gm.track(r.uuid, "Region");
  note("old regions", { o1: o1.visibility, o2: o2.visibility });
  note("old scene viewed", await page(gm, P.viewScene, old.id));
  let s = await page(gm, P.settleState, { sceneId: old.id });
  check("M7: on a GM's view both territory regions move to the Regions control, the terrain stays as made, and the scene is marked", s.regions[o1.id] === 0 && s.regions[o2.id] === 0 && s.regions[t1.id] === 1 && s.settled, s);
  note("set one back by hand", await page(gm, P.setVisibility, { sceneId: old.id, regionId: o1.id, visibility: 1 }));
  note("hex scene viewed", await page(gm, P.viewScene, hex.id));
  note("old scene viewed again", await page(gm, P.viewScene, old.id));
  s = await page(gm, P.settleState, { sceneId: old.id });
  check("M7: a scene is settled once: the visibility set by hand stands", s.regions[o1.id] === 1 && s.regions[o2.id] === 0, s);

  section("modes 8. a square map");
  note("square scene viewed", await page(gm, P.viewScene, square.id));
  m = await page(gm, P.modeWindow, {});
  check("M8: on a square map the window says the modes draw on a hex map and the overlay holds no child", m.window?.hexScene === false && m.overlay?.children === 0, { window: m.window, overlay: m.overlay });
}

async function walkWaterShot(W) {
  const { gm } = W;
  const hex = await gm.create("Scene", sceneData(`QA Water shot ${NONCE}`, { type: 2 }));
  note("hex scene viewed", await page(gm, P.viewScene, hex.id));
  W.preset = W.preset ?? await page(gm, P.wallPreset);
  note("wall preset at start", { key: W.preset.key, scope: W.preset.scope, flagged: !!W.preset.value?.flags?.["acks-extras"] });
  const L = await page(gm, P.layout, { sceneId: hex.id, i: 5, j: 5 });
  const D = L.cells.D.point;
  const press = await page(gm, P.pressTool, { control: "acksBattlemap", tool: "water-river" });
  note("river preset", { notes: press.notes, preset: press.preset });
  const river = await page(gm, P.drawWall, { sceneId: hex.id, from: D, to: { x: D.x - 1.5 * L.size.sizeX, y: D.y } });
  if (river) gm.track(river.uuid, "Wall");
  check("WS: the River preset draws a wall carrying the river flag", !!river && river.water?.kind === "river" && river.move === 0, river);
  if (!river) return;
  const opened = await page(gm, P.wallSheetOpen, { wallUuid: river.uuid, name: "QA brook" });
  note("wall sheet opened", opened);
  check("WS: the sheet's water row is in view with the river kind, the boat ticked and the name typed", opened.row && opened.rowInWindow && opened.kind === "river" && opened.navigable === true && opened.nameField === "QA brook" && opened.water?.name === "QA brook", opened);
  if (opened.row) await shot(gm, "battlemap-water-lines", `[id="${opened.id}"]`);
  note("closed", await page(gm, P.closeAll));
}

/* ------------------------------------------------------------------ */
/*  Part: the formation's country, then the changed terrain/road reads   */
/* ------------------------------------------------------------------ */

async function walkCountry(W) {
  const { gm, player, playerId } = W;
  const hexScene = await gm.create("Scene", sceneData(`QA Country hex ${NONCE}`, { type: 2 }));
  const otherScene = await gm.create("Scene", sceneData(`QA Country other ${NONCE}`, { type: 1 }));
  note("controls reset", await page(gm, P.resetControls));
  note("hex scene viewed", await page(gm, P.viewScene, hexScene.id));
  W.preset = W.preset ?? await page(gm, P.wallPreset);
  const L = await page(gm, P.layout, { sceneId: hexScene.id });
  note("layout", { cells: Object.fromEntries(Object.entries(L.cells).map(([k, v]) => [k, v.offset])), steps: L.steps, size: L.size });
  check("fixture: hex C and its neighbours A, B, D are each one hex step apart, and so is each pair of row R and pair S", Object.values(L.steps).every((s) => s === 1), L.steps);
  const pt = (k) => L.cells[k].point;
  const xy = (k) => ({ x: pt(k).x - L.size.sizeX / 2, y: pt(k).y - L.size.sizeY / 2 });
  const off = (k) => L.cells[k].offset;
  const C = off("C");
  const A = off("A");

  const paintable = await page(gm, P.paintable);
  const forest = ["forestTaiga", "forestDeciduous"].find((v) => paintable.terrain.includes(v)) ?? null;
  const hill = ["hillsForested", "hillsRocky"].find((v) => paintable.terrain.includes(v)) ?? null;
  check("fixture: the brush offers a forest table and a hill table", !!forest && !!hill, { forest, hill, terrains: paintable.terrain.length });
  note("A terrain", await page(gm, P.paintAt, { sceneId: hexScene.id, point: pt("A"), value: forest, layer: "terrain" }));
  note("A territory", await page(gm, P.paintAt, { sceneId: hexScene.id, point: pt("A"), value: Y, layer: "territory" }));
  note("B terrain", await page(gm, P.paintAt, { sceneId: hexScene.id, point: pt("B"), value: hill, layer: "terrain" }));
  const tracked = new Set();
  const trackRegions = async () => {
    let n = 0;
    for (const layer of ["terrain", "territory"]) {
      for (const r of await page(gm, P.regions, { sceneId: hexScene.id, layer })) {
        if (tracked.has(r.uuid)) continue;
        gm.track(r.uuid, "Region");
        tracked.add(r.uuid);
        n++;
      }
    }
    return n;
  };
  note("regions tracked", await trackRegions());
  const Dp = pt("D");
  const river = await page(gm, P.waterLine, { sceneId: hexScene.id, c: [Dp.x - 35, Dp.y, Dp.x + 35, Dp.y], kind: "river" });
  gm.track(river.uuid, "Wall");
  check("fixture: the water line across D is a wall flagged river and navigable", river.water?.kind === "river" && river.water?.navigable === true, river.water);
  const def = await page(gm, P.sceneDefault, { sceneId: hexScene.id, country: { ground: "grassland", territory: X, climate: CLIMATE_SCENE } });
  check("fixture: the scene default holds a ground, X and a second climate", def.ground === "grassland" && def.territory === X && def.climate === CLIMATE_SCENE, def);

  const party = await gm.create("Actor", { name: `QA Company ${NONCE}`, type: "acks-extras.party", ownership: { default: 0, [playerId]: 2 } });
  const memberA = await gm.create("Actor", { name: `QA Walker A ${NONCE}`, type: "character", ownership: { default: 0, [playerId]: 3 }, prototypeToken: { actorLink: true } });
  const memberB = await gm.create("Actor", { name: `QA Walker B ${NONCE}`, type: "character", prototypeToken: { actorLink: true } });
  const built = await page(gm, P.buildParty, { partyId: party.id, sceneId: hexScene.id, memberA: memberA.id, memberB: memberB.id, xy: xy("C"), hudXY: xy("G") });
  note("party", built);
  if (built.error) throw new Error(built.error);
  gm.track(built.tokenUuid, "Token");
  if (built.memberTokenUuid) gm.track(built.memberTokenUuid, "Token");
  const fid = built.formationId;
  check("fixture: member A enrolled through the token HUD (its own token deleted), B by a drop on the sheet; the token adopted; journey", built.adopted && built.hud?.button && built.hud?.enrolled && built.hud?.tokenGone && built.drop?.enrolled && built.mode === "journey" && built.partyTokenOf === built.tokenId && built.members.includes(memberA.id) && built.members.includes(memberB.id), built);
  note("rig 20 (every navigation throw makes its way)", await page(gm, P.rig, { want: 20 }));

  let r;
  let s;
  const card = (k) => s?.cards?.find((c) => c.key === k);
  const ctxCard = (k) => s?.ctx?.cards?.find((c) => c.key === k);
  const trackCards = (d) => {
    for (const u of d.messages ?? []) gm.track(u, "ChatMessage");
    if (d.unclaimed?.length) note("cards this seat made that the run does not claim (left alone)", d.unclaimed);
  };
  const provLabel = { scene: await page(gm, P.provenanceLabel, { key: "scene" }), map: await page(gm, P.provenanceLabel, { key: "map" }), override: await page(gm, P.provenanceLabel, { key: "override" }), declared: await page(gm, P.provenanceLabel, { key: "declared" }) };

  section("country 1. entering the journey reads the map");
  r = await page(gm, P.record, { fid });
  note("record", { map: r.map, provenance: r.provenance, keys: r.keys, hex: r.hex });
  check("C1: travel.map exists before any drag and names hex C", !!r.map && r.map.i === C.i && r.map.j === C.j, r.map && { i: r.map.i, j: r.map.j });
  check("C1: the map's ground, territory and climate are the scene default's, each sourced scene", r.map?.ground === "grassland" && r.map?.territory === X && r.map?.climate === CLIMATE_SCENE && ["ground", "territory", "climate"].every((k) => r.map?.source?.[k] === "scene"), r.map?.source);
  check("C1: provenance reads scene for the three", ["ground", "territory", "climate"].every((k) => r.provenance?.[k] === "scene"), r.provenance);
  s = await page(gm, P.sheet, { partyId: party.id });
  note("sheet", { cards: s.cards, draw: s.draw, sky: s.skyCard });
  check("C1: the Ground and Territory cards show the default values, sourced The scene's default, with no chip", card("ground")?.provenance === "scene" && card("territory")?.provenance === "scene" && card("ground")?.source === provLabel.scene && [card("ground"), card("territory")].every((c) => c && !c.override && !c.declared), { ground: card("ground"), territory: card("territory"), label: provLabel.scene });
  check("C1: the Sky's climate card is sourced scene with no chip", s.skyCard?.provenance === "scene" && s.ctx?.climate?.chip === null, s.skyCard);

  section("country 2. a drag caches the hex and writes no country key");
  const keysBefore = r.keys;
  const d2 = await page(gm, P.drag, { fid, xy: xy("A") });
  trackCards(d2);
  note("drag C->A", d2);
  r = await page(gm, P.record, { fid });
  note("record", { map: r.map, keys: r.keys, day: r.day, provenance: r.provenance, values: r.values, lost: r.lostPhase });
  check("C2: travel.map names hex A with the painted ground and table and Y, each sourced map, and the map's climate sourced scene", r.map?.i === A.i && r.map?.j === A.j && r.map?.encounterTerrain === forest && r.map?.ground === "forest" && r.map?.territory === Y && r.map?.climate === CLIMATE_SCENE && ["ground", "encounterTerrain", "territory"].every((k) => r.map?.source?.[k] === "map") && r.map?.source?.climate === "scene", r.map);
  check("C2: following reads none (the scene has a water line, none under A) and road null", r.map?.following === "none" && r.map?.road === null, { following: r.map?.following, road: r.map?.road });
  const gained = r.keys.filter((k) => !keysBefore.includes(k));
  check("C2: no country key was written to the record", !["ground", "encounterTerrain", "territory", "road", "following"].some((k) => gained.includes(k)), { gained, keys: r.keys });
  check("C2: no hexEntered fired and one cell's miles are carried (the step was counted in Y)", d2.entered.length === 0 && Math.abs((r.day.cadenceCarry ?? 0) - MILES) < 1e-6, { entered: d2.entered, carry: r.day.cadenceCarry });
  check("C2: the navigation throw at the day's first step off a road made its way: no episode opened", r.lostPhase === null, { navCards: d2.navCards, lost: r.lostPhase });
  s = await page(gm, P.sheet, { partyId: party.id });
  note("sheet", { cards: s.cards, draw: s.draw, sky: s.skyCard, chips: s.chips });
  check("C2: the cards read the painted values, sourced Read off the map", card("ground")?.provenance === "map" && card("territory")?.provenance === "map" && s.skyCard?.provenance === "map" && card("ground")?.source === provLabel.map, { ground: card("ground"), territory: card("territory"), sky: s.skyCard });
  const yLabel = await page(gm, P.territoryLabel, { key: Y });
  check("C2: the band's territory chip reads Y", s.chips.some((c) => c.key === "territory" && (c.label === yLabel || String(c.label ?? "").includes(yLabel))), { chips: s.chips, yLabel });
  const forestLabel = await page(gm, P.label, { key: forest });
  check("C2: the Encounters line names hex A's table", !!s.draw && !!forestLabel && s.draw.includes(forestLabel), { draw: s.draw, label: forestLabel });

  section("country 3. the cadence on the way back");
  const d3 = await page(gm, P.drag, { fid, xy: xy("C") });
  trackCards(d3);
  note("drag A->C", d3);
  check("C3: one hexEntered with cadence grid and territory X", d3.entered.length === 1 && d3.entered[0].cadence === "grid" && d3.entered[0].territory === X, d3.entered);
  // The snapshot: dragged from the painted hex A into unpainted C, the cards read the scene's own country.
  s = await page(gm, P.sheet, { partyId: party.id, keep: true });
  const xLabel = await page(gm, P.territoryLabel, { key: X });
  check("C3/shot: in unpainted C the Ground and Territory cards read the scene's country (grassland, X), not hex A's forest and Y", ctxCard("ground")?.value === "grassland" && card("ground")?.provenance === "scene" && card("territory")?.provenance === "scene" && card("territory")?.value === xLabel && card("territory")?.value !== yLabel && s.skyCard?.provenance === "scene", { ground: card("ground"), territory: card("territory"), sky: s.skyCard });
  await sheetShot(gm, party.id, "mode", "formation-country-unpainted", '[data-section="country"]');

  section("country 4. a river");
  const d4 = await page(gm, P.drag, { fid, xy: xy("D") });
  trackCards(d4);
  note("drag C->D", d4);
  r = await page(gm, P.record, { fid });
  note("record", { map: r.map, values: r.values, provenance: r.provenance });
  check("C4: travel.map.following reads river, with navigable river water under D", r.map?.following === "river" && r.map?.water?.kind === "river" && r.map?.water?.navigable === true, { following: r.map?.following, water: r.map?.water });
  const mapAt = r.map?.at ?? null;
  s = await page(gm, P.sheet, { partyId: party.id, keep: true });
  note("sheet", { following: card("following"), camp: s.camp, movement: s.movement });
  check("C4: the Following card reads the river, sourced the map", card("following")?.provenance === "map" && ctxCard("following")?.value === "river", { card: card("following"), ctx: ctxCard("following") });
  check("C4: the Camp section says water is at hand with its declaration unticked", s.camp?.waterAuto === true && s.camp?.waterHint === true && s.camp?.waterChecked === false, s.camp);
  note("vessel", await page(gm, P.setSelect, { partyId: party.id, name: "travel.movement.mode", value: "vessel" }));
  r = await page(gm, P.record, { fid });
  note("record", { movement: r.movement, values: r.values, provenance: r.provenance, at: r.map?.at });
  check("C4: on the vessel the encounter terrain is the land river table with provenance map", r.movement === "vessel" && r.values.encounterTerrain === "riverLand" && r.provenance.encounterTerrain === "map", { movement: r.movement, table: r.values.encounterTerrain, provenance: r.provenance.encounterTerrain });
  check("C4: travel.map.at is unchanged (no re-read)", r.map?.at === mapAt, { before: mapAt, after: r.map?.at ?? null });
  s = await page(gm, P.sheet, { partyId: party.id, keep: true });
  check("C4: the Encounters line names the river table", !!s.draw && !!s.labels?.riverLand && s.draw.includes(s.labels.riverLand), { draw: s.draw, label: s.labels?.riverLand });
  note("foot", await page(gm, P.setSelect, { partyId: party.id, name: "travel.movement.mode", value: "foot" }));
  r = await page(gm, P.record, { fid });
  check("C4: back on foot the ground's own table returns", r.movement === "foot" && r.values.encounterTerrain !== "riverLand" && r.provenance.encounterTerrain === "scene", { movement: r.movement, table: r.values.encounterTerrain, provenance: r.provenance.encounterTerrain });
  note("pause", await page(gm, P.pause, { fid, paused: true }));
  const pC = await page(gm, P.drag, { fid, xy: xy("C") });
  trackCards(pC);
  note("paused drag D->C", pC);
  r = await page(gm, P.record, { fid });
  check("C4: a paused drag into C: travel.hex and travel.map follow, no clock, no card", r.hex?.i === C.i && r.hex?.j === C.j && r.map?.i === C.i && r.map?.j === C.j && pC.worldTimeDelta === 0 && pC.messagesDelta === 0 && pC.entered.length === 0, { hex: r.hex, map: r.map && { i: r.map.i, j: r.map.j }, delta: pC.worldTimeDelta, messages: pC.messagesDelta, entered: pC.entered });
  const milesPaused = r.day?.miles ?? 0;
  const Doff = off("D");
  const pD = await page(gm, P.drag, { fid, xy: xy("D") });
  trackCards(pD);
  note("paused drag C->D", pD);
  r = await page(gm, P.record, { fid });
  check("C4: and back into D: both follow again, the clock and the day's miles unchanged, no card", r.hex?.i === Doff.i && r.hex?.j === Doff.j && r.map?.i === Doff.i && r.map?.j === Doff.j && pD.worldTimeDelta === 0 && pD.messagesDelta === 0 && (r.day?.miles ?? 0) === milesPaused, { hex: r.hex, delta: pD.worldTimeDelta, miles: r.day?.miles, before: milesPaused });
  note("unpause", await page(gm, P.pause, { fid, paused: false }));

  section("country 5. the Judge's word");
  s = await page(gm, P.sheet, { partyId: party.id, keep: true });
  note("tab judge", await page(gm, P.tab, { partyId: party.id, tab: "judge" }));
  note("hand", s.hand?.map((h) => ({ key: h.key, name: h.name, value: h.value, clear: h.clear, map: h.map })));
  const ov = (k) => s.ctx?.overrides?.find((o) => o.key === k);
  const groundRow = s.hand?.find((h) => h.key === "ground");
  const mapGround = r.mapValues.ground;
  const otherGround = groundRow?.options.find((o) => o !== mapGround) ?? null;
  check("C5: the hand has a row per country key, blank, each saying what the map reads or that it says nothing", (s.hand?.length ?? 0) === 6 && s.hand.every((h) => h.value === "" && !h.clear && h.name === `travel.override.${h.key}` && /\S/.test(h.map ?? "")), s.hand?.map((h) => ({ key: h.key, value: h.value, map: h.map })));
  check("C5: the hand knows the map reads a ground and says nothing of a road", ov("ground")?.hasMap === true && ov("road")?.hasMap === false, { overrides: s.ctx?.overrides });
  note("set ground", await page(gm, P.setSelect, { partyId: party.id, name: "travel.override.ground", value: otherGround }));
  note("set road", await page(gm, P.setSelect, { partyId: party.id, name: "travel.override.road", value: "paved" }));
  r = await page(gm, P.record, { fid });
  note("record", { override: r.override, keys: r.keys, values: r.values, provenance: r.provenance, mapValues: r.mapValues });
  check("C5: travel.override holds the ground and the road, and travel.ground stays absent", r.override?.ground === otherGround && r.override?.road === "paved" && !r.keys.includes("ground") && !r.keys.includes("road"), { override: r.override, keys: r.keys });
  s = await page(gm, P.sheet, { partyId: party.id, keep: true });
  note("cards", s.cards);
  note("hand", s.hand?.map((h) => ({ key: h.key, value: h.value, clear: h.clear })));
  check("C5: the Ground card shows the override, sourced The Judge's word, with the Override chip and its clear, whose tooltip names the map's ground", card("ground")?.override === true && card("ground")?.provenance === "override" && card("ground")?.source === provLabel.override && card("ground")?.clear === true && !!ctxCard("ground")?.mapLabel && (card("ground")?.overrideTip ?? "").includes(ctxCard("ground").mapLabel), { card: card("ground"), mapLabel: ctxCard("ground")?.mapLabel });
  const ownTable = await page(gm, P.tableFor, { ground: otherGround });
  check("C5: the Encounters line names the overridden ground's own table, not hex D's (travelOf default/provenance default; the map's still in mapValues)", r.values.encounterTerrain === "" && r.provenance.encounterTerrain === "default" && r.mapValues.encounterTerrain != null && !!ownTable.label && (s.draw ?? "").includes(ownTable.label), { table: r.values.encounterTerrain, provenance: r.provenance.encounterTerrain, map: r.mapValues.encounterTerrain, draw: s.draw, own: ownTable });
  check("C5: the Road card shows paved with the pen mark (no road on the map) and no Override chip", card("road")?.declared === true && !card("road")?.override && card("road")?.provenance === "override" && ctxCard("road")?.value === "paved", { card: card("road"), ctx: ctxCard("road") });
  check("C5: the two set rows of the hand carry a clear", s.hand?.filter((h) => h.clear).map((h) => h.key).sort().join() === "ground,road", s.hand?.map((h) => ({ key: h.key, clear: h.clear })));
  // The snapshots: the four cards with their sources, chips and paint offers; then the hand with a word set.
  check("shot state: four cards each saying where its answer came from, one Override chip with its clear, one Paint this hex", s.cards.length === 4 && s.cards.every((c) => !!c.source) && s.cards.some((c) => c.override && c.clear) && s.cards.some((c) => c.paint), s.cards.map((c) => ({ key: c.key, source: c.source, override: c.override, declared: c.declared, paint: c.paint })));
  await sheetShot(gm, party.id, "mode", "formation-country-cards", '[data-section="country"]');
  await sheetShot(gm, party.id, "judge", "formation-judges-hand", '[data-section="hand"]');
  note("tab mode", await page(gm, P.tab, { partyId: party.id, tab: "mode" }));
  note("press the Ground chip's clear", await page(gm, P.press, { partyId: party.id, selector: '[data-section="country"] .acks-extras-country-card[data-key="ground"] [data-action="clearOverride"]' }));
  r = await page(gm, P.record, { fid });
  s = await page(gm, P.sheet, { partyId: party.id, keep: true });
  check("C5: the Ground card reads the map again with no chip", r.override?.ground === undefined && r.override?.road === "paved" && r.provenance.ground === "scene" && !card("ground")?.override && !card("ground")?.declared, { override: r.override, provenance: r.provenance.ground, card: card("ground") });
  note("set ground to the map's own", await page(gm, P.setSelect, { partyId: party.id, name: "travel.override.ground", value: mapGround }));
  r = await page(gm, P.record, { fid });
  s = await page(gm, P.sheet, { partyId: party.id, keep: true });
  check("C5: a word equal to the map's reads provenance override with no chip", r.override?.ground === mapGround && r.provenance.ground === "override" && !card("ground")?.override && !card("ground")?.declared, { override: r.override, provenance: r.provenance.ground, card: card("ground") });
  note("clear hand ground", await page(gm, P.press, { partyId: party.id, selector: '[data-section="hand"] .acks-extras-country-hand-row[data-key="ground"] [data-action="clearOverride"]' }));
  note("clear hand road", await page(gm, P.press, { partyId: party.id, selector: '[data-section="hand"] .acks-extras-country-hand-row[data-key="road"] [data-action="clearOverride"]' }));
  r = await page(gm, P.record, { fid });
  check("C5: clearing both rows from the hand: travel.override is gone from the record", r.override === null && !r.keys.includes("override"), { override: r.override, keys: r.keys });
  note("declare a road as an older record would", await page(gm, P.declare, { fid, key: "road", value: "earth" }));
  r = await page(gm, P.record, { fid });
  s = await page(gm, P.sheet, { partyId: party.id, keep: true });
  check("C5: the Road card reads the declaration, sourced Declared on the sheet, with the pen mark and its clear (clearDeclared)", r.provenance.road === "declared" && r.values.road === "earth" && card("road")?.declared === true && card("road")?.source === provLabel.declared && (card("road")?.actions ?? []).includes("clearDeclared"), { provenance: r.provenance.road, value: r.values.road, card: card("road") });
  note("press the Road chip's clear", await page(gm, P.press, { partyId: party.id, selector: '[data-section="country"] .acks-extras-country-card[data-key="road"] [data-action="clearDeclared"]' }));
  r = await page(gm, P.record, { fid });
  s = await page(gm, P.sheet, { partyId: party.id, keep: true });
  check("C5: the declaration is retired: travel.road is the default and the card wears no chip", r.provenance.road === "default" && r.values.road === "none" && !card("road")?.declared && !card("road")?.override, { provenance: r.provenance.road, value: r.values.road, keys: r.keys, card: card("road") });

  section("country 6. paint this hex");
  const d6 = await page(gm, P.drag, { fid, xy: xy("C") });
  trackCards(d6);
  note("drag D->C", d6);
  note("other scene viewed", await page(gm, P.viewScene, otherScene.id));
  s = await page(gm, P.sheet, { partyId: party.id, keep: true });
  note("cards", s.cards.map((c) => ({ key: c.key, paint: c.paint, brush: c.paintBrush })));
  note("sky", s.skyCard);
  check("C6: Ground and Territory offer Paint this hex; the Sky's climate, Road and Following do not", card("ground")?.paint && card("territory")?.paint && !s.skyCard?.paint && !card("road")?.paint && !card("following")?.paint, { cards: s.cards.map((c) => ({ key: c.key, paint: c.paint })), sky: s.skyCard?.paint });
  check("C6: the Territory card's brush is X, the card's value", card("territory")?.paintBrush === X, card("territory"));
  const regionsBefore = await page(gm, P.regions, { sceneId: hexScene.id, layer: "territory" });
  const chip = await page(gm, P.paintChip, { partyId: party.id, key: "territory" });
  note("paint chip", chip);
  check("C6: the party's scene comes into view; the palette opens with Territory pressed and X the armed swatch", chip.found && chip.viewed === hexScene.id && chip.palette && chip.pressed === "territory" && chip.armedSwatch === X && chip.state.brush === X && chip.state.layer === "territory" && chip.state.armedBy === "sheet", chip);
  const regionsAfterPress = await page(gm, P.regions, { sceneId: hexScene.id, layer: "territory" });
  check("C6: pressing the chip painted nothing", same(regionsBefore.map((g) => g.hexes), regionsAfterPress.map((g) => g.hexes)), { before: regionsBefore.map((g) => g.hexes.length), after: regionsAfterPress.map((g) => g.hexes.length) });
  await page(gm, P.watchRefresh, { fid });
  const click = await page(gm, P.clickHex, { sceneId: hexScene.id, point: pt("C") });
  note("click C", click);
  check("C6: a click on hex C paints X on the territory layer", click.territory === X, click);
  note("regions tracked", await trackRegions());
  const closed = await page(gm, P.closePalette);
  note("palette closed", closed);
  const clickB = await page(gm, P.clickHex, { sceneId: hexScene.id, point: pt("B") });
  check("C6: with the palette closed a click on hex B paints nothing", clickB.territory === null && closed.state.brush === null, { clickB, closed });

  section("country 7. the Judge's refresh");
  const w1 = await page(gm, P.readWatch, { waitMs: 2000 });
  r = await page(gm, P.record, { fid });
  note("watch", w1);
  note("record", { map: r.map, provenance: r.provenance });
  check("C7: within two seconds the map's territory reads X sourced map, written by the refresh and not a drag", r.map?.territory === X && r.map?.source?.territory === "map" && r.map?.i === C.i && w1.writes >= 1, { writes: w1.writes, updates: w1.updates, territory: r.map?.territory, source: r.map?.source?.territory });
  s = await page(gm, P.sheet, { partyId: party.id, keep: true });
  check("C7: the Territory card lost its paint chip", card("territory")?.paint === false && card("territory")?.provenance === "map", card("territory"));
  await page(gm, P.resetWatch);
  const two = await page(gm, P.paintTwo, { sceneId: hexScene.id, point: pt("C"), terrain: hill, territory: Y });
  note("paint C terrain+territory", two);
  const w2 = await page(gm, P.readWatch, { waitMs: 2000 });
  r = await page(gm, P.record, { fid });
  check("C7: one counted write carries both the terrain and the territory", w2.writes === 1 && r.map?.encounterTerrain === hill && r.map?.ground === "hills" && r.map?.territory === Y && r.map?.source?.territory === "map", { writes: w2.writes, map: r.map });
  note("regions tracked", await trackRegions());
  await page(gm, P.resetWatch);
  note("paint B territory", await page(gm, P.paintAt, { sceneId: hexScene.id, point: pt("B"), value: Y, layer: "territory" }));
  const w3 = await page(gm, P.readWatch, { waitMs: 1500 });
  check("C7: painting hex B (the token is not on it) writes nothing", w3.writes === 0, w3);
  note("regions tracked", await trackRegions());
  await page(gm, P.resetWatch);
  note("scene default ground changed", await page(gm, P.sceneDefault, { sceneId: hexScene.id, country: { ground: "scrubland", territory: X, climate: CLIMATE_SCENE } }));
  const w4 = await page(gm, P.readWatch, { waitMs: 1500 });
  r = await page(gm, P.record, { fid });
  check("C7: changing the scene default's ground writes nothing while hex C's own paint answers", w4.writes === 0 && r.map?.ground === "hills", { writes: w4.writes, ground: r.map?.ground });
  await page(gm, P.resetWatch);
  note("erase C terrain", await page(gm, P.paintAt, { sceneId: hexScene.id, point: pt("C"), value: null, layer: "terrain" }));
  const w5 = await page(gm, P.readWatch, { waitMs: 2000, stop: true });
  r = await page(gm, P.record, { fid });
  check("C7: erasing hex C's terrain lets the reading fall to the new default, sourced scene", w5.writes === 1 && r.map?.ground === "scrubland" && r.map?.source?.ground === "scene", { writes: w5.writes, ground: r.map?.ground, source: r.map?.source?.ground });

  section("country 8. no token, no map");
  const del = await page(gm, P.deleteToken, { fid });
  note("deleted", { tokenId: del.tokenId, sceneId: del.sceneId, map: !!del.map, provenance: del.provenance });
  check("C8: tokenId and sceneId are null, travel.map is still stored, provenance default for every key", del.tokenId === null && del.sceneId === null && !!del.map && Object.values(del.provenance ?? {}).length === 6 && Object.values(del.provenance).every((p) => p === "default"), del.provenance);
  const placed = await page(gm, P.placeToken, { fid, partyId: party.id, sceneId: hexScene.id, xy: xy("A") });
  gm.track(placed.tokenUuid, "Token");
  note("placed", { seated: placed.seated, map: placed.map && { i: placed.map.i, j: placed.map.j }, provenance: placed.provenance, tokenId: placed.tokenId });
  check("C8: placed again in hex A, the arrival re-reads: travel.map names hex A and the provenance returns to map", placed.seated && placed.tokenId && placed.map?.i === A.i && placed.map?.j === A.j && placed.provenance?.territory === "map" && placed.provenance?.ground === "map", { map: placed.map && { i: placed.map.i, j: placed.map.j }, provenance: placed.provenance });

  section("country 9. a player's seat");
  const ps = await page(player, P.playerSheet, { partyId: party.id });
  note("player sheet", ps);
  check("C9: the player's Country section holds the four cards with values, and no source, chip or action", ps.rendered && ps.cards?.length === 4 && ps.cards.every((c) => c.value && !c.source && !c.override && !c.declared && !c.paint && !c.clear) && ps.sources === 0 && ps.chips === 0 && ps.actions?.length === 0, { cards: ps.cards?.map((c) => ({ key: c.key, value: c.value })), sources: ps.sources, chips: ps.chips, actions: ps.actions });
  check("C9: no climate card in the Sky section, no Judge tab, no hand", ps.skyCards === 0 && !ps.judgePart && !ps.judgeTab && !ps.hand, { sky: ps.skyCards, judgePart: ps.judgePart, judgeTab: ps.judgeTab, hand: ps.hand });
  note("closed", await page(gm, P.closeAll));

  section("battlemap Terrain painting 5-7 (changed): the journey read on a painted hex scene");
  // Row R: R1 painted at the book's grain, R2 a region flagged with a bare ground by hand,
  // R3 a river kind flagged by hand (a map painted before rivers were lines), R4 unpainted.
  note("R1 terrain (book grain)", await page(gm, P.paintAt, { sceneId: hexScene.id, point: pt("R1"), value: hill, layer: "terrain" }));
  note("regions tracked", await trackRegions());
  const bare = await page(gm, P.handRegion, { sceneId: hexScene.id, offset: off("R2"), value: "forest" });
  gm.track(bare.uuid, "Region");
  const riverHex = await page(gm, P.handRegion, { sceneId: hexScene.id, offset: off("R3"), value: "riverLand" });
  gm.track(riverHex.uuid, "Region");
  const voc = await page(gm, P.vocab, { keys: ["forest", "riverLand", hill, "scrubland"] });
  note("hand regions", { bare, riverHex, voc });
  check("fixture: the hand-flagged regions read back on the terrain layer; forest is a bare ground and riverLand stands on none", bare.read === "forest" && riverHex.read === "riverLand" && voc.forest.fine === false && voc.riverLand.fine === true && voc.riverLand.ground === null, { bare: bare.read, river: riverHex.read, voc });
  note("pause", await page(gm, P.pause, { fid, paused: true }));
  const toR0 = await page(gm, P.drag, { fid, xy: xy("R0") });
  trackCards(toR0);
  note("unpause", await page(gm, P.pause, { fid, paused: false }));
  r = await page(gm, P.record, { fid });
  note("seated at R0 (paused drag)", { hex: r.hex, day: r.day, keys: r.keys });
  const stepTo = async (k) => {
    const before = await page(gm, P.record, { fid });
    const d = await page(gm, P.drag, { fid, xy: xy(k) });
    trackCards(d);
    const after = await page(gm, P.record, { fid });
    note(`drag to ${k}`, { entered: d.entered.length, navCards: d.navCards, dayKey: [d.dayKeyBefore, d.dayKeyAfter], hex: after.hex, map: after.map, hexesEntered: [before.day.hexesEntered, after.day.hexesEntered], lost: after.lostPhase });
    const countOk = after.day.hexesEntered === (before.day.hexesEntered ?? 0) + 1 || (before.dayKey !== after.dayKey && after.day.hexesEntered === 1);
    return { d, before, after, countOk };
  };
  const named = (rec, k) => rec.hex?.i === off(k).i && rec.hex?.j === off(k).j && rec.hex?.label === L.cells[k].label;
  const neverWritten = (rec) => !rec.keys.includes("ground") && !rec.keys.includes("encounterTerrain");
  let st = await stepTo("R1");
  check("TP5: into R1 (book grain): travel.hex takes the offset and its label, hexesEntered counts the crossing, travel.map holds the ground and the table, each sourced map", named(st.after, "R1") && st.countOk && st.after.map?.ground === voc[hill].ground && st.after.map?.encounterTerrain === hill && st.after.map?.source?.ground === "map" && st.after.map?.source?.encounterTerrain === "map" && neverWritten(st.after), { hex: st.after.hex, label: L.cells.R1.label, hexesEntered: [st.before.day.hexesEntered, st.after.day.hexesEntered], map: st.after.map });
  const f1 = await page(gm, P.factorLine, { partyId: party.id, fid });
  note("factor line at R1 (booleans only)", f1);
  // Step 6: Stock this hex with no word of the Judge's on the encounter table.
  note("Judge's word on the table cleared", await page(gm, P.applyTravelForm, { fid, tv: { override: { encounterTerrain: "" } } }));
  s = await page(gm, P.sheet, { partyId: party.id, keep: true });
  note("tab mode", await page(gm, P.tab, { partyId: party.id, tab: "mode" }));
  const sp = await page(gm, P.stockPress, { partyId: party.id });
  const sr = sp.found ? await page(gm, P.stockRead) : { found: false };
  note("stock dialog", { press: sp, read: sr });
  check("TP6: Stock this hex on R1: the dialog's terrain select opens on the hex's painted kind (cancelled, nothing stocked)", sp.found && sr.found && sr.terrain === hill && sr.closed, { press: sp, read: sr, painted: hill });
  st = await stepTo("R2");
  check("TP5: into R2 (a region flagged with the bare ground forest): that ground and the ground's default table, sourced map", named(st.after, "R2") && st.countOk && st.after.map?.ground === "forest" && st.after.map?.encounterTerrain === voc.forest.defaultTable && st.after.map?.source?.ground === "map" && st.after.map?.source?.encounterTerrain === "map" && neverWritten(st.after), { map: st.after.map, defaultTable: voc.forest.defaultTable, hexesEntered: [st.before.day.hexesEntered, st.after.day.hexesEntered] });
  st = await stepTo("R3");
  check("TP5: into R3 (a river kind painted before rivers were lines): the river's table from the map, the ground left to the next source (the scene's)", named(st.after, "R3") && st.countOk && st.after.map?.encounterTerrain === "riverLand" && st.after.map?.source?.encounterTerrain === "map" && st.after.map?.ground === "scrubland" && st.after.map?.source?.ground === "scene" && neverWritten(st.after), { map: st.after.map, hexesEntered: [st.before.day.hexesEntered, st.after.day.hexesEntered] });
  st = await stepTo("R4");
  check("TP5: into R4 (unpainted): nothing from the terrain layer, the ground and table from the scene", named(st.after, "R4") && st.countOk && st.after.map?.source?.ground === "scene" && st.after.map?.source?.encounterTerrain === "scene" && st.after.map?.ground === "scrubland" && neverWritten(st.after), { map: st.after.map, hexesEntered: [st.before.day.hexesEntered, st.after.day.hexesEntered] });
  const f4 = await page(gm, P.factorLine, { partyId: party.id, fid, otherGround: voc[hill].ground });
  note("factor line at R4 (booleans only)", f4);
  if (f1.imported) {
    check("TP5: the panel's factor line follows the painted terrain (R1's ground's factor shown there as the table prices it, gone at R4)", f1.labelInLine === f1.expectShown && f4.labelInLine === f4.expectShown && (f4.other?.labelInLine ?? false) === false, { f1, f4 });
  } else {
    note("TP5 factor line", "not checked: the world holds no imported terrainMultipliers table");
  }
  check("TP5: no navigation episode opened along the row (the rigged throws made their way)", st.after.lostPhase === null, { lost: st.after.lostPhase });
  const down = await page(gm, P.setDown, { fid, xy: xy("R1") });
  note("set down on R1", { before: down.before, entered: down.entered, hex: down.hex, map: down.map, day: down.day });
  check("TP7: set down on painted R1 without walking: the hex is named, travel.map reads R1, hexesEntered does not move", named(down, "R1") && down.map?.i === off("R1").i && down.map?.j === off("R1").j && down.map?.encounterTerrain === hill && down.map?.source?.encounterTerrain === "map" && down.day.hexesEntered === down.before.hexesEntered && down.entered === 0, { hex: down.hex, map: down.map, hexesEntered: [down.before.hexesEntered, down.day.hexesEntered], entered: down.entered });

  section("battlemap Roads step 12 (changed): the journey read across a drawn road");
  const S0 = pt("S0");
  const S1 = pt("S1");
  const road = await page(gm, P.roadWall, { sceneId: hexScene.id, c: [S0.x, S0.y, S1.x, S1.y], surface: "paved" });
  gm.track(road.uuid, "Wall");
  note("road", road);
  note("pause", await page(gm, P.pause, { fid, paused: true }));
  const toS0 = await page(gm, P.drag, { fid, xy: xy("S0") });
  trackCards(toS0);
  note("unpause", await page(gm, P.pause, { fid, paused: false }));
  st = await stepTo("S1");
  s = await page(gm, P.sheet, { partyId: party.id, keep: true });
  note("road card", { card: card("road"), ctx: ctxCard("road") });
  check("R12: across the drawn road's crossing travel.map.road is the drawn road's surface, sourced map", st.after.map?.road === "paved" && st.after.map?.source?.road === "map", { road: st.after.map?.road, source: st.after.map?.source?.road, navCardsOnTheRoadStep: st.d.navCards });
  check("R12: the Country section's road card reads it with no chip", ctxCard("road")?.value === "paved" && card("road")?.provenance === "map" && !card("road")?.override && !card("road")?.declared, { card: card("road"), ctx: ctxCard("road") });
  note("unrig", await page(gm, P.unrig));
  note("closed", await page(gm, P.closeAll));
}

/* ------------------------------------------------------------------ */
/*  The run                                                             */
/* ------------------------------------------------------------------ */

let registered = false;
let worldTime0 = null;
let encountersBefore = null;
const W = {};
try {
  section("seats");
  note("plan", { parts: [...PARTS], retrack: plan.retrack.length, nonce: NONCE });
  const gm = await seat("gm");
  const player = await seat("player");
  for (const u of plan.retrack ?? []) gm.track(u);
  const census = { gm: await page(gm, P.census, MOD), player: await page(player, P.census, MOD) };
  note("gm census", { ...census.gm, userId: undefined });
  note("player census", { role: census.player.role, activeRoles: census.player.activeRoles });
  worldTime0 = census.gm.worldTime;
  check("the GM seat is the active GM and the player seat is a player", census.gm.activeGMIsSelf && census.gm.role >= 3 && census.player.role < 3, { gmRole: census.gm.role, playerRole: census.player.role, activeRoles: census.gm.activeRoles });
  if (!census.gm.activeGMIsSelf) throw new Error("another GM client is the active GM; the refresh and the throws would run there");
  note("install", { gm: await page(gm, P.install, { nonce: NONCE }), player: await page(player, P.install, { nonce: NONCE }) });
  Object.assign(W, { gm, player, playerId: census.player.userId });
  // Both seats' map view before any part moves it: the Territory pill of every part sets it.
  W.views = { gm: (await page(gm, P.modeState)).view, player: (await page(player, P.modeState)).view };
  note("map views at start", W.views);
  if (census.gm.settings.travelEncounters === true) {
    encountersBefore = true;
    note("travelEncounters off for the walk", await page(gm, P.setSetting, { mod: MOD, key: "travelEncounters", value: false }));
  }
  if (PARTS.has("layers")) {
    section("PART: battlemap layers and water");
    await walkLayers(W);
  }
  if (PARTS.has("modes")) {
    section("PART: battlemap map modes");
    await walkModes(W);
  }
  if (PARTS.has("watershot")) {
    section("PART: water-lines snapshot");
    await walkWaterShot(W);
  }
  if (PARTS.has("country")) {
    section("PART: formation country");
    note("travel document", await page(gm, P.registerTravel, { X, Y, miles: MILES, target: TARGET }));
    registered = true;
    await walkCountry(W);
  }
} catch (err) {
  console.error("WALK FAILED:", err?.stack ?? err);
  process.exitCode = 1;
} finally {
  section("teardown");
  const gm = seats.gm;
  try { if (gm) note("closed windows", { gm: await page(gm, P.closeAll), player: seats.player ? await page(seats.player, P.closeAll) : 0 }); } catch (err) { console.error("closeAll:", err?.message ?? err); }
  try {
    if (gm) {
      const got = await page(gm, P.collectMessages);
      for (const u of got.claimed) gm.track(u, "ChatMessage");
      note("late cards", { claimed: got.claimed.length, unclaimed: got.unclaimed });
    }
  } catch (err) { console.error("collect:", err?.message ?? err); }
  for (const [k, api] of Object.entries(seats)) { try { note(`console errors, ${k} seat (recorder installed after ready)`, await page(api, P.errors)); } catch (err) { console.error("errors:", err?.message ?? err); } }
  try { if (gm && registered) note("travel document unregistered", await page(gm, P.unregisterTravel)); } catch (err) { console.error("unregister:", err?.message ?? err); }
  try { if (gm && encountersBefore != null) note("travelEncounters restored", await page(gm, P.setSetting, { mod: MOD, key: "travelEncounters", value: encountersBefore })); } catch (err) { console.error("setting:", err?.message ?? err); }
  try { if (gm) note("seat restored", await page(gm, P.restoreSeat, { preset: W.preset ?? null })); } catch (err) { console.error("restoreSeat:", err?.message ?? err); }
  try { if (seats.player) note("player seat restored", await page(seats.player, P.restoreSeat, {})); } catch (err) { console.error("restoreSeat player:", err?.message ?? err); }
  for (const k of ["gm", "player"]) {
    try { if (seats[k] && W.views?.[k]) note(`${k} map view restored`, await page(seats[k], P.setView, W.views[k])); } catch (err) { console.error(`map view ${k}:`, err?.message ?? err); }
  }
  try { if (gm) note("sweep", await gm.sweepTracked()); } catch (err) { console.error("sweep:", err?.message ?? err); }
  try { if (gm && worldTime0 != null) note("worldTime delta (s)", (await page(gm, P.census, MOD)).worldTime - worldTime0); } catch (err) { console.error("worldTime:", err?.message ?? err); }
  console.log("\n== shots ==");
  for (const sh of shots) console.log(JSON.stringify(sh));
  console.log("\n== summary ==");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const failed = checks.filter(([, ok]) => !ok).length;
  console.log(`${checks.length - failed}/${checks.length} checks passed`);
  if (failed) process.exitCode = 1;
  for (const api of [seats.player, seats.gm]) { try { api?.close(); } catch (_e) { /* closed */ } }
}
