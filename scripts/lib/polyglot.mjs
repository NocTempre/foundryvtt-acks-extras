/* global game, Hooks */
/**
 * Telling Polyglot about the languages a world imported from its own books.
 * The system's own Polyglot provider already answers what a character
 * speaks; this only adds the world's language documents to its list, so an
 * imported tongue is not known but unusable. See docs/lib/DECISIONS.md,
 * "The same day — telling Polyglot what the world imported".
 */
import { MODULE_ID } from "./constants.mjs";
import { worldLanguages } from "../classes/languages.mjs";

/** Polyglot fires this once its provider has finished its own setup. */
const PROVIDER_READY = "polyglot.languageProvider.ready";

/**
 * Add every language document the world holds to Polyglot's list, keeping
 * any font and rng the GM already chose. An entry the provider already
 * knows is left as it is.
 * @returns {number} how many were added.
 */
export function publishWorldLanguages() {
  const provider = game.polyglot?.languageProvider;
  if (!provider?.languages) return 0;
  // The GM asked for their own list and nothing else. Honour it.
  if (provider.replaceLanguages) return 0;

  const chosen = game.settings.get("polyglot", "Languages") ?? {};
  let added = 0;
  for (const item of worldLanguages()) {
    const key = item.name;
    if (provider.languages[key]) continue;
    provider.languages[key] = {
      label: item.name,
      font: chosen[key]?.font || provider.defaultFont,
      rng: chosen[key]?.rng ?? "default",
    };
    added++;
  }
  if (added) {
    provider.loadLanguages?.();
    provider.reloadLanguages?.();
  }
  return added;
}

/**
 * Wire the bridge. Silent and inert in a world without Polyglot — the hook
 * simply never fires.
 */
export function installPolyglotBridge() {
  Hooks.on(PROVIDER_READY, () => {
    const added = publishWorldLanguages();
    if (added) console.log(`${MODULE_ID} | told Polyglot about ${added} imported language(s)`);
  });

  // Reached without a reload for a mid-session import. Adding only — see
  // docs/lib/DECISIONS.md, "The same day — telling Polyglot what the world
  // imported".
  Hooks.on("createItem", (item) => {
    if (item?.type === "language" && !item.parent) publishWorldLanguages();
  });
}
