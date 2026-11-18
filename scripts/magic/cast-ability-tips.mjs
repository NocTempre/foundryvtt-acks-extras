/**
 * The tooltips of a cast's ability parts, shared by the cast dialog and the cast
 * card: each part reads "{ability} {±value} ({cite})" (`abilityPartTip`), and
 * the caster level's tooltip names where its base came from and then the parts
 * on it. Foundry-free: the caller's localizer is passed in.
 */
import { abilityPartTip } from "./cast-abilities.mjs";

/** The cast's root in a full lang key; the matcher's keys carry it and a caller's localizer takes the rest. */
const KEY_ROOT = "ACKS-MAGIC.cast.";

/**
 * The tooltip of a cast's caster level (`castAbilityLevel`'s answer): where the
 * base came from (`base` is the figure before the abilities, so the line names
 * the figure it says), then each ability part that applied, then each that was
 * listed. A level set by hand takes no ability, so what matched is marked as
 * listed and not added; any other listed part lost to another or has no figure,
 * and its own tip says so.
 *
 * @param {{value: number|null, source: string|null, base?: number|null, parts?: object[], listed?: object[]}} level
 * @param {(key: string, data?: object) => string} loc  takes a key under `ACKS-MAGIC.cast.`
 * @returns {string}
 */
export function levelTip(level, loc) {
  const source = level?.source;
  const base = source ? loc(`tip.level.${source}`, { value: level.base ?? level.value }) : "";
  const added = abilityTips(level?.parts, loc);
  const byHand = source === "hand" || level?.base == null;
  const listed = (level?.listed ?? []).flatMap((p) => {
    const [tip] = abilityTips([p], loc);
    return tip ? [byHand && !p.blank ? loc("ability.listed", { tip }) : tip] : [];
  });
  return [base, ...added, ...listed].filter(Boolean).join(" · ");
}

/**
 * The tooltip lines of a cast's ability parts: each part's "{ability} {±value}
 * ({cite})" (`abilityPartTip`), applied or listed, blank ones included for their
 * page reference. `loc` is the cast card's short-key localizer; the matcher's
 * keys are full, so the root is put back on.
 *
 * @param {object[]} parts
 * @param {(key: string, data?: object) => string} loc  takes a key under `ACKS-MAGIC.cast.`
 * @returns {string[]}
 */
export function abilityTips(parts, loc) {
  const full = (key, data) => loc(key.startsWith(KEY_ROOT) ? key.slice(KEY_ROOT.length) : key, data);
  return (parts ?? []).map((p) => abilityPartTip(p, full)).filter(Boolean);
}
