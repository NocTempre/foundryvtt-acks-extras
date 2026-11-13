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
