/**
 * The cookbook's source text as one string: the facade and every file under
 * `scripts/importer/cookbook/`, for the suites that pin what the source says
 * rather than what it loads.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "importer");

/** Returns the facade's text followed by each cookbook file's, in file-name order. */
export const cookbookSource = () => [
  path.join(dir, "cookbook.mjs"),
  ...fs.readdirSync(path.join(dir, "cookbook")).sort().map((f) => path.join(dir, "cookbook", f)),
].map((f) => fs.readFileSync(f, "utf8")).join("\n");
