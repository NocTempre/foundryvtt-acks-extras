/**
 * Drives the capture driver's page keeper, its stray-page rule and its
 * DevTools connection against scripted stand-ins, and checks what a long shot
 * run depends on: that the page is put back in front before its windows are
 * closed or a frame is taken, that no close waits on an animation, that a
 * toast cannot be in the frame, and that a capture nothing answers is given
 * up and tried once more. It drives the fixture ledger against a scripted
 * world, and checks what a kept fixture depends on: that a marker finds the
 * one document carrying it and nothing else, that what is found is never
 * tracked, and that a delete takes only what the run names. The scripted page
 * and world run the driver's own page-side expressions, in `vm` contexts
 * holding the few DOM and Foundry members they touch, so an expression that
 * does not parse fails here.
 *
 * Nothing here launches a browser: what a real page does when it is hidden is
 * outside this file, and only a live run shows it.
 *
 * Usage:  node tools/toolchain-tests/test-foundry-capture.mjs [<foundry-capture.mjs>]
 *         (defaults to tools/live/_capture.mjs; pass a modified copy to
 *         confirm a case fails when the behaviour it guards is broken)
 */
import path from "node:path";
import url from "node:url";
import vm from "node:vm";

const TEMPLATE_ROOT = path.dirname(path.dirname(path.dirname(url.fileURLToPath(import.meta.url))));
const DRIVER = path.resolve(process.argv[2] ?? path.join(TEMPLATE_ROOT, "tools", "live", "_capture.mjs"));
const { Cdp, attachMap, attachSeat, connect, fixtureLedger, pageKeeper, strayPages } = await import(url.pathToFileURL(DRIVER).href);

const OWN = "target-own";
const TRAY = "#notifications";
const PNG = "iVBORw0KGgo=";
const UNANSWERED = "timeout: Page.captureScreenshot";

// Invented targets: the two a browser opened for itself, and the ones it did not.
const DIALOG = { targetId: "t-dialog", type: "page", url: "edge://sync-confirmation-dialog/" };
const FIRST_RUN = { targetId: "t-first-run", type: "page", url: "chrome-extension://abcdefghijklmnopabcdefghijklmnop/first-run.html" };
const BLANK = { targetId: "t-blank", type: "page", url: "about:blank" };
const POPOUT = { targetId: "t-popout", type: "page", url: "https://world.invalid/popout" };
const WORKER = { targetId: "t-worker", type: "service_worker", url: "chrome-extension://abcdefghijklmnopabcdefghijklmnop/worker.js" };

/**
 * A scripted page and the three channels `pageKeeper` drives it through.
 * `visibility` and `frames` say whether it starts hidden and whether it paints;
 * `pages` are the browser's other targets (one marked `stays` survives its
 * close); `captures` are the outcomes of successive screenshots, "ok" or an
 * error message, "ok" once they run out; `refuse` names commands the browser
 * rejects; `fronting` is what activating a hidden page does — it "shows" at
 * once, "lags" a moment behind the command's reply, or stays "stuck" hidden;
 * `evaluateFails(expression, page)` picks page-side expressions that never
 * answer; `apps` are its open applications (`{id, name}`, one marked `throws`
 * refuses to close) and `toasts` how many sit in its tray. The returned object
 * records every call in order, the stylesheets in its head, the animation
 * frames it ran, whether the tray was hidden as each screenshot was taken,
 * each close asked of an application with its options, and whether the
 * notification queue was cleared.
 */
function scriptedPage({ visibility = "visible", frames = true, pages = [], captures = [], refuse = [], fronting = "shows", evaluateFails = () => false, apps = [], toasts = 0 } = {}) {
  const page = {
    visibility,
    calls: [],
    sheets: new Map(),
    framesRun: 0,
    trayAtCapture: [],
    targets: [{ targetId: OWN, type: "page", url: "http://world.invalid/game" }, ...pages],
    apps: new Map(),
    closes: [],
    toasts: Array.from({ length: toasts }, (_, n) => `toast-${n}`),
    queueCleared: false,
  };
  for (const { id, name, throws } of apps) {
    page.apps.set(id, {
      id,
      constructor: { name },
      async close(options) {
        page.closes.push({ id, options });
        if (throws) throw new Error(`${name} refuses to close`);
        page.apps.delete(id);
      },
    });
  }
  const onVisibilityChange = [];
  const show = () => {
    page.visibility = "visible";
    for (const listener of onVisibilityChange.splice(0)) listener();
  };
  const context = vm.createContext({
    document: {
      get visibilityState() { return page.visibility; },
      head: { append: (el) => page.sheets.set(el.id, el) },
      createElement: () => ({ id: "", textContent: "", remove() { page.sheets.delete(this.id); } }),
      getElementById: (id) => page.sheets.get(id) ?? null,
      querySelector: (selector) => ({ closest: (ancestor) => (selector.startsWith(TRAY) && ancestor === TRAY ? {} : null) }),
      querySelectorAll: (selector) => (selector === `${TRAY} .notification` ? page.toasts : [])
        .map((toast) => ({ remove: () => page.toasts.splice(page.toasts.indexOf(toast), 1) })),
      addEventListener: (type, listener) => { if (type === "visibilitychange") onVisibilityChange.push(listener); },
    },
    foundry: { applications: { instances: page.apps } },
    ui: { notifications: { clear: () => { page.queueCleared = true; } } },
    requestAnimationFrame: (fn) => {
      if (frames && page.visibility === "visible") setImmediate(() => { page.framesRun++; fn(); });
    },
    // A page-side wait is cut to 40 ms, so no case sits out the driver's own.
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 40)),
    clearTimeout,
  });
  const refused = (method) => {
    if (refuse.includes(method)) throw new Error(JSON.stringify({ code: -32000, message: `${method} refused` }));
  };
  page.channels = {
    targetId: OWN,
    browser: async (method, params) => {
      page.calls.push({ channel: "browser", method, params });
      refused(method);
      if (method === "Target.getTargets") return { targetInfos: page.targets.map((t) => ({ ...t })) };
      if (method === "Target.closeTarget") {
        const at = page.targets.findIndex((t) => t.targetId === params.targetId);
        if (at >= 0 && !page.targets[at].stays) page.targets.splice(at, 1);
        return { success: true };
      }
      throw new Error(`unscripted browser command ${method}`);
    },
    page: async (method, params, timeout) => {
      page.calls.push({ channel: "page", method, params, timeout });
      refused(method);
      if (method === "Page.bringToFront") {
        if (fronting === "shows") show();
        else if (fronting === "lags") setTimeout(show, 15);
        return {};
      }
      if (method === "Page.captureScreenshot") {
        page.trayAtCapture.push(page.sheets.size > 0);
        const outcome = captures.length ? captures.shift() : "ok";
        if (outcome !== "ok") throw new Error(outcome);
        return { data: PNG };
      }
      throw new Error(`unscripted page command ${method}`);
    },
    evaluate: async (expression, timeout) => {
      const call = { channel: "evaluate", expression, timeout };
      page.calls.push(call);
      if (evaluateFails(expression, page)) throw new Error("timeout: Runtime.evaluate");
      call.result = await vm.runInContext(expression, context);
      return call.result;
    },
  };
  return page;
}

/**
 * A scripted world for the fixture ledger. `docs` are `{kind, id, name,
 * marker, parent}`, where `parent` is the uuid of a world document listed
 * earlier and `marker` becomes its `flags.world.fixture`. The context holds
 * the members the ledger's page-side expressions touch: `game.collections`,
 * `fromUuid`, `foundry.utils.getDocumentClass` and `parseUuid`, and each
 * document's `getEmbeddedCollection`, `update` and `delete` (a delete takes
 * the documents embedded in it). The returned object's `evaluate` runs an
 * expression there; `has(uuid)` says whether a document stands, `marker(uuid)`
 * reads its marker, and `evaluations`, `creates`, `updates` and `deletes`
 * record each call in order.
 */
function scriptedWorld(docs = []) {
  const KINDS = new Set(["Actor", "Item", "Scene", "ChatMessage"]);
  const EMBEDDED = new Set(["Item"]);
  const world = { evaluations: 0, creates: [], updates: [], deletes: [] };
  const byUuid = new Map();
  const collections = new Map([...KINDS].map((kind) => [kind, new Map()]));
  let next = 0;
  const add = (kind, data, parent = null) => {
    const id = data._id ?? `new${++next}`;
    const uuid = parent ? `${parent.uuid}.${kind}.${id}` : `${kind}.${id}`;
    const embedded = new Map();
    const doc = {
      id, uuid, documentName: kind, name: data.name ?? null, flags: structuredClone(data.flags ?? {}),
      getEmbeddedCollection(name) {
        if (!EMBEDDED.has(name)) throw new Error(`${name} is not embedded in ${kind}`);
        if (!embedded.has(name)) embedded.set(name, new Map());
        return embedded.get(name);
      },
      async update(changes) {
        world.updates.push({ uuid, changes });
        for (const [key, value] of Object.entries(changes)) {
          const path = key.split(".");
          let at = doc;
          for (const part of path.slice(0, -1)) at = at[part] ??= {};
          at[path.at(-1)] = value;
        }
        return doc;
      },
      async delete() {
        world.deletes.push(uuid);
        (parent ? parent.getEmbeddedCollection(kind) : collections.get(kind)).delete(id);
        for (const key of [...byUuid.keys()]) if (key === uuid || key.startsWith(`${uuid}.`)) byUuid.delete(key);
        return doc;
      },
    };
    (parent ? parent.getEmbeddedCollection(kind) : collections.get(kind)).set(id, doc);
    byUuid.set(uuid, doc);
    return doc;
  };
  for (const { kind, id, name, marker, parent } of docs) {
    add(kind, { _id: id, name, flags: marker ? { world: { fixture: marker } } : {} }, parent ? byUuid.get(parent) : null);
  }
  const context = vm.createContext({
    game: { collections },
    fromUuid: async (uuid) => byUuid.get(uuid) ?? null,
    foundry: {
      utils: {
        parseUuid: (uuid) => ({ collection: KINDS.has(uuid.split(".").at(-2)) ? {} : null }),
        getDocumentClass: (kind) => (KINDS.has(kind)
          ? { create: async (data, options) => { world.creates.push({ kind, data, parent: options.parent?.uuid ?? null }); return add(kind, data, options.parent ?? null); } }
          : null),
      },
    },
  });
  world.evaluate = async (expression) => { world.evaluations++; return vm.runInContext(expression, context); };
  world.has = (uuid) => byUuid.has(uuid);
  world.marker = (uuid) => byUuid.get(uuid)?.flags?.world?.fixture ?? null;
  return world;
}

/** A stand-in WebSocket: keeps what was sent, and delivers a reply on demand. */
function scriptedSocket() {
  const listeners = [];
  return {
    sent: [],
    addEventListener: (type, fn) => { if (type === "message") listeners.push(fn); },
    send(text) { this.sent.push(JSON.parse(text)); },
    reply: (msg) => listeners.forEach((fn) => fn({ data: JSON.stringify(msg) })),
  };
}

/** Run `step` with console.warn collected: `{value, lines}`, or `{error, lines}` when it throws. */
async function collectWarnings(step) {
  const lines = [];
  const original = console.warn;
  console.warn = (...args) => lines.push(args.join(" "));
  try {
    return { value: await step(), lines };
  } catch (error) {
    return { error, lines };
  } finally {
    console.warn = original;
  }
}

/** Run `step` with console.log collected: `{value, lines}`, or `{error, lines}` when it throws. */
async function collectLog(step) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(" "));
  try {
    return { value: await step(), lines };
  } catch (error) {
    return { error, lines };
  } finally {
    console.log = original;
  }
}

/** `promise`'s outcome as a string, or "still pending" once `ms` pass. */
function settledWithin(ms, promise) {
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve("still pending"), ms); });
  const outcome = promise.then((value) => `resolved ${JSON.stringify(value)}`, (err) => `rejected ${err.message}`);
  return Promise.race([outcome, late]).finally(() => clearTimeout(timer));
}

const runningTimers = () => process.getActiveResourcesInfo().filter((kind) => kind === "Timeout").length;
const methods = (page, channel) => page.calls.filter((c) => c.channel === channel).map((c) => c.method);
const screenshots = (page) => page.calls.filter((c) => c.method === "Page.captureScreenshot");
const same = (problems, what, actual, expected) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) problems.push(`${what}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
};
const matches = (problems, what, lines, expected) => {
  for (const re of expected) if (!lines.some((line) => re.test(line))) problems.push(`${what}: no line matches ${re}`);
  for (const line of lines) if (!expected.some((re) => re.test(line))) problems.push(`${what}: unexpected line: ${line}`);
};

/**
 * A scripted DevTools socket: records every command, answers the ones an attach
 * makes, and answers a page read of the seat's state from `state`.
 */
function fakeSocket(state = {}) {
  const ws = {
    sent: [],
    closed: false,
    listeners: [],
    addEventListener(type, fn) { if (type === "message") this.listeners.push(fn); },
    emit(obj) { for (const fn of this.listeners) fn({ data: JSON.stringify(obj) }); },
    close() { this.closed = true; },
    send(raw) {
      const msg = JSON.parse(raw);
      this.sent.push(msg);
      let result = {};
      if (msg.method === "Target.attachToTarget") result = { sessionId: "S" };
      if (msg.method === "Runtime.evaluate") {
        const e = msg.params.expression;
        let value = true;
        if (e.includes("ready: typeof game")) value = { ready: state.ready ?? true, user: state.user ?? null };
        else if (e.includes("app.close({ animate: false })")) value = "[]";
        result = { result: { value } };
      }
      setImmediate(() => this.emit({ id: msg.id, result }));
    },
  };
  return ws;
}

const CASES = [
  {
    name: "a page at the browser's own address is stray; the driver's page, a document and a worker are not",
    async run(problems) {
      const settings = { targetId: "t-settings", type: "page", url: "CHROME://settings/" };
      const shouted = { targetId: "t-shouted", type: "page", url: "HTTPS://WORLD.INVALID/" };
      const unnamed = { targetId: "t-unnamed", type: "page", url: "" };
      const own = { targetId: OWN, type: "page", url: "chrome://version/" };
      const strays = strayPages([own, DIALOG, FIRST_RUN, BLANK, POPOUT, WORKER, settings, shouted, unnamed], OWN);
      same(problems, "strays", strays.map((t) => t.targetId), ["t-dialog", "t-first-run", "t-settings"]);
      same(problems, "no list", strayPages(undefined, OWN), []);
    },
  },
  {
    name: "an answered call resolves, a refused one rejects, and neither leaves a timer running",
    async run(problems) {
      const socket = scriptedSocket();
      const cdp = new Cdp(socket);
      const before = runningTimers();
      const answered = cdp.send("Runtime.evaluate", { expression: "1" }, "session-1");
      const refused = cdp.send("Target.closeTarget", { targetId: "gone" });
      same(problems, "frames sent", socket.sent, [
        { id: 1, method: "Runtime.evaluate", params: { expression: "1" }, sessionId: "session-1" },
        { id: 2, method: "Target.closeTarget", params: { targetId: "gone" } },
      ]);
      socket.reply({ id: 2, error: { code: -32602, message: "No target with given id found" } });
      socket.reply({ id: 1, result: { result: { value: 1 } } });
      same(problems, "answered", await settledWithin(1000, answered), 'resolved {"result":{"value":1}}');
      same(problems, "refused", await settledWithin(1000, refused), 'rejected {"code":-32602,"message":"No target with given id found"}');
      same(problems, "timers left running", runningTimers() - before, 0);
    },
  },
  {
    name: "a call nothing answers is given up at its own timeout, and a late reply is dropped",
    async run(problems) {
      const socket = scriptedSocket();
      const cdp = new Cdp(socket);
      const call = cdp.send("Page.captureScreenshot", {}, "session-1", 40);
      same(problems, "unanswered", await settledWithin(2000, call), `rejected ${UNANSWERED}`);
      same(problems, "calls still awaiting a reply", cdp.pending.size, 0);
      socket.reply({ id: 1, result: { data: PNG } });
    },
  },
  {
    name: "front closes the browser's own pages once, activates the driver's page, and says it was hidden",
    async run(problems) {
      const page = scriptedPage({ visibility: "hidden", pages: [{ ...DIALOG, stays: true }, FIRST_RUN, BLANK, POPOUT, WORKER] });
      const keeper = pageKeeper(page.channels);
      const first = await collectWarnings(() => keeper.front("compose()"));
      same(problems, "found", first.value, { visibility: "hidden", closed: [DIALOG.url, FIRST_RUN.url] });
      same(problems, "browser commands", methods(page, "browser"), ["Target.getTargets", "Target.closeTarget", "Target.closeTarget"]);
      same(problems, "page commands", methods(page, "page"), ["Page.bringToFront"]);
      same(problems, "pages left", page.targets.map((t) => t.targetId), [OWN, "t-dialog", "t-blank", "t-popout", "t-worker"]);
      matches(problems, "first call", first.lines, [
        /closed a page the browser opened for itself, before compose\(\): edge:\/\/sync-confirmation-dialog\/$/,
        /closed a page the browser opened for itself, before compose\(\): chrome-extension:\/\/\S+\/first-run\.html$/,
        /page was hidden before compose\(\) — brought to front$/,
      ]);
      page.calls.length = 0;
      const second = await collectWarnings(() => keeper.front("shot()"));
      same(problems, "found again", second.value, { visibility: "visible", closed: [] });
      same(problems, "browser commands again", methods(page, "browser"), ["Target.getTargets"]);
      same(problems, "page commands again", methods(page, "page"), ["Page.bringToFront"]);
      matches(problems, "second call", second.lines, []);
    },
  },
  {
    name: "a step the browser refuses is a warning, and the page is still fronted",
    async run(problems) {
      const page = scriptedPage({ pages: [FIRST_RUN], refuse: ["Target.getTargets"] });
      const { value, error, lines } = await collectWarnings(() => pageKeeper(page.channels).front("compose()"));
      same(problems, "threw", error?.message ?? null, null);
      same(problems, "found", value, { visibility: "visible", closed: [] });
      same(problems, "page commands", methods(page, "page"), ["Page.bringToFront"]);
      matches(problems, "warnings", lines, [/listing the browser's pages failed before compose\(\): .*Target\.getTargets refused/]);
    },
  },
  {
    name: "a page that fronting does not show is reported as still hidden; one that shows a moment late is not",
    async run(problems) {
      const stuck = scriptedPage({ visibility: "hidden", fronting: "stuck" });
      const held = await collectWarnings(() => pageKeeper(stuck.channels).front("compose()"));
      same(problems, "found stuck", held.value, { visibility: "hidden", closed: [] });
      matches(problems, "stuck", held.lines, [/page was hidden before compose\(\) and is hidden after fronting/]);
      const late = scriptedPage({ visibility: "hidden", fronting: "lags" });
      const shown = await collectWarnings(() => pageKeeper(late.channels).front("compose()"));
      matches(problems, "late", shown.lines, [/page was hidden before compose\(\) — brought to front$/]);
    },
  },
  {
    name: "compose fronts the page, then closes every window but the subject, unanimated, and clears the toasts",
    async run(problems) {
      const page = scriptedPage({
        visibility: "hidden",
        toasts: 2,
        apps: [
          { id: "sidebar", name: "Sidebar" },
          { id: "sheet-1", name: "ActorSheet" },
          { id: "stubborn", name: "Onboarding", throws: true },
          { id: "dialog-1", name: "DialogV2" },
        ],
      });
      const { value, error, lines } = await collectWarnings(() => pageKeeper(page.channels).compose("#sheet-1"));
      same(problems, "threw", error?.message ?? null, null);
      same(problems, "closed", value, ["Sidebar", "Onboarding", "DialogV2"]);
      const unanimated = { animate: false };
      same(problems, "closes asked for", page.closes,
        [{ id: "sidebar", options: unanimated }, { id: "stubborn", options: unanimated }, { id: "dialog-1", options: unanimated }]);
      same(problems, "windows left", [...page.apps.keys()], ["sheet-1", "stubborn"]);
      same(problems, "toasts left", { inTray: page.toasts.length, queueCleared: page.queueCleared }, { inTray: 0, queueCleared: true });
      const fronted = page.calls.findIndex((c) => c.method === "Page.bringToFront");
      const swept = page.calls.findIndex((c) => c.channel === "evaluate" && c.expression.includes("applications.instances"));
      if (!(fronted >= 0 && fronted < swept)) problems.push("the page was not fronted before its windows were closed");
      matches(problems, "warnings", lines, [/page was hidden before compose\(\) — brought to front$/]);
      const bare = scriptedPage({ apps: [{ id: "a", name: "Players" }, { id: "b", name: "Hotbar" }] });
      same(problems, "closed with no subject", await pageKeeper(bare.channels).compose(), ["Players", "Hotbar"]);
    },
  },
  {
    name: "a capture fronts the page, waits for frames, and hides the tray only while the frame is taken",
    async run(problems) {
      const page = scriptedPage();
      const clip = { x: 80, y: 40, width: 760, height: 827, scale: 1 };
      const { value, lines } = await collectWarnings(() => pageKeeper(page.channels).capture({ clip, subject: "#sheet" }));
      same(problems, "data", value, PNG);
      same(problems, "tray hidden at the capture", page.trayAtCapture, [true]);
      same(problems, "sheets left in the head", page.sheets.size, 0);
      same(problems, "page commands", methods(page, "page"), ["Page.bringToFront", "Page.captureScreenshot"]);
      const [shot] = screenshots(page);
      same(problems, "screenshot params", shot?.params, { format: "png", clip, captureBeyondViewport: false });
      if (!(shot?.timeout > 0 && shot.timeout <= 30_000)) problems.push(`screenshot timeout: got ${shot?.timeout}, expected at most 30000 ms`);
      const probe = page.calls.find((c) => c.channel === "evaluate" && c.expression.includes("requestAnimationFrame"));
      if (!probe || page.calls.indexOf(probe) > page.calls.indexOf(shot)) problems.push("no frame probe ran before the screenshot");
      else {
        same(problems, "frame probe's answer", probe.result, true);
        same(problems, "frames the probe waited for", page.framesRun, 2);
        if (!(probe.timeout > 0)) problems.push("the frame probe carries no timeout of its own");
      }
      const restore = page.calls.filter((c) => c.channel === "evaluate").at(-1);
      if (page.calls.indexOf(restore) < page.calls.indexOf(shot)) problems.push("the tray was not restored after the screenshot");
      else if (!(restore.timeout > 0 && restore.timeout <= 30_000)) problems.push(`tray restore timeout: got ${restore.timeout}, expected at most 30000 ms`);
      matches(problems, "warnings", lines, []);
    },
  },
  {
    name: "a subject inside the tray is shot with the tray showing; an unclipped frame is not",
    async run(problems) {
      const toast = scriptedPage();
      await pageKeeper(toast.channels).capture({ subject: `${TRAY} .notification` });
      same(problems, "tray hidden for a toast", toast.trayAtCapture, [false]);
      const viewport = scriptedPage();
      await pageKeeper(viewport.channels).capture();
      same(problems, "tray hidden for the viewport", viewport.trayAtCapture, [true]);
      same(problems, "viewport screenshot params", screenshots(viewport)[0]?.params, { format: "png", captureBeyondViewport: false });
    },
  },
  {
    name: "a capture nothing answers is tried once more, after fronting the page again",
    async run(problems) {
      const page = scriptedPage({ captures: [UNANSWERED] });
      const { value, lines } = await collectWarnings(() => pageKeeper(page.channels).capture({ subject: "#sheet" }));
      same(problems, "data", value, PNG);
      same(problems, "page commands", methods(page, "page"),
        ["Page.bringToFront", "Page.captureScreenshot", "Page.bringToFront", "Page.captureScreenshot"]);
      same(problems, "tray hidden at each capture", page.trayAtCapture, [true, true]);
      same(problems, "sheets left in the head", page.sheets.size, 0);
      matches(problems, "warnings", lines, [/capture failed \(timeout: Page\.captureScreenshot, animation frames arriving\) — trying once more$/]);
    },
  },
  {
    name: "two failed captures throw, naming both, and the tray is restored",
    async run(problems) {
      const unable = JSON.stringify({ code: -32000, message: "Unable to capture screenshot" });
      const page = scriptedPage({ frames: false, captures: [UNANSWERED, unable, "ok"] });
      const { value, error } = await collectWarnings(() => pageKeeper(page.channels).capture({ subject: "#sheet" }));
      same(problems, "data", value ?? null, null);
      same(problems, "error", error?.message ?? null,
        `foundry-capture: no screenshot in two attempts — ${UNANSWERED}, animation frames not arriving; then ${unable}, animation frames not arriving`);
      same(problems, "screenshots asked for", screenshots(page).length, 2);
      same(problems, "sheets left in the head", page.sheets.size, 0);
    },
  },
  {
    name: "the frame is asked for whatever the frame probe says, or fails to say",
    async run(problems) {
      const still = scriptedPage({ frames: false });
      same(problems, "no frames", await pageKeeper(still.channels).capture(), PNG);
      const mute = scriptedPage({ evaluateFails: (expression) => expression.includes("requestAnimationFrame") });
      same(problems, "no answer", await pageKeeper(mute.channels).capture(), PNG);
    },
  },
  {
    name: "a tray that cannot be restored is a warning, and the frame is still returned",
    async run(problems) {
      const page = scriptedPage({ evaluateFails: (expression, p) => expression.includes("getElementById") && p.trayAtCapture.length > 0 });
      const { value, lines } = await collectWarnings(() => pageKeeper(page.channels).capture({ subject: "#sheet" }));
      same(problems, "data", value, PNG);
      matches(problems, "warnings", lines, [/could not restore the notification tray: timeout: Runtime\.evaluate$/]);
    },
  },
  {
    name: "a fixture nothing carries is built carrying its marker and tracked; the next run finds it and tracks nothing",
    async run(problems) {
      const world = scriptedWorld([{ kind: "Actor", id: "named", name: "Inn" }]);
      const first = fixtureLedger(world.evaluate);
      const built = await collectLog(() => first.fixture("location/inn", "Actor", { name: "Inn", type: "location" }));
      same(problems, "built", built.value, { uuid: "Actor.new1", id: "new1", name: "Inn", marker: "location/inn", built: true });
      same(problems, "creates", world.creates.map((c) => c.data.flags), [{ world: { fixture: "location/inn" } }]);
      same(problems, "marker on the document", world.marker("Actor.new1"), "location/inn");
      same(problems, "first ledger", first.tracked(), [{ uuid: "Actor.new1", kind: "Actor", marker: "location/inn" }]);
      matches(problems, "first run's log", built.lines, [/^ {2}track: Actor\.new1 \[location\/inn\]$/]);
      const { value: again } = await collectLog(() => first.fixture("location/inn", "Actor", { name: "Inn", type: "location" }));
      same(problems, "asked again in the same run", { built: again?.built, uuid: again?.uuid, creates: world.creates.length }, { built: false, uuid: "Actor.new1", creates: 1 });
      same(problems, "first run reuses what it built", first.reused(), []);
      const second = fixtureLedger(world.evaluate);
      const found = await collectLog(() => second.fixture("location/inn", "Actor", { name: "Inn", type: "location" }));
      same(problems, "found", found.value, { uuid: "Actor.new1", id: "new1", name: "Inn", marker: "location/inn", built: false });
      same(problems, "creates after the second run", world.creates.length, 1);
      same(problems, "second ledger", second.tracked(), []);
      same(problems, "second run reused", second.reused(), [{ uuid: "Actor.new1", kind: "Actor", marker: "location/inn" }]);
      matches(problems, "second run's log", found.lines, [/^ {2}found: location\/inn = Actor\.new1$/]);
      same(problems, "second run's report", second.report(), ["  kept: 0 fixture(s) built this run", "  reused: 1 kept fixture(s): Actor.new1 [location/inn]"]);
      same(problems, "first run's report", first.report(), ["  kept: 1 fixture(s) built this run: Actor.new1 [location/inn]", "  reused: 0 kept fixture(s)"]);
    },
  },
  {
    name: "two documents carrying one marker throw, naming both, and nothing is built, retired or marked",
    async run(problems) {
      const world = scriptedWorld([
        { kind: "Actor", id: "a", marker: "henchmen/employer" },
        { kind: "Actor", id: "b", marker: "henchmen/employer" },
        { kind: "Actor", id: "c" },
      ]);
      const ledger = fixtureLedger(world.evaluate);
      const twin = /2 documents carry the marker "henchmen\/employer" \(Actor\.a, Actor\.b\)/;
      for (const [what, step] of [
        ["fixture", () => ledger.fixture("henchmen/employer", "Actor", { name: "Employer" })],
        ["retire", () => ledger.retire("henchmen/employer", "Actor")],
        ["mark", () => ledger.mark("Actor.c", "henchmen/employer")],
      ]) {
        const { error } = await collectLog(step);
        if (!twin.test(error?.message ?? "")) problems.push(`${what}: expected the twin error, got ${error?.message ?? "no error"}`);
      }
      same(problems, "writes", { creates: world.creates.length, updates: world.updates.length, deletes: world.deletes.length }, { creates: 0, updates: 0, deletes: 0 });
      same(problems, "ledger", ledger.tracked(), []);
    },
  },
  {
    name: "a marker on a document of another kind is an error, not a miss",
    async run(problems) {
      const world = scriptedWorld([{ kind: "Item", id: "i", marker: "markets/stock" }]);
      const { error } = await collectLog(() => fixtureLedger(world.evaluate).fixture("markets/stock", "Actor", { name: "Stock" }));
      same(problems, "error", error?.message ?? null, 'foundry-capture: the marker "markets/stock" is on a Item (Item.i), not a Actor');
      same(problems, "creates", world.creates.length, 0);
    },
  },
  {
    name: "a session's own tag builds beside the recipe's fixture, and neither lookup meets the other",
    async run(problems) {
      const world = scriptedWorld([{ kind: "Actor", id: "party", marker: "formation/party" }]);
      const peer = fixtureLedger(world.evaluate, { own: "s2" });
      const own = await collectLog(() => peer.fixture("formation/party", "Actor", { name: "Party" }));
      same(problems, "own built", { uuid: own.value?.uuid, marker: own.value?.marker, built: own.value?.built }, { uuid: "Actor.new1", marker: "formation/party@s2", built: true });
      same(problems, "own marker on the document", world.marker("Actor.new1"), "formation/party@s2");
      const recipe = await collectLog(() => fixtureLedger(world.evaluate).fixture("formation/party", "Actor", { name: "Party" }));
      same(problems, "recipe's lookup", { uuid: recipe.value?.uuid, built: recipe.value?.built, error: recipe.error?.message ?? null }, { uuid: "Actor.party", built: false, error: null });
      const { value: ownAgain } = await collectLog(() => fixtureLedger(world.evaluate, { own: "s2" }).fixture("formation/party", "Actor", { name: "Party" }));
      same(problems, "own found again", { uuid: ownAgain?.uuid, built: ownAgain?.built }, { uuid: "Actor.new1", built: false });
      same(problems, "creates", world.creates.length, 1);
      let refused = null;
      try { fixtureLedger(world.evaluate, { own: "S 2" }); } catch (err) { refused = err.message; }
      same(problems, "a tag that is not a slug", refused, 'foundry-capture: own tag "S 2" is not lowercase letters, digits and dashes');
    },
  },
  {
    name: "an embedded fixture is looked up inside its parent and built there",
    async run(problems) {
      const world = scriptedWorld([
        { kind: "Actor", id: "beast", marker: "lib/beast" },
        { kind: "Actor", id: "other" },
        { kind: "Item", id: "elsewhere", marker: "lib/power", parent: "Actor.other" },
      ]);
      const first = fixtureLedger(world.evaluate);
      const { value: power } = await collectLog(() => first.fixture("lib/power", "Item", { name: "Keen Nose", type: "ability" }, { parent: "Actor.beast" }));
      same(problems, "built inside the parent", { uuid: power?.uuid, built: power?.built, parent: world.creates[0]?.parent }, { uuid: "Actor.beast.Item.new1", built: true, parent: "Actor.beast" });
      same(problems, "first ledger", first.tracked(), [{ uuid: "Actor.beast.Item.new1", kind: "Item", marker: "lib/power" }]);
      const { value: again } = await collectLog(() => fixtureLedger(world.evaluate).fixture("lib/power", "Item", { name: "Keen Nose", type: "ability" }, { parent: "Actor.beast" }));
      same(problems, "found inside the parent", { uuid: again?.uuid, built: again?.built }, { uuid: "Actor.beast.Item.new1", built: false });
      const { error } = await collectLog(() => first.fixture("lib/power", "Item", { name: "Keen Nose" }, { parent: "Actor.gone" }));
      same(problems, "a parent that does not resolve", error?.message ?? null, 'foundry-capture: looking up "lib/power" — parent not found: Actor.gone');
      same(problems, "creates", world.creates.length, 1);
    },
  },
  {
    name: "a marker is <feature>/<name>, data cannot carry another, and a bad one reaches no page",
    async run(problems) {
      const world = scriptedWorld();
      const ledger = fixtureLedger(world.evaluate);
      for (const marker of ["inn", "Location/inn", "a/b/c", "a/b@s2", "a/", "/b", null]) {
        const { error } = await collectLog(() => ledger.fixture(marker, "Actor", { name: "X" }));
        if (!/is not <feature>\/<name>/.test(error?.message ?? "")) problems.push(`marker ${JSON.stringify(marker)}: got ${error?.message ?? "no error"}`);
      }
      const stated = await collectLog(() => ledger.fixture("location/inn", "Actor", { name: "X", flags: { world: { fixture: "location/tavern" } } }));
      same(problems, "data marked otherwise", stated.error?.message ?? null, 'foundry-capture: fixture("location/inn") was handed data marked "location/tavern"');
      const kind = await collectLog(() => ledger.fixture("location/inn", "actor", { name: "X" }));
      same(problems, "a kind that is not a type name", kind.error?.message ?? null, 'foundry-capture: fixture() needs a document type name, got "actor"');
      same(problems, "page evaluations", world.evaluations, 0);
    },
  },
  {
    name: "retire deletes the one kept fixture alone, and the run's other fixtures stand",
    async run(problems) {
      const world = scriptedWorld([{ kind: "Actor", id: "employer", marker: "henchmen/employer" }]);
      const ledger = fixtureLedger(world.evaluate);
      const { value: hench } = await collectLog(() => ledger.fixture("henchmen/hench", "Actor", { name: "Hench" }));
      const retired = await collectLog(() => ledger.retire("henchmen/employer", "Actor"));
      same(problems, "removed", retired.value?.removed?.map((e) => e.uuid), ["Actor.employer"]);
      same(problems, "deletes", world.deletes, ["Actor.employer"]);
      same(problems, "the run's own fixture stands", { stands: world.has(hench?.uuid), ledger: ledger.tracked().map((e) => e.uuid) }, { stands: true, ledger: [hench?.uuid] });
      const none = await collectLog(() => ledger.retire("henchmen/employer", "Actor"));
      same(problems, "nothing standing", none.value, { removed: [], missing: [], failed: [] });
      matches(problems, "nothing standing, said", none.lines, [/^ {2}retire: henchmen\/employer — none standing$/]);
      same(problems, "deletes after the second retire", world.deletes.length, 1);
    },
  },
  {
    name: "a sweep limited to named uuids deletes those alone, and a uuid off the ledger is refused",
    async run(problems) {
      const world = scriptedWorld([{ kind: "Actor", id: "theirs" }]);
      const ledger = fixtureLedger(world.evaluate);
      const made = [];
      await collectLog(async () => { for (const name of ["A", "B", "C"]) made.push((await ledger.create("Actor", { name })).uuid); });
      const one = await ledger.sweepTracked({ only: [made[1]] });
      same(problems, "removed", one.removed.map((e) => e.uuid), [made[1]]);
      same(problems, "ledger after", ledger.tracked().map((e) => e.uuid), [made[0], made[2]]);
      const { error } = await collectLog(() => ledger.sweepTracked({ only: ["Actor.theirs"] }));
      same(problems, "off the ledger", error?.message ?? null, "foundry-capture: sweepTracked({only}) names Actor.theirs, which this run has not tracked");
      same(problems, "theirs stands", world.has("Actor.theirs"), true);
      await ledger.sweepTracked();
      same(problems, "deletes, newest first", world.deletes, [made[1], made[2], made[0]]);
    },
  },
  {
    name: "mark puts the marker on what a setup produced and tracks it; a marker already elsewhere is refused",
    async run(problems) {
      const world = scriptedWorld([
        { kind: "Actor", id: "made" },
        { kind: "Actor", id: "old", marker: "importer/pregen" },
        { kind: "Actor", id: "keeper", marker: "importer/keeper" },
      ]);
      const ledger = fixtureLedger(world.evaluate);
      const taken = await collectLog(() => ledger.mark("Actor.made", "importer/pregen"));
      same(problems, "taken", taken.error?.message ?? null, 'foundry-capture: mark(Actor.made) — the marker "importer/pregen" is on Actor.old already');
      same(problems, "updates after the refusal", world.updates.length, 0);
      const marked = await collectLog(() => ledger.mark("Actor.made", "importer/made"));
      same(problems, "marked", { value: marked.value, marker: world.marker("Actor.made"), updates: world.updates.length }, { value: "Actor.made", marker: "importer/made", updates: 1 });
      matches(problems, "marked, said", marked.lines, [/^ {2}track: Actor\.made \[importer\/made\]$/, /^ {2}marked: importer\/made = Actor\.made$/]);
      await collectLog(() => ledger.mark("Actor.keeper", "importer/keeper"));
      same(problems, "a document already carrying its marker is not written", world.updates.length, 1);
      same(problems, "ledger", ledger.tracked(), [
        { uuid: "Actor.made", kind: "Actor", marker: "importer/made" },
        { uuid: "Actor.keeper", kind: "Actor", marker: "importer/keeper" },
      ]);
      const pack = await collectLog(() => ledger.mark("Compendium.acks.pack.Actor.x", "importer/pack"));
      same(problems, "a compendium document", pack.error?.message ?? null, 'foundry-capture: "Compendium.acks.pack.Actor.x" is in a compendium — a fixture is a world document');
    },
  },
  {
    name: "a Cdp hands events to its listeners, never breaks on a listener that throws, and still answers commands",
    async run(problems) {
      const ws = fakeSocket();
      const cdp = new Cdp(ws);
      const seen = [];
      cdp.onEvent(() => { throw new Error("a listener fails"); });
      cdp.onEvent((msg) => seen.push(msg.method));
      ws.emit({ method: "Runtime.consoleAPICalled", params: {}, sessionId: "S" });
      const pending = cdp.send("Page.enable", {}, "S");
      ws.emit({ id: 1, result: { ok: true } });
      same(problems, "events", seen, ["Runtime.consoleAPICalled"]);
      same(problems, "reply", await pending, { ok: true });
    },
  },
  {
    name: "attachMap reads the seats a runner keeps from ACKS_ATTACH and is empty when it is unset or unreadable",
    async run(problems) {
      same(problems, "unset", attachMap({}), {});
      same(problems, "unreadable", attachMap({ ACKS_ATTACH: "{not json" }), {});
      same(problems, "not an object", attachMap({ ACKS_ATTACH: "null" }), {});
      const spec = { 9483: { ws: "ws://x/1", targetId: "T1", user: "Gamemaster" } };
      same(problems, "read", attachMap({ ACKS_ATTACH: JSON.stringify(spec) }), spec);
    },
  },
  {
    name: "attachSeat attaches to the kept page as its user, and close() resets the page and drops only its own socket",
    async run(problems) {
      const ws = fakeSocket({ user: "Gamemaster" });
      const handle = await attachSeat({ spec: { ws: "ws://x/1", targetId: "T1", user: "Gamemaster" }, user: "Gamemaster", open: async () => ws });
      const first = ws.sent.find((m) => m.method === "Target.attachToTarget");
      same(problems, "attached to the kept target, flattened", first?.params, { targetId: "T1", flatten: true });
      same(problems, "no page was created and no browser command sent", ws.sent.filter((m) => /^(Target.(createTarget|closeTarget)|Browser.)/.test(m.method)).length, 0);
      handle.close();
      for (let n = 0; n < 50 && !ws.closed; n++) await new Promise((r) => setTimeout(r, 10));
      same(problems, "socket closed", ws.closed, true);
      const evals = ws.sent.filter((m) => m.method === "Runtime.evaluate").map((m) => m.params.expression);
      const compose = evals.findIndex((e) => e.includes("app.close({ animate: false })"));
      const reset = evals.findIndex((e) => e.includes("ui.combat.viewed = null"));
      same(problems, "windows closed before the combat and tokens are released", compose >= 0 && reset > compose, true);
      same(problems, "the browser was not told to close", ws.sent.some((m) => /^Browser.close|^Target.closeTarget/.test(m.method)), false);
    },
  },
  {
    name: "attachSeat refuses a kept page that is another user's or not ready, and closes its socket",
    async run(problems) {
      for (const [label, state] of [["another user", { user: "Player" }], ["not ready", { user: "Gamemaster", ready: false }]]) {
        const ws = fakeSocket(state);
        const error = await attachSeat({ spec: { ws: "ws://x/1", targetId: "T1", user: "Gamemaster" }, user: "Gamemaster", open: async () => ws }).then(() => null, (e) => e.message);
        matches(problems, label, [error ?? ""], [/kept page is/]);
        same(problems, `${label}: socket closed`, ws.closed, true);
      }
    },
  },
  {
    name: "connect() on another port for a user the runner keeps is an error that names the fresh-page declaration, before any browser",
    async run(problems) {
      const before = process.env.ACKS_ATTACH;
      process.env.ACKS_ATTACH = JSON.stringify({ 9483: { ws: "ws://x/1", targetId: "T1", user: "Gamemaster" } });
      try {
        const error = await connect({ browser: "no-such-browser.exe", origin: "http://world.invalid", user: "Gamemaster", port: 9999 }).then(() => null, (e) => e.message);
        matches(problems, "refused", [error ?? ""], [/keeps "Gamemaster" open on port 9483/, /fresh-page/]);
      } finally {
        if (before === undefined) delete process.env.ACKS_ATTACH; else process.env.ACKS_ATTACH = before;
      }
    },
  },
];

let failures = 0;
for (const testCase of CASES) {
  const problems = [];
  try {
    await testCase.run(problems);
  } catch (err) {
    problems.push(`threw: ${err.stack ?? err}`);
  }
  if (problems.length) {
    failures++;
    console.log(`FAIL ${testCase.name}\n  ${problems.join("\n  ")}`);
  } else console.log(`ok   ${testCase.name}`);
}
const shown = path.relative(TEMPLATE_ROOT, DRIVER);
console.log(`test-foundry-capture: ${CASES.length} cases against ${shown.startsWith("..") ? DRIVER : shown}, ${failures} failed`);
if (failures) process.exit(1);
