/**
 * Stages every piece of repo content the site publishes, then renders the two
 * generated reference pages. Run by `npm run dev` and `npm run build`, so a
 * build can never ship a stale copy.
 *
 * Nothing here authors content. The guides, screenshots and gallery index are
 * copied from `docs/`; the settings and compendium references are derived from
 * the code that registers and builds them. Both generated pages carry a header
 * saying so, and both are gitignored.
 */
import fs from "node:fs";
import path from "node:path";

import { REPO } from "./parse.mjs";
import { extractSettings } from "./extract-settings.mjs";
import { extractPacks } from "./extract-packs.mjs";
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

function renderCompendia(packs) {
  const total = packs.reduce((n, p) => n + p.count, 0);

  const out = [
    "---",
    'title: "Compendia"',
    `description: "What ships in each of the module's compendium packs — items, actors, macros and tables."`,
    "editUrl: false",
    "---",
    "",
    GENERATED("tools/pack-data.mjs and module.json"),
    "",
    `The module ships **${packs.length} compendium packs** holding **${total} documents**. Find them`,
    "in Foundry's **Compendium Packs** sidebar tab.",
    "",
    ":::note",
    "Compendium descriptions are authored restatements with page citations, never transcription.",
    "The module ships no book text.",
    ":::",
    "",
    "| Pack | Type | Documents | Players can see |",
    "|---|---|---|---|",
    ...packs.map(
      (p) =>
        `| ${cell(p.label)} | ${code(p.type)} | ${p.count} | ${p.playerOwnership === "OBSERVER" ? "yes" : cell(p.playerOwnership)} |`,
    ),
    "",
    "## What is in each",
    "",
  ];

  for (const pack of packs) {
    out.push(
      `<details>`,
      `<summary><strong>${pack.label}</strong> — ${pack.count} ${pack.type === "Macro" ? "macros" : pack.type === "RollTable" ? "tables" : pack.type.toLowerCase() + "s"}</summary>`,
      "",
    );
    if (pack.folders.length) out.push(`Delivered in one folder: *${pack.folders.join(", ")}*.`, "");
    for (const doc of pack.documents) {
      const type = doc.type && doc.type !== "script" ? ` *(${doc.type})*` : "";
      out.push(`- **${doc.name}**${type}${doc.summary ? ` — ${doc.summary}` : ""}`);
    }
    out.push("", "</details>", "");
  }

  return out.join("\n");
}

const { guides, gallery } = stageContent();
const settings = extractSettings();
const packs = await extractPacks();

write(path.join(DOCS, "reference", "settings.md"), renderSettings(settings));
write(path.join(DOCS, "reference", "compendia.md"), renderCompendia(packs));

const unresolved = settings.filter((r) => !r.resolved);
if (unresolved.length) {
  console.error(`sync: ${unresolved.length} setting key(s) could not be resolved: ${unresolved.map((r) => r.keyExpr).join(", ")}`);
  process.exitCode = 1;
}

const missingShots = gallery.filter((row) => !fs.existsSync(path.join(SITE, "src", "assets", "shots", row.shot)));
if (missingShots.length) {
  console.error(`sync: GALLERY.md points at ${missingShots.length} missing screenshot(s): ${missingShots.map((r) => r.shot).join(", ")}`);
  process.exitCode = 1;
}

console.log(
  `sync: ${guides.length} guides, ${gallery.length} gallery rows, ${settings.length} settings, ` +
    `${packs.length} packs (${packs.reduce((n, p) => n + p.count, 0)} documents)`,
);
