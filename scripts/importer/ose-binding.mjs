/**
 * Turning a converted OSE stat block into a Foundry actor.
 *
 * Deliberately NOT an extension of cookbook.mjs's `bindNpc`. That binder reads
 * an ACKS quick-stat line, whose morale is already on the ACKS scale and whose
 * saves come off the fighter progression — both correct there and both wrong
 * here. Reusing it would clamp every OSE morale of 5 or more to the maximum
 * and overwrite the book's printed saving throws with a derived row.
 *
 * Everything the grammar read is stored on the actor whether or not it became
 * an ACKS field, together with how each value was reached, so the conversion
 * can be audited on the sheet against the page it came from.
 */
import { MODULE_ID } from "./constants.mjs";
import { convertOse } from "./ose-convert.mjs";
import { parseOseStatline } from "./ose-statline.mjs";
import { profileFor } from "./ose-source.mjs";

/**
 * ACKS II's saves are being renamed, and both spellings are in the wild.
 *
 * The converter emits the ACKS II names, `blast` and `implements`. The system on
 * the other side may not have them yet — release `acks` 14.0.1 still calls them
 * `breath` and `wand` — and a SchemaField silently DROPS a key it has no field
 * for. A creature imported against that build therefore kept four of its five
 * saving throws and said nothing: the fifth was gone before the document
 * existed, which is why no offline check could see it.
 *
 * Renaming here rather than in the converter keeps the converter free of
 * Foundry and puts the choice where the target schema can be read. A build
 * carrying the new name is written under the new name, so this expires by
 * itself rather than becoming a permanent alias.
 *
 * @returns canonical save key -> the key this system's schema really has
 */
export function saveFieldNames() {
  const legacy = { blast: "breath", implements: "wand" };
  const out = {};
  let fields = null;
  try {
    fields = CONFIG?.Actor?.dataModels?.monster?.schema?.getField?.("saves")?.fields ?? null;
  } catch {
    fields = null;
  }
  for (const [canonical, older] of Object.entries(legacy)) {
    out[canonical] = fields && !fields[canonical] && fields[older] ? older : canonical;
  }
  return out;
}

/**
 * A converted `system` with its saves under the names this schema really has.
 *
 * Every path that writes a document goes through here — the single creature,
 * and each option of a generator — because a key with no field behind it is
 * dropped in silence, and a generator drops it once per creature it stamps.
 */
export function withSchemaSaveNames(system) {
  const saves = system?.saves;
  if (!saves) return system;
  const named = saveFieldNames();
  const out = {};
  for (const [key, value] of Object.entries(saves)) out[named[key] ?? key] = value;
  return { ...system, saves: out };
}

/**
 * The `details.morale` field's own bounds, from the live schema.
 *
 * Read rather than written down: the endpoint mapping is derived from the two
 * scales' widths, so the ACKS half must come from whatever the system actually
 * declares. A system that rebalanced the field would otherwise get a silently
 * wrong mapping. Returns null when the field cannot be found, and the
 * converter then reports morale as a gap instead of guessing.
 */
export function moraleBoundsFromSchema() {
  try {
    const model = CONFIG?.Actor?.dataModels?.monster;
    const field = model?.schema?.getField?.("details.morale");
    const { min, max } = field ?? {};
    return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
  } catch {
    return null;
  }
}

/** Strip a stat block off the front of a candidate to guess the creature's name. */
export function nameFromCandidate(candidate, fallback = "Imported creature") {
  const lead = (candidate?.leadingText ?? "").trim();
  if (lead) return lead.slice(0, 60);
  return fallback;
}

/**
 * Actor data from OSE fields that are already settled. Pure — no Foundry calls.
 *
 * Split from `oseActorData` because a Judge who corrects a misread field needs
 * that correction to reach the actor. Re-deriving the fields from the raw text
 * here would silently discard every edit, which is the same class of fault as
 * converting a value and never writing it: the work is done and then thrown
 * away between one step and the next.
 *
 * `origin` says where the fields came from — a page the locator read, or a
 * person who typed them — and that reaches the provenance record, because
 * "this number was read off a scan" and "this number was typed in" deserve
 * different amounts of trust at the table.
 *
 * @param opts.fields   OSE-idiom fields, as `parseOseStatline(...).fields`
 * @param opts.origin   `"page"` | `"hand"`
 * @param opts.lineage  which ruleset the fields are written in
 * @param opts.entryId  the authored cookbook entry this creature IS, when it
 *                      came from one — see the cookbook flag below
 */
export function oseActorDataFromFields({
  name,
  blockName = "",
  entryId = null,
  fields,
  extra = [],
  dialect = "ose.canonical",
  raw = "",
  source = null,
  page = null,
  box = null,
  origin = "page",
  lineage,
  constants,
  moraleBounds,
  folderId = null,
  suspectLineage = false,
  mergedBlocks = false,
}) {
  const converted = convertOse(fields, constants, {
    lineage: lineage ?? source?.lineage ?? "ose",
    moraleBounds,
  });
  const where =
    origin === "hand"
      ? source?.label
        ? `${source.label} — entered by hand`
        : "Entered by hand"
      : `${source?.label ?? "Imported"} — p.${page}`;

  // Saves go in under the names this system's schema actually declares; see
  // `saveFieldNames`. A key with no field behind it is dropped without a word.
  const renamed = withSchemaSaveNames(converted.system);

  return {
    name: name || blockName || "Imported creature",
    type: "monster",
    folder: folderId,
    system: {
      ...renamed,
      details: {
        ...(converted.system.details ?? {}),
        biography: `<p><em>${where}</em></p>`,
      },
    },
    items: converted.items ?? [],
    flags: {
      // Open on the sheet that can actually show the provenance below. The Full
      // Monster sheet registers for `monster` but is not the default for it, so
      // without this an imported creature lands on a sheet with no Source tab
      // and the audit trail is invisible to the Judge who needs it.
      core: { sheetClass: `${MODULE_ID}.FullMonsterSheet` },
      [MODULE_ID]: {
        // The extended stat block. Hit-dice rating, saves-as, the speed table
        // and the encounter numbers have no home in the core schema and are
        // read from this flag by the Full Monster sheet — converting them and
        // then not writing them here loses every one of them silently.
        extras: converted.extras ?? {},
        // The whole provenance record. `raw` is the block exactly as extracted,
        // `parsed` is what the grammar made of it in OSE's own idiom, and
        // `conversions` says how each ACKS value was reached — the three
        // things an audit needs and none of which survive in the actor's
        // fields alone.
        ose: {
          raw,
          parsed: fields,
          extra,
          dialect,
          origin,
          lineage: converted.lineage,
          sourceId: source?.id ?? null,
          sourceLabel: source?.label ?? "",
          page,
          box,
          conversions: converted.conversions,
          gaps: converted.gaps,
          notes: converted.notes,
          constants: constants ?? null,
          unconverted: !constants,
          suspectLineage: !!suspectLineage,
          mergedBlocks: !!mergedBlocks,
        },
        // Identity, and the thing a second run of the same import asks about.
        // An AUTHORED book knows which entry this creature is, so the entry id
        // is the id — one per creature, stable across runs and printings. The
        // registered-source and by-hand paths have no entry to name, and fall
        // back to where the block was found; that id is NOT unique (a bestiary
        // prints up to nine creatures on a page), so those paths are the ones
        // that cannot be deduplicated, and they are the ones a Judge drives one
        // block at a time.
        cookbook: {
          id: entryId ?? `${source?.id ?? "ose"}.${origin === "hand" ? "hand" : `p${page}`}`,
          book: source?.id ?? "ose",
          kind: "kind.oseMonster",
          unaudited: true,
        },
      },
    },
  };
}

/**
 * Actor data for one located block — parse the candidate's text, then build.
 *
 * The PDF path's entry point, kept so callers that have a candidate rather than
 * fields do not have to know about the split.
 */
export function oseActorData({ name, candidate, source, page, constants, moraleBounds, folderId = null }) {
  const parsed = parseOseStatline(candidate.text, profileFor(source));
  return oseActorDataFromFields({
    // A block that named itself supplies the name when the caller did not.
    name: name || parsed.name || "",
    fields: parsed.fields,
    extra: parsed.extra,
    dialect: parsed.dialect,
    blockName: parsed.name ?? "",
    raw: candidate.text,
    source,
    page,
    box: candidate.box ?? null,
    origin: "page",
    constants,
    moraleBounds,
    folderId,
    suspectLineage: candidate.suspectLineage,
    mergedBlocks: candidate.mergedBlocks,
  });
}


/**
 * Were these read from the same printing? A different printing could in
 * principle carry different constants, and that IS worth re-converting for —
 * so the comparison is on the values, not merely on whether any were stored.
 */
function sameConstants(a, b) {
  if (!a || !b) return false;
  return Object.keys(b).every((k) => a[k] === b[k]);
}

/**
 * Re-run the conversion on an actor imported without the guide.
 *
 * Idempotent, and it only ever ADDS the axes that needed arithmetic — the
 * fields that came off the page directly are already correct and are left
 * alone. A Judge can therefore import a whole adventure today and connect the
 * Compatibility Guide next week without re-importing anything.
 */
export function reconversionFor(actor, constants, moraleBounds) {
  const rec = actor?.flags?.[MODULE_ID]?.ose;
  if (!rec?.parsed || !constants) return null;
  // Already done, with these same constants: there is nothing to add, and
  // re-writing the axes would overwrite whatever the Judge has since corrected
  // by hand. Deciding that here rather than trusting the caller's filter is the
  // difference between a pass that is idempotent and one that merely looks it.
  if (rec.unconverted === false && sameConstants(rec.constants, constants)) return null;
  const converted = convertOse(rec.parsed, constants, { lineage: rec.lineage ?? "ose", moraleBounds });
  const update = {};
  // Only the axes the guide unlocks; everything else already landed.
  if (converted.system.aac) update["system.aac.value"] = converted.system.aac.value;
  if (converted.system.thac0) update["system.thac0.throw"] = converted.system.thac0.throw;
  if (!Object.keys(update).length) return null;
  update[`flags.${MODULE_ID}.ose.conversions`] = converted.conversions;
  update[`flags.${MODULE_ID}.ose.gaps`] = converted.gaps;
  update[`flags.${MODULE_ID}.ose.constants`] = constants;
  update[`flags.${MODULE_ID}.ose.unconverted`] = false;
  return update;
}

/** Every actor in the world imported from an OSE source without the guide. */
export const unconvertedOseActors = () =>
  game.actors.filter((a) => a.flags?.[MODULE_ID]?.ose?.unconverted);

/**
 * Fill in the arithmetic axes on every unconverted OSE actor.
 * Returns the number updated.
 */
export async function convertUnconvertedOse(constants) {
  if (!constants) return 0;
  const bounds = moraleBoundsFromSchema();
  const updates = [];
  for (const actor of unconvertedOseActors()) {
    const u = reconversionFor(actor, constants, bounds);
    if (u) updates.push({ _id: actor.id, ...u });
  }
  if (!updates.length) return 0;
  await Actor.updateDocuments(updates);
  return updates.length;
}
