/**
 * Live walk, magic-cast-saves: the cast engine's save-side surfaces of slice S4
 * and the cast dialog's save band (docs/magic/TESTING.md, "Saves, gates and
 * record lives (S4)"), walked on the GM seat. The spells the walk casts are
 * invented world spells on invented names, each rewritten at its step from rows
 * the walk authors (`spellFlag`, `rowOf`): the figures are the walk's own and no
 * book word or printed figure is in it. A first stage imports ten register
 * spells through the importer when the seat's RR is open and checks the KINDS
 * of the rows they carry (never a figure); with the RR closed it prints SKIP.
 *
 * Steps: a strict Hit Dice gate (`target.hdBelow`) refusing a target exactly at
 * the bound, with the bucket row marked off before the cast; a creature-kind
 * filter refusing a target of another kind; a save that negates (passed, then
 * failed) and a spell whose save is `none`; ruling 126's save toggle (off, on,
 * and disabled while the modifier is blank) with the target's save figure moving
 * by the spell's modifier; a slay row (passed, then failed: hit points to zero
 * and the dead status); a destroy row with a weapon picked per holder in the
 * dialog (ruling 124), the picked weapon marked destroyed on the first holder and
 * the default on the second; a lifting row (`conditionRemove`) taking a hand's
 * condition off; a record that ends on damage (and the control that does not);
 * and a following-turn duration, outside a fight (a clock) and inside one (the
 * turn life). Each step asserts the observable: the card's entry, the status on
 * the actor, the mark on the weapon, the hit points, the record's flags.
 *
 * Fixtures, kept and found by marker: `magic/saves-scene`, `magic/saves-class`,
 * `magic/saves-caster` (a character the Player owns), `magic/saves-spell-<slug>`
 * (invented spells on the caster, rewritten at each step), `magic/saves-m-a`,
 * `magic/saves-m-b` (two monsters, linked), and `magic/saves-w-a1`, `-a2`, `-b1`,
 * `-b2` (two weapons on each). The run's own tokens, cards, records, hand-made
 * condition and Combat are tracked by uuid and swept alone; the dice are restored.
 * Machine values arrive through ./_env.mjs. Shots are not taken: the owner's
 * shots are the buffs walk's.
 */
import { connect } from "./_driver.mjs";
import { walkDone, blocked, WalkBlocked } from "./_walk.mjs";
import {
  MACHINE, PORTS, P, note, section, check, gap, skip, idOf, run, ready, ledgerFor, finish, summarize, stage,
  SAVE_TARGET, PASS_SAVE, FAIL_SAVE, LEVEL, flat, rowOf, spellFlag, entryAt, keyOf,
} from "./_magic-cast-kit.mjs";

const { browser, origin } = MACHINE;
const KEY = "magic-cast-saves-walk";
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 1_500_000);
/** The register spells whose row kinds the first stage reads, by cookbook id. */
const REGISTER = ["def.spell.beguileHumanoid", "def.spell.slumber", "def.spell.wordOfCommand", "def.spell.removeFear", "def.spell.destroyDead", "def.spell.shatterBlade", "def.spell.sanctuary"];
/** The invented spells, by marker slug. */
const SLUGS = ["gate", "kind", "negate", "none", "toggle", "slay", "destroy", "lift", "ends", "follow"];

let gm = null;
const ledger = ledgerFor(() => gm);
const W = {};
setTimeout(() => {
  console.error(`WALK ERROR: wall clock of ${WALL_MS} ms reached; closing the seat`);
  try { gm?.close(); } catch {}
  process.exit(1);
}, WALL_MS).unref();

/** Rewrite one invented spell from rows and blocks the step authors; answers what the world stored. */
const shape = (slug, opts, cookbook) => run(gm, P.writeSpell, { casterId: W.caster, itemId: W.spell[slug], flag: spellFlag(opts), cookbook });
/** Put these tokens (by token id) as the seat's targets; the seat must hold exactly them. */
const aim = async (tokens) => {
  const got = await run(gm, P.target, { sceneId: W.scene, tokenIds: tokens.map((t) => t.id) });
  if (!Array.isArray(got) || got.length !== tokens.length) throw new Error(`the seat holds ${JSON.stringify(got)} as targets, not ${tokens.length}`);
};
/** Cast on the GM seat with nothing spent; tracks the card and its cast id. */
async function castAs(slug, o = {}) {
  await run(gm, P.setSpent, { casterId: W.caster });
  const c = await run(gm, P.cast, { casterId: W.caster, spellId: W.spell[slug], ...o });
  if (c.model?.castId) ledger.castIds.push(c.model.castId);
  if (c.messageId) await ledger.track(`ChatMessage.${c.messageId}`, "ChatMessage");
  return c;
}
/** Bring both monsters to a known shape and take the run's records off them, so a step starts clean. */
async function reset({ a = {}, b = {} } = {}) {
  await run(gm, P.clearRecords, { actorIds: [W.actor.a, W.actor.b], castIds: ledger.castIds, casterRe: "^magic/saves-" });
  const shapeOne = (id, o) => run(gm, P.shapeMonster, { actorId: id, hp: o.hp ?? 40, hd: o.hd ?? 2, kinds: o.kinds ?? [], saveTarget: SAVE_TARGET });
  return { a: await shapeOne(W.actor.a, a), b: await shapeOne(W.actor.b, b) };
}
const statusOf = (id) => run(gm, P.statuses, { actorId: id });
const withRig = async (seq, fn) => {
  await run(gm, P.rig, { seq });
  try { return await fn(); } finally { await run(gm, P.rig, {}); }
};

/* ---------------------------- A. setup ------------------------------ */
async function stageSetup() {
  W.playerId = await run(gm, P.userId, { name: MACHINE.player });
  if (!W.playerId) throw new Error("no Player user on this world");
  const scene = await gm.fixture("magic/saves-scene", "Scene", { name: "QA Saves Field", active: false, navigation: true, width: 1400, height: 900, padding: 0, backgroundColor: "#55606b", grid: { type: 1, size: 100, distance: 5, units: "ft" }, tokenVision: false, environment: { globalLight: { enabled: true } }, ownership: { default: 2 } });
  const cls = await gm.fixture("magic/saves-class", "Item", { name: "QA Saves Class", type: "acks-extras.class", system: { key: "qasavesclass", casting: [{ key: "arcane", label: "Arcane", kind: "vancian", slots: [{ atLevel: 1, s1: 9 }] }] } });
  const caster = await gm.fixture("magic/saves-caster", "Actor", { name: "QA Saves Caster", type: "character", prototypeToken: { actorLink: true }, system: { spells: { enabled: true }, hp: { value: 9, max: 9 } }, ownership: { default: 0, [W.playerId]: 3 } });
  W.scene = idOf(scene);
  W.caster = idOf(caster);
  W.spell = {};
  for (const slug of SLUGS) {
    const doc = await gm.fixture(`magic/saves-spell-${slug}`, "Item", { name: `QA Saves spell ${SLUGS.indexOf(slug) + 1}`, type: "spell", system: { lvl: 1 } }, { parent: caster.uuid });
    W.spell[slug] = idOf(doc);
  }
  W.actor = {};
  for (const name of ["a", "b"]) W.actor[name] = idOf(await gm.fixture(`magic/saves-m-${name}`, "Actor", { name: `QA Saves ${name.toUpperCase()}`, type: "monster", prototypeToken: { actorLink: true }, ownership: { default: 0 } }));
  W.weapon = {};
  for (const [holder, ids] of [["a", ["a1", "a2"]], ["b", ["b1", "b2"]]]) {
    for (const id of ids) {
      const parent = holder === "a" ? `Actor.${W.actor.a}` : `Actor.${W.actor.b}`;
      W.weapon[id] = idOf(await gm.fixture(`magic/saves-w-${id}`, "Item", { name: `QA Saves blade ${id}`, type: "weapon", system: { melee: true, damage: { base: { formula: "1d4" } } } }, { parent }));
    }
  }
  await run(gm, P.shapeCaster, { casterId: W.caster, classUuid: cls.uuid, level: LEVEL });
  await reset();
  check("A: the field is viewed", await run(gm, P.view, { sceneId: W.scene }));
  const made = await run(gm, P.placeTokens, { sceneId: W.scene, specs: [{ actorId: W.actor.a, name: "Saves A", x: 300, y: 300 }, { actorId: W.actor.b, name: "Saves B", x: 300, y: 500 }] });
  for (const t of made) await ledger.track(t.uuid, "Token");
  check("A: two linked tokens stand on the field", made.length === 2);
  W.t = { a: made.find((t) => t.actorId === W.actor.a), b: made.find((t) => t.actorId === W.actor.b) };
  await run(gm, P.drain);
}

/* ---------------------------- B. register --------------------------- */
async function stageRegister() {
  const r = await run(gm, P.registerShape, { ids: REGISTER });
  if (!r.rr) { skip("B: the RR is not open on the GM seat, so the register rows are not read"); return; }
  const kindsOf = (id) => r.spells[id]?.kinds ?? [];
  check("B: every register spell the walk names is imported", REGISTER.every((id) => r.spells[id]), REGISTER.filter((id) => !r.spells[id]));
  check("B: the charm-style spell is a condition row a save negates", kindsOf("def.spell.beguileHumanoid").includes("conditionGrant") && r.spells["def.spell.beguileHumanoid"]?.saveEffects.includes("negates"));
  check("B: the sleep-style spell is a condition row with a living filter", kindsOf("def.spell.slumber").includes("conditionGrant") && (r.spells["def.spell.slumber"]?.filters ?? []).length > 0, { filters: r.spells["def.spell.slumber"]?.filters.length });
  check("B: the command spell lasts to the following turn and writes one condition with no clock", r.spells["def.spell.wordOfCommand"]?.lasts.includes("followingTurn") && r.spells["def.spell.wordOfCommand"]?.untimed.length > 0, { rows: kindsOf("def.spell.wordOfCommand").length });
  check("B: the fear-lifting spell has a conditionRemove row that no save governs, and its reverse a condition row", kindsOf("def.spell.removeFear")[0] === "conditionRemove" && r.spells["def.spell.removeFear"].saveEffects[0] === "none" && kindsOf("def.spell.removeFear").includes("conditionGrant"));
  check("B: the destroy-undead spell carries a slay row and the shatter spell a destroyItem row", kindsOf("def.spell.destroyDead").includes("slay") && kindsOf("def.spell.shatterBlade").includes("destroyItem"));
  check("B: the sanctuary spell's ward ends on an attack", r.spells["def.spell.sanctuary"]?.endsOn.includes("attack"));
  note("B: figures the import located (booleans, no figure)", Object.fromEntries(REGISTER.map((id) => [id.split(".").pop(), { hdBelow: r.spells[id]?.hdBelow ?? null, reversedDuration: r.spells[id]?.reversedDuration ?? null }])));
}

/* ---------------------------- C. hd gate ---------------------------- */
async function stageHdGate() {
  await reset({ a: { hd: 3 }, b: { hd: 4 } });
  const wrote = await shape("gate", { rows: [rowOf("bewitch", "conditionGrant", { conditions: ["bewitched"], saveEffect: "negates", lasts: "duration" })], target: { hdBelow: flat(4) } });
  check("C: the spell carries its one condition row", wrote.rows === 1 && wrote.kinds[0] === "conditionGrant");
  await aim([W.t.a, W.t.b]);
  const peek = await run(gm, P.cast, { casterId: W.caster, spellId: W.spell.gate, stop: true });
  const rowOfToken = (t) => peek.bucket.rows.find((r) => r.uuid === t.uuid);
  check("C: before the cast the bucket marks the target at the bound off and the one under it on", peek.dialog && rowOfToken(W.t.b)?.off === true && rowOfToken(W.t.a)?.off === false, { a: rowOfToken(W.t.a)?.off, b: rowOfToken(W.t.b)?.off });
  const c = await withRig(FAIL_SAVE, () => castAs("gate"));
  const ea = entryAt(c.model, W.t.a.uuid, "bewitch");
  const eb = entryAt(c.model, W.t.b.uuid, "bewitch");
  check("C: the target under the bound saved and failed, so its entry is applied and it holds the condition", c.card && c.settled && ea?.state === "applied" && ea.saved === false && (await statusOf(W.actor.a)).includes("bewitched"), { state: ea?.state, saved: ea?.saved });
  check("C: the target at the bound is exempt on the hd gate, makes no save and holds no condition", eb?.state === "exempt" && eb.gate?.key === "hd" && c.model.targets[keyOf(c.model, W.t.b.uuid)]?.resist == null && !(await statusOf(W.actor.b)).includes("bewitched"), { state: eb?.state, gate: eb?.gate?.key });
}

/* ---------------------------- D. kind filter ------------------------ */
async function stageKindFilter() {
  await reset({ a: { hd: 2, kinds: ["undead"] }, b: { hd: 2, kinds: ["animal"] } });
  await shape("kind", { rows: [rowOf("bewitch", "conditionGrant", { conditions: ["bewitched"], saveEffect: "negates", lasts: "duration" })], target: { filters: ["undead"] } });
  await aim([W.t.a, W.t.b]);
  const peek = await run(gm, P.cast, { casterId: W.caster, spellId: W.spell.kind, stop: true });
  check("D: the bucket marks the creature of the wrong kind off", peek.bucket.rows.find((r) => r.uuid === W.t.b.uuid)?.off === true && peek.bucket.rows.find((r) => r.uuid === W.t.a.uuid)?.off === false);
  const c = await withRig(FAIL_SAVE, () => castAs("kind"));
  const ea = entryAt(c.model, W.t.a.uuid, "bewitch");
  const eb = entryAt(c.model, W.t.b.uuid, "bewitch");
  check("D: the undead creature holds the condition", ea?.state === "applied" && (await statusOf(W.actor.a)).includes("bewitched"));
  check("D: the animal is exempt on the kind gate and holds nothing", eb?.state === "exempt" && eb.gate?.key === "kind" && !(await statusOf(W.actor.b)).includes("bewitched"), { gate: eb?.gate?.key });
}

/* ---------------------------- E. save negates / none ---------------- */
async function stageSaves() {
  await reset();
  await shape("negate", { rows: [rowOf("bewitch", "conditionGrant", { conditions: ["bewitched"], saveEffect: "negates", lasts: "duration" })] });
  await aim([W.t.a]);
  const pass = await withRig(PASS_SAVE, () => castAs("negate"));
  const ep = entryAt(pass.model, W.t.a.uuid, "bewitch");
  check("E negates: a passed save writes no record and the entry says it saved", pass.card && ep?.state === "applied" && ep.saved === true && !(ep.recordIds?.length) && !(await statusOf(W.actor.a)).includes("bewitched"), { state: ep?.state, saved: ep?.saved });
  const fail = await withRig(FAIL_SAVE, () => castAs("negate"));
  const ef = entryAt(fail.model, W.t.a.uuid, "bewitch");
  check("E negates: a failed save writes the record and the condition", ef?.state === "applied" && ef.saved === false && ef.recordIds?.length > 0 && (await statusOf(W.actor.a)).includes("bewitched"), { records: ef?.recordIds?.length });
  await reset();
  await shape("none", { rows: [rowOf("bewitch", "conditionGrant", { conditions: ["bewitched"], saveEffect: "none", lasts: "duration" })], save: { category: "none", effect: "none" } });
  const none = await withRig(PASS_SAVE, () => castAs("none"));
  const en = entryAt(none.model, W.t.a.uuid, "bewitch");
  check("E none: a spell whose save is none rolls no throw and still writes the condition", none.card && none.model.targets[keyOf(none.model, W.t.a.uuid)]?.resist == null && en?.state === "applied" && (await statusOf(W.actor.a)).includes("bewitched"), { saved: en?.saved ?? null });
}

/* ---------------------------- F. ruling 126 toggle ------------------- */
async function stageToggle() {
  await reset();
  const MOD = 3;
  await shape("toggle", { rows: [rowOf("bewitch", "conditionGrant", { conditions: ["bewitched"], saveEffect: "negates", lasts: "duration" })], save: { modifier: flat(MOD) } });
  await aim([W.t.a]);
  const off = await run(gm, P.cast, { casterId: W.caster, spellId: W.spell.toggle, stop: true });
  check("F: with a modifier read the toggle is enabled and off, and the save band lists no part of the spell's", off.toggle && !off.toggle.disabled && !off.toggle.checked && off.saveParts.length === 0, { toggle: off.toggle, parts: off.saveParts.length });
  const on = await run(gm, P.cast, { casterId: W.caster, spellId: W.spell.toggle, saveMod: true, stop: true });
  check("F: switched on, the save band lists one part, signed, named by the spell", on.toggle?.checked === true && on.saveParts.length === 1 && on.saveParts[0].value === `+${MOD}`, { toggle: on.toggle, parts: on.saveParts.map((p) => p.value) });
  const c0 = await withRig(PASS_SAVE, () => castAs("toggle", { saveMod: false }));
  const c1 = await withRig(PASS_SAVE, () => castAs("toggle", { saveMod: true }));
  const r0 = c0.model.targets[keyOf(c0.model, W.t.a.uuid)]?.resist;
  const r1 = c1.model.targets[keyOf(c1.model, W.t.a.uuid)]?.resist;
  const partOf = (r) => (r?.parts ?? []).find((p) => p.key === "spell:save");
  // The spell's modifier is a roll-side part (lib saveThrow folds `parts` into the formula), so the throw's
  // formula carries it and the target stays where the save table puts it.
  const termOf = (r) => (String(r?.formula ?? "").match(/1d20\s*([+-]\s*\d+)?/)?.[1] ?? "+0").replace(/\s+/g, "");
  check("F: the card keeps the toggle's answer, and the throw carries the modifier as a roll term only when it is on", !c0.model.saveMod && c1.model.saveMod === true && Number.isFinite(r0?.target) && r1?.target === r0.target && Number(termOf(r1)) - Number(termOf(r0)) === MOD && partOf(r1)?.value === MOD && !partOf(r0), { off: r0?.formula, on: r1?.formula, target: [r0?.target, r1?.target], part: partOf(r1)?.value ?? null });
  check("F: the part the toggle adds is named on the throw and the throw's base target is the same either way", Math.abs(partOf(r1)?.value) === MOD && r0.baseTarget === r1.baseTarget, { part: partOf(r1)?.value ?? null, base: [r0.baseTarget, r1.baseTarget] });
  await shape("toggle", { rows: [rowOf("bewitch", "conditionGrant", { conditions: ["bewitched"], saveEffect: "negates", lasts: "duration" })], save: { modifier: null } });
  const blank = await run(gm, P.cast, { casterId: W.caster, spellId: W.spell.toggle, stop: true });
  check("F: with the modifier blank the toggle is disabled", blank.toggle?.disabled === true, { toggle: blank.toggle });
}

/* ---------------------------- G. slay -------------------------------- */
async function stageSlay() {
  await reset({ a: { hp: 30 } });
  await shape("slay", { rows: [rowOf("crumble", "slay", { saveEffect: "negates" })] });
  await aim([W.t.a]);
  const pass = await withRig(PASS_SAVE, () => castAs("slay"));
  const ep = entryAt(pass.model, W.t.a.uuid, "crumble");
  const hpPass = (await run(gm, P.hp, { actorIds: [W.actor.a] }))[0];
  check("G slay: a passed save negates it: no change to the hit points and the entry says it saved", pass.card && ep?.state === "applied" && ep.saved === true && hpPass === 30, { state: ep?.state, hp: hpPass });
  const fail = await withRig(FAIL_SAVE, () => castAs("slay"));
  const ef = entryAt(fail.model, W.t.a.uuid, "crumble");
  const hpFail = (await run(gm, P.hp, { actorIds: [W.actor.a] }))[0];
  check("G slay: a failed save takes the hit points to zero", fail.card && ef?.state === "applied" && hpFail === 0, { state: ef?.state, hp: hpFail });
  check("G slay: the target holds the dead status, written by the cast", (await statusOf(W.actor.a)).includes("dead"));
  await run(gm, P.setHp, { actorId: W.actor.a, value: 30 });
}

/* ---------------------------- H. destroyItem per holder -------------- */
async function stageDestroy() {
  await reset();
  await run(gm, P.resetWeapons, { actorId: W.actor.a, equippedId: W.weapon.a1 });
  await run(gm, P.resetWeapons, { actorId: W.actor.b, equippedId: W.weapon.b1 });
  // The count of weapons is the walk's own: two, so the cap does not refuse the second holder.
  await shape("destroy", { rows: [rowOf("shatter", "destroyItem", { saveEffect: "negates" })], target: { count: flat(2) } });
  await aim([W.t.a, W.t.b]);
  const picked = await run(gm, P.cast, { casterId: W.caster, spellId: W.spell.destroy, weapons: { [W.t.a.uuid]: W.weapon.a2 }, stop: true });
  const rowA = picked.bucket.rows.find((r) => r.uuid === W.t.a.uuid);
  const rowB = picked.bucket.rows.find((r) => r.uuid === W.t.b.uuid);
  check("H: each holder's row offers a pill per weapon", rowA?.pills.length === 2 && rowB?.pills.length === 2, { a: rowA?.pills.length, b: rowB?.pills.length });
  check("H: the pill picked for the first holder is on, and the second holder's default is its equipped weapon", rowA?.pills.find((p) => p.id === W.weapon.a2)?.on === true && rowB?.pills.find((p) => p.id === W.weapon.b1)?.on === true, { a: rowA?.pills, b: rowB?.pills });
  const c = await withRig(FAIL_SAVE, () => castAs("destroy", { weapons: { [W.t.a.uuid]: W.weapon.a2 } }));
  const ea = entryAt(c.model, W.t.a.uuid, "shatter");
  const eb = entryAt(c.model, W.t.b.uuid, "shatter");
  check("H: both entries are applied and each names the weapon it took", c.card && c.settled && ea?.state === "applied" && ea.destroyed?.id === W.weapon.a2 && eb?.state === "applied" && eb.destroyed?.id === W.weapon.b1, { a: ea?.destroyed?.id === W.weapon.a2, b: eb?.destroyed?.id === W.weapon.b1 });
  const wa = await run(gm, P.weapons, { actorId: W.actor.a });
  const wb = await run(gm, P.weapons, { actorId: W.actor.b });
  check("H: the picked weapon is marked destroyed on the first holder and the other is not (the default would have been the other)", wa.find((w) => w.id === W.weapon.a2)?.destroyed === true && wa.find((w) => w.id === W.weapon.a1)?.destroyed === false);
  check("H: the default weapon is marked destroyed on the second holder and the other is not", wb.find((w) => w.id === W.weapon.b1)?.destroyed === true && wb.find((w) => w.id === W.weapon.b2)?.destroyed === false);
  check("H: a destroyed weapon is marked and still carried (it is struck through, not deleted)", wa.length === 2 && wb.length === 2, { a: wa.length, b: wb.length });
  await run(gm, P.resetWeapons, { actorId: W.actor.a, equippedId: W.weapon.a1 });
  await run(gm, P.resetWeapons, { actorId: W.actor.b, equippedId: W.weapon.b1 });
}

/* ---------------------------- I. conditionRemove --------------------- */
async function stageLift() {
  await reset();
  const fx = await run(gm, P.makeEffect, { actorId: W.actor.a, name: "QA Saves fear", status: "frightened" });
  await ledger.track(fx.uuid, "ActiveEffect");
  check("I: the hand-made condition stands on the target before the cast", fx.statuses.includes("frightened") && (await statusOf(W.actor.a)).includes("frightened"));
  await shape("lift", { rows: [rowOf("calm", "conditionRemove", { conditions: ["frightened"], saveEffect: "none" })], save: { category: "none", effect: "none" } });
  await aim([W.t.a]);
  const c = await castAs("lift");
  const e = entryAt(c.model, W.t.a.uuid, "calm");
  const after = await run(gm, P.effectStands, { actorId: W.actor.a, effectId: fx.id });
  check("I: the lifting row's entry is applied, no save governs it, and it names the effect it took", c.card && c.settled && e?.state === "applied" && e.saved == null && (e.lifted ?? []).length >= 1, { lifted: e?.lifted?.length });
  check("I: the condition is off the actor and its effect is gone", after.stands === false && !after.statuses.includes("frightened"), after);
}

/* ---------------------------- J. endsOn ------------------------------- */
async function stageEndsOn() {
  await reset({ a: { hp: 40 }, b: { hp: 40 } });
  const rows = (ends) => [rowOf("charm", "conditionGrant", { conditions: ["bewitched"], saveEffect: "none", lasts: "duration", ...(ends ? { endsOn: ["damage"] } : {}) })];
  await shape("ends", { rows: rows(true), save: { category: "none", effect: "none" } });
  await aim([W.t.a]);
  const c = await castAs("ends");
  const rec = (await run(gm, P.records, { actorId: W.actor.a })).filter((r) => r.castId === c.model?.castId);
  check("J: the record the row writes carries the cause it ends on", c.card && rec.length > 0 && rec.every((r) => r.endsOn.includes("damage")), { records: rec.length });
  await run(gm, P.setHp, { actorId: W.actor.a, value: 39 });
  const left = await run(gm, P.waitGone, { actorId: W.actor.a, castId: c.model?.castId, tries: 24 });
  check("J: hurting the bearer ends the record, and the condition goes with it", left === 0 && !(await statusOf(W.actor.a)).includes("bewitched"), { left });
  // The control: the same row with no cause named survives the same hurt.
  await shape("ends", { rows: rows(false), save: { category: "none", effect: "none" } });
  await aim([W.t.b]);
  const k = await castAs("ends");
  await run(gm, P.setHp, { actorId: W.actor.b, value: 39 });
  const stays = await run(gm, P.waitGone, { actorId: W.actor.b, castId: k.model?.castId, tries: 8 });
  check("J: a record whose row names no cause stands through the same damage", k.card && stays > 0, { left: stays });
}

/* ---------------------------- K. followingTurn ------------------------ */
async function stageFollowing() {
  await reset();
  await shape("follow", { rows: [rowOf("trance", "conditionGrant", { conditions: ["mesmerized"], saveEffect: "none", lasts: "followingTurn" })], save: { category: "none", effect: "none" } });
  const round = await run(gm, P.roundSeconds);
  // Outside a fight: a clock of the bearer's two turns, and no turn life.
  await aim([W.t.a]);
  const c = await castAs("follow");
  const rec = (await run(gm, P.records, { actorId: W.actor.a })).filter((r) => r.castId === c.model?.castId);
  check("K clock: outside a fight the record keeps a clock of two rounds and no turn life", c.card && rec.length > 0 && rec.every((r) => !r.turnLife && r.duration?.units === "rounds" && r.duration?.value === 2 && r.startTime !== null), { duration: rec[0]?.duration ?? null });
  if (rec[0]?.duration?.units === "rounds") {
    const span = rec[0].duration.value * round;
    await run(gm, P.time, { advance: span - 1 });
    check("K clock: a second short of the two rounds the record stands", (await run(gm, P.waitGone, { actorId: W.actor.a, castId: c.model?.castId, tries: 2 })) > 0);
    await run(gm, P.time, { advance: 2 });
    check("K clock: the two rounds passed, the record is gone", (await run(gm, P.waitGone, { actorId: W.actor.a, castId: c.model?.castId })) === 0);
  }
  // Inside a fight: the record is held by the bearer's turns.
  await run(gm, P.clearRecords, { actorIds: [W.actor.a], castIds: ledger.castIds, casterRe: "^magic/saves-" });
  const cm = await run(gm, P.combatNew, { sceneId: W.scene, tokenIds: [W.t.a.id, W.t.b.id] });
  await ledger.track(cm.uuid, "Combat");
  try {
    const byToken = Object.fromEntries(cm.combatants.map((x) => [x.tokenId, x.id]));
    await run(gm, P.combatSet, { combatId: cm.id, initiatives: { [byToken[W.t.a.id]]: 20, [byToken[W.t.b.id]]: 10 } });
    const mv = await run(gm, P.combatMove, { combatId: cm.id, update: { round: 1, turn: 0 } });
    for (const u of mv.cards) await ledger.track(u, "ChatMessage");
    await aim([W.t.a]);
    const f = await castAs("follow");
    const recF = (await run(gm, P.records, { actorId: W.actor.a })).filter((r) => r.castId === f.model?.castId);
    check("K fight: in a fight the record is held by the bearer's turns: its turn life starts at a turn's start and counts two", f.card && recF.length > 0 && recF.every((r) => r.turnLife?.edge === "start" && r.turnLife?.count === 2), recF.map((r) => r.turnLife));
  } finally {
    await run(gm, P.combatDrop, { combatId: cm.id });
  }
}

/* ---------------------------- run ------------------------------------ */
try {
  section("seat");
  gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  note("gm ready after (s)", await ready(gm, "gm"));
  const installed = await run(gm, P.install, { key: KEY });
  check("the GM seat is the active GM", installed.isGM && installed.activeGMIsSelf, { role: installed.role });
  if (!installed.isGM) blocked("the GM seat did not join as a GM");

  await stage("A. setup", stageSetup);
  if (W.t) {
    await stage("B. the register's row kinds (S4e)", stageRegister);
    await stage("C. the Hit Dice gate (S4c)", stageHdGate);
    await stage("D. the creature-kind filter (S4c)", stageKindFilter);
    await stage("E. a save that negates, and none (S4c)", stageSaves);
    await stage("F. ruling 126's save toggle (slice A)", stageToggle);
    await stage("G. a slay row (S4d)", stageSlay);
    await stage("H. a destroy row, a weapon per holder (S4d, ruling 124)", stageDestroy);
    await stage("I. a lifting row (S4d)", stageLift);
    await stage("J. a record that ends on damage (S4a)", stageEndsOn);
    await stage("K. a following-turn duration (S4c)", stageFollowing);
  }
  section("console");
  const d = await run(gm, P.drain);
  check("gm: no console error was recorded since the seat was installed", d.errors.length === 0, d.errors.slice(0, 3));
  if (!W.t) gap("the setup stage did not reach its tokens, so no step ran");
  walkDone();
} catch (err) {
  if (!(err instanceof WalkBlocked)) {
    console.error("WALK ERROR:", err?.stack ?? err);
    check("walk ran to the end", false);
  }
} finally {
  await finish({ gm, player: null, ledger, fixtureRe: "^magic/saves-", restore: P.restore });
  console.log("fixtures kept: magic/saves-scene, magic/saves-class, magic/saves-caster, magic/saves-spell-<slug> x10, magic/saves-m-a, -b, magic/saves-w-a1, -a2, -b1, -b2");
  try { if (gm) await gm.close(); } catch {}
  summarize();
}
