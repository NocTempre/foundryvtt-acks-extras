/**
 * Live walk, a group's own gestures on its sheet: docs/lib/TESTING.md "Join, leave
 * and make its own", steps 1 to 9. Every press is a click on the rendered sheet's
 * control, run as `element.click()` in page context (the capture driver has no click
 * helper), and every observable is the stored rows, `orgHostOf`, the redrawn line or
 * a notification the seat was handed:
 * the line's first-element render and its buttons at 420 px, a picker closed with
 * nothing written, a join through the picker, Open, Leave, Make its own with and
 * without an officer, a group that hosts a chart of two rows, and a player seat that
 * owns the group but not the faction (refused with a warning, nothing written) and
 * then at Observer (the line with no button). Step 7b is the picker's Under select: its
 * rows are the chosen faction's, refilled when the faction changes, and a Join beneath a
 * row nests the group's top row there; the player seat reads that a hidden row is not
 * offered.
 * Machine values arrive through ./_env.mjs. Every name and figure here is invented.
 *
 * Fixtures, kept and found again by marker (`api.fixture`): `lib/org-wander` (a group
 * with one stack over the kept monster, the kept chief as its officer) and
 * `lib/org-wander-faction`; `lib/org-monster` and `lib/org-chief` are the organisation
 * chart walk's own and are read, never written. The shape step writes the rows, the
 * parent, the officer, the stack and both ownerships at the start of every run. The
 * walk does not put them back at its end. Disposable, by the run's own ledger: the two
 * faction cards step 6 makes.
 *
 * Not driven: a tooltip's hover (the attribute is read), and the faction's own sheet
 * drawing the joined group's tree.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";
import { walkDone, blocked } from "./_walk.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const TAG = MACHINE.own ? ` ${MACHINE.own}` : "";
const OBSERVER = 2;

const tally = { pass: 0, fail: 0 };
const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const check = (label, ok, detail) => {
  tally[ok ? "pass" : "fail"] += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const rowsOf = (rows) => rows.map((r) => `${r.key}|${r.parentKey}`).sort();

/* Page side: each function is stringified and run in a seat's page, after `install`. */
const P = {
  /** The seat's helpers on one global, a notification recorder, and the open-window baseline. */
  install: async () => {
    const H = (globalThis.__lj = globalThis.__lj ?? { opened: [] });
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 80, every = 200 } = {}) => {
      for (let n = 0; n < tries; n++) {
        const v = await fn();
        if (v) return v;
        await H.sleep(every);
      }
      return null;
    };
    H.root = (app) => { const el = app?.element; return el?.nodeType === 1 ? el : (el?.[0] ?? null); };
    if (!H.wrapped) {
      H.baseline = [...foundry.applications.instances.keys()];
      H.said = [];
      H.own = {};
      for (const level of ["info", "warn", "error"]) {
        H.own[level] = Object.hasOwn(ui.notifications, level) ? ui.notifications[level] : null;
        const fn = ui.notifications[level];
        ui.notifications[level] = function (message, ...rest) { H.said.push({ level, message: String(message) }); return fn.call(this, message, ...rest); };
      }
      H.wrapped = true;
    }
    return {
      user: game.user.name, role: game.user.role, isGM: game.user.isGM,
      activeGM: game.users.activeGM?.name ?? null, activeGMIsSelf: !!game.users.activeGM?.isSelf,
      api: !!(globalThis.acksExtras?.lib?.org?.factionLineOf && acksExtras.lib.org.orgHostOf && acksExtras.lib.groups?.addStack),
    };
  },

  /** The kept fixtures at their shape; what they held is returned first. */
  shape: async (a) => {
    const groups = acksExtras.lib.groups;
    const org = acksExtras.lib.org;
    const group = game.actors.get(a.groupId);
    const faction = game.actors.get(a.factionId);
    const chief = game.actors.get(a.chiefId);
    const monster = game.actors.get(a.monsterId);
    const user = game.users.find((u) => u.name === a.player);
    if (!user) return { error: "the player seat's user is not in the world" };
    const before = {
      groupRows: group.system.units.length,
      factionRows: faction.system.units.length,
      parent: group.system.unit.parentGroupUuid,
      officerIsChief: group.system.unit.officerUuid === chief.uuid,
      stacks: group.system.stacks.length,
      host: org.orgHostOf(group.uuid)?.host?.uuid ?? null,
    };
    await faction.update({ "system.units": [], "system.leaderUuid": "" });
    await group.update({ "system.units": [], "system.unit.parentGroupUuid": "", "system.unit.officerUuid": chief.uuid });
    let stack = null;
    const [s, ...more] = group.system.toObject().stacks;
    if (!(s && !more.length && s.template.uuid === monster.uuid && s.size.current === 3 && s.size.initial === 3 && !s.roster.length)) {
      await group.update({ "system.stacks": [] });
      stack = await groups.addStack(group, monster, { count: 3 });
    }
    await group.update({ ownership: { default: 1, [user.id]: 3 } });
    await faction.update({ ownership: { default: 1, [user.id]: 1 } });
    const s2 = group.system.toObject().stacks;
    return {
      before,
      stackBuilt: stack === null ? "kept" : (stack?.ok ?? typeof stack),
      after: {
        groupRows: group.system.units.length,
        factionRows: faction.system.units.length,
        parent: group.system.unit.parentGroupUuid,
        officerIsChief: group.system.unit.officerUuid === chief.uuid,
        stackOverMonster: s2.length === 1 && s2[0].template.uuid === monster.uuid,
        host: org.orgHostOf(group.uuid)?.host?.uuid ?? null,
        playerOwnsGroup: group.testUserPermission(user, "OWNER"),
        playerOwnsFaction: faction.testUserPermission(user, "OWNER"),
        factionType: faction.type,
        groupType: group.type,
      },
    };
  },

  /** Both charts as stored, the group's parent and officer, and what the faction line reads. */
  read: async (a) => {
    const org = acksExtras.lib.org;
    const g = game.actors.get(a.groupId);
    const f = game.actors.get(a.factionId);
    const found = org.orgHostOf(g.uuid);
    return {
      group: g.system.toObject().units,
      faction: f.system.toObject().units,
      parent: g.system.unit.parentGroupUuid,
      officer: g.system.unit.officerUuid,
      host: found ? { uuid: found.host.uuid, key: found.row.key, isGroup: found.host.uuid === g.uuid } : null,
      state: org.factionLineOf(g).state,
      names: { group: g.name, faction: f.name },
    };
  },

  /** A faction card made by a press, read from its uuid. */
  card: async ({ uuid }) => {
    const c = await fromUuid(uuid);
    return c ? { name: c.name, type: c.type, leaderUuid: c.system.leaderUuid, units: c.system.toObject().units } : null;
  },

  chartOf: async ({ id }) => {
    const c = acksExtras.lib.org.chartOf(game.actors.get(id));
    return c ? { host: c.host.uuid, key: c.row.key, above: c.above, below: c.below } : null;
  },

  addRow: async ({ id, parentKey, label }) => {
    const r = await acksExtras.lib.org.addRow(game.actors.get(id), parentKey, { label });
    return { ok: r.ok, key: r.key ?? null, reason: r.reason ?? null };
  },

  write: async ({ id, path, value }) => {
    await game.actors.get(id).update({ [path]: value });
    return true;
  },

  setOwnership: async ({ id, player, level }) => {
    const user = game.users.find((u) => u.name === player);
    await game.actors.get(id).update({ ownership: { [user.id]: level } });
    return true;
  },

  /** What this seat reads of its own permissions on the two fixtures. */
  perm: async (a) => {
    const g = game.actors.get(a.groupId);
    const f = game.actors.get(a.factionId);
    return {
      isGM: game.user.isGM,
      groupOwner: g.isOwner,
      groupObserver: g.testUserPermission(game.user, "OBSERVER"),
      factionOwner: f.isOwner,
    };
  },

  /** The group's sheet rendered (closed first where `fresh`), and its body drawn. */
  open: async ({ id, fresh }) => {
    const H = globalThis.__lj;
    const app = game.actors.get(id).sheet;
    if (!H.opened.includes(id)) H.opened.push(id);
    if (fresh && app.rendered) await app.close({ animate: false });
    await app.render({ force: true });
    const drawn = await H.poll(() => H.root(app)?.querySelector(".acks-lib-group-body"), { tries: 100 });
    return { rendered: app.rendered, drawn: !!drawn, cls: app.constructor.name, width: app.position.width };
  },

  /** The faction line as drawn now, or `drawn: false`. */
  line: async ({ id }) => {
    const H = globalThis.__lj;
    const root = H.root(game.actors.get(id).sheet);
    const el = root?.querySelector(".acks-extras-group-faction");
    if (!el) return { drawn: false, body: !!root?.querySelector(".acks-lib-group-body") };
    const btns = [...el.querySelectorAll("button")];
    return {
      drawn: true,
      first: el.parentElement?.firstElementChild === el,
      name: el.querySelector(".acks-extras-group-faction__name")?.textContent.trim() ?? null,
      hint: el.querySelector(".hint")?.textContent.trim() ?? null,
      controls: btns.map((b) => b.dataset.action ?? "").sort(),
      tips: btns.map((b) => !!b.getAttribute("data-tooltip")),
    };
  },

  /** The window narrowed, each line button's box against the window content's, then put back. */
  narrow: async ({ id, widths }) => {
    const H = globalThis.__lj;
    const app = game.actors.get(id).sheet;
    const box = (r) => ({ l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) });
    const out = [];
    for (const width of widths) {
      app.setPosition({ width });
      await H.sleep(500);
      const content = H.root(app).querySelector(".window-content");
      const c = content.getBoundingClientRect();
      const buttons = [...H.root(app).querySelectorAll(".acks-extras-group-faction button")].map((b) => {
        const r = b.getBoundingClientRect();
        return { action: b.dataset.action, box: box(r), inside: r.width > 0 && r.height > 0 && r.left >= c.left - 1 && r.right <= c.right + 1 && r.top >= c.top - 1 && r.bottom <= c.bottom + 1 };
      });
      out.push({ asked: width, width: Math.round(app.position.width), content: box(c), buttons });
    }
    app.setPosition({ width: 600 });
    await H.sleep(300);
    return out;
  },

  /** A click on one of the line's controls; what the seat said before is cleared and the open windows are noted. */
  press: async ({ id, action }) => {
    const H = globalThis.__lj;
    const btn = H.root(game.actors.get(id).sheet)?.querySelector(`.acks-extras-group-faction [data-action="${action}"]`);
    if (!btn) return { clicked: false };
    H.before = [...foundry.applications.instances.keys()];
    H.said.length = 0;
    btn.click();
    return { clicked: true };
  },

  /** The faction picker a press opened, or null. */
  picker: async () => {
    const H = globalThis.__lj;
    const dlg = [...foundry.applications.instances.values()].find((a) => !(H.before ?? []).includes(a.id) && a instanceof foundry.applications.api.DialogV2 && H.root(a)?.querySelector('select[name="faction"]'));
    if (!dlg) return null;
    const root = H.root(dlg);
    return {
      options: [...root.querySelectorAll('select[name="faction"] option')].map((o) => ({ value: o.value, text: o.textContent.trim() })),
      footer: [...root.querySelectorAll(".form-footer button")].map((b) => ({ action: b.dataset.action ?? null, text: b.textContent.trim() })),
      closeControl: !!root.querySelector('.window-header [data-action="close"]'),
      title: root.querySelector(".window-title")?.textContent.trim() ?? null,
    };
  },

  /** The picker closed by its header's close control, and gone before this answers. */
  pickerClose: async () => {
    const H = globalThis.__lj;
    const dlg = [...foundry.applications.instances.values()].find((a) => !(H.before ?? []).includes(a.id) && a instanceof foundry.applications.api.DialogV2 && H.root(a)?.querySelector('select[name="faction"]'));
    if (!dlg) return { found: false };
    const control = H.root(dlg).querySelector('.window-header [data-action="close"]');
    if (control) control.click(); else await dlg.close({ animate: false });
    const gone = await H.poll(() => !foundry.applications.instances.has(dlg.id), { tries: 50 });
    return { found: true, viaControl: !!control, gone: !!gone };
  },

  /** The kept faction chosen in the picker and its one footer button pressed. */
  pickerJoin: async ({ uuid, under }) => {
    const H = globalThis.__lj;
    const dlg = [...foundry.applications.instances.values()].find((a) => !(H.before ?? []).includes(a.id) && a instanceof foundry.applications.api.DialogV2 && H.root(a)?.querySelector('select[name="faction"]'));
    if (!dlg) return { found: false };
    const root = H.root(dlg);
    const select = root.querySelector('select[name="faction"]');
    select.value = uuid;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    const buttons = [...root.querySelectorAll(".form-footer button[data-action]")];
    const go = buttons.find((b) => b.dataset.action === "join") ?? buttons[0];
    if (under !== undefined) {
      const choice = root.querySelector('select[name="under"]');
      if (choice) choice.value = under;
      if (!choice || choice.value !== under) return { found: true, chosen: select.value === uuid, pressed: false, underSet: false };
    }
    if (select.value !== uuid || !go) return { found: true, chosen: select.value === uuid, pressed: false, actions: buttons.map((b) => b.dataset.action) };
    go.click();
    const gone = await H.poll(() => !foundry.applications.instances.has(dlg.id), { tries: 50 });
    return { found: true, chosen: true, pressed: go.dataset.action, gone: !!gone };
  },

  /** Choose the faction and the row named, then press the picker's Cancel: the footer's actions as drawn, and whether the dialog closed. */
  pickerCancel: async ({ uuid, under }) => {
    const H = globalThis.__lj;
    const dlg = [...foundry.applications.instances.values()].find((a) => !(H.before ?? []).includes(a.id) && a instanceof foundry.applications.api.DialogV2 && H.root(a)?.querySelector('select[name="faction"]'));
    if (!dlg) return { found: false };
    const root = H.root(dlg);
    const select = root.querySelector('select[name="faction"]');
    select.value = uuid;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    const choice = root.querySelector('select[name="under"]');
    if (choice) choice.value = under;
    const actions = [...root.querySelectorAll(".form-footer button[data-action]")].map((b) => b.dataset.action);
    const cancel = root.querySelector('.form-footer button[data-action="cancel"]');
    if (!cancel) return { found: true, actions, pressed: false };
    cancel.click();
    const gone = await H.poll(() => !foundry.applications.instances.has(dlg.id), { tries: 50 });
    return { found: true, actions, pressed: true, gone: !!gone };
  },

  /** The picker's Under select after the faction named is chosen (a change event, as a hand's choice fires): its choices as drawn. */
  pickerUnder: async ({ uuid }) => {
    const H = globalThis.__lj;
    const dlg = [...foundry.applications.instances.values()].find((a) => !(H.before ?? []).includes(a.id) && a instanceof foundry.applications.api.DialogV2 && H.root(a)?.querySelector('select[name="faction"]'));
    if (!dlg) return { found: false };
    const root = H.root(dlg);
    const select = root.querySelector('select[name="faction"]');
    select.value = uuid;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    const under = root.querySelector('select[name="under"]');
    if (!under) return { found: true, drawn: false };
    const nb = String.fromCharCode(160);
    return {
      found: true,
      drawn: true,
      chosen: select.value === uuid,
      selected: under.value,
      label: under.getAttribute("aria-label") ?? "",
      tip: under.dataset.tooltipText ?? "",
      options: [...under.options].map((o) => ({ value: o.value, indented: o.textContent.startsWith(nb), text: o.textContent.split(nb).join("").trim() })),
    };
  },

  /** A row of a faction marked hidden, as a Judge's row. */
  hideRow: async ({ id, key }) => {
    const a = game.actors.get(id);
    await a.update({ "system.units": a.system.toObject().units.map((r) => (r.key === key ? { ...r, hidden: true } : r)) });
    return true;
  },

  /** The faction card that lists the group, as a made card shows once the join landed. */
  madeHost: async ({ groupId, factionId }) => {
    const H = globalThis.__lj;
    const g = game.actors.get(groupId);
    const keptUuid = game.actors.get(factionId).uuid;
    for (let n = 0; n < 150; n++) {
      const h = acksExtras.lib.org.orgHostOf(g.uuid)?.host;
      if (h && h.uuid !== g.uuid && h.uuid !== keptUuid && h.type === "acks-extras.faction") return { uuid: h.uuid };
      await H.sleep(100);
    }
    return null;
  },

  /** Whether the faction's sheet has rendered. */
  factionSheet: async ({ id }) => {
    const H = globalThis.__lj;
    if (!H.opened.includes(id)) H.opened.push(id);
    return { rendered: !!game.actors.get(id).sheet.rendered };
  },

  closeSheet: async ({ id }) => {
    await game.actors.get(id).sheet.close({ animate: false });
    return !game.actors.get(id).sheet.rendered;
  },

  said: async () => (globalThis.__lj?.said ?? []).map((m) => ({ ...m })),

  /** The toasts the page shows now: a second reading beside the recorder. */
  toasts: async () => [...document.querySelectorAll(".notification")].map((n) => n.textContent.replace(/\s+/g, " ").trim()),

  /** Every window this walk opened and any picker it left, closed; the recorder taken off. */
  closeAll: async () => {
    const H = globalThis.__lj;
    if (!H) return "never installed";
    for (const app of [...foundry.applications.instances.values()]) {
      if (H.baseline.includes(app.id)) continue;
      if (app instanceof foundry.applications.api.DialogV2 && H.root(app)?.querySelector('select[name="faction"]')) { try { await app.close({ animate: false }); } catch (_e) { /* closed */ } }
    }
    for (const id of H.opened) { try { await game.actors.get(id)?.sheet.close({ animate: false }); } catch (_e) { /* closed */ } }
    H.opened = [];
    if (H.wrapped) {
      for (const level of ["info", "warn", "error"]) {
        if (H.own[level]) ui.notifications[level] = H.own[level]; else delete ui.notifications[level];
      }
      H.wrapped = false;
    }
    return "closed";
  },
};

const run = (api, fn, arg) => api.eval(`(${fn.toString()})(${JSON.stringify(arg ?? null)})`);

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

const open = {};
const swept = [];
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 570_000);
setTimeout(() => {
  console.error(`WALK ERROR: wall clock of ${WALL_MS} ms reached; closing the seats`);
  for (const api of Object.values(open)) { try { api.close(); } catch (_e) { /* closed */ } }
  process.exit(1);
}, WALL_MS).unref();

try {
  section("seat");
  open.gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  const gm = open.gm;
  const census = await run(gm, P.install);
  note("active GM", { name: census.activeGM, isThisSeat: census.activeGMIsSelf });
  if (!census.api) blocked("acksExtras.lib.org or lib.groups is not on the page: the module did not load");
  check("the seat is a GM", census.isGM, census.role);
  note("driving", "every press is element.click() in page context on the rendered sheet's control; a write made by API is printed as such");

  section("fixtures");
  const named = (what) => `QA Org ${what}${TAG}`;
  const monster = await gm.fixture("lib/org-monster", "Actor", { name: named("beast"), type: "monster", items: [] });
  const chief = await gm.fixture("lib/org-chief", "Actor", { name: named("chief"), type: "character", items: [], system: { hp: { value: 8, max: 8 } } });
  const group = await gm.fixture("lib/org-wander", "Actor", { name: named("wander"), type: "acks-extras.group", items: [] });
  const faction = await gm.fixture("lib/org-wander-faction", "Actor", { name: named("wander village"), type: "acks-extras.faction", items: [] });
  const A = { groupId: group.id, factionId: faction.id };
  const shaped = await run(gm, P.shape, { ...A, chiefId: chief.id, monsterId: monster.id, player: MACHINE.player });
  if (shaped.error) blocked(shaped.error);
  note("found at", shaped.before);
  note("stack", shaped.stackBuilt);
  const a0 = shaped.after;
  check("the group and faction are the sub-types the walk needs", a0.groupType === "acks-extras.group" && a0.factionType === "acks-extras.faction", [a0.groupType, a0.factionType]);
  check("the kept fixtures stand at their shape: no row anywhere, the group inside none, the chief its officer, one stack over the kept monster", a0.groupRows === 0 && a0.factionRows === 0 && a0.parent === "" && a0.officerIsChief && a0.stackOverMonster, a0);
  check("the player seat's user owns the group and does not own the faction", a0.playerOwnsGroup === true && a0.playerOwnsFaction === false, [a0.playerOwnsGroup, a0.playerOwnsFaction]);
  if (a0.host) blocked(`a document still lists the group after the shape: ${a0.host}. A faction card from a run that died stands; remove it by the uuid its run logged`);
  const hostCheck = await run(gm, P.read, A);
  check("orgHostOf(group) is null at the shape", hostCheck.host === null, hostCheck.host);

  section("1. the line renders, and fits a narrow window");
  const opened = await run(gm, P.open, { id: group.id, fresh: true });
  note("sheet", opened);
  check("the group's sheet renders its body", opened.rendered && opened.drawn, opened);
  let line = await until(gm, P.line, { id: group.id }, (l) => l?.drawn);
  check("the faction line is the body's first element and reads None", line.drawn && line.first === true && line.name === "None", line);
  check("it carries Join a faction and Make its own, and neither Open nor Leave", same(line.controls, ["joinFaction", "makeFaction"]), line.controls);
  check("each button carries a tooltip key (the hover itself is not driven)", line.tips?.length === 2 && line.tips.every(Boolean), line.tips);
  const narrow = await run(gm, P.narrow, { id: group.id, widths: [420, 300] });
  const n420 = narrow.find((n) => n.asked === 420);
  check("narrowed to 420, both buttons stay inside the window content's box", n420.buttons.length === 2 && n420.buttons.every((b) => b.inside), n420);
  note("narrowed to 300 (not gated: the window's own floor may hold it wider)", narrow.find((n) => n.asked === 300));

  section("2. Join, the picker closed: nothing written");
  const before2 = await run(gm, P.read, A);
  check("the press found its button", (await run(gm, P.press, { id: group.id, action: "joinFaction" })).clicked === true);
  const picker2 = await until(gm, P.picker, null, (d) => !!d);
  note("picker", picker2);
  check("a picker opens, lists the kept faction and offers one footer button", !!picker2 && picker2.options.some((o) => o.value === faction.uuid) && picker2.footer.length === 1, picker2);
  check("the picker has a header close control", picker2?.closeControl === true);
  const closed2 = await run(gm, P.pickerClose);
  if (closed2.viaControl === false) note("NOTE", "driven by API, not click: the picker had no header close control");
  check("the picker closes", closed2.found && closed2.gone, closed2);
  await sleep(900);
  const after2 = await run(gm, P.read, A);
  check("both documents' units are as they were", same([before2.group, before2.faction], [after2.group, after2.faction]), { group: after2.group.length, faction: after2.faction.length });
  const said2 = await run(gm, P.said);
  check("no notification was raised", said2.length === 0, said2);

  section("3. Join the kept faction");
  await run(gm, P.press, { id: group.id, action: "joinFaction" });
  const picker3 = await until(gm, P.picker, null, (d) => !!d);
  note("picker footer", picker3?.footer);
  const joinedPress = await run(gm, P.pickerJoin, { uuid: faction.uuid });
  check("the kept faction was chosen and the picker's button pressed", joinedPress.chosen === true && !!joinedPress.pressed && joinedPress.gone === true, joinedPress);
  line = await until(gm, P.line, { id: group.id }, (l) => l?.controls?.includes("leaveFaction"));
  let s = await run(gm, P.read, A);
  const said3 = await run(gm, P.said);
  const K = s.faction[0]?.key ?? null;
  check("an info notification names the faction", said3.some((m) => m.level === "info" && m.message.includes(s.names.faction)) && !said3.some((m) => m.level !== "info"), said3);
  check("the faction holds one row, labelled with the group's name, holding the group, with no parent", s.faction.length === 1 && s.faction[0].label === s.names.group && s.faction[0].holderUuid === group.uuid && !s.faction[0].parentKey, s.faction);
  check("the group's own rows are empty and the faction answers for it", s.group.length === 0 && s.host?.uuid === faction.uuid, { group: s.group.length, host: s.host });
  check("the line reads the faction's name, listed there as the group's name, with Open and Leave and neither Join nor Make", line.name === s.names.faction && !!line.hint?.includes(s.names.group) && same(line.controls, ["leaveFaction", "openFaction"]), line);

  section("4. Open");
  await run(gm, P.press, { id: group.id, action: "openFaction" });
  const sheet4 = await until(gm, P.factionSheet, { id: faction.id }, (v) => v.rendered);
  check("the faction's own sheet renders", sheet4.rendered === true, sheet4);
  await run(gm, P.closeSheet, { id: faction.id });

  section("5. Leave");
  await run(gm, P.press, { id: group.id, action: "leaveFaction" });
  line = await until(gm, P.line, { id: group.id }, (l) => l?.controls?.includes("joinFaction"));
  // The leave writes the group, then the faction: the line redraws on the first.
  s = await until(gm, P.read, A, (r) => r.faction.length === 0, { tries: 40 });
  const said5 = await until(gm, P.said, null, (m) => m.length > 0, { tries: 20 });
  check("an info notification names the faction", said5.some((m) => m.level === "info" && m.message.includes(s.names.faction)) && !said5.some((m) => m.level !== "info"), said5);
  check("the faction's units are empty", s.faction.length === 0, s.faction.length);
  check("the group holds the same row under the same key, at the top, holding itself", s.group.length === 1 && s.group[0].key === K && !s.group[0].parentKey && s.group[0].holderUuid === group.uuid, s.group);
  check("the line reads None again, with Join and Make", line.name === "None" && same(line.controls, ["joinFaction", "makeFaction"]), line);
  check("the group hosts itself", s.host?.isGroup === true && s.host.key === K, s.host);

  section("6. Make its own");
  const cards = [];
  const made = async (label, officerBlank) => {
    const pressed = await run(gm, P.press, { id: group.id, action: "makeFaction" });
    check(`${label}: the press found its button`, pressed.clicked === true);
    const host = await run(gm, P.madeHost, A);
    if (host?.uuid) swept.push(gm.track(host.uuid, "Actor"));
    if (!host) {
      check(`${label}: a card lists the group`, false, "none appeared in 15 s; a card may stand made and untracked, found by the group's rows and not by name");
      return null;
    }
    cards.push(host.uuid);
    await sleep(500);
    const card = await run(gm, P.card, { uuid: host.uuid });
    line = await until(gm, P.line, { id: group.id }, (l) => l?.controls?.includes("leaveFaction"));
    const r = await run(gm, P.read, A);
    const said = await run(gm, P.said);
    check(`${label}: a faction card named as the group, holding the group's row`, card?.type === "acks-extras.faction" && card.name === r.names.group && card.units.length === 1 && card.units[0].holderUuid === group.uuid && card.units[0].key === K, { name: card?.name, units: card?.units?.length });
    if (officerBlank) check(`${label}: its leader is blank`, !card.leaderUuid, card.leaderUuid);
    else check(`${label}: its leader is the group's officer`, !!card.leaderUuid && card.leaderUuid === r.officer && card.leaderUuid === chief.uuid, { leader: card.leaderUuid === chief.uuid ? "the chief" : card.leaderUuid, officer: r.officer === chief.uuid ? "the chief" : r.officer });
    check(`${label}: the line names it, with Open and Leave`, line.name === card.name && same(line.controls, ["leaveFaction", "openFaction"]), line);
    check(`${label}: an info notification names the card`, said.some((m) => m.level === "info" && m.message.includes(card.name)) && !said.some((m) => m.level !== "info"), said);
    return host.uuid;
  };
  const leaveIt = async (label, uuid) => {
    await run(gm, P.press, { id: group.id, action: "leaveFaction" });
    line = await until(gm, P.line, { id: group.id }, (l) => l?.controls?.includes("makeFaction"));
    const r = await run(gm, P.read, A);
    const card = uuid ? await run(gm, P.card, { uuid }) : null;
    check(`${label}: left, the group hosts itself again and the card holds no row`, r.host?.isGroup === true && (!card || card.units.length === 0), { host: r.host, card: card?.units?.length });
  };
  const first = await made("with the officer", false);
  if (first) await leaveIt("with the officer", first);
  await run(gm, P.write, { id: group.id, path: "system.unit.officerUuid", value: "" });
  note("NOTE", "driven by API, not click: the group's officer blanked for the second make");
  await until(gm, P.line, { id: group.id }, (l) => l?.controls?.includes("makeFaction"));
  const second = await made("without an officer", true);
  if (second) await leaveIt("without an officer", second);
  await run(gm, P.write, { id: group.id, path: "system.unit.officerUuid", value: chief.uuid });
  note("NOTE", "driven by API, not click: the group's officer put back");
  check("the two made cards are two cards", cards.length === 2 && cards[0] !== cards[1], cards);

  section("7. a group with a chart joins and leaves with its rows");
  const under = await run(gm, P.addRow, { id: group.id, parentKey: K, label: "Under" });
  s = await run(gm, P.read, A);
  const chartRows = rowsOf(s.group);
  check("the group hosts two rows, the second under the first", under.ok === true && s.group.length === 2 && s.group.find((r) => r.key === under.key)?.parentKey === K, { under, rows: s.group.length });
  line = await until(gm, P.line, { id: group.id }, (l) => l?.controls?.includes("joinFaction"));
  check("the line still offers Join and Make", same(line.controls, ["joinFaction", "makeFaction"]), line.controls);
  await run(gm, P.press, { id: group.id, action: "joinFaction" });
  await until(gm, P.picker, null, (d) => !!d);
  const join7 = await run(gm, P.pickerJoin, { uuid: faction.uuid });
  check("the kept faction was chosen and the picker's button pressed", join7.chosen === true && !!join7.pressed && join7.gone === true, join7);
  line = await until(gm, P.line, { id: group.id }, (l) => l?.controls?.includes("leaveFaction"));
  s = await run(gm, P.read, A);
  check("both rows stand on the faction with their keys and parents as they were", same(rowsOf(s.faction), chartRows), { faction: rowsOf(s.faction), was: chartRows });
  check("the group's own rows are empty", s.group.length === 0, s.group.length);
  const chart7 = await run(gm, P.chartOf, { id: group.id });
  check("chartOf(group) answers from the faction's rows: the faction hosts, the group's row is K and the second row is beneath it", chart7?.host === faction.uuid && chart7.key === K && chart7.below.includes(under.key), chart7);
  await run(gm, P.press, { id: group.id, action: "leaveFaction" });
  line = await until(gm, P.line, { id: group.id }, (l) => l?.controls?.includes("joinFaction"));
  s = await run(gm, P.read, A);
  check("leave brings both rows back to the group, and the faction holds none", same(rowsOf(s.group), chartRows) && s.faction.length === 0, { group: rowsOf(s.group), faction: s.faction.length });
  check("the group hosts itself and the line reads None", s.host?.isGroup === true && line.name === "None", { host: s.host, line: line.name });

  section("7b. Join under a row");
  const top7 = await run(gm, P.addRow, { id: faction.id, parentKey: "", label: "QA Top" });
  const child7 = await run(gm, P.addRow, { id: faction.id, parentKey: top7.key, label: "QA Child" });
  const hidden7 = await run(gm, P.addRow, { id: faction.id, parentKey: "", label: "QA Hidden" });
  await run(gm, P.hideRow, { id: faction.id, key: hidden7.key });
  note("NOTE", "driven by API, not click: three rows written on the kept faction (a top, a row beneath it, and a hidden top)");
  check("the faction holds the three rows", top7.ok && child7.ok && hidden7.ok, { top7, child7, hidden7 });
  await run(gm, P.press, { id: group.id, action: "joinFaction" });
  await until(gm, P.picker, null, (d) => !!d);
  const cancel7 = await run(gm, P.pickerCancel, { uuid: faction.uuid, under: child7.key });
  check("the picker's footer offers Join then Cancel, and Cancel closes it", same(cancel7.actions, ["join", "cancel"]) && cancel7.pressed === true && cancel7.gone === true, cancel7);
  const sCancel = await run(gm, P.read, A);
  check("Cancel joins nothing: the group hosts its own rows and the faction holds only its three", sCancel.group.length === 2 && sCancel.faction.length === 3 && sCancel.host?.isGroup === true, { group: sCancel.group.length, faction: sCancel.faction.length });
  await run(gm, P.press, { id: group.id, action: "joinFaction" });
  await until(gm, P.picker, null, (d) => !!d);
  const under1 = await run(gm, P.pickerUnder, { uuid: faction.uuid });
  note("Under options", under1.options);
  check("the picker draws an Under select, At the top chosen first with a blank value", under1.drawn === true && under1.options?.[0]?.value === "" && under1.selected === "", under1);
  check("it lists the chosen faction's rows in reading order after At the top: for a Judge the hidden row too", same(under1.options.slice(1).map((o) => o.value), [top7.key, child7.key, hidden7.key]), under1.options);
  check("the nested row is indented and the top rows are not", under1.options[2].indented === true && under1.options[1].indented === false && under1.options[3].indented === false, under1.options.map((o) => o.indented));
  check("the labels are the rows' own", same(under1.options.slice(1).map((o) => o.text), ["QA Top", "QA Child", "QA Hidden"]), under1.options.map((o) => o.text));
  check("the select's tooltip and aria-label say what the field does, and name the group", under1.label.length > 0 && under1.label === under1.tip && under1.label.includes(s.names.group), { label: under1.label, tip: under1.tip });
  const other = cards[0] ? await run(gm, P.pickerUnder, { uuid: cards[0] }) : null;
  if (other) check("changing the faction refills Under: a card holding no row offers At the top alone", other.chosen === true && same(other.options.map((o) => o.value), [""]) && other.selected === "", other.options);
  else note("not walked", "no card from step 6 stands to switch the faction to");
  const back = await run(gm, P.pickerUnder, { uuid: faction.uuid });
  check("changing it back refills the kept faction's rows", same(back.options.slice(1).map((o) => o.value), [top7.key, child7.key, hidden7.key]), back.options);
  const join7b = await run(gm, P.pickerJoin, { uuid: faction.uuid, under: child7.key });
  check("the faction and the row beneath were chosen and the picker's button pressed", join7b.chosen === true && !!join7b.pressed && join7b.gone === true, join7b);
  line = await until(gm, P.line, { id: group.id }, (l) => l?.controls?.includes("leaveFaction"));
  s = await until(gm, P.read, A, (r) => r.group.length === 0 && r.faction.length === 5, { tries: 40 });
  const parentIn = (rows, key) => rows.find((r) => r.key === key)?.parentKey;
  check("the group's top row stands under the row picked, and the row that was beneath it stays beneath it", parentIn(s.faction, K) === child7.key && parentIn(s.faction, under.key) === K, { K: parentIn(s.faction, K), under: parentIn(s.faction, under.key) });
  check("the faction's own three rows are as they were", parentIn(s.faction, top7.key) === "" && parentIn(s.faction, child7.key) === top7.key && parentIn(s.faction, hidden7.key) === "", rowsOf(s.faction));
  await run(gm, P.press, { id: group.id, action: "leaveFaction" });
  line = await until(gm, P.line, { id: group.id }, (l) => l?.controls?.includes("joinFaction"));
  s = await until(gm, P.read, A, (r) => r.faction.length === 3 && r.group.length === 2, { tries: 40 });
  check("Leave brings the group's two rows back, the top row at the top again", same(rowsOf(s.group), chartRows) && !parentIn(s.group, K) && s.faction.length === 3, { group: rowsOf(s.group), faction: s.faction.length });
  await run(gm, P.press, { id: group.id, action: "joinFaction" });
  await until(gm, P.picker, null, (d) => !!d);
  const top2 = await run(gm, P.pickerJoin, { uuid: faction.uuid, under: "" });
  check("At the top: the faction was chosen and the button pressed", top2.chosen === true && !!top2.pressed && top2.gone === true, top2);
  s = await until(gm, P.read, A, (r) => r.group.length === 0 && r.faction.length === 5, { tries: 40 });
  check("At the top passes no row: the group's top row is a top row of the faction", parentIn(s.faction, K) === "" && parentIn(s.faction, under.key) === K, { K: parentIn(s.faction, K) });
  await run(gm, P.press, { id: group.id, action: "leaveFaction" });
  await until(gm, P.line, { id: group.id }, (l) => l?.controls?.includes("joinFaction"));
  s = await until(gm, P.read, A, (r) => r.faction.length === 3 && r.group.length === 2, { tries: 40 });
  check("left again: the group hosts its two rows and the faction its three", s.group.length === 2 && s.faction.length === 3 && s.host?.isGroup === true, { group: s.group.length, faction: s.faction.length });

  section("8. the player seat");
  open.player = await connect({ browser, origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  const player = open.player;
  const pcensus = await run(player, P.install);
  check("the second seat is a player", pcensus.isGM === false && pcensus.api === true, { role: pcensus.role, isGM: pcensus.isGM, api: pcensus.api });
  const perm = await until(player, P.perm, A, (p) => p.groupOwner === true && p.factionOwner === false);
  check("on the player's own page the seat owns the group and not the faction", perm.groupOwner === true && perm.factionOwner === false, perm);
  const before8 = await run(gm, P.read, A);
  const open8 = await run(player, P.open, { id: group.id, fresh: true });
  check("the player's sheet renders", open8.rendered && open8.drawn, open8);
  const pline = await until(player, P.line, { id: group.id }, (l) => l?.controls?.includes("joinFaction"));
  check("the line offers Join and Make to the owner", same(pline.controls, ["joinFaction", "makeFaction"]), pline);
  await run(player, P.press, { id: group.id, action: "joinFaction" });
  const picker8 = await until(player, P.picker, null, (d) => !!d);
  check("the picker lists the kept faction to a player", !!picker8 && picker8.options.some((o) => o.value === faction.uuid), picker8?.options?.length);
  const under8 = await run(player, P.pickerUnder, { uuid: faction.uuid });
  note("Under options on the player's page", under8.options);
  check("a player is offered the faction's visible rows and never the hidden one", under8.drawn === true && same(under8.options.map((o) => o.value), ["", top7.key, child7.key]), under8.options);
  const join8 = await run(player, P.pickerJoin, { uuid: faction.uuid });
  check("the kept faction was chosen and the picker's button pressed", join8.chosen === true && !!join8.pressed, join8);
  const said8 = await until(player, P.said, null, (m) => m.some((x) => x.level === "warn"), { tries: 40 });
  const warn8 = said8.find((m) => m.level === "warn");
  check("a warning notification names the faction card and no info was raised", !!warn8 && warn8.message.includes(before8.names.faction) && !said8.some((m) => m.level === "info"), said8);
  note("toasts the player's page shows (a second reading)", await run(player, P.toasts));
  await sleep(900);
  const after8 = await run(gm, P.read, A);
  check("both documents are unwritten, read from the GM seat", same([before8.group, before8.faction], [after8.group, after8.faction]) && after8.host?.isGroup === true, { group: after8.group.length, faction: after8.faction.length, host: after8.host });
  await run(gm, P.setOwnership, { id: group.id, player: MACHINE.player, level: OBSERVER });
  note("NOTE", "driven by API, not click: the player set to Observer on the group");
  const perm2 = await until(player, P.perm, A, (p) => p.groupOwner === false && p.groupObserver === true);
  check("the player's page reads Observer on the group, not Owner", perm2.groupOwner === false && perm2.groupObserver === true, perm2);
  const open9 = await run(player, P.open, { id: group.id, fresh: true });
  const oline = await until(player, P.line, { id: group.id }, (l) => l?.drawn && l.tips.length === 0);
  check("at Observer the line shows, with no button", open9.drawn && oline.drawn === true && oline.tips.length === 0 && oline.name === "None", { open: open9.drawn, line: oline });

  walkDone();
} catch (err) {
  console.log(`WALK ERROR: ${err?.message ?? err}`);
  console.error(err?.stack ?? err);
  process.exitCode = 1;
} finally {
  section("9. teardown");
  for (const [who, api] of Object.entries(open)) {
    try { note(`closed on the ${who} seat`, await run(api, P.closeAll)); } catch (err) { console.error("close:", err?.message ?? err); }
  }
  const gm = open.gm;
  try { if (gm && swept.length) note("swept", await gm.sweepTracked({ only: swept })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  note("left as they stand", "the kept fixtures; the next run's shape step writes them, the player's ownership included");
  console.log(`\nchecks: ${tally.pass} passed, ${tally.fail} failed`);
  if (tally.fail) process.exitCode = 1;
  for (const api of Object.values(open)) { try { api.close(); } catch (_e) { /* closed */ } }
}
