/** The registry split: what the module offers (`BOOKS`) against what it knows (`REGISTRY`). No PDFs, no Foundry. */
import assert from "node:assert";
import { BOOKS, OSE_BOOKS_ACTIVE, REGISTRY, activeBooks, bookIsJudges, bookLine, citeFor, parseCite } from "../../scripts/importer/books.mjs";

let pass = 0;
const check = (label, cond) => { assert.ok(cond, label); pass++; };

const OSE = ["qd1", "qd2", "qd3", "aft", "dmb", "wld1", "wld2", "wld3", "pc1", "pc2", "pc3"];
const KEPT = ["cat", "mm", "rr", "jj", "ax1"];

const on = activeBooks(REGISTRY, true);
check("with the switch on every key is offered", Object.keys(on).length === Object.keys(REGISTRY).length && Object.keys(REGISTRY).every((id) => id in on));
check("with the switch on the entries are the registry's own", Object.keys(on).every((id) => on[id] === REGISTRY[id]));

const off = activeBooks(REGISTRY, false);
const dropped = Object.keys(REGISTRY).filter((id) => !(id in off));
check("with the switch off exactly the OSE books are dropped", dropped.length === OSE.length && OSE.every((id) => dropped.includes(id)));
check("with the switch off the ACKS-native books stay", KEPT.every((id) => id in off));
check("with the switch off the registry order is kept", Object.keys(off).join() === Object.keys(REGISTRY).filter((id) => !OSE.includes(id)).join());
check("activeBooks leaves its input whole", OSE.every((id) => id in REGISTRY));

check("every entry declaring stats declares ose", Object.values(REGISTRY).every((b) => b.stats === undefined || b.stats === "ose"));
check("the declared set is the OSE set", Object.keys(REGISTRY).filter((id) => REGISTRY[id].stats === "ose").sort().join() === [...OSE].sort().join());
check("a book from a line of its own can still be ACKS-native", REGISTRY.cat.line && REGISTRY.cat.stats === undefined);

check("BOOKS is the registry as the switch leaves it", Object.keys(BOOKS).join() === Object.keys(activeBooks(REGISTRY, OSE_BOOKS_ACTIVE)).join());

for (const id of dropped) {
  check(`a dropped ${id} still answers its line`, bookLine(id) === (REGISTRY[id].line ?? null));
  check(`a dropped ${id} still answers whether it is the Judge's`, bookIsJudges(id) === (REGISTRY[id].judge === true));
  check(`a dropped ${id} still cites`, citeFor(id, 5).startsWith(REGISTRY[id].short));
  check(`a dropped ${id} still parses from its citation`, parseCite(citeFor(id, 5))?.book === id);
}

console.log(`\ntest-book-registry: all ${pass} checks passed`);
