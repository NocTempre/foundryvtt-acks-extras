# Live testing (canonical — every other statement points here)

Read this before any live test, live check, or release gate. The release
snapshot rules are TOOLCHAIN §4b; the release procedure is `/acks-release`.

## Why this is a gate

`validate` and `npm test` run against **mocked** Foundry globals: they verify
the author's assumptions, not Foundry's behaviour. Every module-breaking bug in
this family's history got through a green offline suite and was caught only by
a live install — one release shipped four versions in which the whole module
was dead at `init` while ~180 checks reported green, because nothing offline
ever *called* the entry point. Offline checks gate correctness of logic; only a
live run gates that the module loads and does anything at all.

## Environment

The machine's test server is defined in
`C:\Proj\acks-rules\TEST_ENVIRONMENT.md` — server URL, world, users, the API
calls that drive it, and this machine's capture/driver gotchas. That file is
LOCAL-ONLY and machine-specific by design: every developer writes their own,
and **no port, world id, user name, or password ever goes into a repo, a
skill, or a memory.** Read it before live-testing; if it is absent, this
machine has no test server — skip live verification and say so in the report
rather than inventing one.

## Procedure

1. Confirm the dev install is a junction to the working tree, so what you test
   is what you ship — not a stale copy.
2. **Shut down any running world before rebuilding packs.** A running world
   holds LevelDB locks on module `packs/`, so `npm run build:packs` fails on
   the LOG files. Order: shut down → build packs → launch world → test.
   (The locks no longer dirty the repo — compiled packs are gitignored — but
   the build still needs them released.)
3. Launch the world, enable the module, and verify at minimum:
   - it reaches `ready` with **no console errors** — check `init`, `setup`,
     and `ready` specifically; a throw in one leaves the rest silently dead.
     A clean console is a statement about a recorder: one attached after
     `ready` saw none of the three;
   - every registered setting appears in the settings UI AND gates something
     (an inert toggle is a bug, not a placeholder);
   - every shipped macro runs without throwing;
   - each declared compendium opens and its documents load;
   - **the feature you changed, exercised end-to-end through the UI** — not
     its unit test. Sheet/DOM integrations, drag-and-drop, and Active Effect
     writes are the surfaces mocks cannot reach; verify the write actually
     landed on the target field, not merely that the code ran.
4. **Build whatever fixtures the check needs — that is part of the check.**
   The test world holds the actors, items, or documents a feature touches
   only once some check has built them. "No data existed to exercise it" is
   not a limitation to report; it is test data you were expected to build.

   **A fixture, once built, stays.** The next check of the same surface
   reuses it instead of building it again; a sweep at the end of every walk
   spends the next walk on setup that is already proven. A fixture is found
   again by its **marker**, `flags.world.fixture` set to the
   `<feature>/<name>` its recipe gives it, and never by its document name,
   which two sessions spell alike as a matter of course. A recipe's fixtures
   section names each marker and how to build the fixture when nothing
   carries it. The capture driver's `api.fixture(marker, kind, data)` is the
   lookup: it returns the one document carrying the marker, or builds one
   from `data` carrying it and tracks that, and it throws on two, since a
   twin is two runs that both missed and both built. A document with no
   marker is work nobody recorded: read it, never drive it.

   **A step that needs a known shape asserts it at its start.** A kept
   fixture carries whatever the last walk left, and nothing restores it at
   the end. A rollback is a second write with all the failure modes of the
   first: it can report success and not apply (an ownership rollback did
   exactly that), it cannot restore state nobody snapshotted, and an
   exception mid-test strands it half-done. Where a fixture cannot be brought
   to the shape a step needs, rebuilding it is setup, below.

   **A fixture you drive is yours alone while you drive it.** One that a walk
   only reads or renders serves every session at once. One a walk moves,
   fights, bills or edits has two writers the moment a peer walks the same
   surface. Before driving one, find out who is seated (Concurrency, below);
   where a peer is on the same surface, build your own: connect with
   `own: <tag>`, and every marker the run looks up or builds becomes
   `<feature>/<name>@<tag>`, which never meets the recipe's or a peer's.

   **Delete a fixture only where setup is the subject.** A check of how a
   document comes to exist or stops existing needs it absent: a create path
   or create hook, an import's first run (a standing import blocks the fresh
   create), the DELETE path (Driving techniques, below), a migration of a
   pre-upgrade shape. That check deletes the fixture first, under the
   seated-peer rule above, with `api.retire(marker, kind)`, which tracks the
   lookup's one document and sweeps it alone. It then runs the setup under
   test, and what the setup produced is the fixture from then on:
   `api.mark(uuid, marker)` puts the marker on it.

   **Every delete is by the run's own ids; the capture driver's fixture
   ledger is the mechanism.** `api.create(kind, data)` records the uuid of
   what it makes; `api.track(uuidOrId, kind)` records a document made any
   other way, including one the feature wrote itself once its id is read
   back from the action's result, and a kept fixture a setup check retires
   once its marker lookup returns it. The ledger is the run's record of what
   it built, and `api.sweepTracked()` deletes exactly that list and returns
   what it removed, what it could not find and what refused, and the report
   quotes that object. A delete keyed on anything else — a name, a name
   prefix, a folder, a type, a time window, a pattern over markers, "looks
   like a fixture" — is forbidden: the world is shared, and every one of
   those keys matches another session's documents as readily as yours.
   Every `track` prints its uuid, so a run's log holds every id it built,
   and a setup check that dies before its sweep re-tracks those ids on the
   next run and never goes looking by name. A session driving a browser pane
   instead of the driver keeps the same list by hand and deletes by it, with
   the driver's exported `pageSweep(entries)` as the expression.

   Seats are provisioned: the world carries one user of every permission
   level, so verify player-facing behaviour by **joining as that player**.
   Rendering a template with `isGM: false` proves the template branches; it
   does not prove the API under it refuses a real player.

   Where a release **changes or removes shipped content**, build the
   *pre-upgrade* shape on purpose: recover the old definitions from git
   (`git show <tag>:<path>`) and re-create them as world documents. "Existing
   worlds keep working" is only testable against a world that actually holds
   the old data — reasoning from "Foundry does not delete world documents" is
   a citation, not a verification.
5. Leave the world running or shut it down as you like — compiled packs are
   gitignored, so a running world can no longer dirty the repo.
6. **Report what you exercised, and name what you did not.** "Live-verified"
   with no list is not a result. If a surface could not be reached, say which
   and why — a gap you could have closed by creating fixtures is not a gap;
   close it. Quote the ledger, with each fixture's marker, as the record of
   what the run built and kept, and a setup check's sweep result — removed,
   could not find, refused — as the record of what it deleted.

   **A claim is as wide as the check behind it.** Sort the report three ways:
   exercised live, checked offline only, not checked. A count is quoted from
   the output that produced it, never from recall. "No console errors" names
   what recorded them and when it was attached. Name what the change made
   stale and did not refresh: a screenshot, a guide step, a generated
   reference.

## Driving techniques (scripted checks)

- **Probe a dialog's computation without rendering it**: construct the app
  and `await app._prepareContext({})` in page context — it returns exactly
  what the template would render, reachable where private fields and
  screenshots are not (a backgrounded browser pane cannot composite frames).
  Still finish with one real UI interaction; the context object does not
  prove the form handler and the roll path agree with it.
- **Pass `{animate: false}` to token updates you read back.**
  `tokenDoc.update({rotation: 180})` animates, and an immediate read returns
  a mid-tween angle — only scripted sequences ever hit this, and it presents
  as a heading/position bug in the feature under test.
- **Exercise the DELETE path, not only repeat-use.** A cache keyed by
  identity needs an invalidation story for deletion; the family shipped a
  claim-cache that answered for deleted documents because the live check only
  repeated the import. Delete the artifact and run the path again.
- **The live gate only counts if the REAL trigger fires.** Browser-lifecycle
  behaviour needs real `File`/OPFS handles (not `fetch()`-built stand-ins),
  a real `location.reload()` (not automation navigation), and a foreground
  timed wait with the measured elapsed seconds logged — a synthetic trigger
  proves the handler, not the lifecycle.

## Sub-types need a world relaunch

`module.json` `documentTypes` is read by the SERVER at world launch, not on
F5. After adding a sub-type, a browser reload picks up the JS (data model
registers, sheet works) while `Actor.create`/`Item.create` with the new type
**silently returns falsy** — "not a valid type" on the console, nothing
persisted. Check `game.documentTypes.<Doc>.includes(type)` to tell the two
states apart; fix by shutting down and relaunching the world. The silent
falsy return also means a wrong-type create path produces **no documents at
all** — there is never a malformed population to migrate from that path.

## Concurrency

Parallel sessions share this working tree, this test world, and these
settings. Expect another session's fixtures and failures in the world log.
The only world documents a session deletes are the ones its own ledger names
(step 4), and the only files it acts on are its own; committing beside a peer
is `shared-tree.md`. **A shutdown or a relaunch drops every client, a peer's
included.** Find out who is seated before either, and where a seat is not
yours, ask its owner. Two more rules that
exist because they were broken: **never modify an in-force canonical doc
outside an explicitly authorized phase** (a proposal doc opens with a
NOT-IN-EFFECT banner until adopted), and **shared ledgers are re-read
immediately before every write, with rows matched by title, never by id** —
ids are the thing two sessions mint in collision.

**A create-hook ledger is an OBSERVER, never a delete list.**
`Hooks.on("createItem", …)` fires for every session on the server, so what it
records is the WORLD's creations and not yours — and sweeping it deletes a
peer's fixtures by exactly the route step 4 exists to close, wearing the shape
of compliance. Arm one to prove a run created NOTHING, which is what it is good
for, and take teardown from the ledger that records only what YOU asked for
(`api.create` / `api.track` / `api.sweepTracked`). Where a feature reports
counts rather than ids, `api.track` the ids read back from the action's own
result, read the moment it resolves: a presence claim is per CLIENT, so two
sessions handed the same not-yet-imported id both miss and both build, and an
id read back late may be the other one's. Three sessions reached for a
create-hook ledger in a single afternoon and all three were safe by accident —
one expected an empty ledger, one reset it between calls, one never swept.
