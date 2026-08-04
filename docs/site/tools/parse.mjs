/**
 * Small source-reading helpers shared by the extractors.
 *
 * These read the module's own runtime source rather than importing it. Importing
 * would be exact, but the files that register settings also pull in sheets and
 * applications whose class bodies touch Foundry globals at module scope, so a
 * headless import needs a mock of the whole platform to get at four literals.
 * Reading is the cheaper contract: it needs no mock, and it fails loudly (a key
 * resolves to `null`) rather than quietly registering nothing.
 */
import fs from "node:fs";
import path from "node:path";

/** Absolute path to the repo root, from `docs/site/tools/`. */
export const REPO = path.resolve(import.meta.dirname, "../../..");

/** Every `.mjs` under a directory, recursively, as absolute paths. */
export function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".mjs")) out.push(full);
  }
  return out;
}

/**
 * Index of the `}` closing the `{` at `start`, skipping over strings, template
 * literals and comments so a brace inside one of them cannot end the block.
 *
 * A `${}` interpolation inside a template literal is deliberately not parsed:
 * the scanner runs to the closing backtick and ignores what is between. That is
 * correct for every interpolation in this codebase (none contains a backtick or
 * an unbalanced brace) and keeps this a scanner rather than a parser.
 *
 * @returns {number} index of the matching brace, or -1 if unbalanced
 */
export function matchBrace(src, start) {
  let depth = 0;
  let quote = null;
  let lineComment = false;
  let blockComment = false;

  for (let i = start; i < src.length; i++) {
    const c = src[i];
    const next = src[i + 1];

    if (lineComment) {
      if (c === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (c === "*" && next === "/") {
        blockComment = false;
        i++;
      }
      continue;
    }
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "/" && next === "/") {
      lineComment = true;
      i++;
      continue;
    }
    if (c === "/" && next === "*") {
      blockComment = true;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  return -1;
}

/**
 * Blank out comments, preserving offsets and leaving string literals alone.
 *
 * Needed before any regex that treats `,` or `{` as a structural boundary: the
 * constant maps in this codebase document half their entries with a preceding
 * `//` line, and a boundary match cannot span one. Replacing with spaces rather
 * than deleting keeps indices aligned with the original source.
 */
export function stripComments(src) {
  const out = src.split("");
  let quote = null;
  let lineComment = false;
  let blockComment = false;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const next = src[i + 1];

    if (lineComment) {
      if (c === "\n") lineComment = false;
      else out[i] = " ";
      continue;
    }
    if (blockComment) {
      if (c === "*" && next === "/") {
        blockComment = false;
        out[i] = " ";
        out[i + 1] = " ";
        i++;
      } else if (c !== "\n") out[i] = " ";
      continue;
    }
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "/" && next === "/") {
      lineComment = true;
      out[i] = " ";
      continue;
    }
    if (c === "/" && next === "*") {
      blockComment = true;
      out[i] = " ";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
  }
  return out.join("");
}

/** Strip a trailing `// comment` and comma from a captured expression. */
export function cleanExpr(text) {
  return text
    .replace(/\/\/.*$/s, "")
    .trim()
    .replace(/,$/, "")
    .trim();
}

/**
 * Map of `const NAME = "literal"` across the given files — both `export`ed and
 * file-local. Values are the string literals only; anything computed is skipped,
 * which is why an unresolvable key surfaces as `null` downstream instead of a
 * plausible-looking wrong answer.
 *
 * @returns {{global: Map<string,string>, byFile: Map<string, Map<string,string>>}}
 */
export function constantIndex(files) {
  const global = new Map();
  const byFile = new Map();
  const re = /^(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*=\s*(["'])((?:\\.|(?!\2).)*)\2\s*;/gm;

  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    const local = new Map();
    for (const m of src.matchAll(re)) {
      local.set(m[1], m[3]);
      if (!global.has(m[1])) global.set(m[1], m[3]);
    }
    byFile.set(file, local);
  }
  return { global, byFile };
}

/**
 * Frozen string-valued object literals, keyed by variable name — e.g. the
 * equipment feature's `SETTINGS` map, which every one of its register calls
 * indexes into.
 *
 * @returns {Map<string, Record<string,string>>}
 */
export function objectConstantIndex(files) {
  const out = new Map();
  const re = /^(?:export\s+)?const\s+([A-Z][A-Za-z0-9_]*)\s*=\s*(?:Object\.freeze\()?\s*\{/gm;

  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    for (const m of src.matchAll(re)) {
      const open = src.indexOf("{", m.index + m[0].length - 1);
      const close = matchBrace(src, open);
      if (close < 0) continue;
      // Leading `{` restored so the first pair matches the same `[{,]` boundary
      // as the rest. Not line-anchored: these maps are written both one-per-line
      // (SETTINGS) and all on one line (ENFORCE), and an anchor reads only the
      // first pair of the single-line form.
      const body = "{" + stripComments(src.slice(open + 1, close));
      const entries = {};
      for (const p of body.matchAll(/[{,]\s*([A-Za-z_$][\w$]*)\s*:\s*(["'])((?:\\.|(?!\2).)*)\2/g)) {
        entries[p[1]] = p[3];
      }
      if (Object.keys(entries).length) out.set(m[1], entries);
    }
  }
  return out;
}

/** The feature directory a script belongs to (`scripts/<feature>/...`). */
export function featureOf(file) {
  const rel = path.relative(path.join(REPO, "scripts"), file).split(path.sep);
  return rel.length > 1 ? rel[0] : "module";
}
