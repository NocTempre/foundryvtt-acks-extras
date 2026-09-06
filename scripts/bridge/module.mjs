/* global Hooks, game, foundry */
/**
 * The bridge: a command surface for a client outside Foundry.
 *
 * A seat holder — the Discord service is the first — joins the world as a
 * dedicated user, evaluates `acksExtras.bridge.run(name, args)` in page
 * context, and hears the world back through the event tap. Nothing here
 * renders and nothing here knows a rule: every command is a permission guard
 * over a function another feature already owns (the sheet's roll-by-id, the
 * frame snapshot, core's chat), run as the Foundry user the client identity
 * is bound to. The bindings, the guard, the stamp and the tap are the whole
 * feature; how a client presents them is the client's.
 */
import { acksExtras, assertAcksSystem } from "../namespace.mjs";
import { MODULE_ID, LANG, EMIT_BINDING, ERR, CLIENT_KINDS } from "./constants.mjs";
import { createRegistry, BridgeError } from "./registry-logic.mjs";
import { registerBindingsSetting, resolveUser, readStore, writeStore } from "./bindings.mjs";
import * as bindingsLogic from "./bindings-logic.mjs";
import { registerCommands } from "./commands.mjs";
import { registerClientConfigSettings, registerClientConfigCommands, readClientConfig, readAgent, writeClientConfig, writeAgent } from "./client-config.mjs";
import { BridgeClientConfigApp } from "./apps/client-config.mjs";
import { BridgeMembersApp } from "./apps/members.mjs";
import { registerEventTap, drain, emit } from "./events.mjs";
import { provenanceOf, stampFor, flagsFor } from "./provenance.mjs";

const registry = createRegistry({ resolveUser });

Hooks.once("init", () => {
  registerBindingsSetting();
  registerClientConfigSettings();
  registerCommands(registry);
  registerClientConfigCommands(registry);

  game.settings.registerMenu(MODULE_ID, "bridgeClientMenu", {
    name: `${LANG}.config.title`,
    label: `${LANG}.config.open`,
    hint: `${LANG}.config.menuHint`,
    icon: "fab fa-discord",
    type: BridgeClientConfigApp,
    restricted: true,
  });

  game.settings.registerMenu(MODULE_ID, "bridgeMembersMenu", {
    name: `${LANG}.members.title`,
    label: `${LANG}.members.open`,
    hint: `${LANG}.members.menuHint`,
    icon: "fas fa-user-group",
    type: BridgeMembersApp,
    restricted: true,
  });

  try {
    foundry.applications.handlebars.loadTemplates([`modules/${MODULE_ID}/templates/bridge/client-config.hbs`, `modules/${MODULE_ID}/templates/bridge/members.hbs`]);
  } catch (err) {
    console.warn(`${MODULE_ID} | bridge template preload skipped`, err);
  }

  acksExtras.bridge = {
    apiVersion: 1,
    /** Run one command: `run(name, { client, ...args })` → `{ok, data}` or `{ok:false, code, message}`. */
    run: registry.run,
    /** Every registered command, without handlers. */
    list: registry.list,
    /** Register a command from another feature or a macro; a duplicate name throws. */
    register: registry.register,
    BridgeError,
    /** Events after a sequence number, for a seat that connects late. */
    drain,
    /** Push an event of your own into the stream (a macro announcing something to the client). */
    emit,
    /** The binding store: read whole, write whole, and the pure arithmetic between. */
    bindings: { read: readStore, write: writeStore, ...bindingsLogic },
    /** The client's configuration and the client's own announcement, as the window and the seat use them. */
    clientConfig: { read: readClientConfig, write: writeClientConfig, readAgent, writeAgent },
    provenanceOf,
    stampFor,
    flagsFor,
    EMIT_BINDING,
    CLIENT_KINDS,
    ERR,
  };
});

Hooks.once("ready", () => {
  if (!assertAcksSystem("the bridge drives acks characters and stays inert.")) return;
  registerEventTap();
  console.log(`${MODULE_ID} | bridge ready (${registry.list().length} commands; events via ${EMIT_BINDING}).`);
});
