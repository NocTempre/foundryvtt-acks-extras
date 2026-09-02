/**
 * Compendium document content for acks-extras — the aggregator the synced
 * tools/build-packs.mjs consumes.
 *
 * Each merged feature keeps its own generator in tools/pack-data/<feature>.mjs;
 * this file only unions them. Contract (build-packs.mjs):
 *
 *   export const packs = { "<pack-name>": () => [documents...] };
 *
 * MACROS ARE CONCATENATED, NOT OVERWRITTEN. Several features each ship a pack
 * literally named `macros`, so a plain object spread would silently keep only
 * the last one. They union into a single `macros` pack — no filename and no
 * `_id` collisions across them, so nothing has to be renamed.
 *
 * They land in ONE compendium folder rather than the per-feature trees they
 * arrived in; a flat wall of macros in a single pack is worse than the
 * separate packs were.
 */
import crypto from "node:crypto";

import { packs as abilities } from "./pack-data/abilities.mjs";
import { packs as equipment } from "./pack-data/equipment.mjs";
import { packs as formation } from "./pack-data/formation.mjs";
import { packs as henchmen } from "./pack-data/henchmen.mjs";
import { packs as influence } from "./pack-data/influence.mjs";
import { packs as lib } from "./pack-data/lib.mjs";
import { packs as location } from "./pack-data/location.mjs";
import { packs as monsters } from "./pack-data/monsters.mjs";
import { packs as importer } from "./pack-data/importer.mjs";

const FEATURES = { lib, abilities, equipment, formation, henchmen, influence, location, monsters, importer };

/** Deterministic 16-char id under the module's declared idPrefix ("acks"). */
const did = (seed) => "acks" + crypto.createHash("sha1").update(seed).digest("hex").slice(0, 12);

/** Fixed, so a rebuild never churns packs/_source or the compiled packs. */
const STATS = { coreVersion: "13", createdTime: 1785551134915, modifiedTime: 1785551134915 };

const MACRO_FOLDER_ID = did("folder:macros");

/** The one folder every macro is filed under. */
function macroFolder() {
  return {
    _id: MACRO_FOLDER_ID,
    _key: `!folders!${MACRO_FOLDER_ID}`,
    name: "ACKS Extras",
    type: "Macro",
    sorting: "a",
    folder: null,
    color: null,
    sort: 0,
    flags: {},
    _stats: STATS,
  };
}

const resolve = (v) => (typeof v === "function" ? v() : (v ?? []));

/** Union every feature's packs; same-named packs concatenate. */
function collect() {
  const out = {};
  for (const map of Object.values(FEATURES)) {
    for (const [name, value] of Object.entries(map ?? {})) {
      (out[name] ??= []).push(...resolve(value));
    }
  }
  if (out.macros?.length) {
    // A macro that already names a folder — the importer's own macros, filed
    // under its two sub-folders — keeps that assignment; only a TOP-level
    // document (folder: null/undefined: every other feature's flat macros,
    // and the importer's two sub-folders themselves) is promoted into the
    // shared folder. That nests the importer's tree one level under "ACKS
    // Extras" instead of flattening it — a plain overwrite here would have
    // discarded every macro's own folder assignment.
    out.macros = [
      macroFolder(),
      ...out.macros.map((m) => ({ ...m, folder: m.folder == null ? MACRO_FOLDER_ID : m.folder })),
    ];
  }
  return out;
}

const collected = collect();

export const packs = Object.fromEntries(
  Object.entries(collected).map(([name, docs]) => [name, () => docs])
);
