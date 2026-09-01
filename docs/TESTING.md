# Live-test recipe — the entry point and the namespace

The canonical procedure is `.claude/rules/live-testing.md`. This file covers
the two files that sit directly under `scripts/`: the entry point
`scripts/module.mjs` (the import order that IS the hook order) and
`scripts/namespace.mjs` (the one global, `module.api`, the system boot-gate).
Every feature's own recipe is `docs/<feature>/TESTING.md`; this one proves the
module loads at all, which no feature recipe assumes.

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
   `abilities`, `equipment`, `classes`, `formation`, `influence`, `henchmen`,
   `location`, `markets`, `monsters`, `battlemap`, `vehicles`, `importer` —
   each a non-empty object. The importer's api is attached at `ready`, after
   its cookbook loads; give it a few seconds on a large library.
3. `game.modules.get("acks-extras").api === globalThis.acksExtras`.
   *Observable:* `true`. The namespace is the api; a feature that assigned its
   own `module.api` would hide every other feature behind one key.
4. `Object.keys(globalThis).filter((k) => /^acks/i.test(k))`.
   *Observable:* exactly `["acksExtras"]` — no per-feature or compat-alias
   global (`validate` 7c refuses one in source; this proves none arrives at
   runtime either).
5. Under Node, from the repo root:
   `node --input-type=module -e "await import('./scripts/namespace.mjs')"`.
   *Observable:* exits clean. The namespace tolerates a harness with no
   `Hooks` so the pure-logic modules (and `tools/importer/test-*.mjs`) can
   import through it; under Foundry, `Hooks` always exists, so nothing in
   the game is gated on that tolerance.

## Teardown

Nothing to remove.
