/**
 * What an entry is called on a seat, on plain data: the name its plate and its
 * assignment option carry. A name is the document the entry points at, a body's
 * own name, or, for an entry that names nothing, the word for its kind. Two
 * entries that would read alike are told apart by their order, so a picker and
 * a plan select never list two identical lines.
 */

const text = (value) => (typeof value === "string" ? value.trim() : "");

/**
 * The plate name of every entry, keyed by the entry's key.
 * @param {object[]} entries the entries a seat sees
 * @param {object} words
 * @param {(entry: object) => string} words.nameOf the name the entry's document or body carries, or empty
 * @param {(kind: string) => string} words.kindWord the word for a kind, for an entry with no name
 * @returns {Map<string, string>}
 */
export function plateNames(entries, { nameOf, kindWord }) {
  const list = Array.isArray(entries) ? entries : [];
  const base = list.map((entry) => text(nameOf(entry)) || text(kindWord(entry.kind)) || entry.kind);
  const total = new Map();
  for (const name of base) total.set(name, (total.get(name) ?? 0) + 1);
  const seen = new Map();
  const names = new Map();
  list.forEach((entry, index) => {
    const name = base[index];
    const nth = (seen.get(name) ?? 0) + 1;
    seen.set(name, nth);
    names.set(entry.key, total.get(name) > 1 ? `${name} ${nth}` : name);
  });
  return names;
}
