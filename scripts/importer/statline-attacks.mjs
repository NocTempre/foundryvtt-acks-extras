/**
 * The attack routines of a stat line that prints each routine's throw and
 * damage inside its `#AT` parenthesis ("<name> <n>+: <dice> <type> + <rider>"),
 * read one routine at a time. A line whose parenthesis names a throw with no
 * dice after it (damage under its own `Dmg` key) is not this shape and reads
 * nothing here, so `parseStatline` keeps its reading of such a line whole.
 */

/** A throw target as printed: a signed number and a plus sign. */
const THROW = /(-?\d+)\+/g;

/** A damage roll, with an optional multiplier before it ("<n> × <dice>"). */
const DAMAGE = /^(?:(\d+)\s*[×x*]\s*)?(\d+d\d+(?:\s*[+-]\s*\d+)?)/;

/** A routine's connector to the next: " or " or a comma, at parenthesis depth 0. */
const CONNECTOR = /\s+or\s+|,\s+/g;

/** What follows a throw, with its separator: a colon, a comma or nothing. */
const afterThrow = (s) => s.replace(/^\s*[:,]?\s*/, "");

/** The last connector in `s` at depth 0, as `[before, after]`, or `["", s]` when there is none. */
function splitLastConnector(s) {
  let depth = 0;
  let cut = null;
  for (const m of s.matchAll(CONNECTOR)) {
    depth = 0;
    for (const ch of s.slice(0, m.index)) depth += ch === "(" ? 1 : ch === ")" ? -1 : 0;
    if (depth === 0) cut = m;
  }
  return cut ? [s.slice(0, cut.index), s.slice(cut.index + cut[0].length)] : ["", s];
}

/** A routine's printed name, less its punctuation; a leading count ("2 claws") is split off. */
function nameOf(raw) {
  const name = raw.replace(/^[\s(),]+/, "").replace(/[\s:,]+$/, "").trim();
  const counted = /^(\d+)\s+(\D.*)$/.exec(name);
  return counted ? { text: counted[2].trim(), count: parseInt(counted[1], 10) } : { text: name };
}

/**
 * One damage clause: its roll, its multiplier, a damage-type word directly
 * after the roll when `words` knows it, and what is left as the rider.
 */
function damageOf(raw, words) {
  const s = raw.trim();
  const m = DAMAGE.exec(s);
  if (!m) return null;
  let rest = s.slice(m[0].length).trim();
  const out = { dmg: m[2].replace(/\s+/g, "") };
  if (m[1]) out.mult = parseInt(m[1], 10);
  const word = /^([A-Za-z]+)\b/.exec(rest);
  if (word && words[word[1].toLowerCase()]) {
    out.dmgType = words[word[1].toLowerCase()];
    rest = rest.slice(word[0].length);
  }
  const rider = rest.replace(/^[\s+&,]+/, "").replace(/[\s,;]+$/, "").trim();
  if (rider) out.rider = rider;
  return out;
}

/** A damage part split at each comma whose next piece opens with a roll; a piece with no roll joins the rider before it. */
function damageClauses(raw) {
  const pieces = [];
  for (const piece of raw.split(/,\s+/)) {
    if (pieces.length && DAMAGE.test(piece.trim())) pieces.push(piece);
    else if (pieces.length) pieces[pieces.length - 1] += `, ${piece}`;
    else pieces.push(piece);
  }
  return pieces;
}

/**
 * The routines of an attack parenthesis's text, in printed order, each
 * `{text, throw, dmg, dmgType?, rider?, count?}`; or null when no throw in it
 * is followed by a damage roll. `text` is the routine's name. Names printed as
 * a counted list beside as many damage clauses ("2 claws, 1 bite <n>+: <dice>,
 * <dice>") give one routine each, sharing the throw; `count` is the printed
 * count, else the damage's multiplier.
 *
 * @param {string} text the parenthesis's inside, alternatives joined by " or "
 * @param {Record<string, string>} words damage words to damage-type keys
 * @returns {object[]|null}
 */
export function scenarioRoutines(text, words) {
  const s = String(text ?? "");
  const throws = [...s.matchAll(THROW)].filter((m) => DAMAGE.test(afterThrow(s.slice(m.index + m[0].length))));
  if (!throws.length) return null;
  const out = [];
  let nameRaw = s.slice(0, throws[0].index);
  throws.forEach((m, i) => {
    const end = i + 1 < throws.length ? throws[i + 1].index : s.length;
    let damageRaw = afterThrow(s.slice(m.index + m[0].length, end));
    let nextName = "";
    if (i + 1 < throws.length) [damageRaw, nextName] = splitLastConnector(damageRaw);
    const th = parseInt(m[1], 10);
    const names = nameRaw.split(/,\s+/).map(nameOf).filter((n) => n.text);
    const clauses = damageClauses(damageRaw).map((c) => damageOf(c, words)).filter(Boolean);
    const pairs = names.length > 1 && names.length === clauses.length ? names.map((n, k) => [n, clauses[k]]) : [[nameOf(nameRaw), clauses[0] ?? null]];
    for (const [name, d] of pairs) {
      const { mult, ...dmg } = d ?? {};
      const count = name.count ?? mult;
      out.push({ text: name.text, throw: th, ...dmg, ...(count ? { count } : {}) });
    }
    nameRaw = nextName;
  });
  return out;
}
