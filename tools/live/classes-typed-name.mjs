/**
 * Live walk, classes-typed-name: the character sheet's Class tab calls a class
 * bound only when the class picker applied it, and a weapon-and-shield
 * character whose class grants that style reads as trained. Walks
 * docs/classes/TESTING.md "A typed class name is not a bound class" on the GM
 * seat. A character with a class name typed into the sheet's class field and no
 * class applied resolves the class (so the check is not vacuous) yet `bound` is
 * false and the rendered tab draws the unbound line and none of the bound-only
 * wording (the class link, the bound line, the class's next-experience note);
 * the same class applied through the picker reads bound, with all three. On
 * that applied character, holding an equipped weapon and an equipped shield
 * typed as the system types them, the style training the module reports reads
 * trained on the loadout and on the character sheet's Equipment tab (no
 * untrained tag). That last check may fail live, and its message then prints the
 * class key, the style tokens the class grants, the equipped items' types and
 * the reading: it is the field report's finding. The party sheet's member row
 * is not read: no source under scripts/formation or templates/formation
 * produces an untrained-style reading, so there is nothing there to assert.
 * The class is looked up at run time by what its training grants (a world with
 * no non-stub class stops the walk blocked; one with none granting the style
 * runs the typed-name checks and stops blocked before the style check). The
 * walk sets `proficiencyEnforcement` to on and puts it back. Prints booleans
 * and counts; the class key is printed only in the style check's failure
 * message. Machine values arrive through ./_env.mjs.
 *
 * Fixtures, kept and found by marker: `classes/typed-name-typed` (a
 * character) and `classes/typed-name-applied` (a character holding the weapon
 * and shield). Each step resets its character and applies again.
 */
import { connect } from "./_driver.mjs";
import { walkDone, blocked, WalkBlocked } from "./_walk.mjs";
import { MACHINE, PORTS, note, section, check, checks, idOf, run, ready, P as KIT } from "./_class-style-kit.mjs";

const { browser, origin } = MACHINE;
const TYPED = "classes/typed-name-typed";
const APPLIED = "classes/typed-name-applied";
const STYLE = "weaponShield";

const gear = [
  { name: "QA Typed Name Blade", type: "weapon", system: { equipped: true, damage: { base: { formula: "1d6" } } } },
  { name: "QA Typed Name Shield", type: "armor", system: { type: "shield", equipped: true, ac: { value: 1 } } },
];

const P = {
  ...KIT,
  /** The Class tab as the module's character sheet draws it, with the model's own `bound`. */
  classTab: async ({ actorId }) => {
    const H = globalThis.__cs;
    const actor = game.actors.get(actorId);
    const REG = await import(`${H.base}classes/registry.mjs`);
    const CT = await import(`${H.base}character-sheet/tabs/class.mjs`);
    const SheetCls = H.sheetCls();
    if (!SheetCls) return { sheet: false };
    const sheet = H.sheetOf(actor) ?? new SheetCls({ document: actor });
    sheet.tabGroups.primary = "class";
    await sheet.render({ force: true });
    await H.sleep(900);
    const root = H.root(sheet);
    const tab = root?.querySelector('.tab[data-tab="class"]');
    const lines = [...(tab?.querySelectorAll(".acks-extras-frame__row-line") ?? [])].map((n) => n.textContent.trim());
    const resolved = REG.classForActor(actor);
    return {
      sheet: true,
      rendered: !!tab,
      resolved: !!resolved,
      model: CT.buildClassTab(actor).bound,
      applied: REG.classIsApplied(actor, resolved),
      classLink: !!tab?.querySelector('[data-action="classOpen"]'),
      boundLine: lines.includes(game.i18n.localize("ACKS-CHARACTER.class.boundNote")),
      unboundLine: lines.includes(game.i18n.localize("ACKS-CHARACTER.class.unboundNote")),
      nextNote: !!tab?.querySelector(".acks-extras-frame__fact-label .acks-extras-frame__fact-note:not([data-tooltip])"),
    };
  },
  /** The Equipment tab's untrained tag as drawn, and the hands badge's style label. */
  equipmentTab: async ({ actorId }) => {
    const H = globalThis.__cs;
    const actor = game.actors.get(actorId);
    const SheetCls = H.sheetCls();
    if (!SheetCls) return { sheet: false };
    const sheet = H.sheetOf(actor) ?? new SheetCls({ document: actor });
    sheet.tabGroups.primary = "equipment";
    await sheet.render({ force: true });
    await H.sleep(900);
    const tab = H.root(sheet)?.querySelector('.tab[data-tab="equipment"]');
    const untrainedText = game.i18n.localize("ACKS-EQUIPMENT.wear.untrained");
    const badges = [...(tab?.querySelectorAll(".acks-extras-frame__badge-k") ?? [])].map((n) => n.textContent.trim());
    return {
      sheet: true,
      rendered: !!tab,
      untrainedTag: [...(tab?.querySelectorAll(".acks-tag--danger") ?? [])].some((n) => n.textContent.trim() === untrainedText),
      styleLabelShown: badges.includes(game.i18n.localize("ACKS-EQUIPMENT.wear.style.weaponShield")),
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
  const typed = await gm.fixture(TYPED, "Actor", { name: "QA Typed Name Typed", type: "character", system: { hp: { value: 8, max: 8 } } });
  const applied = await gm.fixture(APPLIED, "Actor", { name: "QA Typed Name Applied", type: "character", system: { hp: { value: 8, max: 8 } }, items: gear });
  const typedId = idOf(typed);
  const appliedId = idOf(applied);
  actorIds.push(typedId, appliedId);
  const found = await run(gm, P.findClass, { style: STYLE });
  note("classes with a training effect, and those granting the style", { classes: found.classes, granting: found.granting });
  if (!found.pick) blocked("no non-stub class in this world carries a training effect to drive the Class tab with");
  const grantsStyle = found.pick.grants;
  const className = await run(gm, P.nameOf, { uuid: found.pick.uuid });

  section("a typed class name and no applied class");
  const bare = await run(gm, P.reset, { actorId: typedId, typedClass: className });
  check("shape: no class ledger, the class field holds the typed name", bare.ledger && bare.typed, bare);
  const t = await run(gm, P.classTab, { actorId: typedId });
  check("the Class tab renders on the module's character sheet", t.sheet && t.rendered, t);
  check("shape: the typed name resolves to a class document (so an unbound reading is the fix's, not an unresolved name's)", t.resolved, { resolved: t.resolved });
  check("the model calls it unbound and the class is not applied", t.model === false && t.applied === false, { model: t.model, applied: t.applied });
  check("the rendered tab draws the unbound line and none of the bound-only wording", t.unboundLine && !t.boundLine && !t.classLink && !t.nextNote, { unboundLine: t.unboundLine, boundLine: t.boundLine, classLink: t.classLink, nextNote: t.nextNote });

  section("the same class applied through the picker");
  await run(gm, P.reset, { actorId: appliedId, typedClass: "" });
  const picked = await run(gm, P.applyViaPicker, { actorId: appliedId, classUuid: found.pick.uuid });
  check("the picker opens on the class, Apply closes it and writes the class ledger", picked.opened && picked.onClass && picked.closed && picked.landed, picked);
  const a = await run(gm, P.classTab, { actorId: appliedId });
  check("the model calls it bound and the class is applied", a.model === true && a.applied === true, { model: a.model, applied: a.applied });
  check("the rendered tab draws the class link, the bound line and the next-experience note, and not the unbound line", a.classLink && a.boundLine && a.nextNote && !a.unboundLine, { classLink: a.classLink, boundLine: a.boundLine, nextNote: a.nextNote, unboundLine: a.unboundLine });

  section("style training on the applied character");
  if (!grantsStyle) blocked(`the class this world's first pick yields does not grant the ${STYLE} style through its training effect (${found.classes} class(es) read, ${found.granting} granting): the style check needs one that does`);
  const lo = await run(gm, P.loadout, { actorId: appliedId });
  const fx = await run(gm, P.trainingEffects, { actorId: appliedId });
  const detail = { classKey: found.pick.key, classGrants: found.pick.styles, appliedStyleEffects: fx, equipped: lo.gear, activeStyle: lo.activeStyle, trained: lo.trained, styleProficient: lo.styleProficient, nonProficientUse: lo.nonProficientUse, violations: lo.violations };
  check("shape: one weapon and one shield are equipped and the active style is the weapon-and-shield style", lo.weapons === 1 && lo.shields === 1 && lo.activeStyle === STYLE, { weapons: lo.weapons, shields: lo.shields, style: lo.activeStyle, equipped: lo.gear });
  check("(i) the loadout reads the style as trained: not the untrained reading, and no untrained-style violation", lo.styleProficient === true && !lo.violations.includes("styleNotProficient"), detail);
  const eq = await run(gm, P.equipmentTab, { actorId: appliedId });
  check("(i) the character sheet's Equipment tab shows the style and no untrained tag", eq.sheet && eq.rendered && eq.styleLabelShown && !eq.untrainedTag, { ...detail, tab: eq });
  note("(ii) the party sheet's member row", "not read: no source in scripts/formation or templates/formation produces an untrained-style reading");

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
  console.log(`fixtures kept: ${TYPED}, ${APPLIED}`);
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
