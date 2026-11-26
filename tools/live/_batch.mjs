/**
 * The runner's batch mode: the seats' browsers are the runner's for the length of
 * a batch, and each walk attaches to the page the runner keeps open for a seat
 * instead of launching its own (`_capture.mjs`, `attachSeat`). A walk pays the
 * page load and the library warm once for the batch, not once for itself.
 *
 * What a kept page must not carry from one walk to the next is the runner's to
 * prevent, and it does so in four ways:
 *
 *  - **Refresh.** A seat's page is loaded again every `refreshEvery` walks, and
 *    after any walk that did not pass, wrote a console error or an uncaught
 *    exception to the page, or whose seat the runner finds not ready as its user.
 *    The errors are read from the browser's own events on the runner's own
 *    session, so a walk's recorders are not needed for it.
 *  - **The tree.** The page is loaded again when the runtime tree id differs from
 *    the one it loaded under, so a landing between two walks never leaves a kept
 *    page running code the walk's record does not name.
 *  - **Which seats are up.** A walk that never names the Player seat runs with no
 *    Player joined, as it does fresh. The seats a walk names are found in its source
 *    (`seatPlan`); a seat it names that is not up is launched by the walk itself.
 *  - **Fresh pages.** A walk whose subject is the page's own load, or that cannot
 *    share a seat, declares `// fresh-page: <reason>` in its first lines. The
 *    runner closes its seats before such a walk and relaunches them after.
 *
 * Nothing here launches a browser itself: `launch(seat)` and the page settle are
 * given, so this file is tested against scripted seats.
 */

/** How many lines of a walk its `fresh-page` declaration may sit in. */
const HEAD_LINES = 80;

/**
 * What a walk's source says about the page it needs: `fresh`, the reason it
 * declared (`// fresh-page: <reason>`) or null; and `gm` / `player`, whether it
 * names that seat's port. A walk naming neither seat is run as it ran before,
 * which is what an unrecognised connect call does.
 * @param {string} source
 */
export function seatPlan(source) {
  const head = String(source).split(/\r?\n/u).slice(0, HEAD_LINES).join("\n");
  const marker = /^\s*(?:\/\/|\*)\s*fresh-page:\s*(\S.*?)\s*$/mu.exec(head);
  return {
    fresh: marker ? marker[1] : null,
    gm: /\bPORTS\.gm\b/u.test(source),
    player: /\bPORTS\.player\b/u.test(source),
  };
}

/**
 * The batch's options from the runner's arguments: `--attach`, `--fresh`,
 * `--refresh-every <n>`. Returns `{ attach, refreshEvery, rest, error }`, `rest`
 * being the arguments that are walk names. `attachDefault` is the mode of a run
 * of more than one walk with neither flag.
 * @param {string[]} argv
 * @param {{attachDefault: boolean}} options
 */
export function batchOptions(argv, { attachDefault }) {
  let attach = null;
  let refreshEvery = 10;
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--attach") attach = true;
    else if (a === "--fresh") attach = false;
    else if (a === "--refresh-every") {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 1) return { error: "--refresh-every takes a whole number of walks, 1 or more" };
      refreshEvery = n;
    } else rest.push(a);
  }
  return { attach: attach ?? (attachDefault && rest.length !== 1), refreshEvery, rest, error: null };
}

/**
 * The kept seats of a batch. A seat is `{ name, port, user }`; `launch(seat)`
 * resolves to the page handle `launchSeat` returns (with `wsUrl`, `targetId`,
 * `join()`, `alive()`, `errors()` and `cleanup()`), and `settle(handle)` waits
 * for the page's library to be loaded. Both are given by the runner.
 */
export class SeatKeeper {
  constructor({ seats, launch, settle = async () => {}, refreshEvery = 10, log = () => {} }) {
    this.defs = seats;
    this.launch = launch;
    this.settle = settle;
    this.refreshEvery = refreshEvery;
    this.log = log;
    /** @type {Map<string, {def: object, handle: object, tree: string, uses: number, dirty: string|null}>} */
    this.kept = new Map();
  }

  /** The ports of the seats now up. */
  ports() {
    return new Set([...this.kept.values()].map((k) => k.def.port));
  }

  /** The names of the seats now up. */
  names() {
    return [...this.kept.keys()];
  }

  async #open(def, tree, why) {
    const handle = await this.launch(def);
    const loadErrors = handle.errors?.() ?? [];
    await this.settle(handle);
    this.kept.set(def.name, { def, handle, tree, uses: 0, dirty: null });
    this.log(`seat ${def.name}: ${why}${loadErrors.length ? `; ${loadErrors.length} console error(s) while loading: ${loadErrors.slice(0, 3).map((e) => e.slice(0, 100)).join(" | ")}` : "; no console error while loading"}`);
  }

  async #reload(entry, tree, why) {
    await entry.handle.join();
    const loadErrors = entry.handle.errors?.() ?? [];
    await this.settle(entry.handle);
    Object.assign(entry, { tree, uses: 0, dirty: null });
    this.log(`seat ${entry.def.name}: loaded again (${why})${loadErrors.length ? `; ${loadErrors.length} console error(s) while loading` : ""}`);
  }

  /**
   * Brings the kept seats to what a walk needs, under the lease the caller holds
   * at runtime tree id `tree`. A fresh walk closes every seat and answers null;
   * otherwise the seats the plan names are up and current and the others are
   * closed, and the answer is the `ACKS_ATTACH` map for the walk's environment.
   * @param {{fresh: string|null, gm: boolean, player: boolean}} plan
   * @param {string} tree
   * @returns {Promise<Record<string, {ws: string, targetId: string, user: string}>|null>}
   */
  async prepare(plan, tree) {
    if (plan.fresh) {
      if (this.kept.size) this.log(`seats closed for a fresh page (${plan.fresh})`);
      this.closeAll();
      return null;
    }
    const wanted = this.defs.filter((d) => plan[d.name]);
    for (const [name, entry] of [...this.kept]) {
      if (wanted.some((d) => d.name === name)) continue;
      entry.handle.cleanup();
      this.kept.delete(name);
      this.log(`seat ${name}: closed, the next walk does not name it`);
    }
    const map = {};
    for (const def of wanted) {
      let entry = this.kept.get(def.name);
      if (!entry) await this.#open(def, tree, "launched");
      else {
        const why = entry.dirty ?? (entry.tree !== tree ? "the runtime tree changed" : entry.uses >= this.refreshEvery ? `${entry.uses} walks since it was loaded` : !(await entry.handle.alive()) ? "the page was not ready as its user" : null);
        if (why) await this.#reload(entry, tree, why);
      }
      entry = this.kept.get(def.name);
      map[def.port] = { ws: entry.handle.wsUrl, targetId: entry.handle.targetId, user: def.user };
    }
    return map;
  }

  /**
   * Records a walk's end: each seat it used counts one more walk, and is marked
   * for a reload after a walk that did not pass or left a console error or an
   * uncaught exception on the page. Returns the seats marked, with why.
   * @param {{passed: boolean}} outcome
   */
  after({ passed }) {
    const marked = [];
    for (const entry of this.kept.values()) {
      entry.uses += 1;
      const errors = entry.handle.errors?.() ?? [];
      const why = !passed ? "the walk did not pass" : errors.length ? `${errors.length} console error(s) or exception(s) on the page` : null;
      if (why) { entry.dirty = why; marked.push({ seat: entry.def.name, why }); }
    }
    return marked;
  }

  /** Ends every kept browser. Synchronous, so it can run from an exit handler. */
  closeAll() {
    for (const entry of this.kept.values()) {
      try { entry.handle.cleanup(); } catch { /* gone */ }
    }
    this.kept.clear();
  }
}

/** The page-side wait for the library's shelves to be loaded, as a seat's settle step. */
export const LIBRARY_READY = `(async () => {
  try {
    const L = await import("/modules/acks-extras/scripts/lib/library.mjs");
    await L.whenReady();
    return true;
  } catch { return false; }
})()`;
