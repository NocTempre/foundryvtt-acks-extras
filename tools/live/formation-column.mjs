/**
 * Live walk: docs/formation/TESTING.md "The column and its lights", "Light
 * figures, imported" (the column section's opening paragraph and the Kit tab),
 * "The delve's wandering cadence" and "The rest switch". The GM seat is the
 * active GM; the Player seat owns every member of the column party and drags
 * its token with trusted pointer input.
 *
 * Covers:
 *   "The column and its lights" 1-8, 9 (the pasted copy), 11 (the fill, the
 *       tint, the hidden token), 12 (one party, explicit shape against the
 *       world default), 13 and 14 up to the release, 15 (a column squeezed by
 *       its corridor, drawn and deployed) and 16 (the column's wall test
 *       against core's movement collision). Not walked: 9's mile
 *       scene, 10's Night Vision watcher, 11's line of sight around the
 *       corner, and 14's reclaim, which is a world-wide write over every
 *       released token, a peer's included.
 *   "Light figures, imported": the reach and burn time in force are the
 *       table's, a Ruledata Browser override (the store's `setOverride`, the
 *       write the browser's Edit makes) takes effect on the column's light and
 *       the Kit tab, and with the light document unregistered on the GM seat
 *       alone the Kit tab and the bearer's sheet say the figure is not
 *       imported; and "Supplying a light": a Judge's light on a bearer with no
 *       fuel hands over the largest stack its pattern matches.
 *   "The delve's wandering cadence" 1-5.
 *   "The rest switch" 1-4.
 *
 * Every fixture and figure is invented; an imported figure is compared in the
 * page and printed as a boolean. Fixtures, kept and found again by marker
 * (`api.fixture`): the scene `formation/column-scene` (an L corridor of walls),
 * the party `formation/column-party` with `formation/column-lead`,
 * `formation/column-torch` and `formation/column-lantern`, its token
 * `formation/column-party-token`; `formation/column-watcher`, a character
 * with no party whose token stands in for an unmanaged light; the parties
 * `formation/cadence-party` and `formation/rest-party` with their members
 * `formation/cadence-member` (who carries no fuel, for the supply check) and
 * `formation/rest-member`.
 * Each section brings what it reads to shape at its start.
 * Writes outside the ledger, each restored in a finally: the world settings
 * `partyTokenShape`, `encounterEvery`, `encounterTarget`, `restRequired` and
 * `advanceWorldTime`; the `light` and `delveEncounters` overrides in the
 * imported-tables store (put back as found); the client-side unregister of the
 * light document (reloaded from the store). The combat, the pasted copy, the
 * hand-lit token, the supplied items and the cards the run's own actions
 * posted are tracked by id and swept.
 */
import path from "node:path";
import { Cdp, connect, sleep } from "./_driver.mjs";
import { books, seats as machineSeats, PORTS, shotDir } from "./_env.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const SEATS = { gm: MACHINE.gm, player: MACHINE.player };
const SCOPE = "acks-extras";
const SHOTS = process.env.SHOTS === "1";
/** The run's tag on the chat cards this GM client creates, so a card is claimed only from this run. */
const NONCE = "col" + Math.random().toString(36).slice(2, 7);

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const tally = { pass: 0, fail: 0 };
const check = (label, ok, detail) => {
  if (ok) tally.pass += 1; else tally.fail += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + JSON.stringify(detail)}`);
};

/** Added to every document a seat loads: errors from the first script on, each with its phase, and every warning toast. */
const RECORDER = `(() => {
  const R = (globalThis.__colBoot = { phase: "load", phases: [], errors: [], warns: [] });
  const push = (kind, text) => R.errors.push({ phase: R.phase, kind, text: String(text).slice(0, 300) });
  const error = console.error.bind(console);
  console.error = (...args) => { push("console", args.map((a) => a?.message ?? a).join(" ")); error(...args); };
  addEventListener("error", (e) => push("error", e.message));
  addEventListener("unhandledrejection", (e) => push("rejection", e.reason?.message ?? e.reason));
  const arm = setInterval(() => {
    if (!globalThis.Hooks?.once) return;
    clearInterval(arm);
    for (const phase of ["init", "setup", "ready"]) Hooks.once(phase, () => { R.phase = phase; R.phases.push(phase); });
    Hooks.once("init", () => {
      const proto = foundry.applications.ui.Notifications.prototype;
      const warn = proto.warn;
      proto.warn = function (msg, ...rest) { R.warns.push(String(msg)); return warn.call(this, msg, ...rest); };
    });
  }, 2);
})()`;

/* The corridor: a 100 px, 5 ft grid; east six cells from x 100, two rows tall, then south six from row 1. */
const GS = 100;
const WALLS = [
  [100, 100, 700, 100], [700, 100, 700, 700], [700, 700, 500, 700],
  [500, 700, 500, 300], [500, 300, 100, 300], [100, 300, 100, 100],
];
/** Every cell the head can stand on or the column can trail through, as top-left corners. */
const CORRIDOR = new Set([
  ...[1, 2, 3, 4, 5, 6].flatMap((cx) => [1, 2].map((cy) => `${cx * GS},${cy * GS}`)),
  ...[5, 6].flatMap((cx) => [3, 4, 5, 6].map((cy) => `${cx * GS},${cy * GS}`)),
]);
const START = { x: 3 * GS, y: 1 * GS };
const CORNER = { x: 5 * GS, y: 1 * GS };
const SOUTH = { x: 5 * GS, y: 6 * GS };

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in a seat's page.  */
/* ------------------------------------------------------------------ */

const P = {
  census: async () => {
    const lead = await import("/modules/acks-extras/scripts/lib/automation-client.mjs").catch(() => null);
    return {
      user: game.user.name,
      userId: game.user.id,
      role: game.user.role,
      activeGMIsSelf: !!game.users.activeGM?.isSelf,
      lead: lead ? !!lead.isLeadClient() : null,
      active: game.users.filter((u) => u.active).map((u) => u.name),
      boot: globalThis.__colBoot ?? null,
    };
  },

  install: async ({ nonce }) => {
    const H = (globalThis.__col = globalThis.__col ?? {});
    const base = "/modules/acks-extras/scripts/";
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 50, every = 150 } = {}) => {
      for (let n = 0; n < tries; n++) {
        const v = await fn();
        if (v) return v;
        await H.sleep(every);
      }
      return null;
    };
    H.model = await import(`${base}formation/formation-model.mjs`);
    H.column = await import(`${base}formation/column.mjs`);
    H.cl = await import(`${base}formation/column-light.mjs`);
    H.cll = await import(`${base}formation/column-light-logic.mjs`);
    H.k = await import(`${base}formation/constants.mjs`);
    H.te = await import(`${base}formation/turn-engine.mjs`);
    H.light = await import(`${base}lib/light.mjs`);
    H.units = await import(`${base}lib/distance-units.mjs`);
    H.store = await import(`${base}location/table-store.mjs`);
    H.t = acksExtras.lib.tables;
    H.F = acksExtras.formation;
    H.root = (app) => (app?.element?.nodeType === 1 ? app.element : app?.element?.[0]) ?? null;
    if (!H.notes) {
      H.notes = [];
      for (const level of ["info", "warn"]) {
        const fn = ui.notifications[level];
        ui.notifications[level] = function (msg, ...rest) {
          H.notes.push(String(msg));
          return fn.call(this, msg, ...rest);
        };
      }
    }
    if (!H.cardsArmed && game.user.isGM) {
      H.cardsArmed = true;
      H.cards = [];
      const throwPre = game.i18n.localize("ACKS-FORMATION.chat.encounterCheck").split("{")[0].trim();
      const metPre = game.i18n.localize("ACKS-FORMATION.chat.encounterTriggered");
      Hooks.on("preCreateChatMessage", (doc, _data, _opts, userId) => {
        if (userId === game.user.id) doc.updateSource({ "flags.world.qaNonce": nonce });
      });
      Hooks.on("createChatMessage", (m) => {
        if (m.flags?.world?.qaNonce !== nonce) return;
        const html = `${m.flavor ?? ""} ${m.content ?? ""}`;
        const box = document.createElement("div");
        box.innerHTML = html;
        const tips = [...box.querySelectorAll("[data-tooltip-text]")].map((n) => n.dataset.tooltipText);
        H.cards.push({ id: m.id, at: Date.now(), alias: m.speaker?.alias ?? null, text: box.textContent, tips, formulas: (m.rolls?.length ? m.rolls.map((r) => r.formula) : [...box.querySelectorAll(".dice-formula")].map((n) => n.textContent)).map((f) => f.replace(/\s+/g, "")), whisper: m.whisper?.length ?? 0, isThrow: box.textContent.includes(throwPre), isMet: box.textContent.includes(metPre) });
      });
    }
    if (!H.trailWrites) {
      H.trailWrites = [];
      Hooks.on("updateToken", (doc, changes) => {
        if (foundry.utils.hasProperty(changes, "flags.acks-extras.trail")) H.trailWrites.push({ id: doc.id, at: Date.now(), moved: "x" in changes || "y" in changes, sized: "width" in changes || "height" in changes });
      });
    }
    return { ok: typeof H.F?.advanceTurns === "function" };
  },

  /** What the world's registry holds for the two delve documents, as booleans and kinds only. */
  tables: async () => {
    const H = globalThis.__col;
    const fig = H.light.lightFigures("torch");
    const cad = H.k.importedEncounterCadence();
    return {
      light: H.t.hasDoc("light"),
      torch: { bright: fig.bright != null, dim: fig.dim != null, turns: fig.turns != null },
      lightCite: !!H.light.lightCite(),
      delve: H.t.hasDoc("delveEncounters"),
      cadence: Object.fromEntries(Object.entries(cad).map(([k, v]) => [k, v != null])),
      lightOverride: H.store.hasOverride("light", "lightSources"),
      delveOverride: ["die", "every", "target", "distance"].filter((k) => H.store.hasOverride("delveEncounters", k)),
      formation: H.t.hasDoc("formation"),
    };
  },

  /** Open a staged book for this session only, the import the Rules tables step reads from. */
  connectBook: async ({ id, path }) => {
    const CB = await import("/modules/acks-extras/scripts/importer/cookbook.mjs");
    if (CB.cookbookSessionDoc(id)) return { already: true };
    globalThis.__colBook = { done: false };
    acksExtras.importer.connectBookUrl(id, path, { remember: false, bridge: false })
      .then(() => { globalThis.__colBook = { done: true, ok: true }; })
      .catch((e) => { globalThis.__colBook = { done: true, ok: false, error: String(e?.message ?? e) }; });
    return { started: true };
  },
  bookState: async ({ id }) => {
    const CB = await import("/modules/acks-extras/scripts/importer/cookbook.mjs");
    return { ...(globalThis.__colBook ?? {}), open: !!CB.cookbookSessionDoc(id) };
  },
  /** The Rules tables import for the named documents, fired into a global; `importJob` reads its end. */
  importTables: async ({ only }) => {
    globalThis.__colImport = { done: false };
    acksExtras.importer.cookbookImportTables(only)
      .then((r) => { globalThis.__colImport = { done: true, ok: !!r }; })
      .catch((e) => { globalThis.__colImport = { done: true, ok: false, error: String(e?.message ?? e) }; });
    return { started: true };
  },
  importJob: async () => globalThis.__colImport ?? { done: false },

  settings: async ({ keys }) => Object.fromEntries(keys.map((k) => { try { return [k, game.settings.get("acks-extras", k)]; } catch { return [k, "(unregistered)"]; } })),
  setSetting: async ({ key, value }) => {
    await game.settings.set("acks-extras", key, value);
    await globalThis.__col.sleep(400);
    return game.settings.get("acks-extras", key);
  },

  view: async ({ sceneId }) => {
    const scene = game.scenes.get(sceneId);
    if (canvas.scene?.id !== sceneId) await scene.view();
    const stop = Date.now() + 25000;
    while (Date.now() < stop && !(canvas.ready && canvas.scene?.id === sceneId)) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 1500));
    return { scene: canvas.scene?.id === sceneId };
  },

  /** The corridor's walls, made where a kept scene lost them. */
  walls: async ({ sceneId, segments }) => {
    const scene = game.scenes.get(sceneId);
    const have = new Set(scene.walls.map((w) => w.c.join(",")));
    const missing = segments.filter((c) => !have.has(c.join(",")));
    if (missing.length) await scene.createEmbeddedDocuments("Wall", missing.map((c) => ({ c })));
    return { walls: scene.walls.size, made: missing.length };
  },

  formationOf: async ({ partyId }) => {
    const H = globalThis.__col;
    const found = await H.poll(() => Object.values(H.model.getFormations()).find((f) => f.actorId === partyId), { tries: 60, every: 200 });
    return found ? { fid: found.id } : { error: "no formation for the party actor" };
  },

  /** Seat the members through the party sheet's drop, in order; a member out of order is taken out and dropped again. */
  seat: async ({ partyId, fid, actorIds }) => {
    const H = globalThis.__col;
    const ids = () => H.model.getFormation(fid).members.filter((m) => m?.actorId).map((m) => m.actorId);
    const now = ids();
    const prefixOk = actorIds.every((id, i) => now[i] === id) && now.length === actorIds.length;
    if (!prefixOk) {
      for (const id of now) await H.model.removeMember(H.model.getFormation(fid), id);
      const sheet = game.actors.get(partyId).sheet;
      await sheet.render(true);
      await H.sleep(900);
      for (const id of actorIds) {
        const dt = new DataTransfer();
        dt.setData("text/plain", JSON.stringify({ type: "Actor", uuid: game.actors.get(id).uuid }));
        H.root(sheet).dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
        await H.poll(() => ids().includes(id), { tries: 40, every: 150 });
      }
    }
    return { members: ids(), reseated: !prefixOk };
  },

  /** The party's token on the scene, made from the party actor where none stands there, and adopted. */
  partyToken: async ({ fid, partyId, sceneId, x, y }) => {
    const H = globalThis.__col;
    const scene = game.scenes.get(sceneId);
    let f = H.model.getFormation(fid);
    let token = f.tokenId ? scene.tokens.get(f.tokenId) : null;
    let made = null;
    if (!token) {
      const doc = await game.actors.get(partyId).getTokenDocument({ x, y, rotation: 270 });
      [token] = await scene.createEmbeddedDocuments("Token", [{ ...doc.toObject(), actorLink: true, hidden: false }]);
      made = token.id;
      await H.poll(() => H.model.getFormation(fid).tokenId === token.id, { tries: 60, every: 200 });
    }
    // The party actor the module builds itself carries sight; one made from the
    // sidebar does not, and a Player in an unlit corridor would see nothing of it.
    const actor = game.actors.get(partyId);
    const sighted = { prototype: !!actor.prototypeToken.sight?.enabled, token: !!token.sight?.enabled };
    if (!sighted.prototype) await actor.update({ "prototypeToken.sight.enabled": true });
    if (!sighted.token) await token.update({ "sight.enabled": true });
    f = H.model.getFormation(fid);
    return { tokenId: f.tokenId, sceneId: f.sceneId, made, sighted };
  },

  /**
   * The column section's start shape: frontage 1, shape and tint unset, nobody
   * deployed, no fight, a fresh clock, both lights lit and open with a full
   * burn, the head at the corridor's west end facing east on a fresh trail.
   */
  columnStart: async ({ fid, torchId, lanternId, at }) => {
    const H = globalThis.__col;
    const turns = (type) => H.light.lightFigures(type).turns;
    await H.model.patchFormation(fid, (r) => {
      r.frontage = 1;
      r.tokenShape = null;
      r.columnColor = null;
      r.combat = null;
      const last = r.clock?.lastPosition;
      r.clock = { turnsTotal: 0, turnsSinceRest: 0, encounterCounter: 0, carryFeet: 0, winded: false, paused: false, ...(last ? { lastPosition: last } : {}) };
      for (const m of r.members) { delete m.deployedTokenId; delete m.deployedSceneId; delete m.deployedStack; }
      r.lights = (r.lights ?? []).filter((l) => (l.bearerId === torchId && l.type === "torch") || (l.bearerId === lanternId && l.type === "lantern"));
      for (const l of r.lights) { l.lit = true; l.shielded = false; l.remaining = turns(l.type); }
    });
    for (const [bearer, type] of [[torchId, "torch"], [lanternId, "lantern"]]) {
      if (!H.model.getFormation(fid).lights.some((l) => l.bearerId === bearer && l.type === type)) {
        await H.F.addLight(H.model.getFormation(fid), type, bearer, { override: true });
      }
    }
    const f = H.model.getFormation(fid);
    const token = H.model.getPartyToken(f);
    // A position written by update is a move core holds to the walls; the Token
    // Config's displace is the user's way to set a token down anywhere.
    await token.update({ hidden: false, width: 1, height: 1 }, { animate: false });
    await H.sleep(600);
    if (token.x !== at.x || token.y !== at.y) {
      await token.move({ x: at.x, y: at.y, action: "displace", snapped: false, explicit: true, checkpoint: true }, { method: "config", autoRotate: false, showRuler: false, constrainOptions: { ignoreWalls: true, ignoreCost: true } });
    }
    await H.sleep(900);
    await token.update({ rotation: 0 }, { animate: false });
    await H.sleep(700);
    await token.update({ rotation: 270 }, { animate: false });
    await H.sleep(1200);
    await H.model.patchFormation(fid, (r) => { r.clock.lastPosition = { x: token.x, y: token.y }; r.clock.carryFeet = 0; });
    const after = H.model.getFormation(fid);
    const trail = token.getFlag("acks-extras", "trail");
    return {
      frontage: after.frontage, tokenShape: after.tokenShape ?? null, columnColor: after.columnColor ?? null, combat: after.combat ?? null,
      deployed: after.members.some((m) => m.deployedTokenId), lights: after.lights.map((l) => ({ type: l.type, lit: l.lit, shielded: !!l.shielded })),
      at: { x: token.x, y: token.y, rotation: token.rotation, w: token.width, h: token.height }, trail: trail?.points?.length ?? 0,
    };
  },

  sync: async () => {
    await globalThis.__col.F.syncEnvironments?.();
    await globalThis.__col.sleep(1200);
    return true;
  },

  tokenState: async ({ tokenId, sceneId }) => {
    const t = game.scenes.get(sceneId).tokens.get(tokenId);
    if (!t) return { gone: true };
    return { x: t.x, y: t.y, w: t.width, h: t.height, rotation: t.rotation, hidden: t.hidden, size: t.getFlag("acks-extras", "partySize") ?? null, trail: t.getFlag("acks-extras", "trail") ?? null, light: { bright: t.light.bright, dim: t.light.dim } };
  },

  resize: async ({ tokenId, sceneId, w, h, waitFor }) => {
    const H = globalThis.__col;
    const t = game.scenes.get(sceneId).tokens.get(tokenId);
    await t.update({ width: w, height: h }, { animate: false });
    if (waitFor) await H.poll(() => t.width === waitFor && t.height === waitFor, { tries: 40, every: 200 });
    else await H.sleep(2500);
    return { w: t.width, h: t.height };
  },

  /** What this seat's canvas draws for the party token: its column's cells, their tint and visibility, and the column's light sources. */
  drawn: async ({ fid, bearers }) => {
    const H = globalThis.__col;
    const roots = canvas.controls.children.filter((c) => c.eventMode === "none" && c.children?.length && c.children.every((col) => col.children?.length && col.children.every((cell) => cell.children?.[0] instanceof PIXI.Graphics)));
    const columns = roots.flatMap((r) => r.children);
    const col = columns[0] ?? null;
    const cells = col ? col.children.map((cell) => ({ x: Math.round(cell.position.x), y: Math.round(cell.position.y), v: !!cell.visible, tint: cell.children[0]?.geometry?.graphicsData?.[0]?.fillStyle?.color ?? null })) : [];
    const lights = {};
    for (const [name, id] of Object.entries(bearers)) {
      const s = canvas.effects.lightSources.get(H.cl.columnLightId(fid, id));
      lights[name] = s ? { x: Math.round(s.data.x), y: Math.round(s.data.y), bright: s.data.bright, dim: s.data.dim } : null;
    }
    const prefix = `acks-extras.column.${fid}.`;
    const ours = [...canvas.effects.lightSources.keys()].filter((k) => String(k).startsWith(prefix)).length;
    return { columns: columns.length, shown: col ? !!col.visible : null, cells, lights, ours, dp: canvas.dimensions.distancePixels, units: canvas.scene.grid.units };
  },

  /** What this seat sees with: the party token's vision, the scene's vision sources, and whether the head's centre and each drawn cell's centre test visible. */
  seeProbe: async ({ tokenId, cells }) => {
    const t = canvas.tokens.get(tokenId);
    const gs = canvas.scene.grid.size;
    const test = (p) => canvas.visibility.testVisibility({ x: p.x + gs / 2, y: p.y + gs / 2 }, { tolerance: gs * 0.25 });
    return {
      sight: { enabled: !!t?.document.sight.enabled, range: t?.document.sight.range ?? null }, vision: !!t?.vision?.active, controlled: !!t?.controlled,
      visionSources: canvas.effects.visionSources.size, activeVision: canvas.effects.visionSources.filter((s) => s.active).length,
      tokenVision: canvas.visibility.tokenVision, head: t ? test(t.document) : null, cells: cells.map(test),
      detection: (t?.document.detectionModes ?? []).map((m) => ({ id: m.id, enabled: m.enabled, range: m.range })),
      visionMode: t?.document.sight.visionMode ?? null, managedVision: !!t?.document.getFlag("acks-extras", "managedVision"),
      level: { viewed: canvas.level?.id ?? null, token: t?.document.level ?? null },
      ours: [...canvas.effects.lightSources.values()].filter((s) => String(s.sourceId).startsWith("acks-extras.column.")).map((s) => ({ active: !!s.active, level: s.data.level ?? null, shape: !!s.shape, at: canvas.visibility.testVisibility({ x: s.data.x, y: s.data.y }, { tolerance: 1 }) })),
      lights: canvas.effects.lightSources.size,
    };
  },

  /**
   * The column at `frontage` from the head as it stands: the cells `columnFor`
   * lays, the cells a deploy would take, and the column's wall test held
   * against core's movement collision for every step between neighbouring
   * cells of `box` (cells) that stays on the scene, counted: core's scene
   * edges are the column's bounds, not its walls.
   */
  walled: async ({ fid, tokenId, frontage, box }) => {
    const H = globalThis.__col;
    const C = await import("/modules/acks-extras/scripts/formation/column.mjs");
    await H.model.patchFormation(fid, (r) => { r.frontage = frontage; });
    await H.sleep(900);
    const f = H.model.getFormation(fid);
    const token = canvas.tokens.get(tokenId);
    const doc = token.document;
    const gs = canvas.scene.grid.size;
    const laid = C.columnFor(f, doc)?.cells ?? [];
    const placed = (C.columnPlacement(f, doc) ?? []).flat();
    const blocked = C.wallTest(canvas.scene.walls, { level: doc.level, gs, near: { x: (box.x0 + box.x1) * gs / 2, y: (box.y0 + box.y1) * gs / 2 }, reach: (box.x1 - box.x0 + box.y1 - box.y0 + 4) * gs });
    const rect = canvas.dimensions.sceneRect;
    const onScene = (c) => c.x >= rect.x && c.y >= rect.y && c.x + gs <= rect.x + rect.width && c.y + gs <= rect.y + rect.height;
    let agree = 0;
    const differ = [];
    for (let cx = box.x0; cx <= box.x1; cx++) {
      for (let cy = box.y0; cy <= box.y1; cy++) {
        const from = { x: cx * gs, y: cy * gs };
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const to = { x: from.x + dx * gs, y: from.y + dy * gs };
          if (!onScene(from) || !onScene(to)) continue;
          const ours = !!blocked?.(from, to);
          const core = !!token.checkCollision({ x: to.x + gs / 2, y: to.y + gs / 2 }, { origin: { x: from.x + gs / 2, y: from.y + gs / 2 }, type: "move", mode: "any" });
          if (ours === core) agree += 1;
          else differ.push({ cx, cy, dx, dy, ours });
        }
      }
    }
    return { frontage: f.frontage, laid, placed, agree, differs: differ.length, differ: differ.slice(0, 8), walls: !!blocked };
  },

  /** `drawn`, read again until each named light's presence is as wanted or the time runs out; `waited` is the ms it took. */
  drawnUntil: async ({ fid, bearers, want, ms = 6000 }) => {
    const H = globalThis.__col;
    const t0 = Date.now();
    const read = () => Object.fromEntries(Object.entries(bearers).map(([n, id]) => [n, !!canvas.effects.lightSources.get(H.cl.columnLightId(fid, id))]));
    while (Date.now() - t0 < ms && !Object.entries(want).every(([n, v]) => read()[n] === v)) await H.sleep(150);
    return { ...read(), waited: Date.now() - t0 };
  },

  /** A sampler on this seat's page, every 120 ms, of the drawn cells, the lights and the head's document position. */
  sampleStart: async ({ fid, tokenId, bearers }) => {
    const H = globalThis.__col;
    H.samples = [];
    const prefix = (id) => H.cl.columnLightId(fid, id);
    const roots = () => canvas.controls.children.filter((c) => c.eventMode === "none" && c.children?.length && c.children.every((col) => col.children?.length && col.children.every((cell) => cell.children?.[0] instanceof PIXI.Graphics)));
    clearInterval(H.sampler);
    H.sampler = setInterval(() => {
      const col = roots().flatMap((r) => r.children)[0];
      // The placeable's position animates through a move; the document's jumps to the end.
      const obj = canvas.tokens.get(tokenId);
      const L = {};
      for (const [name, id] of Object.entries(bearers)) {
        const s = canvas.effects.lightSources.get(prefix(id));
        L[name] = s ? { x: Math.round(s.data.x), y: Math.round(s.data.y) } : null;
      }
      H.samples.push({ t: Date.now(), head: obj ? { x: Math.round(obj.x), y: Math.round(obj.y) } : { x: NaN, y: NaN }, cells: col ? col.children.map((c) => ({ x: Math.round(c.position.x), y: Math.round(c.position.y) })) : [], L });
    }, 120);
    return true;
  },
  /** What reached this seat during a drag: pointer events on the canvas, a drag's start, a move asked for, and the toasts it raised. */
  probeStart: async ({ tokenId, at }) => {
    const H = globalThis.__col;
    const name = (el) => (el ? `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${typeof el.className === "string" && el.className ? "." + el.className.split(/\s+/).slice(0, 2).join(".") : ""}` : null);
    const p = (H.probe = { down: 0, move: 0, up: 0, docDown: [], dragStart: 0, preMove: 0, paused: !!game.paused, controlled: !!canvas.tokens.get(tokenId)?.controlled, topAt: name(document.elementFromPoint(at.x, at.y)), notes: H.notes.length, focus: document.hasFocus(), hidden: document.hidden });
    const view = canvas.app.view;
    H.probeOff?.();
    const on = (t, k) => { const fn = () => { p[k] += 1; }; view.addEventListener(t, fn, true); return () => view.removeEventListener(t, fn, true); };
    const docFn = (e) => { if (p.docDown.length < 3) p.docDown.push(name(e.target)); };
    document.addEventListener("pointerdown", docFn, true);
    const offs = [on("pointerdown", "down"), on("pointermove", "move"), on("pointerup", "up"), () => document.removeEventListener("pointerdown", docFn, true)];
    const h1 = Hooks.on("preMoveToken", (doc) => { if (doc.id === tokenId) p.preMove += 1; });
    const token = canvas.tokens.get(tokenId);
    const orig = token?._onDragLeftStart;
    if (token && orig) token._onDragLeftStart = function (...a) { p.dragStart += 1; return orig.apply(this, a); };
    H.probeOff = () => { offs.forEach((f) => f()); Hooks.off("preMoveToken", h1); if (token && orig) delete token._onDragLeftStart; };
    return true;
  },
  probeStop: async () => {
    const H = globalThis.__col;
    H.probeOff?.();
    H.probeOff = null;
    const p = H.probe ?? {};
    return { ...p, notes: H.notes.slice(p.notes ?? 0).map((n) => n.slice(0, 90)) };
  },

  sampleStop: async () => {
    const H = globalThis.__col;
    clearInterval(H.sampler);
    return H.samples.splice(0);
  },

  /** Client coordinates of a scene point on this seat, after panning so the corridor is in view; the token selected with the select tool. */
  aim: async ({ tokenId, points }) => {
    const H = globalThis.__col;
    try { ui.controls.activate({ control: "tokens", tool: "select" }); } catch (_e) { /* active */ }
    await canvas.animatePan({ x: 400, y: 400, scale: 0.8, duration: 0 });
    await H.sleep(400);
    const token = canvas.tokens.get(tokenId);
    token?.control({ releaseOthers: true });
    canvas.app.render();
    const rect = canvas.app.view.getBoundingClientRect();
    const out = points.map((p) => {
      const g = canvas.stage.toGlobal(new PIXI.Point(p.x, p.y));
      return { x: Math.round(rect.left + g.x), y: Math.round(rect.top + g.y) };
    });
    return { points: out, controlled: !!token?.controlled, tool: game.activeTool, owner: !!token?.isOwner, at: token ? { x: token.document.x, y: token.document.y } : null };
  },

  trailWrites: async ({ since }) => globalThis.__col.trailWrites.filter((w) => w.at >= since),
  nowMs: async () => Date.now(),

  formationState: async ({ fid }) => {
    const f = globalThis.__col.model.getFormation(fid);
    return { clock: f.clock, tokenShape: f.tokenShape ?? null, columnColor: f.columnColor ?? null, combat: f.combat ?? null, members: f.members.map((m) => ({ id: m.actorId, dep: m.deployedTokenId ?? null })), lights: f.lights.map((l) => ({ id: l.id, type: l.type, bearer: l.bearerId, lit: l.lit, shielded: !!l.shielded, remaining: l.remaining })) };
  },

  openSheet: async ({ actorId, tab }) => {
    const H = globalThis.__col;
    const app = game.actors.get(actorId).sheet;
    await app.render(true);
    await H.sleep(1000);
    if (tab) H.root(app)?.querySelector(`[data-action="tab"][data-tab="${tab}"]`)?.click();
    await H.sleep(400);
    return { rendered: !!H.root(app), id: app.id, cls: app.constructor.name };
  },
  closeSheet: async ({ actorId }) => {
    try { await game.actors.get(actorId).sheet.close({ animate: false }); } catch (_e) { /* closed */ }
    return true;
  },

  /** A press on a light's control on the open party sheet's Kit tab. */
  kitPress: async ({ partyId, lightId, action }) => {
    const H = globalThis.__col;
    const el = H.root(game.actors.get(partyId).sheet);
    const button = el?.querySelector(`.light[data-light-id="${lightId}"] [data-action="${action}"]`);
    if (!button) return { found: false };
    button.click();
    await H.sleep(1500);
    return { found: true };
  },

  /** The Kit tab's light rows and add-light options, read off the rendered sheet. */
  kitRead: async ({ partyId }) => {
    const H = globalThis.__col;
    const app = game.actors.get(partyId).sheet;
    await app.render(true);
    await H.sleep(900);
    const el = H.root(app);
    return {
      rows: [...(el?.querySelectorAll(".lights .light[data-light-id]") ?? [])].map((row) => ({ id: row.dataset.lightId, text: row.querySelector(".remaining")?.textContent?.trim() ?? "", tip: row.querySelector(".remaining")?.dataset.tooltipText ?? "" })),
      options: [...(el?.querySelectorAll('select[data-pick="lightType"] option') ?? [])].map((o) => ({ key: o.value, text: o.textContent.trim() })),
    };
  },

  /** A field on the open party sheet's Order tab, set as a user sets it, which submits the form. */
  orderField: async ({ partyId, name, value }) => {
    const H = globalThis.__col;
    const app = game.actors.get(partyId).sheet;
    let el = H.root(app);
    el?.querySelector('[data-action="tab"][data-tab="order"]')?.click();
    await H.sleep(400);
    el = H.root(app);
    const field = el?.querySelector(`[name="${name}"]`);
    if (!field) return { found: false };
    field.value = value;
    field.dispatchEvent(new Event("change", { bubbles: true }));
    await H.sleep(1800);
    return { found: true };
  },

  /** Rotate the token as a hand does, rotation only. */
  rotate: async ({ tokenId, sceneId, rotation }) => {
    const t = game.scenes.get(sceneId).tokens.get(tokenId);
    await t.update({ rotation }, { animate: false });
    await globalThis.__col.sleep(1500);
    return true;
  },

  stepToken: async ({ tokenId, sceneId, dx, dy }) => {
    const H = globalThis.__col;
    const t = game.scenes.get(sceneId).tokens.get(tokenId);
    await t.move({ x: t.x + dx, y: t.y + dy });
    await H.sleep(2500);
    return { x: t.x, y: t.y, w: t.width, h: t.height };
  },

  /** The column's lights as the record and the stored trail compute them, with nothing drawn. */
  computedLights: async ({ fid, tokenId, sceneId }) => {
    const H = globalThis.__col;
    const f = H.model.getFormation(fid);
    const doc = game.scenes.get(sceneId).tokens.get(tokenId);
    const at = H.column.columnFor(f, doc);
    return at ? H.cll.columnLights(f, at.cells, Number(doc.parent.grid.size)).map((p) => ({ bearer: p.bearerId, x: p.x, y: p.y })) : null;
  },

  /** A copy of the party token pasted on its scene, `api.track`ed by the caller from the id returned. */
  pasteCopy: async ({ tokenId, sceneId, dx }) => {
    const scene = game.scenes.get(sceneId);
    const t = scene.tokens.get(tokenId);
    const [copy] = await scene.createEmbeddedDocuments("Token", [{ ...t.toObject(), _id: undefined, x: t.x + dx }]);
    await globalThis.__col.sleep(1800);
    return { id: copy?.id ?? null, uuid: copy?.uuid ?? null, light: copy ? { bright: copy.light.bright, dim: copy.light.dim } : null };
  },

  /** The party token's combat: a combat of this run's on the scene, the token added by the HUD's toggle when it is the viewed combat, else as a combatant. */
  deploy: async ({ tokenId, sceneId }) => {
    const H = globalThis.__col;
    const combat = await Combat.create({ scene: sceneId, active: true });
    await H.sleep(800);
    let via = "createCombatant";
    const placeable = canvas.tokens.get(tokenId);
    if (game.combat?.id === combat.id && placeable) {
      placeable.control({ releaseOthers: true });
      await canvas.hud.token.bind(placeable);
      await H.sleep(300);
      const toggle = document.querySelector('#token-hud [data-action="combat"]');
      if (toggle) { toggle.click(); via = "hud"; }
      try { await canvas.hud.token.close(); } catch (_e) { /* closed */ }
    }
    if (via !== "hud") await combat.createEmbeddedDocuments("Combatant", [{ tokenId, sceneId, actorId: canvas.scene.tokens.get(tokenId).actorId }]);
    await H.sleep(3500);
    return { combatId: combat.id, combatUuid: combat.uuid, via };
  },

  deployed: async ({ fid, sceneId, combatId }) => {
    const H = globalThis.__col;
    const f = H.model.getFormation(fid);
    const scene = game.scenes.get(sceneId);
    const combat = game.combats.get(combatId);
    return {
      active: !!f.combat?.active,
      partyHidden: !!H.model.getPartyToken(f)?.hidden,
      members: f.members.map((m) => {
        const t = m.deployedTokenId ? scene.tokens.get(m.deployedTokenId) : null;
        return { id: m.actorId, token: t ? { id: t.id, actor: t.actorId, x: t.x, y: t.y, bright: t.light.bright, dim: t.light.dim, managed: t.getFlag("acks-extras", "managedLight") ?? null, stamp: t.getFlag("acks-extras", "managedLightStamp") ?? null } : null };
      }),
      combatants: combat ? combat.combatants.map((c) => c.tokenId) : null,
    };
  },

  /** A deployed token's light as the canvas draws it, with core's padding term. */
  tokenLight: async ({ tokenId }) => {
    const t = canvas.tokens.get(tokenId);
    if (!t) return null;
    return { dim: t.document.light.dim, bright: t.document.light.bright, dataDim: t.light?.data?.dim ?? null, dataBright: t.light?.data?.bright ?? null, external: t.externalRadius, dp: canvas.dimensions.distancePixels, managed: t.document.getFlag("acks-extras", "managedLight") ?? null, stamp: t.document.getFlag("acks-extras", "managedLightStamp") ?? null };
  },

  /**
   * Step 13's start shape on one token: a light the last walk's step 14 released
   * to the hand is taken back on this token alone, as the world-wide reclaim
   * would; `found` is what the token carried first. The caller then writes the
   * light again through the Kit tab.
   */
  lightSetup: async ({ tokenId }) => {
    const H = globalThis.__col;
    const t = canvas.tokens.get(tokenId);
    if (!t) return null;
    const found = { managed: t.document.getFlag("acks-extras", "managedLight") ?? null, released: !!t.document.getFlag("acks-extras", "managedLightStamp")?.released };
    if (found.released) await t.document.update({ "flags.acks-extras.-=managedLightStamp": null, "flags.acks-extras.-=managedLight": null });
    return { found };
  },

  editLight: async ({ tokenId, dim }) => {
    const t = canvas.tokens.get(tokenId);
    await t.document.update({ "light.dim": dim });
    await globalThis.__col.sleep(900);
    return { dim: t.document.light.dim, dataDim: t.light?.data?.dim ?? null, external: t.externalRadius };
  },

  /** A token of an actor with no party, lit by hand, `api.track`ed by the caller. */
  handLit: async ({ actorId, sceneId, x, y, dim }) => {
    const H = globalThis.__col;
    const doc = await game.actors.get(actorId).getTokenDocument({ x, y });
    const [t] = await game.scenes.get(sceneId).createEmbeddedDocuments("Token", [{ ...doc.toObject(), light: { ...doc.toObject().light, dim, bright: 0 } }]);
    await H.sleep(1500);
    const p = canvas.tokens.get(t.id);
    return { id: t.id, uuid: t.uuid, dim: t.light.dim, dataDim: p?.light?.data?.dim ?? null, external: p?.externalRadius ?? null, dp: canvas.dimensions.distancePixels, managed: t.getFlag("acks-extras", "managedLight") ?? null };
  },

  endCombat: async ({ combatId }) => {
    const H = globalThis.__col;
    const c = game.combats.get(combatId);
    if (c) await c.delete();
    await H.sleep(3500);
    return { gone: !game.combats.get(combatId) };
  },

  /** The popout chat log, placed on screen, with the card scrolled into view; returns the clip selector (the driver's chat-card recipe). */
  chatPopout: async ({ messageId }) => {
    const H = globalThis.__col;
    await ui.hotbar.render(true);
    const pop = await ui.chat.renderPopout();
    await H.sleep(1500);
    pop.setPosition({ left: 16, top: 16, width: 420, height: 860 });
    await H.sleep(600);
    // The whole card, flavour and dice; the header's whisper line names the world's users and is hidden, with the timestamp.
    const sel = `#${pop.id} li.chat-message[data-message-id="${messageId}"]`;
    for (const n of document.querySelectorAll(`${sel} .whisper-to, ${sel} .message-metadata`)) n.style.setProperty("display", "none");
    document.querySelector(sel)?.scrollIntoView({ block: "nearest" });
    await H.sleep(600);
    return { sel, found: !!document.querySelector(sel) };
  },

  /** Where the deploy will stand each member: the stored trail, and `columnPlacement`'s cells (null when it falls back to the block). */
  placementProbe: async ({ fid }) => {
    const H = globalThis.__col;
    const f = H.model.getFormation(fid);
    const t = H.model.getPartyToken(f);
    const place = H.column.columnPlacement(f, t);
    return { trail: (t.getFlag("acks-extras", "trail")?.points ?? []).map((p) => `${p.x},${p.y}`), placement: place ? place.map((cs) => cs.map((c) => `${c.x},${c.y}`)) : null, rotation: t.rotation };
  },

  /** One redraw of the token on this seat, as any move or refresh gives it. */
  redraw: async ({ tokenId }) => {
    canvas.tokens.get(tokenId)?.renderFlags.set({ refresh: true });
    await globalThis.__col.sleep(600);
    return true;
  },
  release: async () => {
    canvas.tokens.releaseAll();
    await globalThis.__col.sleep(400);
    return true;
  },

  hide: async ({ tokenId, sceneId, hidden }) => {
    await game.scenes.get(sceneId).tokens.get(tokenId).update({ hidden });
    await globalThis.__col.sleep(1500);
    return true;
  },

  dispositionColor: async ({ tokenId }) => canvas.tokens.get(tokenId)?.getDispositionColor?.() ?? null,

  /** The light table's override in force, read for a later restore; the caller never prints it. */
  overrideGet: async ({ docId, tableId }) => {
    const H = globalThis.__col;
    const layer = H.t.getLayer(docId, H.t.PRIORITY.OVERRIDE);
    return H.store.hasOverride(docId, tableId) ? { data: foundry.utils.deepClone(layer?.tables?.[tableId]) } : { data: null };
  },
  overrideSet: async ({ docId, tableId, data }) => {
    const H = globalThis.__col;
    if (data == null) await H.store.clearOverride(docId, tableId);
    else await H.store.setOverride(docId, tableId, data, { sourceName: "manual edit" });
    await H.sleep(800);
    return { has: H.store.hasOverride(docId, tableId) };
  },

  /** The torch's reach raised over the table in force by an invented step, as a Judge's override of the whole table. */
  lightOverride: async ({ step }) => {
    const H = globalThis.__col;
    if (!H.t.hasDoc("light")) return { raised: false, absent: true };
    const table = foundry.utils.deepClone(H.t.getDoc("light")?.tables?.lightSources ?? {});
    const before = H.light.lightFigures("torch");
    table.torch = { ...(table.torch ?? {}), bright: Number(before.bright) + step, dim: Number(before.dim) + step };
    await H.store.setOverride("light", "lightSources", table, { sourceName: "manual edit" });
    await H.poll(() => H.light.lightFigures("torch").bright === Number(before.bright) + step, { tries: 30, every: 200 });
    const after = H.light.lightFigures("torch");
    return { raised: after.bright === Number(before.bright) + step && after.dim === Number(before.dim) + step };
  },

  /** The bright radius the column's torch should carry, from the table in force, the scene's units and its scale. */
  expectedBright: async ({ type }) => {
    const H = globalThis.__col;
    const fig = H.light.lightFigures(type);
    return { px: fig.bright == null ? null : H.units.feetToUnits(fig.bright, canvas.scene.grid.units) * canvas.dimensions.distancePixels, dimPx: fig.dim == null ? null : H.units.feetToUnits(fig.dim, canvas.scene.grid.units) * canvas.dimensions.distancePixels, turns: fig.turns, cite: H.light.lightCite() };
  },

  /** Unregister the light document's world layer on this client alone: nothing persists. */
  dropLight: async () => {
    const H = globalThis.__col;
    H.t.unregisterTable("light", { priority: H.t.PRIORITY.WORLD });
    H.t.unregisterTable("light", { priority: H.t.PRIORITY.OVERRIDE });
    await H.sleep(300);
    const fig = H.light.lightFigures("torch");
    return { gone: !H.t.hasDoc("light"), nulls: fig.bright == null && fig.dim == null && fig.turns == null };
  },
  /** Mirror the world's store back into this client's registry. */
  reloadLight: async () => {
    const H = globalThis.__col;
    await acksExtras.lib.services.get("ruledata-import").reload();
    await H.sleep(500);
    return { back: H.t.hasDoc("light") };
  },

  /** The character sheet's rail and the party sheet's Kit tab, searched for the not-imported wording. */
  notImported: async ({ bearerId, partyId }) => {
    const H = globalThis.__col;
    const kitText = game.i18n.localize("ACKS-FORMATION.app.lightNotImported");
    const railText = game.i18n.format("ACKS-CHARACTER.rail.light.notImported", { light: game.i18n.localize("ACKS-LIB.light.torch") });
    const party = game.actors.get(partyId).sheet;
    await party.render(true);
    await H.sleep(900);
    H.root(party)?.querySelector('[data-action="tab"][data-tab="kit"]')?.click();
    await H.sleep(400);
    const kit = H.root(party)?.innerHTML ?? "";
    const sheet = game.actors.get(bearerId).sheet;
    await sheet.render(true);
    await H.sleep(1200);
    const html = H.root(sheet)?.innerHTML ?? "";
    const enc = (s) => foundry.utils.escapeHTML(s);
    await sheet.close({ animate: false });
    return { kit: kit.includes(kitText), rail: html.includes(railText) || html.includes(enc(railText)), sheet: sheet.constructor.name };
  },

  /** Advance the party's clock through the sheet's turn tool, `n` presses. */
  turnTool: async ({ partyId, n, action = "advanceTurn" }) => {
    const H = globalThis.__col;
    const app = game.actors.get(partyId).sheet;
    let pressed = 0;
    const stamps = [];
    for (let i = 0; i < n; i++) {
      if (!app.rendered) { await app.render(true); await H.sleep(900); }
      const button = H.root(app)?.querySelector(`[data-action="${action}"]`);
      if (!button) break;
      stamps.push(Date.now());
      button.click();
      pressed += 1;
      await H.sleep(1400);
    }
    return { pressed, stamps };
  },

  advance: async ({ fid, n, resting = false }) => {
    const H = globalThis.__col;
    await H.F.advanceTurns(H.model.getFormation(fid), n, { resting });
    await H.sleep(900);
    return H.model.getFormation(fid).clock;
  },

  /** A party's record brought to a new delve's shape for the rest and cadence sections. */
  delveStart: async ({ fid, light }) => {
    const H = globalThis.__col;
    await H.model.patchFormation(fid, (r) => {
      delete r.travel;
      r.clock = { turnsTotal: 0, turnsSinceRest: 0, encounterCounter: 0, carryFeet: 0, winded: false, paused: false };
      r.combat = null;
      r.tableId = null;
      r.spells = [];
      if (!light) r.lights = [];
    });
    return H.model.getFormation(fid).clock;
  },

  restReads: async ({ fid, memberId, partyId }) => {
    const H = globalThis.__col;
    const f = H.model.getFormation(fid);
    const actor = game.actors.get(memberId);
    const winded = actor.effects.some((e) => e.getFlag?.("acks-extras", "winded") || e.flags?.["acks-extras"]?.winded);
    const app = game.actors.get(partyId).sheet;
    await app.render(true);
    await H.sleep(900);
    const el = H.root(app);
    const restLabel = game.i18n.localize("ACKS-FORMATION.app.rest");
    const badge = game.i18n.localize("ACKS-FORMATION.app.windedBadge");
    const stats = [...(el?.querySelectorAll(".stat") ?? [])];
    const rest = stats.find((s) => s.querySelector(".stat-label")?.textContent.trim() === restLabel);
    return { clock: f.clock, effect: winded, restStat: !!rest, badge: rest?.querySelector(".sub")?.textContent.trim() === badge, interval: H.t.getDoc("formation")?.tables?.restInterval ?? null };
  },

  /** The run's own cards since `since` that speak as or name one of `names`. */
  cards: async ({ since, names }) => (globalThis.__col.cards ?? []).filter((c) => c.at >= since && names.some((n) => (c.alias ?? "") === n || c.text.includes(n))),

  /** Prefixes of the turn card's rest and winded lines, for presence tests. */
  restLines: async () => {
    const cut = (k) => game.i18n.localize(k).split("{")[0];
    return { rest: cut("ACKS-FORMATION.chat.restStatus"), winded: game.i18n.localize("ACKS-FORMATION.chat.windedStatus"), became: game.i18n.localize("ACKS-FORMATION.chat.becameWinded"), recovered: game.i18n.localize("ACKS-FORMATION.chat.restedRecovered"), rested: cut("ACKS-FORMATION.chat.turnRested") };
  },

  cadenceTips: async () => {
    const H = globalThis.__col;
    const cite = (k) => H.t.citeOf("delveEncounters", k);
    const imported = (k) => (cite(k) ? game.i18n.format("ACKS-FORMATION.chat.cadenceFrom.import", { cite: cite(k) }) : game.i18n.localize("ACKS-FORMATION.chat.cadenceFrom.override"));
    const cad = H.k.importedEncounterCadence();
    const flat = (v) => (v == null ? null : String(v).replace(/\s+/g, ""));
    return { die: flat(cad.die), every: cad.every, distance: flat(cad.distance), tips: { die: imported("die"), target: imported("target"), distance: imported("distance") }, setting: game.i18n.localize("ACKS-FORMATION.chat.cadenceFrom.setting"), noDistance: game.i18n.localize("ACKS-FORMATION.chat.encounterDetailNoDistance").split("{")[0].slice(0, 40), notImportedWarn: game.i18n.localize("ACKS-FORMATION.warn.encounterNotImported") };
  },

  /** A Judge's light for a bearer with no fuel, and the stack the world or its compendiums hold most of. */
  supply: async ({ fid, bearerId }) => {
    const H = globalThis.__col;
    const actor = game.actors.get(bearerId);
    const pattern = H.light.LIGHT_SOURCES.torch.consumes;
    const before = new Set(actor.items.map((i) => i.id));
    const qty = (e) => { const n = Number(e?.system?.quantity?.value); return Number.isFinite(n) && n > 0 ? n : 1; };
    const world = [...game.items].filter((i) => pattern.test(i.name ?? ""));
    let largest = world.length ? Math.max(...world.map(qty)) : null;
    let from = world.length ? "world" : null;
    if (largest == null) {
      for (const pack of game.packs) {
        if (pack.documentName !== "Item") continue;
        const index = await pack.getIndex({ fields: ["system.quantity.value"] });
        for (const e of index) if (pattern.test(e.name ?? "")) { largest = Math.max(largest ?? 0, qty(e)); from = "compendium"; }
      }
    }
    await H.F.addLight(H.model.getFormation(fid), "torch", bearerId, { override: true });
    await H.sleep(1500);
    const added = actor.items.filter((i) => !before.has(i.id));
    const torch = actor.items.find((i) => pattern.test(i.name ?? ""));
    const light = H.model.getFormation(fid).lights.find((l) => l.bearerId === bearerId && l.type === "torch");
    return { largest, from, added: added.map((i) => i.uuid), held: torch ? qty(torch) : 0, lit: !!light?.lit, lightId: light?.id ?? null };
  },
  /** The supply check's start: no light in the record for the bearer, and how many torches they already hold (the items are not this step's to delete). */
  supplyStart: async ({ fid, bearerId }) => {
    const H = globalThis.__col;
    const actor = game.actors.get(bearerId);
    const torches = actor.items.filter((i) => H.light.LIGHT_SOURCES.torch.consumes.test(i.name ?? ""));
    await H.model.patchFormation(fid, (r) => { r.lights = (r.lights ?? []).filter((l) => l.bearerId !== bearerId); });
    return { torches: torches.length };
  },

  boot: async () => globalThis.__colBoot ?? null,
  takeNotes: async () => globalThis.__col.notes.splice(0),

  /** A transparent box over the column on the canvas, for the plate's clip, removed by `unclip`. */
  clipBox: async ({ x, y, w, h }) => {
    document.getElementById("qa-column-clip")?.remove();
    const rect = canvas.app.view.getBoundingClientRect();
    const a = canvas.stage.toGlobal(new PIXI.Point(x, y));
    const b = canvas.stage.toGlobal(new PIXI.Point(x + w, y + h));
    const div = document.createElement("div");
    div.id = "qa-column-clip";
    Object.assign(div.style, { position: "fixed", left: `${rect.left + a.x}px`, top: `${rect.top + a.y}px`, width: `${b.x - a.x}px`, height: `${b.y - a.y}px`, pointerEvents: "none", zIndex: 1 });
    document.body.append(div);
    return true;
  },
  unclip: async () => { document.getElementById("qa-column-clip")?.remove(); return true; },

  /** Pan to the corridor for a plate without controlling anything: a controlled token pans on its next move. */
  frame: async () => {
    await canvas.animatePan({ x: 400, y: 400, scale: 0.8, duration: 0 });
    await globalThis.__col.sleep(400);
    canvas.app.render();
    return true;
  },

  /** The sidebar `compose` closed, rendered again: core's token pan reads its width. The hotbar goes first, since the chat log's render reaches into it. */
  sidebarBack: async () => {
    try { await ui.hotbar.render({ force: true }); } catch (_e) { /* left closed */ }
    try { await ui.sidebar.render({ force: true }); } catch (_e) { /* left closed */ }
    return !!document.getElementById("sidebar");
  },
  /** How many errors this seat's boot recorder holds, with the sidebar's presence and what the seat controls. */
  errs: async () => ({ errors: globalThis.__colBoot?.errors?.length ?? null, sidebar: !!document.getElementById("sidebar"), controlled: canvas.tokens.controlled.map((t) => t.id) }),
};

const run = (api, fn, arg) => api.eval(`(${fn.toString()})(${JSON.stringify(arg ?? null)})`);

const ready = async (api, label) => {
  for (let n = 0; n < 240; n++) {
    const ok = await api.eval(`!!(globalThis.game?.ready && globalThis.acksExtras?.formation)`).catch(() => false);
    if (ok) return n / 2;
    await sleep(500);
  }
  throw new Error(`${label} never reached ready`);
};

/** The recorder has to be in the page before the page loads, so it goes in over the seat's own CDP target. */
async function record(port, label, api) {
  const targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
  const page = targets.find((t) => t.type === "page" && t.url.startsWith(origin));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve) => { ws.onopen = resolve; });
  let next = 0;
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++next + 500000;
    const on = (event) => {
      const reply = JSON.parse(event.data);
      if (reply.id === id) { ws.removeEventListener("message", on); resolve(reply.result); }
    };
    ws.addEventListener("message", on);
    ws.send(JSON.stringify({ id, method, params }));
  });
  await send("Page.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: RECORDER });
  await send("Page.reload");
  await sleep(1500);
  const seconds = await ready(api, label);
  ws.close();
  return seconds;
}

/**
 * A second DevTools client on a seat's browser, attached to its game page, for
 * a real pointer drag. Prints no address.
 */
async function rawInput(port) {
  const { webSocketDebuggerUrl } = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json());
  const ws = await new Promise((resolve, reject) => {
    const w = new WebSocket(webSocketDebuggerUrl);
    w.addEventListener("open", () => resolve(w));
    w.addEventListener("error", () => reject(new Error("raw input: socket error")));
  });
  const cdp = new Cdp(ws);
  const isGame = (u) => { try { return new URL(u).pathname.endsWith("/game"); } catch { return false; } };
  const { targetInfos } = await cdp.send("Target.getTargets");
  const pages = targetInfos.filter((t) => t.type === "page" && isGame(t.url));
  if (pages.length !== 1) { try { ws.close(); } catch { /* closed */ } throw new Error(`raw input: ${pages.length} game pages on this seat`); }
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: pages[0].targetId, flatten: true });
  const send = (method, params = {}) => cdp.send(method, params, sessionId);
  await send("Page.bringToFront");
  try { await send("Emulation.setFocusEmulationEnabled", { enabled: true }); } catch { /* not offered */ }
  const mouse = (type, x, y, extra = {}) => send("Input.dispatchMouseEvent", { type, x, y, ...extra });
  return {
    async click(at) {
      await mouse("mouseMoved", at.x, at.y, { button: "none", buttons: 0 });
      await mouse("mousePressed", at.x, at.y, { button: "left", buttons: 1, clickCount: 1 });
      await mouse("mouseReleased", at.x, at.y, { button: "left", buttons: 0, clickCount: 1 });
    },
    /** Press, a 12 px first step, then 10 px every 20 ms, and release at the end (TESTING, Core drive mechanics). */
    async drag(from, to) {
      await mouse("mouseMoved", from.x, from.y, { button: "none", buttons: 0 });
      await sleep(80);
      await mouse("mousePressed", from.x, from.y, { button: "left", buttons: 1, clickCount: 1 });
      const dist = Math.hypot(to.x - from.x, to.y - from.y);
      const ux = (to.x - from.x) / dist;
      const uy = (to.y - from.y) / dist;
      for (let d = 12; d < dist; d += 10) {
        await mouse("mouseMoved", from.x + ux * d, from.y + uy * d, { button: "left", buttons: 1 });
        await sleep(20);
      }
      await mouse("mouseMoved", to.x, to.y, { button: "left", buttons: 1 });
      await sleep(60);
      await mouse("mouseReleased", to.x, to.y, { button: "left", buttons: 0, clickCount: 1 });
    },
    close() { try { ws.close(); } catch { /* closed */ } },
  };
}

const open = {};
const tracked = [];
const restore = { settings: null, overrides: [], lightDropped: false, paused: false };

const character = (name, items = [], ownership = undefined) => ({
  name, type: "character", prototypeToken: { actorLink: true }, system: { hp: { value: 8, max: 8 } }, items, ...(ownership ? { ownership } : {}),
});
const gear = (name, qty) => ({ name, type: "item", system: { quantity: { value: qty, max: 0 } } });
const centre = (c) => ({ x: c.x + GS / 2, y: c.y + GS / 2 });
const key = (c) => `${c.x},${c.y}`;
/** Two cell lists, cell for cell. */
const same = (a, b) => a.length === b.length && a.every((c, i) => c.x === b[i].x && c.y === b[i].y);

try {
  section("seats");
  open.gm = await connect({ browser, origin, user: SEATS.gm, port: PORTS.gm, own: MACHINE.own });
  open.player = await connect({ browser, origin, user: SEATS.player, port: PORTS.player, own: MACHINE.own });
  const { gm, player } = open;
  note("GM ready after (s)", await record(PORTS.gm, "gm", gm));
  note("player ready after (s)", await record(PORTS.player, "player", player));
  note("installed", [await run(gm, P.install, { nonce: NONCE }), await run(player, P.install, { nonce: NONCE })]);
  const census = { gm: await run(gm, P.census), player: await run(player, P.census) };
  note("active", census.gm.active);
  check("the GM seat is the active GM and leads the automation, and the player seat is a player", census.gm.activeGMIsSelf && census.gm.lead !== false && census.player.role <= 2, { gm: census.gm.role, lead: census.gm.lead, player: census.player.role });
  if (!census.gm.activeGMIsSelf) throw new Error("another client is the active GM; the automation would run there");
  for (const [k, c] of Object.entries(census)) {
    check(`${k} seat: no error from load through ready`, c.boot?.phases.length === 3 && !c.boot.errors.length, c.boot?.errors);
  }
  let tables = await run(gm, P.tables);
  const tablesAtLoad = tables;
  note("tables (booleans)", tables);
  // The figures this walk compares come from the Judge's import. Where the world
  // holds none, the walk runs Rules tables for the three documents from the
  // staged books, as a Judge would; the import stays, like any corpus fixture.
  const wanted = [["light", tables.light], ["delveEncounters", tables.delve], ["formation", tables.formation]].filter(([, has]) => !has).map(([id]) => id);
  if (wanted.length) {
    section("rules tables");
    const staged = books(["rr", "jj"]);
    note("staged books", staged.map((b) => b.id));
    for (const book of staged) {
      note(`connect ${book.id}`, await run(gm, P.connectBook, book));
      let state = await run(gm, P.bookState, { id: book.id });
      for (let n = 0; n < 90 && !state.open && !state.done; n++) { await sleep(2000); state = await run(gm, P.bookState, { id: book.id }); }
      note(`book ${book.id}`, { open: state.open, error: state.error ?? null });
    }
    if (staged.length === 2) {
      await run(gm, P.importTables, { only: wanted });
      let job = await run(gm, P.importJob);
      for (let n = 0; n < 150 && !job.done; n++) { await sleep(2000); job = await run(gm, P.importJob); }
      note("rules tables import", { only: wanted, done: job.done, ok: job.ok ?? null, error: job.error ?? null });
      tables = await run(gm, P.tables);
      note("tables after the import (booleans)", tables);
    }
  }
  const SETTINGS = ["partyTokenShape", "encounterEvery", "encounterTarget", "restRequired", "advanceWorldTime"];
  restore.settings = await run(gm, P.settings, { keys: SETTINGS });
  note("settings as found", restore.settings);
  if (restore.settings.advanceWorldTime === true) await run(gm, P.setSetting, { key: "advanceWorldTime", value: false });

  section("fixtures");
  const mine = { default: 0, [census.player.userId]: 3 };
  const scene = await gm.fixture("formation/column-scene", "Scene", {
    name: "QA Column Corridor", active: false, navigation: false, width: 1200, height: 800, padding: 0, backgroundColor: "#6f6f6f",
    grid: { type: 1, size: GS, distance: 5, units: "ft" }, tokenVision: true, environment: { globalLight: { enabled: false } }, ownership: { default: 2 },
  });
  const party = await gm.fixture("formation/column-party", "Actor", { name: "QA Column Party", type: `${SCOPE}.party` });
  const lead = await gm.fixture("formation/column-lead", "Actor", character("QA Column Lead", [], mine));
  const torch = await gm.fixture("formation/column-torch", "Actor", character("QA Column Torch", [gear("Torch", 6)], mine));
  const lantern = await gm.fixture("formation/column-lantern", "Actor", character("QA Column Lantern", [gear("Lantern", 1), gear("Oil, flask", 4)], mine));
  const watcher = await gm.fixture("formation/column-watcher", "Actor", character("QA Column Watcher"));
  check("the GM seat views the corridor", (await run(gm, P.view, { sceneId: scene.id })).scene);
  note("walls", await run(gm, P.walls, { sceneId: scene.id, segments: WALLS }));
  const { fid, error } = await run(gm, P.formationOf, { partyId: party.id });
  if (error) throw new Error(error);
  const seated = await run(gm, P.seat, { partyId: party.id, fid, actorIds: [lead.id, torch.id, lantern.id] });
  check("the column party holds lead, torch and lantern, in that order", JSON.stringify(seated.members) === JSON.stringify([lead.id, torch.id, lantern.id]), seated);
  const pt = await run(gm, P.partyToken, { fid, partyId: party.id, sceneId: scene.id, x: START.x, y: START.y });
  if (pt.made) await gm.mark(`Scene.${scene.id}.Token.${pt.made}`, "formation/column-party-token");
  check("the party token stands on the corridor, linked to the record", pt.tokenId && pt.sceneId === scene.id, pt);
  const tokenId = pt.tokenId;
  const bearers = { torch: torch.id, lantern: lantern.id };

  section("the column and its lights");
  const start = await run(gm, P.columnStart, { fid, torchId: torch.id, lanternId: lantern.id, at: START });
  note("start", start);
  check("start shape: frontage 1, shape and tint unset, nobody deployed, both lights lit and open, the head at the west end facing east", start.frontage === 1 && !start.tokenShape && !start.columnColor && !start.deployed && start.lights.length === 2 && start.lights.every((l) => l.lit && !l.shielded) && start.at.x === START.x && start.at.y === START.y && start.at.rotation === 270, start);
  if (restore.settings.partyTokenShape !== "order") await run(gm, P.setSetting, { key: "partyTokenShape", value: "order" });

  // Step 1.
  await run(gm, P.sync);
  let ts = await run(gm, P.tokenState, { tokenId, sceneId: scene.id });
  check("1: the party token is 1x1 and stamped 1x1", ts.w === 1 && ts.h === 1 && ts.size?.width === 1 && ts.size?.height === 1, { w: ts.w, h: ts.h, size: ts.size });
  const r1 = await run(gm, P.resize, { tokenId, sceneId: scene.id, w: 2, h: 2, waitFor: 1 });
  check("1: a hand resize to 2x2 returns to 1x1 a moment later", r1.w === 1 && r1.h === 1, r1);
  // The return to 1x1 holds the 2x2's centre, half a cell off the grid; step 2 starts from the corridor's west cell again.
  const after1 = await run(gm, P.tokenState, { tokenId, sceneId: scene.id });
  note("1: where the 1x1 return left the head", { x: after1.x, y: after1.y, onGrid: after1.x % GS === 0 && after1.y % GS === 0 });
  const restart = await run(gm, P.columnStart, { fid, torchId: torch.id, lanternId: lantern.id, at: START });
  check("1: the head is put back at the corridor's west cell for step 2", restart.at.x === START.x && restart.at.y === START.y && restart.at.w === 1, restart.at);

  // Step 2: the Player seat drags the head east to the corner, then south to the corridor's end.
  check("the Player seat views the corridor", (await run(player, P.view, { sceneId: scene.id })).scene);
  // Core refuses a Player's move while the game is paused; the pause is put back as found.
  restore.paused = await gm.eval(`game.paused`);
  if (restore.paused) await gm.eval(`(async () => { game.togglePause(false, { broadcast: true }); await new Promise((r) => setTimeout(r, 1000)); return game.paused; })()`);
  note("2: the game was paused, and is unpaused for the drags", { was: restore.paused, playerSees: await player.eval(`game.paused`) });
  const input = await rawInput(PORTS.player);
  const samples = [];
  const writesSeen = [];
  try {
    for (const [from, to] of [[START, CORNER], [CORNER, SOUTH]]) {
      // A window left open on the seat (its User Config, at a first login) lies over the canvas and takes the press.
      await player.compose();
      const aim = await run(player, P.aim, { tokenId, points: [centre(from), centre(to)] });
      if (!aim.owner) { check("2: the Player seat owns the party token", false, aim); break; }
      if (aim.at?.x !== from.x || aim.at?.y !== from.y) { check("2: the head stands where the drag starts", false, { at: aim.at, from }); break; }
      await input.click(aim.points[0]);
      await sleep(2500);
      const since = await run(gm, P.nowMs);
      await run(player, P.sampleStart, { fid, tokenId, bearers });
      await run(player, P.probeStart, { tokenId, at: aim.points[0] });
      await input.drag(aim.points[0], aim.points[1]);
      await sleep(4500);
      note("2: what the drag reached", await run(player, P.probeStop));
      samples.push(...(await run(player, P.sampleStop)));
      writesSeen.push(await run(gm, P.trailWrites, { since }));
    }
  } finally {
    input.close();
    if (restore.paused) { note("2: game paused again", await gm.eval(`(async () => { game.togglePause(true, { broadcast: true }); await new Promise((r) => setTimeout(r, 800)); return game.paused; })()`)); restore.paused = false; }
  }
  ts = await run(gm, P.tokenState, { tokenId, sceneId: scene.id });
  note("after the drags", { x: ts.x, y: ts.y, trail: ts.trail?.points?.length });
  check("2: the drags carried the head to the corridor's south end", ts.x === SOUTH.x && ts.y === SOUTH.y, { x: ts.x, y: ts.y });
  const moving = samples.filter((s) => s.cells.length === 3);
  const offCorridor = moving.filter((s) => s.cells.slice(1).some((c) => !CORRIDOR.has(key(c))));
  const lightsOff = moving.filter((s) => ["torch", "lantern"].some((n, i) => !s.L[n] || s.L[n].x !== s.cells[i + 1].x + GS / 2 || s.L[n].y !== s.cells[i + 1].y + GS / 2));
  const bent = moving.some((s) => s.cells[0].x === CORNER.x && s.cells[0].y > CORNER.y && s.cells.slice(1).some((c) => c.y === CORNER.y && c.x < CORNER.x));
  const between = (v) => v % GS !== 0;
  const mid = moving.filter((s) => (s.head.y === START.y && s.head.x > START.x && s.head.x < CORNER.x && between(s.head.x)) || (s.head.x === CORNER.x && s.head.y > CORNER.y && s.head.y < SOUTH.y && between(s.head.y)));
  note("samples", { all: samples.length, drawn: moving.length, mid: mid.length });
  check("2: mid-move samples were taken while the head was between cells", mid.length >= 2, mid.length);
  check("2: every drawn rank stands on a corridor cell the head walked, never through the wall", moving.length > 0 && !offCorridor.length, offCorridor.slice(0, 2));
  check("2: the column bends around the corner while the head walks south", bent);
  check("2: each light shines from the centre of its bearer's drawn cell, at every sample", moving.length > 0 && !lightsOff.length, lightsOff.slice(0, 2));
  const pts = ts.trail?.points ?? [];
  const bound = await gm.eval(`(async () => { const c = await import("/modules/acks-extras/scripts/formation/column.mjs"); return c.trailBound(acksExtras.formation.getFormations()[${JSON.stringify(fid)}]); })()`);
  note("trail bound (cells)", bound);
  check("2: the token's trail holds the column's bound of cells, newest first, from the head back up the corridor", pts.length === bound && pts[0].x === SOUTH.x && pts[0].y === SOUTH.y && pts.every((p, i) => p.x === SOUTH.x && p.y === SOUTH.y - i * GS), pts);
  check("2: each step's trail was written once, as a flag-only write that moved nothing", writesSeen.length === 2 && writesSeen.every((w) => w.filter((x) => x.id === tokenId).length === 1 && w.every((x) => !x.moved && !x.sized)), writesSeen);
  const before3 = await run(player, P.drawn, { fid, bearers });

  // Step 3.
  note("player reloaded after (s)", await record(PORTS.player, "player", player));
  await run(player, P.install, { nonce: NONCE });
  await run(player, P.view, { sceneId: scene.id });
  await sleep(1500);
  const after3 = await run(player, P.drawn, { fid, bearers });
  check("3: after a reload the Player seat draws the same cells and lights (the trail is stored)", JSON.stringify(after3.cells.map(key)) === JSON.stringify(before3.cells.map(key)) && JSON.stringify(after3.lights) === JSON.stringify(before3.lights) && after3.cells.length === 3, { before: before3.cells.map(key), after: after3.cells.map(key) });

  // Step 4.
  await run(gm, P.openSheet, { actorId: party.id, tab: "kit" });
  let fs = await run(gm, P.formationState, { fid });
  const torchLight = fs.lights.find((l) => l.type === "torch");
  const lanternLight = fs.lights.find((l) => l.type === "lantern");
  await run(gm, P.kitPress, { partyId: party.id, lightId: lanternLight.id, action: "toggleShield" });
  // The Player seat hears the record's write a moment after the GM's: each read waits for it, and the wait is noted.
  const both = async (want) => ({ g: await run(gm, P.drawnUntil, { fid, bearers, want }), p: await run(player, P.drawnUntil, { fid, bearers, want }) });
  const holds = (seat, want) => Object.entries(want).every(([n, v]) => seat[n] === v);
  let w4 = { torch: true, lantern: false };
  let s4 = await both(w4);
  note("4 shutter: waited (ms)", { gm: s4.g.waited, player: s4.p.waited });
  check("4: the shuttered lantern's source is gone on both seats; the torch's stands", holds(s4.g, w4) && holds(s4.p, w4), s4);
  await run(gm, P.kitPress, { partyId: party.id, lightId: torchLight.id, action: "toggleLight" });
  w4 = { torch: false, lantern: false };
  s4 = await both(w4);
  note("4 douse: waited (ms)", { gm: s4.g.waited, player: s4.p.waited });
  check("4: the doused torch's source is gone on both seats", holds(s4.g, w4) && holds(s4.p, w4), s4);
  await run(gm, P.kitPress, { partyId: party.id, lightId: torchLight.id, action: "toggleLight" });
  await run(gm, P.kitPress, { partyId: party.id, lightId: lanternLight.id, action: "toggleShield" });
  w4 = { torch: true, lantern: true };
  s4 = await both(w4);
  note("4 relight: waited (ms)", { gm: s4.g.waited, player: s4.p.waited });
  check("4: relit and opened, both sources return on both seats", holds(s4.g, w4) && holds(s4.p, w4), s4);

  // Step 5, and the light figures section's first half.
  section("light figures, imported");
  const exp = await run(gm, P.expectedBright, { type: "torch" });
  check("the light table is imported: the torch's reach and burn time read from it, with a page", tables.light && tables.torch.bright && tables.torch.turns && tables.lightCite, tables.torch);
  let g5 = await run(gm, P.drawn, { fid, bearers });
  check("5: the torch source's bright radius is the imported figure in the scene's units times distancePixels, unpadded", exp.px != null && g5.lights.torch?.bright === exp.px && g5.lights.torch?.dim === exp.dimPx, { equal: g5.lights.torch?.bright === exp.px });
  await gm.eval(`canvas.perception.update({ initializeLighting: true })`);
  await sleep(1200);
  g5 = await run(gm, P.drawn, { fid, bearers });
  check("5: the sources survive a perception re-initialisation", !!g5.lights.torch && !!g5.lights.lantern, g5.ours);
  const kit = await run(gm, P.kitRead, { partyId: party.id });
  const torchRow = kit.rows.find((r) => r.id === torchLight.id);
  check("the Kit tab counts the torch's burn from the table, and its tooltip names the page", !!torchRow && !!exp.turns && torchRow.tip.includes(String(exp.turns)) && !!exp.cite && torchRow.tip.includes(exp.cite), { row: !!torchRow, hasCite: !!exp.cite });
  restore.overrides.push({ docId: "light", tableId: "lightSources", data: (await run(gm, P.overrideGet, { docId: "light", tableId: "lightSources" })).data });
  const ov = await run(gm, P.lightOverride, { step: 7 });
  await sleep(1500);
  const expOv = await run(gm, P.expectedBright, { type: "torch" });
  const gOv0 = await run(gm, P.drawn, { fid, bearers });
  note("override: the drawn torch follows before any redraw of the token", gOv0.lights.torch?.bright === expOv.px);
  await run(gm, P.redraw, { tokenId });
  const gOv = await run(gm, P.drawn, { fid, bearers });
  check("a Ruledata Browser override of the light table takes effect on the column's torch", ov.raised && gOv.lights.torch?.bright === expOv.px && expOv.px !== exp.px, { raised: ov.raised, follows: gOv.lights.torch?.bright === expOv.px });
  const kitOv = await run(gm, P.kitRead, { partyId: party.id });
  const judgeTable = await gm.eval(`game.i18n.localize("ACKS-FORMATION.app.lightJudgeTable")`);
  check("with the override in force the burn tooltip names the Judge's table, not a page", (kitOv.rows.find((r) => r.id === torchLight.id)?.tip ?? "").includes(judgeTable));
  const prior = restore.overrides.pop();
  await run(gm, P.overrideSet, prior);
  await run(gm, P.redraw, { tokenId });
  const gBack = await run(gm, P.drawn, { fid, bearers });
  check("the override cleared, the torch's reach is the import's again", gBack.lights.torch?.bright === exp.px);
  restore.lightDropped = true;
  const dropped = await run(gm, P.dropLight);
  check("with the light document unregistered on the GM seat alone, its figures read null", dropped.gone && dropped.nulls, dropped);
  const ni = await run(gm, P.notImported, { bearerId: torch.id, partyId: party.id });
  check("the party sheet's Kit tab says the burn time is not imported", ni.kit, ni);
  check("the bearer's character sheet says the torch's reach is not imported", ni.rail, ni);
  await run(gm, P.sync);
  await run(gm, P.redraw, { tokenId });
  const gNone = await run(gm, P.drawn, { fid, bearers });
  check("with no reach imported the column sheds nothing", !gNone.lights.torch && !gNone.lights.lantern, gNone.lights);
  const back = await run(gm, P.reloadLight);
  restore.lightDropped = !back.back;
  check("the light document is mirrored back from the world's store", back.back);
  await run(gm, P.sync);

  section("the column and its lights, continued");
  // Step 6.
  fs = await run(gm, P.formationState, { fid });
  const clock6 = JSON.stringify(fs.clock);
  const pre6 = await run(gm, P.tokenState, { tokenId, sceneId: scene.id });
  // A turn to the heading the head already has writes nothing; the walk turns it a quarter.
  await run(gm, P.rotate, { tokenId, sceneId: scene.id, rotation: pre6.rotation === 90 ? 270 : 90 });
  const post6 = await run(gm, P.tokenState, { tokenId, sceneId: scene.id });
  const g6 = await run(gm, P.drawn, { fid, bearers });
  fs = await run(gm, P.formationState, { fid });
  // At the corridor's end the way straight back may run into a wall: the column
  // turns there, so the drawing is held to the column laid with no trail.
  const laid6 = await run(gm, P.walled, { fid, tokenId, frontage: 1, box: { x0: 0, y0: 0, x1: -1, y1: -1 } });
  const behind = g6.cells.length === 3 && same(g6.cells, laid6.laid) && g6.cells[0].x === post6.x && g6.cells[0].y === post6.y && g6.cells.every((c) => CORRIDOR.has(key(c))) && new Set(g6.cells.map(key)).size === 3;
  check("6: a hand turn resets the trail to the head and lays the column behind the new facing, inside the corridor", post6.trail?.points?.length === 1 && post6.trail.points[0].x === post6.x && post6.trail.points[0].y === post6.y && behind, { trail: post6.trail?.points, cells: g6.cells.map(key), laid: laid6.laid.map(key) });
  check("6: the turn writes no size or position and leaves the clock alone", pre6.x === post6.x && pre6.y === post6.y && post6.w === 1 && post6.h === 1 && JSON.stringify(fs.clock) === clock6, { moved: pre6.x !== post6.x || pre6.y !== post6.y, clock: JSON.stringify(fs.clock) === clock6 });
  await run(gm, P.rotate, { tokenId, sceneId: scene.id, rotation: 180 });
  // Walk back north to the corner along the vertical arm, so the deploy has a walked trail.
  await run(gm, P.stepToken, { tokenId, sceneId: scene.id, dx: 0, dy: -2 * GS });

  // Step 7.
  const before7 = await run(gm, P.drawn, { fid, bearers });
  note("7: what the deploy reads", await run(gm, P.placementProbe, { fid }));
  const combats = await gm.eval(`game.combats.size`);
  note("combats in the world before the deploy", combats);
  const dep = await run(gm, P.deploy, { tokenId, sceneId: scene.id });
  tracked.push(gm.track(dep.combatUuid, "Combat"));
  note("deploy via", dep.via);
  const d7 = await run(gm, P.deployed, { fid, sceneId: scene.id, combatId: dep.combatId });
  const order = [lead.id, torch.id, lantern.id];
  const stands = order.map((id, i) => {
    const m = d7.members.find((x) => x.id === id);
    return !!m?.token && m.token.x === before7.cells[i]?.x && m.token.y === before7.cells[i]?.y;
  });
  check("7: the party deploys, each member's token on the cell their glyph stood on", d7.active && d7.partyHidden && stands.every(Boolean), { active: d7.active, hidden: d7.partyHidden, stands, glyphs: before7.cells.map(key), tokens: order.map((id) => { const t = d7.members.find((x) => x.id === id)?.token; return t ? key(t) : null; }) });
  const own = order.map((id) => d7.members.find((x) => x.id === id)?.token?.actor === id);
  check("7: each member's deployed token is their own actor's", own.every(Boolean), { own });
  const torchTok = d7.members.find((m) => m.id === torch.id)?.token;
  const lanternTok = d7.members.find((m) => m.id === lantern.id)?.token;
  const g7 = await run(gm, P.drawn, { fid, bearers });
  check("7: each bearer's own token carries their light, and the column's sources for them are gone", torchTok?.bright > 0 && lanternTok?.dim > 0 && !g7.lights.torch && !g7.lights.lantern, { torch: torchTok?.bright > 0, lantern: lanternTok?.dim > 0, sources: g7.lights });

  // Step 13, on the deployed lantern bearer.
  // The deploy stands the member in the token they had before, so it carries what the last walk's step 14 left.
  const ls13 = await run(gm, P.lightSetup, { tokenId: lanternTok?.id });
  note("13: the lantern bearer's token at the step's start", ls13);
  if (ls13 && (ls13.found.released || !ls13.found.managed)) {
    await run(gm, P.openSheet, { actorId: party.id, tab: "kit" });
    await run(gm, P.kitPress, { partyId: party.id, lightId: lanternLight.id, action: "toggleShield" });
    await run(gm, P.kitPress, { partyId: party.id, lightId: lanternLight.id, action: "toggleShield" });
    note("13: after a shutter and unshutter", await run(gm, P.tokenLight, { tokenId: lanternTok?.id }).then((t) => t && { managed: t.managed }));
  }
  const tl = await run(gm, P.tokenLight, { tokenId: lanternTok?.id });
  check("13: a managed token's light is unpadded: data.dim is light.dim x distancePixels exactly", !!tl && tl.managed === true && Math.abs(tl.dataDim - tl.dim * tl.dp) < 0.01, tl && { managed: tl.managed, unpadded: Math.abs(tl.dataDim - tl.dim * tl.dp) < 0.01 });
  const hand = await run(gm, P.handLit, { actorId: watcher.id, sceneId: scene.id, x: 1000, y: 600, dim: 2 });
  if (hand.uuid) tracked.push(gm.track(hand.uuid, "Token"));
  check("13: a light set by hand on an unmanaged token carries core's padding", !hand.managed && Math.abs(hand.dataDim - (2 * hand.dp + hand.external)) < 0.01, { padded: Math.abs(hand.dataDim - (2 * hand.dp + hand.external)) < 0.01 });

  // Step 14.
  check("14: the managed light is stamped with its stored bright and dim", !!tl?.stamp && tl.stamp.bright === tl.bright && tl.stamp.dim === tl.dim, tl?.stamp && { matches: tl.stamp.dim === tl.dim });
  const edited = await run(gm, P.editLight, { tokenId: lanternTok?.id, dim: (tl?.dim ?? 0) + 3 });
  check("14: a hand edit is drawn padded at once", Math.abs(edited.dataDim - (edited.dim * tl.dp + edited.external)) < 0.01, { padded: Math.abs(edited.dataDim - (edited.dim * tl.dp + edited.external)) < 0.01 });
  fs = await run(gm, P.formationState, { fid });
  const lanternNow = fs.lights.find((l) => l.type === "lantern");
  await run(gm, P.kitPress, { partyId: party.id, lightId: lanternNow.id, action: "toggleShield" });
  await run(gm, P.kitPress, { partyId: party.id, lightId: lanternNow.id, action: "toggleShield" });
  const rel = await run(gm, P.tokenLight, { tokenId: lanternTok?.id });
  check("14: after the next sync the light is released to the hand and stands as set", rel?.stamp?.released === true && rel.managed === false && rel.dim === edited.dim, rel && { released: rel.stamp?.released, managed: rel.managed, kept: rel.dim === edited.dim });

  const end = await run(gm, P.endCombat, { combatId: dep.combatId });
  const g7b = await run(gm, P.deployed, { fid, sceneId: scene.id, combatId: dep.combatId });
  check("7: ending the fight gathers the party: the party token shows and nobody stands deployed", end.gone && !g7b.partyHidden && g7b.members.every((m) => !m.token), { gone: end.gone, hidden: g7b.partyHidden });

  // Step 8.
  await run(gm, P.openSheet, { actorId: party.id, tab: "order" });
  const sf = await run(gm, P.orderField, { partyId: party.id, name: "tokenShape", value: "fixed" });
  let g8 = await run(gm, P.drawn, { fid, bearers });
  ts = await run(gm, P.tokenState, { tokenId, sceneId: scene.id });
  check("8: on Fixed size nothing is drawn and the token stays 1x1", sf.found && g8.columns === 0 && ts.w === 1 && ts.h === 1, { found: sf.found, columns: g8.columns, w: ts.w });
  await run(gm, P.resize, { tokenId, sceneId: scene.id, w: 2, h: 2 });
  const st8 = await run(gm, P.stepToken, { tokenId, sceneId: scene.id, dx: 0, dy: GS });
  check("8: a hand 2x2 stays 2x2 across a step", st8.w === 2 && st8.h === 2, st8);
  g8 = await run(gm, P.drawn, { fid, bearers });
  const comp8 = await run(gm, P.computedLights, { fid, tokenId, sceneId: scene.id });
  const at8 = (id) => comp8?.find((p) => p.bearer === id);
  check("8: both lights still shine from the bearers' computed cells, undrawn", g8.columns === 0 && !!at8(torch.id) && g8.lights.torch?.x === at8(torch.id).x && g8.lights.torch?.y === at8(torch.id).y && g8.lights.lantern?.x === at8(lantern.id)?.x && g8.lights.lantern?.y === at8(lantern.id)?.y, { columns: g8.columns, lights: g8.lights, computed: comp8 });
  await run(gm, P.orderField, { partyId: party.id, name: "tokenShape", value: "order" });
  const r8 = await run(gm, P.resize, { tokenId, sceneId: scene.id, w: 2, h: 2, waitFor: 1 });
  check("8: back on Marching order the token returns to 1x1", r8.w === 1 && r8.h === 1, r8);

  // Step 9: the pasted copy.
  const pre9 = await run(gm, P.drawn, { fid, bearers });
  const copy = await run(gm, P.pasteCopy, { tokenId, sceneId: scene.id, dx: 4 * GS });
  if (copy.uuid) tracked.push(gm.track(copy.uuid, "Token"));
  const post9 = await run(gm, P.drawn, { fid, bearers });
  check("9: a pasted copy draws no column and carries no light", !!copy.id && post9.columns === pre9.columns && post9.ours === pre9.ours && !(copy.light?.bright > 0) && !(copy.light?.dim > 0), { columns: [pre9.columns, post9.columns], sources: [pre9.ours, post9.ours], light: copy.light });
  if (copy.uuid) {
    note("copy swept", await gm.sweepTracked({ only: [copy.uuid] }));
    tracked.splice(tracked.indexOf(copy.uuid), 1);
  }

  // Step 11: the fill.
  const disp = await run(gm, P.dispositionColor, { tokenId });
  let g11 = await run(gm, P.drawn, { fid, bearers });
  check("11: every drawn body carries a square in the token's disposition colour", g11.cells.length === 3 && g11.cells.every((c) => c.tint === disp), { tints: g11.cells.map((c) => c.tint), disp });
  await run(gm, P.orderField, { partyId: party.id, name: "columnColor", value: "#33aa55" });
  g11 = await run(gm, P.drawn, { fid, bearers });
  check("11: a Column tint repaints the squares", g11.cells.every((c) => c.tint === 0x33aa55), g11.cells.map((c) => c.tint));
  await run(gm, P.orderField, { partyId: party.id, name: "columnColor", value: "" });
  g11 = await run(gm, P.drawn, { fid, bearers });
  check("11: clearing the tint returns the disposition colour", g11.cells.every((c) => c.tint === disp), g11.cells.map((c) => c.tint));
  if (SHOTS) {
    try {
      await player.compose();
      await run(player, P.aim, { tokenId, points: [] });
      await sleep(800);
      const t = await run(gm, P.tokenState, { tokenId, sceneId: scene.id });
      await run(player, P.clipBox, { x: 50, y: 50, w: 700, h: 700 });
      await sleep(600);
      const shot = await player.shot(path.join(shotDir(), "formation-column.png"), "#qa-column-clip");
      note("plate formation-column", { bytes: shot.bytes, head: { x: t.x, y: t.y } });
    } catch (err) { console.log(`plate formation-column not taken: ${err?.message ?? err}`); }
    finally {
      await run(player, P.unclip);
      note("the Player seat after the column plate", await run(player, P.errs));
      note("the Player seat's sidebar is back after the column plate", await run(player, P.sidebarBack));
    }
  }
  const p11 = await run(player, P.drawn, { fid, bearers });
  check("11: the Player seat sees the column and its fill", p11.shown === true && p11.cells.length === 3 && p11.cells.some((c) => c.v), { shown: p11.shown, visible: p11.cells.map((c) => c.v) });
  if (!p11.cells.some((c) => c.v)) note("11: what the Player seat sees with", await run(player, P.seeProbe, { tokenId, cells: p11.cells }));
  // Core shows a controlled token to its controller even while hidden; the Player lets go first.
  await run(player, P.release);
  await run(gm, P.hide, { tokenId, sceneId: scene.id, hidden: true });
  const pHid = await run(player, P.drawn, { fid, bearers });
  const gHid = await run(gm, P.drawn, { fid, bearers });
  check("11: hiding the party token hides the whole column from the Player, and the GM still sees it", (pHid.shown === false || pHid.columns === 0) && gHid.shown === true, { player: pHid.shown, gm: gHid.shown });
  await run(gm, P.hide, { tokenId, sceneId: scene.id, hidden: false });

  // Step 12, on one party: an explicit choice against the world default.
  await run(gm, P.orderField, { partyId: party.id, name: "tokenShape", value: "order" });
  await run(gm, P.setSetting, { key: "partyTokenShape", value: "fixed" });
  const g12a = await run(gm, P.drawn, { fid, bearers });
  await run(gm, P.orderField, { partyId: party.id, name: "tokenShape", value: "" });
  const g12b = await run(gm, P.drawn, { fid, bearers });
  check("12: a party with its own choice keeps it when the world default changes; an unset one follows it", g12a.columns === 1 && g12b.columns === 0, { chosen: g12a.columns, unset: g12b.columns });
  await run(gm, P.setSetting, { key: "partyTokenShape", value: restore.settings.partyTokenShape });
  // Shot here, past every token HUD press: compose closes core's HUD container with the windows.
  if (SHOTS) {
    try {
      const sheet = await run(gm, P.openSheet, { actorId: party.id, tab: "kit" });
      await gm.compose(`#${sheet.id}`);
      await sleep(600);
      const shot = await gm.shot(path.join(shotDir(), "formation-lights.png"), `#${sheet.id}`);
      note("plate formation-lights", { bytes: shot.bytes });
    } catch (err) { console.log(`plate formation-lights not taken: ${err?.message ?? err}`); }
  }

  /* ---------------- the column against its walls ---------------- */
  section("the column against its walls");
  note("the Player seat before step 15", await run(player, P.errs));
  const w0 = await run(gm, P.columnStart, { fid, torchId: torch.id, lanternId: lantern.id, at: START });
  note("the Player seat after step 15's start", await run(player, P.errs));
  check("15: start shape: frontage 1, the head at the west end facing east, its trail reset by the turn", w0.frontage === 1 && w0.at.x === START.x && w0.at.y === START.y && w0.at.rotation === 270 && w0.trail <= 1, w0.at);
  await run(gm, P.orderField, { partyId: party.id, name: "tokenShape", value: "order" });
  // Facing east the right hand is south; the corridor is two rows tall, so a third file meets a wall on either hand.
  const w15 = await run(gm, P.walled, { fid, tokenId, frontage: 3, box: { x0: 0, y0: 0, x1: 7, y1: 7 } });
  const want15 = [START, { x: START.x, y: START.y + GS }, { x: START.x - GS, y: START.y }];
  check("15: three abreast in a corridor two wide stand two abreast and one behind, all inside its walls", same(w15.laid, want15) && w15.laid.every((c) => CORRIDOR.has(key(c))), w15.laid);
  await sleep(600);
  const g15 = await run(gm, P.drawn, { fid, bearers });
  check("15: the drawn column stands where the column is laid", same(g15.cells, want15), g15.cells.map(({ x, y }) => ({ x, y })));
  check("15: a deploy from where the party stands, with no step walked, takes the same cells and not the straight block", same(w15.placed, want15), w15.placed);
  check("16: the column's wall test agrees with core's movement collision on every step between neighbouring cells around the corridor", w15.walls && w15.differs === 0 && w15.agree >= 200, { agree: w15.agree, differs: w15.differs, sample: w15.differ });
  if (SHOTS) {
    try {
      await player.compose();
      await run(player, P.frame);
      await sleep(800);
      await run(player, P.clipBox, { x: 50, y: 50, w: 700, h: 700 });
      await sleep(600);
      const shot = await player.shot(path.join(shotDir(), "formation-column-walls.png"), "#qa-column-clip");
      note("plate formation-column-walls", { bytes: shot.bytes });
    } catch (err) { console.log(`plate formation-column-walls not taken: ${err?.message ?? err}`); }
    finally {
      await run(player, P.unclip);
      note("the Player seat after the walls plate", await run(player, P.errs));
      note("the Player seat's sidebar is back after the walls plate", await run(player, P.sidebarBack));
    }
  }
  note("the Player seat after step 16", await run(player, P.errs));
  const w15r = await run(gm, P.walled, { fid, tokenId, frontage: 1, box: { x0: 0, y0: 0, x1: 0, y1: 0 } });
  await run(gm, P.orderField, { partyId: party.id, name: "tokenShape", value: "" });
  check("15: the frontage is put back to 1", w15r.frontage === 1, w15r.frontage);

  /* ---------------- the delve's wandering cadence ---------------- */
  section("the delve's wandering cadence");
  const cParty = await gm.fixture("formation/cadence-party", "Actor", { name: "QA Cadence Party", type: `${SCOPE}.party` });
  const cMember = await gm.fixture("formation/cadence-member", "Actor", character("QA Cadence Member"));
  const cRec = await run(gm, P.formationOf, { partyId: cParty.id });
  await run(gm, P.seat, { partyId: cParty.id, fid: cRec.fid, actorIds: [cMember.id] });
  await run(gm, P.delveStart, { fid: cRec.fid, light: false });
  await run(gm, P.setSetting, { key: "encounterEvery", value: null });
  await run(gm, P.setSetting, { key: "encounterTarget", value: null });
  const gmBoot = await run(gm, P.boot);
  const warnText = await gm.eval(`game.i18n.localize("ACKS-FORMATION.tablesMissing").split("{")[0]`);
  const warned = (gmBoot?.warns ?? []).some((w) => w.startsWith(warnText));
  check("1: at the GM seat's load, the missing-tables warning matches the registry (none with both documents present)", tablesAtLoad.light && tablesAtLoad.delve ? !warned : warned, { light: tablesAtLoad.light, delve: tablesAtLoad.delve, warned });
  const cad = await run(gm, P.cadenceTips);
  check("the cadence is imported: die, interval, target and distance", tables.delve && Object.values(tables.cadence).every(Boolean), tables.cadence);
  const cnames = ["QA Cadence Party"];
  let since = await run(gm, P.nowMs);
  await run(gm, P.openSheet, { actorId: cParty.id, tab: "mode" });
  const pressed = await run(gm, P.turnTool, { partyId: cParty.id, n: cad.every ?? 0 });
  let cards = await run(gm, P.cards, { since, names: cnames });
  for (const c of cards) tracked.push(gm.track(c.id, "ChatMessage"));
  // What each card is, as booleans only: a card's formulas carry imported dice.
  const rolled = (c, dice) => !!dice && (c.formulas[0] ?? "").startsWith(dice);
  const shape = (cs) => cs.map((c) => ({ throw: c.isThrow, met: c.isMet, rolls: c.formulas.length, die: rolled(c, cad.die) }));
  note("2: cards", shape(cards));
  const throws = cards.filter((c) => c.isThrow && rolled(c, cad.die) && c.tips.length >= 2);
  check("2: over the imported interval, the turn tool throws exactly once, on the last turn, with the imported die", pressed.pressed === cad.every && throws.length === 1 && throws[0].at >= pressed.stamps.at(-1), { pressed: pressed.pressed === cad.every, throws: throws.length });
  check("2: the throw's die and target tooltips say Imported, with the page", !!throws[0] && throws[0].tips.includes(cad.tips.die) && throws[0].tips.includes(cad.tips.target));
  if (SHOTS && throws[0]) {
    try {
      await gm.compose();
      const pop = await run(gm, P.chatPopout, { messageId: throws[0].id });
      const shot = await gm.shot(path.join(shotDir(), "formation-encounter-throw.png"), pop.sel);
      note("plate formation-encounter-throw", { bytes: shot.bytes });
    } catch (err) { console.log(`plate formation-encounter-throw not taken: ${err?.message ?? err}`); }
  }
  await run(gm, P.setSetting, { key: "encounterTarget", value: 1 });
  since = await run(gm, P.nowMs);
  await run(gm, P.openSheet, { actorId: cParty.id, tab: "mode" });
  await run(gm, P.turnTool, { partyId: cParty.id, n: 1, action: "encounterNow" });
  cards = await run(gm, P.cards, { since, names: cnames });
  for (const c of cards) tracked.push(gm.track(c.id, "ChatMessage"));
  note("3: cards", shape(cards));
  const dist = cards.find((c) => c.isMet && c.formulas.includes(cad.distance) && c.formulas.length === 2);
  check("3: with the target set to 1, the encounter throw tool meets an encounter whose distance rolls the imported dice", !!dist, cards.map((c) => c.formulas.length));
  check("3: the distance's tooltip says Imported, with the page", !!dist && dist.tips.includes(cad.tips.distance));
  await run(gm, P.setSetting, { key: "encounterTarget", value: null });
  await run(gm, P.setSetting, { key: "encounterEvery", value: 1 });
  await run(gm, P.delveStart, { fid: cRec.fid, light: false });
  since = await run(gm, P.nowMs);
  await run(gm, P.advance, { fid: cRec.fid, n: 1 });
  cards = await run(gm, P.cards, { since, names: cnames });
  for (const c of cards) tracked.push(gm.track(c.id, "ChatMessage"));
  note("4: cards", shape(cards));
  check("4: an interval set to 1 in the settings throws on the first turn", cards.some((c) => c.isThrow && rolled(c, cad.die)), cards.length);
  await run(gm, P.setSetting, { key: "encounterEvery", value: 0 });
  since = await run(gm, P.nowMs);
  await run(gm, P.advance, { fid: cRec.fid, n: (cad.every ?? 1) + 1 });
  cards = await run(gm, P.cards, { since, names: cnames });
  for (const c of cards) tracked.push(gm.track(c.id, "ChatMessage"));
  const st4 = await run(gm, P.formationState, { fid: cRec.fid });
  check("4: an interval of 0 throws nothing past the imported interval, and the counter stays at 0", !cards.some((c) => c.isThrow) && st4.clock.encounterCounter === 0, { throws: cards.filter((c) => c.isThrow).length, counter: st4.clock.encounterCounter });
  await run(gm, P.setSetting, { key: "encounterEvery", value: null });
  restore.overrides.push({ docId: "delveEncounters", tableId: "distance", data: (await run(gm, P.overrideGet, { docId: "delveEncounters", tableId: "distance" })).data });
  await run(gm, P.overrideSet, { docId: "delveEncounters", tableId: "distance", data: "no dice here" });
  await run(gm, P.setSetting, { key: "encounterTarget", value: 1 });
  since = await run(gm, P.nowMs);
  await run(gm, P.turnTool, { partyId: cParty.id, n: 1, action: "encounterNow" });
  cards = await run(gm, P.cards, { since, names: cnames });
  for (const c of cards) tracked.push(gm.track(c.id, "ChatMessage"));
  note("5: cards", shape(cards));
  const noDist = cards.find((c) => c.isMet && c.text.includes(cad.noDistance));
  check("5: with the distance overridden to text that is not dice, the encounter card says the distance is not imported and rolls only the minute", !!noDist && noDist.formulas.length === 1, cards.map((c) => c.formulas.length));
  await run(gm, P.setSetting, { key: "encounterTarget", value: null });
  const priorDist = restore.overrides.pop();
  await run(gm, P.overrideSet, priorDist);
  await run(gm, P.closeSheet, { actorId: cParty.id });

  /* ---------------- supplying a light, on the cadence party's member, who carries no fuel ---------------- */
  section("supplying a light");
  const supStart = await run(gm, P.supplyStart, { fid: cRec.fid, bearerId: cMember.id });
  check("the supply bearer starts with no torch", supStart.torches === 0, supStart);
  const sup = await run(gm, P.supply, { fid: cRec.fid, bearerId: cMember.id });
  note("supply", { from: sup.from, added: sup.added.length, lit: sup.lit });
  for (const uuid of sup.added) tracked.push(gm.track(uuid, "Item"));
  if (supStart.torches === 0) check("a Judge's light on a bearer with no fuel lights, and hands over the largest stack its pattern matches, less the one it burns", sup.lit && sup.largest != null && (sup.held === sup.largest - 1 || (sup.largest === 1 && sup.held === 0)), { largestKnown: sup.largest != null, from: sup.from, heldMatches: sup.held === sup.largest - 1 });
  await run(gm, P.supplyStart, { fid: cRec.fid, bearerId: cMember.id });

  /* ---------------- the rest switch ---------------- */
  section("the rest switch");
  const rParty = await gm.fixture("formation/rest-party", "Actor", { name: "QA Rest Party", type: `${SCOPE}.party` });
  const rMember = await gm.fixture("formation/rest-member", "Actor", character("QA Rest Member"));
  const rRec = await run(gm, P.formationOf, { partyId: rParty.id });
  await run(gm, P.seat, { partyId: rParty.id, fid: rRec.fid, actorIds: [rMember.id] });
  await run(gm, P.delveStart, { fid: rRec.fid, light: true });
  const lines = await run(gm, P.restLines);
  const rnames = ["QA Rest Party"];
  const rReads0 = await run(gm, P.restReads, { fid: rRec.fid, memberId: rMember.id, partyId: rParty.id });
  const n = Number(rReads0.interval);
  check("the formation table's rest interval is imported", Number.isInteger(n) && n > 0, { imported: Number.isInteger(n) && n > 0 });
  if (Number.isInteger(n) && n > 0) {
    await run(gm, P.setSetting, { key: "encounterEvery", value: 0 });
    await run(gm, P.setSetting, { key: "restRequired", value: true });
    await run(gm, P.advance, { fid: rRec.fid, n: 1, resting: true });
    since = await run(gm, P.nowMs);
    await run(gm, P.advance, { fid: rRec.fid, n: n + 1 });
    let rr = await run(gm, P.restReads, { fid: rRec.fid, memberId: rMember.id, partyId: rParty.id });
    cards = await run(gm, P.cards, { since, names: rnames });
    for (const c of cards) tracked.push(gm.track(c.id, "ChatMessage"));
    check("1: on, past the interval the party is winded: the record, the member's effect, the sheet's badge and the card's line", rr.clock.winded && rr.effect && rr.badge && cards.some((c) => c.text.includes(lines.winded) || c.text.includes(lines.became)), { winded: rr.clock.winded, effect: rr.effect, badge: rr.badge, cards: cards.length });
    await run(gm, P.setSetting, { key: "restRequired", value: false });
    since = await run(gm, P.nowMs);
    const total0 = rr.clock.turnsTotal;
    await run(gm, P.advance, { fid: rRec.fid, n: 1 });
    rr = await run(gm, P.restReads, { fid: rRec.fid, memberId: rMember.id, partyId: rParty.id });
    cards = await run(gm, P.cards, { since, names: rnames });
    for (const c of cards) tracked.push(gm.track(c.id, "ChatMessage"));
    const quiet = (c) => !c.text.includes(lines.rest) && !c.text.includes(lines.winded) && !c.text.includes(lines.became) && !c.text.includes(lines.recovered);
    check("2: off, a turn counts, nothing is owed: no winded record or effect, no Rest stat or badge, no rest line", rr.clock.turnsTotal === total0 + 1 && rr.clock.turnsSinceRest === 0 && !rr.clock.winded && !rr.effect && !rr.restStat && !rr.badge && cards.length > 0 && cards.every(quiet), { total: rr.clock.turnsTotal - total0, since: rr.clock.turnsSinceRest, winded: rr.clock.winded, effect: rr.effect, stat: rr.restStat, badge: rr.badge });
    since = await run(gm, P.nowMs);
    await run(gm, P.advance, { fid: rRec.fid, n: n + 3 });
    rr = await run(gm, P.restReads, { fid: rRec.fid, memberId: rMember.id, partyId: rParty.id });
    cards = await run(gm, P.cards, { since, names: rnames });
    for (const c of cards) tracked.push(gm.track(c.id, "ChatMessage"));
    check("3: off, past the interval nothing winds and no card carries a rest or winded line", rr.clock.turnsTotal === total0 + 1 + n + 3 && rr.clock.turnsSinceRest === 0 && !rr.clock.winded && !rr.effect && cards.every(quiet), { total: rr.clock.turnsTotal - total0, winded: rr.clock.winded });
    since = await run(gm, P.nowMs);
    await run(gm, P.openSheet, { actorId: rParty.id, tab: "mode" });
    await run(gm, P.turnTool, { partyId: rParty.id, n: 1, action: "restTurn" });
    cards = await run(gm, P.cards, { since, names: rnames });
    for (const c of cards) tracked.push(gm.track(c.id, "ChatMessage"));
    check("3: off, the Rest turn tool still advances a turn and its card says the party rested", cards.some((c) => c.text.includes(lines.rested)), cards.length);
    await run(gm, P.setSetting, { key: "restRequired", value: true });
    rr = await run(gm, P.restReads, { fid: rRec.fid, memberId: rMember.id, partyId: rParty.id });
    check("4: back on, the Rest stat returns", rr.restStat, { stat: rr.restStat });
    await run(gm, P.advance, { fid: rRec.fid, n: n + 1 });
    rr = await run(gm, P.restReads, { fid: rRec.fid, memberId: rMember.id, partyId: rParty.id });
    check("4: back on, the interval winds the party as step 1 did", rr.clock.winded && rr.effect, { winded: rr.clock.winded, effect: rr.effect });
    const tail = await run(gm, P.cards, { since, names: rnames });
    for (const c of tail) tracked.push(gm.track(c.id, "ChatMessage"));
    await run(gm, P.closeSheet, { actorId: rParty.id });
  }

  section("errors after ready");
  for (const [k, api] of Object.entries(open)) {
    const boot = await run(api, P.boot);
    check(`${k} seat: nothing thrown over the walk`, !boot?.errors.length, boot?.errors?.slice(0, 5));
  }
} catch (err) {
  console.log(`WALK ERROR: ${err?.message ?? err}`);
  console.error(err?.stack ?? err);
  process.exitCode = 1;
} finally {
  section("teardown");
  const gm = open.gm;
  if (gm) {
    try { if (restore.lightDropped) note("light document reloaded", await run(gm, P.reloadLight)); } catch (err) { console.error("light reload:", err?.message ?? err); }
    try { if (restore.paused) note("game paused again", await gm.eval(`(async () => { game.togglePause(true, { broadcast: true }); await new Promise((r) => setTimeout(r, 800)); return game.paused; })()`)); } catch (err) { console.error("pause:", err?.message ?? err); }
    for (const o of restore.overrides.reverse()) {
      try { note(`override ${o.docId}.${o.tableId} put back`, await run(gm, P.overrideSet, o)); } catch (err) { console.error("override:", err?.message ?? err); }
    }
    if (restore.settings) {
      for (const [k, v] of Object.entries(restore.settings)) {
        if (v === "(unregistered)") continue;
        try { await run(gm, P.setSetting, { key: k, value: v }); } catch (err) { console.error(`setting ${k}:`, err?.message ?? err); }
      }
      try { note("settings restored", JSON.stringify(await run(gm, P.settings, { keys: Object.keys(restore.settings) })) === JSON.stringify(restore.settings)); } catch (_e) { /* closed */ }
    }
    // Every card this client posted under the run's nonce that speaks as or names one of the run's parties: the turn cards its moves billed included.
    try {
      const own = await run(gm, P.cards, { since: 0, names: ["QA Column Party", "QA Cadence Party", "QA Rest Party"] });
      for (const c of own) tracked.push(gm.track(c.id, "ChatMessage"));
    } catch (err) { console.error("cards:", err?.message ?? err); }
    try { if (tracked.length) note("swept", await gm.sweepTracked({ only: tracked.filter((u, i, a) => a.indexOf(u) === i) })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  }
  console.log(`\nchecks: ${tally.pass} passed, ${tally.fail} failed`);
  if (tally.fail) process.exitCode = 1;
  for (const api of Object.values(open)) { try { api.close(); } catch (_e) { /* closed */ } }
}
