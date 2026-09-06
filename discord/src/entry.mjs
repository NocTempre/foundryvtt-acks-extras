/**
 * Whether a module is the script Node was started with. Files that export
 * pure helpers and also run as commands guard their command half with it, so
 * a test can import the helpers without running the command.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

export function isMain(url) {
  if (!process.argv[1]) return false;
  const a = path.resolve(process.argv[1]);
  const b = fileURLToPath(url);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}
