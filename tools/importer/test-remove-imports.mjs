/**
 * Remove ALL imports and a Judge's own class's kit: which template parts the
 * removal takes (`partLeavesWithClass`) and that `cookbookRemoveImports`
 * routes every part through it. Fixture classes and uuids are INVENTED.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { partLeavesWithClass } from "../../scripts/classes/registry.mjs";

let n = 0;
const check = (label, got, want) => {
  assert.equal(got, want, `${label}: got ${JSON.stringify(got)}`);
  n++;
};

const PACK_CLASS = "Compendium.world.acks-extras-classes.Item.packYak";
const IMPORTED_SIDEBAR_CLASS = "Item.sidebarYak";
const OWN_CLASS = "Item.ownTinker";
const stamp = (part, cookbook = null) => ({
  flags: { "acks-extras": { templatePart: part, ...(cookbook ? { cookbook } : {}) } },
});

// What the removal deletes: the pack's classes and a cookbook-stamped sidebar class.
const gone = (uuid) => uuid === PACK_CLASS || uuid === IMPORTED_SIDEBAR_CLASS;

check("a shared gear skin stays", partLeavesWithClass(stamp({ kind: "gear", key: "torch" }), gone), false);
check(
  "a shared ability copy that keeps its source's cookbook stamp stays",
  partLeavesWithClass(stamp({ kind: "ability", key: "alchemy" }, { id: "def.ability.alchemy" }), gone),
  false,
);
check(
  "a Judge's own class's bundle stays",
  partLeavesWithClass(stamp({ classUuid: OWN_CLASS, classKey: "tinkerer", kind: "bundle", band: "1" }), gone),
  false,
);
check(
  "a Judge's own class's 3d6 table stays",
  partLeavesWithClass(stamp({ classUuid: OWN_CLASS, classKey: "tinkerer", kind: "table" }), gone),
  false,
);
check(
  "a pack class's bundle leaves",
  partLeavesWithClass(stamp({ classUuid: PACK_CLASS, classKey: "yak", kind: "bundle", band: "1" }), gone),
  true,
);
check(
  "a bundle of a cookbook-stamped sidebar class leaves",
  partLeavesWithClass(stamp({ classUuid: IMPORTED_SIDEBAR_CLASS, classKey: "yak", kind: "bundle" }), gone),
  true,
);
check("a document that is no part does not leave by this rule", partLeavesWithClass({ flags: {} }, () => true), false);
check("a part with no class never asks classGone", partLeavesWithClass(stamp({ kind: "gear", key: "x" }), () => assert.fail("asked")), false);

/* --- the removal routes every part through the predicate ---------------- */
const source = readFileSync(new URL("../../scripts/importer/cookbook/rebuild.mjs", import.meta.url), "utf8");
const start = source.indexOf("export async function cookbookRemoveImports()");
const body = source.slice(start, source.indexOf("\nexport ", start + 1) > 0 ? source.indexOf("\nexport ", start + 1) : undefined);
check("the removal found", start > 0, true);
check("a template part is no longer swept by its flag alone", body.includes("|| templatePart("), false);

console.log(`test-remove-imports: all ${n} checks passed`);
