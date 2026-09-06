/**
 * The seat: a headless browser joined to the world as the bot's own Foundry
 * user, driven over the DevTools protocol.
 *
 * Everything the bot does in Foundry is `Runtime.evaluate` of the bridge's
 * `acksExtras.bridge.run(...)` in this page, and everything it hears back is
 * the bridge calling the global this class installs with `Runtime.addBinding`.
 * The join mechanics are the family's release-capture driver's: read the
 * seat's user id from the join page's own `game.users`, POST `/join` with the
 * camelCase `userId`, navigate to `/game`, poll `game.ready`. The window is
 * sized above Foundry's floor because a canvas below it never initialises,
 * and core's chat speaker dereferences the scene.
 *
 * The browser is disposable and the seat assumes it: a lost socket, a failed
 * watchdog probe or a world restart tears the browser down and launches a
 * fresh one with backoff. Nothing in the page is worth keeping between two
 * lives — the bridge's event buffer is the page's, and a new page starts
 * empty — so a reconnect is a clean join, not a resume.
 *
 * Teardown kills by PROFILE, not by pid: a browser is a launcher plus
 * renderer, GPU, network and crashpad children, the launcher has usually
 * exited already on Windows, and the throwaway `--user-data-dir` is the one
 * string every child carries on its command line.
 */
import { spawn, execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Thrown by `eval` while the seat is between lives. */
export class SeatDown extends Error {
  constructor(message = "the Foundry seat is reconnecting") {
    super(message);
    this.seatDown = true;
  }
}

/**
 * A minimal DevTools client over one WebSocket: requests by id, events by
 * method (emitted as `<method>` with `(params, sessionId)`), and every
 * pending request rejected when the socket closes so nothing hangs.
 */
export class Cdp extends EventEmitter {
  constructor(ws, { timeout = 90000 } = {}) {
    super();
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.timeout = timeout;
    ws.addEventListener("message", (ev) => this.#onMessage(typeof ev.data === "string" ? ev.data : String(ev.data)));
    ws.addEventListener("close", () => {
      for (const p of this.pending.values()) p.reject(new Error("devtools socket closed"));
      this.pending.clear();
      this.emit("close");
    });
    ws.addEventListener("error", (err) => this.emit("socketError", err));
  }

  #onMessage(text) {
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject, timer } = this.pending.get(msg.id);
      clearTimeout(timer);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message ?? "devtools error"} (${msg.error.code ?? "?"})`));
      else resolve(msg.result ?? {});
    } else if (msg.method) {
      this.emit(msg.method, msg.params ?? {}, msg.sessionId);
    }
  }

  send(method, params = {}, sessionId = undefined, timeout = this.timeout) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`timeout: ${method}`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* already closed */
    }
  }
}

const openWs = (url) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener("open", () => resolve(ws), { once: true });
    ws.addEventListener("error", (e) => reject(new Error(`devtools socket failed: ${e?.message ?? e}`)), { once: true });
  });

/**
 * Flags a headless Chromium needs to run unattended. The Linux extras are
 * what a container or a root service otherwise fails on: no user namespace
 * for the sandbox, a small `/dev/shm`, no GPU.
 */
export function browserArgs({ port, profile, width, height, extra = [] }) {
  const args = [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=Translate,AcceptCHFrame",
    "--autoplay-policy=no-user-gesture-required",
  ];
  if (process.platform !== "win32") args.push("--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu");
  return [...args, ...extra, "about:blank"];
}

/**
 * Kill the whole browser. Windows: every process carrying the profile on its
 * command line. Elsewhere: the process group the launcher was started in
 * (`detached` puts it in its own), so renderer and GPU children go with it.
 */
function killByProfile(browser, profile, proc) {
  if (process.platform !== "win32") {
    try {
      if (proc?.pid) process.kill(-proc.pid, "SIGKILL");
    } catch {
      try {
        proc?.kill("SIGKILL");
      } catch {
        /* gone */
      }
    }
    return;
  }
  try {
    proc?.kill();
  } catch {
    /* gone */
  }
  if (!profile) return;
  const exe = path.basename(browser).replace(/'/g, "''");
  const needle = profile.replace(/'/g, "''");
  const script =
    `Get-CimInstance Win32_Process -Filter "Name='${exe}'" | ` +
    `Where-Object { $_.CommandLine -like '*${needle}*' } | ` +
    `ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  try {
    execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: "ignore" });
  } catch {
    /* nothing left to kill */
  }
}

/** Backoff between lives: 5s, 10s, 20s, 40s, then a minute. */
export const reconnectDelay = (attempt) => Math.min(60000, 5000 * 2 ** Math.min(Math.max(0, attempt), 4));

export class Seat extends EventEmitter {
  #config;
  #log;
  #proc = null;
  #profile = null;
  #cdp = null;
  #session = null;
  #ready = false;
  #stopping = false;
  #watchdog = null;
  #attempt = 0;
  #reconnectTimer = null;
  #lastSeq = 0;

  /**
   * @param {object} config  `{ browser, origin, user, password, port, width, height, readySeconds, bindingName }`
   * @param {object} log     the logger
   */
  constructor(config, log) {
    super();
    this.#config = config;
    this.#log = log;
  }

  get ready() {
    return this.#ready;
  }

  /** First life. Throws on a failure the operator must fix (no browser, no world, wrong user); later drops reconnect on their own. */
  async start() {
    for (const k of ["browser", "origin", "user"]) {
      if (!this.#config[k]) throw new Error(`seat: "${k}" is required`);
    }
    if (!fs.existsSync(this.#config.browser)) throw new Error(`seat: browser not found at ${this.#config.browser}`);
    await this.#connect();
  }

  async stop() {
    this.#stopping = true;
    clearTimeout(this.#reconnectTimer);
    this.#teardown();
  }

  /** Evaluate in page context; awaits promises; throws on a page exception or while down. */
  async eval(expression, { timeout = 30000 } = {}) {
    if (!this.#ready || !this.#cdp) throw new SeatDown();
    const r = await this.#cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, this.#session, timeout);
    if (r.exceptionDetails) {
      throw new Error(`${r.exceptionDetails.text ?? "page exception"} ${r.exceptionDetails.exception?.description ?? ""}`.trim());
    }
    return r.result?.value;
  }

  /** A PNG of the page, clipped to `{x, y, width, height}` when given. */
  async screenshot(clip = null) {
    if (!this.#ready || !this.#cdp) throw new SeatDown();
    const shot = await this.#cdp.send(
      "Page.captureScreenshot",
      { format: "png", ...(clip ? { clip: { ...clip, scale: 1 } } : {}), captureBeyondViewport: false },
      this.#session,
    );
    return Buffer.from(shot.data, "base64");
  }

  #teardown() {
    this.#ready = false;
    clearInterval(this.#watchdog);
    this.#watchdog = null;
    const cdp = this.#cdp;
    this.#cdp = null;
    this.#session = null;
    cdp?.removeAllListeners();
    cdp?.close();
    killByProfile(this.#config.browser, this.#profile, this.#proc);
    this.#proc = null;
    if (this.#profile) {
      try {
        fs.rmSync(this.#profile, { recursive: true, force: true });
      } catch {
        /* a straggler still holds it; the next life uses a new one */
      }
    }
    this.#profile = null;
  }

  #down(reason) {
    if (!this.#ready && !this.#cdp) return;
    this.#log.warn(`seat down: ${reason}`);
    this.#teardown();
    this.emit("down", reason);
    this.#scheduleReconnect();
  }

  #scheduleReconnect() {
    if (this.#stopping) return;
    const delay = reconnectDelay(this.#attempt++);
    this.#log.info(`seat reconnecting in ${Math.round(delay / 1000)}s`);
    clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = setTimeout(() => {
      this.#connect().catch((err) => {
        this.#log.error(`seat reconnect failed: ${err.message}`);
        this.#teardown();
        this.#scheduleReconnect();
      });
    }, delay);
  }

  async #connect() {
    const { browser, origin, user, password = "", port, width = 1600, height = 1000, readySeconds = 120, bindingName, browserArgs: extra = [] } = this.#config;
    this.#teardown();
    this.#profile = fs.mkdtempSync(path.join(os.tmpdir(), "acks-extras-discord-seat-"));
    this.#proc = spawn(browser, browserArgs({ port, profile: this.#profile, width, height, extra }), {
      stdio: ["ignore", "ignore", "pipe"],
      detached: process.platform !== "win32",
    });
    this.#proc.stderr.on("data", () => {});
    this.#proc.on("exit", (code) => {
      if (this.#ready) this.#down(`browser exited (${code})`);
    });

    let wsUrl = null;
    for (let i = 0; i < 60 && !wsUrl; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (r.ok) wsUrl = (await r.json()).webSocketDebuggerUrl;
      } catch {
        /* not up yet */
      }
      if (!wsUrl) await sleep(250);
    }
    if (!wsUrl) throw new Error("devtools endpoint never came up");

    const cdp = new Cdp(await openWs(wsUrl));
    this.#cdp = cdp;
    cdp.on("close", () => this.#down("devtools socket closed"));
    cdp.on("socketError", (err) => this.#log.warn(`devtools socket error: ${err?.message ?? err}`));

    const { targetId } = await cdp.send("Target.createTarget", { url: `${origin}/join` });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    this.#session = sessionId;
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);
    cdp.on("Target.targetCrashed", (params) => {
      if (params?.targetId === targetId) this.#down("page crashed");
    });
    // The page's own warnings and errors, for the operator's log: a module
    // that throws at init, a refused write, a stamp that failed to land.
    cdp.on("Runtime.consoleAPICalled", (params, sid) => {
      if (sid !== sessionId || !["error", "warning", "assert"].includes(params?.type)) return;
      const text = (params.args ?? []).map((a) => a.value ?? a.description ?? "").join(" ");
      this.emit("console", { level: params.type, text });
      this.#log.debug(`page ${params.type}: ${text.slice(0, 400)}`);
    });
    cdp.on("Runtime.exceptionThrown", (params, sid) => {
      if (sid !== sessionId) return;
      const text = params?.exceptionDetails?.exception?.description ?? params?.exceptionDetails?.text ?? "exception";
      this.emit("console", { level: "exception", text });
      this.#log.debug(`page exception: ${text.slice(0, 400)}`);
    });
    cdp.on("Runtime.bindingCalled", (params, sid) => {
      if (sid !== sessionId || params?.name !== bindingName) return;
      let event = null;
      try {
        event = JSON.parse(params.payload);
      } catch {
        return;
      }
      if (typeof event?.seq === "number") this.#lastSeq = event.seq;
      this.emit("event", event);
    });
    await sleep(2500);

    const pageEval = async (expression, timeout = 30000) => {
      const r = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId, timeout);
      if (r.exceptionDetails) throw new Error(`${r.exceptionDetails.text ?? "page exception"} ${r.exceptionDetails.exception?.description ?? ""}`.trim());
      return r.result?.value;
    };

    // The seat's user id comes from the join page's own `game.users` — polled,
    // because the page renders it with its own scripts.
    const uid = await pageEval(`new Promise(res => { let n = 0; const t = setInterval(() => {
      const list = globalThis.game?.users ? [...game.users] : [];
      const u = list.find(u => u.name === ${JSON.stringify(user)});
      if (u?.id) { clearInterval(t); res(u.id); }
      else if (++n > 40) { clearInterval(t); res(null); }
    }, 500); })`, 40000);
    if (!uid) throw new Error(`user "${user}" is not on the join page — is a world running at ${origin}, and is that the user's exact name?`);

    const joined = await pageEval(`fetch("/join", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "join", userId: ${JSON.stringify(uid)}, password: ${JSON.stringify(password)} }) })
      .then(r => r.status)`);
    if (joined !== 200) throw new Error(`join as "${user}" answered HTTP ${joined}`);
    await cdp.send("Page.navigate", { url: `${origin}/game` }, sessionId);
    await sleep(3000);

    const ready = await pageEval(`new Promise(res => { let n = 0; const t = setInterval(() => { n++;
      if (typeof game !== "undefined" && game.ready && globalThis.acksExtras?.bridge) { clearInterval(t); res("ready"); }
      else if (n > ${readySeconds}) { clearInterval(t); res("NOT READY: " + location.href + (typeof game !== "undefined" && game.ready ? " (world ready, bridge absent — is acks-extras active?)" : "")); } }, 1000); })`, (readySeconds + 10) * 1000);
    if (ready !== "ready") throw new Error(ready);

    await cdp.send("Runtime.addBinding", { name: bindingName }, sessionId);

    this.#ready = true;
    this.#attempt = 0;
    this.#watchdog = setInterval(() => this.#probe(), 30000);
    const who = await pageEval(`JSON.stringify({ user: game.user?.name, role: game.user?.role, world: game.world?.id ? "ok" : "none", canvas: !!globalThis.canvas?.ready })`);
    this.#log.info(`seat ready: ${who}`);
    this.emit("ready");
  }

  async #probe() {
    if (!this.#ready) return;
    try {
      const ok = await this.eval("!!(globalThis.game?.ready && globalThis.acksExtras?.bridge)", { timeout: 15000 });
      if (ok !== true) this.#down("probe: world not ready");
    } catch (err) {
      this.#down(`probe failed: ${err.message}`);
    }
  }

  /** The last event sequence number seen this life. */
  get lastSeq() {
    return this.#lastSeq;
  }
}
