/**
 * The Books tab's shelf rows, as data and as markup.
 *
 * `book-rows.mjs` draws one row per staged book from its saved-text status:
 * the chip, the state line, the tooltip of each figure, the controls the seat is
 * offered and the progress bar of a read that is running. This suite drives it
 * over states from the real `ParsedBooks`, with strings answered by a stub `L`
 * that echoes its key and data, so a row's wording is checked by key and every
 * figure in it by value. It also checks that every lang key the tab names
 * exists. Every book and file name in it is invented.
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { BookHandle } from "../../scripts/importer/book-handle.mjs";
import { ParsedBooks, PARSE_STAMP } from "../../scripts/importer/parsed-book.mjs";
import { foldSummaryHtml, readerOf, shelfRowHtml, shelfRowView } from "../../scripts/importer/book-rows.mjs";
import { tally, textState } from "../../scripts/importer/book-text.mjs";

let pass = 0;
const ok = (label, cond, detail = "") => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ""}`);
  pass++;
};
const same = (label, a, b) => {
  assert.deepStrictEqual(a, b, label);
  pass++;
};

/** A string stub: the key, and the data it was given as `key{a=1|b=2}`. */
const L = (key, data) => (data ? `${key}{${Object.entries(data).map(([k, v]) => `${k}=${v}`).join("|")}}` : key);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" })[c]);

/* --- a store over an invented shelf ---------------------------------------------------------- */

const SRC = "books/inv-one.pdf";
const journals = {
  one: { src: SRC, pointer: null },
  form: { src: null, pointer: null },
};
const pointer = (over = {}) => ({ stamp: PARSE_STAMP, file: "books/parsed/inv-one.json", src: SRC, bytes: 4096, numPages: 388, title: "Invented", ...over });
const store = (stamp) =>
  new ParsedBooks({
    isGM: () => true,
    srcOf: (id) => journals[id]?.src ?? null,
    pointerOf: (id) => journals[id]?.pointer ?? null,
    writePointer: async () => {},
    upload: async (name) => `books/parsed/${name}`,
    open: async () => ({}),
    attempt: () => "a",
    ...(stamp ? { stamp } : {}),
  });

const status = (over = {}, refusal = null) => ({ ...textState({ parsed: store(), bookId: "one", refusal }), ...over });
const row = (o = {}) =>
  shelfRowView({ bookId: "one", label: "Book <One>", fileName: "inv-one.pdf", shared: true, journalId: "j1", status: status(), isGM: true, L, ...o });
const html = (view) => shelfRowHtml(view, { esc, L });

/* --- the GM row in each state ---------------------------------------------------------------- */

{
  journals.one.pointer = null;
  const v = row();
  same("none: the chip, line and tip", [v.state, v.chip.text, v.line, v.chip.tip], ["none", "textChipNone", "textLineNone", "textTipNone"]);
  same("none: Open, Read now, Remove", [v.open, v.read.text, v.remove.disabled], ["j1", "textReadNow", false]);
  ok("the Read control is named by its book for a screen reader and carries a tooltip", v.read.aria === 'textReadAria{action=textReadNow|book=Book <One>}' && v.read.tip === "textTipRead");
  same("the file line names the staged file", v.fileLine, 'shelfHeld{name=inv-one.pdf}');
  const h = html(v);
  ok("the markup escapes the book's name", h.includes("Book &lt;One&gt;") && !h.includes("<One>"));
  ok("the chip class is ghost", /acks-tag acks-tag--ghost/.test(h));
}

{
  journals.one.pointer = pointer();
  const v = row();
  same("prepared: chip and line", [v.state, v.chip.text, v.line], ["prepared", "textChipPrepared", "textLinePrepared"]);
  ok("prepared: Read again", v.read.text === "textReadAgain");
  // Every figure of the tooltip comes from the journal's pointer.
  const tip = v.chip.tip;
  ok(
    "prepared: the tip names the saved file, the PDF it was read from, the reader and the page count",
    tip.includes('file=books/parsed/inv-one.json') && tip.includes(`src=${SRC}`) && tip.includes(`schema=${readerOf(PARSE_STAMP).schema}`) && tip.includes('count=388'),
    tip,
  );
  ok("prepared: the chip class is solid", /acks-tag acks-tag--solid/.test(html(v)));
}

{
  journals.one.pointer = pointer({ stamp: "p0-1.2.3" });
  const v = row();
  same("stale (reader): line and chip", [v.state, v.line], ["stale", "textLineStaleReader"]);
  ok("stale (reader): the tip names both readers", v.chip.tip.includes('schema=0') && v.chip.tip.includes('version=1.2.3') && v.chip.tip.includes(`version=${readerOf(PARSE_STAMP).version}`), v.chip.tip);
  ok("stale: Read again", v.read.text === "textReadAgain");
  ok("stale: its own chip class", html(v).includes("acks-extras-importer-tag-stale"));

  journals.one.pointer = pointer({ src: "books/inv-one-old.pdf" });
  const f = row();
  same("stale (file): line", f.line, "textLineStaleFile");
  ok("stale (file): the tip names both paths", f.chip.tip.includes('was=books/inv-one-old.pdf') && f.chip.tip.includes(`now=${SRC}`), f.chip.tip);

  journals.one.pointer = pointer({ numPages: 0 });
  same("stale (incomplete pointer): its own line", row().line, "textLineStalePointer");
}

{
  journals.one.pointer = pointer();
  const size = Object.assign(new Error("size"), { kind: "size", length: 61204113, bytes: 59880402 });
  const v = row({ status: status({}, size) });
  same("refused: chip, line and the one control", [v.state, v.chip.text, v.line, v.read, v.open, v.remove], ["refused", "textChipRefused", "textLineRefused", null, null, { disabled: false }]);
  ok("refused (size): the tip quotes the server's size and the staged size", v.chip.tip.includes('length=61,204,113') && v.chip.tip.includes('bytes=59,880,402'), v.chip.tip);
  const h = html(v);
  ok("refused: only Remove is drawn", h.includes("data-unshelve") && !h.includes("data-shelf-read") && !h.includes("data-shelf-open"));
  ok("refused: the chip class is danger", /acks-tag--danger/.test(h));

  const gone = row({ status: status({}, Object.assign(new Error("gone"), { kind: "gone", status: 404 })) });
  ok("refused (gone): its own line and tip", gone.line === "textLineRefusedGone" && gone.chip.tip.includes('status=404'));
  same("refused (wrong book): the generic line", row({ status: status({}, Object.assign(new Error("w"), { wrongBook: "x" })) }).line, "textLineRefused");
  same("refused (anything else): the could-not-be-checked line", row({ status: status({}, new Error("odd")) }).line, "textLineRefusedOther");
}

{
  journals.one.pointer = pointer();
  const v = row({ status: status({ reading: true, progress: { page: 212, total: 640 } }) });
  same("reading: chip, line, bar", [v.state, v.chip.text, v.line, v.progress.page, v.progress.total], ["reading", "textChipReading", 'textLineReading{page=212|total=640}', 212, 640]);
  same("reading: the button says so and is disabled, and so is Remove", [v.read.text, v.read.disabled, v.remove.disabled], ["textReading", true, true]);
  ok("reading: the tip carries the total", v.chip.tip.includes('total=640'));
  const h = html(v);
  ok("reading: a progressbar with its values and a name", /role="progressbar"[^>]*aria-valuemin="0"[^>]*aria-valuemax="640"[^>]*aria-valuenow="212"[^>]*aria-label="textBarLabel"/.test(h));
  ok("reading: the bar fills to the share read", h.includes("width:33%"));
  ok("reading: both buttons are disabled in the markup", (h.match(/ disabled>/g) ?? []).length === 2);

  const start = row({ status: status({ reading: true, progress: null }) });
  ok("reading before a page: the start line and no bar", start.line === "textLineReadingStart" && start.progress === null && !html(start).includes("progressbar"));
}

{
  journals.form.pointer = null;
  const v = row({ bookId: "form", status: textState({ parsed: store(), bookId: "form" }) });
  ok("a form: no chip, no state line, no Read, Remove for a GM", v.chip === null && v.line === null && v.read === null && v.remove !== null && v.state === null);
}

/* --- a seat that is not a GM ----------------------------------------------------------------- */

{
  journals.one.pointer = pointer();
  const refused = Object.assign(new Error("gone"), { kind: "gone", status: 404 });
  const v = row({ isGM: false, status: status({ reading: true, progress: { page: 1, total: 9 } }, refused) });
  same("a player sees what the journal holds: prepared, though a check refused the book and a run is on", [v.state, v.chip.text, v.line, v.progress], ["prepared", "textChipPrepared", "textLinePrepared", null]);
  ok("a player is offered no Read and no Remove, but Open where the journal is visible", v.read === null && v.remove === null && v.open === "j1");
  const h = html(v);
  ok("a player's markup holds no control but Open", !h.includes("data-shelf-read") && !h.includes("data-unshelve") && h.includes("data-shelf-open"));

  journals.one.pointer = null;
  same("a player sees Not read", row({ isGM: false }).chip.text, "textChipNone");

  const withheld = row({ isGM: false, shared: false, journalId: null });
  same("a book not shared shows the withheld line and no state", [withheld.fileLine, withheld.chip, withheld.line, withheld.state], ['shelfWithheld{name=inv-one.pdf}', null, null, null]);
  ok("and no control at all", !/<button/.test(html(withheld)));
}

/* --- the markup's contract ------------------------------------------------------------------- */

{
  journals.one.pointer = pointer();
  const h = html(row());
  ok("tooltips go through data-tooltip-text, never a title attribute", /data-tooltip-text="/.test(h) && !/\btitle=/.test(h));
  ok("no literal id in a row", !/\sid="/.test(h));
  ok("every button is a type=button", [...h.matchAll(/<button\b[^>]*>/g)].every((m) => /type="button"/.test(m[0])));
  ok("no inline type size", !/font-size/.test(h));
}

/* --- the fold's summary ---------------------------------------------------------------------- */

{
  const sum = (t) => foldSummaryHtml({ count: 6, tally: t, esc, L });
  const full = sum({ stale: 2, refused: 1 });
  ok("the closed fold names the count, the stale and the refused", full.includes('shelfCount{count=6}') && full.includes('textCountStale{count=2}') && full.includes('textCountRefused{count=1}'));
  ok("each count carries a tooltip", (full.match(/data-tooltip-text/g) ?? []).length === 3);
  ok("a zero count is left out", !sum({ stale: 0, refused: 1 }).includes("textCountStale") && !sum({ stale: 0, refused: 0 }).includes("textCountRefused"));
  ok("nothing in a summary is a control", !/<(button|a|input|select)\b/.test(full));
  same("the count of a shelf's states", tally([{ state: "stale" }, { state: "refused" }, { state: "prepared" }]), { stale: 1, refused: 1 });

  // The fold counts what the rows say for the seat: a withheld book's state is in no row, and a Player's row shows the base.
  journals.one.pointer = pointer({ stamp: "p0-other" });
  const stale = status();
  const seats = [
    { shared: true, status: stale },
    { shared: false, status: stale },
    { shared: true, status: { ...stale, state: "refused", base: "stale" } },
  ];
  for (const isGM of [true, false]) {
    const rows = seats.map((x) => row({ shared: x.shared, status: x.status, isGM }));
    const drawn = (state) => rows.filter((r) => r.state === state).length;
    same(`the fold's counts equal the rows drawn for a ${isGM ? "GM" : "Player"}`, tally(seats.map((x) => ({ ...x.status, shared: x.shared })), { isGM }), { stale: drawn("stale"), refused: drawn("refused") });
  }
}

/* --- every key the tab names exists ---------------------------------------------------------- */

{
  const lang = JSON.parse(readFileSync(new URL("../../lang/en.json", import.meta.url), "utf8"));
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  const keys = new Set();
  const rows = read("../../scripts/importer/book-rows.mjs");
  for (const m of rows.matchAll(/\bL\("([A-Za-z]+)"/g)) keys.add(m[1]);
  for (const m of rows.matchAll(/"((?:text|shelf)[A-Z][A-Za-z]*)"/g)) keys.add(m[1]);
  const mod = read("../../scripts/importer/module.mjs");
  for (const m of mod.matchAll(/\buiText\("([A-Za-z]+)"/g)) keys.add(m[1]);
  for (const m of mod.matchAll(/"(books(?:Waiting|OpenHead|AbsentHead)Tip)"/g)) keys.add(m[1]);
  for (const k of ["readFailed", "readFailedAgain", "readKept", "readWhyFetch", "readWhySave"]) keys.add(k);
  ok("the scan found the keys", keys.size > 30, String(keys.size));
  for (const key of keys) ok(`lang has ACKS-IMPORTER.ui.${key}`, typeof lang[`ACKS-IMPORTER.ui.${key}`] === "string");
  const note = lang["ACKS-IMPORTER.ui.statusNote"];
  ok("the status note no longer says the file is never stored, and no line says every launch", !/never stored/.test(note) && !/every launch/.test(lang["ACKS-IMPORTER.ui.shelfCount"] + lang["ACKS-IMPORTER.ui.shelfHeld"] + lang["ACKS-IMPORTER.ui.shelfEmpty"]));
}

/* --- a refusal drawn from a real handle ------------------------------------------------------ */

{
  journals.one.pointer = pointer();
  const parsed = store();
  const handle = new BookHandle({
    bookId: "one",
    src: SRC,
    open: async () => ({}),
    parsed,
    fetchImpl: async () => ({ ok: true, status: 200, headers: { get: (k) => (k === "content-length" ? "5000" : null) } }),
  });
  await assert.rejects(() => handle.getPage(1));
  pass++;
  const v = row({ status: textState({ parsed, bookId: "one", refusal: handle.refusal }) });
  ok("a HEAD that answers another size draws Refused with both sizes", v.state === "refused" && v.chip.tip.includes('length=5,000') && v.chip.tip.includes('bytes=4,096'), v.chip.tip);
}

console.log(`test-book-rows: ${pass} checks passed`);
