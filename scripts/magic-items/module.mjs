/* global Hooks */
/**
 * Magic items: rolling an item from the Judges Journal's and the Treasure
 * Tome's item-generation tables, as imported (`magicItemTables`). This file
 * publishes the roll and declares what the feature reads; the walk is
 * `chain-logic.mjs`, the registry read is `roll-service.mjs`, the card is
 * `chat-card.mjs` and the Judge's window is `roll-dialog.mjs`.
 */
import { acksExtras } from "../namespace.mjs";
import * as services from "../lib/services.mjs";
import { expectTables } from "../lib/tables.mjs";
import { EXPECTED_TABLES, MAGIC_ITEM_DOC, MAGIC_ITEM_ROLL_CONTRACT } from "./constants.mjs";
import { rollMagicItem, starts } from "./roll-service.mjs";
import { rollAndPost } from "./chat-card.mjs";
import { openRoller } from "./roll-dialog.mjs";

Hooks.once("init", () => {
  services.register(MAGIC_ITEM_ROLL_CONTRACT, { roll: rollMagicItem });
  // apiVersion: bumped on additive changes; a removal is a new major.
  acksExtras.magicItems = { apiVersion: 3, roll: rollMagicItem, starts, rollAndPost, openRoller };
});

Hooks.once("setup", () => {
  // What this feature will READ from the registry, declared so the import UX
  // can name what a world is missing. The values themselves never ship.
  expectTables(MAGIC_ITEM_DOC, EXPECTED_TABLES);
});
