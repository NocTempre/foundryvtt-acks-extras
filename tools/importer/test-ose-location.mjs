/**
 * A keyed area arrives as a PLACE, carrying the text the import read.
 *
 * Two things this guards. The binding must produce an `acks-extras.location`
 * actor rather than a journal page — a place in this family has a parent, a
 * roster and contents, and prose can never grow those. And the room's text must
 * be materialized into it in the stamped shape, closing on the page reference:
 * a Judge who imported the adventure reads the room without the book open, and
 * a re-import can tell its own writing from theirs.
 */
import { oseLocationData, oseAdventureData, LOCATION_TYPE } from "../../scripts/importer/ose-location.mjs";

let failed = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) {
    console.error(`FAIL ${name}\n  got:  ${g}\n  want: ${w}`);
    failed++;
  }
};
const ok = (name, cond, detail = "") => {
  if (!cond) {
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
};

const adventure = oseAdventureData({ book: "qd1", bookLabel: "Quick Delve #1: Milk" });
check("the adventure is a place too", adventure.type, LOCATION_TYPE);
check("named for the book", adventure.name, "Quick Delve #1: Milk");
ok("and carries no prose of its own", adventure.system.notes === "");

const room = oseLocationData({
  name: "2. Statue Hall",
  entryId: "qd1.area2",
  cite: "QD1 p.10",
  page: 10,
  book: "qd1",
  bookLabel: "Quick Delve #1: Milk",
  areaKey: "2",
  parentUuid: "Actor.abcdefghijklmnop",
  paragraphs: ["A statue of a cow <milk> flows from.", "The hall is cold."],
});

check("a room is a place", room.type, LOCATION_TYPE);
check("the number leads, so areas sort as the map is keyed", room.name, "2. Statue Hall");
check("it sits inside the adventure", room.system.parentUuid, "Actor.abcdefghijklmnop");
ok("the room carries the text the import read", /A statue of a cow/.test(room.system.notes));
ok("every paragraph lands, in order", /cow[\s\S]*hall is cold/i.test(room.system.notes));
ok("extracted text is escaped, never parsed as markup", room.system.notes.includes("&lt;milk&gt;"));
ok("the page reference closes it", /acks-extras-importer-cite">QD1 p\.10<\/p><\/div>$/.test(room.system.notes));
ok("and the block is stamped with the entry it came from", room.system.notes.includes('data-acks-entry="qd1.area2"'));
check("provenance records which area it is", room.flags["acks-extras"].ose.areaKey, "2");
check("and that a person has not checked it", room.flags["acks-extras"].ose.unaudited, true);

// With no parent — a book whose adventure actor could not be created — the room
// is still a valid place rather than one pointing at nothing.
const orphan = oseLocationData({ name: "1. Entry", entryId: "x.area1" });
check("an unparented room is still a place", orphan.type, LOCATION_TYPE);
check("with an empty parent, not a broken one", orphan.system.parentUuid, "");

if (failed) {
  console.error(`\nose-location: ${failed} failure(s)`);
  process.exit(1);
}
console.error("ose-location: OK");
