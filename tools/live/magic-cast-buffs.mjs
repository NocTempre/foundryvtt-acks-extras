/**
 * Live walk, magic-cast-buffs: the buff side of the cast engine, slice S5, and
 * the granted throws of slice D (docs/magic/TESTING.md, "Buffs and granted
 * throws (S5)"), walked on the GM and Player seats. The spells the walk casts are
 * invented world spells on invented names and invented definition ids, each
 * rewritten at its step from rows the walk authors (`spellFlag`, `rowOf`); the
 * figures are the walk's own, the armour figures are read off the bearer's own
 * armour class so a lift is always positive, and no book word or printed figure
 * is in the script. A first stage imports nine register spells through the
 * importer when the seat's RR is open and reads the KINDS of the rows they carry
 * (never a figure); with the RR closed it prints SKIP.
 *
 * Steps: an armour class SET by attack kind (one figure for missile and thrown,
 * another for melee) lifted at a real attack of each kind, the two lifts differing
 * by the figures' difference; an immunity to a named spell, the named spell
 * exempt on the bearer and another spell not; a creature-kind pick (ruling 139)
 * offered by the dialog and narrowing an attack bonus to the picked kind; a granted
 * throw on the Rolls tab's Proficiencies & powers, pale where the character can
 * cast the spell on itself, gold once a record is on it (cast by itself, then by
 * ANOTHER caster), absent for a spell it cannot cast, display-only for a Player,
 * and rolling as the party card's one line; an Adventuring throw a spell makes
 * automatic, rolling as one line ("Automatic through"); and the cast dialog with
 * three targets, and the target cap blocking a Player and warning a Judge; and a
 * condition the system gives changes, granted by a cast on a monster and on a
 * character: the record is the effect Foundry builds for it, its figure counts
 * once beside a second effect of it and a second cast, a lifting spell takes a state's
 * two-status record and its Undo puts it back. The stage picks the condition and
 * the state from the palette and compares every change in the page.
 *
 * Shots, taken into the logs directory (`ACKS_WALK_SHOTS=0` takes none), for the
 * owner to see: `magic-cast-buffs-a-pale-row.png` and `-a-pale-tip.png` (the pale
 * row, then with the hover's tooltip), `-b-gold-self.png`, `-c-gold-other.png`,
 * `-e-granted-card.png` (the granted throw's roll as the one-line party card),
 * `-f-auto-card.png` (the automatic Adventuring throw's card), `-g-dialog.png`
 * (the cast dialog with three targets). Shot (d), a spell the character cannot cast,
 * has no row to show and is an assertion.
 *
 * Fixtures, kept and found by marker: `magic/buffs-scene`, `magic/buffs-class`,
 * `magic/buffs-caster` (a character the Player owns), `magic/buffs-caster-b` (a
 * character only the GM owns), `magic/buffs-spell-<slug>` (invented spells on the
 * first caster, rewritten at each step) and `magic/buffs-b-grant` (one on the
 * second), `magic/buffs-bearer`, `-foe`, `-ally`, `-undead`, `-animal` (monsters,
 * linked) with `magic/buffs-foe-blade` and `magic/buffs-ally-blade` (a weapon that
 * attacks in melee and at range). The run's own tokens, cards and records are
 * tracked by uuid and swept alone; the dice are restored. Machine values arrive
 * through ./_env.mjs.
 */
import { connect } from "./_driver.mjs";
import { walkDone, blocked, WalkBlocked } from "./_walk.mjs";
import {
  MACHINE, PORTS, P, note, section, check, gap, skip, idOf, run, ready, ledgerFor, finish, summarize, stage, logDir,
  SAVE_TARGET, LEVEL, flat, rowOf, spellFlag, entryAt, keyOf,
} from "./_magic-cast-kit.mjs";

const { browser, origin } = MACHINE;
const KEY = "magic-cast-buffs-walk";
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 1_500_000);
/** The register spells whose row kinds the first stage reads, by cookbook id. */
const REGISTER = ["def.spell.allure", "def.spell.arcaneArmor", "def.spell.baneRune", "def.spell.chameleon", "def.spell.silentStep", "def.spell.spiderClimbing", "def.spell.passWithoutTrace"];
/** The id stamped on the invented spell an immunity names, and the two invented proficiencies a grant names. The Adventuring proficiency's id is the module's own. */
const BOLT_ID = "def.spell.qabolt";
const G1 = "def.prof.qacharm";
const G2 = "def.prof.qagaze";
const ADV = "def.prof.adventuring";
const PALE_ID = `grant:${G1}:grant`;
const SLUGS = ["ac", "bolt", "plain", "kind", "grant", "auto", "cant", "cap"];
const SHOTS = process.env.ACKS_WALK_SHOTS === "0" ? null : logDir();

let gm = null;
let player = null;
const ledger = ledgerFor(() => gm);
const W = { name: {} };
setTimeout(() => {
  console.error(`WALK ERROR: wall clock of ${WALL_MS} ms reached; closing the seats`);
  try { player?.close(); } catch {}
  try { gm?.close(); } catch {}
  process.exit(1);
}, WALL_MS).unref();

/** A shot of one element into the logs directory, never of the whole viewport. */
async function shoot(file, selector) {
  if (!SHOTS) return;
  try { note(`shot ${file}`, await gm.shot(`${SHOTS}/${file}.png`, selector)); } catch (err) { note(`shot ${file} FAILED`, err?.message ?? String(err)); }
}
/** Rewrite one invented spell of the first caster from rows the step authors; keeps its name for the steps that look for it on a card. */
async function shape(slug, opts, cookbook) {
  const wrote = await run(gm, P.writeSpell, { casterId: W.caster.a, itemId: W.spell[slug], flag: spellFlag(opts), cookbook });
  W.name[slug] = wrote.name;
  return wrote;
}
const aim = async (seat, tokens) => {
  const got = await run(seat, P.target, { sceneId: W.scene, tokenIds: tokens.map((t) => t.id) });
  if (!Array.isArray(got) || got.length !== tokens.length) throw new Error(`the seat holds ${JSON.stringify(got)} as targets, not ${tokens.length}`);
};
/** Cast one of a caster's spells on the GM seat with nothing spent; tracks the card and its cast id. */
async function castAs(who, slug, o = {}) {
  const casterId = W.caster[who];
  await run(gm, P.setSpent, { casterId });
  const c = await run(gm, P.cast, { casterId, spellId: who === "a" ? W.spell[slug] : W.spell.bgrant, ...o });
  if (c.model?.castId) ledger.castIds.push(c.model.castId);
  if (c.messageId) await ledger.track(`ChatMessage.${c.messageId}`, "ChatMessage");
  return c;
}
/** Take the run's records off every fixture actor, so a step starts with none. */
const clear = () => run(gm, P.clearRecords, { actorIds: Object.values(W.actor).concat([W.caster.a, W.caster.b]), castIds: ledger.castIds, casterRe: "^magic/buffs-" });
const num = (text) => Number(String(text).replace(/−/g, "-").replace(/[^0-9.\-]/g, ""));
const attackAt = async (tokens, attacker, attackType) => {
  await aim(gm, tokens);
  const a = await run(gm, P.attack, { sceneId: W.scene, tokenId: W.t[attacker].id, itemId: W.weapon[attacker], attackType });
  if (a.id) await ledger.track(`ChatMessage.${a.id}`, "ChatMessage");
  return a;
};

/* Page side of stage H: what an actor holds for one condition, compared in the page with the palette's entry. A figure never leaves the page. */
const C = {
  /** A condition whose entry carries changes and brings none, and a state whose entry brings one: ids only. */
  pick: async () => {
    const carrying = CONFIG.statusEffects.filter((e) => (e.system?.changes ?? []).length);
    const state = carrying.find((e) => (e.statuses ?? []).length) ?? null;
    const plain = carrying.find((e) => !(e.statuses ?? []).length && !(state?.statuses ?? []).includes(e.id)) ?? null;
    return { plain: plain?.id ?? null, state: state?.id ?? null, brings: [...(state?.statuses ?? [])] };
  },
  /** Take every effect that is no spell record and names one of `ids` off the actors, then hold each actor's fields as the stage's baseline. */
  shape: async ({ actorIds, ids }) => {
    const H = globalThis.__mck;
    let removed = 0;
    for (const actorId of actorIds) {
      const actor = game.actors.get(actorId);
      const stale = actor.effects.filter((e) => !e.flags?.["acks-extras"]?.spellEffect && ids.some((id) => e.statuses.has(id))).map((e) => e.id);
      if (stale.length) { await actor.deleteEmbeddedDocuments("ActiveEffect", stale); removed += stale.length; }
    }
    await H.sleep(400);
    const keys = [...new Set(CONFIG.statusEffects.filter((e) => ids.includes(e.id)).flatMap((e) => (e.system?.changes ?? []).map((c) => c.key)))];
    H.condBase = Object.fromEntries(actorIds.map((actorId) => [actorId, Object.fromEntries(keys.map((k) => [k, Number(foundry.utils.getProperty(game.actors.get(actorId), k))]))]));
    return { removed, keys: keys.length };
  },
  /** What the actor holds for `id`: its carriers, the run's records among them against what Foundry builds for the entry, and whether every field the entry names stands one change from the baseline. */
  read: async ({ actorId, id, castIds }) => {
    const H = globalThis.__mck;
    const actor = game.actors.get(actorId);
    const entry = CONFIG.statusEffects.find((s) => s.id === id);
    const family = [id, ...(entry?.statuses ?? [])];
    const plain = (list) => Array.from(list ?? []).map((c) => ({ key: c.key, type: c.type, value: Number(c.value) }));
    const want = {};
    for (const c of entry?.system?.changes ?? []) want[c.key] = (want[c.key] ?? 0) + (c.type === "subtract" ? -1 : 1) * Number(c.value);
    const keys = Object.keys(want);
    const carriers = actor.effects.filter((e) => e.statuses.has(id));
    const records = carriers.filter((e) => castIds.includes(e.flags?.["acks-extras"]?.spellEffect?.castId));
    const now = (k) => Number(foundry.utils.getProperty(actor, k));
    const base = H.condBase?.[actorId] ?? {};
    return {
      carriers: carriers.length,
      brought: family.slice(1).map((b) => actor.effects.filter((e) => e.statuses.has(b)).length),
      records: records.map((e) => ({ id: e.id, castId: e.flags["acks-extras"].spellEffect.castId })),
      statuses: records.every((e) => JSON.stringify([...e.statuses]) === JSON.stringify(family)),
      changes: records.every((e) => JSON.stringify(plain(e.system?.changes)) === JSON.stringify(plain(entry?.system?.changes))),
      staticId: records.some((e) => e.id === entry?._id),
      hasChanges: keys.length > 0 && keys.some((k) => want[k] !== 0),
      once: keys.every((k) => now(k) - base[k] === want[k]),
      back: keys.every((k) => now(k) === base[k]),
      has: family.every((s) => actor.statuses.has(s)),
    };
  },
  /** A hand's own effect of a status, as the token HUD's toggle makes it; answers its uuid, which the walk tracks. */
  toggle: async ({ actorId, id }) => {
    const H = globalThis.__mck;
    const actor = game.actors.get(actorId);
    const before = new Set(actor.effects.map((e) => e.id));
    await actor.toggleStatusEffect(id, { active: true });
    await H.sleep(400);
    const made = actor.effects.filter((e) => !before.has(e.id));
    return { made: made.length, id: made[0]?.id ?? null, uuid: made[0]?.uuid ?? null };
  },
  /** A second effect of a status made outright from what Foundry builds for its entry, the way a copied or dropped effect arrives: the toggle makes none while one effect holds the status alone. */
  copy: async ({ actorId, id }) => {
    const H = globalThis.__mck;
    const actor = game.actors.get(actorId);
    const { _id, ...data } = (await ActiveEffect.fromStatusEffect(id)).toObject();
    const [made] = await actor.createEmbeddedDocuments("ActiveEffect", [data]);
    await H.sleep(400);
    return { made: made ? 1 : 0, id: made?.id ?? null, uuid: made?.uuid ?? null };
  },
  /** Delete effects of an actor by id. */
  drop: async ({ actorId, ids }) => {
    const H = globalThis.__mck;
    const actor = game.actors.get(actorId);
    const there = ids.filter((id) => actor.effects.has(id));
    if (there.length) await actor.deleteEmbeddedDocuments("ActiveEffect", there);
    await H.sleep(400);
    return there.length;
  },
  /** Press a button of a cast card's entry, as the Judge does, and answer the card once no entry is still applying. */
  press: async ({ messageId, action, target, row }) => {
    const H = globalThis.__mck;
    try { await ui.sidebar?.changeTab?.("chat", "primary"); } catch { /* chrome only */ }
    await H.sleep(400);
    const button = await H.poll(() => document.querySelector(`[data-message-id="${messageId}"] [data-action="${action}"][data-target="${target}"][data-row="${row}"]`), { tries: 40, every: 200 });
    if (!button) return { button: false };
    button.click();
    const settled = await H.poll(() => !Object.values(game.messages.get(messageId).flags["acks-extras"].castCard.entries).some((e) => e.state === "applying"), { tries: 40, every: 250 });
    await H.sleep(500);
    return { button: true, settled: !!settled };
  },
};

/* ---------------------------- A. setup ------------------------------ */
async function stageSetup() {
  W.playerId = await run(gm, P.userId, { name: MACHINE.player });
  if (!W.playerId) throw new Error("no Player user on this world");
  const scene = await gm.fixture("magic/buffs-scene", "Scene", { name: "QA Buffs Field", active: false, navigation: true, width: 1400, height: 900, padding: 0, backgroundColor: "#55606b", grid: { type: 1, size: 100, distance: 5, units: "ft" }, tokenVision: false, environment: { globalLight: { enabled: true } }, ownership: { default: 2 } });
  // Slots at level one only: a spell listed at level two is carried and cannot be cast.
  const cls = await gm.fixture("magic/buffs-class", "Item", { name: "QA Buffs Class", type: "acks-extras.class", system: { key: "qabuffsclass", casting: [{ key: "arcane", label: "Arcane", kind: "vancian", slots: [{ atLevel: 1, s1: 9 }] }] } });
  const casterA = await gm.fixture("magic/buffs-caster", "Actor", { name: "QA Buffs Caster", type: "character", prototypeToken: { actorLink: true }, system: { spells: { enabled: true }, hp: { value: 9, max: 9 } }, ownership: { default: 0, [W.playerId]: 3 } });
  const casterB = await gm.fixture("magic/buffs-caster-b", "Actor", { name: "QA Buffs Other Caster", type: "character", prototypeToken: { actorLink: true }, system: { spells: { enabled: true }, hp: { value: 9, max: 9 } }, ownership: { default: 0 } });
  W.scene = idOf(scene);
  W.caster = { a: idOf(casterA), b: idOf(casterB) };
  W.casterUuid = { a: casterA.uuid, b: casterB.uuid };
  W.spell = {};
  for (const slug of SLUGS) W.spell[slug] = idOf(await gm.fixture(`magic/buffs-spell-${slug}`, "Item", { name: `QA Buffs spell ${SLUGS.indexOf(slug) + 1}`, type: "spell", system: { lvl: 1 } }, { parent: casterA.uuid }));
  W.spell.bgrant = idOf(await gm.fixture("magic/buffs-b-grant", "Item", { name: "QA Buffs other spell", type: "spell", system: { lvl: 1 } }, { parent: casterB.uuid }));
  W.actor = {};
  for (const name of ["bearer", "foe", "ally", "undead", "animal"]) W.actor[name] = idOf(await gm.fixture(`magic/buffs-${name}`, "Actor", { name: `QA Buffs ${name}`, type: "monster", prototypeToken: { actorLink: true }, ownership: { default: 0 } }));
  W.weapon = {};
  for (const name of ["foe", "ally"]) W.weapon[name] = idOf(await gm.fixture(`magic/buffs-${name}-blade`, "Item", { name: `QA Buffs ${name} blade`, type: "weapon", system: { melee: true, missile: true, damage: { base: { formula: "1d4" } } } }, { parent: `Actor.${W.actor[name]}` }));
  for (const who of ["a", "b"]) await run(gm, P.shapeCaster, { casterId: W.caster[who], classUuid: cls.uuid, level: LEVEL, alignment: "Lawful" });
  W.kinds = { undead: ["undead"], animal: ["animal"] };
  for (const name of Object.keys(W.actor)) await run(gm, P.shapeMonster, { actorId: W.actor[name], hp: 40, hd: 2, kinds: W.kinds[name] ?? [], saveTarget: SAVE_TARGET });
  check("A: both seats view the field", (await run(player, P.view, { sceneId: W.scene })) && (await run(gm, P.view, { sceneId: W.scene })));
  const specs = [
    { actorId: W.caster.a, name: "Buffs Caster", x: 100, y: 200, disposition: 1 },
    { actorId: W.caster.b, name: "Buffs Other", x: 100, y: 400, disposition: 1 },
    { actorId: W.actor.bearer, name: "Buffs Bearer", x: 300, y: 200 },
    { actorId: W.actor.foe, name: "Buffs Foe", x: 300, y: 400 },
    { actorId: W.actor.ally, name: "Buffs Ally", x: 500, y: 200, disposition: 1 },
    { actorId: W.actor.undead, name: "Buffs Undead", x: 500, y: 400 },
    { actorId: W.actor.animal, name: "Buffs Animal", x: 500, y: 600 },
  ];
  const made = await run(gm, P.placeTokens, { sceneId: W.scene, specs });
  for (const t of made) await ledger.track(t.uuid, "Token");
  check("A: seven linked tokens stand on the field", made.length === specs.length);
  W.t = { ca: made.find((t) => t.actorId === W.caster.a), cb: made.find((t) => t.actorId === W.caster.b), bearer: made.find((t) => t.actorId === W.actor.bearer), foe: made.find((t) => t.actorId === W.actor.foe), ally: made.find((t) => t.actorId === W.actor.ally), undead: made.find((t) => t.actorId === W.actor.undead), animal: made.find((t) => t.actorId === W.actor.animal) };
  await run(gm, P.drain);
  await run(player, P.drain);
}

/* ---------------------------- B. register --------------------------- */
async function stageRegister() {
  const r = await run(gm, P.registerShape, { ids: REGISTER });
  if (!r.rr) { skip("B: the RR is not open on the GM seat, so the register rows are not read"); return; }
  const has = (id, field, value) => (r.spells[id]?.[field] ?? []).includes(value);
  check("B: every register spell the walk names is imported", REGISTER.every((id) => r.spells[id]), REGISTER.filter((id) => !r.spells[id]));
  check("B: the allure-style spell grants a proficiency and carries a modifier that waits for it", has("def.spell.allure", "kinds", "grants") && has("def.spell.allure", "kinds", "modifier"));
  check("B: the armour spell sets armour class twice by attack kind and names an immunity", (r.spells["def.spell.arcaneArmor"]?.modes ?? []).filter((m) => m === "set").length === 2 && has("def.spell.arcaneArmor", "attackKinds", "missile") && has("def.spell.arcaneArmor", "attackKinds", "melee") && has("def.spell.arcaneArmor", "kinds", "immunity"));
  check("B: the rune spell offers a creature-kind pick on four weapon rows", r.spells["def.spell.baneRune"]?.picked === 4, { picked: r.spells["def.spell.baneRune"]?.picked });
  check("B: the two skill spells carry a bonus where the skill is held and a set grant where it is not", ["def.spell.chameleon", "def.spell.silentStep"].every((id) => has(id, "kinds", "modifies") && has(id, "kinds", "grants") && has(id, "modes", "set")));
  check("B: the climbing spell grants the proficiency and makes the held throw automatic", has("def.spell.spiderClimbing", "kinds", "grants") && has("def.spell.spiderClimbing", "modes", "auto"));
  check("B: the trace spell is a grant with no throw", r.spells["def.spell.passWithoutTrace"]?.kinds.length > 0 && has("def.spell.passWithoutTrace", "kinds", "grants"));
}

/* ---------------------------- C. armour class set, immunity --------- */
async function stageArmour() {
  await clear();
  const shaped = await run(gm, P.shapeMonster, { actorId: W.actor.bearer, hp: 40, hd: 2, kinds: [], saveTarget: SAVE_TARGET });
  if (!Number.isFinite(shaped.ac)) { gap("C: the bearer's armour class reads as no number, so the armour step cannot be walked"); return; }
  // The figures are read off the bearer's own armour class, so each lift is positive and the two differ by five.
  const MISSILE = shaped.ac + 9;
  const MELEE = shaped.ac + 4;
  const rows = [
    rowOf("missile", "modifier", { target: "ac", mode: "set", appliesTo: "recipient", attackKinds: ["missile", "thrown"], value: flat(MISSILE), lasts: "duration" }),
    rowOf("melee", "modifier", { target: "ac", mode: "set", appliesTo: "recipient", attackKinds: ["melee"], value: flat(MELEE), lasts: "duration" }),
    rowOf("bolt", "immunity", { appliesTo: "recipient", refs: [BOLT_ID], lasts: "duration" }),
  ];
  const wrote = await shape("ac", { rows, save: { category: "none", effect: "none" } });
  check("C: the armour spell carries its three rows", wrote.kinds.join() === "modifier,modifier,immunity");
  await aim(gm, [W.t.bearer]);
  const c = await castAs("a", "ac");
  check("C: the cast lands an entry card and settles", c.card && c.settled);
  const rec = (await run(gm, P.records, { actorId: W.actor.bearer })).filter((r) => r.castId === c.model?.castId);
  const parts = rec.flatMap((r) => r.parts);
  const sets = parts.filter((p) => p.on === "ac" && p.mode === "set");
  check("C: the bearer holds one record whose parts are two armour sets, one for missile and thrown and one for melee, and an immunity naming the spell", rec.length === 1 && sets.length === 2 && sets.some((p) => p.attackKinds.includes("missile") && p.attackKinds.includes("thrown") && p.value === MISSILE) && sets.some((p) => p.attackKinds.join() === "melee" && p.value === MELEE) && parts.some((p) => p.on === "immune" && p.spells.includes(BOLT_ID)), { parts: parts.length });
  const spellName = W.name.ac;
  const missile = await attackAt([W.t.bearer], "foe", "missile");
  const melee = await attackAt([W.t.bearer], "foe", "melee");
  const rowsOf = (a) => (a.attack ?? []).filter((r) => r.label.includes(spellName));
  const [mr, ml] = [rowsOf(missile), rowsOf(melee)];
  check("C: a missile attack at the bearer carries one row for the spell, the missile figure's lift", missile.card && mr.length === 1 && Math.abs(num(mr[0].value)) === 9, { rows: mr.length, lift: mr[0] ? Math.abs(num(mr[0].value)) : null });
  check("C: a melee attack at the bearer carries one row for the spell, the melee figure's lift", melee.card && ml.length === 1 && Math.abs(num(ml[0].value)) === 4, { rows: ml.length, lift: ml[0] ? Math.abs(num(ml[0].value)) : null });
  check("C: the two lifts differ by the two figures' difference", mr.length === 1 && ml.length === 1 && Math.abs(num(mr[0].value)) - Math.abs(num(ml[0].value)) === MISSILE - MELEE);
  // The immunity: the named spell is exempt on the bearer and another spell is not.
  const hit = (key) => rowOf(key, "conditionGrant", { conditions: ["bewitched"], saveEffect: "none", lasts: "duration" });
  await shape("bolt", { rows: [hit("hit")], save: { category: "none", effect: "none" } }, BOLT_ID);
  await shape("plain", { rows: [hit("hit")], save: { category: "none", effect: "none" } });
  await aim(gm, [W.t.bearer]);
  const named = await castAs("a", "bolt");
  const other = await castAs("a", "plain");
  const en = entryAt(named.model, W.t.bearer.uuid, "hit");
  const eo = entryAt(other.model, W.t.bearer.uuid, "hit");
  check("C: the spell the immunity names is exempt on the bearer, on the immune gate, and writes no condition", en?.state === "exempt" && en.gate?.key === "immune", { state: en?.state, gate: en?.gate?.key });
  check("C: a spell the immunity does not name is applied and the bearer holds its condition", eo?.state === "applied" && (await run(gm, P.statuses, { actorId: W.actor.bearer })).includes("bewitched"), { state: eo?.state });
  await clear();
}

/* ---------------------------- D. kind pick -------------------------- */
async function stageKindPick() {
  await clear();
  const wrote = await shape("kind", { rows: [rowOf("atk", "modifier", { target: "attackThrow", mode: "add", appliesTo: "recipient", pickKind: true, vsKinds: ["undead", "animal"], value: flat(2), lasts: "duration" })], save: { category: "none", effect: "none" } });
  check("D: the kind spell carries its one row", wrote.rows === 1);
  await aim(gm, [W.t.ally]);
  const peek = await run(gm, P.cast, { casterId: W.caster.a, spellId: W.spell.kind, stop: true });
  check("D: the dialog offers the row's two kinds in a pick and no other", peek.kind?.options.join() === "undead,animal", { options: peek.kind?.options });
  // Effect cells render for the rows a seat picks among (pick groups, the kind pick); a spell with no pick shows none.
  check("D: the row the kind pick opens wears a tone cell, named", peek.bucket?.tones.length > 0 && peek.bucket.tones.every((t) => t !== ""), { tones: peek.bucket?.tones });
  const c = await castAs("a", "kind", { kind: "animal" });
  const rec = (await run(gm, P.records, { actorId: W.actor.ally })).filter((r) => r.castId === c.model?.castId);
  const part = rec.flatMap((r) => r.parts).find((p) => p.on === "attack");
  check("D: the ally's record holds the attack bonus narrowed to the picked kind alone", c.card && !!part && part.vsKinds.join() === "animal", { vsKinds: part?.vsKinds });
  const name = W.name.kind;
  const animal = await attackAt([W.t.animal], "ally", "melee");
  const undead = await attackAt([W.t.undead], "ally", "melee");
  check("D: the ally's attack at a creature of the picked kind carries a row for the spell", animal.card && animal.attack.some((r) => r.label.includes(name)), { rows: animal.attack.length });
  check("D: its attack at a creature of the other kind carries none", undead.card && !undead.attack.some((r) => r.label.includes(name)), { rows: undead.attack.length });
  await clear();
}

/* ---------------------------- E. granted throws ---------------------- */
async function stageGranted() {
  await clear();
  const grant = (ref, level = 1) => ({ rows: [rowOf("grant", "grants", { ref, mode: "set", value: flat(14), appliesTo: "recipient", lasts: "duration" })], save: { category: "none", effect: "none" }, level });
  await shape("grant", grant(G1));
  await shape("cant", grant(G2, 2));
  const bw = await run(gm, P.writeSpell, { casterId: W.caster.b, itemId: W.spell.bgrant, flag: spellFlag(grant(G1)) });
  W.name.bgrant = bw.name;
  const reg = await run(gm, P.castable, { actorId: W.caster.a });
  check("E: the register lists the granting spell as castable on its caster and the level-two spell, which the class has no slot for, not at all", reg.some((e) => e.itemId === W.spell.grant && e.onSelf === true) && !reg.some((e) => e.itemId === W.spell.cant), { castable: reg.length });

  // (a) pale: the spell can be cast on self and no record is on the character.
  check("E (a): no record of the run stands on the caster before the pale row is read", (await run(gm, P.records, { actorId: W.caster.a })).length === 0);
  const pale = await run(gm, P.rollsTab, { actorId: W.caster.a });
  const row = pale.rows.find((r) => r.id === PALE_ID);
  check("E (a): the Rolls tab shows one pale row for the throw: latent, not gold, no roll class and no action, its pin disabled", pale.rendered && !!row && row.latent && !row.granted && !row.roll && row.action === null && row.pinDisabled, { row: row ?? null });
  check("E (d): the spell the character cannot cast shows no row, pale or gold", !pale.rows.some((r) => r.id.startsWith(`grant:${G2}:`)), { rows: pale.rows.map((r) => r.id.length) });
  check("E (a): the pale row's figure carries a tooltip naming the spell", !!row && row.tip.includes(W.name.grant), { tip: !!row?.tip });
  // The hover scrolls the row into view; the shot with the tooltip is taken first, then the row alone.
  const hov = await run(gm, P.hoverRow, { actorId: W.caster.a, rollId: PALE_ID });
  check("E (a): hovering the figure shows core's tooltip with that text", hov.cell && hov.active && hov.shown === hov.attr && hov.shown.includes(W.name.grant), { active: hov.active });
  const fr = await run(gm, P.frame, { sheetSelector: pale.selector });
  if (fr.frame) await shoot("magic-cast-buffs-a-pale-tip", fr.selector);
  await run(gm, P.unhover, { actorId: W.caster.a, rollId: PALE_ID });
  await run(gm, P.unframe);
  await shoot("magic-cast-buffs-a-pale-row", pale.selector);
  // A Player sees the pale row and cannot roll it.
  const seen = await run(player, P.rollsTab, { actorId: W.caster.a });
  const prow = seen.rows.find((r) => r.id === PALE_ID);
  check("E (a): the Player's seat shows the same pale row, display only", !!prow && prow.latent && !prow.roll && prow.action === null && prow.pinDisabled, { row: prow ?? null });
  const pressed = await run(player, P.pressRow, { actorId: W.caster.a, rollId: PALE_ID, expectNone: true });
  check("E (a): pressing the pale row as a Player posts nothing", pressed.row && pressed.posted === 0, { posted: pressed.posted });
  await run(player, P.closeSheet, { actorId: W.caster.a });

  // (b) gold: the character casts the spell on itself.
  await aim(gm, [W.t.ca]);
  const self = await castAs("a", "grant");
  check("E (b): the cast leaves a record of the grant on the caster, cast by the caster", self.card && self.settled && (await run(gm, P.records, { actorId: W.caster.a })).some((r) => r.castId === self.model.castId && r.casterUuid === W.casterUuid.a && r.parts.some((p) => p.on === "grant")));
  const goldSelf = await run(gm, P.rollsTab, { actorId: W.caster.a });
  const gs = goldSelf.rows.filter((r) => r.id === PALE_ID);
  check("E (b): the row is gold, rolls, has its pin, and no pale twin stands beside it", gs.length === 1 && gs[0].granted && !gs[0].latent && gs[0].roll && gs[0].action === "roll" && !gs[0].pinDisabled, { rows: gs.length });
  await shoot("magic-cast-buffs-b-gold-self", goldSelf.selector);

  // (e) the throw's roll posts as the party card's one line.
  const press = await run(gm, P.pressRow, { actorId: W.caster.a, rollId: PALE_ID });
  if (press.uuid) await ledger.track(press.uuid, "ChatMessage");
  check("E (e): rolling the gold row posts one card in the party roll card's format naming the spell", press.row && press.posted === 1 && press.card && press.text.includes(W.name.grant), { posted: press.posted, tableRows: press.tableRows });
  note("E (e): rows in the card's table (the format is one line)", press.tableRows);
  const shown = await run(gm, P.showCard, { messageId: press.id });
  if (shown.found) await shoot("magic-cast-buffs-e-granted-card", shown.selector);
  else gap("E (e): the card is not in the chat log, so its shot was not taken");

  // (c) gold again, the record cast by ANOTHER caster.
  await run(gm, P.clearRecords, { actorIds: [W.caster.a], castIds: [self.model.castId], casterRe: "^this-matches-no-marker$" });
  const gone = await run(gm, P.records, { actorId: W.caster.a });
  check("E (c): the self-cast record is gone from the caster", !gone.some((r) => r.castId === self.model.castId) && gone.length === 0, { left: gone.length });
  await aim(gm, [W.t.ca]);
  const other = await castAs("b", "grant");
  const recs = await run(gm, P.records, { actorId: W.caster.a });
  check("E (c): the one record on the caster was cast by the other caster, none by the caster itself", other.card && other.settled && recs.length === 1 && recs[0].casterUuid === W.casterUuid.b && !recs.some((r) => r.casterUuid === W.casterUuid.a), { records: recs.length });
  const goldOther = await run(gm, P.rollsTab, { actorId: W.caster.a });
  const go = goldOther.rows.filter((r) => r.id === PALE_ID);
  check("E (c): the row is gold again, whoever cast it, with no pale twin", go.length === 1 && go[0].granted && !go[0].latent && go[0].roll, { rows: go.length });
  await shoot("magic-cast-buffs-c-gold-other", goldOther.selector);
  await run(gm, P.closeSheet, { actorId: W.caster.a });
  await clear();
}

/* ---------------------------- F. automatic Adventuring throw --------- */
async function stageAutomatic() {
  await clear();
  await shape("auto", { rows: [rowOf("climb", "modifies", { target: "proficiencyThrow", mode: "auto", refs: [ADV], appliesToRoll: "climb", appliesTo: "recipient", lasts: "duration" })], save: { category: "none", effect: "none" } });
  const before = await run(gm, P.rollsTab, { actorId: W.caster.a, adv: "climb" });
  check("F: the Climbing row of the Adventuring group shows a figure before the cast", before.rendered && !!before.adv && before.adv.text !== "", { text: !!before.adv?.text });
  await run(gm, P.closeSheet, { actorId: W.caster.a });
  await aim(gm, [W.t.ca]);
  const c = await castAs("a", "auto");
  const after = await run(gm, P.rollsTab, { actorId: W.caster.a, adv: "climb" });
  check("F: with the record on the caster the row reads automatic and its tooltip names the spell", c.card && !!after.adv && after.adv.text !== before.adv?.text && after.adv.tip.includes(W.name.auto), { text: after.adv?.text ?? null });
  const lead = (await run(gm, P.loc, { key: "ACKS-ABILITIES.roll." + "autoRecord" })).split("{")[0].trim();
  const press = await run(gm, P.pressRow, { actorId: W.caster.a, rollId: "adv:climb" });
  if (press.uuid) await ledger.track(press.uuid, "ChatMessage");
  check("F: rolling it posts one card, in the party card's format, saying it is automatic through the spell", press.row && press.posted === 1 && press.card && lead.length > 3 && press.text.includes(lead) && press.text.includes(W.name.auto), { posted: press.posted });
  const shown = await run(gm, P.showCard, { messageId: press.id });
  if (shown.found) await shoot("magic-cast-buffs-f-auto-card", shown.selector);
  else gap("F: the card is not in the chat log, so its shot was not taken");
  await run(gm, P.closeSheet, { actorId: W.caster.a });
  await clear();
}

/* ---------------------------- G. the dialog with three targets ------- */
async function stageDialog() {
  await clear();
  await aim(gm, [W.t.bearer, W.t.ally, W.t.foe]);
  const held = await run(gm, P.cast, { casterId: W.caster.a, spellId: W.spell.ac, hold: true });
  check("G: the dialog lists three target rows, each with its X, the count, the drop strip and the Add my token button", held.dialog && held.bucket.rows.length === 3 && held.bucket.rows.every((r) => r.x) && held.bucket.count !== "" && held.bucket.drop && held.bucket.addMine, { rows: held.bucket.rows.length, count: held.bucket.count });
  check("G: the footer sits outside the scrolling body", held.footerPinned, { footerPinned: held.footerPinned });
  await shoot("magic-cast-buffs-g-dialog", ".application.acks-extras-cast");
  check("G: Cancel closes the window", (await run(gm, P.closeDialog)) === false);
  // The target cap: a spell for two creatures and three targeted.
  await shape("cap", { rows: [rowOf("bonus", "modifier", { target: "attackThrow", mode: "add", appliesTo: "recipient", value: flat(1), lasts: "duration" })], target: { count: flat(2) }, save: { category: "none", effect: "none" } });
  await aim(gm, [W.t.bearer, W.t.ally, W.t.foe]);
  await aim(player, [W.t.bearer, W.t.ally, W.t.foe]);
  const judge = await run(gm, P.cast, { casterId: W.caster.a, spellId: W.spell.cap, stop: true });
  const seat = await run(player, P.cast, { casterId: W.caster.a, spellId: W.spell.cap, stop: true });
  check("G: three targets at a cap of two: the count reads over", judge.bucket.over && seat.bucket.over, { gm: judge.bucket.count, player: seat.bucket.count });
  check("G: the Judge is warned and may still cast", judge.verdicts.includes("warn") && !judge.castDisabled, { verdicts: judge.verdicts });
  check("G: the Player is blocked and the Cast button is disabled", seat.verdicts.includes("block") && seat.castDisabled, { verdicts: seat.verdicts });
}

/* ---------------------------- H. a condition the system gives changes ---- */
async function stageCondition() {
  await clear();
  const pick = await run(gm, C.pick);
  note("H: the condition and the state the stage casts", pick);
  if (!pick.plain || !pick.state) { check("H: the palette holds a condition with changes and a state that brings one", false, pick); return; }
  const bearers = [["a monster", W.actor.bearer, W.t.bearer], ["a character", W.caster.b, W.t.cb]];
  const none = { category: "none", effect: "none" };
  const give = (id) => rowOf("give", "conditionGrant", { conditions: [id], saveEffect: "none", lasts: "duration" });
  const lift = (id) => rowOf("take", "conditionRemove", { conditions: [id], saveEffect: "none" });
  const reads = (id) => Promise.all(bearers.map(([, actorId]) => run(gm, C.read, { actorId, id, castIds: ledger.castIds })));
  const each = (label, rows, ok, detail = () => undefined) => bearers.forEach(([kind], i) => check(`H: on ${kind}, ${label}`, ok(rows[i], i), detail(rows[i], i)));
  note("H: shaped", await run(gm, C.shape, { actorIds: bearers.map((b) => b[1]), ids: [pick.plain, pick.state, ...pick.brings] }));

  // A condition with changes: the record is what Foundry builds, and its figure counts once beside a hand's copy and a second cast.
  await shape("plain", { rows: [give(pick.plain)], save: none });
  await aim(gm, bearers.map((b) => b[2]));
  const first = await castAs("a", "plain");
  check("H: the cast lands an entry card and settles", first.card && first.settled);
  const one = await reads(pick.plain);
  each("the entry is applied and the bearer holds the condition on one record", one, (r, i) => entryAt(first.model, bearers[i][2].uuid, "give")?.state === "applied" && r.records.length === 1 && r.carriers === 1 && r.has, (r) => ({ records: r.records.length, carriers: r.carriers }));
  each("the record holds the statuses and the changes Foundry builds for the condition, under an id of its own", one, (r) => r.hasChanges && r.statuses && r.changes && !r.staticId, (r) => ({ hasChanges: r.hasChanges, statuses: r.statuses, changes: r.changes, staticId: r.staticId }));
  each("every field a change names moved by that change, once", one, (r) => r.once);
  // The token HUD's toggle finds the record, which holds the status alone, and makes no second effect; a second carrier is an effect made outright.
  const toggled = [];
  for (const [, actorId] of bearers) {
    const h = await run(gm, C.toggle, { actorId, id: pick.plain });
    if (h.uuid) await ledger.track(h.uuid, "ActiveEffect");
    toggled.push(h);
  }
  const found = await reads(pick.plain);
  each("the system's toggle of the condition finds the record and makes no second effect", found, (r, i) => toggled[i].made === 0 && r.carriers === 1 && r.once, (r, i) => ({ made: toggled[i].made, carriers: r.carriers }));
  const hands = [];
  for (const [, actorId] of bearers) {
    const h = await run(gm, C.copy, { actorId, id: pick.plain });
    if (h.uuid) await ledger.track(h.uuid, "ActiveEffect");
    hands.push(h);
  }
  const two = await reads(pick.plain);
  each("a second effect of the condition beside the record is a second carrier and the fields still stand one change from the start", two, (r, i) => hands[i].made === 1 && r.carriers === 2 && r.once, (r) => ({ carriers: r.carriers, once: r.once }));
  await aim(gm, bearers.map((b) => b[2]));
  const second = await castAs("a", "plain");
  const three = await reads(pick.plain);
  each("a second cast writes a second record, three carriers in all, and the fields still stand one change from the start", three, (r) => second.card && second.settled && r.records.length === 2 && r.carriers === 3 && r.statuses && r.changes && r.once, (r) => ({ records: r.records.length, carriers: r.carriers, once: r.once }));
  // The earliest carrier goes: a later one takes the figure up.
  for (const [i, [, actorId]] of bearers.entries()) await run(gm, C.drop, { actorId, ids: one[i].records.map((r) => r.id) });
  const later = await reads(pick.plain);
  each("with the first record deleted, a later carrier holds the figure, once", later, (r) => r.carriers === 2 && r.once, (r) => ({ carriers: r.carriers, once: r.once }));
  for (const [i, [, actorId]] of bearers.entries()) await run(gm, C.drop, { actorId, ids: [hands[i].id].filter(Boolean) });
  const last = await reads(pick.plain);
  each("with the hand's copy deleted, the second cast's record holds it alone, once", last, (r) => r.carriers === 1 && r.records.length === 1 && r.once, (r) => ({ carriers: r.carriers, once: r.once }));
  await shape("bolt", { rows: [lift(pick.plain)], save: none });
  await aim(gm, bearers.map((b) => b[2]));
  const off = await castAs("a", "bolt");
  const gone = await reads(pick.plain);
  each("a lifting spell takes the record and every field is back", gone, (r, i) => entryAt(off.model, bearers[i][2].uuid, "take")?.state === "applied" && r.carriers === 0 && r.back, (r) => ({ carriers: r.carriers, back: r.back }));

  // A state that brings a condition: one record holding both, lifted whole by a lifting spell and put back whole by its Undo.
  await clear();
  await shape("kind", { rows: [give(pick.state)], save: none });
  await aim(gm, bearers.map((b) => b[2]));
  const st = await castAs("a", "kind");
  const held = await reads(pick.state);
  each("a cast of the state leaves one record holding the state and the condition it brings, with both entries' changes, under an id of its own", held, (r, i) => st.card && st.settled && entryAt(st.model, bearers[i][2].uuid, "give")?.state === "applied" && r.records.length === 1 && r.carriers === 1 && r.has && r.statuses && r.changes && !r.staticId, (r) => ({ records: r.records.length, statuses: r.statuses, changes: r.changes, staticId: r.staticId }));
  each("every field the state and the brought condition name moved once", held, (r) => r.once);
  const copies = [];
  for (const [, actorId] of bearers) {
    const h = await run(gm, C.toggle, { actorId, id: pick.brings[0] });
    if (h.uuid) await ledger.track(h.uuid, "ActiveEffect");
    copies.push(h);
  }
  const beside = await reads(pick.state);
  each("the brought condition set by hand beside it is a second carrier of that condition, and the fields still stand once", beside, (r, i) => copies[i].made === 1 && r.brought[0] === 2 && r.once, (r) => ({ brought: r.brought, once: r.once }));
  for (const [i, [, actorId]] of bearers.entries()) await run(gm, C.drop, { actorId, ids: [copies[i].id].filter(Boolean) });
  await shape("bolt", { rows: [lift(pick.state)], save: none });
  await aim(gm, bearers.map((b) => b[2]));
  const end = await castAs("a", "bolt");
  const lifted = await reads(pick.state);
  each("a lifting spell naming the state takes its two-status record, names it on the entry, and every field is back", lifted, (r, i) => { const e = entryAt(end.model, bearers[i][2].uuid, "take"); return e?.state === "applied" && (e.lifted ?? []).length === 1 && !(e.listed ?? []).length && r.carriers === 0 && r.back; }, (r, i) => ({ carriers: r.carriers, back: r.back, lifted: entryAt(end.model, bearers[i][2].uuid, "take")?.lifted?.length ?? 0 }));
  for (const [, , tok] of bearers) await run(gm, C.press, { messageId: end.messageId, action: "magicCastUndo", target: keyOf(end.model, tok.uuid), row: end.model.order?.[0] ?? "take" });
  const undone = await reads(pick.state);
  each("the Judge's Undo of the lift puts the record back under its own id, with both statuses and the fields one change from the start", undone, (r, i) => r.carriers === 1 && r.records.length === 1 && r.records[0].id === held[i].records[0].id && r.statuses && r.changes && r.once, (r) => ({ carriers: r.carriers, records: r.records.length, once: r.once }));
  await clear();
  const clean = await reads(pick.state);
  each("the stage leaves no carrier and every field back", clean, (r) => r.carriers === 0 && r.back, (r) => ({ carriers: r.carriers, back: r.back }));
}

/* ---------------------------- run ------------------------------------ */
try {
  section("seats");
  gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  player = await connect({ browser, origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  note("gm ready after (s)", await ready(gm, "gm"));
  note("player ready after (s)", await ready(player, "player"));
  const installed = await run(gm, P.install, { key: KEY });
  const seated = await run(player, P.install, { key: KEY });
  check("the GM seat is the active GM and the player seat is a player", installed.isGM && installed.activeGMIsSelf && !seated.isGM && seated.role <= 2, { gm: installed.role, player: seated.role });
  if (!installed.isGM || seated.isGM) blocked("a seat did not join as the walk's own role");

  await stage("A. setup", stageSetup);
  if (W.t) {
    await stage("B. the register's row kinds (S5e)", stageRegister);
    await stage("C. armour class set by attack kind, and an immunity (S5a, S5b)", stageArmour);
    await stage("D. a creature-kind pick narrowing an attack bonus (S5, ruling 139)", stageKindPick);
    await stage("E. granted throws on the Rolls tab (slice D, S-A)", stageGranted);
    await stage("F. an automatic Adventuring throw (S5c)", stageAutomatic);
    await stage("G. the cast dialog with three targets, and the target cap (slice A)", stageDialog);
    await stage("H. a condition the system gives changes, granted by a cast", stageCondition);
  }
  section("console");
  for (const [label, seat] of [["gm", gm], ["player", player]]) {
    const d = await run(seat, P.drain);
    check(`${label}: no console error was recorded since the seat was installed`, d.errors.length === 0, d.errors.slice(0, 3));
  }
  if (!W.t) gap("the setup stage did not reach its tokens, so no step ran");
  walkDone();
} catch (err) {
  if (!(err instanceof WalkBlocked)) {
    console.error("WALK ERROR:", err?.stack ?? err);
    check("walk ran to the end", false);
  }
} finally {
  await finish({ gm, player, ledger, fixtureRe: "^magic/buffs-", restore: P.restore });
  console.log("fixtures kept: magic/buffs-scene, magic/buffs-class, magic/buffs-caster, magic/buffs-caster-b, magic/buffs-spell-<slug> x8, magic/buffs-b-grant, magic/buffs-bearer, -foe, -ally, -undead, -animal, magic/buffs-foe-blade, magic/buffs-ally-blade");
  try { if (player) await player.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  summarize();
}
