/**
 * Canonical compendium-pack builder.
 * Synced from acks-module-template — edit there and run bin/sync-toolchain.mjs.
 *
 * Document content lives in the module-owned tools/pack-data.mjs, which exports
 *   export const packs = { "<pack-name>": () => [documents...] };
 * (values may be arrays or zero-arg functions; large data may live in sibling
 * files re-exported through the map).
 *
 * For each pack: writes one JSON file per document to packs/_source/<pack>/
 * and compiles a Foundry LevelDB pack at packs/<pack>/ with the official
 * Foundry CLI. Packs with zero documents are skipped — declare a pack in
 * module.json only once it has content, so the release workflow's
 * "verify every declared pack exists" step only sees populated packs.
 *
 * Usage:  npm install && npm run build:packs
 */
import { compilePack } from "@foundryvtt/foundryvtt-cli";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { packs } from "./pack-data.mjs";

const ROOT = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));

async function buildPack(packName, docs) {
  if (!docs.length) {
    console.log(`Skipped empty pack "${packName}" (no documents yet).`);
    return;
  }
  const srcDir = path.join(ROOT, "packs", "_source", packName);
  const dbDir = path.join(ROOT, "packs", packName);

  fs.mkdirSync(srcDir, { recursive: true });
  for (const f of fs.readdirSync(srcDir).filter((f) => f.endsWith(".json"))) fs.rmSync(path.join(srcDir, f));
  for (const doc of docs) {
    const slug = doc.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    fs.writeFileSync(path.join(srcDir, `${slug}.json`), JSON.stringify(doc, null, 2) + "\n");
  }

  fs.rmSync(dbDir, { recursive: true, force: true });
  await compilePack(srcDir, dbDir, { recursive: false, log: false });
  console.log(`Built pack "${packName}": ${docs.length} document(s) -> ${dbDir}`);
}

for (const [name, build] of Object.entries(packs)) {
  await buildPack(name, typeof build === "function" ? build() : build);
}
