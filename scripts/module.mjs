/**
 * ACKS II — Extras: the single entry point declared in module.json.
 *
 * Every feature under scripts/<feature>/ is a side-effect script that registers
 * its own `Hooks.once("init")` / `Hooks.on(...)` handlers at import time.
 * Nothing here calls into them — importing IS the registration.
 *
 * That makes IMPORT ORDER the hook order, because Foundry fires same-hook
 * callbacks in the order they were registered. The order below is the family's
 * dependency order, not alphabetical:
 *
 *   lib        first — everything else reads globalThis.acksExtras?.lib from its
 *              own hooks, and lib owns the shared registries (services, tables)
 *              and the core patches.
 *   influence  before henchmen — henchmen consumes influence's Active Effect
 *              reaction convention (INFLUENCE_REACTION_KEY).
 *   location   after henchmen — the two import each other (henchmen pulls in
 *              LocationSheet; that sheet pulls the market engine, tables and
 *              dialogs back out of henchmen), so this order fixes which side
 *              finishes initializing first rather than leaving it to chance.
 *              The `location` Actor sub-type is registered once either way, by
 *              location/module.mjs, which owns it.
 *   markets    after location — it consumes lib registries, equipment's gear
 *              grant, henchmen's coin adapter/time/market-class rules, and
 *              location's market subtree; nothing consumes it.
 *   monsters   near-last — no hooks depend on it, but battlemap reads its pure
 *              config (SIZES footprints), so it registers first of the two.
 *   battlemap  after monsters — sizes tokens from monsters' SIZES table and
 *              formation's flags; both are plain data imports, so only this
 *              comment depends on the order.
 *   importer   last — it writes into what every other feature owns (the
 *              tables registry, the class builder, the sub-types, the ability
 *              model) and nothing consumes it except through the
 *              `ability-provider` service, which is looked up at call time.
 */
import "./lib/module.mjs";
import "./abilities/module.mjs";
import "./equipment/module.mjs";
import "./classes/module.mjs";
import "./formation/module.mjs";
import "./influence/module.mjs";
import "./henchmen/module.mjs";
import "./location/module.mjs";
import "./markets/module.mjs";
import "./monsters/module.mjs";
import "./battlemap/module.mjs";
import "./vehicles/module.mjs";
import "./importer/module.mjs";
