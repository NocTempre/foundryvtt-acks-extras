/**
 * The capture driver, resolved once for every walk: ACKS_CAPTURE_DRIVER names
 * it, or it is `_capture.mjs` beside this file.
 * A walk imports `connect` and the rest from here and never from a path of its
 * own, so the one machine fact the driver's location is lives in one place.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "./_env.mjs";

const file = process.env.ACKS_CAPTURE_DRIVER ?? path.resolve(ROOT, "tools", "live", "_capture.mjs");
if (!fs.existsSync(file)) throw new Error(`capture driver not found at ${file}: set ACKS_CAPTURE_DRIVER to a capture driver`);

const driver = await import(pathToFileURL(file).href);

/** The driver's surface, re-exported: `connect` opens a seat; `sleep` waits; the rest are the driver's helpers for ledgers, stray pages and the raw CDP session. */
export const { connect, sleep, Cdp, pageSweep, fixtureLedger, strayPages, pageKeeper } = driver;
