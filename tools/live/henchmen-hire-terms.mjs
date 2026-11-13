/**
 * Live walk, henchmen-hire-terms: what a hire writes into the henchman's
 * terms and stat block. Walks docs/henchmen/TESTING.md step 20 on the GM and
 * Player seats: a signing bonus the purse refuses is kept as owed while the
 * hire stands and is recorded as a calamity with the Judge's prompt card
 * (the walk holds calamity auto-roll off and restores it), and a henchman of an imported class has hit points rolled
 * through the classes feature; an unknown class records "not imported"; a
 * 0th-level hire records nothing; a bonus paid through the Player seat's
 * Recruit button on the location sheet owes nothing. An owed bonus is tagged on
 * the employer's roster; the Service tab's Pay refuses against an empty purse
 * and changes nothing, the GM's Forgive clears it and leaves the arrears, and
 * the Player's Pay moves the coin and clears it. It also measures, without
 * writing, how many of the world's candidate class keys resolve to an imported
 * class through the lookup a hire uses. Step 25, on the GM seat alone: an
 * Irrefusable Offer to a captured monster, made through the influence-hosted
 * page under invented table figures, hires the captive at the figure for the
 * result the roll names, and with the table not imported names no result,
 * hires nothing and warns. Machine values arrive through ./_env.mjs.
 *
 * Fixtures, kept and found by marker: `henchmen/bonus-place`, a location with
 * a market the Player seat observes, and `henchmen/bonus-employer`, a
 * character the Player seat owns. The step's start empties the place's
 * candidates and postings, the employer's roster and its coin. The hires, the
 * chat cards that speak as the employer or a hire, and the coin rows the walk
 * mints are tracked by the ids read back from each action and swept by those
 * ids alone. Every figure printed is a count or a boolean; no class, name or
 * figure read from the world leaves the page.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";
import { walkDone, blocked } from "./_walk.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const PLACE = "henchmen/bonus-place";
const EMPLOYER = "henchmen/bonus-employer";
/** An invented bonus the emptied purse cannot pay. */
const BONUS = 40;
/** An invented coin grant, enough for any bonus tier the page offers. */
const MINT = 5000;

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in a seat's page.  */
/* ------------------------------------------------------------------ */
const P = {
  install: async () => {
    const H = (globalThis.__ht = globalThis.__ht ?? {});
    const M = "/modules/acks-extras/scripts";
    H.LD = await import(`${M}/location/data/location-data.mjs`);
    H.R = await import(`${M}/classes/registry.mjs`);
    H.HP = await import(`${M}/classes/hitpoints.mjs`);
    H.L = await import(`${M}/lib/library.mjs`);
    H.SV = await import(`${M}/henchmen/service-view.mjs`);
    H.MO = await import(`${M}/lib/money.mjs`);
    H.AV = await import(`${M}/henchmen/rules/availability.mjs`);
    H.RD = await import(`${M}/henchmen/apps/recruit-dialog.mjs`);
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 60, every = 250 } = {}) => {
      for (let n = 0; n < tries; n++) { const v = await fn(); if (v) return v; await H.sleep(every); }
      return null;
    };
    H.root = (app) => (app?.element?.nodeType === 1 ? app.element : (app?.element?.[0] ?? null));
    H.apps = () => [...foundry.applications.instances.values()];
    H.text = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    H.moneyIds = (actor) => new Set(actor.items.filter((i) => i.type === "money").map((i) => i.id));
    if (!H.patched) {
      H.patched = true;
      H.errors = [];
      H.consoleError = console.error;
      console.error = (...args) => { H.errors.push(args.map((a) => a?.message ?? String(a)).join(" ").slice(0, 300)); H.consoleError(...args); };
      H.chat = [];
      H.chatCreate = ChatMessage.create;
      ChatMessage.create = async function (...args) {
        const made = await H.chatCreate.apply(this, args);
        for (const m of Array.isArray(made) ? made : [made]) if (m?.id) H.chat.push(m.id);
        return made;
      };
    }
    return { isGM: game.user.isGM, activeGMIsSelf: !!game.users.activeGM?.isSelf, hasCharacter: !!game.user.character };
  },
  userId: async ({ name }) => game.users.getName(name)?.id ?? null,
  market: async () => globalThis.__ht.LD.emptyMarket(),
  setting: async ({ key, value }) => {
    const before = game.settings.get("acks-extras", key);
    if (value !== undefined && value !== before) await game.settings.set("acks-extras", key, value);
    return { before, now: game.settings.get("acks-extras", key) };
  },
  /**
   * The step's start: the place's market emptied of candidates and postings and
   * observed by the Player; the employer owned by the Player, linked, with no
   * roster and no coin. Hires an earlier run of this walk left behind — managed
   * by this employer and recorded as hired at this place — are listed by uuid.
   */
  shape: async ({ placeId, employerId, playerId }) => {
    const OWN = CONST.DOCUMENT_OWNERSHIP_LEVELS;
    const place = game.actors.get(placeId);
    const employer = game.actors.get(employerId);
    await place.update({ "system.market.candidates": [], "system.market.postings": [], [`ownership.${playerId}`]: OWN.OBSERVER });
    const coin = employer.items.filter((i) => i.type === "money").map((i) => i.id);
    if (coin.length) await employer.deleteEmbeddedDocuments("Item", coin);
    await employer.update({ "system.henchmenList": [], [`ownership.${playerId}`]: OWN.OWNER, "prototypeToken.actorLink": true, "system.retainer.enabled": false });
    const leftovers = game.actors
      .filter((a) => a.system?.retainer?.managerid === employer.id && a.getFlag("acks-extras", "record")?.locationUuid === place.uuid)
      .map((a) => a.uuid);
    return {
      market: !!place.system.hasMarket,
      empty: !(place.system.candidates ?? []).length,
      placeSeen: place.ownership[playerId] === OWN.OBSERVER,
      employerOwned: employer.ownership[playerId] === OWN.OWNER,
      noCoin: H_noCoin(employer),
      leftovers,
    };
    function H_noCoin(a) { return !a.items.some((i) => i.type === "money"); }
  },
  /**
   * The first imported class whose rows carry hit dice at 1st and 2nd level
   * and which the hire's own lookup finds by its key. Booleans only.
   */
  pickClass: async () => {
    const H = globalThis.__ht;
    await H.L.whenReady();
    const classes = H.R.classItems().sort((a, b) => H.R.classSortKey(a) - H.R.classSortKey(b));
    for (const cls of classes) {
      let cells = null;
      try { cells = [H.HP.hdAt(cls, 1), H.HP.hdAt(cls, 2)]; } catch { cells = null; }
      if (!cells || cells.some((c) => !c)) continue;
      const key = cls.system.key || cls.name;
      const found = await H.R.classForActorAsync({ getFlag: () => null, system: { details: { class: key } } });
      if (found?.uuid !== cls.uuid) continue;
      H.cls = cls;
      H.clsKey = key;
      return { found: true, classes: classes.length };
    }
    return { found: false, classes: classes.length };
  },
  /** Three henchman candidates on the market: the picked class at 2nd, an unknown class at 2nd, a 0th-level one. */
  writeCandidates: async ({ placeId, employerUuid }) => {
    const H = globalThis.__ht;
    const place = game.actors.get(placeId);
    const base = (name, level, classKey) => ({
      id: foundry.utils.randomID(), kind: "henchman", status: "available", quantity: 1, name, level, classKey,
      wageGp: 25, privateToUuid: employerUuid, segment: "",
      attributes: { str: 11, int: 11, wil: 11, dex: 11, con: 17, cha: 11 },
    });
    const rows = {
      rolled: base("QA Bonus Hire Rolled", 2, H.clsKey),
      unknown: base("QA Bonus Hire Unknown", 2, "qa-no-such-class"),
      zero: base("QA Bonus Hire Zero", 0, ""),
      paid: base("QA Bonus Hire Paid", 2, H.clsKey),
    };
    await place.update({ "system.market.candidates": Object.values(rows) });
    return Object.fromEntries(Object.entries(rows).map(([k, r]) => [k, r.id]));
  },
  /** Hire through the API on this seat; the actor's uuid comes back from the call. */
  apiHire: async ({ placeId, candidateId, employerId, bonus }) => {
    const H = globalThis.__ht;
    const place = game.actors.get(placeId);
    const employer = game.actors.get(employerId);
    const errors = H.errors.length;
    H.chat.length = 0;
    const res = await acksExtras.henchmen.hire(place, candidateId, employer, bonus ? { signingBonusGp: bonus } : {});
    await H.sleep(500);
    const fresh = H.errors.slice(errors);
    return {
      error: res?.error ?? null,
      uuid: res?.actor?.uuid ?? null,
      chat: H.chat.splice(0),
      enrichmentFailed: fresh.some((e) => /hire enrichment failed|hit point roll failed/.test(e)),
    };
  },
  /** What a hire wrote: the record's terms and rolls, the actor's hit points, the classes record. Booleans and counts. */
  readHire: async ({ actorId, level }) => {
    const H = globalThis.__ht;
    const a = game.actors.get(actorId);
    const r = a.getFlag("acks-extras", "record") ?? {};
    const t = r.terms ?? {};
    const rolled = r.rolled ?? {};
    const steps = rolled.hpSteps ?? [];
    const hpAt = a.getFlag("acks-extras", "classes")?.hpAt ?? null;
    const cells = H.cls ? steps.map((s) => { const c = H.HP.hdAt(H.cls, s.level); return c ? `${c.dice}d${c.sides}` : null; }) : [];
    return {
      record: !!r.terms,
      bonus: t.signingBonusGp ?? null,
      owed: t.signingBonusOwedGp ?? null,
      arrears: t.arrearsGp ?? null,
      events: (r.events ?? []).map((e) => e.type),
      hpRoll: rolled.hpRoll != null,
      hpUnrolled: rolled.hpUnrolled ?? "",
      steps: steps.length,
      stepLevels: steps.map((s) => s.level).join(",") === Array.from({ length: level }, (_, i) => i + 1).join(","),
      stepFormulas: steps.length > 0 && steps.every((s, i) => s.formula === cells[i]),
      hpMatches: rolled.hpRoll != null && a.system.hp.max === rolled.hpRoll && a.system.hp.value === rolled.hpRoll,
      hpAt: Array.isArray(hpAt) && hpAt.length === 1 && hpAt[0].level === level && hpAt[0].max === rolled.hpRoll,
      hpUntouched: a._source.system.hp.max === new Actor.implementation({ name: "x", type: "character" }).toObject().system.hp.max,
      noHpAt: hpAt == null,
      calamities: r.counters?.calamities ?? 0,
      calamityPermanents: (r.loyalty?.permanents ?? []).filter((p) => p.reason === "calamity" && p.delta === -1 && p.note === game.i18n.localize("ACKS-HENCHMEN.hire.signingBonusCalamity")).length,
      calamityNote: (r.events ?? []).some((e) => e.type === "calamity" && e.note === game.i18n.localize("ACKS-HENCHMEN.hire.signingBonusCalamity")),
      pending: !!r.special?.pendingCalamity,
      badge: globalThis.__ht.SV.buildServicePanel(a, { isGM: game.user.isGM })?.badge ?? null,
    };
  },
  /** Whether one of `ids` is the calamity event card for `actorId`, carrying the Judge's loyalty-roll button. */
  calamityCard: async ({ ids, actorId }) => ids.some((id) => {
    const m = game.messages.get(id);
    return m?.speaker?.actor === actorId && !!m.flags?.["acks-extras"]?.eventCard && /rollLoyaltySecret/.test(m.content ?? "");
  }),
  /** The chat ids this seat caught since the last call, emptied. */
  takeChat: async () => globalThis.__ht.chat.splice(0),
  /** The Service panel's context and its rendered Service tab on this seat. */
  panel: async ({ actorId }) => {
    const H = globalThis.__ht;
    const a = game.actors.get(actorId);
    const ctx = H.SV.buildServicePanel(a, { isGM: game.user.isGM });
    const record = a.getFlag("acks-extras", "record") ?? {};
    const owed = record.terms?.signingBonusOwedGp ?? 0;
    const where = record.settlementName ?? "";
    const L = (k, d) => game.i18n.format(`ACKS-HENCHMEN.service.${k}`, d);
    const out = {
      ctxValue: ctx.terms?.signingBonus === (owed > 0 ? L("signingOwedValue", { gp: owed }) : L("gp", { gp: record.terms?.signingBonusGp ?? 0 })),
      ctxOwed: ctx.terms?.signingOwed === owed > 0,
      ctxWhere: ctx.terms?.signingWhere === (where ? L(owed > 0 ? "signingOwedWhere" : "signingWhere", { where }) : ""),
      ctxTip: !!ctx.terms?.signingTip && !/ACKS-HENCHMEN\./.test(ctx.terms.signingTip),
      ctxHp: ctx.rolled?.hp ? { unset: ctx.rolled.hp.unset, tip: !!ctx.rolled.hp.tip && !/ACKS-HENCHMEN\./.test(ctx.rolled.hp.tip) } : null,
    };
    await a.sheet.render(true);
    await H.poll(() => H.root(a.sheet)?.isConnected);
    try { a.sheet.changeTab("service", "primary"); } catch { /* a sheet with no Service tab */ }
    await H.sleep(600);
    const root = H.root(a.sheet);
    const service = root?.querySelector(".acks-extras-service");
    const rowNamed = (label) => [...(service?.querySelectorAll(".acks-extras-frame__row") ?? [])].find((r) => H.text(r.querySelector(".acks-extras-frame__row-label")) === game.i18n.localize(label));
    const signing = rowNamed("ACKS-HENCHMEN.service.signingBonus");
    const value = signing?.querySelector(".acks-extras-frame__row-value");
    const hpRow = rowNamed("ACKS-HENCHMEN.service.hitPoints");
    const hpValue = hpRow?.querySelector(".acks-extras-frame__row-value");
    out.rendered = !!service;
    out.signingFace = H.text(value) === ctx.terms?.signingBonus;
    out.signingNeg = !!value?.classList.contains("is-neg");
    out.signingTip = !!value?.dataset.tooltipText && value.dataset.tooltipText === ctx.terms?.signingTip;
    out.signingLine = H.text(signing?.querySelector(".acks-extras-frame__row-line")) === (ctx.terms?.signingWhere ?? "");
    out.hpRow = !!hpRow;
    out.hpFaint = !!hpValue?.classList.contains("is-faint");
    out.hpFaceNotImported = H.text(hpValue) === L("hpUnimported");
    out.hpTip = !!hpValue?.dataset.tooltipText;
    out.rawKey = /ACKS-HENCHMEN\./.test(H.text(service));
    await a.sheet.close();
    return out;
  },
  mint: async ({ actorId, gp }) => {
    const H = globalThis.__ht;
    const a = game.actors.get(actorId);
    const before = H.moneyIds(a);
    await H.MO.mintCoin(a, gp);
    return { minted: a.items.filter((i) => i.type === "money" && !before.has(i.id)).map((i) => i.uuid), spendable: H.MO.spendableGp(a) > 0 };
  },
  purse: async ({ actorId }) => {
    const H = globalThis.__ht;
    const a = game.actors.get(actorId);
    H.purse0 = H.MO.spendableGp(a);
    H.money0 = H.moneyIds(a);
    return true;
  },
  /** The coin rows the action since `purse` made on the employer, and whether the purse fell by exactly the recorded bonus. */
  purseAfter: async ({ actorId, hireId }) => {
    const H = globalThis.__ht;
    const a = game.actors.get(actorId);
    const bonus = game.actors.get(hireId)?.getFlag("acks-extras", "record")?.terms?.signingBonusGp ?? null;
    const drop = Math.round((H.purse0 - H.MO.spendableGp(a)) * 100) / 100;
    return { made: a.items.filter((i) => i.type === "money" && !H.money0.has(i.id)).map((i) => i.uuid), bonusSet: bonus > 0, dropIsBonus: bonus > 0 && Math.abs(drop - bonus) < 0.01 };
  },
  /** Player seat: open the place's sheet, press the candidate's Recruit button, and read the hosted hiring page. */
  recruit: async ({ placeId, candidateId, employerId }) => {
    const H = globalThis.__ht;
    const place = game.actors.get(placeId);
    const employer = game.actors.get(employerId);
    for (const a of H.apps()) if (a.constructor?.name === "InfluenceApp") await a.close({ force: true });
    await place.sheet.render(true);
    await H.poll(() => H.root(place.sheet)?.isConnected);
    await H.sleep(500);
    const btn = H.root(place.sheet)?.querySelector(`tr[data-candidate-id="${candidateId}"] a[data-action="recruit"]`);
    // The button picks the seat's assigned character first; with one that is
    // not the employer, the dialog the button opens is opened naming it.
    let how = "button";
    if (!btn) return { pressed: false, rowShown: false };
    if (game.user.character && game.user.character.id !== employerId) { how = "api"; H.RD.openRecruitDialog(place, candidateId, employer); }
    else btn.click();
    const prompt = await H.poll(() => document.querySelector('.application.dialog select[name="employerId"]') ?? H.apps().find((a) => a.constructor?.name === "InfluenceApp"), { tries: 40, every: 200 });
    let employerPrompt = false;
    if (prompt?.matches?.('select[name="employerId"]')) {
      employerPrompt = true;
      prompt.value = employerId;
      prompt.dispatchEvent(new Event("change", { bubbles: true }));
      prompt.closest(".application").querySelector('button[data-action="ok"]').click();
    }
    const app = await H.poll(() => { const a = H.apps().find((x) => x.constructor?.name === "InfluenceApp"); return a && H.root(a)?.querySelector('[data-action="roll"]') ? a : null; }, { tries: 60, every: 200 });
    if (!app) return { pressed: true, rowShown: true, how, employerPrompt, opened: false, throwDialog: H.apps().some((a) => a.constructor?.name === "ThrowDialog") };
    const bonus = H.root(app).querySelector('select[name="mod.signingBonus"]');
    const tiers = bonus ? [...bonus.options].filter((o) => o.value && o.value !== "0") : [];
    H.tierValue = tiers[0]?.value ?? null;
    return { pressed: true, rowShown: true, how, employerPrompt, opened: true, tiers: tiers.length };
  },
  /** Player seat: choose the first bonus tier, roll under a rig that throws every die high, and answer any confirm. */
  roll: async () => {
    const H = globalThis.__ht;
    const app = H.apps().find((x) => x.constructor?.name === "InfluenceApp");
    if (!app) return { found: false };
    const el = H.root(app);
    const bonus = el.querySelector('select[name="mod.signingBonus"]');
    if (bonus && H.tierValue) { bonus.value = H.tierValue; bonus.dispatchEvent(new Event("change", { bubbles: true })); await H.sleep(300); }
    H.chat.length = 0;
    const rig0 = CONFIG.Dice.randomUniform;
    CONFIG.Dice.randomUniform = () => 0.01;
    let yes = 0;
    try {
      el.querySelector('[data-action="roll"]').click();
      const t0 = Date.now();
      while (Date.now() - t0 < 6000) {
        const b = document.querySelector('button[data-action="yes"]');
        if (b) { b.click(); yes++; await H.sleep(400); } else await H.sleep(200);
      }
    } finally {
      CONFIG.Dice.randomUniform = rig0;
    }
    await H.sleep(1000);
    for (const a of H.apps()) if (a.constructor?.name === "InfluenceApp") await a.close({ force: true });
    await game.actors.get(globalThis.__htPlace)?.sheet?.close?.();
    return { found: true, confirms: yes, chat: H.chat.splice(0) };
  },
  closeSheet: async ({ actorId }) => { await game.actors.get(actorId)?.sheet?.close(); return true; },
  /** Write an invented wage arrears onto a hire's record, for Forgive to leave alone. */
  setArrears: async ({ actorId, gp }) => {
    const a = game.actors.get(actorId);
    const r = a.getFlag("acks-extras", "record") ?? {};
    await a.setFlag("acks-extras", "record", { ...r, terms: { ...(r.terms ?? {}), arrearsGp: gp } });
    return a.getFlag("acks-extras", "record")?.terms?.arrearsGp === gp;
  },
  /**
   * This seat opens the hire's Service tab, reads which owed-bonus controls it
   * offers and how they are named, and presses `which` (when given and shown).
   * Warnings and chat cards raised by the press are counted and returned.
   */
  pressSigning: async ({ actorId, which }) => {
    const H = globalThis.__ht;
    const a = game.actors.get(actorId);
    const owed0 = a.getFlag("acks-extras", "record")?.terms?.signingBonusOwedGp ?? 0;
    const events0 = (a.getFlag("acks-extras", "record")?.events ?? []).length;
    await a.sheet.render(true);
    await H.poll(() => H.root(a.sheet)?.isConnected);
    try { a.sheet.changeTab("service", "primary"); } catch { /* a sheet with no Service tab */ }
    await H.sleep(600);
    const service = H.root(a.sheet)?.querySelector(".acks-extras-service");
    const named = (b) => !!b && b.tagName === "BUTTON" && !!b.getAttribute("aria-label") && !/ACKS-HENCHMEN\./.test(b.getAttribute("aria-label")) && !!b.dataset.tooltip && !/ACKS-HENCHMEN\./.test(b.dataset.tooltip);
    const pay = service?.querySelector('[data-signing="pay"]') ?? null;
    const forgive = service?.querySelector('[data-signing="forgive"]') ?? null;
    const out = { rendered: !!service, pay: !!pay, forgive: !!forgive, named: (!pay || named(pay)) && (!forgive || named(forgive)), pressed: false, warns: 0, ownWarn: false, changed: false, chat: [] };
    const target = which === "pay" ? pay : which === "forgive" ? forgive : null;
    if (target) {
      const warn0 = ui.notifications.warn;
      const refusal = game.i18n.format("ACKS-HENCHMEN.service.signingPayRefused", { name: a.name });
      ui.notifications.warn = function (...args) { out.warns++; if (args[0] === refusal) out.ownWarn = true; return warn0.apply(this, args); };
      H.chat.length = 0;
      try {
        target.click();
        out.pressed = true;
        out.changed = !!(await H.poll(() => {
          const r = a.getFlag("acks-extras", "record") ?? {};
          return (r.terms?.signingBonusOwedGp ?? 0) !== owed0 || (r.events ?? []).length !== events0;
        }, { tries: 24, every: 250 }));
        await H.sleep(500);
      } finally {
        ui.notifications.warn = warn0;
      }
      out.chat = H.chat.splice(0);
    }
    await a.sheet.close();
    return out;
  },
  /** GM seat: open the employer's roster window and say which rows carry the owed tag, with a tooltip and no raw key. */
  roster: async ({ employerId }) => {
    const H = globalThis.__ht;
    const employer = game.actors.get(employerId);
    const mine = () => H.apps().find((x) => x.constructor?.name === "RosterApp" && x.employer?.id === employerId);
    acksExtras.henchmen.openRosterApp(employer);
    const app = await H.poll(() => { const x = mine(); return x && H.root(x)?.querySelector(".acks-extras-roster__row") ? x : null; }, { tries: 40, every: 250 });
    if (!app) return { opened: false };
    const rows = [...H.root(app).querySelectorAll(".acks-extras-roster__row")];
    const tagged = rows.filter((r) => r.querySelector(".acks-tag--danger")).map((r) => r.dataset.actorId);
    const tips = rows.map((r) => r.querySelector(".acks-tag--danger")).filter(Boolean)
      .every((t) => !!t.dataset.tooltip && !/ACKS-HENCHMEN\./.test(t.dataset.tooltip) && !/ACKS-HENCHMEN\./.test(H.text(t)));
    await app.close();
    return { opened: true, rows: rows.length, tagged, tips };
  },
  /** GM seat: the actor the Player's hire made, found as the candidate's hire under this employer once it lands. */
  awaitHire: async ({ placeId, candidateId, employerId, before }) => {
    const H = globalThis.__ht;
    const place = game.actors.get(placeId);
    const known = new Set(before);
    const hit = await H.poll(() => {
      const row = (place.system.candidates ?? []).find((c) => c.id === candidateId);
      const actor = game.actors.find((a) => !known.has(a.id) && a.system?.retainer?.managerid === employerId && a.getFlag("acks-extras", "record")?.locationUuid === place.uuid);
      return row?.status === "hired" && actor ? actor : null;
    }, { tries: 80, every: 250 });
    return { landed: !!hit, uuid: hit?.uuid ?? null, id: hit?.id ?? null, pending: (place.system.market?.pendingHires ?? []).length };
  },
  managedIds: async ({ employerId }) => game.actors.filter((a) => a.system?.retainer?.managerid === employerId).map((a) => a.id),
  /** The chat ids this seat caught that speak as one of `actorIds`. */
  ownCards: async ({ ids, actorIds }) => ids.filter((id) => actorIds.includes(game.messages.get(id)?.speaker?.actor)).map((id) => game.messages.get(id).uuid),
  /**
   * How many class keys the world's markets and its imported rarity tables
   * name resolve to an imported class through the hire's own lookup, with the
   * shapes of those that do not. Counts only; nothing is written.
   */
  resolution: async () => {
    const H = globalThis.__ht;
    await H.L.whenReady();
    const fromMarkets = new Set();
    for (const a of game.actors) {
      for (const c of a.system?.candidates ?? []) {
        if ((c.kind ?? "henchman") === "henchman" && Number(c.level) >= 1 && c.classKey) fromMarkets.add(String(c.classKey));
      }
    }
    const fromTables = new Set(H.AV.offerableClasses().map(String));
    const shape = (k) => (k.toLowerCase() === "special" ? "special" : /\s/.test(k) ? "multiWord" : /-/.test(k) ? "hyphenated" : "singleWord");
    const measure = async (keys) => {
      const out = { distinct: keys.size, resolved: 0, unresolved: 0, unresolvedShapes: {} };
      for (const k of keys) {
        const found = await H.R.classForActorAsync({ getFlag: () => null, system: { details: { class: k } } });
        if (found) out.resolved++;
        else { out.unresolved++; out.unresolvedShapes[shape(k)] = (out.unresolvedShapes[shape(k)] ?? 0) + 1; }
      }
      return out;
    };
    return { classes: H.R.classItems().length, markets: await measure(fromMarkets), tables: await measure(fromTables) };
  },
  unlink: async ({ employerId, ids }) => {
    const e = game.actors.get(employerId);
    if (!e) return false;
    await e.update({ "system.henchmenList": (e.system.henchmenList ?? []).filter((id) => !ids.includes(id)) });
    return true;
  },
  /**
   * Step 25's table: this page's priority-30 `influence` layer holds invented
   * figures for the Irrefusable Offer (`invented`) or an empty table for it
   * (`absent`), over whatever the layer held before, which `irrRestore` puts
   * back. The edges leave the page's result at either end whatever the
   * employer's Charisma modifier.
   */
  irrLayer: async ({ mode, tables }) => {
    const H = globalThis.__ht;
    const T = acksExtras.lib.tables;
    if (!H.irrPrev) H.irrPrev = { tables: structuredClone(T.getLayer("influence", 30)?.tables ?? {}) };
    const put = mode === "invented" ? tables : { irrefusableOffer: {} };
    T.registerTable({ id: "influence", tables: { ...H.irrPrev.tables, ...put } }, { priority: 30, source: "qa-hire-terms" });
    return { read: !!T.getTable("influence", "irrefusableOffer") && (mode !== "invented" || (T.getTable("influence", "irrefusableOffer")?.bands ?? []).length === 5) };
  },
  /** Put this page's priority-30 `influence` layer back as step 25 found it. */
  irrRestore: async () => {
    const H = globalThis.__ht;
    if (!H?.irrPrev) return "never changed";
    const T = acksExtras.lib.tables;
    if (Object.keys(H.irrPrev.tables).length) T.registerTable({ id: "influence", tables: H.irrPrev.tables }, { priority: 30, source: "qa-hire-terms" });
    else T.unregisterTable("influence", { priority: 30 });
    H.irrPrev = null;
    return "restored";
  },
  /** The employer at a level above the captives' hit dice. */
  irrEmployer: async ({ employerId, level }) => {
    const e = game.actors.get(employerId);
    await e.update({ "system.details.level": level });
    return e.system.details.level === level;
  },
  /**
   * Offer a captured monster the Irrefusable Offer through the real entry
   * (`recruitMonster`, captured), press Roll on the hosted page under a rig
   * that throws every die at `u`, and read what became of the monster. Result
   * names, booleans and the loyalty start the record holds.
   */
  irrOffer: async ({ employerId, monsterId, u }) => {
    const H = globalThis.__ht;
    const { recruitMonster } = await import("/modules/acks-extras/scripts/henchmen/engine/monster.mjs");
    const employer = game.actors.get(employerId);
    const monster = game.actors.get(monsterId);
    for (const a of H.apps()) if (a.constructor?.name === "InfluenceApp") await a.close({ force: true });
    const warns = [];
    const warn0 = ui.notifications.warn;
    ui.notifications.warn = function (...args) { warns.push(String(args[0])); return warn0.apply(this, args); };
    H.chat.length = 0;
    let fired = false;
    let outcome = null;
    const hook = Hooks.on("acksExtras.influenceRollComplete", (p) => { if (p?.mode === "irrefusableOffer") { fired = true; outcome = p.outcome ?? null; } });
    const rig0 = CONFIG.Dice.randomUniform;
    try {
      recruitMonster(monster, employer, { captured: true });
      const app = await H.poll(() => { const a = H.apps().find((x) => x.constructor?.name === "InfluenceApp"); return a && H.root(a)?.querySelector('[data-action="roll"]') ? a : null; }, { tries: 60, every: 200 });
      if (!app) return { opened: false, throwDialog: H.apps().some((a) => a.constructor?.name === "ThrowDialog") };
      CONFIG.Dice.randomUniform = () => u;
      H.root(app).querySelector('[data-action="roll"]').click();
      await H.poll(() => fired || null, { tries: 40, every: 150 });
      await H.sleep(2500);
    } finally {
      CONFIG.Dice.randomUniform = rig0;
      ui.notifications.warn = warn0;
      Hooks.off("acksExtras.influenceRollComplete", hook);
    }
    for (const a of H.apps()) if (a.constructor?.name === "InfluenceApp") await a.close({ force: true });
    const rec = monster.getFlag("acks-extras", "record");
    const ids = H.chat.splice(0);
    return {
      opened: true,
      fired,
      outcome,
      hired: !!rec?.terms,
      start: rec?.loyalty?.start ?? null,
      kept: rec?.special?.irrefusableResult ?? "",
      managed: monster.system.retainer?.managerid === employerId,
      listed: (employer.getFlag("acks-extras", "monsterHenchmenList") ?? []).includes(monsterId),
      unreadWarn: warns.includes(game.i18n.localize("ACKS-HENCHMEN.loyaltyUnread.irrefusableBands")),
      whispered: ids.filter((id) => game.messages.get(id)?.whisper?.length).length,
      cards: ids.map((id) => game.messages.get(id)?.uuid).filter(Boolean),
    };
  },
  /** Take the captives off the employer's monster list before they are swept. */
  irrUnlist: async ({ employerId, ids }) => {
    const e = game.actors.get(employerId);
    if (!e) return false;
    const list = e.getFlag("acks-extras", "monsterHenchmenList") ?? [];
    await e.setFlag("acks-extras", "monsterHenchmenList", list.filter((id) => !ids.includes(id)));
    return true;
  },
  drain: async () => ({ errors: (globalThis.__ht?.errors ?? []).slice() }),
  restore: async () => {
    const H = globalThis.__ht;
    if (!H?.patched) return "never installed";
    console.error = H.consoleError;
    ChatMessage.create = H.chatCreate;
    H.patched = false;
    return "restored";
  },
};

/* ------------------------------------------------------------------ */
/*  Driver side                                                         */
/* ------------------------------------------------------------------ */
async function run(api, fn, ...args) {
  const text = await api.eval(`(${fn.toString()})(...${JSON.stringify(args)}).then((v) => JSON.stringify(v === undefined ? null : v))`);
  return JSON.parse(text);
}
async function ready(api, label, seconds = 240) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.henchmen?.hire`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}

let gm = null;
let player = null;
const made = [];
const hireIds = [];
const captiveIds = [];
let employerId = null;
let limitBefore = null;
let autoRollBefore = null;
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 480_000);
setTimeout(() => {
  console.error(`WALK ERROR: wall clock of ${WALL_MS} ms reached; closing the seats`);
  try { player?.close(); } catch {}
  try { gm?.close(); } catch {}
  process.exit(1);
}, WALL_MS).unref();

const track = async (uuid, kind) => { if (!uuid || made.includes(uuid)) return; made.push(uuid); await gm.track(uuid, kind); };

try {
  section("seats");
  gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  note("gm ready after (s)", await ready(gm, "gm"));
  const gi = await run(gm, P.install);
  check("the GM seat is the active GM", gi.isGM && gi.activeGMIsSelf, gi);
  if (!gi.activeGMIsSelf) blocked("another client is the active GM; a relayed hire would run there");
  const playerId = await run(gm, P.userId, { name: MACHINE.player });
  if (!playerId) throw new Error("no Player user on this world");

  section("fixtures");
  const market = await run(gm, P.market);
  const place = await gm.fixture(PLACE, "Actor", { name: "QA Bonus Place", type: "acks-extras.location", system: { market } });
  const employer = await gm.fixture(EMPLOYER, "Actor", { name: "QA Bonus Employer", type: "character", prototypeToken: { actorLink: true } });
  employerId = employer.id;
  const shaped = await run(gm, P.shape, { placeId: place.id, employerId: employer.id, playerId });
  check("20: the place has an empty market the Player observes; the employer is the Player's, with no roster and no coin", shaped.market && shaped.empty && shaped.placeSeen && shaped.employerOwned && shaped.noCoin, { ...shaped, leftovers: shaped.leftovers.length });
  for (const uuid of shaped.leftovers) await track(uuid, "Actor");
  const limit = await run(gm, P.setting, { key: "enforceHenchmanLimit" });
  limitBefore = limit.before;
  if (limitBefore !== "off") note("limit policy set off for the walk", await run(gm, P.setting, { key: "enforceHenchmanLimit", value: "off" }));
  // The calamity a refused bonus records prompts the Judge with a card, or
  // opens the loyalty roll at once; the walk holds the card branch.
  autoRollBefore = (await run(gm, P.setting, { key: "autoRollCalamity" })).before;
  if (autoRollBefore !== false) note("calamity auto-roll set off for the walk", await run(gm, P.setting, { key: "autoRollCalamity", value: false }));

  section("20: class keys the hire's lookup resolves (read only)");
  const res = await run(gm, P.resolution);
  note("resolution", res);
  check("20: the world holds imported classes to resolve against", res.classes > 0, { classes: res.classes });
  // The markets' keys are world state left by whatever generated them, so an
  // unresolved one is reported as a finding rather than failing this walk.
  note(res.markets.unresolved === 0 ? "every class key the world's markets hold resolves" : "FINDING: market class keys that resolve to no imported class", res.markets);
  check("20: every class key the imported rarity tables offer resolves to an imported class", res.tables.unresolved === 0, res.tables);

  section("20: candidates");
  const picked = await run(gm, P.pickClass);
  check("20: an imported class carries hit dice at 1st and 2nd level and is found by its key", picked.found, picked);
  if (!picked.found) throw new Error("no imported class with hit dice the hire's lookup finds");
  const ids = await run(gm, P.writeCandidates, { placeId: place.id, employerUuid: (await gm.eval(`game.actors.get(${JSON.stringify(employer.id)}).uuid`)) });

  section("20: a refused bonus, with hit points rolled");
  const h1 = await run(gm, P.apiHire, { placeId: place.id, candidateId: ids.rolled, employerId: employer.id, bonus: BONUS });
  await track(h1.uuid, "Actor");
  const h1Id = h1.uuid?.split(".").pop();
  if (h1Id) hireIds.push(h1Id);
  for (const uuid of await run(gm, P.ownCards, { ids: h1.chat, actorIds: [employer.id, h1Id] })) await track(uuid, "ChatMessage");
  check("20: the hire goes ahead with no enrichment or roll failure on the console", !h1.error && !!h1.uuid && !h1.enrichmentFailed, { error: h1.error, made: !!h1.uuid, enrichmentFailed: h1.enrichmentFailed });
  const r1 = await run(gm, P.readHire, { actorId: h1Id, level: 2 });
  check("20: the record keeps the agreed bonus and owes all of it, the arrears untouched", r1.record && r1.bonus === BONUS && r1.owed === BONUS && r1.arrears === 0, { bonus: r1.bonus === BONUS, owed: r1.owed === BONUS, arrears: r1.arrears });
  check("20: the events end hired, signingBonusOwed, calamity, the calamity naming the unpaid bonus", r1.events.slice(-3).join(",") === "hired,signingBonusOwed,calamity" && r1.calamityNote, { events: r1.events.length, calamityNote: r1.calamityNote });
  check("20: the refusal is a calamity: the counter at one and one uncompensated loyalty point charged for it", r1.calamities === 1 && r1.calamityPermanents === 1, { calamities: r1.calamities, permanents: r1.calamityPermanents });
  check("20: the Judge is prompted with the calamity card and its loyalty-roll button", await run(gm, P.calamityCard, { ids: h1.chat, actorId: h1Id }));
  note("pending-calamity flag and Service badge after the refused bonus", { pending: r1.pending, badge: r1.badge });
  check("20: hit points rolled: maximum and current equal the record's roll, one step per level, each the class's own cell", r1.hpRoll && r1.hpMatches && r1.steps === 2 && r1.stepLevels && r1.stepFormulas && r1.hpUnrolled === "", { hpRoll: r1.hpRoll, hpMatches: r1.hpMatches, steps: r1.steps, stepLevels: r1.stepLevels, stepFormulas: r1.stepFormulas });
  check("20: the classes record holds the one rebuilt maximum at 2nd level", r1.hpAt, { hpAt: r1.hpAt });
  const p1 = await run(gm, P.panel, { actorId: h1Id });
  check("20: the Service panel reads the bonus as owed, with the not-paid line and a tooltip", p1.ctxValue && p1.ctxOwed && p1.ctxWhere && p1.ctxTip, p1);
  check("20: the Service tab renders the owed figure in the negative tone with its tooltip and line, and a Hit points row with a tooltip", p1.rendered && p1.signingFace && p1.signingNeg && p1.signingTip && p1.signingLine && p1.hpRow && !p1.hpFaint && p1.hpTip && !p1.rawKey, p1);

  section("20: an unknown class, and a 0th-level hire");
  const h2 = await run(gm, P.apiHire, { placeId: place.id, candidateId: ids.unknown, employerId: employer.id, bonus: 0 });
  await track(h2.uuid, "Actor");
  const h2Id = h2.uuid?.split(".").pop();
  if (h2Id) hireIds.push(h2Id);
  for (const uuid of await run(gm, P.ownCards, { ids: h2.chat, actorIds: [employer.id, h2Id] })) await track(uuid, "ChatMessage");
  const r2 = await run(gm, P.readHire, { actorId: h2Id, level: 2 });
  check("20: an unknown class rolls nothing: no roll, reason noClass, the type's default hit points, no classes record", !h2.error && !r2.hpRoll && r2.hpUnrolled === "noClass" && r2.steps === 0 && r2.hpUntouched && r2.noHpAt, { error: h2.error, hpUnrolled: r2.hpUnrolled, hpUntouched: r2.hpUntouched, noHpAt: r2.noHpAt });
  check("20: a hire with no bonus owes nothing and records no calamity", r2.owed === 0 && !r2.events.includes("signingBonusOwed") && r2.calamities === 0, { owed: r2.owed, calamities: r2.calamities });
  const p2 = await run(gm, P.panel, { actorId: h2Id });
  check("20: its Hit points row reads not imported, faint, with a tooltip", p2.rendered && p2.hpRow && p2.hpFaint && p2.hpFaceNotImported && p2.hpTip && p2.ctxHp?.unset && p2.ctxHp?.tip, { rendered: p2.rendered, hpRow: p2.hpRow, hpFaint: p2.hpFaint, face: p2.hpFaceNotImported, tip: p2.hpTip });
  const h3 = await run(gm, P.apiHire, { placeId: place.id, candidateId: ids.zero, employerId: employer.id, bonus: BONUS });
  await track(h3.uuid, "Actor");
  const h3Id = h3.uuid?.split(".").pop();
  if (h3Id) hireIds.push(h3Id);
  for (const uuid of await run(gm, P.ownCards, { ids: h3.chat, actorIds: [employer.id, h3Id] })) await track(uuid, "ChatMessage");
  const r3 = await run(gm, P.readHire, { actorId: h3Id, level: 0 });
  const p3 = await run(gm, P.panel, { actorId: h3Id });
  check("20: a 0th-level hire attempts nothing: no roll, no reason, no Hit points row, the type's default hit points", !h3.error && !r3.hpRoll && r3.hpUnrolled === "" && r3.hpUntouched && !p3.hpRow, { error: h3.error, hpUnrolled: r3.hpUnrolled, hpUntouched: r3.hpUntouched, hpRow: p3.hpRow });
  check("20: its refused bonus is owed too, and a calamity", r3.owed === BONUS && r3.events.includes("signingBonusOwed") && r3.calamities === 1, { owed: r3.owed === BONUS, calamities: r3.calamities });

  section("20: the owed bonus on the roster, and the Judge's controls");
  const roster = await run(gm, P.roster, { employerId: employer.id });
  const owedRows = [h1Id, h3Id].filter(Boolean).sort().join(",");
  check("20: the roster tags exactly the rows that owe a bonus, each tag with a tooltip", roster.opened && (roster.tagged ?? []).slice().sort().join(",") === owedRows && roster.tips, { opened: roster.opened, rows: roster.rows, tagged: roster.tagged?.length ?? 0, tips: roster.tips });
  const refused = await run(gm, P.pressSigning, { actorId: h1Id, which: "pay" });
  for (const uuid of await run(gm, P.ownCards, { ids: refused.chat, actorIds: [employer.id, h1Id] })) await track(uuid, "ChatMessage");
  const r1b = await run(gm, P.readHire, { actorId: h1Id, level: 2 });
  check("20: the GM's Service tab offers Pay and Forgive as named buttons", refused.rendered && refused.pay && refused.forgive && refused.named, { pay: refused.pay, forgive: refused.forgive, named: refused.named });
  check("20: Pay against an empty purse changes nothing and shows its own refusal", refused.pressed && refused.ownWarn && r1b.owed === BONUS && !r1b.events.includes("signingBonusPaid") && r1b.calamities === 1, { pressed: refused.pressed, ownWarn: refused.ownWarn, warns: refused.warns, owed: r1b.owed === BONUS, calamities: r1b.calamities });
  const ARREARS = 7;
  check("20: an invented arrears is written on the 0th-level hire", await run(gm, P.setArrears, { actorId: h3Id, gp: ARREARS }));
  const forgave = await run(gm, P.pressSigning, { actorId: h3Id, which: "forgive" });
  const r3b = await run(gm, P.readHire, { actorId: h3Id, level: 0 });
  check("20: Forgive zeroes the owed bonus, logs signingBonusForgiven, and leaves the arrears", forgave.pressed && forgave.changed && r3b.owed === 0 && r3b.events.at(-1) === "signingBonusForgiven" && r3b.arrears === ARREARS && r3b.calamities === 1, { calamities: r3b.calamities, pressed: forgave.pressed, changed: forgave.changed, owed: r3b.owed, last: r3b.events.at(-1), arrearsKept: r3b.arrears === ARREARS });
  const after = await run(gm, P.pressSigning, { actorId: h3Id, which: null });
  check("20: with nothing owed the row offers neither control", after.rendered && !after.pay && !after.forgive, { pay: after.pay, forgive: after.forgive });

  section("20: a paid bonus through the Player seat's Recruit button");
  const minted = await run(gm, P.mint, { actorId: employer.id, gp: MINT });
  for (const uuid of minted.minted) await track(uuid, "Item");
  check("20: the employer holds coin", minted.spendable && minted.minted.length > 0, { rows: minted.minted.length });
  player = await connect({ browser, origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  note("player ready after (s)", await ready(player, "player"));
  const pi = await run(player, P.install);
  check("the Player seat is not a GM", !pi.isGM, { isGM: pi.isGM });
  await run(gm, P.purse, { actorId: employer.id });
  const before = await run(gm, P.managedIds, { employerId: employer.id });
  // The Player's hire runs on the GM, so its cards are caught on the GM seat;
  // what the GM caught before it (the mint's) is tracked here first.
  for (const uuid of await run(gm, P.ownCards, { ids: await run(gm, P.takeChat), actorIds: [employer.id, ...hireIds] })) await track(uuid, "ChatMessage");
  const rec = await run(player, P.recruit, { placeId: place.id, candidateId: ids.paid, employerId: employer.id });
  note("recruit", rec);
  check("20: the Player's location sheet shows the candidate's Recruit button and it opens the hiring page with a bonus tier", rec.rowShown && rec.opened && rec.tiers > 0, rec);
  if (rec.opened) {
    const rolled = await run(player, P.roll);
    note("roll", { found: rolled.found, confirms: rolled.confirms, cards: rolled.chat?.length ?? 0 });
    const landed = await run(gm, P.awaitHire, { placeId: place.id, candidateId: ids.paid, employerId: employer.id, before });
    await track(landed.uuid, "Actor");
    if (landed.id) hireIds.push(landed.id);
    for (const uuid of await run(player, P.ownCards, { ids: rolled.chat ?? [], actorIds: [employer.id, landed.id] })) await track(uuid, "ChatMessage");
    for (const uuid of await run(gm, P.ownCards, { ids: await run(gm, P.takeChat), actorIds: [employer.id, landed.id] })) await track(uuid, "ChatMessage");
    check("20: the accepted offer hires the candidate under the employer", landed.landed, { landed: landed.landed, pending: landed.pending });
    if (landed.landed) {
      const purse = await run(gm, P.purseAfter, { actorId: employer.id, hireId: landed.id });
      for (const uuid of purse.made) await track(uuid, "Item");
      const r4 = await run(gm, P.readHire, { actorId: landed.id, level: 2 });
      check("20: the purse falls by exactly the recorded bonus, nothing owed, no owed event, no calamity", purse.bonusSet && purse.dropIsBonus && r4.owed === 0 && !r4.events.includes("signingBonusOwed") && r4.calamities === 0, { bonusSet: purse.bonusSet, dropIsBonus: purse.dropIsBonus, owed: r4.owed, calamities: r4.calamities });
      check("20: the Player's hire rolled hit points too", r4.hpRoll && r4.hpMatches && r4.steps === 2, { hpRoll: r4.hpRoll, hpMatches: r4.hpMatches, steps: r4.steps });
      const p4 = await run(gm, P.panel, { actorId: landed.id });
      check("20: the Service tab reads the paid bonus in the plain tone with its paid-at line", p4.rendered && p4.ctxValue && !p4.signingNeg && p4.signingFace && p4.signingLine && p4.ctxWhere, { rendered: p4.rendered, neg: p4.signingNeg, face: p4.signingFace, line: p4.signingLine });
    }
  }
  await run(player, P.closeSheet, { actorId: place.id });

  section("20: the Player pays the owed bonus from the Service tab");
  await run(gm, P.purse, { actorId: employer.id });
  const paid = await run(player, P.pressSigning, { actorId: h1Id, which: "pay" });
  for (const uuid of await run(player, P.ownCards, { ids: paid.chat, actorIds: [employer.id, h1Id] })) await track(uuid, "ChatMessage");
  for (const uuid of await run(gm, P.ownCards, { ids: await run(gm, P.takeChat), actorIds: [employer.id, h1Id] })) await track(uuid, "ChatMessage");
  check("20: the Player's Service tab offers Pay and not Forgive", paid.rendered && paid.pay && !paid.forgive && paid.named, { pay: paid.pay, forgive: paid.forgive, named: paid.named });
  const paidPurse = await run(gm, P.purseAfter, { actorId: employer.id, hireId: h1Id });
  for (const uuid of paidPurse.made) await track(uuid, "Item");
  const r1c = await run(gm, P.readHire, { actorId: h1Id, level: 2 });
  check("20: Pay moves the owed bonus from the employer's purse, zeroes it and logs signingBonusPaid", paid.pressed && paid.changed && paid.warns === 0 && paidPurse.dropIsBonus && r1c.owed === 0 && r1c.events.at(-1) === "signingBonusPaid", { pressed: paid.pressed, changed: paid.changed, warns: paid.warns, dropIsBonus: paidPurse.dropIsBonus, owed: r1c.owed, last: r1c.events.at(-1) });
  check("20: the later payment leaves the calamity standing", r1c.calamities === 1 && r1c.calamityPermanents === 1, { calamities: r1c.calamities, permanents: r1c.calamityPermanents });

  for (const seat of [gm, player]) {
    for (const uuid of await run(seat, P.ownCards, { ids: await run(seat, P.takeChat), actorIds: [employer.id, ...hireIds] })) await track(uuid, "ChatMessage");
  }

  section("25: an Irrefusable Offer through the hosted page hires the captive");
  // Figures are invented for the walk; the page's own are never read or printed.
  const INVENTED = {
    irrefusableOffer: {
      bands: [{ min: null, max: 5 }, { min: 6, max: 6 }, { min: 7, max: 7 }, { min: 8, max: 8 }, { min: 9, max: null }],
      oppositeAlignment: -2, hesitateLoyalty: 1, acceptLoyalty: 2, elanLoyalty: 3,
    },
    loyaltyChanges: { forcedServitude: -1 },
  };
  check("25: the employer stands above the captives' hit dice", await run(gm, P.irrEmployer, { employerId: employer.id, level: 6 }));
  const captive = async (name) => {
    const doc = await gm.create("Actor", { name, type: "monster", system: { hp: { hd: "1d8" } } });
    const id = doc.uuid.split(".").pop();
    captiveIds.push(id);
    made.push(doc.uuid);
    return id;
  };
  const top = await captive("QA Irrefusable Captive A");
  const bottom = await captive("QA Irrefusable Captive B");
  const none = await captive("QA Irrefusable Captive C");
  check("25: the invented table is read from this page's layer", (await run(gm, P.irrLayer, { mode: "invented", tables: INVENTED })).read);
  const t = await run(gm, P.irrOffer, { employerId: employer.id, monsterId: top, u: 0.025 });
  for (const uuid of t.cards ?? []) await track(uuid, "ChatMessage");
  check("25: the offer opens the influence-hosted page, not the fallback dialog", t.opened, { opened: t.opened, throwDialog: t.throwDialog });
  check("25: the top roll names the top result in this feature's vocabulary", t.fired && t.outcome === "acceptElan", { fired: t.fired, outcome: t.outcome });
  check("25: the captive is hired: record, employer, monster list, the result kept", t.hired && t.managed && t.listed && t.kept === "acceptElan", { hired: t.hired, managed: t.managed, listed: t.listed, kept: t.kept });
  check("25: it starts at the table's figure for that result, and nothing warns", t.start === INVENTED.irrefusableOffer.elanLoyalty && !t.unreadWarn && t.whispered === 0, { start: t.start, unreadWarn: t.unreadWarn, whispered: t.whispered });
  const b = await run(gm, P.irrOffer, { employerId: employer.id, monsterId: bottom, u: 0.975 });
  for (const uuid of b.cards ?? []) await track(uuid, "ChatMessage");
  check("25: the bottom roll names a feigned acceptance and the captive is hired at the forced-servitude start", b.fired && b.outcome === "betrayal" && b.hired && b.managed && b.listed && b.start === INVENTED.loyaltyChanges.forcedServitude, { outcome: b.outcome, hired: b.hired, start: b.start });
  check("25: the Judge alone is told the acceptance is feigned", b.whispered >= 1, { whispered: b.whispered });
  check("25: the empty table is read from this page's layer", (await run(gm, P.irrLayer, { mode: "absent" })).read);
  const n = await run(gm, P.irrOffer, { employerId: employer.id, monsterId: none, u: 0.025 });
  for (const uuid of n.cards ?? []) await track(uuid, "ChatMessage");
  check("25: with the table not imported the roll names no result, hires nothing, and the Judge is told", n.opened && n.fired && n.outcome === null && !n.hired && !n.managed && !n.listed && n.unreadWarn, { opened: n.opened, fired: n.fired, outcome: n.outcome, hired: n.hired, listed: n.listed, unreadWarn: n.unreadWarn });
  note("layer", await run(gm, P.irrRestore));

  const pe = player ? await run(player, P.drain) : { errors: [] };
  const ge = await run(gm, P.drain);
  check("no console error on either seat from install to the end of the walk", !pe.errors.length && !ge.errors.length, { player: pe.errors.length, gm: ge.errors.length });
  walkDone();
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  if (gm && employerId && hireIds.length) {
    try { note("employer roster unlinked", await run(gm, P.unlink, { employerId, ids: hireIds })); } catch (err) { console.error("unlink:", err?.message ?? err); }
  }
  if (gm && captiveIds.length) {
    try { await run(gm, P.irrRestore); } catch (err) { console.error("restore layer:", err?.message ?? err); }
    try { note("employer monster list unlinked", await run(gm, P.irrUnlist, { employerId, ids: captiveIds })); } catch (err) { console.error("unlist:", err?.message ?? err); }
  }
  if (gm && made.length) {
    try { note("swept", await gm.sweepTracked({ only: made })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  }
  if (gm && limitBefore != null && limitBefore !== "off") {
    try { note("limit policy restored", await run(gm, P.setting, { key: "enforceHenchmanLimit", value: limitBefore })); } catch (err) { console.error("restore setting:", err?.message ?? err); }
  }
  if (gm && autoRollBefore != null && autoRollBefore !== false) {
    try { note("calamity auto-roll restored", await run(gm, P.setting, { key: "autoRollCalamity", value: autoRollBefore })); } catch (err) { console.error("restore setting:", err?.message ?? err); }
  }
  for (const [label, seat] of [["gm", gm], ["player", player]]) {
    try { if (seat) note(`restored (${label})`, await run(seat, P.restore)); } catch (err) { console.error(`restore ${label}:`, err?.message ?? err); }
  }
  console.log(`fixtures kept: ${PLACE}, ${EMPLOYER}`);
  try { if (player) await player.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
