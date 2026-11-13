/**
 * Changelog fragments and the major-release roll. `release-preflight.mjs`
 * checks the results (`changelog-compiled` on every kind, `logs-rolled` on a
 * major); this tool produces them.
 *
 * Commands:
 *   compile [--label "<text>"]   Writes `## <version> — <label>` (or `## <version>`
 *                                with no label) into CHANGELOG.md from the TRACKED
 *                                files under `changelog.d/`, grouped as
 *                                `### Upgrading`, `### Added`, `### Changed`,
 *                                `### Removed`, `### Fixed`, fragments in file-name
 *                                order, each trimmed. The section goes above the
 *                                first `## ` heading, or at the end where there is
 *                                none. The compiled fragment files are deleted;
 *                                untracked ones are listed and left alone.
 *   preview [--label "<text>"]   Prints the section `compile` would insert and
 *                                changes nothing.
 *   roll [--prev v<version>]     Archives each `CHANGELOG.md` and
 *                                `docs/**\/DECISIONS.md` as the previous tag shipped
 *                                it, beside the live file, as
 *                                `<NAME>-through-v<prev>.md` (`git show`, byte for
 *                                byte), and rewrites the live files: a DECISIONS
 *                                keeps its H1, a pointer line, `## In force` with one
 *                                drafted index row per archived ruling that is not
 *                                superseded whole, and every entry that landed after
 *                                the tag. A later roll, on a DECISIONS that already
 *                                holds `## In force`, keeps the earlier pointer
 *                                lines, adds its own, carries the live index rows
 *                                forward as they stand and adds rows for the new
 *                                archive's entries (the tag's own `## In force` is
 *                                never drafted). A CHANGELOG keeps its preamble, a
 *                                pointer line and the sections whose version has
 *                                no tag.
 *                                Prints what a reviewer must rule on (undated
 *                                headings, `IN PART`, entries that mention
 *                                superseding), edits made after the tag inside
 *                                entries that existed at the tag (they are in no
 *                                archive and leave the live file), each ROADMAP to
 *                                re-issue, and each `docs/releases/v*` folder no
 *                                guide or gallery links. It deletes nothing and
 *                                writes no ROADMAP. A log whose live file already
 *                                links the archive is skipped.
 *
 * The previous tag is the highest local `v*` tag by Foundry's version compare,
 * excluding `v<module.json version>`; `--prev` overrides it. `git describe` is
 * never used: it names the nearest tag, not the highest.
 *
 * Exit 0 on success. Exit 1 on a refusal: an unparseable tracked fragment name,
 * no tracked fragment, a version that already has a section, a non-empty
 * `## Unreleased`, no tag to roll from, or an archive that exists with other
 * bytes. A refusal writes nothing.
 *
 * Usage: node tools/logs.mjs compile|preview [--label "<text>"]
 *        node tools/logs.mjs roll [--prev v<version>]
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const ROOT = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const gitBuf = (...a) => execFileSync("git", ["-C", ROOT, ...a], { maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"] });
const git = (...a) => gitBuf(...a).toString("utf8").trim();
/** Paths from a NUL-separated git listing, so a name is never quoted or split. */
const gitZ = (...a) => gitBuf(...a).toString("utf8").split("\0").filter(Boolean);

const args = process.argv.slice(2);
const command = args[0];
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);

/** Prints a refusal and exits 1. */
function die(message) {
  console.error(`logs: ${message}`);
  process.exit(1);
}

/** The shape of a version Foundry can order; validate.mjs holds the same test. */
const ORDERABLE = /^(0|[1-9]\d*)(\.(0|[1-9]\d*)){2}(\.[1-9]\d*)?$/u;
/** The one shape of a live DECISIONS entry heading, after `## `. */
const LIVE_HEADING = /^\d{4}-\d{2}-\d{2} — \S.*$/u;
/** A fragment's file name under `changelog.d/`: date, row id or slug, category. */
const FRAGMENT_NAME = /^(\d{4}-\d{2}-\d{2})-([A-Za-z0-9][A-Za-z0-9._-]*)\.(upgrading|added|changed|removed|fixed)\.md$/u;
const CATEGORIES = ["upgrading", "added", "changed", "removed", "fixed"];
const TITLES = { upgrading: "Upgrading", added: "Added", changed: "Changed", removed: "Removed", fixed: "Fixed" };

/**
 * Foundry's version compare, part by part: two numeric parts that differ
 * order numerically, parts equal as numbers but different as strings and
 * non-numeric parts order as strings, and a longer version whose leading parts
 * are equal is the newer. Returns 1, -1 or 0.
 */
function compareVersions(a, b) {
  const pa = a.split(".");
  const pb = b.split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if (pa[i] === undefined) return -1;
    if (pb[i] === undefined) return 1;
    if (/^\d+$/u.test(pa[i]) && /^\d+$/u.test(pb[i]) && Number(pa[i]) !== Number(pb[i])) return Number(pa[i]) > Number(pb[i]) ? 1 : -1;
    if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
  }
  return 0;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const eolOf = (text) => (text.includes("\r\n") ? "\r\n" : "\n");
const noCr = (line) => line.replace(/\r$/u, "");

/** The module's version, from module.json. */
function moduleVersion() {
  const json = JSON.parse(fs.readFileSync(path.join(ROOT, "module.json"), "utf8").replace(/^﻿/u, ""));
  return String(json.version);
}

/** Every local `v*` tag. */
const localTags = () => git("tag", "-l", "v*").split("\n").filter(Boolean);

/** The highest local tag of a shape Foundry can order, other than the release's own `v<version>`, or null. */
function highestTag(version) {
  return (
    localTags()
      .filter((t) => ORDERABLE.test(t.slice(1)) && t !== `v${version}`)
      .sort((a, b) => compareVersions(a.slice(1), b.slice(1)))
      .at(-1) ?? null
  );
}

/** Every file under a directory, as posix paths relative to ROOT; empty where the directory is absent. */
function walk(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(`${rel}/${d.name}`) : [`${rel}/${d.name}`]));
}

/** GitHub's heading slug: lowercase, everything but letters, numbers, spaces, hyphens and underscores dropped, spaces to hyphens. */
function slugOf(text) {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/[`*]/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .replaceAll(" ", "-");
}

/**
 * Every ATX heading outside a fenced block, as `{ line, level, text, anchor }`
 * with `line` 0-based. A repeated slug gains `-1`, `-2` in document order, as
 * GitHub numbers them, across every heading level.
 */
function headings(lines) {
  const out = [];
  const seen = new Map();
  let fence = null;
  lines.forEach((raw, line) => {
    const l = noCr(raw);
    const f = /^ {0,3}(`{3,}|~{3,})/u.exec(l);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      return;
    }
    if (fence) return;
    const m = /^(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/u.exec(l);
    if (!m || !m[2]) return;
    const slug = slugOf(m[2]);
    const n = seen.get(slug) ?? 0;
    seen.set(slug, n + 1);
    out.push({ line, level: m[1].length, text: m[2], anchor: n ? `${slug}-${n}` : slug });
  });
  return out;
}

/**
 * A log split at its `## ` headings: `preamble` is the lines before the first,
 * and each entry is `{ text, anchor, lines }` where `lines` run from its
 * heading to the line before the next `## `, carriage returns intact.
 */
function sections(text) {
  const lines = text.split("\n");
  const all = headings(lines);
  const h2 = all.filter((h) => h.level === 2);
  const entries = h2.map((h, i) => ({ text: h.text, anchor: h.anchor, lines: lines.slice(h.line, h2[i + 1]?.line ?? lines.length) }));
  return { lines, all, preamble: lines.slice(0, h2[0]?.line ?? lines.length), entries };
}

/** The heading's date and the text after `<date> — `, or null for a heading that does not open with a date. */
function dated(text) {
  const m = /^(\d{4}-\d{2}-\d{2})\s*(?:—|–|-{1,2})\s*(\S.*)$/u.exec(text);
  return m ? { date: m[1], title: m[2] } : null;
}

// -- compile / preview -------------------------------------------------------

/** The tracked fragments on disk, the names that do not parse, and the untracked files left alone. */
function fragments() {
  const prefix = "changelog.d/";
  const tracked = gitZ("ls-files", "-z", "--", "changelog.d").filter((f) => fs.existsSync(path.join(ROOT, f)));
  const untracked = gitZ("ls-files", "-z", "--others", "--exclude-standard", "--", "changelog.d");
  const parsed = tracked.map((f) => ({ file: f, name: f.slice(prefix.length), m: FRAGMENT_NAME.exec(f.slice(prefix.length)) }));
  return {
    bad: parsed.filter((p) => !p.m).map((p) => p.file),
    good: parsed.filter((p) => p.m).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    untracked,
  };
}

/** What compile would write: the new CHANGELOG text, the section inserted, and the fragments it consumes. */
function planCompile(label) {
  const version = moduleVersion();
  const { bad, good, untracked } = fragments();
  if (bad.length) die(`tracked file(s) under changelog.d/ whose name is not <YYYY-MM-DD>-<row id or slug>.<upgrading|added|changed|removed|fixed>.md — nothing written:\n  ${bad.join("\n  ")}`);
  if (!good.length) die(`nothing to compile — no tracked fragment under changelog.d/${untracked.length ? ` (${untracked.length} untracked; git add them first)` : ""}`);

  const file = path.join(ROOT, "CHANGELOG.md");
  const original = fs.existsSync(file) ? fs.readFileSync(file, "utf8").replace(/^﻿/u, "") : "# Changelog\n";
  const eol = eolOf(original);
  let lines = original.replace(/\r\n/gu, "\n").split("\n");

  const versionHeading = new RegExp(`^(?:Release\\s+)?\\[?v?${escapeRe(version)}\\]?(?:\\s|$)`, "u");
  if (headings(lines).some((h) => h.level === 2 && versionHeading.test(h.text))) die(`CHANGELOG.md already has a section for ${version}`);

  const h2 = () => headings(lines).filter((h) => h.level === 2);
  const unreleased = h2().find((h) => /^\[?unreleased\]?$/iu.test(h.text));
  if (unreleased) {
    const end = h2().find((h) => h.line > unreleased.line)?.line ?? lines.length;
    if (lines.slice(unreleased.line + 1, end).some((l) => l.trim() && !/^#{1,6}\s/u.test(l))) die("CHANGELOG.md has a non-empty ## Unreleased — turn each of its bullets into a changelog.d/ fragment, then compile");
    lines.splice(unreleased.line, end - unreleased.line);
  }

  const body = [];
  for (const cat of CATEGORIES) {
    const group = good.filter((g) => g.m[3] === cat);
    if (!group.length) continue;
    const text = group.map((g) => fs.readFileSync(path.join(ROOT, g.file), "utf8").replace(/^﻿/u, "").replace(/\r\n/gu, "\n").trim());
    body.push("", `### ${TITLES[cat]}`, "", text.join("\n"));
  }
  const section = [`## ${version}${label ? ` — ${label}` : ""}`, ...body];

  const at = h2()[0]?.line ?? lines.length;
  const before = lines.slice(0, at);
  while (before.length && !before.at(-1).trim()) before.pop();
  const after = lines.slice(at);
  lines = [...before, ...(before.length ? [""] : []), ...section, "", ...after];
  if (lines.at(-1) !== "") lines.push("");
  return { version, text: lines.join(eol), section: section.join(eol), good, untracked };
}

/** Lists the untracked files a compile leaves alone. */
function noteUntracked(untracked) {
  for (const f of untracked) console.log(`not compiled (untracked): ${f}`);
}

/** `compile`: writes the section, deletes the consumed fragments. */
function compile() {
  const plan = planCompile(opt("--label"));
  fs.writeFileSync(path.join(ROOT, "CHANGELOG.md"), plan.text);
  for (const g of plan.good) fs.rmSync(path.join(ROOT, g.file));
  noteUntracked(plan.untracked);
  console.log(`logs: CHANGELOG.md gains ## ${plan.version} from ${plan.good.length} fragment(s); the fragment files are deleted.`);
}

/** `preview`: prints the section compile would insert. */
function preview() {
  const plan = planCompile(opt("--label"));
  noteUntracked(plan.untracked);
  console.log(plan.section);
}

// -- roll --------------------------------------------------------------------

/** Lines of `lines` that are not in `other`, as a multiset, blank lines ignored. */
function missingFrom(lines, other) {
  const pool = new Map();
  for (const l of other.map(noCr).filter((x) => x.trim())) pool.set(l, (pool.get(l) ?? 0) + 1);
  const out = [];
  for (const l of lines.map(noCr).filter((x) => x.trim())) {
    if (pool.get(l)) pool.set(l, pool.get(l) - 1);
    else out.push(l);
  }
  return out;
}

/** True where the archive file at `rel` is absent, byte-identical to the tag's blob, or different. */
function archiveState(rel, prev, source) {
  if (!fs.existsSync(path.join(ROOT, rel))) return "new";
  return git("hash-object", "--", rel) === git("rev-parse", `${prev}:${source}`) ? "same" : "conflict";
}

/** The version a CHANGELOG heading names, or null; the release workflow's heading test. */
const sectionVersion = (text) => /^(?:Release\s+)?\[?v?(\d[^\]\s]*)\]?(?:\s|$)/u.exec(text)?.[1] ?? null;

/** Rewrites a live DECISIONS file; returns the console lines that describe it. */
function rollDecisions({ source, archiveName, prev, blob }) {
  const report = [];
  const livePath = path.join(ROOT, source);
  if (!fs.existsSync(livePath)) return [`${source}: not in the working tree — archive written, no live file to rewrite`];
  const live = fs.readFileSync(livePath, "utf8").replace(/^﻿/u, "");
  const liveSections = sections(live);
  if (live.includes(`](${archiveName}`)) return [`${source}: already links ${archiveName} — live file left as it is`];
  // An `## In force` the live file already holds is an earlier roll's index: a later roll carries it forward.
  const carried = liveSections.entries.find((e) => e.text === "In force");

  const old = sections(blob.toString("utf8").replace(/^﻿/u, ""));
  const liveH1 = liveSections.all.find((h) => h.level === 1);
  const h1 = liveH1 ?? old.all.find((h) => h.level === 1);
  const h1Line = h1 ? `# ${h1.text}` : "# Decisions";

  // Occurrence-numbered keys, so two entries sharing a heading pair up in order.
  const keyed = (entries) => {
    const n = new Map();
    return entries.map((e) => {
      const i = n.get(e.text) ?? 0;
      n.set(e.text, i + 1);
      return { ...e, key: `${e.text}\0${i}` };
    });
  };
  // Anchors come from `sections`, over every heading of the tag's blob, so an earlier roll's `## In force` still counts toward duplicate-slug numbering.
  const oldEntries = keyed(old.entries.filter((e) => e.text !== "In force"));
  const liveEntries = keyed(liveSections.entries.filter((e) => e.text !== "In force"));
  const oldKeys = new Map(oldEntries.map((e) => [e.key, e]));

  const rows = [];
  const review = [];
  for (const e of oldEntries) {
    const d = dated(e.text);
    const bodyText = e.lines.join("\n");
    const inPart = /IN PART/u.test(e.text);
    const supersededWhole = /SUPERSEDED/u.test(e.text) && !inPart;
    if (!d) review.push(`undated heading: "${e.text}"`);
    if (inPart) review.push(`IN PART: "${e.text}"`);
    if (/supersed/iu.test(bodyText.split("\n").slice(1).join("\n"))) review.push(`body mentions superseding${supersededWhole ? " (no row drafted)" : ""}: "${e.text}"`);
    if (supersededWhole) continue;
    const title = (d ? d.title : e.text).replace(/([[\]])/gu, "\\$1");
    rows.push(`- ${d ? d.date : "undated"} — [${title}](${archiveName}#${e.anchor})`);
  }

  const edits = [];
  for (const e of liveEntries) {
    const was = oldKeys.get(e.key);
    if (!was) continue;
    const added = missingFrom(e.lines, was.lines);
    const removed = missingFrom(was.lines, e.lines);
    if (added.length || removed.length) edits.push({ text: e.text, added, removed });
  }
  const kept = liveEntries.filter((e) => !oldKeys.has(e.key));
  const eol = eolOf(live);
  const trimmed = (lines) => {
    const out = lines.map(noCr);
    while (out.length && !out[0].trim()) out.shift();
    while (out.length && !out.at(-1).trim()) out.pop();
    return out;
  };
  // A first roll drops the preamble; a later one keeps it, since it holds the earlier rolls' pointer lines.
  const lead = carried && liveH1 ? trimmed(liveSections.preamble.slice(liveH1.line + 1)) : [];
  const carriedRows = carried ? trimmed(carried.lines.slice(1)) : [];
  const pointer = `Rulings through ${prev}: [${archiveName}](${archiveName}).`;
  const allRows = [...carriedRows, ...rows];
  const head = [h1Line, "", ...(lead.length ? [...lead, ""] : []), pointer, "", "## In force", "", ...(allRows.length ? [...allRows, ""] : [])].join(eol);
  let text = head + eol + kept.map((e) => e.lines.join("\n")).join("\n");
  if (!text.endsWith("\n")) text += eol;
  fs.writeFileSync(livePath, text);

  report.push(`${source}: ${rows.length} index row(s) drafted from ${oldEntries.length} archived entr${oldEntries.length === 1 ? "y" : "ies"}${carried ? `, ${carriedRows.length} carried from the live index` : ""}; ${kept.length} entr${kept.length === 1 ? "y" : "ies"} after ${prev} kept`);
  for (const r of review) report.push(`  review: ${r}`);
  for (const e of kept) if (!LIVE_HEADING.test(e.text)) report.push(`  review: kept entry heading is not "## YYYY-MM-DD — <title>": "${e.text}"`);
  for (const e of edits) {
    report.push(`  edited after ${prev}, inside an entry the archive holds (not in the archive, dropped from the live file): "${e.text}"`);
    const lines = [...e.added.map((l) => `    + ${l}`), ...e.removed.map((l) => `    - ${l}`)];
    report.push(...lines.slice(0, 12), ...(lines.length > 12 ? [`    … ${lines.length - 12} more`] : []));
  }
  return report;
}

/** Rewrites a live CHANGELOG; returns the console lines that describe it. */
function rollChangelog({ source, archiveName, prev }) {
  const livePath = path.join(ROOT, source);
  if (!fs.existsSync(livePath)) return [`${source}: not in the working tree — archive written, no live file to rewrite`];
  const live = fs.readFileSync(livePath, "utf8").replace(/^﻿/u, "");
  if (live.includes(`](${archiveName})`)) return [`${source}: already links ${archiveName} — live file left as it is`];
  const tags = new Set(localTags());
  const parts = sections(live);
  const keep = parts.entries.filter((e) => {
    const v = sectionVersion(e.text);
    return !(v && tags.has(`v${v}`));
  });
  const preamble = [...parts.preamble];
  while (preamble.length && !noCr(preamble.at(-1)).trim()) preamble.pop();
  const eol = eolOf(live);
  let text = [...preamble, ...(preamble.length ? [""] : []), `Changes through ${prev}: [${archiveName}](${archiveName}).`].join(eol) + eol;
  if (keep.length) text += eol + keep.map((e) => e.lines.join("\n")).join("\n");
  if (!text.endsWith("\n")) text += eol;
  fs.writeFileSync(livePath, text);
  return [`${source}: ${parts.entries.length - keep.length} section(s) of tagged versions moved to the archive, ${keep.length} kept`];
}

/** `roll`: archives, rewrites, and lists what the roll leaves to a reviewer. */
function roll() {
  const version = moduleVersion();
  const prev = opt("--prev") ?? highestTag(version);
  if (!prev) die("no v* tag to roll from — a roll archives what the previous tag shipped");
  try {
    git("rev-parse", "-q", "--verify", `refs/tags/${prev}^{commit}`);
  } catch {
    die(`tag ${prev} does not exist`);
  }

  const atTag = gitZ("ls-tree", "-r", "-z", "--name-only", prev);
  const targets = atTag.filter((f) => f === "CHANGELOG.md" || /^docs\/(?:.+\/)?DECISIONS\.md$/u.test(f)).map((source) => {
    const dir = path.posix.dirname(source);
    const base = path.posix.basename(source, ".md");
    const archiveName = `${base}-through-${prev}.md`;
    return { source, archiveName, archive: dir === "." ? archiveName : `${dir}/${archiveName}`, base, blob: gitBuf("show", `${prev}:${source}`) };
  });

  const conflicts = targets.filter((t) => archiveState(t.archive, prev, t.source) === "conflict");
  if (conflicts.length) die(`archive exists with bytes that differ from ${prev}'s — nothing written:\n  ${conflicts.map((t) => t.archive).join("\n  ")}`);

  console.log(`logs: rolling from ${prev}`);
  for (const t of targets) {
    const state = archiveState(t.archive, prev, t.source);
    if (state === "new") fs.writeFileSync(path.join(ROOT, t.archive), t.blob);
    console.log(`${state === "new" ? "archived" : "archive already in place"}: ${t.archive}`);
    const report = t.base === "CHANGELOG" ? rollChangelog({ ...t, prev }) : rollDecisions({ ...t, prev });
    for (const line of report) console.log(line);
  }

  const stamp = new Date();
  const day = `${stamp.getFullYear()}-${String(stamp.getMonth() + 1).padStart(2, "0")}-${String(stamp.getDate()).padStart(2, "0")}`;
  const roadmaps = atTag.filter((f) => /^docs\/(?:.+\/)?ROADMAP\.md$/u.test(f) && fs.existsSync(path.join(ROOT, f)));
  for (const r of roadmaps) console.log(`re-issue (built rows go, the rest carry, then stamp "Re-issued ${day}."): ${r}`);

  const linkers = [...walk("docs/guides").filter((f) => f.endsWith(".md")), ...(fs.existsSync(path.join(ROOT, "docs/GALLERY.md")) ? ["docs/GALLERY.md"] : [])];
  const linked = linkers.map((f) => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n");
  const releases = fs.existsSync(path.join(ROOT, "docs/releases")) ? fs.readdirSync(path.join(ROOT, "docs/releases"), { withFileTypes: true }).filter((d) => d.isDirectory() && d.name.startsWith("v")) : [];
  for (const d of releases) if (!linked.includes(`releases/${d.name}/`)) console.log(`unlinked shot folder (delete it; the tag keeps it): docs/releases/${d.name}/`);
}

if (command === "compile") compile();
else if (command === "preview") preview();
else if (command === "roll") roll();
else die("usage: node tools/logs.mjs compile|preview [--label \"<text>\"] | roll [--prev v<version>]");
