/* global game */
/**
 * The binding store on Foundry: one hidden world setting, read whole and
 * written whole, through the pure arithmetic in bindings-logic.mjs.
 */
import { MODULE_ID, SETTING_BINDINGS } from "./constants.mjs";
import { emptyStore, normalizeStore, boundUserId } from "./bindings-logic.mjs";

/** Register the hidden world setting. Called once at `init`. */
export function registerBindingsSetting() {
  game.settings.register(MODULE_ID, SETTING_BINDINGS, {
    scope: "world",
    config: false,
    type: Object,
    default: emptyStore(),
  });
}

/** The store as it stands. */
export const readStore = () => normalizeStore(game.settings.get(MODULE_ID, SETTING_BINDINGS));

/** Persist a store built by the pure functions. GM-only by the setting's scope. */
export async function writeStore(store) {
  await game.settings.set(MODULE_ID, SETTING_BINDINGS, normalizeStore(store));
  return readStore();
}

/**
 * The Foundry user a client identity acts as: the seat's own user when the
 * seat holder vouches (`asSeat`), else the bound user, else null. Deleted
 * users resolve to null and so read as unbound.
 */
export function resolveUser(client, args = {}) {
  if (args.asSeat) return game.user;
  if (!client?.kind || !client?.user) return null;
  const id = boundUserId(readStore(), client.kind, client.user);
  return id ? (game.users.get(id) ?? null) : null;
}
