/**
 * What ships in each compendium, read from the generator that builds them.
 *
 * `tools/pack-data.mjs` is the source of truth for pack content (the compiled
 * `packs/` are build output and `packs/_source` is rewritten from it), so the
 * published contents list is generated from the same call the build makes.
 * Nothing here restates a count that could fall out of step with the packs.
 */
import fs from "node:fs";
import path from "node:path";

import { REPO } from "./parse.mjs";

/** Compendium folders travel in the same array as documents, keyed `!folders!`. */
const isFolder = (doc) => String(doc?._key ?? "").startsWith("!folders!");

/** Strip enriched HTML down to a one-line plain-text summary. */
function plain(html, limit = 180) {
  const text = String(html ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= limit) return text;
  return text.slice(0, text.lastIndexOf(" ", limit)).trimEnd() + "…";
}

export async function extractPacks() {
  const { packs } = await import(new URL("../../../tools/pack-data.mjs", import.meta.url));
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO, "module.json"), "utf8"));

  return manifest.packs.map((declared) => {
    const build = packs[declared.name];
    const all = typeof build === "function" ? build() : [];
    const documents = all.filter((doc) => !isFolder(doc));
    const folders = all.filter(isFolder);

    return {
      name: declared.name,
      label: declared.label,
      type: declared.type,
      // The declared player ownership, which decides whether a table can open
      // the pack at all — worth publishing next to the contents.
      playerOwnership: declared.ownership?.PLAYER ?? "inherited",
      count: documents.length,
      folders: folders.map((f) => f.name),
      documents: documents
        .map((doc) => ({
          name: doc.name,
          type: doc.type ?? null,
          summary: plain(doc.system?.description ?? doc.description ?? ""),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  });
}
