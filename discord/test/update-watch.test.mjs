import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { judge, readManifest, watchModule } from "../src/update-watch.mjs";

test("the same version, present, is no change", () => {
  const { state, change } = judge({ version: "6.6.0", missing: false }, { version: "6.6.0" });
  assert.equal(change, null);
  assert.deepEqual(state, { version: "6.6.0", missing: false });
});

test("a manifest that vanishes is remembered, not acted on", () => {
  const { state, change } = judge({ version: "6.6.0", missing: false }, null);
  assert.equal(change, null);
  assert.equal(state.missing, true);
});

test("a new version is an update, whether or not the file was seen missing", () => {
  const direct = judge({ version: "6.6.0", missing: false }, { version: "6.7.0" });
  assert.deepEqual(direct.change, { from: "6.6.0", to: "6.7.0", reason: "version" });
  const afterGap = judge({ version: "6.6.0", missing: true }, { version: "6.7.0" });
  assert.equal(afterGap.change.reason, "version");
  assert.equal(afterGap.state.missing, false);
});

test("the same version back after a gap is a replaced directory", () => {
  const { change } = judge({ version: "6.6.0", missing: true }, { version: "6.6.0" });
  assert.deepEqual(change, { from: "6.6.0", to: "6.6.0", reason: "replaced" });
});

test("readManifest answers null for a missing or half-written file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acks-watch-"));
  const file = path.join(dir, "module.json");
  assert.equal(readManifest(file), null);
  fs.writeFileSync(file, "{\"version\": \"6.6");
  assert.equal(readManifest(file), null);
  fs.writeFileSync(file, JSON.stringify({ version: "6.6.0" }));
  assert.deepEqual(readManifest(file), { version: "6.6.0" });
  fs.rmSync(dir, { recursive: true });
});

test("watchModule fires once on a version change and then stops", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acks-watch-"));
  const file = path.join(dir, "module.json");
  fs.writeFileSync(file, JSON.stringify({ version: "1.0.0" }));
  const seen = [];
  const stop = watchModule({ file, intervalMs: 20, onChange: (c) => seen.push(c) });
  fs.rmSync(file);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(seen.length, 0, "a gap alone does not fire");
  fs.writeFileSync(file, JSON.stringify({ version: "1.1.0" }));
  await new Promise((r) => setTimeout(r, 80));
  fs.writeFileSync(file, JSON.stringify({ version: "1.2.0" }));
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(seen.length, 1);
  assert.equal(seen[0].to, "1.1.0");
  stop();
  fs.rmSync(dir, { recursive: true });
});

test("watchModule without a manifest warns and watches nothing", () => {
  const warned = [];
  const stop = watchModule({ file: path.join(os.tmpdir(), "acks-none", "module.json"), onChange: () => {}, log: { warn: (m) => warned.push(m) } });
  assert.equal(warned.length, 1);
  stop();
});
