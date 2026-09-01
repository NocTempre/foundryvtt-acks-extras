/**
 * Importer-subsystem extra validation, delegated to by the repo's own
 * tools/validate-extra.mjs so `npm run validate` also enforces the checks
 * specific to the importer. Inline checks first, then the delegated tools.
 * Exit non-zero on failure.
 *
 *   stale identity      The importer subsystem carries two retired ids: it
 *                       was created from acks-content (rename was once
 *                       id-and-title only), and it shipped as the standalone
 *                       module acks-importer until the 2026-09 merge into
 *                       acks-extras. Every acks-content / acksContent /
 *                       ACKS-CONTENT / acks-importer / acksImporter survivor
 *                       in code is a silent no-op (a lang key that resolves
 *                       to nothing, a CSS class no selector matches, a global
 *                       that does not exist). History files may narrate the
 *                       old names.
 *   icon existence      img/icon path literals must resolve — module paths
 *                       in-repo, core/system paths against a discoverable
 *                       install/checkout, with a skip notice when absent.
 *   lint-register       IP + schema lint of register/ and cookbook/. No PDFs,
 *                       runs everywhere including CI (`npm run lint:register`).
 *   icon-ledger         Ratchet: no entry may lose its icon and no kind may
 *                       gain an unplaced one (`npm run icons`).
 *   check-prose-boxes    Does each definition's description come from the
 *                       column its own heading starts? Pure geometry, no PDFs.
 *   check-cookbook-drift  Is the committed cookbook/ what register/ compiles
 *                       to? Needs the local reference PDFs and skips cleanly
 *                       without them, so it gates the authoring machines only.
 *
 * Cheapest and most universal first: a register that fails its lint should say
 * so in a second, not after a 40s recompile.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const ROOT = path.dirname(path.dirname(path.dirname(url.fileURLToPath(import.meta.url))));
let failed = false;
const fail = (msg) => {
  console.error(`FAIL validate-extra: ${msg}`);
  failed = true;
};
const walk = (d) =>
  fs.existsSync(d)
    ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]
      )
    : [];
const rel = (f) => path.relative(ROOT, f).split(path.sep).join("/");

/* 1. No stale pre-rename identity in code. Self-exempt (this regex), the
 * legacy shim and the post-merge cleaner name the retired ids by design, and
 * CHANGELOG/docs may narrate the old names as history. */
{
  const STALE = /acks-content|acksContent|ACKS-CONTENT|acks-importer|acksImporter/;
  const SELF = new Set([
    "tools/importer/validate-extra.mjs",
    "scripts/importer/legacy.mjs",
    "scripts/importer/migrate.mjs",
    "tools/pack-data/cleanup.mjs",
    // Generated FROM the entry above — same "names the old ids by design".
    "packs/_source/macros/clean-up-after-the-merge-gm.json",
  ]);
  for (const dir of ["scripts", "styles", "lang", "tools", "register", "cookbook", "packs/_source"]) {
    for (const f of walk(path.join(ROOT, dir))) {
      if (!/\.(mjs|css|json|hbs)$/.test(f)) continue;
      if (SELF.has(rel(f))) continue;
      fs.readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (STALE.test(line)) fail(`${rel(f)}:${i + 1} still carries the pre-rename identity — ${line.trim().slice(0, 90)}`);
      });
    }
  }
}

/* 2. Icon paths resolve (same contract as acks-extras' validate-extra §6). */
{
  const FOUNDRY_PUBLIC = [
    "C:/Program Files/Foundry Virtual Tabletop/resources/app/public",
  ].find((p) => fs.existsSync(path.join(p, "icons")));
  const SYSTEM_SRC = [path.join(ROOT, "..", "foundryvtt-acks-core", "src")].find((p) =>
    fs.existsSync(path.join(p, "assets"))
  );
  const skipped = new Set();
  const seen = new Set();
  for (const dir of ["tools/importer", "scripts/importer", "register"]) {
    for (const f of walk(path.join(ROOT, dir))) {
      if (!/\.(mjs|json)$/.test(f)) continue;
      const text = fs.readFileSync(f, "utf8");
      for (const m of text.matchAll(/["'`]((?:icons|systems|modules)\/[^"'`\n${]+\.(?:svg|webp|png|jpg|jpeg))["'`]/g)) {
        const p = m[1];
        if (seen.has(p)) continue;
        seen.add(p);
        let resolved;
        if (p.startsWith("modules/acks-extras/")) resolved = path.join(ROOT, p.replace("modules/acks-extras/", ""));
        else if (p.startsWith("icons/")) resolved = FOUNDRY_PUBLIC ? path.join(FOUNDRY_PUBLIC, p) : null;
        else if (p.startsWith("systems/acks/")) resolved = SYSTEM_SRC ? path.join(SYSTEM_SRC, p.replace("systems/acks/", "")) : null;
        else continue; // another module's path (e.g. game-icons-net) — optional by design
        if (resolved === null) {
          skipped.add(p.split("/")[0]);
          continue;
        }
        if (!fs.existsSync(resolved)) fail(`${rel(f)}: icon path does not exist — ${p}`);
      }
    }
  }
  if (skipped.size) console.log(`validate-extra: icon check skipped for ${[...skipped].join(", ")} paths (no install/checkout found)`);
}

/* 3. The OSE converter carries no printed constant.
 *
 * Its whole arrangement is that the System Compatibility Guide's numbers
 * arrive as arguments, read from the reader's own copy. A gate that listed the
 * forbidden values would write them down in a tracked file and so defeat
 * itself; this is an ALLOW list instead. Every numeric literal in the module
 * must be one of a few structural ones, each justified here — anything else is
 * a value that belongs in the `constants` argument.
 *
 *   0, 1  identities, counters, indexes, and the floor of a count
 *   2, 6  the OSE morale die (2d6) — the dice, not a printed table
 *   4, 8  hit-die sides; both systems roll d8 per hit die and d4 below one
 */
{
  const ALLOWED = new Set([0, 1, 2, 4, 6, 8]);
  const f = path.join(ROOT, "scripts", "importer", "ose-convert.mjs");
  if (fs.existsSync(f)) {
    // Comments, strings and REGEX LITERALS are not numeric literals — a
    // character class like [^a-z0-9] is spelling, not a value.
    const bare = fs
      .readFileSync(f, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:/])\/\/[^\n]*/g, "$1 ")
      .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""')
      .replace(/([(=,:[!&|?+\s])\/(?:[^/\\\n[]|\\.|\[(?:[^\]\\\n]|\\.)*\])+\/[gimsuy]*/g, "$1RE");
    for (const m of bare.matchAll(/\b\d+(?:\.\d+)?\b/g)) {
      if (!ALLOWED.has(Number(m[0]))) {
        fail(`scripts/importer/ose-convert.mjs carries the literal ${m[0]} — a printed constant belongs in the \`constants\` argument, not the converter`);
      }
    }
  }
}

if (failed) {
  console.error("validate-extra: inline guards FAILED");
  process.exit(1);
}

// Re-exec so each check's own output surfaces and its non-zero exit propagates
// (execFileSync throws, this process exits non-zero). Sequential and
// fail-fast: a drift report is noise while the register itself is broken.
for (const [tool, ...args] of [["lint-register.mjs"], ["icon-ledger.mjs", "--check"], ["test-ose-statline.mjs"], ["test-ose-convert.mjs"], ["test-ose-blocks.mjs"], ["test-ose-binding.mjs"], ["test-ose-template.mjs"], ["test-ose-location.mjs"], ["test-ose-manual.mjs"], ["test-ose-lang.mjs"], ["audit-transcription.mjs"], ["check-prose-boxes.mjs"], ["check-cookbook-drift.mjs"]]) {
  execFileSync(process.execPath, [path.join(ROOT, "tools", "importer", tool), ...args], { stdio: "inherit" });
}
