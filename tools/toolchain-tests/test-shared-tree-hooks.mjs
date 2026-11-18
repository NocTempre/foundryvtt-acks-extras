/**
 * Drives the two shared-tree hooks and the ledger's reader against throwaway
 * repositories and checks what each exists to guarantee:
 *
 * - `edit-ledger.mjs`, fed payloads shaped as the Edit and Write tools report
 *   them, records a write only with a `pre` it can stand behind;
 * - `ledger.mjs`, over what the hook wrote, gives a line to the session that
 *   wrote it and to nobody when a writer no hook saw came between;
 * - `shared-tree-guard.mjs` denies the hand-run git commands that go around
 *   the commit tool, in the repositories it guards and nowhere else;
 * - both hooks stand down in a linked work tree, judged by the path they act
 *   on and never by the session's directory.
 *
 * Usage:  node tools/toolchain-tests/test-shared-tree-hooks.mjs [--hook <edit-ledger.mjs>] [--reader <ledger.mjs>] [--guard <shared-tree-guard.mjs>]
 *         (each defaults to the copy in this repository; pass a modified copy
 *         to confirm a case fails when the behaviour it guards is broken)
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";

const TEMPLATE_ROOT = path.dirname(path.dirname(path.dirname(url.fileURLToPath(import.meta.url))));
const option = (name, fallback) => path.resolve(process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : path.join(TEMPLATE_ROOT, fallback));
const HOOK = option("--hook", ".claude/hooks/edit-ledger.mjs");
const READER = option("--reader", ".claude/skills/acks-commit/ledger.mjs");
const GUARD = option("--guard", ".claude/hooks/shared-tree-guard.mjs");
const TOOL = ".claude/skills/acks-commit/commit-own-hunks.mjs";

const { blame, writersOf, soleWriter, readRecords, prune, ORIGIN, NOBODY } = await import(url.pathToFileURL(READER).href);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "acks-hooks-"));
const results = [];
const BODY = Array.from({ length: 12 }, (_, n) => `line ${n + 1}`);
const ME = "session-me";
const PEER = "session-peer";
const OTHER = "session-other";

/**
 * The patch the Edit and Write tools report for a change in one place: one
 * hunk with up to three lines of context either side.
 */
function patchOf(pre, next) {
  const a = pre.split("\n");
  const b = next.split("\n");
  if (a[a.length - 1] === "") a.pop();
  if (b[b.length - 1] === "") b.pop();
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  if (head === a.length && head === b.length) return [];
  const before = Math.min(3, head);
  const after = Math.min(3, tail);
  const lines = [
    ...a.slice(head - before, head).map((l) => ` ${l}`),
    ...a.slice(head, a.length - tail).map((l) => `-${l}`),
    ...b.slice(head, b.length - tail).map((l) => `+${l}`),
    ...a.slice(a.length - tail, a.length - tail + after).map((l) => ` ${l}`),
  ];
  return [{ oldStart: head - before + 1, oldLines: before + (a.length - tail - head) + after, newStart: head - before + 1, newLines: before + (b.length - tail - head) + after, lines }];
}

/** A committed repository holding `a.txt`, with the stand-ins a case asks for. */
function fixture(name, { origin = null, tool = true } = {}) {
  const repo = path.join(tmp, name);
  fs.mkdirSync(repo, { recursive: true });
  const abs = (rel) => path.join(repo, rel);
  const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  fs.writeFileSync(abs(".gitattributes"), "* text=auto eol=lf\n");
  fs.writeFileSync(abs(".gitignore"), "local/\n");
  fs.writeFileSync(abs("a.txt"), `${BODY.join("\n")}\n`);
  if (tool) {
    fs.mkdirSync(path.dirname(abs(TOOL)), { recursive: true });
    fs.writeFileSync(abs(TOOL), "// stands for the commit tool\n");
  }
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "test");
  git("config", "commit.gpgsign", "false");
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  if (origin) git("remote", "add", "origin", origin);
  const gitDir = abs(".git");
  const read = (rel) => fs.readFileSync(abs(rel), "utf8");

  /** Run the ledger hook with one payload and answer what it printed and how it ended. */
  const hook = (payload, cwd = repo) => {
    const r = spawnSync(process.execPath, [HOOK], { cwd, input: typeof payload === "string" ? payload : JSON.stringify(payload), encoding: "utf8" });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };
  /**
   * One Edit or Write as a session makes it: the file is written, then the
   * hook is told. `shape` picks what the tool's result carries.
   */
  const write = (session, rel, next, shape = "original", extra = {}) => {
    const pre = fs.existsSync(abs(rel)) ? read(rel) : null;
    fs.mkdirSync(path.dirname(abs(rel)), { recursive: true });
    fs.writeFileSync(abs(rel), next);
    const payload = { session_id: session, hook_event_name: "PostToolUse", cwd: repo, tool_name: "Edit", tool_input: { file_path: abs(rel) }, tool_response: { filePath: abs(rel) } };
    const patch = pre === null ? [] : patchOf(pre, next);
    if (pre === null) Object.assign(payload, { tool_name: "Write", tool_response: { type: "create", filePath: abs(rel), content: next, structuredPatch: [], originalFile: null } });
    else if (shape === "original") Object.assign(payload.tool_response, { originalFile: pre, structuredPatch: patch });
    else if (shape === "patch") Object.assign(payload.tool_response, { originalFile: null, structuredPatch: patch });
    else if (shape === "truncated") Object.assign(payload.tool_response, { originalFile: pre.split("\n").slice(0, 4).join("\n"), structuredPatch: patch });
    else if (shape === "misfit") Object.assign(payload.tool_response, { originalFile: null, structuredPatch: patch.map((h) => ({ ...h, newStart: h.newStart + 1 })) });
    else if (shape === "replace") Object.assign(payload.tool_input, extra);
    Object.assign(payload, extra.payload ?? {});
    delete payload.tool_input.payload;
    const r = hook(payload);
    if (r.status !== 0 || r.out) throw new Error(`the ledger hook exited ${r.status} and printed: ${r.out}`);
  };
  /** A write no hook sees: a script, a formatter, a session older than the hook. */
  const unseen = (rel, next) => fs.writeFileSync(abs(rel), next);
  /** Lines of a file with numbered lines replaced, removed (null) or followed by more (an array). */
  const change = (rel, changes) => {
    const out = [];
    read(rel).replace(/\n$/, "").split("\n").forEach((line, i) => {
      const to = changes[i + 1];
      if (to === undefined) out.push(line);
      else if (Array.isArray(to)) out.push(line, ...to);
      else if (to !== null) out.push(to);
    });
    return `${out.join("\n")}\n`;
  };
  /** The working tree's zero-context hunks against HEAD, as the commit tool reads them. */
  const hunks = (rel) => {
    const out = [];
    for (const line of git("diff", "-U0", "--no-color", "HEAD", "--", rel).split("\n")) {
      const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (m) out.push({ newStart: Number(m[3]), plus: [], minus: [] });
      else if (out.length && line.startsWith("+")) out[out.length - 1].plus.push(line.slice(1));
      else if (out.length && line.startsWith("-")) out[out.length - 1].minus.push(line.slice(1));
    }
    return out;
  };
  const blamed = (rel) => blame(gitDir, rel, read(rel));
  /** The writers of every hunk of a file, one entry per hunk. */
  const writers = (rel) => {
    const b = blamed(rel);
    const all = hunks(rel);
    return all.map((h) => writersOf(b, h, all));
  };
  return { repo, abs, git, gitDir, read, hook, write, unseen, change, hunks, blamed, writers };
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
  results.push(!problems.length);
  console.log(`${problems.length ? "FAIL" : "ok"} - ${name}`);
  for (const p of problems) console.log(`    ${p}`);
}

const all = (list, value) => list.length > 0 && list.every((w) => w === value);
const show = (v) => JSON.stringify(v);

try {
  // --- the ledger: what the hook records and what the reader makes of it ---

  for (const shape of ["original", "patch"]) {
    test(`a session's edit is its own, by the tool's ${shape === "original" ? "copy of the file" : "patch undone"}`, (check) => {
      const f = fixture(`own-${shape}`);
      f.write(ME, "a.txt", f.change("a.txt", { 3: "line 3 MINE", 7: ["added by me"] }), shape);
      const w = f.writers("a.txt");
      check("two hunks", w.length === 2, show(w));
      check("the replacement is this session's, both sides", all(w[0].added, ME) && all(w[0].removed, ME), show(w[0]));
      check("the insertion is this session's", all(w[1].added, ME) && w[1].removed.length === 0, show(w[1]));
      const b = f.blamed("a.txt");
      check("a line nobody touched is older than the ledger", b.owners[0] === ORIGIN && b.owners[4] === ORIGIN, show(b.owners));
      check("the record says how its `pre` was found", readRecords(f.gitDir).get("a.txt")[0].how === shape, show(readRecords(f.gitDir).get("a.txt")));
    });
  }

  test("two sessions in one file each keep their own lines", (check) => {
    const f = fixture("two");
    f.write(ME, "a.txt", f.change("a.txt", { 3: "line 3 MINE" }));
    f.write(PEER, "a.txt", f.change("a.txt", { 9: "line 9 PEER" }));
    f.write(ME, "a.txt", f.change("a.txt", { 5: "line 5 MINE" }));
    const w = f.writers("a.txt");
    check("three hunks", w.length === 3, show(w));
    check("line 3 is this session's", all(w[0].added, ME), show(w[0]));
    check("line 5 is this session's", all(w[1].added, ME), show(w[1]));
    check("line 9 is the peer's, both sides", all(w[2].added, PEER) && all(w[2].removed, PEER), show(w[2]));
  });

  test("a writer no hook saw is nobody, and the next session's record does not take its lines", (check) => {
    const f = fixture("unseen");
    f.write(ME, "a.txt", f.change("a.txt", { 3: "line 3 MINE" }));
    f.unseen("a.txt", f.change("a.txt", { 6: "line 6 UNSEEN", 10: null }));
    f.write(ME, "a.txt", f.change("a.txt", { 8: "line 8 MINE" }));
    const w = f.writers("a.txt");
    check("four hunks", w.length === 4, show(w));
    check("line 3 is this session's", all(w[0].added, ME), show(w[0]));
    check("the unseen replacement is nobody's, both sides", all(w[1].added, NOBODY) && all(w[1].removed, NOBODY), show(w[1]));
    check("line 8 is this session's", all(w[2].added, ME), show(w[2]));
    check("the unseen removal is nobody's", w[3].added.length === 0 && all(w[3].removed, NOBODY), show(w[3]));
  });

  test("a write after the last record is nobody's", (check) => {
    const f = fixture("after");
    f.write(ME, "a.txt", f.change("a.txt", { 3: "line 3 MINE" }));
    f.unseen("a.txt", f.change("a.txt", { 3: "line 3 MINE, then reformatted" }));
    const w = f.writers("a.txt");
    check("the line a script rewrote is not this session's", all(w[0].added, NOBODY), show(w[0]));
  });

  test("a record with no `pre` gives its whole write to nobody", (check) => {
    const f = fixture("no-pre");
    f.unseen("a.txt", f.change("a.txt", { 9: "line 9 PEER, uncommitted" }));
    f.write(ME, "a.txt", f.change("a.txt", { 3: "line 3 MINE" }), "none");
    const w = f.writers("a.txt");
    check("the record holds no `pre`", readRecords(f.gitDir).get("a.txt")[0].pre === null);
    check("neither hunk is this session's", w.every((h) => !h.added.includes(ME)), show(w));
  });

  test("a copy of the original that is not the whole file is not believed", (check) => {
    const f = fixture("truncated");
    f.unseen("a.txt", f.change("a.txt", { 9: "line 9 PEER, uncommitted" }));
    f.write(ME, "a.txt", f.change("a.txt", { 3: "line 3 MINE" }), "truncated");
    const rec = readRecords(f.gitDir).get("a.txt")[0];
    check("the record holds no `pre`", rec.pre === null && rec.how === "none", show(rec));
    check("the peer's line is not this session's", f.writers("a.txt").every((h) => !h.added.includes(ME)), show(f.writers("a.txt")));
  });

  test("a patch that does not fit the file on disk is not undone", (check) => {
    const f = fixture("misfit");
    f.write(ME, "a.txt", f.change("a.txt", { 3: "line 3 MINE" }), "misfit");
    const rec = readRecords(f.gitDir).get("a.txt")[0];
    check("the record holds no `pre`", rec.pre === null && rec.how === "none", show(rec));
  });

  test("one replacement is undone where the new text occurs once, and not where it occurs twice", (check) => {
    const f = fixture("replace");
    f.write(ME, "a.txt", f.change("a.txt", { 3: "line 3 MINE" }), "replace", { old_string: "line 3", new_string: "line 3 MINE" });
    check("occurring once, the line is this session's", all(f.writers("a.txt")[0].added, ME), show(f.writers("a.txt")));
    const g = fixture("replace-twice");
    g.unseen("a.txt", g.change("a.txt", { 9: "the same words" }));
    g.write(ME, "a.txt", g.change("a.txt", { 3: "the same words" }), "replace", { old_string: "line 3", new_string: "the same words" });
    check("occurring twice, the record holds no `pre`", readRecords(g.gitDir).get("a.txt")[0].pre === null);
    check("and nothing is this session's", g.writers("a.txt").every((h) => !h.added.includes(ME)), show(g.writers("a.txt")));
  });

  test("a removal is its remover's, by where it happened", (check) => {
    const f = fixture("removal");
    f.write(ME, "a.txt", f.change("a.txt", { 4: null }));
    f.write(PEER, "a.txt", f.change("a.txt", { 7: null }));
    f.unseen("a.txt", f.change("a.txt", { 9: null }));
    const w = f.writers("a.txt");
    check("three removals", w.length === 3 && w.every((h) => h.added.length === 0), show(w));
    check("this session's", all(w[0].removed, ME), show(w[0]));
    check("the peer's", all(w[1].removed, PEER), show(w[1]));
    check("nobody's", all(w[2].removed, NOBODY), show(w[2]));
  });

  test("a line a session wrote and removed again does not claim a peer's removal of the same text", (check) => {
    const f = fixture("churn");
    fs.writeFileSync(f.abs("a.txt"), `${["same", "same", ...BODY].join("\n")}\n`);
    f.git("commit", "-q", "-am", "two equal lines");
    // This session adds an equal line between the two and takes it out again.
    f.write(ME, "a.txt", `${["same", "same", "same", ...BODY].join("\n")}\n`);
    f.write(ME, "a.txt", `${["same", "same", ...BODY].join("\n")}\n`);
    // A writer no hook saw removes one of HEAD's two.
    f.unseen("a.txt", `${["same", ...BODY].join("\n")}\n`);
    const w = f.writers("a.txt");
    check("one removal", w.length === 1 && w[0].removed.length === 1, show(w));
    check("it is nobody's", w[0].removed[0] === NOBODY, show(w));
  });

  test("two equal lines two sessions removed are nobody's to take, and both sessions are named", (check) => {
    const f = fixture("removed-twice");
    f.unseen("a.txt", "top\nsame\nsame\nbottom\n");
    f.git("commit", "-q", "-am", "two equal lines");
    f.write(PEER, "a.txt", "top\nsame\nbottom\n");
    f.write(ME, "a.txt", "top\nbottom\n");
    const w = f.writers("a.txt");
    check("one hunk removes both, and neither removal is given to a session", w.length === 1 && show(w[0].removed) === show([NOBODY, NOBODY]), show(w));
    check("both sessions are among its writers", show([...w[0].among].sort()) === show([ME, PEER].sort()), show(w));
  });

  test("a line one session changed and changed back is the next writer's to change", (check) => {
    const f = fixture("undone");
    f.write(PEER, "a.txt", f.change("a.txt", { 3: "line 3 at 28" }));
    f.write(PEER, "a.txt", f.change("a.txt", { 3: "line 3" }));
    f.write(ME, "a.txt", f.change("a.txt", { 3: "line 3 at 28" }));
    const w = f.writers("a.txt");
    check("one hunk", w.length === 1, show(w));
    check("both sides are this session's, and nobody else is named", all(w[0].added, ME) && all(w[0].removed, ME) && w[0].among.length === 0, show(w[0]));
    check("the peer's undone wording is not read as put in the line's place", w[0].replaced.length === 0, show(w[0]));
    // The line lands, and a third session changes it again. The peer wrote that text once and took it out while HEAD held no line of it: the line HEAD holds now is this session's, and the peer's withdrawn one does not stand against its removal.
    f.git("commit", "-q", "-am", "this session's line lands");
    f.write(OTHER, "a.txt", f.change("a.txt", { 3: "line 3 at 29" }));
    const next = f.writers("a.txt");
    check("the next change's removal is its writer's, and the peer is not named", next.length === 1 && all(next[0].added, OTHER) && show(next[0].removed) === show([OTHER]) && next[0].among.length === 0, show(next));
    // A writer no hook saw changes the line the peer changed and changed back: the removal is nobody's, and is read as the text reads it.
    const g = fixture("undone-then-unseen");
    g.write(PEER, "a.txt", g.change("a.txt", { 3: "line 3 at 28" }));
    g.write(PEER, "a.txt", g.change("a.txt", { 3: "line 3" }));
    g.unseen("a.txt", g.change("a.txt", { 3: "line 3, by a script" }));
    const v = g.writers("a.txt");
    check("a removal no hook saw stays nobody's, with the peer still named", v.length === 1 && show(v[0].removed) === show([NOBODY]) && v[0].among.includes(PEER), show(v));
  });

  test("a line its remover wrote back is the next remover's, and one another hand wrote back is not", (check) => {
    const f = fixture("out-again");
    f.write(PEER, "a.txt", f.change("a.txt", { 4: null }));
    f.write(PEER, "a.txt", f.change("a.txt", { 3: ["line 4"] }));
    f.write(ME, "a.txt", f.change("a.txt", { 4: null }));
    const w = f.writers("a.txt");
    check("one removal, this session's", w.length === 1 && show(w[0].removed) === show([ME]) && w[0].among.length === 0, show(w));
    // Another session wrote the line back: the first remover did not undo its change, and still has a claim.
    const g = fixture("out-again-by-another");
    g.write(PEER, "a.txt", g.change("a.txt", { 4: null }));
    g.write(OTHER, "a.txt", g.change("a.txt", { 3: ["line 4"] }));
    g.write(ME, "a.txt", g.change("a.txt", { 4: null }));
    const v = g.writers("a.txt");
    check("one removal, nobody's, and both removers are named", v.length === 1 && show(v[0].removed) === show([NOBODY]) && show([...v[0].among].sort()) === show([ME, PEER].sort()), show(v));
    // This session took it out first, another wrote it back, the peer changed it and changed it back: the only claim left is this session's own.
    const k = fixture("out-again-own");
    k.write(ME, "a.txt", k.change("a.txt", { 4: null }));
    k.write(OTHER, "a.txt", k.change("a.txt", { 3: ["line 4"] }));
    k.write(PEER, "a.txt", k.change("a.txt", { 4: "line 4 PEER" }));
    k.write(PEER, "a.txt", k.change("a.txt", { 4: "line 4" }));
    k.write(ME, "a.txt", k.change("a.txt", { 4: null }));
    const t = k.writers("a.txt");
    check("an earlier removal of this session's own does not stand against it", t.length === 1 && show(t[0].removed) === show([ME]) && t[0].among.length === 0, show(t));
    // A writer no hook saw took the line out, and one wrote it back: what either meant is not known.
    const h = fixture("out-again-unseen");
    h.write(PEER, "a.txt", h.change("a.txt", { 25: "line 25 PEER" }));
    h.unseen("a.txt", h.change("a.txt", { 4: null }));
    h.write(PEER, "a.txt", h.change("a.txt", { 19: "line 20 PEER" }));
    h.unseen("a.txt", h.change("a.txt", { 3: ["line 4"] }));
    h.write(PEER, "a.txt", h.change("a.txt", { 10: "line 10 PEER" }));
    h.write(ME, "a.txt", h.change("a.txt", { 4: null }));
    const u = h.writers("a.txt").filter((x) => x.added.length === 0);
    check("a removal no hook saw is not read as undone", u.length === 1 && show(u[0].removed) === show([NOBODY]), show(u));
    // The peer changes the line and changes it back, twice over: each of its removals has a later line of its own to answer for it.
    const m = fixture("out-again-twice");
    m.write(PEER, "a.txt", m.change("a.txt", { 4: "line 4, a first wording" }));
    m.write(PEER, "a.txt", m.change("a.txt", { 4: "line 4" }));
    m.write(PEER, "a.txt", m.change("a.txt", { 4: "line 4, a second wording" }));
    m.write(PEER, "a.txt", m.change("a.txt", { 4: "line 4" }));
    m.write(ME, "a.txt", m.change("a.txt", { 4: "line 4 MINE" }));
    const s = m.writers("a.txt");
    check("a line changed back twice is still the next writer's", s.length === 1 && show(s[0].removed) === show([ME]) && s[0].among.length === 0, show(s));
    // The peer and then another session each change the line and change it back: each answers for its own removal alone.
    const q = fixture("out-again-in-turn");
    q.write(PEER, "a.txt", q.change("a.txt", { 4: "line 4 PEER" }));
    q.write(PEER, "a.txt", q.change("a.txt", { 4: "line 4" }));
    q.write(OTHER, "a.txt", q.change("a.txt", { 4: "line 4 OTHER" }));
    q.write(OTHER, "a.txt", q.change("a.txt", { 4: "line 4" }));
    q.write(ME, "a.txt", q.change("a.txt", { 4: "line 4 MINE" }));
    const r = q.writers("a.txt");
    check("a line two sessions each changed back is still the next writer's", r.length === 1 && show(r[0].removed) === show([ME]) && r[0].among.length === 0, show(r));
    // Two equal lines the peer took out together. It wrote one back and another session wrote the other: one line of the peer's does not answer for both removals.
    const n = fixture("out-two-back-one");
    n.unseen("a.txt", "top\nsame\nsame\nbottom\n");
    n.git("commit", "-q", "-am", "two equal lines");
    n.write(PEER, "a.txt", "top\nbottom\n");
    n.write(PEER, "a.txt", "top\nsame\nbottom\n");
    n.write(OTHER, "a.txt", "top\nsame\nsame\nbottom\n");
    n.write(ME, "a.txt", "top\nbottom\n");
    const p = n.writers("a.txt");
    check("both removals are nobody's, between this session and the peer", p.length === 1 && show(p[0].removed) === show([NOBODY, NOBODY]) && show([...p[0].among].sort()) === show([ME, PEER].sort()), show(p));
  });

  test("a line changed and changed back beside another session's new line is still the next writer's", (check) => {
    const f = fixture("undone-beside");
    f.write(OTHER, "a.txt", f.change("a.txt", { 3: ["a line by another"] }));
    f.write(PEER, "a.txt", f.change("a.txt", { 3: "line 3 at 28" }));
    f.write(PEER, "a.txt", f.change("a.txt", { 3: "line 3" }));
    f.write(ME, "a.txt", f.change("a.txt", { 3: "line 3 at 28" }));
    const w = f.writers("a.txt");
    check("one hunk removes the line and adds two", w.length === 1 && w[0].removed.length === 1 && w[0].added.length === 2, show(w));
    check("the removal is this session's, beside the other session's line", show(w[0].removed) === show([ME]) && show(w[0].added) === show([ME, OTHER]) && w[0].among.length === 0, show(w[0]));
  });

  test("a line written back while the line after it is out is not told from the line it was", (check) => {
    const f = fixture("out-beside");
    f.write(ME, "a.txt", f.change("a.txt", { 4: null }));
    f.write(PEER, "a.txt", f.change("a.txt", { 3: null }));
    f.write(PEER, "a.txt", f.change("a.txt", { 2: ["line 3"] }));
    f.write(ME, "a.txt", f.change("a.txt", { 3: null }));
    const w = f.writers("a.txt");
    // The place read as HEAD does only before the first of these edits, and line 3 has been written there since.
    check("one hunk removes both, and the first is nobody's", w.length === 1 && show(w[0].removed) === show([NOBODY, ME]), show(w));
    check("both sessions are among its writers", show([...w[0].among].sort()) === show([ME, PEER].sort()), show(w));
  });

  test("two equal lines HEAD holds at one place are not told apart by when each went", (check) => {
    const f = fixture("equal-in-head");
    f.unseen("a.txt", "top\nsame\nmid\nbottom\n");
    f.git("commit", "-q", "-am", "one of the two equal lines");
    f.write(PEER, "a.txt", "top\nmid\nbottom\n");
    f.write(OTHER, "a.txt", "top\nmid\nsame\nbottom\n");
    // The second equal line lands, and the peer's removal of the first does not.
    const tree = f.read("a.txt");
    f.unseen("a.txt", "top\nsame\nmid\nsame\nbottom\n");
    f.git("commit", "-q", "-am", "the other session's line lands");
    f.unseen("a.txt", tree);
    f.write(ME, "a.txt", "top\nmine\nbottom\n");
    const w = f.writers("a.txt");
    check("one hunk removes three lines", w.length === 1 && w[0].removed.length === 3, show(w));
    check("the peer's removal is not given to this session", show(w[0].removed) === show([NOBODY, ME, ME]), show(w[0]));
    check("the peer is among its writers", w[0].among.includes(PEER), show(w[0]));
  });

  test("one of two equal lines written back and taken out again leaves both removals nobody's", (check) => {
    const f = fixture("out-thrice");
    f.unseen("a.txt", "top\nsame\nsame\nbottom\n");
    f.git("commit", "-q", "-am", "two equal lines");
    f.write(PEER, "a.txt", "top\nsame\nbottom\n");
    f.write(OTHER, "a.txt", "top\nbottom\n");
    f.write(OTHER, "a.txt", "top\nsame\nbottom\n");
    f.write(ME, "a.txt", "top\nbottom\n");
    const w = f.writers("a.txt");
    check("one hunk removes both, and neither removal is given to a session", w.length === 1 && show(w[0].removed) === show([NOBODY, NOBODY]), show(w));
    check("all three sessions are among its writers", show([...w[0].among].sort()) === show([ME, OTHER, PEER].sort()), show(w));
  });

  test("a line moved and then taken out is not told from the line it was", (check) => {
    const f = fixture("moved-out");
    f.unseen("a.txt", "top\nsame\nmid\nbottom\n");
    f.git("commit", "-q", "-am", "a line above another");
    f.write(PEER, "a.txt", "top\nmid\nsame\nbottom\n");
    f.write(ME, "a.txt", "top\nbottom\n");
    const w = f.writers("a.txt");
    check("one hunk removes both lines", w.length === 1 && w[0].removed.length === 2, show(w));
    check("the moved line's removal is nobody's, and both sessions are named", w[0].removed[0] === NOBODY && show([...w[0].among].sort()) === show([ME, PEER].sort()), show(w[0]));
  });

  test("a line one session moved and another moved back is not read as undone by the first", (check) => {
    const f = fixture("moved-and-back");
    f.unseen("a.txt", "top\nsame\nmid\nbottom\n");
    f.git("commit", "-q", "-am", "a line above another");
    // A move takes the line out and writes it in one step: that line is the move itself, and does not answer for the removal.
    f.write(PEER, "a.txt", "top\nmid\nsame\nbottom\n");
    f.write(OTHER, "a.txt", "top\nsame\nmid\nbottom\n");
    f.write(ME, "a.txt", "top\nsame MINE\nmid MINE\nbottom\n");
    const w = f.writers("a.txt");
    check("one hunk removes both lines", w.length === 1 && w[0].removed.length === 2, show(w));
    check("a removal is left to nobody, and the peer that moved the line is named", w[0].removed.includes(NOBODY) && w[0].among.includes(PEER), show(w[0]));
  });

  test("a line two sessions changed in turn is one's removal and the other's line", (check) => {
    const f = fixture("in-turn");
    f.write(PEER, "a.txt", f.change("a.txt", { 3: "line 3 PEER" }));
    f.write(ME, "a.txt", f.change("a.txt", { 3: "line 3 MINE" }));
    const w = f.writers("a.txt");
    check("the line HEAD held went by the peer, and the line standing is this session's", w.length === 1 && show(w[0].removed) === show([PEER]) && show(w[0].added) === show([ME]), show(w));
    check("what the peer wrote in its place is named as removed by this session", show(w[0].replaced) === show([{ owner: PEER, by: ME }]), show(w[0]));
    // A line taken out, and another session's line put in at the same place: neither replaced the other's.
    const g = fixture("out-and-in");
    g.write(ME, "a.txt", g.change("a.txt", { 3: null }));
    g.write(PEER, "a.txt", g.change("a.txt", { 2: ["a line by the peer"] }));
    const v = g.writers("a.txt");
    check("a removal and an insertion at one place name nothing replaced", v.length === 1 && show(v[0].removed) === show([ME]) && show(v[0].added) === show([PEER]) && v[0].replaced.length === 0, show(v));
    // A line taken out in one edit, a line written there in the next, and that line changed by another session.
    const h = fixture("out-then-in");
    h.write(ME, "a.txt", h.change("a.txt", { 3: null }));
    h.write(ME, "a.txt", h.change("a.txt", { 2: ["a line by me"] }));
    h.write(PEER, "a.txt", h.change("a.txt", { 3: "a line by the peer" }));
    const u = h.writers("a.txt");
    check("a line written in a later edit than the removal is not named as replaced", u.length === 1 && show(u[0].removed) === show([ME]) && u[0].replaced.length === 0, show(u));
    // A line changed, reworded by its own writer, and then changed by another session.
    const k = fixture("reworded");
    k.write(ME, "a.txt", k.change("a.txt", { 3: "line 3 MINE" }));
    k.write(ME, "a.txt", k.change("a.txt", { 3: "line 3 MINE, reworded" }));
    k.write(PEER, "a.txt", k.change("a.txt", { 3: "line 3 PEER" }));
    const t = k.writers("a.txt");
    check("a reworded line the peer changed is named as replaced, after the wording its writer dropped", t.length === 1 && show(t[0].replaced) === show([{ owner: ME, by: ME }, { owner: ME, by: PEER }]), show(t));
    // Three sessions change the line in turn: the second's line went by the third, and is named too.
    const m = fixture("three-in-turn");
    m.write(ME, "a.txt", m.change("a.txt", { 3: "line 3 MINE" }));
    m.write(OTHER, "a.txt", m.change("a.txt", { 3: "line 3 OTHER" }));
    m.write(PEER, "a.txt", m.change("a.txt", { 3: "line 3 PEER" }));
    const s = m.writers("a.txt");
    const pairs = (s[0]?.replaced ?? []).map((line) => `${line.owner}>${line.by}`).sort();
    check("each line written over is named with who wrote over it", s.length === 1 && show(s[0].removed) === show([ME]) && show(pairs) === show([`${ME}>${OTHER}`, `${OTHER}>${PEER}`].sort()), show(s));
  });

  test("a line taken out since the place last read as HEAD does is its remover's, whatever else was written there", (check) => {
    const f = fixture("other-text");
    // The peer changes the line and changes it back, which leaves the place as HEAD holds it. Then the line goes, with a line of another text written and removed beside it.
    f.write(PEER, "a.txt", f.change("a.txt", { 3: "line 3 at 28" }));
    f.write(PEER, "a.txt", f.change("a.txt", { 3: "line 3" }));
    f.write(OTHER, "a.txt", f.change("a.txt", { 3: ["another line"] }));
    f.write(ME, "a.txt", f.change("a.txt", { 3: null }));
    f.write(OTHER, "a.txt", f.change("a.txt", { 3: null }));
    const w = f.writers("a.txt");
    check("one removal, this session's, and the peer is not named", w.length === 1 && show(w[0].removed) === show([ME]) && w[0].among.length === 0, show(w));
  });

  test("a line its own writer took out is not told from one that had landed where HEAD holds its text elsewhere", (check) => {
    const f = fixture("own-line-out");
    const body = (...head) => `${[...head, ...BODY].join("\n")}\n`;
    f.unseen("a.txt", body("same", "same"));
    f.git("commit", "-q", "-am", "two equal lines");
    // A third equal line comes and goes by the peer's hand, and then one of HEAD's two goes.
    f.write(PEER, "a.txt", body("same", "same", "same"));
    f.write(PEER, "a.txt", body("same", "same"));
    f.write(ME, "a.txt", body("same"));
    const w = f.writers("a.txt");
    check("one removal, nobody's, and both sessions are named", w.length === 1 && show(w[0].removed) === show([NOBODY]) && show([...w[0].among].sort()) === show([ME, PEER].sort()), show(w));
  });

  /** The ledger's records of a.txt rewritten in place, each through `change`. */
  const rewrite = (f, change) => {
    const dir = path.join(f.gitDir, "acks-ledger");
    for (const name of fs.readdirSync(dir).filter((n) => n.endsWith(".jsonl"))) {
      const lines = fs.readFileSync(path.join(dir, name), "utf8").split("\n").filter(Boolean);
      fs.writeFileSync(path.join(dir, name), `${lines.map((line, i) => JSON.stringify(change(JSON.parse(line), name.slice(0, -".jsonl".length), i))).join("\n")}\n`);
    }
  };

  test("a line withdrawn before it landed does not stand against the removal of one that landed", (check) => {
    // The peer writes a line and takes it out; another session writes it there again and it lands; this session takes that out.
    const withdrawn = (name) => {
      const g = fixture(name);
      g.write(PEER, "a.txt", g.change("a.txt", { 3: ["a line"] }));
      g.write(PEER, "a.txt", g.change("a.txt", { 4: null }));
      g.write(OTHER, "a.txt", g.change("a.txt", { 3: ["a line"] }));
      g.git("commit", "-q", "-am", "the line lands");
      g.write(ME, "a.txt", g.change("a.txt", { 4: null }));
      return g;
    };
    const g = withdrawn("withdrawn");
    const v = g.writers("a.txt");
    check("the removal is this session's, and the peer is not named", v.length === 1 && show(v[0].removed) === show([ME]) && v[0].among.length === 0, show(v));
    const pool = g.blamed("a.txt").removed.flat();
    check("each tombstone names the commit HEAD was at when it was written and when it went", pool.length === 2 && pool.every((e) => /^[0-9a-f]{40}$/.test(e.bornAt) && /^[0-9a-f]{40}$/.test(e.goneAt)) && pool[0].goneAt === pool[1].bornAt && pool[1].goneAt === g.git("rev-parse", "HEAD").trim() && pool[1].bornAt !== pool[1].goneAt, show(pool));
    // The same writes with the peer's line landed before it took it out: the same lines in the same order, and the removal is the peer's to land too.
    const h = fixture("landed-then-out");
    h.write(PEER, "a.txt", h.change("a.txt", { 3: ["a line"] }));
    h.git("commit", "-q", "-am", "the peer's line lands");
    h.write(PEER, "a.txt", h.change("a.txt", { 4: null }));
    h.write(OTHER, "a.txt", h.change("a.txt", { 3: ["a line"] }));
    h.write(ME, "a.txt", h.change("a.txt", { 4: null }));
    const u = h.writers("a.txt");
    check("a line that had landed when its writer took it out is nobody's, both sessions named", u.length === 1 && show(u[0].removed) === show([NOBODY]) && show([...u[0].among].sort()) === show([ME, PEER].sort()), show(u));
    // Records that name no commit, as every record written before the hook named one.
    for (const [name, change] of [["no-head", (rec) => { const { head, ...rest } = rec; return rest; }], ["null-head", (rec) => ({ ...rec, head: null })], ["gone-head", (rec) => ({ ...rec, head: "0".repeat(40) })], ["odd-head", (rec) => ({ ...rec, head: "--help" })]]) {
      const k = withdrawn(`withdrawn-${name}`);
      rewrite(k, change);
      const t = k.writers("a.txt");
      check(`records with ${name} read as they did before a record named a commit`, t.length === 1 && show(t[0].removed) === show([NOBODY]) && show([...t[0].among].sort()) === show([ME, PEER].sort()), show(t));
    }
    // One record alone names no commit: the withdrawal, the writing of the line that landed, or its removal. Each leaves one thing unknown.
    for (const [what, session, index] of [["the withdrawal", PEER, 1], ["the line that landed", OTHER, 0], ["its removal", ME, 0]]) {
      const m = withdrawn(`withdrawn-unknown-${session}`);
      let hit = 0;
      rewrite(m, (rec, who, i) => (who === session && i === index && ++hit ? { ...rec, head: null } : rec));
      const s = m.writers("a.txt");
      check(`with no commit named for ${what}, the removal is nobody's`, hit === 1 && s.length === 1 && show(s[0].removed) === show([NOBODY]) && s[0].among.includes(PEER), show(s));
    }
    // The withdrawal and the line that landed name a commit git no longer holds: a commit that cannot be read is not one that held no such line.
    const n = withdrawn("withdrawn-unread");
    rewrite(n, (rec, who) => (who === ME ? rec : { ...rec, head: "0".repeat(40) }));
    const p = n.writers("a.txt");
    check("a commit that cannot be read says nothing of what it held", p.length === 1 && show(p[0].removed) === show([NOBODY]), show(p));
    // The peer's line lands and so does its removal of it. The text is written there again by another session, lands, and this session takes it out. HEAD held the line when the peer removed it, and no record says that removal landed.
    const q = fixture("landed-removal");
    q.write(PEER, "a.txt", q.change("a.txt", { 3: ["a line"] }));
    q.git("commit", "-q", "-am", "the peer's line lands");
    q.write(PEER, "a.txt", q.change("a.txt", { 4: null }));
    q.git("commit", "-q", "-am", "the peer's removal lands");
    q.write(OTHER, "a.txt", q.change("a.txt", { 3: ["a line"] }));
    q.git("commit", "-q", "-am", "the line lands again");
    q.write(ME, "a.txt", q.change("a.txt", { 4: null }));
    const o = q.writers("a.txt");
    check("a removal made while HEAD held the line stands, landed or not", o.length === 1 && show(o[0].removed) === show([NOBODY]) && show([...o[0].among].sort()) === show([ME, PEER].sort()), show(o));
    // Two equal lines taken out together, one written before its text landed and one after. The one written after is not known to be another line than the peer's, and neither removal is read.
    const d = fixture("withdrawn-beside-written-back");
    d.write(PEER, "a.txt", d.change("a.txt", { 3: ["a line"] }));
    d.write(PEER, "a.txt", d.change("a.txt", { 4: null }));
    d.write(OTHER, "a.txt", d.change("a.txt", { 3: ["a line"] }));
    d.git("commit", "-q", "-am", "the line lands");
    d.write(OTHER, "a.txt", d.change("a.txt", { 4: ["a line"] }));
    d.git("commit", "-q", "-am", "an equal line lands beside it");
    d.write(ME, "a.txt", d.change("a.txt", { 4: null, 5: null }));
    const e = d.writers("a.txt");
    check("each line taken out has to have been written while HEAD held none of its text", e.length === 1 && show(e[0].removed) === show([NOBODY, NOBODY]) && e[0].among.includes(PEER), show(e));
  });

  test("a line that landed after it was taken out of the working tree is still its remover's to remove", (check) => {
    const f = fixture("lands-after");
    // The peer writes a line and takes it out, and a commit built in between lands it.
    f.write(PEER, "a.txt", f.change("a.txt", { 3: ["a line"] }));
    const built = f.read("a.txt");
    f.write(PEER, "a.txt", f.change("a.txt", { 4: null }));
    const tree = f.read("a.txt");
    f.unseen("a.txt", built);
    f.git("commit", "-q", "-am", "the line lands after the peer took it out");
    f.unseen("a.txt", tree);
    // Another session writes it back while HEAD holds it, and this session takes that out.
    f.write(OTHER, "a.txt", f.change("a.txt", { 3: ["a line"] }));
    f.write(ME, "a.txt", f.change("a.txt", { 4: null }));
    const w = f.writers("a.txt");
    check("the removal is nobody's, and the peer is named", w.length === 1 && show(w[0].removed) === show([NOBODY]) && show([...w[0].among].sort()) === show([ME, PEER].sort()), show(w));
    // The line this session takes out was written before the commit, and the commit lands after this session took it out: HEAD did not hold it then.
    const g = fixture("lands-after-both");
    g.write(PEER, "a.txt", g.change("a.txt", { 3: ["a line"] }));
    g.write(PEER, "a.txt", g.change("a.txt", { 4: null }));
    g.write(OTHER, "a.txt", g.change("a.txt", { 3: ["a line"] }));
    const held = g.read("a.txt");
    g.write(ME, "a.txt", g.change("a.txt", { 4: null }));
    const after = g.read("a.txt");
    g.unseen("a.txt", held);
    g.git("commit", "-q", "-am", "the line lands after this session took it out");
    g.unseen("a.txt", after);
    const v = g.writers("a.txt");
    check("a line that had not landed when it was taken out is not read as landed", v.length === 1 && show(v[0].removed) === show([NOBODY]) && v[0].among.includes(PEER), show(v));
    // The commit built before the peer took its line out lands after another session wrote the text there again. The records are those of a line the other session landed: the working tree held the line when HEAD came to, and the removal is read as this session's.
    const k = fixture("lands-after-written-back");
    k.write(PEER, "a.txt", k.change("a.txt", { 3: ["a line"] }));
    const snapshot = k.read("a.txt");
    k.write(PEER, "a.txt", k.change("a.txt", { 4: null }));
    k.write(OTHER, "a.txt", k.change("a.txt", { 3: ["a line"] }));
    k.unseen("a.txt", snapshot);
    k.git("commit", "-q", "-am", "the peer's commit lands the line");
    k.write(ME, "a.txt", k.change("a.txt", { 4: null }));
    const t = k.writers("a.txt");
    check("a line that stood in the working tree when its text landed is its remover's", t.length === 1 && show(t[0].removed) === show([ME]), show(t));
  });

  test("the hook records the commit HEAD is at, and none where the repository has none", (check) => {
    const f = fixture("head-recorded");
    const first = f.git("rev-parse", "HEAD").trim();
    f.write(ME, "a.txt", f.change("a.txt", { 3: "line 3 MINE" }));
    f.git("commit", "-q", "-am", "a commit");
    const second = f.git("rev-parse", "HEAD").trim();
    f.write(ME, "a.txt", f.change("a.txt", { 5: "line 5 MINE" }));
    const heads = readRecords(f.gitDir).get("a.txt").map((rec) => rec.head);
    check("each record names the commit HEAD was at when it was written", first !== second && show(heads) === show([first, second]), show(heads));
    // A linked work tree has one writer and no ledger.
    const linked = path.join(tmp, "head-recorded-linked");
    f.git("worktree", "add", "-q", "--detach", linked, first);
    const there = path.join(linked, "there.txt");
    fs.writeFileSync(there, "a new file\n");
    const told = f.hook({ session_id: ME, hook_event_name: "PostToolUse", cwd: linked, tool_name: "Write", tool_input: { file_path: there }, tool_response: { type: "create", filePath: there, structuredPatch: [], originalFile: null } }, linked);
    const other = readRecords(f.gitDir).get("there.txt");
    check("a write in a linked work tree is not recorded", told.status === 0 && !told.out && other === undefined, show(other));
    check("and main's tree keeps the records it had", show(readRecords(f.gitDir).get("a.txt").map((rec) => rec.head)) === show([first, second]));
    // A repository with no commit yet.
    const repo = path.join(tmp, "head-unborn");
    fs.mkdirSync(path.dirname(path.join(repo, TOOL)), { recursive: true });
    fs.writeFileSync(path.join(repo, TOOL), "// stands for the commit tool\n");
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
    const file = path.join(repo, "new.txt");
    fs.writeFileSync(file, "a new file\n");
    const r = spawnSync(process.execPath, [HOOK], { cwd: repo, input: JSON.stringify({ session_id: ME, hook_event_name: "PostToolUse", cwd: repo, tool_name: "Write", tool_input: { file_path: file }, tool_response: { type: "create", filePath: file, structuredPatch: [], originalFile: null } }), encoding: "utf8" });
    const unborn = readRecords(path.join(repo, ".git")).get("new.txt");
    check("a write before the first commit is recorded, with no commit named", r.status === 0 && unborn?.length === 1 && unborn[0].head === null && unborn[0].how === "create", show(unborn));
  });

  test("a text the hunk also adds is not read by when", (check) => {
    const f = fixture("text-both-sides");
    f.write(PEER, "a.txt", f.change("a.txt", { 3: "line 3 at 28" }));
    f.write(PEER, "a.txt", f.change("a.txt", { 3: "line 3" }));
    f.write(ME, "a.txt", f.change("a.txt", { 3: "a line by me" }));
    const one = f.writers("a.txt");
    check("the line the peer changed and changed back is this session's to change", one.length === 1 && show(one[0].removed) === show([ME]), show(one));
    // This session writes the line's text again under its own. Git prints the new line alone; a hunk cut with the text on both sides holds a standing line that is not told from the one removed.
    f.write(ME, "a.txt", f.change("a.txt", { 3: ["line 3"] }));
    const w = writersOf(f.blamed("a.txt"), { newStart: 3, plus: ["a line by me", "line 3"], minus: ["line 3"] });
    check("the removal is nobody's, between the two sessions", w !== null && show(w.removed) === show([NOBODY]) && show([...w.among].sort()) === show([ME, PEER].sort()), show(w));
  });

  test("a removal the tombstones' text names is not read by when at another place it can slide to", (check) => {
    const f = fixture("named-by-text");
    const text = (...lines) => `${lines.join("\n")}\n`;
    f.unseen("a.txt", text("h1", "", "h2", "}", "h3", "}", "h4"));
    f.git("commit", "-q", "-am", "a short file");
    f.write(PEER, "a.txt", text("h1", "", "h3", "}", "h4"));
    f.write(PEER, "a.txt", text("h1", "", "h3", "}", "h4", "h2"));
    f.write(PEER, "a.txt", text("h1", "", "h3", "}", "a line by the peer"));
    f.write(ME, "a.txt", text("h1", "", "h3", "}"));
    f.write(ME, "a.txt", text("h1", "h2", "}"));
    f.write(ME, "a.txt", text("h1", "h2"));
    f.write(PEER, "a.txt", text("h1", "h2", "x"));
    f.write(PEER, "a.txt", text("h1", "h2"));
    f.write(PEER, "a.txt", text("h1", "h2", "h2"));
    f.write(PEER, "a.txt", text("h1", "h2", "h2", "another by the peer"));
    f.git("commit", "-q", "-am", "the whole working tree lands");
    f.write(ME, "a.txt", text("h1", "h2", "another by the peer"));
    const w = f.writers("a.txt");
    // The peer's removals landed and left their tombstones, which by text answer for the removal of an equal line. A removal the text names is not read again.
    check("one removal, read as the tombstones' text names it", w.length === 1 && show(w[0].removed) === show([PEER]) && w[0].among.length === 0, show(w));
  });

  test("two sessions' entries appended one after the other are told apart inside one hunk", (check) => {
    const f = fixture("joined");
    f.write(ME, "a.txt", `${f.read("a.txt")}## mine\nmy entry\n`);
    f.write(PEER, "a.txt", `${f.read("a.txt")}## theirs\ntheir entry\n`);
    const h = f.hunks("a.txt");
    check("git reads one hunk", h.length === 1 && h[0].plus.length === 4, show(h));
    check("its lines are two sessions'", show(f.writers("a.txt")[0].added) === show([ME, ME, PEER, PEER]), show(f.writers("a.txt")));
  });

  test("a hunk whose lines repeat their neighbours is its writer's at every place git may put it", (check) => {
    const f = fixture("slide");
    f.unseen("a.txt", "first\n\nsecond\n\n\nthird\n");
    f.git("commit", "-q", "-am", "paragraphs");
    // A paragraph and a blank line: the blank before it and it, or it and the blank after.
    f.write(ME, "a.txt", "first\n\nnew\n\nsecond\n\n\nthird\n");
    for (const hunk of [{ newStart: 2, plus: ["", "new"], minus: [] }, { newStart: 3, plus: ["new", ""], minus: [] }]) {
      const w = writersOf(f.blamed("a.txt"), hunk);
      check(`added, placed at line ${hunk.newStart}`, w !== null && all(w.added, ME), show(w));
    }
    // One of two blank lines: the first of them or the second.
    f.write(ME, "a.txt", "first\n\nnew\n\nsecond\n\nthird\n");
    for (const hunk of [{ newStart: 5, plus: [], minus: [""] }, { newStart: 6, plus: [], minus: [""] }]) {
      const w = writersOf(f.blamed("a.txt"), hunk);
      check(`removed, placed after line ${hunk.newStart}`, w !== null && all(w.removed, ME), show(w));
    }
  });

  test("a file one session alone has written says so, and a file with another writer does not", (check) => {
    const f = fixture("sole");
    f.write(ME, "a.txt", f.change("a.txt", { 3: "line 3 MINE", 7: null }));
    check("this session is its only writer", soleWriter(f.blamed("a.txt"), new Set([ME])));
    check("another session is not", !soleWriter(f.blamed("a.txt"), new Set([PEER])));
    check("the content the ledger began from is kept", f.blamed("a.txt").origin === `${BODY.join("\n")}\n`);
    f.write(PEER, "a.txt", f.change("a.txt", { 9: null }));
    check("a peer's removal ends it", !soleWriter(f.blamed("a.txt"), new Set([ME])));
    const g = fixture("sole-unseen");
    g.write(ME, "a.txt", g.change("a.txt", { 3: "line 3 MINE" }));
    g.unseen("a.txt", g.change("a.txt", { 9: "line 9 UNSEEN" }));
    check("so does a line no hook saw", !soleWriter(g.blamed("a.txt"), new Set([ME])));
  });

  test("a line that could be either of two writers' is nobody's", (check) => {
    const f = fixture("slide-two");
    f.unseen("a.txt", "first\n\nsecond\n");
    f.git("commit", "-q", "-am", "paragraphs");
    f.write(ME, "a.txt", "first\n\n\nsecond\n");
    f.git("commit", "-q", "-am", "this session's blank line lands");
    // A script adds a third blank line beside the one this session wrote.
    f.unseen("a.txt", "first\n\n\n\nsecond\n");
    for (const newStart of [2, 3, 4]) {
      const w = writersOf(f.blamed("a.txt"), { newStart, plus: [""], minus: [] });
      check(`placed at line ${newStart}`, w !== null && all(w.added, NOBODY) && w.among.includes(ME), show(w));
    }
  });

  /**
   * A history whose last write is this session's insertion beside a peer's
   * unlanded blank, with git holding a blank of HEAD's in the blank's place:
   * the peer's lines repeat HEAD's after them. `lead(step)` and `tail(step)`
   * give the lines that begin and end the tree written at each step,
   * `after[step](f, lines)` runs once that step is written, and `peer` writes
   * the blank, null for a writer no hook sees.
   */
  const peerUnlanded = (name, { lead = () => [], tail = () => [], after = {}, peer = PEER } = {}) => {
    const f = fixture(name);
    const trees = [
      [null, ["", "head two", "}", "", "}", "head four"]],
      [OTHER, ["", "head two", "}", "", "}", "}", "other one", "other two", ""]],
      [ME, ["", "mine one", "head two", "}", "", "}", "}", "other one", "other two", ""]],
      [OTHER, ["", "mine one", "head two", "}", "", "}", "}", "other one", "other three", "other four", ""]],
      [ME, ["", "mine one", "head two", "}", "", "}", "", "mine two", "}", "head four", "other three", "other four", ""]],
      [peer, ["", "mine one", "theirs", "}", "", "}", "", "}", "", "mine two", "}", "head four", "other three", "other four", ""]],
      [ME, ["", "mine one", "theirs", "}", "", "", "mine three", "", "}", "", "}", "", "mine two", "}", "head four", "other three", "other four", ""]],
    ];
    trees.forEach(([who, lines], step) => {
      const next = `${[...lead(step), ...lines, ...tail(step)].join("\n")}\n`;
      if (who === null) f.unseen("a.txt", next);
      else f.write(who, "a.txt", next);
      if (step === 0) f.git("commit", "-q", "-am", "the start");
      if (step === 2) f.git("commit", "-q", "-am", "the working tree lands");
      after[step]?.(f, lines);
    });
    return f;
  };
  /** The hunk that holds this session's insertion, read with every hunk of the file. */
  const insertion = (f) => {
    const list = f.hunks("a.txt");
    const hunk = list.find((h) => h.plus.includes("mine three"));
    return hunk ? writersOf(f.blamed("a.txt"), hunk, list) : null;
  };

  test("a hunk that slides across another writer's line is one session's only where the ledger shows its lines unlanded and the lines left out HEAD's", (check) => {
    const text = (...lines) => `${lines.join("\n")}\n`;
    // Each file holds the one hunk, read at each place it can slide to.
    const alone = (b, hunk) => writersOf(b, hunk, [hunk]);
    const placed = (f, newStart) => alone(f.blamed("a.txt"), { newStart, plus: newStart === 4 ? ["", "## mine"] : ["## mine", ""], minus: [] });
    // A peer's section lands, and this session adds one after it: the blank line closing each lets the hunk slide.
    const f = fixture("slide-landed");
    f.unseen("a.txt", text("## one", "", "## last"));
    f.git("commit", "-q", "-am", "two sections");
    f.write(PEER, "a.txt", text("## one", "", "## theirs", "", "## last"));
    f.git("commit", "-q", "-am", "the peer's section lands");
    f.write(ME, "a.txt", text("## one", "", "## theirs", "", "## mine", "", "## last"));
    for (const newStart of [4, 5]) {
      const w = placed(f, newStart);
      check(`placed at line ${newStart}, it is this session's`, w !== null && all(w.added, ME) && w.among.length === 0, show(w));
    }
    // The same section written where no hook saw it: a writer no hook saw is not one session.
    const g = fixture("slide-landed-unseen");
    g.unseen("a.txt", text("## one", "", "## last"));
    g.git("commit", "-q", "-am", "two sections");
    g.write(PEER, "a.txt", text("## one", "", "## theirs", "", "## last"));
    g.git("commit", "-q", "-am", "the peer's section lands");
    g.unseen("a.txt", text("## one", "", "## theirs", "", "## mine", "", "## last"));
    const unseen = placed(g, 5);
    check("a section no hook saw is nobody's, the peer among", unseen !== null && all(unseen.added, NOBODY) && unseen.among.includes(PEER), show(unseen));
    // This session's blank line lands; the peer adds one beside it, and this session's section goes between the two.
    const h = fixture("slide-peer-blank");
    h.unseen("a.txt", text("## one", "## last"));
    h.git("commit", "-q", "-am", "two sections, unspaced");
    h.write(ME, "a.txt", text("## one", "", "## last"));
    h.git("commit", "-q", "-am", "this session's blank line lands");
    h.write(PEER, "a.txt", text("## one", "", "", "## last"));
    h.write(ME, "a.txt", text("## one", "", "## mine", "", "## last"));
    for (const [newStart, plus] of [[2, ["", "## mine"]], [3, ["## mine", ""]]]) {
      const w = alone(h.blamed("a.txt"), { newStart, plus, minus: [] });
      check(`a blank line this session landed before its section is not shown unlanded, placed at line ${newStart}`, w !== null && all(w.added, NOBODY) && show([...w.among].sort()) === show([ME, PEER].sort()), show(w));
    }
    // A peer's unlanded lines repeat HEAD's after them, and git holds HEAD's in the peer's place, so a blank of the peer's is left out of this session's insertion.
    const k = peerUnlanded("slide-peer-unlanded");
    const working = k.read("a.txt");
    const unlanded = insertion(k);
    check("the peer's blank is not shown landed, and the insertion is nobody's, the peer among", unlanded !== null && all(unlanded.added, NOBODY) && unlanded.among.includes(PEER) && unlanded.among.includes(ME), show(unlanded));
    // The peer's lines land: its one line of a text nothing else holds is HEAD's, and so is its blank.
    k.unseen("a.txt", text("", "mine one", "theirs", "}", "", "}", "", "}", "}", "other one", "other two", ""));
    k.git("commit", "-q", "-am", "the peer's lines land");
    k.unseen("a.txt", working);
    const landed = insertion(k);
    check("once the peer's lines land, the insertion is this session's", landed !== null && all(landed.added, ME) && landed.among.length === 0, show(landed));
  });

  test("a line a place leaves out is shown landed only by a line its own writer wrote no earlier, that git holds, of a text no removal held", (check) => {
    const text = (...lines) => `${lines.join("\n")}\n`;
    /** One line lands alone: `head` commits, and the working tree `tree` is put back. */
    const land = (f, head, tree) => {
      f.unseen("a.txt", head);
      f.git("commit", "-q", "-am", "one line lands");
      f.unseen("a.txt", tree);
    };
    const cases = [
      ["the peer's landed line is older than its blank", "left-out-older", {
        tail: (step) => (step >= 2 ? ["peer zero"] : []),
        after: { 1: (f, lines) => f.write(PEER, "a.txt", text(...lines, "peer zero")) },
      }],
      ["the line that landed after the blank is another session's", "left-out-another", {
        tail: (step) => (step >= 6 ? ["other five"] : []),
        after: { 5: (f, lines) => { f.write(OTHER, "a.txt", text(...lines, "other five")); land(f, `${f.git("show", "HEAD:a.txt")}other five\n`, text(...lines, "other five")); } },
      }],
      ["the peer wrote back a line of HEAD's that another session took out", "left-out-written-back", {
        tail: () => ["head five"],
        after: { 5: (f, lines) => { f.write(OTHER, "a.txt", text(...lines)); f.write(PEER, "a.txt", text(...lines, "head five")); } },
      }],
      // The script's line begins the file, so the replay's trim keeps the script's blank beside the insertion.
      ["a writer no hook saw wrote the blank, and a line of its own landed after it", "left-out-unseen", {
        peer: null,
        lead: (step) => (step >= 5 ? ["script line"] : []),
        after: { 5: (f, lines) => land(f, `script line\n${f.git("show", "HEAD:a.txt")}`, text("script line", ...lines)) },
      }],
    ];
    for (const [what, name, options] of cases) {
      const f = peerUnlanded(name, options);
      const w = insertion(f);
      const b = f.blamed("a.txt");
      check(`${what}: the insertion is nobody's`, w !== null && all(w.added, NOBODY), `${show(w)}\n${show(b.lines.map((line, i) => `${b.owners[i]}:${line}`))}`);
    }
  });

  test("a new file is its creator's, and a line a script adds to it is not", (check) => {
    const f = fixture("create");
    f.write(ME, "docs/new.md", "one\ntwo\n");
    check("every line is this session's", all(f.blamed("docs/new.md").owners, ME), show(f.blamed("docs/new.md")));
    f.unseen("docs/new.md", "one\ntwo\nthree, by a script\n");
    check("the added line is nobody's", show(f.blamed("docs/new.md").owners) === show([ME, ME, NOBODY]), show(f.blamed("docs/new.md")));
  });

  test("a file no record names has no blame", (check) => {
    const f = fixture("none");
    f.unseen("a.txt", f.change("a.txt", { 3: "line 3" + " changed" }));
    check("blame is null", f.blamed("a.txt") === null);
  });

  test("CRLF content is read as the lines git reads", (check) => {
    const crlf = (text) => text.replace(/\r?\n/g, "\r\n");
    for (const shape of ["original", "patch"]) {
      const f = fixture(`crlf-${shape}`);
      f.unseen("a.txt", crlf(f.read("a.txt")));
      f.write(ME, "a.txt", crlf(f.change("a.txt", { 3: "line 3 MINE" })), shape);
      const w = f.writers("a.txt");
      check(`${shape}: one hunk, this session's`, w.length === 1 && all(w[0].added, ME) && all(w[0].removed, ME), show(w));
      check(`${shape}: the record holds a \`pre\``, readRecords(f.gitDir).get("a.txt")[0].how === shape, show(readRecords(f.gitDir).get("a.txt")));
    }
  });

  test("a change too large to align is nobody's", (check) => {
    const f = fixture("large");
    const big = (tag) => `${Array.from({ length: 2100 }, (_, n) => `${tag} ${n}`).join("\n")}\n`;
    f.unseen("a.txt", `top\n${big("old")}bottom\n`);
    f.git("commit", "-q", "-am", "a large file");
    f.write(ME, "a.txt", `top\n${big("new")}bottom\n`);
    const b = f.blamed("a.txt");
    check("no line of the rewrite is this session's", !b.owners.includes(ME), `${b.owners.filter((o) => o === ME).length} line(s)`);
  });

  test("the hook records nothing it cannot place, and never blocks", (check) => {
    const f = fixture("quiet");
    const outside = path.join(tmp, "outside.txt");
    fs.writeFileSync(outside, "x\n");
    const base = { session_id: ME, tool_name: "Write", tool_response: {} };
    const runs = [
      f.hook("not json"),
      f.hook({ ...base, tool_input: { file_path: outside } }),
      f.hook({ ...base, tool_input: { file_path: "a.txt" } }),
      f.hook({ ...base, tool_input: { file_path: f.abs(".git/config") } }),
      f.hook({ ...base, session_id: "../escape", tool_input: { file_path: f.abs("a.txt") } }),
      f.hook({ tool_name: "Bash", tool_input: { command: "echo" } }),
    ];
    check("every run exits 0 and prints nothing", runs.every((r) => r.status === 0 && !r.out), show(runs));
    check("no ledger was made", !fs.existsSync(path.join(f.gitDir, "acks-ledger")), fs.existsSync(path.join(f.gitDir, "acks-ledger")) ? fs.readdirSync(path.join(f.gitDir, "acks-ledger")).join(", ") : "");
  });

  test("the hook keeps no copy of a file in a repository without the commit tool, or of one git ignores", (check) => {
    const bare = fixture("no-tool", { tool: false });
    bare.write(ME, "a.txt", bare.change("a.txt", { 3: "line 3 MINE" }));
    check("no ledger in a repository without the tool", !fs.existsSync(path.join(bare.gitDir, "acks-ledger")));
    const f = fixture("ignored");
    f.write(ME, "local/secret.txt", "kept out of the repository\n");
    check("no ledger for an ignored file", !fs.existsSync(path.join(f.gitDir, "acks-ledger")));
    f.write(ME, "kept.txt", "an untracked file git does not ignore\n");
    check("an untracked file that is not ignored is recorded", readRecords(f.gitDir).has("kept.txt") && !readRecords(f.gitDir).has("local/secret.txt"), show([...readRecords(f.gitDir).keys()]));
  });

  test("the ledger stands down in a linked work tree by where the file is, not where the session stands", (check) => {
    const f = fixture("ledger-linked");
    const linked = path.join(tmp, "ledger-linked-tree");
    f.git("worktree", "add", "-q", "--detach", linked, "HEAD");
    const told = (file, cwd) => f.hook({ session_id: ME, hook_event_name: "PostToolUse", cwd, tool_name: "Write", tool_input: { file_path: file }, tool_response: { type: "create", filePath: file, structuredPatch: [], originalFile: null } }, cwd);
    const inside = path.join(linked, "inside.txt");
    fs.writeFileSync(inside, "written in the work tree\n");
    const a = told(inside, f.repo);
    check("a file in the work tree, from a session standing in main's tree, is not recorded", a.status === 0 && !a.out && !readRecords(f.gitDir).has("inside.txt"), show([...readRecords(f.gitDir).keys()]));
    const b = told(inside, linked);
    check("nor from a session standing in the work tree", b.status === 0 && !b.out && !readRecords(f.gitDir).has("inside.txt"));
    check("no ledger was made", !fs.existsSync(path.join(f.gitDir, "acks-ledger")));
    const tracked = path.join(linked, "a.txt");
    fs.writeFileSync(tracked, "an edit of a tracked file\n");
    told(tracked, linked);
    check("a tracked file in the work tree is not recorded either", !readRecords(f.gitDir).has("a.txt"));
    const main = f.abs("main-side.txt");
    fs.writeFileSync(main, "written in main's tree\n");
    const c = told(main, linked);
    const rec = readRecords(f.gitDir).get("main-side.txt");
    check("a file in main's tree, from a session standing in the work tree, is recorded", c.status === 0 && !c.out && rec?.length === 1 && rec[0].session === ME, show(rec));
  });

  test("the ledger keeps recording where a `.git` file names no common directory", (check) => {
    const f = fixture("ledger-separate");
    const sep = path.join(tmp, "ledger-separate-store");
    const repo = path.join(tmp, "ledger-separate-tree");
    fs.mkdirSync(path.dirname(path.join(repo, TOOL)), { recursive: true });
    fs.writeFileSync(path.join(repo, TOOL), "// stands for the commit tool\n");
    execFileSync("git", ["init", "-q", "-b", "main", `--separate-git-dir=${sep}`, repo], { stdio: ["pipe", "pipe", "pipe"] });
    check("the stand-in is a `.git` file with no `commondir`", fs.statSync(path.join(repo, ".git")).isFile() && !fs.existsSync(path.join(sep, "commondir")));
    const file = path.join(repo, "new.txt");
    fs.writeFileSync(file, "a new file\n");
    const r = f.hook({ session_id: ME, hook_event_name: "PostToolUse", cwd: repo, tool_name: "Write", tool_input: { file_path: file }, tool_response: { type: "create", filePath: file, structuredPatch: [], originalFile: null } }, repo);
    const got = readRecords(sep).get("new.txt");
    check("a write there is recorded in the git directory the file names", r.status === 0 && got?.length === 1 && got[0].how === "create", show(got));
  });

  test("a subagent's edit is recorded under its session, with the agent named", (check) => {
    const f = fixture("agent");
    f.write(ME, "a.txt", f.change("a.txt", { 3: "line 3 MINE" }), "original", { payload: { agent_id: "agent-7" } });
    const rec = readRecords(f.gitDir).get("a.txt")[0];
    check("session and agent", rec.session === ME && rec.agent === "agent-7", show(rec));
  });

  test("prune drops a session silent for longer than the ledger keeps, and only then", (check) => {
    const f = fixture("prune");
    f.write(ME, "a.txt", f.change("a.txt", { 3: "line 3 MINE" }));
    f.write(PEER, "a.txt", f.change("a.txt", { 9: "line 9 PEER" }));
    const day = 86_400_000;
    check("nothing is dropped a week on", show(prune(f.gitDir, Date.now() + 7 * day)) === show({ sessions: 0, blobs: 0 }));
    const dir = path.join(f.gitDir, "acks-ledger");
    // The peer writes again fifteen days on; this session has been silent since.
    fs.appendFileSync(path.join(dir, `${PEER}.jsonl`), `${JSON.stringify({ v: 1, ts: Date.now() + 15 * day, file: "b.txt", pre: null, post: null, how: "none" })}\n`);
    const gone = prune(f.gitDir, Date.now() + 15 * day);
    check("this session's file is gone and the peer's stays", gone.sessions === 1 && !fs.existsSync(path.join(dir, `${ME}.jsonl`)) && fs.existsSync(path.join(dir, `${PEER}.jsonl`)), show(gone));
    check("the blobs only this session named are gone", gone.blobs >= 1, show(gone));
  });

  // --- the guard ---

  const guarded = fixture("guarded", { origin: "https://example.invalid/owner/repo.git", tool: true });
  fs.mkdirSync(guarded.abs("sub"));
  const scratch = fixture("scratch-clone", { origin: guarded.repo, tool: true });
  const plain = fixture("plain", { origin: "https://example.invalid/owner/other.git", tool: false });
  /** Whether the guard denies a command line run from `cwd`, and what it said. */
  const guard = (command, { cwd = guarded.repo, tool_name = "Bash", project = guarded.repo, raw = null } = {}) => {
    const r = spawnSync(process.execPath, [GUARD], { cwd: tmp, env: { ...process.env, CLAUDE_PROJECT_DIR: project }, input: raw ?? JSON.stringify({ tool_name, cwd, tool_input: { command } }), encoding: "utf8" });
    let decision = null;
    try {
      decision = JSON.parse(r.stdout).hookSpecificOutput;
    } catch {
      // No decision is a pass.
    }
    return { status: r.status, denied: decision?.permissionDecision === "deny", reason: decision?.permissionDecisionReason ?? "", out: r.stdout };
  };
  const posix = (p) => (process.platform === "win32" ? `/${p[0].toLowerCase()}${p.slice(2).replace(/\\/g, "/")}` : p);

  test("the guard denies the commands that write the shared index or commit it", (check) => {
    for (const command of ["git add -A", "git add a.txt", "git stage a.txt", "git commit -m x", "git commit --no-verify -m x", "git commit --amend --no-edit", "git rm a.txt", "git mv a.txt b.txt", "git -c core.autocrlf=false commit -m x", "FOO=1 git add ."]) {
      const r = guard(command);
      check(command, r.status === 0 && r.denied && /commit-own-hunks\.mjs/.test(r.reason), r.out);
    }
  });

  test("the guard denies the commands that unstage or discard without knowing whose", (check) => {
    for (const command of ["git reset --hard", "git reset --hard HEAD", "git reset HEAD~1", "git reset --soft HEAD~1", "git reset a.txt", "git restore a.txt", "git restore --source=HEAD~1 a.txt", "git restore --staged --worktree a.txt", "git restore -SW a.txt", "git stash", "git stash push -m x", "git stash pop", "git clean -fd", "git checkout -- a.txt", "git checkout .", "git checkout HEAD -- a.txt"]) {
      const r = guard(command);
      check(command, r.status === 0 && r.denied, r.out);
    }
  });

  test("the guard denies the commands that make or move commits by hand", (check) => {
    for (const command of ["git revert HEAD", "git cherry-pick abc123", "git am fix.patch", "git merge origin/main", "git pull", "git pull --ff-only origin main", "git rebase origin/main"]) {
      const r = guard(command);
      check(command, r.status === 0 && r.denied, r.out);
    }
  });

  test("the guard passes an unstage, which writes no file and moves no branch", (check) => {
    for (const command of ["git reset", "git reset -q", "git reset HEAD", "git reset -q HEAD -- a.txt b.txt", "git reset HEAD a.txt", "git reset -- a.txt", "git restore --staged a.txt", "git restore -S a.txt", "git restore --staged -- a.txt b.txt"]) {
      const r = guard(command);
      check(command, r.status === 0 && !r.denied, r.out);
    }
  });

  test("the guard finds the command behind a separator, a cd and a -C", (check) => {
    const elsewhere = { cwd: plain.repo, project: plain.repo };
    check("after &&", guard("git status && git commit -m x").denied);
    check("after ;", guard("echo x; git commit -m x").denied);
    check("on a later line", guard("echo x\ngit add -A").denied);
    check("in a subshell", guard("(cd sub && git commit -m x)").denied);
    check("cd into the guarded repository from elsewhere", guard(`cd "${posix(guarded.repo)}" && git commit -m x`, elsewhere).denied);
    check("-C into the guarded repository from elsewhere", guard(`git -C "${posix(guarded.repo)}" commit -m x`, elsewhere).denied);
    check("a PowerShell path with backslashes", process.platform !== "win32" || guard(`git -C ${guarded.repo} commit -m x`, { ...elsewhere, tool_name: "PowerShell" }).denied);
    const computed = guard('cd "$(pwd)" && git commit -m x', { cwd: plain.repo });
    check("a directory it cannot read falls back to the session's project", computed.denied);
    check("and the refusal says where it judged", computed.reason.includes(`it was judged in ${guarded.repo}`), computed.reason);
    check("a refusal in a directory it could read says no such thing", !/it was judged in/.test(guard("git commit -m x").reason));
    check("git under a path and an .exe is git", guard("/usr/bin/git add -A").denied && guard("git.exe commit -m x").denied && guard('"C:/Program Files/Git/cmd/git.exe" add -A').denied);
    check("and passes where that project is not guarded", !guard('cd "$(pwd)" && git commit -m x', elsewhere).denied);
  });

  test("the guard passes what reads, what pushes, and what only spells a command", (check) => {
    for (const command of [
      "git status --short",
      "git diff --cached --name-only",
      "git log --oneline -3",
      "git push origin abc123:refs/heads/main",
      "git stash list",
      "git fetch -q --tags origin",
      "git merge-base --is-ancestor HEAD origin/main",
      "git clean -n",
      "git checkout main",
      'echo "git commit -m x"',
      'grep -n "git add" notes.md',
      "git log --grep 'git commit; git add -A'",
      "cat > note.txt <<'EOF'\ngit commit -m x\ngit add -A\nEOF",
      `node ${TOOL} ship --change ../change`,
      "GIT_INDEX_FILE=/tmp/own-index git add a.txt",
      "export GIT_INDEX_FILE=/tmp/own-index; git add a.txt",
    ]) {
      const r = guard(command);
      check(command, r.status === 0 && !r.denied, r.out);
    }
    check("a private index does not excuse a commit", guard("GIT_INDEX_FILE=/tmp/own-index git commit -m x").denied);
  });

  test("the guard passes a repository it does not guard", (check) => {
    check("a scratch clone, whose origin is a path", !guard("git commit -m x", { cwd: scratch.repo }).denied);
    check("a scratch clone reached by cd from the guarded tree", !guard(`cd "${posix(scratch.repo)}" && git add -A && git commit -m x`).denied);
    check("a repository without the commit tool", !guard("git commit -m x", { cwd: plain.repo, project: plain.repo }).denied);
    check("a directory outside any repository", !guard("git commit -m x", { cwd: os.tmpdir(), project: os.tmpdir() }).denied);
    const r = guard("", { raw: "not json" });
    check("a payload that does not parse", r.status === 0 && !r.denied, r.out);
  });

  test("the guard stands down in a linked work tree, by the directory the command targets and not the session's", (check) => {
    const linked = path.join(tmp, "guarded-linked");
    guarded.git("worktree", "add", "-q", "--detach", linked, "HEAD");
    fs.mkdirSync(path.join(linked, "sub"), { recursive: true });
    check("the work tree carries the commit tool", fs.existsSync(path.join(linked, TOOL)));
    for (const command of ["git commit -m x", "git add -A", "git stash", "git reset --hard"]) {
      check(`${command}, from inside the work tree`, !guard(command, { cwd: linked, project: guarded.repo }).denied);
    }
    check("from a subdirectory of the work tree", !guard("git commit -m x", { cwd: path.join(linked, "sub"), project: guarded.repo }).denied);
    check("aimed at the work tree with -C from main's tree", !guard(`git -C "${posix(linked)}" commit -m x`).denied);
    check("aimed at the work tree with cd from main's tree", !guard(`cd "${posix(linked)}" && git add -A && git commit -m x`).denied);
    check("aimed at main's tree with -C from the work tree", guard(`git -C "${posix(guarded.repo)}" commit -m x`, { cwd: linked, project: guarded.repo }).denied);
    check("aimed at main's tree with cd from the work tree", guard(`cd "${posix(guarded.repo)}" && git commit -m x`, { cwd: linked, project: guarded.repo }).denied);
    check("main's tree itself is still guarded", guard("git commit -m x").denied);
    // A `.git` file that names no common directory is not a linked work tree.
    const sep = path.join(tmp, "guarded-separate-store");
    const repo = path.join(tmp, "guarded-separate-tree");
    fs.mkdirSync(path.dirname(path.join(repo, TOOL)), { recursive: true });
    fs.writeFileSync(path.join(repo, TOOL), "// stands for the commit tool\n");
    execFileSync("git", ["init", "-q", "-b", "main", `--separate-git-dir=${sep}`, repo], { stdio: ["pipe", "pipe", "pipe"] });
    execFileSync("git", ["remote", "add", "origin", "https://example.invalid/owner/separate.git"], { cwd: repo });
    check("a `.git` file with no `commondir` is still guarded", fs.statSync(path.join(repo, ".git")).isFile() && guard("git commit -m x", { cwd: repo, project: repo }).denied);
  });
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

const failures = results.filter((ok) => !ok).length;
console.log(`test-shared-tree-hooks: ${results.length} cases, ${failures} failed`);
if (failures) process.exit(1);
