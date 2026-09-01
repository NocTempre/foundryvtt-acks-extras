/**
 * `bindVariation` — turning a located variation into an acks-extras.variation.
 *
 * What this pins is the MAPPING: which located field reaches which part of the
 * schema, that a stone becomes sixths and changes sign, and that a number the
 * locator never found stays absent rather than arriving as a zero wearing the
 * book's authority. What the locators themselves read is verified against the
 * reference library, not here.
 *
 * No book text is reproduced. The values below are invented.
 */
import assert from "node:assert";
import { bindVariation } from "../../scripts/importer/cookbook.mjs";

let pass = 0;
const check = (label, cond) => { assert.ok(cond, label); pass++; };

const entry = {
  name: "Fine Blade (Attack)",
  book: "rr",
  cite: "RR p.999",
  icon: "icons/svg/upgrade.svg",
  meta: {
    key: "fine.bladeToHit",
    variationKind: "quality",
    appliesTo: ["weapon"],
    supersedes: ["magical.*"],
  },
};

/* A node as the executor hands it over: `variation` already materialized. */
const node = (found) => ({
  fields: { variation: found, description: [{ text: "A fine blade is keener than a plain one." }] },
});

const full = bindVariation(entry, node([
  { field: "cost.add", amount: 7 },
  { field: "deltas.bonus", amount: 3 },
]), "def.variation.fineBladeToHit");

check("the item takes the extras sub-type", full.type === "acks-extras.variation");
check("structure comes from the register, not the page", full.system.key === "fine.bladeToHit");
check("kind is carried", full.system.kind === "quality");
check("appliesTo is carried", full.system.appliesTo.join() === "weapon");
check("supersedes is carried", full.system.supersedes.join() === "magical.*");
check("a located surcharge reaches cost.add", full.system.cost.add === 7);
check("a located bonus reaches deltas.bonus", full.system.deltas.bonus === 3);
check("the citation is recorded", full.system.source.cite === "RR p.999");
check("the page's text is written into the description", /keener than a plain one/.test(full.system.description));
check("closing on the page reference", /acks-extras-importer-cite">RR p\.999<\/p><\/div>$/.test(full.system.description));
check("stamped with the entry it came from", full.system.description.includes('data-acks-entry="def.variation.fineBladeToHit"'));

/* A stone is six sixths, and lighter is negative. */
const lighter = bindVariation(entry, node([{ field: "deltas.stoneLighter", amount: 1 }]), "x");
check("one stone lighter is minus six sixths", lighter.system.deltas.weight6 === -6);
const twoLighter = bindVariation(entry, node([{ field: "deltas.stoneLighter", amount: 2 }]), "x");
check("two stones lighter scales", twoLighter.system.deltas.weight6 === -12);

/* Absence is the point: a dropped locator must not become a zero. */
const none = bindVariation(entry, node([]), "x");
check("no located numbers means no deltas at all", none.system.deltas === undefined);
check("no located numbers means no cost at all", none.system.cost === undefined);
check("structure survives with nothing located", none.system.key === "fine.bladeToHit");

const partial = bindVariation(entry, node([{ field: "deltas.ac", amount: 1 }]), "x");
check("a located ac reaches deltas.ac", partial.system.deltas.ac === 1);
check("the fields nobody located stay out of deltas", partial.system.deltas.bonus === undefined);
check("cost stays absent when only a delta was located", partial.system.cost === undefined);

/* Degenerate input must not throw — a bookless seat executes nothing. */
const bookless = bindVariation(entry, null, "x");
check("a bookless import still builds the document", bookless.system.key === "fine.bladeToHit");
check("a bookless import carries no numbers", bookless.system.deltas === undefined);

/* A field a later importer knows is ignored, not crashed on. */
const future = bindVariation(entry, node([{ field: "deltas.resonance", amount: 4 }]), "x");
check("an unknown located field is skipped", future.system.deltas === undefined);

/* A non-numeric amount is not a number. */
const nan = bindVariation(entry, node([{ field: "cost.add", amount: "eighty" }]), "x");
check("a non-numeric amount is refused", nan.system.cost === undefined);

console.log(`test-variations: all ${pass} checks passed`);
