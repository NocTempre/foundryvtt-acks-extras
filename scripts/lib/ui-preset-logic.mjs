/**
 * The default-sheet ladder — pure, so the harness can assert it.
 *
 * A world's UI preset names the RUNG it prefers: this module's sheets, the
 * system's, or Foundry's. Every registered sheet belongs to one rung by the
 * scope its id was registered under, and a document type the preferred rung
 * has no sheet for falls through the remaining rungs in one fixed order —
 * extras, then the system, then Foundry — so a type is never left without a
 * sheet. Foundry registers no Actor or Item sheet of its own, so on those the
 * `foundry` rung is empty and the ladder lands on this module's.
 */

/** The three presets, as the world setting stores them. */
export const UI_PRESET = Object.freeze({ foundry: "foundry", core: "acksCore", extras: "acksExtras" });

/** The three rungs a registered sheet can belong to, by the scope of its id. */
export const RUNG = Object.freeze({ extras: "extras", core: "core", foundry: "foundry" });

/** The fall-through order, richest first. */
export const LADDER = Object.freeze([RUNG.extras, RUNG.core, RUNG.foundry]);

const PRESET_RUNG = Object.freeze({
  [UI_PRESET.foundry]: RUNG.foundry,
  [UI_PRESET.core]: RUNG.core,
  [UI_PRESET.extras]: RUNG.extras,
});

/** The look a preset carries: `foundry` hands the tokens back; the other two keep the ACKS look. */
export function presetLook(preset) {
  return preset === UI_PRESET.foundry ? "core" : "book";
}

/** The rungs a preset tries, preferred first, then the ladder's own order. */
export function rungOrder(preset) {
  const first = PRESET_RUNG[preset] ?? RUNG.extras;
  return [first, ...LADDER.filter((r) => r !== first)];
}

/**
 * Which registered sheet a type should default to under `preset`.
 *
 * @param {Array<{id: string, rung: string|null, default?: boolean, canBeDefault?: boolean}>} sheets
 *   the type's registry entries in registration order, each tagged with its
 *   rung — null for a scope outside the ladder.
 * @param {string} preset one of `UI_PRESET`.
 * @param {Record<string, string>} [declared] each rung's own declared default —
 *   the id that carried the flag when the rung registered — so a rung holding
 *   several sheets keeps its own choice after the flag has moved elsewhere.
 * @returns {string|null} the id to flag, or null when the ladder has no say: no
 *   ladder sheet is registered, or the current default belongs to a scope
 *   outside the ladder (a third-party sheet that made itself default stands).
 */
export function chooseDefault(sheets, preset, declared = {}) {
  const current = sheets.find((s) => s.default);
  if (current && !current.rung) return null;
  for (const rung of rungOrder(preset)) {
    const candidates = sheets.filter((s) => s.rung === rung && s.canBeDefault !== false);
    if (!candidates.length) continue;
    const own = candidates.find((s) => s.id === declared[rung]) ?? candidates.find((s) => s.default);
    return (own ?? candidates[0]).id;
  }
  return null;
}

/** Each rung's own declared default, read from the flags as the registry stands. */
export function declaredDefaults(sheets) {
  const out = {};
  for (const s of sheets) if (s.default && s.rung) out[s.rung] = s.id;
  return out;
}
