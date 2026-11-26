/**
 * The world-start prune of empty locations spares a place made since the
 * world was launched: the sweep runs at the primary GM's ready, seconds after
 * the world loads, and the place may have been made by another seat before
 * that ready. `launchTimeOf` reads the cut from the world's `lastPlayed` and
 * `sparedByAge` is the decision; both are pure.
 */
import assert from "node:assert/strict";
import { launchTimeOf, sparedByAge } from "../scripts/location/prune-age.mjs";

let passed = 0;
const ok = (fn, label) => { fn(); passed++; console.log(`  ok  ${label}`); };

// The server stamps lastPlayed with `(new Date).toString()` at launch.
const launchedAt = new Date("2026-11-25T10:00:00Z");
const lastPlayed = launchedAt.toString();
const launch = launchTimeOf(lastPlayed);
const at = (seconds) => launchedAt.getTime() + seconds * 1000;

ok(() => assert.equal(launch, launchedAt.getTime()), "lastPlayed as the server writes it reads back to the launch instant");

// What the sweep keeps of a world's places, by age alone.
const sweepsOf = (places, bornBefore) => places.filter((p) => !sparedByAge(p.createdTime, bornBefore)).map((p) => p.name);

ok(() => {
  // Made on this seat after launch, swept at this seat's ready.
  const places = [{ name: "made after launch, same seat", createdTime: at(5) }];
  assert.deepEqual(sweepsOf(places, launch), []);
}, "(a) a place made after launch on the same seat, before the sweep, is spared");

ok(() => {
  // Made by a peer a minute in, swept at a later Judge's ready two minutes in.
  const places = [{ name: "made by a peer", createdTime: at(60) }];
  assert.deepEqual(sweepsOf(places, launch), []);
}, "(b) a place a peer made after launch, before a later GM's ready, is spared");

ok(() => {
  const places = [{ name: "made last session", createdTime: at(-86400) }];
  assert.deepEqual(sweepsOf(places, launch), ["made last session"]);
}, "(c) a place made before launch is swept");

ok(() => {
  const places = [{ name: "no stats" }, { name: "null stats", createdTime: null }, { name: "NaN", createdTime: NaN }];
  assert.deepEqual(sweepsOf(places, launch), ["no stats", "null stats", "NaN"]);
}, "(d) a place with no createdTime is swept");

ok(() => {
  const places = [{ name: "new", createdTime: at(5) }, { name: "old", createdTime: at(-5) }];
  assert.deepEqual(sweepsOf(places, null), ["new", "old"]);
  assert.deepEqual(sweepsOf(places), ["new", "old"]);
}, "(e) with no cut nothing is spared");

ok(() => {
  for (const bad of ["", "not a date", undefined, null, 12345, {}]) assert.equal(launchTimeOf(bad), null, String(bad));
}, "(f) an absent or unparseable lastPlayed gives null");

ok(() => assert.equal(sparedByAge(at(0), launch), true), "a place made at the launch instant is spared");
ok(() => assert.equal(sparedByAge(at(-0.001), launch), false), "a place made a millisecond before launch is swept");
ok(() => assert.equal(sparedByAge(at(5), NaN), false), "a NaN cut spares nothing");

console.log(`test-location-prune-age: ${passed} passed`);
