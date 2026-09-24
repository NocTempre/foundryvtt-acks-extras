/**
 * Canonical pre-release validation for ACKS module repos.
 * Synced from acks-module-template — edit there and run bin/sync-toolchain.mjs;
 * do not hand-edit per module. Pure-logic module tests belong in
 * tools/test-logic.mjs (run via `npm test`); a module that needs an extra
 * check to run as PART of validation (e.g. an IP-safety lint) drops a
 * tools/validate-extra.mjs — this validator auto-runs it (section 10), so
 * `npm run validate` stays the single canonical entry point everywhere.
 *
 * Checks (each section skips cleanly when the dir/file doesn't exist):
 *   1. JS syntax (node --check) of every .mjs under scripts/ and tools/.
 *   2. Handlebars compilation of every .hbs under templates/ (parse errors
 *      otherwise only surface at render time inside Foundry).
 *   2b. Handlebars helpers: every helper a template calls is one Foundry core
 *      registers (a list captured from a live server, versioned beside it) or
 *      one this module registers in scripts/. Compilation resolves no helper
 *      names, so a call to anything else compiles, passes every mocked test,
 *      and throws "Missing helper" on the window's first render.
 *   3. JSON validity: module.json, package.json, lang/*.json, ruledata/**
 *      (which must carry an `id`), packs/_source/**.
 *   4. Pack-source invariants: 16-char alphanumeric _id, _key ending in _id,
 *      no duplicate _id within a pack.
 *   5. module.json invariants: semver version, compatibility.minimum present,
 *      declared esmodules/scripts/styles/languages/packs paths exist (checked
 *      CASE-SENSITIVELY against the real directory entries, since existsSync
 *      follows the local filesystem's case rules and NTFS lets a mismatch
 *      pass locally that case-sensitive CI rejects), every
 *      relationships.requires entry carries a reason and
 *      compatibility.minimum, manifest/download point at
 *      releases/latest/download.
 *   6. i18n: every ACKS-family key referenced in scripts/templates/ruledata/
 *      tools exists in lang/en.json. Roots written as `${LANG_PREFIX}.x` are
 *      resolved from module-level string constants, following named imports;
 *      a root that stays unresolvable fails. A reference captured WHOLE (a
 *      quoted literal) must match a key exactly; only a reference truncated
 *      at an interpolation (`PREFIX.${value}`) is dynamic-suffix tolerant —
 *      exact literals shielded by a longer sibling (foo passing because
 *      fooHint exists) are the miss this distinction exists to catch. The
 *      count of keys actually checked is always printed.
 *   7. Namespacing (one form per registry, no legacy exceptions — the
 *      2026-07-15 migration brought every module into conformance):
 *      globalThis exposures, custom hooks, and Handlebars helpers start with
 *      the camelCased module id; lang keys with "<ID-UPPERCASED>."
 *      (Foundry-owned roots like TYPES.* allowlisted); top-level CSS classes
 *      with the module id; top-level pack _ids with the mandatory
 *      module.json `flags.<id>.idPrefix` short key. Global, hook and helper
 *      names are read where they are written — a global or hook name through
 *      the consts, object members and imports that carry it — and one that
 *      cannot be read fails; a hook call may state why with `hook-ok: <reason>`.
 *   8. The window contract: every window a module opens stays reachable,
 *      resizable, and legible at the user's chosen type size, and behaves when
 *      two copies of it are open at once — scroll-contract membership, dead
 *      scroll retention, a type size the size knob can't reach, interactive
 *      content nested inside <summary>, a <label> no runtime pass could ever
 *      rescue, and a literal id= that collides the moment a second copy of the
 *      sheet is open.
 *   9. IP leak scan (tools/ip-scan.mjs): local-only rules extracts, extraction
 *      pipeline state, and publisher attribution inside data files.
 *   10. Optional module-owned tools/validate-extra.mjs — run last if present;
 *      a non-zero exit fails validation.
 *
 * Usage:  npm run validate
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import Handlebars from "handlebars";

const ROOT = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));

/* Namespacing is enforced at the FAMILY level, not the module level (sections
 * 6, 7a, 7d). The job of these prefixes is to keep the family clear of core
 * Foundry and of the `acks` system; "acks-" does that completely. Pinning them
 * to the module id would additionally have prevented one acks-* module from
 * colliding with another — which stopped being a risk when the family merged
 * into single modules, and which in exchange would force every folded-in
 * feature's lang keys and CSS classes to be re-prefixed for no visible gain.
 * Feature-level roots (ACKS-EQUIPMENT.*, .acks-henchmen-row) stay as authored
 * and remain collision-proof by construction.
 *
 * 7b (pack _id prefix) and 7c (globals/hooks/helpers) are deliberately NOT
 * relaxed: 7b costs nothing since every existing prefix already starts "acks",
 * and 7c is what forbids a compat-alias global. */
const LANG_FAMILY = "ACKS-";
const CSS_FAMILY = "acks-";

let failed = false;
const fail = (file, message) => {
  console.error(`FAIL ${file}: ${message}`);
  failed = true;
};
const rel = (full) => path.relative(ROOT, full).replaceAll(path.sep, "/");

/* fs.existsSync follows the local filesystem's case rules — NTFS and APFS are
 * case-insensitive, so a declared path whose case mismatches the repo passes
 * on a dev machine and fails on case-sensitive CI. Verify each segment against
 * the parent directory's real entries instead. */
function existsExact(relPath) {
  let dir = ROOT;
  for (const segment of String(relPath).split(/[\\/]/)) {
    if (!segment || segment === ".") continue;
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return false;
    }
    if (!entries.includes(segment)) return false;
    dir = path.join(dir, segment);
  }
  return true;
}

/* null when relPath exists with exactly this case; otherwise the reason —
 * naming the case mismatch when the path exists only under different casing. */
function pathProblem(relPath) {
  if (existsExact(relPath)) return null;
  return fs.existsSync(path.join(ROOT, relPath))
    ? "exists only under a different case — case-sensitive CI will not find it"
    : "does not exist";
}

function walk(dir, cb) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, cb);
    else cb(full);
  }
}

// The file a relative import specifier names, or null for a bare or absolute
// one — those are not this module's files to walk.
function resolveSpecifier(fromFile, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  for (const candidate of [base, `${base}.mjs`, `${base}.js`, path.join(base, "index.mjs")]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/* 1. JS syntax of every script/tool module. */
for (const dir of ["scripts", "tools"]) {
  walk(path.join(ROOT, dir), (full) => {
    if (!full.endsWith(".mjs")) return;
    try {
      execFileSync(process.execPath, ["--check", full], { stdio: "pipe" });
    } catch (err) {
      fail(rel(full), String(err.stderr ?? err.message).trim().split("\n")[0]);
    }
  });
}

/* 2. Handlebars templates precompile. */
walk(path.join(ROOT, "templates"), (full) => {
  if (!full.endsWith(".hbs")) return;
  try {
    Handlebars.precompile(fs.readFileSync(full, "utf8"));
  } catch (err) {
    fail(rel(full), err.message.split("\n").slice(0, 2).join(" "));
  }
});

/* 2b. Every helper a template CALLS is registered by something that runs:
 *    Foundry core, or this module's own scripts/. A call is what Handlebars'
 *    compiler treats as one — a block, or a mustache or sub-expression given
 *    arguments — on a path that is one plain name: not a block param, not an
 *    @data variable. So a bare {{name}} (a property lookup) is never flagged,
 *    and a path such as this.format or a.b given arguments — a function held
 *    on the render context, which only a render can see — is counted and left
 *    alone.
 *
 *    A block with NO arguments is flagged like any other call. Handlebars runs
 *    it as a section over the context property of that name until a system or
 *    module registers a helper under that name, which then takes the block
 *    over, silently.
 *
 *    The game system's helpers are on neither list: a call to one fails as
 *    unknown, and its escape says whose helper it is. The template side is a
 *    parse (the handlebars package's own parser); the registration side is a
 *    source-text match (readHelperRegistrations). Escape:
 *    `{{!-- helper-ok: <reason> --}}` on or just above the call. */

/* The helpers Foundry core registers before any system or module loads:
 * Handlebars' built-ins, HandlebarsIntl's, and foundry.applications.handlebars
 * initialize()'s. Captured with Object.keys(Handlebars.helpers) on a live
 * server's /join page, the one page whose registry holds core and nothing
 * else (a world page adds the system's and every active module's). One build's
 * snapshot — a helper a later build drops keeps passing here and throws there,
 * so it is recaptured whenever `compatibility.verified` is raised (TOOLCHAIN
 * §5). */
const FOUNDRY_CORE_HELPERS = {
  version: "14.367",
  names: new Set([
    "and", "blockHelperMissing", "checked", "concat", "disabled", "each", "editor", "eq",
    "filePicker", "formField", "formGroup", "formInput", "formatDate", "formatHTMLMessage",
    "formatMessage", "formatNumber", "formatRelative", "formatTime", "gt", "gte", "helperMissing",
    "if", "ifThen", "intl", "intlDate", "intlGet", "intlHTMLMessage", "intlMessage", "intlNumber",
    "intlTime", "localize", "log", "lookup", "lt", "lte", "ne", "not", "numberFormat",
    "numberInput", "object", "or", "radioBoxes", "rangePicker", "selectOptions", "timeSince",
    "unless", "with",
  ]),
};

/* A JavaScript tokenizer just deep enough to read what a module registers and
 * exposes: comments, strings, regex literals and the text of template literals
 * are consumed whole, so a name mentioned inside one is never read as code. A
 * template with ${} holes is a `template` token holding the text before its
 * first hole, then each hole's own tokens, each followed by a `templateMiddle`
 * or `templateTail` token holding the text after it.
 *
 * Whether a `/` opens a regex is decided from the token before it. It opens
 * one at the start of the source or of a hole, after punctuation other than
 * `)`, `]`, `}`, `x++` and `x--`, after a word in REGEX_AFTER_WORD that is not
 * a property name, and after the `)` closing the head of an `if`, `while`,
 * `for` or `with`. Everywhere else it divides, which misreads a statement
 * that opens with a regex straight after a block's `}`. A `/` read as opening
 * a regex that meets a line end before its closing `/` is division instead,
 * so a misjudged one stays inside its own line. */
const REGEX_AFTER_WORD = new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await"]);
const HEAD_WORDS = new Set(["if", "while", "for", "with"]);
const LINE_END = /[\n\r\p{Zl}\p{Zp}]/u;
function tokenizeJs(src) {
  const tokens = [];
  const holes = []; // open ${} holes: brace depth inside each
  const parens = []; // open parentheses: whether each opens an if/while/for/with head
  let headClose = -1; // the index of the last `)` that closed such a head
  let i = 0;
  // Advances through template-literal text; "hole" when it stops at a `${`.
  const templateText = () => {
    while (i < src.length) {
      if (src[i] === "\\") i += 2;
      else if (src[i] === "`") return (i++, "end");
      else if (src[i] === "$" && src[i + 1] === "{") return ((i += 2), "hole");
      else i++;
    }
    return "end";
  };
  const regexMayStart = () => {
    const k = tokens.length - 1;
    const prev = tokens[k];
    if (!prev || prev.type === "template" || prev.type === "templateMiddle") return true;
    if (prev.type === "ident") return REGEX_AFTER_WORD.has(prev.value) && !punctAt(tokens, k - 1, ".");
    if (prev.type !== "punct") return false;
    if (prev.value === ")") return k === headClose;
    if (prev.value === "]" || prev.value === "}") return false;
    if (prev.value !== "+" && prev.value !== "-") return true;
    // A run of `+` or `-` pairs off from its start, so an even run ends in
    // `++` or `--` and an odd one in an operator: `a+++/x/` is `a++ + /x/`.
    let run = 1;
    while (src[prev.start - run] === prev.value) run++;
    return run % 2 === 1;
  };
  // The index past the flags of the regex opening at i, or -1 when a line ends
  // before its closing `/`.
  const regexEnd = () => {
    let inClass = false;
    for (let j = i + 1; j < src.length && !LINE_END.test(src[j]); j++) {
      if (src[j] === "\\" && !LINE_END.test(src[j + 1] ?? "")) j++;
      else if (src[j] === "[") inClass = true;
      else if (src[j] === "]") inClass = false;
      else if (src[j] === "/" && !inClass) {
        for (j++; /[a-z]/i.test(src[j] ?? ""); j++);
        return j;
      }
    }
    return -1;
  };
  while (i < src.length) {
    const c = src[i];
    const start = i;
    let end;
    if (/\s/.test(c)) i++;
    else if (c === "/" && src[i + 1] === "/") i = src.indexOf("\n", i) < 0 ? src.length : src.indexOf("\n", i);
    else if (c === "/" && src[i + 1] === "*") i = src.indexOf("*/", i + 2) < 0 ? src.length : src.indexOf("*/", i + 2) + 2;
    else if (c === '"' || c === "'") {
      let value = "";
      for (i++; i < src.length && src[i] !== c && src[i] !== "\n"; i++) value += src[i] === "\\" ? src[++i] : src[i];
      i++;
      tokens.push({ type: "string", value, start });
    } else if (c === "`") {
      i++;
      const textStart = i;
      if (templateText() === "hole") {
        holes.push(0);
        tokens.push({ type: "template", value: src.slice(textStart, i - 2), start });
      } else tokens.push({ type: "string", value: src.slice(textStart, i - 1), start });
    } else if (c === "}" && holes.length && holes[holes.length - 1] === 0) {
      holes.pop();
      i++;
      const textStart = i;
      const hole = templateText() === "hole";
      if (hole) holes.push(0);
      tokens.push({ type: hole ? "templateMiddle" : "templateTail", value: src.slice(textStart, i - (hole ? 2 : 1)), start });
    } else if (c === "/" && regexMayStart() && (end = regexEnd()) >= 0) {
      i = end;
      tokens.push({ type: "regex", value: null, start });
    } else if (/[A-Za-z_$]/.test(c)) {
      while (/[\w$]/.test(src[i] ?? "")) i++;
      tokens.push({ type: "ident", value: src.slice(start, i), start });
    } else if (/\d/.test(c)) {
      while (/[\w.]/.test(src[i] ?? "")) i++;
      tokens.push({ type: "number", value: src.slice(start, i), start });
    } else if (src.startsWith("...", i)) {
      i += 3;
      tokens.push({ type: "punct", value: "...", start });
    } else {
      if (holes.length && c === "{") holes[holes.length - 1]++;
      if (holes.length && c === "}") holes[holes.length - 1]--;
      if (c === "(") {
        const word = tokens[tokens.length - 1];
        parens.push(word?.type === "ident" && HEAD_WORDS.has(word.value) && !punctAt(tokens, tokens.length - 2, "."));
      } else if (c === ")" && parens.pop()) headClose = tokens.length;
      i++;
      tokens.push({ type: "punct", value: c, start });
    }
  }
  return tokens;
}

function punctAt(tokens, k, value) {
  return tokens[k]?.type === "punct" && tokens[k].value === value;
}

// The keys of the object literal opening at tokens[open], the index of its
// closing brace, and for each key its token index and the token range
// [from, to) of its value — the key itself for a shorthand. Null when a key is
// not literal: a spread or a computed [key] names nothing readable.
function objectLiteralKeys(tokens, open) {
  const keys = [];
  const values = [];
  let depth = 1;
  let expectKey = true;
  const endValue = (k) => {
    if (values.length) values[values.length - 1].to = k;
  };
  for (let k = open + 1; k < tokens.length; k++) {
    const tk = tokens[k];
    const p = tk.type === "punct" ? tk.value : null;
    if (depth === 1 && expectKey) {
      if (p === "}") return { keys, values, end: k };
      // `async foo() {}`, `get foo() {}`, `*foo() {}` — unless the word is itself the key.
      const modifier = p === "*" || (tk.type === "ident" && ["async", "get", "set"].includes(tk.value));
      if (modifier && ![":", "(", ",", "}"].includes(tokens[k + 1]?.value)) continue;
      if (!["ident", "string", "number"].includes(tk.type)) return null;
      keys.push(tk.value);
      values.push({ key: k, from: punctAt(tokens, k + 1, ":") ? k + 2 : k, to: k + 1 });
      expectKey = false;
      continue;
    }
    if (p === "(" || p === "[" || p === "{") depth++;
    else if (p === ")" || p === "]" || p === "}") {
      if (--depth === 0) {
        endValue(k);
        return { keys, values, end: k };
      }
    } else if (p === "," && depth === 1) {
      endValue(k);
      expectKey = true;
    }
  }
  return null;
}

/**
 * Helper names a module's source registers: `registerHelper("name", fn)` and
 * `registerHelper({ name: fn, other() {} })`, or either argument held in a
 * same-file `const`/`let`/`var`. A SOURCE-TEXT match, not a parse — it reads
 * what a registration SAYS, never whether it runs. `unreadable` holds the
 * offset of every call whose names it cannot read (a parameter, an import, an
 * interpolated name, a spread), so a template calling one of those helpers
 * fails as unknown and the report can say why.
 * @returns {{ names: string[], unreadable: number[] }}
 */
function readHelperRegistrations(src) {
  const tokens = tokenizeJs(src);
  const names = [];
  const unreadable = [];
  const punct = (k, value) => tokens[k]?.type === "punct" && tokens[k].value === value;
  // Same-file bindings a registration may name instead of a literal.
  const bindings = new Map();
  for (let k = 0; k + 3 < tokens.length; k++) {
    if (tokens[k].type !== "ident" || !["const", "let", "var"].includes(tokens[k].value)) continue;
    if (tokens[k + 1].type === "ident" && punct(k + 2, "=")) bindings.set(tokens[k + 1].value, k + 3);
  }
  // A value is only the name it looks like when nothing continues the
  // expression after it: `"acks" + suffix` is not the helper "acks". At the
  // call itself the argument must end at `,` or `)`.
  const complete = (k, atCall) =>
    atCall ? punct(k, ",") || punct(k, ")") : !(tokens[k]?.type === "punct" && "+-*/%.[(?|&<>=".includes(tokens[k].value));
  const readArgument = (at, atCall) => {
    const arg = tokens[at];
    if (arg?.type === "string") return complete(at + 1, atCall) ? [arg.value] : null;
    if (punct(at, "{")) {
      const literal = objectLiteralKeys(tokens, at);
      return literal && complete(literal.end + 1, atCall) ? literal.keys : null;
    }
    if (arg?.type === "ident" && bindings.has(arg.value) && complete(at + 1, atCall)) {
      const bound = bindings.get(arg.value);
      bindings.delete(arg.value); // a binding naming itself is read once, never looped on
      const read = readArgument(bound, false);
      bindings.set(arg.value, bound);
      return read;
    }
    return null;
  };
  for (let t = 0; t < tokens.length; t++) {
    if (tokens[t].type !== "ident" || tokens[t].value !== "registerHelper") continue;
    if (tokens[t - 1]?.value === "function") continue; // a definition, not a call
    let open = t + 1;
    if (tokens[open]?.value === "?" && tokens[open + 1]?.value === ".") open += 2;
    if (tokens[open]?.value !== "(") continue;
    // A method or function DEFINITION is a parameter list followed by a body.
    let close = open;
    for (let depth = 0; close < tokens.length; close++) {
      if (punct(close, "(") || punct(close, "[") || punct(close, "{")) depth++;
      else if ((punct(close, ")") || punct(close, "]") || punct(close, "}")) && --depth === 0) break;
    }
    if (punct(close + 1, "{")) continue;
    const read = readArgument(open + 1, true);
    if (read) names.push(...read);
    else unreadable.push(tokens[t].start);
  }
  return { names, unreadable };
}

/* Every registerHelper call in scripts/ (.mjs and .js), read once: 2b checks
 * what templates call against these names, 7c checks each name against the
 * module namespace. Both read this one list, so they never disagree about what
 * counts as a registration. One entry per file that registers anything;
 * `unreadable` holds the line of each call whose names cannot be read. */
const HELPER_REGISTRATIONS = [];
walk(path.join(ROOT, "scripts"), (full) => {
  if (!/\.m?js$/.test(full)) return;
  const src = fs.readFileSync(full, "utf8");
  const { names, unreadable } = readHelperRegistrations(src);
  if (!names.length && !unreadable.length) return;
  const lineAt = (index) => src.slice(0, index).split("\n").length;
  HELPER_REGISTRATIONS.push({ file: rel(full), names, unreadable: unreadable.map(lineAt) });
});

{
  const registered = new Set(HELPER_REGISTRATIONS.flatMap((entry) => entry.names));
  const unreadable = HELPER_REGISTRATIONS.flatMap((entry) => entry.unreadable.map((line) => `${entry.file}:${line}`));
  for (const where of unreadable) {
    console.warn(`WARN ${where}: registerHelper call whose helper name this check cannot read — pass it a string literal, an object literal of helpers, or a same-file const holding one; until then a template calling that helper fails as unknown`);
  }
  const unreadableNote = unreadable.length
    ? ` (${unreadable.length} registerHelper call${unreadable.length === 1 ? "" : "s"} in scripts/ could not be read — see the WARN above)`
    : "";

  let templates = 0;
  let calls = 0;
  let contextCalls = 0;
  const called = new Set();
  walk(path.join(ROOT, "templates"), (full) => {
    if (!full.endsWith(".hbs")) return;
    const source = fs.readFileSync(full, "utf8");
    let ast;
    try {
      ast = Handlebars.parse(source);
    } catch {
      return; // section 2 has already failed this file
    }
    templates++;
    const lines = source.split("\n");
    const escaped = (lineNo) => lines[lineNo - 1]?.includes("helper-ok:") || lines[lineNo - 2]?.includes("helper-ok:");

    const check = (node, blockParams) => {
      const path_ = node.path;
      // A literal in path position (`{{"name" x}}`) is looked up by its text.
      const name = path_.parts ? path_.parts[0] : String(path_.original);
      const plain = !path_.parts || (path_.parts.length === 1 && !path_.depth && !/^\.|this\b/.test(path_.original));
      const positional = node.params?.length ?? 0;
      const hasArgs = node.type === "SubExpression" || positional > 0 || !!node.hash;
      if (path_.data || (plain && blockParams.has(name))) return;
      if (!plain) {
        if (hasArgs) contextCalls++;
        return;
      }
      if (!hasArgs && node.type !== "BlockStatement") return; // a property lookup
      calls++;
      called.add(name);
      if (FOUNDRY_CORE_HELPERS.names.has(name) || registered.has(name)) return;
      const lineNo = node.loc.start.line;
      if (escaped(lineNo)) return;
      const shape = node.type === "SubExpression" ? `(${name} …)` : node.type === "BlockStatement" ? `{{#${name}}}` : `{{${name} …}}`;
      const effect = !hasArgs
        ? `with no arguments Handlebars runs this block as a section over the context property "${name}", and the first system or module to register a helper under that name takes it over, silently. Write {{#if ${name}}}, {{#each ${name}}} or {{#with ${name}}} for a section`
        : positional > 0
          ? `the template compiles and every offline check passes, then its first render throws "Missing helper: ${name}" and the window or card built from it never appears`
          : "with no positional argument a missing helper renders nothing, silently — the call is dead rather than loud";
      fail(
        rel(full),
        `line ${lineNo}: ${shape} calls a helper nothing registers — not Foundry ${FOUNDRY_CORE_HELPERS.version} core, not this module's scripts/ — ${effect}. Use a core helper, register it in scripts/ with Handlebars.registerHelper, or state why not with "{{!-- helper-ok: <reason> --}}"${unreadableNote}`,
      );
    };

    const visit = (node, blockParams) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach((n) => visit(n, blockParams));
      switch (node.type) {
        case "Program":
          return visit(node.body, blockParams);
        case "MustacheStatement":
        case "SubExpression":
        case "BlockStatement":
          check(node, blockParams);
          break;
        case "PartialStatement":
        case "PartialBlockStatement":
          if (node.name?.type === "SubExpression") visit(node.name, blockParams); // {{> (whichPartial) }}
          break;
        case "DecoratorBlock":
        case "Decorator":
          break; // decorators (`{{#*inline}}`) live in their own registry
        default:
          return;
      }
      visit(node.params, blockParams);
      visit(node.hash?.pairs.map((pair) => pair.value), blockParams);
      if (node.program) visit(node.program, new Set([...blockParams, ...(node.program.blockParams ?? [])]));
      if (node.inverse) visit(node.inverse, blockParams);
    };
    visit(ast, new Set());
  });
  if (templates) {
    console.log(
      `validate: helpers checked ${calls} call${calls === 1 ? "" : "s"} to ${called.size} distinct helper${called.size === 1 ? "" : "s"} ` +
        `across ${templates} template${templates === 1 ? "" : "s"}, against Foundry ${FOUNDRY_CORE_HELPERS.version} core (${FOUNDRY_CORE_HELPERS.names.size}) ` +
        `+ ${registered.size} registered in scripts/` +
        (contextCalls ? `; ${contextCalls} call${contextCalls === 1 ? "" : "s"} on a context path (this.x, a.b) left to the render` : ""),
    );
  }
}

/* 3. JSON validity — plus the two silent manifest corruptions (TOOLCHAIN
 * §10n): a UTF-8 BOM (PowerShell's `utf8` writes one; CI's JSON gate rejects
 * it while a BOM-tolerant local parse would not), and the cp1252→UTF-8
 * double-encoding signature (bytes c3 a2 e2 82 ac — valid UTF-8, valid JSON,
 * garbled to every reader; only a byte check catches it). */
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
let module_ = null;
for (const file of ["module.json", "package.json"]) {
  try {
    const bytes = fs.readFileSync(path.join(ROOT, file));
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      fail(file, "starts with a UTF-8 BOM — write JSON via the Edit tool or node, never PowerShell redirection");
    }
    if (bytes.includes(Buffer.from([0xc3, 0xa2, 0xe2, 0x82, 0xac]))) {
      fail(file, "carries the cp1252 double-encoding signature (c3 a2 e2 82 ac) — an em dash became â€”; rewrite from a clean source");
    }
    const parsed = readJson(file);
    if (file === "module.json") module_ = parsed;
  } catch (err) {
    fail(file, err.message);
  }
}
walk(path.join(ROOT, "lang"), (full) => {
  if (!full.endsWith(".json")) return;
  try {
    const lang = JSON.parse(fs.readFileSync(full, "utf8"));
    /* Foundry expands the flat file with expandObject: a key that is BOTH a
     * leaf and a prefix of other keys either silently eats every child (branch
     * first) or throws and drops the module's WHOLE translation file (leaf
     * first). Suffix the label instead (`nounLabel`, `methods.<key>`). */
    const keys = Object.keys(lang).filter((k) => typeof lang[k] === "string");
    const keySet = new Set(Object.keys(lang));
    for (const k of keys) {
      const clash = [...keySet].find((other) => other !== k && other.startsWith(`${k}.`));
      if (clash) fail(rel(full), `key "${k}" is both a value and a prefix of "${clash}" — expandObject collision kills the translation file`);
    }
  } catch (err) {
    fail(rel(full), err.message);
  }
});
walk(path.join(ROOT, "ruledata"), (full) => {
  if (!full.endsWith(".json")) return;
  try {
    const doc = JSON.parse(fs.readFileSync(full, "utf8"));
    if (!doc.id) fail(rel(full), "ruledata document missing `id`");
  } catch (err) {
    fail(rel(full), err.message);
  }
});

/* 3b. Stray C0 control bytes in source. A tool that writes a file through a
 * shell-quoted string can land a real control character where an escape was
 * meant: `\b` inside a JS string literal is BACKSPACE, so a word-boundary regex
 * written that way becomes /…\x08/ and matches nothing, forever. The byte is
 * invisible in every editor and every diff, the file parses, the suite passes,
 * and the rule around it is simply dead. Tab, newline and carriage return are
 * the only control characters source has any business carrying. */
const CONTROL_OK = new Set([9, 10, 13]);
for (const dir of ["scripts", "tools", "templates", "styles", "lang"]) {
  walk(path.join(ROOT, dir), (full) => {
    if (!/\.(mjs|js|json|hbs|css)$/.test(full)) return;
    const text = fs.readFileSync(full, "utf8");
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if ((code >= 32 || CONTROL_OK.has(code)) && code !== 127) continue;
      const line = text.slice(0, i).split("\n").length;
      fail(
        rel(full),
        `line ${line} carries control byte 0x${code.toString(16).padStart(2, "0")} — an escape such as \\b was written as a literal character; whatever rule contains it is dead`,
      );
      return;
    }
  });
}

/* 4. Pack-source document invariants, including embedded documents (items /
 *    effects / results / pages, recursively — items can nest effects).
 *    Foundry's DocumentIdField requires exactly 16 alphanumerics everywhere. */
const ID_RE = /^[A-Za-z0-9]{16}$/;
const EMBEDDED_COLLECTIONS = ["items", "effects", "results", "pages"];
function checkDoc(fileRel, doc, ids, context) {
  if (doc._id !== undefined) {
    if (!ID_RE.test(doc._id)) fail(fileRel, `${context}_id "${doc._id}" is not 16 alphanumerics`);
    if (doc._key !== undefined && !String(doc._key).endsWith(doc._id)) fail(fileRel, `${context}_key does not end with _id`);
    if (ids.has(doc._id)) fail(fileRel, `${context}duplicate _id ${doc._id}`);
    ids.add(doc._id);
  }
  for (const collection of EMBEDDED_COLLECTIONS) {
    if (!Array.isArray(doc[collection])) continue;
    const childIds = new Set(); // same child id under different parents is legal
    for (const child of doc[collection]) {
      if (child && typeof child === "object") checkDoc(fileRel, child, childIds, `${collection}: `);
    }
  }
}
const sourceRoot = path.join(ROOT, "packs", "_source");
if (fs.existsSync(sourceRoot)) {
  for (const packDir of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
    if (!packDir.isDirectory()) continue;
    const ids = new Set();
    walk(path.join(sourceRoot, packDir.name), (full) => {
      if (!full.endsWith(".json")) return;
      let doc;
      try {
        doc = JSON.parse(fs.readFileSync(full, "utf8"));
      } catch (err) {
        fail(rel(full), err.message);
        return;
      }
      checkDoc(rel(full), doc, ids, "");
    });
  }
}

/* 5. module.json invariants. */
if (module_) {
  const m = module_;
  if (!m.id) fail("module.json", "missing id");
  if (!/^\d+\.\d+\.\d+$/.test(m.version ?? "")) fail("module.json", `version "${m.version}" is not plain semver X.Y.Z`);
  if (!m.compatibility?.minimum) fail("module.json", "missing compatibility.minimum");
  for (const field of ["esmodules", "scripts", "styles"]) {
    for (const p of m[field] ?? []) {
      const problem = pathProblem(p);
      if (problem) fail("module.json", `${field} entry "${p}" ${problem}`);
    }
  }
  for (const l of m.languages ?? []) {
    const problem = pathProblem(l.path);
    if (problem) fail("module.json", `language "${l.lang}" path "${l.path}" ${problem}`);
  }
  for (const p of m.packs ?? []) {
    if (existsExact(p.path) || existsExact(`packs/_source/${p.name}`)) continue;
    const caseHit = [p.path, `packs/_source/${p.name}`].find((c) => fs.existsSync(path.join(ROOT, c)));
    fail(
      "module.json",
      caseHit
        ? `declared pack "${p.name}": "${caseHit}" exists only under a different case — case-sensitive CI will not find it`
        : `declared pack "${p.name}" has neither ${p.path} nor packs/_source/${p.name}`
    );
  }
  /* Every relationships.requires entry carries a human reason; third-party
   * entries also carry compatibility.minimum. Intra-family (acks-*) entries are
   * exempt from the minimum by the §3 waiver — sibling modules co-develop at
   * current versions, so a computed floor there is development-tracking noise,
   * not a contract. The count is printed so a green line cannot mean the check
   * read nothing. */
  const requires = m.relationships?.requires ?? [];
  for (const entry of requires) {
    const who = entry.id ?? "(entry without id)";
    if (!entry.id) fail("module.json", "relationships.requires entry is missing its id");
    if (typeof entry.reason !== "string" || !entry.reason.trim()) {
      fail("module.json", `relationships.requires "${who}" is missing its reason`);
    }
    const intraFamily = typeof entry.id === "string" && entry.id.startsWith("acks-");
    if (!intraFamily && !entry.compatibility?.minimum) {
      fail("module.json", `relationships.requires "${who}" is missing compatibility.minimum`);
    }
  }
  console.log(`validate: module.json relationships.requires checked ${requires.length} entr${requires.length === 1 ? "y" : "ies"}`);
  for (const [field, suffix] of [["manifest", "module.json"], ["download", "module.zip"]]) {
    if (m[field] && !m[field].endsWith(`/releases/latest/download/${suffix}`)) {
      fail("module.json", `${field} should end with /releases/latest/download/${suffix}`);
    }
  }
  if (m.id && path.basename(ROOT) !== m.id) {
    console.warn(`WARN module.json: id "${m.id}" does not match directory name "${path.basename(ROOT)}"`);
  }
}

/* 6. Every localization key referenced in code should exist in lang/en.json. */
if (module_?.id && fs.existsSync(path.join(ROOT, "lang", "en.json"))) {
  const lang = readJson("lang/en.json");
  // Support flat and nested key styles by flattening to dot-paths.
  const langKeys = [];
  (function flatten(obj, prefix) {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === "object") flatten(v, key);
      else langKeys.push(key);
    }
  })(lang, "");
  /* Any ACKS-family lang root, not just this module's own. A merged module
   * carries the roots of everything folded into it (ACKS-EQUIPMENT.*,
   * ACKS-HENCHMEN.*, ...), and those roots stay put — re-prefixing thousands
   * of keys to match the new id buys nothing and risks collisions.
   *
   * This MUST stay in step with 7a below. Keyed to `module_.id` it would match
   * none of a merged module's keys, so `referenced` would come back empty and
   * this section would print OK having checked nothing. */
  const keyRe = new RegExp(`${LANG_FAMILY}[A-Z0-9]+\\.[A-Za-z0-9._-]+`, "g");

  /* Most code names its lang root through a constant — `${LANG_PREFIX}.ui.x`,
   * the shape the scaffold itself seeds — so a scanner that only reads quoted
   * literals sees NO keys in such a repo and prints OK having checked nothing.
   * Resolving the interpolation is what makes this section cover the family's
   * own idiom. Resolution is per file: local `const NAME = "…"` plus named
   * imports followed through relative specifiers. It can never be a repo-wide
   * name→value map — one merged module legitimately declares several different
   * LANG_PREFIX constants (ACKS-LIB, ACKS-LOCATION, …), and flattening them
   * would attribute keys to the wrong root. */
  const CONST_RE = /(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(["'`])([^"'`\\\n]*)\2/g;
  const IMPORT_RE = /import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;
  const INTERP_RE = /\$\{\s*([A-Za-z_$][\w$]*)\s*\}/g;
  /* The same root, one indirection further out: a factory handed a lang root
   * returns a bound localizer, and every `loc("some.key")` after it names a key
   * no literal scan can see. Matched on shape, not on the helper's name — a
   * value that reaches a factory as a lang root and comes back callable with
   * dotted strings IS a localizer, whatever the repo calls it. */
  const BINDER_RE = /(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*[A-Za-z_$][\w$]*\s*\(\s*(?:(["'`])([^"'`\\\n]*)\2|([A-Za-z_$][\w$]*))\s*\)/g;
  /* Only a value shaped like a lang root (or a dot-path under one) is ever
   * substituted, so an unrelated `${…}` can never be rewritten into something
   * that merely looks like a key — including this validator's own LANG_FAMILY,
   * which lives one directory below and is scanned like any other source. */
  const LANG_ROOT_RE = new RegExp(`^${LANG_FAMILY}[A-Z0-9]+(?:\\.[A-Za-z0-9._-]+)?$`);
  /* An i18n call whose key STARTS with an interpolation this pass could not
   * resolve is a key the section cannot see at all. That silence is the defect
   * — it reads as "no problems found" — so it fails instead. Only a root named
   * by something constant-shaped counts: a generic factory interpolating its
   * own `prefix` parameter is unknowable by construction, and its call sites
   * are reached through the binder pass rather than here. */
  const OPAQUE_I18N_RE = /\bi18n\s*\.\s*(?:localize|format|has)\(\s*`\$\{([^}`]*)\}/g;
  const CONSTANTISH = /[A-Z][A-Z0-9_]{2,}/;

  const files = [];
  for (const dir of ["scripts", "templates", "ruledata", "tools"]) {
    walk(path.join(ROOT, dir), (full) => {
      if (/[.](mjs|hbs|json)$/.test(full)) files.push(full);
    });
  }
  const sources = new Map(files.map((full) => [full, fs.readFileSync(full, "utf8")]));

  const substitute = (text, scope) =>
    text.replace(INTERP_RE, (whole, name) => {
      const value = scope.get(name);
      return value !== undefined && LANG_ROOT_RE.test(value) ? value : whole;
    });

  // Module-level string constants per file, plus the named-import edges that
  // carry them between files.
  const constsOf = new Map();
  const importsOf = new Map();
  for (const full of files) {
    if (!full.endsWith(".mjs")) continue;
    const local = new Map();
    for (const m of sources.get(full).matchAll(CONST_RE)) local.set(m[1], m[3]);
    constsOf.set(full, local);
    const edges = [];
    for (const m of sources.get(full).matchAll(IMPORT_RE)) {
      const source = resolveSpecifier(full, m[2]);
      if (!constsOf.has(source) && !files.includes(source)) continue;
      for (const specifier of m[1].split(",")) {
        const [imported, alias] = specifier.trim().split(/\s+as\s+/);
        if (imported) edges.push({ source, imported, local: alias ?? imported });
      }
    }
    importsOf.set(full, edges);
  }
  const scopeFor = (full) => {
    const scope = new Map(constsOf.get(full));
    for (const edge of importsOf.get(full) ?? []) {
      const value = constsOf.get(edge.source)?.get(edge.imported);
      if (value !== undefined) scope.set(edge.local, value);
    }
    return scope;
  };
  /* A root composed from another constant — `const SUB = `${LANG_PREFIX}.ui`` —
   * only resolves once the constant it chains off has, and that one usually
   * arrives by import. So the fixed point runs across ALL files rather than
   * within each: resolving one file's constants can unblock another's. */
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (const [full, local] of constsOf) {
      const scope = scopeFor(full);
      for (const [name, value] of local) {
        const next = substitute(value, scope);
        if (next !== value) (local.set(name, next), (changed = true));
      }
    }
    if (!changed) break;
  }

  /* referenced: key -> truncated. `truncated` stays true only while EVERY
   * capture of the key was cut short — at a `${…}` interpolation or a trailing
   * dot (a concat prefix; a whole key never ends in a dot) — or sat unquoted
   * in prose (a comment naming a key family). Those get the dynamic-family
   * tolerance: any longer sibling satisfies them. One capture of the whole key
   * inside quotes pins it exact for good — an exact literal must match an
   * exact key, because prefix tolerance lets a deleted `foo` hide behind its
   * own `fooHint`, and roughly a tenth of a real repo's keys are strict
   * prefixes of a sibling under the foo/fooHint labelling convention. */
  const referenced = new Map();
  const literal = new Set(); // what a quoted-literal-only scan would have seen
  const QUOTE_RE = /["'`]/;
  /* A quoted WHOLE literal handed to something that names itself a prefix —
   * `static LOCALIZATION_PREFIXES = ["…"]`, `labelPrefix: "…"` — is a prefix
   * by API contract, not a key, and keeps the dynamic-family tolerance. */
  const PREFIX_CTX_RE = /prefix(?:es)?\s*[:=]\s*\[?\s*$/i;
  const addRef = (key, truncated) => referenced.set(key, (referenced.get(key) ?? true) && truncated);
  const collectLiteral = (text) => {
    for (const match of text.matchAll(keyRe)) literal.add(match[0].replace(/[.,]$/, ""));
  };
  const collectRefs = (text) => {
    for (const match of text.matchAll(keyRe)) {
      const key = match[0].replace(/[.,]$/, "");
      const truncated =
        key !== match[0] ||
        text.startsWith("${", match.index + match[0].length) ||
        !QUOTE_RE.test(text[match.index - 1] ?? "") ||
        PREFIX_CTX_RE.test(text.slice(Math.max(0, match.index - 64), match.index - 1));
      addRef(key, truncated);
    }
  };
  for (const full of files) {
    collectLiteral(sources.get(full));
    if (!full.endsWith(".mjs")) {
      collectRefs(sources.get(full));
      continue;
    }
    const scope = scopeFor(full);
    const resolved = substitute(sources.get(full), scope);
    collectRefs(resolved);
    for (const m of resolved.matchAll(OPAQUE_I18N_RE)) {
      if (!CONSTANTISH.test(m[1])) continue;
      fail(rel(full), `i18n key starts with unresolvable \${${m[1]}} — declare the root as a module-level string const so this check can read the key`);
    }
    for (const m of resolved.matchAll(BINDER_RE)) {
      const root = m[3] ?? scope.get(m[4]);
      if (root === undefined || !LANG_ROOT_RE.test(root)) continue;
      const callRe = new RegExp(`\\b${m[1]}\\(\\s*(["'\`])([A-Za-z0-9._-]+)\\1`, "g");
      for (const call of resolved.matchAll(callRe)) addRef(`${root}.${call[2]}`, false);
    }
  }
  const langKeySet = new Set(langKeys);
  for (const [key, truncated] of referenced) {
    // Dynamic families: code builds `PREFIX.${value}` — the captured prefix is
    // fine as long as some real key extends it. Only a TRUNCATED capture gets
    // that tolerance; an exact literal reference demands the exact key.
    if (truncated ? langKeys.some((k) => k.startsWith(key)) : langKeySet.has(key)) continue;
    const sibling = truncated ? undefined : langKeys.find((k) => k !== key && k.startsWith(key));
    fail(
      "lang/en.json",
      `missing key referenced in code: ${key}` +
        (sibling ? ` (a longer sibling "${sibling}" exists, but an exact literal reference requires the exact key)` : "")
    );
  }
  /* Always report the count. A silent OK cannot distinguish "found no problems"
   * from "found no keys", and it was the second that let a missing key ship. */
  const recovered = referenced.size - literal.size;
  console.log(
    `validate: i18n checked ${referenced.size} referenced key${referenced.size === 1 ? "" : "s"} ` +
      `across ${files.length} file${files.length === 1 ? "" : "s"}` +
      (recovered > 0 ? ` (${recovered} invisible to a quoted-literal scan: constant roots and bound localizers)` : "") +
      ` against ${langKeys.length} in lang/en.json`
  );
  const familyKeys = langKeys.filter((k) => k.startsWith(LANG_FAMILY));
  if (familyKeys.length && !referenced.size) {
    console.warn(`WARN lang/en.json: ${familyKeys.length} ${LANG_FAMILY}* keys defined but not one is referenced in code — this check verified nothing`);
  }
}

/* Reading a name where a module writes it. 7c checks the names of what a module
 * exposes on globalThis and the hooks it fires, and modules name both through
 * constants: an object of hook names published on the module's API (TOOLCHAIN
 * §5b), imported wherever a hook fires and often built from a NAMESPACE const.
 * So a name is read from source text, never by running anything, through
 * every shape that hands a string along unchanged — a string or template
 * literal, a const, an object member, a named import or re-export, either arm
 * of a conditional. A call, an operator or a parameter ends the reading. */

/* The module-level surface of one source file: each `const` declared outside
 * every block and parameter list, what the file imports and exports, and every
 * name it binds any other way. A name bound any other way may be shadowed where
 * it is used, so it is never read: a parameter sharing a module const's name
 * reads as the parameter it is. Cached per file. */
const JS_MODULES = new Map();
const CONTROL_WORDS = new Set(["if", "for", "while", "switch", "with"]);
function jsModule(full) {
  if (JS_MODULES.has(full)) return JS_MODULES.get(full);
  let src;
  try {
    src = fs.readFileSync(full, "utf8");
  } catch {
    JS_MODULES.set(full, null);
    return null;
  }
  const t = tokenizeJs(src);
  const mod = { file: full, src, tokens: t, consts: new Map(), imports: new Map(), exports: new Map(), reexports: new Map(), stars: [], bound: new Set() };
  JS_MODULES.set(full, mod);
  const fileAt = (k) => (t[k]?.type === "string" ? resolveSpecifier(full, t[k].value) : null);
  let depth = 0;
  // Each name a parameter list or destructuring pattern binds: every
  // identifier but a key before `:`, with default values skipped.
  const bindAll = (from, to) => {
    for (let k = from; k < to; k++) {
      if (t[k].type === "ident" && !punctAt(t, k + 1, ":") && !punctAt(t, k - 1, ".")) mod.bound.add(t[k].value);
      else if (punctAt(t, k, "=") && !arrowAt(t, k)) k = Math.min(expressionEnd(t, k + 1), to) - 1;
    }
  };
  const declare = (k) => {
    const exported = t[k - 1]?.value === "export";
    for (let j = k + 1; ; j++) {
      let name = null;
      if (t[j]?.type === "ident") name = t[j++].value;
      else if (punctAt(t, j, "{") || punctAt(t, j, "[")) {
        const close = closerOf(t, j);
        bindAll(j + 1, close);
        j = close + 1;
      } else return;
      const init = punctAt(t, j, "=") && !punctAt(t, j + 1, "=") ? j + 1 : -1;
      if (name !== null) {
        if (t[k].value === "const" && depth === 0 && init >= 0) mod.consts.set(name, init);
        else mod.bound.add(name);
        if (exported) mod.exports.set(name, name);
      }
      if (init >= 0) j = expressionEnd(t, init);
      if (!punctAt(t, j, ",")) return;
    }
  };
  // `{ a, b as c }` of an import or export clause: [name, local] pairs, where
  // `name` is the imported or exported one.
  const clause = (open, close, importing) => {
    const pairs = [];
    for (let e = open + 1; e < close; e++) {
      if (t[e].type !== "ident" && t[e].type !== "string") continue;
      const aliased = t[e + 1]?.value === "as";
      pairs.push(importing ? [t[e].value, aliased ? t[e + 2]?.value : t[e].value] : [aliased ? t[e + 2]?.value : t[e].value, t[e].value]);
      if (aliased) e += 2;
    }
    return pairs;
  };
  for (let k = 0; k < t.length; k++) {
    const tk = t[k];
    if (tk.type === "punct") {
      // A parameter list is a group a body or an arrow follows, unless a
      // control keyword owns it; `catch (err) {` binds like one.
      if (tk.value === "(") {
        const close = closerOf(t, k);
        const owner = t[k - 1];
        if ((punctAt(t, close + 1, "{") || arrowAt(t, close + 1)) && !(owner?.type === "ident" && CONTROL_WORDS.has(owner.value))) bindAll(k + 1, close);
      }
      if ("([{".includes(tk.value)) depth++;
      else if (")]}".includes(tk.value)) depth--;
      continue;
    }
    if (tk.type !== "ident" || punctAt(t, k - 1, ".")) continue;
    if (arrowAt(t, k + 1)) mod.bound.add(tk.value);
    else if (["const", "let", "var"].includes(tk.value)) declare(k);
    else if (depth === 0 && tk.value === "import" && !punctAt(t, k + 1, "(") && !punctAt(t, k + 1, ".")) {
      // import D from "s" · import * as N from "s" · import { a, b as c } from "s"
      let j = k + 1;
      const pairs = [];
      if (t[j]?.type === "ident") {
        mod.bound.add(t[j++].value); // a default import is not followed
        if (punctAt(t, j, ",")) j++;
      }
      if (punctAt(t, j, "*") && t[j + 1]?.value === "as") (pairs.push(["*", t[j + 2]?.value]), (j += 3));
      else if (punctAt(t, j, "{")) {
        const close = closerOf(t, j);
        pairs.push(...clause(j, close, true));
        j = close + 1;
      }
      const from = fileAt(t[j]?.value === "from" ? j + 1 : j);
      for (const [name, local] of pairs) if (local) mod.imports.set(local, { from, name });
    } else if (depth === 0 && tk.value === "export") {
      // export { a, b as c } · export { a as b } from "s" · export * from "s" ·
      // export * as n from "s". An `export const` is read by declare().
      if (punctAt(t, k + 1, "*")) {
        const alias = t[k + 2]?.value === "as" ? t[k + 3]?.value : null;
        const fromAt = alias ? k + 4 : k + 2;
        if (t[fromAt]?.value !== "from") continue;
        const from = fileAt(fromAt + 1);
        if (alias) mod.reexports.set(alias, { from, name: "*" });
        else if (from) mod.stars.push(from);
      } else if (punctAt(t, k + 1, "{")) {
        const close = closerOf(t, k + 1);
        const from = t[close + 1]?.value === "from" ? fileAt(close + 2) : undefined;
        for (const [exported, local] of clause(k + 1, close, false)) {
          if (from === undefined) mod.exports.set(exported, local);
          else mod.reexports.set(exported, { from, name: local });
        }
      }
    }
  }
  return mod;
}

// The index of the bracket closing the one opened at tokens[open].
function closerOf(tokens, open) {
  for (let depth = 0, k = open; k < tokens.length; k++) {
    if (tokens[k].type !== "punct") continue;
    if ("([{".includes(tokens[k].value)) depth++;
    else if (")]}".includes(tokens[k].value) && --depth === 0) return k;
  }
  return tokens.length;
}

// Whether an arrow `=>` starts at tokens[k]: the tokenizer splits operators into
// single characters, and adjacent ones are rejoined by position.
function arrowAt(tokens, k) {
  return punctAt(tokens, k, "=") && punctAt(tokens, k + 1, ">") && tokens[k + 1].start === tokens[k].start + 1;
}

const ASSIGNMENT_OPERATORS = new Set(["=", "+=", "-=", "*=", "/=", "%=", "**=", "<<=", ">>=", ">>>=", "&=", "|=", "^=", "&&=", "||=", "??="]);
function assignmentAt(tokens, k) {
  let op = "";
  for (let j = k; tokens[j]?.type === "punct" && "=+-*/%<>&|^?".includes(tokens[j].value) && (j === k || tokens[j].start === tokens[j - 1].start + 1); j++) {
    op += tokens[j].value;
  }
  for (let n = op.length; n > 0; n--) {
    if (ASSIGNMENT_OPERATORS.has(op.slice(0, n))) return op[n] !== "=" && op[n] !== ">"; // not `==`, not `=>`
  }
  return false;
}

/* The index just past the expression starting at tokens[from]: the first `,`
 * or `;` outside every bracket and template, the closer of a bracket opened
 * before it, or a second operand following the first with no operator between
 * — the point automatic semicolon insertion ends a statement. */
function expressionEnd(tokens, from) {
  const endsOperand = (tk) =>
    tk.type === "ident" ? !REGEX_AFTER_WORD.has(tk.value) : tk.type === "punct" ? ")]}".includes(tk.value) : tk.type !== "template" && tk.type !== "templateMiddle";
  const startsOperand = (tk) =>
    tk.type === "ident" ? !["in", "of", "instanceof"].includes(tk.value) : ["string", "number", "regex", "template"].includes(tk.type);
  for (let depth = 0, templates = 0, k = from; k < tokens.length; k++) {
    const tk = tokens[k];
    if (!depth && !templates) {
      if (tk.type === "punct" && [",", ";", ")", "]", "}"].includes(tk.value)) return k;
      if (k > from && endsOperand(tokens[k - 1]) && startsOperand(tk)) return k;
    }
    if (tk.type === "template") templates++;
    else if (tk.type === "templateTail") templates--;
    else if (tk.type === "punct" && "([{".includes(tk.value)) depth++;
    else if (tk.type === "punct" && ")]}".includes(tk.value)) depth--;
  }
  return tokens.length;
}

// The `?` and `:` of a conditional at the top level of tokens[from, to), or
// null. `?.` and `??` are not conditionals.
function conditionalAt(tokens, from, to) {
  let question = -1;
  let inner = 0;
  for (let depth = 0, templates = 0, k = from; k < to; k++) {
    const tk = tokens[k];
    if (tk.type === "template") templates++;
    else if (tk.type === "templateTail") templates--;
    if (tk.type !== "punct" || templates) continue;
    if ("([{".includes(tk.value)) depth++;
    else if (")]}".includes(tk.value)) depth--;
    else if (depth) continue;
    else if (tk.value === "?" && !punctAt(tokens, k + 1, ".") && !punctAt(tokens, k + 1, "?") && !punctAt(tokens, k - 1, "?")) {
      if (question < 0) question = k;
      else inner++;
    } else if (tk.value === ":" && question >= 0) {
      if (!inner) return { question, colon: k };
      inner--;
    }
  }
  return null;
}

// The token range [from, to) of each argument of the call opening at tokens[open].
function argumentsOf(tokens, open) {
  const close = closerOf(tokens, open);
  const ranges = [];
  for (let from = open + 1; from < close; ) {
    const to = Math.min(expressionEnd(tokens, from), close);
    ranges.push([from, to]);
    from = to + 1;
  }
  return ranges;
}

/**
 * What the expression tokens[from, to) of `mod` holds, read from source text.
 * @returns {{ names: { text: string, complete: boolean, mod: object, at: number }[] }
 *   | { object: { mod: object, literal: object } } | { namespace: object } | null}
 *   `names` — each string it may be, with the module and token index where it
 *   is written; a template literal is complete only if every hole reads as one
 *   complete string, and otherwise keeps its text up to the first hole that
 *   does not. `object` — an object literal (objectLiteralKeys). `namespace` —
 *   an `import * as` module. Null — nothing here can be read.
 */
function readValue(mod, from, to, depth = 0) {
  const t = mod.tokens;
  if (depth > 32 || from >= to) return null;
  const branch = conditionalAt(t, from, to);
  if (branch) {
    const yes = readValue(mod, branch.question + 1, branch.colon, depth + 1);
    const no = readValue(mod, branch.colon + 1, to, depth + 1);
    return yes?.names && no?.names ? { names: [...yes.names, ...no.names] } : null;
  }
  let k = from;
  let value = null;
  if (t[k].type === "string") {
    value = { names: [{ text: t[k].value, complete: true, mod, at: k }] };
    k++;
  } else if (t[k].type === "template") {
    ({ value, end: k } = readTemplate(mod, k, depth + 1));
  } else if (punctAt(t, k, "(")) {
    const close = closerOf(t, k);
    value = readValue(mod, k + 1, close, depth + 1);
    k = close + 1;
  } else if (punctAt(t, k, "{")) {
    const literal = objectLiteralKeys(t, k);
    if (!literal) return null;
    value = { object: { mod, literal } };
    k = literal.end + 1;
  } else if (t[k].value === "Object" && t[k].type === "ident" && punctAt(t, k + 1, ".") && t[k + 2]?.value === "freeze" && punctAt(t, k + 3, "(")) {
    const close = closerOf(t, k + 3);
    value = readValue(mod, k + 4, close, depth + 1);
    k = close + 1;
  } else if (t[k].type === "ident") {
    value = readBinding(mod, t[k].value, depth + 1);
    k++;
  }
  // Members: `.key`, `?.key`, `[key]`, `?.[key]`. Anything else — a call, an
  // operator — computes a value this does not read.
  while (value && k < to) {
    if (punctAt(t, k, "?") && punctAt(t, k + 1, ".")) k += punctAt(t, k + 2, "[") ? 2 : 1;
    let key;
    if (punctAt(t, k, ".") && t[k + 1]?.type === "ident") {
      key = t[k + 1].value;
      k += 2;
    } else if (punctAt(t, k, "[")) {
      const close = closerOf(t, k);
      const inner = readValue(mod, k + 1, close, depth + 1)?.names;
      if (inner?.length !== 1 || !inner[0].complete) return null;
      key = inner[0].text;
      k = close + 1;
    } else return null;
    value = memberOf(value, key, depth + 1);
  }
  return k === to ? value : null;
}

// The template literal opening at tokens[at]: its text, with each hole that
// reads as one string spliced in, up to the first hole that does not.
function readTemplate(mod, at, depth) {
  const t = mod.tokens;
  let text = t[at].value;
  let complete = true;
  for (let hole = at + 1; ; ) {
    let close = hole;
    for (let nested = 0; close < t.length; close++) {
      const type = t[close].type;
      if (type === "template") nested++;
      else if (type === "templateTail" && nested) nested--;
      else if ((type === "templateTail" || type === "templateMiddle") && !nested) break;
    }
    if (complete) {
      const read = readValue(mod, hole, close, depth)?.names;
      const one = read?.length === 1 ? read[0] : null;
      if (one) text += one.text;
      if (one?.complete) text += t[close]?.value ?? "";
      else complete = false;
    }
    if (close >= t.length || t[close].type === "templateTail") return { value: { names: [{ text, complete, mod, at }] }, end: close + 1 };
    hole = close + 1;
  }
}

// A name at module scope in `mod`: its const's initializer, or what it imports.
function readBinding(mod, name, depth) {
  if (mod.bound.has(name)) return null;
  if (mod.consts.has(name)) {
    const at = mod.consts.get(name);
    return readValue(mod, at, expressionEnd(mod.tokens, at), depth);
  }
  const imported = mod.imports.get(name);
  const source = imported?.from ? jsModule(imported.from) : null;
  if (!source) return null;
  return imported.name === "*" ? { namespace: source } : readExport(source, imported.name, depth + 1);
}

// What `mod` exports under `name`, followed through its re-exports.
function readExport(mod, name, depth) {
  if (depth > 32) return null;
  if (mod.exports.has(name)) return readBinding(mod, mod.exports.get(name), depth + 1);
  const relay = mod.reexports.get(name);
  if (relay) {
    const source = relay.from ? jsModule(relay.from) : null;
    if (!source) return null;
    return relay.name === "*" ? { namespace: source } : readExport(source, relay.name, depth + 1);
  }
  for (const from of mod.stars) {
    const source = jsModule(from);
    const value = source && readExport(source, name, depth + 1);
    if (value) return value;
  }
  return null;
}

// The member `key` of a value readValue returned. A string's members
// (`.length`, `.replace`) are not names.
function memberOf(value, key, depth) {
  if (value.object) {
    const { mod, literal } = value.object;
    const i = literal.keys.lastIndexOf(key);
    return i < 0 ? null : readValue(mod, literal.values[i].from, literal.values[i].to, depth);
  }
  if (value.namespace) return readExport(value.namespace, key, depth);
  return null;
}

/* 7. Namespacing: shared-registry identifiers carry the module key. */
if (module_?.id) {
  const id = module_.id;
  const camelNs = id.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
  const idPrefix = module_.flags?.[id]?.idPrefix;
  const warn = (file, message) => console.warn(`WARN ${file}: ${message}`);

  // 7a. lang keys carry a family root (Foundry-owned roots allowlisted).
  const FOUNDRY_LANG_ROOTS = ["TYPES"];
  if (fs.existsSync(path.join(ROOT, "lang", "en.json"))) {
    const lang = readJson("lang/en.json");
    for (const key of Object.keys(lang)) {
      const ok =
        key.startsWith(LANG_FAMILY) ||
        FOUNDRY_LANG_ROOTS.some((root) => key === root || key.startsWith(`${root}.`));
      if (!ok) fail("lang/en.json", `key "${key}" is not prefixed "${LANG_FAMILY}" (Foundry-owned roots: ${FOUNDRY_LANG_ROOTS.join(", ")})`);
    }
  }

  // 7b. top-level pack _ids start with the declared idPrefix.
  if (fs.existsSync(sourceRoot)) {
    if (!idPrefix) {
      fail("module.json", `modules with packs must declare flags["${id}"].idPrefix (short key prefixing every pack document _id)`);
    } else {
      walk(sourceRoot, (full) => {
        if (!full.endsWith(".json")) return;
        let doc;
        try {
          doc = JSON.parse(fs.readFileSync(full, "utf8"));
        } catch {
          return; // JSON validity already reported in section 3/4
        }
        if (doc._id !== undefined && !String(doc._id).startsWith(idPrefix)) {
          fail(rel(full), `_id "${doc._id}" does not start with declared idPrefix "${idPrefix}"`);
        }
      });
    }
  }

  // 7c. runtime registrations in scripts/: globals, custom hooks, HB helpers.
  /* Globals and hooks: every assignment to a property of globalThis itself,
   * every Object.assign/defineProperty/Reflect.set aimed at it, and every
   * Hooks.call/callAll, in scripts/ (.mjs and .js) — found in 2b's tokens and
   * named through readValue. A name it cannot read FAILS, as an unreadable
   * helper does: the name is the whole of what this checks. A hook call alone
   * may state why with `hook-ok: <reason>` on or just above it — a generic
   * emitter fires whatever name its caller hands it, which nothing written at
   * the call can say, while every global write has a spelling this reads. */
  let globalWrites = 0;
  let hookCalls = 0;
  let hookExcused = 0;
  const reported = new Set();
  const REMEDY = {
    global: "write globalThis.<name>, or name it with a string literal or a const or import this check can follow back to one",
    hook: 'name it with a string literal, or a const, object member or import this check can follow back to one, or state why not with "// hook-ok: <reason>" on or just above the call',
  };
  walk(path.join(ROOT, "scripts"), (full) => {
    if (!/\.m?js$/.test(full)) return;
    const mod = jsModule(full);
    if (!mod) return;
    const t = mod.tokens;
    const file = rel(full);
    const lines = mod.src.split("\n");
    const lineOf = (m, k) => m.src.slice(0, m.tokens[k].start).split("\n").length;
    const verdict = (name) =>
      name.text.startsWith(camelNs) ? "ok" : !name.complete && camelNs.startsWith(name.text) ? "unreadable" : /^acks/i.test(name.text) ? "foreign" : "outside";
    const check = (kind, names, k) => {
      const line = lineOf(mod, k);
      if (!names || names.some((name) => verdict(name) === "unreadable")) {
        if (kind === "hook" && `${lines[line - 2] ?? ""}\n${lines[line - 1]}`.includes("hook-ok:")) hookExcused++;
        else fail(file, `line ${line}: ${kind === "hook" ? "hook call" : "globalThis write"} whose name this check cannot read, so whether it starts with "${camelNs}" is unchecked — ${REMEDY[kind]}`);
      }
      for (const name of names ?? []) {
        const v = verdict(name);
        const key = `${file}\0${kind}\0${name.text}`;
        if (v === "ok" || v === "unreadable" || reported.has(key)) continue;
        reported.add(key);
        // A name held in a const or an import is fixed where it is written.
        const at = lineOf(name.mod, name.at);
        const text = `${name.text}${name.complete ? "" : "…"}`;
        const where = name.mod === mod && at === line ? "" : ` (named at ${rel(name.mod.file)}:${at})`;
        if (kind === "global") fail(file, `line ${line}: globalThis.${text}${where} must start with "${camelNs}"`);
        else if (v === "foreign") warn(file, `line ${line}: hook "${text}"${where} fires under a foreign acks-* namespace — fine only if it's a deliberate cross-module call`);
        else fail(file, `line ${line}: custom hook "${text}"${where} must start with "${camelNs}"`);
      }
    };
    const namesAt = (range) => (range ? (readValue(mod, range[0], range[1])?.names ?? null) : null);
    const keysOf = (value) =>
      value?.object ? value.object.literal.keys.map((text, i) => ({ text, complete: true, mod: value.object.mod, at: value.object.literal.values[i].key })) : null;
    for (let k = 0; k < t.length; k++) {
      if (t[k].type !== "ident") continue;
      if (t[k].value === "Hooks") {
        // Hooks.call(…) / Hooks.callAll(…), `?.` allowed at each step.
        let j = k + (punctAt(t, k + 1, "?") ? 2 : 1);
        if (!punctAt(t, j, ".") || !["call", "callAll"].includes(t[j + 1]?.value)) continue;
        j += punctAt(t, j + 2, "?") && punctAt(t, j + 3, ".") ? 4 : 2;
        if (!punctAt(t, j, "(")) continue;
        hookCalls++;
        check("hook", namesAt(argumentsOf(t, j)[0]), k);
        continue;
      }
      if (punctAt(t, k - 1, ".")) continue;
      if (t[k].value === "globalThis") {
        // globalThis.name = …, globalThis[name] ??= …: a property of globalThis
        // itself assigned. A write into one (globalThis.acksX.lib = …) is not.
        let names;
        let after;
        if (punctAt(t, k + 1, ".") && t[k + 2]?.type === "ident") {
          names = [{ text: t[k + 2].value, complete: true, mod, at: k + 2 }];
          after = k + 3;
        } else if (punctAt(t, k + 1, "[")) {
          after = closerOf(t, k + 1) + 1;
          names = namesAt([k + 2, after - 1]);
        } else continue;
        if (!assignmentAt(t, after)) continue;
        globalWrites++;
        check("global", names, k);
      } else if ((t[k].value === "Object" || t[k].value === "Reflect") && punctAt(t, k + 1, ".") && punctAt(t, k + 3, "(")) {
        // Object.assign / defineProperty / defineProperties and Reflect.set /
        // defineProperty with globalThis itself as the target.
        const method = `${t[k].value}.${t[k + 2].value}`;
        const [target, ...rest] = argumentsOf(t, k + 3);
        if (!target || target[1] - target[0] !== 1 || t[target[0]].value !== "globalThis" || t[target[0]].type !== "ident") continue;
        if (method === "Object.assign" || method === "Object.defineProperties") {
          globalWrites++;
          const sources = (method === "Object.assign" ? rest : rest.slice(0, 1)).map(([from, to]) => keysOf(readValue(mod, from, to)));
          if (sources.includes(null)) check("global", null, k);
          check("global", sources.filter(Boolean).flat(), k);
        } else if (["Object.defineProperty", "Reflect.set", "Reflect.defineProperty"].includes(method)) {
          globalWrites++;
          check("global", namesAt(rest[0]), k);
        }
      }
    }
  });
  console.log(
    `validate: global and hook namespacing checked ${globalWrites} globalThis write${globalWrites === 1 ? "" : "s"} and ` +
      `${hookCalls} hook call${hookCalls === 1 ? "" : "s"} in scripts/ against "${camelNs}"` +
      (hookExcused ? `; ${hookExcused} hook call${hookExcused === 1 ? "" : "s"} whose name it cannot read passed on hook-ok` : ""),
  );
  /* Helpers: every name 2b's reader found. A registerHelper call it cannot
   * read FAILS here, where 2b only warns: 2b's backstop is that each template
   * calling the helper still fails, and this check has none — the name is the
   * whole of what it checks. */
  let helperNames = 0;
  for (const { file, names, unreadable } of HELPER_REGISTRATIONS) {
    for (const name of new Set(names)) {
      helperNames++;
      if (name.startsWith(camelNs)) continue;
      if (/^acks/i.test(name)) warn(file, `helper "${name}" uses a foreign acks-* namespace`);
      else fail(file, `Handlebars helper "${name}" must start with "${camelNs}"`);
    }
    for (const line of unreadable) {
      fail(
        file,
        `line ${line}: registerHelper call whose helper name this check cannot read, so whether it starts with "${camelNs}" is unchecked — pass it a string literal, an object literal of helpers, or a same-file const holding one`,
      );
    }
  }
  console.log(`validate: helper namespacing checked ${helperNames} name${helperNames === 1 ? "" : "s"} registered in scripts/ against "${camelNs}"`);

  // 7d. top-level CSS classes carry the module id (kebab, like the id itself).
  const cssSeen = new Set();
  walk(path.join(ROOT, "styles"), (full) => {
    if (!full.endsWith(".css")) return;
    for (const line of fs.readFileSync(full, "utf8").split("\n")) {
      const m = /^\s*\.([a-zA-Z][\w-]*)/.exec(line);
      if (!m) continue;
      const cls = m[1];
      if (!cls.startsWith(CSS_FAMILY) && !cssSeen.has(cls)) {
        cssSeen.add(cls);
        fail(rel(full), `top-level class ".${cls}" must start with "${CSS_FAMILY}"`);
      }
    }
  });
}

/* 8. The window contract — every window a module opens stays reachable and
 *    legible on a small display, at the type size its user chose, and behaves
 *    when a second copy of it is open at the same time. Six failure modes are
 *    decidable from the source, and all six are invisible to every other check
 *    because they need a real viewport, a real setting, or a second open
 *    window:
 *
 *    a. A window outside the scroll contract. Core caps an application frame at
 *       the viewport height and gives `.window-content` `overflow: hidden`, so a
 *       window taller than the cap is amputated — trailing footer first — with
 *       no scrollbar to say so. The contract is the class `<id>-scroll`, and
 *       membership in it is the whole of the fix.
 *    b. Scroll retention that can never fire. ApplicationV2 restores a part's
 *       scroll position by resolving `selector === "" ? partRoot :
 *       partRoot.querySelector(selector)`, and querySelector searches
 *       DESCENDANTS ONLY — so a part naming its own root element retains
 *       nothing while reading as entirely correct.
 *    c. A type size the knob cannot reach. A bare px or rem font-size renders
 *       correctly on the machine it was written on and ignores the user's size
 *       setting everywhere else — the accessibility knob is present, and inert.
 *    d. Interactive content nested inside a <summary>. A summary is the
 *       disclosure toggle; a control inside it is reached inconsistently by
 *       keyboard and assistive technology (Chrome reports it as
 *       InteractiveContentSummaryDescendant). An <a> with no href inside a
 *       <summary> gets a separate diagnosis: it is not focusable at all, and
 *       its click is traded with the toggle.
 *    e. A <label> that can never name anything — NOT a label without `for`,
 *       which is the conformant source shape in this family (bound at runtime
 *       by scripts/lib/a11y.mjs downstream): only a label with no `for`,
 *       wrapping no control, and with every control between its close tag and
 *       the close of its own parent already wrapped by a label of its own. The
 *       runtime pass skips a control another label has claimed, so no pass can
 *       ever rescue that one — it reaches a user as a caption that announces
 *       nothing beside a control that already has a name.
 *    f. A literal id= in a template. A part renders once per open window, so a
 *       literal id is a duplicate the moment two copies of that sheet are
 *       open — every for=/list= naming it then resolves to the first window's
 *       element. `{{@root.partId}}` (Foundry sets it to `<app id>-<part id>`
 *       on every HandlebarsApplicationMixin part context) is the fix for the
 *       cases that genuinely need an explicit id, such as a <datalist>.
 *
 *    A window that must sit outside the contract says so where it is declared:
 *    `// no-scroll: <reason>` on or just above its `classes:` line; a size that
 *    must not move says `/* px-ok: <reason> *\/` beside itself; d/e/f each carry
 *    their own escape, on or just above the offending line:
 *    `{{!-- summary-ok: <reason> --}}`, `{{!-- label-ok: <reason> --}}`,
 *    `{{!-- id-ok: <reason> --}}`.
 *
 *    d/e/f strip Handlebars ({{!-- … --}}) and HTML (<!-- … -->) comments
 *    before matching — an existing family gate's known blind spot is matching
 *    INSIDE comments, and it is not reproduced here — but the escape comments
 *    themselves are read from the ORIGINAL text first, since stripping would
 *    blind the check to its own escape hatch. */
if (module_?.id) {
  const id = module_.id;
  const SCROLL_CLASS = `${id}-scroll`;

  // Which classes actually CARRY a scroll contract, read from the stylesheets
  // rather than assumed: a rule that claims the `.window-content` box for a
  // class is that class taking responsibility for the window's overflow. The
  // shared `<id>-scroll` is the common one, and a subsystem may own another
  // (an importer dialog, a battlemap panel) without being wrong.
  //
  // Opt-in per repo: a module whose styles claim no window-content box has no
  // contract to join, so 8a stays silent rather than inventing one.
  const contracts = new Set();
  walk(path.join(ROOT, "styles"), (full) => {
    if (!full.endsWith(".css")) return;
    const css = fs.readFileSync(full, "utf8");
    for (const m of css.matchAll(/\.([A-Za-z][\w-]*)(?:\.[\w-]+)*\.application\s+\.window-content/g)) contracts.add(m[1]);
  });
  const contractDefined = contracts.size > 0;

  // The classes on the FIRST element of each template — exactly the selectors a
  // part must not name in `scrollable`.
  const rootClasses = new Set();
  walk(path.join(ROOT, "templates"), (full) => {
    if (!full.endsWith(".hbs")) return;
    const m = /<[a-zA-Z][^>]*\sclass="([^"{]+)"/.exec(fs.readFileSync(full, "utf8"));
    if (m) for (const c of m[1].split(/\s+/).filter(Boolean)) rootClasses.add(c);
  });

  const lineOf = (text, index) => text.slice(0, index).split("\n").length;

  walk(path.join(ROOT, "scripts"), (full) => {
    if (!full.endsWith(".mjs")) return;
    const text = fs.readFileSync(full, "utf8");
    const lines = text.split("\n");

    // 8a. every declared `classes` array joins the scroll contract.
    if (contractDefined) {
      for (const m of text.matchAll(/classes:\s*\[([^\]]*)\]/g)) {
        const declared = [...m[1].matchAll(/["'`]([^"'`]+)["'`]/g)].map((c) => c[1]);
        if (declared.some((c) => contracts.has(c))) continue;
        const lineNo = lineOf(text, m.index);
        // The declaration itself, plus the contiguous comment block above it —
        // a reason worth stating is usually longer than one line, and a waiver
        // that has to fit on one encourages a reason that explains nothing.
        let i = lineNo - 1; // 0-based index of the declaration line
        let waived = lines[i]?.includes("no-scroll:") ?? false;
        for (let j = i - 1; j >= 0 && /^\s*(\/\/|\*|\/\*)/.test(lines[j] ?? ""); j--) {
          if (lines[j].includes("no-scroll:")) waived = true;
        }
        if (waived) continue;
        fail(
          rel(full),
          `line ${lineNo}: classes array joins no scroll contract — a window outside one clips its own content on a short display, with no scrollbar to say so. Add "${SCROLL_CLASS}" (or another contract class: ${[...contracts].join(", ")}), or state why not with "// no-scroll: <reason>"`,
        );
      }
    }

    // 8b. no part names its own root element as its scroll target.
    for (const m of text.matchAll(/scrollable:\s*\[([^\]]*)\]/g)) {
      for (const sel of m[1].matchAll(/["'`]([^"'`]*)["'`]/g)) {
        if (!sel[1].startsWith(".")) continue;
        const cls = sel[1].slice(1);
        if (!rootClasses.has(cls)) continue;
        fail(
          rel(full),
          `line ${lineOf(text, m.index)}: scrollable names ".${cls}", which is a template ROOT element — querySelector searches descendants only, so this part retains no scroll position. Use scrollable: [""] to address the part's own root`,
        );
      }
    }
  });

  // 8c. every type size answers to the type knob. A bare px or rem font-size
  // does not: px is deaf outright, and rem reads the BROWSER's root size, which
  // `--acks-fs-base` never touches. Both render correctly on the machine they
  // were written on and ignore the setting everywhere else — the reason this is
  // a gate is that it recurred, at scale, in files that read as finished.
  //
  // Two conformant expressions, and the check only has to reject the literal:
  // a ramp step (`var(--acks-fs-*)`), or a base-derived local ratio
  // (`calc(<n>px * var(--<id>-k))`) for a surface transcribed from a px design
  // canvas. `em` is conformant too and deliberately unflagged — it resolves
  // against whatever its parent computed, so it inherits the knob through the
  // chain.
  //
  // Escape: `/* px-ok: <reason> */` on or just above the declaration, for a
  // size that genuinely must not move.
  //
  // Opt-in per repo, on the same principle as 8a: a module that has not adopted
  // the ACKS type ramp has no knob for a size to answer to, and demanding
  // `var(--acks-fs-*)` there would trade a size that ignores the setting for a
  // variable that resolves to nothing. Adoption is read from the styles
  // themselves — the first ramp reference turns the check on for the repo.
  const styleFiles = [];
  walk(path.join(ROOT, "styles"), (full) => {
    if (full.endsWith(".css")) styleFiles.push(full);
  });
  const onTheRamp = styleFiles.some((f) => /--acks-fs-/.test(fs.readFileSync(f, "utf8")));

  for (const full of onTheRamp ? styleFiles : []) {
    const text = fs.readFileSync(full, "utf8");
    const lines = text.split("\n");
    for (const m of text.matchAll(/font-size:\s*([\d.]+)(px|rem)\b/g)) {
      const lineNo = lineOf(text, m.index);
      if (lines[lineNo - 1]?.includes("px-ok:") || lines[lineNo - 2]?.includes("px-ok:")) continue;
      const why =
        m[2] === "rem"
          ? "rem tracks the browser root, which --acks-fs-base does not set"
          : "a literal px never moves";
      // The canvas-ratio form is only offered for px: it multiplies a MEASURED
      // figure, and a rem was never one.
      const fix =
        m[2] === "rem"
          ? "Use a ramp step (var(--acks-fs-*)) or an em off a parent that rides one"
          : `Use a ramp step (var(--acks-fs-*)), an em off a parent that rides one, or calc(${m[1]}px * var(--${id}-k)) for a surface transcribed from a px design canvas`;
      fail(
        rel(full),
        `line ${lineNo}: font-size ${m[1]}${m[2]} does not answer to the type knob — ${why}. ${fix}; or state why not with "/* px-ok: <reason> */"`,
      );
    }
  }
}

// 8d/8e/8f run independent of module_.id — they check template markup, not
// anything keyed by the module's identity.
const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr",
]);
// Foundry's form-associated custom elements, alongside the native labelable
// set (https://html.spec.whatwg.org/#category-label) minus <input type=hidden>.
const LABELABLE_ELEMENTS = new Set([
  "select", "textarea", "meter", "output", "progress", "button",
  "prose-mirror", "multi-select", "multi-checkbox", "string-tags", "file-picker",
  "color-picker", "range-picker", "document-tags", "formula-input", "hue-slider",
  "autocomplete-tags", "code-mirror",
]);
const isLabelable = (name, attrs) =>
  name === "input" ? !/\btype\s*=\s*["']?hidden["']?/i.test(attrs) : LABELABLE_ELEMENTS.has(name);

// Blanks comment bodies to spaces (newlines kept, so indices and line numbers
// still line up with the original text) — matching inside a comment is the
// blind spot this deliberately does not reproduce.
const stripComments = (text) =>
  text
    .replace(/\{\{!--[\s\S]*?--\}\}/g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "));

const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>])*)>/g;
const tokenizeTags = (text) =>
  [...text.matchAll(TAG_RE)].map((m) => {
    const name = m[2].toLowerCase();
    return {
      closing: m[1] === "/",
      name,
      attrs: m[3],
      selfClosing: VOID_ELEMENTS.has(name) || /\/\s*$/.test(m[3]),
      index: m.index,
    };
  });

// The token closing the element opened at tokens[i], or -1 when the nesting
// cannot be followed that far. Handlebars branches routinely open a tag in one
// arm and close it in another, so an unfollowable extent is normal markup, not
// a defect — every caller stays silent on -1.
const matchingClose = (tokens, i) => {
  const stack = [tokens[i].name];
  for (let j = i + 1; j < tokens.length; j++) {
    const tk = tokens[j];
    if (tk.selfClosing) continue;
    if (!tk.closing) {
      stack.push(tk.name);
      continue;
    }
    if (stack[stack.length - 1] !== tk.name) return -1;
    stack.pop();
    if (stack.length === 0) return j;
  }
  return -1;
};

walk(path.join(ROOT, "templates"), (full) => {
  if (!full.endsWith(".hbs")) return;
  const original = fs.readFileSync(full, "utf8");
  const originalLines = original.split("\n");
  const text = stripComments(original);
  const lineOf = (index) => text.slice(0, index).split("\n").length;
  const escaped = (lineNo, token) => originalLines[lineNo - 1]?.includes(token) || originalLines[lineNo - 2]?.includes(token);
  const tokens = tokenizeTags(text);

  // 8d. No interactive content nested inside <summary> — a summary is the
  // disclosure toggle, and a control inside it is reached inconsistently by
  // keyboard and assistive technology (Chrome: InteractiveContentSummaryDescendant).
  // An <a> with no href is a separate diagnosis: not focusable at all, its
  // click traded with the toggle.
  let inSummary = false;
  for (const t of tokens) {
    if (!t.closing && t.name === "summary") {
      inSummary = true;
      continue;
    }
    if (t.closing && t.name === "summary") {
      inSummary = false;
      continue;
    }
    if (!inSummary || t.closing) continue;
    const lineNo = lineOf(t.index);
    if (escaped(lineNo, "summary-ok:")) continue;
    if (t.name === "a" && !/\bhref\s*=/i.test(t.attrs)) {
      fail(
        rel(full),
        `line ${lineNo}: <a> with no href inside <summary> — it is not focusable at all, and its click is traded with the disclosure toggle. Give it an href, move it out of the summary, or state why not with "{{!-- summary-ok: <reason> --}}"`,
      );
      continue;
    }
    const isInteractive =
      (t.name === "a" && /\bhref\s*=/i.test(t.attrs)) ||
      ["button", "label", "select", "textarea", "details"].includes(t.name) ||
      (t.name === "input" && !/\btype\s*=\s*["']?hidden["']?/i.test(t.attrs));
    if (!isInteractive) continue;
    fail(
      rel(full),
      `line ${lineNo}: <${t.name}> inside <summary> — a summary is the disclosure toggle, and a control inside it is reached inconsistently by keyboard and assistive technology (Chrome reports it as InteractiveContentSummaryDescendant). Move it out of the summary, or state why not with "{{!-- summary-ok: <reason> --}}"`,
    );
  }

  // 8e. A <label> with no for=, wrapping no control, and with every control
  // before the close of its own parent already wrapped by a label of its own —
  // no runtime binding pass could ever rescue it. Conservative throughout:
  // whenever the surrounding structure can't be pinned down, this stays
  // silent rather than failing markup that may be entirely correct.
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.closing || t.name !== "label" || /\bfor\s*=/i.test(t.attrs)) continue;

    // The immediate parent, read off the tag stack up to this point. A
    // mismatch anywhere in that history, or no parent at all, means the
    // stack can't be trusted here — skip rather than guess.
    const stack = [];
    let sound = true;
    for (let k = 0; k < i; k++) {
      const tk = tokens[k];
      if (tk.selfClosing) continue;
      if (!tk.closing) {
        stack.push(tk.name);
        continue;
      }
      if (stack.length === 0 || stack[stack.length - 1] !== tk.name) {
        sound = false;
        break;
      }
      stack.pop();
    }
    if (!sound || stack.length === 0) continue;
    const parentName = stack[stack.length - 1];

    // Does the label wrap a control anywhere before its OWN close tag?
    const closeIndex = matchingClose(tokens, i);
    if (closeIndex < 0) continue; // extent undetermined — stay silent
    let wraps = false;
    for (let j = i + 1; j < closeIndex; j++) {
      const tk = tokens[j];
      if (!tk.closing && isLabelable(tk.name, tk.attrs)) {
        wraps = true;
        break;
      }
    }
    if (wraps) continue; // rescued by wrapping

    // No wrap — scan forward for a control the runtime pass could still bind
    // to, stopping at the close of the parent found above. A later <label> is
    // not a boundary, and nothing inside it is a rescue: a control already
    // wrapped by a label of its own is spoken for, and the runtime pass skips
    // it (scripts/lib/a11y.mjs `controlFor`), so the whole subtree is skipped
    // here too. That distinction is the whole check — a caption stranded
    // beside a wrapped checkbox is exactly the shape that reaches a user as
    // two names for one control, one of which announces nothing.
    let depth = 0;
    let rescued = null;
    for (let k = closeIndex + 1; k < tokens.length; k++) {
      const tk = tokens[k];
      if (!tk.closing && tk.name === "label") {
        const skipTo = matchingClose(tokens, k);
        if (skipTo < 0) break; // extent undetermined — stay silent
        k = skipTo;
        continue;
      }
      if (!tk.closing && isLabelable(tk.name, tk.attrs)) {
        rescued = true;
        break;
      }
      if (tk.closing && depth === 0) {
        rescued = tk.name === parentName ? false : null; // parent closed, or a stray close we can't trust
        break;
      }
      if (!tk.closing && !tk.selfClosing) depth++;
      else if (tk.closing) depth--;
    }
    if (rescued !== false) continue; // rescued, or undetermined — either way, no fail

    const lineNo = lineOf(t.index);
    if (escaped(lineNo, "label-ok:")) continue;
    fail(
      rel(full),
      `line ${lineNo}: <label> has no for=, wraps no control, and every control before the close of its parent is already wrapped by a label of its own — no runtime binding pass can ever rescue it. Wrap a control, add for=, drop it to a <span> if it is decorative, or state why not with "{{!-- label-ok: <reason> --}}"`,
    );
  }

  // 8f. A literal id= (a value with no "{{") is a duplicate the instant two
  // copies of the sheet are open — every for=/list= naming it then resolves
  // to the first window's element.
  for (const m of text.matchAll(/(^|\s)id\s*=\s*(["'])([^"']*)\2/gi)) {
    const value = m[3];
    if (value.includes("{{")) continue;
    const lineNo = lineOf(m.index + m[1].length);
    if (escaped(lineNo, "id-ok:")) continue;
    fail(
      rel(full),
      `line ${lineNo}: literal id="${value}" — a template renders once per open window, so this collides the instant a second copy of the sheet is open, and every for=/list= naming it then resolves to the first window's element. Use {{@root.partId}} (Foundry sets it to "<app id>-<part id>" on every HandlebarsApplicationMixin part context), or state why not with "{{!-- id-ok: <reason> --}}"`,
    );
  }
});

/* 9. IP leak scan — licensed book material must never reach a public repo or a
 *    release artifact. CI runs this again against the built zip and quarantines
 *    the repo if it trips; running it here means you find out before the push. */
const ipScan = path.join(ROOT, "tools", "ip-scan.mjs");
if (fs.existsSync(ipScan)) {
  try {
    execFileSync(process.execPath, [ipScan], { stdio: "inherit" });
  } catch {
    failed = true; // its own output already names the offending paths
  }
}

/* 10. Optional module-owned extra validation. A repo drops tools/validate-extra.mjs
 *    for checks specific to it (e.g. an IP-safety lint); the canonical validator
 *    runs it here so `npm run validate` stays the single entry point. It should
 *    exit non-zero on failure. Modules without the file skip this cleanly. */
const extraValidator = path.join(ROOT, "tools", "validate-extra.mjs");
if (fs.existsSync(extraValidator)) {
  try {
    execFileSync(process.execPath, [extraValidator], { stdio: "inherit" });
  } catch {
    failed = true; // its own output already explains the failure
  }
}

if (failed) process.exit(1);
console.log("validate: scripts, templates, JSON, packs, module.json, i18n, and namespacing OK");
