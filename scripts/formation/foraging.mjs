/**
 * Living off the country: foraging, hunting, and grazing.
 *
 * The day board has carried `forage` and `hunt` as pickable slots since the
 * journey shipped, and nothing has ever resolved them. This resolves them, and
 * what it produces goes into the same pool
 * ([provisions.mjs](./provisions.mjs)) the order eats from — which is the only
 * reason the slots were ever worth picking.
 *
 * Three kinds of foraging, and they are NOT the same shape, which is the whole
 * reason this needs structure rather than one function:
 *
 *  - **Firewood** is per forager and may be attempted as often as wanted.
 *  - **Water** is a PARTY throw, once a day — one roll for the whole order,
 *    not one each — and a hex with a river or a lake skips the throw entirely.
 *    Past a certain size the order throws again for each further group.
 *  - **Food** is per forager, once a day, against one target wherever you are.
 *
 * Hunting is its own activity: the hunter throws, dogs throw alongside and help
 * each other to a cap, and how settled the country is moves the target — game
 * is scarce where people are.
 *
 * Every target, bonus, cap and yield is printed and arrives through the
 * `foraging` registered document. What ships is which activities exist, who
 * throws for each, and how the modifiers combine.
 */
import { getDoc, hasDoc } from "../lib/tables.mjs";
import { numOrNull } from "../lib/util.mjs";

/** The registered document these derivations read. */
export const FORAGING_DOC = "foraging";

/**
 * The three things a party can forage for.
 *
 * `perParty` is the structural difference that matters: water is one throw for
 * the whole order and the other two are one throw each.
 */
export const FORAGE_KINDS = Object.freeze({
  firewood: { label: "ACKS-FORMATION.forage.firewood", perParty: false, daily: false },
  water: { label: "ACKS-FORMATION.forage.water", perParty: true, daily: true },
  food: { label: "ACKS-FORMATION.forage.food", perParty: false, daily: true },
});

function table(key) {
  if (!hasDoc(FORAGING_DOC)) return null;
  return getDoc(FORAGING_DOC)?.tables?.[key] ?? null;
}

/**
 * The target for one kind of foraging, and what modifies it.
 *
 * Targets are keyed by terrain where the rules vary by terrain and by a single
 * `any` where they do not, so the same lookup serves all three kinds without
 * the caller knowing which is which.
 *
 * `automatic` is the water case: standing water skips the throw rather than
 * easing it, so a caller must check it before rolling anything.
 */
export function forageSpec({
  kind = "food", terrain = "", territory = "", standingWater = false, survival = false,
} = {}) {
  const spec = FORAGE_KINDS[kind];
  if (!spec) return { ok: false, reason: "kind" };
  if (kind === "water" && standingWater) return { ok: true, automatic: true };

  const targets = table("targets")?.[kind];
  const target = numOrNull(targets?.[terrain] ?? targets?.any);
  if (target == null) return { ok: false, missing: "targets", kind, terrain };

  // Three things move the throw and they are different rules, so they are
  // three registered tables rather than one pre-summed target: hard country,
  // settled country whose "forage" is somebody's crop, and the proficiency.
  const parts = [];
  const add = (key, value) => { if (value) parts.push({ key, value }); };
  add("terrain", numOrNull(table("forageTerrain")?.[kind]?.[terrain]));
  add("territory", numOrNull(table("forageTerritory")?.[kind]?.[territory]));
  add("survival", survival ? numOrNull(table("survivalBonus")) : null);

  const bonus = parts.reduce((n, part) => n + part.value, 0);
  return { ok: true, target, bonus, parts, perParty: spec.perParty, kind };
}

/**
 * How many throws the order gets for a party-wide forage.
 *
 * Water is one throw per group, and an order larger than a group throws again
 * for each — success feeding only the group that found it. A missing cap means
 * one throw rather than an invented number of them.
 */
export function partyThrows(mouths) {
  const cap = numOrNull(table("partyGroupSize"));
  const n = Math.max(0, Math.floor(Number(mouths) || 0));
  if (cap == null || cap <= 0) return 1;
  return Math.max(1, Math.ceil(n / cap));
}

/**
 * The hunting throw: the hunter's own target, moved by how settled the country
 * is. Game is scarce where people are, and the sign of that modifier is the
 * rule — its size is printed.
 */
export function huntSpec({ territory = "borderlands", dogs = 0 } = {}) {
  const base = numOrNull(table("huntTarget"));
  if (base == null) return { ok: false, missing: "huntTarget" };
  const territoryMod = numOrNull(table("huntTerritory")?.[territory]) ?? 0;
  return { ok: true, target: base, bonus: territoryMod, territory, dogs: dogPack(dogs) };
}

/**
 * A pack of hunting dogs: each throws, and each helps the others to a cap.
 *
 * The help is what makes a pack worth keeping — six dogs are not six lone dogs
 * — and the cap is what stops a kennel from being an autowin.
 */
export function dogPack(count) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (!n) return null;
  const target = numOrNull(table("dogTarget"));
  if (target == null) return { throws: n, missing: "dogTarget" };
  const per = numOrNull(table("dogHelpPerDog")) ?? 0;
  const cap = numOrNull(table("dogHelpCap"));
  const raw = per * Math.max(0, n - 1);
  const bonus = cap == null ? raw : Math.min(raw, cap);
  return { throws: n, target, bonus };
}

/**
 * What one success yields, in the units the pool counts.
 *
 * Null when unimported: a forage that succeeded against a target nobody
 * imported has found something of unknown size, and guessing its size is how a
 * party gets fed on numbers we invented.
 */
export function forageYield(kind) {
  const y = table("yields")?.[kind];
  const amount = numOrNull(y?.amount);
  if (amount == null) return null;
  return { amount, feeds: numOrNull(y?.feeds), unit: typeof y?.unit === "string" ? y.unit : null };
}

/**
 * Whether an animal can graze here, and what it costs it.
 *
 * Three structural facts: grazing normally costs the whole day; some kinds
 * graze on their ancillary hours alone and so can still travel; and barren
 * country feeds only what already lives there. Which kinds are which is a
 * registered list, because the book names them.
 */
export function grazingSpec({ kind = "", terrain = "", native = false } = {}) {
  const barren = table("barrenTerrains");
  if (Array.isArray(barren) && barren.includes(terrain) && !native) {
    return { canGraze: false, reason: "barren" };
  }
  const efficient = table("efficientGrazers");
  const onAncillary = Array.isArray(efficient) && efficient.includes(kind);
  return { canGraze: true, onAncillary, costsDay: !onAncillary };
}

/** True once the registry can resolve any of this. */
export function foragingReady() {
  return !!table("targets") || numOrNull(table("huntTarget")) != null;
}
