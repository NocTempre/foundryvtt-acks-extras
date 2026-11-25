/**
 * Live walk, equipment-inherited-style: the item sheet's Inherited row for the
 * fighting style names the style by its label and what grants it. Walks
 * docs/equipment/TESTING.md "The Inherited row's fighting style" on the GM
 * seat: a character holding a weapon and a shield with no class reads the
 * row's detail as Untrained and its source tag as the "no class grants it"
 * string; the same gear on a character whose class was applied through the
 * class picker, the class granting the style its training effect names, reads
 * Trained with the class's own name as the tag, not the plain Class tag. The
 * label is the style's lang string read at run time, never the style's id, and
 * the class is looked up in the world by what its training grants. A world
 * holding no such class stops the walk blocked after the classless case. Prints
 * booleans and counts; the class's name is compared in the page and never
 * printed. Machine values arrive through ./_env.mjs.
 *
 * The walk sets `proficiencyEnforcement` to on (the style reads trained
 * wherever it is off) and puts it back.
 *
 * Fixtures, kept and found by marker: `equipment/inherited-style-classless`
 * and `equipment/inherited-style-classed`, characters each holding an
 * equipped weapon and an equipped shield. Each step brings its character to
 * the shape it needs (the classed one is reset to no class and applied again
 * through the picker). Cards the run's client made speaking as them are swept
 * by id.
 */
import { connect } from "./_driver.mjs";
import { walkDone, blocked, WalkBlocked } from "./_walk.mjs";
import { MACHINE, PORTS, note, section, check, checks, idOf, run, ready, P as KIT } from "./_class-style-kit.mjs";

const { browser, origin } = MACHINE;
const CLASSLESS = "equipment/inherited-style-classless";
const CLASSED = "equipment/inherited-style-classed";
const STYLE = "weaponShield";

/** A weapon and a shield as the system types them, both equipped. */
const gear = (tag) => [
  { name: `QA Inherited Style ${tag} Blade`, type: "weapon", system: { equipped: true, damage: { base: { formula: "1d6" } } } },
  { name: `QA Inherited Style ${tag} Shield`, type: "armor", system: { type: "shield", equipped: true, ac: { value: 1 } } },
];
const character = (tag) => ({ name: `QA Inherited Style ${tag}`, type: "character", system: { hp: { value: 8, max: 8 } }, items: gear(tag) });

const P = {
  ...KIT,
  /** The weapon's item sheet on its Effects tab, the Inherited rows as drawn, read against the lang strings. */
  inheritedRow: async ({ actorId, classUuid = null }) => {
    const H = globalThis.__cs;
    const actor = game.actors.get(actorId);
    const weapon = actor.items.find((i) => i.type === "weapon");
    const app = weapon.sheet;
    await app.close({ animate: false });
    await app.render(true);
    await H.poll(() => H.root(app)?.isConnected);
    await H.sleep(500);
    app.changeTab?.("effects", "primary");
    await H.sleep(600);
    const root = H.root(app);
    const label = game.i18n.format("ACKS-EQUIPMENT.itemSheet.grant.style", { style: game.i18n.localize("ACKS-EQUIPMENT.wear.style.weaponShield") });
    const rows = [...(root?.querySelectorAll(".acks-extras-item-sheet__row.is-inherited") ?? [])].map((r) => ({
      label: r.querySelector(".acks-extras-item-sheet__row-label")?.textContent.trim() ?? "",
      detail: r.querySelector(".acks-extras-item-sheet__row-line")?.textContent.trim() ?? "",
      src: r.querySelector(".acks-tag")?.textContent.trim() ?? "",
    }));
    const row = rows.find((r) => r.label === label) ?? null;
    const cls = classUuid ? await fromUuid(classUuid) : null;
    const typed = String(actor.system.details?.class ?? "");
    return {
      rendered: !!root,
      rows: rows.length,
      found: !!row,
      idLeaked: rows.some((r) => r.label.includes("weaponShield")),
      trained: row?.detail === game.i18n.localize("ACKS-EQUIPMENT.itemSheet.grant.styleTrained"),
      untrained: row?.detail === game.i18n.localize("ACKS-EQUIPMENT.itemSheet.grant.styleUntrained"),
      srcNoClass: row?.src === game.i18n.localize("ACKS-EQUIPMENT.itemSheet.src.noClass"),
      srcPlain: row?.src === game.i18n.localize("ACKS-EQUIPMENT.itemSheet.src.class"),
      srcIsClass: !!row?.src && !!cls && (row.src === cls.name || (typed !== "" && row.src === typed)),
    };
  },
};

let gm = null;
let priorMode = null;
const actorIds = [];
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 600_000);
setTimeout(() => {
  console.error(`WALK ERROR: wall clock of ${WALL_MS} ms reached; closing the seat`);
  try { gm?.close(); } catch {}
  process.exit(1);
}, WALL_MS).unref();

try {
  section("seat");
  gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  note("gm ready after (s)", await ready(gm, "gm"));
  const installed = await run(gm, P.install);
  check("the GM seat is the active GM and the class picker is published", installed.isGM && installed.activeGMIsSelf && installed.picker, installed);
  priorMode = await run(gm, P.setting, { value: "on" });
  note("enforcement before the walk", priorMode);

  section("fixtures");
  const classless = await gm.fixture(CLASSLESS, "Actor", character("Classless"));
  const classed = await gm.fixture(CLASSED, "Actor", character("Classed"));
  const lessId = idOf(classless);
  const classedId = idOf(classed);
  actorIds.push(lessId, classedId);

  section("the character with no class");
  const bare = await run(gm, P.reset, { actorId: lessId });
  check("shape: no class ledger, no class training effect, the typed class field blank", bare.ledger && bare.typed, bare);
  const bareLoad = await run(gm, P.loadout, { actorId: lessId });
  check("shape: one weapon and one shield are equipped and the active style is the weapon-and-shield style", bareLoad.weapons === 1 && bareLoad.shields === 1 && bareLoad.activeStyle === STYLE, { weapons: bareLoad.weapons, shields: bareLoad.shields, style: bareLoad.activeStyle });
  check("shape: the style reads untrained with nothing granting it", bareLoad.styleProficient === false, { trained: bareLoad.trained });
  const bareRow = await run(gm, P.inheritedRow, { actorId: lessId });
  check("the Inherited row prints the style's label, and the style's id appears on no row", bareRow.found && !bareRow.idLeaked, bareRow);
  check("its detail reads Untrained and its source tag reads the no-class string, never the plain Class tag", bareRow.untrained && bareRow.srcNoClass && !bareRow.srcPlain, { untrained: bareRow.untrained, srcNoClass: bareRow.srcNoClass, srcPlain: bareRow.srcPlain });

  section("the character whose class was applied through the picker");
  const found = await run(gm, P.findClass, { style: STYLE });
  note("classes with a training effect, and those granting the style", { classes: found.classes, granting: found.granting });
  if (!found.pick || !found.pick.grants) blocked(`no non-stub class in this world grants the ${STYLE} style through its training effect (${found.classes} class(es) read, ${found.granting} granting)`);
  const cleared = await run(gm, P.reset, { actorId: classedId });
  check("shape: no class ledger and no class training effect before the picker is used", cleared.ledger && cleared.staleEffects >= 0, cleared);
  const applied = await run(gm, P.applyViaPicker, { actorId: classedId, classUuid: found.pick.uuid });
  check("the picker opens on the class, Apply closes it and writes the class ledger", applied.opened && applied.onClass && applied.closed && applied.landed, applied);
  const classedLoad = await run(gm, P.loadout, { actorId: classedId });
  check("shape: the weapon and shield are still equipped, the style reads trained", classedLoad.weapons === 1 && classedLoad.shields === 1 && classedLoad.activeStyle === STYLE && classedLoad.styleProficient === true, { weapons: classedLoad.weapons, shields: classedLoad.shields, style: classedLoad.activeStyle, trained: classedLoad.trained, proficient: classedLoad.styleProficient });
  const classedRow = await run(gm, P.inheritedRow, { actorId: classedId, classUuid: found.pick.uuid });
  check("the Inherited row prints the style's label, and the style's id appears on no row", classedRow.found && !classedRow.idLeaked, classedRow);
  check("its detail reads Trained and its source tag names the class, not the plain Class tag", classedRow.trained && classedRow.srcIsClass && !classedRow.srcPlain, { trained: classedRow.trained, srcIsClass: classedRow.srcIsClass, srcPlain: classedRow.srcPlain, srcNoClass: classedRow.srcNoClass });

  const drained = await run(gm, P.drain);
  check("no console error over the walk", !drained.errors.length, drained.errors.slice(0, 3));
  walkDone();
} catch (err) {
  if (!(err instanceof WalkBlocked)) {
    console.error("WALK ERROR:", err?.stack ?? err);
    checks.push(["walk ran to the end", false]);
  }
} finally {
  section("teardown");
  if (gm) {
    try { await run(gm, P.closeSheets, { actorIds }); } catch (err) { console.error("close sheets:", err?.message ?? err); }
    try {
      const cards = actorIds.length ? await run(gm, P.cardsFor, { actorIds }) : [];
      for (const id of cards) await gm.track(id, "ChatMessage");
      if (cards.length) note("cards swept", await gm.sweepTracked({ only: cards.map((id) => `ChatMessage.${id}`) }));
    } catch (err) { console.error("card sweep:", err?.message ?? err); }
    if (priorMode != null && priorMode !== "on") {
      try { await run(gm, P.setting, { value: priorMode }); note("enforcement restored", priorMode); } catch (err) { console.error("setting restore:", err?.message ?? err); }
    }
    try { note("restored", await run(gm, P.restore)); } catch (err) { console.error("restore:", err?.message ?? err); }
  }
  console.log(`fixtures kept: ${CLASSLESS}, ${CLASSED}`);
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
