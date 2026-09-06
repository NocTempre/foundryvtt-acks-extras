/**
 * Take the seat without Discord, run a few bridge commands as the seat, and
 * leave. The operator's smoke test for the Foundry half, and the live-test
 * recipe's driver: it proves the browser launches, the user joins, the
 * module answers, and events arrive — everything short of the token.
 *
 *   npm run seat:check
 *   npm run seat:check -- --roll "Actor.xxxx" "save:death"
 */
import { loadConfig } from "./config.mjs";
import { createLog } from "./log.mjs";
import { Seat } from "./seat.mjs";
import { Bridge } from "./bridge.mjs";

const config = loadConfig({ discord: false });
const log = createLog("debug");
const seat = new Seat({ ...config.seat, ...config.foundry }, log);
const events = [];
seat.on("event", (ev) => events.push(ev));

try {
  await seat.start();
  const bridge = new Bridge(seat);
  const asSeat = (name, args = {}) => bridge.run(name, { client: { kind: "discord", user: "seat-check" }, asSeat: true, ...args });

  log.info(`commands: ${(await asSeat("commands")).map((c) => c.name).join(" ")}`);
  log.info(`users: ${(await asSeat("users")).map((u) => `${u.name}${u.isGM ? "*" : ""}`).join(", ")}`);
  log.info(`parties: ${JSON.stringify(await asSeat("parties"))}`);
  const who = await asSeat("whoami");
  log.info(`whoami: ${JSON.stringify({ user: who.user?.name, judge: who.judge, characters: who.characters?.length })}`);

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
