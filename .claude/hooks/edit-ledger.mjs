/**
 * Claude Code PostToolUse hook recording what a session writes, as it writes
 * it: one line per Edit or Write, in a ledger the commit tool reads to tell
 * one session's lines from another's in a working tree several sessions
 * share (`.claude/skills/acks-commit/ledger.mjs` is the reader).
 *
 * The ledger lives in the repository's git directory, which no commit carries:
 *
 *   <git dir>/acks-ledger/<session id>.jsonl   one JSON line per write
 *   <git dir>/acks-ledger/blobs/<aa>/<rest>    deflated file content, by sha1
 *
 * A line holds the file's path from the repository root and two content ids:
 * the file as it stood before the tool call (`pre`) and as it stands after
 * (`post`). `pre` is what makes a record safe to read. A writer no hook saw
 * shows as a difference between one record's `post` and the next record's
 * `pre`, and the reader gives those lines to nobody. `pre` is taken from the
 * tool's own result: its copy of the original file, where its patch undone
 * over the file on disk gives the same text; with no copy, that undone patch;
 * with neither, the one replacement undone where the new text occurs exactly
 * once. Where none applies `pre` is null and the reader gives the whole write
 * to nobody.
 *
 * Only a repository that carries the commit tool has a ledger, and only for
 * files git does not ignore. The ledger keeps whole copies of what it
 * records, and a file under some other repository, or one kept out of this
 * one, may be there because its content is to stay where it is.
 *
 * A session appends only to its own file, so no two writers share one. The
 * hook never blocks and never prints: every failure exits 0 with nothing
 * recorded, which the reader sees as a change nobody claims.
 */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const TOOL = ".claude/skills/acks-commit/commit-own-hunks.mjs";

/** A file larger than this is recorded without content. */
const MAX_BYTES = 4 * 1024 * 1024;

const unix = (text) => text.replace(/\r\n/g, "\n");
const unended = (text) => (text.endsWith("\n") ? text.slice(0, -1) : text);
/** Whether two texts hold the same lines, whatever each does at its end. */
const sameText = (a, b) => unended(a) === unended(b);

/** Reads all of stdin as UTF-8. Hook payloads arrive at once. */
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * The git directory that owns `file`, its work tree's root and the file's
 * path from there, or null outside a repository and inside a git directory.
 * A `.git` that is a file names the directory, whose `commondir` names the
 * one every work tree of the repository shares.
 */
function locate(file) {
  for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
    const dot = path.join(dir, ".git");
    const stat = fs.statSync(dot, { throwIfNoEntry: false });
    if (stat) {
      let gitDir = dot;
      if (stat.isFile()) {
        const named = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dot, "utf8"));
        if (!named) return null;
        gitDir = path.resolve(dir, named[1].trim());
        const common = path.join(gitDir, "commondir");
        if (fs.existsSync(common)) gitDir = path.resolve(gitDir, fs.readFileSync(common, "utf8").trim());
      }
      const rel = path.relative(dir, file).split(path.sep).join("/");
      return rel === ".git" || rel.startsWith(".git/") ? null : { gitDir, root: dir, rel };
    }
    if (path.dirname(dir) === dir) return null;
  }
}

/**
 * The text `post` was before the tool's patch, or null where the patch's new
 * side is not what `post` holds at that place. Hunks are undone bottom-up, so
 * an earlier one's line numbers still stand.
 */
function undoPatch(post, patch) {
  const out = post.split("\n");
  for (const hunk of patch.slice().sort((a, b) => b.newStart - a.newStart)) {
    const body = hunk.lines.filter((line) => !line.startsWith("\\")).map((line) => line.replace(/\r$/, ""));
    const after = body.filter((line) => line[0] !== "-").map((line) => line.slice(1));
    const before = body.filter((line) => line[0] !== "+").map((line) => line.slice(1));
    const at = hunk.newStart - 1;
    if (!after.length || after.some((line, i) => out[at + i] !== line)) return null;
    out.splice(at, after.length, ...before);
  }
  return out.join("\n");
}

/** The text `post` was before one replacement, or null where the new text is absent or occurs twice. */
function undoReplace(post, oldString, newString) {
  if (typeof oldString !== "string" || typeof newString !== "string" || !newString) return null;
  const at = post.indexOf(newString);
  if (at === -1 || post.indexOf(newString, at + 1) !== -1) return null;
  return post.slice(0, at) + oldString + post.slice(at + newString.length);
}

/** Keep `text` under its sha1 and answer the id. A blob already kept is left as it is. */
function keep(dir, text) {
  const data = Buffer.from(text, "utf8");
  const id = crypto.createHash("sha1").update(data).digest("hex");
  const file = path.join(dir, "blobs", id.slice(0, 2), id.slice(2));
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const partial = `${file}.${process.pid}`;
    fs.writeFileSync(partial, zlib.deflateSync(data));
    fs.renameSync(partial, file);
  }
  return id;
}

try {
  const payload = JSON.parse(await readStdin());
  const session = payload.session_id ?? process.env.CLAUDE_CODE_SESSION_ID;
  const input = payload.tool_input ?? {};
  const result = payload.tool_response ?? {};
  const file = input.file_path;
  if (typeof session !== "string" || !/^[\w-]+$/.test(session)) process.exit(0);
  if (typeof file !== "string" || !path.isAbsolute(file)) process.exit(0);
  const where = locate(path.resolve(file));
  if (!where || !fs.existsSync(path.join(where.root, TOOL))) process.exit(0);
  // `check-ignore` exits 1 for a path git does not ignore. An ignored path
  // and a git that could not answer both leave the file unrecorded.
  if (spawnSync("git", ["check-ignore", "-q", "--", where.rel], { cwd: where.root, windowsHide: true }).status !== 1) process.exit(0);

  let post = null;
  const stat = fs.statSync(file, { throwIfNoEntry: false });
  if (stat?.isFile() && stat.size <= MAX_BYTES) post = unix(fs.readFileSync(file, "utf8"));

  let pre = null;
  let how = "none";
  if (post !== null) {
    const patch = Array.isArray(result.structuredPatch) && result.structuredPatch.length ? result.structuredPatch : null;
    const unpatched = patch && undoPatch(post, patch);
    if (typeof result.originalFile === "string") {
      // The tool's two accounts of the file before the call have to agree: a
      // copy that is not the whole file would hand this session every line
      // the copy lacks.
      const original = unix(result.originalFile);
      if (!patch || (unpatched !== null && sameText(unpatched, original))) [pre, how] = [original, "original"];
    } else if (result.type === "create") {
      [pre, how] = ["", "create"];
    } else if (patch) {
      if (unpatched !== null) [pre, how] = [unpatched, "patch"];
    } else if (!input.replace_all && input.old_string !== undefined) {
      pre = undoReplace(post, unix(input.old_string), unix(input.new_string ?? ""));
      if (pre !== null) how = "replace";
    }
  }

  const dir = path.join(where.gitDir, "acks-ledger");
  fs.mkdirSync(dir, { recursive: true });
  const line = {
    v: 1,
    ts: Date.now(),
    file: where.rel,
    tool: payload.tool_name ?? null,
    pre: pre === null ? null : keep(dir, pre),
    post: post === null ? null : keep(dir, post),
    how,
  };
  if (payload.agent_id) line.agent = payload.agent_id;
  fs.appendFileSync(path.join(dir, `${session}.jsonl`), `${JSON.stringify(line)}\n`);
} catch {
  // Nothing recorded is a change nobody claims, which is the safe reading.
}
process.exit(0);
