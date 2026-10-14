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
 * text alone. Every line carries the step of the replay that wrote it and,
 * once removed, the step that removed it, so the lines that stood at a place
 * after any step can be read back. A record that names the commit HEAD was at
 * gives that commit to the lines it writes and removes, and the file as that
 * commit holds it says whether a line of some text had landed by then.
 *
 * No record is trusted further than its content. A missing blob, a record
 * with no `pre`, and a change too large to align all end as lines that belong
 * to nobody, which the commit tool leaves where they are unless it is told
 * otherwise. A record that names no commit, or one git cannot read the file
 * from, says nothing of what had landed.
 */
import { spawnSync } from "node:child_process";
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
 * marked as removed by `writer`. `tick` numbers the step: a line it writes is
 * `born` then, and a line it removes is `gone` then. `at` is the commit HEAD
 * was at, where the step is a record that names one: a line it writes is
 * `bornAt` that commit, and a line it removes is `goneAt` it. A step that
 * stands for a writer no hook saw names none.
 */
function step(entries, next, writer, tick, at = null) {
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
    while (placed < j) out.push({ text: next[placed++], owner: who, born: tick, bornAt: at });
  };
  for (const e of entries) {
    if (e.by !== undefined) {
      out.push(e);
      continue;
    }
    const j = keptAs[seen++];
    if (j === -1) {
      out.push({ ...e, by: who, gone: tick, goneAt: at });
    } else {
      placeUpTo(j);
      out.push(e);
      placed = j + 1;
    }
  }
  placeUpTo(next.length);
  return out;
}

/** A commit as a record may name it: a whole object id, and nothing git would read as an option or a path. */
const COMMIT = /^[0-9a-f]{40,64}$/;

/**
 * Whether a file, as a commit holds it, holds a line of some text.
 *
 * @param {string} gitDir The repository's common git directory.
 * @param {string} file Path from the repository root, as the commits spell it.
 * @returns {(commit: string|null|undefined, text: string) => boolean|null}
 *   null where no commit is named, and where git cannot read the file from
 *   it: a commit that is gone, or one the path is not in. Each commit is read
 *   once, and only when asked about.
 */
function headReader(gitDir, file) {
  const held = new Map();
  return (commit, text) => {
    if (typeof commit !== "string" || !COMMIT.test(commit)) return null;
    if (!held.has(commit)) {
      const r = spawnSync("git", ["--git-dir", gitDir, "cat-file", "blob", `${commit}:${file}`], { encoding: "utf8", windowsHide: true, maxBuffer: 1 << 28 });
      held.set(commit, r.status === 0 && typeof r.stdout === "string" ? new Set(toLines(r.stdout)) : null);
    }
    return held.get(commit)?.has(text) ?? null;
  };
}

/**
 * Who wrote and who removed what, for one file as the working tree holds it.
 *
 * @param {string} gitDir The repository's common git directory.
 * @param {string} file Path from the repository root, forward slashes.
 * @param {string} working The file's content now.
 * @param {Map<string, object[]>} [records] `readRecords(gitDir)`, where the
 *   caller already holds it.
 * @returns {null | {lines: string[], owners: string[], born: number[], removed: {text: string, by: string, owner: string, born: number, gone: number, bornAt: string|null, goneAt: string|null}[][], sessions: Map<string, number>, origin: string|null, inHead: (commit: string|null, text: string) => boolean|null}}
 *   null when no record names the file. `owners[i]` wrote `lines[i]`, in
 *   step `born[i]` of the replay. `removed[i]` lists, in order, the lines taken out just ahead of line i,
 *   each with who removed it and who had written it, the steps of the replay
 *   that wrote and removed it (0 for a line the replay began with), and the
 *   commits HEAD was at in those steps (null where the step's record named
 *   none), so it has one entry more than `lines`. `sessions` maps each
 *   session with a record of the file to the time of its latest. `origin` is
 *   the content the first record found, whose lines are `ORIGIN`'s; null
 *   where that record had none. `inHead` says whether the file held a line of
 *   a text at one of those commits, and null where that is not known.
 */
export function blame(gitDir, file, working, records = readRecords(gitDir)) {
  const list = records.get(keyOf(file));
  if (!list?.length) return null;
  const cache = new Map();
  const sessions = new Map();
  let entries = null;
  let origin = null;
  let tick = 0;
  for (const rec of list) {
    sessions.set(rec.session, rec.ts);
    const post = readBlob(gitDir, rec.post, cache);
    if (post === null) continue;
    const pre = readBlob(gitDir, rec.pre, cache);
    const after = toLines(post);
    if (pre === null) {
      entries = entries ? step(entries, after, NOBODY, ++tick) : after.map((text) => ({ text, owner: NOBODY, born: 0 }));
      continue;
    }
    const before = toLines(pre);
    if (!entries) {
      entries = before.map((text) => ({ text, owner: ORIGIN, born: 0 }));
      origin = pre;
    } else if (!holds(entries, before)) entries = step(entries, before, NOBODY, ++tick);
    entries = step(entries, after, rec.session, ++tick, typeof rec.head === "string" ? rec.head : null);
  }
  const now = toLines(working);
  if (!entries) entries = now.map((text) => ({ text, owner: NOBODY, born: 0 }));
  else if (!holds(entries, now)) entries = step(entries, now, NOBODY, ++tick);

  const lines = [];
  const owners = [];
  const born = [];
  const removed = [[]];
  for (const e of entries) {
    if (e.by !== undefined) {
      removed[removed.length - 1].push({ text: e.text, by: e.by, owner: e.owner, born: e.born, gone: e.gone, bornAt: e.bornAt ?? null, goneAt: e.goneAt ?? null });
    } else {
      lines.push(e.text);
      owners.push(e.owner);
      born.push(e.born);
      removed.push([]);
    }
  }
  return { lines, owners, born, removed, sessions, origin, inHead: headReader(gitDir, file) };
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

/** Whether a tombstone's line stood once step `s` of the replay was done. */
const stoodAfter = (e, s) => e.born <= s && e.gone > s;

/**
 * The last step of the replay that left the lines `minus` holds standing, in
 * their order, among the lines a place has since lost, or -1 where no step
 * left them so. `pool` is the place's tombstones, in order.
 */
function lastHeld(pool, minus) {
  const steps = [...new Set(pool.flatMap((e) => [e.born, e.gone]))].sort((a, b) => b - a);
  for (const s of steps) {
    const stood = pool.filter((e) => stoodAfter(e, s));
    if (stood.length === minus.length && stood.every((e, i) => e.text === minus[i])) return s;
  }
  return -1;
}

/**
 * Who removed each of a hunk's removed lines, looked for in order among the
 * tombstones at its place. A line no tombstone holds is nobody's. So is one
 * several tombstones hold with different removers: a line written and removed
 * again leaves a tombstone HEAD never held, and its text does not tell it
 * from the one HEAD did.
 *
 * With `stands`, a line left to nobody is read once more, by when. Where some
 * step of the replay last left the lines `minus` holds standing among the
 * lines the place has since lost, the place read then as HEAD reads it, apart
 * from lines that stand there still. The line is then a session's where the
 * lines of its text that stood after that step went by that session's hand
 * alone, none has been written at the place since, and every earlier removal
 * of a line of that text there by another session was undone by that
 * session's own hand: from each such removal on, it wrote the text there in
 * later steps at least as often as it took it out. A session that changed a
 * line and changed it back has no claim on it. One whose removal another
 * hand undid still has, and so has a writer no hook saw; a line such a writer
 * removed is left as the text reads it.
 *
 * An earlier removal that was not undone still does not stand where the
 * commits say the line it took out had not landed and the line taken out
 * since is another one, which has: HEAD held no line of the text when the
 * earlier removal was made, held none when each line that stood after the
 * step was written, and held one when each of those was taken out. A line
 * written while HEAD held its text is not such a line: it may stand in for
 * one that landed after it left the working tree, which is its remover's to
 * remove. HEAD is asked for the text anywhere in the file: a text it holds at
 * another place is not told, and neither is one whose commit `inHead` cannot
 * read.
 *
 * A text that stands at the place is not read again, the line standing not
 * being told from the one removed, and lines of one text that stood there
 * together are still not told apart, whoever removed each.
 *
 * @param {object[]} pool The place's tombstones, in order.
 * @param {string[]|null} stands The lines standing at the place, or null to
 *   read by text alone.
 * @param {(commit: string|null, text: string) => boolean|null} [inHead]
 *   `blame`'s. Without it nothing is known of what had landed.
 * @returns {{removers: string[], among: Set<string>, steps: number[]}}
 *   `among` holds the removers a line left to nobody may have gone by.
 *   `steps` are the steps of the replay that removed the lines that answered.
 */
function removersOf(pool, minus, stands, inHead = () => null) {
  const removers = [];
  const held = [];
  let from = 0;
  for (const text of minus) {
    const holding = [];
    for (let k = from; k < pool.length; k++) if (pool[k].text === text) holding.push(k);
    const agreed = holding.length > 0 && holding.every((k) => pool[k].by === pool[holding[0]].by);
    removers.push(agreed ? pool[holding[0]].by : NOBODY);
    held.push(holding.map((k) => pool[k]));
    if (agreed) from = holding[0] + 1;
  }
  const since = stands && removers.includes(NOBODY) ? lastHeld(pool, minus) : -1;
  if (since >= 0) {
    minus.forEach((text, i) => {
      if (removers[i] !== NOBODY || stands.includes(text)) return;
      const same = pool.filter((e) => e.text === text);
      const stood = same.filter((e) => stoodAfter(e, since));
      const taker = stood[0].by;
      if (taker === NOBODY || same.some((e) => e.born > since) || !stood.every((e) => e.by === taker)) return;
      const before = same.filter((e) => e.gone <= since && e.by !== taker);
      const undone = (t) => t.by !== NOBODY && same.filter((e) => e.owner === t.by && e.born > t.gone).length >= before.filter((u) => u.by === t.by && u.gone >= t.gone).length;
      const landedSince = () => stood.every((e) => inHead(e.bornAt, text) === false && inHead(e.goneAt, text) === true);
      const withdrawn = (t) => inHead(t.goneAt, text) === false && landedSince();
      if (!before.every((t) => undone(t) || withdrawn(t))) return;
      removers[i] = taker;
      held[i] = stood;
    });
  }
  const among = new Set();
  const steps = [];
  removers.forEach((by, i) => {
    if (by === NOBODY) for (const e of held[i]) among.add(e.by);
    else for (const e of held[i]) steps.push(e.gone);
  });
  return { removers, among, steps };
}

/**
 * The lines written at a place in the steps that removed a hunk's lines, and
 * on through each such line since removed, in the step that removed it: what
 * was put in the removed lines' place, however many times it was reworded
 * and by whom. Only the ones no longer standing are given, each with its
 * writer and with who removed it. `pool` is the place's tombstones.
 */
function writtenInPlace(pool, steps) {
  const chain = new Set(steps);
  for (let grew = true; grew; ) {
    grew = false;
    for (const e of pool) {
      if (!chain.has(e.born) || chain.has(e.gone)) continue;
      chain.add(e.gone);
      grew = true;
    }
  }
  return pool.filter((e) => chain.has(e.born)).map((e) => ({ owner: e.owner, by: e.by }));
}

/** How far a hunk is looked for either side of where git places it. */
const SLIDE_MAX = 64;

/**
 * Of the places a hunk of added lines ties at, the nearest the ledger shows
 * to hold one session's unlanded lines beside lines HEAD holds.
 *
 * A session's lines in a file land together. The place's lines are one
 * session's; some have a text the lines the hunk can slide across hold no
 * more often than the hunk adds it, so every line of that text there is
 * added, and the rest were written no earlier than the oldest of those, so
 * none has landed. Each line the place leaves out is older than the ledger,
 * the session's own, or another session's shown landed: that session wrote,
 * no earlier, a line git holds unchanged whose text no other line holds and
 * no removed line held. Any other line left out may be added, with git
 * holding a line of HEAD's of the same text in its place. Places shown so
 * that name different sessions are none.
 *
 * @param {ReturnType<typeof blame>} blamed
 * @param {{added: string[], slid: number}[]} places Every place the hunk can
 *   slide to; `good` the tied ones among them, nearest git's first.
 * @param {number} first Where git places the hunk's first line.
 * @param {string[]} plus The lines the hunk adds.
 * @param {boolean[]} kept Per line, whether git holds it unchanged.
 * @returns {object|null} The nearest place shown so, or null.
 */
function besideHeadOf({ lines, owners, born, removed }, places, good, first, plus, kept) {
  const n = plus.length;
  const starts = places.map((p) => first + p.slid);
  const lo = Math.min(...starts);
  const hi = Math.max(...starts) + n;
  const tally = (list) => list.reduce((m, text) => m.set(text, (m.get(text) ?? 0) + 1), new Map());
  const there = tally(lines.slice(lo, hi));
  const added = tally(plus);
  const sure = (i) => there.get(lines[i]) === added.get(lines[i]);
  const count = tally(lines);
  const takenOut = new Set(removed.flat().map((t) => t.text));
  const headHolds = (x) => kept[x] && count.get(lines[x]) === 1 && !takenOut.has(lines[x]);
  const landed = (i) => lines.some((_, x) => owners[x] === owners[i] && born[x] >= born[i] && headHolds(x));
  const shown = good.filter((p) => {
    const at = first + p.slid;
    const writer = p.added[0];
    if (!p.added.every((who) => who === writer && who !== NOBODY)) return false;
    const anchors = [];
    for (let i = at; i < at + n; i++) if (sure(i)) anchors.push(born[i]);
    if (!anchors.length) return false;
    const oldest = Math.min(...anchors);
    if (!born.slice(at, at + n).every((step, i) => sure(at + i) || step >= oldest)) return false;
    for (let i = lo; i < hi; i++) {
      if ((i >= at && i < at + n) || owners[i] === ORIGIN || owners[i] === writer) continue;
      if (owners[i] === NOBODY || !landed(i)) return false;
    }
    return true;
  });
  return shown.length && shown.every((p) => p.added[0] === shown[0].added[0]) ? shown[0] : null;
}

/**
 * The writers of one zero-context hunk against HEAD.
 *
 * A hunk that only adds or only removes can lie in more than one place where
 * its lines repeat the ones beside it: a paragraph and the blank line before
 * it are also the blank line after the last paragraph and then the new one.
 * Git picks one such place and the replay may have picked another, so every
 * place the hunk can slide to is read, and the one where the ledger accounts
 * for most of it answers. Where two such places account for it equally and
 * name different writers, the hunk lies at the place of added lines
 * `besideHeadOf` shows, and is nobody's where it shows none.
 *
 * @param {ReturnType<typeof blame>} blamed
 * @param {{newStart: number, plus: string[], minus: string[]}} hunk `newStart`
 *   as git prints it: the first added line, or for a hunk that adds nothing
 *   the line it follows.
 * @param {{newStart: number, plus: string[]}[]|null} [hunks] Every hunk of
 *   the file's diff, `hunk` among them: a line none of them adds is one git
 *   holds unchanged. Without them no line is known unchanged.
 * @returns {null | {added: string[], removed: string[], slid: number, among: string[], replaced: {owner: string, by: string}[]}}
 *   One writer per added line and one remover per removed line, in the order
 *   of the place read; `slid` is how many lines that place lies from git's,
 *   and only at 0 do the writers pair with the hunk's own lines. `among`
 *   names everyone a line given to nobody may belong to, where two readings
 *   disagreed: nobody takes such a line by the ledger, and the sessions among
 *   them still have a claim on it. `replaced` is read for a hunk that both
 *   removes and adds: each line put in the removed lines' place that has
 *   since been removed, with its writer (`owner`) and who removed it (`by`).
 *   Where a line the hunk's removers wrote went by another writer, what
 *   stands in the removed lines' place is no longer theirs. null when the
 *   lines the hunk adds are not the lines `blamed` holds there.
 */
export function writersOf(blamed, hunk, hunks = null) {
  const { lines, owners, removed } = blamed;
  const n = hunk.plus.length;
  const first = n ? hunk.newStart - 1 : hunk.newStart;
  if (hunk.plus.some((text, i) => lines[first + i] !== text)) return null;

  if (n && hunk.minus.length) {
    const pool = removed.slice(first, first + n + 1).flat();
    const gone = removersOf(pool, hunk.minus, hunk.plus, blamed.inHead);
    return { added: owners.slice(first, first + n), removed: gone.removers, slid: 0, among: [...gone.among], replaced: writtenInPlace(pool, gone.steps) };
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
      const gone = removersOf(removed[gap] ?? [], block, null);
      offer({ added: [], removed: gone.removers, among: gone.among, gap, block }, gap - first, gone.removers.filter((by) => by === NOBODY).length);
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
    const kept = lines.map(() => hunks !== null);
    for (const h of hunks ?? []) h.plus.forEach((_, i) => (kept[h.newStart - 1 + i] = false));
    const shown = n ? besideHeadOf(blamed, places, good, first, hunk.plus, kept) : null;
    if (shown) return { added: shown.added, removed: [], slid: shown.slid, among: [], replaced: [] };
    const among = new Set(good.flatMap((p) => [...p.added, ...p.removed, ...p.among]));
    return { added: hunk.plus.map(() => NOBODY), removed: hunk.minus.map(() => NOBODY), slid: 0, among: [...among], replaced: [] };
  }
  // The place is chosen by what the tombstones' text says. Only there, and
  // only where a removal is still nobody's, is it read by when.
  const place = good[0];
  const again = place.removed.includes(NOBODY) ? removersOf(removed[place.gap] ?? [], place.block, [], blamed.inHead) : null;
  return { added: place.added, removed: again?.removers ?? place.removed, slid: place.slid, among: [...(again?.among ?? place.among)], replaced: [] };
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
