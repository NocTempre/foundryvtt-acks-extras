/**
 * Mount flagging: what a printed animal name states about training and
 * mountability. Invented names shaped like the printed ones — the roster of
 * animals a book prices is the reader's, never ours.
 */
import assert from "node:assert";
import { trainingFromName, animalSpecies, mountableSpecies, loadsFromText, speedFromText } from "../../scripts/importer/cookbook.mjs";

let pass = 0;
const check = (label, cond) => { assert.ok(cond, label); pass++; };

/* --- the qualifier states the training ----------------------------------- */
check("a war form reads war", trainingFromName("Qadar, Heavy War") === "war");
check("a riding form reads riding", trainingFromName("Qadar, Light Riding") === "riding");
check("a draft form reads draft", trainingFromName("Qadar, Medium Draft") === "draft");
check("a hunting form reads hunting", trainingFromName("Zeth, Hunting") === "hunting");
check("a herding form reads herding", trainingFromName("Zeth, Herding") === "herding");
check("an unqualified name states nothing", trainingFromName("Qadar") === null);
check("the word must stand alone", trainingFromName("Warthog") === null);
check("a blank name states nothing", trainingFromName("") === null);

/* --- the species is the name's head -------------------------------------- */
check("species is the head", animalSpecies("Qadar, Heavy War") === "qadar");
check("an unqualified name is its own species", animalSpecies("Ox") === "ox");

/* --- mountability is a SPECIES fact, stated by a riding form -------------- */
const entries = [
  { name: "Qadar, Light Riding", meta: { group: "animal" } },
  { name: "Qadar, Heavy War", meta: { group: "animal" } },
  { name: "Zeth, War", meta: { group: "animal" } },   // a war beast with no riding form
  { name: "Bruk, Draft", meta: { group: "animal" } },
  { name: "Not An Animal, Riding", meta: { group: "gear" } },
];
const ridable = mountableSpecies(entries);
check("a species the book sells to be ridden is mountable", ridable.has("qadar"));
check("a war form of that same species is mountable too", ridable.has("qadar"));
check("a war beast with no riding form is NOT marked mountable", !ridable.has("zeth"));
check("a draft-only species is not marked mountable", !ridable.has("bruk"));
check("only animal-group entries count", !ridable.has("not an animal"));

/* --- what it carries, read from its own printed description ------------- */
const prose = "Qadar, Medium: bred for war. They have a speed of 60' / 180', a normal "
  + "load of 30 stone (300 lbs) and maximum load of 60 stones (600 lbs).";
const loads = loadsFromText(prose);
check("the normal load reads in sixths of a stone", loads.unencumbered6 === 180);
check("the maximum load too, singular or plural", loads.capacity6 === 360);
check("the exploration speed is the first of the printed pair", speedFromText(prose) === 60);
const silent = loadsFromText("A beast of no stated burden.");
check("a book that says nothing leaves both unstated",
  silent.unencumbered6 === null && silent.capacity6 === null);
check("and no speed either", speedFromText("A beast of no stated pace.") === null);
check("empty text is unstated, never zero",
  loadsFromText("").capacity6 === null && speedFromText("") === null);

console.log(`test-mount-flags: all ${pass} checks passed`);
