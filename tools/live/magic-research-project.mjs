/**
 * Live walk, magic-research-project: research projects at a location and the
 * Research tab of its sheet (`scripts/magic/research-project*.mjs`,
 * `research-tab.mjs`). Walks docs/magic/TESTING.md "Research projects (M-q1)" on
 * the GM seat and a Player seat: the tab after Storage on a place with no
 * market, the Judge's facility inputs and a Player's read-only values, a Judge's
 * project and a Player's started through the relay for a character the Player
 * owns (and refused for one the Player does not, one not linked and a Judge's
 * field), the facility chip unread with no level entered and read against an
 * invented minimum once the registry holds one, a Player blocked and a Judge
 * warned below it, the controls a Player is left (assistant, close), the
 * components bucket by a drop and an X, and the researcher's derived link, which
 * writes nothing on the character.
 *
 * The facility figures are the registry's `libraryProse` and `researchLadder`
 * through the override layer (invented), so the walk needs no import and sets
 * nothing a Judge did not; a table another hand already overrode blocks the
 * walk. Time is not moved. Prints counts and booleans only.
 *
 * Fixtures, kept and found by marker (the GM seat builds them):
 * `magic/research-place` (a location with no market the Player may only observe,
 * so the Player's writes are relayed), `magic/research-hero` (a character the
 * Player owns, on the place's roster), `magic/research-pell` (a character on the
 * roster the Player does not own), `magic/research-lena` (a character the Player
 * owns who is NOT on the roster) and `magic/research-part` (an item to drop as a
 * component). The place's research record and roster are set at the start and the
 * end; the run's overrides are cleared in the finally. Nothing else is made.
 */
import { connect } from "./_driver.mjs";
import { seats, PORTS } from "./_env.mjs";
import { walkDone, blocked, WalkBlocked } from "./_walk.mjs";

const M = seats();
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + JSON.stringify(detail)}`);
};
const section = (t) => console.log(`\n== ${t} ==`);

let gm;
let player;
let overrode = false;

const TABLE_IDS = ["libraryProse", "researchLadder", "researchLadderNote"];

/** The page helpers every step shares, for the place at `uuid`. */
const kit = (uuid, ids = {}) => `
  const U = ${JSON.stringify(uuid)};
  const ID = ${JSON.stringify(ids)};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, n = 60) => { for (let i = 0; i < n; i++) { const v = fn(); if (v) return v; await sleep(100); } return fn(); };
  const place = () => fromUuidSync(U);
  const research = () => acksExtras.magic.research;
  const flag = () => place().flags?.["acks-extras"]?.magic ?? {};
  const projects = () => flag().projects ?? [];
  const root = () => place().sheet.element;
  const tab = () => root()?.querySelector('section[data-tab="research"]');
  const open = async () => {
    const p = place();
    await p.sheet.render({ force: true });
    await until(() => p.sheet.element?.isConnected);
    p.sheet.changeTab?.("research", "primary", { force: true });
    await until(() => tab()?.classList.contains("active"));
    await sleep(300);
  };
  const close = async () => { await place()?.sheet?.close({ animate: false }); };
  const change = async (el, value) => { el.value = value; el.dispatchEvent(new Event("change", { bubbles: true })); await sleep(900); };
  const card = (id) => tab()?.querySelector('[data-project-id="' + id + '"]');
`;
const run = (seat, uuid, body, ids) => seat.eval(`(async () => { ${kit(uuid, ids)} ${body} })()`);

/** Override or clear the registry's research tables through the Ruledata Browser's own store. */
const tablesKit = `
  const STORE = await import("/modules/acks-extras/scripts/location/table-store.mjs");
  const D = "magicResearch";
  const poll = async (test) => { for (let i = 0; i < 80; i++) { if (test()) return true; await new Promise((r) => setTimeout(r, 100)); } return !!test(); };
`;

try {
  gm = await connect({ browser: M.browser, origin: M.origin, user: M.gm, port: PORTS.gm, own: M.own });
  player = await connect({ browser: M.browser, origin: M.origin, user: M.player, port: PORTS.player, own: M.own });

  section("Boot");
  const seated = await gm.eval(`({ gm: game.user.isGM, active: game.users.activeGM?.isSelf === true, api: typeof acksExtras?.magic?.research?.create === "function" })`);
  const playerSeat = await player.eval(`({ gm: game.user.isGM, id: game.user.id, api: typeof acksExtras?.magic?.research?.create === "function" })`);
  if (!seated.gm || !seated.active) blocked("the first seat is not the active GM");
  if (playerSeat.gm) blocked("the second seat is a GM, so a Player's read-only tab cannot be walked");
  check("the research API is on both seats", seated.api && playerSeat.api);
  const taken = await gm.eval(`(async () => { const S = await import("/modules/acks-extras/scripts/location/table-store.mjs"); return ${JSON.stringify(TABLE_IDS)}.filter((id) => S.hasOverride("magicResearch", id)); })()`);
  if (taken.length) blocked(`the research tables are already overridden by another hand: ${taken.join(", ")}`);

  section("Fixtures");
  const playerId = playerSeat.id;
  const base = { prototypeToken: { actorLink: true }, system: { hp: { value: 9, max: 9 } } };
  const hero = await gm.fixture("magic/research-hero", "Actor", { name: "QA Research Hero", type: "character", ...base, ownership: { default: 0, [playerId]: 3 } });
  const pell = await gm.fixture("magic/research-pell", "Actor", { name: "QA Research Pell", type: "character", ...base, ownership: { default: 2 } });
  const lena = await gm.fixture("magic/research-lena", "Actor", { name: "QA Research Lena", type: "character", ...base, ownership: { default: 0, [playerId]: 3 } });
  const part = await gm.fixture("magic/research-part", "Item", { name: "QA Research Part", type: "item", system: { cost: 12, quantity: { value: 1 } } });
  const where = await gm.fixture("magic/research-place", "Actor", { name: "QA Research Place", type: "acks-extras.location", ownership: { default: 2 } });
  const U = where.uuid;
  const ids = { hero: hero.uuid, pell: pell.uuid, lena: lena.uuid, part: part.uuid };
  // A step that needs a known shape asserts it at its start: a kept fixture carries whatever the last walk left.
  const reset = `
    await place().update({ "flags.acks-extras.-=magic": null, "system.roster": [] });
    await sleep(300);
    const P = await import("/modules/acks-extras/scripts/lib/place.mjs");
    await P.addOccupant(place(), fromUuidSync(ID.hero));
    await P.addOccupant(place(), fromUuidSync(ID.pell));
    await sleep(500);
    return { magic: !!place().flags?.["acks-extras"]?.magic, roster: place().system.roster.map((r) => r.uuid), market: place().system.hasMarket };`;
  const start = await run(gm, U, reset, ids);
  check("the place starts with no record, a roster of the hero and Pell (not Lena) and no market", !start.magic && start.roster.length === 2 && start.roster.includes(ids.hero) && start.roster.includes(ids.pell) && !start.roster.includes(ids.lena) && start.market === false, start);
  await gm.eval(`globalThis.__rp = { place: 0, hero: 0, hookA: Hooks.on("updateActor", (a) => { if (a.uuid === ${JSON.stringify(U)}) __rp.place++; if (a.uuid === ${JSON.stringify(ids.hero)}) __rp.hero++; }) }`);
  const writes = () => gm.eval(`__rp.place`);

  section("1. the tab, after Storage, on a place with no market");
  const t1 = await run(gm, U, `
    await open();
    const links = [...root().querySelectorAll('nav[data-group="primary"] a[data-tab]')].map((a) => a.dataset.tab);
    const fac = [...tab().querySelectorAll("[data-research-facility]")].map((i) => i.dataset.researchFacility);
    const ids = [...tab().querySelectorAll("[id]")].filter((e) => !e.id.startsWith(place().sheet.id + "-")).length;
    return { links, hasMarket: place().system.hasMarket, active: tab().classList.contains("active"), fac, newBtn: !!tab().querySelector('[data-action="newResearchProject"]'), ids, headerChip: !!root().querySelector(".market-class-line .fa-flask") };`, ids);
  check("Research follows Storage in the strip although the place has no market", t1.hasMarket === false && t1.links.indexOf("research") === t1.links.indexOf("storage") + 1, t1.links);
  check("the Judge's tab holds an input for the library and one for the workshop, a New project button and no element with an id but the ones lib's a11y binder seeds from the window", t1.active && t1.fac.join() === "library,workshop" && t1.newBtn && t1.ids === 0, t1);
  check("no open project, so no count in the header", t1.headerChip === false);

  section("2. a facility value is the Judge's");
  const w0 = await writes();
  const f1 = await run(gm, U, `
    await change(tab().querySelector('[data-research-facility="library"]'), "9000");
    return { stored: flag().facilities?.library, shown: tab().querySelector('[data-research-facility="library"]')?.value };`, ids);
  const w1 = await writes();
  check("typing 9000 in the library input writes it once and the face reads it back", f1.stored === 9000 && f1.shown === "9000" && w1 - w0 === 1, { ...f1, writes: w1 - w0 });
  const f2 = await run(player, U, `
    await open();
    const out = { isGM: game.user.isGM, writable: place().canUserModify(game.user, "update"), inputs: tab().querySelectorAll("[data-research-facility]").length, text: tab().querySelector(".acks-extras-research__facility-value")?.textContent.trim(), tabs: [...root().querySelectorAll('nav[data-group="primary"] a[data-tab]')].map((a) => a.dataset.tab) };
    out.answer = await research().setFacility(place(), "library", 1);
    return out;`, ids);
  check("the Player may only observe the place, so every write of theirs is relayed", f2.isGM === false && f2.writable === false, f2);
  check("the Player's tab shows the value as text with no input, and the tab is theirs although Storage is not", f2.inputs === 0 && /9000/.test(f2.text) && f2.tabs.includes("research") && !f2.tabs.includes("storage"), f2);
  check("a Player's facility write is refused where it runs, as the Judge's alone, and nothing changed", f2.answer.ok === false && f2.answer.reason === "judge" && (await run(gm, U, `return flag().facilities?.library;`, ids)) === 9000, f2.answer);

  section("3. a Judge's project, and what the chip says with no level entered");
  const p1 = await run(gm, U, `
    const r = await research().create(place(), { kind: "spell", subject: { name: "QA Lantern" }, researcher: ID.pell, costs: { research: 40, component: 20 } });
    await sleep(900);
    const c = r.ok ? card(r.id) : null;
    const chip = c?.querySelector(".acks-extras-research__ph .acks-tag");
    return { r: { ok: r.ok, warn: r.warn }, id: r.id, n: projects().length, p: projects()[0], card: !!c, chipTone: chip?.className, chipText: chip?.textContent.trim(), chipTip: chip?.getAttribute("data-tooltip-text") ?? "", finish: c?.querySelector(".acks-extras-research__foot button")?.disabled, why: c?.querySelector(".acks-extras-research__verdict")?.textContent.trim(), header: !!root().querySelector(".market-class-line .fa-flask") };`, ids);
  check("the Judge's create answered ok with no warning and the record holds one open project, stamped with the day", p1.r.ok && !p1.r.warn && p1.n === 1 && p1.p.status === "open" && Number.isInteger(p1.p.opened) && p1.p.researcher === ids.pell && p1.p.costs.research === 40, p1);
  check("the project's card is drawn, its facility chip is unread (no words, a tooltip with the page) and Finish is disabled with its reason as text", p1.card && !/is-(ok|warn)/.test(p1.chipTone) && p1.chipText === "" && /\bRR\b/.test(p1.chipTip) && p1.finish === true && p1.why.length > 0, { chipTone: p1.chipTone, chipText: p1.chipText, chipTip: p1.chipTip, finish: p1.finish, why: p1.why });
  check("the header counts the open project", p1.header === true);
  const IDA = p1.id;

  section("4. a Player starts a project through the relay, and is refused what is not theirs");
  const hw0 = await gm.eval(`__rp.hero`);
  const r1 = await run(player, U, `
    const a = place();
    const own = await research().create(a, { kind: "spell", subject: { name: "QA Scroll" }, researcher: ID.hero });
    const other = await research().create(a, { kind: "spell", researcher: ID.pell });
    const away = await research().create(a, { kind: "spell", researcher: ID.lena });
    const costs = await research().create(a, { kind: "spell", researcher: ID.hero, costs: { research: 1 } });
    await sleep(900);
    return { own: { ok: own.ok, warn: own.warn, id: own.id }, other: other.reason, away: away.reason, costs: costs.reason, held: projects().length };`, ids);
  check("a character the Player owns is started from the Player's seat (the answer came from the GM's client)", r1.own.ok === true && !r1.own.warn && r1.held === 2, r1);
  check("Pell (not the Player's) is the owner's refusal, Lena (not on the roster) is the roster's, and a cost is the Judge's", r1.other === "owner" && r1.away === "researcher" && r1.costs === "judge", r1);
  const IDB = r1.own.id;

  section("5. the facility chip reads the imported figures once the registry holds them");
  overrode = true;
  const o1 = await run(gm, U, `
    ${tablesKit}
    await STORE.setOverride(D, "libraryProse", { minimum: 3000, step: 1500, bonusStep: 7000, bonusSize: 2, bonusCap: 5, share: 25 }, { sourceName: "qa-research-project" });
    await STORE.setOverride(D, "researchLadder", { r0: { label: 5, rate: "90gp", throw: "11+" } }, { sourceName: "qa-research-project" });
    await STORE.setOverride(D, "researchLadderNote", { otherProjectsRate: 40 }, { sourceName: "qa-research-project" });
    // The two projects were started with no level, which reads as unread whatever the world has imported; the Judge enters it now.
    await research().update(place(), ID_A, { level: 2 });
    await research().update(place(), ID_B, { level: 2 });
    const served = await poll(() => research().verdicts(place(), ID_A)[0]?.minimum === 4500);
    const v = research().verdicts(place(), ID_A)[0];
    await open();
    await sleep(500);
    const chip = card(ID_A)?.querySelector(".acks-extras-research__ph .acks-tag");
    return { served, v: { minimum: v.minimum, sharers: v.sharers, share: v.share, verdict: v.verdict, bonus: v.bonus, byHand: v.byHand }, chip: { cls: chip?.className, text: chip?.textContent.trim(), tip: chip?.getAttribute("data-tooltip-text") ?? "" } };`.replace(/ID_A/g, JSON.stringify(IDA)).replace(/ID_B/g, JSON.stringify(IDB)), ids);
  check("the second level's minimum is the first level's plus one step, the library's 9000 is shared by two projects and each share (4500) just meets it", o1.served && o1.v.minimum === 4500 && o1.v.sharers === 2 && o1.v.share === 4500 && o1.v.verdict === "ok" && o1.v.bonus === 0 && o1.v.byHand === true, o1.v);
  check("the chip reads ok with the bonus and its tooltip lists the value, the sharers, the share and the minimum", /is-ok/.test(o1.chip.cls) && /4500/.test(o1.chip.tip) && /9000/.test(o1.chip.tip), o1.chip);
  const r2 = await run(player, U, `
    const before = projects().length;
    const blockedAns = await research().create(place(), { kind: "spell", level: 2, researcher: ID.hero });
    await sleep(600);
    return { blockedAns, before, after: projects().length };`, ids);
  check("a third project would divide the value to a share under the minimum: the Player is blocked with the facility reason and nothing is written", r2.blockedAns.ok === false && r2.blockedAns.reason === "facility" && r2.after === r2.before, r2);
  const j2 = await run(gm, U, `
    const warned = await research().create(place(), { kind: "spell", level: 2, researcher: ID.hero });
    await sleep(900);
    const written = projects().length;
    const gate = research().gate(place(), warned.id);
    await research().close(place(), warned.id);
    await sleep(600);
    return { ok: warned.ok, warn: warned.warn, written, gate, open: projects().filter((p) => p.status === "open").length };`, ids);
  check("the same project from the Judge's seat is written with a warning, and the gate says so for a Judge", j2.ok === true && j2.warn === "facility" && j2.written === 3 && j2.gate.ok === true && j2.gate.warn === "facility", j2);
  section("6. the controls: the Judge's fields, a Player's assistant and close");
  const c1 = await run(gm, U, `
    const c = card(${JSON.stringify(IDA)});
    await change(c.querySelector('[data-research-field="costs.material"]'), "15");
    const c2 = card(${JSON.stringify(IDA)});
    await change(c2.querySelector('[data-research-field="paid.material"]'), "15");
    const c3 = card(${JSON.stringify(IDA)});
    await change(c3.querySelector('[data-research-field="level"]'), "3");
    const p = projects().find((x) => x.id === ${JSON.stringify(IDA)});
    return { material: p.costs.material, paid: p.paid, level: p.level, research: p.costs.research };`, ids);
  check("the Judge's cost, material paid (with its day) and level boxes write the record and leave the rest of it", c1.material === 15 && c1.paid.material === 15 && Number.isInteger(c1.paid.day) && c1.level === 3 && c1.research === 40, c1);
  await run(gm, U, `await research().update(place(), ${JSON.stringify(IDA)}, { level: 2 }); await sleep(500);`, ids);
  const c2 = await run(player, U, `
    await open();
    const c = card(${JSON.stringify(IDB)});
    const other = card(${JSON.stringify(IDA)});
    const out = {
      mineDisabled: [...c.querySelectorAll("[data-research-control]")].filter((e) => e.disabled).length,
      mineControls: c.querySelectorAll("[data-research-control]").length,
      judgeFields: c.querySelectorAll('[data-research-field="level"], [data-research-field^="costs"], [data-research-field^="paid"]').length,
      theirs: other.querySelectorAll("[data-research-control]").length,
    };
    const pick = c.querySelector("[data-research-add-assistant]");
    out.choices = [...pick.options].map((o) => o.value).filter(Boolean);
    await change(pick, ID.pell);
    out.assistants = projects().find((x) => x.id === ${JSON.stringify(IDB)})?.assistants;
    await open();
    const x = card(${JSON.stringify(IDB)}).querySelector('[data-action="removeResearchAssistant"]');
    out.removeBtn = !!x;
    x?.click();
    await sleep(900);
    out.after = projects().find((p) => p.id === ${JSON.stringify(IDB)})?.assistants;
    return out;`, ids);
  check("the Player's own project draws live controls (none disabled by the sheet's lock) and none of the Judge's fields; a project of Pell's draws none", c2.mineControls >= 3 && c2.mineDisabled === 0 && c2.judgeFields === 0 && c2.theirs === 0, c2);
  check("the Player adds an assistant from the linked characters (the hero is not offered to itself, Lena is not on the roster) and removes it, each relayed", c2.choices.join() === ids.pell && c2.assistants?.join() === ids.pell && Array.isArray(c2.after) && c2.after.length === 0, { choices: c2.choices, assistants: c2.assistants, after: c2.after });

  section("7. the components bucket");
  const b1 = await run(player, U, `
    await open();
    const zone = card(${JSON.stringify(IDB)}).querySelector("[data-bucket-drop]");
    const dt = new DataTransfer();
    dt.setData("text/plain", JSON.stringify({ type: "Item", uuid: ID.part }));
    zone.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    await sleep(1200);
    const held = projects().find((p) => p.id === ${JSON.stringify(IDB)})?.bucket;
    await open();
    const rows = [...card(${JSON.stringify(IDB)}).querySelectorAll(".acks-extras-bucket__row")].map((r) => r.dataset.uuid);
    const x = card(${JSON.stringify(IDB)}).querySelector('[data-bucket] [data-action="bucketRemove"]');
    return { held, rows, onLocation: place().items.size, xDrawn: !!x, xDisabled: x?.disabled };`, ids);
  check("an item dropped on the project's bucket is stored as a lib answer row and drawn as a row; the location itself received no item, and the row's X is not disabled by the sheet's lock", b1.held?.length === 1 && b1.held[0].uuid === ids.part && b1.rows.join() === ids.part && b1.onLocation === 0 && b1.xDrawn === true && b1.xDisabled === false, b1);
  const b2 = await run(player, U, `
    const dt = new DataTransfer();
    dt.setData("text/plain", JSON.stringify({ type: "Item", uuid: ID.part }));
    card(${JSON.stringify(IDB)}).querySelector("[data-bucket-drop]").dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    await sleep(900);
    const dup = projects().find((p) => p.id === ${JSON.stringify(IDB)}).bucket.length;
    const x = card(${JSON.stringify(IDB)}).querySelector('[data-bucket] [data-action="bucketRemove"]');
    x?.click();
    await sleep(900);
    return { dup, removed: projects().find((p) => p.id === ${JSON.stringify(IDB)}).bucket.length };`, ids);
  check("the same item dropped twice is held once, and X takes it out", b2.dup === 1 && b2.removed === 0, b2);

  section("8. the researcher's link, then close");
  const x2 = await run(gm, U, `
    const links = research().projectsOf(fromUuidSync(ID.hero));
    return { links: links.map((l) => [l.locationUuid === U, l.id, l.role]) };`, ids);
  const heroWrites = await gm.eval(`__rp.hero`);
  check("the hero's link is derived from the open project it researches, and nothing was written on the character", x2.links.length === 1 && x2.links[0][0] === true && x2.links[0][1] === IDB && x2.links[0][2] === "researcher" && heroWrites === hw0, { ...x2, heroWrites: heroWrites - hw0 });
  const x1 = await run(player, U, `
    const c = card(${JSON.stringify(IDB)});
    c.querySelector('[data-action="closeResearchProject"]').click();
    await sleep(900);
    const p = projects().find((x) => x.id === ${JSON.stringify(IDB)});
    return { status: p.status, closed: p.closed, open: projects().filter((x) => x.status === "open").length, links: research().projectsOf(fromUuidSync(ID.hero)).length };`, ids);
  check("the Player closes their own project (relayed): it stays on the record stamped with the day, and the link goes with it", x1.status === "closed" && Number.isInteger(x1.closed) && x1.open === 1 && x1.links === 0, x1);

  section("Teardown");
  await run(gm, U, `await close();`, ids);
  await run(player, U, `await close();`, ids);
  await run(gm, U, `
    ${tablesKit}
    for (const id of ${JSON.stringify(TABLE_IDS)}) await STORE.clearOverride(D, id);
    await place().update({ "flags.acks-extras.-=magic": null, "system.roster": [] });
    return true;`, ids);
  overrode = false;
  await gm.eval(`Hooks.off("updateActor", __rp.hookA); delete globalThis.__rp;`);
  console.log("fixtures kept: magic/research-place, magic/research-hero, magic/research-pell, magic/research-lena, magic/research-part");
  walkDone();
} catch (e) {
  if (!(e instanceof WalkBlocked)) console.log("WALK ERROR:", e?.stack ?? e);
} finally {
  try {
    if (gm && overrode) console.log(`overrides cleared: ${await gm.eval(`(async () => { const S = await import("/modules/acks-extras/scripts/location/table-store.mjs"); for (const id of ${JSON.stringify(TABLE_IDS)}) await S.clearOverride("magicResearch", id); return ${JSON.stringify(TABLE_IDS)}.every((id) => !S.hasOverride("magicResearch", id)); })()`)}`);
  } catch {}
  const failed = checks.filter(([, ok]) => !ok).length;
  console.log(`${checks.length - failed} passed, ${failed} failed`);
  try { player?.close?.(); } catch {}
  try { gm?.close?.(); } catch {}
  process.exitCode = failed ? 1 : 0;
}
