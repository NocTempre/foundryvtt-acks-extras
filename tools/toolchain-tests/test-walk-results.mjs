/**
 * Checks `tools/walk-results.mjs`: the reducer from a walk's printed
 * lines to a state, the runtime tree id, the walk's blob id, the result file's
 * merge rules and the verdict `evaluate` gives each required walk.
 *
 * Tree cases run in throwaway git repositories under the OS temp directory.
 * They check which edits leave the id alone (the changelog, the readme,
 * `module.json`'s version and URLs, a line-ending flip, a doc, a walk, an
 * ignored file) and which move it, that a working tree and the commit it
 * becomes give one id under `core.autocrlf` and under CRLF files on disk, that
 * the repository's own index is untouched, and that `git diff-tree` between two
 * ids names exactly the edited path. A parity case holds `ZIP_DENYLIST` equal
 * to the zip step of `.github/workflows/release.yml`.
 *
 * Usage:  node tools/toolchain-tests/test-walk-results.mjs [<walk-results.mjs>]
 *         (defaults to tools/walk-results.mjs; pass a modified copy to
 *         confirm a case fails when the behaviour it guards is broken)
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";

const TEMPLATE_ROOT = path.dirname(path.dirname(path.dirname(url.fileURLToPath(import.meta.url))));
const LIB = path.resolve(process.argv[2] ?? path.join(TEMPLATE_ROOT, "tools", "walk-results.mjs"));
const W = await import(url.pathToFileURL(LIB).href);

// A caller's own repository variables would turn every git call toward the
// caller's repository, and a runner has no identity to commit as.
for (const key of Object.keys(process.env)) if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|PREFIX)$/iu.test(key)) delete process.env[key];
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "test", GIT_AUTHOR_EMAIL: "test@example.invalid", GIT_COMMITTER_NAME: "test", GIT_COMMITTER_EMAIL: "test@example.invalid" };
const git = (root, args) => execFileSync("git", args, { cwd: root, env: GIT_ENV, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "test-walk-results-"));
let counter = 0;
const put = (root, rel, content) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), content);
};
const crlf = (text) => text.replace(/\n/gu, "\r\n");

// Every file below is invented.
const MODULE_JSON = (extra = {}) => `${JSON.stringify({ id: "widget", title: "Widget", version: "1.0.0", download: "https://example.invalid/1.0.0/module.zip", manifest: "https://example.invalid/module.json", ...extra }, null, 2)}\n`;
const BASE = {
  "module.json": MODULE_JSON(),
  "CHANGELOG.md": "# Changelog\n\n## 1.0.0\n\n- One.\n",
  "README.md": "# Widget\n",
  "LICENSE": "License text.\n",
  "docs/guide.md": "A guide.\n",
  "scripts/a.mjs": "export const a = 1;\nexport const b = 2;\n",
  "scripts/b.mjs": "export const c = 3;\n",
  "templates/x.hbs": "<p>{{x}}</p>\n",
  "packs/_source/items/one.json": "{\n  \"name\": \"One\"\n}\n",
  "tools/live/x.mjs": "console.log('PASS one');\n",
  "tools/live/_h.mjs": "export const h = 1;\n",
  "tools/live/run.mjs": "// runner\n",
  "vendor/blob.bin": Buffer.from([0x41, 0x0d, 0x0a, 0x00, 0x42, 0x0d, 0x0a]),
  "scripts/odd name é.mjs": "export const odd = 1;\n",
  ".gitignore": "scratch/\npacks/*\n!packs/_source/\n",
};

/** A committed repository holding BASE plus `extra`; `autocrlf` sets core.autocrlf. */
function makeRepo({ autocrlf = "false", extra = {}, crlfOnDisk = false } = {}) {
  const root = path.join(tmp, `repo-${counter++}`);
  fs.mkdirSync(root, { recursive: true });
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "core.autocrlf", autocrlf]);
  for (const [rel, content] of Object.entries({ ...BASE, ...extra })) put(root, rel, content);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "--no-verify", "-m", "base"]);
  if (crlfOnDisk) {
    // The commit holds LF; the working tree holds CRLF, as a Windows checkout does.
    for (const rel of ["scripts/a.mjs", "scripts/b.mjs", "templates/x.hbs", "module.json", "packs/_source/items/one.json"]) {
      put(root, rel, crlf(fs.readFileSync(path.join(root, rel), "utf8")));
    }
  }
  return root;
}

const treeOf = (root, opts) => W.runtimeTree(root, opts).tree;
const diffNames = (root, a, b) => git(root, ["diff-tree", "-r", "--name-only", a, b]).split("\n").filter(Boolean);

// -- reducer fixtures ----------------------------------------------------------
const ERRORED_WALK = ["== seats ==", "seat one: taken", "WALK ERROR: could not seat", "== teardown ==", "swept 0", "== summary ==", "0/0 passed"];
const reduceCase = (name, lines, opts, state, tally) => ({
  name: `reduce: ${name}`,
  run: () => {
    const r = W.reduce(lines, opts);
    const problems = [];
    if (r.state !== state) problems.push(`state ${r.state}, expected ${state}`);
    for (const [k, v] of Object.entries(tally ?? {})) if (r.tally[k] !== v) problems.push(`tally.${k} ${r.tally[k]}, expected ${v}`);
    return problems;
  },
});

// -- evaluate fixtures ---------------------------------------------------------
const T1 = "1".repeat(40);
const T2 = "2".repeat(40);
const B1 = "a".repeat(40);
const B2 = "b".repeat(40);
const entry = (over = {}) => ({
  state: "passed", tally: { pass: 3, fail: 0, gap: 0 }, exit: 0, signal: null,
  treeStart: T1, treeEnd: T1, walkBlob: B1, partial: false,
  startedAt: "2026-01-01T00:00:00.000Z", endedAt: "2026-01-01T00:01:00.000Z", ...over,
});
const verdict = (e, over = {}) => W.evaluate({
  data: e === undefined ? { schema: 1, walks: {} } : { schema: 1, walks: { w: e } },
  required: ["w"], tree: T1, walkBlobs: { w: B1 }, version: "2.0.0", ...over,
})[0];
const classified = (as, status, over = {}) => entry({ state: "failed", tally: { pass: 1, fail: 1, gap: 0 }, classification: { row: "T-0042", as, status, version: "2.0.0", at: "2026-01-02T00:00:00.000Z" }, ...over });
const evalCase = (name, e, over, ok, whyRe) => ({
  name: `evaluate: ${name}`,
  run: () => {
    const v = verdict(e, over);
    const problems = [];
    if (v.ok !== ok) problems.push(`ok ${v.ok}, expected ${ok} (${v.why})`);
    if (whyRe && !whyRe.test(v.why)) problems.push(`why "${v.why}" does not match ${whyRe}`);
    return problems;
  },
});

/** A tree case: an edit that must keep or move the id. */
const treeCase = (name, mutate, same, opts = {}) => ({
  name: `tree: ${name} ${same ? "leaves" : "moves"} the id`,
  run: () => {
    const root = makeRepo(opts);
    const before = treeOf(root);
    mutate(root);
    const after = treeOf(root);
    return (before === after) === same ? [] : [`id ${same ? "changed" : "did not change"}: ${before} -> ${after}`];
  },
});

const CASES = [
  // -- reducer ---------------------------------------------------------------
  reduceCase("a walk that reports WALK ERROR is errored", ERRORED_WALK, { exit: 0 }, "errored"),
  reduceCase("the same without the WALK ERROR line is stopped", ERRORED_WALK.filter((l) => !l.startsWith("WALK ERROR")), { exit: 0 }, "stopped"),
  reduceCase("two PASS, WALK END and a summary that lists them again is passed with pass 2",
    ["PASS one", "PASS two", "WALK END", "== summary ==", "PASS one", "PASS two", "2/2 passed"], { exit: 0 }, "passed", { pass: 2, fail: 0, gap: 0 }),
  reduceCase("a FAIL is failed with its tally", ["PASS one", "FAIL two", "PASS three", "WALK END", "== summary =="], { exit: 1 }, "failed", { pass: 2, fail: 1 }),
  reduceCase("a FAIL only in the summary is not counted", ["PASS one", "WALK END", "== summary ==", "FAIL one"], { exit: 0 }, "passed", { pass: 1, fail: 0 }),
  reduceCase("a GAP is counted and does not redden a passing walk", ["GAP not reachable", "PASS one", "WALK END"], { exit: 0 }, "passed", { pass: 1, gap: 1 }),
  reduceCase("a non-zero exit with no FAIL is errored", ["PASS one", "WALK END"], { exit: 2 }, "errored"),
  reduceCase("a null exit with no signal is errored", ["PASS one", "WALK END"], { exit: null }, "errored"),
  reduceCase("a signal is errored, even over a clean tail", ["PASS one", "WALK END"], { exit: null, signal: "SIGTERM" }, "errored"),
  reduceCase("a signal outranks a WALK BLOCKED line", ["WALK BLOCKED: seat taken"], { exit: null, signal: "SIGKILL" }, "errored"),
  reduceCase("WALK BLOCKED is blocked even beside a WALK ERROR line", ["WALK BLOCKED: seat taken", "WALK ERROR: after"], { exit: 0 }, "blocked"),
  reduceCase("WALK ERROR outranks a FAIL", ["FAIL one", "WALK ERROR: boom"], { exit: 1 }, "errored"),
  reduceCase("a PASS and exit 0 without WALK END is stopped", ["PASS one"], { exit: 0 }, "stopped", { pass: 1 }),
  reduceCase("WALK END with no PASS is stopped", ["WALK END", "== summary =="], { exit: 0 }, "stopped"),
  reduceCase("a GAP alone with WALK END is stopped", ["GAP nothing reachable", "WALK END"], { exit: 0 }, "stopped", { gap: 1 }),
  reduceCase("CRLF lines reduce like LF lines", ["PASS one\r", "PASS two\r", "WALK END\r", "== summary ==\r", "PASS one\r"], { exit: 0 }, "passed", { pass: 2 }),
  reduceCase("a PASS-prefixed word is not a check", ["PASSED one", "WALK END"], { exit: 0 }, "stopped", { pass: 0 }),
  reduceCase("a string of lines is split", "PASS one\nWALK END\n", { exit: 0 }, "passed", { pass: 1 }),

  // -- walk lists ------------------------------------------------------------
  {
    name: "listWalks keeps direct tools/live walks, sorted, less _ helpers and run",
    run: () => {
      const got = W.listWalks(["tools/live/zeta.mjs", "tools/live/run.mjs", "tools/live/_h.mjs", "tools/live/alpha.mjs", "tools/live/sub/deep.mjs", "tools/live/notes.md", "scripts/x.mjs"]);
      return JSON.stringify(got) === JSON.stringify(["alpha", "zeta"]) ? [] : [`got ${JSON.stringify(got)}`];
    },
  },
  {
    name: "walksNamedBy reads walk names out of a recipe and skips _ helpers and run",
    run: () => {
      const got = [...W.walksNamedBy("Run `tools/live/alpha.mjs`, then tools/live/b-two.mjs. Not tools/live/_h.mjs or tools/live/run.mjs or tools/live/sub/c.mjs.")].sort();
      return JSON.stringify(got) === JSON.stringify(["alpha", "b-two"]) ? [] : [`got ${JSON.stringify(got)}`];
    },
  },

  // -- tree id ---------------------------------------------------------------
  treeCase("a CHANGELOG.md edit", (r) => put(r, "CHANGELOG.md", "# Changelog\n\n## 1.0.1\n"), true),
  treeCase("a README.md edit", (r) => put(r, "README.md", "# Changed\n"), true),
  treeCase("a LICENSE edit", (r) => put(r, "LICENSE", "Other.\n"), true),
  treeCase("a module.json version, download and manifest change", (r) => put(r, "module.json", MODULE_JSON({ version: "9.9.9", download: "https://example.invalid/9/module.zip", manifest: "https://example.invalid/9/module.json" })), true),
  treeCase("a module.json BOM and CRLF flip", (r) => put(r, "module.json", `﻿${crlf(MODULE_JSON())}`), true),
  treeCase("a module.json title change", (r) => put(r, "module.json", MODULE_JSON({ title: "Other" })), false),
  treeCase("a CRLF flip of a scripts file", (r) => put(r, "scripts/a.mjs", crlf(fs.readFileSync(path.join(r, "scripts/a.mjs"), "utf8"))), true),
  treeCase("a docs edit", (r) => put(r, "docs/guide.md", "Changed.\n"), true),
  treeCase("a tools/live edit", (r) => put(r, "tools/live/x.mjs", "console.log('PASS other');\n"), true),
  treeCase("an untracked gitignored file", (r) => put(r, "scratch/junk.txt", "junk\n"), true),
  treeCase("a scripts byte change", (r) => put(r, "scripts/a.mjs", "export const a = 2;\nexport const b = 2;\n"), false),
  treeCase("a packs/_source change", (r) => put(r, "packs/_source/items/one.json", "{\n  \"name\": \"Two\"\n}\n"), false),
  treeCase("an untracked non-ignored scripts file", (r) => put(r, "scripts/new.mjs", "export const n = 1;\n"), false),
  treeCase("a tracked file deleted from disk", (r) => fs.rmSync(path.join(r, "scripts/b.mjs")), false),
  treeCase("a change to a binary file's CRLF bytes", (r) => put(r, "vendor/blob.bin", Buffer.from([0x41, 0x0a, 0x00, 0x42, 0x0d, 0x0a])), false),
  {
    name: "tree: the id of a clean working tree equals the id at HEAD",
    run: () => {
      const root = makeRepo();
      const wt = treeOf(root);
      const head = treeOf(root, { at: "HEAD" });
      return wt === head ? [] : [`working tree ${wt}, HEAD ${head}`];
    },
  },
  {
    name: "tree: core.autocrlf true gives the same id for the working tree and HEAD",
    run: () => {
      const root = makeRepo({ autocrlf: "true", crlfOnDisk: true });
      const wt = treeOf(root);
      const head = treeOf(root, { at: "HEAD" });
      return wt === head ? [] : [`working tree ${wt}, HEAD ${head}`];
    },
  },
  {
    name: "tree: CRLF files on disk over an LF commit give the same id for the working tree and HEAD",
    run: () => {
      const root = makeRepo({ crlfOnDisk: true });
      const wt = treeOf(root);
      const head = treeOf(root, { at: "HEAD" });
      const lf = treeOf(makeRepo());
      return [...(wt === head ? [] : [`working tree ${wt}, HEAD ${head}`]), ...(head === lf ? [] : [`HEAD ${head}, an LF checkout ${lf}`])];
    },
  },
  {
    name: "tree: an id taken at a commit with a docs-only difference equals the id of the other",
    run: () => {
      const root = makeRepo();
      put(root, "docs/guide.md", "Second.\n");
      put(root, "CHANGELOG.md", "# Changelog\n\n## 1.0.1\n");
      git(root, ["commit", "-q", "--no-verify", "-am", "docs"]);
      const a = treeOf(root, { at: "HEAD~1" });
      const b = treeOf(root, { at: "HEAD" });
      return a === b ? [] : [`${a} vs ${b}`];
    },
  },
  {
    name: "tree: the repository's own index and status are untouched, a staged edit included",
    run: () => {
      const root = makeRepo();
      put(root, "scripts/a.mjs", "export const a = 5;\n");
      git(root, ["add", "scripts/a.mjs"]);
      put(root, "scripts/new.mjs", "export const n = 1;\n");
      const snap = () => ({
        index: fs.readFileSync(path.join(root, ".git", "index")).toString("hex"),
        staged: git(root, ["ls-files", "-s"]),
        status: git(root, ["status", "--porcelain"]),
        cached: (() => { try { git(root, ["diff", "--cached", "--quiet"]); return 0; } catch (e) { return e.status; } })(),
      });
      const before = snap();
      treeOf(root);
      treeOf(root, { at: "HEAD" });
      const after = snap();
      return Object.keys(before).filter((k) => before[k] !== after[k]).map((k) => `${k} changed`);
    },
  },
  {
    name: "tree: an inherited GIT_INDEX_FILE and GIT_DIR are ignored",
    run: () => {
      const root = makeRepo();
      const decoy = path.join(tmp, "decoy-index");
      const want = treeOf(root);
      process.env.GIT_INDEX_FILE = decoy;
      process.env.GIT_DIR = path.join(tmp, "nowhere");
      try {
        const got = treeOf(root);
        return [...(got === want ? [] : [`${got} vs ${want}`]), ...(fs.existsSync(decoy) ? ["the inherited index file was written"] : [])];
      } finally {
        delete process.env.GIT_INDEX_FILE;
        delete process.env.GIT_DIR;
      }
    },
  },
  {
    name: "tree: git diff-tree between two ids names exactly the edited path, for both sources",
    run: () => {
      const root = makeRepo();
      const a = treeOf(root);
      put(root, "scripts/a.mjs", "export const a = 9;\n");
      put(root, "CHANGELOG.md", "# Changelog\n\nmore\n");
      const b = treeOf(root);
      git(root, ["commit", "-q", "--no-verify", "-am", "edit"]);
      const c = treeOf(root, { at: "HEAD" });
      const problems = [];
      const names = diffNames(root, a, b);
      if (JSON.stringify(names) !== JSON.stringify(["scripts/a.mjs"])) problems.push(`working tree diff named ${JSON.stringify(names)}`);
      if (b !== c) problems.push(`working tree ${b}, committed ${c}`);
      const odd = diffNames(root, a, c);
      if (JSON.stringify(odd) !== JSON.stringify(["scripts/a.mjs"])) problems.push(`commit diff named ${JSON.stringify(odd)}`);
      return problems;
    },
  },
  {
    name: "tree: a repository with no runtime files gives the empty tree",
    run: () => {
      const root = path.join(tmp, `repo-${counter++}`);
      fs.mkdirSync(root, { recursive: true });
      git(root, ["init", "-q", "-b", "main"]);
      put(root, "docs/x.md", "x\n");
      git(root, ["add", "-A"]);
      git(root, ["commit", "-q", "-m", "docs only"]);
      const empty = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
      const wt = treeOf(root);
      const head = treeOf(root, { at: "HEAD" });
      return wt === empty && head === empty ? [] : [`working tree ${wt}, HEAD ${head}`];
    },
  },

  // -- walk blob -------------------------------------------------------------
  {
    name: "walkBlob: changes on a walk edit, not on a CRLF flip, not on a helper edit; null when absent",
    run: () => {
      const root = makeRepo();
      const base = W.walkBlob(root, "x");
      const problems = [];
      if (!/^[0-9a-f]{40}$/u.test(base ?? "")) problems.push(`base ${base}`);
      if (W.walkBlob(root, "x", { at: "HEAD" }) !== base) problems.push("HEAD differs from the working tree");
      put(root, "tools/live/_h.mjs", "export const h = 2;\n");
      if (W.walkBlob(root, "x") !== base) problems.push("a helper edit moved the walk's blob");
      put(root, "tools/live/x.mjs", crlf(fs.readFileSync(path.join(root, "tools/live/x.mjs"), "utf8")));
      if (W.walkBlob(root, "x") !== base) problems.push("a CRLF flip moved the blob");
      put(root, "tools/live/x.mjs", "console.log('PASS changed');\n");
      if (W.walkBlob(root, "x") === base) problems.push("an edit left the blob alone");
      if (W.walkBlob(root, "x", { at: "HEAD" }) !== base) problems.push("HEAD moved with a working-tree edit");
      if (W.walkBlob(root, "absent") !== null) problems.push("an absent walk is not null");
      if (W.walkBlob(root, "absent", { at: "HEAD" }) !== null) problems.push("an absent walk at HEAD is not null");
      return problems;
    },
  },

  // -- the zip list ----------------------------------------------------------
  {
    name: "denylist: ZIP_DENYLIST equals the release workflow's zip -x globs",
    run: () => {
      const text = fs.readFileSync(path.join(TEMPLATE_ROOT, ".github", "workflows", "release.yml"), "utf8").replace(/\r\n/gu, "\n");
      const start = text.indexOf("zip -r module.zip");
      if (start < 0) return ["the workflow has no zip -r module.zip step"];
      const lines = text.slice(start).split("\n");
      const stanza = [];
      for (const line of lines) {
        stanza.push(line);
        if (!line.trimEnd().endsWith("\\")) break;
      }
      const globs = [...stanza.join("\n").matchAll(/'([^']+)'/gu)].map((m) => m[1]);
      const want = [...globs].sort();
      const have = [...W.ZIP_DENYLIST].sort();
      return JSON.stringify(want) === JSON.stringify(have) ? [] : [`workflow ${JSON.stringify(want)}`, `ZIP_DENYLIST ${JSON.stringify(have)}`];
    },
  },
  {
    name: "denylist: the zip itself leaves out every dot-git path, the commit hooks included",
    run: () => {
      // zip's own -x matching, kept apart from RUNTIME_EXCLUDES: a path only
      // that list holds is still shipped in module.zip.
      const zipDenies = (rel) => W.ZIP_DENYLIST.some((glob) =>
        new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/gu, "\\$&").replace(/\*/gu, ".*")}$`, "su").test(rel));
      const want = { ".githooks/pre-commit": true, ".git/config": true, ".github/workflows/release.yml": true, ".gitignore": true, ".gitattributes": true, "scripts/module.mjs": false, "module.json": false };
      return Object.entries(want).filter(([p, v]) => zipDenies(p) !== v).map(([p, v]) => `${p}: expected the zip to ${v ? "leave it out" : "ship it"}`);
    },
  },
  {
    name: "denylist: the matcher follows zip's globs",
    run: () => {
      const want = {
        "tools/live/x.mjs": false, "tools/walk.mjs": false, "docs/a/b.md": false, "CLAUDE.md": false, "scripts/CLAUDE.md": true,
        "package.json": false, "vendor/package.json": true, "CHANGELOG.md": false, "README.md": false, "LICENSE": false, "LICENSE.txt": false,
        "scripts/README.md": true, "CHANGELOG-through-v1.md": false, "packs/_source/a/b.json": true, "packs/a.db": true,
        "scripts/module.mjs": true, "module.json": true, ".githooks/pre-commit": false, "aia-tmp/live/walk-results.json": false, ".claude/x": false, "node_modules/a/b": false,
      };
      return Object.entries(want).filter(([p, v]) => W.isRuntimePath(p) !== v).map(([p, v]) => `${p}: expected ${v ? "runtime" : "not runtime"}`);
    },
  },

  // -- the result file -------------------------------------------------------
  {
    name: "merge: two walks recorded are both kept, and the file holds no temp file",
    run: () => {
      const root = path.join(tmp, `plain-${counter++}`);
      W.recordAttempt(root, "alpha", entry());
      W.recordAttempt(root, "beta", entry({ state: "stopped" }));
      const { data, error } = W.readResults(root);
      if (error) return [`readResults: ${error}`];
      const left = fs.readdirSync(path.dirname(path.join(root, W.RESULT_PATH)));
      return [
        ...(JSON.stringify(Object.keys(data.walks)) === JSON.stringify(["alpha", "beta"]) ? [] : [`walks ${JSON.stringify(Object.keys(data.walks))}`]),
        ...(data.walks.beta.state === "stopped" && data.schema === W.SCHEMA ? [] : ["beta's state or the schema is wrong"]),
        ...(JSON.stringify(left) === JSON.stringify([path.basename(W.RESULT_PATH)]) ? [] : [`directory holds ${JSON.stringify(left)}`]),
      ];
    },
  },
  {
    name: "merge: re-recording a walk replaces it and drops its classification",
    run: () => {
      const root = path.join(tmp, `plain-${counter++}`);
      W.recordAttempt(root, "alpha", entry({ state: "failed" }));
      W.recordAttempt(root, "beta", entry());
      W.recordClassification(root, "alpha", { row: "T-0042", as: "world-state", status: "new", version: "2.0.0" });
      const c = W.readResults(root).data.walks.alpha.classification;
      const problems = c && c.row === "T-0042" && c.as === "world-state" && c.status === "new" && c.version === "2.0.0" && c.at ? [] : [`classification ${JSON.stringify(c)}`];
      W.recordAttempt(root, "alpha", entry({ state: "errored" }));
      const { data } = W.readResults(root);
      if (data.walks.alpha.classification) problems.push("the classification survived a new attempt");
      if (data.walks.alpha.state !== "errored") problems.push("the attempt was not replaced");
      if (data.walks.beta.state !== "passed") problems.push("beta was disturbed");
      return problems;
    },
  },
  {
    name: "merge: recordClassification refuses an absent walk, a bad class, row, status or version",
    run: () => {
      const root = path.join(tmp, `plain-${counter++}`);
      W.recordAttempt(root, "alpha", entry({ state: "failed" }));
      const good = { row: "T-0042", as: "environment", status: "claimed", version: "2.0.0" };
      const problems = [];
      const refuses = (label, name, over) => {
        try {
          W.recordClassification(root, name, { ...good, ...over });
          problems.push(`${label}: did not throw`);
        } catch { /* expected */ }
      };
      refuses("absent walk", "gamma", {});
      refuses("bad class", "alpha", { as: "bug" });
      refuses("bad row", "alpha", { row: "42" });
      refuses("short row", "alpha", { row: "T-12" });
      refuses("bad status", "alpha", { status: "fixed" });
      refuses("no version", "alpha", { version: "" });
      if (W.readResults(root).data.walks.alpha.classification) problems.push("a refused call left a classification");
      return problems;
    },
  },
  {
    name: "merge: recordAttempt refuses a bad state, a short tree and a missing field",
    run: () => {
      const root = path.join(tmp, `plain-${counter++}`);
      const problems = [];
      for (const [label, over] of [["state", { state: "green" }], ["tree", { treeStart: "abc" }], ["end tree", { treeEnd: null }], ["blob", { walkBlob: "" }], ["tally", { tally: { pass: 1 } }], ["partial", { partial: true }]]) {
        try {
          W.recordAttempt(root, "alpha", entry(over));
          problems.push(`${label}: did not throw`);
        } catch { /* expected */ }
      }
      if (fs.existsSync(path.join(root, W.RESULT_PATH))) problems.push("a refused entry wrote the file");
      return problems;
    },
  },
  {
    name: "merge: readResults reports a missing, garbage, other-schema and shapeless file",
    run: () => {
      const root = path.join(tmp, `plain-${counter++}`);
      const problems = [];
      const expect = (label, want) => {
        const got = W.readResults(root);
        if (got.error !== want) problems.push(`${label}: ${JSON.stringify(got)}, expected error "${want}"`);
      };
      expect("missing", "missing");
      put(root, W.RESULT_PATH, "{ not json");
      expect("garbage", "unreadable");
      put(root, W.RESULT_PATH, JSON.stringify({ schema: 2 }));
      expect("schema 2", "schema 2");
      put(root, W.RESULT_PATH, JSON.stringify({ schema: 1 }));
      expect("no walks", "unreadable");
      put(root, W.RESULT_PATH, JSON.stringify([1]));
      expect("an array", "unreadable");
      put(root, W.RESULT_PATH, JSON.stringify({ schema: 1, walks: {} }));
      if (!W.readResults(root).data) problems.push("a valid empty file did not read");
      // A recorded attempt over garbage starts the file again rather than failing the run.
      put(root, W.RESULT_PATH, "{ not json");
      W.recordAttempt(root, "alpha", entry());
      if (!W.readResults(root).data?.walks.alpha) problems.push("recording over garbage did not leave a readable file");
      return problems;
    },
  },

  // -- evaluate --------------------------------------------------------------
  evalCase("no entry is not run", undefined, {}, false, /^not run$/u),
  evalCase("a passed walk on the current tree is ok", entry(), {}, true, /^passed$/u),
  evalCase("a changed walk is stale", entry({ walkBlob: B2 }), {}, false, /^stale: the walk changed since it ran$/u),
  evalCase("a walk with no current blob is stale", entry(), { walkBlobs: {} }, false, /^stale: the walk changed/u),
  evalCase("a tree that moved during the run is refused", entry({ treeEnd: T2 }), {}, false, /^the runtime changed during its run$/u),
  evalCase("a different runtime is stale", entry({ treeStart: T2, treeEnd: T2 }), {}, false, /^stale: runtime differs$/u),
  evalCase("with since, a different runtime is current when the walk ran after it", entry({ treeStart: T2, treeEnd: T2 }),
    { since: "2025-12-31T00:00:00Z" }, true, /^passed$/u),
  evalCase("with since, a walk that ran before it is stale", entry(),
    { since: "2026-02-01T00:00:00Z" }, false, /^stale: it ran before the last release \(2026-02-01T00:00:00Z\)$/u),
  evalCase("with since, a runtime that changed during the run is still refused", entry({ treeStart: T1, treeEnd: T2 }),
    { since: "2025-12-31T00:00:00Z" }, false, /^the runtime changed during its run$/u),
  evalCase("with since, a passed walk whose file changed stands and says so", entry({ walkBlob: B2 }),
    { since: "2025-12-31T00:00:00Z" }, true, /^passed; the walk's file changed since$/u),
  evalCase("with since, a failed walk whose file changed is stale", entry({ state: "failed", walkBlob: B2 }),
    { since: "2025-12-31T00:00:00Z" }, false, /^stale: the walk changed since it ran$/u),
  evalCase("with since, a classified walk whose file changed is stale", classified("world-state", "new", { walkBlob: B2 }),
    { since: "2025-12-31T00:00:00Z" }, false, /^stale: the walk changed since it ran$/u),
  evalCase("with since, a passed walk whose file changed and that ran before it is refused as before the release", entry({ walkBlob: B2 }),
    { since: "2026-02-01T00:00:00Z" }, false, /^stale: it ran before the last release \(2026-02-01T00:00:00Z\)$/u),
  evalCase("with since, a passed walk whose file changed and whose tree moved is refused", entry({ walkBlob: B2, treeEnd: T2 }),
    { since: "2025-12-31T00:00:00Z" }, false, /^the runtime changed during its run$/u),
  evalCase("with since, a partial walk whose file changed is refused", entry({ walkBlob: B2, partial: "stopped after check 3" }),
    { since: "2025-12-31T00:00:00Z" }, false, /^partial: stopped after check 3$/u),
  evalCase("with since, a walk in treeBound is held to the tree, naming the paths that differ", entry({ treeStart: T2, treeEnd: T2 }),
    { since: "2025-12-31T00:00:00Z", treeBound: ["w"], diffPaths: () => ["scripts/x.mjs"] }, false, /^stale: runtime differs — scripts\/x\.mjs$/u),
  evalCase("with since, a treeBound walk on the current tree stands whatever its start time", entry(),
    { since: "2026-02-01T00:00:00Z", treeBound: ["w"] }, true, /^passed$/u),
  evalCase("with since, a treeBound walk whose file changed still stands when it passed", entry({ walkBlob: B2 }),
    { since: "2025-12-31T00:00:00Z", treeBound: ["w"] }, true, /^passed; the walk's file changed since$/u),
  evalCase("with since, a walk outside treeBound keeps the since test", entry({ treeStart: T2, treeEnd: T2 }),
    { since: "2025-12-31T00:00:00Z", treeBound: ["other"] }, true, /^passed$/u),
  evalCase("without since, every walk is held to the tree and treeBound changes nothing", entry({ treeStart: T2, treeEnd: T2 }),
    { treeBound: ["w"], diffPaths: () => ["scripts/x.mjs"] }, false, /^stale: runtime differs — scripts\/x\.mjs$/u),
  evalCase("without since, a passed walk whose file changed is stale", entry({ walkBlob: B2 }),
    {}, false, /^stale: the walk changed since it ran$/u),
  evalCase("a different runtime names up to five paths and the rest", entry({ treeStart: T2, treeEnd: T2 }),
    { diffPaths: () => ["a", "b", "c", "d", "e", "f", "g"] }, false, /^stale: runtime differs — a, b, c, d, e, \+2 more$/u),
  evalCase("a different runtime names a short list whole", entry({ treeStart: T2, treeEnd: T2 }),
    { diffPaths: (a, b) => (a === T2 && b === T1 ? ["only.mjs"] : []) }, false, /^stale: runtime differs — only\.mjs$/u),
  evalCase("a partial attempt is refused with its reason", entry({ partial: "stopped after check 3" }), {}, false, /^partial: stopped after check 3$/u),
  evalCase("a failed walk with no classification is refused", entry({ state: "failed" }), {}, false, /^failed, not classified$/u),
  evalCase("a blocked walk with no classification is refused", entry({ state: "blocked" }), {}, false, /^blocked, not classified$/u),
  evalCase("a classification for another version is refused", classified("world-state", "new", { classification: { row: "T-0042", as: "world-state", status: "new", version: "1.9.0" } }), {}, false, /^classified for 1\.9\.0; classify again for this release$/u),
  evalCase("a defect whose row is new is refused", classified("defect", "new"), {}, false, /^a defect ships only when its row is deferred$/u),
  evalCase("a defect whose row is claimed is refused", classified("defect", "claimed"), {}, false, /^a defect ships only when its row is deferred$/u),
  evalCase("a classification on a row that is not classified is refused", classified("world-state", "fixed"), {}, false, /not classified/u),
  evalCase("a world-state failure on a new row is ok", classified("world-state", "new"), {}, true, /^classified world-state T-0042 \(new\)$/u),
  evalCase("a defect on a deferred row is ok", classified("defect", "deferred"), {}, true, /^classified defect T-0042 \(deferred\)$/u),
  evalCase("a stale walk stays stale under a classification", classified("world-state", "new", { treeStart: T2, treeEnd: T2 }), {}, false, /^stale: runtime differs/u),
  {
    name: "evaluate: absent data refuses every required walk, in order",
    run: () => {
      const rows = W.evaluate({ data: undefined, required: ["b", "a"], tree: T1, walkBlobs: {}, version: "1.0.0" });
      return rows.length === 2 && rows[0].walk === "b" && rows[1].walk === "a" && rows.every((r) => !r.ok && r.why === "not run") ? [] : [JSON.stringify(rows)];
    },
  },
];

let failures = 0;
try {
  for (const testCase of CASES) {
    let problems;
    try {
      problems = testCase.run();
    } catch (e) {
      // A case that throws is that case's failure, and the cases after it still run.
      problems = [`threw: ${String(e.stack ?? e).split("\n").slice(0, 4).join("\n  ")}`];
    }
    if (problems.length) {
      failures++;
      console.log(`FAIL ${testCase.name}\n  ${problems.join("\n  ")}`);
    } else console.log(`ok   ${testCase.name}`);
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
const shown = path.relative(TEMPLATE_ROOT, LIB);
console.log(`test-walk-results: ${CASES.length} cases against ${shown.startsWith("..") ? LIB : shown}, ${failures} failed`);
if (failures) process.exit(1);
