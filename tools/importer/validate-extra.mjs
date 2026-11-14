/**
 * Importer-subsystem extra validation, delegated to by the repo's own
 * tools/validate-extra.mjs so `npm run validate` also enforces the checks
 * specific to the importer. Inline checks first, then the delegated tools.
 * Exit non-zero on failure.
 *
 *   stale identity      Two ids name no module in this repo. Every acks-content
 *                       / acksContent / ACKS-CONTENT / acks-importer /
 *                       acksImporter in code is a silent no-op (a lang key
 *                       that resolves to nothing, a CSS class no selector
 *                       matches, a global that does not exist).
 *   icon existence      img/icon path literals must resolve — module paths
 *                       in-repo, core/system paths against a discoverable
 *                       install/checkout, with a skip notice when absent. A
 *                       core path the install aliases resolves as its file.
 *   lint-register       IP + schema lint of register/ and cookbook/. No PDFs,
 *                       runs everywhere including CI (`npm run lint:register`).
 *   icon-ledger         Ratchet: no entry may lose its icon and no kind may
 *                       gain an unplaced one (`npm run icons`).
 *   check-prose-boxes    Does each definition's description come from the
 *                       column its own heading starts? Pure geometry, no PDFs.
 *   check-prose-stops   Does each description STOP where the passage stops, or
 *                       mid-sentence? Reads the page below the box, so it needs
 *                       the PDFs and skips without them; ratchets on a ledger.
 *   check-cookbook-drift  Is the committed cookbook/ what register/ compiles
 *                       to? Needs the local reference PDFs and skips cleanly
 *                       without them, so it gates the authoring machines only.
 *   check-encounter-grids  Do the encounter grids read whole off the book —
 *                       every cell one name, every band tiling its die? Needs
 *                       the PDFs and skips without them, like the drift check.
 *   check-market-classes  Does each domain record read the class of the grid
 *                       row it names, or declare the misprint it reads past?
 *                       Needs the PDFs and skips without them.
 *
 * Cheapest and most universal first: a register that fails its lint should say
 * so in a second, not after a 40s recompile.
 */
import { execFileSync } from "node:child_process";
import { sideBySide } from "../side-by-side.mjs";
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

/* 1. No stale identity in code. The files that hold the id list as data (this
 * regex, the cleaner and the repair scan) are exempt, and the changelog and
 * docs are not scanned. */
{
  const STALE = /acks-content|acksContent|ACKS-CONTENT|acks-importer|acksImporter/;
  const SELF = new Set([
    "tools/importer/validate-extra.mjs",
    "tools/pack-data/cleanup.mjs",
    // Generated from the entry above; it holds the same id list as data.
    "packs/_source/macros/clean-up-after-the-merge-gm.json",
    // The repair tool's residue scan: the cleaner's walk, in module code.
    "scripts/lib/repair-checks.mjs",
  ]);
  for (const dir of ["scripts", "styles", "lang", "tools", "register", "cookbook", "packs/_source"]) {
    for (const f of walk(path.join(ROOT, dir))) {
      if (!/\.(mjs|css|json|hbs)$/.test(f)) continue;
      if (SELF.has(rel(f))) continue;
      fs.readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (STALE.test(line)) fail(`${rel(f)}:${i + 1} carries an id that names no module here —${line.trim().slice(0, 90)}`);
      });
    }
  }
}

/* 2. Icon paths resolve. A core build that renames an icon keeps answering
 * for the old path: its server holds STATIC_FILE_ALIASES and serves each key
 * from the file it maps to. A path the install aliases resolves where that
 * file exists, and is never rewritten to the new name: on a build from before
 * the rename the old path is the file and the new one is nothing. */
{
  const FOUNDRY_PUBLIC = [
    "C:/Program Files/Foundry Virtual Tabletop/resources/app/public",
  ].find((p) => fs.existsSync(path.join(p, "icons")));
  /** The install's aliases, old path to the path it is served from; none where the build keeps no list. */
  const aliases = (() => {
    try {
      const constants = fs.readFileSync(path.join(FOUNDRY_PUBLIC, "..", "dist", "server", "constants.mjs"), "utf8");
      return JSON.parse(constants.match(/STATIC_FILE_ALIASES\s*=\s*(\{[^}]*\})/)[1]);
    } catch {
      return {};
    }
  })();
  const aliased = new Set();
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
        if (fs.existsSync(resolved)) continue;
        if (p.startsWith("icons/") && Object.hasOwn(aliases, p) && fs.existsSync(path.join(FOUNDRY_PUBLIC, aliases[p]))) aliased.add(p);
        else fail(`${rel(f)}: icon path does not exist — ${p}`);
      }
    }
  }
  if (skipped.size) console.log(`validate-extra: icon check skipped for ${[...skipped].join(", ")} paths (no install/checkout found)`);
  if (aliased.size) console.log(`validate-extra: ${aliased.size} icon path(s) the install serves from a renamed file, kept as written: ${[...aliased].join(", ")}`);
}

if (failed) {
  console.error("validate-extra: inline guards FAILED");
  process.exit(1);
}

// Re-exec so each check's own output surfaces and its non-zero exit
// propagates. The register lint runs first and alone (execFileSync throws,
// this process exits non-zero): a drift report is noise while the register
// itself is broken. The checks after it read the register and write nothing
// the others read, so they run side by side, each to its end.
const importerTool = ([tool, ...args]) => [path.join(ROOT, "tools", "importer", tool), ...args];
execFileSync(process.execPath, importerTool(["lint-register.mjs"]), { stdio: "inherit" });
const checks = await sideBySide([["icon-ledger.mjs", "--check"], ["audit-transcription.mjs"], ["check-prose-boxes.mjs"], ["check-prose-stops.mjs"], ["check-cookbook-drift.mjs"], ["check-encounter-grids.mjs"], ["check-market-classes.mjs"]].map(importerTool));
if (checks.some((check) => check.status !== 0)) {
  console.error(`validate-extra: FAILED — ${checks.filter((check) => check.status !== 0).map((check) => path.basename(check.args[0])).join(", ")}`);
  process.exit(1);
}
