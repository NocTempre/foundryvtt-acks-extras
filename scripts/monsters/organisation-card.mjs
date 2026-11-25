/**
 * The Judges' card a Roll posts, as a plain view model (board 1e of the design
 * canvas): what the Roll threw, the unit rows it made with their share and troop,
 * the findings it could not settle, the treasure it handed to the pot and what it
 * wrote. Pure and Foundry-free: strings arrive through `text(key, data)` and the
 * template prints what this returns, so every figure carries its tooltip here, and
 * the suite reads them with no world. Rulings: docs/monsters/MODEL.md, "The
 * organisation roll".
 */
import { walk } from "./encounter-recipe.mjs";

/** The recipe part a step's `why` names, with its count or chance word taken off. */
const partOfStep = (why) => String(why ?? "").replace(/ (count|chance|size)$/, "");

/** The page each recipe part prints on, from the stacks and leaders the tree carries. */
function citesOf(top) {
  const cites = new Map();
  for (const node of walk(top)) {
    for (const s of node.stacks) if (s.gen?.part) cites.set(s.gen.part, s.gen.cite);
    for (const o of node.officers) if (o.part) cites.set(o.part, o.cite);
  }
  return cites;
}

/** Bodies the stacks of one node hold. */
const bodiesOf = (node) => node.stacks.reduce((n, s) => n + (Number(s.count) || 0), 0);

/**
 * The card's view.
 *
 * @param {object} args
 * @param {object} args.tree `planOrganisationRoll`'s result
 * @param {(key: string, data?: object) => string} args.text a localiser
 * @param {{key: string, label: string}[]} [args.troops] the troop rows, for a key's label
 * @param {{uuid: string, name: string}|null} [args.group] the roll's top group
 * @param {{uuid: string}|null} [args.pot] the pot the treasure rows went to
 * @param {number} [args.stacks] stacks written
 * @param {number} [args.bodies] bodies written
 * @returns {{steps: object[], units: object[], findings: object[], treasure: string, wrote: string, group: object|null, pot: object|null}}
 */
export function cardView({ tree, text, troops = [], group = null, pot = null, stacks = 0, bodies = 0 } = {}) {
  const cites = citesOf(tree.top);
  const steps = (tree.steps ?? []).map((s) => {
    const part = partOfStep(s.why);
    const cite = cites.get(part) ?? "";
    return {
      label: s.why,
      figure: s.formula,
      total: s.total,
      cite,
      tip: [text("organisation.card.tip.step", { formula: s.formula, total: s.total, part }), cite].filter(Boolean).join(" · "),
    };
  });
  const troopLabel = (key) => troops.find((r) => r.key === key)?.label ?? key;
  const units = walk(tree.top).filter((n) => !n.camp).map((n) => ({
    label: n.label || n.word,
    bodies: bodiesOf(n),
    share: n.shareKind || "",
    troop: n.troop ? troopLabel(n.troop) : "",
    trait: n.trait ?? "",
    leaders: n.officers.length,
    tip: text("organisation.card.tip.unit", { word: n.word, bodies: bodiesOf(n), leaders: n.officers.length }),
  }));
  const findings = (tree.findings ?? []).map((f) => {
    const data = { word: f.word ?? "", status: f.status ?? "", unit: f.unit ?? "", table: f.table ?? "", roll: f.roll ?? "", part: f.part ?? "", gear: f.gear ?? "", role: f.role ?? "", figure: f.figure ?? "", trait: f.trait ?? "", dice: f.dice ?? "", n: f.candidates?.length ?? 0, missing: (f.missing ?? []).join(", ") };
    return { what: f.what, text: text(`organisation.card.finding.${f.what}`, data), candidates: f.candidates ?? [] };
  });
  return {
    steps,
    units,
    findings,
    treasure: tree.treasure?.deal ? text("organisation.card.treasure", { n: tree.treasure.hoards }) : "",
    wrote: text("organisation.card.wrote", { stacks, bodies }),
    group,
    pot,
  };
}

/**
 * The pot's monster rows after a Roll's treasure is added: a row for the creature
 * raised by `hoards` where the pot already holds that creature, else appended. The
 * pot's own `normalizeMonsters` clamps the figures.
 * @param {object[]} rows the pot's `deal.monsters`
 * @param {{actorId: string, name: string, letter: string|null}} creature
 * @param {number} hoards
 * @returns {object[]}
 */
export function withHoards(rows, creature, hoards) {
  const next = (rows ?? []).map((r) => ({ ...r }));
  const same = next.find((r) => r.actorId === creature.actorId);
  if (same) same.hoards = (Number(same.hoards) || 1) + hoards;
  else next.push({ actorId: creature.actorId, name: creature.name, count: 1, letter: creature.letter ?? null, hoards });
  return next;
}
