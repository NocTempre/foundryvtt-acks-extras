/**
 * Interface text, and a comment, that names a macro the pack stopped holding.
 *
 * Reads the text the module shows a Judge: each string value of the language
 * files `module.json` declares, each string expression under `scripts/`, and
 * each string field of each document the pack build makes. Reads each comment
 * under `scripts/` as well. Which names are retired, and where a text writes
 * one, are the docs sync's to say (`docs/site/tools/`). Here a name is a
 * mention only where it stands as words of its own in a text that says more
 * than the name. See docs/DECISIONS.md, "23. Interface text and comments name
 * a macro only while the pack holds it (2026-10-06)".
 *
 * A script's strings and comments come from a parse, by the acorn Node
 * bundles, which needs `--expose-internals` as `free-variables.mjs` does:
 *
 *   node --expose-internals tools/validate-macro-names.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { extractPacks, isFolder } from "../docs/site/tools/extract-packs.mjs";
import { macroNameHistory } from "../docs/site/tools/macro-names.mjs";
import { findRetiredNames } from "../docs/site/tools/pack-names.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let acorn;
try {
  acorn = createRequire(import.meta.url)("internal/deps/acorn/acorn/dist/acorn");
} catch (err) {
  console.error(`validate-macro-names: cannot reach Node's bundled acorn — ${String(err?.message ?? err).split("\n")[0]}`);
  console.error("validate-macro-names: run with --expose-internals, or add acorn as a devDependency; this gate does not skip.");
  process.exit(2);
}

/** What stands in a string expression's text where a template interpolates a value. */
const GAP = "\u0001";

/** What sets two texts apart in one search: no name holds it, and no run of whitespace crosses it. */
const DIVIDER = "\n\u0000\n";

/** In a comment, the phrase quoted straight after the name of a DECISIONS.md: a decision cited by its heading. */
const CITED = /DECISIONS\.md`?,\s+"[^"]*"/g;

/**
 * The string expressions and the comments of one JavaScript source.
 *
 * A string expression is a literal or a template, or several joined by `+`,
 * as the text it evaluates to. An interpolation is one `GAP`, and a string
 * inside one is an expression of its own. A comment is a block without the
 * stars that open its lines, or a run of line comments on consecutive lines.
 * A cited heading is blanked in it, so a name the heading holds is not read.
 *
 * @param {string} source
 * @returns {{strings: {line: number, text: string}[], comments: {line: number, text: string}[]}}
 *   `line` is where the expression or the comment opens
 */
export function textsOf(source) {
  const tokens = [];
  const marks = [];
  acorn.parse(source, {
    ecmaVersion: "latest",
    sourceType: "module",
    locations: true,
    allowHashBang: true,
    allowAwaitOutsideFunction: true,
    onToken: tokens,
    onComment: (block, text, start, end, from, to) => marks.push({ block, text, start, end, line: from.line, last: to.line }),
  });
  const kind = (i) => tokens[i]?.type.label;
  const opens = (i) => kind(i) === "string" || kind(i) === "`";
  const strings = [];

  /** The text of the literal or template at `i`, and the token after it. */
  function literal(i) {
    if (kind(i) === "string") return { text: tokens[i].value, next: i + 1 };
    let text = "";
    let j = i + 1;
    while (kind(j) !== "`") {
      if (kind(j) === "template") text += tokens[j++].value ?? "";
      else if (kind(j) === "${") {
        text += GAP;
        j = interpolation(j + 1);
      } else throw new Error(`a template holds a token it should not (${kind(j)})`);
    }
    return { text, next: j + 1 };
  }

  /** From just inside a `${`, the token after its closing brace. */
  function interpolation(j) {
    for (let depth = 1; depth; ) {
      if (j >= tokens.length) throw new Error("an interpolation does not close");
      if (opens(j)) j = expression(j);
      else {
        if (kind(j) === "{" || kind(j) === "${") depth++;
        else if (kind(j) === "}") depth--;
        j++;
      }
    }
    return j;
  }

  /** Reads the expression that opens at `i` into `strings`, and returns the token after it. */
  function expression(i) {
    const line = tokens[i].loc.start.line;
    let { text, next } = literal(i);
    while (kind(next) === "+/-" && tokens[next].value === "+" && opens(next + 1)) {
      const more = literal(next + 1);
      text += more.text;
      next = more.next;
    }
    strings.push({ line, text });
    return next;
  }

  for (let i = 0; i < tokens.length; ) i = opens(i) ? expression(i) : i + 1;

  const comments = [];
  let run = null;
  for (const mark of marks) {
    // A line comment on the line after the last one, with nothing between, continues it.
    if (!mark.block && run && mark.line === run.last + 1 && !source.slice(run.end, mark.start).trim()) {
      run.text += "\n" + mark.text;
      run.last = mark.last;
      run.end = mark.end;
      continue;
    }
    const comment = { line: mark.line, text: mark.block ? mark.text.replace(/^[ \t]*\*+ ?/gm, "") : mark.text, last: mark.last, end: mark.end };
    comments.push(comment);
    run = mark.block ? null : comment;
  }
  return {
    strings,
    comments: comments.map(({ line, text }) => ({ line, text: text.replace(CITED, (cited) => cited.replace(/[^\n]/g, " ")) })),
  };
}

/**
 * The words of `text`: its runs of letters and digits. A `{placeholder}` and
 * an interpolation stand for a value and are not words.
 */
const words = (text) => text.replace(/\{\w+\}/g, " ").replaceAll(GAP, " ").match(/[\p{L}\p{N}]+/gu) ?? [];

/** Whether `run` stands in `list` as consecutive entries. */
const holdsRun = (list, run) => list.some((_, i) => run.every((word, j) => list[i + j] === word));

/**
 * Each mention of a retired macro in `texts`.
 *
 * A retired name is found whole or without its trailing parenthetical, as the
 * docs sync finds it. It is a mention where it stands as words of its own,
 * which a name inside an identifier or a key does not, in a text that has
 * other words, which a title does not.
 *
 * @param {string[]} texts
 * @param {string[]} held the names of the macros the pack holds now
 * @param {string[]} retired the names it held once and no longer
 * @returns {{index: number, label: string, name: string}[]} `index` is the
 *   text's place in `texts`, `label` the retired name, `name` the form found
 */
export function mentions(texts, held, retired) {
  // One search over every text: the line a hit opens on says which text holds it.
  const starts = [];
  let line = 1;
  for (const text of texts) {
    starts.push(line);
    line += text.split("\n").length + 1;
  }
  const found = [];
  for (const hit of findRetiredNames(texts.join(DIVIDER), held, retired)) {
    const index = starts.findLastIndex((start) => start <= hit.line);
    const all = words(texts[index]);
    const own = words(hit.name);
    if (holdsRun(all, own) && all.length > own.length) found.push({ index, label: hit.label, name: hit.name });
  }
  return found;
}

/** Each string under `node`, with the dotted path to it. */
function leaves(node, at = "", out = []) {
  if (typeof node === "string") out.push({ at, text: node });
  else if (node && typeof node === "object") for (const [key, value] of Object.entries(node)) leaves(value, at ? `${at}.${key}` : key, out);
  return out;
}

/** Every script under `dir`, in a fixed order. */
function scriptsUnder(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) scriptsUnder(full, out);
    else if (/\.m?js$/.test(entry.name)) out.push(full);
  }
  return out;
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const rel = (file) => path.relative(ROOT, file).split(path.sep).join("/");
  const count = (n, noun) => `${n} ${noun}${n === 1 ? "" : "s"}`;

  // The name history is git's, and a shallow checkout or a tree outside git has none.
  const history = macroNameHistory();
  if (!history || history.shallow) {
    const why = history ? "this checkout is shallow, and the macro pack source's history is what names a retired macro" : "git could not read the macro pack source's history";
    console.log(`  note: macro names in interface text and comments were not checked: ${why}`);
    process.exit(0);
  }

  const units = [];
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "module.json"), "utf8"));
  for (const { path: file } of manifest.languages ?? []) {
    for (const { at, text } of leaves(JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8")))) units.push({ where: `${file} "${at}"`, text });
  }
  const values = units.length;

  const scripts = scriptsUnder(path.join(ROOT, "scripts"));
  let expressions = 0;
  let comments = 0;
  for (const file of scripts) {
    let texts;
    try {
      texts = textsOf(fs.readFileSync(file, "utf8"));
    } catch (err) {
      console.error(`validate-macro-names: cannot read the strings of ${rel(file)} — ${err.message}; this gate does not skip.`);
      process.exit(2);
    }
    for (const { line, text } of texts.strings) units.push({ where: `${rel(file)}:${line}`, text });
    for (const { line, text } of texts.comments) units.push({ where: `${rel(file)}:${line} (comment)`, text });
    expressions += texts.strings.length;
    comments += texts.comments.length;
  }

  const { packs } = await import("./pack-data.mjs");
  for (const [pack, build] of Object.entries(packs)) {
    for (const doc of build()) {
      if (isFolder(doc)) continue;
      for (const { at, text } of leaves(doc)) units.push({ where: `the ${pack} pack's "${doc.name}", ${at}`, text });
    }
  }
  const fields = units.length - values - expressions - comments;

  const held = (await extractPacks()).filter((pack) => pack.type === "Macro").flatMap((pack) => pack.documents.map((doc) => doc.name));
  const retired = [...history.names.keys()].filter((name) => !held.includes(name));
  const found = mentions(units.map((unit) => unit.text), held, retired);

  for (const { index, label, name } of found) {
    const dropped = history.names.get(label);
    console.error(`  FAIL: ${units[index].where} names "${name}", a macro the pack no longer holds (${dropped ? `dropped in ${dropped}` : "dropped in the working tree"})`);
  }
  if (found.length) {
    console.error(`\nvalidate-macro-names: ${count(found.length, "mention")} of a retired macro in interface text and comments`);
    process.exit(1);
  }
  console.log(
    `  ok: no retired macro is named in ${count(values, "language string")}, ${count(expressions, "string expression")} and ${count(comments, "comment")} in ${count(scripts.length, "script")} ` +
      `or ${count(fields, "pack document field")} (${count(retired.length, "retired name")} looked for)`,
  );
}
