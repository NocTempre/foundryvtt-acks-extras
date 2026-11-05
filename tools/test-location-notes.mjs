/**
 * A place's written notes keep it through the world-start prune of empty
 * locations: `hasWrittenNotes` is the prune's test, and it reads text, not
 * markup, so an editor saved empty does not count as a note.
 */
import assert from "node:assert/strict";
import { hasWrittenNotes } from "../scripts/location/notes.mjs";

let passed = 0;
const ok = (fn, label) => { fn(); passed++; console.log(`  ok  ${label}`); };

ok(() => assert.equal(hasWrittenNotes({ notes: "<p>A cellar under the inn.</p>", gmNotes: "" }), true), "shared notes with text count");
ok(() => assert.equal(hasWrittenNotes({ notes: "", gmNotes: "<p>The smugglers' drop.</p>" }), true), "the Judge's notes alone count");
ok(() => assert.equal(hasWrittenNotes({ notes: "<p></p>", gmNotes: "<p><br></p>" }), false), "an editor saved empty is no note");
ok(() => assert.equal(hasWrittenNotes({ notes: "<p>&nbsp;</p>", gmNotes: " " }), false), "a non-breaking space or a blank is no note");
ok(() => assert.equal(hasWrittenNotes({}), false), "a place with neither field is unnoted");
ok(() => assert.equal(hasWrittenNotes(undefined), false), "no system data is unnoted");

console.log(`test-location-notes: ${passed} passed`);
