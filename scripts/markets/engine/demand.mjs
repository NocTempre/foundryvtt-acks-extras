/* global game */
/**
 * The SOLE writer of a market's demand layers (`goods.demand`, the base;
 * `goods.demandOverrides`, the Judge's pins). `goods.demandDerived` is
 * reserved for route equalisation and has no writer yet. Every read goes
 * through `trueDemand` (rules/demand.mjs).
 *
 * Demand is the GM's: a writer called from a player seat refuses with
 * `{error: "gmOnly"}` and touches nothing, so no UI gate is the only guard.
 * Each writer answers `{ok: true}` or `{error}`, the shape the Trade tab's
 * `reportResult` reads.
 */
import { DEMAND_LAYER } from "../rules/demand.mjs";

const plain = (row) => row.toObject?.() ?? JSON.parse(JSON.stringify(row));

const err = (error) => ({ error });

/** The layers a Judge writes by hand; `derived` is not among them. */
const WRITABLE = Object.freeze(["base", "override"]);

/**
 * Write, or delete, one row of a demand layer for a merchandise category. A
 * base write also clears `dmProfile.source`; an override write leaves it.
 * @param {Actor} location
 * @param {object} o
 * @param {"base"|"override"} o.layer
 * @param {string} o.category            A merchandise key.
 * @param {number|null} o.modifier       Price steps; null deletes that layer's row for the category.
 * @returns {Promise<{ok: true}|{error: string}>}
 */
export async function writeDemand(location, { layer, category, modifier }) {
  if (!game.user?.isGM) return err("gmOnly");
  if (!WRITABLE.includes(layer)) return err("badLayer");
  if (!category) return err("noCategory");
  const field = DEMAND_LAYER[layer];
  const rows = (location.system.market.goods[field] ?? []).map(plain);
  const index = rows.findIndex((row) => row.category === category);
  if (modifier == null) {
    if (index < 0) return { ok: true };
    rows.splice(index, 1);
  } else {
    const value = Math.trunc(Number(modifier) || 0);
    if (index >= 0) rows[index].modifier = value;
    else rows.push({ category, modifier: value });
  }
  const changes = { [`system.market.goods.${field}`]: rows };
  // A hand write to the base makes it the Judge's: a book import that refreshes
  // a base it supplied then leaves this one alone. A pin never touches it.
  if (layer === "base") changes["system.market.goods.dmProfile.source"] = null;
  await location.update(changes);
  return { ok: true };
}

/**
 * Replace the base layer with a generator's results and store the profile that
 * produced them. The override layer is never touched. The profile's `source` is
 * cleared: the base is now the generator's, not a book's.
 * @param {Actor} location
 * @param {object} o
 * @param {object} o.profile  `{ageBand, water, biome, elevation, landRevenueGp, races, rolls, landPicks}`.
 * @param {Array<{category: string, base: number}>} o.results  One row per good.
 * @returns {Promise<{ok: true, written: number}|{error: string}>}
 */
export async function applyGenerated(location, { profile, results }) {
  if (!game.user?.isGM) return err("gmOnly");
  const rows = (results ?? []).filter((r) => r?.category).map((r) => ({ category: r.category, modifier: Math.trunc(Number(r.base) || 0) }));
  if (!rows.length) return err("noResults");
  await location.update({
    "system.market.goods.demand": rows,
    "system.market.goods.dmProfile": {
      ageBand: profile.ageBand ?? null,
      water: [...(profile.water ?? [])],
      biome: [...(profile.biome ?? [])],
      elevation: profile.elevation || null,
      landRevenueGp: profile.landRevenueGp ?? null,
      races: [...(profile.races ?? [])],
      rolls: (profile.rolls ?? []).map((r) => ({ category: r.category, a: Math.trunc(Number(r.a) || 0) })),
      landPicks: (profile.landPicks ?? []).map((p) => ({ category: p.category, delta: Math.trunc(Number(p.delta) || 0) })),
      source: null,
      time: Math.floor(Number(game.time?.worldTime) || 0),
    },
  });
  return { ok: true, written: rows.length };
}
