/**
 * Compendium document content for acks-extras — the aggregator the synced
 * tools/build-packs.mjs consumes.
 *
 * Each merged feature keeps its own generator in tools/pack-data/<feature>.mjs;
 * this file only unions them. Contract (build-packs.mjs):
 *
 *   export const packs = { "<pack-name>": () => [documents...] };
 *
 * MACROS ARE CONCATENATED, NOT OVERWRITTEN. Five of the eight features each
 * shipped a pack literally named `macros`, so a plain object spread would have
 * silently kept only the last one. They union into a single `macros` pack —
 * checked when the repos were merged: no filename and no `_id` collisions
 * across the five, so nothing had to be renamed.
 *
 * All 24 land in ONE compendium folder rather than the five per-feature trees
 * they arrived in; a flat wall of macros in a single pack is worse than the
 * five packs were.
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

const FEATURES = { lib, abilities, equipment, formation, henchmen, influence, location, monsters };

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
    out.macros = [macroFolder(), ...out.macros.map((m) => ({ ...m, folder: MACRO_FOLDER_ID }))];
  }
  return out;
}

const collected = collect();

export const packs = Object.fromEntries(
  Object.entries(collected).map(([name, docs]) => [name, () => docs])
);
