/** LOCAL-ONLY: gear/clothing price extraction vs the real RR PDF. Skips w/o ref lib. */
import assert from "node:assert";
import fs from "node:fs";
import { openBook, pageItems } from "../../scripts/importer/extract.mjs";
import { FILES, referenceComplete } from "./reference-lib.mjs";
import { extractPriceMapFromDoc, extractPriceRowsFromDoc, extractPrices, priceFor, parseCost, PRICE_TABLES } from "../../scripts/importer/gear-prices.mjs";

let pass = 0;
const check = (label, cond) => { assert.ok(cond, label); pass++; };

// Unit: coin conversion (1gp = 10sp = 100cp), verified against core costs.
check("parseCost 10gp → 10", parseCost("10gp") === 10);
check("parseCost 3sp → 0.3", Math.abs(parseCost("3sp") - 0.3) < 1e-9);
check("parseCost 2cp → 0.02", Math.abs(parseCost("2cp") - 0.02) < 1e-9);
check("parseCost '5gp/60gp value' → 5", parseCost("5gp/60gp value") === 5);
check("parseCost Varies → null", parseCost("Varies") === null);

// A price at or above a thousand carries a separator, and the unit follows its
// digits with no boundary between them. Read without allowing for that, every
// such price came back as its last three digits — 1,500gp priced at 500gp,
// wrong by an order of magnitude and entirely ordinary-looking.
check("parseCost 1,500gp → 1500", parseCost("1,500gp") === 1500);
check("parseCost 2,000gp → 2000", parseCost("2,000gp") === 2000);
check("parseCost 1,200gp → 1200", parseCost("1,200gp") === 1200);
// The run gap that separates words also lands after the thousands comma.
check("parseCost '1, 500gp' → 1500", parseCost("1, 500gp") === 1500);
check("parseCost 1000gp → 1000", parseCost("1000gp") === 1000);
// A three-digit price must be untouched by the separator handling.
check("parseCost 500gp → 500", parseCost("500gp") === 500);

// Unit: a grid that stacks SECTIONS. One recipe reads the second price page,
// which prints clothing, then livestock, then provisions — so a row's name is
// not what says which kind of thing it is, and a row that does not carry its
// section imports as ordinary inventory whatever the page called it.
{
  const R = { rowTol: 3, sides: [{ nameX0: 40, nameX1: 240, costX: 250, encX: null }, { nameX0: 300, nameX1: 480, costX: 490, encX: null }] };
  const run = (str, x, y) => ({ str, x, y });
  const rows = extractPrices([
    run("Clothing", 40, 10),                                    // section heading
    run("Clothing", 40, 20), run("Cost", 250, 20),              // column heading, both sides
    run("Clothing", 300, 20), run("Cost", 490, 20),
    run("Belt/Sash, Leather", 40, 30), run("1sp", 250, 30),
    run("Loincloth", 300, 30), run("1sp", 490, 30),
    run("Domesticated Animals", 40, 40),                        // next section
    run("Animal", 40, 50), run("Cost", 250, 50),
    run("Animal", 300, 50), run("Cost", 490, 50),
    run("Cow", 40, 60), run("10gp", 250, 60),
  ], R);
  const at = (name) => rows.find((r) => r.name === name);
  check("every priced row survives sectioning", rows.length === 3);
  check("a clothing row carries the clothing heading", at("Belt/Sash, Leather")?.section === "Clothing");
  check("so does the row beside it in the other column", at("Loincloth")?.section === "Clothing");
  check("a later section replaces the earlier one", at("Cow")?.section === "Domesticated Animals");
  // The column-heading line repeats across every column; only a line with the
  // first column alone is a heading, or the grid re-sections on every table.
  check("the column-heading line is not read as a section", at("Cow")?.section !== "Animal");
}

if (!referenceComplete()) {
  console.log(`test-gear-prices: ${pass} unit checks passed; reference PDFs absent — extraction skipped.`);
  process.exit(0);
}

const { doc } = await openBook(fs.readFileSync(FILES.rr));
const map = await extractPriceMapFromDoc(doc, pageItems);

check(`built a substantial price map (${map.size})`, map.size >= 150);

// Known gear (matches core exactly): Archery Target 0.3gp / w6 12; Lock 20gp/1.
const at = priceFor(map, "Archery Target");
check("Archery Target cost 0.3 (book 3sp)", Math.abs((at?.cost ?? 0) - 0.3) < 1e-9);
check("Archery Target weight6 12 (book 2 stone)", at?.weight6 === 12);
check("Lock cost 20gp", priceFor(map, "Lock")?.cost === 20);
check("Backpack cost 2gp", priceFor(map, "Backpack")?.cost === 2);

// Clothing (cost only): Belt/Sash Leather 0.1gp (book 1sp).
check("Belt/Sash, Leather cost 0.1", Math.abs((priceFor(map, "Belt/Sash, Leather")?.cost ?? 0) - 0.1) < 1e-9);

// A general multi-variant category returns null, not a guessed variant.
check("'Army Emblem' (Silver + Gold variants) stays unpriced", priceFor(map, "Army Emblem") === null);

// The real grid, sectioned. A belt and a cow are printed under one recipe and
// must not come back as the same kind of thing: core files clothing on its own
// part of the sheet and leaves it out of encumbrance.
const priced = await extractPriceRowsFromDoc(doc, pageItems);
const sectionOf = (name) => priced.find((r) => r.name === name)?.section ?? "";
const sections = new Set(priced.filter((r) => r.table === "clothing").map((r) => r.section));
check(`the clothing recipe reads three sections (${sections.size})`, sections.size === 3);
check("every row carries a section", priced.every((r) => r.section));
check("a belt is clothing", sectionOf("Belt/Sash, Leather") === sectionOf("Loincloth"));
check("a cow is not", sectionOf("Cow (550 lbs)") !== sectionOf("Belt/Sash, Leather"));
check("nor is a foodstuff", sectionOf("Salt (1 lb)") !== sectionOf("Cow (550 lbs)"));
// The gear page is one section, and the recipes disagree about which page they
// read — so `table` cannot stand in for `section` and both are carried.
check("the gear page is a single section", new Set(priced.filter((r) => r.table === "gear").map((r) => r.section)).size === 1);
check("the gear section is not the clothing one", sectionOf("Backpack (holds 4 stone)") !== sectionOf("Belt/Sash, Leather"));
// The subtype lookup is CONFIG's, not ours — but the heading it is asked about
// has to be the word the system's own vocabulary knows, or nothing matches and
// every clothing row silently stays plain inventory.
check("the clothing heading folds to the core subtype key", sectionOf("Belt/Sash, Leather").toLowerCase().replace(/[^a-z0-9]/g, "") === "clothing");
check("both price pages were found", new Set(priced.map((r) => r.table)).size === Object.keys(PRICE_TABLES).length);

console.log(`\ntest-gear-prices: all ${pass} checks passed (price map ${map.size} entries)`);
