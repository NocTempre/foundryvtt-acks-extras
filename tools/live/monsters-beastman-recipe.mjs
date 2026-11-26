/**
 * Live walk, the recipe editor: docs/monsters/TESTING.md "The recipe editor", marker
 * `monsters/beastman-recipe`. Opens the editor from its three doors, hand-marks a part, resets it,
 * adds a part from a sentence, links a Mount part and Rolls from the chart, types a fixed hit-point
 * figure, repairs the monster in place, checks that a group rolled earlier keeps its figures, narrows
 * the window, joins as a Player seat and resets the whole recipe. Machine values arrive through
 * ./_env.mjs, the Monstrous Manual through ACKS_TEST_BOOKS. The run reads no figure of the book and
 * prints none: it reads each part and its read copy at runtime and compares them with themselves, and
 * logs keys' positions, counts and booleans only.
 *
 * Fixtures. `monsters/beastman-recipe` is a world copy of a family member's library entry
 * (`_stats.compendiumSource`, so a picker repair passes it by) with its recipe emptied, then filled
 * again by `refillMonster` (what a repair runs for a stat-block monster): a fresh read of the
 * Judge's own book, every part stamped `register` with the read copy beside it. A pack document takes
 * no marker, which is why the fixture is a copy; the standing one is retired first. The library's
 * family template is read, never written (only a Repair in place writes it, and only where no option
 * of it holds stamped parts); the run edits a tracked world copy of it and a tracked faction host.
 * Every document a Roll makes is tracked from its result.
 *
 * Seats: the GM seat (MACHINE.gm) drives every step but 10, which joins as MACHINE.player. The
 * monster's ownership is written for step 10 and set back to what it was.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS, books } from "./_env.mjs";
import { walkDone, blocked } from "./_walk.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const BOOK = "mm";
const FAMILY = "mm.familyBeastman";
const MARKER = "monsters/beastman-recipe";
const TAG = MACHINE.own ? ` ${MACHINE.own}` : "";
const OBSERVER = 2;
const OWNER = 3;
const checks = [];
const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in a seat's page,  */
/*  so none names a node-side value; its arguments carry every value.  */
/* ------------------------------------------------------------------ */
const P = {
  /** Helpers on the page, and who the seat is. No module is imported here: a Player seat runs this too. */
  helpers: async () => {
    const H = (globalThis.__br = globalThis.__br ?? {});
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 60, every = 250 } = {}) => {
      for (let n = 0; n < tries; n++) {
        const v = await fn();
        if (v) return v;
        await H.sleep(every);
      }
      return null;
    };
    H.root = (app) => {
      const el = app?.element;
      return el?.nodeType === 1 ? el : (el?.[0] ?? null);
    };
    H.editors = () => [...foundry.applications.instances.values()].filter((a) => a.constructor?.name === "RecipeEditor" && a.rendered);
    H.editor = (title) => H.editors().find((a) => a.title === title) ?? null;
    H.dialogs = () => [...foundry.applications.instances.values()].filter((a) => a instanceof foundry.applications.api.DialogV2 && a.rendered);
    return { isGM: game.user.isGM, activeGMIsSelf: !!game.users.activeGM?.isSelf, role: game.user.role, module: game.modules.get("acks-extras")?.version ?? null };
  },

  /** The GM seat's importer modules, and whether the Monstrous Manual is open. */
  modules: async () => {
    const H = globalThis.__br;
    H.CB = await import("/modules/acks-extras/scripts/importer/cookbook.mjs");
    H.MON = await import("/modules/acks-extras/scripts/importer/cookbook/monster.mjs");
    H.ER = await import("/modules/acks-extras/scripts/monsters/encounter-recipe.mjs");
    H.LIB = await import("/modules/acks-extras/scripts/lib/library.mjs");
    return { open: !!H.CB.cookbookSessionDoc("mm") };
  },

  connectBook: async ({ id, path: file }) => {
    globalThis.__brBook = { done: false };
    acksExtras.importer.connectBookUrl(id, file, { remember: false, bridge: false })
      .then(() => { globalThis.__brBook = { done: true, ok: true }; })
      .catch((e) => { globalThis.__brBook = { done: true, ok: false, error: String(e?.message ?? e) }; });
    return { started: true };
  },
  bookState: async ({ id }) => ({ ...(globalThis.__brBook ?? {}), open: !!globalThis.__br.CB.cookbookSessionDoc(id) }),

  /** The library's family template, by cookbook id, counted so a twin is seen. Read only. */
  template: async ({ family }) => {
    const H = globalThis.__br;
    const held = (await H.CB.importedDocs("Actor")).filter((d) => d.pack && d.getFlag("acks-extras", "cookbook")?.id === family);
    return { uuid: held.length === 1 ? held[0].uuid : null, twins: held.length };
  },

  /** Whether a document is Foundry-editable by this seat: the pack's lock, the update right, the sheet's own answer. */
  lockOf: async ({ uuid }) => {
    const doc = await fromUuid(uuid);
    const pack = doc?.pack ? game.packs.get(doc.pack) : null;
    return { inPack: !!doc?.pack, packLocked: pack ? !!pack.locked : null, canUpdate: !!doc?.canUserModify?.(game.user, "update"), sheetEditable: !!doc?.sheet?.isEditable };
  },

  /**
   * The template's variant options that hold stamped parts, each with the Roll side a Judge part could
   * join: the first side (wilderness before dungeon, wandering before lair, a top unit that counts bodies
   * before one that counts units) whose top unit word some part of the recipe names. Nothing printed leaves
   * the page: the answer is keys, positions and flags.
   */
  variants: async ({ uuid }) => {
    const H = globalThis.__br;
    const doc = await fromUuid(uuid);
    const axes = doc.system.toObject().axes ?? [];
    const variant = axes.find((a) => a.key === "variant");
    const out = [];
    for (const [at, option] of (variant?.options ?? []).entries()) {
      const x = option.flags?.["acks-extras"] ?? {};
      const recipe = x.extras?.encounter?.recipe ?? [];
      const copy = x.cookbook?.read?.recipe ?? [];
      const stamped = recipe.length > 0 && recipe.every((p) => p.origin === "register") && copy.length === recipe.length;
      const words = [...new Set(recipe.flatMap((p) => p.when?.units ?? []).map((u) => String(u).toLowerCase()))];
      const sides = H.ER.sidesOf(recipe, x.extras?.encounter ?? null);
      let side = null;
      for (const [place, state] of [["wilderness", "wandering"], ["dungeon", "wandering"], ["wilderness", "lair"], ["dungeon", "lair"]]) {
        const s = sides.find((q) => q.place === place && q.state === state);
        const word = s ? words.find((w) => H.ER.unitWord(w) === s.word) : null;
        if (s && word) { side = { context: place, state, word, bodies: !s.childWord }; break; }
      }
      out.push({ at, key: option.key, stamped, parts: recipe.length, side });
    }
    return out;
  },

  /** The family's repair through the entry picker, as the Judge ticks it: Yes to the confirm, the held-edits list closed unanswered. */
  repair: async ({ family }) => {
    const H = globalThis.__br;
    const before = H.dialogs().map((a) => a.id);
    // The reimport runs far past one evaluate's limit, so the flight is started here and read by `repairDone`; each wait below stays under it.
    H.flightDone = false;
    H.flightError = null;
    H.flight = acksExtras.importer.cookbookReimportEntries().catch((e) => { H.flightError = String(e?.message ?? e); }).finally(() => { H.flightDone = true; });
    const app = await H.poll(() => H.dialogs().find((a) => !before.includes(a.id) && H.root(a)?.querySelector(".acks-extras-importer-mon-list")), { tries: 160 });
    if (!app) return { opened: false };
    const box = H.root(app).querySelector(`input[name='sel'][value='Monsters|${family}']`);
    if (!box) return { opened: true, ticked: false };
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    const dialogsBefore = H.dialogs().map((a) => a.id);
    H.root(app).querySelector("button[data-action='ok']").click();
    const dlg = await H.poll(() => H.dialogs().find((a) => !dialogsBefore.includes(a.id) && H.root(a)?.querySelector("button[data-action='yes']")), { tries: 160 });
    if (dlg) H.root(dlg).querySelector("button[data-action='yes']").click();
    return { opened: true, ticked: true, asked: !!dlg };
  },
  /** The reimport `repair` started: answers whether it has returned, closing the held-edits list unanswered if it asks. */
  repairDone: async () => {
    const H = globalThis.__br;
    const choice = H.dialogs().find((a) => H.root(a)?.querySelector(".acks-extras-held-list"));
    if (choice) await choice.close();
    return { done: H.flightDone === true, error: H.flightError ?? null };
  },

  /** The family's members the cookbook lists as stat blocks, and which of them the library holds. */
  members: async ({ family }) => {
    const H = globalThis.__br;
    const members = (H.CB.cookbookEntry(family)?.entry?.family?.members ?? []).map((m) => m.id).filter((id) => {
      const kind = H.CB.cookbookEntry(id)?.entry?.kind;
      return !kind || kind === "kind.monster";
    });
    const docs = await H.CB.importedDocs("Actor");
    return { members, held: members.filter((id) => docs.some((d) => d.pack && d.type === "monster" && d.getFlag("acks-extras", "cookbook")?.id === id)) };
  },
  /** Import entries the library lacks through the importer's own call; the ones it holds are declined. */
  importIds: async ({ ids }) => {
    await acksExtras.importer.cookbookImportIds(ids);
    return true;
  },

  /** The data of a world copy of a library actor: its recipe and the read copy of it taken out, its source stamped as a drag out of the library stamps it. */
  copyData: async ({ id, name }) => {
    const H = globalThis.__br;
    const lib = (await H.CB.importedDocs("Actor")).find((d) => d.pack && d.getFlag("acks-extras", "cookbook")?.id === id);
    if (!lib) return null;
    const data = lib.toObject();
    delete data._id;
    data.folder = null;
    data.name = name;
    data.ownership = { default: 0 };
    data._stats = { compendiumSource: lib.uuid };
    foundry.utils.setProperty(data, "flags.acks-extras.extras.encounter.recipe", []);
    foundry.utils.deleteProperty(data, "flags.acks-extras.cookbook.read.recipe");
    return data;
  },
  /** The copy made a world copy of a family template: its source stamped, its name its own. */
  templateCopyData: async ({ uuid, name }) => {
    const lib = await fromUuid(uuid);
    const data = lib.toObject();
    delete data._id;
    data.folder = null;
    data.name = name;
    data.ownership = { default: 0 };
    data._stats = { compendiumSource: lib.uuid };
    return data;
  },
  /** A copy's source stamped as a drag out of the library stamps it, read back: whether the stamp stands and reads as a world copy. */
  stamp: async ({ uuid, source }) => {
    const doc = await fromUuid(uuid);
    if (doc._stats?.compendiumSource !== source) await doc.update({ "_stats.compendiumSource": source });
    const now = (await fromUuid(uuid))?._stats?.compendiumSource ?? "";
    return { stamped: now === source, worldCopy: String(now).startsWith("Compendium.world.") };
  },
  /** The importer's repair of a stat-block monster in place (`refillMonster`, whole), then what the recipe holds. */
  refill: async ({ uuid }) => {
    const H = globalThis.__br;
    const actor = await fromUuid(uuid);
    const r = await H.MON.refillMonster(actor, { whole: true });
    const x = (await fromUuid(uuid))?.flags?.["acks-extras"] ?? {};
    const recipe = x.extras?.encounter?.recipe ?? [];
    const copy = x.cookbook?.read?.recipe ?? [];
    return {
      ok: !!r?.ok, reason: r?.reason ?? "", n: recipe.length, copyN: copy.length,
      allRegister: recipe.length > 0 && recipe.every((p) => p.origin === "register"),
      countable: recipe.filter((p) => !p.count?.ratioOf && (p.count?.dice || Number.isFinite(p.count?.literal))).length,
    };
  },

  /** A recipe and its read copy, as stored: the actor's own, or a variant option's. */
  stored: async ({ uuid, optionKey }) => {
    const doc = await fromUuid(uuid);
    const node = optionKey ? (doc.system.toObject().axes ?? []).find((a) => a.key === "variant")?.options?.find((o) => o.key === optionKey) : doc;
    const x = node?.flags?.["acks-extras"] ?? {};
    return { recipe: foundry.utils.deepClone(x.extras?.encounter?.recipe ?? []), copy: foundry.utils.deepClone(x.cookbook?.read?.recipe ?? []) };
  },
  /** The part to hand-change: the first with a count of its own (not a share), and the tab its row stands under. Indices only. */
  pick: async ({ uuid, optionKey }) => {
    const doc = await fromUuid(uuid);
    const node = optionKey ? (doc.system.toObject().axes ?? []).find((a) => a.key === "variant")?.options?.find((o) => o.key === optionKey) : doc;
    const recipe = node?.flags?.["acks-extras"]?.extras?.encounter?.recipe ?? [];
    const at = recipe.findIndex((p) => !p.count?.ratioOf && (p.count?.dice || Number.isFinite(p.count?.literal)));
    if (at < 0) return null;
    const p = recipe[at];
    const figure = Number.isFinite(p.count?.literal) ? String(p.count.literal + 11) : "17";
    return { at, key: p.key, tab: p.when?.state === "lair" ? "lair" : "wandering", figure };
  },

  /** The title a door gives its window, and the lines the head and the role cell read, composed from the lang (nothing typed here). */
  say: async ({ option, name, hand, all, cite }) => ({
    title: option ? game.i18n.format("ACKS-MONSTERS.recipe.titleOption", { name, option }) : game.i18n.format("ACKS-MONSTERS.recipe.title", { name }),
    heads: [game.i18n.format("ACKS-MONSTERS.recipe.head.line", { cite, hand, all }), game.i18n.format("ACKS-MONSTERS.recipe.head.lineNoCite", { hand, all })],
    noRole: game.i18n.localize("ACKS-MONSTERS.recipe.role.none"),
    readOnly: game.i18n.localize("ACKS-MONSTERS.recipe.foot.readOnly"),
  }),
  /** A variant option's label as the title shows it, and the page cite the head reads (the first part's that carries one). */
  names: async ({ uuid, optionKey }) => {
    const doc = await fromUuid(uuid);
    const option = optionKey ? (doc.system.toObject().axes ?? []).find((a) => a.key === "variant")?.options?.find((o) => o.key === optionKey) : null;
    const x = (option ?? doc).flags?.["acks-extras"] ?? {};
    const copy = x.cookbook?.read?.recipe ?? [];
    const recipe = x.extras?.encounter?.recipe ?? [];
    return { name: doc.name, option: option ? option.label || option.key : "", cite: copy.find((p) => p?.cite)?.cite || recipe.find((p) => p?.cite)?.cite || "" };
  },

  /** A window's face: header, head line, rows, the tab, and the controls a seat has. Row text stays on the page's side of the log. */
  snap: async ({ title }) => {
    const H = globalThis.__br;
    const app = H.editor(title);
    if (!app) return { found: false, windows: H.editors().length };
    const el = H.root(app);
    const strong = (li) => li.querySelector(".acks-extras-recipe-strong");
    return {
      found: true,
      header: el.querySelector(".window-title")?.textContent?.trim() ?? "",
      hint: el.querySelector(".acks-extras-recipe-headtext .acks-extras-recipe-hint")?.textContent?.trim() ?? "",
      rows: [...el.querySelectorAll("li.acks-extras-recipe-item")].map((li) => ({
        key: li.dataset.key, hand: li.classList.contains("is-hand"), open: li.classList.contains("is-on"),
        tip: strong(li)?.getAttribute("data-tooltip-text") ?? "", name: strong(li)?.textContent?.trim() ?? "", muted: !!strong(li)?.classList.contains("is-muted"),
        fields: [...li.querySelectorAll("[data-field]")].map((f) => f.dataset.field),
        linkButtons: [...li.querySelectorAll("[data-action='linkEntry']")].map((b) => b.dataset.uuid),
      })),
      tabOn: el.querySelector(".acks-extras-recipe-tab.is-on")?.dataset.state ?? "",
      pens: el.querySelectorAll("[data-action='editPart']").length,
      add: !!el.querySelector("[data-action='addPart']"),
      sentences: el.querySelectorAll("button[data-action='sentence']").length,
      unread: el.querySelectorAll("button[data-action='sentence'].is-unread").length,
      resetAll: !!el.querySelector("[data-action='resetAll']"),
      status: el.querySelector(".acks-extras-recipe-status")?.textContent?.trim() ?? "",
    };
  },
  /** Press, or set, one control of a window: `set` writes a value and fires its change, `tick` a checkbox. */
  act: async ({ title, selector, set, tick, wait }) => {
    const H = globalThis.__br;
    const node = H.root(H.editor(title))?.querySelector(selector);
    if (!node) return { found: false };
    if (set !== undefined && set !== null) {
      node.value = set;
      node.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (tick !== undefined && tick !== null) {
      node.checked = !!tick;
      node.dispatchEvent(new Event("change", { bubbles: true }));
    } else node.click();
    await H.sleep(wait ?? 500);
    return { found: true };
  },
  /** The editor's own context for a window: what the template would render. */
  context: async ({ title }) => {
    const ctx = await globalThis.__br.editor(title)?._prepareContext({});
    return ctx ? { canWrite: !!ctx.canWrite, canResetAll: !!ctx.foot?.canResetAll } : null;
  },
  /** Close the recipe editors, every one of them or one by title. */
  closeEditors: async ({ title }) => {
    const H = globalThis.__br;
    for (const app of H.editors()) if (!title || app.title === title) await app.close({ animate: false }).catch(() => null);
    return H.editors().length;
  },
  /** The window at 460 wide: one column, the body scrolling, the footer in view; then put back. */
  narrow: async ({ title }) => {
    const H = globalThis.__br;
    const app = H.editor(title);
    await app.setPosition({ width: 460, height: 420 });
    await H.sleep(600);
    const el = H.root(app);
    const frame = el.getBoundingClientRect();
    const body = el.querySelector("[data-application-part='body']");
    const foot = el.querySelector("[data-application-part='footer']");
    const col = el.querySelector(".acks-extras-recipe-col");
    const side = el.querySelector(".acks-extras-recipe-side");
    const f = foot?.getBoundingClientRect();
    const out = {
      width: Math.round(frame.width),
      oneColumn: !!col && !!side && Math.abs(col.getBoundingClientRect().left - side.getBoundingClientRect().left) < 6,
      scrolls: !!body && body.scrollHeight > body.clientHeight,
      overflowY: body ? getComputedStyle(body).overflowY : "",
      footVisible: !!f && f.height > 0 && f.top >= frame.top && f.bottom <= frame.bottom + 1,
    };
    await app.setPosition({ width: 900, height: 640 });
    return out;
  },

  /** The faction host's chart opened on its Org chart tab. */
  openChart: async ({ id }) => {
    const sheet = game.actors.get(id).sheet;
    if (sheet.rendered) await sheet.close({ animate: false });
    sheet.tabGroups.primary = "orgChart";
    await sheet.render({ force: true });
    await new Promise((r) => setTimeout(r, 1000));
    return { rendered: sheet.rendered, recipeButton: !!sheet.element?.querySelector("[data-action='orgRecipe']") };
  },
  /** The host's chart seeded with one empty top row whose record names the template and the variant. */
  seedHost: async ({ id, template, variant }) => {
    await game.actors.get(id).update({ "system.units": [{ key: "top", parentKey: "", label: "", holderUuid: "", kind: "", notes: "", hidden: false, gen: { template, variant } }] });
    return game.actors.get(id).system.units.length;
  },
  /** The sheet's Recipe… press, the chart's third door. */
  pressRecipe: async ({ id }) => {
    const btn = game.actors.get(id).sheet.element?.querySelector("[data-action='orgRecipe']");
    if (!btn) return { pressed: false };
    btn.click();
    return { pressed: true };
  },
  /** The sheet of a template, edit mode on, and the door button of one option's row. */
  openTemplateDoor: async ({ uuid, optionKey }) => {
    const H = globalThis.__br;
    const doc = await fromUuid(uuid);
    await doc.sheet.render({ force: true });
    const toggle = await H.poll(() => H.root(doc.sheet)?.querySelector("[data-action='editToggle']"));
    if (!toggle) return { toggled: false };
    toggle.click();
    const button = await H.poll(() => H.root(doc.sheet)?.querySelector(`li.editor-option[data-axis-key='variant'][data-option-key='${optionKey}'] button.acksm-recipe-door`));
    if (!button) return { toggled: true, door: false };
    button.click();
    return { toggled: true, door: true };
  },
  /** The monster's Full sheet on its Ecology tab, and the door button pressed: the real "Organisation…". */
  openEcologyDoor: async ({ uuid }) => {
    const H = globalThis.__br;
    const actor = await fromUuid(uuid);
    const Cls = Object.values(CONFIG.Actor.sheetClasses.monster).map((e) => e.cls).find((c) => c.name === "FullMonsterSheet");
    const app = new Cls({ document: actor });
    (H.sheets = H.sheets ?? []).push(app);
    await app.render(true);
    await app.changeTab("ecology", "primary");
    const btn = await H.poll(() => H.root(app)?.querySelector("button[data-action='organisation']"));
    if (!btn) return { door: false };
    btn.click();
    return { door: true };
  },
  /** The recipe editor through the API, for a seat's window without a button press; answers whether it opened and what it may do. */
  openApi: async ({ subject, optionKey }) => {
    const app = await acksExtras.monsters.openRecipeEditor(subject, optionKey ? { optionKey } : {});
    if (!app) return { opened: false };
    await new Promise((r) => setTimeout(r, 500));
    const ctx = await app._prepareContext({});
    const status = app.element?.querySelector?.(".acks-extras-recipe-status")?.textContent?.trim() ?? "";
    await app.close({ animate: false }).catch(() => null);
    return { opened: true, canWrite: !!ctx.canWrite, status, readOnlyText: game.i18n.localize("ACKS-MONSTERS.recipe.foot.readOnly") };
  },

  /** A library monster to link: the first of the library's monsters, as the editor's link search lists them. */
  libEntry: async () => {
    const H = globalThis.__br;
    await H.LIB.whenReady();
    const a = H.LIB.libraryActors().find((x) => x.type === "monster" && String(x.name ?? "").length >= 4);
    return a ? { uuid: a.uuid, name: a.name } : null;
  },
  /** A Roll through the API, as the chart's Roll calls it; the stacks of every group it made, as stored. */
  roll: async ({ hostId, template, variant, context, state, card }) => {
    const out = await acksExtras.monsters.rollOrganisation({ host: game.actors.get(hostId), rowKey: "top", template, variant, context, state, scope: "below", card });
    const stacks = [];
    for (const uuid of out?.created ?? []) {
      const doc = await fromUuid(uuid).catch(() => null);
      if (doc?.documentName !== "Actor" || !doc.type.endsWith(".group")) continue;
      for (const s of doc.system.stacks ?? []) stacks.push({ group: uuid, key: s.key, part: s.gen?.part ?? "", templateUuid: s.template?.uuid ?? "", templateLabel: s.template?.label ?? "", fixedHp: s.fixedHp ?? null, gen: s.gen ?? null, size: s.size ?? null });
    }
    return { ok: !!out?.ok, reason: out?.reason ?? "", created: out?.created ?? [], pot: out?.pot ?? "", findings: (out?.findings ?? []).map((f) => ({ what: f.what, part: f.part ?? "", label: f.label ?? "" })), stacks };
  },
  /** Stacks of listed groups as they stand now, in the same shape. */
  stacksOf: async ({ groups }) => {
    const stacks = [];
    for (const uuid of groups) {
      const doc = await fromUuid(uuid).catch(() => null);
      for (const s of doc?.system?.stacks ?? []) stacks.push({ group: uuid, key: s.key, part: s.gen?.part ?? "", gen: s.gen ?? null, size: s.size ?? null });
    }
    return stacks;
  },
  /** Chat cards carrying a finding of a kind and a word of the run's own, since a time. */
  cards: async ({ kind, word, since }) =>
    game.messages.filter((m) => m.timestamp >= since && String(m.content ?? "").includes(`data-finding="${kind}"`) && String(m.content ?? "").includes(word)).map((m) => m.uuid),

  /** A user's id by name, and a document's ownership as it stands. */
  userId: async ({ name }) => game.users.find((u) => u.name === name)?.id ?? null,
  ownershipOf: async ({ uuid }) => foundry.utils.deepClone((await fromUuid(uuid)).ownership),
  setOwnership: async ({ uuid, ownership }) => {
    await (await fromUuid(uuid)).update({ ownership }, { diff: false, recursive: false });
    return true;
  },
  /** The monster's Full sheet on a seat, its Ecology door pressed, the editor's window named by its title. */
  playerDoor: async ({ uuid, title }) => {
    const H = globalThis.__br;
    const actor = await fromUuid(uuid);
    if (!actor) return { opened: false, reason: "no actor" };
    const Cls = Object.values(CONFIG.Actor.sheetClasses.monster).map((e) => e.cls).find((c) => c.name === "FullMonsterSheet");
    const app = new Cls({ document: actor });
    (H.sheets = H.sheets ?? []).push(app);
    await app.render(true);
    await app.changeTab("ecology", "primary");
    const btn = await H.poll(() => H.root(app)?.querySelector("button[data-action='organisation']"));
    if (!btn) return { opened: false, reason: "no door button" };
    btn.click();
    const ed = await H.poll(() => H.editor(title));
    return { opened: !!ed, isOwner: !!actor.isOwner, canUpdate: !!actor.canUserModify(game.user, "update") };
  },

  closeAll: async () => {
    for (const app of [...foundry.applications.instances.values()]) { try { await app.close({ animate: false }); } catch { /* closed */ } }
    return true;
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
const stable = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
const bare = (p) => { const { origin: _origin, ...rest } = p ?? {}; return rest; };
const at = (list, key) => (list ?? []).find((p) => p?.key === key) ?? null;
const sameAsCopy = (part, copy) => !!part && !!copy && stable(bare(part)) === stable(bare(copy));

let gm = null;
let player = null;
let monsterUuid = null;
let ownershipBefore = null;
try {
  /* ---------------------------------------------------------------- */
  section("seat and book");
  gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  for (let n = 0; n < 60 && !(await gm.eval("!!globalThis.acksExtras?.importer?.connectBookUrl")); n++) await sleep(1000);
  const seat = await run(gm, P.helpers);
  check("the GM seat is the active GM", seat.isGM && seat.activeGMIsSelf, seat.module);
  if (!seat.activeGMIsSelf) blocked("another GM client is the active GM");
  let mods = await run(gm, P.modules);
  if (!mods.open) {
    const mm = books([BOOK])[0];
    if (!mm) blocked("ACKS_TEST_BOOKS names no path for the Monstrous Manual");
    await run(gm, P.connectBook, mm);
    for (let n = 0; n < 60 && !mods.open; n++) { await sleep(2000); mods = await run(gm, P.bookState, { id: BOOK }); }
  }
  if (!mods.open) blocked("the Monstrous Manual did not open");

  /* ---------------------------------------------------------------- */
  section("fixture: the family template, read from the library and copied");
  const lib = await run(gm, P.template, { family: FAMILY });
  note("library template", { twins: lib.twins, found: !!lib.uuid });
  check("the library holds exactly one template of the family", lib.twins === 1 && !!lib.uuid, { twins: lib.twins });
  if (lib.twins !== 1 || !lib.uuid) blocked("the library does not hold exactly one family template; import it through the entry picker first");
  let variants = await run(gm, P.variants, { uuid: lib.uuid });
  if (!variants.some((v) => v.stamped && v.side)) {
    note("no option of the library template holds stamped parts with a Roll side", "Repair in place on the family row through the entry picker (the importer's own; the library template is written)");
    const repaired = await run(gm, P.repair, { family: FAMILY });
    check("the entry picker ticked the family row and its confirm was answered", repaired.opened && repaired.ticked && repaired.asked, repaired);
    const flown = await until(gm, P.repairDone, null, (r) => r.done, { tries: 480, every: 1000 });
    check("the repair in place returned without an error", flown.done && !flown.error, flown);
    variants = await run(gm, P.variants, { uuid: lib.uuid });
  }
  const chosen = variants.find((v) => v.stamped && v.side && v.side.bodies) ?? variants.find((v) => v.stamped && v.side);
  note("variant options", { count: variants.length, stamped: variants.filter((v) => v.stamped).length, withSide: variants.filter((v) => v.stamped && v.side).length });
  if (!chosen) blocked("no variant option of the family template holds stamped recipe parts with a Roll side a part can join");
  const V = chosen.key;
  const SIDE = chosen.side;
  note("the option walked", { at: chosen.at, parts: chosen.parts, context: SIDE.context, state: SIDE.state, bodiesTop: SIDE.bodies });

  const tCopyData = await run(gm, P.templateCopyData, { uuid: lib.uuid, name: `QA Recipe template${TAG}` });
  const tCopy = await gm.create("Actor", tCopyData);
  note("template copy (tracked, swept)", tCopy.uuid);
  const tStamp = await run(gm, P.stamp, { uuid: tCopy.uuid, source: tCopyData._stats.compendiumSource });
  check("the template copy is stamped as a drag out of the library, so no repair writes it", tStamp.stamped && tStamp.worldCopy, tStamp);
  const copyVariants = await run(gm, P.variants, { uuid: tCopy.uuid });
  check("the copy carries the option with its stamped parts and the Roll side", !!copyVariants.find((v) => v.key === V && v.stamped && v.side), { parts: copyVariants.find((v) => v.key === V)?.parts });
  const T = tCopy.uuid;

  /* ---------------------------------------------------------------- */
  section("fixture: the marked monster, a fresh read of the book into a world copy");
  const standing = await gm.retire(MARKER, "Actor");
  note("the standing import this run replaces", { retired: standing.removed.length, missing: standing.missing.length, failed: standing.failed.length });
  let cand = await run(gm, P.members, { family: FAMILY });
  if (!cand.held.length) {
    note("the library holds no member of the family", `importing ${Math.min(3, cand.members.length)} through the importer's own call (they stay in the library)`);
    await run(gm, P.importIds, { ids: cand.members.slice(0, 3) });
    cand = await run(gm, P.members, { family: FAMILY });
  }
  let built = null;
  for (const id of cand.held.slice(0, 6)) {
    const data = await run(gm, P.copyData, { id, name: `QA Recipe monster${TAG}` });
    if (!data) continue;
    const made = await gm.create("Actor", data);
    const stamp = await run(gm, P.stamp, { uuid: made.uuid, source: data._stats.compendiumSource });
    if (!stamp.stamped || !stamp.worldCopy) note("the candidate's source stamp did not stand", stamp);
    const filled = await run(gm, P.refill, { uuid: made.uuid });
    const usable = filled.ok && filled.n >= 2 && filled.allRegister && filled.copyN === filled.n && filled.countable >= 1;
    note("candidate member", { ok: filled.ok, reason: filled.reason, parts: filled.n, copy: filled.copyN, allRegister: filled.allRegister, countable: filled.countable, usable });
    if (usable) { built = { uuid: made.uuid, filled }; break; }
    note("candidate swept", await gm.sweepTracked({ only: [made.uuid] }));
  }
  if (!built) blocked("no family member read into a recipe of two or more parts with a count of its own, every part stamped register beside its read copy");
  monsterUuid = built.uuid;
  await gm.mark(monsterUuid, MARKER);
  note("monster", { marker: MARKER, uuid: monsterUuid, parts: built.filled.n });
  check("a fresh read stamped every part register and stored the read copy beside it", built.filled.allRegister && built.filled.copyN === built.filled.n, { parts: built.filled.n });

  /* ---------------------------------------------------------------- */
  section("fixture: a faction host, and a group rolled before any edit");
  const host = await gm.create("Actor", { name: `QA Recipe host${TAG}`, type: "acks-extras.faction", items: [] });
  note("host (tracked, swept)", host.uuid);
  const H_ID = host.id;
  const rollOnce = async ({ card = false } = {}) => {
    await run(gm, P.seedHost, { id: H_ID, template: T, variant: V });
    const since = Date.now() - 1000;
    const result = await run(gm, P.roll, { hostId: H_ID, template: T, variant: V, context: SIDE.context, state: SIDE.state, card });
    for (const u of result.created) gm.track(u);
    if (result.pot) gm.track(result.pot);
    return { ...result, since };
  };
  const baseline = await rollOnce();
  check("the baseline Roll before any edit made a group", baseline.ok && baseline.stacks.length > 0, { ok: baseline.ok, reason: baseline.reason, created: baseline.created.length, stacks: baseline.stacks.length });
  if (!baseline.ok || !baseline.stacks.length) blocked(`the baseline Roll of the chosen option made nothing (${baseline.reason})`);
  const baselineGroups = [...new Set(baseline.stacks.map((s) => s.group))];
  const baselineFingerprint = stable(baseline.stacks.map((s) => ({ group: s.group, key: s.key, part: s.part, gen: s.gen, size: s.size })));

  /* ---------------------------------------------------------------- */
  section("the library template's lock, recorded");
  const libLock = await run(gm, P.lockOf, { uuid: lib.uuid });
  const copyLock = await run(gm, P.lockOf, { uuid: T });
  note("the library family template (what a chart host names after a plain import)", libLock);
  note("the run's copy of it (what this run's host names)", copyLock);
  note("finding", libLock.packLocked ? "the library template's pack is LOCKED: a chart host naming it opens the editor read-only until a Judge unlocks the pack" : libLock.canUpdate ? "the library template is editable by this seat: its pack is not locked" : "the library template is not updatable by this seat");
  const libApi = await run(gm, P.openApi, { subject: lib.uuid, optionKey: V });
  check("the editor opened on the library template's option agrees with Foundry's lock: writable exactly where the pack is unlocked and the seat may update", libApi.opened && libApi.canWrite === (!libLock.packLocked && libLock.canUpdate) && (libApi.status === libApi.readOnlyText) === !libApi.canWrite, { canWrite: libApi.canWrite, packLocked: libLock.packLocked, canUpdate: libLock.canUpdate });
  check("the run's copy is editable, so its edits land", copyLock.inPack === false && copyLock.canUpdate, copyLock);

  /* ---------------------------------------------------------------- */
  section("1. three doors");
  const monsterNames = await run(gm, P.names, { uuid: monsterUuid, optionKey: "" });
  const sayMonster = await run(gm, P.say, { name: monsterNames.name, hand: 0, all: 0, cite: "" });
  const tNames = await run(gm, P.names, { uuid: T, optionKey: V });
  const sayOption = await run(gm, P.say, { name: tNames.name, option: tNames.option, hand: 0, all: 0, cite: "" });

  const door1 = await run(gm, P.openEcologyDoor, { uuid: monsterUuid });
  const snap1 = await until(gm, P.snap, { title: sayMonster.title }, (s) => s.found);
  check("the Ecology tab's Organisation… opens a window headed Recipe · <the monster>", door1.door && snap1.found && snap1.header === sayMonster.title, { door: door1.door, found: snap1.found });
  await run(gm, P.closeEditors, { title: sayMonster.title });

  const door2 = await run(gm, P.openTemplateDoor, { uuid: T, optionKey: V });
  const snap2 = await until(gm, P.snap, { title: sayOption.title }, (s) => s.found);
  check("the template sheet's Edit structure shows Recipe… on the variant option, and it opens a window headed Recipe · <template> · <option>", door2.toggled && door2.door && snap2.found && snap2.header === sayOption.title, door2);
  await run(gm, P.closeEditors, { title: sayOption.title });
  await gm.eval(`fromUuid(${JSON.stringify(T)}).then((d) => d?.sheet?.close({ animate: false })).then(() => true)`).catch(() => null);

  await run(gm, P.seedHost, { id: H_ID, template: T, variant: V });
  const chart = await run(gm, P.openChart, { id: H_ID });
  check("the chart's tool row offers Recipe… on a host whose top row names the template", chart.rendered && chart.recipeButton, chart);
  const door3 = await run(gm, P.pressRecipe, { id: H_ID });
  const snap3 = await until(gm, P.snap, { title: sayOption.title }, (s) => s.found);
  check("the chart's Recipe… opens the option the host's record names, headed Recipe · <template> · <option>", door3.pressed && snap3.found && snap3.header === sayOption.title, { found: snap3.found });
  note("the chart door's window stays open for steps 5, 6, 8 and 9", "yes");
  const OPTION_TITLE = sayOption.title;

  /* ---------------------------------------------------------------- */
  section("2. hand mark, on the monster's own recipe");
  const M_TITLE = sayMonster.title;
  await run(gm, P.openApi, { subject: monsterUuid }); // opens and closes: proves the API door; the walk's window follows
  await gm.eval(`acksExtras.monsters.openRecipeEditor(${JSON.stringify(monsterUuid)}).then(() => true)`);
  await until(gm, P.snap, { title: M_TITLE }, (s) => s.found);
  const pick = await run(gm, P.pick, { uuid: monsterUuid, optionKey: "" });
  check("a part with a count of its own is there to change", !!pick, pick ? { at: pick.at } : null);
  if (!pick) blocked("the monster's recipe holds no part with a count of its own");
  const K = pick.key;
  const rowSel = (key) => `li.acks-extras-recipe-item[data-key="${key}"]`;
  const ensureTab = async (title, state) => {
    const s = await run(gm, P.snap, { title });
    if (s.tabOn !== state) await run(gm, P.act, { title, selector: `button[data-action='state'][data-state='${state}']` });
  };
  const ensureOpen = async (title, key) => {
    const s = await run(gm, P.snap, { title });
    if (!s.rows.find((r) => r.key === key)?.open) await run(gm, P.act, { title, selector: `${rowSel(key)} [data-action='editPart']` });
    return until(gm, P.snap, { title }, (x) => x.rows.find((r) => r.key === key)?.open);
  };
  const storedPart = async (uuid, optionKey, key) => at((await run(gm, P.stored, { uuid, optionKey })).recipe, key);
  await ensureTab(M_TITLE, pick.tab);
  await ensureOpen(M_TITLE, K);
  await run(gm, P.act, { title: M_TITLE, selector: `${rowSel(K)} [data-field='count']`, set: pick.figure });
  const after2 = await until(gm, P.stored, { uuid: monsterUuid, optionKey: "" }, (s) => at(s.recipe, K)?.origin === "");
  const part2 = at(after2.recipe, K);
  const copy2 = at(after2.copy, K);
  check("the changed part's origin is blank and every other part's is register", part2?.origin === "" && after2.recipe.filter((p) => p.key !== K).every((p) => p.origin === "register"), { parts: after2.recipe.length });
  const snapHand = await until(gm, P.snap, { title: M_TITLE }, (s) => s.rows.find((r) => r.key === K)?.hand);
  const sayHand = await run(gm, P.say, { name: monsterNames.name, hand: 1, all: after2.recipe.length, cite: monsterNames.cite });
  check("the head reads 1 of N changed by hand", sayHand.heads.includes(snapHand.hint), { hint: snapHand.hint === sayHand.heads[0] ? "with page" : snapHand.hint === sayHand.heads[1] ? "no page" : "other" });
  const rowHand = snapHand.rows.find((r) => r.key === K);
  check("the row wears is-hand", rowHand?.hand === true);
  const readFigure = String(copy2?.count?.dice || copy2?.count?.literal || "");
  check("its tooltip names what the import read, with the page reference", !!readFigure && rowHand.tip.includes(readFigure) && (!copy2.cite || rowHand.tip.includes(copy2.cite)), { names: !!readFigure && rowHand.tip.includes(readFigure), page: !copy2?.cite || rowHand.tip.includes(copy2.cite) });

  /* ---------------------------------------------------------------- */
  section("3. Reset this part");
  await ensureOpen(M_TITLE, K);
  await run(gm, P.act, { title: M_TITLE, selector: `${rowSel(K)} [data-action='resetPart']` });
  const after3 = await until(gm, P.stored, { uuid: monsterUuid, optionKey: "" }, (s) => at(s.recipe, K)?.origin === "register");
  check("the origin is back to register and the part equals the read copy", at(after3.recipe, K)?.origin === "register" && sameAsCopy(at(after3.recipe, K), at(after3.copy, K)));
  const snap3b = await until(gm, P.snap, { title: M_TITLE }, (s) => s.rows.find((r) => r.key === K)?.hand === false);
  const say0 = await run(gm, P.say, { name: monsterNames.name, hand: 0, all: after3.recipe.length, cite: monsterNames.cite });
  check("the head reads 0 of N", say0.heads.includes(snap3b.hint), { rowHand: snap3b.rows.find((r) => r.key === K)?.hand });

  /* ---------------------------------------------------------------- */
  section("4. add from a sentence");
  const unreadNow = (await run(gm, P.snap, { title: M_TITLE })).unread;
  check("the reading pane lists a sentence no part read", unreadNow > 0, { unread: unreadNow });
  let judgeKey = "";
  if (unreadNow > 0) {
    const keysBefore = new Set(after3.recipe.map((p) => p.key));
    await run(gm, P.act, { title: M_TITLE, selector: "button[data-action='sentence'].is-unread" });
    const after4 = await until(gm, P.stored, { uuid: monsterUuid, optionKey: "" }, (s) => s.recipe.some((p) => !keysBefore.has(p.key)));
    const made = after4.recipe.find((p) => !keysBefore.has(p.key));
    judgeKey = made?.key ?? "";
    check("a Judge part `_…` stands with a blank origin", judgeKey.startsWith("_") && made.origin === "", { added: after4.recipe.length - after3.recipe.length });
    const snap4 = await until(gm, P.snap, { title: M_TITLE }, (s) => s.rows.some((r) => r.key === judgeKey));
    const row4 = snap4.rows.find((r) => r.key === judgeKey);
    check("its row shows the role in muted text", row4?.muted === true && row4.name === sayMonster.noRole, { muted: row4?.muted });
  }

  /* ---------------------------------------------------------------- */
  section("5. Mount, unlinked, then linked, on the option the chart door opened");
  const LABEL = `QA Recipe mount${TAG}`;
  await ensureTab(OPTION_TITLE, SIDE.state);
  const optBefore = await run(gm, P.stored, { uuid: T, optionKey: V });
  const optKeys = new Set(optBefore.recipe.map((p) => p.key));
  await run(gm, P.act, { title: OPTION_TITLE, selector: "[data-action='addPart']" });
  const optAdded = await until(gm, P.stored, { uuid: T, optionKey: V }, (s) => s.recipe.some((p) => !optKeys.has(p.key)));
  const PK = optAdded.recipe.find((p) => !optKeys.has(p.key))?.key ?? "";
  check("Add a part stands a Judge part in the option's recipe", PK.startsWith("_"), { added: optAdded.recipe.length - optBefore.recipe.length });
  const setField = async (field, value, pred) => {
    await ensureOpen(OPTION_TITLE, PK);
    await run(gm, P.act, { title: OPTION_TITLE, selector: `${rowSel(PK)} [data-field='${field}']`, set: value });
    return until(gm, P.stored, { uuid: T, optionKey: V }, (s) => pred(at(s.recipe, PK)));
  };
  await setField("label", LABEL, (p) => p?.label === LABEL);
  await setField("role", "mount", (p) => p?.role === "mount");
  await setField("count", "1", (p) => p?.count?.literal === 1);
  await ensureOpen(OPTION_TITLE, PK);
  await run(gm, P.act, { title: OPTION_TITLE, selector: `${rowSel(PK)} [data-field='unit'][data-word="${SIDE.word}"]`, tick: true });
  const ready = await until(gm, P.stored, { uuid: T, optionKey: V }, (s) => (at(s.recipe, PK)?.when?.units ?? []).map((u) => u.toLowerCase()).includes(SIDE.word));
  const readyPart = at(ready.recipe, PK);
  check("the Judge part reads Mount, 1, named, with the top unit's word ticked", readyPart?.role === "mount" && readyPart.label === LABEL && (readyPart.when?.units ?? []).length > 0 && !readyPart.source?.uuid, { units: readyPart?.when?.units?.length ?? 0 });

  const unlinked = await rollOnce({ card: true });
  const stackU = unlinked.stacks.find((s) => s.part === PK);
  note("the unlinked Roll", { ok: unlinked.ok, reason: unlinked.reason, created: unlinked.created.length, findings: unlinked.findings.map((f) => f.what), hasStack: !!stackU });
  check("a Roll for the Mount part with no link made a labelled stack named by the part's Label", unlinked.ok && !!stackU && !stackU.templateUuid && stackU.templateLabel === LABEL, { ok: unlinked.ok, reason: unlinked.reason, stack: !!stackU });
  check("its finding is of kind unlinked, naming the part", unlinked.findings.some((f) => f.what === "unlinked" && f.part === PK && f.label === LABEL), unlinked.findings.map((f) => f.what));
  const unlinkedCards = await run(gm, P.cards, { kind: "unlinked", word: LABEL, since: unlinked.since });
  for (const u of unlinkedCards) gm.track(u);
  check("the Judges' card lists the unlinked finding", unlinkedCards.length >= 1, { cards: unlinkedCards.length });

  const entry = await run(gm, P.libEntry);
  check("the library has a monster entry to link", !!entry, entry ? { uuid: entry.uuid } : null);
  if (entry) {
    await ensureOpen(OPTION_TITLE, PK);
    await run(gm, P.act, { title: OPTION_TITLE, selector: `${rowSel(PK)} [data-field='linkQuery']`, set: entry.name.toLowerCase() });
    const offered = await until(gm, P.snap, { title: OPTION_TITLE }, (s) => (s.rows.find((r) => r.key === PK)?.linkButtons ?? []).includes(entry.uuid));
    check("the link search offers the entry", (offered.rows.find((r) => r.key === PK)?.linkButtons ?? []).includes(entry.uuid));
    await run(gm, P.act, { title: OPTION_TITLE, selector: `${rowSel(PK)} [data-action='linkEntry'][data-uuid="${entry.uuid}"]` });
    const linked = await until(gm, P.stored, { uuid: T, optionKey: V }, (s) => at(s.recipe, PK)?.source?.uuid === entry.uuid);
    check("Link writes the entry's uuid into the part", at(linked.recipe, PK)?.source?.uuid === entry.uuid);
    const roll2 = await rollOnce();
    const stackL = roll2.stacks.find((s) => s.part === PK);
    check("a Roll after the Link makes a stack whose template is that entry", roll2.ok && stackL?.templateUuid === entry.uuid, { ok: roll2.ok, stack: !!stackL });

    /* -------------------------------------------------------------- */
    section("6. fixedHp on an entry stack");
    const FIXED = 13;
    await setField("fixedHp", String(FIXED), (p) => p?.fixedHp === FIXED);
    const roll3 = await rollOnce();
    const stackF = roll3.stacks.find((s) => s.part === PK);
    check("the made stack's fixedHp equals the figure typed", roll3.ok && stackF?.templateUuid === entry.uuid && stackF.fixedHp === FIXED, { ok: roll3.ok, fixedHp: stackF?.fixedHp ?? null });
    note("not asserted", "a labelled stack drops fixedHp (T-0852)");
  }

  /* ---------------------------------------------------------------- */
  section("7. Repair keeps the hand part");
  await ensureTab(M_TITLE, pick.tab);
  await ensureOpen(M_TITLE, K);
  await run(gm, P.act, { title: M_TITLE, selector: `${rowSel(K)} [data-field='count']`, set: pick.figure });
  const before7 = await until(gm, P.stored, { uuid: monsterUuid, optionKey: "" }, (s) => at(s.recipe, K)?.origin === "");
  const handBefore = stable(at(before7.recipe, K));
  const judgeBefore = judgeKey ? stable(at(before7.recipe, judgeKey)) : null;
  const filled7 = await run(gm, P.refill, { uuid: monsterUuid });
  const after7 = await run(gm, P.stored, { uuid: monsterUuid, optionKey: "" });
  check("the importer's repair of the monster in place wrote", filled7.ok, { reason: filled7.reason });
  check("the hand-changed part stands as it was", stable(at(after7.recipe, K)) === handBefore && at(after7.recipe, K)?.origin === "");
  if (judgeKey) check("the Judge's part stands as it was", stable(at(after7.recipe, judgeKey)) === judgeBefore);
  const untouched = after7.recipe.filter((p) => p.key !== K && p.key !== judgeKey && p.origin === "register");
  check("every untouched part equals the read copy", untouched.length > 0 && untouched.every((p) => sameAsCopy(p, at(after7.copy, p.key))), { untouched: untouched.length });
  note("not walked", "the picker's own Repair in place on a world copy: a copy is passed by, so the walk calls the refill the picker runs for a stat-block monster");

  /* ---------------------------------------------------------------- */
  section("8. a group rolled before the edits keeps its figures");
  const nowStacks = await run(gm, P.stacksOf, { groups: baselineGroups });
  check("the baseline group's stacks read the gen and size they were rolled with", stable(nowStacks.map((s) => ({ group: s.group, key: s.key, part: s.part, gen: s.gen, size: s.size }))) === baselineFingerprint, { stacks: nowStacks.length });

  /* ---------------------------------------------------------------- */
  section("9. narrow");
  const narrow = await run(gm, P.narrow, { title: OPTION_TITLE });
  check("at 460 wide the window is one column", narrow.oneColumn && narrow.width <= 480, narrow);
  check("the body scrolls: its scrollHeight exceeds its clientHeight, overflow-y auto", narrow.scrolls && ["auto", "scroll"].includes(narrow.overflowY), narrow);
  check("the footer stays visible", narrow.footVisible, narrow);

  /* ---------------------------------------------------------------- */
  section("10. the Player seat");
  const uid = await run(gm, P.userId, { name: MACHINE.player });
  if (!uid) blocked("the Player seat's user was not found in the world");
  ownershipBefore = await run(gm, P.ownershipOf, { uuid: monsterUuid });
  player = await connect({ browser, origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  const pseat = await run(player, P.helpers);
  check("the second seat is a Player, not the GM", !pseat.isGM && pseat.role < 3, { role: pseat.role });
  if (pseat.isGM) blocked("the second seat is a GM");
  const own = (level) => ({ ...ownershipBefore, default: ownershipBefore.default ?? 0, [uid]: level });
  const seen = async () => {
    await run(player, P.closeEditors, {});
    const door = await run(player, P.playerDoor, { uuid: monsterUuid, title: M_TITLE });
    const snap = await until(player, P.snap, { title: M_TITLE }, (s) => s.found);
    const ctx = await run(player, P.context, { title: M_TITLE });
    return { door, snap, ctx };
  };
  await run(gm, P.setOwnership, { uuid: monsterUuid, ownership: own(OBSERVER) });
  await sleep(1500);
  const ro = await seen();
  check("a seat that does not own the monster gets the window read-only: no pen, no Add a part, no sentence button, no Reset all, the read-only line", ro.door.opened && ro.door.isOwner === false && ro.ctx?.canWrite === false && ro.snap.pens === 0 && !ro.snap.add && ro.snap.sentences === 0 && !ro.snap.resetAll && ro.snap.status === sayMonster.readOnly, { owner: ro.door.isOwner, canWrite: ro.ctx?.canWrite, pens: ro.snap.pens, add: ro.snap.add, sentences: ro.snap.sentences, resetAll: ro.snap.resetAll, status: ro.snap.status === sayMonster.readOnly });
  check("the rows still draw for it", ro.snap.rows.length > 0, { rows: ro.snap.rows.length });
  await run(gm, P.setOwnership, { uuid: monsterUuid, ownership: own(OWNER) });
  await sleep(1500);
  const rw = await seen();
  check("a seat that owns the monster has the controls: a pen on its rows, Add a part, sentence buttons", rw.door.opened && rw.door.isOwner === true && rw.ctx?.canWrite === true && rw.snap.pens > 0 && rw.snap.add && rw.snap.sentences > 0, { owner: rw.door.isOwner, canWrite: rw.ctx?.canWrite, pens: rw.snap.pens, add: rw.snap.add, sentences: rw.snap.sentences });
  await run(player, P.closeAll);

  /* ---------------------------------------------------------------- */
  section("11. Reset all");
  const hasMonsterWindow = (await run(gm, P.snap, { title: M_TITLE })).found;
  if (!hasMonsterWindow) await gm.eval(`acksExtras.monsters.openRecipeEditor(${JSON.stringify(monsterUuid)}).then(() => true)`);
  const s11 = await until(gm, P.snap, { title: M_TITLE }, (s) => s.found && s.resetAll);
  check("Reset all is offered while a part is held by a hand", s11.found && s11.resetAll, { resetAll: s11.resetAll });
  await run(gm, P.act, { title: M_TITLE, selector: "[data-action='resetAll']" });
  const after11 = await until(gm, P.stored, { uuid: monsterUuid, optionKey: "" }, (s) => s.recipe.length === s.copy.length && s.recipe.every((p) => p.origin === "register"));
  check("the recipe equals the read copy", after11.recipe.length === after11.copy.length && after11.recipe.every((p, i) => sameAsCopy(p, at(after11.copy, p.key)) && p.key === after11.copy[i]?.key), { parts: after11.recipe.length });
  check("the Judge's part is gone", !judgeKey || !at(after11.recipe, judgeKey));
  const snap11 = await until(gm, P.snap, { title: M_TITLE }, (s) => s.found && !s.resetAll);
  const say11 = await run(gm, P.say, { name: monsterNames.name, hand: 0, all: after11.recipe.length, cite: monsterNames.cite });
  check("the head reads 0 of N", say11.heads.includes(snap11.hint));

  walkDone();
} catch (err) {
  if (err?.name !== "WalkBlocked") {
    console.log(`WALK ERROR: ${err?.message ?? err}`);
    console.error(err?.stack ?? err);
    checks.push(["the walk ran to its end", false]);
    process.exitCode = 1;
  }
} finally {
  section("teardown");
  if (player) {
    try { await run(player, P.closeAll); } catch { /* page gone */ }
    try { player.close(); } catch { /* closed */ }
  }
  if (gm) {
    try { if (monsterUuid && ownershipBefore) await run(gm, P.setOwnership, { uuid: monsterUuid, ownership: ownershipBefore }); } catch (err) { console.error("ownership:", err?.message ?? err); }
    try { await run(gm, P.closeAll); } catch { /* page gone */ }
    // The marked monster stays as a kept fixture; only what this run made without a marker goes.
    const disposable = gm.tracked().filter((e) => !e.marker).map((e) => e.uuid);
    try { note("swept", await gm.sweepTracked({ only: disposable })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  }
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`\nchecks: ${passed} passed, ${checks.length - passed} failed`);
  if (checks.some(([, ok]) => !ok)) process.exitCode = 1;
  try { gm?.close(); } catch { /* closed */ }
}
