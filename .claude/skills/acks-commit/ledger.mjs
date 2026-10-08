/**
 * Reads the edit ledger and answers, for one file, which session wrote each
 * line the working tree holds and which removed each line it no longer does.
 *
 * `.claude/hooks/edit-ledger.mjs` writes the ledger: per session, one record
 * per Edit or Write, holding the file's content before and after. This module
 * replays a file's records in time order over a list of lines. A record's own
 * change gives its lines to the record's session. A difference between what
 * the list holds and what the next record found gives its lines to nobody: a
 * writer no hook saw (a script, a formatter, a session older than the hook)
 * came between. A removed line stays in the list as a tombstone naming who
 * removed it, so a removal is attributed by where it happened and not by its
 * text alone.
 *
 * No record is trusted further than its content. A missing blob, a record
 * with no `pre`, and a change too large to align all end as lines that belong
 * to nobody, which the commit tool leaves where they are unless it is told
 * otherwise.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

/** The writer of a line older than the ledger's first record of its file. */
export const ORIGIN = "";
/** The writer of a line no record accounts for. */
export const NOBODY = "?";

/** Above this many cells a change is not aligned line by line, and its lines go to nobody. */
const ALIGN_CELLS = 4_000_000;

/** `prune` drops a session whose latest record is older than this. */
const KEEP_DAYS = 14;

export const ledgerDir = (gitDir) => path.join(gitDir, "acks-ledger");

/** A path as the ledger keys it: Windows names one file in any case. */
export const keyOf =(file) => (process.platform === "win32" ? file.toLowerCase() : file);

/** Text as lines the way git counts them: LF ends, and no entry for the newline that ends the file. */
export function toLines(text) {
  const all = text.replace(/\r\n/g, "\n").split("\n");
  if (all[all.length - 1] === "") all.pop();
  return all;
}

/**
 * Every record in the ledger, by file, oldest first.
 *
 * @param {string} gitDir The repository's common git directory.
 * @returns {Map<string, object[]>} Keyed as `blame` looks files up. Each
 *   record carries the `session` whose file it was read from. A line that
 *   does not parse is a write cut short, and is skipped.
 */
export function readRecords(gitDir) {
  const byFile = new Map();
  const dir = ledgerDir(gitDir);
  if (!fs.existsSync(dir)) return byFile;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".jsonl")) continue;
    const session = name.slice(0, -".jsonl".length);
    for (const line of fs.readFileSync(path.join(dir, name), "utf8").split("\n")) {
      let rec;
      try {
        rec = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof rec?.file !== "string" || typeof rec.ts !== "number") continue;
      const key = keyOf(rec.file);
      if (!byFile.has(key)) byFile.set(key, []);
      byFile.get(key).push({ ...rec, session });
    }
  }
  for (const list of byFile.values()) list.sort((a, b) => a.ts - b.ts);
  return byFile;
}

function readBlob(gitDir, id, cache) {
  if (!id) return null;
  if (!cache.has(id)) {
    let text = null;
    try {
      text = zlib.inflateSync(fs.readFileSync(path.join(ledgerDir(gitDir), "blobs", id.slice(0, 2), id.slice(2)))).toString("utf8");
    } catch {
      // A blob that is gone leaves its record without content.
    }
    cache.set(id, text);
  }
  return cache.get(id);
}

/** The pairs of positions a longest common subsequence of two line ranges matches, in order. */
function align(a, a0, n, b, b0, m) {
  const width = m + 1;
  const table = n < 0xffff && m < 0xffff ? new Uint16Array((n + 1) * width) : new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] = a[a0 + i] === b[b0 + j] ? table[(i + 1) * width + j + 1] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  const pairs = [];
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (a[a0 + i] === b[b0 + j]) pairs.push([a0 + i++, b0 + j++]);
    else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) i++;
    else j++;
  }
  return pairs;
}

const live = (entries) => entries.filter((e) => e.by === undefined);
const holds = (entries, lines) => {
  const now = live(entries);
  return now.length === lines.length && now.every((e, i) => e.text === lines[i]);
};

/**
 * Move the list from the lines it holds to `next`. A line both hold keeps its
 * entry. A line only `next` holds enters as `writer`'s, just ahead of the
 * kept line that follows it. A line only the list holds stays where it was,
 * marked as removed by `writer`.
 */
function step(entries, next, writer) {
  const a = live(entries).map((e) => e.text);
  let head = 0;
  while (head < a.length && head < next.length && a[head] === next[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < next.length - head && a[a.length - 1 - tail] === next[next.length - 1 - tail]) tail++;
  const midA = a.length - head - tail;
  const midB = next.length - head - tail;

  const keptAs = new Int32Array(a.length).fill(-1);
  for (let i = 0; i < head; i++) keptAs[i] = i;
  for (let i = 1; i <= tail; i++) keptAs[a.length - i] = next.length - i;
  let who = writer;
  if (midA && midB) {
    if (midA * midB > ALIGN_CELLS) who = NOBODY;
    else for (const [i, j] of align(a, head, midA, next, head, midB)) keptAs[i] = j;
  }

  const out = [];
  let seen = 0;
  let placed = 0;
  const placeUpTo = (j) => {
    while (placed < j) out.push({ text: next[placed++], owner: who });
  };
  for (const e of entries) {
    if (e.by !== undefined) {
      out.push(e);
      continue;
    }
    const j = keptAs[seen++];
    if (j === -1) {
      out.push({ ...e, by: who });
    } else {
      placeUpTo(j);
      out.push(e);
      placed = j + 1;
    }
  }
  placeUpTo(next.length);
  return out;
}

/**
 * Who wrote and who removed what, for one file as the working tree holds it.
 *
 * @param {string} gitDir The repository's common git directory.
 * @param {string} file Path from the repository root, forward slashes.
 * @param {string} working The file's content now.
 * @param {Map<string, object[]>} [records] `readRecords(gitDir)`, where the
 *   caller already holds it.
 * @returns {null | {lines: string[], owners: string[], removed: {text: string, by: string, owner: string}[][], sessions: Map<string, number>, origin: string|null}}
 *   null when no record names the file. `owners[i]` wrote `lines[i]`.
 *   `removed[i]` lists, in order, the lines taken out just ahead of line i,
 *   each with who removed it and who had written it, so it has one entry
 *   more than `lines`. `sessions` maps each session with a record of the
 *   file to the time of its latest. `origin` is the content the first
 *   record found, whose lines are `ORIGIN`'s; null where that record had none.
 */
export function blame(gitDir, file, working, records = readRecords(gitDir)) {
  const list = records.get(keyOf(file));
  if (!list?.length) return null;
  const cache = new Map();
  const sessions = new Map();
  let entries = null;
  let origin = null;
  for (const rec of list) {
    sessions.set(rec.session, rec.ts);
    const post = readBlob(gitDir, rec.post, cache);
    if (post === null) continue;
    const pre = readBlob(gitDir, rec.pre, cache);
    const after = toLines(post);
    if (pre === null) {
      entries = entries ? step(entries, after, NOBODY) : after.map((text) => ({ text, owner: NOBODY }));
      continue;
    }
    const before = toLines(pre);
    if (!entries) {
      entries = before.map((text) => ({ text, owner: ORIGIN }));
      origin = pre;
    } else if (!holds(entries, before)) entries = step(entries, before, NOBODY);
    entries = step(entries, after, rec.session);
  }
  const now = toLines(working);
  if (!entries) entries = now.map((text) => ({ text, owner: NOBODY }));
  else if (!holds(entries, now)) entries = step(entries, now, NOBODY);

  const lines = [];
  const owners = [];
  const removed = [[]];
  for (const e of entries) {
    if (e.by !== undefined) {
      removed[removed.length - 1].push({ text: e.text, by: e.by, owner: e.owner });
    } else {
      lines.push(e.text);
      owners.push(e.owner);
      removed.push([]);
    }
  }
  return { lines, owners, removed, sessions, origin };
}

/**
 * Whether the sessions in `mine` are the only writers the ledger knows for a
 * file: every line it holds is theirs or older than the ledger, and they
 * removed every line taken out. Where the content the ledger began from is
 * also a committed one, the file's whole difference from HEAD is theirs,
 * however a diff divides it into hunks.
 *
 * @param {ReturnType<typeof blame>} blamed
 * @param {Set<string>} mine
 */
export function soleWriter(blamed, mine) {
  return blamed.owners.every((who) => who === ORIGIN || mine.has(who)) && blamed.removed.every((gap) => gap.every((line) => mine.has(line.by)));
}

/**
 * Who removed each of a hunk's removed lines, looked for in order among the
 * tombstones at its place. A line no tombstone holds is nobody's. So is one
 * several tombstones hold with different removers: a line written and removed
 * again leaves a tombstone HEAD never held, and nothing here tells it from
 * the one HEAD did. `among` holds the removers of every such line.
 */
function removersOf(pool, minus) {
  const removers = [];
  const among = new Set();
  let from = 0;
  for (const text of minus) {
    const holding = [];
    for (let k = from; k < pool.length; k++) if (pool[k].text === text) holding.push(k);
    const agreed = holding.length > 0 && holding.every((k) => pool[k].by === pool[holding[0]].by);
    removers.push(agreed ? pool[holding[0]].by : NOBODY);
    if (agreed) from = holding[0] + 1;
    else for (const k of holding) among.add(pool[k].by);
  }
  return { removers, among };
}

/** How far a hunk is looked for either side of where git places it. */
const SLIDE_MAX = 64;

/**
 * The writers of one zero-context hunk against HEAD.
 *
 * A hunk that only adds or only removes can lie in more than one place where
 * its lines repeat the ones beside it: a paragraph and the blank line before
 * it are also the blank line after the last paragraph and then the new one.
 * Git picks one such place and the replay may have picked another, so every
 * place the hunk can slide to is read, and the one where the ledger accounts
 * for most of it answers. Where two such places account for it equally and
 * name different writers, nothing tells them apart and the hunk is nobody's.
 *
 * @param {ReturnType<typeof blame>} blamed
 * @param {{newStart: number, plus: string[], minus: string[]}} hunk `newStart`
 *   as git prints it: the first added line, or for a hunk that adds nothing
 *   the line it follows.
 * @returns {null | {added: string[], removed: string[], slid: number, among: string[]}}
 *   One writer per added line and one remover per removed line, in the order
 *   of the place read; `slid` is how many lines that place lies from git's,
 *   and only at 0 do the writers pair with the hunk's own lines. `among`
 *   names everyone a line given to nobody may belong to, where two readings
 *   disagreed: nobody takes such a line by the ledger, and the sessions among
 *   them still have a claim on it. null when the lines the hunk adds are not
 *   the lines `blamed` holds there.
 */
export function writersOf(blamed, hunk) {
  const { lines, owners, removed } = blamed;
  const n = hunk.plus.length;
  const first = n ? hunk.newStart - 1 : hunk.newStart;
  if (hunk.plus.some((text, i) => lines[first + i] !== text)) return null;

  if (n && hunk.minus.length) {
    const gone = removersOf(removed.slice(first, first + n + 1).flat(), hunk.minus);
    return { added: owners.slice(first, first + n), removed: gone.removers, slid: 0, among: [...gone.among] };
  }

  const places = [];
  const offer = (found, slid, cost) => places.push({ ...found, slid, cost });
  if (n) {
    // Added lines the first record already held were not added since.
    const read = (at) => offer({ added: owners.slice(at, at + n), removed: [], among: new Set() }, at - first, owners.slice(at, at + n).filter((who) => who === ORIGIN).length);
    read(first);
    for (let at = first; at > 0 && first - at < SLIDE_MAX && lines[at - 1] === lines[at + n - 1]; ) read(--at);
    for (let at = first; at + n < lines.length && at - first < SLIDE_MAX && lines[at] === lines[at + n]; ) read(++at);
  } else {
    const read = (gap, block) => {
      const gone = removersOf(removed[gap] ?? [], block);
      offer({ added: [], removed: gone.removers, among: gone.among }, gap - first, gone.removers.filter((by) => by === NOBODY).length);
    };
    read(first, hunk.minus);
    for (let gap = first, block = hunk.minus; gap > 0 && first - gap < SLIDE_MAX && lines[gap - 1] === block[block.length - 1]; ) {
      block = [lines[gap - 1], ...block.slice(0, -1)];
      read(--gap, block);
    }
    for (let gap = first, block = hunk.minus; gap < lines.length && gap - first < SLIDE_MAX && lines[gap] === block[0]; ) {
      block = [...block.slice(1), lines[gap]];
      read(++gap, block);
    }
  }
  const least = Math.min(...places.map((p) => p.cost));
  const good = places.filter((p) => p.cost === least).sort((a, b) => Math.abs(a.slid) - Math.abs(b.slid));
  const who = (p) => [...p.added, ...p.removed].sort().join("\n");
  if (good.some((p) => who(p) !== who(good[0]))) {
    const among = new Set(good.flatMap((p) => [...p.added, ...p.removed, ...p.among]));
    return { added: hunk.plus.map(() => NOBODY), removed: hunk.minus.map(() => NOBODY), slid: 0, among: [...among] };
  }
  return { added: good[0].added, removed: good[0].removed, slid: good[0].slid, among: [...good[0].among] };
}

/**
 * Drop the sessions that have been silent longer than the ledger keeps, and
 * the blobs no remaining record names. A session's file is removed whole or
 * left alone, never rewritten: its hook may be appending to it. A blob
 * younger than a day is kept whatever names it, since a hook writes a blob
 * before the record that names it.
 *
 * @returns {{sessions: number, blobs: number}} How many of each were removed.
 */
export function prune(gitDir, now = Date.now()) {
  const dir = ledgerDir(gitDir);
  const gone = { sessions: 0, blobs: 0 };
  if (!fs.existsSync(dir)) return gone;
  const named = new Set();
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".jsonl")) continue;
    const file = path.join(dir, name);
    const records = [];
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      try {
        records.push(JSON.parse(line));
      } catch {
        // A line cut short names nothing.
      }
    }
    const latest = Math.max(0, ...records.map((rec) => rec?.ts ?? 0));
    if (latest < now - KEEP_DAYS * 86_400_000) {
      fs.rmSync(file);
      gone.sessions++;
      continue;
    }
    for (const rec of records) for (const id of [rec?.pre, rec?.post]) if (id) named.add(id);
  }
  const blobs = path.join(dir, "blobs");
  if (!fs.existsSync(blobs)) return gone;
  for (const fan of fs.readdirSync(blobs)) {
    for (const rest of fs.readdirSync(path.join(blobs, fan))) {
      const blob = path.join(blobs, fan, rest);
      if (named.has(fan + rest) || fs.statSync(blob).mtimeMs > now - 86_400_000) continue;
      fs.rmSync(blob);
      gone.blobs++;
    }
  }
  return gone;
}
