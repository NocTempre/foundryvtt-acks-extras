/* global game, Item, Hooks */
/**
 * Bringing a world's languages onto the system's own type.
 *
 * Two shapes predate this: languages minted as ABILITY items (the taxonomy
 * import's own, stamped `def.language.*`), and tongues recorded as bare names
 * inside a carrier's `entries` flag — which were never documents at all, so no
 * character holding one was visible to the system's sheet section or to the
 * Polyglot provider that reads it.
 *
 * BOTH CONVERGE ON THE SAME ANSWER: one `language` document per tongue, on the
 * actor that speaks it. The carrier survives, holding only what it was always
 * really for — the count of picks still open, and which languages were chosen
 * against it.
 *
 * ORDERED TO SURVIVE A FAILURE AT ANY POINT. Every replacement is created
 * before anything it replaces is removed, and the carrier's flag is rewritten
 * only once its languages exist. A run that dies halfway leaves a world with a
 * duplicate — which the next run adopts rather than doubling — never one that
 * has lost a language.
 *
 * IDEMPOTENT, so it can simply run at `ready` on every load: a world already
 * converted matches nothing and writes nothing.
 */
import { MODULE_ID } from "./constants.mjs";
import { SLOT_FLAG, LANGUAGE_TYPE, ensureLanguage, slotsOf } from "./languages.mjs";

/** The taxonomy import's id prefix — an ability carrying it is a language. */
const IMPORTED_PREFIX = "def.language.";

/** The cookbook id stamped on a document, or "". */
const cookbookIdOf = (doc) => String(doc?.flags?.["acks-importer"]?.cookbook?.id ?? "");

/**
 * World abilities the taxonomy import minted before the type was right.
 *
 * The importer retypes its own on the next import, but a world may never
 * import again, and its characters' carriers point at these — so extras
 * converts what it finds rather than waiting.
 */
function staleWorldLanguages() {
  return (game.items ?? []).filter((i) => i.type === "ability" && cookbookIdOf(i).startsWith(IMPORTED_PREFIX));
}

/** Retype the world's imported language abilities. */
async function convertWorldLanguages() {
  const stale = staleWorldLanguages();
  if (!stale.length) return 0;

  const have = new Set(
    (game.items ?? []).filter((i) => i.type === LANGUAGE_TYPE).map((i) => cookbookIdOf(i)).filter(Boolean),
  );
  const creates = [];
  const retire = [];
  for (const old of stale) {
    const id = cookbookIdOf(old);
    if (!have.has(id)) {
      creates.push({
        name: old.name,
        type: LANGUAGE_TYPE,
        img: old.img,
        system: { description: old.system?.description ?? "" },
        folder: old.folder?.id ?? null,
        flags: old.flags,
      });
    }
    retire.push(old.id);
  }
  if (creates.length) await Item.createDocuments(creates);
  await Item.deleteDocuments(retire);
  return creates.length;
}

/**
 * Turn one actor's recorded names into documents.
 *
 * The GRANTED carrier is retired outright: everything it held is now a
 * language on the actor, and the carrier existed only to hold them. The OPEN
 * carrier keeps its capacity and trades its names for the ids of the documents
 * they became.
 */
async function convertActor(actor) {
  const carriers = actor.items.filter((i) => i.type === "ability" && slotsOf(i));
  if (!carriers.length) return 0;

  let made = 0;
  const retire = [];
  for (const carrier of carriers) {
    const flag = carrier.getFlag(MODULE_ID, SLOT_FLAG) ?? {};
    const entries = flag.entries ?? [];
    // Already converted: no legacy names left to move.
    if (!entries.length && flag.filled) continue;

    const filled = [];
    for (const entry of entries) {
      const name = String(entry?.name ?? "").trim();
      if (!name) continue;
      const { item, created } = await ensureLanguage(actor, entry?.uuid ? `uuid:${entry.uuid}` : name);
      if (!item) continue;
      if (created) made++;
      filled.push(item.id);
    }

    if ((flag.source ?? "open") === "granted") {
      // Its whole content is documents now.
      retire.push(carrier.id);
      continue;
    }
    await carrier.setFlag(MODULE_ID, SLOT_FLAG, {
      capacity: Math.max(Number(flag.capacity) || 0, filled.length),
      filled,
      source: "open",
    });
  }
  // Only now: every tongue the granted carrier held exists on the actor.
  if (retire.length) await actor.deleteEmbeddedDocuments("Item", retire);
  return made;
}

/**
 * Sweep the world once. GM-only — it writes documents on other people's
 * characters, and every seat running it would race every other.
 */
export async function migrateLanguages() {
  if (!game.user?.isGM) return { world: 0, actors: 0, languages: 0 };

  const world = await convertWorldLanguages();
  let actors = 0;
  let languages = 0;
  for (const actor of game.actors ?? []) {
    const made = await convertActor(actor);
    if (made) {
      actors++;
      languages += made;
    }
  }
  return { world, actors, languages };
}

/** Run the sweep once the world is up. */
export function installLanguageMigration() {
  Hooks.once("ready", () => {
    migrateLanguages()
      .then((r) => {
        if (r.world || r.languages) {
          console.log(
            `${MODULE_ID} | languages now use the system's own type: ${r.world} in the world, ` +
              `${r.languages} on ${r.actors} character(s)`,
          );
        }
      })
      .catch((err) => console.error(`${MODULE_ID} | language migration failed`, err));
  });
}
