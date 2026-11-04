/**
 * The light import: what `light-binding.mjs` reads out of its prose windows,
 * and the table it registers for `lib/light.mjs`.
 *
 * Every sentence and figure here is INVENTED, shaped like prose without being
 * any page's; no value is read off a book.
 */
import assert from "node:assert";
import {
  LIGHT_DOC_ID, PRODUCES, REACH_KINDS, applyLightImport, assembleLightSources, assembleLightTables,
  namedKinds, parseReach, parseTurns,
} from "../scripts/importer/light-binding.mjs";
import { LIGHT_DOC, LIGHT_TABLE } from "../scripts/lib/light.mjs";
import { TABLE_RECIPES } from "../scripts/importer/table-recipes.mjs";

let pass = 0;
const check = (label, cond) => {
  assert.ok(cond, label);
  pass++;
};
const eq = (label, got, want) => {
  assert.deepStrictEqual(got, want, label);
  pass++;
};

/* ------------------------------ parsers ------------------------------ */

eq("a reach with a stated total takes the total as dim", parseReach("glow in a radius of 4’ and a faint glow another 4’ (out to 8’ total). later words"), { bright: 4, dim: 8 });
eq("a reach said to run another so far adds it to the bright", parseReach("glow out to 7' and faint glow another 6' beyond"), { bright: 7, dim: 13 });
eq("two plain distances read as the bright and the dim radius", parseReach("bright to a 9 feet radius and dim to a 17 feet radius"), { bright: 9, dim: 17 });
eq("a window with no distance reads nothing", parseReach("no figures here."), { bright: null, dim: null });
eq("the reach stops at the full stop", parseReach("glow to 3’. other lights reach 40’ (out to 80’ total)"), { bright: 3, dim: null });
eq("a burn time is a count of turns", parseTurns("11 turns before guttering"), 11);
eq("a burn time in words", parseTurns("seven turns."), 7);
eq("no turns, no burn time", parseTurns("a while"), null);
eq("the sources named in a look-back window's last sentence", namedKinds("read maps. torches and candles"), ["torch", "candle"]);
eq("an earlier sentence's names do not count", namedKinds("lanterns glow. candles"), ["candle"]);

/* ------------------------------ assembly ------------------------------ */

const prose = {
  candleReach: "glow in a radius of 2’ and faint glow another 3’ (out to 5’ total). more",
  torchReach: "glow in a radius of 12’ and faint glow another 12’ (out to 24’ total). more",
  shedSubject: "words before. torches and candles",
  shedBurn: "4 turns before going out",
  lanternBurn: "19 turns. more",
};
eq("every source assembles from its windows", assembleLightSources(prose), {
  candle: { bright: 2, dim: 5, turns: 4 },
  torch: { bright: 12, dim: 24, turns: 4 },
  lantern: { bright: 12, dim: 24, turns: 19 },
});
eq("a window that did not read costs only its figure", assembleLightSources({ ...prose, lanternBurn: "" }).lantern, { bright: 12, dim: 24 });
eq("a burn sentence naming only torches prices only torches", assembleLightSources({ ...prose, shedSubject: "x. torches" }).candle, { bright: 2, dim: 5 });
eq("nothing read, nothing assembled", assembleLightTables({}), {});
eq("the assembled table sits under the light table's id", Object.keys(assembleLightTables({ lightProse: prose })), [LIGHT_TABLE]);

/* ------------------------------ wiring ------------------------------ */

eq("the binding answers for lib's light document", LIGHT_DOC_ID, LIGHT_DOC);
check("the assembled table is produced from the recipe's raw table", PRODUCES[LIGHT_DOC][LIGHT_TABLE] === "lightProse" && !!TABLE_RECIPES.light.tables.lightProse);
check("every reach window the binding prices is a recipe value", Object.keys(REACH_KINDS).every((key) => TABLE_RECIPES.light.tables.lightProse.values.some((v) => v.key === key)));
check("no import service, nothing assembled", (await applyLightImport()).assembled.length === 0);

console.log(`test-light-binding: ${pass} checks passed`);
