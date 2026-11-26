/**
 * Live walk, formation-kit-cast-light: casting a light spell from the Party
 * sheet's Kit tab, from a real Player seat and the Judge's. Walks
 * docs/formation/TESTING.md "Casting a light spell from the Kit tab", whose
 * step numbers are this walk's ids (K-c1 to K-c12): the offer row (one option per
 * spell the seat owns, its list and slots line and their tooltips); Cast opening
 * the caster's own cast window and the confirmed cast writing lib's three band
 * changes and the page flag on the caster's record, which the Kit lists as a
 * Shining magic-light row whose tooltip names the spell and its page; the
 * Shutter on that row and the caster's shed light (and a deployed token's);
 * a spent-out list refusing a Player's Cast with the Magic tab's sentence while
 * the Judge reads it as a warning and may still cast; a reversed cast writing no
 * light; a spell whose radii are blank leaving a blank reach cell with the page
 * alone as its tooltip; the clock running past the duration and taking the
 * record and the row; the effect-row editor's three radius boxes, a blank
 * one carrying the page alone as its tooltip; and K-c10, where the blank-banded
 * cast of K-c7 (a real cast, never bands typed by API: the typed-band steps stay
 * for the figure readers) is the party's light on the dark scene, read by the
 * model, the warnings and the header cell, uncounted while shuttered, and the
 * row's Set reach shown to the Judge's seat and not the Player's. K-c11 reads the Judge's own imported illumination spells (never imported by the walk: a seat with none skips) and casts each from the Kit tab, the record's bands, cite and the Kit row read against the copy's own imported row; K-c12 reads the Light here line on both seats against a placed light (marker `formation/daylight-ambient`, far from the party's home square) whose Daylight radius flag is written by a document update, a lit token the Player may not observe, the scene's sky, a hidden token and a journey. Prints booleans and the
 * fixtures' invented labels. Machine values arrive through ./_env.mjs.
 *
 * Fixtures, kept and found by marker (the GM seat builds them; every name and
 * figure is invented): `formation/kit-cast-scene` (a room), the party
 * `formation/kit-cast-party` with its token `formation/kit-cast-token`, the class
 * `formation/kit-cast-class` (one list, one first-level slot), the member
 * `formation/kit-cast-caster` (the Player owns it, bound to the class) with its
 * spell `formation/kit-cast-spell`, and the member `formation/kit-cast-other`
 * (the Player only observes it, bound to the same class) with its own copy
 * `formation/kit-cast-other-spell`. Each step that needs a known shape writes it
 * at its start (`P.shape`): the class's casting row, both members' binding,
 * level, ownership and pools, both spells' flags and counts. The run's own
 * documents (every cast's chat card and record, the token a deploy makes) are
 * tracked by uuid and swept alone; the fixtures stay. Writes outside the ledger,
 * each put back in a finally: the spells' radii, the pools, the member the walk
 * deployed, and the world clock.
 */
import { connect } from "./_driver.mjs";
import { walkDone, blocked, WalkBlocked } from "./_walk.mjs";
import {
  MACHINE, PORTS, P as K, note, section, check, idOf, run, sleep, ledgerFor, finish, summarize, spellFlag,
} from "./_magic-cast-kit.mjs";

const { browser, origin } = MACHINE;
const KEY = "formation-kit-cast-light-walk";
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 1_200_000);
const SCENE = "formation/kit-cast-scene";
const PARTY = "formation/kit-cast-party";
const TOKEN = "formation/kit-cast-token";
const CLASS = "formation/kit-cast-class";
const CASTER = "formation/kit-cast-caster";
const SPELL_A = "formation/kit-cast-spell";
const OTHER = "formation/kit-cast-other";
const SPELL_B = "formation/kit-cast-other-spell";

/* ------------------------------------------------------------------ */
/*  The invented class, spells and figures                              */
/* ------------------------------------------------------------------ */
// A list's key and label fold to the same string, so a spell naming either matches it; the key carries no hyphen.
const LIST = { key: "qaglow", label: "QA Glow" };
const CLASS_NAME = "QA Kit Cast Class";
const CASTER_NAME = "QA Kit Caster";
const OTHER_NAME = "QA Kit Other";
const SPELL = "QA Glimmer";
const TWIN = "QA Glimmer Twin";
const CITE = "QA p. 1";
const CASTING = [{ key: LIST.key, label: LIST.label, kind: "vancian", slots: [{ atLevel: 1, s1: 1 }] }];
const BANDS = { daylight: null, bright: 20, dim: 40 };
const NONE = { daylight: null, bright: null, dim: null };
/** A one-hour duration: the clock step runs past it by a wide margin. */
const DUR = { shape: "fixed", value: 1, unit: "hours" };
const HOUR = 3600;
const NOTICE = { blocked: "ACKS-MAGIC.cast.notice.blocked.noSlot", verdict: "ACKS-MAGIC.cast.notice.verdict.noSlot" };

/** The spell's own light row (`appliesTo: "self"` is the caster in the spell vocabulary) and the reverse form's, which carries its own reach so a leak of it shows. */
const lightRow = (bands) => ({ key: "qa-light", type: "light", appliesTo: "self", saveEffect: "none", lasts: "duration", lightBands: bands });
const REVERSE = { key: "qa-light-rev", type: "light", appliesTo: "self", saveEffect: "none", lasts: "duration", reversed: true, lightBands: { daylight: null, bright: 5, dim: 10 } };
/** The spell flag written whole: the one list at level 1, the cite, a caster-only target, the two rows. */
const flagOf = (bands) => ({
  ...spellFlag({ rows: [lightRow(bands), REVERSE], duration: DUR, target: { model: "self" } }),
  lists: [{ source: LIST.label, level: 1, classes: [], note: "" }],
  cite: CITE,
});
const optionKey = (actorId, itemId) => `${actorId}|${itemId}|${LIST.key}`;

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in a seat's page.  */
/* ------------------------------------------------------------------ */
const P = {
  install: async () => {
    const H = (globalThis.__kc = globalThis.__kc ?? {});
    const base = "/modules/acks-extras/scripts/";
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 40, every = 150 } = {}) => { for (let n = 0; n < tries; n++) { const v = await fn(); if (v) return v; await H.sleep(every); } return null; };
    H.root = (app) => (app?.element?.nodeType === 1 ? app.element : app?.element?.[0] ?? null);
    H.LT = await import(`${base}lib/light.mjs`);
    H.FM = await import(`${base}formation/formation-model.mjs`);
    H.VIEW = await import(`${base}formation/formation-view.mjs`);
    return { isGM: game.user.isGM, userId: game.user.id, role: game.user.role, activeGMIsSelf: !!game.users.activeGM?.isSelf, formation: typeof globalThis.acksExtras?.formation?.carriedLightPoints === "function", worldTime: game.time.worldTime };
  },
  format: async ({ key, data }) => game.i18n.format(key, data ?? {}),
  /** The party actor's formation id, adopted when none stands. */
  formationOf: async ({ partyId }) => {
    const H = globalThis.__kc;
    const find = () => Object.values(H.FM.getFormations()).find((f) => f.actorId === partyId);
    let found = await H.poll(find, { tries: 40, every: 200 });
    let adopted = false;
    if (!found) { await H.FM.adoptPartyActor(game.actors.get(partyId)); adopted = true; found = await H.poll(find, { tries: 40, every: 200 }); }
    return found ? { fid: found.id, adopted } : { error: "no formation for the party actor" };
  },
  /** Seat the members through the party sheet's drop, in order; a member out of order is taken out and dropped again. */
  seat: async ({ partyId, fid, actorIds }) => {
    const H = globalThis.__kc;
    const ids = () => H.FM.getFormation(fid).members.filter((m) => m?.actorId).map((m) => m.actorId);
    const now = ids();
    const prefixOk = actorIds.every((id, i) => now[i] === id) && now.length === actorIds.length;
    if (!prefixOk) {
      for (const id of now) await H.FM.removeMember(H.FM.getFormation(fid), id);
      const sheet = game.actors.get(partyId).sheet;
      await sheet.render(true);
      await H.sleep(900);
      for (const id of actorIds) {
        const dt = new DataTransfer();
        dt.setData("text/plain", JSON.stringify({ type: "Actor", uuid: game.actors.get(id).uuid }));
        H.root(sheet).dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
        await H.poll(() => ids().includes(id), { tries: 40, every: 150 });
      }
    }
    return { members: ids(), reseated: !prefixOk };
  },
  /** The party's token on the scene, made from the party actor where none stands there, and adopted. */
  partyToken: async ({ fid, partyId, sceneId, x, y }) => {
    const H = globalThis.__kc;
    const scene = game.scenes.get(sceneId);
    let f = H.FM.getFormation(fid);
    let token = f.tokenId ? scene.tokens.get(f.tokenId) : null;
    let made = null;
    if (!token) {
      const doc = await game.actors.get(partyId).getTokenDocument({ x, y, rotation: 270 });
      [token] = await scene.createEmbeddedDocuments("Token", [{ ...doc.toObject(), actorLink: true, hidden: false }]);
      made = token.id;
      await H.poll(() => H.FM.getFormation(fid).tokenId === token.id, { tries: 60, every: 200 });
    }
    f = H.FM.getFormation(fid);
    return { tokenId: f.tokenId, sceneId: f.sceneId, made };
  },
  view: async ({ sceneId }) => {
    const scene = game.scenes.get(sceneId);
    if (canvas.scene?.id !== sceneId) await scene.view();
    const stop = Date.now() + 25000;
    while (Date.now() < stop && !(canvas.ready && canvas.scene?.id === sceneId)) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 1500));
    return { scene: canvas.scene?.id === sceneId };
  },
  /**
   * The fixtures' known shape: the class's casting row, both members bound to it at level 1 with core's spell
   * grid at 0, no pool spent, the Player owning the caster and only observing the other, and both spells written
   * whole with the radii given, count 0. Answers what the world reads back.
   */
  shape: async ({ classId, classUuid, casting, playerId, caster, other, flags, observe }) => {
    const { poolState } = await import("/modules/acks-extras/scripts/classes/casting.mjs");
    const { classForActor } = await import("/modules/acks-extras/scripts/classes/registry.mjs");
    await game.items.get(classId).update({ "system.casting": casting });
    const out = {};
    for (const [label, spec] of [["caster", caster], ["other", other]]) {
      const actor = game.actors.get(spec.actorId);
      await actor.update({
        "system.details.level": 1,
        "system.details.class": "",
        "system.spells.enabled": true,
        "system.spells.1.max": 0,
        "flags.acks-extras.classes.uuid": classUuid,
        "flags.acks-extras.classes.-=pools": null,
      });
      // The ownership map is replaced whole: core 14 validates a `-=` deletion key inside it as a user id and logs a validation error.
      await actor.update({ ownership: label === "caster" ? { default: observe, [playerId]: 3 } : { default: observe } }, { diff: false, recursive: false });
      const item = actor.items.get(spec.itemId);
      await item.update({ "flags.acks-extras.-=spell": null });
      await item.update({ "system.cast": 0, "system.lvl": 1, "system.class": "", "flags.acks-extras.spell": flags });
      out[label] = {
        bound: classForActor(actor)?.name ?? null,
        pools: actor.getFlag("acks-extras", "classes")?.pools ?? null,
        derived: poolState(actor).map((p) => ({ key: p.key, slots: (p.slots ?? []).map((s) => ({ n: s.n, max: s.max, used: s.used })) })),
        cast: item.system.cast,
        rows: Array.from(item.flags?.["acks-extras"]?.spell?.effects ?? []).length,
        level: actor.system.details.level,
        playerLevel: actor.ownership[playerId] ?? null,
        defaultLevel: actor.ownership.default,
      };
    }
    return out;
  },
  /** One member as the world reads it now: stored pools, the derived slots, the spell's count, whether the cast window claims it, the Player's seat's ownership. */
  state: async ({ actorId, itemId }) => {
    const { poolState } = await import("/modules/acks-extras/scripts/classes/casting.mjs");
    const { classForActor } = await import("/modules/acks-extras/scripts/classes/registry.mjs");
    const { castSpellClaims } = await import("/modules/acks-extras/scripts/magic/cast-spell.mjs");
    const actor = game.actors.get(actorId);
    const item = actor.items.get(itemId);
    const spent = actor.getFlag("acks-extras", "classes")?.pools ?? null;
    return {
      pools: spent ? JSON.parse(JSON.stringify(spent)) : null,
      derived: poolState(actor).map((p) => ({ key: p.key, slots: (p.slots ?? []).map((s) => ({ n: s.n, max: s.max, used: s.used })) })),
      bound: classForActor(actor)?.name ?? null,
      cast: item?.system?.cast ?? null,
      windowClaims: item ? castSpellClaims(item, undefined, classForActor) : null,
      owner: actor.isOwner,
      items: actor.items.size,
    };
  },
  /** The pools flag unset, then set to `pools` where one is given. */
  setPools: async ({ actorId, pools }) => {
    const actor = game.actors.get(actorId);
    if (actor.getFlag("acks-extras", "classes")?.pools) await actor.update({ "flags.acks-extras.classes.-=pools": null });
    if (pools) await actor.update({ "flags.acks-extras.classes.pools": pools });
    const now = actor.getFlag("acks-extras", "classes")?.pools ?? null;
    return now ? JSON.parse(JSON.stringify(now)) : null;
  },
  /** The spell's non-reversed Light row's radii rewritten (the rest of the flag untouched); answers the radii now stored. */
  writeBands: async ({ actorId, itemId, bands }) => {
    const item = game.actors.get(actorId).items.get(itemId);
    const rows = foundry.utils.deepClone(Array.from(item.flags["acks-extras"].spell.effects ?? []));
    const row = rows.find((r) => r.type === "light" && !r.reversed);
    row.lightBands = { ...bands };
    await item.update({ "flags.acks-extras.spell.effects": rows });
    const now = Array.from(item.flags["acks-extras"].spell.effects).find((r) => r.type === "light" && !r.reversed)?.lightBands ?? null;
    return now ? { daylight: now.daylight ?? null, bright: now.bright ?? null, dim: now.dim ?? null } : null;
  },
  openKit: async ({ partyId, fresh = false }) => {
    const H = globalThis.__kc;
    const app = game.actors.get(partyId).sheet;
    if (fresh) await app.close({ animate: false });
    await app.render(true);
    await H.poll(() => H.root(app)?.isConnected);
    await H.sleep(700);
    H.root(app)?.querySelector('[data-action="tab"][data-tab="kit"]')?.click();
    await H.sleep(500);
    const root = H.root(app);
    return { rendered: !!root && app.state === 2, kit: !!root?.querySelector('.tab[data-tab="kit"].active'), winId: app.id };
  },
  /** The Kit tab as drawn (no render forced): the cast row's options, the picked line's parts, Cast's state, and every magic-light row. */
  kit: async ({ partyId }) => {
    const H = globalThis.__kc;
    const root = H.root(game.actors.get(partyId).sheet);
    const box = root?.querySelector("[data-light-cast]") ?? null;
    const select = box?.querySelector("select[data-pick=lightCast]") ?? null;
    const part = (name) => box?.querySelector(`[data-light-cast-part="${name}"]`) ?? null;
    const text = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    const tip = (el) => el?.getAttribute("data-tooltip-text") ?? "";
    const go = box?.querySelector("button[data-action=castLightSpell]") ?? null;
    return {
      rendered: !!root,
      box: !!box,
      options: [...(select?.options ?? [])].map((o) => ({ value: o.value, text: text(o), listText: o.dataset.listText ?? "", slotsText: o.dataset.slotsText ?? "", refusal: o.dataset.refusal ?? "", blocked: o.dataset.blocked === "1" })),
      value: select?.value ?? null,
      list: { text: text(part("list")), tip: tip(part("list")) },
      slots: { text: text(part("slots")), tip: tip(part("slots")), wrapHidden: part("slots-wrap")?.hidden ?? null },
      refusal: { hidden: part("refusal")?.hidden ?? null, text: text(part("refusal-text")) },
      castDisabled: go ? go.disabled : null,
      rows: [...(root?.querySelectorAll("[data-magic-light]") ?? [])].map((r) => {
        const reach = r.querySelector(".remaining:not(.acks-extras-light-state)");
        const state = r.querySelector(".acks-extras-light-state");
        return {
          key: r.dataset.magicLight,
          label: text(r.querySelector(".label")),
          state: state?.dataset.state ?? null,
          reachText: text(reach),
          reachTip: reach?.getAttribute("data-tooltip-text") ?? "",
          shutter: !!r.querySelector('[data-action="shutterMagicLight"]'),
          setReach: !!r.querySelector('[data-action="setLightReach"]'),
        };
      }),
    };
  },
  /** Pick an option the way a user does: the select's value set and its change event fired; the line follows with no redraw. */
  pick: async ({ partyId, value }) => {
    const H = globalThis.__kc;
    const select = H.root(game.actors.get(partyId).sheet)?.querySelector("select[data-pick=lightCast]");
    if (!select) return { select: false };
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await H.sleep(200);
    return { select: true, held: select.value === value };
  },
  /**
   * Press Cast on the Kit row as a user does (a plain click, no skip-dialog key held), then wait for the cast window it
   * opens. The press is not awaited by the sheet and the window waits on the seat, so this polls for the window.
   */
  pressCast: async ({ partyId }) => {
    const H = globalThis.__kc;
    const btn = H.root(game.actors.get(partyId).sheet)?.querySelector("[data-light-cast] button[data-action=castLightSpell]");
    if (!btn) return { button: false };
    H.castBefore = new Set([...game.messages].map((m) => m.id));
    if (btn.disabled) return { button: true, disabled: true, dialog: false };
    btn.click();
    const dialog = await H.poll(() => document.querySelector(".application.acks-extras-cast"), { tries: 80, every: 150 });
    if (!dialog) return { button: true, disabled: false, dialog: false };
    await H.sleep(400);
    const el = document.querySelector(".application.acks-extras-cast") ?? dialog;
    return {
      button: true,
      disabled: false,
      dialog: true,
      spell: el.querySelector(".acks-extras-cast-spell")?.textContent.trim() ?? "",
      caster: el.querySelector(".acks-extras-cast-caster")?.textContent.trim() ?? "",
      modes: [...el.querySelectorAll('input[name="mode"]')].map((i) => i.value),
    };
  },
  /**
   * Drive the open cast window: the mode radio when `mode` is given, then Cast, then the card it posts (found by its cast
   * flag among the messages made since the press). Answers what the window showed and the card's cast id.
   */
  confirmCast: async ({ mode }) => {
    const H = globalThis.__kc;
    const live = () => document.querySelector(".application.acks-extras-cast");
    if (!live()) return { dialog: false };
    if (mode) {
      const radio = live().querySelector(`input[name="mode"][value="${mode}"]`);
      if (!radio) return { dialog: true, modeFound: false };
      radio.checked = true;
      radio.dispatchEvent(new Event("change", { bubbles: true }));
      await H.sleep(600);
    }
    const shown = {
      dialog: true,
      modeFound: true,
      mode: live()?.querySelector('input[name="mode"]:checked')?.value ?? null,
      verdicts: [...(live()?.querySelectorAll(".acks-extras-cast-verdicts li") ?? [])].map((li) => li.dataset.severity),
    };
    const button = await H.poll(() => { const b = live()?.querySelector('button[data-action="cast"]'); return b && !b.disabled ? b : null; }, { tries: 20, every: 150 });
    if (!button) return { ...shown, card: false, castDisabled: true };
    const before = H.castBefore ?? new Set();
    button.click();
    const message = await H.poll(() => [...game.messages].find((m) => !before.has(m.id) && m.flags?.["acks-extras"]?.castCard), { tries: 120, every: 250 });
    if (!message) return { ...shown, card: false, castDisabled: false };
    await H.sleep(800);
    const card = game.messages.get(message.id).flags["acks-extras"].castCard;
    return { ...shown, card: true, messageId: message.id, castId: card.castId, cardMode: card.mode ?? null, windowGone: !live() };
  },
  /** Every spell record on an actor, with what lib reads from it: the three band values in band order (null where the record has no change on a band's key), the changes' types against `magicLightChanges`' own, the page flag and the clock. */
  records: async ({ actorId }) => {
    const H = globalThis.__kc;
    const LT = H.LT;
    const wantTypes = LT.magicLightChanges({}).map((c) => c.type);
    return [...game.actors.get(actorId).effects].filter((e) => e.flags?.["acks-extras"]?.spellEffect).map((e) => {
      const mark = e.flags["acks-extras"].spellEffect;
      const found = LT.MAGIC_LIGHT_BANDS.map((band) => [...e.changes].find((c) => c.key === LT.MAGIC_LIGHT_CHANGE_KEYS[band]) ?? null);
      return {
        id: e.id,
        uuid: e.uuid,
        castId: mark.castId,
        role: mark.role ?? null,
        name: e.name,
        bandKeys: found.filter(Boolean).length,
        values: found.map((c) => (c ? String(c.value) : null)),
        typesOk: found.every((c, i) => !!c && c.type === wantTypes[i]),
        cite: e.flags["acks-extras"][LT.MAGIC_LIGHT_CITE_FLAG] ?? null,
        startTime: mark.startTime ?? null,
        duration: mark.duration ?? null,
      };
    });
  },
  /** The light an actor sheds as lib sums it (the shining magic lights only), and how many magic lights it lists. */
  shed: async ({ actorId }) => {
    const LT = globalThis.__kc.LT;
    const actor = game.actors.get(actorId);
    return { ...LT.effectLight(actor), listed: LT.magicLights(actor).length };
  },
  pressShutter: async ({ partyId, key }) => {
    const btn = globalThis.__kc.root(game.actors.get(partyId).sheet)?.querySelector(`[data-magic-light="${key}"] [data-action="shutterMagicLight"]`);
    if (!btn) return { button: false };
    btn.click();
    return { button: true };
  },
  /** The scene's darkness level set to `level`; answers the level it held before. */
  darkness: async ({ sceneId, level }) => {
    const scene = game.scenes.get(sceneId);
    const was = scene.environment?.darknessLevel ?? 0;
    await scene.update({ "environment.darknessLevel": level });
    return { was, now: scene.environment?.darknessLevel ?? null };
  },
  /**
   * What the party reads of its light: the model's two answers, the mode and the flames lit, the warnings strip's three
   * light warnings (matched by the text before their first placeholder), and the figures rail's light cell as drawn.
   */
  lightReads: async ({ partyId, fid }) => {
    const H = globalThis.__kc;
    const f = H.FM.getFormation(fid);
    const warnings = H.VIEW.buildWarnings(f, 1);
    const stems = ["noLight", "darkBlinded", "darkSighted"].map((k) => game.i18n.localize(`ACKS-FORMATION.warnings.${k}`).split("{")[0]).filter((s) => s.length > 3);
    const root = H.root(game.actors.get(partyId).sheet);
    const cell = [...(root?.querySelectorAll(".acks-extras-party-sheet__rail--figures .acks-extras-party-sheet__cell") ?? [])].find((c) => c.querySelector("i.fa-fire-flame-curved"));
    const sub = cell?.querySelector(".acks-extras-party-sheet__cell-sub")?.textContent.trim() ?? "";
    const title = `${cell?.getAttribute("data-tooltip") ?? ""} ${cell?.getAttribute("aria-label") ?? ""} ${cell?.querySelector(".acks-sr-only")?.textContent ?? ""}`;
    const badge = game.i18n.localize("ACKS-LIB.light.state.label.shining");
    return {
      mode: f.travel?.mode ?? null,
      flamesLit: (f.lights ?? []).filter((l) => l.lit && !l.shielded).length,
      hasLight: H.FM.formationHasLight(f),
      inDark: H.FM.isPartyInDark(f),
      lightWarning: warnings.some((w) => stems.some((s) => w.startsWith(s))),
      cell: !!cell,
      readsBadge: !!sub && sub === badge && title.includes(badge),
      readsNoLight: title.includes(game.i18n.localize("ACKS-FORMATION.frame.figure.noLight")),
    };
  },
  /** Press a row's Set reach as a user does and read the window it opens: the record's own sheet, closed again. */
  pressSetReach: async ({ partyId, key, uuid }) => {
    const H = globalThis.__kc;
    const btn = H.root(game.actors.get(partyId).sheet)?.querySelector(`[data-magic-light="${key}"] [data-action="setLightReach"]`);
    if (!btn) return { button: false };
    btn.click();
    const app = await H.poll(() => [...(foundry.applications.instances?.values?.() ?? [])].find((a) => a.document?.uuid === uuid), { tries: 40, every: 150 });
    const opened = { button: true, sheet: !!app, name: app?.constructor?.name ?? null };
    if (app) await app.close({ animate: false });
    return opened;
  },
  /** Send a member out of the party token (or back) through the Order tab's own control. */
  detach: async ({ partyId, fid, actorId, want }) => {
    const H = globalThis.__kc;
    const app = game.actors.get(partyId).sheet;
    const member = () => H.FM.getFormation(fid).members.find((m) => m?.actorId === actorId);
    const kit = () => H.root(app)?.querySelector('[data-action="tab"][data-tab="kit"]')?.click();
    H.root(app)?.querySelector('[data-action="tab"][data-tab="order"]')?.click();
    await H.sleep(600);
    const btn = H.root(app)?.querySelector(`.tab[data-tab="order"] [data-actor-id="${actorId}"] [data-action="toggleDetach"]`);
    if (!btn || btn.disabled) { kit(); return { found: !!btn, disabled: !!btn?.disabled }; }
    const was = !!member()?.deployedTokenId;
    if (was !== want) {
      btn.click();
      await H.poll(() => !!member()?.deployedTokenId === want, { tries: 60, every: 200 });
    }
    await H.sleep(500);
    kit();
    await H.sleep(300);
    const m = member();
    return { found: true, was, deployed: !!m?.deployedTokenId, tokenId: m?.deployedTokenId ?? null, sceneId: m?.deployedSceneId ?? H.FM.getFormation(fid).sceneId ?? null };
  },
  /** A deployed member's token light as stored. */
  tokenLight: async ({ fid, actorId }) => {
    const H = globalThis.__kc;
    const f = H.FM.getFormation(fid);
    const m = f.members.find((x) => x?.actorId === actorId);
    const scene = game.scenes.get(m?.deployedSceneId ?? f.sceneId);
    const t = m?.deployedTokenId ? scene?.tokens.get(m.deployedTokenId) : null;
    if (!t) return { token: false };
    return { token: true, bright: t.light.bright ?? 0, dim: t.light.dim ?? 0 };
  },
  /** Advance the world clock (`advance` seconds) and give the GM client's expiry a moment; or set it to `set`. Answers the clock. */
  clock: async ({ advance, set }) => {
    const H = globalThis.__kc;
    if (set != null) await game.time.set(set);
    else if (advance) { await game.time.advance(advance); await H.sleep(2500); }
    return game.time.worldTime;
  },
  /** The spell's sheet on its Mechanics tab, the Light row's Edit control pressed as a user does, and the editor window it opens read: the three radius boxes with their values and the tooltip on each box's group. */
  openEditor: async ({ actorId, itemId }) => {
    const H = globalThis.__kc;
    const item = game.actors.get(actorId).items.get(itemId);
    const index = Array.from(item.flags["acks-extras"].spell.effects).findIndex((r) => r.type === "light" && !r.reversed);
    const sheet = item.sheet;
    await sheet.render(true);
    await H.poll(() => H.root(sheet)?.isConnected);
    await H.sleep(600);
    sheet.changeTab?.("mechanics", "primary");
    await H.sleep(500);
    const edit = H.root(sheet)?.querySelector(`[data-action="effectEdit"][data-index="${index}"]`);
    if (!edit) return { sheet: sheet.constructor.name, edit: false, index };
    edit.click();
    const editor = await H.poll(() => document.querySelector(".acks-extras-effect-editor"), { tries: 40, every: 150 });
    if (!editor) return { sheet: sheet.constructor.name, edit: true, editor: false, index };
    await H.sleep(500);
    const box = (band) => {
      const input = editor.querySelector(`input[name="lightBands.${band}"]`);
      return input ? { type: input.type, value: input.value, tip: input.closest(".form-group")?.getAttribute("data-tooltip-text") ?? "" } : null;
    };
    return { sheet: sheet.constructor.name, edit: true, editor: true, index, daylight: box("daylight"), bright: box("bright"), dim: box("dim") };
  },
  /** Close the party sheet, the spells' sheets and every open effect-row editor. */
  closeSheets: async ({ partyId, items }) => {
    await game.actors.get(partyId)?.sheet?.close({ animate: false });
    for (const { actorId, itemId } of items) await game.actors.get(actorId)?.items.get(itemId)?.sheet?.close({ animate: false });
    for (const app of [...(foundry.applications.instances?.values?.() ?? [])]) if (app.element?.classList?.contains("acks-extras-effect-editor")) await app.close({ animate: false });
    return true;
  },
  /** The Judge's own illumination spells by cookbook id, read and never imported: the data a copy is made from, the spell's cite, and each light row's stored bands as numbers or null. A spell the shelf lacks is null. */
  shelf: async ({ ids }) => {
    const L = await import("/modules/acks-extras/scripts/lib/library.mjs");
    const out = { rr: !!acksExtras.importer?.bookOpen?.("rr"), spells: {} };
    for (const [slug, id] of Object.entries(ids)) {
      const doc = L.byCookbookId("Item", id, { original: true });
      if (!doc) { out.spells[slug] = null; continue; }
      const data = doc.toObject();
      for (const f of ["_id", "folder", "sort", "ownership"]) delete data[f];
      out.spells[slug] = { payload: data };
    }
    return out;
  },
  /** One copy's flag rewritten whole from `payload` (the lists, rows, bands and cite as imported), its count 0; answers its cite, its duration shape and the non-reversed light row's bands. */
  syncCopy: async ({ actorId, itemId, payload }) => {
    const item = game.actors.get(actorId).items.get(itemId);
    await item.update({ "flags.acks-extras.-=spell": null });
    await item.update({ "system.cast": 0, "flags.acks-extras.spell": foundry.utils.deepClone(payload.flags?.["acks-extras"]?.spell ?? {}) });
    const flag = item.getFlag("acks-extras", "spell") ?? {};
    const rows = Array.isArray(flag.effects) ? flag.effects : Object.values(flag.effects ?? {});
    const row = rows.find((r) => r.type === "light" && !r.reversed);
    const band = (v) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null);
    return { cite: String(flag.cite ?? ""), hasRow: !!row, bands: row ? { daylight: band(row.lightBands?.daylight), bright: band(row.lightBands?.bright), dim: band(row.lightBands?.dim) } : null, perpetual: !flag.duration || flag.duration.shape !== "fixed" };
  },
  /** The Light here line on a seat's open Kit tab, read as drawn with no render forced: whether the Light Sources section is drawn, whether the line is, its stage, its words and its tooltip (null where it carries none). */
  lightLine: async ({ partyId }) => {
    const H = globalThis.__kc;
    const root = H.root(game.actors.get(partyId).sheet);
    const section = root?.querySelector('.tab[data-tab="kit"] section.lights') ?? null;
    const line = root?.querySelector("[data-light-here]") ?? null;
    const cell = line?.querySelector(".remaining") ?? null;
    return { section: !!section, line: !!line, level: line?.dataset.lightHere ?? null, text: (cell?.textContent ?? "").replace(/\s+/g, " ").trim(), tip: cell?.getAttribute("data-tooltip-text") ?? null };
  },
  /** Move a token with no animation, as a hand-made update, and answer where it stands. */
  moveToken: async ({ sceneId, tokenId, x, y, hidden }) => {
    const scene = game.scenes.get(sceneId);
    const patch = { _id: tokenId, ...(x != null ? { x, y } : {}), ...(hidden != null ? { hidden } : {}) };
    await scene.updateEmbeddedDocuments("Token", [patch], { animate: false });
    const t = scene.tokens.get(tokenId);
    return { x: t.x, y: t.y, hidden: !!t.hidden };
  },
  /** The placed light written (dotted keys; a `-=` key unsets a flag) and read back: its stored daylight flag, its radii and its own name. */
  ambient: async ({ sceneId, lightId, set }) => {
    const scene = game.scenes.get(sceneId);
    if (set) await scene.updateEmbeddedDocuments("AmbientLight", [{ _id: lightId, ...set }]);
    const l = scene.lights.get(lightId);
    return { daylight: l.getFlag("acks-extras", "daylight") ?? null, bright: l.config.bright, dim: l.config.dim, hidden: !!l.hidden, name: String(l.name ?? "") };
  },
  /** The scene's sky as it stands (global illumination and darkness), written where given; answers what it held before. */
  env: async ({ sceneId, global, level }) => {
    const scene = game.scenes.get(sceneId);
    const was = { global: !!scene.environment?.globalLight?.enabled, level: scene.environment?.darknessLevel ?? 0 };
    const patch = {};
    if (global != null) patch["environment.globalLight.enabled"] = global;
    if (level != null) patch["environment.darknessLevel"] = level;
    if (Object.keys(patch).length) await scene.update(patch);
    return was;
  },
  /** One hand-made effect carrying a daylight reach, as `magicLightChanges` writes it, on an actor the run made; answers the daylight lib reads off the actor. */
  beaconEffect: async ({ actorId, feet }) => {
    const H = globalThis.__kc;
    const actor = game.actors.get(actorId);
    await actor.createEmbeddedDocuments("ActiveEffect", [{ name: "QA Kit Beacon Light", changes: H.LT.magicLightChanges({ daylight: feet }), disabled: false }]);
    return { daylight: H.LT.effectLight(actor).daylight };
  },
  /** An actor's ownership map replaced whole with `map` (a deletion key inside the map is not a user id on core 14); answers the stored map. */
  ownership: async ({ uuid, map }) => {
    const doc = await fromUuid(uuid);
    await doc.update({ ownership: map }, { diff: false, recursive: false });
    return { ...doc._source.ownership };
  },
  /** A token placed on a scene for the step; answers its uuid and id. */
  placeBeacon: async ({ sceneId, actorId, x, y }) => {
    const scene = game.scenes.get(sceneId);
    const [t] = await scene.createEmbeddedDocuments("Token", [{ actorId, x, y, name: "QA Kit Beacon Token", actorLink: true, hidden: false, disposition: 0 }]);
    return { uuid: t.uuid, id: t.id };
  },
  /** The party's travel mode as the record holds it, switched through the module's own writer where `mode` is given. */
  travel: async ({ fid, mode, sceneId }) => {
    const H = globalThis.__kc;
    const was = H.FM.getFormation(fid).travel?.mode ?? null;
    if (mode) await acksExtras.formation.travel.setJourneyMode(fid, mode, { sceneId });
    await H.sleep(600);
    return { was, now: H.FM.getFormation(fid).travel?.mode ?? null };
  },
};

/* ------------------------------------------------------------------ */
/*  Driver side                                                         */
/* ------------------------------------------------------------------ */
/** Waits until a seat has loaded the world and both the magic and the formation apis; answers the seconds it took. */
async function ready(api, label, seconds = 240) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.magic && typeof globalThis.acksExtras?.formation?.carriedLightPoints === "function"`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}

/** Poll `read()` until `test` holds or the tries run out: `{ok, value}`, the value the last reading. */
async function until(read, test, { tries = 40, every = 250 } = {}) {
  let last = null;
  for (let n = 0; n < tries; n++) {
    last = await read();
    if (test(last)) return { ok: true, value: last };
    await sleep(every);
  }
  return { ok: false, value: last };
}

/** A check carrying its step id. */
const chk = (id, label, ok, detail) => check(`${id}: ${label}`, ok, detail);
/** A step part the walk could not reach: printed, never counted as a pass or a fail. */
const notWalked = (id, label, why) => console.log(`NOT WALKED  ${id}: ${label}  ${why}`);

let gm = null;
let player = null;
const ledger = ledgerFor(() => gm);
const W = {};
let worldTime0 = null;
let deployed = false;
let darkSet = false;
setTimeout(() => {
  console.error(`WALK ERROR: wall clock of ${WALL_MS} ms reached; closing the seats`);
  try { player?.close(); } catch {}
  try { gm?.close(); } catch {}
  process.exit(1);
}, WALL_MS).unref();

const kitOf = (seat) => run(seat, P.kit, { partyId: W.party });
const waitKit = (seat, test, opts) => until(() => kitOf(seat), test, opts);
const rowFor = (kit, actorId, recordId) => kit.rows.find((r) => r.key === `${actorId}.${recordId}`) ?? null;
const loc = (seat, key) => run(seat, K.loc, { key });
const stateOf = (actorId, itemId) => run(gm, P.state, { actorId, itemId });
const recordsOn = (actorId) => run(gm, P.records, { actorId });

/** Every step starts from this shape; `observe` is the default level the members carry. */
const shapeAll = (bands = BANDS) => run(gm, P.shape, {
  classId: W.classId, classUuid: W.classUuid, casting: CASTING, playerId: W.playerId, observe: 2,
  caster: { actorId: W.caster, itemId: W.casterSpell }, other: { actorId: W.other, itemId: W.otherSpell }, flags: flagOf(bands),
});

/** A prior run's records on the kept fixtures, listed by uuid, tracked and swept at once, so a step starts with none of them. */
async function clearOwnRecords() {
  for (const actorId of [W.caster, W.other]) {
    const uuids = (await recordsOn(actorId)).map((r) => r.uuid);
    for (const uuid of uuids) await ledger.track(uuid, "ActiveEffect");
    if (uuids.length) note("records a dead run left on a kept fixture, swept by uuid", await gm.sweepTracked({ only: uuids }));
  }
}

/** The card a cast posted and its cast id, put on the run's ledger the moment they are read. */
async function keep(cast) {
  if (cast?.castId) ledger.castIds.push(cast.castId);
  if (cast?.messageId) await ledger.track(`ChatMessage.${cast.messageId}`, "ChatMessage");
}

/** A member out of the party token, or back, as the Judge does it; the token a deploy makes is tracked at once. */
async function detach(actorId, want) {
  const d = await run(gm, P.detach, { partyId: W.party, fid: W.fid, actorId, want });
  if (d.tokenId) await ledger.track(`Scene.${d.sceneId}.Token.${d.tokenId}`, "Token");
  return d;
}

try {
  section("seats");
  gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  player = await connect({ browser, origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  note("gm ready after (s)", await ready(gm, "gm"));
  note("player ready after (s)", await ready(player, "player"));
  const kg = await run(gm, K.install, { key: KEY });
  const kp = await run(player, K.install, { key: KEY });
  const gi = await run(gm, P.install);
  const pi = await run(player, P.install);
  if (!kg.isGM || !kg.activeGMIsSelf) blocked("the first seat is not the active GM");
  if (kp.isGM) blocked("the second seat is a GM, so a Player's own seat cannot be walked");
  if (gi.userId === pi.userId) blocked("both seats are the same user, so the Player's gate cannot be told from the Judge's");
  check("the GM seat is the active GM, the other seat a Player, and both publish the formation api", gi.isGM && kg.activeGMIsSelf && !pi.isGM && pi.role <= 2 && gi.formation && pi.formation, { gm: gi.role, player: pi.role });
  W.playerId = pi.userId;
  worldTime0 = gi.worldTime;

  section("fixtures");
  const scene = await gm.fixture(SCENE, "Scene", {
    name: "QA Kit Cast Room", active: false, navigation: false, width: 1200, height: 800, padding: 0, backgroundColor: "#6f6f6f",
    grid: { type: 1, size: 100, distance: 5, units: "ft" }, tokenVision: true, environment: { globalLight: { enabled: false } }, ownership: { default: 2 },
  });
  const party = await gm.fixture(PARTY, "Actor", { name: "QA Kit Cast Party", type: "acks-extras.party", ownership: { default: 2 } });
  const cls = await gm.fixture(CLASS, "Item", { name: CLASS_NAME, type: "acks-extras.class", system: { key: "qakitclass", casting: CASTING } });
  const member = (name, level) => ({ name, type: "character", prototypeToken: { actorLink: true }, system: { hp: { value: 8, max: 8 }, spells: { enabled: true } }, ownership: { default: 2, ...(level ? { [W.playerId]: level } : {}) } });
  const caster = await gm.fixture(CASTER, "Actor", member(CASTER_NAME, 3));
  const other = await gm.fixture(OTHER, "Actor", member(OTHER_NAME, 0));
  const spellData = (name) => ({ name, type: "spell", system: { lvl: 1, cast: 0, memorized: 0, class: "" } });
  const spellA = await gm.fixture(SPELL_A, "Item", spellData(SPELL), { parent: caster.uuid });
  const spellB = await gm.fixture(SPELL_B, "Item", spellData(TWIN), { parent: other.uuid });
  Object.assign(W, { scene: idOf(scene), party: idOf(party), classId: idOf(cls), classUuid: cls.uuid, caster: idOf(caster), other: idOf(other), casterSpell: idOf(spellA), otherSpell: idOf(spellB) });
  const fo = await run(gm, P.formationOf, { partyId: W.party });
  if (fo.error) throw new Error(fo.error);
  W.fid = fo.fid;
  const seated = await run(gm, P.seat, { partyId: W.party, fid: W.fid, actorIds: [W.caster, W.other] });
  check("the party holds the two members, in order", JSON.stringify(seated.members) === JSON.stringify([W.caster, W.other]), seated);
  const pt = await run(gm, P.partyToken, { fid: W.fid, partyId: W.party, sceneId: W.scene, x: 300, y: 300 });
  if (pt.made) await gm.mark(`Scene.${W.scene}.Token.${pt.made}`, TOKEN);
  check("the party token stands on the room, linked to the record", !!pt.tokenId && pt.sceneId === W.scene, { sceneIsRoom: pt.sceneId === W.scene });
  check("the GM seat views the room", (await run(gm, P.view, { sceneId: W.scene })).scene);
  note("a member a dead run left deployed is gathered back", await detach(W.caster, false));
  await run(gm, K.drain);
  await run(player, K.drain);

  const slotsWord = await loc(gm, "ACKS.spells.Slots");
  const blockedSentence = await loc(gm, NOTICE.blocked);
  const verdictSentence = await loc(gm, NOTICE.verdict);
  const keyA = optionKey(W.caster, W.casterSpell);
  const keyB = optionKey(W.other, W.otherSpell);
  let recA = null;
  let recB = null;
  let playerRefusal = "";

  // ------------------------------------------------------------ K-c1
  section("K-c1. the Player's offer row");
  const shape1 = await shapeAll();
  await clearOwnRecords();
  chk("K-c1", "shape: both members bound to the class, the Player owns the caster and only observes the other, no pool spent, the cast window claims the spell", shape1.caster.bound === CLASS_NAME && shape1.other.bound === CLASS_NAME && shape1.caster.playerLevel === 3 && shape1.other.playerLevel === null && shape1.other.defaultLevel === 2 && shape1.caster.pools === null && shape1.other.pools === null && shape1.caster.rows === 2 && (await stateOf(W.caster, W.casterSpell)).windowClaims === true, { caster: shape1.caster, other: shape1.other });
  await run(player, P.openKit, { partyId: W.party, fresh: true });
  const k1 = await waitKit(player, (v) => v.box && v.options.length >= 1);
  const o1 = k1.value.options;
  chk("K-c1", "the Kit tab lists exactly one option, the owned caster's spell under its list, and not the other member's", k1.ok && o1.length === 1 && o1[0].value === keyA && o1[0].text.includes(SPELL) && o1[0].text.includes(CASTER_NAME) && !o1.some((o) => o.text.includes(TWIN) || o.text.includes(OTHER_NAME)), o1.map((o) => o.text));
  chk("K-c1", "the line reads the list and level, then the list's slots at that level", k1.value.list.text === `${LIST.label} 1` && k1.value.slots.text === `${slotsWord} 0 / 1` && k1.value.slots.wrapHidden === false, { list: k1.value.list.text, slots: k1.value.slots.text });
  chk("K-c1", "the list part and the slots part each carry a non-blank tooltip", k1.value.list.tip.length > 0 && k1.value.slots.tip.length > 0, { list: k1.value.list.tip.length, slots: k1.value.slots.tip.length });
  chk("K-c1", "Cast is on and no refusal sentence shows", k1.value.castDisabled === false && k1.value.refusal.hidden === true, { disabled: k1.value.castDisabled, hidden: k1.value.refusal.hidden });
  chk("K-c1", "no magic-light row stands yet", k1.value.rows.length === 0, k1.value.rows.length);

  // ------------------------------------------------------------ K-c2
  section("K-c2. Cast opens the caster's window, and the confirmed cast writes the light");
  await run(player, K.closeDialog);
  const press2 = await run(player, P.pressCast, { partyId: W.party });
  chk("K-c2", "Cast opens the caster's own cast window, titled with the spell and the caster, offering both forms", press2.button && !press2.disabled && press2.dialog && press2.spell === SPELL && press2.caster === CASTER_NAME && press2.modes.includes("normal") && press2.modes.includes("reversed"), press2);
  const cast2 = await run(player, P.confirmCast, { mode: "normal" });
  await keep(cast2);
  chk("K-c2", "the window confirmed in its normal mode posts the cast card and closes", cast2.card && cast2.mode === "normal" && cast2.windowGone, { card: cast2.card, mode: cast2.mode, verdicts: cast2.verdicts });
  const rec2 = await until(() => recordsOn(W.caster), (rs) => rs.some((r) => r.castId === cast2.castId && r.bandKeys > 0));
  const mine2 = rec2.value.filter((r) => r.castId === cast2.castId);
  recA = mine2.find((r) => r.bandKeys > 0) ?? null;
  chk("K-c2", "exactly one record of the cast carries the three band changes, read in band order as '', '20', '40', each of the type lib writes", mine2.filter((r) => r.bandKeys > 0).length === 1 && recA?.bandKeys === 3 && JSON.stringify(recA.values) === JSON.stringify(["", "20", "40"]) && recA.typesOk, mine2.map((r) => ({ role: r.role, keys: r.bandKeys, values: r.values, typesOk: r.typesOk })));
  chk("K-c2", "the record carries the spell's page as its cite flag, names the spell, is the caster's own and is timed", recA?.cite === CITE && recA.name === SPELL && recA.role === "caster" && Number.isFinite(recA.startTime) && !!recA.duration, { cite: recA?.cite, name: recA?.name, role: recA?.role, startTime: recA?.startTime, duration: recA?.duration });
  const shed2 = await run(gm, P.shed, { actorId: W.caster });
  chk("K-c2", "the caster sheds the cast's reach and lists one magic light", shed2.bright === 20 && shed2.dim === 40 && shed2.daylight === 0 && shed2.listed === 1, shed2);
  const reach2 = await run(gm, P.format, { key: "ACKS-FORMATION.app.magicLightReach", data: { bright: 20, dim: 40 } });
  const tip2 = await run(gm, P.format, { key: "ACKS-FORMATION.app.magicLightCastTip", data: { spell: SPELL, source: CASTER_NAME, cite: CITE, reach: reach2 } });
  const row2 = await waitKit(player, (v) => !!recA && !!rowFor(v, W.caster, recA.id));
  const r2 = recA ? rowFor(row2.value, W.caster, recA.id) : null;
  chk("K-c2", "the Player's Kit tab lists the one light as '{spell} — {caster}', Shining, with the reach read in the tab's words", row2.ok && row2.value.rows.length === 1 && r2.label === `${SPELL} — ${CASTER_NAME}` && r2.state === "shining" && r2.reachText === reach2, { label: r2?.label, state: r2?.state, reach: r2?.reachText });
  chk("K-c2", "the row's tooltip is the cast tip: it names the spell, the bearer, the page and the reach", !!r2 && r2.reachTip === tip2 && r2.reachTip.includes(SPELL) && r2.reachTip.includes(CITE), { tip: r2?.reachTip });

  // ------------------------------------------------------------ K-c3
  section("K-c3. the Shutter on the cast light");
  await run(gm, P.openKit, { partyId: W.party, fresh: true });
  const dep = await detach(W.caster, true);
  deployed = !!dep.deployed;
  let lit3 = null;
  if (deployed) lit3 = await until(() => run(gm, P.tokenLight, { fid: W.fid, actorId: W.caster }), (v) => v.token && v.bright === 20 && v.dim === 40, { tries: 24 });
  if (!deployed) notWalked("K-c3", "the deployed token carries the cast light before the shutter", `the Order tab's detach control was not reached (found ${dep.found}, deployed ${dep.deployed})`);
  else chk("K-c3", "a token the caster is deployed as carries the cast light at the cast's reach", lit3.ok, lit3.value);
  const press3 = await run(player, P.pressShutter, { partyId: W.party, key: `${W.caster}.${recA?.id}` });
  chk("K-c3", "the Player seat finds the row's Shutter button and presses it", press3.button);
  const shut3 = await waitKit(player, (v) => rowFor(v, W.caster, recA?.id)?.state === "shuttered");
  const shutG = await waitKit(gm, (v) => rowFor(v, W.caster, recA?.id)?.state === "shuttered");
  chk("K-c3", "the row reads Shuttered on both seats", shut3.ok && shutG.ok);
  const shed3 = await until(() => run(gm, P.shed, { actorId: W.caster }), (v) => v.bright === 0 && v.dim === 0 && v.daylight === 0);
  chk("K-c3", "the caster sheds no magic light while the effect stays listed", shed3.ok && shed3.value.listed === 1, shed3.value);
  if (!deployed) notWalked("K-c3", "the deployed token sheds no magic light", "nobody is deployed");
  else {
    const dark3 = await until(() => run(gm, P.tokenLight, { fid: W.fid, actorId: W.caster }), (v) => v.token && v.bright === 0 && v.dim === 0, { tries: 24 });
    chk("K-c3", "the deployed token sheds no magic light", dark3.ok, dark3.value);
    note("the caster gathered back into the party token", (await detach(W.caster, false)).deployed === false);
    deployed = false;
  }

  // ------------------------------------------------------------ K-c4
  section("K-c4. the slot is spent: the Player's Cast is off");
  await run(player, P.openKit, { partyId: W.party, fresh: true });
  const k4 = await waitKit(player, (v) => v.slots.text === `${slotsWord} 1 / 1`);
  const press4 = await run(player, P.pressCast, { partyId: W.party });
  playerRefusal = k4.value.refusal.text;
  chk("K-c4", "the line reads the slots used, 1 / 1", k4.ok, { slots: k4.value.slots.text });
  chk("K-c4", "Cast is disabled and the refusal sentence is shown, the Magic tab's blocked sentence", k4.value.castDisabled === true && k4.value.refusal.hidden === false && playerRefusal.length > 0 && playerRefusal === blockedSentence, { disabled: k4.value.castDisabled, hidden: k4.value.refusal.hidden, text: playerRefusal.length });
  chk("K-c4", "the option is still offered, and a press on the disabled Cast opens no window", k4.value.options.length === 1 && press4.disabled === true && press4.dialog === false, { options: k4.value.options.length, press: press4 });

  // ------------------------------------------------------------ K-c5
  section("K-c5. the Judge's offer row: both spells, and a warning in place of a refusal");
  await shapeAll();
  await run(gm, P.setPools, { actorId: W.caster, pools: { [LIST.key]: { s1: 1 } } });
  await run(gm, P.setPools, { actorId: W.other, pools: null });
  await run(gm, P.openKit, { partyId: W.party, fresh: true });
  const k5 = await waitKit(gm, (v) => v.options.length === 2);
  const keys5 = k5.value.options.map((o) => o.value).sort();
  chk("K-c5", "the Judge's Kit tab lists both members' spells, one option each", k5.ok && JSON.stringify(keys5) === JSON.stringify([keyA, keyB].sort()), k5.value.options.map((o) => o.text));
  await run(gm, P.pick, { partyId: W.party, value: keyA });
  const a5 = await kitOf(gm);
  chk("K-c5", "the spent-out spell's line reads Slots 1 / 1, Cast stays on, and the refusal is the warning sentence, not the Player's", a5.value === keyA && a5.slots.text === `${slotsWord} 1 / 1` && a5.castDisabled === false && a5.refusal.hidden === false && a5.refusal.text === verdictSentence && a5.refusal.text !== playerRefusal, { slots: a5.slots.text, disabled: a5.castDisabled, same: a5.refusal.text === playerRefusal });
  await run(gm, P.pick, { partyId: W.party, value: keyB });
  const b5 = await kitOf(gm);
  chk("K-c5", "the other member's spell has its slot free: Slots 0 / 1, Cast on, no refusal", b5.value === keyB && b5.slots.text === `${slotsWord} 0 / 1` && b5.castDisabled === false && b5.refusal.hidden === true, { slots: b5.slots.text, hidden: b5.refusal.hidden });

  // ------------------------------------------------------------ K-c6
  section("K-c6. a reversed cast writes no light");
  await shapeAll();
  await run(gm, P.setPools, { actorId: W.other, pools: null });
  await run(gm, P.openKit, { partyId: W.party, fresh: true });
  await waitKit(gm, (v) => v.options.length === 2);
  await run(gm, P.pick, { partyId: W.party, value: keyB });
  const before6 = (await kitOf(gm)).rows.map((r) => r.key).sort();
  await run(gm, K.closeDialog);
  const press6 = await run(gm, P.pressCast, { partyId: W.party });
  chk("K-c6", "the Judge's Cast opens the other member's cast window, offering both forms", press6.dialog && press6.spell === TWIN && press6.caster === OTHER_NAME && press6.modes.includes("reversed"), press6);
  const cast6 = await run(gm, P.confirmCast, { mode: "reversed" });
  await keep(cast6);
  chk("K-c6", "confirmed in its reversed mode, the cast posts its card", cast6.modeFound && cast6.card && cast6.mode === "reversed", { card: cast6.card, mode: cast6.mode, cardMode: cast6.cardMode });
  await sleep(2500);
  const recs6 = (await recordsOn(W.other)).filter((r) => r.castId === cast6.castId);
  chk("K-c6", "no record of that cast carries a band change or the cite flag (a timed record without light may stand)", recs6.every((r) => r.bandKeys === 0 && r.cite === null), recs6.map((r) => ({ keys: r.bandKeys, cite: r.cite })));
  const shed6 = await run(gm, P.shed, { actorId: W.other });
  const after6 = (await kitOf(gm)).rows.map((r) => r.key).sort();
  chk("K-c6", "the other member sheds nothing, and the Kit tab's magic-light rows are the ones it had", shed6.bright === 0 && shed6.dim === 0 && shed6.daylight === 0 && shed6.listed === 0 && JSON.stringify(before6) === JSON.stringify(after6), { shed: shed6, before: before6.length, after: after6.length });

  // ------------------------------------------------------------ K-c7
  section("K-c7. blank radii: the reach cell is blank and the page alone is its tooltip");
  await shapeAll(NONE);
  await run(gm, P.setPools, { actorId: W.other, pools: null });
  await run(gm, P.openKit, { partyId: W.party, fresh: true });
  await waitKit(gm, (v) => v.options.length === 2);
  await run(gm, P.pick, { partyId: W.party, value: keyB });
  await run(gm, K.closeDialog);
  const press7 = await run(gm, P.pressCast, { partyId: W.party });
  const cast7 = await run(gm, P.confirmCast, { mode: "normal" });
  await keep(cast7);
  chk("K-c7", "the cast of the spell whose radii are all blank goes through its window", press7.dialog && cast7.card && cast7.mode === "normal", { dialog: press7.dialog, card: cast7.card });
  const rec7 = await until(() => recordsOn(W.other), (rs) => rs.some((r) => r.castId === cast7.castId && r.bandKeys > 0));
  recB = rec7.value.find((r) => r.castId === cast7.castId && r.bandKeys > 0) ?? null;
  chk("K-c7", "its record carries the three band changes, each blank, and the cite flag", recB?.bandKeys === 3 && JSON.stringify(recB.values) === JSON.stringify(["", "", ""]) && recB.cite === CITE, { values: recB?.values, cite: recB?.cite });
  const row7 = await waitKit(gm, (v) => !!recB && !!rowFor(v, W.other, recB.id));
  const r7 = recB ? rowFor(row7.value, W.other, recB.id) : null;
  chk("K-c7", "the row's reach cell is blank and its tooltip is the cite string exactly", row7.ok && r7.reachText === "" && r7.reachTip === CITE && r7.state === "shining", { reach: r7?.reachText, tipIsCite: r7?.reachTip === CITE });
  // ------------------------------------------------------------ K-c10
  section("K-c10. a blank cast light counts (step 7's record, a real cast with blank bands)");
  const dark10 = await run(gm, P.darkness, { sceneId: W.scene, level: 0.8 });
  W.darkness0 = dark10.was;
  darkSet = true;
  chk("K-c10", "the room reads dark for the step, so a missing light would show as the dark", dark10.now >= 0.5, dark10);
  await run(gm, P.openKit, { partyId: W.party, fresh: true });
  await run(player, P.openKit, { partyId: W.party, fresh: true });
  const key10 = `${W.other}.${recB?.id}`;
  const lit10 = await until(() => run(gm, P.lightReads, { partyId: W.party, fid: W.fid }), (v) => v.cell && v.hasLight, { tries: 24 });
  const row10 = await waitKit(gm, (v) => !!recB && rowFor(v, W.other, recB.id)?.state === "shining");
  const shut10 = recA ? rowFor(row10.value, W.caster, recA.id) : null;
  chk("K-c10", "the fixture shape: the party is not on a journey, no flame is lit, step 7's blank record shines and step 3's record stays shuttered", lit10.value.mode !== "journey" && lit10.value.flamesLit === 0 && row10.ok && shut10?.state === "shuttered", { mode: lit10.value.mode, flames: lit10.value.flamesLit, blank: rowFor(row10.value, W.other, recB?.id)?.state, cast2: shut10?.state });
  chk("K-c10", "with the blank-reach light shining the party has light and is not in the dark, and the warnings carry no light warning", lit10.ok && lit10.value.hasLight === true && lit10.value.inDark === false && lit10.value.lightWarning === false, lit10.value);
  chk("K-c10", "the header's light cell reads the row's Shining badge and not the no-light reading", lit10.value.cell && lit10.value.readsBadge && !lit10.value.readsNoLight, { cell: lit10.value.cell, readsBadge: lit10.value.readsBadge, readsNoLight: lit10.value.readsNoLight });
  const press10 = await run(gm, P.pressShutter, { partyId: W.party, key: key10 });
  const dim10 = await until(() => run(gm, P.lightReads, { partyId: W.party, fid: W.fid }), (v) => v.hasLight === false && v.readsNoLight === true, { tries: 24 });
  chk("K-c10", "shuttered, the same light no longer counts: no light, the dark, a light warning and the no-light reading", press10.button && dim10.ok && dim10.value.inDark === true && dim10.value.lightWarning === true, dim10.value);
  await run(gm, P.pressShutter, { partyId: W.party, key: key10 });
  const back10 = await until(() => run(gm, P.lightReads, { partyId: W.party, fid: W.fid }), (v) => v.hasLight === true && v.readsBadge === true, { tries: 24 });
  chk("K-c10", "opened again, it counts and the badge returns", back10.ok && back10.value.inDark === false && back10.value.lightWarning === false, back10.value);
  const gmKit10 = await waitKit(gm, (v) => rowFor(v, W.other, recB?.id)?.state === "shining");
  const plKit10 = await waitKit(player, (v) => !!recB && !!rowFor(v, W.other, recB.id));
  chk("K-c10", "Set reach is drawn on the Judge's seat (it owns every record) and not on the Player's, who only observes that bearer", rowFor(gmKit10.value, W.other, recB?.id)?.setReach === true && rowFor(plKit10.value, W.other, recB?.id)?.setReach === false, { gm: rowFor(gmKit10.value, W.other, recB?.id)?.setReach, player: rowFor(plKit10.value, W.other, recB?.id)?.setReach });
  chk("K-c10", "the blank cell's tooltip is still the cite alone", rowFor(gmKit10.value, W.other, recB?.id)?.reachTip === CITE, { tip: rowFor(gmKit10.value, W.other, recB?.id)?.reachTip });
  const reach10 = await run(gm, P.pressSetReach, { partyId: W.party, key: key10, uuid: recB?.uuid });
  chk("K-c10", "pressing Set reach opens the record's own effect sheet", reach10.button && reach10.sheet, reach10);
  await run(gm, P.darkness, { sceneId: W.scene, level: W.darkness0 });
  darkSet = false;
  await shapeAll();
  await run(gm, P.setPools, { actorId: W.other, pools: null });

  // ------------------------------------------------------------ K-c8
  section("K-c8. the clock runs past the duration");
  const t8 = await recordsOn(W.caster);
  note("the cast record's clock as stored (start, duration)", { start: recA?.startTime, duration: recA?.duration });
  const bothGone = async () => (await recordsOn(W.caster)).every((r) => r.castId !== cast2.castId) && (await recordsOn(W.other)).every((r) => r.castId !== cast7.castId);
  chk("K-c8", "both lights' records still stand before the clock moves", t8.some((r) => r.castId === cast2.castId) && (await recordsOn(W.other)).some((r) => r.castId === cast7.castId));
  let clock8 = await run(gm, P.clock, { advance: 2 * HOUR });
  let gone8 = await until(bothGone, (v) => v === true, { tries: 24 });
  if (!gone8.ok) {
    note("the records stood after the first advance; advancing once more", clock8);
    clock8 = await run(gm, P.clock, { advance: 2 * HOUR });
    gone8 = await until(bothGone, (v) => v === true, { tries: 24 });
  }
  chk("K-c8", "past the duration both lights' records are gone", gone8.ok, { clock: clock8, start: worldTime0 });
  const kg8 = await waitKit(gm, (v) => v.rows.length === 0);
  const kp8 = await waitKit(player, (v) => v.rows.length === 0);
  chk("K-c8", "both seats' Kit tabs list no magic light", kg8.ok && kp8.ok, { gm: kg8.value.rows.length, player: kp8.value.rows.length });
  const shed8 = await run(gm, P.shed, { actorId: W.caster });
  chk("K-c8", "the caster sheds nothing again", shed8.bright === 0 && shed8.dim === 0 && shed8.daylight === 0 && shed8.listed === 0, shed8);

  // ------------------------------------------------------------ K-c9
  section("K-c9. the effect-row editor's three radius boxes");
  await shapeAll();
  await run(gm, P.closeSheets, { partyId: W.party, items: [{ actorId: W.caster, itemId: W.casterSpell }] });
  const ed = await run(gm, P.openEditor, { actorId: W.caster, itemId: W.casterSpell });
  chk("K-c9", "the spell sheet's Mechanics tab offers the Light row's Edit control and it opens the editor", ed.edit === true && ed.editor === true, { sheet: ed.sheet, edit: ed.edit, editor: ed.editor, index: ed.index });
  const num = (b) => !!b && b.type === "number";
  chk("K-c9", "the editor shows three number inputs for the radii, holding '', '20' and '40' (the daylight blank)", num(ed.daylight) && num(ed.bright) && num(ed.dim) && ed.daylight.value === "" && ed.bright.value === "20" && ed.dim.value === "40", { daylight: ed.daylight?.value, bright: ed.bright?.value, dim: ed.dim?.value });
  const citeTip = await run(gm, P.format, { key: "ACKS-LIB.effectEditor.tip.cite", data: { cite: CITE } });
  const hint = await loc(gm, "ACKS-LIB.effectEditor.tip.lightBand");
  chk("K-c9", "the blank radius's tooltip is the page alone (the editor's own 'Page: {cite}' wording), and a typed radius's is the field hint, which does not name the page", !!ed.daylight && ed.daylight.tip === citeTip && ed.bright?.tip === hint && !ed.bright.tip.includes(CITE), { blankTip: ed.daylight?.tip, typedTip: ed.bright?.tip });
  await run(gm, P.closeSheets, { partyId: W.party, items: [{ actorId: W.caster, itemId: W.casterSpell }] });

  // ------------------------------------------------------------ K-c11
  section("K-c11. the imported reach (the Judge's own copy of RR; a seat with none skips)");
  const k11Uuids = [];
  try {
    const shelf = await run(gm, P.shelf, { ids: { timed: "def.spell.illumination", perpetual: "def.spell.illuminationPerpetual" } });
    const have = Object.entries(shelf.spells).filter(([, v]) => v);
    for (const [slug, v] of Object.entries(shelf.spells)) if (!v) console.log(`SKIP  K-c11: the ${slug} illumination spell is not on this seat's Spells shelf  ${shelf.rr ? "RR is open but the entry is not imported: re-import it (Settings tab → Game Settings → ACKS II — Extras → Manage imports → (Re)import individual entries) and run again" : "this seat holds no copy of RR, so no imported figure can be read; none is invented"}`);
    if (have.length) {
      await shapeAll();
      await run(gm, P.setPools, { actorId: W.caster, pools: null });
      await clearOwnRecords();
      const copies = {};
      for (const [slug, v] of have) {
        const made = await gm.create("Item", { ...v.payload, name: `QA Kit Illumination ${slug}` }, { parent: `Actor.${W.caster}` });
        await ledger.track(made.uuid, "Item");
        k11Uuids.push(made.uuid);
        copies[slug] = { id: idOf(made), ...(await run(gm, P.syncCopy, { actorId: W.caster, itemId: idOf(made), payload: v.payload })) };
      }
      await run(gm, P.openKit, { partyId: W.party, fresh: true });
      const offered = await waitKit(gm, (v) => Object.values(copies).every((c) => v.options.some((o) => o.value.startsWith(`${W.caster}|${c.id}|`))));
      chk("K-c11", "the cast row's select offers each imported spell the shelf holds (the perpetual form carried no light row before the import gained one)", offered.ok, { options: offered.value.options.length, wanted: Object.keys(copies) });
      for (const [slug, c] of Object.entries(copies)) {
        const tag = `K-c11 ${slug}`;
        chk("K-c11", `${slug}: the imported spell carries a non-reversed light row (the re-import brought it) and its cite names the page`, c.hasRow && c.cite.length > 0 && c.cite.includes(slug === "timed" ? "227" : "228"), { hasRow: c.hasRow, cite: c.cite.length > 0 });
        if (!c.hasRow) continue;
        const exp = ["daylight", "bright", "dim"].map((b) => (c.bands[b] ? String(c.bands[b]) : ""));
        chk("K-c11", `${slug}: the row's bands were located by the import (at least one figure stands); the unread ones are ${["daylight", "bright", "dim"].filter((b) => !c.bands[b]).join(", ") || "none"}`, exp.some(Boolean), { bands: ["daylight", "bright", "dim"].map((b) => !!c.bands[b]) });
        if (slug === "timed") chk("K-c11", "timed: the page prints no daylight band, so none is located", exp[0] === "", { daylight: exp[0] === "" });
        await shapeAll();
        await run(gm, P.setPools, { actorId: W.caster, pools: null });
        await run(gm, P.openKit, { partyId: W.party, fresh: true });
        await waitKit(gm, (v) => v.options.some((o) => o.value.startsWith(`${W.caster}|${c.id}|`)));
        const option = (await kitOf(gm)).options.find((o) => o.value.startsWith(`${W.caster}|${c.id}|`));
        await run(gm, P.pick, { partyId: W.party, value: option?.value ?? "" });
        await run(gm, K.closeDialog);
        const press = await run(gm, P.pressCast, { partyId: W.party });
        const cast = await run(gm, P.confirmCast, { mode: "normal" });
        await keep(cast);
        chk("K-c11", `${slug}: the Judge's Cast opens the imported spell's window and the confirmed cast posts its card`, press.dialog && cast.card, { dialog: press.dialog, card: cast.card, verdicts: cast.verdicts });
        if (!cast.card) continue;
        const rec = await until(() => recordsOn(W.caster), (rs) => rs.some((r) => r.castId === cast.castId && r.bandKeys > 0));
        const mine = rec.value.find((r) => r.castId === cast.castId && r.bandKeys > 0) ?? null;
        if (mine) await ledger.track(mine.uuid, "ActiveEffect");
        chk("K-c11", `${slug}: the record's three band changes read the imported figures in band order (a blank where the import read none), each of lib's type, and the cite flag is the spell's own cite`, mine?.bandKeys === 3 && JSON.stringify(mine.values) === JSON.stringify(exp) && mine.typesOk && mine.cite === c.cite, { values: mine?.values?.map((x) => x !== ""), cite: mine?.cite === c.cite });
        if (slug === "perpetual") chk("K-c11", "perpetual: the record carries no start time and no duration", !!mine && mine.startTime === null && mine.duration === null, { startTime: mine?.startTime, duration: mine?.duration });
        else chk("K-c11", "timed: the record is timed (a start and a duration)", !!mine && Number.isFinite(mine.startTime) && !!mine.duration, { startTime: mine?.startTime });
        const parts = [];
        if (c.bands.daylight) parts.push(await run(gm, P.format, { key: "ACKS-FORMATION.app.magicLightDaylight", data: { daylight: c.bands.daylight } }));
        if (c.bands.bright || c.bands.dim) {
          const key = c.bands.bright && c.bands.dim ? "magicLightReach" : c.bands.bright ? "magicLightBrightOnly" : "magicLightDimOnly";
          parts.push(await run(gm, P.format, { key: "ACKS-" + "FORMATION.app." + key, data: { ...(c.bands.bright ? { bright: c.bands.bright } : {}), ...(c.bands.dim ? { dim: c.bands.dim } : {}) } }));
        }
        const row = await waitKit(gm, (v) => !!mine && !!rowFor(v, W.caster, mine.id));
        const r = mine ? rowFor(row.value, W.caster, mine.id) : null;
        chk("K-c11", `${slug}: the Kit row's reach cell is the imported reach in the tab's words, and the row is Shining`, row.ok && r.reachText === parts.join(" · ") && r.state === "shining", { reach: r?.reachText === parts.join(" · "), state: r?.state });
        if (slug === "perpetual") {
          await run(gm, P.clock, { advance: 2 * HOUR });
          const after = await waitKit(gm, (v) => !!mine && !!rowFor(v, W.caster, mine.id));
          chk("K-c11", "perpetual: two hours of the world clock later the record still stands and its row is still listed, with no countdown ever drawn for it", after.ok && (await recordsOn(W.caster)).some((x) => x.id === mine.id), { listed: after.ok });
        }
        const ed = await run(gm, P.openEditor, { actorId: W.caster, itemId: c.id });
        const citeTip = await run(gm, P.format, { key: "ACKS-LIB.effectEditor.tip.cite", data: { cite: c.cite } });
        chk("K-c11", `${slug}: the effect-row editor's three radius boxes hold the imported figures (blank where unread), and a blank one's tooltip is the page alone`, ed.editor === true && ["daylight", "bright", "dim"].every((b, i) => ed[b]?.value === exp[i] && (exp[i] !== "" || ed[b]?.tip === citeTip)), { editor: ed.editor, values: ["daylight", "bright", "dim"].map((b, i) => ed[b]?.value === exp[i]) });
        await run(gm, P.closeSheets, { partyId: W.party, items: [{ actorId: W.caster, itemId: c.id }] });
        if (mine) note(`${tag}: the cast's record swept by its own uuid`, await gm.sweepTracked({ only: [mine.uuid] }));
      }
      console.log("NOT WALKED  K-c11: a typed band surviving a second re-import as held, a re-import of a row left untouched, and the Judge's unread listing  these drive the importer's own window and are the recipe's and not this walk's");
    }
  } catch (err) {
    console.error("WALK ERROR (K-c11):", err?.stack ?? err);
    chk("K-c11", "the step ran to the end", false, String(err?.message ?? err).slice(0, 200));
  } finally {
    try { await run(gm, P.closeSheets, { partyId: W.party, items: [{ actorId: W.caster, itemId: W.casterSpell }] }); } catch { /* sheets only */ }
    try { if (k11Uuids.length) note("K-c11: the imported spells' copies on the caster, swept by their own uuids", await gm.sweepTracked({ only: k11Uuids })); } catch (err) { console.error("K-c11 sweep:", err?.message ?? err); }
    await shapeAll();
    await run(gm, P.setPools, { actorId: W.other, pools: null });
  }

  // ------------------------------------------------------------ K-c12
  section("K-c12. daylight from a placed light: the Light here line");
  const k12 = { home: null, env: null, travel: null, lightId: null, tokenMoved: false };
  const k12Uuids = [];
  const lineOf = (seat, test) => until(() => run(seat, P.lightLine, { partyId: W.party }), test, { tries: 40, every: 300 });
  try {
    const A = { x: 750, y: 450 };
    const C = { x: 990, y: 450 };
    const levelWord = (l) => loc(gm, "ACKS-" + "LIB.light.level." + l);
    await shapeAll();
    await run(gm, P.setPools, { actorId: W.other, pools: null });
    await clearOwnRecords();
    await detach(W.caster, false);
    k12.home = await run(gm, P.moveToken, { sceneId: W.scene, tokenId: pt.tokenId });
    k12.env = await run(gm, P.env, { sceneId: W.scene, global: false, level: 0.8 });
    k12.travel = (await run(gm, P.travel, { fid: W.fid, mode: null, sceneId: W.scene })).was;
    if (k12.travel === "journey") await run(gm, P.travel, { fid: W.fid, mode: "delve", sceneId: W.scene });
    await run(gm, P.moveToken, { sceneId: W.scene, tokenId: pt.tokenId, hidden: false });
    const light = await gm.fixture("formation/daylight-ambient", "AmbientLight", { x: 800, y: 500, hidden: false, config: { bright: 10, dim: 20 } }, { parent: `Scene.${W.scene}` });
    k12.lightId = idOf(light);
    const shaped = await run(gm, P.ambient, { sceneId: W.scene, lightId: k12.lightId, set: { x: 800, y: 500, hidden: false, "config.bright": 10, "config.dim": 20, "flags.acks-extras.-=daylight": null } });
    chk("K-c12", "the fixture light stands on the kit scene far from the party's home square, with its bright and dim radii typed and no daylight radius", shaped.daylight === null && shaped.bright === 10 && shaped.dim === 20 && shaped.hidden === false, { daylight: shaped.daylight, bright: shaped.bright, dim: shaped.dim });
    const kindAmbient = await loc(gm, "ACKS-FORMATION.app.lightHereKindAmbient");
    const kindToken = await loc(gm, "ACKS-FORMATION.app.lightHereKindToken");
    const kindSky = await loc(gm, "ACKS-FORMATION.app.lightHereKindSky");
    const named = (kind, name) => run(gm, P.format, { key: "ACKS-FORMATION.app.lightHereNamed", data: { kind, name } });
    const ambientTip = shaped.name ? await named(kindAmbient, shaped.name) : kindAmbient;
    await run(gm, P.openKit, { partyId: W.party, fresh: true });
    await run(player, P.openKit, { partyId: W.party, fresh: true });
    const both = async (test, label, expectTip) => {
      const g = await lineOf(gm, test);
      const p = await lineOf(player, test);
      chk("K-c12", `${label}: both seats' open sheets read it with no reopen`, g.ok && p.ok, { gm: g.value.level, player: p.value.level });
      if (expectTip) {
        const tip = typeof expectTip === "function" ? await expectTip() : expectTip;
        chk("K-c12", `${label}: the tooltip on both seats is the source and its page`, g.value.tip === tip.gm && p.value.tip === tip.player, { gm: g.value.tip === tip.gm, player: p.value.tip === tip.player });
      }
      return { g: g.value, p: p.value };
    };
    const same = (tip) => ({ gm: tip, player: tip });
    const at = (spot) => run(gm, P.moveToken, { sceneId: W.scene, tokenId: pt.tokenId, ...spot });

    // The stage the light's own radii give, before any daylight radius.
    await at(A);
    k12.tokenMoved = true;
    const dim0 = await both((v) => v.line && v.level === "bright", "before the radius, the party token inside the light's bright radius reads Bright light", same(ambientTip));
    chk("K-c12", "the line's words are the stage's name", dim0.g.text === (await levelWord("bright")), { text: dim0.g.text });

    // The Daylight radius, written as the config window's submit would write the flag.
    note("K-c12: the Daylight radius field itself (Scene controls → Lighting Controls → double-click the light → Basic Configuration → Light Placement) is the recipe's and lib's walk; here the flag is written by a document update", true);
    await run(gm, P.ambient, { sceneId: W.scene, lightId: k12.lightId, set: { "flags.acks-extras.daylight": 8 } });
    const day = await both((v) => v.level === "daylight", "with a Daylight radius over the token the line reads Daylight", async () => {
      const tip = `${ambientTip} · RR p. 228`;
      return same(tip);
    });
    chk("K-c12", "the daylight line's tooltip names a placed light and ends on the page reference", !!day.g.tip && day.g.tip.startsWith(ambientTip) && day.g.tip.endsWith("RR p. 228"), { startsOk: day.g.tip?.startsWith(ambientTip) });
    await at(C);
    await both((v) => v.level === "dim", "the token moved out of the daylight and bright radii reads Dim light by the light's own radii", same(ambientTip));
    await at(k12.home);
    const dark = await both((v) => v.level === "dark" && v.line, "the token moved out of every radius reads Dark");
    chk("K-c12", "a Dark line carries no tooltip", dark.g.tip === null && dark.p.tip === null && dark.g.text === (await levelWord("dark")), { gm: dark.g.tip, player: dark.p.tip });
    await at(A);
    await run(gm, P.ambient, { sceneId: W.scene, lightId: k12.lightId, set: { "flags.acks-extras.-=daylight": null } });
    await both((v) => v.level === "bright", "with the radius cleared and the token inside, the line falls back to Bright light", same(ambientTip));

    // A lit token that decides the reading: named only to a seat holding Observer on its actor.
    const beacon = await gm.create("Actor", { name: "QA Kit Beacon", type: "monster", prototypeToken: { actorLink: true }, ownership: { default: 0 } });
    await ledger.track(beacon.uuid, "Actor");
    k12Uuids.push(beacon.uuid);
    const fx = await run(gm, P.beaconEffect, { actorId: idOf(beacon), feet: 6 });
    if (fx.daylight !== 6) console.log(`SKIP  K-c12: a hand-made magic-light effect on the beacon actor reads daylight ${fx.daylight}, not the 6 ft it states, so the token-source cases are not walked`);
    else {
      const tk = await run(gm, P.placeBeacon, { sceneId: W.scene, actorId: idOf(beacon), x: A.x, y: A.y });
      await ledger.track(tk.uuid, "Token");
      k12Uuids.push(tk.uuid);
      const tokenName = "QA Kit Beacon Token";
      const gmTip = `${await named(kindToken, tokenName)} · RR p. 228`;
      await both((v) => v.level === "daylight", "a lit token whose actor sheds daylight decides the reading: the Judge's seat names the token, a Player seat with no Observer on its actor is told the kind and the page alone", { gm: gmTip, player: `${kindToken} · RR p. 228` });
      const grant = await run(gm, P.ownership, { uuid: beacon.uuid, map: { default: 0, [W.playerId]: 2 } });
      await run(player, P.openKit, { partyId: W.party, fresh: true });
      const named2 = await lineOf(player, (v) => v.tip === gmTip);
      chk("K-c12", "once the Player holds Observer on the token's actor the Player's line names the token as the Judge's does", grant[W.playerId] === 2 && named2.ok, { stored: grant[W.playerId], tip: named2.value.tip === gmTip });
      await run(gm, P.moveToken, { sceneId: W.scene, tokenId: tk.id, x: 100, y: 650 });
      await both((v) => v.level === "bright", "moving the lit token away redraws the open sheets with no reopen: the line falls to the placed light's Bright light", same(ambientTip));
    }

    // The sky: the scene's darkness and environment redraw the open sheet.
    await run(gm, P.env, { sceneId: W.scene, global: true, level: 0.1 });
    const sky = await both((v) => v.level === "daylight" && !!v.tip && v.tip.startsWith(kindSky), "with the scene's sky lit (global illumination on, darkness 0.1) the line reads Daylight and its tooltip names the sky");
    chk("K-c12", "the sky's tooltip carries a page reference after its kind", sky.g.tip?.split(" · ").length === 2 && sky.p.tip === sky.g.tip, { parts: sky.g.tip?.split(" · ").length });
    await run(gm, P.env, { sceneId: W.scene, level: 0.8 });
    await both((v) => v.level === "bright", "raising the darkness back to 0.8 redraws the line to the placed light's Bright light", same(ambientTip));
    await run(gm, P.env, { sceneId: W.scene, global: false });

    // No line: a hidden party token, a deployed party, a journey. The Light Sources section stays drawn, so an absent line is not an absent tab.
    const hid = await at({ hidden: true });
    const gone = await lineOf(gm, (v) => v.section && !v.line);
    const goneP = await lineOf(player, (v) => v.section && !v.line);
    chk("K-c12", "with the party's token hidden the Light Sources section is drawn and the line is not, on both seats", hid.hidden === true && gone.ok && goneP.ok, { hidden: hid.hidden, gm: gone.value, player: goneP.value.line });
    await at({ hidden: false });
    await both((v) => v.line && v.level === "bright", "unhiding the token brings the line back", same(ambientTip));
    const dep = await detach(W.caster, true);
    deployed = !!dep.deployed;
    const hiddenNow = (await at({})).hidden;
    if (!deployed) notWalked("K-c12", "the line while a member is deployed", `the Order tab's detach control was not reached (found ${dep.found}, deployed ${dep.deployed})`);
    else {
      const seen = await lineOf(gm, (v) => v.section && (hiddenNow ? !v.line : v.line));
      chk("K-c12", `with a member deployed the line is absent exactly while the party's token is hidden (hidden: ${hiddenNow})`, seen.ok, { hidden: hiddenNow, line: seen.value.line });
      await detach(W.caster, false);
      deployed = false;
    }
    await at({ hidden: false });
    const jm = await run(gm, P.travel, { fid: W.fid, mode: "journey", sceneId: W.scene });
    const jgm = await lineOf(gm, (v) => v.section && !v.line);
    const jpl = await lineOf(player, (v) => v.section && !v.line);
    chk("K-c12", "on a journey the Light Sources section is drawn and the line is not, on both seats", jm.now === "journey" && jgm.ok && jpl.ok, { mode: jm.now, gm: jgm.value.line, player: jpl.value.line });
    await run(gm, P.travel, { fid: W.fid, mode: k12.travel === "journey" ? "delve" : (k12.travel ?? "delve"), sceneId: W.scene });
    await both((v) => v.line && v.level === "bright", "leaving the journey brings the line back", same(ambientTip));
    console.log("NOT WALKED  K-c12: a party with no token on its scene (the kit party's token is a kept fixture, and its absence is a setup check of its own)");
  } catch (err) {
    console.error("WALK ERROR (K-c12):", err?.stack ?? err);
    chk("K-c12", "the step ran to the end", false, String(err?.message ?? err).slice(0, 200));
  } finally {
    const tidy12 = async (label, fn) => { try { note(label, await fn()); } catch (err) { console.error(`${label}:`, err?.message ?? err); } };
    if (k12.lightId) await tidy12("K-c12: the placed light's daylight flag cleared", () => run(gm, P.ambient, { sceneId: W.scene, lightId: k12.lightId, set: { "flags.acks-extras.-=daylight": null } }));
    if (k12.home && k12.tokenMoved) await tidy12("K-c12: the party token put back and shown", () => run(gm, P.moveToken, { sceneId: W.scene, tokenId: pt.tokenId, x: k12.home.x, y: k12.home.y, hidden: k12.home.hidden }));
    if (k12.env) await tidy12("K-c12: the scene's sky put back", () => run(gm, P.env, { sceneId: W.scene, global: k12.env.global, level: k12.env.level }));
    if (k12.travel) await tidy12("K-c12: the party's travel mode put back", () => run(gm, P.travel, { fid: W.fid, mode: k12.travel, sceneId: W.scene }));
    await tidy12("K-c12: the sheets closed", () => run(gm, P.closeSheets, { partyId: W.party, items: [{ actorId: W.caster, itemId: W.casterSpell }] }));
    if (k12Uuids.length) await tidy12("K-c12: the beacon actor and its token, swept by their own uuids", () => gm.sweepTracked({ only: k12Uuids }));
  }

  // ------------------------------------------------------------ end
  section("console");
  for (const [label, seat] of [["gm", gm], ["player", player]]) {
    const d = await run(seat, K.drain);
    check(`${label}: no console error was recorded since the seat was installed (after ready: the load itself is not covered)`, d.errors.length === 0, d.errors.slice(0, 3));
  }
  walkDone();
} catch (err) {
  if (!(err instanceof WalkBlocked)) {
    console.error("WALK ERROR:", err?.stack ?? err);
    check("walk ran to the end", false);
  }
} finally {
  section("restore");
  const tidy = async (label, fn) => { try { note(label, await fn()); } catch (err) { console.error(`${label}:`, err?.message ?? err); } };
  if (gm && W.caster) {
    for (const seat of [gm, player]) if (seat) await tidy("dialog left open", () => run(seat, K.closeDialog));
    for (const seat of [gm, player]) if (seat) await tidy("sheets closed", () => run(seat, P.closeSheets, { partyId: W.party, items: [{ actorId: W.caster, itemId: W.casterSpell }, { actorId: W.other, itemId: W.otherSpell }] }));
    if (deployed) await tidy("the caster gathered back", () => detach(W.caster, false));
    if (darkSet) await tidy("the room's darkness put back", () => run(gm, P.darkness, { sceneId: W.scene, level: W.darkness0 ?? 0 }));
    await tidy("both spells' radii, counts and pools put back", () => shapeAll());
    if (worldTime0 != null) await tidy("world clock put back", () => run(gm, P.clock, { set: worldTime0 }));
  }
  await finish({ gm, player, ledger, fixtureRe: "^formation/kit-cast-", restore: K.restore });
  console.log("fixtures kept: formation/kit-cast-scene, -party, -token, -class, -caster, -spell, -other, -other-spell");
  try { if (player) await player.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  summarize();
}
