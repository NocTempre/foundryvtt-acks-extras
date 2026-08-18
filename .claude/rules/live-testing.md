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
     and `ready` specifically; a throw in one leaves the rest silently dead;
   - every registered setting appears in the settings UI AND gates something
     (an inert toggle is a bug, not a placeholder);
   - every shipped macro runs without throwing;
   - each declared compendium opens and its documents load;
   - **the feature you changed, exercised end-to-end through the UI** — not
     its unit test. Sheet/DOM integrations, drag-and-drop, and Active Effect
     writes are the surfaces mocks cannot reach; verify the write actually
     landed on the target field, not merely that the code ran.
4. **Create whatever fixtures the check needs — that is part of the check.**
   The test world rarely already holds the actors, items, or documents a
   feature touches. "No data existed to exercise it" is not a limitation to
   report; it is test data you were expected to build. Make it, run the
   feature through it, then delete it.

   **Create-and-destroy, never mutate-and-restore.** Editing the world's
   existing documents and rolling back afterwards is the failure this rule
   exists to prevent — and it recurs. A rollback is a second write with all
   the failure modes of the first: it can report success and not apply (an
   ownership rollback did exactly that), it cannot restore state you did not
   think to snapshot, and an exception mid-test strands the world broken. A
   document you created is disposable by construction: deleting it is total,
   needs no snapshot, and cannot half-succeed.

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
   close it. Say what you created and confirm you removed it.

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
settings. Expect another session's fixtures and failures in the world log;
filter what you act on to your own files and your own artifacts. Two rules
that exist because they were broken: **never modify an in-force canonical doc
outside an explicitly authorized phase** (a proposal doc opens with a
NOT-IN-EFFECT banner until adopted), and **shared ledgers are re-read
immediately before every write, with rows matched by title, never by id** —
ids are the thing two sessions mint in collision.
