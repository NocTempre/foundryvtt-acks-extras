/* global game, foundry, Hooks */
/**
 * Domains on the map: the country brush's DOMAIN layer, the Domains map mode,
 * and a domain's territory rows read off the map. The one file of this
 * feature that touches battlemap, which names no feature: both registries are
 * battlemap's, and everything registered here reads the world's domain actors.
 *
 * A hex is painted into a domain by the domain's uuid
 * (`flags["acks-extras"].domain`, the cells as offset keys in `domainHexes`),
 * on the Regions control alone, since the Domains mode draws it. The layer
 * derives the hex's territory — the domain's class — which a territory painted
 * on the hex overrides. A domain deleted leaves regions naming a uuid nothing
 * answers to: such a hex derives nothing, and the mode draws it in one neutral
 * colour so the Judge can find it and erase it.
 *
 * See docs/domains/MODEL.md, "Territory on the map".
 */
import { MODULE_ID, LANG_PREFIX } from "./constants.mjs";
import { allDomains, isDomain } from "./domains.mjs";
import {
  borderTier, domainColors, domainRecord, hexCountOf, realmChain, realmOrder, rowsOf, territoryRows,
} from "./domain-logic.mjs";
import { indexPlaces } from "../lib/place-logic.mjs";
import { makeLoc } from "../lib/util.mjs";
import {
  hexLabelFromOffset, isHexScene, layerRegionsOf, paintLayerChanged, registerPaintLayer,
} from "../battlemap/terrain-paint.mjs";
import { layerPlan, registerMapMode } from "../battlemap/map-modes.mjs";

const loc = makeLoc(LANG_PREFIX);

/** The layer's key, which is also the map mode's and the `source` a derived territory names. */
export const DOMAIN_LAYER = "domain";

/** Region flags: the domain's uuid, and the painted cells as offset keys. */
export const DOMAIN_FLAG = "domain";
export const DOMAIN_HEXES_FLAG = "domainHexes";

/** The colour of a hex painted into a domain no longer in the world. */
export const ORPHAN_COLOR = "#8a8a8a";

/**
 * A border's weight by how high in the realm it runs (`borderTier`): a realm's
 * edge, then the line between a sovereign's vassals, then anything deeper.
 */
const TIER_WEIGHTS = Object.freeze([1.75, 1, 0.6]);

/** The world's domains as realm records, their index and their colours, read fresh on every ask. */
function realm() {
  const records = allDomains().map(domainRecord);
  return { records, index: indexPlaces(records), colors: domainColors(records) };
}

const domainAt = (uuid) => (uuid ? allDomains().find((d) => d.uuid === uuid) ?? null : null);

/** A painted value's name: its domain's, or what a hex of a domain no longer in the world reads as. */
const labelOf = (uuid) => domainAt(uuid)?.name || loc("map.unknownDomain");

registerPaintLayer({
  key: DOMAIN_LAYER,
  flag: DOMAIN_FLAG,
  hexesFlag: DOMAIN_HEXES_FLAG,
  regionsOnly: true,
  title: `${LANG_PREFIX}.map.layer`,
  values: () => realmOrder(realm().records),
  label: labelOf,
  color: (uuid) => realm().colors.get(uuid) ?? ORPHAN_COLOR,
  // The palette's swatches fold under each realm's sovereign.
  groups: {
    of: (uuid) => realmChain(uuid, realm().index)[0],
    label: labelOf,
  },
  // A hex's class is its domain's (RR §VIII.3); a domain not yet classified, or gone, implies none.
  derives: { key: "territory", of: (uuid) => domainAt(uuid)?.system?.classification || null },
});

/**
 * The Domains mode's legend: each domain painted on the scene in its colour,
 * in realm order, a vassal named under its liege, and one row for hexes of a
 * domain no longer in the world. A hex with no border holds no domain.
 * @returns {{rows: Array<{color: string, label: string}>, unpainted: null, stripes: null}}
 */
export function domainLegend(scene) {
  const { records, index, colors } = realm();
  const present = new Set(layerPlan(scene, DOMAIN_LAYER).map((h) => h.value));
  const rows = realmOrder(records).filter((uuid) => present.has(uuid)).map((uuid) => {
    const chain = realmChain(uuid, index);
    const name = index.get(uuid)?.name || loc("sheet.unnamed");
    const liege = chain.length > 1 ? (index.get(chain.at(-2))?.name || loc("sheet.unnamed")) : null;
    return { color: colors.get(uuid), label: liege ? loc("map.under", { name, liege }) : name };
  });
  if ([...present].some((uuid) => !index.has(uuid))) rows.push({ color: ORPHAN_COLOR, label: loc("map.unknownDomain") });
  return { rows, unpainted: null, stripes: null };
}

/** The weight of a side between two painted values, from where their realm chains part. */
export function domainWeights() {
  const { index } = realm();
  return (uuid, across) => TIER_WEIGHTS[Math.min(borderTier(uuid, across, index), TIER_WEIGHTS.length - 1)];
}

registerMapMode({
  key: DOMAIN_LAYER,
  label: `${LANG_PREFIX}.map.mode`,
  layer: DOMAIN_LAYER,
  plan: (scene) => layerPlan(scene, DOMAIN_LAYER),
  legend: domainLegend,
  weights: domainWeights,
});

/**
 * Every hex painted into a domain, on every hex scene of the world:
 * `[{sceneUuid, sceneName, key, label}]`, `key` the offset key and `label` the
 * hex's name on the map.
 */
export function paintedHexesOf(domain) {
  const uuid = domain?.uuid;
  if (!uuid) return [];
  return [...(game.scenes ?? [])].filter(isHexScene).flatMap((scene) => layerRegionsOf(scene, DOMAIN_LAYER)
    .filter((region) => region.getFlag(MODULE_ID, DOMAIN_FLAG) === uuid)
    .flatMap((region) => (region.getFlag(MODULE_ID, DOMAIN_HEXES_FLAG) ?? []).map((key) => {
      const [i, j] = String(key).split(":").map(Number);
      return { sceneUuid: scene.uuid, sceneName: scene.name ?? "", key, label: hexLabelFromOffset({ i, j }) };
    })));
}

/** A domain's territory with the map read in (`territoryRows`): its stored rows, then a row per painted hex none names. */
export function territoryOf(domain) {
  return territoryRows(rowsOf(domain?.system?.territory), paintedHexesOf(domain));
}

/** The hexes a domain covers, its painted ones included (`hexCountOf` over `territoryOf`). */
export function hexCountFor(domain) {
  return hexCountOf(territoryOf(domain));
}

/** The domain fields the map draws from: its name labels a swatch, its liege places its colour and border, its class is the hex's. */
const DRAWN_FIELDS = Object.freeze(["name", "system.parentUuid", "system.classification"]);

/**
 * Redraw the map and the palette when a domain they draw changes with no
 * region written: one is made or deleted, or renamed, given another liege or
 * another class. Called once, at init.
 */
export function installDomainMap() {
  const changed = () => paintLayerChanged(DOMAIN_LAYER);
  Hooks.on("createActor", (actor) => {
    if (isDomain(actor)) changed();
  });
  Hooks.on("deleteActor", (actor) => {
    if (isDomain(actor)) changed();
  });
  Hooks.on("updateActor", (actor, change) => {
    if (isDomain(actor) && DRAWN_FIELDS.some((path) => foundry.utils.hasProperty(change, path))) changed();
  });
}
