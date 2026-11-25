/**
 * Live walk, lib-welcome-version: a Player's load after a system update writes
 * no world setting and logs no permission error (patches/welcome-version.mjs).
 * Walks docs/lib/TESTING.md, "A Player's welcome-version write".
 * Machine values arrive through ./_env.mjs. No book and no fixture: the walk
 * moves one world setting, `acks.welcomeMessageVersion`, and puts it back.
 *
 * GM seat: notes the stored version, then sets it one version back, the state
 * a world is in after a system update before any GM has loaded it. Player
 * seat: reloads with a recorder attached before its first script. The checks:
 * the Player ran init, setup and ready, recorded no "lacks permission" line,
 * shows the welcome dialog, and reads the older version, and the GM still reads
 * it. A `finally` restores the stored version and notes what it reads after.
 */
import { connect } from "./_driver.mjs";
import { walkDone, blocked } from "./_walk.mjs";
import { MACHINE, PORTS, run, note, section, check, finish, record, sleep } from "./_treasure-kit.mjs";

const OLDER = "14.1.0";
const TITLE_KEY = "ACKS.Welcome.Title";
let gm;
let player;
let original = null;
try {
  section("seats");
  gm = await connect({ browser: MACHINE.browser, origin: MACHINE.origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  const g = await run(gm, async () => ({
    isGM: game.user.isGM,
    system: game.system.version,
    stored: game.settings.get("acks", "welcomeMessageVersion"),
    wrapTarget: typeof foundry?.helpers?.ClientSettings?.prototype?.set === "function",
  }));
  note("gm", g);
  if (!g.isGM) blocked("the GM seat joined a user that is not a GM");
  check("ClientSettings#set resolves at foundry.helpers.ClientSettings, the patch's wrap target", g.wrapTarget, g);
  original = g.stored;
  note("stored version before the write", original);

  section("put the stored version one back, as after a system update");
  const set = await run(gm, async ({ older }) => {
    await game.settings.set("acks", "welcomeMessageVersion", older);
    return game.settings.get("acks", "welcomeMessageVersion");
  }, { older: OLDER });
  check(`the GM reads ${OLDER} at the start`, set === OLDER, set);

  section("the Player loads with the recorder attached before its first script");
  player = await connect({ browser: MACHINE.browser, origin: MACHINE.origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  note("player ready after (s)", await record(PORTS.player, "player", player));
  await sleep(3000);
  const p = await run(player, async ({ titleKey }) => {
    const boot = globalThis.__tkBoot ?? { errors: [], phases: [] };
    const title = game.i18n.localize(titleKey);
    const dialogs = [...foundry.applications.instances.values()].filter((a) => a.title === title || a.options?.window?.title === titleKey);
    return {
      isGM: game.user.isGM,
      canModify: game.user.can("SETTINGS_MODIFY"),
      phases: boot.phases,
      errors: boot.errors.map((e) => `${e.phase}/${e.kind}: ${e.text}`),
      denied: boot.errors.filter((e) => /lacks permission/i.test(e.text)).length,
      welcome: dialogs.length,
      stored: game.settings.get("acks", "welcomeMessageVersion"),
    };
  }, { titleKey: TITLE_KEY });
  note("player", p);
  if (p.isGM || p.canModify) blocked("the Player seat joined a user allowed to modify settings");
  check("init, setup and ready ran on the Player seat", ["init", "setup", "ready"].every((x) => p.phases.includes(x)), p.phases);
  check("no 'lacks permission' error was recorded from load through ready and after", p.denied === 0, p.errors);
  check("the welcome dialog shows on the Player seat", p.welcome > 0, p.welcome);
  check(`the Player reads the stored ${OLDER}: it wrote nothing`, p.stored === OLDER, p.stored);
  const after = await run(gm, async () => game.settings.get("acks", "welcomeMessageVersion"));
  check(`the GM still reads ${OLDER}`, after === OLDER, after);
  await run(player, async ({ titleKey }) => {
    const title = game.i18n.localize(titleKey);
    for (const a of foundry.applications.instances.values()) if (a.title === title || a.options?.window?.title === titleKey) await a.close();
    return null;
  }, { titleKey: TITLE_KEY });
  walkDone();
} catch (err) {
  if (err?.name !== "WalkBlocked") console.error(`WALK ERROR: ${err?.stack ?? err}`);
  process.exitCode = 1;
} finally {
  if (gm && original !== null) {
    try {
      const back = await run(gm, async ({ v }) => {
        await game.settings.set("acks", "welcomeMessageVersion", v);
        return game.settings.get("acks", "welcomeMessageVersion");
      }, { v: original });
      note("stored version after the restore", back);
      check("the stored version is restored", back === original, { before: original, after: back });
    } catch (e) { console.error(`WALK ERROR: restore failed: ${e}`); process.exitCode = 1; }
  }
  const threw = process.exitCode === 1;
  finish();
  if (threw) process.exitCode = 1;
  try { if (player) await player.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
}
