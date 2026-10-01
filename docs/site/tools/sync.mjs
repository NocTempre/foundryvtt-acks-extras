/**
 * Stages every piece of repo content the site publishes, then renders the two
 * generated reference pages. Run by `npm run dev` and `npm run build`, so a
 * build can never ship a stale copy.
 *
 * The guides, screenshots and gallery index are copied from `docs/`; the
 * settings and compendium references are derived from the code that registers,
 * builds and files them. The few words a derived page needs of its own are held
 * beside its extractor (`FEATURE_LABEL`, `BRIEFS`). Both generated pages carry
 * a header saying so, and both are gitignored.
 */
import fs from "node:fs";
import path from "node:path";

import { REPO } from "./parse.mjs";
import { extractSettings } from "./extract-settings.mjs";
import { extractPacks } from "./extract-packs.mjs";
import { extractLibrary } from "./extract-library.mjs";
import { retiredPackNames } from "./pack-names.mjs";
import { stageContent, GENERATED, write } from "./stage-content.mjs";

const SITE = path.resolve(import.meta.dirname, "..");
const DOCS = path.join(SITE, "src", "content", "docs");

/** Escape a value for a markdown table cell. */
const cell = (s) =>
  String(s ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\n+/g, " ")
    .trim();

const code = (s) => `\`${String(s)}\``;

/** A number with its noun, plural unless the number is one. */
const count = (n, noun) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** The guide the compendia reference sends a reader to for the import itself. */
const IMPORT_GUIDE = "importer";

function renderSettings(rows) {
  const configurable = rows.filter((r) => r.config);
  const internal = rows.filter((r) => !r.config);
  const unique = new Set(rows.map((r) => r.key)).size;

  const byFeature = new Map();
  for (const row of configurable) {
    if (!byFeature.has(row.featureLabel)) byFeature.set(row.featureLabel, []);
    byFeature.get(row.featureLabel).push(row);
  }

  const out = [
    "---",
    'title: "Settings"',
    `description: "Every setting ACKS II — Extras registers: what it does, its default, and whether it is world- or client-scoped."`,
    // Derived from registration calls across six source files — there is no one
    // page to edit, so offering an edit link would point somewhere misleading.
    "editUrl: false",
    "---",
    "",
    GENERATED("the game.settings.register() calls in scripts/ and lang/en.json"),
    "",
    `The module registers **${rows.length} settings** under the \`acks-extras\` namespace — ` +
      `${configurable.length} shown in **Settings → Configure Settings → ACKS II — Extras**, and ` +
      `${internal.length} internal ones that persist world state and are not displayed.`,
    "",
    "Nothing here is mandatory. Every feature is opt-in through its own settings, and the",
    "defaults are RAW.",
    "",
    ":::note",
    "**Scope** is `world` (one value for the whole table, GM-set) or `client` (per player,",
    "on their own machine). A setting marked **reload** takes effect after a browser reload,",
    "because what it changes is patched once at startup.",
    ":::",
    "",
  ];

  // A key registered twice is one setting wearing two labels — worth stating on
  // the page, because the settings UI shows only whichever registration ran last.
  const seen = new Map();
  for (const row of rows) seen.set(row.key, [...(seen.get(row.key) ?? []), row]);
  const collisions = [...seen.entries()].filter(([, list]) => list.length > 1);
  if (collisions.length) {
    out.push(
      ":::caution[Registered twice]",
      `${collisions.length === 1 ? "One key is" : `${collisions.length} keys are`} registered by more than one feature. ` +
        "Foundry keeps one entry per key, so these are a single shared toggle and the settings",
      "UI shows whichever registration ran last:",
      "",
      ...collisions.map(([key, list]) => `- ${code(key)} — ${list.map((r) => code(r.source)).join(" and ")}`),
      ":::",
      "",
    );
  }

  for (const [feature, list] of byFeature) {
    out.push(`## ${feature}`, "", "| Setting | What it does | Default |", "|---|---|---|");
    for (const row of list) {
      const meta = [code(row.scope), row.requiresReload ? "**reload**" : null].filter(Boolean).join(" · ");
      const name = `**${cell(row.name ?? row.key)}**<br />${code(row.key)}<br />${meta}`;

      const detail = [cell(row.hint ?? "")];
      if (row.choices.length) {
        detail.push(`<br />*Options:* ${row.choices.map((c) => `${code(c.value)} ${cell(c.label)}`).join(" · ")}`);
      }
      if (row.range) detail.push(`<br />*Range:* ${cell(row.range)}`);

      out.push(`| ${name} | ${detail.join(" ")} | ${code(row.default === "" ? "—" : row.default)} |`);
    }
    out.push("");
  }

  out.push(
    "## Internal state",
    "",
    "Registered but never shown — these are how the module persists world state between",
    "sessions. They are listed for completeness; there is nothing to configure.",
    "",
    "| Key | Type | Holds |",
    "|---|---|---|",
    ...internal.map((r) => `| ${code(r.key)} | ${code(r.type)} | ${cell(r.featureLabel)} — ${code(r.source)} |`),
    "",
    `*${rows.length} registrations across ${unique} distinct keys, read from ${new Set(rows.map((r) => r.source)).size} source files.*`,
    "",
  );

  return out.join("\n");
}

function renderCompendia(packs, library) {
  const total = packs.reduce((n, p) => n + p.count, 0);

  const out = [
    "---",
    'title: "Compendia"',
    `description: "Every compendium pack the module ships, and the compendiums an import from your own books leaves in a world."`,
    "editUrl: false",
    "---",
    "",
    GENERATED("tools/pack-data.mjs, module.json and the importer's shelf code in scripts/"),
    "",
    `The module ships **${count(packs.length, "compendium pack")}** holding **${count(total, "document")}**, and no library:`,
    `an [import from the Judge's own books](../../guides/${IMPORT_GUIDE}/) builds that in each world. Both are listed`,
    "here, and both are found in Foundry's **Compendium Packs** sidebar tab.",
    "",
    ":::note",
    "The module ships no book text.",
    ":::",
    "",
    "## Shipped with the module",
    "",
    "| Pack | Type | Documents | Players can see |",
    "|---|---|---|---|",
    ...packs.map(
      (p) =>
        `| ${cell(p.label)} | ${code(p.type)} | ${p.count} | ${p.playerOwnership === "OBSERVER" ? "yes" : cell(p.playerOwnership)} |`,
    ),
    "",
    "### What is in each",
    "",
  ];

  for (const pack of packs) {
    out.push(
      `<details>`,
      `<summary><strong>${pack.label}</strong> — ${count(pack.count, pack.type === "RollTable" ? "table" : pack.type.toLowerCase())}</summary>`,
      "",
    );
    if (pack.folders.length) out.push(`Filed in ${count(pack.folders.length, "folder")}: *${pack.folders.join(", ")}*.`, "");
    for (const doc of pack.documents) {
      const type = doc.type && doc.type !== "script" ? ` *(${doc.type})*` : "";
      out.push(`- **${doc.name}**${type}${doc.summary ? ` — ${doc.summary}` : ""}`);
    }
    out.push("", "</details>", "");
  }

  out.push(
    "## Left by an import",
    "",
    "An import creates these in the world, each the first time a book fills it, and files them under",
    `*${library.folder.join(" › ")}*. A world holds only the ones its books fill.`,
    "",
    "| Compendium | Type | What it is |",
    "|---|---|---|",
    // A type no shipped book fills yet has no compendium to name.
    ...library.shelves
      .filter((shelf) => shelf.labels.length)
      .map((shelf) => {
        const shelves = shelf.shelves.length ? `<br />*Shelves:* ${shelf.shelves.map(cell).join(" · ")}` : "";
        return `| ${shelf.labels.map(cell).join("<br />")} | ${code(shelf.type)} | ${cell(shelf.brief)}${shelves} |`;
      }),
    "",
    "### A set of its own",
    "",
    "Two kinds of book fill compendiums of the same types under a longer name:",
    "",
    `- **A book the module knows to be the Judge's alone**, an adventure or a gazetteer: ${code(library.judge.label)}, and so on for each type.` +
      (library.judge.closed ? " No player seat can see these compendiums or open a document in them." : ""),
    `- **Another game's book**: ${code(library.series.label)}, named for the series it belongs to, or ` +
      `${code(library.series.unnamed)} when it was registered with none. Where both apply the name carries both: ${code(library.series.judge)}.`,
    "",
  );

  return out.join("\n");
}

const { guides, gallery } = stageContent();
const settings = extractSettings();
const packs = await extractPacks();
const library = await extractLibrary();

write(path.join(DOCS, "reference", "settings.md"), renderSettings(settings));
write(path.join(DOCS, "reference", "compendia.md"), renderCompendia(packs, library));

// Counts the hand-authored pages quote. Prose that states "44 settings" is the
// second place a fact is stated, and it drifts the moment a feature registers
// one more — index.mdx reads these instead of carrying its own number.
write(
  path.join(SITE, "src", "data", "counts.json"),
  JSON.stringify(
    {
      settings: settings.length,
      guides: guides.length,
      packs: packs.length,
      documents: packs.reduce((n, p) => n + p.count, 0),
    },
    null,
    2,
  ) + "\n",
);

// A staged guide with no sidebar entry still builds and still answers search,
// so it ships as a page nothing links to. Compare the two lists rather than
// trusting either.
const sidebarGuides = new Set(
  [...fs.readFileSync(path.join(SITE, "astro.config.mjs"), "utf8").matchAll(/slug: "guides\/([\w-]+)"/g)].map((m) => m[1]),
);
const stagedGuides = guides.map((g) => g.slug);
const unlinked = stagedGuides.filter((slug) => !sidebarGuides.has(slug));
const dangling = [...sidebarGuides].filter((slug) => !stagedGuides.includes(slug));
if (unlinked.length || dangling.length) {
  if (unlinked.length) console.error(`sync: guide(s) staged but absent from the sidebar in astro.config.mjs: ${unlinked.join(", ")}`);
  if (dangling.length) console.error(`sync: sidebar names guide(s) that docs/guides/ does not have: ${dangling.join(", ")}`);
  process.exitCode = 1;
}

// A link to a guide that is not there was re-pointed with the rest, at a route
// the build never emits, and Astro does not follow links to find out.
const deadLinks = guides.flatMap((g) => g.links.filter((to) => !stagedGuides.includes(to)).map((to) => `${g.slug}.md -> ${to}.md`));
if (deadLinks.length) {
  console.error(`sync: ${deadLinks.length} guide link(s) name a guide that docs/guides/ does not have: ${deadLinks.join(", ")}`);
  process.exitCode = 1;
}

const unresolved = settings.filter((r) => !r.resolved);
if (unresolved.length) {
  console.error(`sync: ${unresolved.length} setting key(s) could not be resolved: ${unresolved.map((r) => r.keyExpr).join(", ")}`);
  process.exitCode = 1;
}

// A feature the extractor's lists omit still renders, under its directory name
// or ahead of every listed section, so nothing on the page reports it.
const unlisted = [...new Set(settings.filter((r) => !r.featureListed).map((r) => r.feature))];
if (unlisted.length) {
  console.error(`sync: feature(s) register a setting but are absent from FEATURE_ORDER or FEATURE_LABEL in extract-settings.mjs: ${unlisted.join(", ")}`);
  process.exitCode = 1;
}

const missingShots = gallery.filter((row) => !fs.existsSync(path.join(SITE, "src", "assets", "shots", row.shot)));
if (missingShots.length) {
  console.error(`sync: GALLERY.md points at ${missingShots.length} missing screenshot(s): ${missingShots.map((r) => r.shot).join(", ")}`);
  process.exitCode = 1;
}

// A compendium type with no brief publishes a row that says nothing; a brief
// for a type the importer dropped is prose no page prints.
if (library.unbriefed.length) {
  console.error(`sync: the importer keeps a compendium for type(s) BRIEFS in extract-library.mjs does not describe: ${library.unbriefed.join(", ")}`);
  process.exitCode = 1;
}
if (library.untyped.length) {
  console.error(`sync: BRIEFS in extract-library.mjs describes type(s) the importer keeps no compendium for: ${library.untyped.join(", ")}`);
  process.exitCode = 1;
}

// The compendia reference links a guide from generated prose, which the guide
// links checked above do not include.
if (!stagedGuides.includes(IMPORT_GUIDE)) {
  console.error(`sync: the compendia reference links guides/${IMPORT_GUIDE}, which docs/guides/ does not have`);
  process.exitCode = 1;
}

// A pack's name outlives the pack in prose that nothing regenerates.
const retired = retiredPackNames(packs.map((p) => p.label));
if (retired.findings.length) {
  const where = retired.findings.map(
    (f) => `${f.file}:${f.line} "${f.name}" (${f.removedIn ? `dropped in ${f.removedIn}` : "dropped in the working tree"})`,
  );
  console.error(`sync: ${count(where.length, "mention")} of a compendium pack module.json no longer declares: ${where.join(", ")}`);
  process.exitCode = 1;
}
if (retired.note) console.log(`sync: note: ${retired.note}`);

console.log(
  `sync: ${guides.length} guides, ${gallery.length} gallery rows, ${settings.length} settings, ` +
    `${packs.length} packs (${packs.reduce((n, p) => n + p.count, 0)} documents)`,
);
