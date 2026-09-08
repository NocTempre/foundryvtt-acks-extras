import { test } from "node:test";
import assert from "node:assert";
import { EventEmitter } from "node:events";
import { Cdp, reconnectDelay, browserArgs } from "../src/seat.mjs";
import { Bridge, BridgeRefusal } from "../src/bridge.mjs";

/** A WebSocket stand-in: EventTarget-ish, records what was sent, lets a test answer. */
class FakeWs extends EventTarget {
  sent = [];
  send(text) {
    this.sent.push(JSON.parse(text));
  }
  answer(id, result) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ id, result }) }));
  }
  fail(id, message) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ id, error: { message, code: -1 } }) }));
  }
  event(method, params, sessionId) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ method, params, sessionId }) }));
  }
  close() {
    this.dispatchEvent(new Event("close"));
  }
}

test("a request resolves with its result and rejects with its error, by id", async () => {
  const ws = new FakeWs();
  const cdp = new Cdp(ws, { timeout: 1000 });
  const p1 = cdp.send("Runtime.evaluate", { expression: "1" }, "s1");
  const p2 = cdp.send("Page.enable");
  assert.equal(ws.sent[0].sessionId, "s1");
  assert.equal(ws.sent[1].sessionId, undefined);
  ws.answer(2, { ok: true });
  ws.fail(1, "nope");
  assert.deepEqual(await p2, { ok: true });
  await assert.rejects(p1, /nope/);
});

test("events dispatch by method with params and session; a closed socket rejects what is pending", async () => {
  const ws = new FakeWs();
  const cdp = new Cdp(ws, { timeout: 1000 });
  const heard = [];
  cdp.on("Runtime.bindingCalled", (params, sid) => heard.push({ params, sid }));
  ws.event("Runtime.bindingCalled", { name: "x", payload: "{}" }, "s1");
  assert.deepEqual(heard, [{ params: { name: "x", payload: "{}" }, sid: "s1" }]);
  const pending = cdp.send("Runtime.evaluate", {});
  ws.close();
  await assert.rejects(pending, /closed/);
});

test("a request times out rather than hanging", async () => {
  const ws = new FakeWs();
  const cdp = new Cdp(ws, { timeout: 20 });
  await assert.rejects(cdp.send("Slow.thing"), /timeout: Slow.thing/);
});

test("reconnect backoff doubles from five seconds and caps at a minute", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map(reconnectDelay), [5000, 10000, 20000, 40000, 60000, 60000, 60000]);
});

test("the browser gets a profile, a port, a size above Foundry's floor and the operator's extras", () => {
  const args = browserArgs({ port: 9334, profile: "/tmp/p", width: 1600, height: 1000, extra: ["--x"] });
  assert.ok(args.includes("--headless=new"));
  assert.ok(args.includes("--remote-debugging-port=9334"));
  assert.ok(args.includes("--user-data-dir=/tmp/p"));
  assert.ok(args.includes("--window-size=1600,1000"));
  assert.ok(args.includes("--x"));
  assert.equal(args.at(-1), "about:blank");
});

test("a seat is told there is no GPU unless it was given one", () => {
  const off = browserArgs({ port: 9334, profile: "/tmp/p", width: 1600, height: 1000 });
  assert.ok(off.includes("--disable-gpu"), "the default seat draws nothing it does not have to");
  const on = browserArgs({ port: 9334, profile: "/tmp/p", width: 1600, height: 1000, gpu: true });
  assert.ok(!on.includes("--disable-gpu"), "a seat given a GPU is allowed to use it");
});

test("the bridge client serialises calls, unwraps data and turns a refusal into an error", async () => {
  const seat = new EventEmitter();
  const log = [];
  let n = 0;
  seat.eval = async (expr) => {
    const me = ++n;
    log.push(`start ${me}`);
    await new Promise((r) => setTimeout(r, me === 1 ? 30 : 1));
    log.push(`end ${me}`);
    if (expr.includes('"refuse"')) return JSON.stringify({ ok: false, code: "forbidden", message: "no" });
    return JSON.stringify({ ok: true, data: { echo: JSON.parse(expr.match(/run\("[^"]+", (.*)\)\)\)\(\)$/)[1]) } });
  };
  const bridge = new Bridge(seat);
  const a = bridge.run("first", { x: 1 });
  const b = bridge.run("second", { y: 2 });
  const c = bridge.run("refuse");
  assert.deepEqual((await a).echo, { x: 1 });
  assert.deepEqual((await b).echo, { y: 2 });
  await assert.rejects(c, (e) => e instanceof BridgeRefusal && e.code === "forbidden");
  assert.deepEqual(log, ["start 1", "end 1", "start 2", "end 2", "start 3", "end 3"], "one call at a time, in order");
  const after = await bridge.run("after");
  assert.deepEqual(after.echo, {}, "the queue survives a refusal");
});
