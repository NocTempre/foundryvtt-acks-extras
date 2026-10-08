# Live-test recipe — the entry point and the namespace

The canonical procedure is `.claude/rules/live-testing.md`. This file covers
the two files that sit directly under `scripts/`: the entry point
`scripts/module.mjs` (the import order that IS the hook order) and
`scripts/namespace.mjs` (the one global, `module.api`, the system boot-gate).
Every feature's own recipe is `docs/<feature>/TESTING.md`; this one proves the
module loads at all, which no feature recipe assumes. Below that recipe it
holds what is true of walking any shipped macro, and the recipe for the one
macro no feature owns.

## Fixtures

None. The check reads what the module attached; it creates nothing.

## Steps

1. Launch the world with the module enabled and join as the Gamemaster. Wait
   for `game.ready`.
   *Observable:* no console error naming `acks-extras` at `init`, `setup` or
   `ready`. A throw in one feature's hook leaves the ones registered after it
   silently dead, so check the console, not the sidebar.
2. In the console: `Object.keys(globalThis.acksExtras)`.
   *Observable:* one key per subsystem `scripts/module.mjs` imports — `lib`,
   `abilities`, `equipment`, `classes`, `magic`, `formation`, `influence`,
   `henchmen`, `location`, `factions`, `markets`, `monsters`, `battlemap`,
   `vehicles`, `characterSheet`, `bridge`, `importer` — each a non-empty
   object. The importer's api is attached at `ready`, after its cookbook
   loads; give it a few seconds on a large library.
3. `game.modules.get("acks-extras").api === globalThis.acksExtras`.
   *Observable:* `true`. The namespace is the api; a feature that assigned its
   own `module.api` would hide every other feature behind one key.
4. `Object.keys(globalThis).filter((k) => /^acks/i.test(k))`.
   *Observable:* exactly `["acksExtras"]` — no per-feature or compat-alias
   global (`validate` 7c refuses one in source; this proves none arrives at
   runtime either). On the Discord bot's own seat there is one more,
   `acksExtrasBridgeEmit`: the binding the seat holder installs to hear the
   world's events (`docs/bridge/MODEL.md`). `tools/bridge-walk.mjs` runs
   steps 1–4 from that seat and expects exactly those two.
5. Under Node, from the repo root:
   `node --input-type=module -e "await import('./scripts/namespace.mjs')"`.
   *Observable:* exits clean. The namespace tolerates a harness with no
   `Hooks` so the pure-logic modules (and `tools/importer/test-*.mjs`) can
   import through it; under Foundry, `Hooks` always exists, so nothing in
   the game is gated on that tolerance.

## Teardown

Nothing to remove.

## Walking a shipped macro

Three mechanics hold for every macro in the `acks-extras.macros` compendium.
A feature's recipe states only what is its own.

- **Run the compendium document, and do not await it.**
  `(await game.packs.get("acks-extras.macros").getDocument(id)).execute()`
  resolves only once every dialog the macro opens has been answered. Fire it,
  then find the dialog in `foundry.applications.instances` by its title and
  press its `button[data-action]`.
- **A macro's text changes only when the pack is rebuilt**, and the pack cannot
  be rebuilt under a running world. To walk an edit before the rebuild, build
  the command under Node from its pack data
  (`(await import("./tools/pack-data/<file>.mjs")).buildMacros()`) and carry it
  in a world `Macro` the run creates. The compendium document is then the
  before, and the two are run on twin fixtures.
- **A compatibility warning is one console line per write that earns it.**
  Wrap `console.warn` before the run and count the lines that say what is
  being looked for. Prove the wrap hears one first: a fixture update that
  deletes a key the legacy way, `update({"flags.acks-extras.-=zzProbe": null})`,
  raises exactly one `forced deletion` line while
  `CONFIG.compatibility.mode` is at its default.

## The merge cleaner macro

*Clean Up After the Merge (GM)* (`DECISIONS.md` §11). The walk covers every
kind of row its scan lists except a document of a removed sub-type, which no
fixture can make.

**The macro removes everything its scan finds, in the whole world.** In a
shared world that is another session's documents as readily as this run's.
Step 1 is therefore a gate: when the world as found holds any residue, stop
and report it. In step 3, press *Remove them* only when every row of the
report names a fixture of this run; otherwise press *Cancel*.

### Fixtures

Created after step 1. Each carries something that must survive beside what
must go. The retired ids are the `OLD` list at the head of the macro
(`tools/pack-data/cleanup.mjs`).

| Document | Carries |
|---|---|
| a `character` Actor | two retired flag scopes, `flags.acks-extras`, `flags.world` |
| an Item the actor carries | one retired scope, `flags.acks-extras` |
| an ActiveEffect on the actor | one retired scope, `flags.world`; changes keyed `flags.<retired id>.x` and `flags.acks-extras.y` |
| an ActiveEffect on the carried item | one retired scope and no other |
| a world Item | one retired scope, `flags.core.sheetClass` naming `<retired id>.<AnySheet>`, `flags.world` |
| an ActiveEffect on the world item | one change keyed `flags.<retired id>.x` |
| a JournalEntry | two retired scopes, one of them an empty object; `flags.world` |
| a RollTable | one retired scope |
| a Scene | one retired scope, `flags.acks-extras` |
| a Token in that scene | two retired scopes, `flags.world` |
| a world `Setting` | key `<retired id>.<name>` |

That is 9 flag rows holding 12 scopes, 2 effect rows, 1 sheet row and 1
setting row: 13 leftovers.

### Drive mechanics (learned live)

- **A retired scope goes in at create.** `setFlag` refuses a scope that is no
  active package. `Actor.create({flags: {"<retired id>": {…}}})` takes it: the
  flags field checks only that the key is shaped like a package id.
- **An effect's changes are `system.changes`** in the create data.
- **A setting under a retired namespace is a raw `Setting` document**,
  `api.create("Setting", {key, value})`. Read it back by id from
  `game.settings.storage.get("world")`.
- **None of the retired ids may be an active package** in the test world, or
  `unsetFlag` accepts the scope and the deletion under test never runs. Read
  `game.modules.get(id)?.active` for each before the run.
- **The macro's id** is `acks39f78242e2b3`; its report is a dialog titled
  `ACKS II — Clean Up After the Merge`, where *Remove them* is
  `button[data-action="yes"]` and *Cancel* is `"no"`.
- **The report lists twelve rows a heading and counts the rest.** Keep the
  fixture set under that, so every row can be read against the run's ids.
- **A second reading of the scan** is the repair tool's:
  `acksExtras.lib.repair.scan({only: ["lib.mergeResidue"]})` answers the same
  rows as `findings` and removes nothing.
- **What the client sends is readable.** Wrap `game.socket.emit` before the
  run and keep every `modifyDocument` request: each names the documents it
  writes by id, which is how a write to anything outside the run's ledger is
  seen.

### Steps

1. **The world as found.** Before any fixture, read the repair scan and run
   the macro.
   *Observable:* the scan has no findings; the macro opens no dialog, sends no
   request and says `Nothing left from the old modules — this world is already
   clean.` Anything else ends the walk here.
2. **The report.** Create the fixtures and run the macro.
   *Observable:* the dialog counts 13 under `Flag scopes (9) — removed`,
   `Effect change keys (2) — removed`, `Sheet pointers (1) — cleared` and
   `World settings (1) — deleted`; every row names a fixture; the repair scan
   lists the same 13; nothing has been written yet.
3. **Remove them.** Press it.
   *Observable:* the notice says `Cleaned up 13 leftover(s).`; in each
   document's `_source.flags` every retired scope is gone and every other
   scope is as created; each effect keeps its other change key and has lost
   the retired one; the sheet pointer is gone; the setting document is gone;
   each flagged document was sent one update naming exactly its retired
   scopes; no request names a document outside the run's ledger; no
   `forced deletion` line.
4. **Nothing left.** Read the repair scan and run the macro again.
   *Observable:* as step 1.
5. **A reload keeps it.** Reload the client.
   *Observable:* the documents read as in step 3 and the scan has no findings.

### Teardown

`api.sweepTracked()`; quote what it removed, what it could not find and what
refused. The `Setting` fixture comes back as not found: the macro deleted it.
