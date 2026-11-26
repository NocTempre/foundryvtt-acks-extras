/**
 * Live walk, magic-research-project: research projects at a location and the
 * Research tab of its sheet (`scripts/magic/research-project*.mjs`,
 * `research-tab.mjs`). Walks docs/magic/TESTING.md "Research projects (M-q1)" on
 * the GM seat and a Player seat: the tab after Storage on a place with no
 * market, the facility inputs of the place's owner and the read-only values of a Player who only observes
 * the place (whose write is refused as the owner's), a Judge's
 * project and a Player's started through the relay for a character the Player
 * owns (and refused for one the Player does not, one not linked and the common mark, which is the Judge's),
 * the controls a researcher's owner has on the project (level, costs, paid, due) used through the relay
 * from a place that is only observed, the facility chip unread with no level entered and read against an
 * invented minimum once the registry holds one, a Player blocked and a Judge
 * warned below it, the controls a Player is left (assistant, close), the
 * components bucket by a drop and an X, and the researcher's derived link, which
 * writes nothing on the character.
 *
 * Section 12 walks board 16: the days-due box (drawn only while the due cannot be computed, for whoever
 * may act on the project: the Player who owns the researcher writes it, a Player who does not own it is shown the due as
 * text and refused the write), the Judge's Post days… prompt (a range with a
 * skipped day, a Player's button staying Post day and a Player's range refused) and withdrawing a
 * posted day (a waiting day's dashed cell and tag, a Player's own project, a Player refused on
 * another's, a credited day with no X).
 *
 * Section 13 walks Finish (M-q3, ruling 223; M-r1's procedure: the component cost holds it, an item with a known formula and a
 * spell marked common finish with no throw, the Intellect bonus and the level raise are on the throw) with the die rigged on the GM seat (restored in the finally): a
 * known item delivered, an identification marked, a spell added and not added twice, a novel subject opening a
 * blank world item for the Judge, a failure and the automatic-failure band (the card posts, the project closes,
 * the bucket is spent), the formula recorded, read by the next throw and turned off by a substitute, Finish
 * disabled while the cost is not credited, with no throw read, and a Player's own Finish
 * (relayed) and the two they are refused. Every document it makes is tracked by uuid and swept by that list.
 *
 * Section 14 (A2) walks where a cast ritual's effect goes (M-r2b): Choose… is pressed on the awaiting row and the prompt is driven as a
 * user does (the radios, a real drop event on the zone, Confirm). A new scroll is read back off the researcher (marked a magic scroll,
 * recording the spell and the project), a charge off the kept rod (`system.charges.value` up by one, the maximum with it, the effect
 * listed), Take effect now opens the ordinary cast dialog and leaves the ritual waiting when it is cancelled, and a Player's own
 * researcher is placed through the relay while a rod held by a character the Player does not own is held with its reason and a rod
 * held by a second character the Player owns (not the researcher) takes the charge. Every project it places is already closed.
 *
 * Section 15 walks ownership as the gate on a place the Player owns outright (default Owner): the Player sets a facility value, creates a
 * project for the researcher they own with costs and a throw, edits its level, costs, paid and due through the inputs, and each value
 * reads back from the flag and from the inputs after a reopen, while the common mark, Post days… and a post of another day stay refused.
 *
 * Sections 9 to 11 walk the posted days (M-q2, ruling 222): a day posted from a
 * Player's seat at the pace its radios chose, the day strip and chip, a past day
 * posted by the Judge and held while its rate is unread (nothing credited or
 * written), then credited once the rate is read (a second call and a Player's
 * request credit nothing and write nothing), an assistant under the imported
 * level blocked for a Player and warned for a Judge, and a marked rung of the
 * ladder read at the printed rate for the kind the imported footnote names and
 * at the footnote's for another. The clock is shared and is never
 * moved: the day that has "passed" is a Judge's post with a backdated calendar
 * day, which is what a day posted earlier looks like once time moves. The hook
 * that credits on a clock step is not walked here.
 *
 * The figures are the registry's `libraryProse`, `researchLadder`,
 * `researchLadderNote`, `researchProse`, `assistantProse` and (section 13) `workshopProse` through the override
 * layer (invented), so the walk needs no import and sets nothing a Judge did not;
 * a table another hand already overrode blocks the walk. The hero's and Pell's
 * class levels are set from section 5 on and put back at the end of section 10. Prints counts and
 * booleans only.
 *
 * Fixtures, kept and found by marker (the GM seat builds them):
 * `magic/research-place` (a location with no market the Player may only observe,
 * so the Player's writes are relayed), `magic/research-hero` (a character the
 * Player owns, on the place's roster), `magic/research-pell` (a character on the
 * roster the Player does not own), `magic/research-lena` (a character the Player
 * owns who is NOT on the roster) and `magic/research-part` (an item to drop as a
 * component), plus for section 13 `magic/research-spell`, `magic/research-gear`, `magic/research-gear2` and
 * `magic/research-relic` (a spell, two items and an item to identify), and for section 14 `magic/research-ritual-spell` (the hero's own
 * ritual spell), `magic/research-wand` (the hero's rod, brought to no charge and no stored effect at the step's start), `magic/research-stray-rod` (a rod Pell holds) and
 * `magic/research-lena-rod` (a rod Lena holds, who is a second character the Player owns and who is not the researcher; brought to no charge
 * and no stored effect at the step's start), and for section 15 `magic/research-place-owned` (a location with no market at ownership default
 * Owner, the hero on its roster). The places' research records and rosters are set at the start and the
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
let rigged = false;
/** The uuid of every document this run made (items, cards, delivered items), swept in the finally by id and nothing else. */
const tracked = [];

const TABLE_IDS = ["libraryProse", "workshopProse", "researchLadder", "researchLadderNote", "researchProse", "assistantProse", "ritualWorkshopProse"];

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
  const part = await gm.fixture("magic/research-part", "Item", { name: "QA Research Part", type: "item", system: { cost: 12, quantity: 1 } });
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

  section("2. a facility value is the place's owner's");
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
  check("the Player's tab shows the value as text with no input, and the Research tab is theirs beside Storage, which an observer of the place sees", f2.inputs === 0 && /9000/.test(f2.text) && f2.tabs.includes("research") && f2.tabs.includes("storage"), f2);
  check("a facility write from a Player who does not own the place is refused where it runs, as the owner's, and nothing changed", f2.answer.ok === false && f2.answer.reason === "owner" && (await run(gm, U, `return flag().facilities?.library;`, ids)) === 9000, f2.answer);

  section("3. a Judge's project, and what the chip says with no level entered");
  const p1 = await run(gm, U, `
    const r = await research().create(place(), { kind: "spell", subject: { name: "QA Lantern" }, researcher: ID.pell, costs: { research: 40, component: 20 } });
    await sleep(900);
    const c = r.ok ? card(r.id) : null;
    const chip = c?.querySelector(".acks-extras-research__ph .acks-tag:not(.is-pow)");
    return { r: { ok: r.ok, warn: r.warn }, id: r.id, n: projects().length, p: projects()[0], card: !!c, chipTone: chip?.className, chipText: chip?.textContent.trim(), chipTip: chip?.getAttribute("data-tooltip-text") ?? "", finish: c?.querySelector(".acks-extras-research__foot .acks-btn--roll")?.disabled, why: c?.querySelector(".acks-extras-research__verdict")?.textContent.trim(), header: !!root().querySelector(".market-class-line .fa-flask") };`, ids);
  check("the Judge's create answered ok with no warning and the record holds one open project, stamped with the day", p1.r.ok && !p1.r.warn && p1.n === 1 && p1.p.status === "open" && Number.isInteger(p1.p.opened) && p1.p.researcher === ids.pell && p1.p.costs.research === 40, p1);
  check("the project's card is drawn, its facility chip is unread (no words, a tooltip with the page) and Finish is disabled with its reason as text", p1.card && !/is-(ok|warn)/.test(p1.chipTone) && p1.chipText === "" && /\bRR\b/.test(p1.chipTip) && p1.finish === true && p1.why.length > 0, { chipTone: p1.chipTone, chipText: p1.chipText, chipTip: p1.chipTip, finish: p1.finish, why: p1.why });
  check("the header counts the open project", p1.header === true);
  const IDA = p1.id;

  section("4. a Player starts a project through the relay, and is refused what is not theirs");
  const r1 = await run(player, U, `
    const a = place();
    const own = await research().create(a, { kind: "spell", subject: { name: "QA Scroll" }, researcher: ID.hero });
    const other = await research().create(a, { kind: "spell", researcher: ID.pell });
    const away = await research().create(a, { kind: "spell", researcher: ID.lena });
    const common = await research().create(a, { kind: "spell", researcher: ID.hero, common: true });
    await sleep(900);
    return { own: { ok: own.ok, warn: own.warn, id: own.id }, other: other.reason, away: away.reason, common: common.reason, held: projects().length };`, ids);
  check("a character the Player owns is started from the Player's seat (the answer came from the GM's client)", r1.own.ok === true && !r1.own.warn && r1.held === 2, r1);
  check("Pell (not the Player's) is the owner's refusal, Lena (not on the roster) is the roster's, and the common mark in a create is the Judge's (nothing is written, so two projects are held)", r1.other === "owner" && r1.away === "researcher" && r1.common === "judge" && r1.held === 2, r1);
  const IDB = r1.own.id;

  section("5. the facility chip reads the imported figures once the registry holds them");
  overrode = true;
  const lv0 = await gm.eval(`({ hero: Number(fromUuidSync(${JSON.stringify(ids.hero)}).system.details.level), pell: Number(fromUuidSync(${JSON.stringify(ids.pell)}).system.details.level) })`);
  const o1 = await run(gm, U, `
    ${tablesKit}
    await STORE.setOverride(D, "libraryProse", { minimum: 3000, step: 1500, bonusStep: 7000, bonusSize: 2, bonusCap: 5, share: 25 }, { sourceName: "qa-research-project" });
    await STORE.setOverride(D, "researchLadder", { r0: { label: 5, rate: "90gp", throw: "11+" } }, { sourceName: "qa-research-project" });
    await STORE.setOverride(D, "researchLadderNote", { otherProjectsRate: 40 }, { sourceName: "qa-research-project" });
    await STORE.setOverride(D, "researchProse", { ancillaryFraction: "1/4" }, { sourceName: "qa-research-project" });
    await STORE.setOverride(D, "assistantProse", { managerLevel: 4, managerBase: 2, aidLevel: 2, spellLevel: 6, itemLevel: 9 }, { sourceName: "qa-research-project" });
    await fromUuidSync(ID.hero).update({ "system.details.level": 5 });
    await fromUuidSync(ID.pell).update({ "system.details.level": 4 });
    // The two projects were started with no level, which reads as unread whatever the world has imported; the Judge enters it now.
    await research().update(place(), ID_A, { level: 2 });
    await research().update(place(), ID_B, { level: 2 });
    const served = await poll(() => research().verdicts(place(), ID_A)[0]?.minimum === 4500);
    const v = research().verdicts(place(), ID_A)[0];
    await open();
    await sleep(500);
    const chip = card(ID_A)?.querySelector(".acks-extras-research__ph .acks-tag:not(.is-pow)");
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
  // Step 5 pins the hero's class level, which is the walk's own write; the count starts after it.
  const hw0 = await gm.eval(`__rp.hero`);
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
      ownFields: c.querySelectorAll('[data-research-field="level"], [data-research-field^="costs"], [data-research-field^="paid"]').length,
      ownFieldsDisabled: [...c.querySelectorAll('[data-research-field="level"], [data-research-field^="costs"], [data-research-field^="paid"]')].filter((e) => e.disabled).length,
      theirFields: other.querySelectorAll('[data-research-field="level"], [data-research-field^="costs"], [data-research-field^="paid"]').length,
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
  check("the Player's own project draws live controls (none disabled by the sheet's lock) including the level, cost and paid boxes of a researcher's owner; a project of Pell's draws none of them", c2.mineControls >= 3 && c2.mineDisabled === 0 && c2.ownFields >= 3 && c2.ownFieldsDisabled === 0 && c2.theirFields === 0 && c2.theirs === 0, c2);
  // A researcher's owner who only observes the place writes the project's level, cost and paid through the relay.
  const c2b = await run(player, U, `
    await open();
    const IDB = ${JSON.stringify(IDB)};
    const p = () => projects().find((x) => x.id === IDB);
    const out = { writable: place().canUserModify(game.user, "update") };
    await change(card(IDB).querySelector('[data-research-field="costs.material"]'), "11");
    await change(card(IDB).querySelector('[data-research-field="paid.material"]'), "11");
    out.material = p().costs.material;
    out.paid = p().paid.material;
    out.paidDay = p().paid.day;
    await change(card(IDB).querySelector('[data-research-field="level"]'), "3");
    out.level3 = p().level;
    await change(card(IDB).querySelector('[data-research-field="level"]'), "2");
    out.level2 = p().level;
    out.shown = card(IDB).querySelector('[data-research-field="costs.material"]')?.value;
    return out;`, ids);
  check("the Player who owns the researcher and only observes the place writes the project's material cost (11), its material paid (11, stamped with the day) and its level (3, then 2) through the relay, each read back from the flag", c2b.writable === false && c2b.material === 11 && c2b.paid === 11 && Number.isInteger(c2b.paidDay) && c2b.level3 === 3 && c2b.level2 === 2 && c2b.shown === "11", c2b);
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

  section("9. research days: posted at a pace, credited once their day has passed");
  // The clock is shared by every seat and is never moved: a day that has passed is posted by the Judge with a past
  // calendar day (the stamp is backdated), which is exactly what a day posted earlier looks like once time moves.
  const d0 = await run(gm, U, `
    ${tablesKit}
    await STORE.setOverride(D, "researchLadder", { r0: { label: 4, rate: "30gp", throw: "15+", marked: false }, r1: { label: 5, rate: "90gp", throw: "11+", marked: false } }, { sourceName: "qa-research-project" });
    await STORE.setOverride(D, "researchLadderNote", { otherProjectsRate: 150, markedProjects: "4 30gp 15+ * for glasswork, spellcraft. u se 150gp" }, { sourceName: "qa-research-project" });
    const r = await research().create(place(), { kind: "spell", subject: { name: "QA Days" }, researcher: ID.hero, assistants: [ID.pell], costs: { research: 1000 } });
    const served = await poll(() => research().progress(place(), r.id)?.daily === 120);
    await sleep(600);
    await open();
    const prog = research().progress(place(), r.id);
    const c = card(r.id);
    const chip = c?.querySelector(".acks-tag.is-pow");
    const who = [...c.querySelectorAll(".acks-extras-research__who .acks-tag")].map((e) => e.textContent.replace(/\\s+/g, " ").trim());
    return { ok: r.ok, warn: r.warn, id: r.id, served, prog: { daily: prog.daily, dueDays: prog.dueDays, dueBy: prog.dueBy, complete: prog.complete }, chip: chip?.textContent.trim(), who, strip: c.querySelectorAll(".acks-extras-research__days i").length, t0: game.time.worldTime, today: (await import("/modules/acks-extras/scripts/lib/world-time.mjs")).dayOfWorldTime(game.time.worldTime) };`, ids);
  check("a project read against the invented ladder, share and assistant levels: a day is worth 120 (90 and 30), the due is 9 days computed from the rates, and the strip draws 9 empty cells", d0.ok && !d0.warn && d0.served && d0.prog.daily === 120 && d0.prog.dueDays === 9 && d0.prog.dueBy === "ladder" && d0.prog.complete === false && d0.strip === 9, d0);
  check("the day chip reads day 0 of 9 and each participant's chip names the rate it counts", /0.*9/.test(d0.chip ?? "") && d0.who.some((x) => /90/.test(x)) && d0.who.some((x) => /30/.test(x)), d0);
  const IDD = d0.id;
  const today = d0.today;
  const ww0 = await writes();
  const d1 = await run(player, U, `
    await open();
    const c = card(${JSON.stringify(IDD)});
    const radios = [...c.querySelectorAll("[data-research-pace]")];
    const anc = radios.find((r) => r.value === "ancillary");
    const own = { radios: radios.map((r) => [r.value, r.checked, r.disabled]), formOwned: radios.some((r) => !!r.form) };
    anc.checked = true;
    anc.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(700);
    own.postedAfterPick = projects().find((p) => p.id === ${JSON.stringify(IDD)}).posted?.length ?? 0;
    c.querySelector('[data-action="postResearchDay"]').click();
    await sleep(1500);
    const after = card(${JSON.stringify(IDD)});
    own.posted = projects().find((p) => p.id === ${JSON.stringify(IDD)}).posted;
    own.pickedAfter = [...after.querySelectorAll("[data-research-pace]")].find((r) => r.checked)?.value;
    own.postDisabled = after.querySelector('[data-action="postResearchDay"]').disabled;
    own.strip = { p: after.querySelectorAll(".acks-extras-research__days i.is-p").length, c: after.querySelectorAll(".acks-extras-research__days i.is-c").length, cells: after.querySelectorAll(".acks-extras-research__days i").length };
    own.again = await research().post(place(), ${JSON.stringify(IDD)}, { pace: "dedicated" });
    own.tomorrow = await research().post(place(), ${JSON.stringify(IDD)}, { pace: "dedicated", day: ${today + 1} });
    return own;`, ids);
  const ww1 = await writes();
  check("a Player's radios belong to no form and start on dedicated; picking ancillary writes nothing", d1.radios.length === 3 && d1.radios[0][1] === true && d1.formOwned === false && d1.postedAfterPick === 0, d1);
  check("Post from the Player's seat posts today at the ancillary pace through the relay, one write, and the window still shows ancillary picked", d1.posted?.length === 1 && d1.posted[0].day === today && d1.posted[0].pace === "ancillary" && ww1 - ww0 === 1 && d1.pickedAfter === "ancillary", { ...d1, writes: ww1 - ww0 });
  check("the control is then disabled, the strip draws one posted cell among the 10 the due needs, and a second post of the day and a Player's post of another day are refused", d1.postDisabled === true && d1.strip.p === 1 && d1.strip.c === 0 && d1.strip.cells === 10 && d1.again.reason === "duplicate" && d1.tomorrow.reason === "day", d1);

  // A passed day whose rate the import left unread is held: the ladder's rows carry no mark, so no rate reads.
  const dh = await run(gm, U, `
    ${tablesKit}
    const past = await research().post(place(), ${JSON.stringify(IDD)}, { pace: "dedicated", day: ${today - 2} });
    await sleep(900);
    await STORE.setOverride(D, "researchLadder", { r0: { label: 4, rate: "30gp", throw: "15+" }, r1: { label: 5, rate: "90gp", throw: "11+" } }, { sourceName: "qa-research-project" });
    await poll(() => research().progress(place(), ${JSON.stringify(IDD)})?.daily === null);
    const w = __rp.place;
    const asked = await research().credit(place());
    await sleep(1200);
    const wrote = __rp.place - w;
    const p = projects().find((x) => x.id === ${JSON.stringify(IDD)});
    const prog = research().progress(place(), ${JSON.stringify(IDD)});
    await open();
    const c = card(${JSON.stringify(IDD)});
    const tips = [...c.querySelectorAll("[data-tooltip-text]")].map((e) => e.dataset.tooltipText);
    return { past: past.ok, asked, wrote, posted: p.posted.length, credited: p.credited.length, prog: { unread: prog.unread, waiting: prog.waiting, days: prog.creditedDays, dueBy: prog.dueBy }, strip: { c: c.querySelectorAll(".acks-extras-research__days i.is-c").length, p: c.querySelectorAll(".acks-extras-research__days i.is-p").length, w: c.querySelectorAll(".acks-extras-research__days i.is-w").length }, tip: tips.some((t) => /RR 388/.test(t) && /held/.test(t)) };`, ids);
  check("a passed day whose rate the import left unread stays posted: credit answers 0 days and writes nothing, both posted days remain, no credited row is written and no due is computed", dh.past && dh.asked.ok === true && dh.asked.credited === 0 && dh.wrote === 0 && dh.posted === 2 && dh.credited === 0 && dh.prog.unread === 1 && dh.prog.waiting === 1 && dh.prog.days === 0 && dh.prog.dueBy === null, dh);
  check("the card draws the held day as a waiting cell (posted, not credited) beside today's posted one, and a tooltip names it as held with the page of the rate it waits on", dh.strip.c === 0 && dh.strip.w === 1 && dh.strip.p === 1 && dh.tip === true, dh);

  const d2 = await run(gm, U, `
    ${tablesKit}
    await STORE.setOverride(D, "researchLadder", { r0: { label: 4, rate: "30gp", throw: "15+", marked: false }, r1: { label: 5, rate: "90gp", throw: "11+", marked: false } }, { sourceName: "qa-research-project" });
    await poll(() => research().progress(place(), ${JSON.stringify(IDD)})?.daily === 120);
    const before = research().progress(place(), ${JSON.stringify(IDD)});
    const w = __rp.place;
    const first = await research().credit(place());
    await sleep(1200);
    const afterFirst = __rp.place;
    const second = await research().credit(place());
    await sleep(900);
    const p = projects().find((x) => x.id === ${JSON.stringify(IDD)});
    const prog = research().progress(place(), ${JSON.stringify(IDD)});
    await open();
    const c = card(${JSON.stringify(IDD)});
    return { waiting: before.waiting, first, second, writes: [afterFirst - w, __rp.place - afterFirst], credited: p.credited, posted: p.posted, prog: { days: prog.creditedDays, gp: prog.creditedGp, due: prog.dueDays, posted: prog.posted, waiting: prog.waiting }, strip: { c: c.querySelectorAll(".acks-extras-research__days i.is-c").length, p: c.querySelectorAll(".acks-extras-research__days i.is-p").length }, chip: c.querySelector(".acks-tag.is-pow")?.textContent.trim(), t1: game.time.worldTime };`, ids);
  check("with the rate read again the held day is credited by the next call: two rows (90 for the hero and 30 for Pell) stamped with that day, and today's ancillary day stays posted", d2.waiting === 1 && d2.first.credited === 1 && d2.credited.length === 2 && d2.credited.every((r) => r.day === today - 2) && d2.credited.find((r) => r.by === ids.hero)?.amount === 90 && d2.credited.find((r) => r.by === ids.pell)?.amount === 30 && d2.posted.length === 1 && d2.posted[0].day === today, d2);
  check("crediting is once: the second call credits nothing and writes nothing, one write for the first", d2.second.credited === 0 && d2.writes[0] === 1 && d2.writes[1] === 0, d2.writes);
  check("the standing reads 1 credited day and 120 gp, the due still computed (1 + 1 + 8 = 10 days), and the strip and chip follow", d2.prog.days === 1 && d2.prog.gp === 120 && d2.prog.due === 10 && d2.prog.posted === 1 && d2.prog.waiting === 0 && d2.strip.c === 1 && d2.strip.p === 1 && /2.*10/.test(d2.chip ?? ""), d2);
  check("the world clock was not moved by any of this", d2.t1 === d0.t0, { t0: d0.t0, t1: d2.t1 });
  const d3 = await run(player, U, `
    const asked = await research().credit(place());
    await sleep(900);
    return { asked, held: projects().find((x) => x.id === ${JSON.stringify(IDD)}).credited.length };`, ids);
  check("a Player's request to credit (relayed, on the sender's authority) finds nothing due and adds no row", d3.asked.ok === true && d3.asked.credited === 0 && d3.held === 2, d3);

  section("10. an assistant under the imported level: a Player is blocked and a Judge warned");
  await run(gm, U, `
    await fromUuidSync(ID.pell).update({ "system.details.level": 1 });
    await research().update(place(), ${JSON.stringify(IDD)}, { assistants: [] });
    await sleep(700);
    return true;`, ids);
  const g2 = await run(player, U, `
    const answer = await research().update(place(), ${JSON.stringify(IDD)}, { assistants: [ID.pell] });
    await sleep(700);
    return { answer, held: projects().find((x) => x.id === ${JSON.stringify(IDD)}).assistants };`, ids);
  check("Pell at the level under the aiding level is refused to the Player (relayed): the assistantLevel reason, nothing written", g2.answer.ok === false && g2.answer.reason === "assistantLevel" && g2.held.length === 0, g2);
  const g3 = await run(gm, U, `
    const answer = await research().update(place(), ${JSON.stringify(IDD)}, { assistants: [ID.pell] });
    await sleep(700);
    const prog = research().progress(place(), ${JSON.stringify(IDD)});
    return { ok: answer.ok, warn: answer.warn, held: projects().find((x) => x.id === ${JSON.stringify(IDD)}).assistants, counts: prog.people.map((x) => [x.role, x.counts, x.why]) };`, ids);
  check("the Judge is warned and the assistant is added, and counts for nothing", g3.ok === true && g3.warn === "assistantLevel" && g3.held.length === 1 && g3.counts.join("|") === "researcher,true,|assistant,false,below", g3);

  section("11. the footnote from the import: a marked rung's rate follows the projects the footnote names");
  // The hero is level 5 here, and the invented ladder marks that rung. The list is the override's text, as the importer
  // would read it, so which kind reads the printed rate comes from it and from nowhere in the module.
  const m1 = await run(gm, U, `
    ${tablesKit}
    const set = async (note) => {
      await STORE.setOverride(D, "researchLadder", { r0: { label: 5, rate: "90gp", throw: "11+", marked: true } }, { sourceName: "qa-research-project" });
      await STORE.setOverride(D, "researchLadderNote", note, { sourceName: "qa-research-project" });
    };
    await set({ otherProjectsRate: 40, markedProjects: "5 90gp 11+ * for glasswork, spellcraft. u se 40gp" });
    const a = await research().create(place(), { kind: "spell", researcher: ID.hero });
    const b = await research().create(place(), { kind: "item", researcher: ID.hero });
    const rate = (id) => research().progress(place(), id)?.people?.[0]?.rate ?? null;
    await poll(() => rate(a.id) === 90 && rate(b.id) === 40);
    const named = [rate(a.id), rate(b.id)];
    await set({ otherProjectsRate: 40, markedProjects: "5 90gp 11+ * for glasswork, itemcraft. u se 40gp" });
    await poll(() => rate(a.id) === 40 && rate(b.id) === 90);
    const flipped = [rate(a.id), rate(b.id)];
    await set({ otherProjectsRate: 40 });
    await poll(() => rate(a.id) === null && rate(b.id) === null);
    const unlisted = [rate(a.id), rate(b.id)];
    await research().close(place(), a.id);
    await research().close(place(), b.id);
    await sleep(600);
    return { made: [a.ok, b.ok], named, flipped, unlisted };`, ids);
  check("a marked rung reads the printed rate for the project the imported list names and the footnote's rate for another", m1.made.every(Boolean) && m1.named.join() === "90,40", m1);
  check("naming the other kind in the list swaps them, so the module holds no kind of its own", m1.flipped.join() === "40,90", m1);
  check("with the list unread a marked rung reads no rate for either kind", m1.unlisted.every((v) => v === null), m1);

  section("12. the Judge's due, Post days… and withdrawing a posted day (board 16)");
  // Known shape first: the ladder read (unmarked rows), no assistant on the project, the hero at level 5 from section 5.
  const LADDER_OK = `{ r0: { label: 4, rate: "30gp", throw: "15+", marked: false }, r1: { label: 5, rate: "90gp", throw: "11+", marked: false } }`;
  const LADDER_UNREAD = `{ r0: { label: 4, rate: "30gp", throw: "15+" }, r1: { label: 5, rate: "90gp", throw: "11+" } }`;
  const a1 = await run(gm, U, `
    ${tablesKit}
    await STORE.setOverride(D, "researchLadder", ${LADDER_OK}, { sourceName: "qa-research-project" });
    await STORE.setOverride(D, "researchLadderNote", { otherProjectsRate: 150, markedProjects: "4 30gp 15+ * for glasswork, spellcraft. u se 150gp" }, { sourceName: "qa-research-project" });
    const r = await research().create(place(), { kind: "spell", subject: { name: "QA Due" }, researcher: ID.hero, costs: { research: 1000 } });
    await poll(() => research().progress(place(), r.id)?.daily === 90);
    await sleep(600);
    await open();
    const c = card(r.id);
    const prog = research().progress(place(), r.id);
    return { ok: r.ok, id: r.id, prog: { dueDays: prog.dueDays, dueBy: prog.dueBy }, box: c.querySelectorAll('[data-research-field="dueDays"]').length, text: c.querySelector("[data-research-due]")?.textContent.trim() };`, ids);
  check("a project whose rate is read and whose research cost is entered computes its due (12 days), and the Judge's tab shows it as text with no box", a1.ok && a1.prog.dueDays === 12 && a1.prog.dueBy === "ladder" && a1.box === 0 && a1.text === "12", a1);
  const IDE = a1.id;
  const a2 = await run(gm, U, `
    ${tablesKit}
    await STORE.setOverride(D, "researchLadder", ${LADDER_UNREAD}, { sourceName: "qa-research-project" });
    await poll(() => research().progress(place(), ${JSON.stringify(IDE)})?.daily === null);
    await sleep(600);
    await open();
    const box = card(${JSON.stringify(IDE)}).querySelector('[data-research-field="dueDays"]');
    const out = { drawn: !!box, value: box?.value, tip: box?.dataset.tooltipText ?? "", label: box?.getAttribute("aria-label") ?? "", textGone: !card(${JSON.stringify(IDE)}).querySelector("[data-research-due]"), unrelatedBefore: projects().find((p) => p.id === ${JSON.stringify(IDE)}).dueDays };
    const w = __rp.place;
    await change(box, "7");
    out.writes = __rp.place - w;
    out.stored = projects().find((p) => p.id === ${JSON.stringify(IDE)}).dueDays;
    const prog = research().progress(place(), ${JSON.stringify(IDE)});
    out.prog = { dueDays: prog.dueDays, dueBy: prog.dueBy };
    out.shown = card(${JSON.stringify(IDE)}).querySelector('[data-research-field="dueDays"]')?.value;
    return out;`, ids);
  check("with the rate unread the Judge's tab draws the days-due box (blank, labelled, its tooltip naming the page of the rate) and no due text", a2.drawn && a2.value === "" && a2.unrelatedBefore === null && /RR 388/.test(a2.tip) && a2.label.length > 0 && a2.textGone, a2);
  check("typing 7 in the box writes dueDays once through the update field and the standing reads the Judge's 7", a2.writes === 1 && a2.stored === 7 && a2.prog.dueDays === 7 && a2.prog.dueBy === "judge" && a2.shown === "7", a2);
  const a3 = await run(player, U, `
    await open();
    const IDE = ${JSON.stringify(IDE)};
    const IDA = ${JSON.stringify(IDA)};
    const c = card(IDE);
    const theirs = card(IDA);
    const pr = (id) => projects().find((p) => p.id === id);
    const out = {
      writable: place().canUserModify(game.user, "update"),
      box: c.querySelectorAll('[data-research-field="dueDays"]').length,
      boxValue: c.querySelector('[data-research-field="dueDays"]')?.value,
      textGone: !c.querySelector("[data-research-due]"),
      theirBox: theirs.querySelectorAll('[data-research-field="dueDays"]').length,
      theirText: !!theirs.querySelector("[data-research-due]"),
      before: { due: pr(IDA).dueDays, material: pr(IDA).costs.material },
    };
    const mine = await research().update(place(), IDE, { dueDays: 3 });
    await sleep(900);
    out.apiOk = mine.ok;
    out.apiStored = pr(IDE).dueDays;
    await open();
    await change(card(IDE).querySelector('[data-research-field="dueDays"]'), "7");
    out.typed = pr(IDE).dueDays;
    const otherDue = await research().update(place(), IDA, { dueDays: 3 });
    const otherCost = await research().update(place(), IDA, { costs: { material: 99 } });
    await sleep(600);
    out.refused = [otherDue.reason, otherCost.reason];
    out.kept = { due: pr(IDA).dueDays, material: pr(IDA).costs.material };
    return out;`, ids);
  check("a Player who owns the researcher sees the days-due box holding 7 on their own project, with no due text, although the place is only observed; Pell's project (not theirs) shows the due as text with no box", a3.writable === false && a3.box === 1 && a3.boxValue === "7" && a3.textGone === true && a3.theirBox === 0 && a3.theirText === true, a3);
  check("the Player's write of the due on their own project is accepted through the relay (3 by the API, then 7 typed in the box, read back from the flag), and a due write and a cost write on Pell's project are each refused as the owner's with nothing changed", a3.apiOk === true && a3.apiStored === 3 && a3.typed === 7 && a3.refused.join() === "owner,owner" && a3.kept.due === a3.before.due && a3.kept.material === a3.before.material, a3);
  const a4 = await run(gm, U, `
    ${tablesKit}
    await STORE.setOverride(D, "researchLadder", ${LADDER_OK}, { sourceName: "qa-research-project" });
    await poll(() => research().progress(place(), ${JSON.stringify(IDE)})?.daily === 90);
    await sleep(600);
    await open();
    const c = card(${JSON.stringify(IDE)});
    return { box: c.querySelectorAll('[data-research-field="dueDays"]').length, text: c.querySelector("[data-research-due]")?.textContent.trim(), prog: research().progress(place(), ${JSON.stringify(IDE)}).dueBy };`, ids);
  check("with the rate read again the computed due (12) is text and the box is gone, whatever the Judge typed", a4.box === 0 && a4.text === "12" && a4.prog === "ladder", a4);

  // B. Post days…
  const bw0 = await writes();
  const b3 = await run(gm, U, `
    await research().post(place(), ${JSON.stringify(IDE)}, { day: ${today + 1}, pace: "dedicated" });
    await sleep(900);
    await open();
    const btn = card(${JSON.stringify(IDE)}).querySelector('[data-action="postResearchDays"]');
    const out = { label: btn?.textContent.trim(), single: !!card(${JSON.stringify(IDE)}).querySelector('[data-action="postResearchDay"]') };
    const seen = [];
    const info = ui.notifications.info;
    ui.notifications.info = (m, ...rest) => { seen.push(String(m)); return info.call(ui.notifications, m, ...rest); };
    btn.click();
    const dlg = await until(() => document.querySelector(".acks-extras-research-prompt")?.closest(".application"));
    out.prompt = !!dlg;
    out.classes = dlg ? [...dlg.classList].filter((k) => k.startsWith("acks-")).join() : "";
    out.fields = dlg ? { days: dlg.querySelector('input[name="days"]')?.value, from: dlg.querySelector('input[name="from"]')?.value, pressed: [...dlg.querySelectorAll("[data-pace]")].filter((p) => p.getAttribute("aria-pressed") === "true").map((p) => p.dataset.pace), grip: !!dlg.querySelector(".window-resize-handle") } : null;
    const days = dlg.querySelector('input[name="days"]');
    const from = dlg.querySelector('input[name="from"]');
    days.value = "4"; days.dispatchEvent(new Event("input", { bubbles: true }));
    from.value = "${today}"; from.dispatchEvent(new Event("input", { bubbles: true }));
    out.caption = dlg.querySelector("[data-range-caption]")?.textContent.trim();
    dlg.querySelector('[data-pace="both"]').click();
    out.pressed = [...dlg.querySelectorAll("[data-pace]")].filter((p) => p.getAttribute("aria-pressed") === "true").map((p) => p.dataset.pace);
    dlg.querySelector('button[data-action="ok"]').click();
    await until(() => !document.querySelector(".acks-extras-research-prompt"));
    await sleep(1500);
    ui.notifications.info = info;
    out.seen = seen;
    out.posted = projects().find((p) => p.id === ${JSON.stringify(IDE)}).posted.map((r) => [r.day, r.pace]);
    return out;`, ids);
  const bw1 = await writes();
  check("a Judge's Post button is the range control (no Post day beside it) and opens a prompt that names the module's classes; it starts on 1 day from today at the window's pace (dedicated)", typeof b3.label === "string" && b3.label.length > 0 && b3.single === false && b3.prompt && /acks-extras/.test(b3.classes) && b3.fields?.days === "1" && b3.fields?.from === String(today) && b3.fields?.pressed.join() === "dedicated", b3);
  check("the caption follows the fields, a pill picks the pace (one pressed), and Post writes the range once: the day already posted is skipped and keeps its pace, the other three are posted at the chosen pace", b3.caption?.includes(String(today)) && b3.caption?.includes(String(today + 3)) && b3.pressed.join() === "both" && bw1 - bw0 === 2 && b3.posted.length === 4 && b3.posted.filter(([d, p]) => p === "both").map(([d]) => d).join() === [today, today + 2, today + 3].join() && b3.posted.find(([d]) => d === today + 1)[1] === "dedicated", { ...b3, writes: bw1 - bw0 });
  check("the result notification names the days it posted and the day it skipped", b3.seen.some((m) => m.includes(String(today + 1)) && m.includes(String(today)) && m.includes(String(today + 3))), b3.seen);
  const b4 = await run(gm, U, `
    const w = __rp.place;
    const again = await research().postRange(place(), ${JSON.stringify(IDE)}, { pace: "both", from: ${today}, days: 4 });
    const zero = await research().postRange(place(), ${JSON.stringify(IDE)}, { from: ${today}, days: 0 });
    await sleep(700);
    return { again: { ok: again.ok, posted: again.posted, skipped: again.skipped }, zero: zero.reason, writes: __rp.place - w };`, ids);
  check("the same range again posts nothing and writes nothing (all four skipped), and a count of 0 is refused as a range", b4.again.ok === true && b4.again.posted.length === 0 && b4.again.skipped.length === 4 && b4.zero === "range" && b4.writes === 0, b4);
  const b5 = await run(player, U, `
    await open();
    const c = card(${JSON.stringify(IDE)});
    const btn = c.querySelector('[data-action="postResearchDay"]');
    const out = { single: !!btn, label: btn?.textContent.trim(), range: !!c.querySelector('[data-action="postResearchDays"]'), disabled: btn?.disabled };
    const w = (await research().postRange(place(), ${JSON.stringify(IDE)}, { pace: "both", from: ${today + 10}, days: 2 }));
    await sleep(700);
    out.refused = w.reason;
    out.posted = projects().find((p) => p.id === ${JSON.stringify(IDE)}).posted.length;
    return out;`, ids);
  check("a Player's button stays Post day (a different label from the Judge's, disabled while today is posted) and never opens the prompt; a range asked of the relay is refused as the Judge's and writes nothing", b5.single === true && b5.label !== b3.label && b5.range === false && b5.disabled === true && b5.refused === "judge" && b5.posted === 4, b5);

  // C. withdrawing
  const c3 = await run(gm, U, `
    ${tablesKit}
    const IDE = ${JSON.stringify(IDE)};
    await research().post(place(), IDE, { day: ${today - 5}, pace: "dedicated" });
    const credited = await research().credit(place(), IDE);
    await sleep(1200);
    await research().post(place(), IDE, { day: ${today - 4}, pace: "dedicated" });
    await sleep(900);
    await STORE.setOverride(D, "researchLadder", ${LADDER_UNREAD}, { sourceName: "qa-research-project" });
    await poll(() => research().progress(place(), IDE)?.unread === 1);
    await sleep(600);
    await open();
    const c = card(IDE);
    const rows = [...c.querySelectorAll("[data-posted-day]")].map((r) => ({ day: Number(r.dataset.postedDay), tag: r.querySelector(".acks-tag")?.className, tip: r.querySelector(".acks-tag")?.dataset.tooltipText ?? "", x: !!r.querySelector('[data-action="withdrawResearchDay"]'), xLabel: r.querySelector('[data-action="withdrawResearchDay"]')?.getAttribute("aria-label") ?? "" }));
    return { credited: credited.credited, held: research().progress(place(), IDE).heldDays, credits: projects().find((p) => p.id === IDE).credited.map((r) => r.day), rows, waitingCells: c.querySelectorAll(".acks-extras-research__days i.is-w").length, creditedCells: c.querySelectorAll(".acks-extras-research__days i.is-c").length, creditedX: c.querySelectorAll('[data-action="withdrawResearchDay"][data-day="${today - 5}"]').length };`, ids);
  const waitRow = c3.rows.find((r) => r.day === today - 4);
  check("one day is credited (today-5) and the day posted after the rate went unread (today-4) is held: its strip cell is the dashed waiting one", c3.credited === 1 && c3.credits.join() === String(today - 5) && c3.held.join() === String(today - 4) && c3.waitingCells === 1 && c3.creditedCells === 1, c3);
  check("the list under the strip has a row for each of the five posted days and none for the credited day: the held one is tagged waiting with a tooltip naming the page, the rest posted, each with an X, and the credited day has no X", c3.rows.length === 5 && !c3.rows.some((r) => r.day === today - 5) && /is-warn/.test(waitRow.tag) && /RR 388/.test(waitRow.tip) && c3.rows.filter((r) => !/is-warn/.test(r.tag)).length === 4 && c3.rows.every((r) => r.x && r.xLabel.length > 0) && c3.creditedX === 0, c3.rows);
  // A day of Pell's project, which the Player does not own.
  await run(gm, U, `
    await research().post(place(), ${JSON.stringify(IDA)}, { day: ${today + 5}, pace: "dedicated" });
    await sleep(900);
    return true;`, ids);
  const c4 = await run(player, U, `
    await open();
    const mine = card(${JSON.stringify(IDE)});
    const theirs = card(${JSON.stringify(IDA)});
    const out = { mineX: mine.querySelectorAll('[data-action="withdrawResearchDay"]').length, theirRows: theirs.querySelectorAll("[data-posted-day]").length, theirX: theirs.querySelectorAll('[data-action="withdrawResearchDay"]').length, disabled: [...mine.querySelectorAll('[data-action="withdrawResearchDay"]')].filter((b) => b.disabled).length };
    const refused = await research().withdraw(place(), ${JSON.stringify(IDA)}, ${today + 5});
    await sleep(700);
    out.refused = refused.reason;
    out.theirKept = projects().find((p) => p.id === ${JSON.stringify(IDA)}).posted.map((r) => r.day);
    const credited = await research().withdraw(place(), ${JSON.stringify(IDE)}, ${today - 5});
    out.creditedRefused = credited.reason;
    const x = card(${JSON.stringify(IDE)}).querySelector('[data-action="withdrawResearchDay"][data-day="${today + 3}"]');
    x.click();
    await sleep(1500);
    out.after = projects().find((p) => p.id === ${JSON.stringify(IDE)}).posted.map((r) => r.day);
    out.rowGone = !card(${JSON.stringify(IDE)}).querySelector('[data-posted-day="${today + 3}"]');
    return out;`, ids);
  check("a Player's own project draws an X on every posted day, none disabled by the sheet's lock; Pell's project lists its day with no X", c4.mineX === 5 && c4.disabled === 0 && c4.theirRows === 1 && c4.theirX === 0, c4);
  check("the Player's X takes back a posted day of their own project through the relay and the row goes; the same request for Pell's project is refused as the owner's and the day stands; a credited day is refused", c4.after.join() === [today - 4, today, today + 1, today + 2].join() && c4.rowGone === true && c4.refused === "owner" && c4.theirKept.join() === String(today + 5) && c4.creditedRefused === "credited", c4);
  const c5 = await run(gm, U, `
    await open();
    const IDE = ${JSON.stringify(IDE)};
    const x = card(IDE).querySelector('[data-action="withdrawResearchDay"][data-day="${today - 4}"]');
    x.click();
    await sleep(1500);
    const out = { after: projects().find((p) => p.id === IDE).posted.map((r) => r.day), waitingCells: card(IDE).querySelectorAll(".acks-extras-research__days i.is-w").length };
    out.notPosted = (await research().withdraw(place(), IDE, ${today + 40})).reason;
    out.credited = (await research().withdraw(place(), IDE, ${today - 5})).reason;
    const theirs = await research().withdraw(place(), ${JSON.stringify(IDA)}, ${today + 5});
    out.judgeAny = theirs.ok;
    await sleep(700);
    out.theirLeft = projects().find((p) => p.id === ${JSON.stringify(IDA)}).posted.length;
    out.creditsKept = projects().find((p) => p.id === IDE).credited.map((r) => r.day);
    return out;`, ids);
  check("the Judge's X withdraws the waiting day (its dashed cell goes), a day that is not posted is refused as notPosted, a credited one as credited and its row stands; the Judge withdraws a day of Pell's project too", c5.after.join() === [today, today + 1, today + 2].join() && c5.waitingCells === 0 && c5.notPosted === "notPosted" && c5.credited === "credited" && c5.judgeAny === true && c5.theirLeft === 0 && c5.creditsKept.join() === String(today - 5), c5);
  await run(gm, U, `
    ${tablesKit}
    await research().close(place(), ${JSON.stringify(IDE)});
    await STORE.setOverride(D, "researchLadder", ${LADDER_OK}, { sourceName: "qa-research-project" });
    await sleep(600);
    return true;`, ids);

  section("13. Finish (ruling 223): the throw, the result by kind, the formula, the bucket and the card");
  // The die is rigged on the GM seat, where every Finish of a Player's is applied too (the place is theirs to observe only).
  // `CONFIG.Dice.randomUniform` reads from the top: 1 - (die - 0.5) / 20 throws that natural die on core 14. Restored in the finally.
  const spellFx = await gm.fixture("magic/research-spell", "Item", { name: "QA Research Spell", type: "spell", system: { lvl: 2 } });
  const gearFx = await gm.fixture("magic/research-gear", "Item", { name: "QA Research Gear", type: "item", system: { cost: 5, quantity: 1 } });
  const gear2Fx = await gm.fixture("magic/research-gear2", "Item", { name: "QA Research Gear Two", type: "item", system: { cost: 5, quantity: 1 } });
  const relicFx = await gm.fixture("magic/research-relic", "Item", { name: "QA Research Relic", type: "item", system: { cost: 5, quantity: 1 } });
  const ids13 = { ...ids, spell: spellFx.uuid, gear: gearFx.uuid, gear2: gear2Fx.uuid, relic: relicFx.uuid };
  const mkPart = async (name) => {
    const made = await gm.create("Item", { name, type: "item", system: { cost: 40, quantity: 1 } });
    tracked.push(made.uuid);
    return made.uuid;
  };
  const rig13 = (die) => {
    rigged = true;
    return gm.eval(`(() => { globalThis.__rpDice ??= CONFIG.Dice.randomUniform; CONFIG.Dice.randomUniform = () => 1 - (${die} - 0.5) / 20; return true; })()`);
  };
  // A step that needs a known shape asserts it at its start: the ladder read, the hero at level 5, no formula, the relic unidentified.
  const f0 = await run(gm, U, `
    ${tablesKit}
    await STORE.setOverride(D, "researchLadder", ${LADDER_OK}, { sourceName: "qa-research-project" });
    await STORE.setOverride(D, "researchProse", { ancillaryFraction: "1/4", autoFailBand: [1, 2], penalty: -3, penaltyMinimum: -2 }, { sourceName: "qa-research-project" });
    // The workshop's passage is read too (an item project reads it; an identification reads its own bonus from it), with invented figures:
    // a Finish is held while any facility bonus it needs is unread, so every kind this section finishes needs its table.
    await STORE.setOverride(D, "workshopProse", { minimum: 3500, step: 1700, bonusStep: 6000, bonusSize: 1, bonusCap: 4, identifyResearch: 800, identifyBonusStep: 8000, identifyBonusSize: 1, identifyBonusCap: 2 }, { sourceName: "qa-research-project" });
    await research().setFacility(place(), "library", 90000);
    await research().setFacility(place(), "workshop", 90000);
    const hero = fromUuidSync(ID.hero);
    await hero.update({ "system.details.level": 5, "flags.acks-extras.magic.-=formulas": null });
    await fromUuidSync(ID.relic).update({ "flags.acks-extras.markets.-=identified": null });
    await sleep(500);
    return { level: Number(hero.system.details.level), carries: [...hero.items].filter((i) => /^QA Research (Spell|Gear)/.test(i.name)).length, formulas: research().formulas(hero).length };`, ids13);
  if (f0.carries) blocked("the hero already carries one of the walk's spell or gear items: a leaving of a run that did not sweep");
  check("the step starts from a known shape: the hero at level 5 and no formula researched", f0.level === 5 && f0.formulas === 0, f0);
  // A project made ready to finish: one past day posted at the dedicated pace and credited at the ladder's rate for level 5, so the research cost is met.
  // The component cost is the 40 a component item is worth when a bucket is passed, else none (an empty bucket would hold Finish); `component` overrides it.
  const makeReady = (spec, bucket = [], component = bucket.length ? 40 : 0) => run(gm, U, `
    const r = await research().create(place(), { researcher: ID.hero, level: 2, costs: { research: 90, component: ${component} }, ...${JSON.stringify(spec)} });
    await research().post(place(), r.id, { day: ${today - 3}, pace: "dedicated" });
    await sleep(700);
    const c = await research().credit(place(), r.id);
    await sleep(900);
    ${bucket.length ? `await research().update(place(), r.id, { bucket: ${JSON.stringify(bucket)} }); await sleep(700);` : ""}
    return { id: r.id, ok: r.ok, credited: c.credited, complete: research().progress(place(), r.id)?.complete };`, ids13);
  // The page's view of what a Finish wrote: the hero's items and the hero's roll cards that were not there before.
  const snap = `
    const hero = fromUuidSync(ID.hero);
    const heldIds = () => [...hero.items].map((i) => i.id);
    const before = { items: heldIds(), msgs: [...game.messages].map((m) => m.id) };
    const proj = (id) => projects().find((p) => p.id === id);
    const newItems = () => [...hero.items].filter((i) => !before.items.includes(i.id));
    const newCards = () => [...game.messages].filter((m) => !before.msgs.includes(m.id) && m.speaker?.actor === hero.id && String(m.content).includes("acks-extras-roll-card"));`;

  // A. a known item, by the button.
  const partA = await mkPart("QA Research Component A");
  const fa = await makeReady({ kind: "item", subject: { uuid: ids13.gear, name: "QA Research Gear" } }, [{ uuid: partA, qty: 1, fit: "matched" }]);
  await rig13(20);
  const k1 = await run(gm, U, `
    ${snap}
    await open();
    const btn = card(${JSON.stringify(fa.id)}).querySelector('[data-action="finishResearchProject"]');
    const planA = await research().plan(place(), ${JSON.stringify(fa.id)});
    const out = { enabled: !!btn && !btn.disabled, controlMark: !!btn?.hasAttribute("data-research-control"), plan: { target: planA.target, by: planA.by, levelRaise: planA.levelRaise, int: planA.int, intUnread: planA.intUnread, noThrow: planA.noThrow } };
    btn.click();
    await until(() => proj(${JSON.stringify(fa.id)})?.status === "closed", 80);
    // The card is posted after the writers and the settlement, so it is waited for, not timed.
    await until(() => newCards().length > 0, 80);
    await sleep(500);
    const p = proj(${JSON.stringify(fa.id)});
    out.status = p.status;
    out.outcome = p.outcome;
    out.newItems = newItems().map((i) => ({ name: i.name, uuid: i.uuid }));
    out.formulas = research().formulas(hero).map((f) => [f.kind, f.name]);
    out.cards = newCards().map((m) => ({ id: m.uuid, target: String(m.content).includes(out.plan.target + "+"), success: /is-success/.test(String(m.content)), rolls: m.rolls?.length ?? 0 }));
    out.cardGone = !card(${JSON.stringify(fa.id)});
    return out;`, ids13);
  for (const n of k1.newItems) { tracked.push(n.uuid); gm.track(n.uuid, "Item"); }
  for (const c of k1.cards) { tracked.push(c.id); gm.track(c.id, "ChatMessage"); }
  check("a project credited in full has a live Finish (the control mark); pressing it throws the rigged 20 on the Judge's seat, closes the project and stamps the outcome", fa.credited === 1 && fa.complete === true && k1.enabled && k1.controlMark && k1.status === "closed" && k1.outcome?.result === "success" && k1.outcome?.die === 20, { fa, k1: { enabled: k1.enabled, controlMark: k1.controlMark, outcome: k1.outcome, cardGone: k1.cardGone } });
  check("the plan before the press reads the ladder's rung for level 5 (11) raised by the project's level of 2 (13), the Intellect bonus as a number, and no throw is waived", k1.plan.by === "ladder" && k1.plan.levelRaise === 2 && k1.plan.target === 13 && Number.isFinite(k1.plan.int) && k1.plan.intUnread === false && k1.plan.noThrow === null, k1.plan);
  check("on success the known item reaches the researcher as one new item and the formula for the subject is recorded on the researcher", k1.newItems.length === 1 && k1.newItems[0].name === "QA Research Gear" && k1.formulas.some(([kind, name]) => kind === "item" && name === "QA Research Gear"), { newItems: k1.newItems, formulas: k1.formulas });
  check("the outcome is one card through the shared roll card, spoken as the researcher, carrying the die, the raised ladder target and a success mark", k1.cards.length === 1 && k1.cards[0].target && k1.cards[0].success && k1.cards[0].rolls === 1, k1.cards);
  check("the component bucket was settled: the component item no longer exists", (await gm.eval(`fromUuidSync(${JSON.stringify(partA)}) === null`)) === true);

  // B. an identification.
  const fb = await makeReady({ kind: "identify", subject: { uuid: ids13.relic, name: "QA Research Relic" } });
  await rig13(20);
  const k2 = await run(gm, U, `
    ${snap}
    const r = await research().finish(place(), ${JSON.stringify(fb.id)});
    await sleep(1500);
    return { r: { ok: r.ok, outcome: r.outcome, written: r.written?.map((w) => w.what), failed: r.failed }, identified: fromUuidSync(ID.relic).getFlag("acks-extras", "markets")?.identified, newItems: newItems().length, formulas: research().formulas(hero).length, cards: newCards().map((m) => m.uuid) };`, ids13);
  for (const c of k2.cards) { tracked.push(c); gm.track(c, "ChatMessage"); }
  check("an identification marks the item fully identified, adds nothing to the researcher and records no formula", fb.complete === true && k2.r.ok && k2.r.outcome === "success" && k2.r.written.join() === "identify" && k2.identified === "full" && k2.newItems === 0 && k2.formulas === 1 && k2.r.failed.length === 0 && k2.cards.length === 1, k2);

  // C. a known spell; then the same subject again, where the formula is read and a substitute turns it off.
  const fc1 = await makeReady({ kind: "spell", subject: { uuid: ids13.spell, name: "QA Research Spell" } });
  await rig13(20);
  const k3 = await run(gm, U, `
    ${snap}
    const r = await research().finish(place(), ${JSON.stringify(fc1.id)});
    await sleep(1500);
    return { r: { ok: r.ok, written: r.written?.map((w) => w.what) }, spells: [...hero.items].filter((i) => i.type === "spell" && i.name === "QA Research Spell").map((i) => i.uuid), formulas: research().formulas(hero).map((f) => [f.kind, f.name]), cards: newCards().map((m) => m.uuid) };`, ids13);
  for (const u of k3.spells) { tracked.push(u); gm.track(u, "Item"); }
  for (const c of k3.cards) { tracked.push(c); gm.track(c, "ChatMessage"); }
  check("a known spell joins the researcher's spells (one copy) and its formula is recorded", fc1.complete === true && k3.r.ok && k3.r.written.join() === "spell,formula" && k3.spells.length === 1 && k3.formulas.some(([kind, name]) => kind === "spell" && name === "QA Research Spell"), k3);
  const partC = await mkPart("QA Research Component C");
  const fc2 = await makeReady({ kind: "spell", subject: { uuid: ids13.spell, name: "QA Research Spell" } }, [{ uuid: partC, qty: 1, fit: "substitute" }]);
  const pl1 = await run(gm, U, `
    const sub = await research().plan(place(), ${JSON.stringify(fc2.id)});
    await research().update(place(), ${JSON.stringify(fc2.id)}, { bucket: [{ uuid: ${JSON.stringify(partC)}, qty: 1, fit: "matched" }] });
    await sleep(700);
    const matched = await research().plan(place(), ${JSON.stringify(fc2.id)});
    return { sub, matched };`, ids13);
  check("the next throw for the same subject reads the researcher's formula: with a matched component it is applied; with a substitute it is not, and the substitute takes the penalty at the invented figures (3 a level, level 2, the whole cost: 6) against the ladder's target of 11 raised by the level (13), the modifier carrying the Intellect bonus", pl1.matched.formula.known && pl1.matched.formula.used && pl1.matched.penalty === 0 && pl1.sub.formula.known && !pl1.sub.formula.used && pl1.sub.penalty === -6 && pl1.sub.modifier === pl1.sub.bonus + pl1.sub.int - 6 && pl1.sub.target === 13 && pl1.sub.levelRaise === 2 && pl1.sub.by === "ladder" && pl1.sub.noThrow === null, { sub: pl1.sub, matched: pl1.matched });
  await rig13(20);
  const k3b = await run(gm, U, `
    ${snap}
    const r = await research().finish(place(), ${JSON.stringify(fc2.id)});
    await sleep(1500);
    return { r: { ok: r.ok, written: r.written?.map((w) => [w.what, w.held === true]) }, spells: [...hero.items].filter((i) => i.type === "spell" && i.name === "QA Research Spell").length, cards: newCards().map((m) => m.uuid) };`, ids13);
  for (const c of k3b.cards) { tracked.push(c); gm.track(c, "ChatMessage"); }
  check("a spell the researcher already carries is not added twice: the writer reports it held and the spell count stays one", k3b.r.ok && k3b.r.written.some(([w, held]) => w === "spell" && held) && k3b.spells === 1, k3b);

  // D. a novel subject: a blank document for the Judge.
  const fd = await makeReady({ kind: "item", subject: { name: "QA Novel Thing" } });
  await rig13(20);
  const k4 = await run(gm, U, `
    ${snap}
    const r = await research().finish(place(), ${JSON.stringify(fd.id)});
    await sleep(1800);
    const made = r.written?.find((w) => w.what === "blank");
    const item = made ? fromUuidSync(made.uuid) : null;
    return { r: { ok: r.ok, written: r.written?.map((w) => w.what) }, blank: item ? { uuid: item.uuid, name: item.name, type: item.type, world: !item.parent, open: item.sheet?.rendered === true } : null, formula: research().formulas(hero).find((f) => f.name === "QA Novel Thing") ?? null, cards: newCards().map((m) => m.uuid) };`, ids13);
  if (k4.blank) { tracked.push(k4.blank.uuid); gm.track(k4.blank.uuid, "Item"); }
  for (const c of k4.cards) { tracked.push(c); gm.track(c, "ChatMessage"); }
  check("a subject no document answers to becomes a blank world item carrying the project's name, its sheet opened on the Judge's seat, and the formula keeps the new document's uuid", k4.r.ok && k4.r.written.join() === "blank,formula" && k4.blank?.name === "QA Novel Thing" && k4.blank?.type === "item" && k4.blank?.world === true && k4.blank?.open === true && k4.formula?.uuid === k4.blank?.uuid, k4);
  await gm.eval(`(async () => { await fromUuidSync(${JSON.stringify(k4.blank?.uuid ?? "")})?.sheet?.close({ animate: false }); return true; })()`);

  // E. a failure and the automatic-failure band: nothing is written, but the project closes, the bucket is spent and the card posts.
  const partE = await mkPart("QA Research Component E");
  // The second gear: the first is a known formula by now, and a known item is finished with no throw.
  const fe = await makeReady({ kind: "item", subject: { uuid: ids13.gear2, name: "QA Research Gear Two" }, throw: { target: 18 } }, [{ uuid: partE, qty: 1, fit: "matched" }]);
  await rig13(3);
  const k5 = await run(gm, U, `
    ${snap}
    const r = await research().finish(place(), ${JSON.stringify(fe.id)});
    await sleep(1500);
    return { r: { ok: r.ok, outcome: r.outcome, auto: r.auto, written: r.written?.length }, newItems: newItems().length, status: proj(${JSON.stringify(fe.id)})?.status, result: proj(${JSON.stringify(fe.id)})?.outcome?.result, cards: newCards().map((m) => ({ id: m.uuid, failure: /is-failure/.test(String(m.content)) })) };`, ids13);
  for (const c of k5.cards) { tracked.push(c.id); gm.track(c.id, "ChatMessage"); }
  check("a plain failure (die 3 against a Judge's 18) writes nothing, closes the project as a failure, spends the component and posts a failure card", fe.complete === true && k5.r.ok && k5.r.outcome === "failure" && k5.r.auto === false && k5.r.written === 0 && k5.newItems === 0 && k5.status === "closed" && k5.result === "failure" && k5.cards.length === 1 && k5.cards[0].failure && (await gm.eval(`fromUuidSync(${JSON.stringify(partE)}) === null`)) === true, k5);
  const fg = await makeReady({ kind: "item", subject: { uuid: ids13.gear2, name: "QA Research Gear Two" }, throw: { target: 1 } });
  await rig13(2);
  const k6 = await run(gm, U, `
    ${snap}
    const r = await research().finish(place(), ${JSON.stringify(fg.id)});
    await sleep(1500);
    return { r: { ok: r.ok, outcome: r.outcome, auto: r.auto, total: r.total, target: r.target }, newItems: newItems().length, cards: newCards().map((m) => m.uuid) };`, ids13);
  for (const c of k6.cards) { tracked.push(c); gm.track(c, "ChatMessage"); }
  check("a die inside the imported automatic-failure band (2) fails although the total meets a target of 1, and delivers nothing", k6.r.ok && k6.r.outcome === "failure" && k6.r.auto === true && k6.r.total >= k6.r.target && k6.newItems === 0, k6);

  // H. the component cost holds Finish: a short bucket is named on the card with the page, the API refuses it unrolled, and paying frees it.
  const partH = await mkPart("QA Research Component H");
  const fs1 = await makeReady({ kind: "item", subject: { name: "QA Short Thing" } }, [], 40);
  await rig13(20);
  const h1 = await run(gm, U, `
    ${snap}
    await open();
    const read = () => { const c = card(${JSON.stringify(fs1.id)}); const b = c?.querySelector('[data-action="finishResearchProject"]'); return { disabled: b?.disabled === true, mark: !!b?.hasAttribute("data-research-control"), why: c?.querySelector(".acks-extras-research__verdict")?.textContent.trim() ?? "", tip: b?.dataset.tooltipText ?? "" }; };
    const out = { short: read(), plan: (await research().plan(place(), ${JSON.stringify(fs1.id)}))?.components };
    const refused = await research().finish(place(), ${JSON.stringify(fs1.id)});
    out.refused = refused.reason;
    out.untouched = { status: proj(${JSON.stringify(fs1.id)})?.status, items: newItems().length, cards: newCards().length };
    await research().update(place(), ${JSON.stringify(fs1.id)}, { bucket: [{ uuid: ${JSON.stringify(partH)}, qty: 1, fit: "matched" }] });
    await sleep(900);
    await open();
    out.paid = read();
    out.paidPlan = (await research().plan(place(), ${JSON.stringify(fs1.id)}))?.components;
    await research().close(place(), ${JSON.stringify(fs1.id)});
    await sleep(600);
    return out;`, ids13);
  check("a bucket short of the component cost holds Finish: disabled with no control mark, its reason beside it and the page of the costs in its tooltip, the plan says short, and the API refuses it as componentsShort before a die, an item or a card exists", h1.short.disabled && !h1.short.mark && h1.short.why.length > 0 && /RR ch\. 8/.test(h1.short.tip) && h1.plan.short === true && h1.plan.hold === true && h1.refused === "componentsShort" && h1.untouched.status === "open" && h1.untouched.items === 0 && h1.untouched.cards === 0, h1);
  check("the same project with a component worth the cost in its bucket is live again, and the plan no longer holds", h1.paid.disabled === false && h1.paid.mark === true && h1.paidPlan.hold === false && h1.paidPlan.short === false, { paid: h1.paid, plan: h1.paidPlan });

  // I. an item whose formula is known is finished with no roll (the formula for the first gear was recorded in A).
  const fi = await makeReady({ kind: "item", subject: { uuid: ids13.gear, name: "QA Research Gear" } });
  await rig13(1);
  const i1 = await run(gm, U, `
    ${snap}
    await open();
    const btn = card(${JSON.stringify(fi.id)}).querySelector('[data-action="finishResearchProject"]');
    const planI = await research().plan(place(), ${JSON.stringify(fi.id)});
    // The delivery folds into the stack the hero already carries from A, so what it added is read as quantity.
    const held = () => [...hero.items].filter((i) => i.name === "QA Research Gear").reduce((n, i) => n + Number(i.system.quantity ?? 0), 0);
    const out = { enabled: !!btn && !btn.disabled, tip: btn?.dataset.tooltipText ?? "", noThrow: planI.noThrow, formula: planI.formula, heldBefore: held() };
    // The die is counted: the rigged 1 is inside the automatic-failure band, so a throw would fail; no throw reads no die at all.
    const real = CONFIG.Dice.randomUniform;
    let draws = 0;
    CONFIG.Dice.randomUniform = () => { draws++; return real(); };
    btn.click();
    await until(() => proj(${JSON.stringify(fi.id)})?.status === "closed", 80);
    await sleep(2000);
    CONFIG.Dice.randomUniform = real;
    const p = proj(${JSON.stringify(fi.id)});
    out.draws = draws;
    out.outcome = p.outcome;
    out.heldAfter = held();
    out.newItems = newItems().map((i) => ({ name: i.name, uuid: i.uuid }));
    out.cards = newCards().map((m) => ({ id: m.uuid, success: /is-success/.test(String(m.content)), rolls: m.rolls?.length ?? 0 }));
    return out;`, ids13);
  for (const n of i1.newItems) { tracked.push(n.uuid); gm.track(n.uuid, "Item"); }
  for (const c of i1.cards) { tracked.push(c.id); gm.track(c.id, "ChatMessage"); }
  check("a project for an item whose formula the researcher holds, with no substitute, reads noThrow 'formula' and a live Finish whose tooltip says it makes no throw", fi.complete === true && i1.enabled && i1.noThrow === "formula" && i1.formula.used === true && /no throw/i.test(i1.tip), { fi, i1: { enabled: i1.enabled, noThrow: i1.noThrow, formula: i1.formula, tip: i1.tip } });
  check("pressing it rolls no die (none drawn although the rigged 1 would have failed), closes the project as a success with no die, total or target stamped, delivers the item (the held stack grows by one) and posts one card with no dice", i1.draws === 0 && i1.outcome?.result === "success" && i1.outcome?.die === null && i1.outcome?.total === null && i1.outcome?.target === null && i1.outcome?.noThrow === "formula" && i1.heldAfter === i1.heldBefore + 1 && i1.cards.length === 1 && i1.cards[0].success && i1.cards[0].rolls === 0, i1);

  // J. a spell the Judge marks common is finished with no roll; the throw's tooltip names the Intellect bonus and the level before it is.
  const fj = await makeReady({ kind: "spell", subject: { uuid: ids13.spell, name: "QA Research Spell" } });
  await rig13(1);
  const jt1 = await run(gm, U, `
    ${snap}
    await open();
    const tips = [...card(${JSON.stringify(fj.id)}).querySelectorAll("[data-tooltip-text]")].map((e) => e.dataset.tooltipText);
    const planJ = await research().plan(place(), ${JSON.stringify(fj.id)});
    return { tips: { intellect: tips.some((t) => /Intellect/.test(t)), level: tips.some((t) => /level of effect/.test(t)), signed: tips.some((t) => t.includes((planJ.int >= 0 ? "+" : "") + planJ.int + " Intellect")) }, plan: { noThrow: planJ.noThrow, int: planJ.int, levelRaise: planJ.levelRaise, target: planJ.target } };`, ids13);
  check("the throw's tooltip names the Intellect bonus (with the actor's own figure) and the level of effect that raises the target", jt1.tips.intellect && jt1.tips.level && jt1.tips.signed && jt1.plan.levelRaise === 2 && jt1.plan.noThrow === null, jt1);
  const jt2 = await run(player, U, `
    const r = await research().update(place(), ${JSON.stringify(fj.id)}, { common: true });
    await sleep(700);
    return { reason: r.reason, ok: r.ok, stored: projects().find((p) => p.id === ${JSON.stringify(fj.id)})?.common };`, ids13);
  check("a Player's write of the common mark is refused as the Judge's (relayed, the attested sender decides) and nothing is stored", jt2.ok === false && jt2.reason === "judge" && jt2.stored !== true, jt2);
  // The Judge's check on the sheet (board 18 A): a real click on the checkbox writes the mark; the Finish label follows. An item project shows no such check.
  const jt2b = await run(gm, U, `
    const itemProj = await research().create(place(), { kind: "item", researcher: ID.hero, level: 2, subject: { uuid: ID.gear2, name: "QA Research Gear Two" } });
    await sleep(900);
    await open();
    const fin = () => card(${JSON.stringify(fj.id)})?.querySelector('[data-action="finishResearchProject"]')?.textContent.trim() ?? "";
    const box = () => card(${JSON.stringify(fj.id)})?.querySelector('input[type="checkbox"][data-research-field="common"]');
    const before = { has: !!box(), checked: box()?.checked, label: box()?.closest("label")?.textContent.trim(), tip: box()?.closest("label")?.dataset.tooltipText, finish: fin(), stored: projects().find((p) => p.id === ${JSON.stringify(fj.id)})?.common === true };
    const level = card(${JSON.stringify(fj.id)}).querySelector('[data-research-field="level"]');
    const costs = card(${JSON.stringify(fj.id)}).querySelector('[data-research-field^="costs."]');
    const underLevel = !!level && !!box() && !!costs && !!(level.compareDocumentPosition(box()) & Node.DOCUMENT_POSITION_FOLLOWING) && !!(costs.compareDocumentPosition(box()) & Node.DOCUMENT_POSITION_PRECEDING);
    box().click();
    const stored = await until(() => projects().find((p) => p.id === ${JSON.stringify(fj.id)})?.common === true, 80);
    await until(() => box()?.checked === true && /common spell/i.test(fin()), 80);
    const after = { stored, checked: box()?.checked, finish: fin() };
    const itemCard = card(itemProj.id);
    await research().close(place(), itemProj.id);
    await sleep(700);
    return { before, after, underLevel, itemDrawn: !!itemCard, itemHas: !!itemCard?.querySelector('[data-research-field="common"]') };`, ids13);
  check("the Judge's Research tab offers 'Common spell (no throw)' on a spell project, unchecked with the page in its tooltip and Finish unchanged; a real click on it writes common to the project, leaves it checked and the Finish label reads 'Finish (common spell)'; an item project shows no such check", jt2b.before.has && jt2b.before.checked === false && jt2b.before.stored === false && /^Common spell \(no throw\)$/.test(jt2b.before.label) && /RR/.test(jt2b.before.tip ?? "") && !/common spell/i.test(jt2b.before.finish) && jt2b.after.stored === true && jt2b.after.checked === true && /^Finish \(common spell\)$/.test(jt2b.after.finish) && jt2b.underLevel && jt2b.itemDrawn && jt2b.itemHas === false, jt2b);
  const jt2c = await run(player, U, `
    await open();
    const rows = [...card(${JSON.stringify(fj.id)}).querySelectorAll(".acks-extras-research__parts > span")].map((s) => s.textContent.trim());
    const at = rows.indexOf("Common spell");
    return { at, next: rows[at + 1], control: !!card(${JSON.stringify(fj.id)}).querySelector('[data-research-field="common"]'), finish: card(${JSON.stringify(fj.id)}).querySelector('[data-action="finishResearchProject"]')?.textContent.trim() };`, ids13);
  check("a Player's seat shows the mark as a 'Common spell' / 'no throw' row once the Judge has set it, with no checkbox", jt2c.at >= 0 && jt2c.next === "no throw" && jt2c.control === false && /^Finish \(common spell\)$/.test(jt2c.finish), jt2c);
  const jt3 = await run(gm, U, `
    ${snap}
    const marked =await research().update(place(), ${JSON.stringify(fj.id)}, { common: true });
    await sleep(900);
    const planJ = await research().plan(place(), ${JSON.stringify(fj.id)});
    const real = CONFIG.Dice.randomUniform;
    let draws = 0;
    CONFIG.Dice.randomUniform = () => { draws++; return real(); };
    const r = await research().finish(place(), ${JSON.stringify(fj.id)});
    await sleep(1500);
    CONFIG.Dice.randomUniform = real;
    return { marked: marked.ok, noThrow: planJ.noThrow, draws, r: { ok: r.ok, outcome: r.outcome, die: r.die, total: r.total, target: r.target, noThrow: r.noThrow, written: r.written?.map((w) => w.what) }, outcome: proj(${JSON.stringify(fj.id)})?.outcome, cards: newCards().map((m) => ({ id: m.uuid, success: /is-success/.test(String(m.content)), rolls: m.rolls?.length ?? 0 })) };`, ids13);
  for (const c of jt3.cards) { tracked.push(c.id); gm.track(c.id, "ChatMessage"); }
  check("a Judge's common mark is stored; the spell then finishes with no die drawn (the rigged 1 would have failed), as a success with no die, total or target, a card with no dice, and the spell reported held", jt3.marked === true && jt3.noThrow === "common" && jt3.draws === 0 && jt3.r.ok && jt3.r.outcome === "success" && jt3.r.die === null && jt3.r.total === null && jt3.r.target === null && jt3.r.noThrow === "common" && jt3.outcome?.noThrow === "common" && jt3.cards.length === 1 && jt3.cards[0].success && jt3.cards[0].rolls === 0, jt3);

  // F. Finish is disabled, with its reason beside it, until it can be made.
  const fh = await run(gm, U, `
    ${tablesKit}
    const mk = (spec) => research().create(place(), { researcher: ID.hero, level: 2, ...spec });
    const waiting = await mk({ kind: "item", costs: { research: 90 } });
    const rit = await mk({ kind: "ritual", level: 5, costs: { research: 90 } });
    const blind = await mk({ kind: "item", costs: { research: 90 } });
    // A Judge's target, so the ladder this block blanks cannot hold it first: only the unread bonus may.
    const unlevelled = await mk({ kind: "item", level: null, costs: { research: 90 }, throw: { target: 12 } });
    for (const x of [blind, unlevelled]) {
      await research().post(place(), x.id, { day: ${today - 3}, pace: "dedicated" });
      await sleep(700);
      await research().credit(place(), x.id);
      await sleep(900);
    }
    await STORE.setOverride(D, "researchLadder", { r0: { label: 5, rate: "90gp", marked: false } }, { sourceName: "qa-research-project" });
    await poll(() => research().progress(place(), blind.id)?.daily === 90);
    await open();
    const read = (id) => { const c = card(id); const b = c?.querySelector('[data-action="finishResearchProject"]'); return { disabled: b?.disabled === true, mark: !!b?.hasAttribute("data-research-control"), why: c?.querySelector(".acks-extras-research__verdict")?.textContent.trim() ?? "" }; };
    const out = { waiting: read(waiting.id), ritual: read(rit.id), blind: read(blind.id), complete: research().progress(place(), blind.id)?.complete };
    out.target = (await research().plan(place(), blind.id))?.target;
    // A project with no level entered cannot read its facility's bonus: Finish is held, naming it, the page in the tooltip.
    const held = card(unlevelled.id)?.querySelector('[data-action="finishResearchProject"]');
    out.unlevelled = { ...read(unlevelled.id), tip: held?.dataset.tooltipText ?? "", plan: (await research().plan(place(), unlevelled.id))?.bonusUnread, refused: (await research().finish(place(), unlevelled.id)).reason };
    await research().update(place(), unlevelled.id, { level: 2 });
    await sleep(900);
    await open();
    out.levelled = read(unlevelled.id);
    out.refused = [(await research().finish(place(), waiting.id)).reason, (await research().finish(place(), rit.id)).reason, (await research().finish(place(), blind.id)).reason];
    for (const x of [waiting, rit, blind, unlevelled]) await research().close(place(), x.id);
    await STORE.setOverride(D, "researchLadder", ${LADDER_OK}, { sourceName: "qa-research-project" });
    await sleep(600);
    return out;`, ids13);
  check("with the research cost not credited, for a project and for a ritual alike, Finish is disabled with no control mark and its reason beside it; the API refuses both as notComplete before anything is rolled", [fh.waiting, fh.ritual].every((s) => s.disabled && !s.mark && s.why.length > 0) && fh.refused[0] === "notComplete" && fh.refused[1] === "notComplete", fh);
  check("a credited project whose ladder prints no throw reads no target and is disabled with its reason; the API refuses it as throwUnread (the throw is not made up)", fh.complete === true && fh.target === null && fh.blind.disabled && !fh.blind.mark && fh.blind.why.length > 0 && fh.refused[2] === "throwUnread", fh);

  check("a credited project whose facility bonus cannot be read (no level entered) is held, not thrown with the bonus missing: Finish is disabled with its reason and the page in its tooltip, the plan says the bonus is unread, the API refuses it as bonusUnread, and entering the level frees it", fh.unlevelled.disabled && !fh.unlevelled.mark && fh.unlevelled.why.length > 0 && /RR/.test(fh.unlevelled.tip) && fh.unlevelled.plan === true && fh.unlevelled.refused === "bonusUnread" && fh.levelled.disabled === false && fh.levelled.mark === true, { unlevelled: fh.unlevelled, levelled: fh.levelled });

  // G. a Player's own Finish, and what is refused them.
  const partG = await mkPart("QA Research Component G");
  const own = await run(player, U, `
    const r = await research().create(place(), { kind: "item", researcher: ID.hero, level: 2, subject: { uuid: ID.gear2, name: "QA Research Gear Two" } });
    await sleep(900);
    return { ok: r.ok, id: r.id, reason: r.reason };`, ids13);
  const gp = await run(gm, U, `
    await research().update(place(), ${JSON.stringify(own.id)}, { costs: { research: 90 } });
    await research().post(place(), ${JSON.stringify(own.id)}, { day: ${today - 3}, pace: "dedicated" });
    await sleep(700);
    await research().credit(place(), ${JSON.stringify(own.id)});
    await sleep(900);
    return { complete: research().progress(place(), ${JSON.stringify(own.id)})?.complete };`, ids13);
  const fp = await makeReady({ kind: "item", subject: { uuid: ids13.gear, name: "QA Research Gear" } }, [{ uuid: partG, qty: 1, fit: "matched" }]);
  await rig13(20);
  const q1 = await run(player, U, `
    ${snap}
    await open();
    const btn = card(${JSON.stringify(own.id)})?.querySelector('[data-action="finishResearchProject"]');
    const out = { live: !!btn && !btn.disabled && btn.hasAttribute("data-research-control") };
    btn?.click();
    await until(() => proj(${JSON.stringify(own.id)})?.status === "closed", 100);
    await sleep(2500);
    out.status = proj(${JSON.stringify(own.id)})?.status;
    out.outcome = proj(${JSON.stringify(own.id)})?.outcome?.result;
    out.newItems = newItems().map((i) => i.uuid);
    out.cards = newCards().map((m) => m.uuid);
    return out;`, ids13);
  for (const u of q1.newItems ?? []) { tracked.push(u); gm.track(u, "Item"); }
  for (const u of q1.cards ?? []) { tracked.push(u); gm.track(u, "ChatMessage"); }
  check("a Player's own credited project has a live Finish on their seat; pressing it is relayed, the GM's client throws the rigged die, and the item reaches their character", own.ok === true && gp.complete === true && q1.live && q1.status === "closed" && q1.outcome === "success" && q1.newItems.length === 1 && q1.cards.length === 1, { own, gp, q1 });
  const q2 = await run(player, U, `
    const component = await research().finish(place(), ${JSON.stringify(fp.id)});
    const owner = await research().finish(place(), ${JSON.stringify(IDA)});
    await sleep(600);
    return { component: component.reason, owner: owner.reason, stillOpen: projects().find((p) => p.id === ${JSON.stringify(fp.id)})?.status, other: projects().find((p) => p.id === ${JSON.stringify(IDA)})?.status };`, ids13);
  check("a Player's Finish whose bucket holds a component they do not own is refused as bucketOwner before anything is thrown, and a project of a character they do not own is refused as the owner's; both stay open", q2.component === "bucketOwner" && q2.owner === "owner" && q2.stillOpen === "open" && q2.other === "open", q2);
  await run(gm, U, `
    await research().close(place(), ${JSON.stringify(fp.id)});
    await research().setFacility(place(), "library", 9000);
    await research().setFacility(place(), "workshop", null);
    await fromUuidSync(ID.hero).update({ "flags.acks-extras.magic.-=formulas": null });
    await fromUuidSync(ID.relic).update({ "flags.acks-extras.markets.-=identified": null });
    await sleep(600);
    return true;`, ids13);

  section("14. board 17: a ritual project, Add power and Finish (formula)");
  // Not yet run: written with the slice. The ritual's workshop passage is read with invented figures, like the sections above.
  await run(gm, U, `
    ${tablesKit}
    await STORE.setOverride(D, "ritualWorkshopProse", { workshopMinimums: "1,000gp for 5 level spells", bonusStep: 5000, bonusSize: 2, bonusCap: 6 }, { sourceName: "qa-research-project" });
    await research().setFacility(place(), "workshop", 90000);
    await fromUuidSync(ID.hero).update({ "system.details.level": 5, "flags.acks-extras.magic.-=formulas": null, "flags.acks-extras.-=power": null });
    await sleep(600);
    return true;`, ids13);
  // A. a ritual: a miscellaneous row is barred and the bucket stays short; matched components let it be thrown for, and it waits on where it goes.
  const partR = await mkPart("QA Research Component R");
  const partM = await mkPart("QA Research Component M");
  const ritual = await makeReady({ kind: "ritual", level: 5, subject: { uuid: ids13.spell, name: "QA Research Spell" } }, [{ uuid: partM, qty: 1, fit: "miscellaneous" }]);
  const ra = await run(gm, U, `
    await open();
    const c = card(${JSON.stringify(ritual.id)});
    const chip = c.querySelector('.acks-extras-bucket__row [data-fit]');
    const btn = c.querySelector('[data-action="finishResearchProject"]');
    return { chip: chip?.textContent.trim(), chipTone: chip?.className ?? "", chipTip: chip?.dataset.tooltipText ?? "", off: !!c.querySelector(".acks-extras-bucket__row.is-off"), disabled: btn?.disabled === true, why: c.querySelector(".acks-extras-research__verdict")?.textContent.trim() ?? "", refused: (await research().finish(place(), ${JSON.stringify(ritual.id)})).reason };`, ids13);
  check("a ritual's miscellaneous component wears the barred chip (danger tone, the page in its tooltip), the row is dimmed, the bucket stays short, Finish is disabled with its reason and the API refuses it as componentsShort", ra.chip?.toLowerCase() === "barred" && /is-bad/.test(ra.chipTone) && ra.chipTip.length > 0 && ra.off && ra.disabled && ra.why.length > 0 && ra.refused === "componentsShort", ra);
  await rig13(20);
  const rb = await run(gm, U, `
    ${snap}
    await research().update(place(), ${JSON.stringify(ritual.id)}, { bucket: [{ uuid: ${JSON.stringify(partM)}, qty: 1, fit: "miscellaneous" }, { uuid: ${JSON.stringify(partR)}, qty: 1, fit: "matched" }] });
    await sleep(800);
    await open();
    const btn = card(${JSON.stringify(ritual.id)}).querySelector('[data-action="finishResearchProject"]');
    const out = { enabled: !!btn && !btn.disabled };
    btn.click();
    await until(() => proj(${JSON.stringify(ritual.id)})?.status === "closed", 80);
    await sleep(2000);
    const p = proj(${JSON.stringify(ritual.id)});
    out.status = p.status;
    out.outcome = p.outcome;
    await open();
    const row = tab().querySelector('.acks-extras-research__awaiting-row[data-project-id="' + ${JSON.stringify(ritual.id)} + '"]');
    out.awaiting = { present: !!row, tag: row?.querySelector(".acks-tag")?.textContent.trim() ?? "", chooseLive: !!row?.querySelector('[data-action="chooseResearchPlacement"]') && row.querySelector('[data-action="chooseResearchPlacement"]').disabled === false };
    out.cards = newCards().map((m) => m.uuid);
    out.kept = !!fromUuidSync(${JSON.stringify(partM)});
    out.spent = !fromUuidSync(${JSON.stringify(partR)}) || Number(fromUuidSync(${JSON.stringify(partR)}).system.quantity) === 0;
    return out;`, ids13);
  for (const u of rb.cards ?? []) { tracked.push(u); gm.track(u, "ChatMessage"); }
  check("with a matched component the ritual is thrown for: the project closes, stamps `pending: placement`, shows `cast · awaiting where it goes` with a live Choose…, the card posts, the matched row is spent and the barred row is kept", rb.enabled && rb.status === "closed" && rb.outcome?.result === "success" && rb.outcome?.pending === "placement" && rb.awaiting.present && rb.awaiting.tag.length > 0 && rb.awaiting.chooseLive && rb.cards.length === 1 && rb.kept && rb.spent, rb);

  // A2. where a cast ritual's effect goes (M-r2b): Choose… is driven through the UI for each placement, and each write is read back from the world.
  // The researcher holds a kept ritual spell (the project's subject, so Take effect now has the caster's own item to cast) and a kept rod (the charge's item).
  const ritualSpellFx = await gm.fixture("magic/research-ritual-spell", "Item", { name: "QA Research Ritual Spell", type: "spell", system: { lvl: 3 }, flags: { "acks-extras": { spell: { ritual: true } } } }, { parent: ids13.hero });
  const rodFx = await gm.fixture("magic/research-wand", "Item", { name: "QA Research Rod", type: "item", system: { charges: { value: 0, max: 0 } } }, { parent: ids13.hero });
  const strayRodFx = await gm.fixture("magic/research-stray-rod", "Item", { name: "QA Research Stray Rod", type: "item", system: { charges: { value: 0, max: 0 } } }, { parent: ids13.pell });
  // Lena is the second character the Player owns (and not the researcher, and not on the roster): her rod is the one a Player's charge may go in besides the researcher's.
  const lenaRodFx = await gm.fixture("magic/research-lena-rod", "Item", { name: "QA Research Lena Rod", type: "item", system: { charges: { value: 0, max: 0 } } }, { parent: ids13.lena });
  // A step that needs a known shape asserts it at its start: the kept rod holds no charge and records no effect.
  const shape2 = await run(gm, U, `
    const rod = await fromUuid(${JSON.stringify(rodFx.uuid)});
    await rod.update({ "system.charges.value": 0, "system.charges.max": 0, "flags.acks-extras.magic.-=stored": null });
    await sleep(400);
    const fresh = await fromUuid(${JSON.stringify(rodFx.uuid)});
    return { value: fresh.system.charges.value, max: fresh.system.charges.max, stored: fresh.flags?.["acks-extras"]?.magic?.stored ?? null, scrolls: [...fromUuidSync(ID.hero).items].filter((i) => /^Scroll of QA Research/.test(i.name)).length };`, ids13);
  if (shape2.scrolls) blocked("the hero already carries a scroll of one of the walk's spells: a leaving of a run that did not sweep");
  check("the step starts from a known shape: the kept rod holds no charge and no stored effect", shape2.value === 0 && shape2.max === 0 && shape2.stored === null, shape2);
  const shape3 = await run(gm, U, `
    const rod = await fromUuid(${JSON.stringify(lenaRodFx.uuid)});
    await rod.update({ "system.charges.value": 0, "system.charges.max": 0, "flags.acks-extras.magic.-=stored": null });
    await sleep(400);
    const fresh = await fromUuid(${JSON.stringify(lenaRodFx.uuid)});
    const player = game.users.get(${JSON.stringify(playerId)});
    return { value: fresh.system.charges.value, max: fresh.system.charges.max, stored: fresh.flags?.["acks-extras"]?.magic?.stored ?? null, holder: fresh.parent?.uuid, holderOwned: fresh.parent?.testUserPermission(player, "OWNER") === true, strayHolderOwned: fromUuidSync(ID.pell).testUserPermission(player, "OWNER") === true };`, ids13);
  check("the second charged item starts from a known shape: Lena's rod holds no charge and no stored effect, Lena is not the researcher and the Player owns her, and the Player owns no part of Pell, who holds the stray rod", shape3.value === 0 && shape3.max === 0 && shape3.stored === null && shape3.holder === ids13.lena && shape3.holder !== ids13.hero && shape3.holderOwned === true && shape3.strayHolderOwned === false, shape3);
  const ritualSpec = { kind: "ritual", level: 5, subject: { uuid: ritualSpellFx.uuid, name: "QA Research Ritual Spell" } };
  const finishRitual = async (spec) => {
    const part = await mkPart("QA Research Component P");
    const made = await makeReady(spec, [{ uuid: part, qty: 1, fit: "matched" }]);
    await rig13(20);
    const done = await run(gm, U, `
      ${snap}
      const f = await research().finish(place(), ${JSON.stringify(made.id)});
      await until(() => newCards().length > 0, 80);
      await sleep(500);
      return { ok: f.ok, pending: f.pending, cards: newCards().map((m) => m.uuid) };`, ids13);
    for (const u of done.cards ?? []) { tracked.push(u); gm.track(u, "ChatMessage"); }
    return { id: made.id, ...done };
  };
  // The page's drive of Choose…: open the tab, press the row's control, take the prompt that opens, and hand back what it shows.
  const chooser = (id) => `
    const row = () => tab().querySelector('.acks-extras-research__awaiting-row[data-project-id="${id}"]');
    const promptOf = () => document.querySelector("[data-placement-drop]")?.closest(".application") ?? null;
    const radio = (dlg, v) => dlg.querySelector('input[name="placement"][value="' + v + '"]');
    const choose = async () => {
      await open();
      const btn = row()?.querySelector('[data-action="chooseResearchPlacement"]');
      if (!btn || btn.disabled) return null;
      btn.click();
      return until(promptOf, 80);
    };
    const shown = (dlg) => ({ okDisabled: dlg.querySelector('button[data-action="ok"]')?.disabled === true, why: dlg.querySelector("[data-placement-why]")?.textContent.trim() ?? "", dropActive: dlg.querySelector("[data-placement-drop]")?.hasAttribute("data-active") === true, classed: dlg.classList.contains("acks-extras-scroll") });
    const pick = async (dlg, v) => { radio(dlg, v).click(); await sleep(250); };
    const dropOn = async (dlg, uuid) => {
      const dt = new DataTransfer();
      dt.setData("text/plain", JSON.stringify({ type: "Item", uuid }));
      dlg.querySelector("[data-placement-drop]").dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
      await sleep(500);
    };`;

  // The ritual A cast is the first: a new scroll.
  const scrollRun = await run(gm, U, `
    ${snap}
    ${chooser(ritual.id)}
    const dlg = await choose();
    if (!dlg) return { prompt: false };
    const out = { prompt: true, initial: shown(dlg) };
    await pick(dlg, "charge");
    out.charge = shown(dlg);
    await dropOn(dlg, ID.relic);
    out.badDrop = shown(dlg);
    await pick(dlg, "scroll");
    out.scroll = shown(dlg);
    dlg.querySelector('button[data-action="ok"]').click();
    await until(() => proj(${JSON.stringify(ritual.id)})?.outcome?.placed === "scroll", 80);
    await until(() => newCards().length > 0, 80);
    await sleep(800);
    const p = proj(${JSON.stringify(ritual.id)});
    const made = [...hero.items].filter((i) => /^Scroll of QA Research Spell/.test(i.name));
    out.outcome = p.outcome;
    out.status = p.status;
    out.scrolls = made.map((i) => ({ uuid: i.uuid, kind: i.flags?.["acks-extras"]?.markets?.kind, magic: i.flags?.["acks-extras"]?.markets?.magic, stored: i.flags?.["acks-extras"]?.magic?.stored }));
    out.closed = !promptOf();
    await open();
    out.stillAwaiting = !!row();
    out.cards = newCards().map((m) => ({ uuid: m.uuid, text: String(m.content).replace(/<[^>]+>/g, " ").replace(/\\s+/g, " ").trim() }));
    return out;`, ids13);
  for (const s of scrollRun.scrolls ?? []) { tracked.push(s.uuid); gm.track(s.uuid, "Item"); }
  for (const c of scrollRun.cards ?? []) { tracked.push(c.uuid); gm.track(c.uuid, "ChatMessage"); }
  check("Choose… on the awaiting ritual opens a prompt in the scroll contract on Take effect now with Confirm enabled and the drop zone off", scrollRun.prompt && scrollRun.initial.classed && !scrollRun.initial.okDisabled && !scrollRun.initial.dropActive, scrollRun.initial);
  check("As a charge in an item turns the drop zone on and holds Confirm with its reason shown; an item a charge cannot go in leaves it held with its reason", scrollRun.charge.dropActive && scrollRun.charge.okDisabled && scrollRun.charge.why.length > 0 && scrollRun.badDrop.okDisabled && scrollRun.badDrop.why.length > 0 && scrollRun.badDrop.why !== scrollRun.charge.why, { charge: scrollRun.charge, badDrop: scrollRun.badDrop });
  check("On a new scroll with Confirm writes it: the prompt closes, the project's `pending` is gone and `placed` is scroll, one scroll exists on the researcher marked a magic scroll and recording the spell and the project, and one card names where it went", scrollRun.scroll.dropActive === false && !scrollRun.scroll.okDisabled && scrollRun.closed && scrollRun.status === "closed" && scrollRun.outcome?.placed === "scroll" && scrollRun.outcome.pending === undefined && scrollRun.scrolls.length === 1 && scrollRun.scrolls[0].kind === "scroll" && scrollRun.scrolls[0].magic === true && scrollRun.scrolls[0].stored?.[0]?.project === ritual.id && scrollRun.scrolls[0].stored[0].name === "QA Research Spell" && scrollRun.cards.length === 1 && scrollRun.stillAwaiting === false, scrollRun);

  // A second ritual: as a charge in the kept rod, by a real drop. The stray rod is another character's, and the control writes nothing for it.
  const chargeProj = await finishRitual(ritualSpec);
  const chargeRun = await run(gm, U, `
    ${snap}
    ${chooser(chargeProj.id)}
    const dlg = await choose();
    if (!dlg) return { prompt: false };
    const out = { prompt: true };
    await pick(dlg, "charge");
    await dropOn(dlg, ${JSON.stringify(strayRodFx.uuid)});
    out.stray = shown(dlg);
    await dropOn(dlg, ${JSON.stringify(rodFx.uuid)});
    out.rod = shown(dlg);
    dlg.querySelector('button[data-action="ok"]').click();
    await until(() => proj(${JSON.stringify(chargeProj.id)})?.outcome?.placed === "charge", 80);
    await until(() => newCards().length > 0, 80);
    await sleep(800);
    const rod = await fromUuid(${JSON.stringify(rodFx.uuid)});
    out.outcome = proj(${JSON.stringify(chargeProj.id)}).outcome;
    out.charges = rod.system.charges;
    out.stored = rod.flags?.["acks-extras"]?.magic?.stored ?? null;
    out.cards = newCards().map((m) => m.uuid);
    return out;`, ids13);
  for (const u of chargeRun.cards ?? []) { tracked.push(u); gm.track(u, "ChatMessage"); }
  check("a Judge may store into a rod another character holds: the prompt accepts it (Confirm enabled)", chargeRun.stray?.okDisabled === false, chargeRun.stray);
  check("the kept rod takes the charge: `system.charges.value` rose by one, the maximum with it, the effect is recorded under the module's magic flag, the project is answered and one card posts", chargeRun.prompt && chargeRun.rod.dropActive && !chargeRun.rod.okDisabled && chargeRun.charges?.value === 1 && chargeRun.charges.max === 1 && chargeRun.stored?.length === 1 && chargeRun.stored[0].project === chargeProj.id && chargeRun.outcome?.placed === "charge" && chargeRun.cards.length === 1, chargeRun);

  // The Player seat: the hero is the Player's own researcher, so Choose… is live there. Another character's rod is held with its reason, and a scroll is written through the relay.
  const playerProj = await finishRitual(ritualSpec);
  const playerRun = await run(player, U, `
    ${snap}
    ${chooser(playerProj.id)}
    const dlg = await choose();
    if (!dlg) return { prompt: false };
    const out = { prompt: true };
    await pick(dlg, "charge");
    await dropOn(dlg, ${JSON.stringify(strayRodFx.uuid)});
    out.stray = shown(dlg);
    out.refusedApi = (await research().place(place(), ${JSON.stringify(playerProj.id)}, { mode: "charge", itemUuid: ${JSON.stringify(strayRodFx.uuid)} })).reason;
    await pick(dlg, "scroll");
    dlg.querySelector('button[data-action="ok"]').click();
    await until(() => proj(${JSON.stringify(playerProj.id)})?.outcome?.placed === "scroll", 120);
    await sleep(1200);
    out.outcome = proj(${JSON.stringify(playerProj.id)}).outcome;
    out.scrolls = [...hero.items].filter((i) => /^Scroll of QA Research Ritual Spell/.test(i.name)).map((i) => i.uuid);
    out.cards = newCards().map((m) => m.uuid);
    return out;`, ids13);
  for (const u of playerRun.scrolls ?? []) { tracked.push(u); gm.track(u, "Item"); }
  for (const u of playerRun.cards ?? []) { tracked.push(u); gm.track(u, "ChatMessage"); }
  check("on the Player seat, an item another character holds leaves Confirm held with the owner reason and the API refuses it as itemOwner; the Player's own scroll is written through the relay and the project is answered", playerRun.prompt && playerRun.stray.okDisabled && playerRun.stray.why.length > 0 && playerRun.refusedApi === "itemOwner" && playerRun.outcome?.placed === "scroll" && playerRun.scrolls.length === 1, playerRun);

  // The Player's charge goes in an item a second character they own holds, where the researcher holds no such item: ownership of the item is the gate.
  const ownChargeProj = await finishRitual(ritualSpec);
  // The finish's own card reaches the Player seat by broadcast; the run counts the cards that come after its snapshot, so the snapshot is taken once that card is there.
  await new Promise((r) => setTimeout(r, 2000));
  const ownChargeRun = await run(player, U, `
    ${snap}
    ${chooser(ownChargeProj.id)}
    const dlg = await choose();
    if (!dlg) return { prompt: false };
    const out = { prompt: true };
    await pick(dlg, "charge");
    await dropOn(dlg, ${JSON.stringify(strayRodFx.uuid)});
    out.stray = shown(dlg);
    await dropOn(dlg, ${JSON.stringify(lenaRodFx.uuid)});
    out.own = shown(dlg);
    dlg.querySelector('button[data-action="ok"]').click();
    await until(() => proj(${JSON.stringify(ownChargeProj.id)})?.outcome?.placed === "charge", 120);
    await until(() => newCards().length > 0, 80);
    await sleep(1200);
    const rod = await fromUuid(${JSON.stringify(lenaRodFx.uuid)});
    out.outcome = proj(${JSON.stringify(ownChargeProj.id)})?.outcome;
    out.charges = rod.system.charges;
    out.stored = rod.flags?.["acks-extras"]?.magic?.stored ?? null;
    out.heroRod = (await fromUuid(${JSON.stringify(rodFx.uuid)})).system.charges.value;
    out.cards = newCards().map((m) => m.uuid);
    return out;`, ids13);
  for (const u of ownChargeRun.cards ?? []) { tracked.push(u); gm.track(u, "ChatMessage"); }
  check("on the Player seat, a rod held by the Player's second character (not the researcher) leaves Confirm enabled where the stray rod of a character they do not own had it held with a reason", ownChargeRun.prompt && ownChargeRun.stray.okDisabled === true && ownChargeRun.stray.why.length > 0 && ownChargeRun.own.okDisabled === false && ownChargeRun.own.dropActive === true, { stray: ownChargeRun.stray, own: ownChargeRun.own });
  check("Confirm stores the charge in that rod: `system.charges.value` is 1 with the maximum, the effect is recorded under the module's magic flag naming the project, the project is answered `placed: charge`, and the researcher's own rod keeps the one charge the Judge's run stored, with no second",ownChargeRun.outcome?.placed === "charge" && ownChargeRun.charges?.value === 1 && ownChargeRun.charges.max === 1 && ownChargeRun.stored?.length === 1 && ownChargeRun.stored[0].project === ownChargeProj.id && ownChargeRun.heroRod === chargeRun.charges?.value &&ownChargeRun.cards.length === 1, ownChargeRun);

  // A third ritual: Take effect now casts first. A cancelled cast leaves the ritual waiting; a cast that goes through answers it.
  const nowProj = await finishRitual(ritualSpec);
  const nowRun = await run(gm, U, `
    ${snap}
    ${chooser(nowProj.id)}
    const castDialog = () => document.querySelector(".application.acks-extras-cast");
    const castCards = () => [...game.messages].filter((m) => !before.msgs.includes(m.id) && m.flags?.["acks-extras"]?.castCard);
    let dlg = await choose();
    if (!dlg) return { prompt: false };
    dlg.querySelector('button[data-action="ok"]').click();
    const opened = await until(castDialog, 80);
    const out = { prompt: true, castOpened: !!opened, ritualBand: !!opened?.querySelector(".acks-extras-cast-ritual"), button: opened?.querySelector('button[data-action="cast"]')?.textContent.trim() ?? "", disabled: opened?.querySelector('button[data-action="cast"]')?.disabled === true, waitingWhileOpen: proj(${JSON.stringify(nowProj.id)})?.outcome?.pending === "placement" };
    opened?.querySelector('button[data-action="cancel"]')?.click();
    await sleep(900);
    out.afterCancel = { pending: proj(${JSON.stringify(nowProj.id)})?.outcome?.pending, placed: proj(${JSON.stringify(nowProj.id)})?.outcome?.placed ?? null, casts: castCards().length };
    dlg = await choose();
    dlg.querySelector('button[data-action="ok"]').click();
    const again = await until(castDialog, 80);
    again?.querySelector('button[data-action="cast"]')?.click();
    await until(() => proj(${JSON.stringify(nowProj.id)})?.outcome?.placed === "now", 120);
    await sleep(1200);
    out.outcome = proj(${JSON.stringify(nowProj.id)}).outcome;
    out.casts = castCards().map((m) => m.uuid);
    out.cards = newCards().map((m) => m.uuid);
    return out;`, ids13);
  for (const u of [...(nowRun.casts ?? []), ...(nowRun.cards ?? [])]) { tracked.push(u); gm.track(u, "ChatMessage"); }
  check("Take effect now with Confirm opens the ordinary cast dialog on the researcher's own spell (no Ritual band, an enabled cast button), and the project still waits while it is open", nowRun.prompt && nowRun.castOpened && !nowRun.ritualBand && nowRun.button.length > 0 && !nowRun.disabled && nowRun.waitingWhileOpen, nowRun);
  check("cancelling the cast leaves the ritual waiting with nothing cast; casting it answers the project `placed: now`, posts the spell's cast card and one placement card", nowRun.afterCancel?.pending === "placement" && nowRun.afterCancel.placed === null && nowRun.afterCancel.casts === 0 && nowRun.outcome?.placed === "now" && nowRun.casts.length >= 1 && nowRun.cards.length >= 1, { afterCancel: nowRun.afterCancel, outcome: nowRun.outcome, casts: nowRun.casts?.length, cards: nowRun.cards?.length });

  // A project that is not a cast ritual never offers Choose…, and the API refuses to place it.
  const notRitual = await run(gm, U, `
    const spellProj = projects().find((p) => p.kind !== "ritual" && p.status === "closed");
    await open();
    const refused = spellProj ? (await research().place(place(), spellProj.id, { mode: "scroll" })).reason : "none";
    return { found: !!spellProj, refused, controls: tab().querySelectorAll('.acks-extras-research__awaiting-row [data-action="chooseResearchPlacement"]').length };`, ids13);
  check("a closed project that is no cast ritual is refused by the API as notAwaiting, and no Choose… control is drawn for it", notRitual.refused === "notAwaiting" && notRitual.controls === 0, notRitual);

  // B. Add power: the control opens a row, Add writes a power row worth its amount, and with none held it says so.
  const spellProj = await makeReady({ kind: "spell", subject: { uuid: ids13.spell, name: "QA Research Spell" } }, [], 4);
  const pw = await run(gm, U, `
    const hero = fromUuidSync(ID.hero);
    await acksExtras.magic.power.gain(hero, "arcane", { amount: 5, name: "QA walk" });
    await sleep(700);
    await open();
    const c = () => card(${JSON.stringify(spellProj.id)});
    c().querySelector('[data-action="toggleResearchPower"]').click();
    await until(() => c().querySelector("[data-research-power-amount]"), 60);
    const open1 = !!c().querySelector("[data-research-power-amount]");
    const heldText = c().querySelector(".acks-extras-research__power-row .acks-extras-research__cap")?.textContent.trim() ?? "";
    const box = c().querySelector("[data-research-power-amount]");
    box.value = "3";
    c().querySelector('[data-action="addResearchPower"]').click();
    await until(() => projects().find((p) => p.id === ${JSON.stringify(spellProj.id)})?.bucket?.some((r) => r.uuid === "power:arcane"), 60);
    await sleep(900);
    await open();
    const row = c().querySelector('.acks-extras-bucket__row[data-kind="power"]');
    const out = { open1, heldText, bucket: projects().find((p) => p.id === ${JSON.stringify(spellProj.id)}).bucket, bolt: !!row?.querySelector(".fa-bolt"), chip: row?.querySelector("[data-fit]")?.textContent.trim() ?? "", total: c().querySelector(".acks-extras-bucket__total")?.textContent.trim() ?? "" };
    c().querySelector('[data-action="toggleResearchPower"]')?.click();
    await sleep(300);
    await open();
    c().querySelector('[data-action="toggleResearchPower"]').click();
    await until(() => c().querySelector('[data-action="pickResearchPower"][data-kind="divine"]'), 60);
    c().querySelector('[data-action="pickResearchPower"][data-kind="divine"]').click();
    await until(() => c().querySelector('[data-action="addResearchPower"]')?.disabled === true, 60);
    out.none = { disabled: c().querySelector('[data-action="addResearchPower"]')?.disabled === true, note: c().querySelector(".acks-extras-research__power-row")?.textContent.replace(/\\s+/g, " ").trim() ?? "" };
    return out;`, ids13);
  check("Add power opens the row on the first power, shows 'of N held' from the ledger, and Add writes `power:arcane` at the amount typed into the project's bucket; the row draws the bolt, the matched chip and the amount as the figure toward the cost", pw.open1 && /5/.test(pw.heldText) && pw.bucket.some((r) => r.uuid === "power:arcane" && r.qty === 3) && pw.bolt && pw.chip.toLowerCase() === "matched" && /^3/.test(pw.total), pw);
  check("with none of a power held the row says so and Add is disabled", pw.none.disabled && /no divine power held/i.test(pw.none.note), pw.none);
  await run(gm, U, `
    await research().close(place(), ${JSON.stringify(spellProj.id)});
    await fromUuidSync(ID.hero).update({ "flags.acks-extras.-=power": null });
    return true;`, ids13);

  // C. a known formula: the button, its tag, its tooltip and the card.
  const partF = await mkPart("QA Research Component F");
  const first = await makeReady({ kind: "item", subject: { uuid: ids13.gear, name: "QA Research Gear" } }, [{ uuid: partF, qty: 1, fit: "matched" }]);
  await rig13(20);
  const firstCards = await run(gm, U, `${snap} await research().finish(place(), ${JSON.stringify(first.id)}); await until(() => newCards().length > 0, 80); await sleep(500); return newCards().map((m) => m.uuid);`, ids13);
  for (const u of firstCards ?? []) { tracked.push(u); gm.track(u, "ChatMessage"); }
  const partG2 = await mkPart("QA Research Component F2");
  const again = await makeReady({ kind: "item", subject: { uuid: ids13.gear, name: "QA Research Gear" } }, [{ uuid: partG2, qty: 1, fit: "matched" }]);
  const fo = await run(gm, U, `
    ${snap}
    await open();
    const c = card(${JSON.stringify(again.id)});
    const btn = c.querySelector('[data-action="finishResearchProject"]');
    const tag = btn?.previousElementSibling;
    const out = { label: btn?.textContent.trim(), tag: tag?.textContent.trim() ?? "", tagTip: tag?.dataset.tooltipText ?? "" };
    out.throwChip = [...c.querySelectorAll(".acks-extras-research__parts .acks-tag")].map((e) => e.textContent.trim()).join("|");
    btn.click();
    await until(() => proj(${JSON.stringify(again.id)})?.status === "closed", 80);
    await until(() => newCards().length > 0, 80);
    await sleep(500);
    const msg = newCards().at(-1);
    out.card = { text: msg ? String(msg.content).replace(/<[^>]+>/g, " ").replace(/\\s+/g, " ").trim() : "", rolls: msg?.rolls?.length ?? -1, targetColumn: msg ? /Target/i.test(String(msg.content)) : null };
    out.cards = newCards().map((m) => m.uuid);
    return out;`, ids13);
  for (const u of fo.cards ?? []) { tracked.push(u); gm.track(u, "ChatMessage"); }
  check("with the formula known and no substitute held the button reads Finish (formula) beside a `formula` tag whose tooltip names the formula and the page, the throw chip shows no target, and the card says Made from the formula with no die and no target column", /finish \(formula\)/i.test(fo.label) && fo.tag.toLowerCase() === "formula" && fo.tagTip.length > 0 && !/\d\+/.test(fo.throwChip) && /made from the formula/i.test(fo.card.text) && fo.card.rolls === 0 && fo.card.targetColumn === false, fo);
  await run(gm, U, `
    ${tablesKit}
    await STORE.clearOverride(D, "ritualWorkshopProse");
    await fromUuidSync(ID.hero).update({ "flags.acks-extras.magic.-=formulas": null });
    return true;`, ids13);

  section("15. ownership is the gate: a Player who owns the place and the researcher");
  // The place is the Player's outright (default Owner), so every write of theirs runs on their own client and the GM seat proves nothing
  // about it. The hero is on its roster. The ladder is unread, so the days-due box is drawn. Its own record keeps the other places' counts.
  const ownedFx = await gm.fixture("magic/research-place-owned", "Actor", { name: "QA Research Place Owned", type: "acks-extras.location", ownership: { default: 3 } });
  const U2 = ownedFx.uuid;
  const o0 = await run(gm, U2, `
    ${tablesKit}
    await place().update({ ownership: { default: 3 }, "flags.acks-extras.-=magic": null, "system.roster": [] });
    await sleep(300);
    const P = await import("/modules/acks-extras/scripts/lib/place.mjs");
    await P.addOccupant(place(), fromUuidSync(ID.hero));
    await STORE.setOverride(D, "researchLadder", ${LADDER_UNREAD}, { sourceName: "qa-research-project" });
    await sleep(600);
    return { owner: place().ownership.default, magic: !!place().flags?.["acks-extras"]?.magic, roster: place().system.roster.map((r) => r.uuid), market: place().system.hasMarket };`, ids);
  check("the owned place starts at ownership Owner for every player with no record, the hero on its roster and no market", o0.owner === 3 && !o0.magic && o0.roster.join() === ids.hero && o0.market === false, o0);
  const ow1 = await run(player, U2, `
    await open();
    const input = (key) => tab().querySelector('[data-research-facility="' + key + '"]');
    const out = { isGM: game.user.isGM, owner: place().isOwner, writable: place().canUserModify(game.user, "update"), inputs: tab().querySelectorAll("[data-research-facility]").length };
    await change(input("library"), "8000");
    out.typed = flag().facilities?.library;
    out.api = (await research().setFacility(place(), "workshop", 1234)).ok;
    await sleep(900);
    out.workshop = flag().facilities?.workshop;
    await close();
    await open();
    out.reopened = { library: input("library")?.value, workshop: input("workshop")?.value };
    return out;`, ids);
  // The Player's two writes reach the GM seat by the server's broadcast, so the GM's copy is read once it holds the second.
  const o1gm = await run(gm, U2, `await until(() => flag().facilities?.workshop === 1234, 80); return flag().facilities ?? null;`, ids);
  check("a Player who owns the place draws both facility inputs, types 8000 in the library box and sets the workshop to 1234 by the API, writing directly (the Player may update the place), each stored on the place as the GM seat reads it and shown in the inputs after a reopen", ow1.isGM === false && ow1.owner === true && ow1.writable === true && ow1.inputs === 2 && ow1.typed === 8000 && ow1.api === true && ow1.workshop === 1234 && ow1.reopened.library === "8000" && ow1.reopened.workshop === "1234" && o1gm?.library === 8000 && o1gm?.workshop === 1234, { ow1, o1gm });
  const o2 = await run(player, U2, `
    const made = await research().create(place(), { kind: "spell", subject: { name: "QA Owned Lantern" }, researcher: ID.hero, costs: { research: 1000 }, throw: { target: 14 } });
    await sleep(900);
    const id = made.id;
    const common = await research().create(place(), { kind: "spell", researcher: ID.hero, common: true });
    const p = () => projects().find((x) => x.id === id);
    const out = { made: { ok: made.ok, warn: made.warn, id }, commonRefused: common.reason, held: projects().length, created: { research: p()?.costs?.research, target: p()?.throw?.target } };
    await until(() => research().progress(place(), id)?.dueBy !== "ladder", 80);
    await open();
    await change(card(id).querySelector('[data-research-field="level"]'), "3");
    await change(card(id).querySelector('[data-research-field="costs.material"]'), "15");
    await change(card(id).querySelector('[data-research-field="paid.material"]'), "15");
    out.boxDrawn = !!card(id).querySelector('[data-research-field="dueDays"]');
    await change(card(id).querySelector('[data-research-field="dueDays"]'), "7");
    const api = await research().update(place(), id, { throw: { target: 16 } });
    await sleep(700);
    const read = () => ({ level: p().level, material: p().costs.material, paid: p().paid.material, paidDay: p().paid.day, due: p().dueDays, research: p().costs.research, target: p().throw?.target });
    out.written = read();
    out.api = api.ok;
    await close();
    await open();
    const c = card(id);
    const val = (field) => c.querySelector('[data-research-field="' + field + '"]')?.value;
    out.reopened = { level: val("level"), material: val("costs.material"), paid: val("paid.material"), due: val("dueDays"), research: val("costs.research") };
    out.afterReopen = read();
    return out;`, ids);
  const o2gm = await run(gm, U2, `
    const p = projects().find((x) => x.id === ${JSON.stringify(o2.made.id)});
    return p ? { level: p.level, material: p.costs.material, paid: p.paid.material, due: p.dueDays, research: p.costs.research, target: p.throw?.target, open: projects().length } : null;`, ids);
  check("a Player who owns the place and the researcher creates a project with a research cost of 1000 and a throw target of 14 (written, no refusal), while the common mark in a create is refused as the Judge's and writes nothing", o2.made.ok === true && !o2.made.warn && o2.commonRefused === "judge" && o2.held === 1 && o2.created.research === 1000 && o2.created.target === 14, o2);
  check("the same Player edits the project's level (3), material cost (15), material paid (15, stamped with the day), days due (7, a box drawn while the due cannot be computed) and throw target (16, by the API); each reads back from the flag", o2.boxDrawn === true && o2.api === true && o2.written.level === 3 && o2.written.material === 15 && o2.written.paid === 15 && Number.isInteger(o2.written.paidDay) && o2.written.due === 7 && o2.written.target === 16 && o2.written.research === 1000, o2.written);
  check("each of those values persists on a reopen of the sheet: the inputs show 3, 15, 15, 7 and the untouched research cost 1000, the flag still holds them, and the GM seat reads the same from the place", o2.reopened.level === "3" && o2.reopened.material === "15" && o2.reopened.paid === "15" && o2.reopened.due === "7" && o2.reopened.research === "1000" && o2.afterReopen.level === 3 && o2.afterReopen.due === 7 && o2gm?.level === 3 && o2gm.material === 15 && o2gm.paid === 15 && o2gm.due === 7 && o2gm.target === 16 && o2gm.open === 1, { reopened: o2.reopened, gm: o2gm });
  const o3 = await run(player, U2, `
    const id = ${JSON.stringify(o2.made.id)};
    const common = await research().update(place(), id, { common: true });
    const range = await research().postRange(place(), id, { pace: "both", from: ${today + 10}, days: 2 });
    const later = await research().post(place(), id, { pace: "dedicated", day: ${today + 1} });
    await sleep(600);
    const p = projects().find((x) => x.id === id);
    await open();
    const c = card(id);
    return { common: common.reason, range: range.reason, later: later.reason, kept: { common: p.common === true, posted: p.posted.length }, postDay: !!c.querySelector('[data-action="postResearchDay"]'), postRange: !!c.querySelector('[data-action="postResearchDays"]'), commonBox: !!c.querySelector('[data-research-field="common"]') };`, ids);
  check("an owner of the place and the researcher is still refused what is the Judge's: the common mark and Post days… as the Judge's and a post of another day than today as the day's, nothing is stored, and the card draws Post day with no range control and no common box", o3.common === "judge" && o3.range === "judge" && o3.later === "day" && o3.kept.common === false && o3.kept.posted === 0 && o3.postDay === true && o3.postRange === false && o3.commonBox === false, o3);
  await run(gm, U2, `await close();`, ids);
  await run(player, U2, `await close();`, ids);
  await run(gm, U2, `
    ${tablesKit}
    await STORE.setOverride(D, "researchLadder", ${LADDER_OK}, { sourceName: "qa-research-project" });
    await place().update({ "flags.acks-extras.-=magic": null, "system.roster": [] });
    await sleep(400);
    return true;`, ids);

  section("Days teardown");
  await run(gm, U, `
    await research().close(place(), ${JSON.stringify(IDD)});
    await fromUuidSync(ID.hero).update({ "system.details.level": ${lv0.hero} });
    await fromUuidSync(ID.pell).update({ "system.details.level": ${lv0.pell} });
    await sleep(600);
    return true;`, ids);

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
  console.log("fixtures kept: magic/research-place, magic/research-hero, magic/research-pell, magic/research-lena, magic/research-part, magic/research-spell, magic/research-gear, magic/research-gear2, magic/research-relic, magic/research-ritual-spell, magic/research-wand, magic/research-stray-rod, magic/research-lena-rod, magic/research-place-owned");
  walkDone();
} catch (e) {
  if (!(e instanceof WalkBlocked)) console.log("WALK ERROR:", e?.stack ?? e);
} finally {
  try {
    if (gm && overrode) console.log(`overrides cleared: ${await gm.eval(`(async () => { const S = await import("/modules/acks-extras/scripts/location/table-store.mjs"); for (const id of ${JSON.stringify(TABLE_IDS)}) await S.clearOverride("magicResearch", id); return ${JSON.stringify(TABLE_IDS)}.every((id) => !S.hasOverride("magicResearch", id)); })()`)}`);
  } catch {}
  try {
    if (gm && rigged) await gm.eval(`(() => { if (globalThis.__rpDice) { CONFIG.Dice.randomUniform = globalThis.__rpDice; delete globalThis.__rpDice; } return true; })()`);
  } catch {}
  try {
    if (gm && tracked.length) console.log("swept:", JSON.stringify(await gm.sweepTracked({ only: tracked })));
  } catch (e) { console.log("sweep:", e?.message ?? e); }
  const failed = checks.filter(([, ok]) => !ok).length;
  console.log(`${checks.length - failed} passed, ${failed} failed`);
  try { player?.close?.(); } catch {}
  try { gm?.close?.(); } catch {}
  process.exitCode = failed ? 1 : 0;
}
