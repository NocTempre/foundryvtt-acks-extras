/**
 * Commit one change's hunks from a working tree other sessions are writing
 * in, and nothing else. The tree that is gated is the tree that is committed:
 * it is built in a private index, checked out over a scratch clone, gated
 * there, and staged on the shared index only once its id is the gated one.
 *
 *   node commit-own-hunks.mjs <mode> --change <dir> [--session <id>] [--wait <minutes>]
 *
 *   record            pick this change's zero-context hunks, by the edit ledger or by pattern,
 *                     printing every hunk of every file as MINE, PART or left, with who wrote
 *                     it where the ledger says; hash the whole, added files
 *   build             HEAD plus the recorded change in a private index; print the tree id
 *   gate              check that tree out over a scratch clone and run the gate there; record
 *                     the green tree and its base
 *   commit [--carry]  rebuild; refuse unless tree and HEAD are the gated ones; stage on the
 *                     shared index; check its tree; commit with commit-msg.txt. With --carry a
 *                     moved base is accepted when the commits that landed write none of this
 *                     change's files and no gate tooling, those files come out as gated, and
 *                     the carry stages pass on the rebuilt tree
 *   postgate <sha>    the full gate on a commit already made
 *   ship [--attempts N]  record, gate and commit, again only while the base moves under the gate.
 *                     It holds whole and added files to the `record` already made. With none
 *                     made it goes on only where the ledger accounts for everything it reads,
 *                     and otherwise prints the listing and stops for it to be read
 *   clean             remove the scratch clone and the private index; drop the ledger's
 *                     long-silent sessions
 *
 * Run from the repository root. `<dir>` lies outside the repository and holds
 * the change's inputs, `change.json` and `commit-msg.txt`, beside everything
 * this script writes: the hunk record, the private index, the clone, the gate
 * logs and the gated tree's id.
 *
 * The edit ledger says which session wrote each line the working tree holds
 * (`.claude/hooks/edit-ledger.mjs` writes it, `ledger.mjs` beside this file
 * reads it). This session is `--session <id>`, or `CLAUDE_CODE_SESSION_ID`.
 *
 * `gate`, `commit` and `ship` hold the landing lease (`lease.mjs` beside this
 * file) while they run, `ship` from its gate through its commit. One run in a
 * repository holds it at a time, so a gate starts on a base no other run of
 * this tool is about to move. A run that finds it held waits `--wait` minutes,
 * 20 where none is given, and 0 asks once.
 *
 * change.json:
 *   files    { "<path>": {} | { "own": "<regex>", "count": <n> } | { "whole": true, "own"?: "<regex>" } }
 *            `{}` takes the hunks the ledger gives this session. Of a hunk two sessions
 *            wrote it takes this session's lines, where every line has a writer and no
 *            other session removed one.
 *            `own` is tested against a hunk's removed and added lines joined by newlines.
 *            It takes a hunk no record accounts for, and never one holding another
 *            session's line.
 *            `whole` takes the working copy as it stood at `record`, and refuses any later edit.
 *   added    paths HEAD does not track, each taken whole as recorded
 *   removed  paths HEAD tracks and the working tree no longer holds
 *   mine     true: beside the paths named, every file this session's records name, read as
 *            `{}` reads it, and a new file where every line is this session's. A change.json
 *            that names no path is read this way
 *   adopt    session ids, or the first eight characters of one, whose records count as this
 *            session's: the session before a `/clear`, or one whose work this one finishes
 *   gate     stages run in the clone, in order; a stage is one command line or a list of
 *            command lines run side by side. Default: `npm run build:packs`, then
 *            `npm run validate` beside `npm test`, each where package.json names the script
 *   carry    the stages a carried base runs on the rebuilt tree. Default: the gate without
 *            validate, or the whole gate where that leaves nothing
 *   expect   strings the gate's output must hold, for a check that exits 0 where it cannot run
 *   link     untracked directories joined into the clone by a link. Default: ["node_modules"]
 *   tooling  a regex over paths whose change makes a gate result stale for every file
 *   timeoutMinutes  per command line, default 30
 *
 * Exit status: 0 done, 1 refused, 2 usage, 3 the base moved (gate again), 4 the shared index
 * holds another session's staging (wait for its commit), 5 the landing lease was still held
 * when the wait ran out (run it again).
 */
import { spawn, spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { blame, writersOf, soleWriter, readRecords, prune, keyOf, ORIGIN, NOBODY } from "./ledger.mjs";
import { acquire, holds } from "./lease.mjs";

const EXIT = { refused: 1, usage: 2, movedBase: 3, peerStaging: 4, leaseHeld: 5 };
/** Minutes a run waits for the landing lease where `--wait` gives none. */
const WAIT_MINUTES = 20;
const LOCK_TRIES = 8;
const LOCK_WAIT_MS = 1500;
/**
 * Paths that decide what a gate checks. A commit that writes one makes a gate
 * result stale for every file the gate read, whoever's they are, so a moved
 * base is never carried over it. The test runner is absent because the carry
 * runs it again.
 */
const GATE_TOOLING = /^(tools\/(validate[^/]*|ip-[^/]*|build-packs)\.mjs$|docs\/site\/tools\/|\.githooks\/|\.claude\/|\.gitattributes$|package(-lock)?\.json$)/;
/**
 * Where a repository keeps the leak scanner its pre-commit hook runs. The
 * first that holds one is asked: a module's is in tools/, and the template
 * keeps none there and runs the canonical one in skeleton/tools/.
 */
const SCANNER_DIRS = ["tools", "skeleton/tools"];

const REPO = process.cwd();
const argv = process.argv.slice(2);
const mode = argv[0];
const option = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : null);
const DIR = option("--change") ? path.resolve(option("--change")) : null;
const at = (name) => path.join(DIR, name);
/** The session whose records in the edit ledger are this change's, where one is known. */
const SESSION = option("--session") ?? process.env.CLAUDE_CODE_SESSION_ID ?? null;

/** A stop the caller can act on by its exit status; anything else thrown is a fault. */
class Refusal extends Error {
  constructor(message, code = EXIT.refused) {
    super(message);
    this.code = code;
  }
}
const refuse = (why, code) => {
  throw new Refusal(why, code);
};

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Run git from the repository root. A command that cannot take the shared
 * index's lock changes nothing, so it is tried again while stderr names the
 * lock: another session's git held it for a moment.
 */
function git(args, opts = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return execFileSync("git", args, { cwd: REPO, encoding: "utf8", maxBuffer: 1 << 28, stdio: ["pipe", "pipe", "pipe"], ...opts });
    } catch (e) {
      if (attempt >= LOCK_TRIES || !/index\.lock/.test(String(e.stderr))) throw e;
      sleep(LOCK_WAIT_MS);
    }
  }
}
const lines = (text) => text.split("\n").filter(Boolean);
const revParse = (ref) => git(["rev-parse", ref]).trim();
const staged = () => lines(git(["diff", "--cached", "--name-only"]));
const headEntry = (file) => git(["ls-tree", "HEAD", "--", file]).trim();
/** The blob id `git add` would write for the working file, with nothing written. */
const hashOf = (file) => git(["hash-object", "--", file]).trim();
const inTree = (file) => fs.existsSync(path.join(REPO, file));

/**
 * Parse change.json into the paths, patterns and stages the modes share.
 *
 * @param {object} [options]
 * @param {boolean} [options.resolved] Answer the paths the last `record` took
 *   in place of the ones change.json names, which leave out every file the
 *   ledger supplied. `record` itself reads the named ones.
 */
function readChange({ resolved = true } = {}) {
  if (!fs.existsSync(at("change.json"))) refuse(`no change.json in ${DIR}`, EXIT.usage);
  const raw = JSON.parse(fs.readFileSync(at("change.json"), "utf8"));
  let files = raw.files ?? {};
  let added = raw.added ?? [];
  const removed = raw.removed ?? [];
  const adopt = raw.adopt ?? [];
  const named = [...Object.keys(files), ...added, ...removed];
  const mine = raw.mine === true || !named.length;
  // Whose edits the ledger gives is asked at `record` alone; every later mode
  // reads the paths that record took.
  if (!resolved && !SESSION && !adopt.length) {
    const how = "no session id says whose edits the ledger gives (CLAUDE_CODE_SESSION_ID, or --session <id>)";
    for (const [file, spec] of Object.entries(files)) {
      if (!spec.whole && !spec.own) refuse(`${file}: give "own", a pattern its hunks match, or "whole": true; ${how}`, EXIT.usage);
    }
    if (!named.length) refuse(`change.json names no path, and ${how}`, EXIT.usage);
    if (mine) refuse(`"mine" is set, and ${how}`, EXIT.usage);
  }
  if (new Set(named).size !== named.length) refuse("change.json lists a path twice", EXIT.usage);
  if (named.some((f) => f.includes("\\") || path.isAbsolute(f))) refuse("paths are repository-relative, with forward slashes", EXIT.usage);
  if (resolved && fs.existsSync(at("record.json"))) {
    const taken = JSON.parse(fs.readFileSync(at("record.json"), "utf8")).paths;
    if (taken) ({ files, added } = taken);
  }
  const all = [...Object.keys(files), ...added, ...removed].sort();
  return {
    files,
    added,
    removed,
    all,
    mine,
    adopt,
    gate: raw.gate ?? null,
    carry: raw.carry ?? null,
    expect: raw.expect ?? [],
    link: raw.link ?? ["node_modules"],
    tooling: raw.tooling ? new RegExp(raw.tooling) : GATE_TOOLING,
    timeoutMs: (raw.timeoutMinutes ?? 30) * 60_000,
  };
}

/** The working tree's zero-context hunks against HEAD for one text file. */
function hunksOf(file) {
  const text = git(["diff", "-U0", "--no-color", "--no-ext-diff", "HEAD", "--", file]);
  const hunks = [];
  for (const raw of text.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (m) {
      hunks.push({ oldStart: Number(m[1]), oldCount: m[2] === undefined ? 1 : Number(m[2]), newStart: Number(m[3]), minus: [], plus: [] });
    } else if (hunks.length) {
      const h = hunks[hunks.length - 1];
      if (line.startsWith("-")) h.minus.push(line.slice(1));
      else if (line.startsWith("+")) h.plus.push(line.slice(1));
      else if (line.startsWith("\\")) refuse(`${file}: a no-newline marker; list this file whole`);
    }
  }
  return hunks;
}

const isBinary = (file) => git(["diff", "--numstat", "HEAD", "--", file]).startsWith("-\t-");

/**
 * Apply the picked hunks to HEAD's lines, bottom-up, every removed line
 * checked. A zero-context insertion is placed by its old-side line, which no
 * skipped hunk above it can shift.
 */
function applyHunks(file, headLines, picked) {
  const out = headLines.slice();
  for (const h of picked.slice().sort((a, b) => b.oldStart - a.oldStart)) {
    if (h.minus.length !== h.oldCount) refuse(`${file}: the hunk at -${h.oldStart} counts ${h.oldCount} line(s) and lists ${h.minus.length}`);
    if (h.oldCount === 0) {
      out.splice(h.oldStart, 0, ...h.plus);
      continue;
    }
    h.minus.forEach((l, i) => {
      if (out[h.oldStart - 1 + i] !== l) refuse(`${file}: HEAD line ${h.oldStart + i} is not what the hunk removes`);
    });
    out.splice(h.oldStart - 1, h.oldCount, ...h.plus);
  }
  return out;
}

const same = (a, b) => a.length === b.length && a.every((l, i) => l === b[i]);

/** Refuse a text blob that holds a carriage return; a binary one is left alone. */
function refuseCarriageReturns(sha, file) {
  const blob = execFileSync("git", ["cat-file", "blob", sha], { cwd: REPO, maxBuffer: 1 << 28 });
  if (!blob.subarray(0, 8000).includes(0) && blob.includes(13)) refuse(`${file}: a carriage return in the content to commit`);
}

const short = (session) => session.slice(0, 8);
/** The git directory every work tree of this repository shares, where the edit ledger lives. */
const commonDir = () => path.resolve(REPO, git(["rev-parse", "--git-common-dir"]).trim());
const workingText = (file) => fs.readFileSync(path.join(REPO, file), "utf8");

/**
 * The edit ledger as this run reads it: every record by file, and the
 * sessions whose records are this change's.
 */
function readLedger(change) {
  const gitDir = commonDir();
  const records = readRecords(gitDir);
  const sessions = new Set([...records.values()].flat().map((r) => r.session));
  const mine = new Set(SESSION ? [SESSION] : []);
  for (const given of change.adopt) {
    const hits = [...sessions].filter((s) => s.startsWith(given));
    if (String(given).length < 8 || hits.length !== 1) refuse(`"adopt": ${JSON.stringify(given)} names ${hits.length} session(s) in the ledger; give eight characters or more of one session's id`, EXIT.usage);
    mine.add(hits[0]);
  }
  return { gitDir, records, mine };
}

/**
 * Whose one hunk is by the ledger.
 *
 * @returns {null | {whose: "mine"|"peer"|"nobody"|"mixed", peers: string[], mine: number, unknown: number, keep: number[]|null}}
 *   null where no record names the file. `mine` and `unknown` count the
 *   hunk's lines this change's sessions wrote or removed and the lines no
 *   record accounts for; `peers` are the other sessions with a line in it,
 *   or among the writers a line given to nobody may belong to.
 *   `keep` is set on a mixed hunk that can be divided: the added lines that
 *   are this change's, by index. It can be divided when every line has a
 *   writer, the writers were read at the place git puts the hunk, and this
 *   change removed every line the hunk removes, so what is left behind is
 *   other sessions' added lines alone.
 */
function verdictOf(ledger, blamed, hunk) {
  if (!blamed) return null;
  const writers = writersOf(blamed, hunk);
  if (!writers) return { whose: "nobody", peers: [], mine: 0, unknown: hunk.plus.length + hunk.minus.length, keep: null };
  const all = [...writers.added, ...writers.removed];
  const isMine = (who) => ledger.mine.has(who);
  const isPeer = (who) => who !== ORIGIN && who !== NOBODY && !isMine(who);
  const peers = [...new Set([...all, ...writers.among].filter(isPeer))].sort();
  const mine = all.filter(isMine).length;
  const unknown = all.filter((who) => !isMine(who) && !isPeer(who)).length;
  const whose = mine === all.length ? "mine" : mine ? "mixed" : peers.length ? "peer" : "nobody";
  const divides = whose === "mixed" && !unknown && !writers.slid && writers.removed.every(isMine);
  return { whose, peers, mine, unknown, keep: divides ? writers.added.flatMap((who, i) => (isMine(who) ? [i] : [])) : null };
}

/**
 * Whether a file's content is one a commit holds: HEAD's, or an earlier
 * commit's of the same path. Content that is not was written by someone
 * before the ledger's first record of the file, and is nobody's.
 */
function committed(file, content) {
  if (content === null) return false;
  const blob = git(["hash-object", "--stdin", "--path", file], { input: content }).trim();
  if (blob === revParse(`HEAD:${file}`)) return true;
  try {
    return git(["log", "-1", "--format=%H", `--find-object=${blob}`, "--", file]).trim() !== "";
  } catch {
    return false; // git knows no such object, so no commit holds it
  }
}

/** The writers of a hunk as the listing names them. */
const tagOf = (v) => (v ? ` [${[v.mine && "me", ...v.peers.map((s) => `session ${short(s)}`), v.unknown && "no record"].filter(Boolean).join(" + ")}]` : "");

/**
 * The files this change's sessions wrote that change.json does not name: a
 * tracked file that differs from HEAD, read as `{}` reads it, and a new file
 * where every line is theirs. A file the working tree no longer holds is not
 * among them; a removal is named.
 */
function discover(change, ledger) {
  const out = { files: {}, added: [] };
  const named = new Set([...Object.keys(change.files), ...change.added, ...change.removed].map(keyOf));
  const paths = new Map(git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"]).split("\0").filter(Boolean).map((f) => [keyOf(f), f]));
  for (const [key, list] of ledger.records) {
    if (named.has(key) || !list.some((r) => ledger.mine.has(r.session))) continue;
    const file = paths.get(key);
    if (!file || !inTree(file)) continue;
    if (headEntry(file)) {
      if (hashOf(file) !== revParse(`HEAD:${file}`)) out.files[file] = {};
      continue;
    }
    const { owners } = blame(ledger.gitDir, file, workingText(file), ledger.records);
    const others = owners.filter((who) => !ledger.mine.has(who)).length;
    if (others && others < owners.length) refuse(`${file}: new, and ${others} of its ${owners.length} line(s) are not this session's by the ledger; list it under "added" to take it whole`);
    if (!others) out.added.push(file);
  }
  return { files: Object.fromEntries(Object.entries(out.files).sort(([a], [b]) => (a < b ? -1 : 1))), added: out.added.sort() };
}

/**
 * Pick this change's hunks and hash its whole and added files.
 *
 * A file with a pattern, a whole file and a named added file are taken on the
 * caller's word, and none of them can take a line the ledger gives another
 * session. Every other file is read by the ledger: a hunk is taken where all
 * of it is this change's, divided where it can be, and left where it is
 * another session's or nobody's. A file no one else has written since a
 * committed content is taken entire.
 *
 * @param {object} [options]
 * @param {object} [options.pin] An earlier record. A file taken on the
 *   caller's word whose content differs from it stops the run, so no attempt
 *   takes in an edit made after the listing was read.
 * @returns {object} The record written. `settled` says nothing in it rests on
 *   the caller's word and no hunk it read went unaccounted for.
 */
function record({ pin = null } = {}) {
  const change = readChange({ resolved: false });
  const ledger = readLedger(change);
  const found = change.mine ? discover(change, ledger) : { files: {}, added: [] };
  const rec = { hunks: {}, whole: {}, added: {}, claimed: [], paths: { files: {}, added: [] }, settled: !change.adopt.length && !change.removed.length };
  const claim = (file) => {
    rec.claimed.push(file);
    rec.settled = false;
  };
  const theirs = (sessions) => `the ledger gives ${sessions.map(short).join(", ")} a line in it. It is that session's to commit; "adopt" takes it where the owner rules it this change's`;

  for (const [file, spec] of Object.entries({ ...found.files, ...change.files })) {
    const named = file in change.files;
    if (!headEntry(file)) refuse(`${file}: HEAD does not track it; list it under "added"`);
    if (!inTree(file)) refuse(`${file}: the working tree does not hold it; list it under "removed"`);
    const binary = isBinary(file);
    if (binary && !spec.whole) refuse(`${file}: a binary file is taken whole or not at all`);
    const all = binary ? [] : hunksOf(file);
    const blamed = binary ? null : blame(ledger.gitDir, file, workingText(file), ledger.records);
    const own = spec.own ? new RegExp(spec.own) : null;
    const byLedger = !spec.whole && !own;
    // Where this change's sessions are the file's only writers since a
    // committed content, every hunk is theirs whatever lines git pairs up to
    // make it. Elsewhere each hunk is read by the lines it holds.
    const sole = byLedger && blamed !== null && soleWriter(blamed, ledger.mine) && committed(file, blamed.origin);
    const read = new Map(all.map((h) => [h, sole ? { whose: "mine", peers: [], mine: h.plus.length + h.minus.length, unknown: 0, keep: null } : verdictOf(ledger, blamed, h)]));
    let mine = all;
    if (byLedger) mine = all.filter((h) => read.get(h)?.whose === "mine" || read.get(h)?.keep);
    else if (own) mine = all.filter((h) => own.test([...h.minus, ...h.plus].join("\n")));

    console.log(`== ${file}: ${binary ? "binary" : `${all.length} hunk(s), ${mine.length} this change's`}${spec.whole ? ", taken whole" : ""}${byLedger ? ", by the ledger" : ""}`);
    for (const h of all) {
      const first = ([...h.plus, ...h.minus].find((l) => l.trim()) ?? "").slice(0, 96);
      const mark = !mine.includes(h) ? "left" : byLedger && read.get(h).keep ? "PART" : "MINE";
      console.log(`  ${mark} -${h.oldStart},${h.oldCount} (-${h.minus.length} +${h.plus.length})${tagOf(read.get(h))} ${first}`);
    }

    if (byLedger) {
      for (const h of all) {
        const v = read.get(h);
        if (v?.whose !== "mixed" || v.keep) continue;
        if (v.peers.length) refuse(`${file}: the hunk at -${h.oldStart} holds this session's lines and ${v.peers.map(short).join(", ")}'s, and they do not divide by line; it lands once theirs has, or under "adopt" where the owner rules it this change's`);
        refuse(`${file}: the hunk at -${h.oldStart} holds this session's lines beside ${v.unknown} no record accounts for; give the file an "own" pattern to take the hunk on your word`);
      }
      if (!mine.length) {
        if (named) refuse(`${file}: the ledger gives this session none of its hunks; give "own", a pattern they match, to take them on your word`);
        console.log("  nothing of this session's is left in it; not taken");
        continue;
      }
      if (all.some((h) => !mine.includes(h) && read.get(h)?.whose === "nobody")) rec.settled = false;
    } else {
      const taken = [...new Set(mine.flatMap((h) => read.get(h)?.peers ?? []))];
      if (ledger.mine.size && taken.length) refuse(`${file}: ${spec.whole ? "listed whole" : "the pattern picks a hunk"}, and ${theirs(taken)}`);
      claim(file);
    }
    rec.paths.files[file] = spec;

    if (spec.whole) {
      if (mine.length !== all.length) refuse(`${file}: listed whole, and ${all.length - mine.length} hunk(s) do not match its pattern`);
      rec.whole[file] = hashOf(file);
      if (rec.whole[file] === revParse(`HEAD:${file}`)) refuse(`${file}: the working copy is what HEAD holds`);
      if (pin && pin.whole?.[file] !== rec.whole[file]) refuse(`${file}: listed whole, and it is not what the last \`record\` hashed; run \`record\` and read its listing again`);
    } else {
      if (spec.count != null && mine.length !== spec.count) refuse(`${file}: ${byLedger ? "the ledger" : "the pattern"} picks ${mine.length} hunk(s) and ${spec.count} are this change's`);
      if (!mine.length) refuse(`${file}: the pattern picks nothing`);
      rec.hunks[file] = mine.map((h) => {
        const keep = byLedger ? read.get(h).keep : null;
        return keep ? { minus: h.minus, plus: h.plus, keep } : { minus: h.minus, plus: h.plus };
      });
    }
  }

  for (const file of [...change.added, ...found.added]) {
    const named = change.added.includes(file);
    if (headEntry(file)) refuse(`${file}: listed as added, and HEAD tracks it`);
    if (!inTree(file)) refuse(`${file}: listed as added, and the working tree does not hold it`);
    rec.added[file] = hashOf(file);
    if (named) {
      const blamed = ledger.mine.size ? blame(ledger.gitDir, file, workingText(file), ledger.records) : null;
      const taken = [...new Set((blamed?.owners ?? []).filter((who) => who !== ORIGIN && who !== NOBODY && !ledger.mine.has(who)))];
      if (taken.length) refuse(`${file}: added, and ${theirs(taken)}`);
      if (pin && pin.added?.[file] !== rec.added[file]) refuse(`${file}: added, and it is not what the last \`record\` hashed; run \`record\` and read its listing again`);
      claim(file);
    }
    rec.paths.added.push(file);
    console.log(`== ${file}: added, ${rec.added[file]}${named ? "" : ", by the ledger"}`);
  }
  for (const file of change.removed) {
    if (!headEntry(file)) refuse(`${file}: listed as removed, and HEAD does not track it`);
    if (inTree(file)) refuse(`${file}: listed as removed, and the working tree still holds it`);
    console.log(`== ${file}: removed`);
  }
  if (!Object.keys(rec.paths.files).length && !rec.paths.added.length && !change.removed.length) refuse("nothing in the working tree is this session's to commit, by the ledger");
  fs.writeFileSync(at("record.json"), JSON.stringify(rec, null, 1));
  console.log("recorded");
  return rec;
}

/**
 * Stage HEAD plus the recorded change, and answer the tree that makes.
 *
 * A recorded hunk is found in the working tree by its exact lines, so a hunk a
 * peer has since added to the file is left where it is, and one that has run
 * into a recorded hunk stops the build. Of a hunk `record` divided, the lines
 * it kept are applied and the rest are left. A whole or added file is taken
 * only while its content is what `record` hashed.
 *
 * @param {object} [options]
 * @param {boolean} [options.shared] Stage on the repository's own index, which
 *   must hold nothing staged, in place of a private one reset to HEAD.
 * @returns {{tree: string, head: string, leftOut: Record<string, number>}}
 */
function build({ shared = false } = {}) {
  const change = readChange();
  if (!fs.existsSync(at("record.json"))) refuse("no hunk record; run `record` first");
  const rec = JSON.parse(fs.readFileSync(at("record.json"), "utf8"));
  const env = shared ? process.env : { ...process.env, GIT_INDEX_FILE: at("private-index") };
  if (shared) {
    if (staged().length) refuse(`the shared index holds staged changes: ${staged().join(", ")}`, EXIT.peerStaging);
  } else {
    fs.rmSync(at("private-index"), { force: true });
    git(["read-tree", "HEAD"], { env });
  }

  const leftOut = {};
  for (const [file, spec] of Object.entries(change.files)) {
    const fileMode = headEntry(file).split(/\s+/)[0];
    if (!fileMode) refuse(`${file}: HEAD no longer tracks it`);
    let sha;
    if (spec.whole) {
      if (rec.whole[file] === undefined) refuse(`${file}: not on record; run \`record\` again`);
      const now = inTree(file) ? hashOf(file) : "missing";
      if (now !== rec.whole[file]) refuse(`${file}: listed whole, and its working copy is ${now} where ${rec.whole[file]} was recorded`);
      sha = git(["hash-object", "-w", "--", file]).trim();
    } else {
      if (!rec.hunks[file]) refuse(`${file}: not on record; run \`record\` again`);
      const current = hunksOf(file);
      const picked = rec.hunks[file].map((want, i) => {
        const found = current.filter((h) => same(h.minus, want.minus) && same(h.plus, want.plus));
        if (found.length !== 1) refuse(`${file}: recorded hunk ${i + 1} occurs ${found.length} time(s) in the working tree`);
        return found[0];
      });
      if (new Set(picked).size !== picked.length) refuse(`${file}: two recorded hunks matched one working-tree hunk`);
      leftOut[file] = current.length - picked.length;
      // Of a divided hunk only the lines on record are applied; the rest of it
      // stays in the working tree for the session that wrote it.
      const taken = picked.map((h, i) => {
        const keep = rec.hunks[file][i].keep;
        return keep ? { ...h, plus: keep.map((k) => h.plus[k]) } : h;
      });
      const content = applyHunks(file, git(["show", `HEAD:${file}`]).split("\n"), taken).join("\n");
      sha = git(["hash-object", "-w", "--stdin"], { input: content }).trim();
    }
    refuseCarriageReturns(sha, file);
    git(["update-index", "--cacheinfo", `${fileMode},${sha},${file}`], { env });
  }
  for (const file of change.added) {
    if (headEntry(file)) refuse(`${file}: listed as added, and HEAD tracks it`);
    const sha = inTree(file) ? git(["hash-object", "-w", "--", file]).trim() : "missing";
    if (sha !== rec.added[file]) refuse(`${file}: added, and its content is ${sha} where ${rec.added[file]} was recorded`);
    refuseCarriageReturns(sha, file);
    git(["update-index", "--add", "--cacheinfo", `100644,${sha},${file}`], { env });
  }
  for (const file of change.removed) {
    if (inTree(file)) refuse(`${file}: listed as removed, and the working tree holds it again`);
    git(["update-index", "--force-remove", "--", file], { env });
  }

  const tree = git(["write-tree"], { env }).trim();
  const changed = lines(git(["diff", "--name-only", "HEAD", tree])).sort();
  if (JSON.stringify(changed) !== JSON.stringify(change.all)) refuse(`the tree changes [${changed.join(", ")}] and change.json names [${change.all.join(", ")}]`);
  return { tree, head: revParse("HEAD"), leftOut };
}

const report = ({ tree, head, leftOut }) => {
  console.log(`base ${head}\ntree ${tree}`);
  for (const [file, n] of Object.entries(leftOut)) if (n) console.log(`left out: ${n} hunk(s) in ${file} that are not this change's`);
};

/**
 * Remove every link in the clone, each as the link itself and never through
 * it: a recursive delete that follows one empties the directory it points at.
 */
function dropLinks(change) {
  const clone = at("clone");
  if (!fs.existsSync(clone)) return;
  const candidates = new Set([...change.link, ...fs.readdirSync(clone)]);
  for (const rel of candidates) {
    const link = path.join(clone, rel);
    if (!fs.lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink()) continue;
    try {
      fs.unlinkSync(link);
    } catch {
      fs.rmdirSync(link);
    }
    if (fs.lstatSync(link, { throwIfNoEntry: false })) refuse(`could not remove the link ${link}; remove it by hand before anything deletes the clone`);
  }
}

function dropClone(change) {
  dropLinks(change);
  fs.rmSync(at("clone"), { recursive: true, force: true });
}

/**
 * Make the scratch clone hold one tree on one commit. A clone and not an
 * export: a check that reads git history has none to read in an export, and
 * passes there without having run.
 */
function freshClone(change, commit, tree) {
  const clone = at("clone");
  dropClone(change);
  git(["clone", "-q", "--shared", "--no-checkout", REPO, clone]);
  git(["-C", clone, "checkout", "-q", "--detach", commit]);
  if (tree) git(["-C", clone, "read-tree", "-u", "--reset", tree]);
  const want = tree ?? revParse(`${commit}^{tree}`);
  const holds = git(["-C", clone, "write-tree"]).trim();
  if (holds !== want) refuse(`the clone holds ${holds}, not ${want}`);
  for (const rel of change.link) {
    const from = path.join(REPO, rel);
    const to = path.join(clone, rel);
    if (!fs.existsSync(from) || fs.lstatSync(to, { throwIfNoEntry: false })) continue;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.symlinkSync(from, to, "junction");
  }
}

/** Stop a command line and everything it started: stopping the shell alone leaves its children running. */
function killTree(child) {
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
  else {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}

/** Run one command line in the clone, keep its output in a log beside the change, and answer how it ended. */
function start(cmd, logName, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(cmd, { cwd: at("clone"), shell: true, windowsHide: true, detached: process.platform !== "win32" });
    let output = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding("utf8");
      stream.on("data", (d) => (output += d));
    }
    child.on("close", (code) => {
      clearTimeout(timer);
      const status = timedOut ? "timeout" : code;
      const seconds = Math.round((Date.now() - started) / 1000);
      fs.writeFileSync(at(logName), `$ ${cmd}\n${output}\n--- exit ${status} in ${seconds}s ---\n`);
      console.log(`${cmd}: exit ${status} in ${seconds}s (${logName})`);
      resolve({ cmd, status, seconds, output });
    });
  });
}

/**
 * Run the stages in order, the command lines of one stage side by side, and
 * stop after the first stage that is not green.
 *
 * @returns {Promise<{green: boolean, results: object[]}>} `green` only when
 *   every command line of every stage ran and exited 0.
 */
async function runStages(stages, label, timeoutMs) {
  const results = [];
  let n = 0;
  for (const stage of stages) {
    const cmds = Array.isArray(stage) ? stage : [stage];
    const done = await Promise.all(cmds.map((cmd) => start(cmd, `${label}-${++n}.log`, timeoutMs)));
    results.push(...done);
    if (done.some((r) => r.status !== 0)) break;
  }
  const expected = stages.flat().length;
  return { green: results.length === expected && results.every((r) => r.status === 0), results };
}

/** The gate package.json names: packs first, then validate beside the tests. */
function defaultStages({ carry = false } = {}) {
  const pkgFile = path.join(at("clone"), "package.json");
  const scripts = fs.existsSync(pkgFile) ? (JSON.parse(fs.readFileSync(pkgFile, "utf8")).scripts ?? {}) : {};
  const side = [!carry && scripts.validate && "npm run validate", scripts.test && "npm test"].filter(Boolean);
  const stages = [scripts["build:packs"] && "npm run build:packs", side.length > 1 ? side : side[0]].filter(Boolean);
  if (carry && !scripts.test) return defaultStages();
  if (!stages.length) refuse('package.json names none of build:packs, validate, test; give "gate" in change.json', EXIT.usage);
  return stages;
}

/** The lease this run holds, from `landing` until its body returns. */
let LEASE = null;

/**
 * Run `body` holding the landing lease, so no other run of this tool gates or
 * commits in this repository until it returns. A lease another run holds is
 * waited for, `--wait` minutes at most, and its holder named as the wait
 * starts.
 */
async function landing(body) {
  const gitDir = commonDir();
  const minutes = Number(option("--wait") ?? WAIT_MINUTES);
  if (!(minutes >= 0)) refuse("--wait takes a number of minutes", EXIT.usage);
  const name = (held) => `${held?.session ? `session ${short(held.session)}` : "another run"}${held?.since ? `, since ${new Date(held.since).toTimeString().slice(0, 8)}` : ""}${held?.change ? `, for ${held.change}` : ""}`;
  let last = null;
  const lease = await acquire(gitDir, { session: SESSION, change: DIR }, {
    waitMs: minutes * 60_000,
    onWait: (held) => {
      last = held;
      console.log(`the landing lease is held by ${name(held)}; waiting ${minutes} minute(s) at most`);
    },
  });
  if (!lease) refuse(`the landing lease is still held by ${name(last)}; nothing gated, nothing staged`, EXIT.leaseHeld);
  if (lease.waitedMs >= 1000) console.log(`took the landing lease after ${Math.round(lease.waitedMs / 1000)}s`);
  LEASE = { gitDir, token: lease.token };
  try {
    return await body();
  } finally {
    LEASE = null;
    lease.stop();
  }
}

async function gate() {
  const change = readChange();
  const built = build();
  report(built);
  freshClone(change, built.head, built.tree);
  let run;
  try {
    run = await runStages(change.gate ?? defaultStages(), "gate", change.timeoutMs);
  } finally {
    dropLinks(change);
  }
  const output = run.results.map((r) => r.output).join("\n");
  const missing = change.expect.filter((text) => !output.includes(text));
  for (const text of missing) console.log(`expected in the gate's output and absent: ${text}`);
  if (!run.green || missing.length) refuse("the gate is not green; nothing recorded");
  const stages = run.results.map(({ cmd, status, seconds }) => ({ cmd, status, seconds }));
  fs.writeFileSync(at("gated.json"), JSON.stringify({ tree: built.tree, head: built.head, at: new Date().toISOString(), stages }, null, 1));
  console.log(`GREEN: recorded ${built.tree} on ${built.head}`);
}

/**
 * Decide whether a gate result holds on a base that moved under it, and
 * answer the tree and base to commit.
 *
 * It holds when the gated base is an ancestor of HEAD, the commits that
 * landed write none of this change's files and no gate tooling, the rebuilt
 * tree holds the gated blob for every file of the change, and the carry
 * stages pass on that tree. Every other case is a moved base: gate again.
 */
async function carryOver(change, gated) {
  const head = revParse("HEAD");
  try {
    git(["merge-base", "--is-ancestor", gated.head, head]);
  } catch {
    refuse(`the gated base ${gated.head} is not an ancestor of HEAD`, EXIT.movedBase);
  }
  const landed = lines(git(["diff", "--name-only", gated.head, head]));
  const mine = landed.filter((f) => change.all.includes(f));
  if (mine.length) refuse(`a commit that landed writes this change's files (${mine.join(", ")}); gate again`, EXIT.movedBase);
  const tooling = landed.filter((f) => change.tooling.test(f));
  if (tooling.length) refuse(`a commit that landed writes gate tooling (${tooling.join(", ")}); gate again`, EXIT.movedBase);

  const rebuilt = build();
  const blobs = (tree) => git(["ls-tree", "-r", tree, "--", ...change.all]);
  if (blobs(rebuilt.tree) !== blobs(gated.tree)) refuse("the rebuilt tree does not hold the gated content for this change's files; gate again", EXIT.movedBase);
  freshClone(change, rebuilt.head, rebuilt.tree);
  let run;
  try {
    run = await runStages(change.carry ?? defaultStages({ carry: true }), "carry", change.timeoutMs);
  } finally {
    dropLinks(change);
  }
  if (!run.green) refuse("the carry stages are not green on the rebuilt tree; nothing staged");
  console.log(`carrying ${landed.length} landed path(s) from ${gated.head} to ${rebuilt.head}`);
  return { tree: rebuilt.tree, base: rebuilt.head, carried: true };
}

/**
 * Ask the repository's leak scanner about the change set before staging. The
 * pre-commit hook takes a flagged file out of the commit, so asking first
 * means the commit either holds the gated tree or is not made. The scanner
 * asked is the one that hook runs, which `SCANNER_DIRS` finds. It is asked
 * about `tree`, the tree to be committed, as the hook reads the index that
 * tree is staged to: the working copy holds peers' hunks beside this change's.
 */
async function leakScan(paths, tree) {
  const scanner = SCANNER_DIRS.map((dir) => path.join(REPO, dir, "ip-scan.mjs")).find((file) => fs.existsSync(file));
  if (!scanner) return;
  const { scanPaths } = await import(pathToFileURL(scanner).href);
  if (typeof scanPaths !== "function") return;
  const { errors } = scanPaths(REPO, paths, { from: tree });
  if (errors.length) refuse(`the leak scanner flags the change set:\n${errors.join("\n")}`);
}

async function commit({ carry = false } = {}) {
  const change = readChange();
  if (!fs.existsSync(at("gated.json"))) refuse("no gated tree on record; run `gate` first");
  if (!fs.existsSync(at("commit-msg.txt"))) refuse(`no commit message at ${at("commit-msg.txt")}`);
  const gated = JSON.parse(fs.readFileSync(at("gated.json"), "utf8"));
  // Staging that is not this run's is a peer between `git add` and `git commit`:
  // its commit lands in moments and moves the base, so nothing is built over it.
  if (staged().length) refuse(`the shared index holds staged changes: ${staged().join(", ")}`, EXIT.peerStaging);

  let want = { tree: gated.tree, base: gated.head, carried: false };
  if (revParse("HEAD") !== gated.head) {
    if (!carry) refuse(`HEAD moved off the gated base ${gated.head}`, EXIT.movedBase);
    want = await carryOver(change, gated);
  } else {
    const again = build();
    if (again.tree !== gated.tree) refuse(`the tree is now ${again.tree}, and ${gated.tree} is what passed:\n${git(["diff", "--stat", gated.tree, again.tree])}`);
  }
  await leakScan([...Object.keys(change.files), ...change.added], want.tree);

  // Past the build below, whatever is staged under the change's paths is this
  // run's own, and is this run's to unstage.
  const unstage = () => {
    try {
      git(["reset", "-q", "HEAD", "--", ...change.all]);
    } catch (e) {
      console.error(`could not unstage: ${e.stderr ?? e.message}`);
    }
  };
  // A lease is taken from a run whose heartbeat stopped, and a run that
  // stopped only for a while is still here. It writes nothing shared once
  // the lease is another's.
  if (!LEASE || !holds(LEASE.gitDir, LEASE.token)) refuse("the landing lease is no longer this run's; nothing staged");
  try {
    const onShared = build({ shared: true });
    if (onShared.tree !== want.tree) refuse(`the shared index made ${onShared.tree}, not ${want.tree}`);
    if (revParse("HEAD") !== want.base) refuse("HEAD moved while staging", EXIT.movedBase);
    let made;
    for (let attempt = 1; ; attempt++) {
      made = spawnSync("git", ["commit", "-F", at("commit-msg.txt")], { cwd: REPO, encoding: "utf8" });
      if (made.status === 0 || attempt >= LOCK_TRIES || !/index\.lock/.test(made.stderr ?? "")) break;
      sleep(LOCK_WAIT_MS);
    }
    process.stdout.write(made.stdout ?? "");
    process.stderr.write(made.stderr ?? "");
    if (made.status !== 0) refuse(`git commit exited ${made.status}`);
  } catch (e) {
    if (e instanceof Refusal && e.code === EXIT.peerStaging) throw e;
    unstage();
    if (e instanceof Refusal) refuse(`${e.message}; unstaged again`, e.code);
    throw e;
  }

  const sha = revParse("HEAD");
  const tree = revParse("HEAD^{tree}");
  const parent = revParse("HEAD~1");
  console.log(`commit ${sha}\ntree   ${tree}\nparent ${parent}`);
  if (tree !== want.tree || parent !== want.base) refuse("the commit is NOT the gated tree on its base; look at it before anything else");
  if (want.carried) console.log(`OK: the commit holds the gated files on the moved base; run \`postgate ${sha}\`, and the carry stands once that is green`);
  else console.log("OK: the commit holds the gated tree on the gated base");
}

async function postgate() {
  const sha = argv[1] && !argv[1].startsWith("--") ? revParse(`${argv[1]}^{commit}`) : refuse("postgate takes a commit", EXIT.usage);
  const change = readChange();
  freshClone(change, sha, null);
  let run;
  try {
    run = await runStages(change.gate ?? defaultStages(), "postgate", change.timeoutMs);
  } finally {
    dropLinks(change);
  }
  const output = run.results.map((r) => r.output).join("\n");
  const missing = change.expect.filter((text) => !output.includes(text));
  if (!run.green || missing.length) refuse(`the full gate is not green on ${sha}`);
  console.log(`GREEN: the full gate passes on ${sha}`);
}

async function ship() {
  const attempts = Number(option("--attempts") ?? 4);
  // The listing `record` prints is the one place a hunk taken on the caller's
  // word can be checked against whose it is, so a run that takes one starts
  // from a record someone has read, and every attempt holds whole and added
  // files to it. Where the ledger accounts for everything read, no listing
  // decides anything.
  let pin = fs.existsSync(at("record.json")) ? JSON.parse(fs.readFileSync(at("record.json"), "utf8")) : null;
  if (!pin) {
    pin = record();
    if (!pin.settled) refuse("the listing above takes something on this change's word, or leaves a hunk no record accounts for; read it, then run `ship` again");
  }
  // Under the lease the base moves only by a commit made around this tool, so
  // a second attempt is the exception it was the rule for.
  await landing(async () => {
    for (let n = 1; n <= attempts; n++) {
      console.log(`--- attempt ${n} of ${attempts} on ${revParse("HEAD")}`);
      try {
        if (staged().length) refuse(`the shared index holds staged changes: ${staged().join(", ")}`, EXIT.peerStaging);
        pin = record({ pin });
        await gate();
        await commit();
        return;
      } catch (e) {
        if (!(e instanceof Refusal) || e.code !== EXIT.movedBase || n === attempts) throw e;
        console.log(`${e.message}\nthe base moved under attempt ${n}; going again`);
      }
    }
  });
}

const MODES = {
  record: () => void record(),
  build: () => report(build()),
  gate: () => landing(gate),
  commit: () => landing(() => commit({ carry: argv.includes("--carry") })),
  postgate,
  ship,
  clean: () => {
    dropClone(readChange());
    fs.rmSync(at("private-index"), { force: true });
    prune(commonDir());
  },
};

try {
  if (!MODES[mode] || !DIR) refuse("usage: node commit-own-hunks.mjs record | build | gate | commit [--carry] | postgate <sha> | ship [--attempts N] | clean, each with --change <dir> [--session <id>] [--wait <minutes>]", EXIT.usage);
  const real = (p) => fs.realpathSync.native(p).toLowerCase();
  const top = git(["rev-parse", "--show-toplevel"]).trim();
  if (real(top) !== real(REPO)) refuse(`run from the repository root (${top})`, EXIT.usage);
  const inside = path.relative(REPO, DIR);
  if (!inside.startsWith("..") && !path.isAbsolute(inside)) refuse("the change directory lies outside the repository", EXIT.usage);
  await MODES[mode]();
} catch (e) {
  if (!(e instanceof Refusal)) throw e;
  console.error(`REFUSED: ${e.message}`);
  process.exit(e.code);
}
