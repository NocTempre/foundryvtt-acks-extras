/**
 * Live walk, whether a party is mapping: docs/formation/TESTING.md, "The mapper".
 * A party's scene reads "?" while no light reaches a mapper who can work, vague
 * while one does and the mapper lacks the Mapping proficiency, and exact with
 * it; a magic light of an invented reach, its reach against the mapper's place
 * in the column, its shutter, the day outside, the Judge's light switch, a dead
 * mapper, and the fog and the whisper a failed light brings. Each reads from
 * the GM seat and the Player seat: the scene's measurement flag and the
 * warnings strip's sentences. The walk never calls the environment sync by
 * hand: what moves the verdict is a real write (an effect, an item, a status, a
 * setting, the scene), and the hooks in `module.mjs` must pick it up. A boot
 * recorder is attached before the GM seat's reload, so `init`, `setup` and
 * `ready` are in the console record. Prints booleans and counts, never a name.
 * Machine values arrive through ./_env.mjs.
 *
 * Fixtures, kept and found by marker (the GM seat builds them): a scene
 * `formation/mapper-lit-scene` (5 ft cells, dark); a party
 * `formation/mapper-lit-party` with its token `formation/mapper-lit-token`;
 * two characters, `formation/mapper-lit` (the mapper) and
 * `formation/mapper-lit-bearer` (carries the light), both members. Built and
 * swept by the run's own ledger: the magic-light effect, the Mapping ability, a
 * status effect, the Map item a session opens, and the chat cards the sync
 * posts (found afterwards by the speaker and the fixture's scene name, in the
 * run's window). Writes outside the ledger, each restored in a finally: the
 * world settings `manageFog`, `fuzzMeasurement` and `mapperNeedsLight`, the
 * scene's fog mode and darkness, the mapper's role.
 */
import { connect, sleep, Cdp } from "./_driver.mjs";
import { walkDone, blocked } from "./_walk.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const SCENE = "formation/mapper-lit-scene";
const PARTY = "formation/mapper-lit-party";
const TOKEN = "formation/mapper-lit-token";
const MAPPER = "formation/mapper-lit";
const BEARER = "formation/mapper-lit-bearer";
const GS = 100;
const SCENE_NAME = "QA Mapper Lit Scene";
const PARTY_NAME = "QA Mapper Lit Party";

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/** Runs before any of Foundry's scripts on the next document load: records warnings and errors from `init` on. */
const BOOT_RECORDER = `(() => {
  if (window.top !== window) return;
  const B = (window.__boot = { preFoundry: typeof globalThis.Hooks === "undefined" && typeof globalThis.game === "undefined", warn: [], error: [] });
  const text = (args) => args.map((a) => a?.message ?? String(a)).join(" ").slice(0, 300);
  for (const level of ["warn", "error"]) {
    const original = console[level];
    console[level] = (...args) => { B[level].push(text(args)); return original.apply(console, args); };
  }
  window.addEventListener("error", (e) => B.error.push("uncaught: " + String(e.message ?? "").slice(0, 200)));
})();`;

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in the seat's page. */
/* ------------------------------------------------------------------ */
const P = {
  install: async ({ key }) => {
    const H = (globalThis.__mm = globalThis.__mm ?? {});
    H.key = key;
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 60, every = 200 } = {}) => { for (let n = 0; n < tries; n++) { const v = await fn(); if (v) return v; await H.sleep(every); } return null; };
    const base = "/modules/acks-extras/scripts/";
    H.model = await import(`${base}formation/formation-model.mjs`);
    H.mapping = await import(`${base}formation/mapping.mjs`);
    H.view = await import(`${base}formation/formation-view.mjs`);
    H.light = await import(`${base}lib/light.mjs`);
    H.formation = (partyId) => Object.values(H.model.getFormations()).find((f) => f.actorId === partyId) ?? null;
    /** A lang template as a pattern, its `{names}` standing for anything. */
    H.pattern = (key) => new RegExp("^" + game.i18n.localize(key).replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{names\}/g, ".+") + "$");
    /**
     * What this seat reads of the party now, as booleans and counts: the
     * verdict, the scene's measurement flag, the fog, and which mapper
     * sentences the warnings strip carries.
     */
    H.read = ({ partyId, sceneId }) => {
      const f = H.formation(partyId);
      const scene = game.scenes.get(sceneId);
      const v = f ? H.mapping.mappingOf(f) : null;
      const strip = f ? H.view.buildWarnings(f, 60) : [];
      const has = (key) => strip.some((w) => H.pattern(key).test(w));
      return {
        mapping: v?.mapping ?? null,
        block: v?.block ?? null,
        working: v?.working ?? null,
        litCount: v?.lit ?? null,
        litBy: (v?.mappers ?? []).map((m) => m.litBy),
        proficient: v?.proficient ?? null,
        measure: scene?.getFlag("acks-extras", "measure")?.mode ?? null,
        fog: scene?.fog?.mode ?? null,
        warnLight: has("ACKS-FORMATION.warnings.mapperNoLight"),
        warnDown: has("ACKS-FORMATION.warnings.mapperDown"),
        warnProficiency: strip.includes(game.i18n.localize("ACKS-FORMATION.warnings.mapperNoProficiency")),
        noMapperWarn: strip.includes(game.i18n.localize("ACKS-FORMATION.warnings.noMapper")),
        isGM: game.user.isGM,
      };
    };
    if (!H.patched) {
      H.patched = true;
      H.errors = [];
      H.uncaught = [];
      H.consoleError = console.error;
      console.error = (...args) => { H.errors.push(args.map((a) => a?.message ?? String(a)).join(" ").slice(0, 300)); H.consoleError(...args); };
      H.onError = (e) => H.uncaught.push(String(e.message ?? "").slice(0, 200));
      window.addEventListener("error", H.onError);
    }
    return {
      isGM: game.user.isGM,
      role: game.user.role,
      userId: game.user.id,
      activeGMIsSelf: !!game.users.activeGM?.isSelf,
      primary: game.user.isGM ? await Promise.race([import(`${base}lib/util.mjs`).then((u) => u.primaryGMSettled()), new Promise((r) => setTimeout(() => r(null), 30000))]) : null,
    };
  },

  boot: async () => {
    const b = window.__boot ?? null;
    const own = (list) => list.filter((m) => /mapping|mapper|environment sync|light/iu.test(m)).length;
    return { recorded: !!b, preFoundry: !!b?.preFoundry, warns: b?.warn.length ?? null, errors: b?.error.length ?? null, ownWarns: b ? own(b.warn) : null, ownErrors: b ? own(b.error) : null };
  },

  /** The world settings the walk flips, as found. */
  settings: async () => ({
    manageFog: game.settings.get("acks-extras", "manageFog"),
    fuzzMeasurement: game.settings.get("acks-extras", "fuzzMeasurement"),
    mapperNeedsLight: game.settings.get("acks-extras", "mapperNeedsLight"),
  }),
  setting: async ({ key, value }) => {
    if (game.settings.get("acks-extras", key) !== value) await game.settings.set("acks-extras", key, value);
    return game.settings.get("acks-extras", key);
  },

  /** The scene as the walk needs it: dark, fog on its own mode, no leftover management flag. */
  sceneShape: async ({ sceneId, darkness }) => {
    const scene = game.scenes.get(sceneId);
    await scene.update({ "environment.darknessLevel": darkness, "fog.mode": CONST.FOG_EXPLORATION_MODES.INDIVIDUAL, "flags.acks-extras.-=fogOriginal": null, "flags.acks-extras.-=measure": null });
    return { darkness: scene.environment.darknessLevel, fog: scene.fog.mode };
  },
  darkness: async ({ sceneId, darkness }) => {
    await game.scenes.get(sceneId).update({ "environment.darknessLevel": darkness });
    return game.scenes.get(sceneId).environment.darknessLevel;
  },

  /**
   * The party's known shape: both characters are members in marching order
   * (the mapper first, the bearer one cell behind), the mapper holds the role,
   * the party token stands at a cell and is adopted, no combat, no hurry, no
   * lights in the record, no leftover of the walk on either character.
   */
  shape: async ({ partyId, mapperId, bearerId, sceneId, x, y, role }) => {
    const H = globalThis.__mm;
    let f = await H.poll(() => H.formation(partyId));
    if (!f) {
      await H.model.adoptPartyActor(game.actors.get(partyId));
      f = await H.poll(() => H.formation(partyId));
    }
    if (!f) return { formation: false };
    for (const id of [mapperId, bearerId]) {
      f = H.formation(partyId);
      if (!f.members.some((m) => m?.actorId === id)) {
        await H.model.addMember(f, game.actors.get(id), null, { scene: null });
        await H.sleep(700);
      }
    }
    const scene = game.scenes.get(sceneId);
    let token = H.formation(partyId).tokenId ? scene.tokens.get(H.formation(partyId).tokenId) : null;
    let made = null;
    if (!token) {
      const doc = await game.actors.get(partyId).getTokenDocument({ x, y, rotation: 270 });
      [token] = await scene.createEmbeddedDocuments("Token", [{ ...doc.toObject(), actorLink: true, hidden: false }]);
      made = token.id;
      await H.poll(() => H.formation(partyId).tokenId === token.id, { tries: 40, every: 200 });
      if (H.formation(partyId).tokenId !== token.id) await H.model.adoptPartyToken(H.formation(partyId).id, token);
    }
    await H.model.patchFormation(H.formation(partyId).id, (rec) => {
      const order = [mapperId, bearerId];
      rec.members.sort((a, b) => order.indexOf(a?.actorId) - order.indexOf(b?.actorId));
      for (const m of rec.members) {
        if (m?.actorId === mapperId) m.roles = role ? ["mapper"] : [];
        if (m?.actorId === bearerId) m.roles = [];
        if (m?.actorId) { delete m.left; delete m.dead; }
      }
      rec.lights = [];
      rec.combat = null;
      rec.stance = { ...(rec.stance ?? {}), pace: "careful" };
      rec.mapSession = null;
    });
    await H.sleep(900);
    const found = H.formation(partyId);
    const left = [];
    for (const id of [mapperId, bearerId]) {
      for (const e of game.actors.get(id).effects) if (e.statuses.has("dead") || e.changes.some((c) => c.key.includes("magicLight"))) left.push(e.uuid);
      for (const i of game.actors.get(id).items) if (i.type === "ability" && /^QA Mapping$/.test(i.name)) left.push(i.uuid);
    }
    return { formation: true, formationId: found.id, made, tokenId: found.tokenId, onScene: found.sceneId === sceneId, members: found.members.filter((m) => m?.actorId).length, left };
  },

  /** Set or clear the role on the mapper; a plain record patch, as the sheet's control writes beneath its kit check. */
  role: async ({ partyId, mapperId, on }) => {
    const H = globalThis.__mm;
    await H.model.patchFormation(H.formation(partyId).id, (rec) => { for (const m of rec.members) if (m?.actorId === mapperId) m.roles = on ? ["mapper"] : []; });
    return H.formation(partyId).members.find((m) => m?.actorId === mapperId)?.roles ?? null;
  },

  /** An invented magic light on the bearer: an effect writing the bright radius key. */
  makeLight: async ({ actorId, bright }) => {
    const H = globalThis.__mm;
    const [eff] = await game.actors.get(actorId).createEmbeddedDocuments("ActiveEffect", [{
      name: "QA Mapper Glow",
      img: "icons/svg/light.svg",
      disabled: false,
      changes: [{ key: H.light.MAGIC_LIGHT_CHANGE_KEYS.bright, type: "upgrade", value: String(bright) }],
    }]);
    return { id: eff.id, uuid: eff.uuid, listed: H.light.magicLights(game.actors.get(actorId)).some((l) => l.id === eff.id) };
  },
  setReach: async ({ actorId, effectId, bright }) => {
    const H = globalThis.__mm;
    const eff = game.actors.get(actorId).effects.get(effectId);
    await eff.update({ changes: [{ key: H.light.MAGIC_LIGHT_CHANGE_KEYS.bright, type: "upgrade", value: String(bright) }] });
    return H.light.magicLights(game.actors.get(actorId)).find((l) => l.id === effectId)?.bright ?? null;
  },
  /** The shutter, by the call the Judge's seat makes. */
  shutter: async ({ actorId, effectId, on }) => {
    const H = globalThis.__mm;
    const eff = game.actors.get(actorId).effects.get(effectId);
    return { returned: await H.light.setLightShutter(eff, on), state: H.light.lightStateOf(eff) };
  },
  /** A Mapping ability on the mapper, the way a proficiency sits on a sheet. */
  makeMapping: async ({ actorId }) => {
    const [item] = await game.actors.get(actorId).createEmbeddedDocuments("Item", [{ name: "QA Mapping", type: "ability" }]);
    return { uuid: item?.uuid ?? null };
  },
  dropItem: async ({ uuid }) => {
    const item = await fromUuid(uuid);
    if (item) await item.delete();
    return !(await fromUuid(uuid));
  },
  status: async ({ actorId, status, on }) => {
    const actor = game.actors.get(actorId);
    await actor.toggleStatusEffect(status, { active: on });
    await globalThis.__mm.sleep(300);
    return [...actor.effects].filter((e) => e.statuses.has(status)).map((e) => e.uuid);
  },

  /** Wait until the read satisfies the named shape, then a beat more so a late second write would show; return the final read. */
  settle: async ({ partyId, sceneId, want, tries = 60 }) => {
    const H = globalThis.__mm;
    const ok = (r) => Object.entries(want).every(([k, v]) => r[k] === v);
    const matched = !!(await H.poll(() => ok(H.read({ partyId, sceneId })), { tries, every: 200 }));
    await H.sleep(800);
    return { matched, ...H.read({ partyId, sceneId }) };
  },
  read: async (args) => globalThis.__mm.read(args),

  /** The scene's measurement flag, nothing else (a plain read, for a "stays unset" check). */
  flagOnly: async ({ sceneId }) => game.scenes.get(sceneId)?.getFlag("acks-extras", "measure")?.mode ?? null,

  /** What the sync leaves behind in the world: the Map item a session opened, and the cards the run's window holds that name the fixture. */
  leavings: async ({ mapperId, since, sceneName, partyName, gmIds }) => {
    const items = [...game.actors.get(mapperId).items].filter((i) => i.getFlag("acks-extras", "map")).map((i) => i.uuid);
    const cards = [...game.messages].filter((m) => m.timestamp >= since && (m.speaker?.alias === partyName || String(m.content ?? "").includes(sceneName)));
    return {
      items,
      cards: cards.map((m) => m.uuid),
      gmWhispers: cards.filter((m) => String(m.content ?? "").includes(sceneName) && m.whisper.length > 0 && m.whisper.every((id) => gmIds.includes(id))).length,
      publicSceneCards: cards.filter((m) => String(m.content ?? "").includes(sceneName) && m.whisper.length === 0).length,
    };
  },
  closeSession: async ({ partyId }) => {
    const H = globalThis.__mm;
    await H.model.patchFormation(H.formation(partyId).id, (rec) => { rec.mapSession = null; });
    return H.formation(partyId).mapSession ?? null;
  },
  drain: async () => ({ errors: globalThis.__mm.errors.slice(), uncaught: globalThis.__mm.uncaught.length }),
  restore: async () => {
    const H = globalThis.__mm;
    if (!H?.patched) return "never installed";
    console.error = H.consoleError;
    window.removeEventListener("error", H.onError);
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

async function ready(api, label, { seconds = 240, fresh = false } = {}) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.formation && ${fresh ? "!window.__preReload" : "true"}`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}

/** Attach a second DevTools session, register the boot recorder for the next document, and reload (the driver's own session attaches after `ready`). */
async function reloadWithRecorder(api) {
  const version = await (await fetch(`http://127.0.0.1:${PORTS.gm}/json/version`)).json();
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener("open", resolve); ws.addEventListener("error", reject); });
  const cdp = new Cdp(ws);
  try {
    const { targetInfos } = await cdp.send("Target.getTargets");
    const page = targetInfos.find((t) => t.type === "page" && t.url.includes("/game"));
    if (!page) throw new Error("no /game page to reload");
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: page.targetId, flatten: true });
    await cdp.send("Page.enable", {}, sessionId);
    const { identifier } = await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: BOOT_RECORDER }, sessionId);
    await api.eval("window.__preReload = true; 0");
    await cdp.send("Page.reload", {}, sessionId);
    const seconds = await ready(api, "gm after reload", { fresh: true });
    await cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier }, sessionId).catch(() => {});
    return seconds;
  } finally {
    try { ws.close(); } catch {}
  }
}

let gm = null;
let player = null;
let ids = null;
let found = null;
const swept = [];
const RUN_START = Date.now();
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 540_000);
setTimeout(() => {
  console.error(`WALK ERROR: wall clock of ${WALL_MS} ms reached; closing the seats`);
  try { gm?.close(); } catch {}
  try { player?.close(); } catch {}
  process.exit(1);
}, WALL_MS).unref();

/** Track a document the run built or left, by uuid, so the sweep deletes exactly these. */
const track = async (uuid, kind) => { if (uuid && !swept.includes(uuid)) { swept.push(uuid); await gm.track(uuid, kind); } };

try {
  section("seats");
  gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  player = await connect({ browser, origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  note("gm ready after (s)", await ready(gm, "gm"));
  note("player ready after (s)", await ready(player, "player"));
  note("gm reloaded with the boot recorder, ready after (s)", await reloadWithRecorder(gm));
  const installed = await run(gm, P.install, { key: "formation-mapper-mapping-walk" });
  const seen = await run(player, P.install, { key: "formation-mapper-mapping-walk" });
  check("the GM seat is the active GM and this window runs its automation; the other seat is a player", installed.isGM && installed.activeGMIsSelf && installed.role === 4 && installed.primary === true && !seen.isGM && seen.role <= 2, { gm: installed.role, primary: installed.primary, player: seen.role });
  if (installed.primary !== true) blocked("this window is not the primary GM");
  const boot = await run(gm, P.boot);
  check("the boot recorder ran before Foundry's scripts and saw no warning or error naming mapping or the environment sync", boot.recorded && boot.preFoundry && boot.ownWarns === 0 && boot.ownErrors === 0, { warns: boot.warns, errors: boot.errors, ownWarns: boot.ownWarns, ownErrors: boot.ownErrors });

  section("fixtures");
  found = await run(gm, P.settings);
  note("settings as found (restored in the finally)", found);
  note("settings set for the walk", { manageFog: await run(gm, P.setting, { key: "manageFog", value: false }), fuzzMeasurement: await run(gm, P.setting, { key: "fuzzMeasurement", value: true }), mapperNeedsLight: await run(gm, P.setting, { key: "mapperNeedsLight", value: true }) });
  const scene = await gm.fixture(SCENE, "Scene", { name: SCENE_NAME, active: false, navigation: false, width: 2000, height: 1000, padding: 0, grid: { type: 1, size: GS, distance: 5, units: "ft" }, environment: { darknessLevel: 1, globalLight: { enabled: false } }, ownership: { default: 2 } });
  const mapper = await gm.fixture(MAPPER, "Actor", { name: "QA Mapper Lit", type: "character" });
  const bearer = await gm.fixture(BEARER, "Actor", { name: "QA Mapper Lit Bearer", type: "character" });
  const party = await gm.fixture(PARTY, "Actor", { name: PARTY_NAME, type: "acks-extras.party" });
  const idOf = (doc) => doc.id ?? String(doc.uuid).split(".").pop();
  ids = { sceneId: idOf(scene), mapperId: idOf(mapper), bearerId: idOf(bearer), partyId: idOf(party) };
  const view = { partyId: ids.partyId, sceneId: ids.sceneId };
  note("scene as shaped", await run(gm, P.sceneShape, { sceneId: ids.sceneId, darkness: 1 }));
  const shaped = await run(gm, P.shape, { ...ids, x: 5 * GS, y: 5 * GS, role: true });
  for (const uuid of shaped.left ?? []) await track(uuid, uuid.includes(".Item.") ? "Item" : "ActiveEffect");
  if (shaped.left?.length) note("a leftover of an earlier run on the characters, tracked and swept", await gm.sweepTracked({ only: shaped.left }));
  check("the party's formation holds both characters, with the party token adopted on the scene", shaped.formation && shaped.members === 2 && shaped.onScene && !!shaped.tokenId, { members: shaped.members, onScene: shaped.onScene });
  const tokenUuid = shaped.made ? `Scene.${ids.sceneId}.Token.${shaped.made}` : null;
  if (tokenUuid) { note("party token built by this run, tracked", true); await track(tokenUuid, "Token"); }
  const settingsNow = await run(gm, P.settings);
  check("settings in force: fog management off, measurement fuzz on, light requirement on", !settingsNow.manageFog && settingsNow.fuzzMeasurement && settingsNow.mapperNeedsLight, settingsNow);

  /** A read from each seat, once the GM seat's reading has settled on `want`. */
  const both = async (want) => {
    const g = await run(gm, P.settle, { ...view, want });
    const p = await run(player, P.settle, { ...view, want: { measure: want.measure ?? g.measure } });
    return { g, p };
  };

  section("1. no light reaches the mapper");
  const dark = await both({ mapping: false, measure: "unknown" });
  check("the mapper is not mapping for want of light: working, none lit", dark.g.matched && dark.g.mapping === false && dark.g.block === "dark" && dark.g.working === 1 && dark.g.litCount === 0, { block: dark.g.block, working: dark.g.working, lit: dark.g.litCount });
  check("with fog management off the scene still reads \"?\" on both seats: the measurement stands above the fog switch", dark.g.measure === "unknown" && dark.p.measure === "unknown", { gm: dark.g.measure, player: dark.p.measure });
  check("the strip says no light reaches them, on both seats", dark.g.warnLight && dark.p.warnLight, { gm: dark.g.warnLight, player: dark.p.warnLight });
  check("the proficiency warning is the Judge's: the GM seat reads it, the Player seat does not", dark.g.isGM && dark.g.warnProficiency === true && dark.p.isGM === false && dark.p.warnProficiency === false, { gm: dark.g.warnProficiency, player: dark.p.warnProficiency });

  section("2. a magic light within the mapper's reach");
  const made = await run(gm, P.makeLight, { actorId: ids.bearerId, bright: 20 });
  await track(made.uuid, "ActiveEffect");
  check("the effect is a listed magic light on the bearer", made.listed, { listed: made.listed });
  const lit = await both({ mapping: true, measure: "fuzzy" });
  check("lit by the light: the party maps, vaguely, as the mapper lacks the proficiency", lit.g.matched && lit.g.mapping === true && lit.g.litBy[0] === "light" && lit.g.proficient === false && lit.g.measure === "fuzzy", { litBy: lit.g.litBy, measure: lit.g.measure });
  check("the player seat reads the same flag, and neither seat is told of missing light", lit.p.measure === "fuzzy" && !lit.g.warnLight && !lit.p.warnLight, { player: lit.p.measure });

  section("3. the same light, out of reach");
  note("reach set below one cell", await run(gm, P.setReach, { actorId: ids.bearerId, effectId: made.id, bright: 3 }));
  const far = await both({ mapping: false, measure: "unknown" });
  check("one cell is past a reach of three feet: no light, no mapping, \"?\"", far.g.matched && far.g.block === "dark" && far.g.measure === "unknown" && far.g.warnLight, { block: far.g.block, measure: far.g.measure });
  note("reach set back", await run(gm, P.setReach, { actorId: ids.bearerId, effectId: made.id, bright: 20 }));
  check("and back in reach it maps again", (await both({ mapping: true, measure: "fuzzy" })).g.matched);

  section("4. the light shuttered by hand");
  const shut = await run(gm, P.shutter, { actorId: ids.bearerId, effectId: made.id, on: true });
  check("the shutter writes and the light reads shuttered", shut.returned === true && shut.state === "shuttered", shut);
  const shuttered = await both({ mapping: false, measure: "unknown" });
  check("nothing called the sync: the shutter alone put the scene back to \"?\"", shuttered.g.matched && shuttered.g.measure === "unknown" && shuttered.p.measure === "unknown", { gm: shuttered.g.measure, player: shuttered.p.measure });

  section("5. the day outside");
  note("scene darkness", await run(gm, P.darkness, { ...ids, darkness: 0 }));
  const day = await both({ mapping: true, measure: "fuzzy" });
  check("by the day the shuttered light does not matter: lit by the day outside", day.g.matched && day.g.litBy[0] === "ambient" && day.g.measure === "fuzzy" && !day.g.warnLight, { litBy: day.g.litBy });
  note("scene darkness back", await run(gm, P.darkness, { ...ids, darkness: 1 }));
  check("and the dark takes it away again", (await both({ mapping: false, measure: "unknown" })).g.matched);

  section("6. the Mapping proficiency");
  await run(gm, P.shutter, { actorId: ids.bearerId, effectId: made.id, on: false });
  check("the light open again: vague", (await both({ mapping: true, measure: "fuzzy" })).g.matched);
  const skill = await run(gm, P.makeMapping, { actorId: ids.mapperId });
  await track(skill.uuid, "Item");
  const exact = await both({ proficient: true, measure: "off" });
  check("with the proficiency the measurements are exact on both seats and the Judge's warning is gone", exact.g.matched && exact.g.measure === "off" && exact.p.measure === "off" && exact.g.warnProficiency === false, { gm: exact.g.measure, player: exact.p.measure });
  check("a proficient party with the light out is still not mapping: light is its own check", await (async () => {
    await run(gm, P.shutter, { actorId: ids.bearerId, effectId: made.id, on: true });
    const r = await run(gm, P.settle, { ...view, want: { mapping: false, measure: "unknown" } });
    await run(gm, P.shutter, { actorId: ids.bearerId, effectId: made.id, on: false });
    return r.matched && r.proficient === false;
  })());
  check("dropping the ability returns it to vague", (await run(gm, P.dropItem, { uuid: skill.uuid })) && (await both({ mapping: true, measure: "fuzzy" })).g.matched);

  section("7. the light requirement off");
  await run(gm, P.shutter, { actorId: ids.bearerId, effectId: made.id, on: true });
  await both({ mapping: false, measure: "unknown" });
  note("mapperNeedsLight", await run(gm, P.setting, { key: "mapperNeedsLight", value: false }));
  const assumed = await both({ mapping: true, measure: "fuzzy" });
  check("with the switch off the module assumes light: mapping, and no light warning on either seat", assumed.g.matched && assumed.g.litBy[0] === "assumed" && !assumed.g.warnLight && !assumed.p.warnLight, { litBy: assumed.g.litBy });
  note("mapperNeedsLight", await run(gm, P.setting, { key: "mapperNeedsLight", value: true }));
  check("and back on, the dark light is read again", (await both({ mapping: false, measure: "unknown" })).g.matched);
  await run(gm, P.shutter, { actorId: ids.bearerId, effectId: made.id, on: false });
  await both({ mapping: true, measure: "fuzzy" });

  section("8. a mapper who cannot work");
  const dead = await run(gm, P.status, { actorId: ids.mapperId, status: "dead", on: true });
  for (const uuid of dead) await track(uuid, "ActiveEffect");
  const gone = await both({ mapping: false, measure: "unknown" });
  check("a dead mapper maps nothing though the light reaches where they lie", gone.g.matched && gone.g.block === "down" && gone.g.working === 0 && gone.g.measure === "unknown", { block: gone.g.block, working: gone.g.working });
  check("the strip says the mapper cannot work the kit, on both seats, and not that no light reaches them", gone.g.warnDown && gone.p.warnDown && !gone.g.warnLight, { gm: gone.g.warnDown, player: gone.p.warnDown });
  const revived = await run(gm, P.status, { actorId: ids.mapperId, status: "dead", on: false });
  check("the death lifted, they map again", revived.length === 0 && (await both({ mapping: true, measure: "fuzzy" })).g.matched);

  section("9. the fog and its whisper");
  note("fog management", await run(gm, P.setting, { key: "manageFog", value: true }));
  note("scene reset to its own fog, dark", await run(gm, P.sceneShape, { sceneId: ids.sceneId, darkness: 1 }));
  await run(gm, P.shutter, { actorId: ids.bearerId, effectId: made.id, on: true });
  const closed = await run(gm, P.settle, { ...view, want: { mapping: false, fog: 0 } });
  check("a failed light closes the fog: disabled, management flag kept", closed.matched && closed.fog === 0, { fog: closed.fog });
  await run(gm, P.shutter, { actorId: ids.bearerId, effectId: made.id, on: false });
  const opened = await run(gm, P.settle, { ...view, want: { mapping: true, measure: "fuzzy" } });
  check("the light back, the fog is on again", opened.matched && opened.fog !== 0, { fog: opened.fog });
  const gmIds = await gm.eval(`JSON.stringify(game.users.filter((u) => u.isGM).map((u) => u.id))`).then(JSON.parse);
  const left = await run(gm, P.leavings, { mapperId: ids.mapperId, since: RUN_START, sceneName: SCENE_NAME, partyName: PARTY_NAME, gmIds });
  check("the fog notices went to the GMs alone, and none went to the table", left.gmWhispers >= 1 && left.publicSceneCards === 0, { whispers: left.gmWhispers, public: left.publicSceneCards });
  note("closing the session the sync opened", await run(gm, P.closeSession, { partyId: ids.partyId }));
  for (const uuid of left.items) await track(uuid, "Item");
  for (const uuid of left.cards) await track(uuid, "ChatMessage");
  note("what the run's window left, tracked for the sweep (map items, cards)", { items: left.items.length, cards: left.cards.length });

  section("console");
  const errors = await run(gm, P.drain);
  const own = errors.errors.filter((e) => /mapping|mapper|environment sync|light/iu.test(e));
  check("no console error naming mapping, the mapper or the environment sync over the walk", own.length === 0 && errors.uncaught === 0, { own: own.length, uncaught: errors.uncaught, all: errors.errors.length });
  walkDone();
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  if (gm) {
    try {
      if (ids) {
        try {
          await run(gm, P.role, { partyId: ids.partyId, mapperId: ids.mapperId, on: false });
          await run(gm, P.closeSession, { partyId: ids.partyId });
        } catch { /* the walk may have died before the formation held the member */ }
      }
      if (found) {
        for (const key of ["manageFog", "fuzzMeasurement", "mapperNeedsLight"]) {
          try { note(`restored ${key}`, await run(gm, P.setting, { key, value: found[key] })); } catch (err) { console.error(`restore ${key}:`, err?.message ?? err); }
        }
      }
      if (ids) {
        try {
          await sleep(1500);
          const late = await run(gm, P.leavings, { mapperId: ids.mapperId, since: RUN_START, sceneName: SCENE_NAME, partyName: PARTY_NAME, gmIds: [] });
          for (const uuid of late.items) await track(uuid, "Item");
          for (const uuid of late.cards) await track(uuid, "ChatMessage");
          note("scene put back (dark, own fog mode, no management flag)", await run(gm, P.sceneShape, { sceneId: ids.sceneId, darkness: 1 }));
        } catch (err) { console.error("scene put back:", err?.message ?? err); }
      }
      note("swept (the run's own effect, ability, status, map item, cards and party token)", await gm.sweepTracked({ only: swept }));
    } catch (err) { console.error("sweep:", err?.message ?? err); }
    try { note("restored", await run(gm, P.restore)); } catch (err) { console.error("restore:", err?.message ?? err); }
    console.log(`fixtures kept: ${SCENE}, ${PARTY}, ${MAPPER}, ${BEARER}`);
    console.log(`run window: ${Math.round((Date.now() - RUN_START) / 1000)} s`);
    try { await gm.close(); } catch {}
  }
  if (player) { try { await run(player, P.restore); } catch {} try { await player.close(); } catch {} }
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
