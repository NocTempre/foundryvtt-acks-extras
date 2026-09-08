/**
 * Take the seat without Discord, run a few bridge commands as the seat, and
 * leave. The operator's smoke test for the Foundry half, and the live-test
 * recipe's driver: it proves the browser launches, the user joins, the
 * module answers, events arrive, and — the point of the check — that a
 * WRITE actually lands, not just that a read comes back. `commands`,
 * `users`, `parties` and `whoami` are all local reads of data the seat
 * already has cached; a world whose writes hang answers every one of them
 * and never once touches the network. `config` and `announce` are what the
 * running bot calls at every start (`main.mjs`), and `announce` is a real
 * write — `game.settings.set` on the world's `bridgeAgent` setting — so this
 * closes the loop: write, then read the value back through a fresh `config`
 * call to prove it was the WORLD that has the new value, not a promise that
 * merely resolved.
 *
 *   npm run seat:check
 *   npm run seat:check -- --roll "Actor.xxxx" "save:death"
 */
import { loadConfig } from "./config.mjs";
import { createLog } from "./log.mjs";
import { Seat } from "./seat.mjs";
import { Bridge } from "./bridge.mjs";

/** Above this, a write that still succeeded is reported as slow rather than silently timed. Ordinary bridge calls run in the tens of milliseconds (docs/bridge/MODEL.md). */
const SLOW_WRITE_MS = 2000;
/** A write given this long to land is either hung or as good as — the same shape of failure a `Runtime.evaluate` timeout already reports, just far short of it. */
const WRITE_TIMEOUT_MS = 15000;

const config = loadConfig({ discord: false });
const log = createLog("debug");
const seat = new Seat({ ...config.seat, ...config.foundry }, log);
const events = [];
seat.on("event", (ev) => events.push(ev));

try {
  await seat.start();
  const bridge = new Bridge(seat);
  const asSeat = (name, args = {}, opts) => bridge.run(name, { client: { kind: "discord", user: "seat-check" }, asSeat: true, ...args }, opts);
  const timed = async (label, fn) => {
    const started = Date.now();
    const value = await fn();
    const ms = Date.now() - started;
    log.info(`${label}: ${ms}ms${ms > SLOW_WRITE_MS ? " — SLOW" : ""}`);
    if (ms > SLOW_WRITE_MS) throw new Error(`${label} took ${ms}ms, past the ${SLOW_WRITE_MS}ms a document write should need — this is what a hung write looks like before it times out outright`);
    return value;
  };

  log.info(`commands: ${(await asSeat("commands")).map((c) => c.name).join(" ")}`);
  log.info(`users: ${(await asSeat("users")).map((u) => `${u.name}${u.isGM ? "*" : ""}`).join(", ")}`);
  log.info(`parties: ${JSON.stringify(await asSeat("parties"))}`);
  const who = await asSeat("whoami");
  log.info(`whoami: ${JSON.stringify({ user: who.user?.name, judge: who.judge, characters: who.characters?.length })}`);

  // The two commands the running bot actually calls to start (main.mjs), and
  // the write round-trip: announce a value nobody else would write, then
  // read it straight back through a second, independent call. `announce`
  // reporting {ok:true} is not proof the setting was persisted — only
  // seeing it again through `config` is.
  await timed("config", () => asSeat("config", {}, { timeout: WRITE_TIMEOUT_MS }));
  const nonce = `seat-check ${Date.now()}`;
  await timed("announce (write)", () => asSeat("announce", { agent: { status: { state: "checking", message: nonce, at: Date.now() } } }, { timeout: WRITE_TIMEOUT_MS }));
  const reread = await timed("config (write round-trip)", () => asSeat("config", {}, { timeout: WRITE_TIMEOUT_MS }));
  if (reread.agent?.status?.message !== nonce) {
    throw new Error("write round-trip: announce reported success but a fresh read did not see it — the write did not land");
  }

  const [, , flag, uuid, id] = process.argv;
  if (flag === "--roll" && uuid && id) {
    const r = await asSeat("roll", { uuid, id });
    log.info(`roll ${id}: ${JSON.stringify(r.messages.map((m) => ({ flavor: m.flavor, rolls: m.rolls, text: m.text.slice(0, 120) })))}`);
  }
  await new Promise((r) => setTimeout(r, 1500));
  log.info(`events heard: ${events.length}${events.length ? ` (last: ${events.at(-1).type} #${events.at(-1).seq})` : ""}`);
  log.info("seat check: OK");
} catch (err) {
  log.error(`seat check FAILED: ${err.message}`);
  process.exitCode = 1;
} finally {
  await seat.stop();
}
