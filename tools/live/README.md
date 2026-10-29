# Live walks

The live half of the release gate, as code. `tools/release-preflight.mjs` names
the `docs/<feature>/TESTING.md` recipes for every surface changed since the
last tag; a walk here drives a recipe's sections against the running test world
and prints PASS or FAIL for each observable the recipe names. The rules a walk
obeys are `.claude/rules/live-testing.md`; this file is only what a walk is and
how one is run. Nothing under `tools/` ships, and the IP scan reads it like the
rest of the directory.

## Running

The machine's values arrive as environment variables, from its
`TEST_ENVIRONMENT.md` (LOCAL-ONLY); `_env.mjs` lists them. Then:

```bash
node tools/live/run.mjs
```

runs every walk, and `node tools/live/run.mjs markets henchmen` runs the named
ones in that order. A walk takes both seats, so one runs at a time, and a peer
session's run is waited for: the runner refuses to start while a browser
already answers on either seat's port, because a second driver would attach to
the first walk's browser and drive the same world beside it. The runner writes
each walk's whole output to a
log under `aia-tmp/live/` (ignored) and shows only the headings and the verdict
lines on the console: a log can hold figures the world imported from a book, so
it is read and never quoted. `SHOTS=1` makes a walk take its release plates into
`docs/releases/v<version>/`; a walk with stages takes `STAGE`, and a walk
that takes a plan reads `WALK_PLAN` (a JSON file; the walk's header gives its
shape). A walk that stops on documents it did not make takes a flag that is
their owner's go-ahead to run over them (`SHELF_OK`, `REBUILD_OK`,
`HELD_OK`; the walk's header says what each permits); set one only on the
owner's word.

## A walk

- imports the driver from `./_driver.mjs` and its seats and paths from
  `./_env.mjs`, and names no path, port, world, user or book of its own;
- finds each fixture by the marker its recipe names, or builds it carrying
  one (`api.fixture`), and brings it to the shape a step needs at that step's
  start; it deletes only in a section whose subject is setup, by the run's
  own ids (`api.retire`, `api.sweepTracked({only})`), as live-testing step 4
  rules; it restores in a `finally` any setting it flipped. `FIXTURE_OWN=<tag>`
  makes it build and find its own fixtures beside a peer's, and the log ends
  with the driver's ledger: what the run built, and what it reused;
- invents its fixtures, compares an imported figure in page and prints a
  boolean, and never prints a book's words;
- asserts a toast by the text that names its fixture, never by the tray
  being empty: the importer opens the shelf's books after `ready` and
  toasts each one on its own schedule, minutes into a walk;
- prints `== <section> ==` per recipe section, `PASS  <observable>  <detail>`
  or `FAIL  <observable>  <detail>` per check and `WALK ERROR:` on a throw,
  and exits non-zero on any FAIL;
- prints `GAP   <observable> (ROADMAP: <row>)  <detail>` instead of FAIL where
  a check fails showing the signature of a gap its feature's `ROADMAP.md` row
  names. The runner counts a GAP and does not fail on it. A failure without
  that signature is still a FAIL, and once the row is built the check passes
  and the GAP comes out with it;
- lists in its header the recipe sections it covers, and the recipe points
  back at it by name.
