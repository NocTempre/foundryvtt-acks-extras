/**
 * The shelf rows of the Books tab, as data and as markup.
 *
 * `shelfRowView` turns one shelved book and its saved-text status
 * (`book-text.mjs`) into what a row says: a chip, a state line, a tooltip for
 * each figure, the controls this seat is offered and a progress bar while a
 * read runs. `shelfRowHtml` writes that as markup, escaping every string
 * itself, so a view holds raw text. Both are pure: the strings come through an
 * injected `L(key, data)`, so the suite drives them with no Foundry.
 *
 * A seat that is not a GM sees the state the journal holds and nothing a check
 * of the file would add: no Refused, no Reading, no control. A book the Judge
 * has not shared with it shows the withheld line and no state.
 */
import { TEXT_STATES, refusalKind, rowActions } from "./book-text.mjs";

/** The schema and pdf.js version a stamp names (`p<schema>-<version>`); the whole stamp as the version when it has another shape. */
export function readerOf(stamp) {
  const m = /^p(\d+)-(.+)$/.exec(String(stamp ?? ""));
  return m ? { schema: m[1], version: m[2] } : { schema: "?", version: String(stamp ?? "?") };
}

const number = (n) => (typeof n === "number" ? n.toLocaleString("en-US") : String(n ?? ""));

/**
 * The chip, state line and tooltip a state is drawn with.
 *
 * @param {object} o
 * @param {object} o.status a `textState` result, widened by `rowActions`
 * @param {boolean} o.isGM
 * @param {string} o.fileName the staged file's name, for a tooltip that names it
 * @param {function(string, object=): string} o.L
 * @returns {{kind: string, chip: string, line: string, tip: string}|null}
 */
function drawing({ status, isGM, fileName, L }) {
  // A seat that checks no file shows what the journal holds, never a refusal or a run.
  const state = isGM ? status.state : status.base;
  const pointer = status.pointer;
  const reader = (stamp) => {
    const r = readerOf(stamp);
    return L("textReader", { schema: r.schema, version: r.version });
  };
  switch (state) {
    case TEXT_STATES.PREPARED:
      return {
        kind: "prepared",
        chip: L("textChipPrepared"),
        line: L("textLinePrepared"),
        tip: L("textTipPrepared", {
          file: pointer.file,
          src: pointer.src,
          reader: reader(pointer.stamp),
          pages: L("textPages", { count: number(pointer.numPages) }),
        }),
      };
    case TEXT_STATES.STALE: {
      const line = { reader: "textLineStaleReader", file: "textLineStaleFile", pointer: "textLineStalePointer" }[status.cause];
      const tip =
        status.cause === "reader"
          ? L("textTipStaleReader", { was: reader(pointer.stamp), now: reader(status.stamp) })
          : status.cause === "file"
            ? L("textTipStaleFile", { was: pointer.src, now: status.src })
            : L("textTipStalePointer");
      return { kind: "stale", chip: L("textChipStale"), line: L(line), tip };
    }
    case TEXT_STATES.NONE:
      return { kind: "none", chip: L("textChipNone"), line: L("textLineNone"), tip: L("textTipNone") };
    case TEXT_STATES.REFUSED: {
      const kind = refusalKind(status.refusal);
      const err = status.refusal;
      const tip =
        kind === "size"
          ? L("textTipRefusedSize", { name: fileName, length: number(err.length), bytes: number(err.bytes) })
          : kind === "gone"
            ? L("textTipRefusedGone", { name: fileName, status: String(err.status ?? "") })
            : kind === "wrong"
              ? L("textTipRefusedWrong", { name: fileName })
              : L("textTipRefusedOther", { name: fileName });
      const line = kind === "gone" ? "textLineRefusedGone" : kind === "other" ? "textLineRefusedOther" : "textLineRefused";
      return { kind: "refused", chip: L("textChipRefused"), line: L(line), tip };
    }
    default:
      return null;
  }
}

/**
 * One shelf row, as data.
 *
 * @param {object} o
 * @param {string} o.bookId
 * @param {string} o.label the book's name
 * @param {string} o.fileName the staged file's name
 * @param {boolean} o.shared whether this seat may read the book (the Judge shared its journal, or it is a GM)
 * @param {string|null} o.journalId the shelf journal this seat can open, or null
 * @param {object} o.status a `textState` result
 * @param {boolean} o.isGM
 * @param {function(string, object=): string} o.L
 */
export function shelfRowView({ bookId, label, fileName, shared, journalId, status, isGM, L }) {
  const draw = shared ? drawing({ status, isGM, fileName, L }) : null;
  const reading = isGM && !!status.reading;
  const acts = rowActions({ state: isGM ? status.state : null, reading, isGM });
  const refused = draw?.kind === "refused";
  const read = acts.read
    ? {
        text: L(reading ? "textReading" : acts.read === "now" ? "textReadNow" : "textReadAgain"),
        aria: L("textReadAria", { action: L(acts.read === "now" ? "textReadNow" : "textReadAgain"), book: label }),
        disabled: acts.readDisabled,
        tip: L("textTipRead"),
      }
    : null;
  let chip = draw && { kind: draw.kind, text: draw.chip, tip: draw.tip };
  let line = draw?.line ?? null;
  let progress = null;
  if (reading) {
    const p = status.progress;
    chip = { kind: "reading", text: L("textChipReading"), tip: L(p ? "textTipReadingTotal" : "textTipReading", { total: number(p?.total) }) };
    line = p ? L("textLineReading", { page: number(p.page), total: number(p.total) }) : L("textLineReadingStart");
    if (p) progress = { page: p.page, total: p.total, tip: chip.tip, label: L("textBarLabel") };
  }
  return {
    bookId,
    label,
    state: reading ? "reading" : (draw?.kind ?? null),
    fileLine: L(shared ? "shelfHeld" : "shelfWithheld", { name: fileName }),
    chip,
    line,
    progress,
    open: journalId && !refused ? journalId : null,
    read,
    remove: acts.remove ? { disabled: acts.removeDisabled } : null,
  };
}

/** Markup for one shelf row; every string is escaped here. */
export function shelfRowHtml(view, { esc, L }) {
  const chip = view.chip
    ? `<span class="acks-tag ${CHIP_CLASS[view.chip.kind]}" data-text-chip data-tooltip-text="${esc(view.chip.tip)}">${esc(view.chip.text)}</span>`
    : "";
  const buttons = [
    view.open
      ? `<button type="button" class="acks-btn acks-btn--secondary acks-btn--sm" data-shelf-open="${esc(view.open)}">${esc(L("shelfOpen"))}</button>`
      : "",
    view.read
      ? `<button type="button" class="acks-btn acks-btn--secondary acks-btn--sm" data-shelf-read="${esc(view.bookId)}" aria-label="${esc(view.read.aria)}" data-tooltip-text="${esc(view.read.tip)}"${view.read.disabled ? " disabled" : ""}>${esc(view.read.text)}</button>`
      : "",
    view.remove
      ? `<button type="button" class="acks-btn acks-btn--quiet acks-btn--sm" data-unshelve="${esc(view.bookId)}"${view.remove.disabled ? " disabled" : ""}>${esc(L("shelfRemove"))}</button>`
      : "",
  ].join("");
  const bar = view.progress
    ? `<div class="acks-extras-importer-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${esc(view.progress.total)}" aria-valuenow="${esc(view.progress.page)}" aria-label="${esc(view.progress.label)}" data-text-bar data-tooltip-text="${esc(view.progress.tip)}"><i style="width:${Math.round((100 * view.progress.page) / Math.max(1, view.progress.total))}%"></i></div>`
    : "";
  return `<div class="acks-extras-importer-reconnect-row acks-extras-importer-shelf-row" data-shelf-row="${esc(view.bookId)}"${view.state ? ` data-text-state="${esc(view.state)}"` : ""}>
        <div class="acks-extras-importer-reconnect-head">
          <strong>${esc(view.label)}</strong>${chip}${buttons ? `<span class="acks-extras-importer-shelf-acts">${buttons}</span>` : ""}
        </div>
        <p class="notes" data-shelf-status="${esc(view.bookId)}">${esc(view.fileLine)}</p>${view.line ? `
        <p class="notes acks-extras-importer-text-state" data-text-line="${esc(view.bookId)}">${esc(view.line)}</p>` : ""}${bar}
      </div>`;
}

const CHIP_CLASS = {
  prepared: "acks-tag--solid",
  stale: "acks-extras-importer-tag-stale",
  none: "acks-tag--ghost",
  reading: "",
  refused: "acks-tag--danger",
};

/**
 * The summary of the folded shelf: the count, and how many books are stale or
 * refused when any are. Each figure carries a tooltip, and nothing in it is a control.
 *
 * @param {object} o
 * @param {number} o.count books staged
 * @param {{stale: number, refused: number}} o.tally
 */
export function foldSummaryHtml({ count, tally, esc, L }) {
  const part = (text, tip) => `<span data-tooltip-text="${esc(tip)}">${esc(text)}</span>`;
  const parts = [part(L("shelfCount", { count }), L("shelfCountTip", { folder: L("shelfFolder") }))];
  if (tally.stale) parts.push(part(L("textCountStale", { count: tally.stale }), L("textCountStaleTip")));
  if (tally.refused) parts.push(part(L("textCountRefused", { count: tally.refused }), L("textCountRefusedTip")));
  return parts.join(" · ");
}
