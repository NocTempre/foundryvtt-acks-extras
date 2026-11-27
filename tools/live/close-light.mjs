/**
 * Live walk, close-light: the closing check of two topics, one PASS or FAIL for
 * each control a commit changed (the owner: "Yes, walk them", "only what changed
 * is checked"). The GM seat drives every write; a Player seat is added only where
 * a commit says a Player sees something. Machine values arrive through ./_env.mjs.
 *
 * Topic light-daylight (T-0791), commits 34185471 and bf6dd5f3:
 *   - the Daylight radius control the module injects on core's Light Source
 *     window (Basic tab, after the bright and dim radii): present, blank,
 *     typed and saved through the window's own Update button, kept across a
 *     re-render and a reopen, cleared, a new light's window, and what a hidden
 *     light or an activation range does to the reading;
 *   - a light reading names its source: `lightLevelOf` answers the source's kind
 *     (ambient, token, sky), its name, its page and its id, after a real write;
 *   - the party sheet's Kit tab Light here line: the stage in words and its
 *     provenance tooltip, redrawn with no reopen on a placed light's change, the
 *     party token's move, a lit token, the scene's sky; no line on a hidden party
 *     token or a journey; a token source named only to a seat holding Observer on
 *     its actor (the Player seat, made Owner of the party for the step).
 * Topic cast-light (T-0791), commit f819208c: a real cast of a spell whose light
 * row carries no band locators writes a blank-banded record, and that record is
 * the party's light before its reach is known (model, warnings, header cell),
 * stops counting when shuttered, and its row offers Set reach to the Judge's seat
 * and not to the Player's. The cast goes through the Kit tab's own Cast button
 * and the cast window; no band is typed by API.
 *
 * Fixtures, kept and found by marker (the GM seat builds them; every name and
 * figure is invented): `formation/close-light-scene` (square 5 ft grid, a room),
 * the party `-party` and its token `-token`, the class `-class`, the casters
 * `-caster` and `-other` with their spells `-spell` and `-other-spell`, and the
 * placed light `formation/close-light-ambient`. Built and swept by the run's own
 * ids: the casts' cards and records, the beacon actor and its token, the light a
 * new-light step creates. Writes outside the ledger, each put back in a finally:
 * the scene's sky and darkness, the party token's place, the party's travel mode,
 * the Player's ownership of the party and the beacon actor, the light's flag.
 */
import { connect } from "./_driver.mjs";
import { walkDone, blocked, WalkBlocked } from "./_walk.mjs";
import {
  MACHINE, PORTS, P as K, note, section, check, idOf, run, sleep, ledgerFor, finish, summarize, spellFlag,
} from "./_magic-cast-kit.mjs";

const { browser, origin } = MACHINE;
const KEY = "close-light-walk";
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 1_200_000);
const SCENE = "formation/close-light-scene";
const PARTY = "formation/close-light-party";
const TOKEN = "formation/close-light-token";
const CLASS = "formation/close-light-class";
const CASTER = "formation/close-light-caster";
const SPELL_A = "formation/close-light-spell";
const OTHER = "formation/close-light-other";
const SPELL_B = "formation/close-light-other-spell";

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
  /** Close the party sheet, the spells' sheets and every open effect-row editor. */
  closeSheets: async ({ partyId, items }) => {
    await game.actors.get(partyId)?.sheet?.close({ animate: false });
    for (const { actorId, itemId } of items) await game.actors.get(actorId)?.items.get(itemId)?.sheet?.close({ animate: false });
    for (const app of [...(foundry.applications.instances?.values?.() ?? [])]) if (app.element?.classList?.contains("acks-extras-effect-editor")) await app.close({ animate: false });
    return true;
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
  /** The party's travel mode as the record holds it, switched through the module's own writer where `mode` is given. */
  travel: async ({ fid, mode, sceneId }) => {
    const H = globalThis.__kc;
    const was = H.FM.getFormation(fid).travel?.mode ?? null;
    if (mode) await acksExtras.formation.travel.setJourneyMode(fid, mode, { sceneId });
    await H.sleep(600);
    return { was, now: H.FM.getFormation(fid).travel?.mode ?? null };
  },
  /** The helpers the light-configuration steps share, kept on `__kc`. */
  installLight: async () => {
    const H = globalThis.__kc;
    H.FIELD = "flags.acks-extras.daylight";
    H.cfgFacts = (app, scene) => {
      const root = H.root(app);
      const input = root?.querySelector(`[name="${H.FIELD}"]`) ?? null;
      const group = input?.closest(".form-group") ?? null;
      const prev = group?.previousElementSibling ?? null;
      const label = group?.querySelector("label") ?? null;
      const units = String(scene.grid?.units ?? "");
      return {
        window: !!root?.isConnected,
        field: !!input,
        count: root?.querySelectorAll(`[name="${H.FIELD}"]`).length ?? 0,
        inBasic: !!input?.closest('[data-application-part="basic"]'),
        afterRadii: !!prev?.querySelector('[name="config.bright"]') && !!prev?.querySelector('[name="config.dim"]'),
        unitBeside: !!units && !!label && label.textContent.includes(`(${units})`),
        tipKey: group?.dataset.tooltip ?? null,
        ariaNamed: !!input?.getAttribute("aria-label"),
        value: input?.value ?? null,
        disabled: !!input?.disabled,
        title: !!group?.hasAttribute("title"),
      };
    };
    return { ok: true };
  },
  /** A placed light's own configuration window, opened fresh as a user does (the document's sheet), and the control it carries as drawn. */
  openLightConfig: async ({ sceneId, lightId }) => {
    const H = globalThis.__kc;
    const scene = game.scenes.get(sceneId);
    const app = scene.lights.get(lightId).sheet;
    await app.close({ animate: false });
    await app.render(true);
    await H.poll(() => H.root(app)?.isConnected);
    await H.sleep(900);
    H.root(app)?.querySelector('[data-action="tab"][data-tab="basic"]')?.click();
    await H.sleep(300);
    return { ctor: app.constructor.name, ...H.cfgFacts(app, scene) };
  },
  /** Type a value into the open window's Daylight radius control (value, input, change), and press Update Ambient Light where `save` is set. */
  typeDaylight: async ({ sceneId, lightId, text, save }) => {
    const H = globalThis.__kc;
    const scene = game.scenes.get(sceneId);
    const app = scene.lights.get(lightId).sheet;
    const root = H.root(app);
    const input = root?.querySelector(`[name="${H.FIELD}"]`);
    if (!input) return { field: false };
    input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await H.sleep(600);
    if (!save) return { field: true, saved: false, value: input.value };
    const btn = root.querySelector('button[type="submit"]');
    if (!btn) return { field: true, button: false };
    btn.click();
    await H.sleep(1500);
    return { field: true, button: true, saved: true, closed: !H.root(app)?.isConnected || app.state !== 2 };
  },
  /** A full re-render of the open window (every part), and the control as drawn after it. */
  rerenderLightConfig: async ({ sceneId, lightId }) => {
    const H = globalThis.__kc;
    const scene = game.scenes.get(sceneId);
    const app = scene.lights.get(lightId).sheet;
    await app.render({ force: true });
    await H.sleep(900);
    return H.cfgFacts(app, scene);
  },
  closeLightConfig: async ({ sceneId, lightId }) => {
    await game.scenes.get(sceneId)?.lights.get(lightId)?.sheet?.close({ animate: false });
    return true;
  },
  /** A light placed on the scene at a spot, as the layer leaves one: bright and dim radii typed, no daylight; answers its id and uuid. */
  placeLight: async ({ sceneId, x, y }) => {
    const scene = game.scenes.get(sceneId);
    const [l] = await scene.createEmbeddedDocuments("AmbientLight", [{ x, y, hidden: false, config: { bright: 10, dim: 20 } }]);
    return { id: l.id, uuid: l.uuid };
  },
  /** What lib reads of a token's light: stage, how, and the deciding source's kind, name, page and id. */
  reading: async ({ sceneId, tokenId }) => {
    const H = globalThis.__kc;
    const token = game.scenes.get(sceneId).tokens.get(tokenId);
    const r = H.LT.lightLevelOf(token);
    const s = r?.source ?? null;
    return { level: r?.level ?? null, by: r?.by ?? null, hasSource: !!s, kind: s?.kind ?? null, name: s?.name ?? null, cite: s?.cite ?? null, id: s?.id ?? null };
  },
  /** The placed light's own darkness range and hidden state, written (the activation range steps). */
  lightRange: async ({ sceneId, lightId, hidden, range }) => {
    const scene = game.scenes.get(sceneId);
    const patch = { _id: lightId };
    if (hidden != null) patch.hidden = hidden;
    if (range) { patch["config.darkness.min"] = range.min; patch["config.darkness.max"] = range.max; }
    await scene.updateEmbeddedDocuments("AmbientLight", [patch]);
    const l = scene.lights.get(lightId);
    return { hidden: !!l.hidden, min: l.config.darkness?.min ?? null, max: l.config.darkness?.max ?? null };
  },
  /** An actor's ownership map replaced whole with `map` (a deletion key inside the map is not a user id on core 14); answers the stored map. */
  ownership: async ({ uuid, map }) => {
    const doc = await fromUuid(uuid);
    await doc.update({ ownership: map }, { diff: false, recursive: false });
    return { ...doc._source.ownership };
  },
  /** A lit token placed on a scene for the step (its own light, no actor light); answers its uuid and id. */
  placeBeacon: async ({ sceneId, actorId, x, y, name }) => {
    const scene = game.scenes.get(sceneId);
    const [t] = await scene.createEmbeddedDocuments("Token", [{ actorId, x, y, name, actorLink: true, hidden: false, disposition: 0, light: { bright: 12, dim: 14 } }]);
    return { uuid: t.uuid, id: t.id, name: t.name };
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
  const census = JSON.parse(await gm.eval(`JSON.stringify({ seated: game.users.filter((u) => u.active).map((u) => [u.name, u.isGM]), activeGM: game.users.activeGM?.name ?? null, self: game.user.name })`));
  note("census: active users [name, isGM]", census.seated);
  note("census: the active GM", census.activeGM);
  if (census.activeGM !== census.self) note("census: a Judge other than this lane's own holds the active GM seat; the walk goes on and a check that needs the primary GM's automation will say so", true);
  if (!kg.isGM) blocked("the first seat is not a GM");
  if (kp.isGM) blocked("the second seat is a GM, so a Player's own seat cannot be walked");
  if (gi.userId === pi.userId) blocked("both seats are the same user, so the Player's gate cannot be told from the Judge's");
  check("the first seat is a GM, the other seat a Player, and both publish the formation api", gi.isGM && !pi.isGM && pi.role <= 2 && gi.formation && pi.formation, { gm: gi.role, player: pi.role });
  W.playerId = pi.userId;

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
  W.tokenId = pt.tokenId;
  W.partyUuid = party.uuid;
  if (pt.made) await gm.mark(`Scene.${W.scene}.Token.${pt.made}`, TOKEN);
  check("the party token stands on the room, linked to the record", !!pt.tokenId && pt.sceneId === W.scene, { sceneIsRoom: pt.sceneId === W.scene });
  check("the GM seat views the room", (await run(gm, P.view, { sceneId: W.scene })).scene);
  note("a member a dead run left deployed is gathered back", await detach(W.caster, false));
  await run(gm, K.drain);
  await run(player, K.drain);

  const keyA = optionKey(W.caster, W.casterSpell);
  const keyB = optionKey(W.other, W.otherSpell);
  let recA = null;
  let recB = null;

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
  chk("K-c10", "the fixture shape: the party is not on a journey, no flame is lit, the blank-banded cast record shines", lit10.value.mode !== "journey" && lit10.value.flamesLit === 0 && row10.ok, { mode: lit10.value.mode, flames: lit10.value.flamesLit, blank: rowFor(row10.value, W.other, recB?.id)?.state });
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

  // ------------------------------------------------------------ light-daylight
  const ld = { home: null, env: null, travel: null, lightId: null, tokenMoved: false, partyOwn: false, beaconOwn: null };
  const ldUuids = [];
  const lineOf = (seat, test) => until(() => run(seat, P.lightLine, { partyId: W.party }), test, { tries: 40, every: 300 });
  const A = { x: 750, y: 450 };
  const B = { x: 890, y: 450 };
  const C = { x: 990, y: 450 };
  // The top-right corner, inside the scene rect (a token update that leaves it is not applied), beyond the beacon token's own dim reach of every spot the party token stands on.
  const FAR = { x: 1100, y: 0 };
  const DAY_KEY = "ACKS-LIB.ambientDaylight.tooltip";
  const LIGHT_NAME = "QA Close Lamp";
  const BEACON_NAME = "QA Close Beacon Token";
  const at = (spot) => run(gm, P.moveToken, { sceneId: W.scene, tokenId: W.tokenId, ...spot });
  const readAt = () => run(gm, P.reading, { sceneId: W.scene, tokenId: W.tokenId });
  /** Open the light's window fresh, type a radius and press Update Ambient Light; the stored light is read back. */
  const setRadius = async (text) => {
    await run(gm, P.openLightConfig, { sceneId: W.scene, lightId: ld.lightId });
    const typed = await run(gm, P.typeDaylight, { sceneId: W.scene, lightId: ld.lightId, text, save: true });
    return { typed, stored: await run(gm, P.ambient, { sceneId: W.scene, lightId: ld.lightId }) };
  };
  try {
    await clearOwnRecords();
    // Run 2 of this check died before its sweep and left its beacon actor and token; the ids its log printed are re-tracked and swept, nothing else.
    const left = ["Actor.EhqPhcHznk9OxZQ6", "Scene.u5mDuPCmsgfj1itl.Token.cFaCxmpUCec8eHfU"];
    for (const uuid of left) await ledger.track(uuid, uuid.includes(".Token.") ? "Token" : "Actor");
    note("a dead run's beacon actor and token, swept by the ids its log printed", await gm.sweepTracked({ only: left }).catch((e) => String(e?.message ?? e).slice(0, 200)));
    await shapeAll();
    await run(gm, P.setPools, { actorId: W.other, pools: null });
    await run(gm, K.closeDialog);
    await run(gm, P.installLight);
    ld.home = await run(gm, P.moveToken, { sceneId: W.scene, tokenId: W.tokenId });
    ld.env = await run(gm, P.env, { sceneId: W.scene, global: false, level: 0.8 });
    ld.travel = (await run(gm, P.travel, { fid: W.fid, mode: null, sceneId: W.scene })).was;
    if (ld.travel === "journey") await run(gm, P.travel, { fid: W.fid, mode: "delve", sceneId: W.scene });
    await run(gm, P.moveToken, { sceneId: W.scene, tokenId: W.tokenId, hidden: false });
    const light = await gm.fixture("formation/close-light-ambient", "AmbientLight", { x: 800, y: 500, hidden: false, name: LIGHT_NAME, config: { bright: 10, dim: 20 } }, { parent: `Scene.${W.scene}` });
    ld.lightId = idOf(light);

    section("light-daylight (34185471): the Daylight radius control on core's Light Source window");
    const shaped = await run(gm, P.ambient, { sceneId: W.scene, lightId: ld.lightId, set: { x: 800, y: 500, hidden: false, name: LIGHT_NAME, "config.bright": 10, "config.dim": 20, "config.negative": false, "config.darkness.min": 0, "config.darkness.max": 1, "flags.acks-extras.-=daylight": null } });
    chk("LD-0", "start shape: the light's bright and dim radii typed, no daylight flag, shown, light named", shaped.daylight === null && shaped.bright === 10 && shaped.dim === 20 && shaped.hidden === false, { daylight: shaped.daylight, bright: shaped.bright, dim: shaped.dim, named: shaped.name === LIGHT_NAME });
    const lightNamed = shaped.name === LIGHT_NAME;
    await at(A);
    ld.tokenMoved = true;

    const open1 = await run(gm, P.openLightConfig, { sceneId: W.scene, lightId: ld.lightId });
    chk("LD-1", "the Light Source window carries one Daylight radius field, on the Basic tab directly after the group holding the bright and dim radii", open1.window && open1.field && open1.count === 1 && open1.inBasic && open1.afterRadii, open1);
    chk("LD-1", "the field is blank, shows the scene's unit beside its label, names itself for assistive technology and the group's tooltip is the module's key (no title attribute)", open1.value === "" && open1.unitBeside && open1.ariaNamed && open1.tipKey === DAY_KEY && !open1.title && !open1.disabled, { value: open1.value, unit: open1.unitBeside, aria: open1.ariaNamed, tipIsKey: open1.tipKey === DAY_KEY, title: open1.title });

    const set4 = await setRadius("4");
    chk("LD-2", "typed 4 and pressed Update: the light's flag holds 4 and core's bright and dim radii are as typed before", set4.typed.field && set4.typed.button && set4.stored.daylight === 4 && set4.stored.bright === 10 && set4.stored.dim === 20, { typed: set4.typed, stored: { daylight: set4.stored.daylight, bright: set4.stored.bright, dim: set4.stored.dim } });
    const rIn = await readAt();
    chk("LD-2", "a point inside the radius reads level daylight by a light, its source an ambient light", rIn.level === "daylight" && rIn.by === "light" && rIn.kind === "ambient", rIn);
    await at(B);
    const rMid = await readAt();
    chk("LD-2", "a point past the radius and inside core's bright radius reads bright", rMid.level === "bright" && rMid.kind === "ambient", rMid);
    await at(A);

    const typed6 = await (async () => {
      await run(gm, P.openLightConfig, { sceneId: W.scene, lightId: ld.lightId });
      const t = await run(gm, P.typeDaylight, { sceneId: W.scene, lightId: ld.lightId, text: "6", save: false });
      const after = await run(gm, P.rerenderLightConfig, { sceneId: W.scene, lightId: ld.lightId });
      return { t, after };
    })();
    chk("LD-3", "an unsaved 6 typed in the window survives a full re-render: the field is drawn once and still holds 6", typed6.t.field && typed6.after.count === 1 && typed6.after.field && typed6.after.value === "6" && typed6.after.inBasic, { value: typed6.after.value, count: typed6.after.count });
    await run(gm, P.closeLightConfig, { sceneId: W.scene, lightId: ld.lightId });
    const reopen = await run(gm, P.openLightConfig, { sceneId: W.scene, lightId: ld.lightId });
    chk("LD-3", "closed and reopened, the field holds the saved 4 and not the discarded 6", reopen.field && reopen.value === "4", { value: reopen.value });

    await run(gm, P.openLightConfig, { sceneId: W.scene, lightId: ld.lightId });
    const clr = await run(gm, P.typeDaylight, { sceneId: W.scene, lightId: ld.lightId, text: "", save: true });
    const stClr = await run(gm, P.ambient, { sceneId: W.scene, lightId: ld.lightId });
    chk("LD-4", "the field emptied and saved: the flag reads blank", clr.saved && (stClr.daylight === null || stClr.daylight === 0 || stClr.daylight === ""), { daylight: stClr.daylight });
    const rClr = await readAt();
    chk("LD-4", "the same point falls back to bright and its source is still the ambient light", rClr.level === "bright" && rClr.kind === "ambient", rClr);

    await setRadius("4");
    await run(gm, P.lightRange, { sceneId: W.scene, lightId: ld.lightId, hidden: true });
    const rHid = await readAt();
    chk("LD-5", "with the radius set and the light hidden, the reading does not name the light", rHid.kind !== "ambient" && rHid.level !== "daylight", { level: rHid.level, kind: rHid.kind });
    await run(gm, P.lightRange, { sceneId: W.scene, lightId: ld.lightId, hidden: false, range: { min: 0, max: 0.5 } });
    const rRange = await readAt();
    chk("LD-5", "shown again with an activation range that excludes darkness 0.8, the reading still does not name the light", rRange.kind !== "ambient" && rRange.level !== "daylight", { level: rRange.level, kind: rRange.kind });
    const back = await run(gm, P.lightRange, { sceneId: W.scene, lightId: ld.lightId, range: { min: 0, max: 1 } });
    const rBack = await readAt();
    chk("LD-5", "with the range widened to include the darkness the light is named again, as daylight", back.hidden === false && rBack.level === "daylight" && rBack.kind === "ambient", { level: rBack.level, kind: rBack.kind });

    // Core 14 refuses a configuration window on a light that does not yet exist (its own console error says so), so the recipe's Create Ambient Light path is not reachable; a light placed on the scene is the new light a user gets, and its window is the one walked.
    const placed = await run(gm, P.placeLight, { sceneId: W.scene, x: 100, y: 750 });
    ldUuids.push(placed.uuid);
    await ledger.track(placed.uuid, "AmbientLight");
    await run(gm, P.openLightConfig, { sceneId: W.scene, lightId: placed.id });
    const fresh = await run(gm, P.openLightConfig, { sceneId: W.scene, lightId: placed.id });
    const sv = await run(gm, P.typeDaylight, { sceneId: W.scene, lightId: placed.id, text: "3", save: true });
    const stPlaced = await run(gm, P.ambient, { sceneId: W.scene, lightId: placed.id });
    chk("LD-6", "a light just placed on the scene: its window carries the field, blank, and a radius saved from it lands on the new light's flag with core's radii untouched", fresh.field && fresh.count === 1 && fresh.value === "" && sv.saved && stPlaced.daylight === 3 && stPlaced.bright === 10 && stPlaced.dim === 20, { field: fresh.field, blank: fresh.value === "", daylight: stPlaced.daylight, bright: stPlaced.bright, dim: stPlaced.dim });
    await run(gm, P.closeLightConfig, { sceneId: W.scene, lightId: placed.id });
    note("the light LD-6 placed, swept at once by its own uuid so no later reading counts it", await gm.sweepTracked({ only: [placed.uuid] }));
    ldUuids.splice(ldUuids.indexOf(placed.uuid), 1);
    console.log("UNREACHABLE  LD-6b: a radius typed before Create Ambient Light on a light not yet created: core 14 refuses that window (its console error: document creation from AmbientLightConfig is not supported)");

    section("light-daylight (34185471): a light reading names its source");
    await setRadius("4");
    const nAmb = await readAt();
    chk("LS-1", "a placed light decides the reading: kind ambient, its name, its id and the page of the daylight band", nAmb.kind === "ambient" && nAmb.id === ld.lightId && !!nAmb.cite && (lightNamed ? nAmb.name === LIGHT_NAME : true), { kind: nAmb.kind, idIsLight: nAmb.id === ld.lightId, cite: !!nAmb.cite, nameIsLight: nAmb.name === LIGHT_NAME });
    const beaconActor = await gm.create("Actor", { name: "QA Close Beacon", type: "monster", prototypeToken: { actorLink: true }, ownership: { default: 0 } });
    await ledger.track(beaconActor.uuid, "Actor");
    ldUuids.push(beaconActor.uuid);
    await run(gm, P.ambient, { sceneId: W.scene, lightId: ld.lightId, set: { "flags.acks-extras.-=daylight": null } });
    const tk = await run(gm, P.placeBeacon, { sceneId: W.scene, actorId: idOf(beaconActor), x: A.x, y: A.y, name: BEACON_NAME });
    await ledger.track(tk.uuid, "Token");
    ldUuids.push(tk.uuid);
    const nTok = await readAt();
    chk("LS-2", "a token's own light decides a wider reach: kind token, its name and its id, no page for a bright reading", nTok.kind === "token" && nTok.name === BEACON_NAME && nTok.id === tk.id && nTok.level === "bright" && nTok.cite === null, { level: nTok.level, kind: nTok.kind, nameIsToken: nTok.name === BEACON_NAME, idIsToken: nTok.id === tk.id, cite: nTok.cite });
    await run(gm, P.env, { sceneId: W.scene, global: true, level: 0.1 });
    const nSky = await readAt();
    chk("LS-3", "with the scene's sky lit the reading is daylight by the sky, source kind sky, with a page and no name", nSky.level === "daylight" && nSky.by === "sky" && nSky.kind === "sky" && !!nSky.cite && nSky.name === null && nSky.id === null, { level: nSky.level, by: nSky.by, kind: nSky.kind, cite: !!nSky.cite });
    await run(gm, P.env, { sceneId: W.scene, global: false, level: 0.8 });

    section("light-daylight (bf6dd5f3): the Kit tab's Light here line");
    // The party actor is made an Owner of the Player seat for the step; the Player reads the same line.
    const grantParty = await run(gm, P.ownership, { uuid: W.partyUuid, map: { default: 2, [W.playerId]: 3 } });
    ld.partyOwn = true;
    chk("LH-0", "the Player seat is made Owner of the party actor from the Judge's seat", grantParty[W.playerId] === 3, { level: grantParty[W.playerId] });
    note("the beacon token after the move away", await run(gm, P.moveToken, { sceneId: W.scene, tokenId: tk.id, ...FAR }));
    note("the beacon token's size and light as stored", JSON.parse(await gm.eval(`(() => { const t = game.scenes.get(${JSON.stringify(W.scene)}).tokens.get(${JSON.stringify(tk.id)}); return JSON.stringify({ w: t.width, h: t.height, x: t.x, y: t.y, bright: t.light.bright, dim: t.light.dim, sceneW: t.parent.width, sceneH: t.parent.height }); })()`)));
    await run(gm, P.openKit, { partyId: W.party, fresh: true });
    await run(player, P.openKit, { partyId: W.party, fresh: true });
    const kindAmbient = await loc(gm, "ACKS-FORMATION.app.lightHereKindAmbient");
    const kindToken = await loc(gm, "ACKS-FORMATION.app.lightHereKindToken");
    const kindSky = await loc(gm, "ACKS-FORMATION.app.lightHereKindSky");
    const named = (kind, name) => run(gm, P.format, { key: "ACKS-FORMATION.app.lightHereNamed", data: { kind, name } });
    const ambientTip = lightNamed ? await named(kindAmbient, LIGHT_NAME) : kindAmbient;
    const levelWord = (l) => loc(gm, `ACKS-LIB.light.level.${l}`);
    const both = async (test, label, expectTip) => {
      const g = await lineOf(gm, (v) => test(v) && (!expectTip || v.tip === expectTip.gm));
      const p = await lineOf(player, (v) => test(v) && (!expectTip || v.tip === expectTip.player));
      chk("LH-1", `${label}: both seats' open sheets read it with no reopen`, g.ok && p.ok, { gm: g.value.level, player: p.value.level, lib: g.ok ? null : await readAt(), gmTip: g.ok ? null : g.value.tip, wantTip: expectTip?.gm ?? null });
      if (expectTip) chk("LH-1", `${label}: the tooltip on both seats is the source and its page`, g.value.tip === expectTip.gm && p.value.tip === expectTip.player, { gm: g.value.tip === expectTip.gm, player: p.value.tip === expectTip.player });
      return { g: g.value, p: p.value };
    };
    const same = (tip) => ({ gm: tip, player: tip });

    await at(A);
    const bright0 = await both((v) => v.line && v.level === "bright", "before a radius, inside the light's bright radius, the line reads Bright light", same(ambientTip));
    chk("LH-1", "the line's words are the stage's name", bright0.g.text === (await levelWord("bright")), { text: bright0.g.text });
    await setRadius("4");
    const day = await both((v) => v.level === "daylight", "a Daylight radius saved from the window redraws the open sheet to Daylight", same(`${ambientTip} · RR p. 228`));
    chk("LH-2", "the daylight line's tooltip names a placed light (by its name) and ends on the page reference", !!day.g.tip && day.g.tip.startsWith(ambientTip) && day.g.tip.endsWith("RR p. 228"), { startsOk: day.g.tip?.startsWith(ambientTip) });
    await at(B);
    await both((v) => v.level === "bright", "the party token moved past the radius reads Bright light by the light's own radius", same(ambientTip));
    await at(C);
    await both((v) => v.level === "dim", "moved out of the bright radius it reads Dim light", same(ambientTip));
    await at(ld.home);
    const dark = await both((v) => v.level === "dark" && v.line, "moved out of every radius it reads Dark");
    chk("LH-2", "a Dark line carries no tooltip", dark.g.tip === null && dark.p.tip === null && dark.g.text === (await levelWord("dark")), { gm: dark.g.tip, player: dark.p.tip });
    await at(A);
    await both((v) => v.level === "daylight", "moved back inside the radius it reads Daylight again", same(`${ambientTip} · RR p. 228`));
    await run(gm, P.openLightConfig, { sceneId: W.scene, lightId: ld.lightId });
    await run(gm, P.typeDaylight, { sceneId: W.scene, lightId: ld.lightId, text: "", save: true });
    await both((v) => v.level === "bright", "the radius cleared from the window with the token inside redraws the line to Bright light", same(ambientTip));

    // A lit token decides: named only to a seat holding Observer on its actor.
    await run(gm, P.moveToken, { sceneId: W.scene, tokenId: tk.id, x: A.x, y: A.y });
    const gmTip = await named(kindToken, BEACON_NAME);
    await both((v) => v.level === "bright" && v.tip === gmTip || v.tip === kindToken, "a lit token decides the reading (moved on, the open sheets redraw)");
    const gTok = await lineOf(gm, (v) => v.tip === gmTip);
    const pTok = await lineOf(player, (v) => v.tip === kindToken);
    chk("LH-3", "the Judge's line names the token; the Player seat with no Observer on its actor is told the kind alone", gTok.ok && pTok.ok, { gm: gTok.value.tip === gmTip, player: pTok.value.tip === kindToken });
    ld.beaconOwn = idOf(beaconActor);
    const grant = await run(gm, P.ownership, { uuid: beaconActor.uuid, map: { default: 0, [W.playerId]: 2 } });
    await run(player, P.openKit, { partyId: W.party, fresh: true });
    const named2 = await lineOf(player, (v) => v.tip === gmTip);
    chk("LH-3", "once the Player holds Observer on the token's actor the Player's line names the token as the Judge's does", grant[W.playerId] === 2 && named2.ok, { stored: grant[W.playerId], tip: named2.value.tip === gmTip });
    await run(gm, P.moveToken, { sceneId: W.scene, tokenId: tk.id, ...FAR });
    await both((v) => v.level === "bright", "moving the lit token away redraws both open sheets: the line falls to the placed light's Bright light", same(ambientTip));

    // The sky: the scene's darkness and environment redraw the open sheet.
    await run(gm, P.env, { sceneId: W.scene, global: true, level: 0.1 });
    const sky = await both((v) => v.level === "daylight" && !!v.tip && v.tip.startsWith(kindSky), "with the scene's sky lit the line reads Daylight and its tooltip names the sky");
    chk("LH-4", "the sky's tooltip carries a page reference after its kind, the same on both seats", sky.g.tip?.split(" · ").length === 2 && sky.p.tip === sky.g.tip, { parts: sky.g.tip?.split(" · ").length });
    await run(gm, P.env, { sceneId: W.scene, global: false, level: 0.8 });
    await both((v) => v.level === "bright", "darkness raised back to 0.8 redraws the line to the placed light's Bright light", same(ambientTip));

    // No line: a hidden party token, a journey. The Light Sources section stays drawn, so an absent line is not an absent tab.
    const hid = await at({ hidden: true });
    const gone = await lineOf(gm, (v) => v.section && !v.line);
    const goneP = await lineOf(player, (v) => v.section && !v.line);
    chk("LH-5", "with the party's token hidden the Light Sources section is drawn and the line is not, on both seats", hid.hidden === true && gone.ok && goneP.ok, { hidden: hid.hidden, gm: gone.value.line, player: goneP.value.line });
    await at({ hidden: false });
    await both((v) => v.line && v.level === "bright", "unhiding the token brings the line back", same(ambientTip));
    const jm = await run(gm, P.travel, { fid: W.fid, mode: "journey", sceneId: W.scene });
    const jgm = await lineOf(gm, (v) => v.section && !v.line);
    const jpl = await lineOf(player, (v) => v.section && !v.line);
    chk("LH-5", "on a journey the Light Sources section is drawn and the line is not, on both seats", jm.now === "journey" && jgm.ok && jpl.ok, { mode: jm.now, gm: jgm.value.line, player: jpl.value.line });
    await run(gm, P.travel, { fid: W.fid, mode: ld.travel === "journey" ? "delve" : (ld.travel ?? "delve"), sceneId: W.scene });
    await both((v) => v.line && v.level === "bright", "leaving the journey brings the line back", same(ambientTip));
    console.log("NOT WALKED  LH-5: a party with no token on its scene, and a deployed member (the kept party token is a fixture and the Order tab's detach is another recipe's)");
  } catch (err) {
    console.error("WALK ERROR (light-daylight):", err?.stack ?? err);
    chk("LD", "the light-daylight steps ran to the end", false, String(err?.message ?? err).slice(0, 200));
  } finally {
    const tidyLd = async (label, fn) => { try { note(label, await fn()); } catch (err) { console.error(`${label}:`, err?.message ?? err); } };
    if (ld.lightId) {
      await tidyLd("the placed light's flag, range and shown state put back", () => run(gm, P.ambient, { sceneId: W.scene, lightId: ld.lightId, set: { hidden: false, "config.darkness.min": 0, "config.darkness.max": 1, "flags.acks-extras.-=daylight": null } }));
      await tidyLd("the light window closed", () => run(gm, P.closeLightConfig, { sceneId: W.scene, lightId: ld.lightId }));
    }
    if (ld.home && ld.tokenMoved) await tidyLd("the party token put back and shown", () => run(gm, P.moveToken, { sceneId: W.scene, tokenId: W.tokenId, x: ld.home.x, y: ld.home.y, hidden: ld.home.hidden }));
    if (ld.env) await tidyLd("the scene's sky put back", () => run(gm, P.env, { sceneId: W.scene, global: ld.env.global, level: ld.env.level }));
    if (ld.travel) await tidyLd("the party's travel mode put back", () => run(gm, P.travel, { fid: W.fid, mode: ld.travel, sceneId: W.scene }));
    if (ld.partyOwn) await tidyLd("the Player's ownership of the party put back", () => run(gm, P.ownership, { uuid: W.partyUuid, map: { default: 2 } }));
    await tidyLd("the sheets closed", () => run(gm, P.closeSheets, { partyId: W.party, items: [{ actorId: W.caster, itemId: W.casterSpell }] }));
    if (ldUuids.length) await tidyLd("the beacon, its token and the created light, swept by their own uuids", () => gm.sweepTracked({ only: ldUuids }));
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
  }
  await finish({ gm, player, ledger, fixtureRe: "^formation/close-light-", restore: K.restore });
  console.log("fixtures kept: formation/close-light-scene, -party, -token, -class, -caster, -spell, -other, -other-spell, -ambient");
  try { if (player) await player.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  summarize();
}
