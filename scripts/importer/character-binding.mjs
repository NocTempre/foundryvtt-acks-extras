/**
 * A person a page prints in full, read into the official character sheet's
 * boxes, so the sheet import (`character-sheet/pdf/apply.mjs:importSheet`)
 * binds the class at the printed level, grants what the line names, writes
 * the scores, hit points and alignment, and reports every printed figure the
 * class works out differently. What the page printed then stands in the
 * character's biography as the stamped "as printed" block. Foundry-free.
 *
 * Names are handed to `rename` before they reach a box, so an older printing's
 * name arrives as the one the library carries; the matching itself is the
 * sheet import's.
 */
import { abilityEntry, splitOutside } from "../character-sheet/pdf/parse.mjs";
import { COIN_KEYS, SCORE_KEYS, SHEET_ROWS } from "../character-sheet/pdf/plan.mjs";
import { escapeText } from "./prose.mjs";

/** A quick-stat alignment letter as the system writes the alignment. */
export const ALIGN_WORD = Object.freeze({ L: "Lawful", N: "Neutral", C: "Chaotic" });

/** The class the "as printed" block carries, beside the book-text stamp. */
export const AS_PRINTED_CLASS = "acks-extras-importer-as-printed";

const COIN_RE = new RegExp(`^(\\d[\\d,]*)\\s*(${COIN_KEYS.join("|")})$`, "i");
const ORDINAL_RE = /(\d+)(?:st|nd|rd|th)\s*[-–—:]?\s*/gi;

/** A repertoire's spell names by level, in printed order. */
function repertoireLevels(text) {
  const t = String(text ?? "");
  const marks = [...t.matchAll(ORDINAL_RE)];
  return marks.map((m, i) => ({
    level: Number(m[1]),
    names: t.slice(m.index + m[0].length, marks[i + 1]?.index ?? t.length).split(/[,;]/).map((s) => s.trim()).filter(Boolean),
  }));
}

/** The weapons a line names: the attack's own, then every one the damage brackets name. */
function weaponNames(sl) {
  const out = [];
  const add = (name) => {
    const n = String(name ?? "").trim();
    if (/[a-z]/i.test(n) && !out.some((w) => w.toLowerCase() === n.toLowerCase())) out.push(n);
  };
  add(sl.atk?.text);
  for (const m of String(sl.dmg ?? "").matchAll(/\(([^)]*)\)/g)) for (const w of m[1].split(/\s+or\s+|,/)) add(w);
  return out;
}

/** A proficiency token with its name renamed, its pick and rank kept as printed. */
function renamedAbility(token, rename) {
  const entry = abilityEntry(token);
  if (!entry) return null;
  const name = rename("proficiency", entry.name);
  return `${name}${entry.selection ? ` (${entry.selection})` : ""}${entry.rank > 1 ? ` ${entry.rank}` : ""}`;
}

/**
 * The sheet's boxes for one parsed quick-stat line (`parseStatline`) or
 * write-up (`parseWriteup`).
 *
 * The armour the AC bracket names and the equipment list are worn, so each
 * piece takes the slot its item asks for; coin goes to the coin boxes; the
 * weapons go to the weapons table. Experience and the save code are not
 * written: the line's XP is what defeating the person is worth, and the class
 * derives the saves.
 * @param {object} sl the parsed line
 * @param {object} [options]
 * @param {(kind: "class"|"proficiency"|"spell", name: string) => string} [options.rename]
 *   the library's name for a printed one
 * @returns {{values: Record<string, string>, morale: number|null, unplaced: Array<{kind: string, name: string}>}}
 *   `unplaced` is what the sheet has no row left for
 */
export function sheetValuesFromStatline(sl, { rename = (kind, name) => name } = {}) {
  const values = {};
  const unplaced = [];
  const set = (key, value) => {
    if (value !== null && value !== undefined && value !== "") values[key] = String(value);
  };
  if (sl.class?.name) {
    set("class", rename("class", sl.class.name));
    set("level", sl.class.level);
  }
  set("alignment", sl.al ? (ALIGN_WORD[sl.al] ?? sl.al) : null);
  for (const s of SCORE_KEYS) set(`score.${s}`, sl.abilities?.[s]);
  set("hp.value", sl.hp);
  set("hp.max", sl.hp);
  set("ac.shield", Number.isInteger(sl.ac) ? sl.ac : null);
  set("move.exploration", /(\d+)/.exec(String(sl.mv ?? ""))?.[1] ?? null);
  set("attack.0", sl.atk?.throw);

  // A token's throw bracket ("(11+)") is the row's throw box; the name drops it.
  const profOf = (token) => {
    const name = renamedAbility(token, rename);
    return name ? { name, throw: /\((\d+)\s*\+\)/.exec(token)?.[1] ?? null } : null;
  };
  const generalBoxes = Array.from({ length: SHEET_ROWS.generalProf }, (_, i) => `generalProf.${i}`);
  const classBoxes = Array.from({ length: SHEET_ROWS.classProf }, (_, i) => `classProf.${i}`);
  const fill = (list, boxes) => {
    const over = [];
    list.forEach((p, i) => {
      if (!boxes[i]) return void over.push(p);
      set(`${boxes[i]}.name`, p.name);
      if (p.throw) set(`${boxes[i]}.throw`, `${p.throw}+`);
    });
    return over;
  };
  const general = (sl.proficiencies ?? []).map(profOf).filter(Boolean);
  // A write-up splits its proficiencies by kind, and each kind fills its own
  // rows; a quick-stat line does not, so its one list fills the general rows
  // and runs on into the class rows.
  const over = sl.classProficiencies
    ? [...fill((sl.classProficiencies ?? []).map(profOf).filter(Boolean), classBoxes), ...fill(general, generalBoxes)]
    : fill(general, [...generalBoxes, ...classBoxes]);
  over.forEach((p) => unplaced.push({ kind: "proficiency", name: p.name }));

  const worn = splitOutside(sl.acNote ?? "", /[,&]/).filter((p) => /[a-z]/i.test(p));
  const coins = {};
  // A thousands comma is part of its number, not a list's separator.
  for (const piece of splitOutside(String(sl.equipment ?? "").replace(/(\d),(?=\d{3}(?!\d))/g, "$1"), /[,;]/)) {
    // A coin's closing bracket is a note about it ("(banked)"), not a piece of gear.
    const coin = COIN_RE.exec(piece.replace(/\s*\([^()]*\)\s*$/, "").trim());
    if (coin) {
      const box = coin[2].toLowerCase();
      coins[box] = (coins[box] ?? 0) + Number(coin[1].replace(/,/g, ""));
    } else worn.push(piece);
  }
  set("gear.worn.list", worn.join("\n"));
  for (const [box, count] of Object.entries(coins)) set(`coin.${box}`, count);

  weaponNames(sl).forEach((name, i) => (i < SHEET_ROWS.weapon ? set(`weapon.${i}.name`, name) : unplaced.push({ kind: "weapon", name })));

  const perDay = {};
  for (const m of String(sl.spells ?? "").matchAll(/(\d+)\s*(\d)(?:st|nd|rd|th)\b/gi)) {
    perDay[m[2]] = (perDay[m[2]] ?? 0) + Number(m[1]);
  }
  for (const [level, count] of Object.entries(perDay)) set(`spells.perDay.${level}`, count);
  for (const { level, names } of repertoireLevels(sl.repertoire)) {
    names.forEach((n, r) => {
      const name = rename("spell", n);
      if (level >= 1 && level <= SHEET_ROWS.spellLevels && r < SHEET_ROWS.spellsPerLevel) set(`spell.${level}.${r}`, name);
      else unplaced.push({ kind: "spell", name });
    });
  }
  return { values, morale: Number.isInteger(sl.ml) ? sl.ml : null, unplaced };
}

/**
 * The stamped "as printed" block: the stat line as the page prints it, a line
 * per figure the character carries differently, and a line per row the
 * caller adds (a name the library could not answer, a note). Stamped like
 * materialized book text, so `stripBookText` takes it with the rest of the
 * import's writing.
 * @param {object} block
 * @param {string} block.id the entry's cookbook id
 * @param {string} [block.statline] the printed line
 * @param {Array<{label: string, sheet: string, inForce: string}>} [block.differences] the sheet import's checks
 * @param {Array<{label: string, text: string}>} [block.rows]
 * @param {{heading: string, differs: (d: {label: string, sheet: string, inForce: string}) => string}} words
 * @returns {string} "" when there is nothing to say
 */
export function asPrintedBlock({ id, statline = "", differences = [], rows = [] }, { heading, differs }) {
  const line = String(statline ?? "").trim();
  if (!line && !differences.length && !rows.length) return "";
  const p = (label, text) => `<p><strong>${escapeText(label)}:</strong> ${escapeText(text)}</p>`;
  const body = [
    line ? `<p>${escapeText(line)}</p>` : "",
    ...differences.map((d) => p(d.label, differs(d))),
    ...rows.map((r) => p(r.label, r.text)),
  ].join("");
  return `<div class="${AS_PRINTED_CLASS}" data-acks-entry="${escapeText(id).replace(/"/g, "&quot;")}"><h3>${escapeText(heading)}</h3>${body}</div>`;
}

/**
 * Whether anyone but a Judge owns a document: the default level, or a user
 * `isPlayer` says is no GM, at `owner` or above.
 * @param {Record<string, number>} ownership
 * @param {{isPlayer: (userId: string) => boolean, owner: number}} options
 */
export function playerOwned(ownership, { isPlayer, owner }) {
  return Object.entries(ownership ?? {}).some(([who, level]) => Number(level) >= owner && (who === "default" || isPlayer(who)));
}
