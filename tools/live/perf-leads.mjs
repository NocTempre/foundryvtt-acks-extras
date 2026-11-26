/**
 * Timing script, not a gating walk: the performance leads of the 2026-11-26
 * closeout read, each one a number from the GM seat's page. It asserts nothing and
 * judges nothing. Run it by hand, never from the release batch:
 *
 *   PERF_LEADS=1 node tools/live/perf-leads.mjs
 *
 * Without `PERF_LEADS=1` it connects to nothing and ends at once, because
 * `tools/live/run.mjs` reads every file here that does not start with `_` as a
 * walk, and a default run must not time anything.
 *
 * Output: one JSON object on stdout (every other line, the driver's included, goes
 * to stderr), and the same object in `aia-tmp/20261126-perf-timings.json`. Each lead
 * is one key; one that could not be built is `null` with a `<lead>Note` key holding
 * a line of why. The keys:
 *
 *   beginCombat20          a. Begin a combat of 20 bearers of an engaged row, to the last ring
 *   dragThrough3Rings      b. one token moved through 3 engaged rings, 3 sheets open
 *   bearerMoveOneSquare    c. one bearer moved one square
 *   clockAdvanceOneTurn    d. one world-clock advance of a turn, in a fight and idle
 *   lordSheet20Henchmen    e. a lord's sheet with 20 henchmen, and `getHenchmen` calls
 *   orgChartSheet          f. a faction sheet whose org chart holds 12 rows
 *   glyphPassAfterHp       g. the reach glyph pass after a hit-point change
 *   firstDeal              h. the treasure Deal, first in a freshly loaded page
 *   firstUnequip           h. a weapon's unequip, first in a freshly loaded page
 *
 * The seats come from `_env.mjs` (CAPTURE_BROWSER, CAPTURE_ORIGIN, SEAT_GM; the
 * Player seat is not driven). It takes the repository's landing lease as the
 * runner does for each walk, and refuses to start while the GM seat's port answers.
 * Fixtures are kept, found again by their `perf/<name>` marker (`FIXTURE_OWN` gives a
 * run its own); the run's own leavings (its combat) are swept by the ids the driver's
 * ledger holds for them and nothing else. The first run builds ~60 fixtures. Bearers
 * come from a library template body whose ability item holds a row with
 * `reach.engaged === true`, as `lib-aura-engaged.mjs` finds one; a world with none
 * prints the arena leads as null.
 *
 * Counts come from hooks and a wrapper on `ApplicationV2.prototype.render` armed for
 * the length of each step only. Every name and figure here is invented.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { acquire } from "../../.claude/skills/acks-commit/lease.mjs";
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS, ROOT } from "./_env.mjs";
import { walkDone } from "./_walk.mjs";

// stdout carries the one JSON object; the driver's progress lines go to stderr.
const writeOut = process.stdout.write.bind(process.stdout);
console.log = (...args) => console.error(...args);

const ENABLED = process.env.PERF_LEADS === "1";
/**
 * `PERF_SET=followup` runs only the follow-up leads and adds their keys to the
 * existing output file, leaving every earlier key as it stood:
 *
 *   libraryLoad            the imported shelves' load, per pack (type, running number, size, ms) and all at once
 *   clockAdvanceKeys       the in-fight clock advance with the changed key paths of its actor updates tallied
 *   glyphPassWithTokens    the glyph pass with tokens standing inside raised reaches
 */
const FOLLOWUP = ENABLED && process.env.PERF_SET === "followup";
const FOLLOWUP_LEADS = new Set(["libraryLoad", "clockAdvanceKeys", "glyphPassWithTokens"]);
if (ENABLED) process.env.SEAT_PLAYER ||= process.env.SEAT_GM ?? "";
const OUT_FILE = path.join(ROOT, "aia-tmp", "20261126-perf-timings.json");
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 1_800_000);
const MOD = "acks-extras";
/** How many bearers the begin-combat lead seats. */
const BEARERS = 20;
/** The most bodies the generator is asked for while a body with an engaged row is looked for. */
const MAX_ATTEMPTS = 40;
/** Henchmen on the lord, and rows on the faction's chart. */
const HENCHMEN = 20;
const CHART_ROWS = 12;

const note = (label, value) => console.error(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const firstLine = (err) => String(err?.message ?? err).split("\n")[0].slice(0, 300);
const pad = (n) => String(n).padStart(2, "0");

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in the seat's page. */
/* ------------------------------------------------------------------ */
const P = {
  /** Hooks, the render wrapper and the long-task observer, armed once per page and counting only between `begin` and `end`. */
  install: async () => {
    globalThis.__perf?.dispose?.();
    const H = (globalThis.__perf = {});
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.r1 = (n) => Math.round(n * 10) / 10;
    H.median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
    H.on = false;
    H.labels = {};
    H.open = [];
    H.longtasks = [];
    const reset = () => {
      H.counts = {}; H.renders = {}; H.byClass = {}; H.tokenWrites = {}; H.last = {}; H.activity = 0; H.t0 = performance.now();
      H.keyTally = {}; H.actorWrites = {}; H.actorTypes = {};
    };
    /** The key paths an update changed: two segments deep, three under `flags`, an id-shaped segment masked, no value read. */
    const keyPaths = (changes) => {
      const out = new Set();
      const seg = (s) => (/^[A-Za-z0-9]{16}$/.test(s) ? "<id>" : s);
      const walk = (obj, path) => {
        for (const [k, v] of Object.entries(obj ?? {})) {
          const p = [...path, seg(k)];
          const depth = p[0] === "flags" ? 3 : 2;
          if (p.length >= depth || v === null || typeof v !== "object" || Array.isArray(v)) out.add(p.join("."));
          else walk(v, p);
        }
      };
      walk(changes, []);
      return out;
    };
    reset();
    const names = [
      "createRegion", "updateRegion", "deleteRegion", "createRegionBehavior", "updateRegionBehavior", "deleteRegionBehavior",
      "createToken", "updateToken", "deleteToken", "updateActor", "createItem", "updateItem", "deleteItem",
      "createActiveEffect", "updateActiveEffect", "deleteActiveEffect", "createChatMessage", "updateChatMessage",
      "updateCombat", "updateCombatant", "updateScene",
    ];
    const hooks = [];
    for (const name of names) {
      const id = Hooks.on(name, (doc, changes) => {
        if (!H.on) return;
        if (name === "updateActor") {
          for (const p of keyPaths(changes)) H.keyTally[p] = (H.keyTally[p] ?? 0) + 1;
          H.actorWrites[doc?.id ?? "?"] = (H.actorWrites[doc?.id ?? "?"] ?? 0) + 1;
          H.actorTypes[doc?.type ?? "?"] = (H.actorTypes[doc?.type ?? "?"] ?? 0) + 1;
        }
        H.counts[name] = (H.counts[name] ?? 0) + 1;
        H.last[name] = performance.now() - H.t0;
        H.activity += 1;
        if (name === "updateToken") H.tokenWrites[doc?.id ?? "?"] = (H.tokenWrites[doc?.id ?? "?"] ?? 0) + 1;
      });
      hooks.push([name, id]);
    }
    const AV2 = foundry.applications.api.ApplicationV2;
    const original = AV2.prototype.render;
    AV2.prototype.render = function (...args) {
      if (H.on) {
        const cls = this.constructor?.name ?? "?";
        const label = H.labels[this.document?.uuid] ?? cls;
        H.renders[label] = (H.renders[label] ?? 0) + 1;
        H.byClass[cls] = (H.byClass[cls] ?? 0) + 1;
        H.activity += 1;
      }
      return original.apply(this, args);
    };
    let observer = null;
    try {
      observer = new globalThis.PerformanceObserver((list) => { for (const e of list.getEntries()) H.longtasks.push({ at: e.startTime, ms: e.duration }); });
      observer.observe({ entryTypes: ["longtask"] });
    } catch { observer = null; }
    H.begin = () => { reset(); H.longtasks = []; H.on = true; };
    /** Wait until nothing counted has happened for `quietMs`; answers when the last counted event landed. */
    H.quiet = async (quietMs = 1200, maxMs = 20000) => {
      const start = performance.now();
      let seen = H.activity;
      let at = performance.now();
      for (;;) {
        await H.sleep(100);
        if (H.activity !== seen) { seen = H.activity; at = performance.now(); }
        if (performance.now() - at >= quietMs) return { settled: true, lastCountedEventMs: H.r1(at - H.t0) };
        if (performance.now() - start > maxMs) return { settled: false, lastCountedEventMs: H.r1(at - H.t0) };
      }
    };
    H.end = () => {
      H.on = false;
      const rendersTotal = Object.values(H.renders).reduce((a, b) => a + b, 0);
      const tasks = H.longtasks.filter((t) => t.at >= H.t0);
      const writes = Object.values(H.actorWrites);
      const updateActorKeys = writes.length
        ? {
          distinctActors: writes.length,
          writesPerActor: writes.reduce((o, n) => ({ ...o, [n]: (o[n] ?? 0) + 1 }), {}),
          actorTypes: { ...H.actorTypes },
          keyPaths: Object.fromEntries(Object.entries(H.keyTally).sort((a, b) => b[1] - a[1])),
        }
        : null;
      return {
        ...(updateActorKeys ? { updateActorKeys } : {}),
        counts: { ...H.counts },
        sheetRenders: { ...H.renders },
        sheetRendersTotal: rendersTotal,
        rendersByClass: { ...H.byClass },
        tokenWritesByTarget: { ...H.tokenWrites },
        lastEventMs: Object.fromEntries(Object.entries(H.last).map(([k, v]) => [k, H.r1(v)])),
        longTaskMs: H.r1(tasks.reduce((a, t) => a + t.ms, 0)),
        longTasks: tasks.length,
      };
    };
    H.dispose = () => {
      for (const [name, id] of hooks) Hooks.off(name, id);
      AV2.prototype.render = original;
      try { observer?.disconnect(); } catch { /* gone */ }
    };
    return {
      user: game.user.name,
      isGM: game.user.isGM,
      primaryGM: !!game.users.activeGM?.isSelf,
      extras: game.modules.get("acks-extras")?.version ?? null,
      lib: acksExtras.lib?.apiVersion ?? null,
      chatMessages: game.messages.size,
      longTasks: !!observer,
    };
  },

  /** What a fresh page can say about itself without having done anything: no wrapper, no hook. */
  bare: () => ({ primaryGM: !!game.users.activeGM?.isSelf, isGM: game.user.isGM, chatMessages: game.messages.size, extras: game.modules.get("acks-extras")?.version ?? null }),

  engagementFeet: async () => (await import("/modules/acks-extras/scripts/lib/distance-units.mjs")).engagementFeet(),

  byMarker: ({ marker }) => {
    const engagedOf = (actor) => {
      const R = acksExtras.lib.itemRun.logic;
      for (const item of actor?.items ?? []) {
        if (!R.alwaysOn(item)) continue;
        for (const row of R.itemRunRowsOf(item)) {
          if (row?.reach?.engaged === true) return { kinds: [...(row.reach.filter?.kinds ?? [])] };
        }
      }
      return null;
    };
    return game.actors.contents.filter((a) => a.flags?.world?.fixture === marker).map((a) => ({ uuid: a.uuid, id: a.id, name: a.name, engaged: engagedOf(a) }));
  },

  templates: async () => {
    const CB = await import("/modules/acks-extras/scripts/importer/cookbook.mjs");
    const out = [];
    for (const d of (await CB.importedDocs("Actor")).filter((x) => x.pack)) {
      const axes = d.system?.toObject?.().axes ?? d.system?.axes ?? [];
      const trait = axes.find((a) => a.key === "trait");
      if (!trait) continue;
      const variants = axes.find((a) => a.key === "variant")?.options ?? [];
      out.push({ uuid: d.uuid, traits: (trait.options ?? []).map((o) => o.key), variant: variants.find((o) => o.flags?.["acks-extras"]?.extras?.encounter)?.key ?? variants[0]?.key ?? "" });
    }
    return out;
  },

  generate: async ({ templateUuid, trait, variant }) => {
    const GEN = await import("/modules/acks-extras/scripts/lib/template-generate.mjs");
    const template = await fromUuid(templateUuid);
    const actor = await GEN.generateFromTemplate(template, { pins: { trait, ...(variant ? { variant } : {}) } });
    if (!actor) return { ok: false };
    const R = acksExtras.lib.itemRun.logic;
    let engaged = null;
    for (const item of actor.items) {
      if (!R.alwaysOn(item)) continue;
      for (const row of R.itemRunRowsOf(item)) if (!engaged && row?.reach?.engaged === true) engaged = { kinds: [...(row.reach.filter?.kinds ?? [])] };
    }
    return { ok: true, uuid: actor.uuid, id: actor.id, name: actor.name, engaged };
  },

  /** An actor as create data, with the marker, the ownership and the generator's own prototype mark taken out. */
  actorData: ({ uuid, name }) => {
    const data = fromUuidSync(uuid).toObject();
    delete data._id;
    delete data.folder;
    delete data._stats;
    delete data.sort;
    data.ownership = { default: 0 };
    data.name = name;
    if (data.flags?.world) delete data.flags.world.fixture;
    if (data.flags?.["acks-extras"]) delete data.flags["acks-extras"].organisationPrototype;
    return data;
  },

  /** The scene's grid at the engagement square, and the scene viewed. */
  viewScene: async ({ sceneUuid, feet }) => {
    const scene = fromUuidSync(sceneUuid);
    const g = scene.grid;
    if (g.size !== 100 || g.distance !== feet || g.units !== "ft") await scene.update({ grid: { size: 100, distance: feet, units: "ft", type: 1 } });
    if (canvas.scene?.id !== scene.id) await scene.view();
    for (let n = 0; n < 150 && !(canvas.scene?.id === scene.id && canvas.ready); n++) await new Promise((r) => setTimeout(r, 100));
    return { viewing: canvas.scene?.id === scene.id && canvas.ready === true, combats: game.combats.filter((c) => c.scene?.id === scene.id).length };
  },

  /** Tokens to their slots, and every named actor to full hit points; writes only what differs. */
  place: async ({ moves, hp }) => {
    let moved = 0;
    for (const m of moves) {
      const t = fromUuidSync(m.uuid);
      if (t.x !== m.x || t.y !== m.y) { await t.update({ x: m.x, y: m.y }, { animate: false }); moved += 1; }
    }
    for (const h of hp) {
      const a = fromUuidSync(h.uuid);
      if (a.system?.hp?.max !== h.max || a.system?.hp?.value !== h.max) await a.update({ "system.hp.max": h.max, "system.hp.value": h.max });
    }
    return { moved };
  },

  openSheets: async ({ list }) => {
    const H = globalThis.__perf;
    const Ext = CONFIG.Actor.sheetClasses.character?.["acks-extras.AcksCharacterSheet"]?.cls ?? null;
    for (const s of list) {
      const actor = fromUuidSync(s.uuid);
      const app = s.ext && Ext ? new Ext({ document: actor }) : actor.sheet;
      H.labels[actor.uuid] = s.label;
      await app.render({ force: true });
      H.open.push(app);
    }
    await H.sleep(1000);
    return H.open.map((a) => ({ label: H.labels[a.document?.uuid] ?? null, cls: a.constructor.name, rendered: a.rendered === true }));
  },
  closeSheets: async () => {
    const H = globalThis.__perf;
    for (const app of H?.open ?? []) { try { await app.close({ animate: false }); } catch { /* closed */ } }
    if (H) H.open = [];
    return true;
  },

  /** The combat's seats, flagged as the tracker leaves a combat before its first round. */
  seatCombat: async ({ combatId, sceneId, rows }) => {
    const combat = game.combats.get(combatId);
    await combat.createEmbeddedDocuments("Combatant", rows.map((r, i) => ({ tokenId: r.tokenId, sceneId, actorId: r.actorId, initiative: 100 - i })));
    await combat.update({ "flags.acks.initDone": true, "flags.acks.lock-turns": false, "flags.acks.groups": [] });
    combat.setupTurns();
    if (!combat.active && typeof combat.activate === "function") await combat.activate();
    return { combatants: combat.combatants.size, active: !!combat.active, round: combat.round };
  },

  rings: ({ sceneUuid }) => {
    const L = acksExtras.lib.auraReach.logic;
    let n = 0;
    for (const r of [...(fromUuidSync(sceneUuid)?.regions ?? [])]) {
      if ([...r.behaviors].some((b) => b.type === "acks-extras.aura" && L.isEngagedActivation(b.system?.activationId))) n += 1;
    }
    return n;
  },

  /** a. The round written to the combat, as the tracker's Begin writes it, timed to the last ring standing. */
  beginStep: async ({ combatId, sceneUuid, want, timeoutMs }) => {
    const H = globalThis.__perf;
    const L = acksExtras.lib.auraReach.logic;
    const count = () => {
      let n = 0;
      for (const r of [...(fromUuidSync(sceneUuid)?.regions ?? [])]) {
        if ([...r.behaviors].some((b) => b.type === "acks-extras.aura" && L.isEngagedActivation(b.system?.activationId))) n += 1;
      }
      return n;
    };
    const combat = game.combats.get(combatId);
    const before = count();
    H.begin();
    const t0 = performance.now();
    await combat.update({ round: 1, turn: 0 });
    const updateMs = performance.now() - t0;
    let n = count();
    let ringsAt = n >= want ? updateMs : null;
    while (ringsAt === null && performance.now() - t0 < timeoutMs) {
      await H.sleep(5);
      n = count();
      if (n >= want) ringsAt = performance.now() - t0;
    }
    const settle = await H.quiet(1500, 20000);
    const out = H.end();
    return { ringsBefore: before, ringsWanted: want, ringsStanding: count(), updateMs: H.r1(updateMs), beginToLastRingMs: ringsAt === null ? null : H.r1(ringsAt), settle, ...out };
  },

  /** b and c. One token update, timed to its own await, then the counts until the world is quiet; the token is put back after. */
  moveStep: async ({ tokenUuid, to, back }) => {
    const H = globalThis.__perf;
    const token = fromUuidSync(tokenUuid);
    H.begin();
    const t0 = performance.now();
    await token.update({ x: to[0], y: to[1] }, { animate: false });
    const updateMs = performance.now() - t0;
    const settle = await H.quiet(1200, 15000);
    const out = H.end();
    await token.update({ x: back[0], y: back[1] }, { animate: false });
    await H.sleep(2000);
    return { updateMs: H.r1(updateMs), settle, ...out };
  },

  /** g. The glyph pass after a hit-point change; then the pass called directly, repeated. */
  glyphStep: async ({ actorUuid, sceneUuid, max, wait = null }) => {
    const H = globalThis.__perf;
    const G = await import("/modules/acks-extras/scripts/lib/reach-glyph.mjs");
    const scene = fromUuidSync(sceneUuid);
    if (canvas.scene?.id !== scene.id || !canvas.ready) throw new Error("the scene is not the viewed one");
    /* With `wait`, glyphs are polled for until `want` stand (or the time is out), then one direct pass is tried. */
    let before = null;
    if (wait) {
      const glyphs = () => (canvas.tokens?.placeables ?? []).filter((t) => G.glyphOf(t)).length;
      const t = performance.now();
      while (glyphs() < wait.want && performance.now() - t < wait.timeoutMs) await H.sleep(200);
      const standing = glyphs();
      let afterDirectPass = null;
      if (standing < wait.want) { G.refreshAllGlyphs(); await H.sleep(500); afterDirectPass = glyphs(); }
      before = { want: wait.want, standing, waitedMs: H.r1(performance.now() - t), afterDirectPass };
    }
    const actor = fromUuidSync(actorUuid);
    if (actor.system.hp.max !== max || actor.system.hp.value !== max) await actor.update({ "system.hp.max": max, "system.hp.value": max });
    await H.sleep(600);
    H.begin();
    const t0 = performance.now();
    await actor.update({ "system.hp.value": max - 1 });
    const updateMs = performance.now() - t0;
    const settle = await H.quiet(800, 8000);
    const afterHp = { updateMs: H.r1(updateMs), settle, ...H.end() };
    const runs = [];
    for (let i = 0; i < 7; i++) {
      const a = performance.now();
      G.refreshAllGlyphs();
      runs.push(performance.now() - a);
      await H.sleep(50);
    }
    await actor.update({ "system.hp.value": max });
    const placeables = canvas.tokens?.placeables ?? [];
    return {
      ...(before ? { glyphsBeforeHp: before } : {}),
      chatMessages: game.messages.size,
      tokensOnScene: placeables.length,
      tokensWithGlyph: placeables.filter((t) => G.glyphOf(t)).length,
      passMs: H.r1(H.median(runs)),
      passRunsMs: runs.map(H.r1),
      afterHp,
    };
  },

  /** d. One world-clock advance of a turn, as the primary GM runs it, put back after. */
  clockStep: async () => {
    const H = globalThis.__perf;
    const dt = acksExtras.lib.timeUnit.turnSeconds();
    const primary = !!game.users.activeGM?.isSelf;
    H.begin();
    const t0 = performance.now();
    await game.time.advance(dt);
    const advanceMs = performance.now() - t0;
    const settle = await H.quiet(1500, 20000);
    const out = H.end();
    let restored = null;
    try { await game.time.advance(-dt); restored = true; } catch { restored = false; }
    await H.sleep(1500);
    return { primaryGM: primary, turnSeconds: dt, advanceMs: H.r1(advanceMs), settle, restoredClock: restored, ...out };
  },

  /** e. The lord's henchmen wired on the lord's list, as the org-chart walk wires its service fixtures. */
  wireHenchmen: async ({ lordId, ids }) => {
    const lord = game.actors.get(lordId);
    if (lord.system.henchmenList.length >= ids.length && ids.every((id) => lord.system.henchmenList.includes(id))) return { wired: 0, listed: lord.system.henchmenList.length };
    await lord.update({ "prototypeToken.actorLink": true });
    let wired = 0;
    for (const id of ids) {
      const h = game.actors.get(id);
      await h.update({ "prototypeToken.actorLink": true, "system.retainer": { enabled: true, managerid: lord.id, category: "henchman", wage: "5", quantity: 1 } });
      if (!lord.system.henchmenList.includes(id)) await lord.addHenchman(id);
      if (!lord.system.henchmenList.includes(id)) await lord.update({ "system.henchmenList": [...lord.system.henchmenList, id] });
      wired += 1;
    }
    return { wired, listed: game.actors.get(lordId).system.henchmenList.length };
  },

  /** e. The lord's sheet rendered from closed, repeated, with `getHenchmen` counted on the class that owns it. */
  lordStep: async ({ lordId }) => {
    const H = globalThis.__perf;
    const lord = game.actors.get(lordId);
    let proto = CONFIG.Actor.documentClass.prototype;
    while (proto && !Object.hasOwn(proto, "getHenchmen")) proto = Object.getPrototypeOf(proto);
    if (!proto) throw new Error("no getHenchmen on the actor class");
    const original = proto.getHenchmen;
    let calls = 0;
    proto.getHenchmen = function (...args) { calls += 1; return original.apply(this, args); };
    const Ext = CONFIG.Actor.sheetClasses.character?.["acks-extras.AcksCharacterSheet"]?.cls ?? null;
    const Sheet = Ext ?? lord.sheet.constructor;
    const one = async (tab) => {
      const app = new Sheet({ document: lord });
      if (tab) app.tabGroups.primary = tab;
      calls = 0;
      H.begin();
      const t0 = performance.now();
      await app.render({ force: true });
      const ms = performance.now() - t0;
      const out = H.end();
      const run = { ms: H.r1(ms), getHenchmenCalls: calls, sheetRendersTotal: out.sheetRendersTotal, longTaskMs: out.longTaskMs };
      await app.close({ animate: false });
      await H.sleep(300);
      return run;
    };
    try {
      const runs = [];
      for (let i = 0; i < 3; i++) runs.push(await one(null));
      const followers = await one("followers");
      return {
        henchmenOnList: lord.system.henchmenList.length,
        sheetClass: Sheet.name,
        ms: H.median(runs.map((r) => r.ms)),
        getHenchmenCalls: runs[0].getHenchmenCalls,
        runs,
        followersTab: followers,
      };
    } finally {
      proto.getHenchmen = original;
    }
  },

  /** f. The faction's chart at its rows: a top row, three under it, the rest under those, each held by one group. */
  orgShape: async ({ factionId, groupIds, rows }) => {
    const org = acksExtras.lib.org;
    const faction = game.actors.get(factionId);
    if (faction.system.units.length >= rows) return { built: 0, rows: faction.system.units.length };
    await faction.update({ "system.units": [] });
    const keys = [];
    let built = 0;
    for (let i = 0; i < rows; i++) {
      const parent = i === 0 ? "" : i <= 3 ? keys[0] : keys[1 + ((i - 4) % 3)];
      const made = await org.addRow(faction, parent, { label: `Row ${i + 1}` });
      if (!made?.ok) throw new Error(`addRow refused: ${made?.reason}`);
      keys.push(made.key);
      const set = await org.setHolder(faction, made.key, game.actors.get(groupIds[i]).uuid);
      if (!set?.ok) throw new Error(`setHolder refused: ${set?.reason}`);
      built += 1;
    }
    return { built, rows: game.actors.get(factionId).system.units.length };
  },

  /** f. The faction sheet rendered from closed on its chart tab, repeated, and the chart's own call alone. */
  orgStep: async ({ factionId }) => {
    const H = globalThis.__perf;
    const faction = game.actors.get(factionId);
    const Sheet = faction.sheet.constructor;
    const one = async () => {
      const app = new Sheet({ document: faction });
      app.tabGroups.primary = "orgChart";
      H.begin();
      const t0 = performance.now();
      await app.render({ force: true });
      const ms = performance.now() - t0;
      const out = H.end();
      const run = { ms: H.r1(ms), sheetRendersTotal: out.sheetRendersTotal, longTaskMs: out.longTaskMs };
      await app.close({ animate: false });
      await H.sleep(300);
      return run;
    };
    const runs = [];
    for (let i = 0; i < 3; i++) runs.push(await one());
    const calls = [];
    let chart = null;
    for (let i = 0; i < 5; i++) {
      const a = performance.now();
      chart = acksExtras.lib.org.orgChart(faction, { isGM: true });
      calls.push(performance.now() - a);
    }
    return { rows: chart.rows.length, sheetClass: Sheet.name, ms: H.median(runs.map((r) => r.ms)), runs, orgChartCallMs: H.r1(H.median(calls)), orgChartCallRunsMs: calls.map(H.r1) };
  },

  /** h. The letters the Deal may be asked for, read without dealing. */
  dealLetters: async () => {
    const M = await import("/modules/acks-extras/scripts/treasure/hoard.mjs");
    return M.hoardTypes("classic").map(String);
  },
  /** h. A pot staged for the Deal, or the id of the one the marker names. */
  newPot: async () => {
    const pile = await acksExtras.treasure.newPot({ name: "Perf Deal Pot", render: false });
    return pile ? { uuid: pile.uuid, id: pile.id } : null;
  },
  potByMarker: ({ marker }) => game.cards.contents.filter((c) => c.flags?.world?.fixture === marker).map((c) => ({ uuid: c.uuid, id: c.id })),
  /** h. Equipped, as the unequip step needs the weapon at its start. */
  equip: async ({ actorId, itemId }) => {
    const item = game.actors.get(actorId).items.get(itemId);
    if (item.system.equipped !== true) await item.update({ "system.equipped": true });
    return item.system.equipped === true;
  },

  /** h. The Deal called twice in a page that has done nothing else; the cards it staged are deleted by their ids. */
  dealOnce: async ({ potId, letters }) => {
    const M = await import("/modules/acks-extras/scripts/treasure/deal.mjs");
    const pile = game.cards.get(potId);
    const known = new Set(pile.cards.map((c) => c.id));
    const run = async () => {
      const t0 = performance.now();
      const out = await M.dealLettersIntoPot(pile, { letters, confirmLair: () => true });
      return { ms: Math.round((performance.now() - t0) * 10) / 10, ok: out?.ok ?? null, reason: out?.reason ?? null, dealt: out?.dealt?.length ?? null, staged: out?.staged?.length ?? null };
    };
    const first = await run();
    const second = await run();
    const mine = pile.cards.filter((c) => !known.has(c.id)).map((c) => c.id);
    let removed = null;
    try { if (mine.length) await pile.deleteEmbeddedDocuments("Card", mine); removed = mine.length; } catch { removed = false; }
    return { first, second, cardsStaged: mine.length, cardsRemoved: removed, chatMessages: game.messages.size };
  },

  /** h. A weapon's unequip, the call the sheet's toggle makes, first in a page that has done nothing else; drawn again after. */
  unequipOnce: async ({ actorId, itemId }) => {
    const A = await import("/modules/acks-extras/scripts/equipment/actions.mjs");
    const item = game.actors.get(actorId).items.get(itemId);
    if (item.system.equipped !== true) return { skip: "the weapon was not equipped at the start" };
    const t0 = performance.now();
    await A.sheatheItem(item);
    const ms = Math.round((performance.now() - t0) * 10) / 10;
    const off = item.system.equipped === false;
    const t1 = performance.now();
    await A.drawItem(item);
    const drawMs = Math.round((performance.now() - t1) * 10) / 10;
    return { ms, unequipped: off, redrawMs: drawMs, equippedAfter: item.system.equipped === true };
  },

  /**
   * The imported shelves' load. `all` calls `warmLibrary()` as the module does; `sequential` awaits each
   * shelf's own `getDocuments()` one at a time. Pass one is what the page holds when it is first asked
   * (the module's ready-time warm may be done or still running; `coldAtStart` says which); pass two
   * empties each shelf's collection first, so the load is done again from the server. Type, a running
   * number, size and ms only.
   */
  libraryLoad: async ({ mode }) => {
    const L = await import("/modules/acks-extras/scripts/lib/library.mjs");
    const types = ["Item", "Actor", "JournalEntry", "RollTable"];
    const r1 = (n) => Math.round(n * 10) / 10;
    const loaded = (pack) => [...pack.values()].length;
    const cold = (pack) => pack.index.size > loaded(pack);
    let obs = null;
    try { obs = new globalThis.PerformanceObserver(() => {}); obs.observe({ entryTypes: ["longtask"] }); } catch { obs = null; }
    const longMs = async () => { await new Promise((r) => setTimeout(r, 80)); return r1((obs?.takeRecords() ?? []).reduce((a, e) => a + e.duration, 0)); };
    const shelves = () => types.flatMap((type) => L.libraryPacks(type).map((pack) => ({ type, pack })));
    const pass = async () => {
      const list = shelves();
      const coldAtStart = list.filter((s) => cold(s.pack)).length;
      obs?.takeRecords();
      const t0 = performance.now();
      const packs = [];
      if (mode === "all") {
        await L.warmLibrary();
        const totalMs = r1(performance.now() - t0);
        return { shelves: list.length, coldAtStart, packs: list.map((s, i) => ({ type: s.type, n: i + 1, indexSize: s.pack.index.size, loaded: loaded(s.pack) })), totalMs, longTaskMs: await longMs() };
      }
      let n = 0;
      for (const s of list) {
        n += 1;
        const was = cold(s.pack);
        const a = performance.now();
        await s.pack.getDocuments();
        packs.push({ type: s.type, n, indexSize: s.pack.index.size, coldAtStart: was, loaded: loaded(s.pack), ms: r1(performance.now() - a) });
      }
      return { shelves: list.length, coldAtStart, packs, totalMs: r1(performance.now() - t0), longTaskMs: await longMs() };
    };
    const sinceNavigationMs = r1(performance.now());
    const asFound = await pass();
    let emptied = 0;
    for (const s of shelves()) { Map.prototype.clear.call(s.pack); if (loaded(s.pack) === 0) emptied += 1; }
    const recold = await pass();
    try { obs?.disconnect(); } catch { /* gone */ }
    return { mode, sinceNavigationMs, asFound, shelvesEmptied: emptied, recold };
  },
};

/* ------------------------------------------------------------------ */
/*  Node side                                                          */
/* ------------------------------------------------------------------ */
const run = (api, fn, arg) => api.eval(`(${fn.toString()})(${JSON.stringify(arg ?? null)})`);

/** True when something already answers CDP on the port: another walk's browser, or a peer session's. */
const portBusy = (port) => new Promise((resolve) => {
  const req = http.get({ host: "127.0.0.1", port, path: "/json/version", timeout: 1500 }, (res) => { res.resume(); resolve(true); });
  req.on("error", () => resolve(false));
  req.on("timeout", () => { req.destroy(); resolve(false); });
});

function commonGitDir() {
  const r = spawnSync("git", ["rev-parse", "--git-common-dir"], { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0 || !r.stdout.trim()) throw new Error(`cannot find the git directory: ${(r.stderr || r.error?.message || "").trim()}`);
  return path.resolve(ROOT, r.stdout.trim());
}

const R = { at: new Date().toISOString() };
const open = {};
const disposables = [];
let lease = null;
const letGo = () => { try { lease?.stop(); } catch { /* given up */ } lease = null; };
process.on("exit", letGo);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => { letGo(); process.exit(1); });

/** A lead runs on its own: a throw is `null` and a note, and the script goes on. */
async function lead(name, fn) {
  if (FOLLOWUP !== FOLLOWUP_LEADS.has(name)) return;
  try {
    const value = await fn();
    R[name] = value ?? null;
  } catch (err) {
    R[name] = null;
    R[`${name}Note`] = firstLine(err);
    note(`lead ${name} not measured`, firstLine(err));
  }
}

let MACHINE = null;
const marked = (marker) => (MACHINE?.own ? `${marker}@${MACHINE.own}` : marker);

async function seatConnect() {
  return connect({ browser: MACHINE.browser, origin: MACHINE.origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
}

/** The first body (a kept fixture, a copy of a peer walk's, or a generated one) whose ability item holds an engaged row. */
async function bearerBody(gm) {
  const mine = await run(gm, P.byMarker, { marker: marked("perf/engaged-unit") });
  if (mine.length > 1) throw new Error(`${mine.length} actors carry the marker perf/engaged-unit`);
  if (mine.length === 1) {
    if (!mine[0].engaged) throw new Error("the kept fixture perf/engaged-unit holds no engaged row any more; retire it by its marker");
    return { ...mine[0], kept: true };
  }
  const peer = await run(gm, P.byMarker, { marker: marked("lib/aura-t10-unit") });
  if (peer.length === 1 && peer[0].engaged) {
    const data = await run(gm, P.actorData, { uuid: peer[0].uuid, name: "Perf Bearer 01" });
    const made = await gm.fixture("perf/engaged-unit", "Actor", data);
    return { uuid: made.uuid, id: made.id, name: made.name, engaged: peer[0].engaged, kept: false };
  }
  const templates = await run(gm, P.templates);
  let attempts = 0;
  for (const tpl of templates) {
    for (const trait of tpl.traits) {
      if (attempts >= MAX_ATTEMPTS) throw new Error("no body with an engaged row in the first 40 the generator made: the book that prints it is not imported on this world");
      attempts += 1;
      const g = await run(gm, P.generate, { templateUuid: tpl.uuid, trait, variant: tpl.variant });
      if (!g?.ok) continue;
      gm.track(g.uuid, "Actor");
      if (g.engaged) {
        await gm.mark(g.uuid, "perf/engaged-unit");
        return { uuid: g.uuid, id: g.id, name: g.name, engaged: g.engaged, kept: false };
      }
      await gm.sweepTracked({ only: [g.uuid] });
    }
  }
  throw new Error("no library template generates a body whose ability item holds an engaged row: the book that prints it is not imported on this world");
}

/** One slot for each bearer: three in a row for the drag, the rest four squares apart in rows below. */
function slots(n) {
  const out = [[600, 700], [1000, 700], [1400, 700]];
  for (const y of [1100, 1500, 1900]) for (let i = 0; i < 7; i++) out.push([200 + 400 * i, y]);
  return out.slice(0, n);
}

/** The arena the first four leads share: the scene, the bearers and their tokens, the traveler, a character and a group on the scene, the sheets open. */
let arena = null;
let arenaError = null;
async function getArena(gm) {
  if (arena) return arena;
  if (arenaError) throw arenaError;
  try {
    arena = await buildArena(gm);
    return arena;
  } catch (err) {
    arenaError = err;
    throw err;
  }
}

async function buildArena(gm) {
  const feet = await run(gm, P.engagementFeet);
  const scene = await gm.fixture("perf/arena-scene", "Scene", { name: "Perf Arena", width: 3200, height: 2600, padding: 0, grid: { size: 100, distance: feet, units: "ft", type: 1 } });
  const body = await bearerBody(gm);
  note("bearer body", { kept: body.kept, kinds: body.engaged.kinds.length });
  const spots = slots(BEARERS);
  const bearers = [];
  for (let i = 0; i < BEARERS; i++) {
    const n = pad(i + 1);
    let actor;
    if (i === 0) actor = body;
    else {
      const data = await run(gm, P.actorData, { uuid: body.uuid, name: `Perf Bearer ${n}` });
      actor = await gm.fixture(`perf/engaged-unit-${n}`, "Actor", data);
    }
    const token = await gm.fixture(`perf/engaged-token-${n}`, "Token", { name: actor.name, actorId: actor.id, actorLink: true, x: spots[i][0], y: spots[i][1], disposition: -1 }, { parent: scene.uuid });
    bearers.push({ actorUuid: actor.uuid, actorId: actor.id, tokenUuid: token.uuid, tokenId: token.id, slot: spots[i] });
  }
  const kinds = body.engaged.kinds;
  const traveler = await gm.fixture("perf/arena-traveler", "Actor", { name: "Perf Traveler", type: "monster", prototypeToken: { actorLink: true, disposition: 1 }, flags: { [MOD]: { extras: { types: kinds } } } });
  const character = await gm.fixture("perf/arena-character", "Actor", { name: "Perf Character", type: "character", prototypeToken: { actorLink: true }, system: { hp: { value: 6, max: 6 } } });
  const group = await gm.fixture("perf/arena-group", "Actor", { name: "Perf Group", type: "acks-extras.group", items: [] });
  const homes = { traveler: [200, 600], character: [2800, 300], group: [2800, 500] };
  const tokenOf = async (key, actor) => {
    const t = await gm.fixture(`perf/arena-${key}-token`, "Token", { name: actor.name, actorId: actor.id, actorLink: true, x: homes[key][0], y: homes[key][1], disposition: key === "traveler" ? 1 : 0 }, { parent: scene.uuid });
    return { actorUuid: actor.uuid, actorId: actor.id, tokenUuid: t.uuid, tokenId: t.id, home: homes[key] };
  };
  const t = { traveler: await tokenOf("traveler", traveler), character: await tokenOf("character", character), group: await tokenOf("group", group) };
  const view = await run(gm, P.viewScene, { sceneUuid: scene.uuid, feet });
  if (!view.viewing) throw new Error("the GM seat could not view the perf scene");
  if (view.combats) throw new Error(`${view.combats} combat(s) already stand on the perf scene`);
  const placed = await run(gm, P.place, {
    moves: [...bearers.map((b) => ({ uuid: b.tokenUuid, x: b.slot[0], y: b.slot[1] })), ...Object.values(t).map((x) => ({ uuid: x.tokenUuid, x: x.home[0], y: x.home[1] }))],
    hp: [{ uuid: t.traveler.actorUuid, max: 8 }],
  });
  note("arena placed", placed);
  return { sceneUuid: scene.uuid, sceneId: scene.id, feet, bearers, ...t, kinds: kinds.length };
}

/** The run's combat, made and swept by its own id, its 20 bearers seated and no round begun. */
async function startFight(gm, a) {
  const combat = await gm.create("Combat", { scene: a.sceneId, active: true });
  disposables.push(combat.uuid);
  const seated = await run(gm, P.seatCombat, { combatId: combat.id, sceneId: a.sceneId, rows: a.bearers.map((b) => ({ tokenId: b.tokenId, actorId: b.actorId })) });
  return { combat, seated };
}
async function endFight(gm, fight) {
  if (!fight) return null;
  const sw = await gm.sweepTracked({ only: [fight.combat.uuid] });
  const i = disposables.indexOf(fight.combat.uuid);
  if (i >= 0) disposables.splice(i, 1);
  return sw;
}

/** The run's page-side counters answer in a fixed shape; this picks what a lead names. */
const pick = (raw, keys) => Object.fromEntries(keys.filter((k) => k in raw).map((k) => [k, raw[k]]));

/** h's fixtures, built in the first seat so the two fresh pages only measure. */
async function prepareH(gm) {
  const prep = {};
  try {
    const letters = await run(gm, P.dealLetters);
    prep.letters = letters;
    if (!letters.length) prep.dealNote = "no treasure table is imported on this world, so there is no letter to deal";
    else {
      let pot = (await run(gm, P.potByMarker, { marker: marked("perf/deal-pot") }))[0];
      if (!pot) {
        const made = await run(gm, P.newPot);
        if (!made) throw new Error("newPot made no pot");
        await gm.mark(made.uuid, "perf/deal-pot");
        pot = made;
      }
      prep.potId = pot.id;
    }
  } catch (err) { prep.dealNote = firstLine(err); }
  try {
    const actor = await gm.fixture("perf/unequip-actor", "Actor", { name: "Perf Unequip", type: "character", prototypeToken: { actorLink: true }, system: { hp: { value: 6, max: 6 } } });
    const weapon = await gm.fixture("perf/unequip-weapon", "Item", { name: "Perf Blade", type: "weapon", system: { equipped: true, melee: true, missile: false } }, { parent: actor.uuid });
    if (!(await run(gm, P.equip, { actorId: actor.id, itemId: weapon.id }))) throw new Error("the weapon would not stay equipped");
    prep.actorId = actor.id;
    prep.itemId = weapon.id;
  } catch (err) { prep.unequipNote = firstLine(err); }
  return prep;
}

/** A page with nothing done in it, for a "first" measurement; closed after. */
async function freshPage(fn) {
  const page = await seatConnect();
  try {
    const bare = await run(page, P.bare);
    return await fn(page, bare);
  } finally {
    try { page.close(); } catch { /* closed */ }
  }
}

setTimeout(() => {
  console.error(`WALK ERROR: wall clock of ${WALL_MS} ms reached; closing the seats`);
  for (const api of Object.values(open)) { try { api.close(); } catch { /* closed */ } }
  letGo();
  process.exit(1);
}, WALL_MS).unref();

try {
  if (!ENABLED) {
    console.error("perf-leads is a timing script, not a walk: set PERF_LEADS=1 to run it. Nothing was connected.");
  } else {
    MACHINE = machineSeats();
    if (await portBusy(PORTS.gm)) throw new Error(`a browser already answers on the GM seat's port ${PORTS.gm}; another walk or a peer session holds the seat`);
    const gitDir = commonGitDir();
    lease = await acquire(gitDir, { session: process.env.CLAUDE_CODE_SESSION_ID ?? null, change: "perf-leads" }, {
      waitMs: Number(process.env.ACKS_WALK_LEASE_WAIT_MS ?? 3_600_000),
      onWait: (held) => note("the landing lease is held; waiting", { session: String(held?.session ?? "").slice(0, 8), for: held?.change ?? null }),
    });
    if (!lease) { process.exitCode = 5; throw new Error("the landing lease stayed held past the wait; nothing was measured"); }

    open.gm = await seatConnect();
    const gm = open.gm;
    if (FOLLOWUP) {
      Object.assign(R, JSON.parse(fs.readFileSync(OUT_FILE, "utf8")));
      R.followupAt = new Date().toISOString();
      R.followupMeta = await run(gm, P.install);
      note("seat", R.followupMeta);
    } else {
      R.meta = await run(gm, P.install);
      note("seat", R.meta);
    }

    /* a, b, c, g, d: one arena, one fight */
    let fight = null;
    let sheetsOpen = false;
    try {
      await lead("beginCombat20", async () => {
        const a = await getArena(gm);
        if (!R.meta.primaryGM) throw new Error("this seat is not the primary GM; the rings are made on the primary GM's client");
        const sheets = await run(gm, P.openSheets, { list: [
          { uuid: a.traveler.actorUuid, label: "monsterSheet(traveler)", ext: false },
          { uuid: a.character.actorUuid, label: "characterSheet", ext: true },
          { uuid: a.group.actorUuid, label: "groupSheet", ext: false },
        ] });
        sheetsOpen = true;
        fight = await startFight(gm, a);
        const raw = await run(gm, P.beginStep, { combatId: fight.combat.id, sceneUuid: a.sceneUuid, want: BEARERS, timeoutMs: 60000 });
        return {
          combatants: fight.seated.combatants,
          sheetsOpen: sheets,
          ringsStanding: raw.ringsStanding,
          beginToLastRingMs: raw.beginToLastRingMs,
          updateMs: raw.updateMs,
          regionCreates: raw.counts.createRegion ?? 0,
          tokenWrites: raw.counts.updateToken ?? 0,
          sheetRenders: raw.sheetRenders,
          sheetRendersTotal: raw.sheetRendersTotal,
          ...pick(raw, ["counts", "rendersByClass", "tokenWritesByTarget", "lastEventMs", "longTaskMs", "longTasks", "settle"]),
        };
      });

      await lead("dragThrough3Rings", async () => {
        const a = await getArena(gm);
        if (!fight || R.beginCombat20 === null) throw new Error("no fight is running (see beginCombat20Note)");
        if (R.beginCombat20.ringsStanding < 3) throw new Error(`only ${R.beginCombat20.ringsStanding} ring(s) stand`);
        const raw = await run(gm, P.moveStep, { tokenUuid: a.traveler.tokenUuid, to: [1800, 600], back: a.traveler.home });
        return {
          travelerTokenId: a.traveler.tokenId,
          ringsOnPath: 3,
          updateTokenEvents: raw.counts.updateToken ?? 0,
          updateTokenOnTraveler: raw.tokenWritesByTarget[a.traveler.tokenId] ?? 0,
          sheetRenders: raw.sheetRenders,
          sheetRendersTotal: raw.sheetRendersTotal,
          updateMs: raw.updateMs,
          ...pick(raw, ["counts", "rendersByClass", "tokenWritesByTarget", "lastEventMs", "longTaskMs", "longTasks", "settle"]),
        };
      });

      await lead("bearerMoveOneSquare", async () => {
        const a = await getArena(gm);
        if (!fight || R.beginCombat20 === null) throw new Error("no fight is running (see beginCombat20Note)");
        const b = a.bearers[0];
        const raw = await run(gm, P.moveStep, { tokenUuid: b.tokenUuid, to: [b.slot[0], b.slot[1] + 100], back: b.slot });
        return {
          updateRegionEvents: raw.counts.updateRegion ?? 0,
          updateTokenEvents: raw.counts.updateToken ?? 0,
          sheetRenders: raw.sheetRenders,
          sheetRendersTotal: raw.sheetRendersTotal,
          updateMs: raw.updateMs,
          ...pick(raw, ["counts", "rendersByClass", "lastEventMs", "longTaskMs", "longTasks", "settle"]),
        };
      });

      await lead("glyphPassAfterHp", async () => {
        const a = await getArena(gm);
        if (!fight || R.beginCombat20 === null) throw new Error("no fight is running (see beginCombat20Note)");
        return run(gm, P.glyphStep, { actorUuid: a.traveler.actorUuid, sceneUuid: a.sceneUuid, max: 8 });
      });

      await lead("clockAdvanceOneTurn", async () => {
        if (!R.meta.primaryGM) throw new Error("this seat is not the primary GM; the clock handlers run on the primary GM's client");
        const inFight = fight ? await run(gm, P.clockStep) : null;
        if (!fight) note("clock", "no fight is running; only the idle advance is taken");
        const sw = await endFight(gm, fight);
        fight = null;
        note("combat swept", sw);
        await sleep(2500);
        const idle = await run(gm, P.clockStep);
        return { inFight, idle };
      });

      /* Follow-up: the arena's fight begun as in `beginCombat20` and its sheets open, then the clock advanced once, its actor updates tallied by key path. */
      await lead("clockAdvanceKeys", async () => {
        if (!R.followupMeta?.primaryGM) throw new Error("this seat is not the primary GM; the clock handlers run on the primary GM's client");
        const a = await getArena(gm);
        await run(gm, P.openSheets, { list: [
          { uuid: a.traveler.actorUuid, label: "monsterSheet(traveler)", ext: false },
          { uuid: a.character.actorUuid, label: "characterSheet", ext: true },
          { uuid: a.group.actorUuid, label: "groupSheet", ext: false },
        ] });
        sheetsOpen = true;
        fight = await startFight(gm, a);
        const begun = await run(gm, P.beginStep, { combatId: fight.combat.id, sceneUuid: a.sceneUuid, want: BEARERS, timeoutMs: 60000 });
        const raw = await run(gm, P.clockStep);
        return { ringsStanding: begun.ringsStanding, actorsInWorld: await run(gm, () => game.actors.size), inFight: raw };
      });

      /* Follow-up: tokens of the traveler's body stood one square off bearers, inside the raised rings; the glyph pass timed with the chat log at its present size. */
      await lead("glyphPassWithTokens", async () => {
        const a = await getArena(gm);
        if (!fight) throw new Error("no fight is running (see clockAdvanceKeysNote)");
        const probes = [];
        for (const b of a.bearers.slice(0, 12)) {
          const t = await gm.create("Token", { name: "Perf Glyph Probe", actorId: a.traveler.actorId, actorLink: true, x: b.slot[0], y: b.slot[1] - 100, disposition: 1 }, { parent: a.sceneUuid });
          probes.push(t.uuid);
        }
        try {
          const out = await run(gm, P.glyphStep, { actorUuid: a.traveler.actorUuid, sceneUuid: a.sceneUuid, max: 8, wait: { want: 10, timeoutMs: 15000 } });
          return { probeTokens: probes.length, ...out };
        } finally {
          note("glyph probes swept", await gm.sweepTracked({ only: probes }));
        }
      });
    } finally {
      if (fight) { try { note("combat swept", await endFight(gm, fight)); } catch (err) { console.error("sweep:", firstLine(err)); } fight = null; }
      if (sheetsOpen) { try { await run(gm, P.closeSheets); } catch { /* closed */ } }
    }

    /* e: a lord with 20 henchmen */
    await lead("lordSheet20Henchmen", async () => {
      const lord = await gm.fixture("perf/lord", "Actor", { name: "Perf Lord", type: "character", prototypeToken: { actorLink: true }, system: { scores: { cha: { value: 13 } }, details: { level: 4 } } });
      const ids = [];
      for (let i = 1; i <= HENCHMEN; i++) {
        const h = await gm.fixture(`perf/lord-hench-${pad(i)}`, "Actor", { name: `Perf Henchman ${pad(i)}`, type: "character", prototypeToken: { actorLink: true }, items: [] });
        ids.push(h.id);
      }
      const wired = await run(gm, P.wireHenchmen, { lordId: lord.id, ids });
      note("lord wired", wired);
      if (wired.listed < HENCHMEN) throw new Error(`the lord's list holds ${wired.listed} of ${HENCHMEN}`);
      return run(gm, P.lordStep, { lordId: lord.id });
    });

    /* f: a faction's org chart */
    await lead("orgChartSheet", async () => {
      const faction = await gm.fixture("perf/org-faction", "Actor", { name: "Perf Village", type: "acks-extras.faction", items: [] });
      const groupIds = [];
      for (let i = 1; i <= CHART_ROWS; i++) {
        const g = await gm.fixture(`perf/org-group-${pad(i)}`, "Actor", { name: `Perf Band ${pad(i)}`, type: "acks-extras.group", items: [] });
        groupIds.push(g.id);
      }
      note("chart shaped", await run(gm, P.orgShape, { factionId: faction.id, groupIds, rows: CHART_ROWS }));
      return run(gm, P.orgStep, { factionId: faction.id });
    });

    /* h: the fixtures for the two fresh-page measurements */
    const prep = FOLLOWUP ? {} : await prepareH(gm);
    if (!FOLLOWUP) note("h prepared", { letters: prep.letters?.length ?? null, pot: !!prep.potId, weapon: !!prep.itemId });
    try { open.gm.close(); } catch { /* closed */ }
    delete open.gm;

    /* Follow-up: two fresh pages, one asking the shelves one at a time, one asking as the module does. */
    await lead("libraryLoad", async () => {
      const sequential = await freshPage(async (page, bare) => ({ freshPage: bare, ...(await run(page, P.libraryLoad, { mode: "sequential" })) }));
      const all = await freshPage(async (page, bare) => ({ freshPage: bare, ...(await run(page, P.libraryLoad, { mode: "all" })) }));
      return { sequential, all };
    });

    await lead("firstDeal", async () => {
      if (prep.dealNote) throw new Error(prep.dealNote);
      return freshPage(async (page, bare) => ({ freshPage: bare, ...(await run(page, P.dealOnce, { potId: prep.potId, letters: [prep.letters[0]] })) }));
    });
    await lead("firstUnequip", async () => {
      if (prep.unequipNote) throw new Error(prep.unequipNote);
      const out = await freshPage(async (page, bare) => ({ freshPage: bare, ...(await run(page, P.unequipOnce, { actorId: prep.actorId, itemId: prep.itemId })) }));
      if (out.skip) throw new Error(out.skip);
      return out;
    });
  }
  walkDone();
} catch (err) {
  console.error(`PERF ERROR: ${firstLine(err)}`);
  R.error = firstLine(err);
  process.exitCode ||= 1;
} finally {
  for (const api of Object.values(open)) { try { api.close(); } catch { /* closed */ } }
  letGo();
  if (ENABLED) {
    const json = `${JSON.stringify(R, null, 2)}\n`;
    try {
      fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
      fs.writeFileSync(OUT_FILE, json);
    } catch (err) { console.error(`could not write ${OUT_FILE}: ${firstLine(err)}`); }
    writeOut(json);
  }
}
