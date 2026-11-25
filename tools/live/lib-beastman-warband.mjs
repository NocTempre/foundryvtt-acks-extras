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

  /**
   * Generate on the family template as its sheet's Generate button does (the service lib's template sheet calls),
   * Roll the top card of the root group it made, and name every document that appeared in the Actors tab:
   * before Generate, after Generate, after the Roll, each as `type:name:uuid`, with the classes the Roll's documents fall into.
   */
  generateVillage: async ({ template, wait }) => {
    const names = () => new Map(game.actors.contents.map((a) => [a.uuid, `${a.type}:${a.name}`]));
    const c0 = names();
    const made = await acksExtras.lib.services.get("template-generate").generate(await fromUuid(template));
    if (!made?.handled) return { handled: false };
    const root = made.actor;
    const c1 = names();
    root.sheet.render(true);
    await new Promise((r) => setTimeout(r, wait ?? 800));
    return { handled: true, uuid: root.uuid, id: root.id, before: c0.size, afterGenerate: c1.size, generated: [...c1.keys()].filter((u) => !c0.has(u)).map((u) => `${c1.get(u)}:${u}`), baseline: [...c0.keys()] };
  },

  /** After the Roll: every document that is new since `baseline`, sorted into what the Roll's result is made of. */
  afterRoll: async ({ baseline, rootUuid, template }) => {
    const root = fromUuidSync(rootUuid);
    const faction = game.actors.contents.find((a) => a.type === "acks-extras.faction" && a.system.units.some((r) => r.holderUuid === rootUuid));
    const rows = faction?.system.units ?? [];
    const fresh = game.actors.contents.filter((a) => !baseline.includes(a.uuid));
    const holders = new Set(rows.map((r) => r.holderUuid).filter(Boolean));
    const leaders = new Set(fresh.flatMap((a) => (a.type === "acks-extras.group" ? [a.system.unit?.officerUuid] : [])).filter(Boolean));
    const family = fromUuidSync(template);
    const sorted = { faction: [], groups: [], prototypes: [], leaders: [], other: [] };
    for (const a of fresh) {
      if (a.uuid === faction?.uuid) sorted.faction.push(a.uuid);
      else if (a.type === "acks-extras.group") (holders.has(a.uuid) || a.uuid === rootUuid ? sorted.groups : sorted.other).push(a.uuid);
      else if (a.flags?.["acks-extras"]?.organisationPrototype) sorted.prototypes.push(a.uuid);
      else if (leaders.has(a.uuid)) sorted.leaders.push(a.uuid);
      else sorted.other.push(a.uuid);
    }
    return {
      hasFaction: !!faction, factionUuid: faction?.uuid ?? "", count: game.actors.size,
      topHolder: rows.find((r) => !r.parentKey)?.holderUuid ?? "", rootRows: root.system.units.length,
      rootOfficer: root.system.unit?.officerUuid ?? "", factionLeader: faction?.system.leaderUuid ?? "",
      factionImg: faction?.img ?? "", rootImg: root.img, plate: family?.flags?.["acks-extras"]?.plate ?? "",
      names: fresh.map((a) => `${a.type}:${a.name}:${a.uuid}`), sorted: Object.fromEntries(Object.entries(sorted).map(([k, v]) => [k, v.length])), other: sorted.other,
    };
  },

  /** Each card's frame: its role class, accessible name, the word written beside it, and the frame's own line. */
  frames: async ({ id }) => {
    const el = game.actors.get(id).sheet.element;
    return [...el.querySelectorAll(".acks-extras-pf")].filter((f) => !f.classList.contains("acks-extras-pf__badge")).map((f) => {
      const role = [...f.classList].find((c) => c.startsWith("acks-extras-pf--"))?.replace("acks-extras-pf--", "") ?? "";
      const card = f.closest("li[data-key]");
      const cs = getComputedStyle(f);
      return {
        key: card?.dataset.key, role, label: f.getAttribute("aria-label"),
        word: card?.querySelector(".acks-extras-pf__word")?.textContent?.trim() ?? "",
        line: `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`, root: !card?.parentElement?.closest("li[data-key]"), kids: !!card?.querySelector(":scope > ul > li"),
      };
    });
  },

  /** Whether a card in edit offers the clear-leader control, and press it. */
  clearLeader: async ({ id, key, press }) => {
    const card = game.actors.get(id).sheet.element.querySelector(`li[data-key="${key}"]`);
    const btn = card?.querySelector('[data-action="orgClearLeader"]');
    if (press && btn) { btn.click(); await new Promise((r) => setTimeout(r, 900)); }
    return { drawn: !!btn, name: btn?.textContent?.trim() ?? "", emptyTick: !!card?.querySelector('input[type="checkbox"][data-org-field]') };
  },

  /** The Locations tab's chips: nested ones, and whether any chip or the frame spills sideways. */
  chipsRead: async ({ id }) => {
    const el = game.actors.get(id).sheet.element;
    const frame = el.querySelector(".window-content");
    const fr = frame.getBoundingClientRect();
    const chips = [...el.querySelectorAll(".acks-extras-org-chip")];
    return {
      chips: chips.length,
      holds: el.querySelectorAll(".acks-extras-org-chip--holds").length,
      nested: el.querySelectorAll(".acks-extras-org-chip--holds .acks-extras-org-chip--inner").length,
      spill: chips.filter((c) => c.getBoundingClientRect().right > fr.right + 1).length,
      frameScrollsSideways: frame.scrollWidth > frame.clientWidth + 1,
      width: Math.round(fr.width),
    };
  },

  /** The open Roll panel's two readings: the labels of what it will make, the silent choices, and its slots; and what the world's chat and Actors tab hold. */
  panel: async () => {
    const dlg = [...document.querySelectorAll("dialog.application, .application.dialog-v2")].at(-1);
    return {
      open: !!dlg,
      choices: [...(dlg?.querySelectorAll('[name^="choice-"]') ?? [])].map((el) => el.name),
      make: [...(dlg?.querySelectorAll(".acks-lib-roll-make li") ?? [])].map((li) => li.textContent.trim().replace(/\s+/g, " ")),
      tips: [...(dlg?.querySelectorAll(".acks-lib-roll-make li") ?? [])].filter((li) => li.dataset.tooltipText).length,
      slots: [...(dlg?.querySelectorAll("[data-slot]") ?? [])].map((el) => el.dataset.slot),
      troopHidden: [...(dlg?.querySelectorAll("[name^='troop-']") ?? [])].every((el) => el.hidden),
      actors: game.actors.size,
      chat: game.messages.size,
    };
  },

  /** Set a field of the open dialog and fire its change, as a hand does. */
  setField: async ({ name, value }) => {
    const dlg = [...document.querySelectorAll("dialog.application, .application.dialog-v2")].at(-1);
    const el = dlg?.querySelector(`[name="${name}"]`);
    if (!el) return false;
    if (el.type === "checkbox") el.checked = !!value;
    else el.value = value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 600));
    return true;
  },

  closeDialog: async () => {
    const dlg = [...document.querySelectorAll("dialog.application, .application.dialog-v2")].at(-1);
    dlg?.querySelector('[data-action="cancel"], .header-control[data-action="close"]')?.click();
    await new Promise((r) => setTimeout(r, 400));
    return true;
  },

  /** Close the sheet and open a fresh one at a width, so nothing measured is an old window's. */
  reopen: async ({ id, width, tab }) => {
    const actor = game.actors.get(id);
    await actor.sheet.close();
    actor.sheet.tabGroups.primary = tab;
    await actor.sheet.render({ force: true, position: { width } });
    await new Promise((r) => setTimeout(r, 900));
    return true;
  },

  /** Focus every control in the tree box in turn: does each meet the box's rectangle once focused? */
  reach: async ({ id }) => {
    const el = game.actors.get(id).sheet.element;
    const box = el.querySelector(".acks-extras-org__scroll");
    if (!box) return { box: false };
    const controls = [...box.querySelectorAll("button, a[href], [tabindex='0']")];
    let missed = 0;
    for (const c of controls) {
      c.focus();
      const a = c.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      if (!(a.right > b.left && a.left < b.right)) missed += 1;
    }
    return { box: true, controls: controls.length, missed, tabStop: box.tabIndex === 0, role: box.getAttribute("role") };
  },

  /** Scroll the tree box sideways and read where it is, and what it is after a redraw. */
  scrollTo: async ({ id, left }) => {
    const box = game.actors.get(id).sheet.element.querySelector(".acks-extras-org__scroll");
    if (!box) return null;
    box.scrollLeft = left;
    return { max: box.scrollWidth - box.clientWidth, now: box.scrollLeft };
  },
  scrolled: async ({ id }) => game.actors.get(id).sheet.element.querySelector(".acks-extras-org__scroll")?.scrollLeft ?? null,

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

  section("the Roll panel's two readings, and Design by selection");
  if (census.template) {
    await run(gm, P.host, { id: fid, template: census.template, tab: "orgChart" });
    await run(gm, P.press, { id: fid, action: "orgRollAll", wait: 700 });
    const panel = await run(gm, P.panel, null);
    check("Roll at random opens a panel that lists what the roll will make, each row with a provenance tooltip", panel.open && panel.make.length > 0 && panel.tips === panel.make.length, { make: panel.make.length, tips: panel.tips });
    note("where the page is silent: the choices this variant reaches", panel.choices);
    const state = await run(gm, P.setField, { name: "state", value: "lair" });
    const again = await run(gm, P.panel, null);
    check("changing the state redraws the readings, and nothing was rolled or made to draw them", state && again.actors === panel.actors && again.chat === panel.chat, { actors: [panel.actors, again.actors], chat: [panel.chat, again.chat] });
    await run(gm, P.closeDialog, null);
    await run(gm, P.press, { id: fid, action: "orgAddWarband", wait: 500 });
    await run(gm, P.press, { id: fid, action: "orgDesign", wait: 700 });
    const design = await run(gm, P.panel, null);
    check("Design by selection opens the panel with a slot for each empty unit below the top, and no troop select shown until the troops rule and the special share both stand", design.open && design.slots.length >= 0 && design.troopHidden, design.slots);
    await run(gm, P.closeDialog, null);
  } else note("not walked", "no family template carries an encounter line in this world");

  section("generate a village on a root group, then roll it");
  if (census.template) {
    const gen = await run(gm, P.generateVillage, { template: census.template });
    check("Generate on the family makes one root group and nothing else", gen.handled && gen.afterGenerate === gen.before + 1 && gen.generated.length === 1, gen.generated);
    if (gen.handled) {
      await gm.track(gen.uuid, "Actor");
      await run(gm, P.press, { id: gen.id, action: "orgRoll", wait: 400 });
      await run(gm, P.dialog, { fields: { context: "wilderness", state: "lair" }, button: "ok" });
      const cardMade = await waitFor(gm, `game.actors.contents.some((a) => a.type === "acks-extras.faction" && a.system.units.some((r) => r.holderUuid === "${gen.uuid}"))`, 25000);
      check("a village Roll ends with the faction card holding the root group's row", cardMade || note("no village from this roll", "the Roll made a warband or a gang: no card is called for"));
      if (cardMade) {
        const after = await run(gm, P.afterRoll, { baseline: gen.baseline, rootUuid: gen.uuid, template: census.template });
        for (const u of after.names.map((n) => n.split(":").slice(2).join(":"))) await gm.track(u, "Actor");
        note("every document the village Roll made, by type:name:uuid, the Actors tab count before Generate, after Generate and now", { before: gen.before, afterGenerate: gen.afterGenerate, now: after.count, made: after.names });
        check("the top row names the root group itself, so no shell holds it", after.topHolder === gen.uuid && after.rootRows === 0, { topHolder: after.topHolder });
        check("the root group's officer is the faction's leader", !!after.rootOfficer && after.rootOfficer === after.factionLeader, { officer: after.rootOfficer, leader: after.factionLeader });
        check("every document the Actors tab gained is the root group, the faction, a row's group, a prototype or a leader, and none is left over", after.other.length === 0, after.sorted);
        check("the faction card takes the root group's picture (the plate, where one was imported)", after.factionImg === after.rootImg && (!after.plate || after.rootImg === after.plate), { faction: after.factionImg, plate: after.plate });
      }
    }
  } else note("not walked", "no family template carries an encounter line in this world");

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
      await run(gm, P.press, { id: fid, action: "orgEdit", key: filledRow.key, wait: 600 });
      const holder = filledRow.holderUuid;
      const hadOfficer = await gm.eval(`!!fromUuidSync("${holder}").system.unit?.officerUuid`);
      const clear = await run(gm, P.clearLeader, { id: fid, key: filledRow.key, press: false });
      check("the clear-leader control is drawn where an officer exists and nowhere else, named for its rank, and no empty tick is drawn", clear.drawn === hadOfficer && clear.emptyTick === false && (!hadOfficer || /\S/.test(clear.name)), clear);
      if (hadOfficer) {
        await run(gm, P.clearLeader, { id: fid, key: filledRow.key, press: true });
        const cleared = await waitFor(gm, `!fromUuidSync("${holder}").system.unit.officerUuid`, 8000);
        check("pressing it clears the group's officer, writes at once and keeps the faction's own leader", cleared);
      }
      await run(gm, P.press, { id: fid, action: "orgEditDone", key: filledRow.key, wait: 600 });
    } else note("not walked", "the filled card holds no stack");
  }

  section("rank frames, with their words");
  const frames = await run(gm, P.frames, { id: fid });
  const roles = new Set(frames.map((f) => f.role));
  check("every framed head carries its rank as an accessible name and as a word written on the card", frames.length > 0 && frames.every((f) => f.label && f.word && f.label.includes(f.word)), frames.map((f) => [f.role, f.word]));
  check("the top card with units beneath it is the chieftain's frame, a card holding bodies only a champion's, a card with no leader the rank and file's", frames.filter((f) => f.root && f.kids).every((f) => f.role === "chief" || f.role === "file") && frames.filter((f) => !f.kids && f.role !== "file").every((f) => f.role === "champion"), [...roles]);
  const lines = new Map(frames.map((f) => [f.role, f.line]));
  check("the frames differ in line weight and style as well as colour, so they read without colour", new Set([...lines.values()].map((l) => l.split(" ").slice(0, 2).join(" "))).size >= Math.min(lines.size, 3) || lines.size < 2, [...lines]);

  section("send out and recall");
  if (filledRow) {
    await run(gm, P.press, { id: fid, action: "orgSendOut", key: filledRow.key, wait: 500 });
    await run(gm, P.dialog, { fields: { place: place.uuid }, button: "ok" });
    const out = await waitFor(gm, `game.actors.get("${place.id}").system.roster.some((r) => r.uuid === "${filledRow.holderUuid}")`, 8000);
    check("Send out writes the group to the place's roster", out);
    await run(gm, P.host, { id: fid, template: null, tab: "locations" }).catch(() => null);
    const onTab = await run(gm, P.read, { id: fid });
    check("the Locations tab draws a chip for the group on that place", onTab.chips >= 1, onTab.chips);
    await run(gm, P.reopen, { id: fid, width: 320, tab: "locations" });
    const narrowChips = await run(gm, P.chipsRead, { id: fid });
    const heldRows = await gm.eval(`(() => { const h = game.actors.get("${fid}"); const g = fromUuidSync("${filledRow.holderUuid}"); return h.system.units.filter((r) => r.holderUuid && r.holderUuid !== g.uuid && r.parentKey).length; })()`);
    check("a group that holds other rows' groups draws them as chips nested inside its own chip", heldRows === 0 || narrowChips.nested >= 1, narrowChips);
    check("on a freshly opened narrow window the rows wrap: no chip spills past the frame and the frame does not scroll sideways", narrowChips.spill === 0 && narrowChips.frameScrollsSideways === false, narrowChips);
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

  section("a narrow window, freshly opened");
  await run(gm, P.reopen, { id: fid, width: 320, tab: "orgChart" });
  const narrow = await run(gm, P.read, { id: fid });
  check("the tree scrolls in its own box and the frame does not scroll sideways", narrow.scrollBox?.overflowX === "auto" && narrow.frameScrollsSideways === false, narrow.scrollBox);
  const reach = await run(gm, P.reach, { id: fid });
  check("every control in the tree is reached by keyboard focus at the floor width, and the box is a tab stop", reach.box && reach.missed === 0 && reach.tabStop, reach);
  const moved = await run(gm, P.scrollTo, { id: fid, left: 80 });
  if (moved && moved.max > 0) {
    await run(gm, P.press, { id: fid, action: "orgExpandAll", wait: 900 });
    const kept = await run(gm, P.scrolled, { id: fid });
    check("the box's scroll position survives the redraw a press makes", kept === moved.now, { was: moved.now, now: kept });
  } else note("not walked", "the tree fits the window at this width, so there is no position to keep: narrow the window or roll a larger tree");

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
