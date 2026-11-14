/**
 * A lair's roster, over invented rows and mocked documents: no PDFs, no Foundry.
 *
 * Drives `keyedOccupantRows` with a stat-line label registered to a replacement
 * (`creatureReplacement`), a label the library's creatures answer by name, and
 * a place whose row names the monster it is the lair of (`meta.of`). The names
 * are invented, and so are the keys: each is the hash of an invented label.
 */
import assert from "node:assert";
import { creatureKeys } from "../../scripts/lib/vocab.mjs";
import { hash36 } from "../../scripts/importer/printed-name.mjs";
import { replacementOf, withHostRow } from "../../scripts/importer/poi-binding.mjs";
import { keyedOccupantRows } from "../../scripts/importer/cookbook/adventure-places.mjs";
import { data } from "../../scripts/importer/cookbook/state.mjs";
import { cookbookSource } from "./cookbook-source.mjs";

let pass = 0;
const check = (label, cond) => { assert.ok(cond, label); pass++; };
const same = (label, a, b) => { assert.deepStrictEqual(a, b, label); pass++; };

/** The replacement table's keys for each invented label, as the register is authored. */
const table = (...pairs) => {
  const out = {};
  for (const [label, ref, books = ["zz"]] of pairs) for (const form of creatureKeys(label)) out[hash36(form)] = { ref, books };
  return out;
};

/* --- the pure lookup --- */

const PAIRS = table(["Ember Wisps", "zz.emberWisp"], ["Slate Crawlers", "zz.slateCrawler", ["other"]]);
same("a plural label finds the pair its singular form was authored for", replacementOf("Ember Wisp", PAIRS, "zz"), "zz.emberWisp");
same("and the plural as printed", replacementOf("Ember Wisps (2d4)", PAIRS, "zz"), "zz.emberWisp");
same("a pair answers only for the books it names", replacementOf("Slate Crawlers", PAIRS, "zz"), null);
same("a label with no pair has none", replacementOf("Dust Moths", PAIRS, "zz"), null);
same("no table has none", replacementOf("Ember Wisps", null, "zz"), null);

const hostRow = { uuid: "Actor.mon", name: "Host", kind: "monster", hidden: true };
same("a host row is appended to the roster", withHostRow([{ uuid: "Actor.a" }], hostRow), [{ uuid: "Actor.a" }, hostRow]);
const already = [{ uuid: "Actor.a" }, { uuid: "Actor.mon", quantity: 3 }];
check("a stat line already bound to the monster takes no second row", withHostRow(already, hostRow) === already);
const empty = [];
check("no monster in the library adds no row", withHostRow(empty, null) === empty);

/* --- the roster built over mocked documents --- */

/** A library actor the importer stamped with a cookbook id. */
const actor = (id, name, type = "monster") => ({
  id: id.replace(/\W/g, "_"), uuid: `Actor.${id.replace(/\W/g, "_")}`, name, img: "", type, system: {},
  flags: { "acks-extras": { cookbook: { id } } },
  getFlag(scope, key) { return this.flags[scope]?.[key]; },
});

globalThis.game = { actors: [], packs: [], i18n: { format: (_k, o) => `hp ${o?.hp}`, localize: (k) => k } };

const libraryOf = (...actors) => { game.actors = actors; };
const wisp = actor("zz.emberWisp", "Ember Wisp");
const decoy = actor("zz.decoy", "Ember Wisps");
const moth = actor("zz.dustMoth", "Dust Moth");
const host = actor("zz.hostMonster", "Host Monster");
const template = actor("zz.hostFamily", "Host Family", "acks-extras.template");

const occupants = (...names) => ({
  fields: { occupants: Object.fromEntries(names.flatMap(([text, count], i) => [[`${i}.name`, { text }], [`${i}.count`, count ?? null], [`${i}.stats`, null]])) },
  page: 1,
});
const roster = async ({ of, node, core = new Map() }) => {
  data.registers = { tables: { creatureReplacement: PAIRS } };
  data.books.clear();
  data.books.set("zz", { entries: { "zz.room": { meta: { space: "zz.space", ...(of ? { of } : {}) } } } });
  const run = { targetsOf: async () => ({ core, own: new Map() }), tally: { rostered: 0 } };
  return { rows: await keyedOccupantRows("zz", "zz.room", node, run), tally: run.tally };
};
const coreOf = (...actors) => new Map(actors.flatMap((a) => [...creatureKeys(a.name)].map((k) => [k, a])));

libraryOf(wisp, moth, host);
{
  const { rows } = await roster({ node: occupants(["Ember Wisps", 3]), core: coreOf(decoy) });
  same("a registered label binds to its replacement, ahead of a same-name creature", rows.map((r) => [r.uuid, r.quantity, r.hidden]), [[wisp.uuid, 3, true]]);
}
{
  const { rows } = await roster({ node: occupants(["Dust Moths", 2]), core: coreOf(moth) });
  same("an unregistered label binds by name as before", rows.map((r) => r.uuid), [moth.uuid]);
}
{
  const { rows, tally } = await roster({ of: "zz.hostMonster", node: occupants(["Dust Moths", 2]), core: coreOf(moth) });
  same("a lair's roster ends with a hidden reference to its monster", rows.map((r) => [r.uuid, r.hidden, r.kind]), [[moth.uuid, true, "monster"], [host.uuid, true, "monster"]]);
  check("the roster's tally counts the host row", tally.rostered === 2);
}
{
  const { rows } = await roster({ of: "zz.dustMoth", node: occupants(["Dust Moths", 2]), core: coreOf(moth) });
  same("a stat line that bound to the lair's monster is its only row", rows.map((r) => r.uuid), [moth.uuid]);
}
{
  const { rows } = await roster({ of: "zz.hostMonster", node: occupants(["Ember Wisps", 1]) });
  same("a replaced stat line and the host stand once each", rows.map((r) => r.uuid), [wisp.uuid, host.uuid]);
}
{
  const { rows } = await roster({ of: "zz.notImported", node: occupants(["Dust Moths", 1]), core: coreOf(moth) });
  same("a monster that is not in the library adds no row", rows.map((r) => r.uuid), [moth.uuid]);
}
{
  const { rows } = await roster({ node: occupants(["Dust Moths", 1]), core: coreOf(moth) });
  same("a place with no monster of its own has no host row", rows.map((r) => r.uuid), [moth.uuid]);
}
{
  const { rows } = await roster({ of: "zz.hostMonster", node: occupants() });
  same("a place with no stat lines is its monster alone", rows.map((r) => r.uuid), [host.uuid]);
}
{
  game.actors = [template];
  const { rows } = await roster({ of: "zz.hostFamily", node: occupants() });
  same("a monster template, an actor of its own, is referenced like a monster, as a plain actor",
    rows.map((r) => [r.uuid, r.hidden, r.kind]), [[template.uuid, true, "actor"]]);
  libraryOf(wisp, moth, host);
}

/* --- wiring the mocks do not reach --- */

const source = cookbookSource();
const body = source.slice(source.indexOf("export async function keyedOccupantRows"), source.indexOf("async function statLineCreature"));
check("a registered label never falls back to a same-name creature",
  /const library = replaced \?\? named \?\? \(replacement \? null :/.test(body) && /library \|\| replacement \? null :/.test(body));
check("the host row is read from the row's own meta.of, never from a book switch",
  /entries\?\.\[id\]\?\.meta\?\.of/.test(body) && !/bookId === "le"/.test(body));
check("the host actor is the library's own, never a world copy", /importedActor\(of, \{ copies: false \}\)/.test(body));

console.log(`lair roster: ${pass} checks passed`);
