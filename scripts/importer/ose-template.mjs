/**
 * A creature the book stats across a RANGE becomes a generator, not a creature.
 *
 * Some entries are not one monster. "HD 3** to 8** (13/18/22/27/31/36hp),
 * THAC0 By HD (17 [+2] to 12 [+7])" describes six creatures sharing everything
 * except their hit dice, and the Referee's Tome prints eleven of them. Read as
 * a single block each one arrives as the WEAKEST member of its own kind and the
 * rest of the range is gone — no gap, no note, just a three-hit-dice ankheg.
 *
 * The family already has the right document for this: `TEMPLATE_TYPE`, an
 * actor whose axes carry engine-ready patches and which stamps out concrete
 * creatures on demand. It was built for the Monstrous Manual's four
 * varies-by-rank entries; a varies-by-hit-dice entry is the same shape, so this
 * builds one rather than inventing a second mechanism.
 *
 * WHAT IS PRINTED AND WHAT IS NOT. Each step's hit points are printed — either
 * one figure per step or a rate per hit die — and are transcribed. The attack
 * throw is printed only at the two ENDS of the range, so the steps between are
 * filled only when the arithmetic proves itself: the bonus must advance evenly
 * across the range, which is the book's own table restricted to these rows. It
 * does not divide evenly, the middle of the range says nothing and the option
 * carries no throw at all. Nothing here interpolates on faith.
 */
import { convertOse } from "./ose-convert.mjs";
import { withSchemaSaveNames } from "./ose-binding.mjs";
import { MODULE_ID } from "./constants.mjs";
import { TEMPLATE_TYPE } from "../lib/constants.mjs";
export { TEMPLATE_TYPE };

/**
 * Does this parse describe a range rather than a creature?
 *
 * The grammar reports `countMax` only when the block printed "HD x to y", so
 * this is reading what the page said, not guessing from the numbers.
 */
export function isRangedCreature(fields) {
  const hd = fields?.hd;
  return !!hd && Number.isFinite(hd.count) && Number.isFinite(hd.countMax) && hd.countMax > hd.count;
}

/**
 * The attack bonus at each step of a hit-dice range, or null when the printed
 * ends do not divide evenly across it.
 *
 * Refusing is the point. Two printed endpoints and a printed number of steps
 * determine the middle only if the advance is uniform; where it is not, the
 * book is describing something this importer cannot see, and a plausible
 * straight line through it would be invention wearing arithmetic's clothes.
 */
export function bonusSteps(thac0, count, countMax) {
  const from = thac0?.ascendingBonus;
  const to = thac0?.ascendingBonusMax;
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  const spans = countMax - count;
  if (spans <= 0) return null;
  const delta = to - from;
  if (delta % spans !== 0) return null;
  const step = delta / spans;
  return Array.from({ length: spans + 1 }, (_, i) => from + step * i);
}

/**
 * Build one generator from SEVERAL entries that differ along one axis.
 *
 * The other shape a varying creature takes: instead of one block printing a
 * range, the book prints a block per step. Dolmenwood's retainers run "Level 1
 * Bard (Rhymer)", "Level 3 Bard (Troubadour)", "Level 5 Bard (Lore-Master)" —
 * three complete stat blocks that are one creature at three levels, and which
 * arrive as three unrelated monsters unless something says otherwise.
 *
 * Nothing is derived here at all: every option carries its own block, fully
 * converted, exactly as printed. That is the difference from the ranged case,
 * and why this one needs no arithmetic and can never refuse.
 *
 * @param members  `[{key, label, fields, raw, page, box, entryId}]`, in order
 */
export function oseTemplateFromGroup({
  name,
  groupId = null,
  axisKey = "level",
  axisLabel = "Level",
  members,
  source = null,
  lineage = "ose",
  constants = null,
  moraleBounds = null,
  folderId = null,
}) {
  const options = [];
  const conversions = [];
  const gaps = [];
  for (const m of members) {
    const converted = convertOse(m.fields, constants, { lineage, moraleBounds });
    conversions.push(...converted.conversions.map((c) => ({ ...c, option: m.key })));
    gaps.push(...converted.gaps.map((g) => ({ ...g, option: m.key })));
    options.push({
      key: String(m.key),
      label: m.label,
      nameLabel: m.label,
      merge: withSchemaSaveNames(converted.system),
      items: [],
      html: "",
      art: "",
      tint: "",
      flags: { [MODULE_ID]: { extras: converted.extras } },
      token: {},
    });
  }

  return {
    name,
    type: TEMPLATE_TYPE,
    folder: folderId,
    system: {
      // The option label already reads "Level 5 (Lore-Master)", so the default
      // fallback would parenthesise a parenthesis. Named explicitly instead.
      output: { actorType: "monster", nameFormat: `{base} {${axisKey}}` },
      base: { merge: {}, flags: {} },
      axes: [{ key: axisKey, label: axisLabel, roll: "", multi: false, derive: { from: "", max: null }, options }],
      cells: [],
      menu: { die: "", budgetAxis: "", rows: [] },
    },
    flags: {
      [MODULE_ID]: {
        ose: {
          raw: members.map((m) => m.raw).join("\n"),
          dialect: "ose.group",
          lineage,
          sourceId: source?.id ?? null,
          sourceLabel: source?.label ?? null,
          page: members[0]?.page ?? null,
          origin: "page",
          conversions,
          gaps,
          constants,
          unconverted: !constants,
          unaudited: true,
          group: { axis: axisKey, members: members.map((m) => ({ key: m.key, entryId: m.entryId, page: m.page })) },
        },
        // A generator built from several authored entries is one document, so
        // it needs an identity of its own: the group's key, under its book.
        // Group keys are bare words ("bard", "cleric") and repeat across books.
        ...(groupId
          ? { cookbook: { id: groupId, book: source?.id ?? "ose", kind: "kind.oseMonster", unaudited: true } }
          : {}),
      },
    },
  };
}

/**
 * Build the generator actor for a ranged creature.
 *
 * @param opts.fields     `parseOseStatline(...).fields` for the printed block
 * @param opts.constants  SCG values, or null (the throw is then a gap, as ever)
 * @returns Actor creation data of type `acks-extras.template`
 */
export function oseTemplateDataFromFields({
  name,
  entryId = null,
  fields,
  extra = [],
  raw = "",
  source = null,
  page = null,
  box = null,
  lineage = "ose",
  constants = null,
  moraleBounds = null,
  folderId = null,
  cite = "",
}) {
  const hd = fields.hd;
  const converted = convertOse(fields, constants, { lineage, moraleBounds });

  // The fixed foundation: everything the range does NOT vary. Hit points and
  // the attack throw come off it because those are exactly what the axis is
  // for — leaving them would stamp every generated creature with the weakest
  // member's figures under its own.
  // The saves go under the names this schema really has BEFORE they are frozen
  // into the base, or every creature the generator stamps loses one of them.
  const { hp: _hp, thac0: _thac0, ...baseSystem } = withSchemaSaveNames(converted.system);

  const bonuses = bonusSteps(fields.thac0, hd.count, hd.countMax);
  const options = [];
  for (let n = hd.count, i = 0; n <= hd.countMax; n++, i++) {
    const points = hd.hpSteps?.[i] ?? (Number.isFinite(hd.hpPerHd) ? hd.hpPerHd * n : null);
    const merge = { hp: { hd: `${n}d8${hd.bonus ? (hd.bonus > 0 ? `+${hd.bonus}` : `${hd.bonus}`) : ""}` } };
    if (Number.isFinite(points)) {
      merge.hp.value = points;
      merge.hp.max = points;
    }
    if (constants && bonuses) merge.thac0 = { throw: constants.attackThrow - bonuses[i] };
    options.push({
      key: String(n),
      label: `${n} HD`,
      nameLabel: `${n} HD`,
      merge,
      items: [],
      html: "",
      art: "",
      tint: "",
      flags: {},
      token: {},
    });
  }

  const gaps = [...converted.gaps];
  if (!bonuses && Number.isFinite(fields.thac0?.ascendingBonus)) {
    gaps.push({
      axis: "thac0",
      printed: `${fields.thac0.ascendingBonus} to ${fields.thac0.ascendingBonusMax ?? "?"}`,
      reason: "range-does-not-divide-evenly",
    });
  }

  return {
    name,
    type: TEMPLATE_TYPE,
    folder: folderId,
    system: {
      // An empty nameFormat is deliberate: the generator's own fallback reads
      // "Ankheg (5 HD)", which is what a Judge would have typed anyway.
      output: { actorType: "monster", nameFormat: "" },
      base: { merge: baseSystem, flags: { [MODULE_ID]: { extras: converted.extras } } },
      axes: [
        {
          key: "hd",
          label: "Hit Dice",
          roll: "",
          multi: false,
          derive: { from: "", max: null },
          options,
        },
      ],
      cells: [],
      menu: { die: "", budgetAxis: "", rows: [] },
    },
    flags: {
      [MODULE_ID]: {
        ose: {
          raw,
          parsed: fields,
          extra,
          dialect: "ose.range",
          lineage,
          sourceId: source?.id ?? null,
          sourceLabel: source?.label ?? null,
          page,
          box,
          origin: "page",
          conversions: converted.conversions,
          gaps,
          constants,
          unconverted: !constants,
          unaudited: true,
          range: { from: hd.count, to: hd.countMax, throwsDerived: !!bonuses },
          ...(cite ? { cite } : {}),
        },
        // Identity, on the same rule the creature binding states: the authored
        // entry when there is one, and nothing at all when there is not — an
        // id that cannot tell two blocks on a page apart is worse than none,
        // because the dedup check would answer for the wrong creature.
        ...(entryId
          ? { cookbook: { id: entryId, book: source?.id ?? "ose", kind: "kind.oseMonster", unaudited: true } }
          : {}),
      },
    },
  };
}
