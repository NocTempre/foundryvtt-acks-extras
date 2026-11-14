/**
 * The `acksExtras.<namespace>.<path>` a doc writes, held to the namespace the
 * extractor read: a doc that names a call the namespace does not hold sends its
 * reader to a macro that throws.
 *
 * `apiPathProblems` is pure over the extracted features and the docs' text;
 * `docFiles` is the one function here that reads the disk.
 */
import fs from "node:fs";
import path from "node:path";

import { MAX_DEPTH } from "./extract-api.mjs";

/** `acksExtras`, `acksExtras?.`, `globalThis.acksExtras` and what follows, to the first character no path holds. */
const MENTION = /\backsExtras\??\.([A-Za-z0-9_$.?]*)/g;

const depthOf = (key) => key.split(".").length;

/**
 * Whether `segments` (the path under a namespace) reach a row, or reach a row
 * the extractor stopped at: a non-group row, or a group at the follow depth.
 */
function resolves(rows, segments) {
  const keys = new Map(rows.map((r) => [r.key, r]));
  if (keys.has(segments.join("."))) return true;
  for (let i = 1; i < segments.length; i++) {
    const prefix = segments.slice(0, i).join(".");
    const row = keys.get(prefix);
    if (row && (!row.group || depthOf(prefix) >= MAX_DEPTH)) return true;
  }
  return false;
}

/**
 * Every `acksExtras.<namespace>.<path>` in `docs` that the namespace does not hold.
 *
 * A first segment that is no namespace is a hook name and is skipped, as is a
 * mention of a namespace alone.
 *
 * @param {Array<{feature: string, rows: object[]}>} features `extractApi().features`
 * @param {Array<{file: string, text: string}>} docs
 * @returns {string[]}
 */
export function apiPathProblems(features, docs) {
  const rowsOf = new Map(features.map((f) => [f.feature, f.rows]));
  const problems = [];
  for (const { file, text } of docs) {
    for (const m of text.matchAll(MENTION)) {
      const segments = m[1].replace(/\?/g, "").replace(/\.+$/, "").split(".").filter(Boolean);
      if (segments.length < 2 || !rowsOf.has(segments[0])) continue;
      const [namespace, ...rest] = segments;
      if (resolves(rowsOf.get(namespace), rest)) continue;
      const line = text.slice(0, m.index).split("\n").length;
      problems.push(`${file}:${line} names acksExtras.${segments.join(".")}, which the namespace does not hold`);
    }
  }
  return problems;
}

/**
 * The repo's current docs: its README and `docs/**\/*.md`, less the logs, the
 * work in flight, the release shots and the site's own tree.
 *
 * @returns {Array<{file: string, text: string}>} `file` repo-relative, forward slashes
 */
export function docFiles(repo) {
  const out = [];
  const keep = (rel) => {
    const segments = rel.split("/");
    const name = segments.at(-1);
    if (!name.endsWith(".md")) return false;
    if (/^(DECISIONS|CHANGELOG|ROADMAP)/.test(name) || /-through-v/.test(name)) return false;
    return !segments.slice(0, -1).some((s) => s === "wip" || s === "releases" || s === "site");
  };
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(repo, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (!["wip", "releases", "site", "node_modules"].includes(e.name)) walk(rel);
      } else if (keep(rel)) {
        out.push({ file: rel, text: fs.readFileSync(path.join(repo, rel), "utf8").replace(/\r\n/g, "\n") });
      }
    }
  };
  if (fs.existsSync(path.join(repo, "README.md"))) {
    out.push({ file: "README.md", text: fs.readFileSync(path.join(repo, "README.md"), "utf8").replace(/\r\n/g, "\n") });
  }
  if (fs.existsSync(path.join(repo, "docs"))) walk("docs");
  return out;
}
