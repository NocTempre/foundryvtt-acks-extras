/**
 * The two business-prose readers — the gate toll a city charges merchandise
 * and the syndicate's smuggling service — shaped into the engine tables
 * acks-extras declares.
 *
 * Every figure and every sentence below is INVENTED. The prose is shaped like
 * the printed prose (these are sentence readers) but no printed figure is
 * reproduced; where a real page says one thing the fixture deliberately says
 * another.
 *
 * What this pins is the READING: that a dice expression keeps its modifier and
 * is tidied, that a thousands-separated count survives, that the duty is read
 * only beside the word that names it, and that a window with nothing to read
 * yields nothing rather than an empty shell.
 */
import assert from "node:assert";
import {
  assembleGateTolls, assembleSmuggling, assembleCityTravelTables,
} from "../../scripts/importer/city-travel-binding.mjs";

let pass = 0;
const check = (label, cond) => { assert.ok(cond, label); pass++; };
const eq = (label, actual, expected) => {
  assert.deepStrictEqual(actual, expected, label);
  pass++;
};

/* --- gate tolls ---------------------------------------------------------- */
const TOLLS = "Merchandise pays 3d4+1gp per 700 st carried through a gate, "
  + "and an import also pays a duty equal to 1d6% of its market price.";

eq("toll dice keep their modifier and the per-stone figure reads", assembleGateTolls(TOLLS), {
  toll: { dice: "3d4+1", perStones: 700 },
  duty: { dicePercent: "1d6" },
});

eq(
  "a thousands-separated per-stone figure loses its comma",
  assembleGateTolls("Pays 2d6gp per 1,200 st of goods.").toll,
  { dice: "2d6", perStones: 1200 },
);

eq(
  "a spaced dice expression is tidied",
  assembleGateTolls("Pays 2d8 + 3 gp per 500 st; a duty of 2d4 % applies.").toll.dice,
  "2d8+3",
);
eq(
  "a spaced duty expression is tidied too",
  assembleGateTolls("Pays 2d8 + 3 gp per 500 st; a duty of 2d4 % applies.").duty,
  { dicePercent: "2d4" },
);

check(
  "a window without the duty sentence yields no duty key",
  !("duty" in assembleGateTolls("Pays 3d4gp per 700 st carried through a gate.")),
);
check(
  "a window naming no per-stone unit yields null",
  assembleGateTolls("Pays 3d4gp at a gate, with a duty equal to 1d6% of the price.") === null,
);
check("an empty window yields null", assembleGateTolls("") === null);
check("an undefined window yields null", assembleGateTolls(undefined) === null);
check(
  "a zero per-stone figure yields null",
  assembleGateTolls("Pays 3d4gp per 0 st of goods.") === null,
);

check(
  "a percentage beside another word is not the duty",
  !("duty" in assembleGateTolls("Pays 3d4gp per 700 st; a surcharge of 2d4% follows.")),
);

/* --- smuggling ----------------------------------------------------------- */
const SMUGGLING = "The syndicate moves 12 loads of merchandise per month for a fee of 7%. "
  + "There is a 3% chance of interception, and goods arrive in 1d3+1 days.";

eq("every smuggling figure reads", assembleSmuggling(SMUGGLING), {
  loadsPerMonth: 12,
  feePercent: 7,
  interceptPercent: 3,
  arrivalDays: "1d3+1",
});

eq(
  "a partial window yields only the figures present",
  assembleSmuggling("There is a 3% chance the consignment is seized."),
  { interceptPercent: 3 },
);
eq(
  "another partial window yields its own figures only",
  assembleSmuggling("Goods arrive in 2d6 days, for a fee of 9%."),
  { feePercent: 9, arrivalDays: "2d6" },
);
eq(
  "a thousands-separated load count loses its comma",
  assembleSmuggling("It moves 1,500 loads of merchandise per month.").loadsPerMonth,
  1500,
);
check("an empty window yields null", assembleSmuggling("") === null);
check("an undefined window yields null", assembleSmuggling(undefined) === null);
check("prose with no figures yields null", assembleSmuggling("The syndicate is discreet.") === null);

/* --- assembly ------------------------------------------------------------ */
{
  const out = assembleCityTravelTables({ businessProse: { tolls: TOLLS, smuggling: SMUGGLING } });
  eq("both keys assemble", Object.keys(out).sort(), ["gateTolls", "smuggling"]);
  eq("the toll table carries the toll", out.gateTolls.toll, { dice: "3d4+1", perStones: 700 });
  eq("the smuggling table carries the fee", out.smuggling.feePercent, 7);
}
{
  const out = assembleCityTravelTables({});
  check("with no businessProse neither key is present", !("gateTolls" in out) && !("smuggling" in out));
}
{
  const out = assembleCityTravelTables({ businessProse: { tolls: TOLLS } });
  check("a missing smuggling window leaves only the toll", "gateTolls" in out && !("smuggling" in out));
}

console.log(`${pass} checks passed`);
