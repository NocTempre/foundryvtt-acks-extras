/**
 * Live walk, the 1st-level hit-die floor on a cell of two dice:
 * docs/classes/TESTING.md, "The 1st-level hit-die floor", step 5. The class's
 * level-1 HD cell is typed on its own sheet, every die is rigged to fall 1,
 * and the class is bound at 1st level through the call the picker and chargen
 * make. The served hit-point arithmetic is also run directly at an invented
 * floor, so the check discriminates even where the world has imported none.
 * Machine values arrive through ./_env.mjs; nothing here names a port, a
 * world, a seat or a book. Every figure typed into a fixture is invented.
 *
 * Fixtures, kept and found again by marker (`api.fixture`): the class item
 * `classes/two-die-first-level` and the character `classes/hp-floor-character`.
 * The class's levels and the character's Constitution are written to shape at
 * the step's start. Writes outside the ledger: none; `CONFIG.Dice.randomUniform`
 * is restored in a `finally` in page context.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";

const MACHINE = machineSeats();
const MOD = "acks-extras";

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/* ------------------------------------------------------------------ */
/*  Page side                                                           */
/* ------------------------------------------------------------------ */

const P = {
  census: async () => ({
    module: game.modules.get("acks-extras")?.version ?? null,
    role: game.user.role,
    activeGMIsSelf: !!game.users.activeGM?.isSelf,
    applyClass: typeof acksExtras.classes?.applyClass,
    floorImported: (acksExtras.classes?.firstLevelDieMinimum?.() ?? 1) > 1,
  }),

  /** Bring the class to one die at 1st level, then type the cell as two on its sheet. */
  typeCell: async ({ itemId }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const item = game.items.get(itemId);
    await item.update({
      "system.levels": [
        { level: 1, xp: 0, title: "", hd: "1d8" },
        { level: 2, xp: 1500, title: "", hd: "2d8" },
      ],
      "system.hitDie": "1d8",
    });
    const sheet = item.sheet;
    await sheet.render({ force: true });
    for (let i = 0; i < 40 && !sheet.rendered; i++) await sleep(100);
    const row = [...sheet.element.querySelectorAll('input[name^="system.levels."][name$=".hd"]')].find(
      (el) => el.closest("tr")?.querySelector('input[name$=".level"]')?.value === "1",
    );
    if (row) {
      row.value = "2d8";
      row.dispatchEvent(new Event("change", { bubbles: true }));
    }
    for (let i = 0; i < 40 && item.system.levelRow(1)?.hd !== "2d8"; i++) await sleep(100);
    await sheet.close();
    return { found: !!row, hd: item.system.levelRow(1)?.hd ?? null };
  },

  /** Rig every die to 1, run the arithmetic directly and through applyClass, restore. */
  rolled: async ({ itemId, actorId }) => {
    const prior = CONFIG.Dice.randomUniform;
    const out = {};
    try {
      CONFIG.Dice.randomUniform = () => 0.975;
      out.probe = (await new Roll("1d8").evaluate()).total;
      const hp = await import("/modules/acks-extras/scripts/classes/hitpoints.mjs");
      out.servesFix = hp.rollHitDice.toString().includes("i === 0");
      const cell = { dice: 2, sides: 8, flat: 0 };
      const plain = await hp.rollHitDice(cell, 0, { dieMinimum: 3 });
      const penalty = await hp.rollHitDice(cell, -1, { dieMinimum: 3 });
      out.direct = { plain: plain.total, penalty: penalty.total, perDie: plain.perDie && penalty.perDie };

      const actor = game.actors.get(actorId);
      const cls = game.items.get(itemId);
      // At 1st level already, so the bind takes no leave-0th-level path.
      await actor.update({ "system.scores.con.value": 13, "system.details.level": 1 });
      const con = Number(actor.system.scores?.con?.mod) || 0;
      const floor = acksExtras.classes.firstLevelDieMinimum();
      const applied = await acksExtras.classes.applyClass(actor, cls, { level: 1, confirm: false, rebuildVitals: true });
      out.applied = {
        ok: !!applied?.applied,
        con,
        floorAbove1: floor > 1,
        max: actor.system.hp?.max ?? null,
        expected: Math.max(1, floor + con) + Math.max(1, 1 + con),
        bothFloored: 2 * Math.max(1, floor + con),
      };
    } finally {
      CONFIG.Dice.randomUniform = prior;
    }
    out.restored = CONFIG.Dice.randomUniform === prior;
    return out;
  },
};

async function run(api, fn, ...args) {
  const text = await api.eval(`(${fn.toString()})(...${JSON.stringify(args)}).then((v) => JSON.stringify(v === undefined ? null : v))`);
  return JSON.parse(text);
}

async function ready(api, seconds = 240) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try {
      ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.classes?.applyClass`);
    } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`gm: not ready after ${seconds}s`);
    await sleep(1000);
  }
}

let gm = null;
try {
  section("seats");
  gm = await connect({ browser: MACHINE.browser, origin: MACHINE.origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  note("gm ready after (s)", await ready(gm));
  const census = await run(gm, P.census);
  note("census", census);
  check("the GM seat is the active GM and the page serves applyClass", census.activeGMIsSelf && census.role === 4 && census.applyClass === "function", census);
  if (!census.activeGMIsSelf) throw new Error("another GM client is the active GM");

  section("fixtures");
  const cls = await gm.fixture("classes/two-die-first-level", "Item", {
    name: "HP Two-Die Class",
    type: `${MOD}.class`,
    system: { levels: [{ level: 1, xp: 0, title: "", hd: "1d8" }], hitDie: "1d8" },
  });
  const actor = await gm.fixture("classes/hp-floor-character", "Actor", { name: "HP Floor Character", type: "character" });

  section("5. a 1st level of two dice floors one of them");
  const typed = await run(gm, P.typeCell, { itemId: cls.id });
  note("typed", typed);
  check("the class sheet's Levels table takes 2d8 in level 1's HD cell", typed.found && typed.hd === "2d8", typed);
  const r = await run(gm, P.rolled, { itemId: cls.id, actorId: actor.id });
  // The bound figures carry the imported floor, so they are compared in the walk and printed as booleans.
  note("rolled", { probe: r.probe, servesFix: r.servesFix, direct: r.direct, applied: r.applied.ok, floorAbove1: r.applied.floorAbove1, restored: r.restored });
  check("the rig throws a 1", r.probe === 1, { probe: r.probe });
  check("the page serves the floor that raises the first face only", r.servesFix);
  check("two dice falling 1 at an invented floor of 3 sum 4, and 3 with a Constitution of -1", r.direct.perDie && r.direct.plain === 4 && r.direct.penalty === 3, r.direct);
  check(
    "bound at 1st level, hit points are the floor plus Constitution and one plus Constitution",
    r.applied.ok && r.applied.max === r.applied.expected,
    { matches: r.applied.max === r.applied.expected, bothFlooredWouldDiffer: r.applied.bothFloored !== r.applied.expected, floorAbove1: r.applied.floorAbove1 },
  );
  if (!r.applied.floorAbove1) note("note", "the world imports no floor above 1, so the bound check cannot tell one floored die from two; the direct check carries it");
  check("randomUniform is restored", r.restored);
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err?.message ?? err);
  checks.push(["the walk ran to its end", false]);
} finally {
  section("teardown");
  if (gm) {
    note("ledger (gm)", "");
    try { await gm.close(); } catch {}
  }
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
