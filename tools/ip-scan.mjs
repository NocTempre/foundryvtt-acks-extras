/**
 * IP leak scan — the family-wide gate that stands between licensed book
 * material and a public release. Synced from acks-module-template; do not
 * hand-edit. Runs from tools/validate.mjs (so it gates every `npm run
 * validate`, and therefore every release) and again in CI against the
 * *unpacked module.zip*, so the thing actually being published is what gets
 * checked — not just the working tree.
 *
 * Usage:
 *   node tools/ip-scan.mjs [dir]     scan dir (default: repo root)
 *   node tools/ip-scan.mjs --strict  treat prose warnings as failures too
 *
 * Design note: this file deliberately contains NO book text. It cannot match
 * "known passages" — storing them here would itself be the leak. It works on
 * structural signals instead: files that are supposed to be local-only,
 * pipeline artifacts that are supposed to stay untracked, and copyright
 * boilerplate showing up inside data files (where authored content lives).
 *
 * What it deliberately does NOT flag is a page reference. A citation
 * reproduces nothing and points at the reader's own copy, so it ships
 * everywhere — `.claude/rules/ip-doctrine.md` is the ruling. That leaves the
 * two rules that matter with no mechanism at all: the book's sentences and
 * the book's numbers both need a REVIEWER, and no green run here is evidence
 * about either.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const CLI = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
const ROOT = path.resolve(process.argv.find((a) => !a.startsWith("--") && a !== process.argv[0] && a !== process.argv[1]) ?? ".");
const STRICT = process.argv.includes("--strict");

/* Canonical rules extracts are LOCAL-ONLY (C:\Proj\acks-rules\<module-id>\).
 * They were purged from every repo history 2026-07-16 and must never return. */
const FORBIDDEN_FILES = [/^RULES\.md$/iu, /^PROFICIENCIES\.md$/iu, /Reactions-Reference\.md$/iu];
/* Extraction-pipeline state: holds raw fragments lifted from the user's PDFs.
 * `ruledata/` earns its place here the hard way: acks-henchmen shipped its book
 * tables as ruledata/*.json publicly, in every release zip since v0.1.0, until
 * the 2026-07-19 audit. Nothing loads it any more, no repo tracks it, and the
 * doctrine is that no book-read value ships in any repo — so a tracked
 * ruledata/ is a mistake, not a judgement call. Note the value signals there
 * were table rows and name lists, all individually short: no prose-length rule
 * would ever have caught them, which is why this is a path ban. */
const FORBIDDEN_PATHS = [/(^|[/\\])_proposals([/\\]|$)/u, /(^|[/\\])_manifest([/\\]|$)/u, /(^|[/\\])_ledger\.json$/u, /(^|[/\\])acks-rules([/\\]|$)/u, /(^|[/\\])ruledata([/\\]|$)/u];
/* A COPYRIGHT NOTICE inside machine data. Naming the book or its publisher is
 * a reference and is welcome anywhere; a reservation-of-rights line is not one
 * — nobody types "all rights reserved" to cite a page — so in a pack source or
 * a cookbook it means a page footer travelled in with the text above it. */
const ATTRIBUTION = /all rights reserved|(?:©|\(c\)|copyright)\s*(?:\d{4}[\s,–—-]*)*autarch/iu;
/* There is no CITATION signal, and its absence is a ruling rather than a gap.
 * One lived here from 2026-08-15 to 2026-09-03 and failed the build on a book
 * sigil beside a page number in lang, a template or a pack source. It was
 * built on the premise that the only reason to cite a page in a string a
 * player reads is that the sentence around it came off that page — which
 * inverts the harm. A citation is the one thing in a shipped string that
 * cannot substitute for the book, because it only pays out to a reader who
 * has one. Removing it does not remove the paraphrase it sat beside; it just
 * makes the paraphrase unattributed, which is what the rule's first full
 * application actually produced (extras 6.3.0, 22 strings). */
const DATA_GLOBS = [/packs[/\\]_source[/\\].*\.json$/u, /^cookbook[/\\].*\.json$/u, /^register[/\\].*\.json$/u, /^lang[/\\].*\.json$/u];
/* Handlebars is shipped text too, and is not JSON-walkable. */
const TEMPLATE_GLOBS = [/^templates[/\\].*\.hbs$/u];
/* Source is not JSON-walkable, but book text hides in it just as well: a
 * private sibling module keeps ~1,400 words of another publisher's rules in
 * scripts/rules-data.mjs. Scanned as raw text for the same two signals.
 *
 * scripts/ AND tools/ — tools/ never ships, but it is tracked and public, and
 * generated packs/_source only covers pack-data's OUTPUT: a block of book
 * prose in a tools comment reaches GitHub without ever reaching a pack. Only
 * this file itself is excluded (it must name the ATTRIBUTION signal to scan
 * for it). vendor/ is excluded for the opposite reason: third-party bundles
 * carry their own licence headers, and a gate that flags those on every run
 * is a gate people mute. docs/ (also tracked and public) stays out because it
 * is legitimate prose — the PROSE_CHARS signal would fire on every guide; its
 * IP bar is the human one TOOLCHAIN §4b sets for guides. */
const CODE_GLOBS = [/^scripts[/\\].*\.mjs$/u, /^tools[/\\].*\.mjs$/u];
const CODE_SELF_EXCLUDE = /^tools[/\\]ip-scan\.mjs$/u;
/* Quoted and templated literals found by pairing quote marks alone. Blind to
 * comments and regex literals, so a backtick in either opens a "literal" that
 * runs to the next backtick anywhere in the file. Used only on a file
 * sourceLiterals() loses its place in: there, over-reporting is the safe
 * failure, and a file the tokenizer cannot read never goes unmeasured. */
const STRING_LITERAL = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/gu;
/* After these words a `/` opens a regex literal; after any other word it divides. */
const REGEX_AFTER_WORD = new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await"]);
/* A `)` closing the head of one of these is followed by a statement, so a `/`
 * after it opens a regex: `if (ok) /x/.test(s)`. After any other `)` it divides. */
const HEAD_KEYWORDS = new Set(["if", "while", "for", "with"]);
const IDENT_START = /[\p{ID_Start}$_\\]/u;
const IDENT_PART = /[\p{ID_Continue}$\p{Join_Control}\\]/u;
const LINE_END = /[\n\r\p{Zl}\p{Zp}]/gu;
const IS_LINE_END = /^[\n\r\p{Zl}\p{Zp}]$/u;
const SPACE = /\s/u;
const DIGIT = /\d/u;
const NUMBER_PART = /[\w.]/u;
const CLOSER = new Map([["(", ")"], ["[", "]"], ["{", "}"]]);
/* A string leaf this long in a data file is a paragraph, not a label. */
const PROSE_CHARS = 1500;
/* ...unless it is source code. Macro bodies are authored JS and legitimately
 * long; letting them warn every run is how a gate gets tuned out. */
const CODE_KEYS = new Set(["command"]);

const SKIP_DIRS = new Set(["node_modules", ".git", ".github", "dist"]);
const errors = [];
const warnings = [];

/**
 * Two scan modes, and the difference is the whole point:
 *
 *  - A git work tree is scanned via `git ls-files` — TRACKED files only. An
 *    ignored, untracked file is not in the repo and never reaches the remote;
 *    the extraction pipeline relies on exactly that to keep raw PDF fragments
 *    on the local disk. Flagging those would be crying wolf. Force-add one,
 *    though, and it becomes tracked — and this catches it.
 *  - Anything else (notably the unpacked module.zip) is walked in full: if it
 *    is in the artifact, it ships, and nothing gets a pass.
 */
function trackedFiles(dir) {
  try {
    const out = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return out.split("\0").filter(Boolean);
  } catch {
    return null; // not a git work tree — fall back to walking everything
  }
}

function walk(dir, rel = "") {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const relPath = rel ? path.join(rel, entry.name) : entry.name;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (FORBIDDEN_PATHS.some((re) => re.test(relPath))) {
        errors.push(`${relPath}/ — extraction-pipeline state must never ship or be committed`);
        continue;
      }
      walk(abs, relPath);
    } else {
      inspect(abs, relPath);
    }
  }
}

function inspect(abs, relPath) {
  if (FORBIDDEN_FILES.some((re) => re.test(path.basename(relPath)))) {
    errors.push(`${relPath} — LOCAL-ONLY rules extract; it belongs in C:\\Proj\\acks-rules\\, never in the repo`);
    return;
  }
  if (FORBIDDEN_PATHS.some((re) => re.test(relPath))) {
    errors.push(`${relPath} — extraction-pipeline state must never ship or be committed`);
    return;
  }
  if (CODE_GLOBS.some((re) => re.test(relPath)) && !CODE_SELF_EXCLUDE.test(relPath)) {
    if (!fs.existsSync(abs)) return; // tracked but deleted in the work tree
    scanSource(fs.readFileSync(abs, "utf8"), relPath);
    return;
  }
  if (TEMPLATE_GLOBS.some((re) => re.test(relPath))) {
    if (!fs.existsSync(abs)) return;
    // Scanned whole, comments included: a copyright footer is a paste artifact
    // wherever it landed, and a Handlebars comment is not a safer place to
    // have pasted a page into than the body.
    if (ATTRIBUTION.test(fs.readFileSync(abs, "utf8"))) {
      errors.push(`${relPath} — copyright notice in a shipped template; a page footer travelled in with the text`);
    }
    return;
  }
  if (!DATA_GLOBS.some((re) => re.test(relPath))) return;
  if (!fs.existsSync(abs)) return; // tracked but deleted in the work tree

  let data;
  try {
    data = JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch {
    return; // tools/validate.mjs already reports malformed JSON
  }
  scanStrings(data, relPath);
}

function scanSource(text, relPath) {
  if (ATTRIBUTION.test(text)) {
    errors.push(`${relPath} — publisher attribution in source; book text belongs in the reader's own PDF, not in a .mjs`);
  }
  const read = sourceLiterals(text);
  if (read.lost !== undefined) {
    warnings.push(`${relPath}: line ${lineOf(text, read.lost)}: the literal scan lost its place here, so this file's literals were measured by pairing quote marks, which reads a comment or regex between two quotes as a literal`);
  }
  const found = read.literals ?? [...text.matchAll(STRING_LITERAL)].map((m) => [m.index, m[0].length]);
  for (const [start, length] of found) {
    if (length > PROSE_CHARS) {
      warnings.push(`${relPath}: line ${lineOf(text, start)}: a ${length}-char string literal — verify this is authored, not transcribed`);
    }
  }
}

function lineOf(text, offset) {
  return text.slice(0, offset).split("\n").length;
}

/**
 * The string and template literals in a JavaScript source, read the way the
 * engine reads them rather than by pairing quote marks. Comments and regex
 * literals are consumed whole, so a quote or backtick inside one opens
 * nothing, and a template is followed through its `${}` holes and whatever
 * braces and literals they nest. Whether a `/` opens a regex is decided from
 * the token before it; one that meets a line end before its closing `/`
 * divided after all.
 *
 * Standalone on purpose: the pre-commit hook imports this file by relative
 * path (ip-quarantine.mjs), so anything it imported would be one more file
 * the hook fails without.
 *
 * @returns {{literals: Array<[number, number]>} | {lost: number}} `literals`
 *   holds each literal's start offset and length, delimiters included. A
 *   template's length is its own text: a `${}` hole is code, not literal
 *   content, and a literal nested in one is listed on its own. `lost` is the
 *   offset where the reading stopped making sense — a quoted string meeting a
 *   line end, a bracket closing the wrong opener, or a comment, template or
 *   bracket still open at the end of the file. Valid JavaScript produces none
 *   of those, so `lost` means a misjudged `/` or a file that does not parse.
 */
function sourceLiterals(src) {
  const literals = [];
  const open = []; // unclosed brackets and template holes, innermost last
  let regexOk = true; // a `/` here opens a regex literal
  let afterDot = false; // the next word is a property name, never a keyword
  let head = false; // the last word was one of HEAD_KEYWORDS
  let i = 0;
  const lineEnd = (from) => {
    LINE_END.lastIndex = from;
    return LINE_END.exec(src)?.index ?? src.length;
  };
  // Consumes template text from i through its closing backtick or its next
  // `${`; `text` is how much of the template's own text came before. False
  // when the file ends first.
  const templateText = (start, text) => {
    const from = i;
    while (i < src.length) {
      if (src[i] === "\\") i += 2;
      else if (src[i] === "`") {
        literals.push([start, text + (i - from) + 2]);
        i++;
        regexOk = false;
        return true;
      } else if (src[i] === "$" && src[i + 1] === "{") {
        open.push({ hole: true, start, text: text + (i - from), at: i });
        i += 2;
        regexOk = true;
        return true;
      } else i++;
    }
    return false;
  };
  // The offset past the flags of a regex literal opening at i, or -1 when a
  // line ends before its closing `/`.
  const regexEnd = () => {
    let inClass = false;
    for (let j = i + 1; j < src.length && !IS_LINE_END.test(src[j]); j++) {
      if (src[j] === "\\") {
        if (IS_LINE_END.test(src[j + 1] ?? "")) return -1;
        j++;
      } else if (src[j] === "[") inClass = true;
      else if (src[j] === "]") inClass = false;
      else if (src[j] === "/" && !inClass) {
        for (j++; j < src.length && IDENT_PART.test(src[j]); j++);
        return j;
      }
    }
    return -1;
  };

  if (src.startsWith("#!")) i = lineEnd(0);
  while (i < src.length) {
    const c = src[i];
    const at = i;
    if (SPACE.test(c)) {
      i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      i = lineEnd(i);
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const close = src.indexOf("*/", i + 2);
      if (close < 0) return { lost: at };
      i = close + 2;
      continue;
    }
    const regex = c === "/" && regexOk ? regexEnd() : -1;
    let word = "";
    let dot = false;
    if (c === '"' || c === "'") {
      for (i++; src[i] !== c; i++) {
        if (i >= src.length || src[i] === "\n" || src[i] === "\r") return { lost: at };
        if (src[i] === "\\") i += src.startsWith("\r\n", i + 1) ? 2 : 1;
      }
      i++;
      literals.push([at, i - at]);
      regexOk = false;
    } else if (c === "`") {
      i++;
      if (!templateText(at, 0)) return { lost: at };
    } else if (c === "}" && open.at(-1)?.hole) {
      const { start, text } = open.pop();
      i++;
      if (!templateText(start, text)) return { lost: start };
    } else if (regex > 0) {
      i = regex;
      regexOk = false;
    } else if (IDENT_START.test(c)) {
      do i++;
      while (i < src.length && IDENT_PART.test(src[i]));
      if (!afterDot) word = src.slice(at, i);
      regexOk = REGEX_AFTER_WORD.has(word);
    } else if (DIGIT.test(c) || (c === "." && DIGIT.test(src[i + 1] ?? ""))) {
      do i++;
      while (i < src.length && NUMBER_PART.test(src[i]));
      regexOk = false;
    } else if (src.startsWith("...", i)) {
      i += 3;
      regexOk = true;
    } else if ((c === "+" || c === "-") && src[i + 1] === c) {
      i += 2;
      regexOk = false; // x++ / y divides
    } else if (CLOSER.has(c)) {
      open.push({ closer: CLOSER.get(c), head: c === "(" && head, at });
      i++;
      regexOk = true;
    } else if (c === ")" || c === "]" || c === "}") {
      if (open.at(-1)?.closer !== c) return { lost: at };
      regexOk = open.pop().head;
      i++;
    } else {
      dot = c === ".";
      i++;
      regexOk = true;
    }
    afterDot = dot;
    head = HEAD_KEYWORDS.has(word);
  }
  return open.length ? { lost: open.at(-1).at } : { literals };
}

function scanStrings(node, relPath, keyPath = "") {
  if (typeof node === "string") {
    if (ATTRIBUTION.test(node)) {
      errors.push(`${relPath}: ${keyPath || "(root)"} contains a copyright notice — copied book text, not authored data`);
    } else if (node.length > PROSE_CHARS && !CODE_KEYS.has(keyPath)) {
      warnings.push(`${relPath}: ${keyPath || "(root)"} is ${node.length} chars — verify this is authored, not transcribed`);
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => scanStrings(v, relPath, `${keyPath}[${i}]`));
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) scanStrings(v, relPath, keyPath ? `${keyPath}.${k}` : k);
  }
}

/**
 * Scan an explicit list of repo-relative paths. tools/ip-quarantine.mjs uses
 * this against the *staged* set so a leak is caught before it enters a commit,
 * which is the only moment a .gitignore can still keep it out of history.
 */
export function scanPaths(root, relPaths) {
  errors.length = 0;
  warnings.length = 0;
  for (const relPath of relPaths) inspect(path.join(root, relPath), relPath);
  return { errors: [...errors], warnings: [...warnings] };
}

/*
 * Exit codes are a contract the release workflow depends on:
 *   0 — clean
 *   1 — a leak was found (a content verdict; CI quarantines the repo)
 *   2 — the scanner itself crashed (a tooling verdict; CI fails loud but must
 *       NOT quarantine — a Node quirk or missing file is not grounds to take a
 *       public repo private). Never let a crash masquerade as exit 1.
 */
if (CLI) {
  try {
    const tracked = trackedFiles(ROOT);
    if (tracked) {
      for (const relPath of tracked) inspect(path.join(ROOT, relPath), relPath);
    } else {
      walk(ROOT);
    }
  } catch (err) {
    console.error(`::error::ip-scan: tooling error, not a leak verdict — ${err?.stack || err}`);
    process.exit(2);
  }

  for (const w of warnings) console.warn(`  warn  ${w}`);
  for (const e of errors) console.error(`  LEAK  ${e}`);

  if (errors.length || (STRICT && warnings.length)) {
    console.error(`\nip-scan: FAILED — ${errors.length} leak(s), ${warnings.length} warning(s) in ${ROOT}`);
    process.exit(1);
  }
  console.log(`ip-scan: clean (${warnings.length} warning(s))`);
}
