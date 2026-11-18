/**
 * Drives the `acks-commit` skill's tool against throwaway repositories and
 * checks what it exists to guarantee: a commit holds this change's hunks and
 * no peer's, the tree it commits is the tree its gate read, and a base that
 * moved under the gate is refused or carried by the stated conditions and no
 * others. Each case is a fresh repository with a gate that fails on a peer's
 * line, so a gate that read the working tree in place of the built tree is
 * red. The ledger cases write through the edit-ledger hook as two sessions
 * and check that a line is taken by its writer and by nobody else. The mode
 * cases check that a commit holds the mode change.json gives a file, with the
 * content HEAD holds where the change names the file for nothing else.
 *
 * Usage:  node tools/toolchain-tests/test-commit-own-hunks.mjs [<commit-own-hunks.mjs>] [--group tree|ledger]
 *         (defaults to .claude/skills/acks-commit/commit-own-hunks.mjs; pass a
 *         modified copy to confirm a case fails when the behaviour it guards
 *         is broken. A copy imports `ledger.mjs` from beside itself.
 *         `--group` runs the shared-tree cases or the ledger's alone)
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";

const TEMPLATE_ROOT = path.dirname(path.dirname(path.dirname(url.fileURLToPath(import.meta.url))));
const GROUP = process.argv.includes("--group") ? process.argv[process.argv.indexOf("--group") + 1] : null;
const KIT = path.resolve(process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : path.join(TEMPLATE_ROOT, ".claude", "skills", "acks-commit", "commit-own-hunks.mjs"));
const HOOK = path.join(TEMPLATE_ROOT, ".claude", "hooks", "edit-ledger.mjs");
const ME = "session-me-0001";
const PEER = "session-peer-0002";

const BODY = Array.from({ length: 30 }, (_, n) => `line ${n + 1}`);
/**
 * The fixture's gate. It fails on a peer's line in the tree it runs in, and
 * lands a commit in the origin repository once when a flag beside the clone
 * asks for it, which is a peer's commit arriving while the gate runs.
 */
const GATE = `import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
const flag = path.join(process.cwd(), "..", "land-once.json");
if (fs.existsSync(flag)) {
  const { repo, file } = JSON.parse(fs.readFileSync(flag, "utf8"));
  fs.rmSync(flag);
  fs.writeFileSync(path.join(repo, file), "landed under the gate\\n");
  execFileSync("git", ["add", "--", file], { cwd: repo });
  execFileSync("git", ["commit", "-q", "-m", "peer lands under the gate"], { cwd: repo });
}
for (const f of ["a.txt", "b.txt", "new.txt"]) {
  if (fs.existsSync(f) && fs.readFileSync(f, "utf8").includes("PEER")) {
    console.log("FAIL: a peer's line is in the gated tree: " + f);
    process.exit(1);
  }
}
if (process.argv[2] === "red") process.exit(1);
console.log("ok - gate " + (process.argv[2] ?? ""));
`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "acks-commit-"));
const results = [];

/**
 * A committed repository with two text files, a file to remove, gate tooling
 * and an untracked node_modules. The tool runs as `session`, or as no session
 * at all: the id this test's own shell carries never reaches it.
 */
function fixture(name, changeJson, { session = null } = {}) {
  const root = path.join(tmp, name);
  const repo = path.join(root, "repo");
  const change = path.join(root, "change");
  fs.mkdirSync(path.join(repo, "tools"), { recursive: true });
  fs.mkdirSync(path.join(repo, "node_modules"), { recursive: true });
  fs.mkdirSync(change, { recursive: true });
  const write = (rel, text) => fs.writeFileSync(path.join(repo, rel), text);
  write(".gitattributes", "* text=auto eol=lf\n");
  write(".gitignore", "node_modules/\n");
  write("package.json", JSON.stringify({ scripts: { validate: "node gate.mjs validate", test: "node gate.mjs test" } }, null, 1) + "\n");
  write("gate.mjs", GATE);
  write("a.txt", BODY.join("\n") + "\n");
  write("b.txt", BODY.join("\n") + "\n");
  write("gone.txt", "to be removed\n");
  write("other.txt", "untouched\n");
  write("tools/validate.mjs", "// stands for gate tooling\n");
  // The ledger hook records only where the commit tool is carried.
  fs.mkdirSync(path.join(repo, ".claude", "skills", "acks-commit"), { recursive: true });
  write(".claude/skills/acks-commit/commit-own-hunks.mjs", "// stands for the commit tool\n");
  write("node_modules/sentinel.txt", "must survive every clone\n");
  const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "test");
  git("config", "commit.gpgsign", "false");
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  fs.writeFileSync(path.join(change, "commit-msg.txt"), "the change\n");
  fs.writeFileSync(path.join(change, "change.json"), JSON.stringify({ gate: ["node gate.mjs validate", "node gate.mjs test"], carry: ["node gate.mjs test"], ...changeJson }, null, 1));
  const env = { ...process.env };
  delete env.CLAUDE_CODE_SESSION_ID;
  if (session) env.CLAUDE_CODE_SESSION_ID = session;
  const kit = (...args) => {
    const r = spawnSync(process.execPath, [KIT, ...args, "--change", change], { cwd: repo, encoding: "utf8", env });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };
  /** Rewrite change.json, keeping the fixture's gate. */
  const rechange = (json) => fs.writeFileSync(path.join(change, "change.json"), JSON.stringify({ gate: ["node gate.mjs validate", "node gate.mjs test"], carry: ["node gate.mjs test"], ...json }, null, 1));
  /** Rewrite numbered lines of a file in the working tree. */
  const edit = (rel, changes) => {
    const text = fs.readFileSync(path.join(repo, rel), "utf8").split("\n");
    for (const [n, value] of Object.entries(changes)) text[Number(n) - 1] = value;
    write(rel, text.join("\n"));
  };
  /**
   * A session writing through the Edit and Write tools: the file is written,
   * then the ledger hook is told, as Claude Code tells it.
   */
  const as = (who) => {
    const through = (rel, next) => {
      const file = path.join(repo, rel);
      const pre = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
      fs.writeFileSync(file, next);
      const tool_response = pre === null ? { type: "create", filePath: file, originalFile: null, structuredPatch: [] } : { filePath: file, originalFile: pre, structuredPatch: [] };
      const payload = { session_id: who, hook_event_name: "PostToolUse", cwd: repo, tool_name: pre === null ? "Write" : "Edit", tool_input: { file_path: file }, tool_response };
      const r = spawnSync(process.execPath, [HOOK], { cwd: repo, input: JSON.stringify(payload), encoding: "utf8" });
      if (r.status !== 0 || r.stdout || r.stderr) throw new Error(`the ledger hook exited ${r.status} and printed: ${r.stdout}${r.stderr}`);
    };
    return {
      write: through,
      edit: (rel, changes) => {
        const text = fs.readFileSync(path.join(repo, rel), "utf8").split("\n");
        for (const [n, value] of Object.entries(changes)) text[Number(n) - 1] = value;
        through(rel, text.join("\n"));
      },
      append: (rel, more) => through(rel, fs.readFileSync(path.join(repo, rel), "utf8") + more),
    };
  };
  /** A peer's commit: one file written and committed on the shared branch. */
  const land = (rel, text) => {
    write(rel, text);
    git("add", "--", rel);
    git("commit", "-q", "-m", `peer writes ${rel}`);
  };
  /** `record`, as a session does before it reads the listing, then `ship`. */
  const ship = () => {
    const recorded = kit("record");
    return recorded.status === 0 ? kit("ship") : recorded;
  };
  return { repo, change, git, kit, ship, edit, write, land, as, rechange, head: () => git("rev-parse", "HEAD").trim(), show: (rel) => git("show", `HEAD:${rel}`) };
}

function test(name, body, group = "tree") {
  if (GROUP && GROUP !== group) return;
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

const OWN_A = { files: { "a.txt": { own: "MINE", count: 1 } } };

try {
  test("a commit holds this change's hunk, and the peer's hunk stays in the working tree", (check) => {
    const f = fixture("hunks", OWN_A);
    f.edit("a.txt", { 3: "line 3 MINE", 20: "line 20 PEER" });
    const base = f.head();
    const shipped = f.ship();
    check("ship exits 0", shipped.status === 0, shipped.out);
    check("the listing names one hunk as MINE and one as left", /MINE -3,1/.test(shipped.out) && /left -20,1/.test(shipped.out), shipped.out);
    check("HEAD holds the change's line", f.show("a.txt").includes("line 3 MINE"));
    check("HEAD holds no peer line", !f.show("a.txt").includes("PEER"));
    check("the commit's parent is the base", f.git("rev-parse", "HEAD~1").trim() === base);
    check("the working tree still differs from HEAD by the peer's hunk alone", f.git("diff", "-U0", "HEAD").includes("+line 20 PEER") && !f.git("diff", "-U0", "HEAD").includes("MINE"));
    check("nothing is left staged", f.git("diff", "--cached", "--name-only").trim() === "");
    check("the linked node_modules survives the clone", fs.existsSync(path.join(f.repo, "node_modules", "sentinel.txt")));
    f.kit("clean");
    check("clean removes the clone and leaves node_modules", !fs.existsSync(path.join(f.change, "clone")) && fs.existsSync(path.join(f.repo, "node_modules", "sentinel.txt")));
  });

  test("a whole file, an added file and a removed file commit together under package.json's gate", (check) => {
    const f = fixture("whole", { files: { "b.txt": { whole: true } }, added: ["new.txt"], removed: ["gone.txt"], gate: undefined });
    f.edit("b.txt", { 5: "line 5 changed", 25: "line 25 changed" });
    f.write("new.txt", "a new file\n");
    fs.rmSync(path.join(f.repo, "gone.txt"));
    f.edit("a.txt", { 9: "line 9 PEER" });
    const shipped = f.ship();
    check("ship exits 0", shipped.status === 0, shipped.out);
    check("the default gate ran validate and the tests through npm", /npm run validate: exit 0/.test(shipped.out) && /npm test: exit 0/.test(shipped.out), shipped.out);
    const names = f.git("diff", "--name-only", "HEAD~1", "HEAD").trim().split("\n").sort().join(",");
    check("the commit writes exactly the three paths", names === "b.txt,gone.txt,new.txt", names);
    check("the peer's file is still modified and uncommitted", f.git("status", "--porcelain").trim() === "M a.txt", f.git("status", "--porcelain"));
  });

  test("a removed file and a near-copy added under a new name land together, where git reads the pair as a rename", (check) => {
    const f = fixture("rename", { added: ["b2.txt"], removed: ["b.txt"] });
    // Rename detection is on here whatever this machine's global config says.
    f.git("config", "diff.renames", "true");
    f.write("b2.txt", BODY.map((l, n) => (n === 4 ? "line 5 changed" : l)).join("\n") + "\n");
    fs.rmSync(path.join(f.repo, "b.txt"));
    const recorded = f.kit("record");
    check("record exits 0", recorded.status === 0, recorded.out);
    const landed = f.kit("land", "--no-push");
    check("land exits 0 and reports the commit unpushed", landed.status === 0 && /^landed [0-9a-f]{40} not pushed \(--no-push\)/m.test(landed.out), landed.out);
    if (landed.status !== 0) return;
    const names = f.git("diff", "--no-renames", "--name-only", "HEAD~1", "HEAD").trim().split("\n").sort().join(",");
    check("the commit removes the one path and adds the other", names === "b.txt,b2.txt", names);
    const status = f.git("diff", "-M", "--name-status", "HEAD~1", "HEAD");
    check("git reads the commit as a rename", /^R\d+\tb\.txt\tb2\.txt$/m.test(status), status);
  });

  test("a whole-listed file a peer has written in is refused at record", (check) => {
    const f = fixture("whole-foreign", { files: { "b.txt": { whole: true, own: "MINE" } } });
    f.edit("b.txt", { 5: "line 5 MINE", 25: "line 25 PEER" });
    const r = f.kit("record");
    check("record exits 1", r.status === 1, r.out);
    check("it says a hunk does not match", /listed whole, and 1 hunk\(s\) do not match/.test(r.out), r.out);
  });

  test("a whole-listed file edited after record is refused at commit", (check) => {
    const f = fixture("whole-edited", { files: { "b.txt": { whole: true } } });
    f.edit("b.txt", { 5: "line 5 changed" });
    check("record and gate are green", f.kit("record").status === 0 && f.kit("gate").status === 0);
    f.edit("b.txt", { 6: "line 6 changed later" });
    const base = f.head();
    const r = f.kit("commit");
    check("commit exits 1 and names the file's changed content", r.status === 1 && /b\.txt: listed whole, and its working copy is/.test(r.out), r.out);
    check("no commit is made", f.head() === base);
    check("nothing is left staged", f.git("diff", "--cached", "--name-only").trim() === "");
  });

  test("a change recorded again after its gate is not the gated tree", (check) => {
    const f = fixture("rerecorded", { files: { "b.txt": { whole: true } } });
    f.edit("b.txt", { 5: "line 5 changed" });
    check("record and gate are green", f.kit("record").status === 0 && f.kit("gate").status === 0);
    f.edit("b.txt", { 6: "a wording fix after the gate" });
    check("the second record is green", f.kit("record").status === 0);
    const base = f.head();
    const r = f.kit("commit");
    check("commit exits 1 and says the tree is not the one that passed", r.status === 1 && /the tree is now [0-9a-f]{40}, and [0-9a-f]{40} is what passed/.test(r.out), r.out);
    check("no commit is made", f.head() === base);
  });

  test("a pattern that picks more hunks than the change wrote is refused at record", (check) => {
    const f = fixture("count", { files: { "a.txt": { own: "line", count: 1 } } });
    f.edit("a.txt", { 3: "line 3 MINE", 20: "line 20 PEER" });
    const r = f.kit("record");
    check("record exits 1 and gives both counts", r.status === 1 && /the pattern picks 2 hunk\(s\) and 1 are this change's/.test(r.out), r.out);
  });

  test("ship starts from a record, and holds a whole-listed file to it", (check) => {
    const f = fixture("ship-pin", { files: { "b.txt": { whole: true } } });
    f.edit("b.txt", { 5: "line 5 changed" });
    const base = f.head();
    const bare = f.kit("ship");
    check("ship with no record lists the change and exits 1", bare.status === 1 && /== b\.txt: 1 hunk\(s\), 1 this change's, taken whole/.test(bare.out) && /read it, then run `ship` again/.test(bare.out), bare.out);
    check("no commit is made by it", f.head() === base);
    f.edit("b.txt", { 6: "line 6 PEER, written after the listing was read" });
    const r = f.kit("ship");
    check("ship exits 1 on the later edit", r.status === 1 && /not what the last `record` hashed/.test(r.out), r.out);
    check("no commit is made", f.head() === base);
  });

  test("a peer's hunk taken into the gated tree makes the gate red, and nothing is recorded", (check) => {
    const f = fixture("gate-red", { files: { "a.txt": { own: "line", count: 2 } } });
    f.edit("a.txt", { 3: "line 3 MINE", 20: "line 20 PEER" });
    f.kit("record");
    const r = f.kit("gate");
    check("gate exits 1", r.status === 1, r.out);
    check("no gated tree is recorded", !fs.existsSync(path.join(f.change, "gated.json")));
    check("commit refuses with no gated tree", f.kit("commit").status === 1);
  });

  test("a gate that exits 0 without the expected line is not green", (check) => {
    const f = fixture("expect", { ...OWN_A, expect: ["ok - the check that never printed"] });
    f.edit("a.txt", { 3: "line 3 MINE" });
    f.kit("record");
    const r = f.kit("gate");
    check("gate exits 1", r.status === 1, r.out);
    check("it names the absent line", /expected in the gate's output and absent/.test(r.out), r.out);
  });

  test("a base that moved under the gate is refused with exit 3", (check) => {
    const f = fixture("moved", OWN_A);
    f.edit("a.txt", { 3: "line 3 MINE" });
    check("record and gate are green", f.kit("record").status === 0 && f.kit("gate").status === 0);
    f.land("other.txt", "a peer's commit\n");
    const moved = f.head();
    const r = f.kit("commit");
    check("commit exits 3", r.status === 3, r.out);
    check("no commit is made", f.head() === moved);
  });

  test("a moved base is carried when the landed commit writes neither the change's files nor gate tooling", (check) => {
    const f = fixture("carry", OWN_A);
    f.edit("a.txt", { 3: "line 3 MINE", 20: "line 20 PEER" });
    check("record and gate are green", f.kit("record").status === 0 && f.kit("gate").status === 0);
    f.land("other.txt", "a peer's commit\n");
    const moved = f.head();
    const r = f.kit("commit", "--carry");
    check("commit --carry exits 0", r.status === 0, r.out);
    check("it ran the carry stage and asks for postgate", /node gate\.mjs test: exit 0 .*carry-1\.log/.test(r.out) && /run `postgate /.test(r.out), r.out);
    check("the commit's parent is the moved base", f.git("rev-parse", "HEAD~1").trim() === moved);
    check("HEAD holds the change's line and no peer line", f.show("a.txt").includes("line 3 MINE") && !f.show("a.txt").includes("PEER"));
    const post = f.kit("postgate", f.head());
    check("postgate is green on the commit", post.status === 0 && /GREEN: the full gate passes/.test(post.out), post.out);
  });

  test("a moved base is not carried when the carry stages are red on the rebuilt tree", (check) => {
    const f = fixture("carry-red", { ...OWN_A, carry: ["node gate.mjs red"] });
    f.edit("a.txt", { 3: "line 3 MINE" });
    check("record and gate are green", f.kit("record").status === 0 && f.kit("gate").status === 0);
    f.land("other.txt", "a peer's commit\n");
    const moved = f.head();
    const r = f.kit("commit", "--carry");
    check("commit --carry exits 1 and says the stages are not green", r.status === 1 && /the carry stages are not green/.test(r.out), r.out);
    check("no commit is made", f.head() === moved);
    check("nothing is left staged", f.git("diff", "--cached", "--name-only").trim() === "");
  });

  test("a moved base is not carried over a commit that writes gate tooling", (check) => {
    const f = fixture("carry-tooling", OWN_A);
    f.edit("a.txt", { 3: "line 3 MINE" });
    check("record and gate are green", f.kit("record").status === 0 && f.kit("gate").status === 0);
    f.land("tools/validate.mjs", "// a peer changed the gate\n");
    const moved = f.head();
    const r = f.kit("commit", "--carry");
    check("commit --carry exits 3", r.status === 3, r.out);
    check("it names the tooling", /writes gate tooling \(tools\/validate\.mjs\)/.test(r.out), r.out);
    check("no commit is made", f.head() === moved);
  });

  test("a moved base is not carried over a commit that writes the change's own file", (check) => {
    const f = fixture("carry-mine", OWN_A);
    f.edit("a.txt", { 3: "line 3 MINE" });
    check("record and gate are green", f.kit("record").status === 0 && f.kit("gate").status === 0);
    const mine = fs.readFileSync(path.join(f.repo, "a.txt"), "utf8");
    f.land("a.txt", BODY.map((l, n) => (n === 27 ? "line 28 landed" : l)).join("\n") + "\n");
    f.write("a.txt", mine.replace("line 28", "line 28 landed"));
    const moved = f.head();
    const r = f.kit("commit", "--carry");
    check("commit --carry exits 3", r.status === 3, r.out);
    check("no commit is made", f.head() === moved);
  });

  test("a moved base is not carried over a commit that moves gate tooling to a path outside it", (check) => {
    const f = fixture("carry-moved-tooling", OWN_A);
    f.git("config", "diff.renames", "true");
    f.edit("a.txt", { 3: "line 3 MINE" });
    check("record and gate are green", f.kit("record").status === 0 && f.kit("gate").status === 0);
    f.git("mv", "tools/validate.mjs", "validate.mjs");
    f.git("commit", "-q", "-m", "peer moves the validator");
    const status = f.git("diff", "-M", "--name-status", "HEAD~1", "HEAD");
    check("git reads the landed commit as a rename", /^R\d+\ttools\/validate\.mjs\tvalidate\.mjs$/m.test(status), status);
    const moved = f.head();
    const r = f.kit("commit", "--carry");
    check("commit --carry exits 3 and names the tooling", r.status === 3 && /writes gate tooling \(tools\/validate\.mjs\)/.test(r.out), r.out);
    check("no commit is made", f.head() === moved);
  });

  test("ship gates again on the new base when a commit lands under its gate", (check) => {
    const f = fixture("ship-again", OWN_A);
    f.edit("a.txt", { 3: "line 3 MINE" });
    fs.writeFileSync(path.join(f.change, "land-once.json"), JSON.stringify({ repo: f.repo, file: "other.txt" }));
    const r = f.ship();
    check("ship exits 0", r.status === 0, r.out);
    check("it went again once", /the base moved under attempt 1; going again/.test(r.out) && /--- attempt 2 of 4/.test(r.out), r.out);
    check("the peer's commit is the parent", f.git("log", "-1", "--format=%s", "HEAD~1").trim() === "peer lands under the gate");
    check("HEAD holds the change's line", f.show("a.txt").includes("line 3 MINE"));
  });

  test("another session's staging in the shared index stops the run with exit 4", (check) => {
    const f = fixture("peer-staging", OWN_A);
    f.edit("a.txt", { 3: "line 3 MINE" });
    f.write("other.txt", "a peer between add and commit\n");
    f.git("add", "--", "other.txt");
    const r = f.ship();
    check("ship exits 4", r.status === 4, r.out);
    check("the peer's staging is untouched", f.git("diff", "--cached", "--name-only").trim() === "other.txt");
  });

  test("a carriage return in the content to commit is refused", (check) => {
    const f = fixture("crlf", OWN_A);
    f.edit("a.txt", { 3: "line 3 MINE\rtail" });
    f.kit("record");
    const r = f.kit("build");
    check("build exits 1", r.status === 1, r.out);
    check("it names the carriage return", /a carriage return in the content to commit/.test(r.out), r.out);
  });

  test("a change directory inside the repository is refused", (check) => {
    const f = fixture("inside", OWN_A);
    f.edit("a.txt", { 3: "line 3 MINE" });
    // A complete change, so the directory's place is the only thing to refuse.
    fs.cpSync(f.change, path.join(f.repo, "scratch"), { recursive: true });
    const r = spawnSync(process.execPath, [KIT, "record", "--change", path.join(f.repo, "scratch")], { cwd: f.repo, encoding: "utf8" });
    check("it exits 2 and says where the directory belongs", r.status === 2 && /lies outside the repository/.test(r.stderr), `${r.stdout}${r.stderr}`);
    check("nothing is recorded there", !fs.existsSync(path.join(f.repo, "scratch", "record.json")));
  });

  // --- a file's mode ---

  /** The mode a commit holds for a path. */
  const modeAt = (f, rel) => f.git("ls-tree", "HEAD", "--", rel).split(/\s+/)[0];
  /**
   * Whether a working copy reads as a mode change. Where git reads a mode from
   * the file it does until the copy is given the mode the commit holds; where
   * git reads none it never does.
   */
  const modeDrift = (f) => /^(old|new) mode /m.test(f.git("diff"));

  test("a mode named alone is committed with the content HEAD holds, once its listing is read", (check) => {
    const f = fixture("mode-only", { mode: { "other.txt": "100755" } });
    f.write("other.txt", "untouched\na PEER line in the working copy\n");
    f.edit("a.txt", { 20: "line 20 PEER" });
    const base = f.head();
    const blob = f.git("rev-parse", "HEAD:other.txt").trim();
    const bare = f.kit("ship");
    check("ship with no record lists the mode and exits 1", bare.status === 1 && /== other\.txt: mode 100644 to 100755, with the content HEAD holds/.test(bare.out) && /read it, then run `ship` again/.test(bare.out), bare.out);
    check("no commit is made by it", f.head() === base);
    const shipped = f.kit("ship");
    check("ship exits 0 on the record that listing left", shipped.status === 0, shipped.out);
    check("the commit's parent is the base", f.git("rev-parse", "HEAD~1").trim() === base);
    check("HEAD holds the file as executable", modeAt(f, "other.txt") === "100755", f.git("ls-tree", "HEAD", "--", "other.txt"));
    check("HEAD holds the content it held", f.git("rev-parse", "HEAD:other.txt").trim() === blob);
    const names = f.git("diff", "--name-only", "HEAD~1", "HEAD").trim();
    check("the commit writes that path alone", names === "other.txt", names);
    check("the peer's lines are still in the working tree, in both files", f.git("diff", "--name-only").trim().split("\n").sort().join(",") === "a.txt,other.txt" && f.git("diff", "-U0", "HEAD", "--", "other.txt").includes("+a PEER line"), f.git("status", "--porcelain"));
    check("the working copy does not read as a mode change", !modeDrift(f), f.git("diff", "--", "other.txt"));
    check("nothing is left staged", f.git("diff", "--cached", "--name-only").trim() === "");
  });

  test("a mode rides with a file's hunks, and an added file takes the mode it is given", (check) => {
    const f = fixture("mode-with", { files: { "a.txt": { own: "MINE", count: 1 } }, added: ["new.txt"], mode: { "a.txt": "100755", "new.txt": "100755" } });
    f.edit("a.txt", { 3: "line 3 MINE", 20: "line 20 PEER" });
    f.write("new.txt", "a new file\n");
    const shipped = f.ship();
    check("ship exits 0", shipped.status === 0, shipped.out);
    check("the listing names both modes, and neither as HEAD's content", /== a\.txt: mode 100644 to 100755\n/.test(shipped.out) && /== new\.txt: mode 100644 to 100755\n/.test(shipped.out), shipped.out);
    check("HEAD holds both as executable", modeAt(f, "a.txt") === "100755" && modeAt(f, "new.txt") === "100755", f.git("ls-tree", "HEAD"));
    check("HEAD holds the change's line and no peer line", f.show("a.txt").includes("line 3 MINE") && !f.show("a.txt").includes("PEER"));
    check("the peer's hunk alone is left in the working tree", f.git("diff", "-U0", "HEAD").includes("+line 20 PEER") && !f.git("diff", "-U0", "HEAD").includes("MINE") && !modeDrift(f), f.git("diff", "HEAD"));
  });

  test("a mode that is not a file's, one HEAD already holds, and one for a path the commit cannot hold are each refused", (check) => {
    const odd = fixture("mode-odd", { mode: { "other.txt": "755" } }).kit("record");
    check("a mode that is not a file's exits 2", odd.status === 2 && /"mode" gives other\.txt "755"/.test(odd.out), odd.out);
    const held = fixture("mode-held", { mode: { "other.txt": "100644" } }).kit("record");
    check("the mode HEAD holds exits 1", held.status === 1 && /other\.txt: "mode" gives 100644, the mode the commit holds for it with no word/.test(held.out), held.out);
    const gone = fixture("mode-gone", { removed: ["gone.txt"], mode: { "gone.txt": "100755" } }).kit("record");
    check("a mode for a removed path exits 2", gone.status === 2 && /"mode" names gone\.txt, and "removed" lists it/.test(gone.out), gone.out);
    const f = fixture("mode-untracked", { mode: { "new.txt": "100755" } });
    f.write("new.txt", "a new file\n");
    const untracked = f.kit("record");
    check("a mode for a path HEAD does not track exits 1", untracked.status === 1 && /new\.txt: "mode" names it, and HEAD does not track it/.test(untracked.out), untracked.out);
    // An entry that is a link, made in the index: no file system here is asked for one.
    const g = fixture("mode-link", { mode: { "link.txt": "100755" } });
    g.git("update-index", "--add", "--cacheinfo", `120000,${g.git("rev-parse", "HEAD:other.txt").trim()},link.txt`);
    g.git("commit", "-q", "-m", "a link");
    const linked = g.kit("record");
    check("a mode for a path HEAD holds as a link exits 1", linked.status === 1 && /link\.txt: HEAD holds it as 120000, which is not a file's mode/.test(linked.out), linked.out);
    check("none of them leaves a record", !fs.existsSync(path.join(f.change, "record.json")) && !fs.existsSync(path.join(g.change, "record.json")));
  });

  test("a mode named after the listing was read stops the run", (check) => {
    const f = fixture("mode-pin", { mode: { "other.txt": "100755" } });
    check("record is green", f.kit("record").status === 0);
    f.rechange({ mode: { "other.txt": "100755", "b.txt": "100755" } });
    const base = f.head();
    const built = f.kit("build");
    check("build exits 1 and says the mode is not the recorded one", built.status === 1 && /"mode" is not what `record` listed/.test(built.out), built.out);
    const r = f.kit("ship");
    check("ship exits 1 and says the mode is not the listed one", r.status === 1 && /"mode" is not what the last `record` listed/.test(r.out), r.out);
    check("no commit is made", f.head() === base);
    check("nothing is left staged", f.git("diff", "--cached", "--name-only").trim() === "");
  });

  test("a moved base is not carried over a commit that gives the change's file its mode", (check) => {
    const f = fixture("mode-carry", { mode: { "other.txt": "100755" } });
    check("record and gate are green", f.kit("record").status === 0 && f.kit("gate").status === 0);
    f.git("update-index", "--chmod=+x", "--", "other.txt");
    f.git("commit", "-q", "-m", "peer gives other.txt the mode");
    const moved = f.head();
    const r = f.kit("commit", "--carry");
    check("commit --carry exits 3 and names the file", r.status === 3 && /a commit that landed writes this change's files \(other\.txt\)/.test(r.out), r.out);
    check("no commit is made", f.head() === moved);
    const again = f.kit("record");
    check("record then says the commit would hold that mode anyway", again.status === 1 && /other\.txt: "mode" gives 100755, the mode the commit holds for it with no word/.test(again.out), again.out);
  });

  // --- the leak scanner ---

  /** A leak scanner as the commit tool calls one. It flags a path whose name holds `word`. */
  const scannerFor = (word) => `export function scanPaths(root, paths) {\n  return { errors: paths.filter((p) => p.includes("${word}")).map((p) => p + " — flagged by the fixture's scanner"), warnings: [] };\n}\n`;
  /** Commit a scanner into the fixture's `dir`, as the repository's own. */
  const scanner = (f, dir, word) => {
    fs.mkdirSync(path.join(f.repo, dir), { recursive: true });
    f.land(`${dir}/ip-scan.mjs`, scannerFor(word));
  };
  const TWO_NEW = { added: ["leak.txt", "fine.txt"] };
  const twoNew = (f) => {
    f.write("leak.txt", "a file the scanner flags\n");
    f.write("fine.txt", "a file it does not\n");
  };

  for (const [dir, where] of [
    ["tools", "tools/, where a module keeps it,"],
    ["skeleton/tools", "skeleton/tools/, where tools/ holds none,"],
  ]) {
    test(`a change the leak scanner in ${where} flags is refused with nothing staged`, (check) => {
      const f = fixture(`leak-${dir.replace("/", "-")}`, TWO_NEW);
      scanner(f, dir, "leak");
      twoNew(f);
      const base = f.head();
      const r = f.ship();
      check("the gate is green and ship exits 1", r.status === 1 && /GREEN: recorded/.test(r.out), r.out);
      check("it names the flagged path and no other", /the leak scanner flags the change set:\nleak\.txt — /.test(r.out) && !/fine\.txt — /.test(r.out), r.out);
      check("no commit is made", f.head() === base);
      check("nothing is left staged", f.git("diff", "--cached", "--name-only").trim() === "");
    });
  }

  test("where tools/ and skeleton/tools/ each hold a scanner, the one in tools/ is asked", (check) => {
    const f = fixture("leak-both", TWO_NEW);
    scanner(f, "tools", "no path holds this");
    scanner(f, "skeleton/tools", "leak");
    twoNew(f);
    const r = f.ship();
    check("ship exits 0", r.status === 0, r.out);
    const names = f.git("diff", "--name-only", "HEAD~1", "HEAD").trim().split("\n").sort().join(",");
    check("the commit writes both files", names === "fine.txt,leak.txt", names);
  });

  // The notice is assembled so this file never holds one whole.
  const NOTICE = ["All", "rights", "reserved."].join(" ");
  const LANG = `{\n${BODY.map((line, n) => `  "k${n + 1}": "${line}"`).join(",\n")}\n}\n`;
  const OWN_LANG = { files: { "lang/en.json": { own: "MINE", count: 1 } } };
  /** A fixture that holds the canonical scanner where a module keeps it, and a data file the scanner reads. */
  const withCanonScanner = (name) => {
    const f = fixture(name, OWN_LANG);
    f.land("tools/ip-scan.mjs", fs.readFileSync(path.join(TEMPLATE_ROOT, "tools", "ip-scan.mjs"), "utf8"));
    fs.mkdirSync(path.join(f.repo, "lang"));
    f.land("lang/en.json", LANG);
    return f;
  };

  test("a notice in a peer's uncommitted hunk does not stop a change whose own hunk holds none", (check) => {
    const f = withCanonScanner("leak-peer-hunk");
    f.edit("lang/en.json", { 4: '  "k3": "line 3 MINE",', 21: `  "k20": "Invented Press. ${NOTICE}",` });
    const shipped = f.ship();
    check("ship exits 0", shipped.status === 0, shipped.out);
    check("HEAD holds this change's line and no notice", f.show("lang/en.json").includes("line 3 MINE") && !f.show("lang/en.json").includes(NOTICE), f.show("lang/en.json"));
    check("the peer's hunk is still in the working tree", fs.readFileSync(path.join(f.repo, "lang", "en.json"), "utf8").includes(NOTICE));
  });

  test("a notice in this change's own hunk is refused with nothing staged, though HEAD holds the file clean", (check) => {
    const f = withCanonScanner("leak-own-hunk");
    f.edit("lang/en.json", { 4: `  "k3": "MINE. Invented Press. ${NOTICE}",` });
    const base = f.head();
    const r = f.ship();
    check("the gate is green and ship exits 1", r.status === 1 && /GREEN: recorded/.test(r.out), r.out);
    check("it names the file and the key that holds the notice", /the leak scanner flags the change set:\nlang\/en\.json: k3 contains a copyright notice/.test(r.out), r.out);
    check("no commit is made", f.head() === base);
    check("nothing is left staged", f.git("diff", "--cached", "--name-only").trim() === "");
  });

  // --- the edit ledger ---

  const ledgerCase = (name, body) => test(name, body, "ledger");
  const working = (f) => f.git("diff", "-U0", "HEAD");

  ledgerCase("a file listed with no pattern gives up the hunks the ledger says this session wrote, and ship needs no listing read", (check) => {
    const f = fixture("ledger-own", { files: { "a.txt": {} } }, { session: ME });
    f.as(ME).edit("a.txt", { 3: "line 3 by me" });
    f.as(PEER).edit("a.txt", { 20: "line 20 PEER" });
    f.as(ME).edit("a.txt", { 27: "line 27 by me" });
    const shipped = f.kit("ship");
    check("ship exits 0 with no record made first", shipped.status === 0, shipped.out);
    check("the listing says whose each hunk is", /MINE -3,1 \(-1 \+1\) \[me\]/.test(shipped.out) && /left -20,1 \(-1 \+1\) \[session session-\]/.test(shipped.out) && /MINE -27,1/.test(shipped.out), shipped.out);
    check("HEAD holds both of this session's lines", f.show("a.txt").includes("line 3 by me") && f.show("a.txt").includes("line 27 by me"));
    check("HEAD holds no peer line", !f.show("a.txt").includes("PEER"));
    check("the peer's hunk alone is left in the working tree", working(f).includes("+line 20 PEER") && !working(f).includes("by me"), working(f));
  });

  ledgerCase("a file this session alone has written is taken entire, however git pairs its lines into hunks", (check) => {
    const f = fixture("ledger-sole", {}, { session: ME });
    f.write("a.txt", "first\n\nsecond\n\n\nthird\n");
    f.git("commit", "-q", "-am", "paragraphs");
    // Two edits git reads as a line replaced and a line moved.
    f.as(ME).write("a.txt", "first\n\nnew\n\nsecond\n\n\nthird\n");
    f.as(ME).write("a.txt", "first\n\nnew\n\nsecond\n\nthird\n");
    const shipped = f.kit("ship");
    check("ship exits 0 with no record made first", shipped.status === 0, shipped.out);
    check("HEAD holds the file as the working tree does", f.show("a.txt") === "first\n\nnew\n\nsecond\n\nthird\n" && working(f) === "", f.show("a.txt"));
  });

  ledgerCase("a change written before the ledger's first record of a file is nobody's", (check) => {
    const f = fixture("ledger-before", {}, { session: ME });
    // No hook saw this one, and the file's first record finds it already there.
    f.edit("a.txt", { 20: "line 20 PEER, from before the ledger" });
    f.as(ME).edit("a.txt", { 3: "line 3 by me" });
    const first = f.kit("ship");
    check("ship stops with the earlier hunk left", first.status === 1 && /MINE -3,1 \(-1 \+1\) \[me\]/.test(first.out) && /left -20,1 \(-1 \+1\) \[no record\]/.test(first.out), first.out);
    const second = f.kit("ship");
    check("ship run again commits this session's line alone", second.status === 0 && f.show("a.txt").includes("line 3 by me") && !f.show("a.txt").includes("PEER"), second.out);
  });

  ledgerCase("a change that names no path is every file this session wrote, and no file a peer wrote", (check) => {
    const f = fixture("ledger-auto", {}, { session: ME });
    f.as(ME).edit("a.txt", { 3: "line 3 by me" });
    f.as(ME).write("new.txt", "a new file by me\n");
    f.as(PEER).edit("b.txt", { 5: "line 5 PEER" });
    f.as(PEER).write("theirs.txt", "a new file, PEER's\n");
    f.as(ME).edit("other.txt", { 1: "changed by me" });
    f.as(ME).edit("other.txt", { 1: "untouched" });
    // A file this session created and a peer has since rewritten.
    f.as(ME).write("taken-over.txt", "by me\n");
    f.as(PEER).write("taken-over.txt", "rewritten, PEER's now\n");
    const shipped = f.kit("ship");
    check("ship exits 0", shipped.status === 0, shipped.out);
    const names = f.git("diff", "--name-only", "HEAD~1", "HEAD").trim().split("\n").sort().join(",");
    check("the commit writes this session's two files", names === "a.txt,new.txt", names);
    const status = f.git("status", "--porcelain").trim().split("\n").map((l) => l.trim()).sort().join("|");
    check("the peer's files are as they were", status === "?? taken-over.txt|?? theirs.txt|M b.txt", status);
  });

  ledgerCase("a new file holding lines that are not this session's is not added on the ledger's word", (check) => {
    const f = fixture("ledger-new-mixed", {}, { session: ME });
    f.as(ME).write("new.txt", "by me\nalso by me\n");
    f.write("new.txt", "by me\nalso by me\na line by a script\n");
    const r = f.kit("record");
    check("record exits 1 and counts the lines", r.status === 1 && /REFUSED: new\.txt: new, and 1 of its 3 line\(s\) are not this session's by the ledger/.test(r.out), r.out);
    f.rechange({ added: ["new.txt"] });
    check("named under added, it is taken whole", f.kit("record").status === 0);
  });

  ledgerCase("a hunk two readings give to different sessions is not taken by a pattern", (check) => {
    const f = fixture("ledger-among", { files: { "a.txt": { own: "same" } } }, { session: ME });
    f.write("a.txt", "top\nsame\nsame\nbottom\n");
    f.git("commit", "-q", "-am", "two equal lines");
    f.as(PEER).write("a.txt", "top\nsame\nbottom\n");
    f.as(ME).write("a.txt", "top\nbottom\n");
    const r = f.kit("record");
    check("record exits 1 and names the other session", r.status === 1 && /the pattern picks a hunk, and the ledger gives session- a line in it/.test(r.out), r.out);
    f.rechange({ files: { "a.txt": {} } });
    const bare = f.kit("record");
    check("and the ledger gives this session none of it", bare.status === 1 && /the ledger gives this session none of its hunks/.test(bare.out), bare.out);
  });

  ledgerCase("two sessions' entries appended one after the other commit apart, each its own lines", (check) => {
    const f = fixture("ledger-joined", { files: { "a.txt": {} } }, { session: ME });
    f.as(PEER).append("a.txt", "## theirs\na PEER entry\n");
    f.as(ME).append("a.txt", "## mine\nmy entry\n");
    const recorded = f.kit("record");
    check("record divides the one hunk", recorded.status === 0 && /PART -30,0 \(-0 \+4\) \[me \+ session session-\]/.test(recorded.out), recorded.out);
    const shipped = f.kit("ship");
    check("ship exits 0", shipped.status === 0, shipped.out);
    check("HEAD ends with this session's entry and holds no peer line", f.show("a.txt").endsWith("line 30\n## mine\nmy entry\n"), f.show("a.txt").slice(-80));
    check("the peer's entry alone is left, ahead of this session's", /^\+## theirs\n\+a PEER entry$/m.test(working(f)) && !working(f).includes("+## mine"), working(f));
  });

  ledgerCase("a section added beside a peer's landed one is this session's, though it slides across the lines between them", (check) => {
    // The blank line closing the peer's section and the one closing this session's.
    const f = fixture("ledger-slide-landed", { files: { "a.txt": {} } }, { session: ME });
    f.write("a.txt", "## one\nbody one\n\n## last\nbody last\n");
    f.git("commit", "-q", "-am", "two sections");
    f.as(PEER).write("a.txt", "## one\nbody one\n\n## theirs\ntheir body\n\n## last\nbody last\n");
    f.git("commit", "-q", "-am", "the peer's section lands");
    f.as(ME).write("a.txt", "## one\nbody one\n\n## theirs\ntheir body\n\n## mine\nmy body\n\n## last\nbody last\n");
    const shipped = f.kit("ship");
    check("ship exits 0 with no record made first", shipped.status === 0, shipped.out);
    check("the listing gives the hunk to this session alone", /MINE -\d+,0 \(-0 \+3\) \[me\]/.test(shipped.out), shipped.out);
    check("HEAD holds the section, and the working tree nothing more", f.show("a.txt").includes("their body\n\n## mine\nmy body\n\n## last\n") && working(f) === "", f.show("a.txt"));
    // A closing line and a blank line: two lines the hunk slides across.
    const g = fixture("ledger-slide-landed-two", { files: { "a.txt": {} } }, { session: ME });
    g.write("a.txt", "start();\n\nend();\n");
    g.git("commit", "-q", "-am", "a short script");
    g.as(PEER).write("a.txt", 'start();\n\ntest("theirs", () => {\n  theirs();\n});\n\nend();\n');
    g.git("commit", "-q", "-am", "the peer's test lands");
    g.as(ME).write("a.txt", 'start();\n\ntest("theirs", () => {\n  theirs();\n});\n\ntest("mine", () => {\n  mine();\n});\n\nend();\n');
    const two = g.kit("ship");
    check("a hunk sliding across two lines ships the same way", two.status === 0 && /MINE -\d+,0 \(-0 \+4\) \[me\]/.test(two.out) && working(g) === "", two.out);
  });

  ledgerCase("a hunk that slides across a peer's line is not this session's where that line may be the one added", (check) => {
    // The peer's section has not landed: its lines are added beside this session's.
    const f = fixture("ledger-slide-unlanded", { files: { "a.txt": {} } }, { session: ME });
    f.write("a.txt", "## one\nbody one\n\n## last\nbody last\n");
    f.git("commit", "-q", "-am", "two sections");
    f.as(PEER).write("a.txt", "## one\nbody one\n\n## theirs\na PEER body\n\n## last\nbody last\n");
    f.as(ME).write("a.txt", "## one\nbody one\n\n## theirs\na PEER body\n\n## mine\nmy body\n\n## last\nbody last\n");
    const r = f.ship();
    check("the hunk is not listed as this session's alone", !/MINE -\d+,0 \(-0 \+6\)/.test(r.out) && /\(-0 \+6\) \[me \+ session session-\]/.test(r.out), r.out);
    check("HEAD holds no peer line", !f.show("a.txt").includes("PEER"), f.show("a.txt"));
    check("the peer's section is still in the working tree", /^\+a PEER body$/m.test(working(f)), working(f));
    // This session's blank line has landed and the peer's has not, and this session's section lies between them.
    const g = fixture("ledger-slide-peer-blank", { files: { "a.txt": {} } }, { session: ME });
    g.write("a.txt", "## one\nbody one\n## last\nbody last\n");
    g.git("commit", "-q", "-am", "two sections, unspaced");
    g.as(ME).write("a.txt", "## one\nbody one\n\n## last\nbody last\n");
    g.git("commit", "-q", "-am", "this session's blank line lands");
    g.as(PEER).write("a.txt", "## one\nbody one\n\n\n## last\nbody last\n");
    g.as(ME).write("a.txt", "## one\nbody one\n\n## mine\nmy body\n\n## last\nbody last\n");
    const base = g.head();
    const left = g.kit("record");
    check("record exits 1 with the hunk left and the peer named", left.status === 1 && /left -\d+,0 \(-0 \+3\) \[me \+ session session- \+ no record\]/.test(left.out) && /slides to 2 places the ledger cannot choose between, and at every one this session wrote a line of it beside session-'s/.test(left.out), left.out);
    check("no commit is made", g.head() === base);
  });

  ledgerCase("a hunk that slides where the ledger cannot place it is taken where every place is this change's, and refused where every place holds a line of it beside another's", (check) => {
    const OTHER = "session-other-0003";
    const text = (...lines) => `${lines.join("\n")}\n`;
    const first = (decl) => ["export function first() {", decl, "  return one;", "}"];
    const last = (body) => ["/**", " * The last one.", " */", "export function last() {", body, "}"];
    const tail = (doc) => ["/**", doc, " */", "export function tail() {", "  return 3;", "}"];
    const helper = (who) => ["/**", ` * The ${who} helper.`, " */", `export function ${who}() {`, `  return "${who}";`, "}"];
    const mine = first("  const one = 1; // mine");
    // This session inserts its helper with a change just above it, so the replay gives it the brace, blank and opener above the block. The peer
    // inserts its own helper after this session's and calls it; this session moves its helper to the end, and the replay keeps its brace, blank
    // and opener and takes HEAD's out; a third session rewords a line far off. The peer's helper then slides to four places, and three hold a
    // line of this session's.
    const history = (name, json) => {
      const f = fixture(name, json, { session: ME });
      f.write("a.txt", text(...first("  const one = 1;"), "", ...last("  return 2;"), "", ...tail(" * The tail.")));
      f.git("commit", "-q", "-am", "three functions");
      f.as(ME).write("a.txt", text(...mine, "", ...helper("mineHelper"), "", ...last("  return 2;"), "", ...tail(" * The tail.")));
      f.as(PEER).write("a.txt", text(...mine, "", ...helper("mineHelper"), "", ...helper("theirHelper"), "", ...last("  return 2;"), "", ...tail(" * The tail.")));
      f.as(PEER).write("a.txt", text(...mine, "", ...helper("mineHelper"), "", ...helper("theirHelper"), "", ...last("  return theirHelper();"), "", ...tail(" * The tail.")));
      f.as(ME).write("a.txt", text(...mine, "", ...helper("theirHelper"), "", ...last("  return theirHelper();"), "", ...tail(" * The tail."), "", ...helper("mineHelper")));
      f.as(OTHER).write("a.txt", text(...mine, "", ...helper("theirHelper"), "", ...last("  return theirHelper();"), "", ...tail(" * The tail, reworded."), "", ...helper("mineHelper")));
      return f;
    };
    const defines = (f) => f.show("a.txt").includes("export function theirHelper() {");
    const calls = (f) => f.show("a.txt").includes("  return theirHelper();");
    // The peer's own seat: its helper is in every place, beside this session's lines.
    const f = history("ledger-tie-refused", { files: { "a.txt": {} } });
    const base = f.head();
    const refused = f.kit("record", "--session", PEER);
    check("the session that wrote the helper and its call is refused, the hunk named", refused.status === 1 && /left -5,0 \(-0 \+7\) \[me \+ session session- \+ no record\]/.test(refused.out) && /MINE -10,1 \(-1 \+1\) \[me\]/.test(refused.out) && /REFUSED: a\.txt: the hunk at -5 \(-0 \+7\) slides to 4 places the ledger cannot choose between, and at every one this session wrote a line of it beside session-'s; landing session-'s lines first can settle where it lies, or it lands under "adopt"/.test(refused.out), refused.out);
    check("no commit is made", f.head() === base);
    // This session adopting the peer: every writer of every place is this change's.
    const g = history("ledger-tie-adopted", { files: { "a.txt": {} }, adopt: [PEER] });
    const adopted = g.ship();
    check("with the peer adopted, ship exits 0 and the hunk is taken", adopted.status === 0 && /MINE -5,0 \(-0 \+7\) \[me\]/.test(adopted.out), adopted.out);
    check("HEAD defines the helper it calls", defines(g) && calls(g), g.show("a.txt"));
    check("the third session's line alone is left", /^\+ \* The tail, reworded\.$/m.test(working(g)) && !/theirHelper|mineHelper|\/\/ mine/.test(working(g)), working(g));
    // This session alone: no place gives it a line every other place does, and its own work calls on nothing in the hunk.
    const h = history("ledger-tie-left", { files: { "a.txt": {} } });
    const alone = h.ship();
    check("this session alone ships its own lines and leaves the peer's helper", alone.status === 0 && /left -5,0 \(-0 \+7\) \[session session- \+ no record\]/.test(alone.out) && /MINE -2,1 \(-1 \+1\) \[me\]/.test(alone.out) && /MINE -18,0 \(-0 \+7\) \[me\]/.test(alone.out), alone.out);
    check("HEAD holds this session's helper, and neither the peer's helper nor its call", h.show("a.txt").includes("export function mineHelper() {") && !defines(h) && !calls(h), h.show("a.txt"));
  });

  ledgerCase("a line another session changed and changed back is this session's to change", (check) => {
    const f = fixture("ledger-undone", { files: { "a.txt": {} } }, { session: ME });
    f.as(PEER).edit("a.txt", { 3: "line 3 at 28" });
    f.as(PEER).edit("a.txt", { 3: "line 3" });
    f.as(ME).edit("a.txt", { 3: "line 3 at 28" });
    const shipped = f.kit("ship");
    check("ship exits 0 with no record made first", shipped.status === 0, shipped.out);
    check("the listing gives the hunk to this session alone", /MINE -3,1 \(-1 \+1\) \[me\]/.test(shipped.out), shipped.out);
    check("HEAD holds the line", f.show("a.txt").includes("line 3 at 28\n") && working(f) === "", f.show("a.txt").slice(0, 60));
    // Another session wrote the line back: the first one's removal was not undone by its own hand, and it is still named.
    const g = fixture("ledger-undone-by-another", { files: { "a.txt": {} } }, { session: ME });
    g.as(PEER).edit("a.txt", { 3: "line 3 at 28" });
    g.as("session-other-0003").edit("a.txt", { 3: "line 3" });
    g.as(ME).edit("a.txt", { 3: "line 3 at 28" });
    const r = g.kit("record");
    check("a line another session wrote back is still refused, the first session named", r.status === 1 && /REFUSED: a\.txt: the hunk at -3 holds this session's lines and session-'s, and they do not divide by line/.test(r.out), r.out);
  });

  ledgerCase("this session's line over a peer's uncommitted line is refused, both sessions being in the hunk", (check) => {
    const f = fixture("ledger-over-peer", { files: { "a.txt": {} } }, { session: ME });
    f.as(PEER).edit("a.txt", { 3: "line 3 PEER" });
    f.as(ME).edit("a.txt", { 3: "line 3 by me" });
    const r = f.kit("record");
    check("record exits 1 and names the peer", r.status === 1 && /REFUSED: a\.txt: the hunk at -3 holds this session's lines and session-'s, and they do not divide by line/.test(r.out), r.out);
    check("it does not say to wait for a line that is gone", /no part of it is theirs to land first by the ledger either, so it lands under "adopt"/.test(r.out) && !/it lands once theirs has/.test(r.out), r.out);
    // A peer's entry beside this session's line, over a line the peer took out: the peer's entry can still land.
    const g = fixture("ledger-beside-peer", { files: { "a.txt": {} } }, { session: ME });
    const lines = () => fs.readFileSync(path.join(g.repo, "a.txt"), "utf8").split("\n");
    g.as(PEER).write("a.txt", lines().flatMap((l) => (l === "line 3" ? ["a PEER entry"] : [l])).join("\n"));
    g.as(ME).write("a.txt", lines().flatMap((l) => (l === "a PEER entry" ? [l, "an entry by me"] : [l])).join("\n"));
    const beside = g.kit("record");
    check("a peer's line still standing in the hunk is waited for", beside.status === 1 && /they do not divide by line; it lands once theirs has/.test(beside.out), beside.out);
  });

  ledgerCase("a peer's line standing where this session's stood is left for the peer, and HEAD's line is not taken out", (check) => {
    const f = fixture("ledger-under-peer", {}, { session: ME });
    f.as(ME).edit("a.txt", { 3: "line 3 by me" });
    f.as(PEER).edit("a.txt", { 3: "line 3 PEER" });
    f.as(ME).edit("a.txt", { 20: "line 20 by me" });
    const shipped = f.kit("ship");
    check("ship exits 0", shipped.status === 0, shipped.out);
    check("the listing leaves the hunk and names both sessions", /left -3,1 \(-1 \+1\) \[me \+ session session-\]/.test(shipped.out) && /MINE -20,1/.test(shipped.out), shipped.out);
    check("HEAD holds line 3 as it was, and this session's other line", f.show("a.txt").includes("line 2\nline 3\nline 4\n") && f.show("a.txt").includes("line 20 by me"), f.show("a.txt").slice(0, 60));
    check("the peer's line alone is left in the working tree", working(f).includes("+line 3 PEER") && !working(f).includes("by me"), working(f));
    // The same where this session had reworded its own line before the peer wrote over it.
    const g = fixture("ledger-under-peer-reworded", {}, { session: ME });
    g.as(ME).edit("a.txt", { 3: "line 3 by me" });
    g.as(ME).edit("a.txt", { 3: "line 3 by me, reworded" });
    g.as(PEER).edit("a.txt", { 3: "line 3 PEER" });
    g.as(ME).edit("a.txt", { 20: "line 20 by me" });
    const again = g.kit("ship");
    check("a reworded line the peer wrote over leaves the hunk the same way", again.status === 0 && /left -3,1 \(-1 \+1\) \[me \+ session session-\]/.test(again.out) && g.show("a.txt").includes("line 2\nline 3\nline 4\n"), again.out);
    // The same where an adopted session reworded the line before the peer wrote over it.
    const h = fixture("ledger-under-peer-adopted", { files: { "a.txt": {} }, adopt: ["session-other-0003"] }, { session: ME });
    h.as(ME).edit("a.txt", { 3: "line 3 by me" });
    h.as("session-other-0003").edit("a.txt", { 3: "line 3 by the adopted session" });
    h.as(PEER).edit("a.txt", { 3: "line 3 PEER" });
    h.as(ME).edit("a.txt", { 20: "line 20 by me" });
    const adopted = h.kit("record");
    check("an adopted session's line the peer wrote over leaves it too", adopted.status === 0 && /left -3,1 \(-1 \+1\) \[me \+ session session-\]/.test(adopted.out) && /MINE -20,1/.test(adopted.out), adopted.out);
  });

  ledgerCase("a line this session took out, where a peer then put one in, is still divided: the removal lands", (check) => {
    const f = fixture("ledger-out-and-in", { files: { "a.txt": {} } }, { session: ME });
    const lines = () => fs.readFileSync(path.join(f.repo, "a.txt"), "utf8").split("\n");
    f.as(ME).write("a.txt", lines().filter((l) => l !== "line 3").join("\n"));
    f.as(PEER).write("a.txt", lines().flatMap((l) => (l === "line 2" ? [l, "a PEER line"] : [l])).join("\n"));
    const shipped = f.kit("ship");
    check("ship exits 0", shipped.status === 0, shipped.out);
    check("the listing divides the hunk", /PART -3,1 \(-1 \+1\) \[me \+ session session-\]/.test(shipped.out), shipped.out);
    check("HEAD no longer holds line 3, and holds no peer line", f.show("a.txt").includes("line 2\nline 4\n") && !f.show("a.txt").includes("PEER"), f.show("a.txt").slice(0, 60));
    check("the peer's line is left in the working tree", /^\+a PEER line$/m.test(working(f)), working(f));
    // The same where this session had first reworded the line: what it wrote there went by its own hand.
    const g = fixture("ledger-out-in-two", { files: { "a.txt": {} } }, { session: ME });
    const now = () => fs.readFileSync(path.join(g.repo, "a.txt"), "utf8").split("\n");
    g.as(ME).edit("a.txt", { 3: "line 3 by me" });
    g.as(ME).write("a.txt", now().filter((l) => l !== "line 3 by me").join("\n"));
    g.as(PEER).write("a.txt", now().flatMap((l) => (l === "line 2" ? [l, "a PEER line"] : [l])).join("\n"));
    const two = g.kit("record");
    check("a line this session wrote there and took out itself leaves the hunk divided", two.status === 0 && /PART -3,1 \(-1 \+1\) \[me \+ session session-\]/.test(two.out), two.out);
  });

  ledgerCase("a peer's line over one of two lines this session wrote is still divided: the other line lands", (check) => {
    const f = fixture("ledger-under-peer-half", { files: { "a.txt": {} } }, { session: ME });
    const lines = () => fs.readFileSync(path.join(f.repo, "a.txt"), "utf8").split("\n");
    f.as(ME).write("a.txt", lines().flatMap((l) => (l === "line 3" ? ["line 3 by me", "and another by me"] : [l])).join("\n"));
    f.as(PEER).write("a.txt", lines().map((l) => (l === "line 3 by me" ? "line 3 PEER" : l)).join("\n"));
    const shipped = f.kit("ship");
    check("ship exits 0", shipped.status === 0, shipped.out);
    check("the listing divides the hunk", /PART -3,1 \(-1 \+2\) \[me \+ session session-\]/.test(shipped.out), shipped.out);
    check("HEAD holds this session's second line where line 3 was", f.show("a.txt").includes("line 2\nand another by me\nline 4\n"), f.show("a.txt").slice(0, 80));
    check("the peer's line alone is left in the working tree", /^\+line 3 PEER$/m.test(working(f)) && !working(f).includes("by me"), working(f));
  });

  ledgerCase("a refusal says to wait only where another session can land its part of the hunk", (check) => {
    const text = (x) => fs.readFileSync(path.join(x.repo, "a.txt"), "utf8").split("\n");
    const waits = (r) => r.status === 1 && /they do not divide by line; it lands once theirs has, or under "adopt"/.test(r.out);
    const cannot = (r) => r.status === 1 && /they do not divide by line; no part of it is theirs to land first by the ledger either, so it lands under "adopt"/.test(r.out);
    // Two peer lines over HEAD's, and this session's over the first: the second still stands.
    const f = fixture("ledger-over-one-of-two", { files: { "a.txt": {} } }, { session: ME });
    f.as(PEER).write("a.txt", text(f).flatMap((l) => (l === "line 3" ? ["a PEER line", "a second PEER line"] : [l])).join("\n"));
    f.as(ME).write("a.txt", text(f).map((l) => (l === "a PEER line" ? "a line by me" : l)).join("\n"));
    const half = f.kit("record");
    check("a peer with a line still standing in the hunk", waits(half), half.out);
    // The peer reworded the line and took it out again itself: its removal is still its own to land.
    const g = fixture("ledger-peer-took-out", { files: { "a.txt": {} } }, { session: ME });
    g.as(PEER).edit("a.txt", { 3: "line 3 PEER" });
    g.as(PEER).write("a.txt", text(g).filter((l) => l !== "line 3 PEER").join("\n"));
    g.as(ME).write("a.txt", text(g).flatMap((l) => (l === "line 2" ? [l, "a line by me"] : [l])).join("\n"));
    const out = g.kit("record");
    check("a peer whose line there went by its own hand", waits(out), out.out);
    // This session's line over a peer's, and a third session's line beside it: the peer's line is gone, and the third did not remove HEAD's.
    const h = fixture("ledger-over-peer-beside-third", { files: { "a.txt": {} } }, { session: ME });
    h.as(PEER).edit("a.txt", { 3: "line 3 PEER" });
    h.as(ME).edit("a.txt", { 3: "line 3 by me" });
    h.as("session-other-0003").write("a.txt", text(h).flatMap((l) => (l === "line 3 by me" ? [l, "a third session's line"] : [l])).join("\n"));
    const three = h.kit("record");
    check("two other sessions, neither of which takes any of the hunk", cannot(three), three.out);
    // Three sessions change one line in turn: the first is left it, and the second removed nothing HEAD holds.
    const k = fixture("ledger-three-in-turn", { files: { "a.txt": {} } }, { session: ME });
    k.as(PEER).edit("a.txt", { 3: "line 3 PEER" });
    k.as("session-other-0003").edit("a.txt", { 3: "line 3 by another" });
    k.as(ME).edit("a.txt", { 3: "line 3 by me" });
    const turn = k.kit("record");
    check("a first writer whose line two sessions have written over", cannot(turn), turn.out);
  });

  ledgerCase("a line its writer landed and then changed is not taken by a session that put it back and changed it again", (check) => {
    const OTHER = "session-other-0003";
    const text = (x) => fs.readFileSync(path.join(x.repo, "a.txt"), "utf8").split("\n");
    const swap = (x, from, to) => text(x).flatMap((l) => (l === from ? to : [l])).join("\n");
    // The peer writes a line and it lands. The peer rewords it; this session puts it back as HEAD holds it and rewords it again the same way.
    const f = fixture("ledger-landed-then-reworded", {}, { session: ME });
    f.as(PEER).write("a.txt", swap(f, "line 2", ["line 2", "a PEER line"]));
    f.git("commit", "-q", "-am", "the peer's line lands");
    f.as(PEER).write("a.txt", swap(f, "a PEER line", ["a PEER line, reworded"]));
    f.as(ME).write("a.txt", swap(f, "a PEER line, reworded", ["a PEER line"]));
    f.as(ME).write("a.txt", swap(f, "a PEER line", ["a PEER line, reworded"]));
    f.as(ME).write("a.txt", swap(f, "line 20", ["line 20 by me"]));
    const shipped = f.kit("ship");
    check("ship exits 1 at the peer's reworded line", shipped.status === 1 && /REFUSED: a\.txt: the hunk at -3 holds this session's lines and session-'s, and they do not divide by line/.test(shipped.out), shipped.out);
    check("HEAD holds the line as it landed", f.show("a.txt").includes("line 2\na PEER line\nline 3\n"), f.show("a.txt").slice(0, 60));
    // The peer takes its landed line out; another session writes it back; this session takes it out.
    const g = fixture("ledger-landed-then-out", {}, { session: ME });
    g.as(PEER).write("a.txt", swap(g, "line 2", ["line 2", "a PEER line"]));
    g.git("commit", "-q", "-am", "the peer's line lands");
    g.as(PEER).write("a.txt", swap(g, "a PEER line", []));
    g.as(OTHER).write("a.txt", swap(g, "line 2", ["line 2", "a PEER line"]));
    g.as(ME).write("a.txt", swap(g, "a PEER line", []));
    const out = g.kit("ship");
    check("ship exits 1 with the removal left", out.status === 1 && /left -3,1 \(-1 \+0\)/.test(out.out) && /REFUSED: nothing in the working tree is this session's to commit, by the ledger/.test(out.out), out.out);
    check("HEAD still holds the line", g.show("a.txt").includes("line 2\na PEER line\nline 3\n"), g.show("a.txt").slice(0, 60));
  });

  ledgerCase("a line a session drafted and withdrew, which this tool then landed for another, is the next writer's to change", (check) => {
    const OTHER = "session-other-0003";
    // The peer drafts a stamp and withdraws it. This session writes the same stamp and the tool lands it. A third session writes the next.
    const f = fixture("ledger-withdrawn-then-landed", { files: { "a.txt": {} } }, { session: ME });
    f.as(PEER).edit("a.txt", { 3: "line 3 at 28" });
    f.as(PEER).edit("a.txt", { 3: "line 3" });
    f.as(ME).edit("a.txt", { 3: "line 3 at 28" });
    const first = f.kit("ship");
    check("this session's stamp lands", first.status === 0 && f.show("a.txt").includes("line 3 at 28\n"), first.out);
    f.as(OTHER).edit("a.txt", { 3: "line 3 at 29" });
    const next = f.kit("ship", "--session", OTHER);
    check("the next stamp ships with exit 0, its hunk the third session's alone", next.status === 0 && /MINE -3,1 \(-1 \+1\) \[me\]/.test(next.out), next.out);
    check("HEAD holds the next stamp", f.show("a.txt").includes("line 3 at 29\n") && working(f) === "", f.show("a.txt").slice(0, 60));
    // The same with the peer's draft landed before it withdrew it: its withdrawal is a change it has yet to land.
    const g = fixture("ledger-landed-then-withdrawn", { files: { "a.txt": {} } }, { session: ME });
    g.as(PEER).edit("a.txt", { 3: "line 3 at 28" });
    g.git("commit", "-q", "-am", "the peer's stamp lands");
    g.as(PEER).edit("a.txt", { 3: "line 3" });
    g.as(ME).edit("a.txt", { 3: "line 3 at 28" });
    g.as(OTHER).edit("a.txt", { 3: "line 3 at 29" });
    const r = g.kit("record", "--session", OTHER);
    check("a stamp that had landed when its writer withdrew it is refused to the next writer", r.status === 1 && /REFUSED: a\.txt: the hunk at -3 holds this session's lines and/.test(r.out), r.out);
    check("HEAD holds the stamp as it landed", g.show("a.txt").includes("line 3 at 28\n"), g.show("a.txt").slice(0, 60));
  });

  ledgerCase("a pattern cannot take a hunk the ledger gives another session", (check) => {
    const f = fixture("ledger-veto", { files: { "a.txt": { own: "line" } } }, { session: ME });
    f.as(ME).edit("a.txt", { 3: "line 3 by me" });
    f.as(PEER).edit("a.txt", { 20: "line 20 PEER" });
    const r = f.kit("record");
    check("record exits 1 and names the session", r.status === 1 && /the pattern picks a hunk, and the ledger gives session- a line in it/.test(r.out), r.out);
    f.rechange({ files: { "a.txt": { whole: true } } });
    const whole = f.kit("record");
    check("a whole file is refused the same way", whole.status === 1 && /listed whole, and the ledger gives session- a line in it/.test(whole.out), whole.out);
    f.as(PEER).write("new.txt", "a new file, PEER's\n");
    f.rechange({ files: { "a.txt": { own: "by me" } }, added: ["new.txt"] });
    const added = f.kit("record");
    check("so is a named new file", added.status === 1 && /new\.txt: added, and the ledger gives session- a line in it/.test(added.out), added.out);
  });

  ledgerCase("a hunk no record accounts for is left, and ship stops for its listing to be read", (check) => {
    const f = fixture("ledger-gap", {}, { session: ME });
    f.as(ME).edit("a.txt", { 3: "line 3 by me" });
    // A writer no hook saw, between two of this session's edits.
    f.edit("a.txt", { 10: "line 10 PEER, by a script" });
    f.as(ME).edit("a.txt", { 15: "line 15 by me" });
    const base = f.head();
    const first = f.kit("ship");
    check("ship stops with the hunk listed as nobody's", first.status === 1 && /left -10,1 \(-1 \+1\) \[no record\]/.test(first.out) && /read it, then run `ship` again/.test(first.out), first.out);
    check("no commit is made", f.head() === base);
    const second = f.kit("ship");
    check("ship run again exits 0", second.status === 0, second.out);
    check("HEAD holds this session's two lines and not the script's", f.show("a.txt").includes("line 3 by me") && f.show("a.txt").includes("line 15 by me") && !f.show("a.txt").includes("PEER"));
    check("the script's line is still in the working tree", working(f).includes("+line 10 PEER, by a script"));
  });

  ledgerCase("this session's line beside one no record accounts for is refused until a pattern claims the hunk", (check) => {
    const f = fixture("ledger-beside", { files: { "a.txt": {} } }, { session: ME });
    f.as(ME).edit("a.txt", { 3: "line 3 by me", 20: "line 20 by me" });
    f.edit("a.txt", { 4: "line 4, by a script" });
    const r = f.kit("record");
    check("record exits 1 and says what the hunk holds", r.status === 1 && /REFUSED: a\.txt: the hunk at -3 holds this session's lines beside 2 no record accounts for/.test(r.out), r.out);
    f.rechange({ files: { "a.txt": { own: "by me", count: 2 } } });
    const claimed = f.kit("record");
    check("a pattern takes it", claimed.status === 0 && /MINE -3,2 \(-2 \+2\) \[me \+ no record\]/.test(claimed.out), claimed.out);
    // Added lines alone: nothing of the hunk is divided off while a line in it has no writer.
    const g = fixture("ledger-beside-added", { files: { "a.txt": {} } }, { session: ME });
    g.as(ME).append("a.txt", "an entry by me\n");
    g.write("a.txt", `${fs.readFileSync(path.join(g.repo, "a.txt"), "utf8")}a line by a script\n`);
    const added = g.kit("record");
    check("a hunk of added lines is held the same way", added.status === 1 && /REFUSED: a\.txt: the hunk at -30 holds this session's lines beside 1 no record accounts for/.test(added.out), added.out);
  });

  ledgerCase("another session's records count as this one's only under adopt", (check) => {
    const f = fixture("ledger-adopt", { files: { "a.txt": {} } }, { session: ME });
    f.as(PEER).edit("a.txt", { 3: "line 3 by the session before" });
    const r = f.kit("record");
    check("record exits 1 with none of the hunks this session's", r.status === 1 && /the ledger gives this session none of its hunks/.test(r.out), r.out);
    f.rechange({ files: { "a.txt": {} }, adopt: ["session"] });
    const loose = f.kit("record");
    check("a prefix under eight characters is refused", loose.status === 2 && /give eight characters or more/.test(loose.out), loose.out);
    f.rechange({ files: { "a.txt": {} }, adopt: [PEER.slice(0, 12)] });
    const bare = f.kit("ship");
    check("ship stops for the listing, the hunk taken", bare.status === 1 && /MINE -3,1 \(-1 \+1\) \[me\]/.test(bare.out) && /read it, then run `ship` again/.test(bare.out), bare.out);
    const shipped = f.kit("ship");
    check("ship run again commits it", shipped.status === 0 && f.show("a.txt").includes("line 3 by the session before"), shipped.out);
  });

  ledgerCase("with no session id a pattern is read as before, and the ledger only labels", (check) => {
    const f = fixture("ledger-no-session", { files: { "a.txt": { own: "by a session", count: 1 } } });
    f.as(PEER).edit("a.txt", { 3: "line 3 by a session" });
    const r = f.kit("record");
    check("record takes the hunk and labels its writer", r.status === 0 && /MINE -3,1 \(-1 \+1\) \[session session-\]/.test(r.out), r.out);
    f.rechange({ files: { "a.txt": {} } });
    const bare = f.kit("record");
    check("a file with no pattern is refused", bare.status === 2 && /no session id says whose edits the ledger gives/.test(bare.out), bare.out);
    f.rechange({});
    const none = f.kit("record");
    check("so is a change that names no path", none.status === 2 && /change\.json names no path, and no session id/.test(none.out), none.out);
  });

  ledgerCase("a mode named alone takes none of this session's hunks, and beside `mine` it rides with them", (check) => {
    const f = fixture("ledger-mode", { mode: { "other.txt": "100755" }, leave: ["a.txt"] }, { session: ME });
    f.as(ME).edit("a.txt", { 3: "line 3 by me" });
    const alone = f.ship();
    check("ship exits 0", alone.status === 0, alone.out);
    const names = f.git("diff", "--name-only", "HEAD~1", "HEAD").trim();
    check("the commit writes the mode's path alone", names === "other.txt" && modeAt(f, "other.txt") === "100755", names);
    check("this session's hunk is still in the working tree", working(f).includes("+line 3 by me"), working(f));
    const g = fixture("ledger-mode-mine", { mine: true, mode: { "other.txt": "100755" } }, { session: ME });
    g.as(ME).edit("a.txt", { 3: "line 3 by me" });
    g.as(PEER).edit("b.txt", { 5: "line 5 PEER" });
    const both = g.ship();
    check("beside `mine`, ship exits 0", both.status === 0, both.out);
    const written = g.git("diff", "--name-only", "HEAD~1", "HEAD").trim().split("\n").sort().join(",");
    check("that commit writes this session's file and the mode's path", written === "a.txt,other.txt" && modeAt(g, "other.txt") === "100755" && g.show("a.txt").includes("line 3 by me"), written);
    check("the peer's file is as it was", g.git("status", "--porcelain").trim() === "M b.txt", g.git("status", "--porcelain"));
  });

  ledgerCase("a key change.json does not define is refused, and a top-level `whole` is told where it goes", (check) => {
    const f = fixture("keys-unknown", { whole: ["b.txt"], added: ["new.txt"] }, { session: ME });
    f.write("new.txt", "a new file\n");
    f.edit("b.txt", { 5: "line 5 changed" });
    const r = f.kit("record");
    check("record exits 2 naming the key and the accepted keys", r.status === 2 && /unknown key\(s\) "whole"/.test(r.out) && /the keys are files, added, removed, mode, mine, leave/.test(r.out), r.out);
    check("it hints where a whole file goes", /"files": \{"<path>": \{"whole": true\}\}/.test(r.out), r.out);
    f.rechange({ files: { "b.txt": { whole: true } }, added: ["new.txt"], colour: "red" });
    const other = f.kit("ship");
    check("any other key is refused without the hint", other.status === 2 && /unknown key\(s\) "colour"/.test(other.out) && !/"whole": true/.test(other.out), other.out);
    check("nothing is committed", f.git("log", "--oneline").trim().split("\n").length === 1);
    const landed = f.kit("land", "--no-push");
    check("land stops on it with exit 2 and prints the reason", landed.status === 2 && /unknown key\(s\) "colour"/.test(landed.out), landed.out);
  });

  ledgerCase("a change that names paths is refused while this session's recorded lines stand in a file it does not name, unless `leave` lists it", (check) => {
    const f = fixture("named-leaves-own", { added: ["new.txt"] }, { session: ME });
    f.as(ME).write("new.txt", "a new file by me\n");
    f.as(ME).edit("a.txt", { 3: "line 3 by me" });
    f.as(ME).write("fresh.txt", "a second new file by me\n");
    f.as(PEER).edit("b.txt", { 5: "line 5 PEER" });
    f.as(ME).edit("other.txt", { 1: "changed by me" });
    f.as(ME).edit("other.txt", { 1: "untouched" });
    const base = f.head();
    const r = f.kit("ship");
    const listed = /does not name: (.*?)\. Name them/.exec(r.out)?.[1];
    check("ship exits 1 listing both files, and neither the peer's nor the reverted one", r.status === 1 && listed === "a.txt, fresh.txt", r.out);
    check("the refusal says how to leave them", /"leave"/.test(r.out), r.out);
    check("no commit is made", f.head() === base);
    f.rechange({ added: ["new.txt"], leave: ["a.txt"] });
    const half = f.kit("ship");
    check("one file left and the other unnamed is still refused, naming the unnamed one", half.status === 1 && /does not name: fresh\.txt\. Name them/.test(half.out), half.out);
    f.rechange({ added: ["new.txt"], leave: ["a.txt", "fresh.txt"] });
    const shipped = f.ship();
    check("with both under `leave` ship exits 0", shipped.status === 0, shipped.out);
    const names = f.git("diff", "--name-only", "HEAD~1", "HEAD").trim();
    check("the commit holds the named file alone", names === "new.txt", names);
    check("the left files keep this session's lines in the working tree", working(f).includes("+line 3 by me") && fs.existsSync(path.join(f.repo, "fresh.txt")), working(f));

    const g = fixture("named-leaves-own-land", { added: ["new.txt"] }, { session: ME });
    g.as(ME).write("new.txt", "a new file by me\n");
    g.as(ME).edit("a.txt", { 3: "line 3 by me" });
    const before = g.head();
    const landed = g.kit("land", "--no-push");
    check("land exits 1 and its output names the file left", landed.status === 1 && /does not name: a\.txt\. Name them/.test(landed.out), landed.out);
    check("land makes no commit", g.head() === before);

    const m = fixture("mode-leaves-own", { mode: { "a.txt": "100755" } }, { session: ME });
    m.as(ME).edit("a.txt", { 3: "line 3 by me" });
    const refused = m.kit("record");
    check("a mode path holding this session's lines is refused without `leave`", refused.status === 1 && /does not name: a\.txt\. Name them/.test(refused.out), refused.out);
    m.rechange({ mode: { "a.txt": "100755" }, leave: ["a.txt"] });
    const ok = m.ship();
    check("and lands with the mode and the lines left, once `leave` lists it", ok.status === 0 && modeAt(m, "a.txt") === "100755" && working(m).includes("+line 3 by me"), ok.out);
  });

  ledgerCase("a change that names a file whose lines the peer wrote is not refused for the peer's file, and `{}` is unchanged", (check) => {
    const f = fixture("named-peer-only", { files: { "a.txt": {} } }, { session: ME });
    f.as(ME).edit("a.txt", { 3: "line 3 by me" });
    f.as(PEER).edit("b.txt", { 5: "line 5 PEER" });
    const shipped = f.kit("ship");
    check("ship exits 0", shipped.status === 0, shipped.out);
    const g = fixture("empty-takes-all", {}, { session: ME });
    g.as(ME).edit("a.txt", { 3: "line 3 by me" });
    g.as(ME).edit("b.txt", { 5: "line 5 by me" });
    const all = g.kit("ship");
    const names = all.status === 0 ? g.git("diff", "--name-only", "HEAD~1", "HEAD").trim().split("\n").sort().join(",") : all.out;
    check("`{}` still takes every file this session wrote", all.status === 0 && names === "a.txt,b.txt", names);
    const h = fixture("mine-beside-names", { mine: true, added: ["new.txt"] }, { session: ME });
    h.as(ME).write("new.txt", "a new file by me\n");
    h.as(ME).edit("a.txt", { 3: "line 3 by me" });
    const beside = h.ship();
    check("`mine` beside named paths is not refused and takes the unnamed file", beside.status === 0 && h.show("a.txt").includes("line 3 by me"), beside.out);
  });

  ledgerCase("a session with nothing of its own in the working tree has nothing to commit", (check) => {
    const f = fixture("ledger-empty", {}, { session: ME });
    f.as(PEER).edit("a.txt", { 3: "line 3 PEER" });
    const r = f.kit("record");
    check("record exits 1", r.status === 1 && /nothing in the working tree is this session's to commit/.test(r.out), r.out);
  });
} finally {
  // A clone a failed case left behind may still hold a link into its fixture's
  // node_modules; the fixture is deleted with it, so nothing outside is reached.
  fs.rmSync(tmp, { recursive: true, force: true });
}

const failures = results.filter((ok) => !ok).length;
const shown = path.relative(TEMPLATE_ROOT, KIT);
console.log(`test-commit-own-hunks: ${results.length} cases against ${shown.startsWith("..") ? KIT : shown}, ${failures} failed`);
if (failures) process.exit(1);
