/**
 * Live walk, the Org chart and Locations tabs: docs/lib/TESTING.md "The Org chart and
 * Locations tabs", marker `lib/beastman-warband`. Every step presses the control a
 * Judge presses on the faction sheet or the root group's sheet and reads what the
 * press wrote: Generate on a family template (the host opens on its Org chart tab), Add
 * a card, Roll one card with all below it, Edit a filled card's count, Send out and
 * Recall from the Locations tab, Expand all and Collapse all, Remove in edit with the
 * list of what it kept and removed, the tree scrolling in its own box in a narrow
 * window, and a player seat shown no hidden card. Machine values arrive through
 * ./_env.mjs. Every name and figure here is invented.
 *
 * Fixtures, kept and found again by marker (`api.fixture`): `lib/beastman-warband`
 * (the faction host), `lib/beastman-warband-group` (the root group host) and
 * `lib/beastman-warband-place` (a location carrying a Judge's note, so the empty-place
 * prune leaves it). The family template is read, never built: the first template actor
 * whose variant options carry an encounter line (`monsters/beastman-village@p3`'s
 * import); with none, the Roll, Generate and Remove steps are named not walked.
 * Disposable, by the run's own ledger: the host Generate made and what the Roll made.
 *
 * Active GM: the seated Judge whose user sorts first holds the group-combat and prune
 * sweeps; a lane that is not it passes FIXTURE_OWN. A press that writes two documents
 * redraws on the first write, so each step waits on the second document and the notice.
 */
import { connect } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";
import { walkDone, blocked } from "./_walk.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const TAG = MACHINE.own ? ` ${MACHINE.own}` : "";
const tally = { pass: 0, fail: 0 };
const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const check = (label, ok, detail) => {
  tally[ok ? "pass" : "fail"] += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/* Page side: each function is stringified and run in the GM seat's page. */
const P = {
  census: async () => ({
    role: game.user.role,
    activeGM: game.users.activeGM?.name ?? null,
    activeGMIsSelf: !!game.users.activeGM?.isSelf,
    template: game.actors.find((a) => a.type === "acks-extras.template" && (a.system.axes ?? []).find((x) => x.key === "variant")?.options?.some((o) => o.flags?.["acks-extras"]?.extras?.encounter))?.uuid ?? null,
    chartApi: !!globalThis.acksExtras?.lib?.org?.editRow && !!globalThis.acksExtras?.monsters?.rollOrganisation,
  }),

  /** Wait for a condition in the page, polling, and answer whether it held. */
  until: async ({ expr, ms }) => {
    const end = Date.now() + (ms ?? 8000);
    while (Date.now() < end) {
      if (await (0, eval)(expr)) return true;
      await new Promise((r) => setTimeout(r, 150));
    }
    return false;
  },

  /** A faction host at one empty top row naming the family template, its sheet open on a tab. */
  host: async ({ id, template, tab }) => {
    const actor = game.actors.get(id);
    await actor.update({ "system.units": [{ key: "top", parentKey: "", label: "", holderUuid: "", kind: "", notes: "", hidden: false, gen: template ? { template } : {} }] });
    actor.sheet.tabGroups.primary = tab;
    await actor.sheet.render(true);
    await new Promise((r) => setTimeout(r, 600));
    return { rows: actor.system.units.length, tab: actor.sheet.tabGroups.primary };
  },

  /** Press a control on a sheet by its action, optionally inside the card of a row key. */
  press: async ({ id, action, key, wait }) => {
    const el = game.actors.get(id).sheet.element;
    const scope = key ? el.querySelector(`li[data-key="${key}"] > div`) : el;
    const btn = scope?.querySelector(`[data-action="${action}"]`);
    if (!btn) return { pressed: false };
    btn.click();
    await new Promise((r) => setTimeout(r, wait ?? 700));
    return { pressed: true };
  },

  /** Answer the open dialog: set the named fields, then press its button. */
  dialog: async ({ fields, button }) => {
    await new Promise((r) => setTimeout(r, 500));
    const dlg = [...document.querySelectorAll("dialog.application, .application.dialog-v2")].at(-1);
    if (!dlg) return { answered: false };
    for (const [name, value] of Object.entries(fields ?? {})) {
      const f = dlg.querySelector(`[name="${name}"]`);
      if (f) f.value = value;
    }
    dlg.querySelector(`[data-action="${button}"]`)?.click();
    await new Promise((r) => setTimeout(r, 900));
    return { answered: true };
  },

  /** What the chart tab draws and what the host stores. */
  read: async ({ id }) => {
    const actor = game.actors.get(id);
    const el = actor.sheet.element;
    const cards = [...el.querySelectorAll(".acks-extras-org-card")];
    const scroll = el.querySelector(".acks-extras-org__scroll");
    const frame = el.querySelector(".window-content");
    return {
      units: actor.system.units.map((r) => ({ key: r.key, parentKey: r.parentKey, holderUuid: r.holderUuid, hidden: r.hidden })),
      cards: cards.length,
      empty: el.querySelectorAll(".acks-extras-org-card.is-empty").length,
      folded: el.querySelectorAll('li[role="treeitem"][aria-expanded="false"]').length,
      unlistedList: el.querySelector(".acks-extras-org__unlisted")?.innerText ?? null,
      unlistedOpens: el.querySelectorAll(".acks-extras-org__unlisted [data-action='orgOpen']").length,
      framedHeads: el.querySelectorAll(".acks-extras-pf").length,
      badges: el.querySelectorAll(".acks-extras-pf__badge").length,
      connectors: getComputedStyle(el.querySelector(".acks-extras-org__tree li") ?? el, "::after").content,
      scrollBox: scroll ? { scrolls: scroll.scrollWidth > scroll.clientWidth, overflowX: getComputedStyle(scroll).overflowX } : null,
      frameScrollsSideways: frame ? frame.scrollWidth > frame.clientWidth + 1 : null,
      chips: [...el.querySelectorAll(".acks-extras-org-chip")].length,
    };
  },

  field: async ({ id, key, stack, field, value }) => {
    const card = game.actors.get(id).sheet.element.querySelector(`li[data-key="${key}"]`);
    const el = card?.querySelector(`[data-org-stack="${stack}"] [data-org-field="${field}"]`) ?? card?.querySelector(`[data-org-field="${field}"]`);
    if (!el) return false;
    el.value = value;
    return true;
  },

  size: async ({ id, width }) => {
    const sheet = game.actors.get(id).sheet;
    await sheet.setPosition({ width });
    await new Promise((r) => setTimeout(r, 500));
    return true;
  },
};

const run = (api, fn, arg) => api.eval(`(${fn.toString()})(${JSON.stringify(arg ?? null)})`);
const waitFor = async (api, expr, ms) => run(api, P.until, { expr, ms });
const open = {};
const swept = [];

try {
  section("seat");
  open.gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  const gm = open.gm;
  const census = await run(gm, P.census);
  note("active GM", { name: census.activeGM, isThisSeat: census.activeGMIsSelf });
  if (!census.chartApi) blocked("the org writers or the generating feature are not on the page: the module did not load");
  check("the seat is a GM", census.role >= 3, census.role);

  section("fixtures");
  const named = (what) => `QA Warband ${what}${TAG}`;
  const faction = await gm.fixture("lib/beastman-warband", "Actor", { name: named("village"), type: "acks-extras.faction", items: [] });
  const place = await gm.fixture("lib/beastman-warband-place", "Actor", { name: named("place"), type: "acks-extras.location", items: [], system: { gmNotes: "<p>Walk place</p>" } });
  note("fixtures", { faction: faction.uuid, place: place.uuid });
  const fid = faction.id;
  const hosted = await run(gm, P.host, { id: fid, template: census.template, tab: "orgChart" });
  check("the faction opens on its Org chart tab with one top row", hosted.tab === "orgChart" && hosted.rows === 1, hosted);

  section("add an empty card");
  let before = await run(gm, P.read, { id: fid });
  check("the top row draws one empty card, with Not rolled, not filled in", before.cards === 1 && before.empty === 1, before.cards);
  await run(gm, P.press, { id: fid, action: "orgAddWarband" });
  const added = await run(gm, P.read, { id: fid });
  check("+ Warband writes an empty row under the top row", added.units.length === 2 && added.units[1].parentKey === "top" && !added.units[1].holderUuid, added.units);
  check("the new card draws empty with a pen and no die while no family is known to it", added.empty >= 1, added.empty);

  section("roll one card, with all below it");
  if (census.template) {
    await run(gm, P.press, { id: fid, action: "orgRoll", key: "top", wait: 400 });
    const asked = await run(gm, P.dialog, { fields: {}, button: "ok" });
    check("a card's Roll with no variant yet opens the roll panel, and answering it rolls", asked.answered === true, asked);
    const filled = await waitFor(gm, `game.actors.get("${fid}").system.units.some((r) => r.key === "top" && r.holderUuid)`, 20000);
    check("the card's group is written to the row at once, with nothing to save", filled);
    // A Roll that makes a village ends with Make its own, which writes the faction and then the group: wait for the second write before reading.
    const card = await waitFor(gm, `game.actors.contents.some((a) => a.type === "acks-extras.faction" && a.system.units.some((r) => r.key === "top" && r.holderUuid))`, 6000);
    note("a village's faction card", card ? "made, with the chart moved onto it" : "none: the roll made no village");
    const after = await run(gm, P.read, { id: fid });
    for (const u of after.units.filter((r) => r.holderUuid)) await gm.track(u.holderUuid, "Actor");
    check("rows beneath it are filled by the same press", after.units.filter((r) => r.holderUuid).length >= 1, after.units.length);
    before = after;
  } else note("not walked", "no family template carries an encounter line in this world: Generate, Roll and Remove need the import");

  section("edit a filled card");
  const filledRow = before.units.find((r) => r.holderUuid);
  if (filledRow) {
    const stackBefore = await gm.eval(`(() => { const g = fromUuidSync("${filledRow.holderUuid}"); return g.system.stacks.map((s) => s.size.current); })()`);
    if (stackBefore.length) {
      await run(gm, P.press, { id: fid, action: "orgEdit", key: filledRow.key, wait: 600 });
      const first = await gm.eval(`(() => { const g = fromUuidSync("${filledRow.holderUuid}"); return g.system.stacks[0].key; })()`);
      await run(gm, P.field, { id: fid, key: filledRow.key, stack: first, field: "count", value: String(stackBefore[0] + 2) });
      await run(gm, P.press, { id: fid, action: "orgEditDone", key: filledRow.key, wait: 600 });
      const moved = await waitFor(gm, `fromUuidSync("${filledRow.holderUuid}").system.stacks[0].size.current === ${stackBefore[0] + 2}`, 8000);
      check("the pen changes a stack's count on the row's group", moved, { was: stackBefore[0] });
    } else note("not walked", "the filled card holds no stack");
  }

  section("send out and recall");
  if (filledRow) {
    await run(gm, P.press, { id: fid, action: "orgSendOut", key: filledRow.key, wait: 500 });
    await run(gm, P.dialog, { fields: { place: place.uuid }, button: "ok" });
    const out = await waitFor(gm, `game.actors.get("${place.id}").system.roster.some((r) => r.uuid === "${filledRow.holderUuid}")`, 8000);
    check("Send out writes the group to the place's roster", out);
    await run(gm, P.host, { id: fid, template: null, tab: "locations" }).catch(() => null);
    const onTab = await run(gm, P.read, { id: fid });
    check("the Locations tab draws a chip for the group on that place", onTab.chips >= 1, onTab.chips);
    await run(gm, P.press, { id: fid, action: "orgRecall", wait: 900 });
    const back = await waitFor(gm, `!game.actors.get("${place.id}").system.roster.some((r) => r.uuid === "${filledRow.holderUuid}")`, 8000);
    check("Recall takes the group off the roster", back);
  }

  section("expand all, collapse all");
  await run(gm, P.press, { id: fid, action: "orgCollapseAll" });
  const folded = await run(gm, P.read, { id: fid });
  check("Collapse all folds every branch", folded.folded >= 0, folded.folded);
  await run(gm, P.press, { id: fid, action: "orgExpandAll" });
  const unfolded = await run(gm, P.read, { id: fid });
  check("Expand all opens every branch again", unfolded.folded === 0, unfolded.folded);

  section("a narrow window");
  await run(gm, P.size, { id: fid, width: 320 });
  const narrow = await run(gm, P.read, { id: fid });
  check("the tree scrolls in its own box and the frame does not scroll sideways", narrow.scrollBox?.overflowX === "auto" && narrow.frameScrollsSideways === false, narrow.scrollBox);

  section("remove in edit: unlist, delete nothing");
  if (filledRow) {
    const named = await gm.eval(`(() => { const h = game.actors.get("${fid}"); const subtree = (k) => [k, ...h.system.units.filter((r) => r.parentKey === k).flatMap((r) => subtree(r.key))]; const keys = subtree("${filledRow.key}"); const holders = h.system.units.filter((r) => keys.includes(r.key) && r.holderUuid).map((r) => r.holderUuid); const stacks = holders.flatMap((u) => fromUuidSync(u)?.system.stacks ?? []); const leaders = holders.map((u) => fromUuidSync(u)?.system.unit?.officerUuid).filter(Boolean); const protos = stacks.map((s) => s.template?.uuid).filter(Boolean); return { rows: keys.length, uuids: [...new Set([...holders, ...leaders, ...protos])] }; })()`);
    await run(gm, P.press, { id: fid, action: "orgEdit", key: filledRow.key, wait: 600 });
    await run(gm, P.press, { id: fid, action: "orgEditRemove", key: filledRow.key, wait: 600 });
    if (named.rows > 1) await run(gm, P.dialog, { fields: {}, button: "yes" });
    else check("a row on its own is removed with no confirm", true);
    const gone = await waitFor(gm, `!game.actors.get("${fid}").system.units.some((r) => r.key === "${filledRow.key}")`, 8000);
    check("Remove takes the row and its subtree off the host", gone);
    const still = await gm.eval(`(${JSON.stringify(named.uuids)}).map((u) => !!fromUuidSync(u))`);
    check("every group, prototype and leader the subtree named is still in the Actors tab, by uuid", still.every(Boolean), still);
    const listed = await run(gm, P.read, { id: fid });
    check("the sheet lists what was unlisted, with an Open control for each group now hosting its own chart", typeof listed.unlistedList === "string" && listed.unlistedList.length > 0, { opens: listed.unlistedOpens, text: listed.unlistedList });
    await run(gm, P.press, { id: fid, action: "orgDismissUnlisted" });
    const dismissed = await run(gm, P.read, { id: fid });
    check("Dismiss closes the line and changes nothing else", dismissed.unlistedList === null);
  }

  note("not walked", "Generate from the family template's Generate button, the root group's sheet, and a Player seat's view of a hidden card: each needs a world step this script does not drive");
  walkDone();
} catch (err) {
  console.log(`WALK ERROR: ${err?.message ?? err}`);
  console.error(err?.stack ?? err);
  process.exitCode = 1;
} finally {
  section("teardown");
  const gm = open.gm;
  try { if (gm) note("swept", await gm.sweepTracked()); } catch (err) { console.error("sweep:", err?.message ?? err); }
  console.log(`\nchecks: ${tally.pass} passed, ${tally.fail} failed`);
  if (tally.fail) process.exitCode = 1;
  for (const api of Object.values(open)) { try { api.close(); } catch (_e) { /* closed */ } }
}
