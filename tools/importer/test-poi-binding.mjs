/**
 * A settlement's keyed places arrive as PLACES, nested quarter → city.
 *
 * Two things this guards. The group words that mark a quarter's points of
 * interest, its residents and its overview are the register's own vocabulary,
 * so the parse must take exactly those and no other group shape — a hideout, a
 * cult or a party group stays on the page path until it is bound as what it
 * is. And the data a place is built from must carry its cookbook identity, so
 * the presence claim finds it on a second run instead of building it twice,
 * and the same `kind.location` stamp the OSE binding uses, so the audit reads
 * both alike.
 *
 * The foot of the file reads the shipped AX3 cookbook: every keyed place it
 * holds must belong to a quarter (or the journal step would write pages beside
 * the actors), nothing that is not a place may be taken for one, and a quarter
 * has at most one overview, since two would race for one place's notes.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  poiGroupOf, isPoiEntry, isDistrictOverview, districtPlaceId, districtPlaceData, poiLocationData,
} from "../../scripts/importer/poi-binding.mjs";
import { LOCATION_TYPE } from "../../scripts/location/constants.mjs";
import { MODULE_ID } from "../../scripts/importer/constants.mjs";

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

/* ---------------- the group parse ---------------- */

check("a quarter's points of interest", poiGroupOf("Old District — Points of Interest"), { district: "Old District", kind: "poi" });
check("a quarter's residents", poiGroupOf("Temple District — Notable Residents"), { district: "Temple District", kind: "residents" });
check("a quarter's own overview", poiGroupOf("Lake District — Overview"), { district: "Lake District", kind: "overview" });
check("stray whitespace is the register's, not the quarter's", poiGroupOf("  Old District — Points of Interest  "), { district: "Old District", kind: "poi" });
check("an organisation inside a quarter is not a point of interest", poiGroupOf("Temple District — Smugglers' Cellar"), null);
check("nor is a cult", poiGroupOf("Lake District — Moon Cult"), null);
check("nor a party", poiGroupOf("NPC Party — Iron Company"), null);
check("nor the city's own overview", poiGroupOf("Harbourtown"), null);
check("a hyphen is not the register's dash", poiGroupOf("Old District - Points of Interest"), null);
check("no group, no quarter", poiGroupOf(undefined), null);
check("a group that is only the suffix names no quarter", poiGroupOf("— Points of Interest"), null);

/* ---------------- which entries bind ---------------- */

const poiGroup = { group: "Plaza District — Points of Interest" };
ok("a keyed place in a quarter binds", isPoiEntry({ kind: "kind.location", meta: poiGroup }));
ok("a resident's stat block is a creature, not a place", !isPoiEntry({ kind: "kind.npc", meta: poiGroup }));
ok("a keyed place outside any quarter stays a page", !isPoiEntry({ kind: "kind.location", meta: { group: "Bridge District — Sun Keep" } }));
ok("a keyed place with no group stays a page", !isPoiEntry({ kind: "kind.location" }));
ok("nothing is not an entry", !isPoiEntry(null));

const overviewGroup = { group: "Plaza District — Overview" };
ok("a quarter's overview is kept off the page path", isPoiEntry({ kind: "kind.location", meta: overviewGroup }));
ok("and is the quarter's notes, not a place", isDistrictOverview({ kind: "kind.location", meta: overviewGroup }));
ok("a point of interest is not an overview", !isDistrictOverview({ kind: "kind.location", meta: poiGroup }));
ok("an overview of another kind is nothing here", !isDistrictOverview({ kind: "kind.npc", meta: overviewGroup }));
ok("nothing is not an overview", !isDistrictOverview(null));

/* ---------------- ids ---------------- */

check("a quarter's place is claimed per book and quarter", districtPlaceId("ax3", "Old District"), "ax3.district.old-district");
check("a quarter's punctuation does not reach the id", districtPlaceId("ax3", "  St. Ambrose's Quarter! "), "ax3.district.st-ambrose-s-quarter");
ok("two spellings of one quarter claim one place", districtPlaceId("ax3", "Old District") === districtPlaceId("ax3", "OLD  DISTRICT"));

/* ---------------- the quarter's place ---------------- */

const district = districtPlaceData({ book: "ax3", bookLabel: "Harbourtown", district: "Old District", parentUuid: "Actor.city", folderId: "F1" });
check("a quarter is a place", district.type, LOCATION_TYPE);
check("named after itself", district.name, "Old District");
check("inside the city", district.system.parentUuid, "Actor.city");
check("in the book's folder", district.folder, "F1");
check("built empty, for the overview to fill", district.system.notes, "");
check("regioned by the book", district.system.region, "Harbourtown");
check("claimed under its id", district.flags[MODULE_ID].cookbook, { id: "ax3.district.old-district", book: "ax3", kind: "kind.location", unaudited: true });
check("an unparented quarter is still a place", districtPlaceData({ book: "ax3", district: "Old District" }).system.parentUuid, "");

/* ---------------- the point of interest ---------------- */

const notes = "<p>The gate stands open by day.</p><p><em>AX3 p.69</em></p>";
const place = poiLocationData({
  name: "1. Salt Gate (“Sea Door”)", entryId: "ax3.poi1", notes, book: "ax3", bookLabel: "Harbourtown",
  district: "Old District", parentUuid: "Actor.quarter", folderId: "F1",
});
check("a point of interest is a place", place.type, LOCATION_TYPE);
check("named as the caller read it off the page", place.name, "1. Salt Gate (“Sea Door”)");
check("inside its quarter", place.system.parentUuid, "Actor.quarter");
check("carrying the page's text as it was materialized", place.system.notes, notes);
check("regioned by its quarter", place.system.region, "Old District");
check("claimed under the entry's own id", place.flags[MODULE_ID].cookbook, { id: "ax3.poi1", book: "ax3", kind: "kind.location", unaudited: true });
check("in the book's folder", place.folder, "F1");
check("with core's house for a picture", place.img, "icons/svg/house.svg");
check("a place with no quarter falls back to the book for its region", poiLocationData({ name: "X", entryId: "b.x", book: "b", bookLabel: "Book" }).system.region, "Book");

/* ---------------- the shipped AX3 cookbook ---------------- */

const here = dirname(fileURLToPath(import.meta.url));
const ax3 = JSON.parse(readFileSync(join(here, "..", "..", "cookbook", "ax3.json"), "utf8"));
const entries = Object.values(ax3.entries ?? {});
const locations = entries.filter((e) => e.kind === "kind.location");
ok("AX3 holds keyed places", locations.length > 0);
const unbound = locations.filter((e) => !isPoiEntry(e)).map((e) => e.name);
check("every keyed place in AX3 belongs to some quarter", unbound, []);
const mistaken = entries.filter((e) => e.kind !== "kind.location" && isPoiEntry(e)).map((e) => e.name);
check("nothing that is not a place is taken for one", mistaken, []);
const quarters = new Set(locations.map((e) => poiGroupOf(e.meta?.group)?.district));
ok("every point of interest names a quarter", ![...quarters].includes(undefined));
const overviews = locations.filter(isDistrictOverview).map((e) => poiGroupOf(e.meta.group).district);
check("no quarter is described twice", overviews.length, new Set(overviews).size);
const undescribed = [...quarters].filter((q) => !overviews.includes(q));
check("every quarter AX3 keys places in has its overview", undescribed, []);

// A keyed place is the book's own proper name, so the cookbook ships none of
// it: a label built from the key number, and a name read off the page.
const keyed = Object.entries(ax3.entries ?? {}).filter(([, e]) => e.kind === "kind.location" && poiGroupOf(e.meta?.group)?.kind === "poi");
ok("AX3 keys places in its quarters", keyed.length > 0);
check("every keyed place ships a label built from its number", keyed.filter(([, e]) => !/^POI \d+[A-Za-z]?(?:\/\d+[A-Za-z]?)?$/.test(e.name)).map(([id]) => id), []);
check("under an id built from its number", keyed.filter(([id, e]) => id !== `ax3.poi${e.name.slice(4).split("/")[0]}`).map(([id]) => id), []);
check("and reads its printed name off the page", keyed.filter(([, e]) => e.fields?.name?.op !== "heading" || !e.fields.name.number || "text" in e.fields.name).map(([id]) => id), []);
check("by the number its label is built from", keyed.filter(([, e]) => e.fields?.name?.number !== `${e.name.slice(4)}.`).map(([id]) => id), []);

if (failed) {
  console.error(`\npoi-binding: ${failed} failure(s)`);
  process.exit(1);
}
console.error("poi-binding: OK");
