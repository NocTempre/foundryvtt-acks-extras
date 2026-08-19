/**
 * The Source tab's view model.
 *
 * An importer that converts a creature from another game's book leaves the
 * whole provenance behind — the block as printed, what its grammar made of it,
 * how each ACKS value was reached, and which axes it refused to fill. This
 * turns that record into rows a Judge can read beside the page it came from,
 * which is the only way a conversion can actually be checked.
 *
 * Presentation only: nothing here recomputes or repairs a conversion. An
 * unrecognised route or reason falls back to its own key rather than being
 * hidden, because a label this file has not been taught about is still
 * information the Judge should see.
 */

const L = "ACKS-MONSTERS";

/** How a value was reached. */
const ROUTE_LABEL = Object.freeze({
  guide: `${L}.route.guide`,
  "raw-derivation": `${L}.route.rawDerivation`,
  transcribed: `${L}.route.transcribed`,
  "derived-endpoint": `${L}.route.derivedEndpoint`,
});

/** Why an axis was left alone. */
const REASON_LABEL = Object.freeze({
  "needs-guide": `${L}.gap.needsGuide`,
  "progressions-disagree": `${L}.gap.progressionsDisagree`,
  "no-attack-bonus-printed": `${L}.gap.noAttackBonus`,
  "single-save-printed": `${L}.gap.singleSave`,
  "no-acks-equivalent": `${L}.gap.noEquivalent`,
  "different-award-schedule": `${L}.gap.awardSchedule`,
  "different-treasure-tables": `${L}.gap.treasureTables`,
  "not-an-acks-alignment": `${L}.gap.notAlignment`,
  "out-of-scale": `${L}.gap.outOfScale`,
  "no-bounds": `${L}.gap.noBounds`,
  "unsupported-lineage": `${L}.gap.unsupportedLineage`,
  unreadable: `${L}.gap.unreadable`,
});

/** Render a printed or converted value compactly, whatever shape it arrived in. */
function show(v, depth = 0) {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.map((x) => show(x, depth + 1)).join("; ") || "—";
  if (typeof v === "object") {
    // A lone {value: n} wrapper carries nothing but the number.
    const keys = Object.keys(v);
    if (keys.length === 1 && keys[0] === "value") return show(v.value, depth + 1);
    return (
      Object.entries(v)
        .filter(([, x]) => x !== null && x !== undefined)
        .map(([k, x]) => (depth > 1 ? String(x) : `${k} ${show(x, depth + 1)}`))
        .join(", ") || "—"
    );
  }
  return String(v);
}

/**
 * @param rec  `flags["acks-importer"].ose` from the actor, or null
 * @returns a view model, or null when the creature was not imported
 */
export function oseSourceView(rec) {
  if (!rec) return null;
  const warnings = [];
  if (rec.unconverted) warnings.push(`${L}.warn.unconverted`);
  if (rec.mergedBlocks) warnings.push(`${L}.warn.mergedBlocks`);
  if (rec.suspectLineage) warnings.push(`${L}.warn.suspectLineage`);

  return {
    raw: rec.raw ?? "",
    sourceLabel: rec.sourceLabel || rec.sourceId || "",
    page: rec.page ?? "—",
    dialect: rec.dialect ?? "",
    lineage: rec.lineage ?? "",
    warnings,
    conversions: (rec.conversions ?? []).map((c) => ({
      axis: c.axis,
      printedText: show(c.printed),
      route: c.route ?? "unknown",
      routeLabel: ROUTE_LABEL[c.route] ?? c.route ?? "",
      valueText: show(c.value),
      rule: c.rule ?? "",
    })),
    gaps: (rec.gaps ?? []).map((g) => ({
      axis: g.axis,
      printedText: show(g.printed),
      reasonLabel: REASON_LABEL[g.reason] ?? g.reason ?? "",
    })),
    extra: rec.extra ?? [],
    notes: rec.notes ?? [],
  };
}
