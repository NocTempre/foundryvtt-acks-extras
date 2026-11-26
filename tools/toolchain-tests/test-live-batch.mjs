/**
 * Checks the live runner's batch mode, `tools/live/_batch.mjs`, against scripted
 * seats: what a walk's source says about the seats it names and a fresh page
 * (`seatPlan`), the runner's flags (`batchOptions`), and the kept seats
 * (`SeatKeeper`): launched when a walk names them and closed when it does not,
 * loaded again after a walk that did not pass or left a console error, every N
 * walks, when the runtime tree id changed, and when the page is not ready as its
 * user; closed for a fresh-page walk and relaunched after; the attach map each
 * walk is handed; and everything ended by `closeAll`.
 *
 * Nothing here launches a browser: the real attach and the page reads are
 * `test-foundry-capture.mjs` and a live run.
 *
 * Usage:  node tools/toolchain-tests/test-live-batch.mjs [<_batch.mjs>]
 *         (defaults to tools/live/_batch.mjs; pass a modified copy to confirm a
 *         case fails when the behaviour it guards is broken)
 */
import path from "node:path";
import url from "node:url";

const ROOT = path.dirname(path.dirname(path.dirname(url.fileURLToPath(import.meta.url))));
const BATCH = path.resolve(process.argv[2] ?? path.join(ROOT, "tools", "live", "_batch.mjs"));
const { SeatKeeper, batchOptions, seatPlan } = await import(url.pathToFileURL(BATCH).href);

const same = (problems, what, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) problems.push(`${what}: expected ${e}, got ${a}`);
};

const DEFS = [{ name: "gm", port: 9483, user: "Gamemaster" }, { name: "player", port: 9484, user: "Player" }];

/** A keeper over scripted seats; `world` records what was launched, loaded again, settled and ended. */
function scripted({ refreshEvery = 3, alive = () => true } = {}) {
  const world = { launched: [], joined: [], ended: [], settled: [], errors: {}, logs: [], count: 0 };
  const keeper = new SeatKeeper({
    seats: DEFS,
    refreshEvery,
    log: (line) => world.logs.push(line),
    settle: async (handle) => { world.settled.push(handle.def.name); },
    launch: async (def) => {
      world.launched.push(def.name);
      const id = ++world.count;
      return {
        def,
        wsUrl: `ws://browser/${def.name}/${id}`,
        targetId: `T-${def.name}-${id}`,
        join: async () => { world.joined.push(def.name); },
        alive: async () => alive(def.name),
        errors: () => world.errors[def.name]?.splice(0) ?? [],
        boot: async () => world.boot?.[def.name] ?? null,
        cleanup: () => { world.ended.push(def.name); },
      };
    },
  });
  return { keeper, world };
}

const CASES = [
  {
    name: "the keeper logs the boot record of a launched and a reloaded seat, with each error by its phase",
    async run(problems) {
      const { keeper, world } = scripted();
      world.boot = { gm: { phases: ["init", "setup"], errors: [{ phase: "setup", kind: "console", text: "a hook threw" }] } };
      await keeper.prepare({ fresh: null, gm: true, player: false }, "t1");
      same(problems, "the launch line carries the boot record, error and phase included", world.logs.some((l) => l.includes("[boot: ") && l.includes("a hook threw") && l.includes("setup")), true);
      world.boot.gm = { phases: ["init", "setup", "ready"], errors: [] };
      keeper.after({ passed: false });
      await keeper.prepare({ fresh: null, gm: true, player: false }, "t1");
      same(problems, "the reload line carries the new boot record", world.logs.some((l) => l.includes("loaded again") && l.includes("[boot: ") && l.includes("ready")), true);
    },
  },
  {
    name: "seatPlan reads the seats a walk names and a fresh-page declaration in its head",
    async run(problems) {
      same(problems, "gm only", seatPlan("connect({ port: PORTS.gm })"), { fresh: null, gm: true, player: false });
      same(problems, "both", seatPlan("PORTS.gm and PORTS.player"), { fresh: null, gm: true, player: true });
      same(problems, "gm2 is not gm", seatPlan("connect({ port: PORTS.gm2 })"), { fresh: null, gm: false, player: false });
      same(problems, "neither", seatPlan("connect({ port: 9333 })"), { fresh: null, gm: false, player: false });
      same(problems, "declared", seatPlan("/**\n * fresh-page: reads the load\n */\nPORTS.gm").fresh, "reads the load");
      same(problems, "declared as a line comment", seatPlan("// fresh-page: popout\nPORTS.gm").fresh, "popout");
      same(problems, "past the head it is not a declaration", seatPlan(`${"\n".repeat(90)}// fresh-page: late`).fresh, null);
    },
  },
  {
    name: "batchOptions: --attach and --fresh decide, the default is a run of more than one walk, --refresh-every takes a count",
    async run(problems) {
      same(problems, "flag attach", batchOptions(["--attach", "a"], { attachDefault: false }).attach, true);
      same(problems, "flag fresh", batchOptions(["--fresh", "a", "b"], { attachDefault: true }).attach, false);
      same(problems, "default off", batchOptions(["a", "b"], { attachDefault: false }).attach, false);
      same(problems, "default on, two walks", batchOptions(["a", "b"], { attachDefault: true }).attach, true);
      same(problems, "default on, one walk", batchOptions(["a"], { attachDefault: true }).attach, false);
      same(problems, "default on, every walk", batchOptions([], { attachDefault: true }).attach, true);
      const o = batchOptions(["--refresh-every", "4", "a"], { attachDefault: false });
      same(problems, "refresh count and walks", [o.refreshEvery, o.rest], [4, ["a"]]);
      same(problems, "default refresh", batchOptions(["a"], { attachDefault: false }).refreshEvery, 10);
      same(problems, "bad count", typeof batchOptions(["--refresh-every", "x"], { attachDefault: false }).error, "string");
    },
  },
  {
    name: "the keeper launches the seats a walk names, hands out their attach map, and closes the ones the next walk does not name",
    async run(problems) {
      const { keeper, world } = scripted();
      const map = await keeper.prepare({ fresh: null, gm: true, player: true }, "tree-1");
      same(problems, "launched", world.launched, ["gm", "player"]);
      same(problems, "map", map, { 9483: { ws: "ws://browser/gm/1", targetId: "T-gm-1", user: "Gamemaster" }, 9484: { ws: "ws://browser/player/2", targetId: "T-player-2", user: "Player" } });
      same(problems, "settled after each launch", world.settled, ["gm", "player"]);
      same(problems, "ports", [...keeper.ports()].sort(), [9483, 9484]);
      keeper.after({ passed: true });
      const next = await keeper.prepare({ fresh: null, gm: true, player: false }, "tree-1");
      same(problems, "player closed, gm kept as it was", [world.ended, world.launched, Object.keys(next)], [["player"], ["gm", "player"], ["9483"]]);
      keeper.closeAll();
      same(problems, "closeAll ends the rest", world.ended, ["player", "gm"]);
      same(problems, "nothing left", keeper.names(), []);
    },
  },
  {
    name: "a seat is loaded again after a failed walk, an error on the page, N walks, a changed tree and a page not ready, and only then",
    async run(problems) {
      let ready = true;
      const { keeper, world } = scripted({ refreshEvery: 3, alive: () => ready });
      const plan = { fresh: null, gm: true, player: false };
      await keeper.prepare(plan, "t1");
      keeper.after({ passed: true });
      await keeper.prepare(plan, "t1");
      same(problems, "a passed walk with no error: no reload", world.joined, []);
      world.errors.gm = ["Uncaught TypeError: x"];
      same(problems, "marked for an error", keeper.after({ passed: true }).map((m) => m.seat), ["gm"]);
      await keeper.prepare(plan, "t1");
      same(problems, "reloaded after the error", world.joined, ["gm"]);
      keeper.after({ passed: false });
      await keeper.prepare(plan, "t1");
      same(problems, "reloaded after a failed walk", world.joined, ["gm", "gm"]);
      for (let i = 0; i < 3; i++) { keeper.after({ passed: true }); }
      await keeper.prepare(plan, "t1");
      same(problems, "reloaded after 3 walks", world.joined.length, 3);
      keeper.after({ passed: true });
      await keeper.prepare(plan, "t2");
      same(problems, "reloaded when the tree changed", world.joined.length, 4);
      ready = false;
      await keeper.prepare(plan, "t2");
      same(problems, "reloaded when the page is not ready as its user", world.joined.length, 5);
      ready = true;
      keeper.after({ passed: true });
      await keeper.prepare(plan, "t2");
      same(problems, "no reload when none of it holds", world.joined.length, 5);
      same(problems, "no second launch", world.launched, ["gm"]);
    },
  },
  {
    name: "a fresh-page walk closes every seat and gets no attach map; the next walk launches the seats again",
    async run(problems) {
      const { keeper, world } = scripted();
      await keeper.prepare({ fresh: null, gm: true, player: true }, "t1");
      keeper.after({ passed: true });
      const map = await keeper.prepare({ fresh: "reads the load", gm: true, player: false }, "t1");
      same(problems, "no map", map, null);
      same(problems, "every seat ended", world.ended.sort(), ["gm", "player"]);
      same(problems, "no seat kept", keeper.names(), []);
      await keeper.prepare({ fresh: null, gm: true, player: false }, "t1");
      same(problems, "launched again", world.launched, ["gm", "player", "gm"]);
      matches(problems, world.logs);
    },
  },
  {
    name: "a walk that names neither seat runs with no seat kept and an empty attach map",
    async run(problems) {
      const { keeper, world } = scripted();
      await keeper.prepare({ fresh: null, gm: true, player: false }, "t1");
      const map = await keeper.prepare({ fresh: null, gm: false, player: false }, "t1");
      same(problems, "empty map", map, {});
      same(problems, "gm ended", world.ended, ["gm"]);
    },
  },
  {
    name: "the load's console errors are logged by the runner at launch, and do not mark the seat",
    async run(problems) {
      const { keeper, world } = scripted();
      world.errors.gm = ["a module failed to load"];
      await keeper.prepare({ fresh: null, gm: true, player: false }, "t1");
      same(problems, "logged", world.logs.some((l) => /1 console error\(s\) while loading/.test(l)), true);
      same(problems, "not marked", keeper.after({ passed: true }), []);
    },
  },
];

function matches(problems, logs) {
  if (!logs.some((l) => /seats closed for a fresh page \(reads the load\)/.test(l))) problems.push(`the fresh page was not logged: ${JSON.stringify(logs)}`);
}

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
const shown = path.relative(ROOT, BATCH);
console.log(`test-live-batch: ${CASES.length} cases against ${shown.startsWith("..") ? BATCH : shown}, ${failures} failed`);
if (failures) process.exit(1);
