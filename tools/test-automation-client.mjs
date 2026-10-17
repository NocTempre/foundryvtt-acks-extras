/**
 * Offline tests for the seat election (scripts/lib/automation-client-logic.mjs,
 * scripts/lib/automation-client.mjs, the gate in scripts/lib/sockets.mjs) and
 * the rule that every GM-side gate goes through `isPrimaryGM`.
 *
 * The windows of one seat sit behind a simulated server that handles messages
 * one at a time and delivers each to every connected window of the seat, in
 * its order of handling, with its own latency per window — the shape of
 * Foundry's `handleCustomSocket` with `recipients`. Document events ride the
 * same order. The property under test: for every event, at most one window
 * leads when it reads the event, whatever joins, closes, crashes, freezes,
 * drops its connection or throttles its timers; and once the faults stop, one
 * window leads and every window agrees which.
 *
 * Run: node tools/test-automation-client.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSeatElection, SEAT_TIMINGS } from "../scripts/lib/automation-client-logic.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

let failed = 0;
let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`ok   ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL ${name}\n     ${err?.stack ?? err}`);
  }
}

/* -------------------------------------------- */
/*  The simulated seat                          */
/* -------------------------------------------- */

/** A seeded PRNG, so a failing interleaving can be replayed. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * One seat's windows behind one server. Time is simulated milliseconds; every
 * delivery to a window keeps that window's arrival order equal to the server's
 * handling order.
 */
function makeSeat(seed = 1, { latency = [5, 60], throttle = 0 } = {}) {
  const rand = prng(seed);
  const between = ([lo, hi]) => lo + Math.floor(rand() * (hi - lo + 1));
  let now = 0;
  let seq = 0;
  const queue = [];
  const windows = [];
  const events = [];
  let eventCount = 0;

  const at = (t, run) => {
    const item = { at: t, seq: ++seq, run, live: true };
    queue.push(item);
    return item;
  };

  function runUntil(t) {
    for (;;) {
      queue.sort((a, b) => a.at - b.at || a.seq - b.seq);
      const next = queue[0];
      if (!next || next.at > t) break;
      queue.shift();
      now = next.at;
      if (next.live) next.run();
    }
    now = t;
  }

  /** The server handles one message: to every connected window, in order. */
  function handle(message) {
    if (message.kind === "event") events[message.n] = [];
    for (const w of windows) {
      if (!w.alive || !w.connected) continue;
      const arrive = Math.max(w.lastIn, now + between(latency));
      const epoch = w.epoch;
      w.lastIn = arrive;
      at(arrive, () => epoch === w.epoch && w.deliver(message));
    }
  }

  function addWindow(id = `w${windows.length + 1}`) {
    const w = {
      id,
      alive: true,
      connected: true,
      frozen: false,
      lastIn: now,
      epoch: 0,
      backlog: [],
      dueTimers: [],
      throttle,
      election: null,
      // What reached the browser before a drop is still read, in order, and
      // the disconnect after it: a frozen tab reads both when it thaws.
      deliver(message) {
        if (!w.alive) return;
        if (w.frozen) return void w.backlog.push(message);
        if (message.kind === "seat") w.election.receive(message);
        else if (message.kind === "event" && w.election.isLead()) events[message.n].push(w.id);
        else if (message.kind === "disconnect") w.election.disconnected();
      },
    };
    w.election = createSeatElection({
      selfId: id,
      send: (op) => {
        if (!w.alive || !w.connected) return false;
        at(now + between(latency), () => handle({ kind: "seat", op, from: id }));
        return true;
      },
      schedule: (fn, ms) => {
        const extra = w.throttle ? Math.floor(rand() * w.throttle) : 0;
        return at(now + ms + extra, () => {
          if (!w.alive) return;
          if (w.frozen) w.dueTimers.push(fn);
          else fn();
        });
      },
      cancel: (item) => {
        if (item) item.live = false;
      },
    });
    windows.push(w);
    w.election.join();
    return w;
  }

  return {
    windows,
    events,
    get now() {
      return now;
    },
    rand,
    runUntil,
    run: (ms) => runUntil(now + ms),
    addWindow,
    /** A document event another client caused, in the server's order. */
    event() {
      const n = eventCount++;
      at(now + between(latency), () => handle({ kind: "event", n }));
    },
    close(w) {
      w.election.leave();
      w.alive = false;
    },
    cancelledUnload(w) {
      w.election.leave();
    },
    kill(w) {
      w.alive = false;
    },
    drop(w) {
      if (!w.connected) return;
      w.connected = false;
      w.epoch++;
      w.deliver({ kind: "disconnect" });
    },
    /** A frozen tab runs no reconnect of its own: it thaws first. */
    reconnect(w) {
      if (w.connected || w.frozen) return;
      w.connected = true;
      w.lastIn = now;
      w.election.join();
    },
    freeze(w) {
      w.frozen = true;
    },
    thaw(w) {
      w.frozen = false;
      for (const m of w.backlog.splice(0)) w.deliver(m);
      for (const fn of w.dueTimers.splice(0)) if (w.alive && !w.frozen) fn();
    },
    live: () => windows.filter((w) => w.alive && w.connected && !w.frozen),
  };
}

/** At most one window led at each event it read. */
function assertOneLeadPerEvent(seat, label = "") {
  seat.events.forEach((leads, n) => {
    assert.ok((leads?.length ?? 0) <= 1, `${label} event ${n} was handled by ${leads.join(", ")}`);
  });
}

/** One live window leads, and every live window names it. */
function assertAgreed(seat, label = "") {
  const live = seat.live();
  const leads = live.filter((w) => w.election.isLead());
  assert.equal(leads.length, 1, `${label} live leads: ${leads.map((w) => w.id).join(", ") || "none"}`);
  for (const w of live) assert.equal(w.election.census().lead, leads[0].id, `${label} ${w.id} names ${w.election.census().lead}`);
}

const QUIET = SEAT_TIMINGS.joinWaitMs + SEAT_TIMINGS.pingEveryMs + SEAT_TIMINGS.pingWaitMs + 5000;

/* -------------------------------------------- */
/*  Scenarios                                   */
/* -------------------------------------------- */

await test("a window alone on its seat leads once its join wait has passed", async () => {
  const seat = makeSeat(11);
  const a = seat.addWindow();
  seat.run(SEAT_TIMINGS.joinWaitMs - 500);
  assert.equal(a.election.isLead(), false, "still joining");
  seat.run(1000);
  assert.equal(a.election.isLead(), true);
  assert.equal(await a.election.settled, true);
});

await test("a second window follows the lead it is answered by, and the first keeps leading", async () => {
  const seat = makeSeat(12);
  const a = seat.addWindow();
  seat.run(QUIET);
  const b = seat.addWindow();
  seat.run(1000);
  assert.equal(b.election.isLead(), false);
  assert.equal(b.election.census().lead, a.id);
  assert.equal(await b.election.settled, false);
  seat.run(QUIET * 3);
  assertAgreed(seat);
  assert.equal(a.election.isLead(), true, "the lead is never unseated by a live follower");
});

await test("two windows joining together settle on one lead", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const seat = makeSeat(seed);
    seat.addWindow();
    seat.addWindow();
    for (let i = 0; i < 30; i++) {
      seat.event();
      seat.run(200);
    }
    seat.run(QUIET);
    assertOneLeadPerEvent(seat, `seed ${seed}`);
    assertAgreed(seat, `seed ${seed}`);
  }
});

await test("every event in a steady seat is handled exactly once", () => {
  const seat = makeSeat(13);
  seat.addWindow();
  seat.run(QUIET);
  seat.addWindow();
  seat.addWindow();
  seat.run(QUIET);
  const from = seat.events.length;
  for (let i = 0; i < 50; i++) {
    seat.event();
    seat.run(100);
  }
  seat.run(1000);
  for (let n = from; n < seat.events.length; n++) assert.equal(seat.events[n].length, 1, `event ${n}`);
});

await test("a closing lead's bye hands the seat over at once", () => {
  const seat = makeSeat(14);
  const a = seat.addWindow();
  seat.run(QUIET);
  const b = seat.addWindow();
  seat.run(QUIET);
  seat.close(a);
  seat.run(1000);
  assert.equal(b.election.isLead(), true, "taken over within a second, long before a ping would notice");
});

await test("a cancelled unload changes nothing until a follower's claim lands", () => {
  const seat = makeSeat(15);
  const a = seat.addWindow();
  seat.run(QUIET);
  const b = seat.addWindow();
  seat.run(QUIET);
  seat.cancelledUnload(a);
  assert.equal(a.election.isLead(), true, "bye alone moves nothing");
  for (let i = 0; i < 10; i++) {
    seat.event();
    seat.run(50);
  }
  seat.run(QUIET);
  assertOneLeadPerEvent(seat);
  assertAgreed(seat);
  assert.equal(b.election.isLead(), true, "the follower that heard bye took the lead");
});

await test("a crashed lead is replaced within a ping and its wait", () => {
  const seat = makeSeat(16);
  const a = seat.addWindow();
  seat.run(QUIET);
  const b = seat.addWindow();
  seat.run(QUIET);
  const crashed = seat.now;
  seat.kill(a);
  while (!b.election.isLead() && seat.now - crashed < QUIET * 2) seat.run(100);
  assert.equal(b.election.isLead(), true);
  assert.ok(seat.now - crashed <= SEAT_TIMINGS.pingEveryMs + SEAT_TIMINGS.pingWaitMs + 1000, `took ${seat.now - crashed} ms`);
});

await test("a lead that reconnects in place stops leading, and the seat agrees again", () => {
  const seat = makeSeat(17);
  const a = seat.addWindow();
  seat.run(QUIET);
  const b = seat.addWindow();
  seat.run(QUIET);
  seat.drop(a);
  assert.equal(a.election.isLead(), false, "a dropped window leads no longer");
  seat.event();
  seat.run(1000);
  seat.reconnect(a);
  for (let i = 0; i < 10; i++) {
    seat.event();
    seat.run(300);
  }
  seat.run(QUIET);
  assertOneLeadPerEvent(seat);
  assertAgreed(seat);
});

await test("a frozen lead's backlog thaws in order and never doubles an event", () => {
  const seat = makeSeat(18);
  const a = seat.addWindow();
  seat.run(QUIET);
  const b = seat.addWindow();
  seat.run(QUIET);
  seat.freeze(a);
  for (let i = 0; i < 40; i++) {
    seat.event();
    seat.run(1000);
  }
  assert.equal(b.election.isLead(), true, "the follower took over from the frozen lead");
  seat.thaw(a);
  seat.run(QUIET);
  assertOneLeadPerEvent(seat);
  assertAgreed(seat);
  assert.ok(
    seat.events.every((leads) => leads.length === 1),
    "the thawed window handled the events from before the takeover, the new lead the rest",
  );
});

await test("a throttled follower replaces a dead lead late and never makes two", () => {
  const seat = makeSeat(19, { throttle: 60000 });
  const a = seat.addWindow();
  seat.run(QUIET * 4);
  const b = seat.addWindow();
  seat.run(QUIET * 4);
  for (let i = 0; i < 20; i++) {
    seat.event();
    seat.run(2000);
  }
  assertOneLeadPerEvent(seat);
  assert.equal(a.election.isLead(), true, "a live lead is never unseated by a slow follower's ping");
  seat.kill(a);
  seat.run(QUIET * 10);
  assert.equal(b.election.isLead(), true);
});

await test("an answer from a window that does not lead never moves the lead", () => {
  let sent = [];
  const e = createSeatElection({ selfId: "b", send: (op) => (sent.push(op), true), schedule: () => null, cancel: () => {} });
  e.join();
  e.receive({ op: "claim", from: "a" });
  assert.equal(e.census().lead, "a");
  e.receive({ op: "here", from: "c" });
  assert.equal(e.census().lead, "a", "only a claim changes the lead");
  e.receive({ op: "hello", from: "a" });
  assert.equal(e.census().lead, null, "the believed lead rejoining leaves the seat vacant");
  assert.ok(sent.includes("claim"), "and the follower claims it");
  sent = [];
  e.receive({ op: "claim", from: "b" });
  assert.equal(e.isLead(), true);
  e.receive({ op: "ping", from: "a" });
  assert.deepEqual(sent, ["here"], "the lead answers from its message handler");
});

await test("a window sends nothing while disconnected and leads only after rejoining", () => {
  let connected = true;
  const sent = [];
  const e = createSeatElection({
    selfId: "a",
    send: (op) => (connected ? (sent.push(op), true) : false),
    schedule: () => null,
    cancel: () => {},
  });
  e.join();
  e.receive({ op: "claim", from: "a" });
  assert.equal(e.isLead(), true);
  connected = false;
  e.disconnected();
  assert.equal(e.isLead(), false);
  e.receive({ op: "claim", from: "a" });
  assert.equal(e.isLead(), false, "a message read while not joined is ignored");
  assert.equal(e.census().lead, null, "and names no lead");
  e.leave();
  assert.equal(sent.filter((op) => op === "bye").length, 0);
  connected = true;
  e.join();
  e.receive({ op: "claim", from: "a" });
  assert.equal(e.isLead(), true);
  e.join();
  assert.equal(e.census().lead, null, "a rejoin knows no lead until a claim or an answer names one");
  assert.equal(e.isLead(), false);
});

await test("random joins, closes, crashes, freezes, drops and throttles never double an event", () => {
  for (let seed = 100; seed < 260; seed++) {
    const seat = makeSeat(seed, { throttle: seed % 3 === 0 ? 30000 : 0 });
    seat.addWindow();
    for (let step = 0; step < 120; step++) {
      const r = seat.rand();
      const live = seat.windows.filter((w) => w.alive);
      const pick = () => live[Math.floor(seat.rand() * live.length)];
      if (r < 0.45) seat.event();
      else if (r < 0.52 && live.length < 5) seat.addWindow();
      else if (r < 0.56 && live.length > 1) seat.close(pick());
      else if (r < 0.59 && live.length > 1) seat.kill(pick());
      else if (r < 0.62) seat.cancelledUnload(pick());
      else if (r < 0.66) {
        const w = pick();
        if (w.connected) seat.drop(w);
        else seat.reconnect(w);
      } else if (r < 0.69) {
        const w = pick();
        if (w.frozen) seat.thaw(w);
        else seat.freeze(w);
      }
      seat.run(Math.floor(seat.rand() * 4000));
      assertOneLeadPerEvent(seat, `seed ${seed} step ${step}`);
    }
    for (const w of seat.windows) {
      if (!w.alive) continue;
      if (w.frozen) seat.thaw(w);
      if (!w.connected) seat.reconnect(w);
      w.throttle = 0;
    }
    if (!seat.windows.some((w) => w.alive)) seat.addWindow();
    seat.run(QUIET * 2);
    const from = seat.events.length;
    for (let i = 0; i < 10; i++) {
      seat.event();
      seat.run(200);
    }
    seat.run(1000);
    assertOneLeadPerEvent(seat, `seed ${seed}`);
    assertAgreed(seat, `seed ${seed} at rest`);
    for (let n = from; n < seat.events.length; n++) assert.equal(seat.events[n].length, 1, `seed ${seed} event ${n} at rest`);
  }
});

/* -------------------------------------------- */
/*  The window half and the relay gate          */
/* -------------------------------------------- */

await test("a relayed request runs on the seat's lead alone; a broadcast and a window's own call run anywhere", async () => {
  const once = new Map();
  globalThis.Hooks = {
    once(name, fn) {
      if (!once.has(name)) once.set(name, []);
      once.get(name).push(fn);
    },
    on() {},
  };
  const fire = (name) => {
    for (const fn of once.get(name) ?? []) fn();
    once.delete(name);
  };
  const registered = new Map();
  globalThis.socketlib = { registerModule: () => ({ register: (name, fn) => registered.set(name, fn) }) };
  const listeners = new Map();
  const emitted = [];
  const order = [];
  const unload = [];
  globalThis.window = {
    addEventListener: (type, fn) => unload.push([type, fn]),
    removeEventListener: (type, fn) => {
      const at = unload.findIndex(([t, f]) => t === type && f === fn);
      if (at >= 0) unload.splice(at, 1);
    },
  };
  // socket.io's own unload listener, added by the page's first connection
  // before any module loads: it closes the transport, as socket.io 4.8.3 does.
  const transport = { close: () => order.push("closed") };
  unload.push(["beforeunload", () => game.socket.io.engine.transport.close()]);
  globalThis.foundry = { utils: { randomID: () => "self" } };
  globalThis.game = {
    view: "game",
    user: { id: "gm", isGM: true },
    users: { activeGM: { isSelf: true }, get: (id) => ({ id, isGM: id === "gm" }) },
    socket: {
      connected: true,
      io: { engine: { transport } },
      on: (event, fn) => listeners.set(event, [...(listeners.get(event) ?? []), fn]),
      emit: (event, message, options) => {
        emitted.push({ event, message, options });
        order.push(message?.seatElection?.op ?? event);
      },
    },
  };

  const sockets = await import("../scripts/lib/sockets.mjs");
  const client = await import("../scripts/lib/automation-client.mjs");
  const util = await import("../scripts/lib/util.mjs");
  const ran = [];
  sockets.registerHandler("act", (payload) => (ran.push(["act", payload]), "done"));
  sockets.registerHandler("fog", (payload) => (ran.push(["fog", payload]), "shown"), { broadcast: true });
  fire("socketlib.ready");
  assert.equal(client.isLeadClient(), false, "a live window does not lead before it joins");
  assert.equal(emitted.length, 0, "and says nothing before ready");
  fire("ready");

  const hello = emitted.find((e) => e.message?.seatElection?.op === "hello");
  assert.ok(hello, "the window says hello at ready");
  assert.deepEqual(hello.options, { recipients: ["gm"] }, "to its own seat's sockets only");
  const deliver = (op, from, senderId = "gm") => {
    for (const fn of listeners.get("module.acks-extras") ?? []) fn({ seatElection: { op, from } }, senderId);
  };
  const relay = (name, senderId) => registered.get(name).call({ socketdata: { userId: senderId } }, { n: 1 });
  const within = (result, ms = 30) =>
    Promise.race([Promise.resolve(result).then((v) => ({ v })), new Promise((r) => setTimeout(() => r("pending"), ms))]);

  const early = relay("act", "player");
  assert.equal(await within(early), "pending", "a request waits while the window is still joining");

  deliver("claim", "other", "player");
  assert.equal(client.automationCensus().lead, null, "a claim from another user's socket is ignored");
  deliver("claim", "other");
  assert.equal(await within(early), "pending", "and is never answered once another window leads");
  assert.equal(util.isPrimaryGM(), false);
  assert.equal(await util.primaryGMSettled(), false);
  assert.equal(util.isActiveGMSeat(), true, "the seat still answers for its own user's acts");
  assert.deepEqual(await within(relay("fog", "player")), { v: "shown" }, "a broadcast handler runs on a follower");
  assert.deepEqual(await within(relay("act", "gm")), { v: "done" }, "a call this window made runs here");

  deliver("claim", "self");
  assert.equal(client.isLeadClient(), true);
  assert.equal(util.isPrimaryGM(), true);
  assert.deepEqual(await within(relay("act", "player")), { v: "done" }, "the lead answers a relayed request");
  assert.equal(ran.filter(([name]) => name === "act").length, 2, "the request a follower saw was never run");

  order.length = 0;
  for (const [type, fn] of [...unload]) if (type === "beforeunload") fn();
  assert.deepEqual(order, ["bye", "closed"], "the lead's bye is sent before socket.io closes the connection");

  for (const fn of listeners.get("disconnect") ?? []) fn();
  assert.equal(client.isLeadClient(), false, "a dropped connection ends the lead");
  game.socket.connected = false;
  const before = emitted.length;
  for (const fn of listeners.get("connect") ?? []) fn();
  assert.equal(emitted.length, before, "nothing is emitted while the socket is down");

  game.socket.connected = true;
  game.socket.io.engine.transport = { close: () => order.push("closed again") };
  for (const fn of listeners.get("connect") ?? []) fn();
  deliver("claim", "self");
  assert.equal(client.isLeadClient(), true, "the window leads again after reconnecting");
  order.length = 0;
  game.socket.io.engine.transport.close();
  assert.deepEqual(order, ["bye", "closed again"], "a reconnected transport says bye before it closes");
});

/* -------------------------------------------- */
/*  The gate stays one helper                   */
/* -------------------------------------------- */

await test("no script gates on the active GM except through util.mjs", () => {
  const INLINE = /activeGM\s*\??\.\s*isSelf|[!=]==\s*game\.users\??\.activeGM\b|\bgame\.users\??\.activeGM\s*[!=]==/;
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".mjs")) {
        const rel = path.relative(ROOT, full).split(path.sep).join("/");
        if (rel === "scripts/lib/util.mjs") continue;
        fs.readFileSync(full, "utf8")
          .split("\n")
          .forEach((line, i) => {
            if (INLINE.test(line)) found.push(`${rel}:${i + 1}`);
          });
      }
    }
  };
  walk(path.join(ROOT, "scripts"));
  assert.deepEqual(found, [], "use isPrimaryGM (hooks, sockets, timers) or isActiveGMSeat (the user's own act) from scripts/lib/util.mjs");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
