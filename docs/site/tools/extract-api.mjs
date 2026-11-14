/**
 * The public namespace, read from the code that assembles it: every key a
 * feature hangs on `acksExtras.<feature>`, followed to the declaration that
 * defines it, with that declaration's own docstring.
 *
 * The files are read, never imported, for the reason `parse.mjs` gives. The
 * assignments take three shapes, and all three are followed:
 *   - an object literal assigned in place;
 *   - a local `const api = { … }` assigned by name;
 *   - a call (`resolveApi()`), which `ROOTS` maps to the object it returns.
 *
 * A key is followed through shorthand, `key: name`, a nested literal, a
 * `...spread` of a namespace import or a local object, a named import, a
 * re-export, and a local declaration at any depth of the file. An identifier
 * that reaches none of these is reported in `unresolved`, and the callers exit
 * non-zero on it: a reference that silently drops a key reads as a namespace
 * that never had one.
 */
import fs from "node:fs";
import path from "node:path";

import { REPO, walk, matchBrace, stripComments } from "./parse.mjs";

const SCRIPTS = path.join(REPO, "scripts");

/**
 * Where an assignment's right-hand side is a call: the object the call
 * returns, and the keys it adds to that object.
 */
const ROOTS = {
  lib: { object: "localImpl", extra: ["movementScales"] },
};

/**
 * How deep a nested literal or a namespace is followed before it is listed as
 * one row: a group row whose key has this many segments is not expanded.
 */
export const MAX_DEPTH = 3;

const rel = (file) => path.relative(REPO, file).split(path.sep).join("/");
const lineOf = (src, index) => src.slice(0, index).split("\n").length;

const sources = new Map();
/** A file's text and its comment-blanked twin, offsets aligned. */
function read(file) {
  if (!sources.has(file)) {
    const src = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    sources.set(file, { src, bare: stripComments(src) });
  }
  return sources.get(file);
}

/** Index of the bracket closing the one at `start`, over `()`, `[]` and `{}`. */
function matchBracket(bare, start) {
  const open = bare[start];
  const close = { "(": ")", "[": "]", "{": "}" }[open];
  let depth = 0;
  let quote = null;
  for (let i = start; i < bare.length; i++) {
    const c = bare[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return i;
  }
  return -1;
}

/**
 * The top-level entries of an object literal's body, as `[start, end)` offset
 * pairs into the file. Commas inside a nested bracket, a string or a comment
 * do not split.
 */
function splitEntries(bare, open, close) {
  const out = [];
  let depth = 0;
  let quote = null;
  let from = open + 1;
  for (let i = open + 1; i < close; i++) {
    const c = bare[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) {
      out.push([from, i]);
      from = i + 1;
    }
  }
  out.push([from, close]);
  return out.filter(([a, b]) => bare.slice(a, b).trim());
}

/** A comment's text with its markers and leading stars removed. */
function cleanComment(text) {
  return text
    .replace(/^\s*\/\*\*?/, "")
    .replace(/\*\/\s*$/, "")
    .split("\n")
    .map((line) => line.replace(/^\s*(?:\*|\/\/) ?/, "").trimEnd())
    .join("\n")
    .trim();
}

/** The `/** … *\/` block that ends directly above `index`, or "". */
function docAbove(src, index) {
  const lineStart = src.lastIndexOf("\n", index - 1) + 1;
  const before = src.slice(0, lineStart).trimEnd();
  if (!before.endsWith("*/")) return "";
  const start = before.lastIndexOf("/*");
  if (start < 0 || !before.startsWith("/**", start)) return "";
  // A block separated from earlier code only by whitespace on its own line.
  const head = before.slice(before.lastIndexOf("\n", start - 1) + 1, start);
  return head.trim() ? "" : cleanComment(before.slice(start));
}

/**
 * The comments an entry carries inside the literal: the block or line comments
 * between the previous entry and its first token.
 */
function leadingComment(src, bare, start, end) {
  const first = start + (bare.slice(start, end).match(/^\s*/)?.[0].length ?? 0);
  const text = src.slice(start, first).trim();
  return text ? cleanComment(text.replace(/\*\/\s*\/\*\*?/g, "\n")) : "";
}

/** One-line parameter list from the `(` at `open`. */
function paramsAt(src, bare, open) {
  const close = matchBracket(bare, open);
  if (close < 0) return "(…)";
  const text = bare.slice(open, close + 1).replace(/\s+/g, " ").replace(/\( /, "(").replace(/,? \)$/, ")");
  return text.length > 160 ? `${text.slice(0, 157)}…)` : text;
}

/** What a value expression is, from its first tokens. */
function describeValue(src, bare, at) {
  const text = bare.slice(at);
  let m;
  if ((m = /^(async\s+)?function\b[^(]*/.exec(text))) {
    return { kind: "function", signature: `${m[1] ? "async " : ""}${paramsAt(src, bare, at + m[0].length)}` };
  }
  if ((m = /^(async\s+)?(?=\()/.exec(text))) {
    const open = at + m[0].length;
    const close = matchBracket(bare, open);
    if (close > 0 && /^\s*=>/.test(bare.slice(close + 1))) {
      return { kind: "function", signature: `${m[1] ? "async " : ""}${paramsAt(src, bare, open)}` };
    }
  }
  if ((m = /^(async\s+)?([A-Za-z_$][\w$]*)\s*=>/.exec(text))) {
    return { kind: "function", signature: `${m[1] ? "async " : ""}(${m[2]})` };
  }
  if (/^class\b/.test(text)) return { kind: "class" };
  if (/^(?:Object\.freeze\(\s*)?\{/.test(text)) return { kind: "object" };
  if (/^(?:Object\.freeze\(\s*)?\[/.test(text)) return { kind: "array" };
  if (/^new\s+(Map|Set|WeakMap|WeakSet)\b/.test(text)) return { kind: RegExp.$1 };
  if (/^["'`]/.test(text)) return { kind: "string" };
  if (/^-?\d/.test(text)) return { kind: "number" };
  if (/^(true|false)\b/.test(text)) return { kind: "boolean" };
  return { kind: "value" };
}

const importMaps = new Map();
/**
 * A file's static imports: local name → `{file, name}`, where `name` is the
 * exported name, `"*"` for a namespace and `"default"` for a default import.
 * Only relative specifiers are kept.
 */
function importsOf(file) {
  if (importMaps.has(file)) return importMaps.get(file);
  const { bare } = read(file);
  const map = new Map();
  const re = /^\s*import\s+([^;]*?)\s+from\s+(["'])(\.[^"']*)\2/gm;
  for (const m of bare.matchAll(re)) {
    const target = path.resolve(path.dirname(file), m[3]);
    let clause = m[1];
    const braces = /\{([^}]*)\}/.exec(clause);
    if (braces) {
      for (const part of braces[1].split(",")) {
        const [name, alias] = part.trim().split(/\s+as\s+/);
        if (name) map.set((alias ?? name).trim(), { file: target, name: name.trim() });
      }
      clause = clause.replace(braces[0], "");
    }
    const ns = /\*\s+as\s+([\w$]+)/.exec(clause);
    if (ns) {
      map.set(ns[1], { file: target, name: "*" });
      clause = clause.replace(ns[0], "");
    }
    const def = /([\w$]+)/.exec(clause);
    if (def) map.set(def[1], { file: target, name: "default" });
  }
  importMaps.set(file, map);
  return map;
}

/** A declaration of `name` anywhere in `file`: function, class, or const/let/var. */
function declarationIn(file, name) {
  const { src, bare } = read(file);
  const id = name.replace(/\$/g, "\\$");
  let m;
  const fn = new RegExp(`^[ \\t]*(?:export\\s+)?(?:default\\s+)?(async\\s+)?function\\s*(\\*?)\\s*${id}\\s*\\(`, "m");
  if ((m = fn.exec(bare))) {
    const open = m.index + m[0].length - 1;
    return {
      kind: "function",
      signature: `${m[1] ? "async " : ""}${paramsAt(src, bare, open)}`,
      file,
      index: m.index + m[0].search(/\S/),
    };
  }
  const cls = new RegExp(`^[ \\t]*(?:export\\s+)?(?:default\\s+)?class\\s+${id}\\b([^{]*)`, "m");
  if ((m = cls.exec(bare))) {
    const ext = /extends\s+([\w$.]+)/.exec(m[1]);
    return { kind: "class", signature: ext ? `extends ${ext[1]}` : "", file, index: m.index + m[0].search(/\S/) };
  }
  const decl = new RegExp(`^[ \\t]*(?:export\\s+)?(?:const|let|var)\\s+${id}\\s*=\\s*`, "m");
  if ((m = decl.exec(bare))) {
    const at = m.index + m[0].length;
    return { ...describeValue(src, bare, at), file, index: m.index + m[0].search(/\S/), valueAt: at };
  }
  return null;
}

/** Every name a file exports, own and re-exported, as `name → {file, name}` of where to look. */
function exportsOf(file, seen = new Set()) {
  const out = new Map();
  if (seen.has(file) || !fs.existsSync(file)) return out;
  seen.add(file);
  const { bare } = read(file);
  for (const m of bare.matchAll(/^export\s+(?:async\s+)?(?:function\s*\*?|class|const|let|var)\s+([\w$]+)/gm)) {
    out.set(m[1], { file, name: m[1], local: true });
  }
  const def = /^export\s+default\s+(?:(?:async\s+)?function\s*\*?\s*|class\s+)?([\w$]+)/m.exec(bare);
  if (def) out.set("default", { file, name: def[1], local: true });
  for (const m of bare.matchAll(/^export\s+\{([^}]*)\}\s*(?:from\s+(["'])(\.[^"']*)\2)?/gm)) {
    const target = m[3] ? path.resolve(path.dirname(file), m[3]) : null;
    for (const part of m[1].split(",")) {
      const [name, alias] = part.trim().split(/\s+as\s+/);
      if (!name) continue;
      out.set((alias ?? name).trim(), target ? { file: target, name: name.trim() } : { file, name: name.trim(), local: true });
    }
  }
  for (const m of bare.matchAll(/^export\s+\*\s+from\s+(["'])(\.[^"']*)\1/gm)) {
    for (const [name, where] of exportsOf(path.resolve(path.dirname(file), m[2]), seen)) {
      if (!out.has(name)) out.set(name, where);
    }
  }
  return out;
}

/**
 * Follow `name` as it is written in `file` to the declaration behind it.
 *
 * @returns {object|null} `{kind, signature?, file, index, doc}`, a
 *   `{kind: "namespace", file}` for a namespace import, or null
 */
function resolveName(file, name, hops = 0) {
  if (hops > 8) return null;
  const imported = importsOf(file).get(name);
  if (imported) {
    if (!fs.existsSync(imported.file)) return null;
    if (imported.name === "*") return { kind: "namespace", file: imported.file, index: 0 };
    return resolveExport(imported.file, imported.name, hops + 1);
  }
  const found = declarationIn(file, name);
  if (found) {
    const { src, bare } = read(file);
    // `const a = b;` is `b` under another name: the kind and signature are
    // `b`'s, and the docstring is the alias's own where it has one.
    const alias = found.kind === "value" ? /^([\w$]+)\s*;/.exec(bare.slice(found.valueAt))?.[1] : null;
    const behind = alias && alias !== name ? resolveName(file, alias, hops + 1) : null;
    if (behind && behind.kind !== "namespace") {
      return { ...behind, file, index: found.index, valueAt: undefined, doc: docAbove(src, found.index) || behind.doc };
    }
    // In a single-class file the file header is the class docstring.
    const header = found.kind === "class" ? /^\s*\/\*\*[\s\S]*?\*\//.exec(src)?.[0] : null;
    return { ...found, doc: docAbove(src, found.index) || (header ? cleanComment(header) : "") };
  }
  // `const { a, b: c } = source`: the member of whatever `source` is.
  const { bare } = read(file);
  for (const m of bare.matchAll(/^[ \t]*(?:const|let|var)\s*\{([^}]*)\}\s*=\s*([\w$]+)\s*;/gm)) {
    for (const part of m[1].split(",")) {
      const [member, alias] = part.trim().split(/\s*:\s*/);
      if ((alias ?? member) !== name) continue;
      const source = resolveName(file, m[2], hops + 1);
      if (source?.kind === "namespace") return resolveExport(source.file, member, hops + 1);
      return source ? { kind: "value", signature: `${m[2]}.${member}`, file, index: m.index + m[0].search(/\S/), doc: "" } : null;
    }
  }
  return null;
}

/** Follow an exported `name` of `file` through re-exports to its declaration. */
function resolveExport(file, name, hops = 0) {
  const where = exportsOf(file).get(name);
  if (!where) return null;
  if (where.local || where.file === file) return resolveName(where.file, where.name, hops + 1);
  return resolveExport(where.file, where.name, hops + 1);
}

/**
 * Rows for the object literal whose `{` is at `open` in `file`.
 *
 * @param {object} ctx `{feature, rows, unresolved}`, appended to
 * @param {string} prefix dotted key path of the literal itself
 */
function readLiteral(ctx, file, open, prefix, depth) {
  const { src, bare } = read(file);
  const close = matchBrace(src, open);
  if (close < 0) {
    ctx.unresolved.push({ feature: ctx.feature, key: prefix || "(root)", why: `unbalanced literal in ${rel(file)}` });
    return;
  }
  // A file's `export const publicApi = {` is a manifest: every row read inside
  // it, nested reads included, carries the file as its route.
  const manifest = MANIFEST_HEAD.test(bare.slice(Math.max(0, open - 80), open)) ? rel(file) : null;
  const from = ctx.rows.length;
  ctx.literals.push({ file: rel(file), index: open, manifest });
  readEntries(ctx, file, open, close, prefix, depth);
  if (manifest) for (let i = from; i < ctx.rows.length; i++) ctx.rows[i].manifest ??= manifest;
}

/** A file that declares `export const publicApi` in any shape. */
const PUBLIC_API = /^export\s+const\s+publicApi\b/m;

/** What directly precedes the `{` of a manifest literal. */
const MANIFEST_HEAD = /^[\s\S]*\bexport\s+const\s+publicApi\s*=\s*$/;

/** The entries of the literal whose braces are at `open` and `close`. */
function readEntries(ctx, file, open, close, prefix, depth) {
  const { src, bare } = read(file);
  for (const [start, end] of splitEntries(bare, open, close)) {
    const at = start + bare.slice(start, end).match(/^\s*/)[0].length;
    const text = bare.slice(at, end).trim();
    const note = leadingComment(src, bare, start, end);
    const here = { file, index: at };
    let m;

    if ((m = /^\.\.\.\s*([\w$]+)$/.exec(text))) {
      spread(ctx, file, m[1], prefix, depth, note);
    } else if ((m = /^(get|set)\s+([\w$]+)\s*\(/.exec(text))) {
      if (m[1] === "get") ctx.rows.push({ key: join(prefix, m[2]), kind: "getter", note, ...here });
    } else if ((m = /^(async\s+)?(\*?)\s*([\w$]+)\s*\(/.exec(text))) {
      const sig = `${m[1] ? "async " : ""}${paramsAt(src, bare, at + m[0].length - 1)}`;
      ctx.rows.push({ key: join(prefix, m[3]), kind: "function", signature: sig, note, ...here });
    } else if ((m = /^([\w$]+|"[^"]+"|'[^']+')\s*:\s*/.exec(text))) {
      const key = join(prefix, m[1].replace(/^["']|["']$/g, ""));
      const valueAt = at + m[0].length;
      const value = text.slice(m[0].length);
      if (value.startsWith("{")) nested(ctx, file, valueAt, key, depth, note);
      else if (/^[\w$]+$/.test(value) && !/^(true|false|null|undefined|\d+)$/.test(value)) named(ctx, file, value, key, depth, note);
      else if ((m = /^([\w$]+)((?:\.[\w$]+)+)$/.exec(value))) member(ctx, file, m[1], m[2], key, note, here);
      else ctx.rows.push({ key, ...describeValue(src, bare, valueAt), note, ...here });
    } else if (/^[\w$]+$/.test(text)) {
      named(ctx, file, text, join(prefix, text), depth, note);
    } else {
      ctx.unresolved.push({ feature: ctx.feature, key: prefix || "(root)", why: `unread entry "${text.slice(0, 60)}" in ${rel(file)}` });
    }
  }
}

const join = (prefix, key) => (prefix ? `${prefix}.${key}` : key);

/** A nested literal: its own row, then its entries beneath it while depth allows. */
function nested(ctx, file, open, key, depth, note) {
  ctx.rows.push({ key, kind: "object", note, file, index: open, group: true });
  if (depth < MAX_DEPTH) readLiteral(ctx, file, open, key, depth + 1);
}

/** `key: a.b.c` — the head is followed, the tail is kept as written. */
function member(ctx, file, head, tail, key, note, here) {
  const found = resolveName(file, head);
  if (!found) {
    ctx.unresolved.push({ feature: ctx.feature, key, why: `"${head}" not found from ${rel(file)}` });
    return;
  }
  // One step into a namespace import is an export of that file.
  const single = /^\.([\w$]+)$/.exec(tail)?.[1];
  const target = found.kind === "namespace" && single ? resolveExport(found.file, single) : null;
  if (target && target.kind !== "namespace") {
    ctx.rows.push({ key, kind: target.kind, signature: target.signature, doc: target.doc, note, file: target.file, index: target.index });
    return;
  }
  ctx.rows.push({ key, kind: "value", signature: `${head}${tail}`, note, ...here });
}

/** A key bound to an identifier: followed to its declaration. */
function named(ctx, file, name, key, depth, note) {
  const found = resolveName(file, name);
  if (!found) {
    ctx.unresolved.push({ feature: ctx.feature, key, why: `"${name}" not found from ${rel(file)}` });
    return;
  }
  if (found.kind === "namespace") {
    ctx.rows.push({ key, kind: "namespace", note, file: found.file, index: 0, group: true });
    if (depth < MAX_DEPTH) namespaceRows(ctx, found.file, key);
    return;
  }
  if (found.kind === "object" && found.valueAt != null && depth < MAX_DEPTH) {
    const { bare } = read(found.file);
    const open = bare.indexOf("{", found.valueAt);
    ctx.rows.push({ key, kind: "object", doc: found.doc, note, file: found.file, index: found.index, group: true });
    readLiteral(ctx, found.file, open, key, depth + 1);
    return;
  }
  ctx.rows.push({ key, kind: found.kind, signature: found.signature, doc: found.doc, note, file: found.file, index: found.index });
}

/** One row per export of a namespace-imported file. */
function namespaceRows(ctx, file, prefix) {
  for (const name of [...exportsOf(file).keys()].sort()) {
    const found = resolveExport(file, name);
    if (!found) {
      ctx.unresolved.push({ feature: ctx.feature, key: join(prefix, name), why: `export "${name}" of ${rel(file)} not found` });
      continue;
    }
    ctx.rows.push({ key: join(prefix, name), kind: found.kind, signature: found.signature, doc: found.doc, file: found.file, index: found.index });
  }
}

/** `...name`: a namespace import's exports, or a local object's entries, at this level. */
function spread(ctx, file, name, prefix, depth, note) {
  const found = resolveName(file, name);
  if (found?.kind === "namespace") {
    if (note) ctx.rows.push({ key: join(prefix, `…${name}`), kind: "spread", note, file: found.file, index: 0, group: true });
    namespaceRows(ctx, found.file, prefix);
  } else if (found?.kind === "object" && found.valueAt != null) {
    readLiteral(ctx, found.file, read(found.file).bare.indexOf("{", found.valueAt), prefix, depth);
  } else {
    ctx.unresolved.push({ feature: ctx.feature, key: join(prefix, `...${name}`), why: `spread of "${name}" not followed from ${rel(file)}` });
  }
}

/**
 * The keys a namespace reaches more than once, among its leaf rows.
 *
 * @param {object[]} rows a namespace's rows before repeats are dropped
 * @returns {Array<{key: string, manifest: boolean}>} `manifest` is true where
 *   at least one of the routes was a file's `publicApi`
 */
export function repeatedKeys(rows) {
  const byKey = new Map();
  for (const row of rows) {
    if (row.group) continue;
    if (!byKey.has(row.key)) byKey.set(row.key, []);
    byKey.get(row.key).push(row);
  }
  return [...byKey]
    .filter(([, list]) => list.length > 1)
    .map(([key, list]) => ({ key, manifest: list.some((r) => r.manifest) }));
}

/**
 * The public namespace, one entry per feature key.
 *
 * @returns {{features: Array<{feature: string, file: string, line: number, doc: string, rows: object[]}>,
 *   unresolved: Array<{feature: string, key: string, why: string}>}}
 *   each row is `{key, kind, signature?, doc?, note?, file, line, group?}` with
 *   `file` repo-relative
 */
export function extractApi() {
  const features = [];
  const unresolved = [];
  const seen = new Set();
  const literals = [];
  const declaring = new Set();
  for (const file of walk(SCRIPTS)) if (PUBLIC_API.test(read(file).bare)) declaring.add(rel(file));
  const assign = /^[ \t]*acksExtras\.([a-zA-Z]+)\s*=\s*/gm;

  for (const file of walk(SCRIPTS).sort()) {
    const { src, bare } = read(file);
    for (const m of bare.matchAll(assign)) {
      const feature = m[1];
      if (seen.has(feature)) continue;
      const at = m.index + m[0].length;
      const ctx = { feature, rows: [], unresolved, literals };
      const expr = bare.slice(at, bare.indexOf("\n", at));
      let found = null;

      if (expr.startsWith("{")) {
        readLiteral(ctx, file, at, "", 1);
        found = { file, index: m.index };
      } else {
        const root = ROOTS[feature];
        const name = root ? root.object : /^([\w$]+)\s*;/.exec(expr)?.[1];
        const decl = name && declarationIn(file, name);
        if (decl?.valueAt != null && decl.kind === "object") {
          readLiteral(ctx, file, bare.indexOf("{", decl.valueAt), "", 1);
          for (const extra of root?.extra ?? []) named(ctx, file, extra, extra, 1, "");
          found = { file, index: decl.index };
        }
      }
      if (!found) {
        unresolved.push({ feature, key: "(root)", why: `assignment "${expr.trim().slice(0, 40)}" in ${rel(file)} is no literal, local object or mapped call` });
        continue;
      }
      seen.add(feature);
      for (const { key, manifest } of repeatedKeys(ctx.rows)) {
        // A repeat between two spreads or hand keys is left to the last-wins rule below.
        if (manifest) unresolved.push({ feature, key, why: `reached twice, at least once through a publicApi manifest; a key has one route` });
      }
      for (const row of ctx.rows) {
        if (row.group) continue;
        if (row.manifest && !row.doc) {
          unresolved.push({ feature, key: row.key, why: `published through ${row.manifest}'s publicApi with no docstring on its declaration (${rel(row.file)}); the API page prints it` });
        }
        if (declaring.has(rel(row.file)) && row.manifest !== rel(row.file)) {
          unresolved.push({ feature, key: row.key, why: `reaches ${rel(row.file)}, which publishes through its publicApi; add it there` });
        }
      }
      // Two spreads can carry one name; the later spread is the value the
      // object holds, so the later row is the one kept.
      const last = new Map(ctx.rows.map((row, i) => [row.key, i]));
      ctx.rows = ctx.rows.filter((row, i) => row.group || last.get(row.key) === i);
      features.push({
        feature,
        file: rel(file),
        line: lineOf(src, m.index + m[0].search(/\S/)),
        doc: docAbove(src, found.index),
        rows: ctx.rows.map(({ index, file: f, ...row }) => ({ ...row, file: rel(f), line: lineOf(read(f).src, index) })),
      });
    }
  }
  // A manifest no namespace read publishes nothing.
  const reached = new Set(literals.filter((l) => l.manifest).map((l) => l.manifest));
  for (const file of declaring) {
    if (!reached.has(file)) unresolved.push({ feature: "(none)", key: "publicApi", why: `${file}'s publicApi is reached by no acksExtras key` });
  }
  features.sort((a, b) => a.feature.localeCompare(b.feature));
  return { features, unresolved };
}
