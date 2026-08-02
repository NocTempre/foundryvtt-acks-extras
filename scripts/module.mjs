/**
 * ACKS II — Extras: the single entry point declared in module.json.
 *
 * Every feature under scripts/<feature>/ keeps the entry point it had as its
 * own module: a side-effect script that registers its own `Hooks.once("init")`
 * / `Hooks.on(...)` handlers at import time. Nothing here calls into them —
 * importing is the registration, exactly as loading eight separate modules
 * used to be.
 *
 * That makes IMPORT ORDER the hook order, because Foundry fires same-hook
 * callbacks in the order they were registered. The order below is the family's
 * dependency order, not alphabetical:
 *
 *   lib        first — everything else reads globalThis.acksLib from its own
 *              hooks, and lib owns the shared registries (services, tables) and
 *              the core patches.
 *   influence  before henchmen — henchmen consumes influence's Active Effect
 *              reaction convention (INFLUENCE_REACTION_KEY).
 *   location   after henchmen — see MERGE-NOTES.md §4: both still declare the
 *              Actor `location` subtype, and the later registration wins.
 *              That collision is recorded, not yet resolved; this ordering
 *              only makes which one wins deterministic.
 *   monsters   last — leaf, nothing depends on it.
 */
import "./lib/module.mjs";
import "./abilities/module.mjs";
import "./equipment/module.mjs";
import "./formation/module.mjs";
import "./influence/module.mjs";
import "./henchmen/module.mjs";
import "./location/module.mjs";
import "./monsters/module.mjs";
