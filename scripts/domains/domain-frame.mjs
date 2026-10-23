/**
 * The domain sheet's frame, decided offline: the chips naming the ruler and
 * the liege, the tags for the classification and the alignment, every rail
 * cell with its reading, its tooltip and the tab it opens, and the lines
 * saying what those figures leave out. Pure over the
 * sums the sheet has already read (`familiesOf`, `hexCountOf`,
 * `strongholdValueOf`, `ledgerFor`) and a `loc` for the words, so
 * tools/test-domains.mjs pins it without a running Foundry; domain-sheet.mjs
 * binds it to the window.
 *
 * A rail shows what the record states and nothing more: a count with rows
 * nobody counted reads as "at least" (`more`), and a month whose ledger is
 * partial says so on each of its cells rather than showing a smaller figure
 * as exact. A cell is a press that opens the tab where its figure is kept, on
 * every seat: it reads, and writes nothing.
 */

/** A figure as the sheet shows it: the number, rounded to the hundredth, or a dash for none. */
export function shownFigure(n) {
  if (n === null || n === undefined || n === "") return "—";
  const v = Number(n);
  return Number.isFinite(v) ? String(Math.round(v * 100) / 100) : "—";
}

/** One rail cell: its reading, with "+" where rows went uncounted, and a tooltip naming both. */
function railCell({ key, icon, name, value, more = false, partial = false, partialNote = "", tab }, loc) {
  const reading = `${shownFigure(value)}${more ? "+" : ""}`;
  const said = loc("frame.cell", { name, reading });
  return {
    key,
    icon,
    name,
    reading,
    partial,
    tab,
    title: partial ? `${said} — ${partialNote}` : said,
  };
}

/**
 * The two rails: the land (peasant and urban families, hexes, the
 * stronghold's value) and the month (revenue, expenses, income).
 * @param {object} input
 * @param {{peasant: number, urban: number, urbanUnknown: number}} input.families `familiesOf`
 * @param {{total: number, unknown: number}} input.hexCount
 * @param {{total: number, unknown: number}} input.strongholdValue
 * @param {{totals: {revenue: number, expenses: number, income: number}, partial: boolean}} input.ledger `ledgerFor`
 * @param {string} input.partialNote what the partial ledger lacks, in words
 * @param {(key: string, data?: object) => string} loc
 * @returns {{land: object[], month: object[]}}
 */
export function railsOf({ families, hexCount, strongholdValue, ledger, partialNote = "" }, loc) {
  const cell = (spec) => railCell(spec, loc);
  const partial = !!ledger?.partial;
  return {
    land: [
      cell({ key: "peasant", icon: "fa-solid fa-wheat-awn", name: loc("field.peasantFamilies"), value: families?.peasant ?? 0, tab: "territory" }),
      cell({ key: "urban", icon: "fa-solid fa-city", name: loc("field.urbanFamilies"), value: families?.urban ?? 0, more: (families?.urbanUnknown ?? 0) > 0, tab: "holdings" }),
      cell({ key: "hexes", icon: "fa-solid fa-map", name: loc("field.hexes"), value: hexCount?.total ?? 0, more: (hexCount?.unknown ?? 0) > 0, tab: "territory" }),
      cell({ key: "stronghold", icon: "fa-solid fa-chess-rook", name: loc("field.strongholdValue"), value: strongholdValue?.total ?? 0, more: (strongholdValue?.unknown ?? 0) > 0, tab: "holdings" }),
    ],
    month: [
      cell({ key: "revenue", icon: "fa-solid fa-coins", name: loc("field.totalRevenue"), value: ledger?.totals?.revenue, partial, partialNote, tab: "ledger" }),
      cell({ key: "expenses", icon: "fa-solid fa-hand-holding-dollar", name: loc("field.totalExpenses"), value: ledger?.totals?.expenses, partial, partialNote, tab: "ledger" }),
      cell({ key: "income", icon: "fa-solid fa-scale-balanced", name: loc("field.income"), value: ledger?.totals?.income, partial, partialNote, tab: "ledger" }),
    ],
  };
}

/**
 * The two chips: who rules the domain and whom it answers to. Each names the
 * actor where there is one (a press opens its sheet, struck through where it
 * is gone), else the record's own word for it, else that there is none. Each
 * takes a drop (`zone`) and, for the Judge, a picker and a clear.
 * @param {object} input
 * @param {{uuid: string, name: string, missing: boolean}|null} input.ruler
 * @param {string} input.rulerName the record's word for a ruler with no actor
 * @param {{uuid: string, name: string, missing: boolean}|null} input.liege
 * @param {string} input.liegeName
 * @param {boolean} input.canEdit
 * @returns {{ruler: object, liege: object}}
 */
export function chipsOf({ ruler, rulerName = "", liege, liegeName = "", canEdit = false }, loc) {
  const chip = ({ zone, icon, role, ref, word, none, pick, pickLabel, clear }) => ({
    zone,
    icon,
    role,
    name: ref?.name || word || none,
    uuid: ref?.uuid ?? "",
    missing: !!ref?.missing,
    empty: !ref && !word,
    pick: canEdit ? pick : null,
    pickLabel,
    clear: canEdit && ref ? clear : null,
  });
  return {
    ruler: chip({ zone: "ruler", icon: "fa-solid fa-crown", role: loc("field.ruler"), ref: ruler, word: rulerName, none: loc("frame.noRuler"), pick: "pickRuler", pickLabel: loc("frame.pickRuler"), clear: "clearRuler" }),
    liege: chip({ zone: "liege", icon: "fa-solid fa-sitemap", role: loc("field.liege"), ref: liege, word: liegeName, none: loc("frame.noLiege"), pick: "pickLiege", pickLabel: loc("frame.pickLiege"), clear: "clearLiege" }),
  };
}

/** The classification and alignment tags; a blank reads as unclassified, or as the ruler's. */
export function tagsOf({ classification = "", alignment = "" }, loc) {
  return [
    { key: "classification", label: classification ? loc(`classification.${classification}`) : loc("frame.unclassified"), unset: !classification },
    { key: "alignment", label: alignment ? loc(`alignment.${alignment}`) : loc("frame.rulersAlignment"), unset: !alignment },
  ];
}

/**
 * What the rails' figures leave out, in words, one line per figure that does:
 * the settlements, the territory rows and the structures with no figure, and
 * the ledger's unset and unknown lines. Empty when every figure is whole.
 * @returns {Array<{key: string, name: string, note: string}>}
 */
export function leftOutOf({ families, hexCount, strongholdValue, ledger, partialNote = "" }, loc) {
  const rows = [];
  const n = (v) => Number(v) || 0;
  if (n(families?.urbanUnknown)) rows.push({ key: "urban", name: loc("field.urbanFamilies"), note: loc("sheet.urbanUnknown", { n: n(families.urbanUnknown) }) });
  if (n(hexCount?.unknown)) rows.push({ key: "hexes", name: loc("field.hexes"), note: loc("sheet.hexesUnknown", { n: n(hexCount.unknown) }) });
  if (n(strongholdValue?.unknown)) rows.push({ key: "stronghold", name: loc("field.strongholdValue"), note: loc("frame.costsUnknown", { n: n(strongholdValue.unknown) }) });
  if (ledger?.partial) rows.push({ key: "ledger", name: loc("field.income"), note: partialNote });
  return rows;
}

/**
 * The frame's whole context, built once per render. `chipList` and
 * `railList` are the chips and the rails in the order the art row draws them.
 * @returns {{chips: object, tags: object[], rails: {land: object[], month: object[]}, chipList: object[],
 *   railList: object[][], leftOut: object[]}}
 */
export function buildDomainFrame(input, loc) {
  const chips = chipsOf(input, loc);
  const rails = railsOf(input, loc);
  return {
    chips,
    tags: tagsOf(input, loc),
    rails,
    chipList: [chips.ruler, chips.liege],
    railList: [rails.land, rails.month],
    leftOut: leftOutOf(input, loc),
  };
}
