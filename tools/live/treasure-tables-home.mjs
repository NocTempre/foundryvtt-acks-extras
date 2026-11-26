/**
 * Live walk, treasure tables home: where a Judge finds the tables the treasure
 * deal reads, and the pot rail's button that opens them. Walks
 * docs/treasure/TESTING.md "Treasure tables home (Judge seat)", steps 1 to 5,
 * on the GM seat, with the Player seat read for the permission the button
 * follows and a second GM seat (the world's Assistant Gamemaster user) for
 * step 5. Every observable is a boolean or a count: the walk prints no table
 * cell, no letter and no figure the books print. Machine values arrive through
 * ./_env.mjs; the shared seat plumbing is ./_treasure-kit.mjs.
 *
 * Covers: step 1 (a pot made through Token controls' tool path, `newPot`, with
 * its Treasure tables button under the Table style group, drawn with its lang
 * label and its page-reference tooltip; a real press opens the Ruledata
 * Browser on the Treasure and Magic Item Tables groups, every other group
 * collapsed, each heading readable with its id as the hint, the Treasure group
 * scrolled into view, the engine's tables ahead of the Page reads list; the
 * pot brought forward over it and the button pressed again leaves one window,
 * in front); step 2 (the Page reads list collapsed with no control in its
 * summary, then opened by a real press: each row has View and Export and no
 * Edit, names the tables the deal reads, takes no drop, and its View opens;
 * an engine row keeps Edit and the drop selector); step 3 (an override of the
 * Type Classic table written through the real Edit dialog: the group's count
 * of overridden tables and the row's badge, then a deal into a pot whose audit
 * row and coin card carry the edited figure; Revert pressed on the row, the
 * heading's count gone, a second deal carrying none; the override removed by
 * the walk and read back as gone); step 4 (a world with no treasure import:
 * the declared tables listed as not supplied; skipped where one is imported);
 * step 5 (the Assistant Gamemaster seat with SETTINGS_MODIFY taken from its
 * role: a staged pot's rail carries no Treasure tables button and the rest of
 * it is drawn; the setting restored to the value read); the console on both
 * seats; teardown.
 *
 * Fixtures: `treasure/pot-tables` (a staged pot, marked and swept by the
 * run's ledger, never kept). The deals of step 3 each make a pot of their own,
 * tracked by id. No kept fixture is needed: the letter and the column the
 * override edits are chosen in page from the imported table's own cells. The
 * override and the permissions setting are world-setting data, not documents:
 * the walk removes and restores each itself and reads each back.
 *
 * Real gestures: the Treasure tables button, the Page reads summary, the Edit
 * dialog's Save override, the row's View and Revert are CDP mouse presses at
 * the control's centre when the control is the element under that point.
 * Scripted: the text of the edit dialog's textarea (the cell is replaced in
 * page), the die under each deal (held at its floor so a chance cell always
 * hits), the pot's window, the drop of a table onto a read-only row (a `drop`
 * event with the data a sidebar drag writes), and the Assistant seat's pot
 * window.
 *
 * Not reached: step 1's tooltip as a pointer hover shows it (the attribute is
 * read), a drop onto an engine row (it would write an override, which step 3
 * writes through Edit), the rail's Deal reporting not imported on a world with
 * nothing imported (the declared tables' listing is read, the rail's press is
 * not), and a Player seat's rail (a Player is offered none, so only the
 * permission the button follows is read on that seat).
 */
import { connect } from "./_driver.mjs";
import { walkDone, blocked } from "./_walk.mjs";
import { MACHINE, PORTS, LANG, P as K, run, t, note, section, check, checks, clicks, openSeats, press, ready, sleep, finish, watchdog } from "./_treasure-kit.mjs";

const POT_MARK = "treasure/pot-tables";
/** The invented figure the override writes: a die of one side plus a constant, so the throw is certain and audited. */
const FIGURE = 7777;
const NEW_COUNT = "1d1+7776";
const BROWSER = "#acks-location-ruledata-browser";

const P = {
  ...K,
  /** What the world holds: the treasure import, the override on its Classic table, the page-read API and this seat's permission. */
  probe: async () => {
    const m = (p) => import(`/modules/acks-extras/scripts/${p}`);
    const T = await m("lib/tables.mjs");
    const B = await m("importer/treasure-binding.mjs");
    const S = await m("location/table-store.mjs");
    const C = await m("treasure/constants.mjs");
    const imported = T.hasDoc(B.TREASURE_DOC_ID);
    const raw = typeof acksExtras.importer?.rawTablesOf === "function" ? acksExtras.importer.rawTablesOf(B.TREASURE_DOC_ID) : null;
    return {
      imported,
      docIds: [...C.TREASURE_TABLE_DOCS],
      docIsFirst: B.TREASURE_DOC_ID === C.TREASURE_TABLE_DOCS[0],
      overridden: S.hasOverride(B.TREASURE_DOC_ID, "typeClassic"),
      browserApi: typeof acksExtras.location?.openRuledataBrowser === "function",
      rawApi: raw !== null,
      reads: raw ? Object.keys(raw).length : 0,
      canBrowse: game.user.can("SETTINGS_MODIFY"),
    };
  },
  /** The rail's Treasure tables button as the pot's window draws it: where it sits, its label, its tooltip, and the style group beside it. */
  tablesButton: async ({ potId }) => {
    const H = globalThis.__tk;
    const root = H.root(H.sheet(potId));
    const btn = root?.querySelector("[data-action='dealTables']");
    const group = btn?.closest("fieldset");
    return {
      rendered: !!root,
      count: root?.querySelectorAll("[data-action='dealTables']").length ?? 0,
      underStyle: !!group && group.querySelectorAll("[data-action='dealStyle']").length === 3,
      label: H.text(btn),
      tip: btn?.getAttribute("data-tooltip-text") ?? null,
      labelled: !!H.text(btn),
      rail: !!root?.querySelector(".acks-extras-treasure__side"),
    };
  },
  /** Bring the pot's own window in front of every other. */
  frontPot: async ({ potId }) => {
    const app = globalThis.__tk.sheet(potId);
    app?.bringToFront?.();
    await globalThis.__tk.sleep(300);
    return { z: app?.position?.zIndex ?? null };
  },
  /** Wait until the Ruledata Browser has drawn its groups (or, with `gone`, until no browser window is left). */
  waitBrowser: async ({ gone = false } = {}) => {
    const H = globalThis.__tk;
    const ok = await H.poll(() => {
      const apps = [...foundry.applications.instances.values()].filter((a) => a.constructor.name === "RuledataBrowser");
      if (gone) return apps.length === 0;
      return apps[0]?.rendered && H.root(apps[0])?.querySelector("details[data-group]") ? true : null;
    }, { tries: 60, every: 250 });
    await H.sleep(700);
    return !!ok;
  },
  /** The browser window as drawn: how many windows, and each group's state. */
  browserView: async () => {
    const H = globalThis.__tk;
    const apps = [...foundry.applications.instances.values()].filter((a) => a.constructor.name === "RuledataBrowser");
    const app = apps[0] ?? null;
    const root = H.root(app);
    if (!root) return { windows: apps.length, drawn: false };
    const body = root.querySelector(".window-content") ?? root;
    const area = body.getBoundingClientRect();
    const groups = [...root.querySelectorAll("details[data-group]")].map((d) => {
      const summary = d.querySelector(":scope > summary");
      const top = summary.getBoundingClientRect().top;
      const table = d.querySelector(":scope > table");
      const reads = d.querySelector(":scope > details.page-reads");
      const rows = table?.querySelectorAll("tbody tr").length ?? 0;
      const readRows = reads?.querySelectorAll("tr[data-entry-key]").length ?? 0;
      const shown = /\((\d+)\)/.exec(H.text(summary));
      return {
        id: d.dataset.group,
        open: d.open,
        label: H.text(summary.querySelector("strong")),
        hint: H.text(summary.querySelector(".hint")),
        count: shown ? Number(shown[1]) : null,
        rows,
        inView: top >= area.top - 2 && top < area.bottom,
        enginesFirst: !reads || !!(table && table.compareDocumentPosition(reads) & Node.DOCUMENT_POSITION_FOLLOWING),
        absentRows: table?.querySelectorAll("tr.absent").length ?? 0,
        absentBadges: table?.querySelectorAll(".absent-badge").length ?? 0,
        readsPresent: !!reads,
        readsOpen: reads?.open === true,
        readsRows: readRows,
        readsSummary: H.text(reads?.querySelector(":scope > summary")),
        readsSummaryOk: !reads || H.text(reads.querySelector(":scope > summary")) === game.i18n.format("ACKS-LOCATION.browser.readsSummary", { n: readRows }),
        readsSummaryControls: reads?.querySelectorAll(":scope > summary button, :scope > summary a, :scope > summary input, :scope > summary select").length ?? 0,
        overriddenBadge: H.text(summary.querySelector(".override-badge")),
        overriddenOne: H.text(summary.querySelector(".override-badge")) === game.i18n.format("ACKS-LOCATION.browser.overriddenCount", { n: 1 }),
      };
    });
    return { windows: apps.length, drawn: true, z: app.position?.zIndex ?? null, domCount: document.querySelectorAll("#acks-location-ruledata-browser").length, groups };
  },
  /** The highest stacking level among the other open windows. */
  topOthers: async () => Math.max(0, ...[...foundry.applications.instances.values()].filter((a) => a.constructor.name !== "RuledataBrowser" && a.rendered).map((a) => a.position?.zIndex ?? 0)),
  /** The Page reads rows of the treasure group, checked against the importer's own page reads. */
  readsView: async () => {
    const H = globalThis.__tk;
    const TD = await import("/modules/acks-extras/scripts/location/table-docs.mjs");
    const root = H.root([...foundry.applications.instances.values()].find((a) => a.constructor.name === "RuledataBrowser"));
    const det = root?.querySelector("details.page-reads[data-reads='treasure']");
    if (!det) return { present: false };
    const entries = TD.listEntries();
    const raw = acksExtras.importer.rawTablesOf("treasure") ?? {};
    const rows = [...det.querySelectorAll("tr[data-entry-key]")].map((tr) => {
      const e = entries.find((x) => x.key === tr.dataset.entryKey);
      const by = e?.readBy ?? [];
      return {
        readOnly: tr.hasAttribute("data-read-only") && e?.readOnly === true,
        view: !!tr.querySelector("[data-action='viewEntry']"),
        exp: !!tr.querySelector("[data-action='exportEntry']"),
        edit: !!tr.querySelector("[data-action='editEntry']"),
        names: by.length > 0 && H.text(tr.querySelector(".read-by")) === game.i18n.format("ACKS-LOCATION.browser.readBy", { tables: by.map(TD.tableLabel).join(", ") }),
        agrees: Array.isArray(raw[e?.tableId]) && raw[e?.tableId].join("|") === by.join("|"),
        key: tr.dataset.entryKey,
      };
    });
    const engine = [...root.querySelectorAll("details[data-group='treasure'] > table tbody tr[data-entry-key]")].find((tr) => !tr.hasAttribute("data-read-only"));
    const sel = [...foundry.applications.instances.values()].find((a) => a.constructor.name === "RuledataBrowser")?.options?.dragDrop?.[0]?.dropSelector ?? "";
    return {
      present: true,
      open: det.open,
      rows,
      engineEdit: !!engine?.querySelector("[data-action='editEntry']"),
      engineDroppable: !!engine && !!sel && engine.matches(sel),
      readDroppable: !!sel && [...det.querySelectorAll("tr[data-read-only]")].some((tr) => tr.matches(sel)),
    };
  },
  /** Drop a RollTable on the first read-only row, and say whether any override of that row's table stands afterwards. */
  dropOnRead: async ({ tableUuid }) => {
    const H = globalThis.__tk;
    const TD = await import("/modules/acks-extras/scripts/location/table-docs.mjs");
    const S = await import("/modules/acks-extras/scripts/location/table-store.mjs");
    const root = H.root([...foundry.applications.instances.values()].find((a) => a.constructor.name === "RuledataBrowser"));
    const tr = root?.querySelector("details.page-reads[data-reads='treasure'] tr[data-read-only]");
    if (!tr) return { found: false };
    const entry = TD.listEntries().find((x) => x.key === tr.dataset.entryKey);
    const before = S.hasOverride(entry.docId, entry.tableId);
    const dt = new DataTransfer();
    dt.setData("text/plain", JSON.stringify({ type: "RollTable", uuid: tableUuid }));
    tr.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
    await H.sleep(1500);
    return { found: true, before, after: S.hasOverride(entry.docId, entry.tableId) };
  },
  /** The window a View press opens: present, and holding some text. */
  waitViewer: async () => {
    const H = globalThis.__tk;
    const app = await H.poll(() => [...foundry.applications.instances.values()].find((a) => a.rendered && a.options?.classes?.includes("acks-location-ruledata-view")) ?? null, { tries: 40, every: 200 });
    const text = H.text(H.root(app)?.querySelector("pre"));
    if (app) await app.close({ animate: false });
    return { opened: !!app, hasText: text.length > 0 };
  },
  /**
   * The letter and the coin column the override edits, chosen from the imported Classic grid's own cells: one coin
   * cell of exactly one clause whose count rewrites to the invented die and still reads, in a type whose deal under
   * a floor die throws that column's count, at a figure other than the invented one. Nothing of the cell leaves
   * the page: the driver holds the three strings and prints none.
   */
  pickOverride: async ({ next, figure }) => {
    const m = (p) => import(`/modules/acks-extras/scripts/${p}`);
    const T = await m("lib/tables.mjs");
    const B = await m("importer/treasure-binding.mjs");
    const HL = await m("treasure/hoard-logic.mjs");
    const Hd = await m("treasure/hoard.mjs");
    const TD = await m("location/table-docs.mjs");
    const entry = TD.listEntries().find((e) => e.docId === B.TREASURE_DOC_ID && e.tableId === "typeClassic");
    const rows = T.getDoc(B.TREASURE_DOC_ID).tables?.typeClassic ?? {};
    const orig = CONFIG.Dice.randomUniform;
    CONFIG.Dice.randomUniform = () => 0;
    let tried = 0;
    try {
      for (const letter of Object.keys(rows)) {
        for (const column of ["cp", "sp", "ep", "gp", "pp"]) {
          const cell = rows[letter]?.[column];
          if (typeof cell !== "string") continue;
          const parsed = HL.parseCell(cell, { column });
          if (parsed.error || parsed.errors?.length || parsed.terms?.length !== 1) continue;
          const count = parsed.terms[0].count;
          if (typeof count !== "string" || !cell.includes(count)) continue;
          const edited = cell.replace(count, next);
          const again = HL.parseCell(edited, { column });
          if (again.error || again.errors?.length || again.terms?.length !== 1 || String(again.terms[0].count).replace(/\s+/g, "").toLowerCase() !== next) continue;
          tried++;
          const out = await Hd.dealHoard({ letter, style: "classic", toggles: { noMagic: true } });
          const row = out.audit.find((a) => a.where === `${letter}.${column}` && a.count === true);
          if (!row || row.total === figure) continue;
          return { found: true, letter, column, cell, edited, key: entry?.key ?? null, tried };
        }
      }
    } finally {
      CONFIG.Dice.randomUniform = orig;
    }
    return { found: false, tried, key: entry?.key ?? null };
  },
  /** Deal one letter into a fresh pot under a floor die, and say whether the audit row and a coin card carry the figure. */
  dealOn: async ({ letter, column, figure }) => {
    const m = (p) => import(`/modules/acks-extras/scripts/${p}`);
    const D = await m("treasure/deal.mjs");
    const Pm = await m("treasure/pot.mjs");
    const pile = await acksExtras.treasure.newDealPot([]);
    if (!pile) return { made: false };
    await Pm.setDealToggle(pile, "noMagic", true);
    const orig = CONFIG.Dice.randomUniform;
    CONFIG.Dice.randomUniform = () => 0;
    let out;
    try {
      out = await D.dealLettersIntoPot(pile, { letters: [letter], style: "classic", confirmLair: async () => true });
    } finally {
      CONFIG.Dice.randomUniform = orig;
    }
    const audit = (out?.dealt ?? []).flatMap((d) => d.audit ?? []).filter((a) => a.where === `${letter}.${column}` && a.count === true);
    const coins = pile.cards.contents.map((c) => c.getFlag("acks-extras", "card")?.coin?.count).filter((n) => Number.isFinite(n));
    try { await pile.sheet?.close({ animate: false }); } catch { /* already closed */ }
    return {
      made: true,
      uuid: pile.uuid,
      ok: !!out?.ok,
      audit: audit.length,
      auditAtFigure: audit.some((a) => a.total === figure),
      coins: coins.length,
      coinsAtFigure: coins.filter((n) => n >= figure && n % figure === 0).length,
    };
  },
  /** The editor the Edit press opened: wait for it, replace the one cell in its text, and say the replacement stood. */
  editCell: async ({ letter, column, cell, edited }) => {
    const H = globalThis.__tk;
    const ta = await H.poll(() => document.querySelector(".acks-location-ruledata-edit textarea.ruledata-editor"), { tries: 40, every: 200 });
    if (!ta) return { opened: false };
    const parsed = JSON.parse(ta.value);
    if (parsed?.[letter]?.[column] !== cell) return { opened: true, guard: false };
    parsed[letter][column] = edited;
    ta.value = JSON.stringify(parsed, null, 2);
    return { opened: true, guard: true };
  },
  /** Wait for the override on the Classic table to be (or stop being) held. */
  waitOverride: async ({ want }) => {
    const H = globalThis.__tk;
    const S = await import("/modules/acks-extras/scripts/location/table-store.mjs");
    const ok = await H.poll(() => (S.hasOverride("treasure", "typeClassic") === want ? true : null), { tries: 50, every: 200 });
    await H.sleep(700);
    return { met: !!ok, held: S.hasOverride("treasure", "typeClassic") };
  },
  /** Remove the override the walk wrote, if it stands, and read it back. */
  dropOverride: async () => {
    const S = await import("/modules/acks-extras/scripts/location/table-store.mjs");
    if (S.hasOverride("treasure", "typeClassic")) await S.clearOverride("treasure", "typeClassic");
    return { gone: !S.hasOverride("treasure", "typeClassic") };
  },
  /** Whether a row of the browser carries the override badge. */
  rowBadge: async ({ key }) => {
    const H = globalThis.__tk;
    const root = H.root([...foundry.applications.instances.values()].find((a) => a.constructor.name === "RuledataBrowser"));
    const tr = [...(root?.querySelectorAll("tr[data-entry-key]") ?? [])].find((x) => x.dataset.entryKey === key);
    return { found: !!tr, badge: !!tr?.querySelector(".override-badge"), revert: !!tr?.querySelector("[data-action='revertEntry']") };
  },
  /** Open the browser through the API the button calls, on the treasure groups, and wait for it. */
  openBrowser: async () => {
    const C = await import("/modules/acks-extras/scripts/treasure/constants.mjs");
    await acksExtras.location.openRuledataBrowser({ focus: [...C.TREASURE_TABLE_DOCS] });
    return true;
  },
  closeBrowser: async () => {
    for (const app of [...foundry.applications.instances.values()]) if (app.constructor.name === "RuledataBrowser") { try { await app.close({ animate: false }); } catch { /* closed */ } }
    return true;
  },
  /** Wait until this seat reads the permission as `want`. */
  waitCan: async ({ want }) => {
    const ok = await globalThis.__tk.poll(() => (game.user.can("SETTINGS_MODIFY") === want ? true : null), { tries: 40, every: 250 });
    await globalThis.__tk.sleep(300);
    return { met: !!ok, can: game.user.can("SETTINGS_MODIFY") };
  },
  /** The Assistant Gamemaster user and whether it holds the permission the button follows. */
  assistant: async () => {
    const u = game.users.find((x) => x.role === CONST.USER_ROLES.ASSISTANT);
    return u ? { found: true, id: u.id, name: u.name, active: u.active, can: u.can("SETTINGS_MODIFY") } : { found: false };
  },
  /** The world's permission table as a JSON string, to restore byte for byte. */
  readPermissions: async () => JSON.stringify(game.settings.get("core", "permissions")),
  /** Take SETTINGS_MODIFY from the Assistant role, and wait until the seat reads it gone. */
  takePermission: async ({ id }) => {
    const H = globalThis.__tk;
    const now = foundry.utils.deepClone(game.settings.get("core", "permissions"));
    now.SETTINGS_MODIFY = (now.SETTINGS_MODIFY ?? []).filter((r) => r !== CONST.USER_ROLES.ASSISTANT);
    await game.settings.set("core", "permissions", now);
    const gone = await H.poll(() => (game.users.get(id)?.can("SETTINGS_MODIFY") === false ? true : null), { tries: 40, every: 250 });
    return { gone: !!gone, can: game.users.get(id)?.can("SETTINGS_MODIFY") };
  },
  /** Put the permission table back to the exact value read, and read it back. */
  restorePermissions: async ({ value }) => {
    await game.settings.set("core", "permissions", JSON.parse(value));
    await globalThis.__tk.sleep(500);
    return { same: JSON.stringify(game.settings.get("core", "permissions")) === value };
  },
  /** Open a pot's window on this seat and read its rail: the style group, the other controls and the button. */
  railOn: async ({ potId }) => {
    const H = globalThis.__tk;
    const pile = H.pile(potId);
    if (!pile) return { found: false };
    await pile.sheet.render(true);
    if (!H.opened.includes(pile.sheet)) H.opened.push(pile.sheet);
    const root = await H.poll(() => { const r = H.root(pile.sheet); return r?.querySelector(".acks-extras-treasure__side") ? r : null; }, { tries: 60, every: 250 });
    return {
      found: true,
      rail: !!root,
      styles: root?.querySelectorAll("[data-action='dealStyle']").length ?? 0,
      tables: root?.querySelectorAll("[data-action='dealTables']").length ?? 0,
      arms: !!root?.querySelector("[data-deal-arms]"),
      toggles: root?.querySelectorAll("[data-action='dealSpecial'], [data-action='dealLair']").length ?? 0,
      deal: !!root?.querySelector("[data-action='dealRun']"),
      can: game.user.can("SETTINGS_MODIFY"),
    };
  },
  /** What the seat's permission reads, for a seat the walk only observes. */
  can: async () => ({ can: game.user.can("SETTINGS_MODIFY"), isGM: game.user.isGM }),
  /** A world RollTable uuid to drop, read without writing. */
  anyTable: async () => game.tables.contents[0]?.uuid ?? null,
};

let gm = null;
let player = null;
let gm2 = null;
const made = [];
let wrote = false;
let permBefore = null;
let permChanged = false;
watchdog(() => [gm, player, gm2], Number(process.env.WALK_WALL_MS ?? 600_000));

const skip = (label, why) => console.log(`SKIP  ${label}  ${why}`);
/** One step in its own try: a throw is a failed check and leaves the next step running. */
async function step(name, fn) {
  try {
    await fn();
  } catch (err) {
    check(`${name}: ran to its end without throwing`, false, String(err?.message ?? err).slice(0, 200));
  }
}

try {
  section("seats");
  gm = await connect({ browser: MACHINE.browser, origin: MACHINE.origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  player = await connect({ browser: MACHINE.browser, origin: MACHINE.origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  await openSeats({ gm, player, blocked, pattern: /treasure|pot-sheet|deal|ruledata|table-docs|location/i });

  section("fixtures");
  const probe = await run(gm, P.probe);
  note("the world holds (imported, page-read rows, override standing)", { imported: probe.imported, reads: probe.reads, overridden: probe.overridden });
  if (!probe.browserApi) blocked("acksExtras.location.openRuledataBrowser is not on the GM seat: the tables home is not in the loaded tree");
  if (!probe.canBrowse) blocked("the GM seat does not hold SETTINGS_MODIFY, so the button is not drawn to it and step 1 has no subject");
  check("the browser API is on the GM seat, the treasure documents the button opens are the importer's, and the seat holds the permission the button follows", probe.browserApi && probe.docIsFirst && probe.docIds.length === 2 && probe.canBrowse, { docs: probe.docIds.length });
  const playerCan = await run(player, P.can);
  check("the Player seat does not hold the permission the button follows", playerCan.can === false && playerCan.isGM === false, playerCan);

  const pot = await run(gm, P.newPot);
  if (!pot) blocked("no pot window opened on the GM seat");
  try { await gm.mark(pot.uuid, POT_MARK); } catch (err) { note("the pot could not carry its marker (tracked by id instead)", String(err?.message ?? err).slice(0, 160)); gm.track(pot.uuid, "Cards"); }
  made.push(pot.uuid);
  const staged = await run(gm, K.stage, { potId: pot.potId });
  check("a staged pot is open on the GM seat", staged.phase === "staging", { phase: staged.phase });

  await step("Step 1", async () => {
    section("Step 1. the button and the focus");
    const btn = await run(gm, P.tablesButton, { potId: pot.potId });
    const expLabel = await t(gm, "deal.tables");
    const expTip = await t(gm, "deal.tip.tables", { cite: await t(gm, "cite.deal") });
    check("the rail has one Treasure tables button under the Table style group, with its lang label and its page-reference tooltip", btn.rendered && btn.rail && btn.count === 1 && btn.underStyle && btn.label === expLabel && btn.tip === expTip, { count: btn.count, underStyle: btn.underStyle, label: btn.label === expLabel, tip: btn.tip === expTip });
    await run(gm, P.closeBrowser);
    const pressed = await press(gm, PORTS.gm, { scope: "sheet", potId: pot.potId, sel: "[data-action='dealTables']" }, "Treasure tables");
    const drawn = await run(gm, P.waitBrowser);
    const v1 = await run(gm, P.browserView);
    const focused = v1.groups?.filter((g) => probe.docIds.includes(g.id)) ?? [];
    const others = v1.groups?.filter((g) => !probe.docIds.includes(g.id)) ?? [];
    const first = v1.groups?.find((g) => g.id === probe.docIds[0]);
    check("the press opened the Ruledata Browser with one window", pressed.found && !pressed.disabled && drawn && v1.drawn && v1.windows === 1 && v1.domCount === 1, { found: pressed.found, real: pressed.real, windows: v1.windows });
    check("the treasure group is there and open, the magic item group open where the window holds it, and every other group collapsed", !!first && first.open && focused.every((g) => g.open) && others.every((g) => !g.open), { focused: focused.length, others: others.length, othersOpen: others.filter((g) => g.open).length });
    check("each group's heading is readable with its id as the hint, and its count is the rows listed", (v1.groups ?? []).every((g) => g.label.length > 0 && g.hint === g.id && g.count === g.rows), { groups: v1.groups?.length });
    check("the treasure group is scrolled into view, and the engine's tables stand ahead of its Page reads list", !!first && first.inView && first.enginesFirst, { inView: first?.inView, enginesFirst: first?.enginesFirst });
    // A second press with the pot in front: one window, brought forward.
    await run(gm, P.frontPot, { potId: pot.potId });
    const zPot = await run(gm, P.topOthers);
    const again = await press(gm, PORTS.gm, { scope: "sheet", potId: pot.potId, sel: "[data-action='dealTables']" }, "Treasure tables again");
    await sleep(900);
    const v2 = await run(gm, P.browserView);
    const zOthers = await run(gm, P.topOthers);
    check("with the pot brought in front of the browser, pressing the button again leaves one window and brings it in front of the pot's", again.found && zPot > v1.z && v2.windows === 1 && v2.domCount === 1 && v2.z > zOthers, { windows: v2.windows, potWasFront: zPot > v1.z, front: v2.z > zOthers });
  });

  await step("Step 2", async () => {
    section("Step 2. page reads");
    if (!probe.imported || !probe.rawApi || probe.reads === 0) return skip("Step 2 page reads", `the world has no treasure import with page reads (imported ${probe.imported}, page-read API ${probe.rawApi}, rows ${probe.reads})`);
    await run(gm, P.openBrowser);
    await run(gm, P.waitBrowser);
    const v = await run(gm, P.browserView);
    const g = v.groups?.find((x) => x.id === probe.docIds[0]);
    check("in the treasure group the Page reads list is present, collapsed, its summary counts its rows and holds no control", !!g && g.readsPresent && !g.readsOpen && g.readsRows > 0 && g.readsSummaryOk && g.readsSummaryControls === 0, { present: g?.readsPresent, open: g?.readsOpen, rows: g?.readsRows, controls: g?.readsSummaryControls });
    const open = await press(gm, PORTS.gm, { scope: "doc", sel: `${BROWSER} details.page-reads[data-reads='treasure'] > summary` }, "Page reads");
    await sleep(500);
    const r = await run(gm, P.readsView);
    check("the press opened the list", open.found && r.present && r.open, { found: open.found, real: open.real });
    check("every page-read row has View and Export and no Edit, is marked read-only and names the tables the deal reads, agreeing with the importer's own page reads", r.rows.length > 0 && r.rows.every((x) => x.readOnly && x.view && x.exp && !x.edit && x.names && x.agrees), { rows: r.rows.length, bad: r.rows.filter((x) => !(x.readOnly && x.view && x.exp && !x.edit && x.names && x.agrees)).length });
    check("an engine row keeps its Edit control and is a drop target, and a page-read row is not", r.engineEdit && r.engineDroppable && !r.readDroppable, { edit: r.engineEdit, engine: r.engineDroppable, read: r.readDroppable });
    // Drop a table onto a read-only row: nothing is written.
    let tableUuid = await run(gm, P.anyTable);
    if (!tableUuid) {
      const own = await gm.create("RollTable", { name: "QA Tables Home Drop", formula: "1d2", replacement: true });
      made.push(own.uuid);
      tableUuid = own.uuid;
    }
    const drop = await run(gm, P.dropOnRead, { tableUuid });
    check("dropping a table on a page-read row writes no override of the table it names", drop.found && drop.before === false && drop.after === false, drop);
    const view = await press(gm, PORTS.gm, { scope: "doc", sel: `${BROWSER} details.page-reads[data-reads='treasure'] tr[data-read-only] [data-action='viewEntry']` }, "View on a page-read row");
    const viewer = await run(gm, P.waitViewer);
    check("View on a page-read row opens its data", view.found && viewer.opened && viewer.hasText, { found: view.found, opened: viewer.opened });
  });

  await step("Step 3", async () => {
    section("Step 3. an override reaches the deal");
    if (!probe.imported) return skip("Step 3 override", "the world has no treasure import, so there is no table to edit");
    if (probe.overridden) return skip("Step 3 override", "an override of the Classic table already stands and is not this run's, so it is neither edited nor cleared");
    const pick = await run(gm, P.pickOverride, { next: NEW_COUNT, figure: FIGURE });
    if (!pick.found || !pick.key) return skip("Step 3 override", `no coin cell of the imported Classic grid rewrites to a readable count and deals under a floor die (cells that rewrote: ${pick.tried})`);
    const base = await run(gm, P.dealOn, { letter: pick.letter, column: pick.column, figure: FIGURE });
    if (base.uuid) made.push(gm.track(base.uuid, "Cards"));
    check("before the override the chosen type deals its coin column with an audit row and no throw at the invented figure", base.made && base.ok && base.audit > 0 && !base.auditAtFigure && base.coinsAtFigure === 0, { audit: base.audit, atFigure: base.auditAtFigure, coins: base.coinsAtFigure });
    await run(gm, P.openBrowser);
    await run(gm, P.waitBrowser);
    const edit = await press(gm, PORTS.gm, { scope: "doc", sel: `${BROWSER} tr[data-entry-key=${JSON.stringify(pick.key)}] [data-action='editEntry']` }, "Edit on the Classic type table");
    const cell = await run(gm, P.editCell, { letter: pick.letter, column: pick.column, cell: pick.cell, edited: pick.edited });
    check("Edit opened the table's JSON, and the chosen cell read as the table holds it", edit.found && cell.opened && cell.guard, { found: edit.found, opened: cell.opened, guard: cell.guard });
    if (!(cell.opened && cell.guard)) throw new Error("the editor did not open on the table's own cell");
    const save = await press(gm, PORTS.gm, { scope: "doc", sel: ".acks-location-ruledata-edit button[data-action='ok']" }, "Save override");
    wrote = true;
    const held = await run(gm, P.waitOverride, { want: true });
    await run(gm, P.waitBrowser);
    const v = await run(gm, P.browserView);
    const g = v.groups?.find((x) => x.id === probe.docIds[0]);
    const badge = await run(gm, P.rowBadge, { key: pick.key });
    check("Save override stored the override, the group's heading reads one overridden and the row's badge says override with Revert offered", save.found && held.met && !!g && g.overriddenOne && badge.badge && badge.revert, { saved: held.met, heading: g?.overriddenOne, badge: badge.badge, revert: badge.revert });
    const over = await run(gm, P.dealOn, { letter: pick.letter, column: pick.column, figure: FIGURE });
    if (over.uuid) made.push(gm.track(over.uuid, "Cards"));
    check("a deal of that letter at the Classic style carries the edited figure in the column's audit row", over.made && over.ok && over.auditAtFigure, { audit: over.audit, atFigure: over.auditAtFigure });
    check("and a coin card of the pot holds a count that is a whole multiple of the edited figure (the coin's own unit applied)", over.coinsAtFigure > 0, { coins: over.coins, atFigure: over.coinsAtFigure });
    const revert = await press(gm, PORTS.gm, { scope: "doc", sel: `${BROWSER} tr[data-entry-key=${JSON.stringify(pick.key)}] [data-action='revertEntry']` }, "Revert on the Classic type table");
    const gone = await run(gm, P.waitOverride, { want: false });
    await run(gm, P.waitBrowser);
    const v3 = await run(gm, P.browserView);
    const g3 = v3.groups?.find((x) => x.id === probe.docIds[0]);
    const after = await run(gm, P.dealOn, { letter: pick.letter, column: pick.column, figure: FIGURE });
    if (after.uuid) made.push(gm.track(after.uuid, "Cards"));
    check("Revert on the row dropped the override, the heading's count is gone, and a second deal carries the imported figure again", revert.found && gone.met && !!g3 && g3.overriddenBadge === "" && after.made && after.ok && !after.auditAtFigure && after.coinsAtFigure === 0, { reverted: gone.met, heading: g3?.overriddenBadge === "", atFigure: after.auditAtFigure });
    const clean = await run(gm, P.dropOverride);
    wrote = !clean.gone;
    check("the walk's override is removed and reads back as gone", clean.gone, clean);
  });

  await step("Step 4", async () => {
    section("Step 4. nothing imported");
    if (probe.imported) return skip("Step 4 nothing imported", "this world holds a treasure import (walked only where none is at hand)");
    await run(gm, P.openBrowser);
    await run(gm, P.waitBrowser);
    const v = await run(gm, P.browserView);
    const g = v.groups?.find((x) => x.id === probe.docIds[0]);
    check("the Treasure group lists its declared tables as not supplied", !!g && g.rows > 0 && g.absentRows === g.rows && g.absentBadges === g.rows, { rows: g?.rows, absent: g?.absentRows });
    note("step 4, the rail's Deal reporting not imported", "not pressed here; recipe step 4 asks for it");
  });

  await step("Step 5", async () => {
    section("Step 5. a seat without the permission");
    await run(gm, P.closeBrowser);
    const asst = await run(gm, P.assistant);
    if (!asst.found) return skip("Step 5 permission", "this world has no Assistant Gamemaster user to seat as a second GM");
    if (asst.active) return skip("Step 5 permission", "the Assistant Gamemaster user is already seated by another client, and this walk drives no peer's seat");
    permBefore = await run(gm, P.readPermissions);
    if (asst.can) {
      const took = await run(gm, P.takePermission, { id: asst.id });
      permChanged = true;
      if (!took.gone) {
        note("step 5, the Assistant seat still holds the permission after its role entry was removed", took);
        return skip("Step 5 permission", "removing the role's entry leaves the permission with the seat, so there is no seat that lacks it; the recipe's inference that only the Assistant role can lack it is settled the other way");
      }
    } else note("step 5, the Assistant role did not hold the permission before the walk", "nothing was changed");
    gm2 = await connect({ browser: MACHINE.browser, origin: MACHINE.origin, user: asst.name, port: PORTS.gm2, own: MACHINE.own });
    await ready(gm2, "gm2");
    await run(gm2, P.install, { lang: LANG });
    await run(gm2, P.waitCan, { want: false });
    const rail = await run(gm2, P.railOn, { potId: pot.potId });
    check("on the Assistant seat, without SETTINGS_MODIFY, the staged pot's rail has its three style buttons, the arms field, the toggles and Deal, and no Treasure tables button", rail.found && rail.rail && rail.can === false && rail.styles === 3 && rail.arms && rail.toggles === 2 && rail.deal && rail.tables === 0, { can: rail.can, styles: rail.styles, arms: rail.arms, toggles: rail.toggles, deal: rail.deal, tables: rail.tables });
    const back = await run(gm, P.restorePermissions, { value: permBefore });
    permChanged = !back.same;
    check("the permissions setting is restored to the value read", back.same, back);
    if (asst.can) {
      await run(gm2, P.waitCan, { want: true });
      const withIt = await run(gm2, P.railOn, { potId: pot.potId });
      check("with the permission back the same seat's rail is drawn the button", withIt.rail && withIt.can === true && withIt.tables === 1, { can: withIt.can, tables: withIt.tables });
    }
  });

  section("console");
  for (const [key, api] of [["gm", gm], ["player", player]]) {
    const drained = await run(api, K.drain);
    check(`${key}: no console error over the walk`, !drained.errors.length, drained.errors.slice(0, 3).map((e) => e.slice(0, 120)));
  }
  note("clicks (real pointer presses / pressed with click())", clicks);
  walkDone();
} catch (err) {
  if (err?.name !== "WalkBlocked") console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  if (gm) {
    try { if (wrote) note("override removed", await run(gm, P.dropOverride)); } catch (err) { console.error("override:", err?.message ?? err); }
    try { if (permChanged && permBefore) note("permissions restored", await run(gm, P.restorePermissions, { value: permBefore })); } catch (err) { console.error("permissions:", err?.message ?? err); }
    try { await run(gm, P.closeBrowser); } catch {}
  }
  for (const [key, api] of [["gm2", gm2], ["player", player], ["gm", gm]]) {
    if (!api) continue;
    try { await run(api, K.closeAll); } catch {}
    try { note(`restored (${key})`, await run(api, K.restore)); } catch (err) { console.error("restore:", err?.message ?? err); }
  }
  if (gm) {
    // Only the run's own ids: the staged pot and the pots of step 3's deals. No kept fixture is built.
    try { note("swept (the run's own ids)", await gm.sweepTracked({ only: made.filter((uuid) => gm.tracked().some((e) => e.uuid === uuid)) })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  }
  try { if (gm2) await gm2.close(); } catch {}
  try { if (player) await player.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  finish();
}
