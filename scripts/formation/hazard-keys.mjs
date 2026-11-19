/**
 * The keys a Hazard item can carry, which group each belongs to, and the label
 * and icon each shows. The Hazard data model, its sheet, the compendium builder
 * and `hazard-logic.mjs` all read this one list, so it holds no Foundry global
 * and imports nothing that does: the compendium builder runs it under plain
 * Node.
 *
 * An obstacle key is a crossing kind: one of the climb obstacles in
 * `OBSTACLES`, or the jump, swim and squeeze kinds (named here by their string
 * because `crossing.mjs` cannot be loaded outside Foundry; the test pins each
 * to its constant there). A condition key is a fact about the ground an
 * obstacle sits on, present or absent. Neither carries a figure: length, gap
 * and depth are typed on a place's own row, so no printed value lives here.
 */
import { OBSTACLES } from "./obstacles.mjs";

/** The obstacle keys, in the order a pick lists them: the climb obstacles in the crossing's own order, then jump, swim and squeeze. */
export const OBSTACLE_HAZARDS = Object.freeze([...Object.keys(OBSTACLES), "jump", "swim", "squeeze"]);

/** The condition keys, in the order a pick lists them. */
export const CONDITION_HAZARDS = Object.freeze(["ropeFixed", "noRunUp", "precarious", "waterCold", "waterRough", "waterFast"]);

/** Every hazard key: the obstacles, then the conditions. */
export const HAZARD_KEYS = Object.freeze([...OBSTACLE_HAZARDS, ...CONDITION_HAZARDS]);

/** The two groups a pick shows, in order, with the lang key of each group's caption. */
export const HAZARD_GROUPS = Object.freeze([
  Object.freeze({ group: "obstacle", label: "ACKS-FORMATION.HAZARD.group.obstacle", keys: OBSTACLE_HAZARDS }),
  Object.freeze({ group: "condition", label: "ACKS-FORMATION.HAZARD.group.condition", keys: CONDITION_HAZARDS }),
]);

/** The lang key of each hazard key's label: the crossing's own label where it has one. */
const LABEL_KEYS = Object.freeze({
  ...Object.fromEntries(Object.entries(OBSTACLES).map(([key, { label }]) => [key, label])),
  jump: "ACKS-FORMATION.crossing.kind.jump",
  swim: "ACKS-FORMATION.crossing.kind.swim",
  squeeze: "ACKS-FORMATION.crossing.kind.squeeze",
  ropeFixed: "ACKS-FORMATION.crossing.ropeFixed",
  noRunUp: "ACKS-FORMATION.HAZARD.noRunUp",
  precarious: "ACKS-FORMATION.crossing.precarious",
  waterCold: "ACKS-FORMATION.swimming.water.cold",
  waterRough: "ACKS-FORMATION.swimming.water.rough",
  waterFast: "ACKS-FORMATION.swimming.water.fast",
});

/** The core icon each hazard's compendium item shows. */
export const HAZARD_ICONS = Object.freeze({
  easyClimb: "icons/svg/ladder.svg",
  sheerClimb: "icons/svg/mountain.svg",
  rappel: "icons/svg/down.svg",
  crawl: "icons/svg/cave.svg",
  narrowLedge: "icons/svg/stone-path.svg",
  precariousLedge: "icons/svg/falling.svg",
  jump: "icons/svg/jump.svg",
  swim: "icons/svg/whale.svg",
  squeeze: "icons/svg/wall-direction.svg",
  ropeFixed: "icons/svg/anchor.svg",
  noRunUp: "icons/svg/leg.svg",
  precarious: "icons/svg/hazard.svg",
  waterCold: "icons/svg/frozen.svg",
  waterRough: "icons/svg/waterfall.svg",
  waterFast: "icons/svg/direction.svg",
});

/** The lang key of a hazard key's label, or null for a key that is none. */
export const hazardLabelKey = (key) => LABEL_KEYS[key] ?? null;

/** Which group a hazard key is in, `obstacle` or `condition`, or null for a key that is none. */
export function hazardGroupOf(key) {
  if (OBSTACLE_HAZARDS.includes(key)) return "obstacle";
  if (CONDITION_HAZARDS.includes(key)) return "condition";
  return null;
}

/**
 * Every hazard key with its label, as a select's choices.
 * @param {(key: string) => string} say turns a lang key into text
 * @returns {Record<string, string>}
 */
export const hazardChoices = (say) => Object.fromEntries(HAZARD_KEYS.map((key) => [key, say(LABEL_KEYS[key])]));

/**
 * The lang key, under `ACKS-FORMATION.crossing.ref.`, of the page each crossing
 * kind's setup cites for its figures; a climb obstacle cites the spelunking
 * page.
 */
export const figureRefKey = (key) => ({ jump: "jumping", swim: "swimming", squeeze: "squeezing" })[key] ?? "spelunking";
