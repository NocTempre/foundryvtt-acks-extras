/* global game, fromUuidSync, Actor */
/**
 * Domains, asked of the world: which domain holds a place, which ones a
 * character rules, which ones answer to a liege — and the Judge's writers for
 * what a domain's sheet cannot simply type in: the liege and the holdings,
 * because each must be checked against every other domain, and the two that
 * make a document (a vassal row promoted to a domain, a settlement founded).
 * The pure half is `domain-logic.mjs`.
 */
import { DOMAIN_TYPE, LANG_PREFIX } from "./constants.mjs";
import {
  domainHolding, domainRecord, figure, holdConflict, ledgerOf, normalizeHolding, peasantFamiliesOf, promoteVassalRow,
  rowsOf, urbanFamiliesOf, wouldCycleDomain,
} from "./domain-logic.mjs";
import { ancestorUuids, indexPlaces } from "../lib/place-logic.mjs";
import { allPlaces, packIdOf } from "../lib/place.mjs";
import { LOCATION_TYPE } from "../location/constants.mjs";

/** The picture a founded settlement is made with: core's village. */
const SETTLEMENT_IMG = "icons/svg/village.svg";

/** Is this document a domain actor? */
export const isDomain = (doc) => doc?.documentName === "Actor" && doc?.type === DOMAIN_TYPE;

/** Every domain in the world. Compendium domains are not consulted: a realm is the world's. */
export function allDomains() {
  return (game.actors ?? []).filter((a) => a.type === DOMAIN_TYPE);
}

/**
 * The document a uuid names, or null. Never throws: `fromUuidSync` raises on a
 * uuid into an unloaded compendium.
 */
function docOf(uuid) {
  try {
    return uuid ? (fromUuidSync(uuid) ?? null) : null;
  } catch {
    return null;
  }
}

const uuidOf = (docOrUuid) => (typeof docOrUuid === "string" ? docOrUuid : (docOrUuid?.uuid ?? ""));

/** Is this place held by any domain in the world? The empty-location prune asks this before it deletes. */
export function holdsPlace(placeOrUuid) {
  const uuid = uuidOf(placeOrUuid);
  return !!uuid && allDomains().some((d) => d.system.holdsPlace(uuid));
}

/** The domains holding exactly this place — normally one. */
export function domainsHolding(placeOrUuid) {
  const uuid = uuidOf(placeOrUuid);
  return uuid ? allDomains().filter((d) => d.system.holdsPlace(uuid)) : [];
}

/**
 * The domain a place belongs to: the one holding it, else the one holding the
 * nearest place it stands inside. A town held by a barony answers for every
 * inn in it. Null where no domain holds the place or anything around it.
 */
export function domainOf(place) {
  const uuid = uuidOf(place);
  if (!uuid) return null;
  const doc = typeof place === "string" ? docOf(place) : place;
  const nodes = allPlaces({ pack: doc?.pack ?? packIdOf(doc?.system?.parentUuid) });
  const chain = [uuid, ...ancestorUuids(uuid, indexPlaces(nodes))];
  const domains = allDomains();
  const found = domainHolding(domains.map(domainRecord), chain);
  return found ? domains.find((d) => d.uuid === found.uuid) ?? null : null;
}

/** The domains this actor rules. */
export function domainsRuledBy(actorOrUuid) {
  const uuid = uuidOf(actorOrUuid);
  return uuid ? allDomains().filter((d) => d.system.rulerUuid === uuid) : [];
}

/** The vassal domains that name this one as their liege. */
export function vassalsOf(domainOrUuid) {
  const uuid = uuidOf(domainOrUuid);
  return uuid ? allDomains().filter((d) => d.system.parentUuid === uuid) : [];
}

/** The liege domain of this one, or null where it has none or the liege is gone. */
export function liegeOf(domain) {
  const doc = docOf(domain?.system?.parentUuid);
  return isDomain(doc) ? doc : null;
}

/** Would making `liege` this domain's liege close a loop? */
export function wouldCycle(domain, liege) {
  const index = indexPlaces(allDomains().map(domainRecord));
  return wouldCycleDomain(uuidOf(domain), uuidOf(liege), index);
}

/**
 * Set or clear a domain's liege. GM only. A liege that would make the domain
 * its own overlord is refused.
 * @returns {Promise<{ok: boolean, reason?: "judgeOnly"|"cycle"|"notDomain"}>}
 */
export async function setLiege(domain, liege) {
  if (!isDomain(domain)) return { ok: false, reason: "notDomain" };
  if (!game.user?.isGM) return { ok: false, reason: "judgeOnly" };
  if (liege && !isDomain(liege)) return { ok: false, reason: "notDomain" };
  if (liege && wouldCycle(domain, liege)) return { ok: false, reason: "cycle" };
  await domain.update({ "system.parentUuid": liege?.uuid ?? "" });
  return { ok: true };
}

/**
 * Hold a place. GM only. A place this domain already holds is a no-op; one
 * another domain holds is refused, naming that domain, because a settlement
 * counted in two domains is two sets of the same families.
 * @param {object} [row] the holding row's other fields: `{role, investmentGp, note, hidden}`
 * @returns {Promise<{ok: boolean, reason?: "judgeOnly"|"held"|"heldElsewhere"|"notDomain", other?: Actor}>}
 */
export async function hold(domain, place, row = {}) {
  if (!isDomain(domain) || !place?.uuid) return { ok: false, reason: "notDomain" };
  if (!game.user?.isGM) return { ok: false, reason: "judgeOnly" };
  if (domain.system.holdsPlace(place.uuid)) return { ok: false, reason: "held" };
  const conflict = holdConflict(allDomains().map(domainRecord), domain.uuid, place.uuid);
  if (conflict) return { ok: false, reason: "heldElsewhere", other: docOf(conflict.uuid) };
  const role = row.role ?? (place.system?.market ? "settlement" : "other");
  const rows = rowsOf(domain.system.holdings).map((r) => r?.toObject?.() ?? r);
  await domain.update({
    "system.holdings": [...rows, normalizeHolding({ ...row, role, uuid: place.uuid, name: place.name ?? "" })],
  });
  return { ok: true };
}

/** Let go of a place. GM only. */
export async function release(domain, placeUuid) {
  if (!isDomain(domain) || !placeUuid || !game.user?.isGM) return false;
  const rows = rowsOf(domain.system.holdings).map((r) => r?.toObject?.() ?? r);
  const kept = rows.filter((r) => r.uuid !== placeUuid);
  if (kept.length === rows.length) return false;
  await domain.update({ "system.holdings": kept });
  return true;
}

/**
 * Promote one of a liege's vassal rows to a domain of its own: a domain actor
 * answering to the liege, carrying what the row said (`promoteVassalRow`), and
 * the row deleted, because a vassal is an actor or a row, never both. GM
 * only. The new domain is created bare and then written, because the system's
 * `Actor.create` drops a single create's `system`; the row goes only once the
 * new domain holds the record.
 * @param {(key: string) => string} [label] names a figure the record has no field for, in its notes
 * @returns {Promise<{ok: boolean, domain?: Actor, reason?: "judgeOnly"|"notDomain"|"noRow"|"notCreated"}>}
 */
export async function promoteVassal(liege, rowId, { label } = {}) {
  if (!isDomain(liege)) return { ok: false, reason: "notDomain" };
  if (!game.user?.isGM) return { ok: false, reason: "judgeOnly" };
  const rows = rowsOf(liege.system.vassalRows).map((r) => r?.toObject?.() ?? r);
  const row = rows.find((r) => r.id === rowId);
  if (!row) return { ok: false, reason: "noRow" };
  const { name, system } = promoteVassalRow(row, { liegeUuid: liege.uuid, label });
  const domain = await Actor.create({
    name: name || game.i18n.localize(`${LANG_PREFIX}.sheet.unnamed`),
    type: DOMAIN_TYPE,
    folder: liege.folder?.id ?? null,
  });
  if (!domain) return { ok: false, reason: "notCreated" };
  await domain.update({ system });
  await liege.update({ "system.vassalRows": rows.filter((r) => r.id !== rowId) });
  return { ok: true, domain };
}

/**
 * Found a settlement for a domain: a world location with a market, held by
 * the domain at once as a settlement. GM only. Created bare and then given
 * its market, as the location sheet's own Add a market writes it.
 * @param {object} [market] the market to give it; the location model's empty one where omitted
 * @returns {Promise<{ok: boolean, place?: Actor, reason?: string, other?: Actor}>} `hold`'s refusal where the hold fails
 */
export async function foundSettlement(domain, { name = "", market = null } = {}) {
  if (!isDomain(domain)) return { ok: false, reason: "notDomain" };
  if (!game.user?.isGM) return { ok: false, reason: "judgeOnly" };
  const marketData = market ?? (await import("../location/data/location-data.mjs")).emptyMarket();
  const place = await Actor.create({
    name: name || game.i18n.localize(`${LANG_PREFIX}.sheet.newSettlement`),
    type: LOCATION_TYPE,
    img: SETTLEMENT_IMG,
  });
  if (!place) return { ok: false, reason: "notCreated" };
  await place.update({ "system.market": marketData });
  const held = await hold(domain, place, { role: "settlement" });
  return held.ok ? { ok: true, place } : { ...held, place };
}

/** A placed settlement's urban families, off its place's market; null where nobody has entered them. */
export function placeFamilies(uuid) {
  const families = docOf(uuid)?.system?.market?.urbanFamilies;
  return families === undefined ? null : families;
}

/**
 * A domain's families: peasant from its territory, urban from the
 * settlements it holds, with how many settlements give no figure.
 * @returns {{peasant: number, urban: number, urbanUnknown: number}}
 */
export function familiesOf(domain) {
  const urban = urbanFamiliesOf(domain?.system?.holdings, placeFamilies);
  return { peasant: peasantFamiliesOf(domain?.system?.territory), urban: urban.total, urbanUnknown: urban.unknown };
}

/** The domain's month as its record states it (`domain-logic.mjs` `ledgerOf`), over the world's vassals. */
export function ledgerFor(domain) {
  const families = familiesOf(domain);
  return ledgerOf(domain?.system, {
    families: { peasant: families.peasant, urban: families.urbanUnknown ? null : families.urban },
    vassalDomains: vassalsOf(domain).map((d) => ({ tributeGp: figure(d.system.tributeGp) })),
  });
}
