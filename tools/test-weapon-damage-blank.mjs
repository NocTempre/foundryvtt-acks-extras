/**
 * A weapon with no damage formula stays blank (scripts/equipment/damage-blank.mjs,
 * the named and scavenged overlays).
 *
 * What this pins: no layer writes an invented die over a blank formula; a
 * blank weapon is told apart from one that has a formula; an answer is kept
 * only when the roller's own check accepts it; and saving the answer becomes
 * the captured base of every layer that captured a blank, so the layers apply
 * over it once. The prompt itself and the save through Foundry are the live
 * recipe's (docs/equipment/TESTING.md, "A weapon with no damage formula").
 */
import assert from "node:assert/strict";

let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log("ok   " + name); };

const { needsDamageFormula, damageAnswer, savedFormulaUpdates, DAMAGE_FIELD } = await import("../scripts/equipment/damage-blank.mjs");
const N = await import("../scripts/equipment/overlays/named.mjs");
const S = await import("../scripts/equipment/overlays/scavenged.mjs");

/** A weapon stand-in: `flags` are read through `getFlag` as Foundry's are. */
const weapon = (formula, flags = {}) => ({
  type: "weapon",
  system: { damage: { base: { formula } }, bonus: { attack: 0 }, weight6: 6 },
  getFlag: (_m, k) => flags[k],
});

ok("a blank or absent formula needs one; a stated one does not", () => {
  assert.equal(needsDamageFormula(weapon("")), true);
  assert.equal(needsDamageFormula(weapon("  ")), true);
  assert.equal(needsDamageFormula({ type: "weapon", system: {} }), true);
  assert.equal(needsDamageFormula(weapon("1d8")), false);
  assert.equal(needsDamageFormula({ type: "armor", system: {} }), false);
  assert.equal(needsDamageFormula(null), false);
});

ok("a flat figure a layer left over a blank snapshot still needs a formula", () => {
  assert.equal(needsDamageFormula(weapon("-1", { pristine: { damage: "" } })), true);
  assert.equal(needsDamageFormula(weapon("-1")), false, "with no blank snapshot a flat figure is the weapon's own");
  assert.equal(needsDamageFormula(weapon("1d6 - 1", { pristine: { damage: "1d6" } })), false);
});

ok("an answer is kept only when the roller accepts it", () => {
  const validate = (f) => /^\d*d\d+([+-]\d+)?$/.test(f.replace(/\s/g, ""));
  assert.equal(damageAnswer(" 1d8+1 ", validate), "1d8+1");
  assert.equal(damageAnswer("", validate), null);
  assert.equal(damageAnswer("sword", validate), null);
  assert.equal(damageAnswer("1d8", () => { throw new Error("parse"); }), null);
});

ok("saving onto a plain weapon writes the formula alone", () => {
  const { update, layers } = savedFormulaUpdates(weapon(""), "1d8");
  assert.deepEqual(update, { [DAMAGE_FIELD]: "1d8" });
  assert.deepEqual(layers, { pristine: false, named: false });
});

ok("saving onto a layered blank fills each blank captured base", () => {
  const w = weapon("", { pristine: { damage: "", bonus: 0 }, named: { base: { bonus: 0, damage: "" }, ladder: ["damage"], unlocked: 1 } });
  const { update, layers } = savedFormulaUpdates(w, "1d8");
  assert.equal(update[DAMAGE_FIELD], "1d8");
  assert.equal(update["flags.acks-extras.pristine.damage"], "1d8");
  assert.equal(update["flags.acks-extras.named.base.damage"], "1d8");
  assert.deepEqual(layers, { pristine: true, named: true });
  const kept = savedFormulaUpdates(weapon("", { pristine: { damage: "1d6" } }), "1d8");
  assert.equal("flags.acks-extras.pristine.damage" in kept.update, false, "a stated snapshot is not overwritten");
});

const namedRec = (base, unlocked = 1) => ({ trueName: "T", ladder: ["damage", "hit"], unlocked, revealed: false, guesses: {}, base });

ok("a named weapon with no formula captures a blank base, not a die", () => {
  assert.equal(N.captureBase(weapon("")).damage, "");
});

ok("an unlocked damage bonus over a blank base writes nothing to the damage field", () => {
  const w = weapon("", { named: namedRec({ bonus: 0, damage: "", weight6: 6 }) });
  const u = N.applyUpdates(w);
  assert.equal(DAMAGE_FIELD in u, false);
  assert.equal(u["system.bonus.attack"], 0);
});

ok("once the formula is saved, the bonus layers over it once and the base is re-captured", () => {
  const rec = namedRec({ bonus: 0, damage: "", weight6: 6 }, 2);
  const w = weapon("1d8", { named: rec });
  const u = N.applyUpdates(w);
  assert.equal(u[DAMAGE_FIELD], "1d8+1");
  assert.equal(u["system.bonus.attack"], 1);
  assert.equal(u["flags.acks-extras.named.base.damage"], "1d8");
  // The write lands: the stored base now holds the formula, the field the layered one.
  const after = weapon("1d8+1", { named: { ...rec, base: { ...rec.base, damage: "1d8" } } });
  const again = N.applyUpdates(after);
  assert.equal(again[DAMAGE_FIELD], "1d8+1", "a second application does not compound");
  assert.equal("flags.acks-extras.named.base.damage" in again, false);
});

ok("a level-up over a blank base advances the rung and writes no die", () => {
  const w = { ...weapon("", { named: namedRec({ bonus: 0, damage: "", weight6: 6 }, 0) }), system: { damage: { base: { formula: "" } }, bonus: { attack: 0 }, weight6: 6, equipped: true } };
  const [adv] = N.advanceWieldedOnLevelUp({ items: [w] }, 1);
  assert.equal(adv.updates["flags.acks-extras.named.unlocked"], 1);
  assert.equal(DAMAGE_FIELD in adv.updates, false);
});

ok("a scavenged damage penalty over a blank formula writes no die", () => {
  const cond = { attack: 0, damage: -1, ac: 0, encumbrance: 0, labels: [], breaks: false, cannotSneak: false, initiative: 0, valueMultiplier: 1 };
  assert.equal(DAMAGE_FIELD in S.toItemUpdates(weapon(""), cond), false);
  assert.equal(S.toItemUpdates(weapon("1d6"), cond)[DAMAGE_FIELD], "1d6-1");
});

// A spell carrier is built per cast and is never asked. A stored weapon asks as
// it did. The unarmed strike has a window of its own: it keeps what is typed on
// the world, where the seat may modify world settings, and asks again where not.
{
  const prompts = [];
  const shown = [];
  const warned = [];
  const kept = [];
  let keepFails = false;
  let mayModify = true;

  /** A DialogV2 stand-in: the config it was built with, the nodes the code queries, and its listeners. */
  class FakeDialog {
    static async prompt() { prompts.push(1); return null; }
    constructor(config) {
      this.config = config;
      this.closed = false;
      this.listeners = {};
      this.face = { textContent: "" };
      this.button = { attrs: {}, querySelector: () => this.face, setAttribute: (k, v) => { this.button.attrs[k] = v; } };
      this.error = { hidden: true, textContent: "" };
      this.field = { attrs: {}, setAttribute: (k, v) => { this.field.attrs[k] = v; }, focus() {} };
      this.keep = config.content.includes('name="keep"') ? { checked: false, addEventListener: (_t, fn) => { this.keep.onChange = fn; } } : null;
      const nodes = { 'button[data-action="attack"]': this.button, "[data-strike-error]": this.error, 'input[name="formula"]': this.field, 'input[name="keep"]': this.keep };
      this.element = { querySelector: (sel) => nodes[sel] ?? null };
      shown.push(this);
    }
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
    render() { for (const fn of this.listeners.render ?? []) fn(); return this; }
    async close() {
      if (this.closed) return;
      this.closed = true;
      for (const fn of this.listeners.close ?? []) fn();
    }
    /** What a press of Attack does: the button's callback reads the form, then the dialog's own submit runs. */
    async press(formula, { keep } = {}) {
      if (this.keep && keep !== undefined) { this.keep.checked = keep; this.keep.onChange(); }
      const elements = { formula: { value: formula }, keep: this.keep ? { checked: this.keep.checked } : undefined };
      const answer = await this.config.buttons[0].callback(null, { form: { elements } });
      await this.config.submit(answer, this);
    }
  }
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const pending = Symbol("pending");
  const settled = async (promise) => Promise.race([promise, tick().then(() => pending)]);

  globalThis.foundry = { applications: { api: { DialogV2: FakeDialog } } };
  globalThis.game = { i18n: { has: () => false, localize: (k) => k, format: (k) => k }, user: { can: (p) => (p === "SETTINGS_MODIFY" ? mayModify : false) } };
  globalThis.ui = { notifications: { warn: (m) => warned.push(m), info() {} } };
  globalThis.Roll = { validate: () => true };
  globalThis.acksExtras = {
    lib: {
      services: {
        get: (name) => (name === "ruledata-import" ? { setOverride: async (...args) => { if (keepFails) throw new Error("refused"); kept.push(args); } } : null),
      },
    },
  };
  globalThis.CONFIG = {
    Item: {
      documentClass: class {
        constructor(data) { Object.assign(this, data); }
        updateSource(patch) {
          for (const [path, value] of Object.entries(patch)) {
            const parts = path.split(".");
            let node = this;
            for (const part of parts.slice(0, -1)) node = node[part];
            node[parts.at(-1)] = value;
          }
        }
      },
    },
  };
  const { prepareDamageFormula } = await import("../scripts/equipment/damage-prompt.mjs");
  const { rollUnarmed, isUnarmedStrike } = await import("../scripts/equipment/actions.mjs");
  const { asUnarmedDie } = await import("../scripts/equipment/attack-mods.mjs");
  const { spellCarrier } = await import("../scripts/lib/patches/attack-throw.mjs");

  const newStrike = () => {
    const struck = [];
    rollUnarmed({ makeAttackThrow: (o) => { struck.push(o.item); return true; } }, { skipDialog: true });
    return struck[0];
  };
  const strike = newStrike();
  assert.equal(isUnarmedStrike(strike), true);
  assert.equal(strike.system.damage.base.formula, "", "no die imported: the strike's formula is blank");
  assert.equal(needsDamageFormula(strike), true, "a blank weapon is one that needs a formula");

  ok("the one test for a die is NdM, and nothing else", () => {
    for (const good of ["1d6", "d8", " 2d4 ", "10D6"]) assert.notEqual(asUnarmedDie(good), null, good);
    assert.equal(asUnarmedDie(" d8 "), "d8", "trimmed");
    for (const bad of ["2d6+1", "1d6 - 1", "a lot", "", "  ", null, undefined, 6, "d", "1d"]) assert.equal(asUnarmedDie(bad), null, String(bad));
  });

  // A seat that may modify world settings: the strike asks, with the keep choice.
  {
    const run = prepareDamageFormula({ weapon: strike });
    await tick();
    const w = shown.at(-1);
    assert.equal(shown.length, 1, "the strike opens its own window");
    assert.deepEqual(prompts, [], "and not the stored-weapon prompt");
    assert.ok(w.keep, "this seat is offered the keep choice");
    assert.ok(w.config.content.includes("hintStrike<"), "the hint is the strike's own, not the weapon's");
    assert.ok(!w.config.content.includes("damagePrompt.hint<"), "the weapon's hint never shows");
    assert.equal(w.face.textContent, "ACKS-EQUIPMENT.damagePrompt.attack", "the button reads Attack");
    assert.equal(w.button.attrs["data-tooltip-text"], "ACKS-EQUIPMENT.damagePrompt.attackTip");
    assert.equal(w.config.form.closeOnSubmit, false, "a refusal can leave the window open");
    assert.ok(w.config.classes.includes("acks-extras-scroll"), "the window is in the scroll contract");

    await w.press("a lot");
    assert.equal(w.error.hidden, false, "a typed answer that is not a die is refused on the window");
    assert.ok(w.error.textContent.includes("invalidDie"));
    assert.equal(w.field.attrs["aria-invalid"], "true");
    assert.equal(w.closed, false, "the window stays open");
    assert.equal(await settled(run), pending, "and the attack waits");
    await w.press("2d6+1");
    assert.equal(w.closed, false, "a die with a flat figure on it is refused too: the table would read it back as not imported");
    assert.deepEqual(kept, [], "nothing is written");

    w.keep.checked = true;
    w.keep.onChange();
    assert.equal(w.face.textContent, "ACKS-EQUIPMENT.damagePrompt.save", "ticked, the button says it will save");
    assert.equal(w.button.attrs["data-tooltip-text"], "ACKS-EQUIPMENT.damagePrompt.saveTip");
    w.keep.checked = false;
    w.keep.onChange();
    assert.equal(w.face.textContent, "ACKS-EQUIPMENT.damagePrompt.attack", "unticked, it reads Attack again");

    await w.press("1d3", { keep: false });
    assert.equal(await run, true, "attack once: the throw goes ahead");
    assert.equal(strike.system.damage.base.formula, "1d3", "with the typed die on this throw's weapon");
    assert.deepEqual(kept, [], "and nothing kept for the world");
    assert.equal(w.closed, true);
    passed++;
    console.log("ok   a seat that may modify world settings: the strike asks, refuses a non-die on the window, attacks once without keeping");
  }
  {
    const second = newStrike();
    const run = prepareDamageFormula({ weapon: second });
    await tick();
    const w = shown.at(-1);
    await w.press("2d4", { keep: true });
    assert.equal(await run, true);
    assert.deepEqual(kept, [["equipment", "unarmedStrike", { damage: "2d4" }, { sourceName: "unarmed strike prompt" }]], "ticked: the die is written as the world's override of the unarmed strike's damage");
    assert.equal(second.system.damage.base.formula, "2d4");
    passed++;
    console.log("ok   ticked: the die is kept as the world's override and carried on the throw");
  }
  {
    keepFails = true;
    const third = newStrike();
    const run = prepareDamageFormula({ weapon: third });
    await tick();
    await shown.at(-1).press("1d4", { keep: true });
    assert.equal(await run, true, "a write that fails does not cost the attack");
    assert.equal(third.system.damage.base.formula, "1d4");
    assert.deepEqual(warned, ["ACKS-EQUIPMENT.damagePrompt.keepFailed"], "and is said on the screen");
    keepFails = false;
    warned.length = 0;
    passed++;
    console.log("ok   a refused write is said on the screen and the attack goes ahead");
  }
  {
    const fourth = newStrike();
    const run = prepareDamageFormula({ weapon: fourth });
    await tick();
    await shown.at(-1).close();
    assert.equal(await run, false, "closing the window cancels the attack");
    assert.equal(fourth.system.damage.base.formula, "", "and writes nothing");
    passed++;
    console.log("ok   closing the window cancels the attack");
  }

  // A seat without it: the field and Attack alone; nothing can be kept.
  {
    mayModify = false;
    const before = kept.length;
    const fifth = newStrike();
    const run = prepareDamageFormula({ weapon: fifth });
    await tick();
    const w = shown.at(-1);
    assert.equal(w.keep, null, "no keep choice is drawn");
    assert.ok(!w.config.content.includes('type="checkbox"'));
    assert.ok(w.config.content.includes("hintStrikePlayer<"), "the reason is words on the window");
    assert.equal(w.button.attrs["data-tooltip-text"], "ACKS-EQUIPMENT.damagePrompt.attackTipPlayer");
    const answer = { formula: "1d6", keep: true };
    w.config.buttons[0].callback = async () => answer;
    await w.press("1d6");
    assert.equal(await run, true, "the typed die applies to this throw");
    assert.equal(fifth.system.damage.base.formula, "1d6");
    assert.equal(kept.length, before, "and even an answer that claims to keep writes nothing");
    mayModify = true;
    passed++;
    console.log("ok   a seat without the permission: field and Attack only, nothing kept");
  }

  // The spell carrier is never asked, and a stored weapon asks as before.
  {
    const windows = shown.length;
    const caster = {};
    const carrier = spellCarrier(caster, { key: "row", delivery: "melee" }, { castId: "c1" });
    assert.equal(needsDamageFormula(carrier), true, "a carrier whose row has no roll is blank");
    assert.equal(await prepareDamageFormula({ weapon: carrier }), true, "the attack goes ahead");
    assert.equal(shown.length, windows, "and no window opens");
    assert.deepEqual(prompts, [], "a carrier is not asked");
    passed++;
    console.log("ok   a spell carrier is never asked for a formula");

    const plain = new CONFIG.Item.documentClass({ type: "weapon", name: "blank", system: { damage: { base: { formula: "" } } } });
    assert.equal(isUnarmedStrike(plain), false);
    assert.equal(await prepareDamageFormula({ weapon: plain }), false, "an ordinary blank weapon still asks, and a closed prompt cancels the attack");
    assert.equal(prompts.length, 1, "the stored-weapon prompt opened once");
    assert.equal(shown.length, windows, "not the strike's window");
    const copy = new CONFIG.Item.documentClass({ ...strike });
    assert.equal(isUnarmedStrike(copy), false, "a copy of the strike is an ordinary unsaved weapon and asks as one");
    assert.equal(isUnarmedStrike(null), false);
    passed++;
    console.log("ok   an ordinary blank weapon, a saved or an unsaved one, still asks as before");
  }
}

console.log(`\n${passed} passed`);
