/**
 * Live walk, lib-defend-shield: a Defend reads the shield at the roll, on a
 * character, on an unlinked monster token, on a state another combatant gave,
 * and under the retired `defendingShield` id.
 * Walks docs/lib/TESTING.md, "Conditions on the palette and on a roll", step 21.
 * Machine values arrive through ./_env.mjs. The GM seat drives; no Player seat
 * is taken. Defending's four figures are invented and registered for this
 * client alone, above whatever the world imported, so the walk reads the same
 * with or without an import and prints which it found.
 *
 * Fixtures, kept and found by marker: the scene `lib/defend-scene`; the
 * characters `lib/defend-hero`, `lib/defend-guard` and the attacker
 * `lib/defend-raider`, each with a linked token (`lib/defend-hero-token`,
 * `lib/defend-guard-token`, `lib/defend-raider-token`); the shield items
 * `lib/defend-hero-shield` and `lib/defend-guard-shield` (armour of the shield
 * type, Armor Class blank); the raider's one weapon `lib/defend-raider-weapon`,
 * which offers the melee, missile and thrown attack; the monster
 * `lib/defend-goblin` with its unlinked token `lib/defend-goblin-token`; and
 * the shield item `lib/defend-goblin-shield`, which lives on that token's own
 * actor. Each step writes the shape it needs first: every condition effect off
 * the fixtures, each shield equipped or not as the step says, no target.
 * Nothing is rolled back at the end.
 *
 * The run's own products are tracked and swept by id: the combat of the given
 * half, the effect that holds the retired id, and every card this client posts.
 * The fixtures stay.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";
import { walkDone, blocked } from "./_walk.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const SEATS = { gm: MACHINE.gm };

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};
const gap = (label, why) => console.log(`GAP  ${label}  ${why}`);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** The attack kinds a Defend reads the shield for, in the order the walk rolls them. */
const KINDS = ["missile", "thrown", "melee"];
/** Defending's four figures as this walk registers them: invented, distinct, and read by no book. */
const FIGURES = Object.freeze({ melee: 7, thrown: 11, missile: 13, blast: 17 });
/** The condition id the palette dropped; an effect may still hold it. */
const RETIRED = "defendingShield";
/** An Armor Class written on a shield to prove the shield reading ignores it. */
const SET_AC = 2;
/** The marker a fixture is found under: the recipe's, suffixed with the session's tag when it builds its own. */
const marked = (marker) => (MACHINE.own ? `${marker}@${MACHINE.own}` : marker);

const weapon = () => ({
  name: "Defend Raider Blade", type: "weapon",
  system: { melee: true, missile: true, special: { thrown: true }, range: { short: 10, medium: 20, long: 30 }, damage: { base: { formula: "1d6" } } },
});
const shield = (name) => ({ name, type: "armor", system: { type: "shield", equipped: false } });

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in the GM's page.  */
/* ------------------------------------------------------------------ */
const P = {
  /** Arm the recorders and build the helpers every later call uses; replaces an earlier install in this page. */
  install: async () => {
    globalThis.__ld?.disarm?.();
    const H = (globalThis.__ld = {});
    const CL = acksExtras.lib.conditions;
    H.CL = CL;
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.said = [];
    H.errors = [];
    H.posted = [];
    H.seen = [];

    // What the roller is told, and every error this page raises.
    const notes = ui.notifications;
    const undo = [];
    for (const kind of ["info", "warn", "error"]) {
      const had = Object.hasOwn(notes, kind);
      const original = notes[kind];
      notes[kind] = function (message, ...rest) {
        H.said.push({ kind, text: String(message) });
        if (kind === "error") H.errors.push(`toast: ${String(message)}`.slice(0, 300));
        return original.call(this, message, ...rest);
      };
      undo.push(() => { if (had) notes[kind] = original; else delete notes[kind]; });
    }
    const consoleError = console.error;
    console.error = (...args) => {
      H.errors.push(args.map((a) => a?.message ?? String(a)).join(" ").slice(0, 300));
      return consoleError.apply(console, args);
    };
    const onReject = (e) => H.errors.push(`rejection: ${String(e.reason?.message ?? e.reason)}`.slice(0, 300));
    window.addEventListener("unhandledrejection", onReject);

    // Every card this client asks Foundry to post: `create` reaches `createDocuments` through `this`.
    const CM = foundry.documents.ChatMessage;
    const cmHad = Object.hasOwn(CM, "createDocuments");
    const cmOriginal = CM.createDocuments;
    CM.createDocuments = async function (...args) {
      const docs = await cmOriginal.apply(this, args);
      for (const d of docs ?? []) if (d?.uuid && !H.posted.includes(d.uuid)) H.posted.push(d.uuid);
      return docs;
    };
    H.hook = Hooks.on("acksLibPostAttackRoll", (actor, ctx) => { H.seen.push({ actor: actor.uuid, math: ctx.conditions ?? null }); });
    H.disarm = () => {
      for (const fn of undo) fn();
      console.error = consoleError;
      window.removeEventListener("unhandledrejection", onReject);
      if (cmHad) CM.createDocuments = cmOriginal; else delete CM.createDocuments;
      Hooks.off("acksLibPostAttackRoll", H.hook);
      globalThis.canvas?.tokens?.setTargets([]);
    };

    const defending = game.i18n.localize(CL.conditionNameKey("defending"));
    H.names = {
      defending,
      whenShield: game.i18n.localize("ACKS-LIB.conditionRoll.when.shield"),
      target: game.i18n.format("ACKS-LIB.conditionRoll.term.target", { name: defending }),
    };

    /** The icons a token draws for its effects. */
    H.icons = (tok) => {
      const fx = tok?.object?.effects;
      return fx ? (fx.children ?? []).filter((c) => c !== fx.bg && c !== fx.overlay).length : null;
    };
    /**
     * Find a shield item by marker on a token's actor, building it there from `data` when it is missing, and bring it to `equipped`, type
     * `shield` and Armor Class `ac`. Never tracked: it is a kept fixture.
     */
    H.shield = async ({ token, marker, data = null, equipped, ac = 0 }) => {
      const actor = (await fromUuid(token)).actor;
      let item = actor.items.find((i) => i.flags?.world?.fixture === marker) ?? null;
      let built = false;
      if (!item && data) {
        const [made] = await actor.createEmbeddedDocuments("Item", [{ ...data, flags: { ...(data.flags ?? {}), world: { fixture: marker } } }]);
        item = made;
        built = true;
      }
      if (!item) return { marker, found: false };
      const patch = {};
      if (item.system.type !== "shield") patch["system.type"] = "shield";
      if (Number(item.system.ac?.value) !== ac) patch["system.ac.value"] = ac;
      if (!!item.system.equipped !== equipped) patch["system.equipped"] = equipped;
      if (Object.keys(patch).length) await item.update(patch);
      return {
        marker, found: true, built, uuid: item.uuid, type: item.system.type, equipped: !!item.system.equipped,
        ac: Number(item.system.ac?.value), shield: CL.shieldOf(actor),
      };
    };
    /** One attack of `kind` by a token on another, with the condition math the contributor read, the throw's modifiers and what the roller was told. */
    H.attack = async (aTok, vTok, kind) => {
      canvas.tokens.setTargets([vTok.id], { mode: "replace" });
      await H.sleep(120);
      const actor = aTok.actor;
      const item = actor.items.find((i) => i.type === "weapon");
      const mark = H.seen.length;
      const said = H.said.length;
      const sent = H.posted.length;
      const o = await actor.makeAttackThrow({ item, attackType: kind, skipDialog: true });
      for (let n = 0; n < 30 && (H.posted.length === sent || H.seen.length === mark); n++) await H.sleep(100);
      const math = H.seen.slice(mark).find((s) => s.actor === actor.uuid)?.math?.[kind] ?? null;
      const terms = math?.terms ?? [];
      return {
        rolled: !!o,
        kindOk: !!math && math.kind === kind,
        defending: terms.filter((t) => t.condition === "defending" && t.side === "target").map((t) => Number(t.value)),
        otherTerms: terms.filter((t) => t.condition !== "defending").length,
        pending: (math?.pending ?? []).map((p) => ({ condition: p.condition, when: p.when })),
        unpriced: math?.unpriced ?? [],
        labelled: (o?.result?.attack?.modifiers ?? []).filter((m) => m.label === H.names.target).map((m) => Number(m.value)),
        notices: H.said.slice(said),
        card: H.posted[sent] ?? null,
      };
    };
    /** One Blast saving throw: the number it had to reach, and what the roller was told. */
    H.save = async (actor) => {
      const skip = game.settings.get("acks", "skip-dialog-key");
      const mark = H.said.length;
      const r = await actor.rollSave("blast", { event: { [skip]: true } });
      await H.sleep(200);
      return { total: Number(r?.total), target: Number(r?.data?.roll?.target), notices: H.said.slice(mark) };
    };
    /** The three attacks and the Blast save against a victim, and what the conditions' own readers say of it. */
    H.measure = async (aTok, vTok) => {
      const actor = vTok.actor;
      const kinds = {};
      for (const kind of ["missile", "thrown", "melee"]) kinds[kind] = await H.attack(aTok, vTok, kind);
      canvas.tokens.setTargets([]);
      const blast = await H.save(actor);
      const subject = CL.subjectOf(actor);
      const math = CL.rollMath("save", subject, undefined, { save: "blast" });
      return {
        kinds, blast,
        blastMath: { parts: math.parts, pending: math.pending.map((p) => ({ condition: p.condition, when: p.when })), unpriced: math.unpriced },
        shield: subject.shield,
        statuses: [...actor.statuses].sort(),
      };
    };

    return {
      user: game.user.name, isGM: game.user.isGM,
      activeGMIsSelf: !!game.users.activeGM?.isSelf,
      names: H.names,
      namesRead: Object.values(H.names).every((n) => typeof n === "string" && n !== "" && !n.startsWith("ACKS-")),
    };
  },

  /** View the scene before any token is made on it. */
  view: async ({ sceneId }) => {
    const scene = game.scenes.get(sceneId);
    if (scene && canvas.scene?.id !== sceneId) {
      await scene.view();
      await new Promise((r) => setTimeout(r, 1500));
    }
    return { viewing: canvas.scene?.id === sceneId };
  },

  /** What the world holds for Defending, then this client's invented figures registered above it. */
  price: async ({ figures }) => {
    const CL = acksExtras.lib.conditions;
    const T = acksExtras.lib.tables;
    const world = { imported: CL.conditionsReady(), slotsRead: Object.keys(CL.conditionValues().defending ?? {}).length };
    T.registerTable(
      { id: CL.CONDITIONS_DOC, source: "invented", tables: { [CL.CONDITIONS_TABLE]: { defending: figures } } },
      { priority: T.PRIORITY.OVERRIDE + 1, source: "live-test" },
    );
    return { world, read: CL.conditionValues().defending ?? null, ready: CL.conditionsReady(), slots: CL.CONDITION_SLOTS.defending };
  },

  /** Bring the fixtures to the shape a step starts from: no condition effect on any of them, each shield as asked, no target. */
  shape: async ({ tokens, shields }) => {
    const H = globalThis.__ld;
    const lifted = [];
    for (const uuid of tokens) {
      const actor = (await fromUuid(uuid)).actor;
      const ids = actor.effects.filter((e) => e.statuses.size).map((e) => e.id);
      if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
      lifted.push(ids.length);
    }
    const read = [];
    for (const s of shields) read.push(await H.shield(s));
    canvas.tokens.setTargets([]);
    const clean = [];
    for (const uuid of tokens) clean.push([...(await fromUuid(uuid)).actor.statuses].length === 0);
    const blast = [];
    for (const uuid of tokens) blast.push(Number.isFinite(Number((await fromUuid(uuid)).actor.system?.saves?.blast?.value)));
    return { lifted: lifted.reduce((a, b) => a + b, 0), shields: read, clean: clean.every(Boolean), blastStored: blast.every(Boolean) };
  },

  /** One shield read for each combination of equipped and an Armor Class, for one token's actor. */
  grid: async ({ token, marker, acs }) => {
    const H = globalThis.__ld;
    const out = [];
    for (const equipped of [true, false]) {
      for (const ac of acs) {
        const r = await H.shield({ token, marker, equipped, ac });
        out.push({ equipped, ac: r.ac, shield: r.shield });
      }
    }
    return out;
  },

  /** One state of the roll: Defending off then on, with a Blast save before and the three attacks and a save after. */
  state: async ({ victim, attacker }) => {
    const H = globalThis.__ld;
    const vTok = await fromUuid(victim);
    const aTok = await fromUuid(attacker);
    const actor = vTok.actor;
    const shape = [...actor.statuses];
    const shield = H.CL.subjectOf(actor).shield;
    const acShield = Number(actor.system?.ac?.shield);
    const clean = await H.save(actor);
    await actor.toggleStatusEffect("defending", { active: true });
    await H.sleep(400);
    const on = await H.measure(aTok, vTok);
    await actor.toggleStatusEffect("defending", { active: false });
    await H.sleep(400);
    return { name: actor.name, shape, shield, acShield, clean: { target: clean.target }, on, after: [...actor.statuses] };
  },

  /** The tracker on a fixture combat: initiatives written, the round begun, the turn on one row, the tracker rendered on it. */
  fight: async ({ combatId, rows, inits, upKey }) => {
    const combat = game.combats.get(combatId);
    await combat.update({ "flags.acks.initDone": true, "flags.acks.lock-turns": false, "flags.acks.groups": [] });
    await combat.updateEmbeddedDocuments("Combatant", Object.keys(rows).map((k) => ({ _id: rows[k], initiative: inits[k], defeated: false, hidden: false })));
    combat.setupTurns();
    if (!combat.active && typeof combat.activate === "function") await combat.activate();
    await combat.update({ round: 1, turn: combat.turns.findIndex((t) => t.id === rows[upKey]) });
    try { ui.sidebar.changeTab("combat", "primary"); } catch {}
    await ui.combat.render({ combat, force: true });
    for (let n = 0; n < 40 && game.combat?.id !== combat.id; n++) await new Promise((r) => setTimeout(r, 150));
    return {
      viewed: game.combat?.id === combat.id, active: !!combat.active, round: combat.round, turn: combat.turn,
      up: combat.combatant?.name ?? null, upRow: combat.combatant?.id ?? null, order: combat.turns.map((t) => t.name),
    };
  },

  /** A Defend given on another combatant's turn: the shields set, the turn put on the giver, Hero marked, and the roll read. */
  given: async ({ victim, attacker, combatId, giverRow, shields }) => {
    const H = globalThis.__ld;
    const CL = H.CL;
    const combat = game.combats.get(combatId);
    for (const s of shields) await H.shield(s);
    const turn = combat.turns.findIndex((t) => t.id === giverRow);
    if (combat.turn !== turn) {
      await combat.update({ turn });
      await H.sleep(500);
    }
    const vTok = await fromUuid(victim);
    const aTok = await fromUuid(attacker);
    const actor = vTok.actor;
    const shape = [...actor.statuses];
    const clean = await H.save(actor);
    await actor.toggleStatusEffect("defending", { active: true });
    await H.sleep(500);
    const effect = actor.effects.find((e) => e.statuses.has("defending")) ?? null;
    const subject = CL.subjectOf(actor);
    const gift = subject.gifts.defending ?? null;
    const giver = effect ? CL.giverOf(effect, actor) : null;
    const start = effect?.start ?? null;
    const on = await H.measure(aTok, vTok);
    await actor.toggleStatusEffect("defending", { active: false });
    await H.sleep(400);
    return {
      shape, clean: { target: clean.target }, on, after: [...actor.statuses],
      up: combat.combatant?.name ?? null, upRow: combat.combatant?.id ?? null, viewed: game.combat?.id === combat.id,
      startCombat: start?.combat?.id ?? (typeof start?.combat === "string" ? start.combat : null),
      startCombatant: start?.combatant ?? null, startInitiative: start?.initiative ?? null,
      giverRow: giver?.id ?? null,
      gift: gift ? { shield: gift.shield, statuses: [...gift.statuses].sort() } : null,
      heroShield: subject.shield,
    };
  },

  /** The retired id on Hero: a clean Blast save first, then an effect that holds it, and the icons the token draws. */
  retiredMake: async ({ hero, id }) => {
    const H = globalThis.__ld;
    const tok = await fromUuid(hero);
    const actor = tok.actor;
    const clean = await H.save(actor);
    const icons0 = H.icons(tok);
    const [made] = await actor.createEmbeddedDocuments("ActiveEffect", [{ name: "Defend Walk Retired Id", statuses: [id] }]);
    await H.sleep(600);
    return { uuid: made.uuid, effectId: made.id, clean: { target: clean.target }, icons0, icons1: H.icons(tok), held: actor.statuses.has(id) };
  },

  /** The retired id's effect on Hero while the attacks and the save roll, and what the page logged meanwhile. */
  retiredRead: async ({ hero, attacker, id, effectId }) => {
    const H = globalThis.__ld;
    const tok = await fromUuid(hero);
    const aTok = await fromUuid(attacker);
    const actor = tok.actor;
    const mark = H.errors.length;
    const on = await H.measure(aTok, tok);
    await H.sleep(300);
    return {
      on, errors: H.errors.slice(mark),
      inPalette: CONFIG.statusEffects.some((s) => s.id === id),
      inCatalogue: Object.hasOwn(H.CL.CONDITIONS, id),
      effectStands: actor.effects.has(effectId), held: actor.statuses.has(id), icons: H.icons(tok),
      img: actor.effects.get(effectId)?.img ?? null,
    };
  },

  /** Hero after the retired effect is removed by hand. */
  retiredAfter: async ({ hero, id, effectId }) => {
    const H = globalThis.__ld;
    const tok = await fromUuid(hero);
    await H.sleep(500);
    return { held: tok.actor.statuses.has(id), effectStands: tok.actor.effects.has(effectId), icons: H.icons(tok) };
  },

  /** The uuids of every card this client asked Foundry to post, for the sweep. */
  drain: async () => ({ posted: globalThis.__ld?.posted?.slice() ?? [] }),

  /** End this client's invented figures at the priority they were registered under, and take the recorders down. */
  restore: async () => {
    const H = globalThis.__ld;
    const T = acksExtras.lib.tables;
    const CL = acksExtras.lib.conditions;
    const ended = T.unregisterTable(CL.CONDITIONS_DOC, { priority: T.PRIORITY.OVERRIDE + 1 });
    H?.disarm?.();
    globalThis.__ld = null;
    return { figuresEnded: ended, recordersDown: !!H };
  },
};

async function run(api, fn, arg) {
  const text = await api.eval(`(${fn.toString()})(${JSON.stringify(arg ?? null)}).then((v) => JSON.stringify(v === undefined ? null : v))`, 120000);
  return JSON.parse(text);
}
async function ready(api, label, seconds = 120) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.lib`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}

let gm = null;
const swept = [];
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 570_000);
setTimeout(() => {
  console.error(`WALK ERROR: wall clock of ${WALL_MS} ms reached; closing the seat`);
  try { gm?.close(); } catch {}
  process.exit(1);
}, WALL_MS).unref();
try {
  section("seat");
  gm = await connect({ browser, origin, user: SEATS.gm, port: PORTS.gm, own: MACHINE.own });
  note("gm ready after (s)", await ready(gm, "gm"));
  const g = await run(gm, P.install);
  check("the seat is a GM and the active GM, and the lang the notices are matched by resolves", g.isGM && g.activeGMIsSelf && g.namesRead, { activeGM: g.activeGMIsSelf, names: g.namesRead });
  if (!g.activeGMIsSelf) blocked("another client is the active GM; the automation would run there");
  const NAMES = g.names;

  section("fixtures");
  const scene = await gm.fixture("lib/defend-scene", "Scene", { name: "Defend Shield Probe", width: 1200, height: 800, grid: { size: 100 } });
  const viewing = await run(gm, P.view, { sceneId: scene.id });
  if (!viewing.viewing) blocked("the fixture scene could not be viewed on the GM seat");
  const hero = await gm.fixture("lib/defend-hero", "Actor", { name: "Defend Hero", type: "character" });
  const guard = await gm.fixture("lib/defend-guard", "Actor", { name: "Defend Guard", type: "character" });
  const raider = await gm.fixture("lib/defend-raider", "Actor", { name: "Defend Raider", type: "character" });
  const goblin = await gm.fixture("lib/defend-goblin", "Actor", { name: "Defend Goblin", type: "monster" });
  const heroShield = await gm.fixture("lib/defend-hero-shield", "Item", shield("Defend Hero Shield"), { parent: hero.uuid });
  const guardShield = await gm.fixture("lib/defend-guard-shield", "Item", shield("Defend Guard Shield"), { parent: guard.uuid });
  await gm.fixture("lib/defend-raider-weapon", "Item", weapon(), { parent: raider.uuid });
  const heroTok = await gm.fixture("lib/defend-hero-token", "Token", { name: "Defend Hero", actorId: hero.id, actorLink: true, x: 500, y: 300 }, { parent: scene.uuid });
  const guardTok = await gm.fixture("lib/defend-guard-token", "Token", { name: "Defend Guard", actorId: guard.id, actorLink: true, x: 700, y: 300 }, { parent: scene.uuid });
  const raiderTok = await gm.fixture("lib/defend-raider-token", "Token", { name: "Defend Raider", actorId: raider.id, actorLink: true, x: 900, y: 300 }, { parent: scene.uuid });
  const goblinTok = await gm.fixture("lib/defend-goblin-token", "Token", { name: "Defend Goblin", actorId: goblin.id, actorLink: false, x: 300, y: 300 }, { parent: scene.uuid });
  const goblinShieldMarker = marked("lib/defend-goblin-shield");
  const tokens = [heroTok.uuid, guardTok.uuid, raiderTok.uuid, goblinTok.uuid];

  section("figures");
  const priced = await run(gm, P.price, { figures: FIGURES });
  note("the world's conditions document (before the walk's figures)", { imported: priced.world.imported, defendingSlotsRead: priced.world.slotsRead });
  check("Defending's four invented figures read back from the registry above whatever the world imported, under the slots the catalogue names", priced.ready && same(priced.read, FIGURES) && same([...priced.slots].sort(), Object.keys(FIGURES).sort()), { read: priced.read, slots: priced.slots });

  /** Bring every fixture to a step's shape and say whether each shield reads as asked. */
  const shapes = [];
  const shape = async (label, { hero: h, guard: gd, goblin: gb }) => {
    const r = await run(gm, P.shape, {
      tokens,
      shields: [
        { token: heroTok.uuid, marker: heroShield.marker, equipped: h },
        { token: guardTok.uuid, marker: guardShield.marker, equipped: gd },
        { token: goblinTok.uuid, marker: goblinShieldMarker, equipped: gb, data: shield("Defend Goblin Shield") },
      ],
    });
    const want = [h, gd, gb];
    const ok = r.clean && r.blastStored && r.shields.every((s, i) => s.found && s.type === "shield" && s.equipped === want[i] && s.ac === 0);
    shapes.push([label, ok]);
    note(`shape (${label})`, { lifted: r.lifted, cleanOfConditions: r.clean, shields: r.shields.map((s) => ({ marker: s.marker, built: s.built, equipped: s.equipped })) });
    return r;
  };
  /** The attack reads every kind asked and every roll resolved. */
  const reads = [];
  const sound = (label, on) => reads.push([label, KINDS.every((k) => on.kinds[k].rolled && on.kinds[k].kindOk) && Number.isFinite(on.blast.target)]);

  const carries = (on) => KINDS.every((k) => same(on.kinds[k].defending, [-FIGURES[k]]));
  const meleeOnly = (on) => same(on.kinds.melee.defending, [-FIGURES.melee]) && !on.kinds.missile.defending.length && !on.kinds.thrown.defending.length;
  const noRows = (on) => KINDS.every((k) => !on.kinds[k].defending.length);
  const blastBy = (s) => s.on.blast.target - s.clean.target;
  const terms = (on) => Object.fromEntries(KINDS.map((k) => [k, on.kinds[k].defending]));
  const told = (notices) => notices.filter((n) => n.kind === "info" && n.text.includes(NAMES.defending) && n.text.includes(NAMES.whenShield)).length;
  const toldAll = (on) => Object.fromEntries([...KINDS.map((k) => [k, told(on.kinds[k].notices)]), ["blast", told(on.blast.notices)]]);
  const namedAny = (on) => [...KINDS.flatMap((k) => on.kinds[k].notices), ...on.blast.notices].filter((n) => n.text.includes(NAMES.defending)).length;
  const nothingWaits = (on) => KINDS.every((k) => !on.kinds[k].pending.length && !on.kinds[k].unpriced.length) && !on.blastMath.pending.length && !on.blastMath.unpriced.length;
  const onThrow = (on) => KINDS.every((k) => same(on.kinds[k].labelled, on.kinds[k].defending));
  const lone = (s) => s.shape.length === 0 && same(s.on.statuses, ["defending"]) && s.after.length === 0;

  section("21a. Hero holds an equipped shield, and again with it carried");
  const grid = await run(gm, P.grid, { token: heroTok.uuid, marker: heroShield.marker, acs: [0, SET_AC] });
  note("Hero's shield reading by equipped and Armor Class", grid);
  await shape("Hero equipped", { hero: true, guard: false, goblin: false });
  const E = await run(gm, P.state, { victim: heroTok.uuid, attacker: raiderTok.uuid });
  sound("Hero equipped", E.on);
  note("Hero equipped", { shield: E.shield, acShield: E.acShield, terms: terms(E.on), blastMoved: blastBy(E), told: toldAll(E.on) });
  check("21: equipped, Hero's terms carry Defending's missile, thrown and melee figures, once each", carries(E.on), terms(E.on));
  check("21: equipped, Hero's Blast target moves by the Blast figure", blastBy(E) === -FIGURES.blast, { moved: blastBy(E) });

  await shape("Hero carried", { hero: false, guard: false, goblin: false });
  const U = await run(gm, P.state, { victim: heroTok.uuid, attacker: raiderTok.uuid });
  sound("Hero carried", U.on);
  note("Hero carried", { shield: U.shield, terms: terms(U.on), blastMoved: blastBy(U), told: toldAll(U.on) });
  check(
    "21: Hero's shield reads true while equipped and false when carried, its Armor Class blank or set",
    grid.length === 4 && grid.every((r) => r.shield === r.equipped) && new Set(grid.map((r) => r.ac)).size === 2 && E.shield === true && E.on.shield === true && U.shield === false && U.on.shield === false,
    { grid, equipped: E.shield, carried: U.shield },
  );
  check("21: unequipped, Hero's terms carry the melee figure only, and the Blast target does not move", meleeOnly(U.on) && blastBy(U) === 0, { terms: terms(U.on), moved: blastBy(U) });
  check("21: unequipped, no notice names Defending and nothing is left pending or unpriced", namedAny(U.on) === 0 && nothingWaits(U.on), { named: namedAny(U.on), pending: !nothingWaits(U.on) });

  section("21b. the Goblin token, with no equipped shield and then with one on its own actor");
  await shape("Goblin without", { hero: false, guard: false, goblin: false });
  const G0 = await run(gm, P.state, { victim: goblinTok.uuid, attacker: raiderTok.uuid });
  sound("Goblin without", G0.on);
  note("Goblin without", { shield: G0.shield, terms: terms(G0.on), blastMoved: blastBy(G0), told: toldAll(G0.on), pending: G0.on.kinds.missile.pending });
  check("21: the Goblin token's shield reads null", G0.shield === null && G0.on.shield === null, { shield: G0.shield });
  check("21: the Goblin token takes the melee figure only", meleeOnly(G0.on), terms(G0.on));
  check(
    "21: each missile attack and Blast save on the Goblin token raises an info notice naming Defending and where an equipped shield is held, and applies nothing",
    told(G0.on.kinds.missile.notices) === 1 && told(G0.on.blast.notices) === 1 && blastBy(G0) === 0 && !G0.on.kinds.missile.defending.length
      && G0.on.kinds.missile.pending.some((p) => p.condition === "defending") && G0.on.blastMath.pending.some((p) => p.condition === "defending"),
    { told: toldAll(G0.on), moved: blastBy(G0) },
  );
  await shape("Goblin equipped on its own actor", { hero: false, guard: false, goblin: true });
  const G1 = await run(gm, P.state, { victim: goblinTok.uuid, attacker: raiderTok.uuid });
  sound("Goblin equipped", G1.on);
  note("Goblin equipped", { shield: G1.shield, terms: terms(G1.on), blastMoved: blastBy(G1), told: toldAll(G1.on) });
  check("21: equipped on the token's own actor, the Goblin's rows apply and its Blast target moves by the Blast figure", G1.shield === true && carries(G1.on) && blastBy(G1) === -FIGURES.blast, { shield: G1.shield, terms: terms(G1.on), moved: blastBy(G1) });
  check("21: equipped on the token's own actor, the notice stops", Object.values(toldAll(G1.on)).every((n) => n === 0) && nothingWaits(G1.on), toldAll(G1.on));
  gap("21: the shield equipped from the token's own sheet", "the walk writes system.equipped on the token's actor item, which is the field the sheet's control writes; the click itself is not driven");

  section("21c. a Defend given on Guard's turn");
  await shape("given, Guard holds the shield", { hero: false, guard: true, goblin: false });
  const combat = await gm.create("Combat", { scene: scene.id, active: true });
  swept.push(combat.uuid);
  const rowHero = await gm.create("Combatant", { tokenId: heroTok.id, sceneId: scene.id, actorId: hero.id }, { parent: combat.uuid });
  swept.push(rowHero.uuid);
  const rowGuard = await gm.create("Combatant", { tokenId: guardTok.id, sceneId: scene.id, actorId: guard.id }, { parent: combat.uuid });
  swept.push(rowGuard.uuid);
  const fightIds = [combat.uuid, rowHero.uuid, rowGuard.uuid];
  const fight = await run(gm, P.fight, { combatId: combat.id, rows: { hero: rowHero.id, guard: rowGuard.id }, inits: { hero: 6, guard: 12 }, upKey: "guard" });
  note("the fixture combat", fight);
  check("21: the fixture combat is the tracker's own, in round 1 with Guard's turn up", fight.viewed && fight.round === 1 && fight.upRow === rowGuard.id, { viewed: fight.viewed, round: fight.round, up: fight.up });
  const heroGuardShield = [
    { token: heroTok.uuid, marker: heroShield.marker, equipped: false },
    { token: guardTok.uuid, marker: guardShield.marker, equipped: true },
  ];
  const D1 = await run(gm, P.given, { victim: heroTok.uuid, attacker: raiderTok.uuid, combatId: combat.id, giverRow: rowGuard.id, shields: heroGuardShield });
  sound("given, Guard holds", D1.on);
  note("given, Guard holds it and Hero does not", { up: D1.up, viewed: D1.viewed, startCombatant: D1.startCombatant === rowGuard.id, startInitiative: D1.startInitiative !== null, gift: D1.gift, heroShield: D1.heroShield, terms: terms(D1.on), blastMoved: blastBy(D1), told: toldAll(D1.on) });
  check(
    "21: the Defend is a given one: made in the fixture combat on Guard's turn, its start names Guard's row and an initiative, and Guard's combatant is its giver",
    D1.viewed && D1.upRow === rowGuard.id && D1.startCombat === combat.id && D1.startCombatant === rowGuard.id && D1.startInitiative !== null && D1.giverRow === rowGuard.id && D1.gift !== null,
    { up: D1.up, startCombat: D1.startCombat === combat.id, startCombatant: D1.startCombatant === rowGuard.id, startInitiative: D1.startInitiative !== null, giver: D1.giverRow === rowGuard.id },
  );
  check("21: given with Guard holding the shield and Hero not, gifts.defending.shield is Guard's true and the rows apply", D1.gift?.shield === true && D1.heroShield === false && carries(D1.on) && blastBy(D1) === -FIGURES.blast, { gift: D1.gift?.shield, hero: D1.heroShield, terms: terms(D1.on), moved: blastBy(D1) });
  const D2 = await run(gm, P.given, {
    victim: heroTok.uuid, attacker: raiderTok.uuid, combatId: combat.id, giverRow: rowGuard.id,
    shields: [{ token: heroTok.uuid, marker: heroShield.marker, equipped: true }, { token: guardTok.uuid, marker: guardShield.marker, equipped: false }],
  });
  sound("given, Hero holds", D2.on);
  note("given, Hero holds it and Guard does not", { up: D2.up, startCombatant: D2.startCombatant === rowGuard.id, gift: D2.gift, heroShield: D2.heroShield, terms: terms(D2.on), blastMoved: blastBy(D2), told: toldAll(D2.on) });
  check("21: given with Hero holding the shield and Guard not, gifts.defending.shield is Guard's false: the melee row only, nothing told and the Blast target still", D2.startCombatant === rowGuard.id && D2.gift?.shield === false && D2.heroShield === true && meleeOnly(D2.on) && blastBy(D2) === 0 && namedAny(D2.on) === 0 && nothingWaits(D2.on), { gift: D2.gift?.shield, hero: D2.heroShield, terms: terms(D2.on), moved: blastBy(D2), named: namedAny(D2.on) });
  const swCombat = await gm.sweepTracked({ only: fightIds });
  for (const uuid of fightIds) swept.splice(swept.indexOf(uuid), 1);
  note("sweep (the combat)", { removed: swCombat.removed.length, missing: swCombat.missing.length, failed: swCombat.failed.map((e) => ({ uuid: e.uuid, error: e.error })) });

  section("21d. the retired id");
  await shape("retired id, Hero equipped", { hero: true, guard: false, goblin: false });
  const made = await run(gm, P.retiredMake, { hero: heroTok.uuid, id: RETIRED });
  swept.push(gm.track(made.uuid));
  const R = await run(gm, P.retiredRead, { hero: heroTok.uuid, attacker: raiderTok.uuid, id: RETIRED, effectId: made.effectId });
  sound("retired id", R.on);
  note("retired id", { icons: [made.icons0, made.icons1, R.icons], held: R.held, inPalette: R.inPalette, inCatalogue: R.inCatalogue, errors: R.errors, terms: terms(R.on), others: KINDS.map((k) => R.on.kinds[k].otherTerms), blastMoved: R.on.blast.target - made.clean.target });
  check("21: the retired id contributes no term and moves no Blast target", noRows(R.on) && KINDS.every((k) => R.on.kinds[k].otherTerms === 0) && R.on.blast.target === made.clean.target && !R.inPalette && !R.inCatalogue && made.held, { terms: terms(R.on), moved: R.on.blast.target - made.clean.target, inPalette: R.inPalette, inCatalogue: R.inCatalogue });
  check("21: the retired id logs no error while Hero is attacked and rolls its Blast save", R.errors.length === 0, R.errors);
  check("21: the retired id's icon stays on Hero until it is removed by hand", R.effectStands && R.held && R.icons !== null && R.icons === made.icons1 && made.icons1 === made.icons0 + 1 && !!R.img, { icons: [made.icons0, made.icons1, R.icons], img: !!R.img });
  const swEffect = await gm.sweepTracked({ only: [made.uuid] });
  swept.splice(swept.indexOf(made.uuid), 1);
  note("sweep (the retired id's effect)", { removed: swEffect.removed.length, missing: swEffect.missing.length, failed: swEffect.failed.map((e) => ({ uuid: e.uuid, error: e.error })) });
  const after = await run(gm, P.retiredAfter, { hero: heroTok.uuid, id: RETIRED, effectId: made.effectId });
  check("21: removed by hand, the retired id's effect and its icon are gone", !after.held && !after.effectStands && after.icons === made.icons0, { icons: [made.icons0, after.icons] });

  section("the walk's own conditions");
  check("21 (setup): every step began with every condition off the fixtures, each shield as set, and a numeric stored Blast target", shapes.every(([, ok]) => ok), shapes.filter(([, ok]) => !ok).map(([l]) => l));
  check("21 (setup): every state held Defending alone while it rolled, and lifted it after", lone(E) && lone(U) && lone(G0) && lone(G1) && same(D1.on.statuses, ["defending"]) && D1.shape.length === 0 && D1.after.length === 0 && same(D2.on.statuses, ["defending"]) && D2.shape.length === 0 && D2.after.length === 0 && R.on.statuses.length === 1, { states: [E, U, G0, G1].map(lone) });
  check("21 (setup): every attack was read as the kind it asked for, and every roll resolved", reads.every(([, ok]) => ok), reads.filter(([, ok]) => !ok).map(([l]) => l));
  check("21 (setup): wherever Defending's rows applied, the throw's own modifiers carry each term once under Defending's target name", onThrow(E.on) && onThrow(G1.on) && onThrow(D1.on) && onThrow(U.on) && onThrow(D2.on), { E: onThrow(E.on), G1: onThrow(G1.on), D1: onThrow(D1.on) });
  walkDone();
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  try {
    if (gm) {
      await sleep(600);
      const { posted } = await run(gm, P.drain);
      for (const uuid of posted) swept.push(gm.track(uuid, "ChatMessage"));
      note("cards posted by this client", posted.length);
    }
  } catch (err) { console.error("drain:", err?.message ?? err); }
  try { if (gm) note("restored", await run(gm, P.restore)); } catch (err) { console.error("restore:", err?.message ?? err); }
  try {
    if (gm && swept.length) {
      const sw = await gm.sweepTracked({ only: swept });
      note("sweep (gm)", { removed: sw.removed.length, missing: sw.missing.map((e) => e.uuid), failed: sw.failed.map((e) => ({ uuid: e.uuid, error: e.error })) });
    }
  } catch (err) { console.error("sweep:", err?.message ?? err); }
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
