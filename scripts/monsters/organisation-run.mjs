/* global game, foundry, fromUuid, fromUuidSync */
/**
 * The provider of the organisation Roll (docs/monsters/MODEL.md, "The organisation
 * roll"): the Foundry half that reads a family template and a chart's row, rolls
 * with `planOrganisationRoll`, plans the write with lib's `planRoll`, and carries
 * it out through lib's executor, supplying what lib knows nothing of: how a
 * prototype spec becomes an actor and how a leader is made. It then hands the
 * treasure to the pot and whispers the Judges' card. Never throws for a refusal:
 * every answer is `{ok, reason?}`, with every id made in `created`.
 */
import { MODULE_ID } from "./constants.mjs";
import { generateFromTemplate } from "../lib/template-generate.mjs";
import { ANIMAL_TYPE } from "../lib/constants.mjs";
import { libraryActors, whenReady } from "../lib/library.mjs";
import { postToJudges } from "../lib/roll-audience.mjs";
import { ORG_PROTOTYPE_FLAG, makeFaction, nodesOf, orgHostOf, planRoll, rowAncestors, runPlan, unitsOf } from "../lib/org.mjs";
import { holdsUnitsOfUnits, needsFactionCard } from "./generate-host.mjs";
import { makeLoc } from "../lib/util.mjs";
import { letterOf } from "../treasure/search-logic.mjs";
import { newPot, potOf, setDealMonsters } from "../treasure/pot.mjs";
import { GRADE_SOURCE, NO_TRAIT, NO_TROOP, importedOrganisation } from "./organisation.mjs";
import { planOrganisationRoll } from "./organisation-logic.mjs";
import { cardView, withHoards } from "./organisation-card.mjs";

const loc = makeLoc("ACKS-MONSTERS");

/** The flag key a generated leader carries the figures with no field of their own under. */
export const LEADER_FLAG = "leaderRoll";

const refused = (reason, extra = {}) => ({ ok: false, reason, created: [], ...extra });

/** The template's variant option for a breed: where the encounter lines and the recipe live. */
const variantOptionOf = (template, variant) =>
  (template.system?.toObject?.().axes ?? template.system?.axes ?? []).find((a) => a.key === "variant")?.options?.find((o) => o.key === variant) ?? null;

/** The Role cell `variant|role` of a template, or null. */
const cellOf = (template, variant, role) => (template.system?.cells ?? []).find((c) => c.key === `${variant}|${role}`) ?? null;

/** The axes a spec pins on the family template; every axis the roll decided is pinned, so a mint never rolls beside it. */
function pinsOf(spec, extra = {}) {
  const pins = { variant: spec.variant, troop: spec.troop || NO_TROOP, trait: spec.trait || NO_TRAIT, ...extra };
  if (spec.role) pins.role = spec.role;
  if (spec.grade === GRADE_SOURCE) pins.leaderSource = GRADE_SOURCE;
  return pins;
}

/** The world actor already minted for a prototype key, or null. */
const mintedFor = (key) => [...game.actors].find((a) => a.flags?.[MODULE_ID]?.[ORG_PROTOTYPE_FLAG] === key) ?? null;

/**
 * Roll an organisation into a chart row.
 *
 * @param {object} args
 * @param {Actor|null} [args.host] a faction or a group hosting the chart; none makes the top unit's group the host
 * @param {string} [args.rowKey] the empty row to fill; blank starts a new top row
 * @param {Actor|string} [args.template] the family template (or its uuid); an empty row below the top reads it from its ancestor
 * @param {string} [args.variant] the breed's key
 * @param {"dungeon"|"wilderness"} [args.context]
 * @param {"wandering"|"lair"|"chance"} [args.state]
 * @param {"one"|"below"} [args.scope]
 * @param {{troops?: boolean, traits?: boolean, gear?: boolean}} [args.rules]
 * @param {string} [args.leaderSource]
 * @param {"page"|"table"} [args.villageSource]
 * @param {object} [args.choices] the Judge's choices where the page is silent
 * @param {string} [args.placeUuid] a place whose roster the top group joins
 * @param {Cards|string|null} [args.pot] a staged pot the treasure rows join; none makes a new one
 * @param {() => number} [args.rng]
 * @param {boolean} [args.card] post the Judges' card (default true)
 * @returns {Promise<{ok: boolean, reason?: string, created: string[], made?: object, host?: string, group?: string, rows?: object[], findings?: object[], treasure?: object, pot?: string, tree?: object}>}
 */
export async function rollOrganisation({ host = null, rowKey = "", template = null, variant = "", context, state, scope = "one", rules, leaderSource, villageSource, choices, placeUuid = "", pot = null, rng = Math.random, card = true } = {}) {
  const rows = host ? unitsOf(host) : [];
  const target = rowKey ? rows.find((r) => r.key === rowKey) : null;
  if (rowKey && !target) return refused("noRow");
  if (target?.holderUuid) return refused("filled");

  // What the roll that began the chart recorded, read from the nearest ancestor that holds it.
  const above = target ? rowAncestors(rowKey, nodesOf(rows)).map((k) => rows.find((r) => r.key === k)).filter(Boolean) : [];
  const began = above.find((r) => r.gen?.variant) ?? null;
  const gen = { ...(began?.gen ?? {}) };
  const own = target?.gen ?? {};
  const use = (given, key, fallback) => given ?? gen[key] ?? fallback;
  const family = typeof template === "string" ? await fromUuid(template).catch(() => null) : template ?? (gen.template ? await fromUuid(gen.template).catch(() => null) : null);
  if (!family) return refused("noTemplate");
  const key = use(variant || undefined, "variant", "");
  const option = variantOptionOf(family, key);
  const encounter = option?.flags?.[MODULE_ID]?.extras?.encounter ?? null;
  if (!encounter) return refused("noRecipe");

  await whenReady();
  const library = libraryActors().filter((a) => a.type === "monster" || a.type === ANIMAL_TYPE).map((a) => ({ name: a.name, uuid: a.uuid }));
  const org = importedOrganisation();
  const hdOf = (role) => Number(cellOf(family, key, role)?.flags?.[MODULE_ID]?.extras?.hd?.count) || null;
  const printedHp = (spec) => (spec.kind === "cell" && spec.role ? Number(cellOf(family, key, spec.role)?.merge?.hp?.max) || null : null);
  const inherit = target ? { trait: gen.trait ?? "", ...(own.shareKind ? { shareKind: own.shareKind } : {}), ...(own.troop ? { troop: own.troop } : {}) } : {};

  const tree = planOrganisationRoll({
    recipe: encounter.recipe ?? [], encounter, variant: key, context: use(context, "context", "wilderness"), state: use(state, "state", "wandering"),
    unit: target?.kind ?? "", rng, rules: use(rules, "rules", {}), leaderSource: use(leaderSource, "leaderSource", ""), villageSource: use(villageSource, "villageSource", "page"),
    org, library, choices: use(choices, "choices", {}), inherit, hdOf, printedHp,
  });
  if (!tree.ok) return refused(tree.reason ?? "noTree");
  tree.gen.template = family.uuid;

  const hostRef = host ? { uuid: host.uuid, kind: host.type === `${MODULE_ID}.faction` ? "faction" : "group" } : null;
  const plan = planRoll({ host: hostRef, rows, rowKey, tree, scope, labels: { camp: loc("organisation.camp") }, placeUuid, newKey: () => foundry.utils.randomID() });
  if (!plan.ok) return refused(plan.reason);

  const provider = {
    async mint(spec, { key: protoKey }) {
      const held = mintedFor(protoKey);
      if (held) return { actor: held, made: false };
      const actor = await generateFromTemplate(family, { pins: pinsOf(spec) });
      if (!actor) return null;
      await actor.update({ [`flags.${MODULE_ID}.${ORG_PROTOTYPE_FLAG}`]: protoKey });
      return { actor, made: true };
    },
    async makeLeader(op, spec, mount) {
      const actor = await generateFromTemplate(family, { pins: pinsOf({ ...spec, role: spec.role || op.role, troop: op.troop, trait: op.trait }, op.gear?.length ? { gear: op.gear } : {}) });
      if (!actor) return null;
      const figures = { ...(mount ? { mount } : {}), ...(op.speaksCommon != null ? { speaksCommon: !!op.speaksCommon } : {}) };
      if (Object.keys(figures).length) await actor.update({ [`flags.${MODULE_ID}.${LEADER_FLAG}`]: figures });
      return actor;
    },
  };
  const run = await runPlan(plan, provider);
  const out = { ...run, host: hostRef?.uuid ?? run.made.groups[0] ?? "", group: run.made.groups[0] ?? "" };
  if (!run.ok) return out;
  out.rows = plan.rows;
  out.findings = tree.findings;
  out.treasure = tree.treasure;
  out.tree = tree;

  const card_ = await makeCardIfVillage({ host: host ?? fromUuidSync(run.made.groups[0]), target, rowKey, tree, hostRef });
  if (card_) {
    out.faction = card_.ok ? card_.faction.uuid : "";
    out.factionResult = { ok: card_.ok, ...(card_.reason ? { reason: card_.reason } : {}) };
    if (card_.ok) out.created = [...out.created, card_.faction.uuid];
  }

  const hand = tree.treasure?.deal ? await handOffTreasure({ run, hoards: tree.treasure.hoards, pot }) : null;
  if (hand?.pot) {
    out.pot = hand.pot;
    if (hand.made) out.created = [...out.created, hand.pot];
  }
  if (card) await postCard({ tree, run, family, group: out.group, pot: hand?.pot ?? "", org });
  return out;
}

/**
 * A Roll that made a village ends with lib's Make its own: the group hosting the chart is
 * given a faction card and listed under it. A gang or warband roll, a roll below the top of
 * a chart, and a chart already on a faction or under one make no card. Null where none was
 * called for; otherwise lib's answer, which never stops the roll's own result.
 * @returns {Promise<{ok: boolean, reason?: string, faction?: Actor}|null>}
 */
async function makeCardIfVillage({ host, target, rowKey, tree, hostRef }) {
  const group = host;
  if (!group || group.type === `${MODULE_ID}.faction`) return null;
  const rowIsTop = hostRef ? !!rowKey && !target?.parentKey : true;
  if (!needsFactionCard({ holdsUnitsOfUnits: holdsUnitsOfUnits(tree), rowIsTop, hostIsFaction: false, joined: !!orgHostOf(group.uuid) })) return null;
  return makeFaction(group);
}

/**
 * Add the roll's treasure to a pot's deal list: one row for the first creature
 * the roll made that carries a treasure type, raised by the hoards the line
 * counts. A pot named is added to; none makes a new staged pot. A roll that made
 * no creature with a type deals nothing, and says so as an empty hand.
 * @returns {Promise<{pot?: string, made?: boolean}|null>}
 */
async function handOffTreasure({ run, hoards, pot }) {
  const makers = await Promise.all([...run.made.prototypes, ...run.reused, ...run.made.leaders].map((u) => fromUuid(u).catch(() => null)));
  const creature = makers.find((a) => letterOf(a?.system?.details?.treasure?.type));
  if (!creature) return null;
  const row = { actorId: creature.id, name: creature.name, letter: letterOf(creature.system.details.treasure.type) };
  const held = typeof pot === "string" ? await fromUuid(pot).catch(() => null) : pot;
  if (held) {
    await setDealMonsters(held, withHoards(potOf(held).deal.monsters, row, hoards));
    return { pot: held.uuid, made: false };
  }
  const made = await newPot({ render: false, deal: { monsters: withHoards([], row, hoards) } });
  return made ? { pot: made.uuid, made: true } : null;
}

/** Whisper the Judges' card for a Roll. */
async function postCard({ tree, run, family, group, pot, org }) {
  const stacks = run.made.groups.map((u) => fromUuidSync(u)).flatMap((g) => g?.system?.stacks ?? []);
  const content = await foundry.applications.handlebars.renderTemplate(`modules/${MODULE_ID}/templates/monsters/organisation-card.hbs`, {
    title: loc("organisation.card.title", { name: family.name }),
    where: [tree.gen.variant, loc(`organisation.card.context.${tree.context}`), loc(`organisation.card.state.${tree.state}`)].filter(Boolean).join(" · "),
    ...cardView({
      tree, text: loc, troops: org.troops?.rows ?? [], group: group ? { uuid: group, name: fromUuidSync(group)?.name ?? "" } : null,
      pot: pot ? { uuid: pot } : null, stacks: stacks.length, bodies: stacks.reduce((n, s) => n + (s.size?.initial ?? 0), 0),
    }),
  });
  await postToJudges({ content, speaker: { alias: loc("organisation.card.speaker") }, flags: { [MODULE_ID]: { organisationRoll: { group, pot } } } });
}
