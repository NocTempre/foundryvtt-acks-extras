/**
 * Drives the family's commit-time leak gate through the hook a module runs.
 * Each case is a throwaway repository that holds tools/ip-quarantine.mjs
 * and the scanner beside it as its own tools/, armed by this repository's
 * pre-commit hook. The case makes a commit and checks what the commit holds,
 * what is still staged, what is on disk and what the ignore list says.
 *
 * A case stages through the work tree, as a session does, or straight into
 * the index, which holds content the work tree never did and a name in a
 * letter case the filesystem would fold. Names git refuses an index entry for
 * on this machine are left out of the cases that use them, and the run says
 * which on a `note` line; a run off Windows fails where any is left out.
 *
 * Usage:  node tools/toolchain-tests/test-ip-quarantine.mjs [--root <dir>]
 *         (`--root` is the tree whose quarantine is tested and
 *         defaults to this one; pass a modified copy to confirm a case fails
 *         when the behaviour it guards is broken)
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";

const TEMPLATE_ROOT = path.dirname(path.dirname(path.dirname(url.fileURLToPath(import.meta.url))));
const option = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const ROOT = path.resolve(option("--root", TEMPLATE_ROOT));
const HOOK = ".githooks/pre-commit";
/** What a case's repository holds of the tree under test, each file read from the tree's own path. */
const CARRIED = ["tools/ip-quarantine.mjs", "tools/ip-scan.mjs", HOOK];
const WINDOWS = process.platform === "win32";
/** The most a git this file runs may print: a listing of the thousands of paths one case commits. */
const GIT_OUTPUT_BYTES = 2 ** 26;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A caller's own repository variables would turn the fixtures' git toward the
// caller's repository, and a runner has no identity to commit as.
const ENV = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(GIT_DIR|GIT_WORK_TREE|GIT_INDEX_FILE|GIT_PREFIX)$/iu.test(key))),
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "commit.gpgsign",
  GIT_CONFIG_VALUE_0: "false",
};

// The notice is assembled so this file never holds one whole.
const NOTICE = ["All", "rights", "reserved."].join(" ");
/** A data file as an author writes one. */
const CLEAN = (label = "") => `${JSON.stringify({ title: "An invented label", label }, null, 2)}\n`;
/** The same file with a publisher's notice in it. */
const NOTICED = (label = "") => `${JSON.stringify({ title: "An invented label", footer: `Invented Press. ${NOTICE}`, label }, null, 2)}\n`;
/** What the quarantine prints when it has anything to say. */
const SAID = /ip-quarantine|LEAK/u;

/** A scanner whose one error names a directory. `flagged` is what it returns under that key, written as source. */
const namelessScanner = (flagged) => `export function scanPaths(root, paths) {
  return { errors: ["ruledata/ — a directory, and no staged file"], warnings: []${flagged ? `, flagged: ${flagged}` : ""} };
}
`;
/** A scanner that flags one path ending in /probe.txt each time it is asked, however many are staged. */
const ONE_AT_A_TIME = `export function scanPaths(root, paths) {
  const flagged = paths.filter((p) => p.endsWith("/probe.txt")).slice(0, 1);
  return { errors: flagged.map((p) => p + " — flagged by a scanner this case wrote"), warnings: [], flagged };
}
`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "acks-ip-quarantine-test-"));
const results = [];
const run = (cwd, args, input) => spawnSync("git", args, { cwd, encoding: "utf8", env: ENV, input, maxBuffer: GIT_OUTPUT_BYTES });
const sorted = (text) => text.split("\0").filter(Boolean).sort();

/**
 * A module-shaped repository: the quarantine, its scanner and the hook of the
 * tree under test, with the hook armed as `npm install` arms a module's.
 * `before` writes what the first commit holds beside them; that commit is made
 * before the hook is armed. With `base` false there is no first commit, and
 * the three files are on disk and untracked.
 */
function fixture(name, { before = () => {}, base = true } = {}) {
  const dir = path.join(tmp, name);
  const git = (...args) => run(dir, args);
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  for (const rel of CARRIED) write(rel, fs.readFileSync(path.join(ROOT, rel)));
  // Git on Linux and macOS runs a hook only where its file is executable. The
  // mode is given before the first commit, so the index holds it and a second
  // checkout of this repository gets it too.
  fs.chmodSync(path.join(dir, HOOK), 0o755);
  before(write);
  git("init", "-q", "-b", "main");
  if (base) {
    git("add", "-A");
    git("commit", "-q", "-m", "base");
  }
  git("config", "core.hooksPath", ".githooks");

  const excludeFile = path.join(dir, ".git", "info", "exclude");
  const exclude = () => (fs.existsSync(excludeFile) ? fs.readFileSync(excludeFile, "utf8") : "");
  const blobs = new Map();
  /** The id of a blob holding this text, written once however often it is asked for. */
  const blob = (text) => {
    if (!blobs.has(text)) blobs.set(text, run(dir, ["hash-object", "-w", "--stdin"], text).stdout.trim());
    return blobs.get(text);
  };
  return {
    dir,
    git,
    write,
    exclude,
    read: (rel) => fs.readFileSync(path.join(dir, rel), "utf8"),
    remove: (rel) => fs.rmSync(path.join(dir, rel)),
    stage: (...paths) => git("add", "--", ...paths),
    /**
     * Stage straight into the index, with no file written: each entry is a
     * name, the text its blob holds, and a mode where it is no plain file. A
     * submodule's entry gives a commit id as its text.
     */
    index: (...entries) => {
      const lines = entries.map(([rel, text, mode = "100644"]) => `${mode} ${mode === "160000" ? text : blob(text)}\t${rel}\0`);
      const r = run(dir, ["update-index", "--add", "-z", "--index-info"], lines.join(""));
      if (r.status !== 0 || r.stderr.trim()) throw new Error(`git update-index exited ${r.status}: ${r.stderr}`);
    },
    /** `git commit`, with the hook armed; `extra` follows the message. */
    commit: (...extra) => {
      const r = git("commit", "-m", "a commit", ...extra);
      return { status: r.status, out: `${r.stdout}${r.stderr}` };
    },
    /** The commit HEAD names, or "" where the repository has none yet. */
    head: () => git("rev-parse", "--verify", "-q", "HEAD").stdout.trim(),
    /** The paths the last commit writes, sorted. */
    written: () => sorted(git("diff-tree", "--root", "--no-commit-id", "--name-only", "-r", "-z", "HEAD").stdout),
    /** The paths staged now, sorted. */
    staged: () => sorted(git("diff", "--cached", "--name-only", "--no-renames", "-z").stdout),
    status: () => git("status", "--porcelain").stdout.trim(),
    /** The text a commit holds for a path, or null where it holds none. */
    holds: (rev, rel) => {
      const r = git("show", `${rev}:${rel}`);
      return r.status === 0 ? r.stdout : null;
    },
    /** Put this text in place of the ignore list. */
    seedExclude: (text) => {
      fs.mkdirSync(path.dirname(excludeFile), { recursive: true });
      fs.writeFileSync(excludeFile, text);
    },
    /** The lines the quarantine has put on the ignore list: everything below its header. */
    listed: () => {
      const lines = exclude().split("\n");
      const header = lines.findIndex((line) => line.startsWith("# ip-quarantine"));
      return header < 0 ? [] : lines.slice(header + 1).filter(Boolean);
    },
    /** What `git check-ignore` exits with for a path: 0 where an ignore line matches it, 1 where none does. */
    ignored: (rel) => git("check-ignore", "-q", "--", rel).status,
  };
}

function test(name, body) {
  const problems = [];
  const check = (what, ok, detail = "") => {
    if (!ok) problems.push(`${what}${detail ? `\n      ${String(detail).trim().split("\n").join("\n      ")}` : ""}`);
  };
  try {
    body(check);
  } catch (e) {
    problems.push(`threw: ${e.stack ?? e}`);
  }
  results.push(problems.length === 0);
  console.log(problems.length ? `FAIL ${name}\n  ${problems.join("\n  ")}` : `ok   ${name}`);
}

/**
 * Banned names with a mark in them that an error line or an ignore-list line
 * could trip on, each with a name its line would also match were the mark
 * read as a pattern, where there is one.
 */
const AWKWARD = [
  ["ruledata/Table 1 — Wages.json", null],
  ["ruledata/a: b.json", null],
  ["ruledata/[v2] table.json", "ruledata/v table.json"],
  ["ruledata/star*.json", "ruledata/starry.json"],
  ["ruledata/what?.json", "ruledata/whatX.json"],
  ["ruledata/ends ", "ruledata/ends"],
  ["ruledata/back\\slash.json", "ruledata/backslash.json"],
  ["ruledata/#draft.json", null],
  ["ruledata/tâble 1.json", null],
  ["!bang/ruledata/x.json", null],
  ["#hash/ruledata/x.json", null],
  ["RULES.md", "docs/RULES.md"],
];
const LINE_BREAK = "ruledata/two\nlines.json";

/** The names of a list that this machine's git will hold in an index. */
function holdable(names) {
  const dir = path.join(tmp, "holdable");
  fs.mkdirSync(dir);
  run(dir, ["init", "-q", "-b", "main"]);
  const blob = run(dir, ["hash-object", "-w", "--stdin"], "{}\n").stdout.trim();
  for (const name of names) run(dir, ["update-index", "--add", "-z", "--index-info"], `100644 ${blob}\t${name}\0`);
  const held = new Set(run(dir, ["ls-files", "-z"]).stdout.split("\0"));
  return names.filter((name) => held.has(name));
}

try {
  const usable = new Set(holdable([...AWKWARD.map(([name]) => name), LINE_BREAK]));
  const leftOut = [...AWKWARD.map(([name]) => name), LINE_BREAK].filter((name) => !usable.has(name));
  const awkward = AWKWARD.filter(([name]) => usable.has(name));
  if (leftOut.length) console.log(`note git on ${process.platform} holds no index entry for ${leftOut.length} of the awkward names, and they are left out: ${leftOut.map((name) => JSON.stringify(name)).join(", ")}`);

  test("a commit that holds nothing flagged passes with nothing said, and so does one with nothing staged", (check) => {
    const f = fixture("clean");
    const before = f.exclude();
    f.write("lang/en.json", CLEAN());
    f.write("docs/note.txt", "clean\n");
    f.stage("lang/en.json", "docs/note.txt");
    const made = f.commit();
    check("git commit exits 0 and the quarantine says nothing", made.status === 0 && !SAID.test(made.out), made.out);
    check("the commit writes both files", f.written().join(", ") === "docs/note.txt, lang/en.json", f.written().join(", "));
    const base = f.head();
    const empty = f.commit("--allow-empty");
    check("a commit with nothing staged is made", empty.status === 0 && !SAID.test(empty.out) && f.head() !== base, empty.out);
    check("the ignore list is as it was", f.exclude() === before, f.exclude());
  });

  test("a banned path staged beside a clean file is taken out of the commit, left on disk, and ignored from then on", (check) => {
    const f = fixture("beside");
    f.write("ruledata/table.json", "{}\n");
    f.write("docs/note.txt", "clean\n");
    f.stage("ruledata/table.json", "docs/note.txt");
    const base = f.head();
    const made = f.commit();
    check("git commit exits 0", made.status === 0, made.out);
    check("the quarantine names the path and counts it", /LEAK {2}ruledata\/table\.json — /u.test(made.out) && /Quarantined 1 file\(s\)/u.test(made.out), made.out);
    check("a commit is made, and it writes the clean file alone", f.head() !== base && f.written().join(", ") === "docs/note.txt", f.written().join(", "));
    check("nothing is left staged", f.staged().length === 0, f.staged().join(", "));
    check("the banned file is on disk as it was", f.read("ruledata/table.json") === "{}\n");
    check("the ignore list holds one line for it, anchored at the top of the tree", f.listed().join("\n") === "/ruledata/table.json", f.exclude());
    check("git ignores it: the tree is clean, and a plain git add refuses the file", f.status() === "" && f.stage("ruledata/table.json").status !== 0, f.status());
  });

  test("a commit whose whole staged set is flagged is abandoned, an amended one included", (check) => {
    const f = fixture("whole-set");
    f.write("ruledata/table.json", "{}\n");
    f.stage("ruledata/table.json");
    const base = f.head();
    const made = f.commit();
    check("git commit exits non-zero and says nothing is left", made.status !== 0 && /Quarantined 1 file\(s\)/u.test(made.out) && /Nothing left to commit/u.test(made.out), made.out);
    check("no commit is made, and nothing is left staged", f.head() === base && f.staged().length === 0, f.staged().join(", "));
    check("the file is on disk and on the ignore list", fs.existsSync(path.join(f.dir, "ruledata", "table.json")) && f.listed().includes("/ruledata/table.json"), f.exclude());
    // Git amends a commit with nothing staged, so only the quarantine stands in the way of this one.
    f.write("ruledata/other.json", "{}\n");
    f.stage("ruledata/other.json");
    const amended = f.commit("--amend");
    check("git commit --amend exits non-zero, and HEAD is the commit it was", amended.status !== 0 && /Nothing left to commit/u.test(amended.out) && f.head() === base, amended.out);
  });

  test("on a repository's first commit, where HEAD does not resolve, a banned file is taken out and the rest is committed", (check) => {
    const f = fixture("first-commit", { base: false });
    f.write("ruledata/x.json", "{}\n");
    f.write("keep.txt", "k\n");
    f.git("add", "-A");
    const made = f.commit();
    check("git commit exits 0 and takes one file out", made.status === 0 && /Quarantined 1 file\(s\)/u.test(made.out), made.out);
    check("the first commit writes everything else", f.written().join(", ") === [...CARRIED, "keep.txt"].sort().join(", "), f.written().join(", "));
    const alone = fixture("first-commit-alone", { base: false });
    alone.write("ruledata/x.json", "{}\n");
    alone.stage("ruledata/x.json");
    const none = alone.commit();
    check("where the banned file is all that is staged, there is still no first commit", none.status !== 0 && /Nothing left to commit/u.test(none.out) && alone.head() === "" && alone.staged().length === 0, none.out);
  });

  test("the ignore list gets its header once and a path once, and a last line with no line end is kept whole", (check) => {
    const f = fixture("list");
    f.seedExclude("mine.tmp");
    f.write("ruledata/a.json", "{}\n");
    f.write("one.txt", "1\n");
    f.stage("ruledata/a.json", "one.txt");
    const first = f.commit();
    // A list edited by hand since: its last line has lost its line end.
    f.seedExclude(f.exclude().replace(/\n$/u, ""));
    f.write("ruledata/b.json", "{}\n");
    f.write("two.txt", "2\n");
    f.stage("ruledata/b.json", "two.txt");
    const second = f.commit();
    f.write("three.txt", "3\n");
    f.git("add", "-f", "--", "ruledata/a.json", "three.txt");
    const third = f.commit();
    check("each of the three commits exits 0 with one file taken out", [first, second, third].every((made) => made.status === 0 && /Quarantined 1 file\(s\)/u.test(made.out)), `${first.out}${second.out}${third.out}`);
    check("a listed path staged again by force is taken out again", f.written().join(", ") === "three.txt", f.written().join(", "));
    check("the list is the line it held, the header, and each path on a line of its own, once", /^mine\.tmp\n\n# ip-quarantine[^\n]*\n\/ruledata\/a\.json\n\/ruledata\/b\.json\n$/u.test(f.exclude()), JSON.stringify(f.exclude()));
    check("the line the list held still ignores its file", f.ignored("mine.tmp") === 0);
  });

  test("a change to a banned file HEAD already holds stops the commit, and the stop says history holds it", (check) => {
    const f = fixture("in-head", { before: (write) => write("ruledata/old.json", "{}\n") });
    f.write("ruledata/old.json", '{ "changed": true }\n');
    f.write("docs/note.txt", "clean\n");
    f.stage("ruledata/old.json", "docs/note.txt");
    const base = f.head();
    const before = f.exclude();
    const made = f.commit();
    check("git commit exits non-zero", made.status !== 0, made.out);
    check("the stop says the file is committed already, and not that the change brings it in", /ALREADY COMMITTED/u.test(made.out) && !/HEAD holds clean/u.test(made.out), made.out);
    check("no commit is made, both files stay staged, and the ignore list is as it was", f.head() === base && f.staged().join(", ") === "docs/note.txt, ruledata/old.json" && f.exclude() === before, `${f.staged().join(", ")}\n${f.exclude()}`);
  });

  test("a notice arriving in a file HEAD holds clean stops the commit, and is told apart from one HEAD holds already", (check) => {
    const f = fixture("arriving", {
      before: (write) => {
        write("lang/en.json", CLEAN("base"));
        write("lang/old.json", NOTICED("base"));
      },
    });
    f.write("lang/en.json", NOTICED("a notice arrives"));
    f.write("lang/old.json", NOTICED("changed, the notice still in it"));
    f.write("docs/note.txt", "clean\n");
    f.stage("lang/en.json", "lang/old.json", "docs/note.txt");
    const base = f.head();
    const before = f.exclude();
    const made = f.commit();
    const [history, arriving = ""] = made.out.split("HEAD holds clean");
    check("git commit exits non-zero", made.status !== 0, made.out);
    check("the file HEAD holds with a notice is listed as committed already", /ALREADY COMMITTED[^]*\n {4}lang\/old\.json\n/u.test(history) && !/\n {4}lang\/en\.json\n/u.test(history), made.out);
    check("the file HEAD holds clean is listed as brought in by the change", /\n {4}lang\/en\.json\n/u.test(arriving) && !/\n {4}lang\/old\.json\n/u.test(arriving), made.out);
    check("no commit is made, all three files stay staged, and the ignore list is as it was", f.head() === base && f.staged().length === 3 && f.exclude() === before, `${f.staged().join(", ")}\n${f.exclude()}`);
  });

  test("a change that takes the notice out of a file HEAD holds with one is committed", (check) => {
    const f = fixture("taken-out", { before: (write) => write("lang/old.json", NOTICED("base")) });
    f.write("lang/old.json", CLEAN("the notice taken out"));
    f.stage("lang/old.json");
    const made = f.commit();
    check("git commit exits 0 and the quarantine says nothing", made.status === 0 && !SAID.test(made.out), made.out);
    check("HEAD holds the file without the notice", f.holds("HEAD", "lang/old.json") === CLEAN("the notice taken out"), f.holds("HEAD", "lang/old.json"));
  });

  test("a staged removal of a banned file HEAD holds is committed: it brings nothing in", (check) => {
    const f = fixture("removal", { before: (write) => write("ruledata/old.json", "{}\n") });
    f.git("rm", "-q", "--", "ruledata/old.json");
    const made = f.commit();
    check("git commit exits 0 and the quarantine says nothing", made.status === 0 && !SAID.test(made.out), made.out);
    check("the commit removes the file", f.written().join(", ") === "ruledata/old.json" && f.holds("HEAD", "ruledata/old.json") === null, f.written().join(", "));
  });

  test("a name that holds the marks an error line is written with is taken out like any other", (check) => {
    const f = fixture("marks");
    const banned = ["ruledata/Table 1 — Wages.json", "ruledata/a: b.json"].filter((name) => usable.has(name));
    const noticed = ["packs/_source/items/Sword — Long.json", "lang/a — b.json"];
    f.index(...banned.map((name) => [name, "{}\n"]), ...noticed.map((name) => [name, NOTICED()]), ["docs/note.txt", "clean\n"]);
    const made = f.commit();
    check("git commit exits 0 and every such file is taken out", made.status === 0 && made.out.includes(`Quarantined ${banned.length + noticed.length} file(s)`), made.out);
    check("the commit writes the clean file alone, and nothing is left staged", f.written().join(", ") === "docs/note.txt" && f.staged().length === 0, `${f.written().join(", ")}\n${f.staged().join(", ")}`);
    const base = f.head();
    f.index(["ruledata/Table 2 — Wages.json", "{}\n"]);
    const alone = f.commit();
    check("as the whole staged set, such a name leaves nothing to commit", alone.status !== 0 && /Nothing left to commit/u.test(alone.out) && f.head() === base && f.staged().length === 0, alone.out);
    check("a name with a colon in it is among them off Windows", WINDOWS || banned.length === 2, banned.join(", "));
  });

  test("a flagged file edited after it was staged is taken out all the same, and the edit is kept", (check) => {
    const f = fixture("edited");
    f.write("ruledata/x.json", "{}\n");
    f.write("lang/new.json", NOTICED("as staged"));
    f.write("keep.txt", "k\n");
    f.stage("ruledata/x.json", "lang/new.json", "keep.txt");
    f.write("ruledata/x.json", '{ "edited": true }\n');
    f.write("lang/new.json", NOTICED("edited after staging"));
    const made = f.commit();
    check("git commit exits 0 and both files are taken out", made.status === 0 && /Quarantined 2 file\(s\)/u.test(made.out), made.out);
    check("the commit writes the clean file alone, and nothing is left staged", f.written().join(", ") === "keep.txt" && f.staged().length === 0, `${f.written().join(", ")}\n${f.staged().join(", ")}`);
    check("each file on disk is as it was last written", f.read("ruledata/x.json") === '{ "edited": true }\n' && f.read("lang/new.json") === NOTICED("edited after staging"));
  });

  test("what is judged is what was staged: a notice taken out, deleted or broken on disk afterwards is still caught", (check) => {
    const f = fixture("as-staged");
    f.write("lang/rewritten.json", NOTICED());
    f.write("scripts/deleted.mjs", `// Invented Press. ${NOTICE}\nexport const x = 1;\n`);
    f.write("templates/deleted.hbs", `<p>Invented Press. ${NOTICE}</p>\n`);
    f.write("lang/broken.json", NOTICED());
    f.write("lang/later.json", CLEAN("as staged"));
    f.stage("lang/rewritten.json", "scripts/deleted.mjs", "templates/deleted.hbs", "lang/broken.json", "lang/later.json");
    f.write("lang/rewritten.json", CLEAN("the notice taken out on disk, and not staged again"));
    f.remove("scripts/deleted.mjs");
    f.remove("templates/deleted.hbs");
    f.write("lang/broken.json", '{ "title": "half-written, ');
    // Staged clean beside them: the notice it gains on disk is not what the commit would hold.
    f.write("lang/later.json", NOTICED("on disk, never staged"));
    const made = f.commit();
    check("git commit exits 0 and all four files are taken out", made.status === 0 && /Quarantined 4 file\(s\)/u.test(made.out), made.out);
    check("the commit writes the one file staged clean, as it was staged", f.written().join(", ") === "lang/later.json" && f.holds("HEAD", "lang/later.json") === CLEAN("as staged"), f.written().join(", "));
    check("nothing is left staged", f.staged().length === 0, f.staged().join(", "));
  });

  test("a notice on disk that was never staged is not this commit's", (check) => {
    const f = fixture("on-disk", { before: (write) => write("lang/tracked.json", CLEAN("base")) });
    f.write("lang/new.json", CLEAN("as staged"));
    f.write("lang/tracked.json", CLEAN("a clean change, as staged"));
    f.stage("lang/new.json", "lang/tracked.json");
    f.write("lang/new.json", NOTICED("on disk, never staged"));
    f.write("lang/tracked.json", NOTICED("on disk, never staged"));
    const made = f.commit();
    check("git commit exits 0 and the quarantine says nothing", made.status === 0 && !SAID.test(made.out), made.out);
    check("the commit writes both files as they were staged", f.holds("HEAD", "lang/new.json") === CLEAN("as staged") && f.holds("HEAD", "lang/tracked.json") === CLEAN("a clean change, as staged"), f.written().join(", "));
    check("the files on disk still hold what was written after", f.read("lang/new.json").includes(NOTICE) && f.read("lang/tracked.json").includes(NOTICE));
  });

  test("a path that changes type is read: a link in HEAD staged as a file with a notice stops the commit", (check) => {
    const f = fixture("type-change");
    f.index(["lang/en.json", "elsewhere.json", "120000"]);
    f.commit("--no-verify");
    f.index(["lang/en.json", NOTICED()], ["keep.txt", "k\n"]);
    const listing = f.git("diff", "--cached", "--name-status").stdout;
    check("git lists the path as a change of type", /^T\tlang\/en\.json$/mu.test(listing), listing);
    const base = f.head();
    const made = f.commit();
    check("git commit exits non-zero, and the stop says the change brings the notice in", made.status !== 0 && /HEAD holds clean/u.test(made.out), made.out);
    check("no commit is made", f.head() === base);
  });

  test("git commit -a and git commit -- <paths> are judged by the index git builds for each", (check) => {
    const f = fixture("commit-a", {
      before: (write) => {
        write("lang/en.json", CLEAN("base"));
        write("notes.txt", "n\n");
      },
    });
    f.write("lang/en.json", NOTICED("never staged by hand"));
    f.write("notes.txt", "n2\n");
    const base = f.head();
    const all = f.commit("-a");
    check("git commit -a is stopped by a notice it would have staged", all.status !== 0 && /HEAD holds clean/u.test(all.out) && f.head() === base, all.out);

    const g = fixture("commit-paths");
    g.write("ruledata/x.json", "{}\n");
    g.write("keep.txt", "k\n");
    g.stage("ruledata/x.json", "keep.txt");
    const named = g.commit("--", "ruledata/x.json", "keep.txt");
    check("git commit -- <paths> exits 0 and commits the clean path alone", named.status === 0 && /Quarantined 1 file\(s\)/u.test(named.out) && g.written().join(", ") === "keep.txt", `${g.written().join(", ")}\n${named.out}`);
    const after = g.head();
    const next = g.commit();
    check("the commit after it holds no banned path either, and leaves none staged", next.status !== 0 && g.head() === after && g.staged().length === 0, `${g.staged().join(", ")}\n${next.out}`);
  });

  test("a file moved into a banned directory is taken out at its new path, and its removal from the old one is committed", (check) => {
    const f = fixture("moved", { before: (write) => write("data.json", '{ "kept": true }\n') });
    fs.mkdirSync(path.join(f.dir, "ruledata"));
    f.git("mv", "data.json", "ruledata/data.json");
    f.write("keep.txt", "k\n");
    f.stage("keep.txt");
    const made = f.commit();
    check("git commit exits 0 and takes one file out", made.status === 0 && /LEAK {2}ruledata\/data\.json — /u.test(made.out) && /Quarantined 1 file\(s\)/u.test(made.out), made.out);
    check("the commit writes the removal and the clean file", f.written().join(", ") === "data.json, keep.txt" && f.holds("HEAD", "data.json") === null && f.holds("HEAD", "ruledata/data.json") === null, f.written().join(", "));
    check("the file is on disk where it was moved to, and ignored there", f.read("ruledata/data.json") === '{ "kept": true }\n' && f.ignored("ruledata/data.json") === 0);
  });

  test("in a checkout whose .git is a file, the ignore list git reads is found and written", (check) => {
    const f = fixture("worktree-main");
    const linked = path.join(tmp, "worktree-linked");
    const added = f.git("worktree", "add", "-q", "-b", "side", linked);
    check("git makes a second checkout of the repository, with .git a file in it", added.status === 0 && fs.statSync(path.join(linked, ".git")).isFile(), added.stderr);
    fs.mkdirSync(path.join(linked, "ruledata"));
    fs.writeFileSync(path.join(linked, "ruledata", "x.json"), "{}\n");
    fs.writeFileSync(path.join(linked, "keep.txt"), "k\n");
    run(linked, ["add", "--", "ruledata/x.json", "keep.txt"]);
    const r = run(linked, ["commit", "-m", "a commit"]);
    const out = `${r.stdout}${r.stderr}`;
    check("git commit exits 0 there and takes one file out", r.status === 0 && /Quarantined 1 file\(s\)/u.test(out), out);
    const written = sorted(run(linked, ["diff-tree", "--no-commit-id", "--name-only", "-r", "-z", "HEAD"]).stdout).join(", ");
    check("the commit writes the clean file alone", written === "keep.txt", written);
    check("the line is on the list the two checkouts share", f.listed().join("\n") === "/ruledata/x.json", f.exclude());
    check("git ignores the file in that checkout", run(linked, ["status", "--porcelain"]).stdout.trim() === "", run(linked, ["status", "--porcelain"]).stdout);
  });

  test("a flagged name that reads as a pattern takes no other file out of the commit, and ignores no other", (check) => {
    const f = fixture("pattern-name", { before: (write) => write("lang/a.json", CLEAN("base")) });
    f.write("lang/[ab].json", NOTICED());
    f.write("lang/a.json", CLEAN("a clean change"));
    f.write("lang/b.json", CLEAN("a clean new file"));
    f.stage("lang/[ab].json", "lang/a.json", "lang/b.json");
    const made = f.commit();
    check("git commit exits 0 and takes one file out", made.status === 0 && /Quarantined 1 file\(s\)/u.test(made.out), made.out);
    check("the commit writes the two files the name matches as a pattern, and no other", f.written().join(", ") === "lang/a.json, lang/b.json", f.written().join(", "));
    check("HEAD holds both as they were staged", f.holds("HEAD", "lang/a.json") === CLEAN("a clean change") && f.holds("HEAD", "lang/b.json") === CLEAN("a clean new file"), `${f.holds("HEAD", "lang/a.json")}${f.holds("HEAD", "lang/b.json")}`);
    // Asked with no index, so that a tracked file is judged by the list's lines like any other.
    const listedAs = (rel) => f.git("check-ignore", "-q", "--no-index", "--", rel).status;
    check("the list's line matches the flagged file and neither of the two", listedAs("lang/[ab].json") === 0 && listedAs("lang/a.json") === 1 && listedAs("lang/b.json") === 1, f.exclude());
  });

  test("an ignore-list line matches its own file and no other", (check) => {
    const f = fixture("lines");
    f.index(...awkward.map(([name]) => [name, "{}\n"]), ["keep.txt", "k\n"]);
    const made = f.commit();
    check("git commit exits 0 and every awkward name is taken out", made.status === 0 && made.out.includes(`Quarantined ${awkward.length} file(s)`) && f.written().join(", ") === "keep.txt", `${f.written().join(", ")}\n${made.out}`);
    for (const [name, decoy] of awkward) {
      check(`git ignores ${JSON.stringify(name)} by its line`, f.ignored(name) === 0, f.exclude());
      if (decoy) check(`and not ${JSON.stringify(decoy)}`, f.ignored(decoy) === 1, f.exclude());
    }
    check("no awkward name is left out off Windows", WINDOWS || awkward.length === AWKWARD.length, awkward.map(([name]) => name).join(", "));
  });

  if (usable.has(LINE_BREAK)) {
    test("a name with a line break in it, which the ignore list cannot hold, is still taken out of the commit", (check) => {
      const f = fixture("line-break");
      const before = f.exclude();
      f.index([LINE_BREAK, "{}\n"], ["keep.txt", "k\n"]);
      const made = f.commit();
      check("git commit exits 0 and takes one file out", made.status === 0 && /Quarantined 1 file\(s\)/u.test(made.out), made.out);
      check("the commit writes the clean file alone, and nothing is left staged", f.written().join(", ") === "keep.txt" && f.staged().length === 0, `${f.written().join(", ")}\n${f.staged().join(", ")}`);
      check("the ignore list gains no line for it", f.exclude() === before, JSON.stringify(f.exclude()));
    });
  } else test("a name with a line break in it is one git holds an index entry for off Windows", (check) => check("this run is on Windows", WINDOWS));

  test("a leak the scanner names no staged path for stops the commit, with nothing taken out", (check) => {
    const f = fixture("nameless");
    f.write("ruledata/a.json", "{}\n");
    f.write("keep.txt", "k\n");
    f.stage("ruledata/a.json", "keep.txt");
    const base = f.head();
    const before = f.exclude();
    for (const [what, flagged] of [
      ["no path at all", ""],
      ["a directory", '["ruledata/"]'],
    ]) {
      f.write("tools/ip-scan.mjs", namelessScanner(flagged));
      const made = f.commit();
      check(`where the scanner names ${what}, git commit exits non-zero and says why`, made.status !== 0 && /names no staged path/u.test(made.out), made.out);
      check("no commit is made, both files stay staged, and the ignore list is as it was", f.head() === base && f.staged().join(", ") === "keep.txt, ruledata/a.json" && f.exclude() === before, `${f.staged().join(", ")}\n${f.exclude()}`);
    }
  });

  test("a flagged path that is still staged after the quarantine stops the commit", (check) => {
    const f = fixture("still-staged");
    f.write("tools/ip-scan.mjs", ONE_AT_A_TIME);
    f.write("one/probe.txt", "x\n");
    f.write("two/probe.txt", "x\n");
    f.write("keep.txt", "k\n");
    f.stage("one/probe.txt", "two/probe.txt", "keep.txt");
    const base = f.head();
    const made = f.commit();
    check("git commit exits non-zero and names the path it could not take out", made.status !== 0 && /Still staged, and still flagged/u.test(made.out) && /\n {4}two\/probe\.txt — /u.test(made.out), made.out);
    check("no commit is made", f.head() === base);
    check("the path the scanner named is out of the index, and the one it named late is still in", f.staged().join(", ") === "keep.txt, two/probe.txt", f.staged().join(", "));
  });

  test("a scanner that cannot be loaded stops the commit", (check) => {
    const f = fixture("unloadable");
    f.write("tools/ip-scan.mjs", "export const scanPaths = (;\n");
    f.write("keep.txt", "k\n");
    f.stage("keep.txt");
    const base = f.head();
    const made = f.commit();
    check("git commit exits non-zero", made.status !== 0, made.out);
    check("no commit is made, and the clean file stays staged", f.head() === base && f.staged().join(", ") === "keep.txt", f.staged().join(", "));
  });

  test("a banned directory and a file whose text is read are known in any letter case", (check) => {
    const f = fixture("letter-case");
    f.index(
      ["RuleData/x.json", "{}\n"],
      ["docs/Rules.MD", "x\n"],
      ["Lang/EN.JSON", NOTICED()],
      ["Packs/_Source/items/x.json", NOTICED()],
      ["Templates/Sheet.HBS", `<p>Invented Press. ${NOTICE}</p>\n`],
      ["Scripts/Helper.MJS", `// Invented Press. ${NOTICE}\nexport const x = 1;\n`],
      ["keep.txt", "k\n"],
    );
    const made = f.commit();
    check("git commit exits 0 and all six files are taken out", made.status === 0 && /Quarantined 6 file\(s\)/u.test(made.out), made.out);
    check("the commit writes the clean file alone", f.written().join(", ") === "keep.txt", f.written().join(", "));
  });

  test("a data file that does not parse is read as text: a notice in it is caught, and with none it is committed", (check) => {
    const f = fixture("no-parse");
    f.index(["lang/half.json", `{ "title": "half-written", "footer": "Invented Press. ${NOTICE}"\n`], ["lang/half-clean.json", '{ "title": "half-written, '], ["keep.txt", "k\n"]);
    const made = f.commit();
    check("git commit exits 0 and takes out the one that holds a notice", made.status === 0 && /LEAK {2}lang\/half\.json — /u.test(made.out) && /Quarantined 1 file\(s\)/u.test(made.out), made.out);
    check("the commit writes the other two", f.written().join(", ") === "keep.txt, lang/half-clean.json", f.written().join(", "));
  });

  test("each staged file is judged by its own content, among many and beside awkward ones", (check) => {
    const f = fixture("many");
    const noticed = new Set(["lang/004.json", "lang/031.json", "lang/059.json"]);
    const files = new Map([
      ["lang/000.json", ""],
      ["lang/001.json", CLEAN("é—".repeat(700))],
      // No JSON, and a line that reads as the header git prints before a blob.
      ["lang/002.json", `{}\n${"0".repeat(40)} blob 5\n{}\n`],
      ["lang/003.json", CLEAN("x".repeat(1_200_000))],
    ]);
    for (let n = 4; n < 60; n++) {
      const rel = `lang/${String(n).padStart(3, "0")}.json`;
      files.set(rel, noticed.has(rel) ? NOTICED(`file ${n}`) : CLEAN(`file ${n}`).trimEnd());
    }
    for (const [rel, text] of files) f.write(rel, text);
    f.stage("lang");
    const made = f.commit();
    check("git commit exits 0 and takes out the three that hold a notice", made.status === 0 && /Quarantined 3 file\(s\)/u.test(made.out), made.out.slice(0, 2000));
    const clean = [...files.keys()].filter((rel) => !noticed.has(rel)).sort();
    check("the commit writes every other file and no more", f.written().join(", ") === clean.join(", "), f.written().join(", "));
    check("the three are the ones left on the ignore list", f.listed().join(", ") === [...noticed].map((rel) => `/${rel}`).join(", "), f.listed().join(", "));
  });

  test("a staged submodule under a path whose text is read is passed over: it holds none", (check) => {
    const f = fixture("submodule");
    f.index(["lang/vendored.json", "1".repeat(40), "160000"], ["lang/en.json", CLEAN()], ["keep.txt", "k\n"]);
    const made = f.commit();
    check("git commit exits 0 and the quarantine says nothing", made.status === 0 && !SAID.test(made.out), made.out);
    check("the commit writes all three", f.written().join(", ") === "keep.txt, lang/en.json, lang/vendored.json", f.written().join(", "));
  });

  test("a commit of thousands of paths, and a HEAD that holds them, is read whole", (check) => {
    const f = fixture("thousands");
    // Over a megabyte of names, which is more than a git call returns by default.
    const deep = `docs/${"a-long-directory-name/".repeat(8)}`;
    const names = Array.from({ length: 6000 }, (_, n) => `${deep}${String(n).padStart(5, "0")}.txt`);
    f.index(...names.map((name) => [name, "x\n"]), ["lang/en.json", CLEAN()], ["ruledata/x.json", "{}\n"]);
    const made = f.commit("-q");
    check("git commit exits 0 and takes the banned file out", made.status === 0 && /Quarantined 1 file\(s\)/u.test(made.out), made.out.slice(0, 2000));
    check("the commit writes every other path", f.written().length === names.length + 1 && !f.written().includes("ruledata/x.json"), String(f.written().length));
    f.index(["ruledata/y.json", "{}\n"], ["keep.txt", "k\n"]);
    const next = f.commit("-q");
    check("a commit over that HEAD exits 0 and takes its banned file out", next.status === 0 && /Quarantined 1 file\(s\)/u.test(next.out) && f.written().join(", ") === "keep.txt", next.out.slice(0, 2000));
  });
} finally {
  // A git that was still exiting may hold its directory for a moment.
  for (let n = 0; n < 20; n++) {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
      break;
    } catch {
      await sleep(250);
    }
  }
}

const failed = results.filter((ok) => !ok).length;
const shown = path.relative(TEMPLATE_ROOT, path.join(ROOT, CARRIED[0])).replaceAll("\\", "/");
console.log(`\ntest-ip-quarantine: ${results.length} cases against ${shown}, ${failed} failed`);
process.exit(failed ? 1 : 0);
