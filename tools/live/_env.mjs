/**
 * The machine's seats and this repository's paths, for the live walks. Nothing
 * here is a value of its own: the seats come from the environment, which the
 * machine's TEST_ENVIRONMENT.md (LOCAL-ONLY) fills, and the paths are read off
 * the repository the walk runs in. A walk that names a path, a port, a world or
 * a user of its own is wrong; it asks here.
 *
 * Variables:
 *   CAPTURE_BROWSER     the Chromium the driver launches
 *   CAPTURE_ORIGIN      the test server
 *   SEAT_GM, SEAT_PLAYER  the user name of each seat
 *   ACKS_CAPTURE_DRIVER   the capture driver, when it is not the template's
 *                         bin/foundry-capture.mjs beside this repository
 *   ACKS_TEST_BOOKS     a JSON map of book id to the path the Books window
 *                       reads for the GM's own staged copy; absent, no book
 *   ACKS_LIVE_LOGS      where a run's logs go; default aia-tmp/live (ignored)
 *   SHOTS=1             take the release plates
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The repository root, read off this file's location. */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const need = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set: the machine's live-test values are in its TEST_ENVIRONMENT.md`);
  return value;
};

/** The two seats a walk drives: the browser, the server, and each seat's user name. Throws naming the first variable that is missing. */
export function seats() {
  return { browser: need("CAPTURE_BROWSER"), origin: need("CAPTURE_ORIGIN"), gm: need("SEAT_GM"), player: need("SEAT_PLAYER") };
}

/** The CDP port the driver opens for each seat. One browser per seat is why two walks never run at once. */
export const PORTS = { gm: 9483, player: 9484 };

/** The version in module.json, which names the release directory a plate lands in. */
export function version() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "module.json"), "utf8")).version;
}

/** Where a walk's release plates land: `docs/releases/v<version>/`, made on first use, with forward slashes for the driver. */
export function shotDir() {
  const dir = path.join(ROOT, "docs", "releases", `v${version()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir.replaceAll("\\", "/");
}

/** Where a run's logs go, made on first use. Ignored by git: a log holds figures the world imported from a book. */
export function logDir() {
  const dir = process.env.ACKS_LIVE_LOGS ?? path.join(ROOT, "aia-tmp", "live");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * The GM's staged books a walk may connect, for the ids it asks for, as
 * `{id, path}` rows in the order asked. Empty when ACKS_TEST_BOOKS is unset or
 * names none of them: the walk then takes the path that needs no book and says
 * so in a note.
 */
export function books(ids) {
  const raw = process.env.ACKS_TEST_BOOKS;
  if (!raw) return [];
  const map = JSON.parse(raw);
  return ids.filter((id) => typeof map[id] === "string" && map[id]).map((id) => ({ id, path: map[id] }));
}
