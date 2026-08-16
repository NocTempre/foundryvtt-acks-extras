/* global game, Hooks */
/**
 * Telling Polyglot about the languages a world imported from its own books.
 *
 * THE SYSTEM ALREADY OWNS THE INTEGRATION and this module does not take it
 * over. `acks` registers its own provider and that provider answers the
 * question that matters — what does this character speak — by reading the
 * actor's `language` items, which is exactly what the family now writes. So
 * the known-tongue half needs no code here at all.
 *
 * ONE GAP IS LEFT. The system's provider builds the world's language LIST from
 * its own compendium and nothing else, so a tongue read out of a Judge's book
 * is spoken by the character and still absent from the chat selector — known,
 * but unusable. This adds those documents to the list the provider already
 * built.
 *
 * WHY NOT REGISTER OUR OWN PROVIDER: Polyglot picks its default by preferring
 * a `system.*` registration over a `module.*` one, so a provider registered
 * here would sit unused until a GM found the setting and chose it. Feeding the
 * system's provider is both the working answer and the one the family's
 * reuse-before-invent rule asks for.
 */
import { MODULE_ID } from "./constants.mjs";
import { worldLanguages } from "../classes/languages.mjs";

/** Polyglot fires this once its provider has finished its own setup. */
const PROVIDER_READY = "polyglot.languageProvider.ready";

/**
 * Add every language document the world holds to Polyglot's list, keeping any
 * font and rng the GM already chose for it.
 *
 * A language the provider already knows is left exactly as it is — the
 * system's compendium entry wins, because a world holding both means the
 * import adopted that document and they are the same tongue.
 *
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

  // A language imported after Polyglot settled must reach the selector without
  // a reload — an import mid-session is the normal way these arrive. Only world
  // language documents move the list, so everything else costs one comparison.
  //
  // ADDING ONLY. Withdrawing a language from a live provider would strip it
  // from every message already written in it; a deleted language leaves the
  // selector at the next reload instead.
  Hooks.on("createItem", (item) => {
    if (item?.type === "language" && !item.parent) publishWorldLanguages();
  });
}
