/**
 * A monster's entered Strength on the attacks it makes (`strengthContributor`,
 * the attack seam's contributor of the monsters feature) and the dice-formula
 * reader it takes the average from (`lib/dice-bounds.mjs`).
 *
 * Which attack kinds get a row, which weapons count as natural or wielded, and
 * every case that adds nothing. Book-free: the grid, scores and figures are
 * invented, and no page prints this grid. The localizer reads the real
 * `lang/en.json`, so a missing key or a mistyped placeholder fails here.
 * Run: node tools/test-strength-contributor.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { PRIORITY, registerTable, resetTables } from "../scripts/lib/tables.mjs";

let pass = 0;
const check = (label, cond) => {
  assert.ok(cond, label);
  pass++;
};
const same = (label, a, b) => check(label, JSON.stringify(a) === JSON.stringify(b));

/* --- stand-ins ------------------------------------------------------------------ */
const LANG = JSON.parse(fs.readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));
const lookup = (key) => {
  const text = key.split(".").reduce((node, part) => node?.[part], LANG);
  assert.equal(typeof text, "string", `lang key ${key}`);
  return text;
};
globalThis.game = {
  i18n: {
    localize: lookup,
    format: (key, data) =>
      lookup(key).replace(/\{(\w+)\}/g, (_, name) => {
        assert.ok(name in data, `placeholder ${name} of ${key} is given`);
        return String(data[name]);
      }),
  },
};
const modelCalls = [];
globalThis.CONFIG = {
  Actor: {
    dataModels: {
      character: {
        getAttributeModifier: (score) => {
          modelCalls.push(score);
          return ({ 6: -1, 7: 0, 9: 1, 14: 2 })[score] ?? 0;
        },
      },
    },
  },
};
/** Evaluates "NdM", "NdM+K" and "NdM-K" by arithmetic, and throws on anything else, as `Roll` does on a formula it cannot parse. */
globalThis.Roll = class {
  constructor(formula) {
    this.m = /^(\d+)d(\d+)\s*([+-]\s*\d+)?$/.exec(String(formula).trim());
    if (!this.m) throw new Error(`cannot parse ${formula}`);
  }
  evaluateSync({ minimize = false, maximize = false } = {}) {
    const [, n, d, k] = this.m;
    const bonus = k ? Number(k.replace(/\s+/g, "")) : 0;
    return { total: (maximize ? Number(n) * Number(d) : Number(n)) + bonus };
  }
};

const { formulaBounds, formulaAverage } = await import("../scripts/lib/dice-bounds.mjs");
const { strengthContributor, registerStrengthContributor } = await import("../scripts/monsters/strength-contributor.mjs");
const { STRENGTH_DOC } = await import("../scripts/monsters/strength-attack.mjs");

/* --- the dice reader ------------------------------------------------------------ */
same("a formula's bounds", formulaBounds("2d6"), { min: 2, max: 12 });
same("a formula's bounds with a bonus", formulaBounds("1d8+2"), { min: 3, max: 10 });
check("the average is the mean of the bounds", formulaAverage("2d6") === 7 && formulaAverage("1d6") === 3.5);
check("an empty or blank formula is null", [formulaBounds(""), formulaBounds("   "), formulaBounds(null), formulaBounds(undefined), formulaAverage("")].every((v) => v === null));
check("a formula Roll rejects is null, never a throw", formulaBounds("By weapon") === null && formulaAverage("By weapon") === null);
{
  const was = globalThis.Roll;
  globalThis.Roll = class {
    evaluateSync() {
      return { total: NaN };
    }
  };
  check("a non-finite result is null", formulaBounds("1d6") === null && formulaAverage("1d6") === null);
  globalThis.Roll = was;
}

/* --- the grid ------------------------------------------------------------------- */
const grid = {
  attribute: { col1: "4 or less", col2: "5 - 9", col3: "10 or more", header: true },
  7: { col1: 21, col2: 22, col3: 23 },
  9: { col1: 31, col2: 32, col3: 33 },
  6: { col1: 0, col2: 0, col3: 0 },
};
const register = (tables, priority = PRIORITY.WORLD, pages = "XX 7") => registerTable({ id: STRENGTH_DOC, source: { pages }, tables }, { priority });
register({ strengthAttack: grid });

const monster = (str, extra = {}) => ({ type: "monster", getFlag: (scope, key) => (scope === "acks-extras" && key === "extras" ? { scores: str === null ? {} : { str } } : undefined), ...extra });
const weapon = (formula, mark) => ({
  type: "weapon",
  system: { damage: { base: { formula } } },
  getFlag: (scope, key) => (scope === "acks-extras" && key === "naturalWeapon" ? mark : undefined),
});
const attack = (actor, item, kind) => strengthContributor.attack({ actor, weapon: item }, kind, [{ label: "own", value: 1 }]);
const damage = (actor, item, kind) => strengthContributor.damage({ actor, weapon: item }, kind, [{ label: "own", value: 1 }]);
const added = (list) => list.slice(1);

/* --- a natural attack ----------------------------------------------------------- */
{
  const claw = weapon("1d6+2", "claw"); // average 5.5, the second band
  const throwRows = attack(monster(7), claw, "melee");
  same("a natural melee attack's throw gains the table's cell", added(throwRows).map((r) => r.value), [22]);
  const damageRows = damage(monster(7), claw, "melee");
  same("a natural melee attack's damage gains the same cell", added(damageRows).map((r) => r.value), [22]);
  check("the first row is the system's own, kept", throwRows[0].label === "own" && damageRows[0].label === "own");
  check("the label names the score, the average and the table's page", throwRows[1].label === "Strength 7, 5.5 average damage (XX 7)");
  const big = weapon("2d6", "bite"); // average 7
  same("a different average reads another band's cell", added(attack(monster(9), big, "melee")).map((r) => r.value), [32]);
  const huge = weapon("4d6", "bite"); // average 14, the open top band
  same("the open top band answers", added(attack(monster(9), huge, "melee")).map((r) => r.value), [33]);
}

/* --- unmarked and other marks ----------------------------------------------------- */
{
  for (const mark of [undefined, null, ""]) {
    const rows = added(attack(monster(7), weapon("1d6+2", mark), "melee"));
    check(`an unmarked weapon (${JSON.stringify(mark)}) is a natural attack`, rows.length === 1 && rows[0].value === 22 && rows[0].label.includes("average damage"));
  }
  check("a flag object with no mark is unmarked too", added(attack(monster(7), { ...weapon("1d6+2"), getFlag: undefined, flags: { "acks-extras": {} } }, "melee")).length === 1);
}

/* --- a wielded weapon ------------------------------------------------------------- */
{
  modelCalls.length = 0;
  const sword = weapon("1d8", "weapon");
  const throwRows = attack(monster(14), sword, "melee");
  same("a wielded arm takes the character's modifier on the throw", added(throwRows).map((r) => r.value), [2]);
  same("and on the damage", added(damage(monster(14), sword, "melee")).map((r) => r.value), [2]);
  check("the label names the score and that it is wielded, with the shipped reference", throwRows[1].label === "Strength 14, wielded (MM ch. 3)");
  check("the system's own table was asked for the score", modelCalls.every((s) => s === 14) && modelCalls.length > 0);
  check("a wielded arm needs no readable formula", added(attack(monster(14), weapon("By weapon", "weapon"), "melee")).length === 1);
}

/* --- the kinds of attack ---------------------------------------------------------- */
{
  const claw = weapon("1d6+2", "claw");
  const sword = weapon("1d8", "weapon");
  for (const w of [claw, sword]) {
    check("a thrown attack adds no throw row", added(attack(monster(7), w, "thrown")).length === 0);
    check("a thrown attack adds a damage row", added(damage(monster(7), w, "thrown")).length === 1);
    check("a missile attack adds no throw row", added(attack(monster(7), w, "missile")).length === 0);
    check("a missile attack adds no damage row", added(damage(monster(7), w, "missile")).length === 0);
  }
  check("a kind nothing names adds nothing", added(attack(monster(7), claw, "magic")).length === 0 && added(damage(monster(7), claw, undefined)).length === 0);
  check("the contributor declares no carriers, so a spell carrier is never asked", strengthContributor.carriers === undefined);
}

/* --- who adds nothing ------------------------------------------------------------- */
{
  const claw = weapon("1d6+2", "claw");
  for (const blank of [null, 0, "", undefined]) {
    check(`a blank Strength (${JSON.stringify(blank)}) adds no row`, added(attack(monster(blank), claw, "melee")).length === 0 && added(damage(monster(blank), claw, "melee")).length === 0);
  }
  const character = { type: "character", system: { scores: { str: { mod: 3 } } }, getFlag: () => ({ scores: { str: 7 } }) };
  check("a character is untouched", added(attack(character, claw, "melee")).length === 0 && added(damage(character, claw, "melee")).length === 0);
  check("a character with a wielded mark is untouched", added(attack(character, weapon("1d8", "weapon"), "melee")).length === 0);
  check("an attack with no weapon adds nothing", added(attack(monster(7), null, "melee")).length === 0);
  check("a score with no row adds nothing", added(attack(monster(12), claw, "melee")).length === 0);
  check("a formula Roll rejects adds nothing", added(attack(monster(7), weapon("By weapon", "claw"), "melee")).length === 0 && added(damage(monster(7), weapon("", undefined), "melee")).length === 0);
  check("an average past the table's bands adds nothing", (() => { register({ strengthAttack: { attribute: { col1: "1 - 2", header: true }, 7: { col1: 5 } } }); const none = added(attack(monster(7), weapon("4d6", "claw"), "melee")).length === 0; register({ strengthAttack: grid }); return none; })());
  const kept = [{ label: "own", value: 1 }];
  check("an answer that adds nothing returns the list it was given", strengthContributor.attack({ actor: monster(null), weapon: claw }, "melee", kept) === kept);
}

/* --- the table absent ------------------------------------------------------------- */
{
  resetTables();
  const claw = weapon("1d6+2", "claw");
  check("no table: a natural attack adds nothing", added(attack(monster(7), claw, "melee")).length === 0 && added(damage(monster(7), claw, "melee")).length === 0);
  check("no table: a wielded arm still takes the character's modifier", added(attack(monster(14), weapon("1d8", "weapon"), "melee")).length === 1);
  register({ strengthAttack: grid });
}

/* --- zero, and an override --------------------------------------------------------- */
{
  const claw = weapon("1d6+2", "claw");
  const rows = added(attack(monster(6), claw, "melee"));
  check("a zero cell is still a row", rows.length === 1 && rows[0].value === 0);
  check("a zero modifier on a wielded arm is still a row", (() => { const r = added(attack(monster(7), weapon("1d8", "weapon"), "melee")); return r.length === 1 && r[0].value === 0; })());
  register({ strengthAttack: { attribute: { col1: "1 or less", col2: "2 or more", header: true }, 7: { col1: 90, col2: 91 } } }, PRIORITY.OVERRIDE);
  const row = added(attack(monster(7), claw, "melee"))[0];
  check("an override's cell is read", row.value === 91);
  check("an override has no page, so the label carries the shipped reference", row.label === "Strength 7, 5.5 average damage (MM ch. 3)");
}
resetTables();

/* --- registration ------------------------------------------------------------------- */
check("registering the contributor is repeatable", (() => { registerStrengthContributor(); registerStrengthContributor(); return true; })());

process.stdout.write(`strength contributor: ${pass} checks passed\n`);
