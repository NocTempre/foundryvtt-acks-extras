/**
 * Live walk, equipment-ability-training: the proficiency gate honours the
 * weapon training an imported proficiency item states. Walks
 * docs/equipment/TESTING.md step 3e on the GM seat: a character whose class
 * training declares one weapon class, holding a sword, with a weapon
 * proficiency ability whose pick covers swords, attacks through the
 * system's own attack throw with no Non-proficient row, and its Training
 * pill for swords is lit; with the pick moved to another class the pill goes
 * dark and the same attack carries the row; with the pick back the row is
 * gone again. Only presence is asserted, never the row's size. Machine
 * values arrive through ./_env.mjs.
 *
 * Fixture, kept and found by marker: `equipment/ability-training`, a
 * character carrying a training effect that declares one weapon class, an
 * equipped sword, and a weapon-proficiency ability as the ability sheet
 * writes one (`flags.acks-extras.extras`: category and picks). Each run
 * brings it to that shape before its first check. The attack cards the walk
 * posts are its own and are swept by id.
 */
import { connect, sleep } from "./_driver.mjs";
import { walkDone } from "./_walk.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const MARKER = "equipment/ability-training";
const COVERS = ["Swords & Daggers"];
const MISSES = ["Bows"];

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

const FIXTURE = {
  name: "Walk: ability training",
  type: "character",
  system: { scores: { str: { value: 16 } } },
  items: [
    { name: "Sword", type: "weapon", system: { equipped: true, damage: { base: { formula: "1d6" } } } },
    { name: "Weapon Proficiency", type: "ability", flags: { "acks-extras": { extras: { category: "weaponProficiency", selections: COVERS } } } },
  ],
  effects: [{ name: "Walk: declared weapon class", changes: [{ key: "flags.acks-extras.weaponProf", type: "add", mode: 2, value: "axe" }] }],
};

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in the seat's page. */
/* ------------------------------------------------------------------ */
const P = {
  install: async () => {
    const H = (globalThis.__at = globalThis.__at ?? {});
    H.L = await import("/modules/acks-extras/scripts/equipment/loadout.mjs");
    H.S = await import("/modules/acks-extras/scripts/lib/proficiency-strip.mjs");
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    if (!H.patched) {
      H.patched = true;
      H.errors = [];
      H.cards = [];
      H.consoleError = console.error;
      console.error = (...args) => { H.errors.push(args.map((a) => a?.message ?? String(a)).join(" ").slice(0, 300)); H.consoleError(...args); };
      H.hook = Hooks.on("createChatMessage", (m) => H.cards.push({ id: m.id, actor: m.speaker?.actor ?? null }));
    }
    return { isGM: game.user.isGM, activeGMIsSelf: !!game.users.activeGM?.isSelf };
  },
  setting: async ({ value }) => {
    const prior = game.settings.get("acks-extras", "proficiencyEnforcement");
    if (value != null && value !== prior) await game.settings.set("acks-extras", "proficiencyEnforcement", value);
    return prior;
  },
  /** The fixture's known shape: the sword equipped, the declared class, the pick given, a positive Strength. */
  shape: async ({ actorId, picks }) => {
    const actor = game.actors.get(actorId);
    const sword = actor.items.find((i) => i.type === "weapon");
    const ability = actor.items.find((i) => i.type === "ability" && i.getFlag("acks-extras", "extras")?.category === "weaponProficiency");
    const effect = actor.effects.find((e) => (e.changes ?? []).some((c) => c.key === "flags.acks-extras.weaponProf"));
    if (!sword || !ability || !effect) return { shaped: false, sword: !!sword, ability: !!ability, effect: !!effect };
    if (!sword.system.equipped) await sword.update({ "system.equipped": true });
    if (effect.disabled) await effect.update({ disabled: false });
    if (Number(actor.system.scores?.str?.value) !== 16) await actor.update({ "system.scores.str.value": 16 });
    await ability.update({ "flags.acks-extras.extras.selections": picks });
    await globalThis.__at.sleep(400);
    return { shaped: true, picks: ability.getFlag("acks-extras", "extras")?.selections ?? [] };
  },
  /** The gate, the pill, and one real attack through the system's attack throw. */
  attack: async ({ actorId }) => {
    const H = globalThis.__at;
    const actor = game.actors.get(actorId);
    const sword = actor.items.find((i) => i.type === "weapon");
    const label = game.i18n.has("ACKS-EQUIPMENT.attack.nonProficient") ? game.i18n.localize("ACKS-EQUIPMENT.attack.nonProficient") : "Non-proficient";
    const loadout = H.L.getLoadout(actor);
    const pill = H.S.profileStrips(actor).weapons.find((w) => w.key === "sworddagger");
    const before = H.cards.length;
    const outcome = await actor.makeAttackThrow({ item: sword, attackType: "melee", skipDialog: true });
    for (let n = 0; n < 20 && H.cards.length === before; n++) await H.sleep(150);
    const card = H.cards.slice(before).find((c) => c.actor === actorId);
    const content = card ? String(game.messages.get(card.id)?.content ?? "") : "";
    const mods = outcome?.result?.attack?.modifiers ?? [];
    return {
      rolled: !!outcome,
      nonProficientUse: !!loadout.nonProficientUse,
      pillOn: !!pill?.on,
      row: mods.some((m) => m.label === label),
      cardRow: content.includes(label),
      cardId: card?.id ?? null,
    };
  },
  drain: async () => ({ errors: globalThis.__at.errors.slice() }),
  restore: async () => {
    const H = globalThis.__at;
    if (!H?.patched) return "never installed";
    console.error = H.consoleError;
    Hooks.off("createChatMessage", H.hook);
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

let gm = null;
let priorMode = null;
const cards = [];
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 300_000);
setTimeout(() => {
  console.error(`WALK ERROR: wall clock of ${WALL_MS} ms reached; closing the seat`);
  try { gm?.close(); } catch {}
  process.exit(1);
}, WALL_MS).unref();

try {
  section("seat");
  gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  note("gm ready after (s)", await ready(gm, "gm"));
  const installed = await run(gm, P.install);
  check("the GM seat is the active GM", installed.isGM && installed.activeGMIsSelf, installed);
  priorMode = await run(gm, P.setting, { value: "on" });
  note("enforcement before the walk", priorMode);

  section("fixture");
  const fixture = await gm.fixture(MARKER, "Actor", FIXTURE);
  const actorId = fixture.id ?? String(fixture.uuid).split(".").pop();
  const shaped = await run(gm, P.shape, { actorId, picks: COVERS });
  check("shape: the declared class, the equipped sword and a pick covering swords", shaped.shaped, shaped);

  section("3e. a pick that covers the weapon");
  const covered = await run(gm, P.attack, { actorId });
  if (covered.cardId) cards.push(covered.cardId);
  check("the Training pill for swords is lit and the loadout is not the non-proficient package", covered.pillOn && !covered.nonProficientUse, { pillOn: covered.pillOn, nonProficientUse: covered.nonProficientUse });
  check("the system's attack throw carries no Non-proficient row, on the roll or its card", covered.rolled && !covered.row && covered.cardId && !covered.cardRow, { rolled: covered.rolled, row: covered.row, card: !!covered.cardId, cardRow: covered.cardRow });

  section("3e. the pick moved to a class that misses it");
  await run(gm, P.shape, { actorId, picks: MISSES });
  const missed = await run(gm, P.attack, { actorId });
  if (missed.cardId) cards.push(missed.cardId);
  check("the pill goes dark and the loadout is the non-proficient package", !missed.pillOn && missed.nonProficientUse, { pillOn: missed.pillOn, nonProficientUse: missed.nonProficientUse });
  check("the same attack carries the Non-proficient row, on the roll and its card", missed.rolled && missed.row && missed.cardRow, { rolled: missed.rolled, row: missed.row, cardRow: missed.cardRow });

  section("3e. the pick back");
  await run(gm, P.shape, { actorId, picks: COVERS });
  const back = await run(gm, P.attack, { actorId });
  if (back.cardId) cards.push(back.cardId);
  check("with the pick back the row is gone again", back.rolled && !back.row && back.pillOn, { row: back.row, pillOn: back.pillOn });

  const drained = await run(gm, P.drain);
  check("no console error over the walk", !drained.errors.length, drained.errors.slice(0, 3));
  walkDone();
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  if (gm && priorMode != null && priorMode !== "on") {
    try { await run(gm, P.setting, { value: priorMode }); note("enforcement restored", priorMode); } catch (err) { console.error("setting restore:", err?.message ?? err); }
  }
  if (gm && cards.length) {
    try {
      for (const id of cards) await gm.track(id, "ChatMessage");
      note("cards swept", await gm.sweepTracked({ only: cards.map((id) => `ChatMessage.${id}`) }));
    } catch (err) { console.error("card sweep:", err?.message ?? err); }
  }
  try { if (gm) note("restored", await run(gm, P.restore)); } catch (err) { console.error("restore:", err?.message ?? err); }
  console.log(`fixture kept: ${MARKER}`);
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
