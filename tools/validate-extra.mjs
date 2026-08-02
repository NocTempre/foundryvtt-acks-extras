/**
 * Module-owned extra validation, run by the canonical tools/validate.mjs:
 * execute the offline flow tests (transfer / deploy / reform / cleanup against
 * mocked Foundry globals) so no release ships with a broken party lifecycle.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
execFileSync(process.execPath, [path.join(HERE, "test-formation-flows.mjs")], { stdio: "inherit" });
