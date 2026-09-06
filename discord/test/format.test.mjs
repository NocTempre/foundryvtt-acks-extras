import { test } from "node:test";
import assert from "node:assert";
import { clip, refusalText, characterLabel, whoamiText, sheetEmbed, rollChoice, chatLine, rollText, sayText, relayable, looksLikeDice, diceText, LIMITS } from "../src/format.mjs";

test("clip cuts at the limit and marks the cut", () => {
  assert.equal(clip("abc", 5), "abc");
  assert.equal(clip("abcdef", 4), "abc…");
  assert.equal(clip(null, 3), "");
});

test("refusal codes read as the member's own problem, unknown codes as Foundry's", () => {
  assert.match(refusalText("unbound"), /link/);
  assert.match(refusalText("noActive"), /character use/);
  assert.match(refusalText("notFound", "no actor"), /no actor/);
  assert.match(refusalText("seatDown"), /reconnecting/);
  assert.match(refusalText("failed", "boom"), /Foundry refused: boom/);
});

test("a character label carries class and level when known", () => {
  assert.equal(characterLabel({ name: "Ael", cls: "Fighter", level: 3 }), "Ael (Fighter 3)");
  assert.equal(characterLabel({ name: "Ael", cls: { name: "Mage", level: 1 } }), "Ael (Mage 1)");
  assert.equal(characterLabel({ name: "Ael", cls: "", level: null }), "Ael");
});

test("whoami says linked, speaking-as and the roster", () => {
  assert.match(whoamiText({ bound: false }), /not linked/);
  const t = whoamiText({ bound: true, user: { name: "Player" }, judge: false, active: { name: "Ael", cls: "Thief", level: 2 }, characters: [{ name: "Ael" }, { name: "Bo" }] });
  assert.match(t, /\*\*Player\*\*/);
  assert.match(t, /Ael \(Thief 2\)/);
  assert.match(t, /Ael, Bo/);
});

test("the sheet embed carries vitals, purse, saves and hands within Discord's limits", () => {
  const e = sheetEmbed({
    name: "Ael", cls: { name: "Fighter", level: 3 }, hp: { value: 9, max: 20 }, ac: { value: 6, shield: 1, naked: 1 },
    xp: { value: 500, next: 2000 }, coinGp: 12.345, move: { modes: { combat: 40, exploration: 120, expedition: 24 } },
    saves: { death: 12, blast: 14 }, grip: { weapons: [{ name: "Sword", twoHanded: false }] }, formation: { name: "The Company" }, pending: 2,
  });
  assert.equal(e.title, "Ael — Fighter 3");
  const byName = Object.fromEntries(e.fields.map((f) => [f.name, f.value]));
  assert.equal(byName.HP, "9 / 20");
  assert.equal(byName.AC, "6 (5 without shield)");
  assert.equal(byName.XP, "500 / 2000");
  assert.equal(byName.Purse, "12.35 gp");
  assert.equal(byName.Movement, "combat 40 · exploration 120 · expedition 24");
  assert.equal(byName.Saves, "death 12+ · blast 14+");
  assert.equal(byName["In hand"], "Sword");
  assert.equal(byName.Party, "The Company");
  assert.ok(e.fields.length <= LIMITS.fields);
});

test("a roll choice names the row and its group, and answers the id", () => {
  assert.deepEqual(rollChoice({ id: "save:death", label: "Death", value: "12+", group: "Saves" }), { name: "Death 12+ · Saves", value: "save:death" });
});

test("a chat line shows dice when there are dice, text otherwise", () => {
  assert.equal(chatLine({ speaker: { alias: "Ael" }, flavor: "Death save", rolls: [{ total: 15, formula: "1d20" }], text: "" }), "🎲 **Ael** — Death save: **15** (1d20)");
  assert.equal(chatLine({ speaker: { alias: "Ael" }, flavor: "", rolls: [], text: "draws her sword" }), "**Ael**: draws her sword");
  assert.equal(rollText({ actor: { name: "Ael" }, id: "x", messages: [] }), "**Ael** rolled `x` — the card posted in Foundry carried nothing this bot can read.");
});

test("say renders as speech or as an emote", () => {
  assert.equal(sayText({ actor: { name: "Ael" }, text: "Hold.", style: "ic" }), "**Ael:** Hold.");
  assert.equal(sayText({ actor: { name: "Ael" }, text: "draws her sword", style: "emote" }), "*Ael draws her sword*");
});

test("the relay takes public chat that this bot did not already show", () => {
  assert.equal(relayable({ type: "chat", whisper: [], blind: false, text: "hi" }), true);
  assert.equal(relayable({ type: "chat", whisper: ["gm"], blind: false, text: "hi" }), false);
  assert.equal(relayable({ type: "chat", whisper: [], blind: true, text: "hi" }), false);
  assert.equal(relayable({ type: "chat", whisper: [], blind: false, text: "hi", bridge: { via: "discord" } }), false);
  assert.equal(relayable({ type: "actor", text: "hi" }), false);
  assert.equal(relayable({ type: "chat", whisper: [], blind: false, text: "", rolls: [] }), false);
});

test("dice are told from a throw by shape: a die and no colon", () => {
  for (const f of ["2d6+3", "d20", "1d8 + 2d4", "4dF", "d%", "3d6kh2", "(2d6+1)*2"]) assert.equal(looksLikeDice(f), true, f);
  for (const f of ["save:death", "atk:sword", "", "   ", "dagger", "5", "wpn:d6-blade"]) assert.equal(looksLikeDice(f), false, JSON.stringify(f));
});

test("a dice throw reads as who, formula, total and every die; an actor when the world kept it", () => {
  const t = diceText({ formula: "2d6 + 3", total: 11, dice: [{ faces: 6, results: [{ value: 3, active: true }, { value: 5, active: true }] }], actor: null }, "Bo");
  assert.match(t, /\*\*Bo\*\* rolls `2d6 \+ 3` → \*\*11\*\*/);
  assert.match(t, /d6: 3, 5/);
  assert.doesNotMatch(t, / as \*\*/);
  const kept = diceText({ formula: "3d6kh2", total: 10, dice: [{ faces: 6, results: [{ value: 6, active: true }, { value: 4, active: true }, { value: 1, active: false }] }], actor: { name: "Aelin" } }, "Bo");
  assert.match(kept, /as \*\*Aelin\*\*/);
  assert.match(kept, /~~1~~/, "a dropped die is struck through");
  assert.match(diceText(null, undefined), /Someone/);
});

test("a forbidden refusal carries its reason when the world gave one", () => {
  assert.equal(refusalText("forbidden"), "That is not yours to do.");
  assert.match(refusalText("forbidden", "a Gamemaster's password is never set from outside Foundry"), /Gamemaster's password/);
});
