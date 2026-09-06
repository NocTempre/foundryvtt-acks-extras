/**
 * One logger, to stdout, with a level. A service that runs unattended for
 * weeks wants timestamps on every line and nothing clever.
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLog(level = "info") {
  const floor = LEVELS[level] ?? LEVELS.info;
  const line = (lvl, msg, extra) => {
    if (LEVELS[lvl] < floor) return;
    const tail = extra === undefined ? "" : ` ${typeof extra === "string" ? extra : (extra?.stack ?? JSON.stringify(extra))}`;
    process.stdout.write(`${new Date().toISOString()} ${lvl.padEnd(5)} ${msg}${tail}\n`);
  };
  return {
    debug: (m, e) => line("debug", m, e),
    info: (m, e) => line("info", m, e),
    warn: (m, e) => line("warn", m, e),
    error: (m, e) => line("error", m, e),
  };
}
