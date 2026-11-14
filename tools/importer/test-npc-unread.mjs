/**
 * An adventure NPC's unread figures, end to end without Foundry: the actor
 * paths an unread parse path stands for, the `derived.unread` list an import
 * writes from the created actor, and the Statblock rows that draw blank while
 * the actor holds that value. The actor is a plain object holding invented
 * stand-ins for core's initial values with `bindNpc`'s writes laid over them.
 * Every line and figure here is invented: no PDFs, no engine.
 */
import assert from "node:assert/strict";
import { parseStatline } from "../../scripts/importer/executor.mjs";
import { bindNpc } from "../../scripts/importer/cookbook/monster.mjs";
import { UNREAD_FIGURES, unreadActorPaths, unreadRecord, unreadOfStatline } from "../../scripts/importer/unread-figures.mjs";
import { statblockColumns } from "../../scripts/monsters/statblock.mjs";
import { blankedFigures, blankUnreadRows } from "../../scripts/monsters/unread-figures.mjs";

let n = 0;
const t = async (name, fn) => {
  await fn();
  n++;
  console.log(`ok - ${name}`);
};

const LINE = "MV 50’, AC 4, HD 3, hp 17, #AT 1 (poke 8+: 1d4 piercing), SV F3, ML +1, AL N, XP 77";
const CITE = "ZZ p.9";
const SAVE_KEYS = { paralysis: "paralysis", death: "death", blast: "blast", implements: "implements", spell: "spell" };
const loc = (key) => key;

/** A path's value, as `foundry.utils.getProperty` reads it. */
const getProperty = (obj, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
/** `obj` with `value` set at `path`. */
const setProperty = (obj, path, value) => {
  const keys = path.split(".");
  const last = keys.pop();
  keys.reduce((o, k) => (o[k] ??= {}), obj)[last] = value;
};
/** The statline as the read leaves it: each unread path deleted from the parse and echoed as `unread`. */
const readLine = (line, unread = []) => {
  const sl = parseStatline(line);
  for (const p of unread) {
    const keys = p.split(".");
    const last = keys.pop();
    delete keys.reduce((o, k) => o?.[k], sl)?.[last];
  }
  return unread.length ? { ...sl, unread: [...unread] } : sl;
};
/** The actor core would hold: invented initial values, then what the binding wrote over them. */
const actorFor = (unread) => {
  const system = {
    saves: Object.fromEntries(Object.keys(SAVE_KEYS).map((k, i) => [k, { value: 31 + i }])),
    hp: { value: 41, max: 42, hd: "9d9" },
    ac: { value: 43 },
    details: { morale: 44, xp: 45 },
    movement: { base: 46 },
    attack: { throw: 47 },
  };
  const bound = bindNpc({ fields: { statline: readLine(LINE, unread) } });
  const lay = (target, from) => {
    for (const [k, v] of Object.entries(from ?? {})) {
      if (v && typeof v === "object" && !Array.isArray(v)) lay((target[k] ??= {}), v);
      else target[k] = v;
    }
  };
  lay(system, bound.system);
  return { system, bound };
};
/** The unread list an import writes for a created actor. */
const recordOf = (unread) => {
  const { system, bound } = actorFor(unread);
  const actor = { system };
  return { actor, bound, list: unreadRecord(bound.statline.unread, (p) => getProperty(actor, p), CITE) };
};
/** The Statblock's columns for the actor, drawn the way the sheet does. */
const columnsOf = (actor, list) => {
  const sys = actor.system;
  const snap = {
    saves: Object.fromEntries(Object.keys(SAVE_KEYS).map((k) => [k, sys.saves[SAVE_KEYS[k]].value])),
    saveLabels: Object.fromEntries(Object.keys(SAVE_KEYS).map((k) => [k, k])),
    saveKeys: SAVE_KEYS,
    morale: sys.details.morale,
    attackThrow: sys.attack.throw,
    attacks: [{ id: "w1", name: "Poke", damage: "1d4" }],
    hp: { value: sys.hp.value, max: sys.hp.max, formula: sys.hp.hd },
    hdText: sys.hp.hd,
  };
  const { columns } = statblockColumns(snap, loc);
  const before = structuredClone(columns);
  blankUnreadRows(columns, blankedFigures(list, (p) => getProperty(actor, p)), SAVE_KEYS);
  return { columns, before };
};
const rowOf = (columns, id) => columns.flat().flatMap((g) => g.rows ?? []).find((r) => r.id === id);
const groupOf = (columns, key) => columns.flat().find((g) => g.key === key);

/* ---------------- the map ---------------- */

await t("each parse figure stands for the actor fields the binding writes, and the save row for all five", () => {
  assert.deepEqual(unreadActorPaths(["save"]), UNREAD_FIGURES.save);
  assert.equal(UNREAD_FIGURES.save.length, 5);
  assert.deepEqual(unreadActorPaths(["ac", "ml", "xp"]), ["system.ac.value", "system.details.morale", "system.details.xp"]);
  assert.deepEqual(unreadActorPaths(["mv"]), ["system.movement.base"]);
});

await t("a path under a figure, or a figure's parent, stands for the figure; a repeat lists a path once", () => {
  assert.deepEqual(unreadActorPaths(["save.level"]), UNREAD_FIGURES.save);
  assert.deepEqual(unreadActorPaths(["atk.throw"]), ["system.attack.throw"]);
  assert.deepEqual(unreadActorPaths(["atk", "atk.throw"]), ["system.attack.throw"]);
  assert.deepEqual(unreadActorPaths(["hp", "hd"]).sort(), ["system.hp.hd", "system.hp.max", "system.hp.value"]);
  assert.deepEqual(unreadActorPaths(["hp"]), ["system.hp.value", "system.hp.max"], "hit points do not stand for the hit dice, which bind from their own figure");
});

await t("a path the map does not know stands for nothing and throws nothing", () => {
  assert.deepEqual(unreadActorPaths(["bogus", "class.level", "", 7, null]), []);
  assert.deepEqual(unreadActorPaths(undefined), []);
  assert.deepEqual(unreadActorPaths("save"), []);
  assert.deepEqual(unreadRecord(["bogus"], () => 1, CITE), []);
});

/* ---------------- the list an import writes ---------------- */

await t("nothing unread writes an empty list, and nothing draws blank", () => {
  const { actor, list } = recordOf([]);
  assert.deepEqual(list, []);
  assert.equal(blankedFigures(list, (p) => getProperty(actor, p)).size, 0);
  const { columns, before } = columnsOf(actor, list);
  assert.deepEqual(columns, before, "no row is touched");
  assert.match(rowOf(columns, "save:death").value, /^\d+\+$/, "a figure read draws as a figure");
  assert.equal(rowOf(columns, "save:death").blank, undefined);
});

await t("save unread lists each save figure with the value the actor holds, and the binding wrote none of them", () => {
  const { actor, bound, list } = recordOf(["save"]);
  assert.equal(bound.system.saves, undefined);
  assert.deepEqual(list.map((e) => e.path), UNREAD_FIGURES.save);
  assert.deepEqual(list.map((e) => e.held), [31, 32, 33, 34, 35]);
  assert.ok(list.every((e) => e.cite === CITE));
  assert.equal(actor.system.ac.value, 4, "a figure that was read still binds");
});

await t("hit points unread lists the value and the maximum; hit dice unread too lists the dice", () => {
  assert.deepEqual(recordOf(["hp"]).list, [
    { path: "system.hp.value", held: 41, cite: CITE },
    { path: "system.hp.max", held: 42, cite: CITE },
  ]);
  assert.deepEqual(recordOf(["hp", "hd"]).list, [
    { path: "system.hp.hd", held: "9d9", cite: CITE },
    { path: "system.hp.value", held: 41, cite: CITE },
    { path: "system.hp.max", held: 42, cite: CITE },
  ]);
});

await t("unread hit dice with no hit points printed stand for the hit points too; printed ones do not", () => {
  assert.deepEqual(unreadOfStatline({ unread: ["hd"] }), ["hd", "hp"]);
  assert.deepEqual(unreadOfStatline({ unread: ["hd"], hp: 7 }), ["hd"]);
  assert.deepEqual(unreadOfStatline({ unread: ["hd", "hp"] }), ["hd", "hp"]);
  assert.deepEqual(unreadOfStatline({}), []);
  assert.deepEqual(unreadOfStatline(undefined), []);
});

await t("a repair keeps the value an earlier import listed, so a Judge's edit is not taken for core's", () => {
  const earlier = [{ path: "system.details.morale", held: 0, cite: "ZZ p.1" }];
  assert.deepEqual(unreadRecord(["ml", "xp"], () => 3, CITE, earlier), [
    { path: "system.details.morale", held: 0, cite: CITE },
    { path: "system.details.xp", held: 3, cite: CITE },
  ]);
});

await t("a figure the actor has no value for is held as null", () => {
  assert.deepEqual(unreadRecord(["xp"], () => undefined), [{ path: "system.details.xp", held: null, cite: "" }]);
});

/* ---------------- the rows ---------------- */

await t("a save row is blank while the actor holds the value it was created with, its tooltip the page reference", () => {
  const { actor, list } = recordOf(["save"]);
  const { columns } = columnsOf(actor, list);
  for (const k of Object.keys(SAVE_KEYS)) {
    const row = rowOf(columns, `save:${k}`);
    assert.equal(row.value, "");
    assert.equal(row.valueTip, CITE);
    assert.equal(row.blank, true);
  }
  assert.notEqual(rowOf(columns, "morale").value, "", "a figure that was read draws as it did");
  assert.equal(rowOf(columns, "morale").blank, undefined);
});

await t("a figure a Judge has edited draws as any figure, and the rest stay blank", () => {
  const { actor, list } = recordOf(["save"]);
  actor.system.saves.death.value = 99;
  const { columns } = columnsOf(actor, list);
  assert.equal(rowOf(columns, "save:death").value, "99+");
  assert.equal(rowOf(columns, "save:death").blank, undefined);
  assert.notEqual(rowOf(columns, "save:death").valueTip, CITE);
  assert.equal(rowOf(columns, "save:blast").value, "");
  assert.equal(rowOf(columns, "save:blast").valueTip, CITE);
});

await t("equality keeps its type: a figure edited to the same digits as text is an edit", () => {
  const { actor, list } = recordOf(["save"]);
  actor.system.saves.death.value = "32";
  assert.equal(blankedFigures(list, (p) => getProperty(actor, p)).has("system.saves.death.value"), false);
});

await t("hit points and hit dice unread blank the roll, the hit dice line and the formula note", () => {
  const { actor, list } = recordOf(["hp", "hd"]);
  const { columns } = columnsOf(actor, list);
  const hp = rowOf(columns, "hp");
  assert.equal(hp.value, "");
  assert.equal(hp.valueTip, CITE);
  const hd = rowOf(columns, "hd");
  assert.equal(hd.line, "");
  assert.equal(hd.valueTip, CITE);
  assert.equal(groupOf(columns, "hitPoints").note, "");
  assert.equal(rowOf(columns, "atk:w1").value, "8+", "the attack throw was read");
  actor.system.hp.value = 12;
  const edited = columnsOf(actor, list).columns;
  assert.equal(rowOf(edited, "hp").value, "12 / 42");
  assert.equal(rowOf(edited, "hd").line, "", "the hit dice are still core's");
});

await t("an unread attack throw blanks every attack row and the note that reads it", () => {
  const { actor, list } = recordOf(["atk"]);
  const { columns } = columnsOf(actor, list);
  assert.equal(rowOf(columns, "atk:w1").value, "");
  assert.equal(rowOf(columns, "atk:w1").valueTip, CITE);
  assert.equal(groupOf(columns, "attacks").note, "");
});

await t("an unread morale blanks its row; a list with nothing for the Statblock draws nothing", () => {
  const { actor, list } = recordOf(["ml", "mv", "ac"]);
  const { columns } = columnsOf(actor, list);
  assert.equal(rowOf(columns, "morale").value, "");
  assert.equal(rowOf(columns, "morale").valueTip, CITE);
  assert.equal(rowOf(columns, "save:spell").blank, undefined);
});

await t("a malformed or absent list is empty and throws nothing", () => {
  const read = () => 1;
  assert.equal(blankedFigures(undefined, read).size, 0);
  assert.equal(blankedFigures("save", read).size, 0);
  assert.equal(blankedFigures([null, {}, { path: "" }, { path: 3 }], read).size, 0);
  assert.equal(blankedFigures([{ path: "system.ac.value", held: 1 }], read).get("system.ac.value"), "", "no page reference is an empty tip");
  assert.doesNotThrow(() => blankUnreadRows([], new Map([["system.ac.value", ""]])));
});

console.log(`\n${n} checks passed`);
