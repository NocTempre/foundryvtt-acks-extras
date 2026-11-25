/**
 * Live walk, "+ Officer" and an actor dropped on a chart row's officer line: docs/lib/TESTING.md "The
 * officer line", step 9, marker `lib/officer-assign`. The press is made as a seat presses it on the faction
 * sheet's Org chart tab (a part row with no officer: a copy of its source creature, then a blank), and the
 * drop is a real DragEvent sequence on the rendered line, a `dragstart`, a `dragover` whose DataTransfer is
 * EMPTY (a browser hides the payload until the drop, so the line's name comes from the page's own watch of
 * `dragstart`), a `dragleave`, and a `drop` carrying Foundry's `{type, uuid}` payload. It reads back that the
 * officer was replaced and the replaced actor still exists, that a group or a faction dropped on a line writes
 * nothing, that the same drop works on a group host's chart, and that a Player seat without ownership of the
 * row's group has no button, no target and a drop that writes nothing. Machine values arrive through
 * ./_env.mjs. Every name and figure here is invented.
 *
 * Fixture, kept and found again by marker (`api.fixture`): `lib/officer-assign`, a faction host whose rows the
 * walk rewrites at its start and again in its teardown. The groups and actors are the run's own: made with
 * `api.create`, tracked, and swept with `sweepTracked`; each actor a press makes is tracked from its group the
 * moment the press resolves. The Player seat's ownership is set by API and put back at the end; the world's
 * actor-create permission is read, never changed.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";
import { walkDone, blocked } from "./_walk.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const TAG = MACHINE.own ? ` ${MACHINE.own}` : "";
const OBSERVER = 2;
const OWNER = 3;
const tally = { pass: 0, fail: 0 };
const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const check = (label, ok, detail) => {
  tally[ok ? "pass" : "fail"] += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/* Page side: each function is stringified and run in a seat's page, so none names a node-side value. */
const P = {
  census: async () => ({
    role: game.user.role,
    chartApi: !!globalThis.acksExtras?.lib?.org?.editRow,
    canCreate: game.user.can("ACTOR_CREATE"),
    monsterType: game.documentTypes.Actor.includes("monster"),
  }),

  /** A lang string, formatted in the page. */
  say: async ({ key, data }) => game.i18n.format(key, data ?? {}),

  /** Write the fixture's chart: a warband row (its group names officer A), two part rows (the first's group stacks name the source creature, the second's stack nothing), and the root group host's one row. Rewrites `system.units` of the kept host and the groups' own fields. */
  seed: async ({ id, W, P, Q, GH, W2, src, A, A2 }) => {
    const row = (key, label, holderUuid, gen) => ({ key, parentKey: "", label, holderUuid, kind: "", notes: "", hidden: false, gen });
    const stack = { key: "s1", template: { uuid: src }, gen: {}, size: { initial: 1, current: 1 }, roster: [] };
    await fromUuidSync(W).update({ "system.unit.officerUuid": A, "system.unit.officerMoraleBonus": 2 });
    await fromUuidSync(P).update({ "system.unit.officerUuid": "", "system.stacks": [stack] });
    await fromUuidSync(Q).update({ "system.unit.officerUuid": "", "system.stacks": [] });
    await fromUuidSync(W2).update({ "system.unit.officerUuid": A2 });
    await fromUuidSync(GH).update({ "system.units": [row("g", "QA Host row", W2, {})] });
    await game.actors.get(id).update({
      "system.units": [row("w", "QA Warband", W, {}), row("p", "QA Part young", P, { part: "qa-part-a" }), row("q", "QA Part blank", Q, { part: "qa-part-b" })],
      "system.leaderUuid": "", "system.parentUuid": "",
    });
    return game.actors.get(id).system.units.length;
  },

  /** The rows of a host (a faction or a group) with what each row's group names as officer and the morale figure beside it. */
  rows: async ({ uuid }) => fromUuidSync(uuid).system.units.map((r) => {
    const h = r.holderUuid ? fromUuidSync(r.holderUuid) : null;
    return { key: r.key, label: r.label, group: r.holderUuid, officer: h?.system?.unit?.officerUuid ?? "", morale: h?.system?.unit?.officerMoraleBonus ?? null };
  }),

  /** What an actor is: whether it is in the world, its name, type, image, item count and its minted-prototype mark. */
  actor: async ({ uuid }) => {
    const a = uuid ? fromUuidSync(uuid) : null;
    return { exists: !!a, name: a?.name ?? "", type: a?.type ?? "", img: a?.img ?? "", items: a?.items?.size ?? 0, mark: a?.flags?.["acks-extras"]?.organisationPrototype ?? null };
  },

  /** What a drop on a line must leave alone: the faction's own members and parent and a group's stack count. */
  guard: async ({ id, group }) => ({ members: JSON.stringify(game.actors.get(id).system.members ?? []), parent: game.actors.get(id).system.parentUuid ?? "", stacks: fromUuidSync(group)?.system?.stacks?.length ?? 0 }),

  /** Reopen a host's sheet, on the Org chart tab where it has one. */
  reopen: async ({ uuid }) => {
    const sheet = fromUuidSync(uuid).sheet;
    if (sheet.rendered) await sheet.close({ animate: false });
    if (sheet.actor?.type === "acks-extras.faction") sheet.tabGroups.primary = "orgChart";
    await sheet.render({ force: true });
    await new Promise((r) => setTimeout(r, 900));
    return { rendered: sheet.rendered };
  },

  /** Press a control of a card by its action, on the sheet of a host. */
  pressCard: async ({ uuid, key, action, wait }) => {
    const btn = fromUuidSync(uuid).sheet.element?.querySelector(`li[data-key="${key}"] > div [data-action="${action}"]`);
    if (!btn) return { pressed: false };
    btn.click();
    await new Promise((r) => setTimeout(r, wait ?? 900));
    return { pressed: true };
  },

  /** Press a control of a card's officer line by action. */
  pressLine: async ({ uuid, key, action, wait }) => {
    const btn = fromUuidSync(uuid).sheet.element?.querySelector(`li[data-key="${key}"] > div .acks-extras-org-officer [data-action="${action}"]`);
    if (!btn) return { pressed: false };
    btn.click();
    await new Promise((r) => setTimeout(r, wait ?? 1500));
    return { pressed: true };
  },

  /** A card's officer line as drawn now: its words, controls, tooltips, whether it is a drop target and what it shows while one. */
  line: async ({ uuid, key }) => {
    const card = fromUuidSync(uuid).sheet.element?.querySelector(`li[data-key="${key}"] > div`);
    const line = card?.querySelector(".acks-extras-org-officer");
    const add = line?.querySelector('[data-action="orgAddOfficer"]');
    const name = line?.querySelector(".acks-extras-org-officer__name");
    const hint = line?.querySelector(".acks-extras-org-officer__drop");
    const controls = line?.querySelector(".acks-extras-org-officer__controls");
    const make = line?.querySelector('[data-action="orgMakeLeader"]');
    return {
      drawn: !!line,
      inEdit: !!card?.querySelector(".acks-extras-org-card__form"),
      text: name?.textContent?.trim() ?? "",
      nameTip: name?.dataset.tooltipText ?? "",
      actions: [...(line?.querySelectorAll("[data-action]") ?? [])].map((b) => b.dataset.action),
      addText: add?.textContent?.trim() ?? "",
      addLabel: add?.getAttribute("aria-label") ?? "",
      addTip: add?.dataset.tooltipText ?? "",
      makeTip: make?.dataset.tooltipText ?? "",
      dropAttr: !!line?.hasAttribute("data-org-drop"),
      target: !!line?.classList.contains("is-drop-target"),
      hint: hint && !hint.hidden ? hint.textContent.trim() : "",
      controlsShown: controls ? getComputedStyle(controls).display !== "none" : null,
      hintOutline: line ? getComputedStyle(line).outlineStyle : "",
      frame: [...(line?.querySelector(".acks-extras-pf")?.classList ?? [])].find((c) => c.startsWith("acks-extras-pf--")) ?? "",
      // The role words the card draws outside its officer line: the head's word, and the leader frame's word and accessible name.
      headWords: [...(card?.querySelectorAll(".acks-extras-pf__word, [role='group'][aria-label]") ?? [])].filter((n) => !line?.contains(n)).map((n) => (n.getAttribute("aria-label") ?? n.textContent ?? "").trim()),
    };
  },

  /** One event of a real drag on a card's officer line. A `dragover` carries an EMPTY DataTransfer, as a browser's does; `start` and `drop` carry Foundry's `{type, uuid}` payload. */
  drag: async ({ uuid, key, phase, payload }) => {
    const root = fromUuidSync(uuid).sheet.element;
    const line = root?.querySelector(`li[data-key="${key}"] > div .acks-extras-org-officer`);
    if (!line) return { found: false };
    const carrying = () => {
      const dt = new DataTransfer();
      dt.setData("text/plain", JSON.stringify(payload));
      return dt;
    };
    const fire = (el, type, init) => {
      const ev = new DragEvent(type, { bubbles: true, cancelable: true, ...init });
      el.dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    let prevented = null;
    if (phase === "start") prevented = fire(root, "dragstart", { dataTransfer: carrying() });
    if (phase === "over") prevented = fire(line, "dragover", { dataTransfer: new DataTransfer() });
    if (phase === "leave") prevented = fire(line, "dragleave", { relatedTarget: root });
    if (phase === "drop") prevented = fire(line, "drop", { dataTransfer: carrying() });
    if (phase === "end") prevented = fire(root, "dragend", {});
    await new Promise((r) => setTimeout(r, phase === "drop" ? 1800 : 200));
    return { found: true, prevented };
  },

  /** Write a card's officer through lib's writer, as a seat would; used to put a known shape under a step. */
  setOfficer: async ({ uuid, key, officer }) => {
    const out = await acksExtras.lib.org.editRow(fromUuidSync(uuid), key, { officer: { officer, moraleBonus: null } });
    return { ok: out.ok, reason: out.reason ?? "" };
  },

  /** Set a user's ownership of a document, as a Judge does in its sheet. */
  setOwnership: async ({ uuid, player, level, defaultLevel }) => {
    const doc = fromUuidSync(uuid);
    const user = game.users.find((u) => u.name === player);
    await doc.update({ ownership: { ...(defaultLevel !== undefined ? { default: defaultLevel } : {}), [user.id]: level } });
    return true;
  },

  /** What this seat reads of its own permissions on the host and two groups, and the world's actor-create permission. */
  perm: async ({ uuid, groups }) => ({
    isGM: game.user.isGM,
    hostOwner: fromUuidSync(uuid).isOwner,
    groups: groups.map((g) => !!fromUuidSync(g)?.isOwner),
    canCreate: game.user.can("ACTOR_CREATE"),
  }),

  /** Close the sheets of the walk's documents so nothing stays open. */
  closeSheets: async ({ uuids }) => {
    for (const u of uuids ?? []) { try { await fromUuidSync(u)?.sheet?.close({ animate: false }); } catch (_e) { /* closed */ } }
    return true;
  },
};

const run = (api, fn, arg) => api.eval(`(${fn.toString()})(${JSON.stringify(arg ?? null)})`);
const open = {};
/** Reads until `pred` holds and returns the last read, which is the failing one on a timeout. */
const until = async (api, fn, arg, pred, { tries = 40, every = 250 } = {}) => {
  let v = null;
  for (let n = 0; n < tries; n++) {
    v = await run(api, fn, arg);
    if (pred(v)) return v;
    await sleep(every);
  }
  return v;
};
const hasAll = (have, want) => want.every((a) => have.includes(a));
const keyRow = (rows, key) => rows.find((r) => r.key === key);

let fid = null;
let hostUuid = "";
let ghUuid = "";
const owned = [];
try {
  section("seat");
  open.gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  const gm = open.gm;
  for (let n = 0; n < 60 && !(await gm.eval("!!globalThis.acksExtras?.importer?.connectBookUrl")); n++) await sleep(1000);
  const census = await run(gm, P.census);
  if (!census.chartApi) blocked("the org chart writers are not on the page: the module did not load");
  check("the seat is a GM, and may create actors", census.role >= 3 && census.canCreate === true, census);
  const say = (key, data) => run(gm, P.say, { key, data });

  section("fixture: a faction host with a warband row and two part rows, a root group host, and the actors they name");
  const host = await gm.fixture("lib/officer-assign", "Actor", { name: `QA Officer assign${TAG}`, type: "acks-extras.faction", items: [] });
  fid = host.id;
  hostUuid = host.uuid;
  const make = async (name, type, extra = {}) => (await gm.create("Actor", { name: `${name}${TAG}`, type, items: [], ...extra }));
  const W = await make("QA Assign warband", "acks-extras.group");
  const Pp = await make("QA Assign part young", "acks-extras.group");
  const Q = await make("QA Assign part blank", "acks-extras.group");
  const GH = await make("QA Assign group host", "acks-extras.group");
  ghUuid = GH.uuid;
  const W2 = await make("QA Assign host row", "acks-extras.group");
  const X = await make("QA Assign stray group", "acks-extras.group");
  const A = await make("QA Officer A", "character");
  const A2 = await make("QA Officer B", "character");
  const D = await make("QA Dropped E", "character");
  const src = await make("QA Source creature", "monster", { flags: { "acks-extras": { organisationPrototype: `officer-assign${TAG}` } } });
  note("fixture", { host: host.uuid, groups: [W.uuid, Pp.uuid, Q.uuid, GH.uuid, W2.uuid, X.uuid], actors: [A.uuid, A2.uuid, D.uuid, src.uuid] });
  await run(gm, P.seed, { id: fid, W: W.uuid, P: Pp.uuid, Q: Q.uuid, GH: GH.uuid, W2: W2.uuid, src: src.uuid, A: A.uuid, A2: A2.uuid });
  await run(gm, P.reopen, { uuid: host.uuid });
  const tipEnd = await say("ACKS-LIB.org.officer.nameTip");
  const dropSentence = tipEnd.slice(tipEnd.indexOf("Or drop"));

  section("1. + Officer on a part row whose group stacks name a creature: a copy of it, named by the row");
  check("the pen opens the part row's form", (await run(gm, P.pressCard, { uuid: host.uuid, key: "p", action: "orgEdit" })).pressed);
  const l0 = await until(gm, P.line, { uuid: host.uuid, key: "p" }, (l) => l.drawn && l.inEdit);
  check("the line reads No officer and offers + Officer alone, with no Make, no Clear and no Open", l0.text === (await say("ACKS-LIB.org.officer.none", { word: "officer" })) && l0.actions.join() === "orgAddOfficer", l0);
  check("the button reads ＋ Officer, is named Add an officer, and its tooltip ends with the drop sentence", l0.addText === (await say("ACKS-LIB.org.officer.add")) && l0.addLabel === "Add an officer" && l0.addTip.endsWith(dropSentence), { text: l0.addText, label: l0.addLabel, tip: l0.addTip });
  check("the line is a drop target and nothing shows at rest", l0.dropAttr && !l0.target && l0.hint === "" && l0.controlsShown === true, l0);
  await run(gm, P.pressLine, { uuid: host.uuid, key: "p", action: "orgAddOfficer" });
  const r1 = await until(gm, P.rows, { uuid: host.uuid }, (rs) => !!keyRow(rs, "p")?.officer);
  const O1 = keyRow(r1, "p").officer;
  if (O1) gm.track(O1);
  note("the actor the press made, tracked", O1);
  const a1 = await run(gm, P.actor, { uuid: O1 });
  const srcRead = await run(gm, P.actor, { uuid: src.uuid });
  check("the group's officer is a new world actor named by the row", !!O1 && a1.exists && a1.name === "QA Part young", a1);
  check("it is a copy of the source: its type and image, and not the source's minted-prototype mark", a1.type === srcRead.type && a1.img === srcRead.img && a1.mark === null && O1 !== src.uuid, { copy: a1, source: srcRead });
  check("no morale figure was written (the source carries none)", keyRow(r1, "p").morale === null, keyRow(r1, "p").morale);
  const l1 = await until(gm, P.line, { uuid: host.uuid, key: "p" }, (l) => l.actions.includes("orgOpen"));
  check("the line is the ordinary one: Open, Clear and Delete actor…, no + Officer", hasAll(l1.actions, ["orgOpen", "orgClearLeader", "orgDeleteLeaderActor"]) && !l1.actions.includes("orgAddOfficer"), l1.actions);
  check("the line names the actor alone, with no role word, in the neutral frame", l1.text === "QA Part young" && l1.frame === "acks-extras-pf--file", { text: l1.text, frame: l1.frame });
  check("the officer's name carries a tooltip ending with the drop sentence", l1.nameTip.endsWith(dropSentence), l1.nameTip);
  const roleWords = [await say("ACKS-LIB.org.role.champion"), await say("ACKS-LIB.org.role.sub"), await say("ACKS-LIB.org.role.chief")];
  check("the card's head and leader frame name no role read from the chart's shape", !l1.headWords.some((w) => roleWords.some((r) => w.startsWith(r))), l1.headWords);

  section("2. + Officer on a part row whose group stacks name none: a blank actor of the type Make creates");
  await run(gm, P.pressCard, { uuid: host.uuid, key: "q", action: "orgEdit" });
  const l2 = await until(gm, P.line, { uuid: host.uuid, key: "q" }, (l) => l.drawn && l.inEdit);
  check("the blank row offers + Officer with the tooltip that names no creature", l2.actions.join() === "orgAddOfficer" && l2.addTip === (await say("ACKS-LIB.org.officer.addBlankTip")) && l2.addTip.endsWith(dropSentence), l2);
  await run(gm, P.pressLine, { uuid: host.uuid, key: "q", action: "orgAddOfficer" });
  const r2 = await until(gm, P.rows, { uuid: host.uuid }, (rs) => !!keyRow(rs, "q")?.officer);
  const O2 = keyRow(r2, "q").officer;
  if (O2) gm.track(O2);
  const a2 = await run(gm, P.actor, { uuid: O2 });
  check("the actor is named by the row, is of the generator's default type, and carries no item", a2.exists && a2.name === "QA Part blank" && a2.items === 0 && (census.monsterType ? a2.type === "monster" : true), a2);

  section("3. a drop on the warband row's line: it replaces the officer, and the old actor stays");
  await run(gm, P.pressCard, { uuid: host.uuid, key: "w", action: "orgEdit" });
  const lw = await until(gm, P.line, { uuid: host.uuid, key: "w" }, (l) => l.drawn && l.inEdit);
  check("a warband row's line keeps its own controls and is a drop target", lw.dropAttr && hasAll(lw.actions, ["orgOpen", "orgClearLeader"]) && lw.text.includes(A.name) && lw.nameTip.endsWith(dropSentence), lw);
  const payload = { type: "Actor", uuid: D.uuid };
  const g0 = await run(gm, P.guard, { id: fid, group: W.uuid });
  await run(gm, P.drag, { uuid: host.uuid, key: "w", phase: "start", payload });
  await run(gm, P.drag, { uuid: host.uuid, key: "w", phase: "over", payload });
  const over = await run(gm, P.line, { uuid: host.uuid, key: "w" });
  check("while the actor is dragged over, the line shows a dashed outline and names it, from a dragover that carried no payload", over.target && over.hintOutline === "dashed" && over.hint === (await say("ACKS-LIB.org.officer.dropHint", { name: D.name })) && over.controlsShown === false, over);
  await run(gm, P.drag, { uuid: host.uuid, key: "w", phase: "leave", payload });
  const left = await run(gm, P.line, { uuid: host.uuid, key: "w" });
  check("a dragleave puts the line back to rest", !left.target && left.hint === "" && left.controlsShown === true, left);
  await run(gm, P.drag, { uuid: host.uuid, key: "w", phase: "over", payload });
  await run(gm, P.drag, { uuid: host.uuid, key: "w", phase: "drop", payload });
  const r3 = await until(gm, P.rows, { uuid: host.uuid }, (rs) => keyRow(rs, "w")?.officer === D.uuid);
  check("the drop made the dropped actor the row's officer", keyRow(r3, "w").officer === D.uuid, keyRow(r3, "w"));
  check("the replaced actor is unlinked and not deleted", (await run(gm, P.actor, { uuid: A.uuid })).exists === true);
  check("no morale figure came with the dropped actor", keyRow(r3, "w").morale === null, keyRow(r3, "w").morale);
  const after = await until(gm, P.line, { uuid: host.uuid, key: "w" }, (l) => l.text.includes(D.name));
  check("the drop cleared the target state, and the line is the ordinary one", !after.target && after.hint === "" && hasAll(after.actions, ["orgOpen", "orgClearLeader", "orgDeleteLeaderActor"]), after);
  const g1 = await run(gm, P.guard, { id: fid, group: W.uuid });
  check("the faction took the actor as no member and no parent, and the sheet's own drop did not fire", JSON.stringify(g0) === JSON.stringify(g1), { before: g0, after: g1 });
  await run(gm, P.drag, { uuid: host.uuid, key: "w", phase: "end", payload });

  section("4. a drop on a part row's line, and a group or a faction dropped on a line is ignored");
  await run(gm, P.drag, { uuid: host.uuid, key: "p", phase: "start", payload: { type: "Actor", uuid: A.uuid } });
  await run(gm, P.drag, { uuid: host.uuid, key: "p", phase: "over", payload: { type: "Actor", uuid: A.uuid } });
  await run(gm, P.drag, { uuid: host.uuid, key: "p", phase: "drop", payload: { type: "Actor", uuid: A.uuid } });
  const r4 = await until(gm, P.rows, { uuid: host.uuid }, (rs) => keyRow(rs, "p")?.officer === A.uuid);
  check("a part row takes a dropped actor too, and the copy the press made stays in the world", keyRow(r4, "p").officer === A.uuid && (await run(gm, P.actor, { uuid: O1 })).exists, keyRow(r4, "p"));
  for (const [what, uuid] of [["a group", X.uuid], ["a faction", host.uuid]]) {
    await run(gm, P.drag, { uuid: host.uuid, key: "w", phase: "start", payload: { type: "Actor", uuid } });
    await run(gm, P.drag, { uuid: host.uuid, key: "w", phase: "over", payload: { type: "Actor", uuid } });
    const ignoredOver = await run(gm, P.line, { uuid: host.uuid, key: "w" });
    await run(gm, P.drag, { uuid: host.uuid, key: "w", phase: "drop", payload: { type: "Actor", uuid } });
    const r5 = await run(gm, P.rows, { uuid: host.uuid });
    const g2 = await run(gm, P.guard, { id: fid, group: W.uuid });
    check(`${what} dragged over the line shows no target, and dropped there changes no officer, member or parent`, !ignoredOver.target && keyRow(r5, "w").officer === D.uuid && JSON.stringify(g2) === JSON.stringify(g1), { over: ignoredOver.target, officer: keyRow(r5, "w").officer, after: g2 });
    await run(gm, P.drag, { uuid: host.uuid, key: "w", phase: "end", payload: { type: "Actor", uuid } });
  }

  section("5. the same drop on a group host's chart");
  await run(gm, P.reopen, { uuid: GH.uuid });
  check("the group host's sheet draws the chart and its pen opens the row", (await run(gm, P.pressCard, { uuid: GH.uuid, key: "g", action: "orgEdit" })).pressed);
  const lg = await until(gm, P.line, { uuid: GH.uuid, key: "g" }, (l) => l.drawn && l.inEdit);
  check("the group host's line is a drop target", lg.dropAttr, lg);
  const gh0 = await run(gm, P.guard, { id: fid, group: GH.uuid });
  const pg = { type: "Actor", uuid: D.uuid };
  await run(gm, P.drag, { uuid: GH.uuid, key: "g", phase: "start", payload: pg });
  await run(gm, P.drag, { uuid: GH.uuid, key: "g", phase: "over", payload: pg });
  const overG = await run(gm, P.line, { uuid: GH.uuid, key: "g" });
  check("it shows the outline and the dragged actor's name", overG.target && overG.hint === (await say("ACKS-LIB.org.officer.dropHint", { name: D.name })), overG);
  await run(gm, P.drag, { uuid: GH.uuid, key: "g", phase: "drop", payload: pg });
  const rg = await until(gm, P.rows, { uuid: GH.uuid }, (rs) => keyRow(rs, "g")?.officer === D.uuid);
  const gh1 = await run(gm, P.guard, { id: fid, group: GH.uuid });
  check("the row's officer is replaced, the old one stays, and the sheet's own drop did not add a stack to the host", keyRow(rg, "g").officer === D.uuid && (await run(gm, P.actor, { uuid: A2.uuid })).exists && gh0.stacks === gh1.stacks, { officer: keyRow(rg, "g").officer, stacks: [gh0.stacks, gh1.stacks] });
  await run(gm, P.drag, { uuid: GH.uuid, key: "g", phase: "end", payload: pg });

  section("6. the Player seat: no button and no target without ownership of the row's group, and a drop that writes nothing");
  await run(gm, P.setOfficer, { uuid: host.uuid, key: "q", officer: "" });
  await run(gm, P.setOwnership, { uuid: host.uuid, player: MACHINE.player, level: OWNER });
  owned.push(host.uuid);
  for (const g of [W.uuid, Pp.uuid, A.uuid, D.uuid]) await run(gm, P.setOwnership, { uuid: g, player: MACHINE.player, level: OBSERVER, defaultLevel: OBSERVER });
  await run(gm, P.setOwnership, { uuid: Q.uuid, player: MACHINE.player, level: OWNER });
  open.player = await connect({ browser, origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  const player = open.player;
  const perm = await until(player, P.perm, { uuid: host.uuid, groups: [W.uuid, Pp.uuid, Q.uuid] }, (p) => p.hostOwner && p.groups[2] && !p.isGM);
  check("on the Player's own page the seat owns the host and the third group and not the first two", perm.hostOwner && perm.groups.join() === "false,false,true" && !perm.isGM, perm);
  note("the world's actor-create permission, read on the Player seat", { canCreate: perm.canCreate });
  await run(player, P.reopen, { uuid: host.uuid });
  for (const key of ["w", "p", "q"]) await run(player, P.pressCard, { uuid: host.uuid, key, action: "orgEdit", wait: 700 });
  const pw = await until(player, P.line, { uuid: host.uuid, key: "w" }, (l) => l.drawn && l.inEdit);
  check("a warband row whose group the Player does not own shows no button and no drop target", !pw.dropAttr && !pw.actions.includes("orgAddOfficer") && !pw.actions.includes("orgClearLeader"), pw);
  const gp0 = await run(player, P.guard, { id: fid, group: W.uuid });
  const pr0 = await run(player, P.rows, { uuid: host.uuid });
  await run(player, P.drag, { uuid: host.uuid, key: "w", phase: "start", payload: { type: "Actor", uuid: A.uuid } });
  await run(player, P.drag, { uuid: host.uuid, key: "w", phase: "over", payload: { type: "Actor", uuid: A.uuid } });
  const pOver = await run(player, P.line, { uuid: host.uuid, key: "w" });
  await run(player, P.drag, { uuid: host.uuid, key: "w", phase: "drop", payload: { type: "Actor", uuid: A.uuid } });
  const pr1 = await run(gm, P.rows, { uuid: host.uuid });
  const gp1 = await run(gm, P.guard, { id: fid, group: W.uuid });
  check("a drop on it shows no target and writes nothing: no officer, member or parent changed", !pOver.target && JSON.stringify(pr0.map((r) => r.officer)) === JSON.stringify(pr1.map((r) => r.officer)) && JSON.stringify(gp0) === JSON.stringify(gp1), { officers: pr1.map((r) => r.officer), over: pOver.target });
  const pp = await run(player, P.line, { uuid: host.uuid, key: "p" });
  check("a part row with an officer whose group the Player does not own shows no Clear, no button and no target", pp.drawn && !pp.dropAttr && !pp.actions.includes("orgAddOfficer") && !pp.actions.includes("orgClearLeader"), pp);
  const pq = await until(player, P.line, { uuid: host.uuid, key: "q" }, (l) => l.drawn);
  check(`the part row whose group the Player owns is a drop target, and + Officer is ${perm.canCreate ? "shown" : "absent"} as the world's actor-create permission says`, pq.dropAttr && pq.actions.includes("orgAddOfficer") === perm.canCreate, pq);
  await run(player, P.drag, { uuid: host.uuid, key: "q", phase: "start", payload: { type: "Actor", uuid: A.uuid } });
  await run(player, P.drag, { uuid: host.uuid, key: "q", phase: "drop", payload: { type: "Actor", uuid: A.uuid } });
  const pr2 = await until(gm, P.rows, { uuid: host.uuid }, (rs) => keyRow(rs, "q")?.officer === A.uuid);
  check("a drop on that line writes the officer, by the Player's own ownership", keyRow(pr2, "q").officer === A.uuid, keyRow(pr2, "q"));
  if (perm.canCreate) {
    await run(gm, P.setOfficer, { uuid: host.uuid, key: "q", officer: "" });
    await run(player, P.reopen, { uuid: host.uuid });
    await run(player, P.pressCard, { uuid: host.uuid, key: "q", action: "orgEdit", wait: 700 });
    await until(player, P.line, { uuid: host.uuid, key: "q" }, (l) => l.actions.includes("orgAddOfficer"));
    await run(player, P.pressLine, { uuid: host.uuid, key: "q", action: "orgAddOfficer", wait: 2000 });
    const pr3 = await until(gm, P.rows, { uuid: host.uuid }, (rs) => !!keyRow(rs, "q")?.officer);
    const O3 = keyRow(pr3, "q").officer;
    if (O3) gm.track(O3);
    check("the Player's + Officer press wrote the officer, and the actor is tracked for the sweep", !!O3 && O3 !== A.uuid, O3);
  } else note("not walked", "Players may not create actors in this world, so the Player's + Officer press was not driven; the button's absence is what was asserted");

  note("not walked", "a place dropped on a line (unit-tested), the press on a seat that lost ownership between render and press, and a dragover read in a browser pane with a pointer (the events are script-dispatched, as the other walks' drags are)");
  walkDone();
} catch (err) {
  if (err?.name !== "WalkBlocked") {
    console.log(`WALK ERROR: ${err?.message ?? err}`);
    console.error(err?.stack ?? err);
    process.exitCode = 1;
  }
} finally {
  section("teardown");
  const gm = open.gm;
  if (gm) {
    try { await run(gm, P.closeSheets, { uuids: [hostUuid, ghUuid].filter(Boolean) }); } catch (err) { console.error("close:", err?.message ?? err); }
    try { for (const uuid of owned) await run(gm, P.setOwnership, { uuid, player: MACHINE.player, level: 0, defaultLevel: 0 }); } catch (err) { console.error("ownership:", err?.message ?? err); }
    try { if (fid) await gm.eval(`game.actors.get("${fid}")?.update({"system.units": [], "system.leaderUuid": "", "system.parentUuid": ""})`); } catch (err) { console.error("reset:", err?.message ?? err); }
    try { note("swept", await gm.sweepTracked({ only: gm.tracked().filter((e) => !e.marker).map((e) => e.uuid) })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  }
  console.log(`\nchecks: ${tally.pass} passed, ${tally.fail} failed`);
  if (tally.fail) process.exitCode = 1;
  for (const api of Object.values(open)) { try { api.close(); } catch (_e) { /* closed */ } }
}
