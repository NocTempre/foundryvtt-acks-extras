/**
 * The blood sacrifice (RR ch. 8, "Blood Sacrifice"; the demonologist's power, RR ch. 2): the model of the act
 * and of its window. Foundry-free: the victims' facts, the imported tables and every write are arguments or
 * dependencies, so a test or a consumer supplies its own.
 *
 * What ships is the procedure. A victim is a bucket row (lib's `bucket.mjs`) worth its component value
 * (`bucket-value.mjs`, never a figure of this file). The sacrifice happens at a site the caster's owner says
 * qualifies. A lawful or neutral victim must be helpless and a chaotic victim willing, and an unwilling
 * chaotic victim counts for nothing without being refused. A lawful or neutral caster never gains from a
 * sapient victim. The yield is the sum of the counted victims' values, kept as divine power for a divine
 * caster and as arcane power through the imported multiple for the holder of the class power. A research
 * throw then follows, made by the caster as a research throw is (`throwPlan`, with no level of effect and
 * no facility): on a success each counted victim adds its component value once for each trait the caster's
 * owner ticked, by the imported table's factor, and a failure adds nothing. Victims are marked with core's dead
 * status and never deleted.
 *
 * A figure that is not read is `null`. A throw is never made, and a yield never written, with a figure it
 * needs missing: `holdOf` names the first such part. The rules' limits (`findings`) are the cast plan's
 * verdicts, which block a Player and warn a Judge (`castVerdicts`), so a missing figure holds everyone and
 * a limit holds only a Player.
 */
import { castVerdicts, blocked } from "./cast-plan.mjs";
import { throwPlan, throwResult, THROW_DIE } from "./research-project.mjs";
import { sacrificeBonus } from "./research-tables.mjs";
import { POWER_KIND } from "./power-ledger.mjs";
import { cleanState, num } from "./sacrifice-record.mjs";
import { makeEntry, settlementPlan, bucketView, ENTRY_KIND, OUTCOME, SETTLE } from "../lib/bucket.mjs";

export { cleanState };

/** The kinds of document a victims bucket takes by a drop. */
export const VICTIM_KINDS = Object.freeze([ENTRY_KIND.actor, ENTRY_KIND.token]);

/** The alignments a victim and a caster are read as (`actorAlignment`'s keys). */
export const ALIGN = Object.freeze({ lawful: "lawful", neutral: "neutral", chaotic: "chaotic" });

/** The die a sacrifice's research throw rolls, the research throw's own. */
export const SACRIFICE_DIE = THROW_DIE;

/** A creature is marked on every outcome: the sacrifice is made whether or not the throw succeeds. A row that counts for nothing is kept (`settlementPlan`). */
export const SACRIFICE_SETTLE = Object.freeze({ [OUTCOME.success]: SETTLE.mark, [OUTCOME.failure]: SETTLE.mark, [OUTCOME.botch]: SETTLE.mark });

/** The ledger a power gain goes to, by the caster's basis. */
export const BASIS = Object.freeze({ divine: POWER_KIND.divine, arcane: POWER_KIND.arcane });

/**
 * The limits of the rules as findings, each the last segment of a lang key in the sacrifice window's `finding` group: `noBasis` (the caster
 * is neither a divine caster nor holds the class power), `noSite`, `notHelpless` (a lawful or neutral victim that is
 * not helpless), `sapientRefused` (a lawful or neutral caster and a sapient victim) and `animalWarn`, a Judge's
 * warning alone (a lawful or neutral caster and a victim that is not sapient).
 */
export const FINDING = Object.freeze({ noBasis: "noBasis", noSite: "noSite", notHelpless: "notHelpless", sapientRefused: "sapientRefused", animalWarn: "animalWarn" });

/**
 * What holds a sacrifice for everyone, because a figure or a fact it needs is not read: `victims` (none dropped),
 * `casterAlignment`, `victimAlignment`, `intelligence` (a lawful or neutral caster's victim whose intelligence is
 * blank), `values` (a counted victim's value), `traits` (a ticked trait whose factor is not read), `multiplier` (the
 * class power's multiple), `throw` (no target on the ladder for the caster's level) and `int` (no Intellect bonus).
 */
export const HOLD = Object.freeze({ victims: "victims", casterAlignment: "casterAlignment", victimAlignment: "victimAlignment", intelligence: "intelligence", values: "values", traits: "traits", multiplier: "multiplier", throw: "throw", int: "int" });

/** Why a victim counts for nothing besides a bar on its value (`value.reason`): already dead, an unwilling chaotic victim, an unread alignment. */
export const NO_YIELD = Object.freeze({ dead: "dead", unwilling: "unwilling", alignment: "alignment" });

/**
 * Whether a creature counts as sapient for the caster's limit: a character is, a creature whose intelligence reads
 * `sapient` is, any other reading is not, and a blank one is unread (null), which holds a lawful or neutral caster.
 */
export function sapientOf({ isCharacter = false, intelligence = "" } = {}) {
  if (isCharacter) return true;
  const word = typeof intelligence === "string" ? intelligence.trim() : "";
  return word ? word === "sapient" : null;
}

/**
 * Which power the caster gains: arcane where the record says the caster holds the class power, else divine for a
 * divine caster, else null (the caster has nothing to gain).
 * @returns {"divine"|"arcane"|null}
 */
export function casterBasis({ divine = false, power = false } = {}) {
  if (power === true) return BASIS.arcane;
  return divine === true ? BASIS.divine : null;
}

/**
 * Where one victim stands: whether it counts, why not, and the findings it raises. A dead victim, a creature the
 * value's bar excludes (`value.source` `excluded`, whose `reason` is the bar) and a victim with no alignment read
 * count for nothing, as does an unwilling chaotic victim, which raises nothing. A counted victim raises
 * `notHelpless` where it is lawful or neutral and not helpless, and, for a lawful or neutral caster, `sapientRefused`
 * or `animalWarn`.
 * @returns {{uuid: string, counts: boolean, reason: string|null, findings: Array<{key: string, uuid: string, name: string, severity?: string}>, holds: string[]}}
 */
export function victimStanding(victim, state, { caster }) {
  const st = cleanState(state);
  const base = { uuid: victim.uuid, counts: false, reason: null, findings: [], holds: [] };
  if (victim.dead === true) return { ...base, reason: NO_YIELD.dead };
  if (victim.value?.source === "excluded") return { ...base, reason: victim.value.reason ?? "excluded" };
  if (!victim.alignment) return { ...base, reason: NO_YIELD.alignment, holds: [HOLD.victimAlignment] };
  if (victim.alignment === ALIGN.chaotic && !st.willing) return { ...base, reason: NO_YIELD.unwilling };
  const out = { ...base, counts: true };
  const found = (key, extra = {}) => out.findings.push({ key, uuid: victim.uuid, name: victim.name, ...extra });
  if (victim.alignment !== ALIGN.chaotic && !st.helpless) found(FINDING.notHelpless);
  if (caster.alignment && caster.alignment !== ALIGN.chaotic) {
    if (victim.sapient === true) found(FINDING.sapientRefused);
    else if (victim.sapient === false) found(FINDING.animalWarn, { severity: "warn" });
    else out.holds.push(HOLD.intelligence);
  }
  return out;
}

/**
 * The sacrifice's research throw as the caster stands: `throwPlan` for a project with no level of effect and no
 * facility, so the target is the ladder's rung for the caster's level and the modifier is the Intellect bonus.
 * Its target is null where the ladder or the level is not read, `intUnread` where the Intellect bonus is not.
 */
export function sacrificeThrow(tables, { level = null, intBonus = null } = {}) {
  const project = { kind: "sacrifice", researcher: "caster", level: null, costs: {}, throw: null, common: false };
  return throwPlan(project, { tables, levelOf: () => level, intBonusOf: () => intBonus });
}

/**
 * What the counted victims yield. `base` is the sum of their values (null while any is not read), `traits` the
 * sum of each victim's ticked rows' factors times its value (`sacrificeBonus`; null while a ticked row's factor
 * is not read, and zero where nothing is ticked), `multiplier` the class power's multiple for an arcane basis (one
 * for divine; null while unread). `now` is the power gained at once and `onSuccess` what a successful throw adds, both
 * through the multiplier and null while a figure is missing. `rows` is each counted victim's `{uuid, now, extra}`.
 */
export function yieldOf(counted, { basis, traits, power }) {
  const values = counted.map((c) => num(c.value?.gp));
  const base = values.some((v) => v === null) ? null : values.reduce((n, v) => n + v, 0);
  const multiplier = basis === BASIS.arcane ? num(power?.multiplier) : 1;
  const extras = counted.map((c, i) => (c.state.traits.length === 0 ? 0 : values[i] === null ? null : sacrificeBonus(traits, c.state.traits, values[i])));
  const extra = extras.some((e) => e === null) ? null : extras.reduce((n, e) => n + e, 0);
  const through = (n) => (n === null || multiplier === null ? null : n * multiplier);
  return {
    base,
    traits: extra,
    multiplier,
    now: through(base),
    onSuccess: through(extra),
    rows: counted.map((c, i) => ({ uuid: c.uuid, now: through(values[i]), extra: through(extras[i]) })),
  };
}

/**
 * The first thing a missing figure or fact holds the sacrifice on, or none: `{ok, why}` (`HOLD`). Nothing counted
 * yields nothing and needs no throw, so the figures of a throw are not asked of it.
 */
export function holdOf({ entries, standings, caster, plan, yielded }) {
  if (!entries.length) return { ok: false, why: HOLD.victims };
  if (!caster.alignment) return { ok: false, why: HOLD.casterAlignment };
  const found = (hold) => standings.some((s) => s.holds.includes(hold));
  if (found(HOLD.victimAlignment)) return { ok: false, why: HOLD.victimAlignment };
  if (found(HOLD.intelligence)) return { ok: false, why: HOLD.intelligence };
  if (!standings.some((s) => s.counts)) return { ok: true, why: "" };
  if (yielded.base === null) return { ok: false, why: HOLD.values };
  if (yielded.traits === null) return { ok: false, why: HOLD.traits };
  if (yielded.multiplier === null) return { ok: false, why: HOLD.multiplier };
  if (plan.target === null) return { ok: false, why: HOLD.throw };
  if (plan.intUnread) return { ok: false, why: HOLD.int };
  return { ok: true, why: "" };
}

/**
 * The whole of a sacrifice as it stands.
 * `caster` is `{uuid, name, img, alignment, divine, level, intBonus}`; `victims` are `{uuid, name, img, kind, alignment,
 * sapient, dead, value}` (`value` is lib's value, from `creatureValue` or `characterValue`); `state` is the window's
 * `{site, power, victims: {uuid: state}}`; `tables` is `readResearchTables()`'s answer; `loc(key, data)` words a finding.
 * A hand-set value replaces the victim's own (source `edited`, the page it was read from kept).
 * @returns {{basis: string|null, rows: object[], entries: object[], standings: object[], findings: object[], verdicts: object[], blocked: boolean, yielded: object, throw: object, hold: {ok: boolean, why: string}, counted: number, canAct: boolean}}
 */
export function planOf({ caster, victims, state, tables, judge = false, loc = (key) => key }) {
  const basis = casterBasis({ divine: caster.divine, power: state.power });
  const rows = victims.map((v) => {
    const st = cleanState(state.victims?.[v.uuid]);
    const hand = st.value;
    const value = hand === null ? v.value : { gp: hand, source: "edited", cite: v.value?.cite ?? null, basis: { was: num(v.value?.gp) } };
    const standing = victimStanding({ ...v, value }, st, { caster });
    return { ...v, value, state: st, standing };
  });
  const standings = rows.map((r) => r.standing);
  const counted = rows.filter((r) => r.standing.counts);
  const yielded = yieldOf(counted, { basis, traits: tables.sacrifice, power: tables.powerOfSacrifice });
  const throwing = sacrificeThrow(tables, { level: caster.level, intBonus: caster.intBonus });
  const found = [];
  if (!state.site) found.push({ key: FINDING.noSite });
  if (!basis) found.push({ key: FINDING.noBasis });
  for (const s of standings) found.push(...s.findings);
  const asVerdict = (f) => ({ key: f.key, notice: loc(`finding.${f.key}`, { name: f.name ?? "" }) });
  const verdicts = castVerdicts({ isGM: judge, procedure: found.filter((f) => f.severity !== "warn").map(asVerdict) });
  // A lawful or neutral caster's animal sacrifice is a Judge's warning and never a block, so it is ranked here and not by the plan.
  if (judge) for (const f of found.filter((x) => x.severity === "warn")) verdicts.push({ key: f.key, severity: "warn", notice: asVerdict(f).notice });
  const hold = holdOf({ entries: rows, standings, caster, plan: throwing, yielded });
  const isBlocked = blocked(verdicts);
  return { basis, rows, entries: rows, standings, findings: found, verdicts, blocked: isBlocked, yielded, throw: throwing, hold, counted: counted.length, canAct: hold.ok && !isBlocked };
}

/** The entry a victim row is in lib's bucket: its value, and the reason it counts for nothing as the window words it. */
export function victimEntry(row, { loc = (key) => key } = {}) {
  const barred = row.value?.source === "excluded" && row.standing.reason === row.value.reason;
  const reason = row.standing.reason ? (barred ? row.value.reason : loc(`noYield.${row.standing.reason}`)) : null;
  return makeEntry({ uuid: row.uuid, kind: row.kind, name: row.name, img: row.img, qty: 1, value: row.value, reason });
}

/**
 * What a victim's row carries inside lib's bucket row (its `extra` slot): for a seat that can edit (an owner of the
 * caster, a GM included) the checks and the value box, for a seat that cannot the same facts as read-only text. The first line is helpless or willing and the imported trait checks;
 * the second is `young` (a creature's mark, since a character's value is not read by its age) and the value box. A hand-set value
 * is `edited`, and its tooltip names the figure it replaced, or says none was read, with the page. Nothing here is a
 * figure of the book: the labels are the procedure's, and the trait rows and their factors are the imported table's.
 * @returns {object}
 */
export function victimExtra(row, { editable, partial, tables, loc, cites = {} }) {
  const st = row.state;
  const traitRows = tables.sacrifice?.rows ?? [];
  const page = cites.sacrifice ?? "";
  const checks = [];
  if (row.alignment === ALIGN.chaotic) checks.push({ field: "willing", label: loc("willing"), tip: loc("willingTip", { cite: page }), checked: st.willing });
  else if (row.alignment) checks.push({ field: "helpless", label: loc("helpless"), tip: loc("helplessTip", { cite: page }), checked: st.helpless });
  const traits = traitRows.map((t, i) => ({ index: i, label: t.label, checked: st.traits.includes(i), tip: t.times === null ? page : loc("traitTip", { times: t.times, cite: tables.sacrifice?.cite ?? page }) }));
  const extra = { partial, uuid: row.uuid, editable: editable === true, checks, traits };
  if (editable === true) {
    const was = row.value?.basis?.was ?? null;
    const edited = st.value !== null;
    const valueTip = !edited ? loc("valueBoxTip", { cite: row.value?.cite ?? "" }) : was === null ? loc("valueBoxNoneRead", { cite: row.value?.cite ?? "" }) : loc("valueBoxWas", { was, cite: row.value?.cite ?? "" });
    extra.young = row.isMonster ? { label: loc("young"), tip: loc("youngTip", { cite: cites.value ?? "" }), checked: st.young } : null;
    extra.value = { label: loc("valueBox"), shown: st.value === null ? "" : String(st.value), tip: valueTip, edited };
  } else {
    const said = [...checks.filter((c) => c.checked).map((c) => c.label), ...traits.filter((t) => t.checked).map((t) => t.label), ...(row.isMonster && st.young ? [loc("young")] : [])];
    extra.said = said.join(" · ");
  }
  return extra;
}

/**
 * The window's model: the bucket as lib draws it (its head replaced by the yield, each victim's checks inside its
 * own row through `rowPartial`), the site and class-power checks, the two yield lines with their provenance, the
 * verdicts and the footer's state. `editable` is whether the seat owns the caster (a GM included): that seat sets every
 * check; a seat that cannot edit sees them as text, and what only an owner can settle, it is told it waits on (`wait`).
 * `judge` is the seat's severity and nothing else: it ranks a limit as a block or a warning (`planOf`). `rowPartial` is
 * the loaded partial a victim's checks are drawn by; with none given no row carries a slot.
 * @returns {object}
 */
export function panelModel({ caster, victims, state, tables, judge, editable, loc, bucketLoc, cites = {}, rowPartial = "" }) {
  const plan = planOf({ caster, victims, state, tables, judge, loc });
  const entries = plan.rows.map((r) => victimEntry(r, { loc }));
  const slots = rowPartial ? Object.fromEntries(plan.rows.map((r) => [r.uuid, { extra: victimExtra(r, { editable, partial: rowPartial, tables, loc, cites }) }])) : {};
  const bucket = bucketView({ accepts: { kinds: VICTIM_KINDS }, due: null }, entries, { key: "victims", loc: bucketLoc, legend: loc("victims"), icon: "fa-droplet", emptyText: loc("empty"), dropText: loc("drop"), locked: false, rows: slots });
  bucket.head = null;
  bucket.rows.forEach((row, i) => {
    const standing = plan.rows[i].standing;
    row.chips = [];
    if (plan.rows[i].sapient === true) row.chips.push({ text: loc("sapient"), tip: loc("sapientTip"), tone: "bad" });
    if (!standing.counts) row.chips.push({ text: loc("noYieldChip"), tip: standing.reason ? loc(`noYield.${standing.reason}`) : "", tone: "warn" });
  });
  const y = plan.yielded;
  const unit = plan.basis === BASIS.arcane ? "arcane" : "divine";
  const text = (n) => (n === null ? "" : String(n));
  const cite = tables.sacrifice?.cite ?? "";
  const yieldRows = {
    unit,
    now: { label: loc(`yield.now.${unit}`), text: entries.length ? text(y.now) : "", tip: yieldTip(plan, loc, cites, tables) },
    bonus: { label: loc("yield.bonus"), text: entries.length && tables.sacrifice?.present ? text(y.onSuccess) : "", tip: loc("yield.bonusTip", { cite: cite || (cites.sacrifice ?? "") }) },
  };
  const lines = footerLines(plan, { editable, loc, tables, cites });
  return {
    plan,
    bucket,
    site: { checked: state.site === true, disabled: editable !== true, label: loc("site"), tip: loc("siteTip", { cite: cites.sacrifice ?? "" }) },
    power: { shown: editable === true || state.power === true, checked: state.power === true, disabled: editable !== true, label: loc("power"), tip: loc("powerTip", { cite: tables.powerOfSacrifice?.cite ?? cites.power ?? "" }) },
    yield: yieldRows,
    lines,
    why: lines[0]?.text ?? "",
    blocked: !plan.canAct,
  };
}

/** The findings an owner of the caster settles by a check or a figure, and so a seat that cannot edit waits on instead of being blocked by. */
export const JUDGE_SETTLES = Object.freeze([FINDING.noSite, FINDING.notHelpless]);

/**
 * The footer's lines: each verdict, then the hold. A seat that cannot edit is told what waits on the caster's owner in
 * one line, "Waiting on the caster's owner: ...", for the findings an owner's check settles (`JUDGE_SETTLES`) and a victim's
 * value left to an owner to enter; those lines are severity `wait`, the rest keep their block. A seat that can edit
 * (`editable`) reads every one as it stands.
 */
export function footerLines(plan, { editable, loc, tables, cites = {} }) {
  const verdictLines = plan.verdicts.map((v) => ({ severity: v.severity, text: v.notice, key: v.key }));
  const holdLine = plan.hold.ok ? null : { severity: "block", text: loc(`hold.${plan.hold.why}`, { cite: holdCite(plan.hold.why, tables, cites) }) };
  if (editable === true) return [...verdictLines, ...(holdLine ? [holdLine] : [])].map(({ key, ...line }) => line);
  const waits = plan.findings.filter((f) => f.severity !== "warn" && JUDGE_SETTLES.includes(f.key)).map((f) => loc(`wait.${f.key}`, { name: f.name ?? "" }));
  const valueWait = !plan.hold.ok && plan.hold.why === HOLD.values;
  if (valueWait) waits.push(loc("wait.values"));
  const kept = verdictLines.filter((v) => !JUDGE_SETTLES.includes(v.key)).map(({ key, ...line }) => line);
  const waiting = waits.length ? [{ severity: "wait", text: loc("waiting", { what: waits.join("; ") }) }] : [];
  return [...kept, ...waiting, ...(holdLine && !valueWait ? [holdLine] : [])];
}

/** The tooltip of the yield now: which victims make it, and the multiple the class power counts it by. */
function yieldTip(plan, loc, cites, tables) {
  const rows = plan.rows.filter((r) => r.standing.counts).map((r) => `${r.name} ${r.value?.gp ?? ""}`.trim());
  const cite = cites.sacrifice ?? "";
  const k = plan.basis === BASIS.arcane && plan.yielded.multiplier !== null ? loc("yield.multiple", { n: plan.yielded.multiplier, cite: tables.powerOfSacrifice?.cite ?? cites.power ?? "" }) : "";
  return rows.length ? loc("yield.nowTip", { rows: rows.join(" · "), multiple: k, cite: cite ? ` (${cite})` : "" }) : cite;
}

/** The page a hold names: the table the missing figure is read from, or the sacrifice's own passage. */
function holdCite(why, tables, cites) {
  if (why === HOLD.multiplier) return tables.powerOfSacrifice?.cite ?? cites.power ?? "";
  if (why === HOLD.throw || why === HOLD.int) return tables.ladder?.cite ?? cites.sacrifice ?? "";
  return cites.sacrifice ?? "";
}

/* -------------------------------------------------------------------------- */
/*  The act                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Whether a request to mark victims dead is one the GM's client may run, checked against what the GM's client
 * reads and never what the payload claims: the sender must be a Judge or own the caster, there must be victims,
 * and each must resolve to a creature that is not yet dead and is not the caster.
 * @param {{casterUuid?: string, uuids?: string[]}} req
 * @param {{caster: object|null, fromJudge: boolean, owns: boolean, resolved: Array<{uuid: string, creature: boolean, dead: boolean}>}} from
 * @returns {{ok: true}|{refused: string}}
 */
export function checkMarkRequest(req, { caster, fromJudge, owns, resolved }) {
  if (!caster) return { refused: "noCaster" };
  if (!fromJudge && !owns) return { refused: "owner" };
  const uuids = Array.isArray(req?.uuids) ? req.uuids : [];
  if (!uuids.length) return { refused: "noVictims" };
  for (const uuid of uuids) {
    const row = resolved.find((r) => r.uuid === uuid);
    if (!row?.creature) return { refused: "victim" };
    if (row.dead) return { refused: "dead" };
    if (uuid === req.casterUuid) return { refused: "self" };
  }
  return { ok: true };
}

/**
 * Make the sacrifice. The caller has read the victims afresh and built `plan` (`planOf`) from them, so the gates
 * hold at the moment of the act. A held or blocked plan is refused and changes nothing. With no victim counted
 * nothing yields and no throw is made. Otherwise the order is: the throw, the victims marked (`deps.mark`, which a
 * Player's seat has the GM's client do), then the power gained for the victims that were actually marked, then
 * the card. A failure gives the base yield and nothing of the traits; a success adds them.
 *
 * `deps`: `roll()` the natural die, `mark(uuids)` answering `{marked: string[], failed: string[]}`, `gain(kind, amount)`
 * answering `{ok, ...}` and `card(result)`; `tables` is `readResearchTables()`'s answer.
 * @returns {Promise<{ok: boolean, reason?: string, nothing?: boolean, outcome?: string, die?: number, total?: number, target?: number, auto?: boolean, amount?: number, kind?: string, marked?: string[], failed?: string[], gain?: object|null}>}
 */
export async function performSacrifice(plan, deps, { tables }) {
  if (!plan.hold.ok) return { ok: false, reason: plan.hold.why };
  if (plan.blocked) return { ok: false, reason: "blocked" };
  const counted = plan.rows.filter((r) => r.standing.counts);
  if (!counted.length) {
    const result = { ok: true, nothing: true, marked: [], failed: [], amount: 0, kind: plan.basis, gain: null };
    await deps.card?.(result, plan);
    return result;
  }
  const rolled = await deps.roll();
  const thrown = throwResult(plan.throw, tables.prose, rolled.die);
  const entries = plan.rows.map((r) => victimEntry(r));
  const steps = settlementPlan(entries, thrown.outcome, SACRIFICE_SETTLE).filter((s) => s.action === SETTLE.mark);
  const done = await deps.mark(steps.map((s) => s.uuid));
  const marked = steps.map((s) => s.uuid).filter((uuid) => done.marked.includes(uuid));
  const rowsMarked = plan.yielded.rows.filter((r) => marked.includes(r.uuid));
  const amount = Math.round(rowsMarked.reduce((n, r) => n + (r.now ?? 0) + (thrown.success ? r.extra ?? 0 : 0), 0));
  const gain = amount >= 1 ? await deps.gain(plan.basis, amount) : null;
  const result = { ok: true, outcome: thrown.outcome, success: thrown.success, auto: thrown.auto, die: thrown.die, total: thrown.total, target: thrown.target, amount, kind: plan.basis, marked, failed: done.failed ?? [], gain, roll: rolled.roll ?? null };
  await deps.card?.(result, plan);
  return result;
}
