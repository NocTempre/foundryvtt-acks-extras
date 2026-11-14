/**
 * A family template's ROLE axis: the leaders, casters and dependants a
 * member's own prose describes, read at import into the variant×role cells
 * the template engine applies (`lib/template-logic.mjs`). Pure: the locators
 * ship, every figure is read from the seat's own extracted prose, and the
 * figures a sentence does not print are carried over from the member's own
 * stat block by the procedure that relates them (one throw row per Hit Dice
 * row, saves at the creature's Hit Dice), never from a shipped number.
 *
 * Also the family's shared readings of a Hit Dice rating: which row of the
 * attack-throw ladder it stands on and the throw the Judge's imported ladder
 * gives it, the level it saves at, and the "by weapon" modifier a stat line
 * prints beside its damage.
 *
 * Rulings: docs/importer/DECISIONS.md, 2026-11-04 entries. Model:
 * docs/monsters/MODEL.md, "Family templates: the Role axis".
 */
import { MODULE_ID } from "./constants.mjs";
import { parseHitDice, savesForLevel } from "./stats.mjs";
import { hdFormula } from "../lib/actor-read.mjs";
import { citeOf, getDoc, hasDoc, isMissingRow } from "../lib/tables.mjs";

/** A Hit Dice rating as `{count, bonus}`: parsed text, a number, or an already-parsed rating. */
export function hdOf(hd) {
  if (hd == null || hd === "") return null;
  if (typeof hd === "number") return Number.isFinite(hd) && hd > 0 ? { count: hd, bonus: null } : null;
  if (typeof hd === "object") return Number(hd.count) > 0 ? { count: Number(hd.count), bonus: hd.bonus ?? null } : null;
  return parseHitDice(String(hd).replace(/^(\d+)\s*\+\s*$/, "$1+1"));
}

/**
 * The row of the attack-throw ladder a rating stands on, counted in rows from
 * 1 HD (RR ch. 6, Attack Throws by Level and HD): a fraction of a die is the
 * row below 1-1, 1-1 the row below 1, and a hit-point bonus rounds the dice up
 * a row, which a penalty does not. Null for no rating.
 */
export function throwStep(hd) {
  const r = hdOf(hd);
  if (!r) return null;
  if (r.count < 1) return -1;
  const n = Math.floor(r.count);
  if (r.bonus > 0) return n + 1;
  if (r.bonus < 0 && n === 1) return 0;
  return n;
}

/** The registry document monster tables are imported into. */
export const MONSTERS_DOC = "monsters";

/**
 * The attack-throw ladder's table key: the Monster HD column of RR ch. 6,
 * Attack Throws by Level and HD, one row per `throwStep`, each `{throw}`.
 */
export const THROW_LADDER_TABLE = "attackThrowByHd";

/** A ladder row's key for a `throwStep`: the fraction row, the 1-1 row, then one per whole die. */
export const ladderKey = (step) => (step < 0 ? "half" : step === 0 ? "oneLess" : `hd${step}`);

/**
 * The attack-throw ladder as the Judge's world holds it (an override over the
 * imported layer), with the citation of the layer it comes from; `null` rows
 * where nothing is imported.
 */
export function importedThrowLadder() {
  if (!hasDoc(MONSTERS_DOC)) return { rows: null, cite: null };
  const rows = getDoc(MONSTERS_DOC)?.tables?.[THROW_LADDER_TABLE] ?? null;
  return { rows: rows && typeof rows === "object" ? rows : null, cite: citeOf(MONSTERS_DOC, THROW_LADDER_TABLE) };
}

/**
 * The throw a ladder gives a rating's row. A rating above the ladder's last
 * whole-die row takes that row, which the page prints open-ended. Null with no
 * ladder, no rating, or no figure on the row.
 */
export function ladderThrowAt(rows, step) {
  if (!rows || step == null) return null;
  const figure = (key) => {
    const row = rows[key];
    if (row == null || isMissingRow(row)) return null;
    const v = Number(typeof row === "object" ? row.throw : row);
    return Number.isFinite(v) ? v : null;
  };
  if (step > 0 && figure(ladderKey(step)) == null) {
    const top = Math.max(0, ...Object.keys(rows).map((k) => /^hd(\d+)$/.exec(k)?.[1]).filter(Boolean).map(Number));
    if (top && step > top) return figure(ladderKey(top));
  }
  return figure(ladderKey(step));
}

/**
 * A monster's attack throw by Hit Dice where nothing printed anchors it: the
 * row of the imported ladder its rating stands on (`throwStep`). Null when no
 * ladder is imported, so the throw is left to the actor's default rather than
 * guessed.
 */
export function monsterThrowForHd(hd, rows = null) {
  return ladderThrowAt(rows, throwStep(hd));
}

/**
 * A leader's attack throw: the member's own printed throw, moved by what the
 * ladder adds between the member's row and the leader's, so the anchor is
 * always the page's. Without a printed throw, the leader's own ladder row.
 * `{value, rows}` (`rows` the ladder rows moved), or null with no ladder.
 */
export function leaderThrow(baseThrow, baseHd, leaderHd, ladder = null) {
  const from = throwStep(baseHd);
  const to = throwStep(leaderHd);
  const at = ladderThrowAt(ladder, to);
  if (at == null) return null;
  const was = ladderThrowAt(ladder, from);
  if (Number.isFinite(baseThrow) && was != null) return { value: baseThrow + (at - was), rows: to - from };
  return { value: at, rows: null };
}

/**
 * The level a rating saves at, for a creature that saves at its Hit Dice: the
 * whole dice, less one for a hit-point penalty, and none below 1 HD.
 */
export function saveLevelOf(hd) {
  const r = hdOf(hd);
  if (!r) return null;
  if (r.count < 1) return 0;
  const n = Math.floor(r.count);
  return Math.max(0, r.bonus < 0 ? n - 1 : n);
}

/**
 * A leader's saves: the member's own save class, at its own save level moved
 * by the difference the two ratings make (`saveLevelOf`), so a creature that
 * saves above or below its dice keeps that offset. `{saveAs, saves}`, where
 * `saves` is the system's row shape.
 */
export function leaderSaves(baseSaveAs, baseHd, leaderHd) {
  const from = saveLevelOf(baseHd);
  const to = saveLevelOf(leaderHd);
  if (from == null || to == null) return null;
  const level = Math.max(0, (Number.isInteger(baseSaveAs?.level) ? baseSaveAs.level : from) + (to - from));
  const row = savesForLevel(level);
  const saves = Object.fromEntries(Object.entries(row).filter(([k]) => k !== "band").map(([k, v]) => [k, { value: v }]));
  return { saveAs: { class: baseSaveAs?.class ?? "fighter", level }, saves };
}

/**
 * A stat line's "by weapon ±N" damage, split into the die part a weapon item
 * holds and the creature's own modifier, which belongs on `system.damage.mod`
 * where every weapon the creature swings adds it. Null for any other damage
 * (a die of a natural attack keeps its own modifier).
 */
export function splitWeaponModifier(damage) {
  const m = /^\s*(by weapon)\s*(?:([+-])\s*(\d+))?\s*$/i.exec(String(damage ?? ""));
  if (!m) return null;
  return { formula: m[1].replace(/^b/, "B"), mod: m[2] ? (m[2] === "-" ? -1 : 1) * parseInt(m[3], 10) : 0 };
}

/** The role keys, in the order the sheet lists them. */
export const ROLE_ORDER = Object.freeze(["champion", "subChieftain", "chieftain", "shaman", "witchDoctor", "drudge", "whelp"]);

/** The role an unpinned generation takes. */
export const STANDARD_ROLE = "standard";

/** A printed rank word to its role key: "sub- chieftain", "subchieftain" and "sub-chieftain" alike. */
export function roleKeyOf(word) {
  const k = String(word ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (k === "warrior") return STANDARD_ROLE;
  if (k === "champion" || k === "champions") return "champion";
  if (k === "subchieftain" || k === "subchieftains") return "subChieftain";
  if (k === "chieftain" || k === "chieftains") return "chieftain";
  if (k === "shaman") return "shaman";
  if (k === "witchdoctor") return "witchDoctor";
  return null;
}

/**
 * An XP cell that prints one figure per role, "N (role)" or "(role) N" in
 * either order, as `{roleKey: N}`. Roles it does not know are left out.
 */
export function roleXp(text) {
  const out = {};
  const t = String(text ?? "");
  const int = (s) => parseInt(String(s).replace(/,/g, ""), 10);
  for (const m of t.matchAll(/(\d[\d,]*)\s*\(([^)]+)\)|([A-Za-z][A-Za-z -]*?)\s*\((\d[\d,]*)\)/g)) {
    const key = roleKeyOf(m[2] ?? m[3]);
    const n = int(m[1] ?? m[4]);
    if (key && Number.isFinite(n) && out[key] == null) out[key] = n;
  }
  return out;
}

/* ---------------- locators (shipped; the figures are the page's) ---------------- */

/** A count word or article before a rank: "a", "an", "one", or none. */
const COUNT = String.raw`(?:(?:an?|one|two|three|\d+)\s+)?`;
/** "N AC" or "AC N". */
const AC = String.raw`(?:(\d+)\s*AC|AC\s*(\d+))`;
/** A rating: "4", "4+1", "1-1", "1/2". */
const HD = String.raw`(\d+(?:\s*[+-]\s*\d+|\/\d+)?)`;
/** A die level, with a modifier where one is printed: "1d6", "1d4+1", "3". */
const LEVEL = String.raw`(\d*d\d+(?:\s*[+-]\s*\d+)?|\d+)`;
const RANK = String.raw`(champion|sub-?\s?chieftain|chieftain)s?`;

const LEADER_RX = new RegExp(
  String.raw`led by ${COUNT}${RANK} with ${AC},?\s*${HD}\s*HD,?\s*(?:and\s+)?(\d+)\s*hp(?:,?\s*and\s+an?\s+([+-]\d+)\s+damage bonus)?`,
  "gi",
);
const DEPENDANT_RX = /\b(drudges and whelps|drudges|whelps) have Spd (\d+)['’]?,?\s*AC (\d+),?\s*(\d+) hp,?\s*ML (-?\d+)/gi;
const FIGHTS_AS_RX = /\b(drudges|whelps) fight as ([a-z]+)/gi;
const CASTER_RX = new RegExp(
  String.raw`(shaman|witch\s*-?\s*doctor) is equivalent to (?:an?\s+)?${RANK} statistically,?\s*but has (\w+) abilities at level ${LEVEL}`,
  "gi",
);

/**
 * Every role sentence in one member's prose, as data: leaders `{ac, hd, hp,
 * dmg}`, dependants `{speed, ac, hp, morale}` or `{as}` (another member's
 * name), casters `{as, cls, levelDie}`. A sentence it cannot read adds
 * nothing; the first sentence for a role wins.
 */
export function readRoleSentences(text) {
  const t = String(text ?? "").replace(/\s+/g, " ");
  const out = {};
  for (const m of t.matchAll(LEADER_RX)) {
    const role = roleKeyOf(m[1]);
    if (!role || out[role]) continue;
    out[role] = {
      ac: parseInt(m[2] ?? m[3], 10),
      hd: m[4].replace(/\s+/g, ""),
      hp: parseInt(m[5], 10),
      dmg: m[6] != null ? parseInt(m[6], 10) : null,
    };
  }
  for (const m of t.matchAll(DEPENDANT_RX)) {
    const fig = { speed: parseInt(m[2], 10), ac: parseInt(m[3], 10), hp: parseInt(m[4], 10), morale: parseInt(m[5], 10) };
    const who = m[1].toLowerCase();
    if (/drudge/.test(who)) out.drudge ??= fig;
    if (/whelp/.test(who)) out.whelp ??= fig;
  }
  for (const m of t.matchAll(FIGHTS_AS_RX)) {
    const role = /drudge/i.test(m[1]) ? "drudge" : "whelp";
    out[role] ??= { as: m[2].toLowerCase() };
  }
  for (const m of t.matchAll(CASTER_RX)) {
    const role = /witch/i.test(m[1]) ? "witchDoctor" : "shaman";
    if (out[role]) continue;
    out[role] = { as: roleKeyOf(m[2]), cls: m[3], levelDie: m[4].replace(/\s+/g, "") };
  }
  return out;
}

/* ---------------- cells ---------------- */

const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** What a member's option already says about itself: its rating, throw, save class and XP. */
function memberBase(option) {
  const extras = option.flags?.[MODULE_ID]?.extras ?? {};
  return {
    hd: hdOf(extras.hd),
    throw: option.merge?.attack?.throw,
    saveAs: extras.saveAs ?? null,
  };
}

/** The damage modifier a cell or a stat line writes as a total: both kinds of attack alike. */
export const damageTotal = (n) => ({ mod: { melee: n, missile: n } });

/** A rating as the page prints it: "3+2", "1-1", "1/2". */
export function ratingText(hd) {
  const r = hdOf(hd);
  if (!r) return "";
  const whole = r.count < 1 ? "1/2" : String(r.count);
  return r.bonus ? `${whole}${r.bonus > 0 ? "+" : ""}${r.bonus}` : whole;
}

/**
 * What a derived throw and save row were worked out from, stored on the
 * generated actor (`extras.derived`) so its sheet can name the parts: the
 * figure written, the member's figure and rating it moved from, the rating it
 * moved to, the ladder rows between, and the ladder's citation. A throw the
 * ladder could not give is `{missing: true}`.
 */
function derivation({ thr, sv, base, hd, ladderCite }) {
  const throwPart = thr
    ? { value: thr.value, base: Number.isFinite(base.throw) && thr.rows != null ? base.throw : null, baseHd: ratingText(base.hd), hd: ratingText(hd), rows: thr.rows, cite: ladderCite ?? "" }
    : { missing: true };
  const savesPart = sv
    ? { level: sv.saveAs.level, baseLevel: Number.isInteger(base.saveAs?.level) ? base.saveAs.level : null, baseHd: ratingText(base.hd), hd: ratingText(hd) }
    : null;
  return { throw: throwPart, ...(savesPart ? { saves: savesPart } : {}) };
}

/**
 * One leader's cell from its sentence: the printed AC, hit points, rating and
 * damage total (none printed is a total of 0), the throw and saves carried
 * over from the member's own block, and the role's printed XP where the XP
 * cell lists one. `ladder` is the imported attack-throw ladder's rows and
 * `ladderCite` its citation; without the ladder the cell writes no throw and
 * records that it could not. A sentence printing no hit points leaves them to
 * be rolled from the rating. `leader` is where the leader's own figures came
 * from (`extras.derived.leader`: `{source: "printed", cite}` or the procedure's
 * parts), which the sheet names.
 */
export function leaderCell(option, fig, { xp = null, ladder = null, ladderCite = null, leader = null } = {}) {
  const base = memberBase(option);
  const hd = hdOf(fig.hd);
  const merge = {
    ac: { value: fig.ac },
    damage: damageTotal(fig.dmg ?? 0),
  };
  if (hd) {
    merge.hp = { hd: hdFormula({ count: hd.count, dieType: 8, bonus: hd.bonus ?? 0 }) };
    if (Number.isFinite(fig.hp)) Object.assign(merge.hp, { value: fig.hp, max: fig.hp });
  }
  const thr = hd ? leaderThrow(base.throw, base.hd, hd, ladder) : null;
  if (thr) merge.attack = { throw: thr.value };
  const sv = hd && base.hd ? leaderSaves(base.saveAs, base.hd, hd) : null;
  if (sv) merge.saves = sv.saves;
  if (Number.isInteger(xp)) merge.details = { xp };
  const extras = {};
  if (hd) extras.hd = { count: hd.count, bonus: hd.bonus ?? null };
  if (sv) extras.saveAs = sv.saveAs;
  if (hd) extras.derived = derivation({ thr, sv, base, hd, ladderCite });
  if (leader) (extras.derived ??= {}).leader = leader;
  return { merge, flags: Object.keys(extras).length ? { [MODULE_ID]: { extras } } : {} };
}

/** A dependant that does not fight: its printed speed, AC, hit points and morale, and none of the member's weapons. */
function dependantCell(fig) {
  return {
    dropItemTypes: ["weapon"],
    merge: {
      movement: { base: fig.speed },
      ac: { value: fig.ac },
      hp: { hd: "1d8", value: fig.hp, max: fig.hp },
      details: { morale: fig.morale },
      damage: damageTotal(0),
      attacks: "",
    },
    flags: { [MODULE_ID]: { extras: { noncombatant: true } } },
  };
}

/** A dependant that fights as another member: that member's combat block whole. */
function fightsAsCell(target) {
  const m = target.merge ?? {};
  const merge = {};
  for (const key of ["ac", "hp", "attack", "saves", "movement"]) if (m[key] != null) merge[key] = structuredClone(m[key]);
  merge.damage = damageTotal(Number(m.damage?.mod?.melee) || 0);
  const details = {};
  if (m.details?.morale != null) details.morale = m.details.morale;
  if (m.details?.xp != null) details.xp = m.details.xp;
  if (Object.keys(details).length) merge.details = details;
  const ex = target.flags?.[MODULE_ID]?.extras ?? {};
  const extras = {};
  if (ex.hd) extras.hd = structuredClone(ex.hd);
  if (ex.saveAs) extras.saveAs = structuredClone(ex.saveAs);
  return { merge, flags: Object.keys(extras).length ? { [MODULE_ID]: { extras } } : {} };
}

/** The member a "fights as" word names: its key or its label, singular or plural. */
function memberNamed(options, word) {
  const w = String(word ?? "").toLowerCase();
  const forms = new Set([w, w.replace(/es$/, ""), w.replace(/s$/, "")]);
  return options.find((o) => forms.has(String(o.key).toLowerCase()) || forms.has(String(o.label ?? "").toLowerCase())) ?? null;
}

/**
 * Build the Role axis and its cells for a family: one cell per variant×role
 * the variant's prose prints, keyed `variant|role`, and a role on the axis
 * only where some variant has its cell. `memberXp` maps a variant key to its
 * XP cell's text, read whole. The axis's default is the standard rank and
 * file, so an unpinned generation never invents a leader (`chooseAxes`).
 * `ladder` and `ladderCite` are the imported attack-throw ladder
 * (`importedThrowLadder`). Pushes onto `axes` and `cells`, and sets
 * `out.nameFormat`; adds nothing where no variant prints a role.
 */
export function proseLeaderRoles({ options, memberText, memberXp = new Map(), axes, cells, out, ladder = null, ladderCite = null }) {
  const found = new Set();
  for (const option of options) {
    const said = readRoleSentences(memberText.get(option.key) ?? "");
    const xp = roleXp(memberXp.get(option.key) ?? "");
    const built = {};
    for (const role of ["champion", "subChieftain", "chieftain"]) {
      if (said[role]) {
        const leader = { source: "printed", cite: option.flags?.[MODULE_ID]?.cookbook?.cite ?? "", ac: said[role].ac };
        built[role] = leaderCell(option, said[role], { xp: xp[role] ?? null, ladder, ladderCite, leader });
      }
    }
    for (const role of ["drudge", "whelp"]) {
      const fig = said[role];
      if (!fig) continue;
      if (fig.as) {
        const target = memberNamed(options, fig.as);
        if (target && target !== option) built[role] = fightsAsCell(target);
      } else {
        built[role] = dependantCell(fig);
      }
    }
    // A caster is another role's block with the class it casts as and the
    // die its level is rolled on at generation.
    for (const role of ["shaman", "witchDoctor"]) {
      const fig = said[role];
      const as = fig ? built[fig.as] : null;
      if (!as) continue;
      const cell = structuredClone(as);
      const flags = (cell.flags[MODULE_ID] ??= {});
      flags.extras = { ...(flags.extras ?? {}), spellcasting: { class: capitalize(fig.cls), level: null, levelDie: fig.levelDie } };
      built[role] = cell;
    }
    for (const [role, cell] of Object.entries(built)) {
      found.add(role);
      cells.push({ by: ["variant", "role"], key: `${option.key}|${role}`, merge: cell.merge, items: [], flags: cell.flags, ...(cell.dropItemTypes ? { dropItemTypes: cell.dropItemTypes } : {}) });
    }
  }
  if (!found.size) return;
  roleAxis(axes, found, out);
}

const ROLE_LABELS = {
  champion: "Champion", subChieftain: "Sub-Chieftain", chieftain: "Chieftain",
  shaman: "Shaman", witchDoctor: "Witch Doctor", drudge: "Drudge", whelp: "Whelp",
};

/**
 * The Role axis holding `found` roles, Standard first and the default: added
 * where the template has none, and widened in `ROLE_ORDER` where it lacks one.
 */
function roleAxis(axes, found, out) {
  let axis = axes.find((a) => a.key === "role");
  if (!axis) {
    axis = {
      key: "role",
      label: "Role",
      roll: "",
      default: STANDARD_ROLE,
      derive: { from: "", max: null },
      options: [{ key: STANDARD_ROLE, label: "Standard", nameLabel: "" }],
    };
    axes.push(axis);
  }
  const have = new Set(axis.options.map((o) => o.key));
  const keys = ROLE_ORDER.filter((k) => found.has(k) || have.has(k));
  axis.options = [
    axis.options.find((o) => o.key === STANDARD_ROLE),
    ...keys.map((k) => axis.options.find((o) => o.key === k) ?? { key: k, label: ROLE_LABELS[k], nameLabel: ROLE_LABELS[k] }),
  ].filter(Boolean);
  out.nameFormat = "{variant} {role}";
  return axis;
}

/** The leader-source axis's key. */
export const SOURCE_AXIS = "leaderSource";

/** The leader-source axis's option keys: the book's printed leaders, or the procedure's. */
export const SOURCE =Object.freeze({ printed: "printed", procedure: "axioms" });

/**
 * The leaders the AXIOMS procedure builds (`monsters/leader-derive.mjs`), as
 * a second source beside the printed ones. A printed leader always stands: a
 * variant whose page prints any leader gets the procedure's cells under the
 * leader-source axis's procedure option only, so its default, the printed
 * book, is what generates unless the Judge picks otherwise; a variant whose
 * page prints none gets them as plain role cells, the only leaders it has.
 * Each cell takes its throw and saves as a printed leader's do, its role's XP
 * where the member's XP cell prints one, records its parts on
 * `extras.derived.leader`, and asks for its hit points rolled from its rating
 * (`rollHp`), which the procedure does not give. `proc` is
 * `importedLeaderProcedure()`; nothing is added without it.
 */
export function derivedLeaderRoles({ options, axes, cells, out, proc, deriveLeader, memberXp = new Map(), ladder = null, ladderCite = null }) {
  if (!proc) return;
  const found = new Set();
  let underSource = false;
  for (const option of options) {
    const base = memberBase(option);
    if (!base.hd) continue;
    const printed = new Set(
      cells.filter((c) => (c.by ?? []).length === 2 && String(c.key).startsWith(`${option.key}|`)).map((c) => String(c.key).split("|")[1]),
    );
    const anyPrinted = ["champion", "subChieftain", "chieftain"].some((r) => printed.has(r));
    const xp = roleXp(memberXp.get(option.key) ?? "");
    const ac = Number(option.merge?.ac?.value);
    const damage = Number(option.merge?.damage?.mod?.melee) || 0;
    for (const role of ["champion", "subChieftain", "chieftain"]) {
      const d = deriveLeader(proc, { hd: base.hd, ac: Number.isFinite(ac) ? ac : 0, damage }, role);
      if (!d) continue;
      const leader = {
        source: SOURCE.procedure,
        cite: proc.cite ?? "",
        rows: d.rows,
        baseHd: ratingText(base.hd),
        baseAc: Number.isFinite(ac) ? ac : 0,
        acAdd: d.acAdd,
        baseDamage: damage,
        damageAdd: d.damageAdd,
        carried: d.carried,
        bonusFactor: d.bonusFactor,
        hd: ratingText(d.hd),
        ac: d.ac,
        damage: d.damage,
      };
      const cell = leaderCell(option, { ac: d.ac, hd: d.hd, hp: null, dmg: d.damage }, { xp: xp[role] ?? null, ladder, ladderCite, leader });
      const by = anyPrinted ? ["variant", "role", SOURCE_AXIS] : ["variant", "role"];
      const key = anyPrinted ? `${option.key}|${role}|${SOURCE.procedure}` : `${option.key}|${role}`;
      cells.push({ by, key, merge: cell.merge, items: [], flags: cell.flags, rollHp: true });
      found.add(role);
      if (anyPrinted) underSource = true;
    }
  }
  if (!found.size) return;
  const role = roleAxis(axes, found, out);
  if (!underSource || axes.some((a) => a.key === SOURCE_AXIS)) return;
  // The source is chosen before the role, so a role the default source does
  // not print for the chosen variant is unavailable rather than generated
  // under a leader's name with the warrior's figures.
  axes.splice(axes.indexOf(role), 0, {
    key: SOURCE_AXIS,
    label: "Leader figures",
    roll: "",
    default: SOURCE.printed,
    derive: { from: "", max: null },
    options: [
      { key: SOURCE.printed, label: "As printed", nameLabel: "" },
      { key: SOURCE.procedure, label: "AXIOMS procedure", nameLabel: "" },
    ],
  });
}

/**
 * The cookbook id a single entry's leader template answers for: the entry's
 * own id with a suffix no entry id carries, so the template stands on the
 * entry's shelf without claiming the creature's id.
 */
export const leaderTemplateId = (id) => `${id}.leaders`;

/** Does a monster's type list make it one the leader procedure builds for? */
export const procedureBuildsFor = (types) => (types ?? []).some((t) => String(t).toLowerCase() === "beastman");

/**
 * The Role axis for ONE entry outside a family: a template whose variant axis
 * holds the entry's own creature alone, its default, and whose role cells are
 * what its prose prints (`proseLeaderRoles`) and, where `procedure` holds, what
 * the leader procedure builds beside them (`derivedLeaderRoles`). `{axes,
 * cells, out}`, or null when neither adds a role, so an entry whose page
 * names no leader mints nothing. `option` is the creature as a variant option
 * (the shape `importFamily` builds); `text` its description and `xp` its whole
 * XP cell, read as text.
 */
export function entryLeaderTemplate({ option, text = "", xp = "", proc = null, deriveLeader = null, procedure = false, ladder = null, ladderCite = null }) {
  const options = [option];
  const axes = [{ key: "variant", label: "Variant", roll: "", default: option.key, derive: { from: "", max: null }, options }];
  const cells = [];
  const out = { nameFormat: "{variant}" };
  const memberText = new Map([[option.key, text]]);
  const memberXp = new Map([[option.key, xp]]);
  proseLeaderRoles({ options, memberText, memberXp, axes, cells, out, ladder, ladderCite });
  if (procedure && proc && deriveLeader) derivedLeaderRoles({ options, axes, cells, out, proc, deriveLeader, memberXp, ladder, ladderCite });
  return cells.length ? { axes, cells, out } : null;
}

/**
 * Is a family's overview member lore rather than a variant? An overview (the
 * member named as the family is) whose every stat field is read from the
 * same page and box as another member's carries that member's figures under
 * the family's name, so it is not offered as a variant of its own.
 * `entryOf(id)` returns a member's cookbook entry.
 */
export function overviewIsLore(member, members, famName, entryOf) {
  if (String(member.variant ?? "").toLowerCase() !== String(famName ?? "").toLowerCase()) return false;
  const statBoxes = (entry) =>
    new Map(
      Object.entries(entry?.fields ?? {})
        .filter(([k]) => k.startsWith("stats."))
        .map(([k, f]) => [k, JSON.stringify([f?.page ?? null, f?.box ?? null])]),
    );
  const own = statBoxes(entryOf(member.id));
  if (!own.size) return false;
  return members.some((other) => {
    if (other.id === member.id) return false;
    const theirs = statBoxes(entryOf(other.id));
    return [...own].every(([k, at]) => theirs.get(k) === at);
  });
}
