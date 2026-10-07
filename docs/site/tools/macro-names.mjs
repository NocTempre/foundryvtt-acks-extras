/**
 * Prose that names a macro the pack stopped holding.
 *
 * A macro's name is free text, as a pack's label is, and it is told the same
 * way: every name a macro in the pack source has carried is known to git, and
 * one the pack build makes no longer is retired. `retiredMacroNames()` looks
 * for the retired ones where `retiredPackNames()` looks, and in each feature's
 * MODEL.md and TESTING.md.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { REPO } from "./parse.mjs";
import { isFolder } from "./extract-packs.mjs";
import { findRetiredNames, git, proseSources } from "./pack-names.mjs";

/** The macro pack's source: a JSON file for each macro and each folder, rewritten by the pack build. */
const MACRO_SOURCE = "packs/_source/macros";

/**
 * The text of each object in `ids`, read by one git process.
 *
 * @param {string[]} ids object names, whole or abbreviated
 * @returns {Map<string, string>} keyed by the id as given; an object git
 *   cannot give is absent
 */
function blobs(ids) {
  const texts = new Map();
  if (!ids.length) return texts;
  const out = execFileSync("git", ["-C", REPO, "cat-file", "--batch"], {
    input: ids.join("\n") + "\n",
    stdio: ["pipe", "pipe", "ignore"],
    maxBuffer: 64 * 1024 * 1024,
  });
  // An answer is `<name> <type> <bytes>`, a line break, that many bytes and a
  // line break; an object git cannot give is the one line, with no length.
  // The length counts bytes, so the buffer is cut before it is decoded.
  let at = 0;
  for (const id of ids) {
    const eol = out.indexOf("\n", at);
    const bytes = Number(out.toString("utf8", at, eol).split(" ")[2]);
    at = eol + 1;
    if (!Number.isFinite(bytes)) continue;
    texts.set(id, out.toString("utf8", at, at + bytes));
    at += bytes + 1;
  }
  return texts;
}

/**
 * Every name a macro in the pack source has carried in a commit, with the
 * commit that dropped it.
 *
 * @returns {{names: Map<string, string|null>, shallow: boolean}|null} each
 *   name mapped to the short hash of the commit that last removed it, or to
 *   null while the newest commit to touch it still holds it; `shallow` when
 *   the checkout carries no history to read, and `names` is then empty; null
 *   when git cannot answer, or holds no commit of the source to read.
 */
export function macroNameHistory() {
  const names = new Map();
  try {
    if (git("rev-parse", "--is-shallow-repository") === "true") return { names, shallow: true };
    // A raw line for each file a commit changed, holding the object it
    // replaced and the one it wrote. `-m` reads a merge against each parent,
    // `--root` reads the first commit whatever `log.showRoot` says, and a
    // rename stays a removal and an addition.
    const commits = [];
    for (const line of git("log", "--topo-order", "-m", "--root", "--raw", "--no-renames", "--format=%h", "--", MACRO_SOURCE).split("\n")) {
      const change = line.match(/^:\d+ \d+ ([0-9a-f]+) ([0-9a-f]+) /);
      if (change) commits.at(-1).changes.push({ before: change[1], after: change[2] });
      else if (line) commits.push({ hash: line, changes: [] });
    }
    // A copy of the tree kept inside another repository is answered by that
    // repository, which holds no commit of this source.
    if (!commits.length) return null;
    const ids = new Set(commits.flatMap((commit) => commit.changes.flatMap((change) => [change.before, change.after])));
    // The absent side of an addition or a removal is all zeroes.
    const texts = blobs([...ids].filter((id) => /[^0]/.test(id)));
    const nameOf = (id) => {
      try {
        const doc = JSON.parse(texts.get(id));
        return typeof doc.name === "string" && !isFolder(doc) ? doc.name : null;
      } catch {
        // An absent side, or a source that does not parse at that commit.
        return null;
      }
    };
    // Newest first, so the first commit to touch a name says where it stands.
    // One that both removes a name and writes it has only moved it.
    for (const { hash, changes } of commits) {
      const written = changes.map((change) => nameOf(change.after)).filter(Boolean);
      const replaced = changes.map((change) => nameOf(change.before)).filter(Boolean);
      for (const name of written) if (!names.has(name)) names.set(name, null);
      for (const name of replaced) if (!names.has(name)) names.set(name, hash);
    }
    return { names, shallow: false };
  } catch {
    return null;
  }
}

/**
 * Each MODEL.md and TESTING.md in `docs/` or in a feature's directory under
 * it, as `[repo-relative path, text]`: what says how the module works now and
 * how to walk it.
 */
function featureDocs() {
  const docs = path.join(REPO, "docs");
  const features = fs
    .readdirSync(docs, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  return ["", ...features]
    .flatMap((feature) => ["MODEL.md", "TESTING.md"].map((name) => path.join(docs, feature, name)))
    .filter((file) => fs.existsSync(file))
    .map((file) => [path.relative(REPO, file).split(path.sep).join("/"), fs.readFileSync(file, "utf8")]);
}

/**
 * Every place the prose names a macro the pack no longer holds.
 *
 * @param {string[]} held the names of the macros the pack build makes now
 * @returns {{findings: {file: string, line: number, name: string, removedIn: string|null}[], note: string|null}}
 *   `removedIn` is the commit that dropped the name, or null for one the
 *   committed source still holds. `note` says why nothing was checked, when
 *   nothing could be: the name history is git's, and a shallow checkout or a
 *   tree outside git has none.
 */
export function retiredMacroNames(held) {
  const history = macroNameHistory();
  if (!history) return { findings: [], note: "macro names in prose were not checked: git could not read the macro pack source's history" };
  if (history.shallow) return { findings: [], note: "macro names in prose were not checked: this checkout is shallow, and the macro pack source's history is what names a retired macro" };

  const retired = [...history.names.keys()].filter((name) => !held.includes(name));
  const findings = [];
  for (const [file, text] of [...proseSources(), ...featureDocs()]) {
    for (const hit of findRetiredNames(text, held, retired)) {
      findings.push({ file, line: hit.line, name: hit.name, removedIn: history.names.get(hit.label) });
    }
  }
  return { findings, note: null };
}
