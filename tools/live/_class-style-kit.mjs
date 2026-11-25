/**
 * The shared half of the walks `equipment-inherited-style.mjs` and
 * `classes-typed-name.mjs`: the check printer, the driver-side plumbing (`run`,
 * `until`, `ready`) and the page-side functions both walks run on the GM seat
 * (`P`, installed under `globalThis.__cs`). A walk spreads `P` into its own page
 * functions and adds the ones only it needs. The underscore keeps the runner
 * and the walk-end gate from taking this file for a walk. Nothing here names a
 * path, a port, a world, a user or a book: the machine's values arrive through
 * ./_env.mjs, and the class a walk drives is looked up in the world at run time
 * by what its training effect grants (`P.findClass`), never by a name.
 *
 * A class is applied the way a user applies one: the class picker window is
 * opened on it (`openClassPickerFor`, the route a class dropped on a sheet
 * takes), its Apply button is pressed, and a damage-bonus election dialog the
 * apply raises is answered through its own OK button.
 */
import { sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";

export { PORTS, sleep };
export const MACHINE = machineSeats();

export const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
export const section = (title) => console.log(`\n== ${title} ==`);
export const checks = [];
export const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};
export const idOf = (doc) => doc.id ?? String(doc.uuid).split(".").pop();

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in the seat's page. */
/* ------------------------------------------------------------------ */
export const P = {
  install: async () => {
    const H = (globalThis.__cs = globalThis.__cs ?? {});
    H.base = "/modules/acks-extras/scripts/";
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 40, every = 200 } = {}) => {
      for (let n = 0; n < tries; n++) {
        const v = await fn();
        if (v) return v;
        await H.sleep(every);
      }
      return null;
    };
    H.root = (app) => (app?.element?.nodeType === 1 ? app.element : app?.element?.[0] ?? null);
    H.sheetCls = () => Object.values(CONFIG.Actor.sheetClasses.character).find((e) => e.cls?.name === "AcksCharacterSheet")?.cls;
    H.sheetOf = (actor) => [...foundry.applications.instances.values()].find((a) => a.document === actor && a.constructor === H.sheetCls());
    await (await import(`${H.base}equipment/weapon-rows.mjs`)).rowsReady();
    if (!H.patched) {
      H.patched = true;
      H.errors = [];
      H.cards = [];
      H.consoleError = console.error;
      console.error = (...args) => { H.errors.push(args.map((a) => a?.message ?? String(a)).join(" ").slice(0, 300)); H.consoleError(...args); };
      H.hook = Hooks.on("createChatMessage", (m) => { if (m.author?.id === game.user.id) H.cards.push({ id: m.id, actor: m.speaker?.actor ?? null }); });
    }
    return { isGM: game.user.isGM, activeGMIsSelf: !!game.users.activeGM?.isSelf, picker: typeof acksExtras?.classes?.openClassPicker === "function" };
  },
  /** Set the proficiency enforcement mode (null reads it); returns the mode before the write. */
  setting: async ({ value }) => {
    const prior = game.settings.get("acks-extras", "proficiencyEnforcement");
    if (value != null && value !== prior) await game.settings.set("acks-extras", "proficiencyEnforcement", value);
    return prior;
  },
  /**
   * The library's classes that carry a training effect and are not stubs, read
   * at run time: the first one granting `style` (folded to letters), chosen
   * without a damage-bonus election where one exists, and any class at all as a
   * fallback. Names stay in the page; only a uuid, a key and the style tokens
   * come back.
   */
  findClass: async ({ style }) => {
    const H = globalThis.__cs;
    await (await import(`${H.base}lib/library.mjs`)).whenReady();
    const REG = await import(`${H.base}classes/registry.mjs`);
    const TL = await import(`${H.base}classes/training-logic.mjs`);
    const AP = await import(`${H.base}classes/apply.mjs`);
    const fold = (s) => String(s ?? "").toLowerCase().replace(/[^a-z]/g, "");
    const rows = [];
    for (const cls of REG.classItems()) {
      if (!cls?.system || cls.system.isStub !== false) continue;
      const effect = TL.classTrainingEffect(cls);
      const styles = effect ? TL.trainingOf(effect.changes).styles : [];
      const ladder = AP.damageBonusLadder(cls);
      rows.push({ uuid: cls.uuid, key: cls.system.key || String(cls.name ?? "").toLowerCase(), styles, grants: styles.map(fold).includes(fold(style)), election: !!ladder && !ladder.scope });
    }
    rows.sort((a, b) => Number(a.election) - Number(b.election) || a.key.localeCompare(b.key));
    const pick = rows.find((r) => r.grants) ?? rows[0] ?? null;
    return { classes: rows.length, granting: rows.filter((r) => r.grants).length, pick };
  },
  /** The class document's name, for the typed class field (never printed). */
  nameOf: async ({ uuid }) => (await fromUuid(uuid))?.name ?? null,
  /**
   * A character with no class: the module's training effects off, the class
   * ledger and the style override unset, level 1, the typed class field set to
   * `typedClass`, and every weapon and shield on it equipped.
   */
  reset: async ({ actorId, typedClass = "" }) => {
    const H = globalThis.__cs;
    const actor = game.actors.get(actorId);
    const stale = actor.effects.filter((e) => e.getFlag("acks-extras", "fromClass")).map((e) => e.id);
    if (stale.length) await actor.deleteEmbeddedDocuments("ActiveEffect", stale);
    for (const flag of ["classes", "activeStyle"]) if (actor.getFlag("acks-extras", flag) !== undefined) await actor.unsetFlag("acks-extras", flag);
    await actor.update({ "system.details.class": typedClass, "system.details.level": 1 });
    for (const item of actor.items.filter((i) => i.type === "weapon" || i.type === "armor")) if (!item.system.equipped) await item.update({ "system.equipped": true });
    await H.sleep(600);
    return { staleEffects: stale.length, ledger: actor.getFlag("acks-extras", "classes") === undefined, typed: String(actor.system.details.class ?? "") === typedClass };
  },
  /**
   * The class picker as a class dropped on a sheet opens it, Apply pressed. A
   * damage-bonus election dialog is answered through its OK button. Bounded:
   * a picker still open at the end is reported with the windows that are.
   */
  applyViaPicker: async ({ actorId, classUuid }) => {
    const H = globalThis.__cs;
    const actor = game.actors.get(actorId);
    const cls = await fromUuid(classUuid);
    const AA = await import(`${H.base}classes/assign-app.mjs`);
    for (const app of foundry.applications.instances.values()) if (H.root(app)?.classList?.contains("acks-extras-classes-assign")) await app.close({ animate: false });
    const app = await AA.openClassPickerFor(actor, cls);
    const root = await H.poll(() => (H.root(app)?.querySelector('footer button[type="submit"]') ? H.root(app) : null), { tries: 60 });
    if (!root) return { opened: false };
    const onClass = app.binding.classUuid === cls.uuid;
    root.querySelector('footer button[type="submit"]').click();
    let answered = false;
    let closed = false;
    for (let n = 0; n < 80 && !closed; n++) {
      for (const select of document.querySelectorAll('.application select[name="applies"]')) {
        const ok = select.closest(".application")?.querySelector('button[data-action="ok"]');
        if (ok) { ok.click(); answered = true; }
      }
      closed = !foundry.applications.instances.has(app.id);
      if (!closed) await H.sleep(250);
    }
    const landed = await H.poll(() => actor.getFlag("acks-extras", "classes")?.uuid === cls.uuid, { tries: 40 });
    await H.sleep(800);
    return { opened: true, onClass, closed, answeredElection: answered, landed: !!landed, open: closed ? [] : [...foundry.applications.instances.values()].map((a) => a.constructor.name) };
  },
  /** The loadout as the module reads it, with the gear it read. */
  loadout: async ({ actorId }) => {
    const H = globalThis.__cs;
    const L = await import(`${H.base}equipment/loadout.mjs`);
    const actor = game.actors.get(actorId);
    const lo = L.getLoadout(actor);
    return {
      activeStyle: lo.activeStyle,
      styleProficient: lo.styleProficient,
      nonProficientUse: lo.nonProficientUse,
      trained: [...L.trainedStyles(actor)].sort(),
      violations: lo.violations.map((v) => v.type),
      weapons: lo.weapons.length,
      shields: lo.shields.length,
      gear: actor.items.filter((i) => i.system?.equipped).map((i) => ({ type: i.type, kind: i.system?.type ?? null })),
    };
  },
  /** The actor's own training effects, by style token. */
  trainingEffects: async ({ actorId }) => game.actors.get(actorId).effects.filter((e) => e.getFlag("acks-extras", "fromClass")).map((e) => ({ disabled: !!e.disabled, styles: e.changes.filter((c) => c.key === "flags.acks-extras.styleProficient").map((c) => String(c.value)) })),
  /** Cards this client made that speak as one of `actorIds`, by id. */
  cardsFor: async ({ actorIds }) => globalThis.__cs.cards.filter((c) => actorIds.includes(c.actor)).map((c) => c.id),
  closeSheets: async ({ actorIds }) => {
    const H = globalThis.__cs;
    for (const id of actorIds) {
      const actor = game.actors.get(id);
      await H.sheetOf(actor)?.close({ animate: false });
      for (const item of actor?.items ?? []) await item.sheet?.close({ animate: false });
    }
    return true;
  },
  drain: async () => ({ errors: globalThis.__cs.errors.slice() }),
  restore: async () => {
    const H = globalThis.__cs;
    if (!H?.patched) return "never installed";
    console.error = H.consoleError;
    Hooks.off("createChatMessage", H.hook);
    H.patched = false;
    return "restored";
  },
};

/* ------------------------------------------------------------------ */
/*  Driver side                                                         */
/* ------------------------------------------------------------------ */
/** Run a page function on a seat and parse what it resolves to. */
export async function run(api, fn, ...args) {
  const text = await api.eval(`(${fn.toString()})(...${JSON.stringify(args)}).then((v) => JSON.stringify(v === undefined ? null : v))`);
  return JSON.parse(text);
}

/** Read a page function until `test` passes, or give back the last reading. */
export async function until(api, fn, arg, test, { tries = 40, every = 250 } = {}) {
  let last = null;
  for (let n = 0; n < tries; n++) {
    last = await run(api, fn, arg);
    if (test(last)) return { ok: true, value: last };
    await sleep(every);
  }
  return { ok: false, value: last };
}

/** Wait for the world to be ready with the module's `needs` expression true. */
export async function ready(api, label, needs = "!!globalThis.acksExtras?.equipment && !!globalThis.acksExtras?.classes?.applyClass", seconds = 240) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && ${needs}`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}
