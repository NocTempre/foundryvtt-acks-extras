/**
 * Runs before the bot starts — `ExecStartPre` in the unit, `prestart` for
 * `npm start` — and reinstalls dependencies only when the install under this
 * directory is missing, incomplete, or older than `package-lock.json`.
 * Foundry's updater replaces the module directory whole, `node_modules`
 * included: the restart that follows finds it gone and puts it back, and
 * every other restart costs a stat call.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isMain } from "./entry.mjs";

/** Why an install is needed, or null. Pure over two mtimes and the presence of the runtime dependency. */
export function installReason({ lockMtime, installedMtime, hasDependency }) {
  if (installedMtime == null) return "node_modules is missing";
  if (!hasDependency) return "discord.js is not installed";
  if (lockMtime != null && lockMtime > installedMtime) return "package-lock.json is newer than the install";
  return null;
}

/** The npm beside this node, or the one on PATH. */
export function npmCommand() {
  const name = process.platform === "win32" ? "npm.cmd" : "npm";
  const beside = path.join(path.dirname(process.execPath), name);
  return fs.existsSync(beside) ? beside : name;
}

const mtime = (p) => {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return null;
  }
};

if (isMain(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const reason = installReason({
    lockMtime: mtime(path.join(root, "package-lock.json")),
    installedMtime: mtime(path.join(root, "node_modules", ".package-lock.json")),
    hasDependency: fs.existsSync(path.join(root, "node_modules", "discord.js", "package.json")),
  });
  if (!reason) {
    console.log("prestart: dependencies are in place");
  } else {
    console.log(`prestart: ${reason}; running npm ci`);
    execFileSync(npmCommand(), ["ci", "--omit=dev", "--no-audit", "--no-fund"], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  }
}
