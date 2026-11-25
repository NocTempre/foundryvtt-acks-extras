/**
 * Live walk, the Org chart and Locations tabs: docs/lib/TESTING.md "The Org chart and
 * Locations tabs", marker `lib/beastman-warband`. Every step presses the control a
 * Judge presses on the faction sheet and reads what the press wrote: Generate on the
 * family template (the host opens on its Org chart tab), Add a card, Roll one card with
 * all below it, rank frames, Edit a filled card's count, Clear the leader, Send out and
 * Recall from the Locations tab, Expand all and Collapse all, Remove in edit with and
 * without its confirm, the tree scrolling in its own box in a narrow window. Machine
 * values arrive through ./_env.mjs. Every name and figure here is invented.
 *
 * The family template is the library's own, found by its cookbook id as
 * docs/monsters/TESTING.md `monsters/family-roles` describes (a library document takes no
 * marker, and the walk never writes it). The walk's first step prints the shape it needs
 * from that template and fails by name where no variant's leader reaches a unit word; with
 * none or two templates holding the family id it stops as blocked.
 *
 * Fixtures, kept and found again by marker (`api.fixture`): `lib/beastman-warband` (the
 * faction host) and `lib/beastman-warband-place` (a location carrying a Judge's note, so
 * the empty-place prune leaves it; its roster is emptied at the Locations step's start).
 * Disposable, by the run's own ledger: the host Generate made, and every document a Roll
 * made, tracked from the `created` of the Roll's own result (the page's
 * `rollOrganisation` is wrapped for the run and restored in the teardown).
 *
 * Active GM: the seated Judge whose user sorts first holds the group-combat and prune
 * sweeps; a lane that is not it passes FIXTURE_OWN. A press that writes two documents
 * redraws on the first write, so each step waits on the second document and the notice.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";
import { walkDone, blocked } from "./_walk.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const TAG = MACHINE.own ? ` ${MACHINE.own}` : "";
const FAMILY = "mm.familyBeastman";
const tally = { pass: 0, fail: 0 };
const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const check = (label, ok, detail) => {
  tally[ok ? "pass" : "fail"] += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/* Page side: each function is stringified and run in the GM seat's page, so none names a node-side value. */
const P = {
  census: async () => ({
    role: game.user.role,
    activeGM: game.users.activeGM?.name ?? null,
    activeGMIsSelf: !!game.users.activeGM?.isSelf,
    chartApi: !!globalThis.acksExtras?.lib?.org?.editRow && !!globalThis.acksExtras?.monsters?.rollOrganisation,
  }),

  /** The library's family template: the library documents whose cookbook id is the family, counted so a twin stops the walk. Read only. */
  template: async ({ family }) => {
    const CB = await import("/modules/acks-extras/scripts/importer/cookbook.mjs");
    const held = (await CB.importedDocs("Actor")).filter((d) => d.pack && d.getFlag("acks-extras", "cookbook")?.id === family);
    return { uuid: held.length === 1 ? held[0].uuid : null, twins: held.length };
  },

  /**
   * The shape the walk needs from the template, per variant option: whether it carries an encounter line, the unit words
   * its lines name, and each recipe part with role leader with its `when.units` and the unit words among them it reaches.
   */
  shape: async ({ uuid }) => {
    const R = await import("/modules/acks-extras/scripts/monsters/encounter-recipe.mjs");
    const doc = await fromUuid(uuid);
    const axes = doc?.system?.toObject?.().axes ?? doc?.system?.axes ?? [];
    const options = axes.find((a) => a.key === "variant")?.options ?? [];
    return options.map((o) => {
      const encounter = o.flags?.["acks-extras"]?.extras?.encounter ?? null;
      const recipe = encounter?.recipe ?? [];
      const words = [...new Set(R.sidesOf(recipe, encounter).flatMap((s) => [s.word, s.childWord]).filter(Boolean))];
      const leaders = recipe.filter((p) => p.role === "leader").map((p) => ({ part: p.key, units: [...(p.when?.units ?? [])], reaches: words.filter((w) => R.appliesTo(p, w)) }));
      return { variant: o.key, encounter: !!encounter, words, leaders, reaches: leaders.some((l) => l.reaches.length > 0) };
    });
  },

  /** Wrap the page's `rollOrganisation` so each resolved result, a refusal too, is kept for the walk to track from. */
  spy: async () => {
    const api = acksExtras.monsters;
    if (!api?.rollOrganisation) return { wrapped: false };
    const orig = api.rollOrganisation.__orig ?? api.rollOrganisation;
    globalThis.__warbandRolls = [];
    const wrapped = async (...args) => {
      let r;
      try {
        r = await orig(...args);
      } catch (err) {
        globalThis.__warbandRolls.push({ ok: false, threw: String(err?.message ?? err), created: [], groups: [], prototypes: [], leaders: [], faction: "", pot: "", reused: 0 });
        throw err;
      }
      globalThis.__warbandRolls.push({ ok: !!r?.ok, reason: r?.reason ?? "", created: [...(r?.created ?? [])], groups: [...(r?.made?.groups ?? [])], prototypes: [...(r?.made?.prototypes ?? [])], leaders: [...(r?.made?.leaders ?? [])], faction: r?.faction ?? "", pot: r?.pot ?? "", reused: (r?.reused ?? []).length });
      return r;
    };
    wrapped.__orig = orig;
    api.rollOrganisation = wrapped;
    return { wrapped: api.rollOrganisation === wrapped };
  },

  /** Take the results the wrapper has kept since the last take. */
  drain: async () => globalThis.__warbandRolls?.splice(0) ?? [],

  /** Put the page's `rollOrganisation` back and take what is left. */
  unspy: async () => {
    const api = acksExtras?.monsters;
    if (api?.rollOrganisation?.__orig) api.rollOrganisation = api.rollOrganisation.__orig;
    return { restored: !api?.rollOrganisation?.__orig, left: globalThis.__warbandRolls?.splice(0) ?? [] };
  },

  /** Two groups, the first standing on its own top row over the second; remove that top row through lib's writer and read what is left. */
  ownTop: async ({ hostUuid, subUuid }) => {
    const rowOf = (key, parentKey, holderUuid) => ({ key, parentKey, label: key, holderUuid, kind: "", notes: "", hidden: false, gen: {} });
    const host = fromUuidSync(hostUuid);
    const sub = fromUuidSync(subUuid);
    await host.update({ "system.units": [rowOf("t", "", host.uuid), rowOf("s", "t", sub.uuid)] });
    const out = await globalThis.acksExtras.lib.org.unlistRow(host, "t");
    return { ok: out.ok, lifted: out.lifted?.map((r) => r.key), hostRows: host.system.units.map((r) => `${r.key}<${r.parentKey}`), subRows: sub.system.units.length, nested: sub.system.unit?.parentGroupUuid ?? "", both: !!fromUuidSync(host.uuid) && !!fromUuidSync(sub.uuid) };
  },

  /** Wait for a condition in the page, polling, and answer whether it held. */
  until: async ({ expr, ms }) => {
    const end = Date.now() + (ms ?? 8000);
    while (Date.now() < end) {
      if (await (0, eval)(expr)) return true;
      await new Promise((r) => setTimeout(r, 150));
    }
    return false;
  },

  /** A faction host at one empty top row naming the family template, its sheet open on a tab. Rewrites `system.units`: only the walk's own start calls it. */
  host: async ({ id, template, tab }) => {
    const actor = game.actors.get(id);
    await actor.update({ "system.units": [{ key: "top", parentKey: "", label: "", holderUuid: "", kind: "", notes: "", hidden: false, gen: { template } }] });
    actor.sheet.tabGroups.primary = tab;
    await actor.sheet.render(true);
    await new Promise((r) => setTimeout(r, 600));
    return { rows: actor.system.units.length, tab: actor.sheet.tabGroups.primary };
  },

  /** Change a sheet's tab with nothing written, and say which tab it is on. */
  tab: async ({ id, tab }) => {
    const sheet = game.actors.get(id).sheet;
    if (!sheet.rendered) await sheet.render(true);
    sheet.changeTab(tab, "primary");
    await new Promise((r) => setTimeout(r, 500));
    return { tab: sheet.tabGroups.primary };
  },

  /** Every chart row with what its group says: the unit word, the variant rolled, the officer, the stacks and the group it stands inside. */
  rows: async ({ id }) => game.actors.get(id).system.units.map((r) => {
    const h = r.holderUuid ? fromUuidSync(r.holderUuid) : null;
    return { key: r.key, parentKey: r.parentKey, holderUuid: r.holderUuid, kind: r.kind, variant: r.gen?.variant ?? "", officer: h?.system?.unit?.officerUuid ?? "", stacks: h?.system?.stacks?.length ?? 0, parentGroup: h?.system?.unit?.parentGroupUuid ?? "" };
  }),

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

  /** Press a control on a Locations-tab chip's row, which is not a card. */
  pressChip: async ({ id, key, action, wait }) => {
    const row = game.actors.get(id).sheet.element.querySelector(`.acks-extras-org-chip__row[data-key="${key}"]`);
    const btn = row?.querySelector(`[data-action="${action}"]`);
    if (!btn) return { pressed: false, row: !!row };
    btn.click();
    await new Promise((r) => setTimeout(r, wait ?? 900));
    return { pressed: true, row: true };
  },

  /** How many dialogs are open. */
  dialogCount: async () => document.querySelectorAll("dialog.application, .application.dialog-v2").length,

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

  /** The client setting that asks before a multi-row Remove: read it, and set it where `set` is given. */
  setting: async ({ set }) => {
    if (set !== undefined) await game.settings.set("acks-extras", "confirmRemoveRows", set);
    return game.settings.get("acks-extras", "confirmRemoveRows");
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
      branches: el.querySelectorAll('li[role="treeitem"][aria-expanded]').length,
      unlistedList: el.querySelector(".acks-extras-org__unlisted")?.innerText ?? null,
      unlistedOpens: el.querySelectorAll(".acks-extras-org__unlisted [data-action='orgOpen']").length,
      scrollBox: scroll ? { scrolls: scroll.scrollWidth > scroll.clientWidth, overflowX: getComputedStyle(scroll).overflowX } : null,
      frameScrollsSideways: frame ? frame.scrollWidth > frame.clientWidth + 1 : null,
    };
  },

  field: async ({ id, key, stack, field, value }) => {
    const card = game.actors.get(id).sheet.element.querySelector(`li[data-key="${key}"]`);
    const el = card?.querySelector(`[data-org-stack="${stack}"] [data-org-field="${field}"]`) ?? card?.querySelector(`[data-org-field="${field}"]`);
    if (!el) return false;
    el.value = value;
    return true;
  },

  /** The first filled row whose group has stacks (a unit of units has none), with its first stack's key and bodies. */
  stacked: async ({ id }) => {
    for (const r of game.actors.get(id).system.units) {
      const g = r.holderUuid ? fromUuidSync(r.holderUuid) : null;
      const s = g?.system?.stacks?.[0];
      if (s) return { key: r.key, holder: g.uuid, stack: s.key, current: s.size.current };
    }
    return null;
  },

  /** A group's first stack as a card in edit would show it: the bodies now and the total the Roll threw. */
  stackNow: async ({ uuid }) => {
    const s = fromUuidSync(uuid)?.system?.stacks?.[0];
    return { initial: s?.size?.initial ?? null, rolled: s?.gen?.rolled ?? null };
  },

  /** Whether a card reads set by hand, and the tooltip on its count. */
  byHand: async ({ id, key }) => {
    const card = game.actors.get(id).sheet.element.querySelector(`li[data-key="${key}"] > div`);
    const count = card?.querySelector(".acks-extras-org-card__count");
    return { drawn: !!card?.classList.contains("is-hand") && !!count?.classList.contains("is-hand"), cite: !!card?.querySelector(".acks-extras-org-card__body .cite"), tip: count?.dataset.tooltipText ?? "" };
  },

  /** The notices on screen now, and each badge a card draws with the text its tooltip carries. */
  badges: async ({ id }) => ({
    badges: [...game.actors.get(id).sheet.element.querySelectorAll('.acks-extras-pf__badge[data-action="orgBadge"]')].map((b) => ({ tip: b.dataset.tooltipText ?? "", key: b.closest("li[data-key]")?.dataset.key ?? "" })),
  }),
  pressBadge: async ({ id }) => {
    const btn = game.actors.get(id).sheet.element.querySelector('.acks-extras-pf__badge[data-action="orgBadge"]');
    if (!btn) return { pressed: false, notices: [] };
    btn.click();
    await new Promise((r) => setTimeout(r, 600));
    return { pressed: true, notices: [...document.querySelectorAll("#notifications .notification")].map((n) => n.textContent.trim()) };
  },

  /**
   * Generate on the family template as its sheet's Generate button does (the service lib's template sheet calls),
   * and name the Actors tab's count before and after, with every document that appeared.
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
    return { handled: true, uuid: root.uuid, id: root.id, before: c0.size, afterGenerate: c1.size, generated: [...c1.keys()].filter((u) => !c0.has(u)).map((u) => `${c1.get(u)}:${u}`) };
  },

  /** After a village Roll on a root group: the faction card the Roll's own result names, and whether every group the Roll made is some row's holder. */
  afterRoll: async ({ rootUuid, factionUuid, groups, template }) => {
    const root = fromUuidSync(rootUuid);
    const faction = fromUuidSync(factionUuid);
    const rows = faction?.system.units ?? [];
    const holders = new Set(rows.map((r) => r.holderUuid).filter(Boolean));
    const family = await fromUuid(template);
    return {
      hasFaction: !!faction, topHolder: rows.find((r) => !r.parentKey)?.holderUuid ?? "", rootRows: root.system.units.length,
      rootOfficer: root.system.unit?.officerUuid ?? "", factionLeader: faction?.system.leaderUuid ?? "",
      factionImg: faction?.img ?? "", rootImg: root.img, plate: family?.flags?.["acks-extras"]?.plate ?? "",
      strays: groups.filter((u) => u !== rootUuid && !holders.has(u)),
    };
  },

  /** Each card's frame with the rank the chart's data gives it (officer, rows beneath, parent), the accessible name, the word beside it and the frame's own line. */
  frames: async ({ id }) => {
    const host = game.actors.get(id);
    const el = host.sheet.element;
    return [...el.querySelectorAll(".acks-extras-pf")].filter((f) => !f.classList.contains("acks-extras-pf__badge")).map((f) => {
      const role = [...f.classList].find((c) => c.startsWith("acks-extras-pf--"))?.replace("acks-extras-pf--", "") ?? "";
      const card = f.closest("li[data-key]");
      const row = host.system.units.find((r) => r.key === card?.dataset.key);
      const officer = (row?.holderUuid ? fromUuidSync(row.holderUuid) : null)?.system?.unit?.officerUuid ?? "";
      const kids = !!card?.querySelector(":scope > ul > li");
      const tier = Number.isInteger(row?.gen?.tier) ? row.gen.tier : kids ? 1 : 0;
      const cs = getComputedStyle(f);
      return {
        key: card?.dataset.key, role, label: f.getAttribute("aria-label"),
        expected: !officer ? "file" : tier <= 0 ? "champion" : row?.parentKey ? "sub" : "chief",
        word: card?.querySelector(":scope > div .acks-extras-pf__word")?.textContent?.trim() ?? "",
        line: `${cs.borderTopWidth} ${cs.borderTopStyle}`, root: !row?.parentKey,
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

  /** A faction's leader, as stored. */
  leaderOf: async ({ id }) => game.actors.get(id).system.leaderUuid ?? "",

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

  /** Whether a chip row for a chart row stands on the Locations tab, and offers Recall. */
  chipRow: async ({ id, key }) => {
    const row = game.actors.get(id).sheet.element.querySelector(`.acks-extras-org-chip__row[data-key="${key}"]`);
    return { row: !!row, recall: !!row?.querySelector('[data-action="orgRecall"]') };
  },

  /** Empty the kept place's roster, so the step starts from a known shape. */
  emptyPlace: async ({ id }) => {
    const place = game.actors.get(id);
    const was = place.system.roster.length;
    if (was) await place.update({ "system.roster": [] });
    return { was, now: place.system.roster.length };
  },

  /** What lib's recall answers for a row, with nothing written where it refuses. */
  recallAnswer: async ({ id, key }) => {
    const out = await globalThis.acksExtras.lib.org.recall(game.actors.get(id), key);
    return { ok: out.ok, reason: out.reason ?? "" };
  },

  /** The rows a Remove of a key takes (it and every row beneath), and the uuids of every group, leader and prototype they name. */
  subtree: async ({ id, key }) => {
    const h = game.actors.get(id);
    const under = (k) => [k, ...h.system.units.filter((r) => r.parentKey === k).flatMap((r) => under(r.key))];
    const keys = under(key);
    const holders = h.system.units.filter((r) => keys.includes(r.key) && r.holderUuid).map((r) => r.holderUuid);
    const stacks = holders.flatMap((u) => fromUuidSync(u)?.system.stacks ?? []);
    const leaders = holders.map((u) => fromUuidSync(u)?.system.unit?.officerUuid).filter(Boolean);
    const protos = stacks.map((s) => s.template?.uuid).filter(Boolean);
    return { rows: keys.length, uuids: [...new Set([...holders, ...leaders, ...protos])] };
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
      slotReads: [...(dlg?.querySelectorAll("[data-slot]") ?? [])].map((el) => ({ key: el.dataset.slot, kind: el.dataset.kind, unsure: el.dataset.unsure === "true", shares: [...(el.querySelector("select[name^='share-']")?.options ?? [])].map((o) => o.value).filter(Boolean) })),
      troopHidden: [...(dlg?.querySelectorAll("[name^='troop-']") ?? [])].every((el) => el.hidden),
      actors: game.actors.size,
      chat: game.messages.size,
    };
  },

  /** Tick or clear a checkbox of the open dialog and fire its change, as a hand does. */
  setRule: async ({ name, checked }) => {
    const dlg = [...document.querySelectorAll("dialog.application, .application.dialog-v2")].at(-1);
    const el = dlg?.querySelector(`[name="${name}"]`);
    if (!el) return false;
    el.checked = checked;
    el.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));
    return true;
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
};

const run = (api, fn, arg) => api.eval(`(${fn.toString()})(${JSON.stringify(arg ?? null)})`);
const waitFor = async (api, expr, ms) => run(api, P.until, { expr, ms });
const open = {};
let confirmWas = null;

/** Wait for the page's wrapped Roll to resolve, then track every document its own result names, the moment it is read. */
async function rollResult(gm, ms) {
  await waitFor(gm, "(globalThis.__warbandRolls?.length ?? 0) > 0", ms);
  const rolls = await run(gm, P.drain, null);
  for (const r of rolls) for (const uuid of r.created) gm.track(uuid);
  return rolls;
}

try {
  section("seat");
  open.gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  const gm = open.gm;
  // The importer's api is assigned only after its cookbook loads, which can be after ready.
  for (let n = 0; n < 60 && !(await gm.eval("!!globalThis.acksExtras?.importer?.connectBookUrl")); n++) await sleep(1000);
  const census = await run(gm, P.census);
  note("active GM", { name: census.activeGM, isThisSeat: census.activeGMIsSelf });
  if (!census.chartApi) blocked("the org writers or the generating feature are not on the page: the module did not load");
  check("the seat is a GM", census.role >= 3, census.role);

  section("the library's family template, and the shape this walk needs from it");
  const tpl = await run(gm, P.template, { family: FAMILY });
  note("template", { twins: tpl.twins, uuid: tpl.uuid });
  check("the library holds exactly one template of the family", tpl.twins === 1 && !!tpl.uuid, { twins: tpl.twins });
  if (tpl.twins !== 1 || !tpl.uuid) blocked("the library does not hold exactly one family template; the walk reads it and never builds a twin, so the Roll and Generate steps stop here (import the family through the entry picker first)");
  const shape = await run(gm, P.shape, { uuid: tpl.uuid });
  note("each variant: its leader parts, their when.units and the unit words they reach", shape.map((v) => ({ variant: v.variant, encounter: v.encounter, words: v.words, leaders: v.leaders })));
  check("the template's recipe names a leader that reaches a unit word", shape.some((v) => v.reaches), shape.map((v) => ({ variant: v.variant, reaches: v.reaches })));
  if (!shape.some((v) => v.encounter)) blocked("no variant of the library's family template carries an encounter line, so no Roll can be made from it");

  section("tracking: every document a Roll makes is read from the Roll's own result");
  const spied = await run(gm, P.spy, null);
  if (!spied.wrapped) blocked("the page's rollOrganisation could not be wrapped, so what a Roll makes could not be tracked and swept");
  check("the page's rollOrganisation is wrapped for the run", spied.wrapped);

  section("fixtures");
  const named = (what) => `QA Warband ${what}${TAG}`;
  const faction = await gm.fixture("lib/beastman-warband", "Actor", { name: named("village"), type: "acks-extras.faction", items: [] });
  const place = await gm.fixture("lib/beastman-warband-place", "Actor", { name: named("place"), type: "acks-extras.location", items: [], system: { gmNotes: "<p>Walk place</p>" } });
  note("fixtures", { faction: faction.uuid, place: place.uuid });
  const fid = faction.id;
  const hosted = await run(gm, P.host, { id: fid, template: tpl.uuid, tab: "orgChart" });
  check("the faction opens on its Org chart tab with one top row", hosted.tab === "orgChart" && hosted.rows === 1, hosted);

  section("add an empty card");
  const before = await run(gm, P.read, { id: fid });
  check("the top row draws one empty card, with Not rolled, not filled in", before.cards === 1 && before.empty === 1, before.cards);
  await run(gm, P.press, { id: fid, action: "orgAddWarband" });
  const added = await run(gm, P.read, { id: fid });
  check("+ Warband writes an empty row under the top row", added.units.length === 2 && added.units[1].parentKey === "top" && !added.units[1].holderUuid, added.units);
  check("the new card draws empty with a pen and no die while no family is known to it", added.empty >= 1, added.empty);

  section("the Roll panel's two readings, and Design by selection");
  await run(gm, P.press, { id: fid, action: "orgRollAll", wait: 700 });
  const panel = await run(gm, P.panel, null);
  check("Roll at random opens a panel that lists what the roll will make, each row with a provenance tooltip", panel.open && panel.make.length > 0 && panel.tips === panel.make.length, { make: panel.make.length, tips: panel.tips });
  note("where the page is silent: the choices this variant reaches", panel.choices);
  const wander = await run(gm, P.setField, { name: "state", value: "wandering" });
  const wandering = await run(gm, P.panel, null);
  const state = await run(gm, P.setField, { name: "state", value: "lair" });
  const again = await run(gm, P.panel, null);
  note("This roll will make under Wandering and under Lair, for the walker to compare against the recipe: a part that applies only to the lair's units is absent from the first", { wandering: wandering.make, lair: again.make, waited: wander });
  check("changing the state redraws the readings, and nothing was rolled or made to draw them", state && again.actors === panel.actors && again.chat === panel.chat, { actors: [panel.actors, again.actors], chat: [panel.chat, again.chat] });
  await run(gm, P.closeDialog, null);
  await run(gm, P.press, { id: fid, action: "orgDesign", wait: 700 });
  const design = await run(gm, P.panel, null);
  check("Design by selection opens the panel with a slot for each empty unit below the top, and no troop select shown until the troops rule and the special share both stand", design.open && design.slots.length >= 1 && design.troopHidden, design.slots);
  note("each slot's unit word (kind), whether it is offered, and the shares its select holds, with the rules as they stand", design.slotReads);
  check("a slot that is offered carries the unit word of its level, so its die rolls that unit and not the whole line", design.slotReads.length >= 1 && design.slotReads.every((s) => s.unsure || !!s.kind), design.slotReads);
  await run(gm, P.setRule, { name: "rules-troops", checked: false });
  const without = await run(gm, P.panel, null);
  await run(gm, P.setRule, { name: "rules-troops", checked: true });
  const withRule = await run(gm, P.panel, null);
  check("the share options follow the Special troops rule: they differ between the two reads where the shares were imported, and a troop select stays hidden while no slot holds the special share", withRule.troopHidden && without.slotReads.length === withRule.slotReads.length && JSON.stringify(without.slotReads.map((s) => s.shares)) !== JSON.stringify(withRule.slotReads.map((s) => s.shares)), { off: without.slotReads.map((s) => s.shares), on: withRule.slotReads.map((s) => s.shares) });
  await run(gm, P.closeDialog, null);

  section("roll one card, with all below it");
  await run(gm, P.press, { id: fid, action: "orgRoll", key: "top", wait: 400 });
  const asked = await run(gm, P.dialog, { fields: { context: "wilderness", state: "lair" }, button: "ok" });
  check("a card's Roll with no variant yet opens the roll panel, and answering it rolls", asked.answered === true, asked);
  const rolled1 = await rollResult(gm, 25000);
  check("the Roll resolved, and its result names what it made", rolled1.length >= 1 && rolled1.every((r) => r.ok) && rolled1.some((r) => r.created.length > 0), rolled1.map((r) => ({ ok: r.ok, reason: r.reason, made: r.created.length, groups: r.groups.length, prototypes: r.prototypes.length, leaders: r.leaders.length })));
  const filled = await waitFor(gm, `game.actors.get("${fid}").system.units.some((r) => r.key === "top" && r.holderUuid)`, 20000);
  check("the card's group is written to the row at once, with nothing to save", filled);
  check("a Roll on a host already on a faction makes no second faction card", rolled1.every((r) => !r.faction), rolled1.map((r) => r.faction));
  const rows1 = await run(gm, P.rows, { id: fid });
  check("rows beneath it are filled by the same press", rows1.filter((r) => r.holderUuid).length >= 2, rows1.length);
  const topRow = rows1.find((r) => r.key === "top");
  const variant = topRow?.variant ?? "";
  const rolledShape = shape.find((v) => v.variant === variant);
  check("the Roll records the variant it rolled on the top row, and the shape read from the template has that variant", !!variant && !!rolledShape, { variant, known: shape.map((v) => v.variant) });
  note("the variant the Roll recorded, and whether its recipe names a leader that reaches a unit word", { variant, reaches: rolledShape?.reaches ?? null });

  section("generate a village on a root group, then roll it");
  const gen = await run(gm, P.generateVillage, { template: tpl.uuid });
  check("Generate on the family makes one root group and nothing else", gen.handled && gen.afterGenerate === gen.before + 1 && gen.generated.length === 1, gen.generated);
  if (gen.handled) {
    gm.track(gen.uuid);
    await run(gm, P.press, { id: gen.id, action: "orgRoll", wait: 400 });
    await run(gm, P.dialog, { fields: { context: "wilderness", state: "lair" }, button: "ok" });
    const rolled2 = await rollResult(gm, 30000);
    const village = rolled2.find((r) => r.ok && r.faction);
    check("the village Roll resolved", rolled2.some((r) => r.ok), rolled2.map((r) => ({ ok: r.ok, reason: r.reason })));
    if (village) {
      check("a village Roll ends with the faction card holding the root group's row", true, village.faction);
      const after = await run(gm, P.afterRoll, { rootUuid: gen.uuid, factionUuid: village.faction, groups: village.groups, template: tpl.uuid });
      note("what the village Roll made, by count, and the Actors tab count before Generate and after it", { before: gen.before, afterGenerate: gen.afterGenerate, groups: village.groups.length, prototypes: village.prototypes.length, leaders: village.leaders.length, created: village.created.length });
      check("the top row names the root group itself, so no shell holds it", after.topHolder === gen.uuid && after.rootRows === 0, { topHolder: after.topHolder });
      check("the root group's officer is the faction's leader", !!after.rootOfficer && after.rootOfficer === after.factionLeader, { officer: after.rootOfficer, leader: after.factionLeader });
      check("every group the Roll made is some row's holder, and none is left over", village.groups.length >= 1 && after.strays.length === 0, after.strays);
      check("the faction card takes the root group's picture (the plate, where one was imported)", after.factionImg === after.rootImg && (!after.plate || after.rootImg === after.plate), { faction: after.factionImg, plate: after.plate });
    } else note("no village from this roll", "the Roll made a warband or a gang: no card is called for");
  }

  section("rank frames, with their words, and the leader");
  const rows2 = await run(gm, P.rows, { id: fid });
  const officers = rows2.filter((r) => r.officer);
  if (rolledShape?.reaches) check("the Roll of the library template made a leader, since the rolled variant's recipe names one that reaches a unit word", officers.length >= 1, { rows: rows2.length, officers: officers.length });
  else note("not walked", "the rolled variant's recipe names no leader that reaches a unit word, so no leader is called for");
  const frames = await run(gm, P.frames, { id: fid });
  check("every framed head carries its rank as an accessible name and as a word written on the card", frames.length > 0 && frames.every((f) => f.label && f.word && f.label.includes(f.word)), frames.map((f) => [f.role, f.word]));
  check("each card's frame is the rank its group gives it: no leader the rank and file's, a unit of bodies only a champion's, a unit of units the chieftain's at the top and a sub-chieftain's below", frames.length > 0 && frames.every((f) => f.role === f.expected), frames.map((f) => [f.key, f.role, f.expected]));
  const topOfficer = !!rows2.find((r) => !r.parentKey)?.officer;
  if (topOfficer) check("the top card with a leader is the chieftain's frame", frames.find((f) => f.root)?.role === "chief", frames.find((f) => f.root)?.role);
  const championRows = rows2.filter((r) => r.officer && r.holderUuid && !rows2.some((c) => c.parentKey === r.key));
  if (championRows.length) check("a unit of bodies with an officer is framed as a champion", championRows.every((r) => frames.find((f) => f.key === r.key)?.role === "champion"), championRows.map((r) => frames.find((f) => f.key === r.key)?.role));
  else note("not walked", "no unit of bodies carries an officer in this roll, so no champion frame is called for");
  const lines = new Map(frames.map((f) => [f.role, f.line]));
  if (lines.size >= 2) check("the frames differ in line weight and style as well as colour, so they read without colour", new Set([...lines.values()]).size >= Math.min(lines.size, 3), [...lines]);
  else note("not walked", "the chart draws one rank only, so there are no two frames to tell apart");

  section("edit a filled card");
  const stacked = await run(gm, P.stacked, { id: fid });
  if (stacked) {
    await run(gm, P.press, { id: fid, action: "orgEdit", key: stacked.key, wait: 600 });
    await run(gm, P.field, { id: fid, key: stacked.key, stack: stacked.stack, field: "count", value: String(stacked.current + 2) });
    await run(gm, P.press, { id: fid, action: "orgEditDone", key: stacked.key, wait: 600 });
    const moved = await waitFor(gm, `fromUuidSync("${stacked.holder}").system.stacks[0].size.current === ${stacked.current + 2}`, 8000);
    check("the pen changes a stack's count on the row's group", moved, { was: stacked.current });
    const now = await run(gm, P.stackNow, { uuid: stacked.holder });
    if (typeof now.rolled === "number") {
      const hand = await run(gm, P.byHand, { id: fid, key: stacked.key });
      check("the card reads set by hand, with a tooltip naming the total the Roll threw and the bodies now", hand.drawn && hand.cite && hand.tip.includes(String(now.rolled)) && hand.tip.includes(String(now.initial)), { drawn: hand.drawn, cite: hand.cite, rolled: now.rolled, now: now.initial });
    } else note("not walked", "the stack records no total the Roll threw, so a count set by hand has nothing to differ from");
    const badges = await run(gm, P.badges, { id: fid });
    if (badges.badges.length) {
      const pressed = await run(gm, P.pressBadge, { id: fid });
      check("a badge's press puts its tooltip text in a notice", pressed.pressed && pressed.notices.some((n) => n.includes(badges.badges[0].tip.trim().slice(0, 40))), { badges: badges.badges.length, notices: pressed.notices.length });
    } else note("not walked", "no card draws a badge on this roll");
  } else note("not walked", "no filled card holds a stack");

  section("clear the leader");
  const lead = (await run(gm, P.rows, { id: fid })).filter((r) => r.officer);
  if (lead.length) {
    const clearOn = async (row) => {
      const holderOfficer = row.officer;
      const hadLeader = await run(gm, P.leaderOf, { id: fid });
      await run(gm, P.press, { id: fid, action: "orgEdit", key: row.key, wait: 600 });
      const clear = await run(gm, P.clearLeader, { id: fid, key: row.key, press: false });
      check("the clear-leader control (the officer line's Clear) is drawn where an officer exists, and no empty tick is drawn", clear.drawn && clear.emptyTick === false && /\S/.test(clear.name), clear);
      await run(gm, P.clearLeader, { id: fid, key: row.key, press: true });
      const cleared = await waitFor(gm, `!fromUuidSync("${row.holderUuid}").system.unit.officerUuid`, 8000);
      check("pressing it clears the group's officer and writes at once", cleared);
      const leaderNow = await run(gm, P.leaderOf, { id: fid });
      check("the faction's leader is cleared with it where the officer was that leader, and is left as it was for any other card", hadLeader === holderOfficer ? leaderNow === "" : leaderNow === hadLeader, { wasLeader: hadLeader === holderOfficer, was: hadLeader, now: leaderNow });
      await run(gm, P.press, { id: fid, action: "orgEditDone", key: row.key, wait: 600 });
    };
    const lower = lead.find((r) => r.parentKey);
    if (lower) await clearOn(lower);
    else note("not walked", "no card below the top carries an officer, so the leader left as it was is not shown");
    const top = lead.find((r) => !r.parentKey);
    if (top) {
      const leaderNow = await run(gm, P.leaderOf, { id: fid });
      check("the top card's officer is the faction's leader before it is cleared", leaderNow === top.officer, { leader: leaderNow, officer: top.officer });
      await clearOn(top);
    } else note("not walked", "the top card carries no officer, so the faction's leader is not cleared with one");
  } else note("not walked", "no card's group names an officer after this roll");

  section("send out and recall, on the Locations tab");
  const rows3 = await run(gm, P.rows, { id: fid });
  const top = rows3.find((r) => !r.parentKey && r.holderUuid);
  const parentHolderOf = (r) => rows3.find((p) => p.key === r.parentKey)?.holderUuid ?? "";
  const gang = rows3.find((r) => r.parentKey && r.holderUuid && r.parentGroup && r.parentGroup === parentHolderOf(r));
  check("the chart stands in the shape this step needs: a top row with a group, and a row below it whose group stands inside its parent row's group", !!top && !!gang, { top: !!top, gang: !!gang });
  if (top && gang) {
    const parentOf = new Map(rows3.filter((r) => r.holderUuid).map((r) => [r.holderUuid, r.parentGroup]));
    const within = (uuid, ancestor) => { let g = parentOf.get(uuid); for (let n = 0; g && n < 50; n++, g = parentOf.get(g)) if (g === ancestor) return true; return false; };
    const held = rows3.filter((r) => r.holderUuid && r.holderUuid !== top.holderUuid && within(r.holderUuid, top.holderUuid)).length;
    const wiped = await run(gm, P.emptyPlace, { id: place.id });
    check("the kept place starts with an empty roster", wiped.now === 0, wiped);
    await run(gm, P.tab, { id: fid, tab: "orgChart" });
    await run(gm, P.press, { id: fid, action: "orgSendOut", key: top.key, wait: 500 });
    await run(gm, P.dialog, { fields: { place: place.uuid }, button: "ok" });
    const out = await waitFor(gm, `game.actors.get("${place.id}").system.roster.some((r) => r.uuid === "${top.holderUuid}")`, 8000);
    check("Send out writes the top row's group to the place's roster", out);
    const rowsBeforeTab = JSON.stringify(await run(gm, P.rows, { id: fid }));
    const tabbed = await run(gm, P.tab, { id: fid, tab: "locations" });
    const rowsAfterTab = JSON.stringify(await run(gm, P.rows, { id: fid }));
    check("the sheet is on its Locations tab, and changing tab wrote nothing to the chart", tabbed.tab === "locations" && rowsAfterTab === rowsBeforeTab, tabbed);
    const onTab = await run(gm, P.chipsRead, { id: fid });
    check("the Locations tab draws a chip for the group on that place", onTab.chips >= 1, onTab.chips);
    check("a group that holds other rows' groups draws one chip with a chip inside it for each of them", held >= 1 && onTab.holds >= 1 && onTab.nested === held, { held, holds: onTab.holds, nested: onTab.nested });
    const refused = await run(gm, P.recallAnswer, { id: fid, key: top.key });
    check("Recall on the top row is refused by design, naming the top row", refused.ok === false && refused.reason === "topRow", refused);
    await run(gm, P.reopen, { id: fid, width: 320, tab: "locations" });
    const narrow = await run(gm, P.chipsRead, { id: fid });
    check("on a freshly opened narrow window the rows wrap: no chip spills past the frame and the frame does not scroll sideways", narrow.chips >= 1 && narrow.spill === 0 && narrow.frameScrollsSideways === false, narrow);

    await run(gm, P.tab, { id: fid, tab: "orgChart" });
    await run(gm, P.press, { id: fid, action: "orgSendOut", key: gang.key, wait: 500 });
    await run(gm, P.dialog, { fields: { place: place.uuid }, button: "ok" });
    const gangOut = await waitFor(gm, `game.actors.get("${place.id}").system.roster.some((r) => r.uuid === "${gang.holderUuid}") && !fromUuidSync("${gang.holderUuid}").system.unit.parentGroupUuid`, 8000);
    check("Send out on a row below the top writes its group to the roster and takes it out of the group it stood inside", gangOut);
    await run(gm, P.tab, { id: fid, tab: "locations" });
    const chip = await run(gm, P.chipRow, { id: fid, key: gang.key });
    check("the Locations tab draws that row on a chip of its own, with Recall", chip.row && chip.recall, chip);
    const recalled = await run(gm, P.pressChip, { id: fid, key: gang.key, action: "orgRecall", wait: 900 });
    check("Recall is pressed on that chip", recalled.pressed, recalled);
    const back = await waitFor(gm, `!game.actors.get("${place.id}").system.roster.some((r) => r.uuid === "${gang.holderUuid}") && fromUuidSync("${gang.holderUuid}").system.unit.parentGroupUuid === "${gang.parentGroup}"`, 8000);
    check("Recall takes the group off the roster and puts it back under the group its parent row holds", back);
    const tidy = await run(gm, P.emptyPlace, { id: place.id });
    note("the kept place's roster, emptied again (the top row cannot be recalled)", tidy);
  }

  section("expand all, collapse all");
  await run(gm, P.tab, { id: fid, tab: "orgChart" });
  const whole = await run(gm, P.read, { id: fid });
  await run(gm, P.press, { id: fid, action: "orgCollapseAll" });
  const folded = await run(gm, P.read, { id: fid });
  check("Collapse all folds every branch it draws", whole.branches >= 1 && folded.folded >= 1 && folded.folded === folded.branches, { before: whole.branches, folded: folded.folded, drawn: folded.branches });
  await run(gm, P.press, { id: fid, action: "orgExpandAll" });
  const unfolded = await run(gm, P.read, { id: fid });
  check("Expand all opens every branch again", unfolded.folded === 0 && unfolded.branches === whole.branches, { folded: unfolded.folded, branches: unfolded.branches, was: whole.branches });

  section("a narrow window, freshly opened");
  await run(gm, P.reopen, { id: fid, width: 320, tab: "orgChart" });
  const narrowTree = await run(gm, P.read, { id: fid });
  check("the tree scrolls in its own box and the frame does not scroll sideways", narrowTree.scrollBox?.overflowX === "auto" && narrowTree.frameScrollsSideways === false, narrowTree.scrollBox);
  const reach = await run(gm, P.reach, { id: fid });
  check("every control in the tree is reached by keyboard focus at the floor width, and the box is a tab stop", reach.box && reach.controls > 0 && reach.missed === 0 && reach.tabStop, reach);
  const movedBox = await run(gm, P.scrollTo, { id: fid, left: 80 });
  if (movedBox && movedBox.max > 0) {
    await run(gm, P.press, { id: fid, action: "orgExpandAll", wait: 900 });
    const kept = await run(gm, P.scrolled, { id: fid });
    check("the box's scroll position survives the redraw a press makes", kept === movedBox.now, { was: movedBox.now, now: kept });
  } else note("not walked", "the tree fits the window at this width, so there is no position to keep: narrow the window or roll a larger tree");

  section("remove in edit: the one row leaves, the rows beneath it move up, delete nothing");
  confirmWas = await run(gm, P.setting, {});
  await run(gm, P.setting, { set: true });
  const removeStep = async (label, key, { ask, many }) => {
    const named = await run(gm, P.subtree, { id: fid, key });
    check(`${label}: the row stands in the shape the step needs`, many ? named.rows > 1 : named.rows === 1, { rows: named.rows });
    await run(gm, P.press, { id: fid, action: "orgEdit", key, wait: 600 });
    const rowsBefore = await run(gm, P.rows, { id: fid });
    const parentOf = rowsBefore.find((r) => r.key === key)?.parentKey ?? "";
    const movers = rowsBefore.filter((r) => r.parentKey === key).map((r) => r.key);
    const dialogsBefore = await run(gm, P.dialogCount, null);
    await run(gm, P.press, { id: fid, action: "orgRemove", key, wait: 900 });
    const dialogsAfter = await run(gm, P.dialogCount, null);
    if (movers.length && ask) {
      check(`${label}: a row with rows beneath it asks first`, dialogsAfter === dialogsBefore + 1, { before: dialogsBefore, after: dialogsAfter });
      await run(gm, P.dialog, { fields: {}, button: "yes" });
    } else check(`${label}: it asks nothing`, dialogsAfter === dialogsBefore, { before: dialogsBefore, after: dialogsAfter });
    const gone = await waitFor(gm, `!game.actors.get("${fid}").system.units.some((r) => r.key === "${key}")`, 8000);
    check(`${label}: Remove takes that one row off the host`, gone, { rows: named.rows });
    const rowsAfter = await run(gm, P.rows, { id: fid });
    check(`${label}: the rows that stood beneath it are all still on the host, the direct ones moved up to its parent, and no other row changed parent`, rowsAfter.length === rowsBefore.length - 1 && movers.every((k) => rowsAfter.find((r) => r.key === k)?.parentKey === parentOf) && rowsBefore.filter((r) => r.key !== key && !movers.includes(r.key)).every((r) => rowsAfter.find((x) => x.key === r.key)?.parentKey === r.parentKey), { movers, parentOf });
    const still = await gm.eval(`(${JSON.stringify(named.uuids)}).map((u) => !!fromUuidSync(u))`);
    check(`${label}: every group, prototype and leader the subtree named is still in the Actors tab, by uuid`, still.length >= 1 && still.every(Boolean), still);
    const listed = await run(gm, P.read, { id: fid });
    check(`${label}: the sheet names the rows that moved up and where, or says nothing where none moved`, movers.length ? typeof listed.unlistedList === "string" && listed.unlistedList.length > 0 : listed.unlistedList === null, { text: listed.unlistedList });
    if (listed.unlistedList !== null) await run(gm, P.press, { id: fid, action: "orgDismissUnlisted" });
    const dismissed = await run(gm, P.read, { id: fid });
    check(`${label}: Dismiss closes the line and changes nothing else`, dismissed.unlistedList === null);
  };
  const rows4 = await run(gm, P.rows, { id: fid });
  const branchRow = rows4.find((r) => r.parentKey && r.holderUuid && rows4.some((c) => c.parentKey === r.key));
  if (branchRow) await removeStep("a row with rows beneath it, the setting on", branchRow.key, { ask: true, many: true });
  else note("not walked", "no filled row below the top has rows beneath it in this roll, so the confirm of a multi-row Remove below the top is not shown");
  const rows5 = await run(gm, P.rows, { id: fid });
  const leafRow = rows5.find((r) => r.parentKey && r.holderUuid && !rows5.some((c) => c.parentKey === r.key));
  if (leafRow) await removeStep("a row on its own, the setting on", leafRow.key, { ask: true, many: false });
  else note("not walked", "no filled row on its own is left below the top");
  await run(gm, P.setting, { set: false });
  const rows6 = await run(gm, P.rows, { id: fid });
  if (rows6.some((r) => r.key === "top" && r.holderUuid) && rows6.length > 1) await removeStep("the top row with rows beneath it, the setting off", "top", { ask: false, many: true });
  else note("not walked", "the top row is gone or stands alone, so the multi-row Remove with the setting off is not shown");
  await run(gm, P.setting, { set: confirmWas });
  confirmWas = null;

  section("remove on a group's own top row: its rows move to the top and no group is un-nested");
  const ownHost = await gm.create("Actor", { name: named("own top"), type: "acks-extras.group", items: [] });
  const ownSub = await gm.create("Actor", { name: named("own sub"), type: "acks-extras.group", items: [] });
  const own = await run(gm, P.ownTop, { hostUuid: ownHost.uuid, subUuid: ownSub.uuid });
  check("org.unlistRow on a group's own top row (the API the Remove press ends in) leaves the group hosting the row beneath it at the top, writes no other group, and both groups stay in the Actors tab", own.ok && own.hostRows.join() === "s<" && own.lifted.join() === "s" && own.subRows === 0 && own.both, own);

  note("not walked", "the family template sheet's own Generate button (Generate is driven through the service the button calls), the root group's sheet, a Player seat's view of a hidden card, and the Judges' chat card a Roll whispers (it is not in the Roll's result)");
  walkDone();
} catch (err) {
  console.log(`WALK ERROR: ${err?.message ?? err}`);
  console.error(err?.stack ?? err);
  process.exitCode = 1;
} finally {
  section("teardown");
  const gm = open.gm;
  if (gm) {
    // The setting goes back first, then the wrapped Roll; a Roll's result still kept is tracked before the sweep.
    if (confirmWas !== null) { try { await run(gm, P.setting, { set: confirmWas }); } catch (err) { console.error("setting:", err?.message ?? err); } }
    try {
      const back = await run(gm, P.unspy, null);
      for (const r of back.left) for (const uuid of r.created) gm.track(uuid);
      note("the page's rollOrganisation restored", { restored: back.restored, untracked: back.left.length });
    } catch (err) { console.error("unspy:", err?.message ?? err); }
  }
  // The marked fixtures stay for the next walk; only what this run made without a marker goes.
  try { if (gm) note("swept", await gm.sweepTracked({ only: gm.tracked().filter((e) => !e.marker).map((e) => e.uuid) })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  console.log(`\nchecks: ${tally.pass} passed, ${tally.fail} failed`);
  if (tally.fail) process.exitCode = 1;
  for (const api of Object.values(open)) { try { api.close(); } catch (_e) { /* closed */ } }
}
