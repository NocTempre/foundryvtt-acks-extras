/**
 * Prose that names a compendium pack the manifest stopped declaring.
 *
 * A pack's label is free text, so nothing in the prose tells one from any
 * other emphasised phrase. The manifest's own history does: every label
 * `module.json` has declared is known to git, and one it declares no longer is
 * retired. `retiredPackNames()` looks for the retired ones in the README, the
 * guides and the site's hand-written pages.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { REPO } from "./parse.mjs";
import { GENERATED } from "./stage-content.mjs";

/** The opening every staged page's header shares, whatever source it names. */
const GENERATED_MARK = GENERATED("").split(" from ")[0];

const git = (...args) =>
  execFileSync("git", ["-C", REPO, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 16 * 1024 * 1024,
  }).trim();

/** A label as prose writes it: whole, and without its trailing parenthetical. */
const forms = (label) => [...new Set([label, label.replace(/\s*\([^)]*\)\s*$/, "")])].filter(Boolean);

/**
 * A pattern for `text` that takes any run of whitespace where it has a space,
 * so a name wrapped across two lines of prose still matches.
 */
const loose = (text) =>
  new RegExp(
    text
      .trim()
      .split(/\s+/)
      .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("\\s+"),
    "g",
  );

/** `text` with every match of `pattern` blanked, line breaks kept so line numbers hold. */
const mask = (text, pattern) => text.replace(pattern, (found) => found.replace(/[^\n]/g, " "));

/**
 * Every pack label `module.json` has declared in a commit, with the commit
 * that dropped it.
 *
 * @returns {{labels: Map<string, string|null>, shallow: boolean}|null} each
 *   label mapped to the short hash of the commit that last removed it, or to
 *   null while the newest commit still declares it; `shallow` when the
 *   checkout carries no history to read, and `labels` is then empty; null when
 *   git cannot answer at all.
 */
export function manifestLabelHistory() {
  const labels = new Map();
  try {
    if (git("rev-parse", "--is-shallow-repository") === "true") return { labels, shallow: true };
    // Only a commit whose diff touches a label line can change the set, and
    // `-m` reads a merge against each parent so a label that arrived or left
    // in one is seen.
    const commits = [...new Set(git("log", "-m", "--reverse", "--format=%h", '-G"label"', "--", "module.json").split("\n").filter(Boolean))];
    for (const commit of commits) {
      let declared;
      try {
        declared = new Set((JSON.parse(git("show", `${commit}:./module.json`)).packs ?? []).map((p) => p.label).filter(Boolean));
      } catch {
        // A manifest that does not parse at one commit declares nothing readable.
        continue;
      }
      for (const [label, dropped] of labels) {
        if (!dropped && !declared.has(label)) labels.set(label, commit);
      }
      for (const label of declared) labels.set(label, null);
    }
    return { labels, shallow: false };
  } catch {
    return null;
  }
}

/**
 * Where `text` names a retired label, whole or without its parenthetical.
 *
 * A declared label is blanked first, so a retired name that opens a declared
 * one is not found inside it. The retired forms are then taken longest first
 * and each is blanked as it is found, so one place is reported once, under the
 * longest name that fits it.
 *
 * @param {string} text the prose to search
 * @param {string[]} declared the labels the manifest declares now
 * @param {string[]} retired the labels it once declared
 * @returns {{label: string, name: string, line: number}[]} `name` is the form
 *   found, `line` is 1-based
 */
export function findRetiredNames(text, declared, retired) {
  let rest = text;
  for (const label of declared) for (const form of forms(label)) rest = mask(rest, loose(form));

  const wanted = retired
    .flatMap((label) => forms(label).map((form) => ({ label, form })))
    .sort((a, b) => b.form.length - a.form.length);
  const found = [];
  for (const { label, form } of wanted) {
    for (const hit of rest.matchAll(loose(form))) {
      found.push({ label, name: form, line: rest.slice(0, hit.index).split("\n").length });
    }
    rest = mask(rest, loose(form));
  }
  return found.sort((a, b) => a.line - b.line);
}

/**
 * The prose a reader is sent to, as `[repo-relative path, text]`: the README,
 * the guides, and each site page that is written by hand rather than staged.
 */
function proseSources() {
  const files = [path.join(REPO, "README.md")];
  const guides = path.join(REPO, "docs", "guides");
  for (const name of fs.readdirSync(guides).sort()) if (name.endsWith(".md")) files.push(path.join(guides, name));

  const pages = path.join(REPO, "docs", "site", "src", "content", "docs");
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.mdx?$/.test(entry.name)) files.push(full);
    }
  };
  walk(pages);

  return files
    .map((file) => [path.relative(REPO, file).split(path.sep).join("/"), fs.readFileSync(file, "utf8")])
    // A staged page is a copy of a source already in the list.
    .filter(([, text]) => !text.includes(GENERATED_MARK));
}

/**
 * Every place the prose names a pack label the manifest no longer declares.
 *
 * @param {string[]} declared the labels `module.json` declares in the working tree
 * @returns {{findings: {file: string, line: number, name: string, removedIn: string|null}[], note: string|null}}
 *   `removedIn` is the commit that dropped the label, or null for one dropped
 *   only in the working tree. `note` says why nothing was checked, when
 *   nothing could be: the label history is git's, and a shallow checkout or a
 *   tree outside git has none.
 */
export function retiredPackNames(declared) {
  const history = manifestLabelHistory();
  if (!history) return { findings: [], note: "pack names in prose were not checked: git could not read module.json's history" };
  if (history.shallow) return { findings: [], note: "pack names in prose were not checked: this checkout is shallow, and module.json's history is what names a retired pack" };

  const retired = [...history.labels.keys()].filter((label) => !declared.includes(label));
  const findings = [];
  for (const [file, text] of proseSources()) {
    for (const hit of findRetiredNames(text, declared, retired)) {
      findings.push({ file, line: hit.line, name: hit.name, removedIn: history.labels.get(hit.label) });
    }
  }
  return { findings, note: null };
}
