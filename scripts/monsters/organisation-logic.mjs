/**
 * The beastman organisation roll: the recipe evaluator's tree (`encounter-recipe.mjs`)
 * with the optional rules layered on and every creature made a prototype the
 * write plan (`lib/org-write-logic.mjs`) can carry out. Pure and Foundry-free,
 * `rng` injected. Every figure is read from what is passed in (the imported
 * registry tables as `importedOrganisation()` answers them, the recipe, the
 * library's index) and none is stated here: a figure that is missing leaves its
 * piece blank and is listed in `findings`, so nothing throws and no wrong figure
 * is written. Row keys are data and are never branched on; a table row is told
 * by the figures it holds (a mount row by its `mounts`, a trait that adds beasts
 * by its `beastDice`).
 *
 * What the layers do, in order:
 *  1. The village makeup from the page's own parts, or (`villageSource: "table"`)
 *     from the table's cells, which replace the page's guards and captives.
 *  2. The optional three-way split (`rules.troops`): the shares the imported
 *     split figures give replace the recipe's two.
 *  3. A troop for each unit the split makes special, rolled on the variant's
 *     bands; its units, leaders and the gangs beneath take it.
 *  4. One trait for a unit that holds units (the top of a warband or village),
 *     rolled on the variant's bands, taken by everything under it.
 *  5. Mounts (a troop row's `mounts`): a mounted unit's bodies ride, and each
 *     unit above it has its leader mounted too. A mount word is an outside
 *     reference (`outside-reference.mjs`).
 *  6. Optional gear (`rules.gear`): carry rolls by the equipment table's own
 *     ranks, troops and scopes; a piece a leader's table does not give is listed
 *     as eligible-not and is never rolled onto.
 *  7. Speakers of Common, from the imported speech figures.
 *
 * Rulings: docs/monsters/MODEL.md, "The organisation roll".
 */
import { rollDie } from "../lib/template-logic.mjs";
import { bandDie } from "../lib/tables.mjs";
import { evaluateRecipe, rollFormula, unitWord, walk } from "./encounter-recipe.mjs";
import { REFERENCE, beastCellPart, readBeastCell, readMountCell, resolveOutside } from "./outside-reference.mjs";

/** The share key a three-way split gives the units its troops are rolled for. */
export const SPECIAL = "special";

/** The morale field's range on a group's officer (`unit.officerMoraleBonus`). */
const MORALE_BONUS_RANGE = [0, 4];

const whole = (v) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : null);

/** A prototype's identity: its fields in a fixed order, so identical creatures share one. */
export function protoKey(spec) {
  const o = {};
  for (const k of Object.keys(spec).sort()) {
    const v = spec[k];
    o[k] = Array.isArray(v) ? [...v].sort() : v;
  }
  return JSON.stringify(o);
}

/**
 * The troop or trait a die picks for a variant: a die over the bands the table
 * holds for that variant (the die the bands imply), the row whose band holds the
 * throw. A throw outside every band, or a variant with no band, is a gap.
 * @param {{key: string, cells: object}[]} rows the table's rows (`importedOrganisation().troops.rows`)
 * @param {string} variant the breed's column key
 * @param {() => number} rng
 * @returns {{key: string|null, roll: number|null, die: string|null}}
 */
export function rollBanded(rows, variant, rng) {
  const bands = (rows ?? []).map((r) => ({ key: r.key, band: r.cells?.[variant] })).filter((b) => b.band && Number.isInteger(b.band.min) && Number.isInteger(b.band.max));
  const die = bandDie(bands.map((b) => b.band));
  const roll = die ? rollDie(die, rng) : null;
  const hit = roll === null ? null : bands.find((b) => roll >= b.band.min && roll <= b.band.max);
  return { key: hit?.key ?? null, roll, die };
}

/** The role a Role cell key names: the part after the variant ("variant|role"), or the whole key. */
const roleOfCell = (cell) => String(cell ?? "").split("|").pop();

/**
 * The recipe with the village table's cells in place of the page's guards and
 * captives: a beast cell is a guard part of the table's own, and a per-unit cell
 * a captive part. Parts the table has no cell for are the page's. The units the
 * new parts apply to are those the page's own guard parts name.
 * @param {object[]} recipe
 * @param {{key: string, cells: object}[]} villageRows `importedOrganisation().village.rows`
 * @param {string} variant
 * @param {string} cite the table's page
 */
export function withTableVillage(recipe, villageRows, variant, cite = "") {
  const guards = (recipe ?? []).filter((p) => p.role === "guard");
  const units = guards[0]?.when?.units ?? (recipe ?? []).find((p) => p.role === "captive")?.when?.units ?? [];
  const fromTable = [];
  const captives = [];
  for (const row of villageRows ?? []) {
    const text = row.cells?.[variant];
    const cell = readBeastCell(text);
    if (!cell) continue;
    if (cell.kind === "perUnit") {
      captives.push({
        key: `village-${row.key}`, label: row.label, role: "captive",
        source: { uuid: "", templateCell: "", stat: "", name: row.label },
        count: { dice: cell.count.dice ?? "", literal: cell.count.literal ?? null, ratioOf: "", percent: null, round: "", perUnit: cell.perUnit },
        chance: cell.chance, when: { state: "", place: "", units: [...units] }, branch: { group: "", band: "" }, moraleWhileAlive: null, cite, basis: "table",
      });
    } else {
      const p = beastCellPart({ key: `village-${row.key}`, text, variant, units, cite });
      if (p) fromTable.push(p);
    }
  }
  const keep = (recipe ?? []).filter((p) => !(p.role === "guard" && fromTable.length) && !(p.role === "captive" && captives.length));
  return [...keep, ...fromTable, ...captives];
}

/**
 * Roll an organisation: the recipe evaluated for a unit, the optional rules
 * layered on, every creature a prototype. `tree` is what `lib/org-write-logic.mjs`
 * carries out; `gen` is the record a later Roll of an empty row under it needs.
 *
 * @param {object} args
 * @param {object[]} args.recipe the variant's recipe parts
 * @param {object|null} args.encounter the variant's `extras.encounter`
 * @param {string} args.variant the breed's key, the column its table cells are filed under
 * @param {"dungeon"|"wilderness"} args.context lib's own Roll's line
 * @param {"wandering"|"lair"|"chance"} args.state lib's own Roll's side; `chance` throws the lair chance
 * @param {string} [args.unit] the unit word of an empty row rolled from below the top
 * @param {() => number} [args.rng]
 * @param {{troops?: boolean, traits?: boolean, gear?: boolean}} [args.rules] which optional rules are on
 * @param {string} [args.leaderSource] `table` for the leader table's grade; blank for the variant's own leaders
 * @param {"page"|"table"} [args.villageSource]
 * @param {object} [args.org] `importedOrganisation()`
 * @param {{name: string, uuid: string}[]} [args.library] the library's index, for outside references
 * @param {object} [args.choices] the Judge's choices where the page is silent (the evaluator's, and `traitBeast`: a creature word)
 * @param {{trait?: string}} [args.inherit] what an ancestor's roll already fixed: a trait key, blank for none
 * @param {(role: string) => number|null} [args.hdOf] a leader's Hit Dice, for a chance per Hit Die
 * @param {(proto: object) => number|null} [args.printedHp] the hit points a prototype's own page prints
 * @returns {object} `{ok, reason?, context, state, lair, treasure, top, prototypes, findings, steps, gen}`
 */
export function planOrganisationRoll({
  recipe = [], encounter = null, variant = "", context = "wilderness", state = "wandering", unit = "", rng = Math.random,
  rules = {}, leaderSource = "", villageSource = "page", org = {}, library = [], choices = {}, inherit = {}, hdOf = () => null, printedHp = () => null,
} = {}) {
  const findings = [];
  const on = { troops: !!rules.troops, traits: !!rules.traits, gear: !!rules.gear };
  const parts = villageSource === "table" && org.village?.rows?.length ? withTableVillage(recipe, org.village.rows, variant, org.village.cite ?? "") : recipe;

  let shares = null;
  if (on.troops) {
    const f = org.organisation?.figures ?? {};
    const trio = [["archers", "archerShare", "archerRound"], ["warriors", "warriorShare", "warriorRound"], [SPECIAL, "specialShare", "specialRound"]];
    const read = trio.map(([key, share, how]) => ({ key, percent: whole(f[share]), round: f[how] ?? "" }));
    if (read.every((s) => s.percent !== null)) shares = read;
    else findings.push({ what: "split", missing: trio.filter(([, share]) => whole(f[share]) === null).map(([key]) => key) });
  }

  const evaluated = evaluateRecipe({ recipe: parts, encounter, context, state, unit, rng, shares, choices });
  if (!evaluated.ok) return { ok: false, reason: evaluated.reason, lair: evaluated.lair ?? null };
  findings.push(...evaluated.missing.map((m) => ({ what: "missing", ...m })));

  const prototypes = {};
  const protoOf = (spec) => {
    const key = protoKey(spec);
    prototypes[key] ??= { key, ...spec };
    return key;
  };
  const resolved = new Map();
  const outside = (word, why) => {
    const k = unitWord(word);
    if (!resolved.has(k)) {
      const r = resolveOutside(word, library);
      resolved.set(k, r);
      if (r.status !== REFERENCE.resolved) findings.push({ what: "reference", status: r.status, word, why, candidates: r.candidates.map((c) => c.uuid ?? c.name) });
    }
    return resolved.get(k);
  };

  const evalNodes = walk(evaluated.top);
  const parentOf = new Map();
  for (const n of evalNodes) for (const c of n.children) parentOf.set(c.key, n);

  // 3. A troop for each unit the split made special, taken by the units beneath it.
  const troopOf = new Map();
  const troopRows = org.troops?.rows ?? [];
  const specialRoots = evalNodes.filter((n) => n.kind === SPECIAL && parentOf.get(n.key)?.kind !== SPECIAL);
  if (on.troops) {
    for (const n of specialRoots) {
      const hit = rollBanded(troopRows, variant, rng);
      if (!hit.key) findings.push({ what: "gap", table: "troops", unit: n.unit, roll: hit.roll });
      else troopOf.set(n.key, hit.key);
    }
  }
  const troopAt = (n) => {
    for (let at = n; at; at = parentOf.get(at.key)) if (troopOf.has(at.key)) return troopOf.get(at.key);
    return "";
  };
  const troopAbove = (n) => walk(n).map((d) => troopOf.get(d.key)).find(Boolean) ?? "";

  // 4. One trait for a unit that holds units, taken by everything under it.
  let trait = inherit.trait ?? "";
  if (on.traits && inherit.trait === undefined && evaluated.top.children.length) {
    const hit = rollBanded(org.traits?.rows, variant, rng);
    if (hit.key) trait = hit.key;
    else findings.push({ what: "gap", table: "traits", roll: hit.roll });
  }

  const troopRuleOf = (key) => (org.troopRules?.rows ?? []).find((r) => r.key === key)?.figures ?? {};
  const mountOf = (troopKey) => {
    const cell = troopKey ? readMountCell(troopRuleOf(troopKey), variant) : null;
    if (!cell) return null;
    const r = outside(cell.word, "mount");
    const proto = r.status === REFERENCE.resolved ? { kind: "entry", uuid: r.entry.uuid ?? "" } : { kind: "label", label: cell.word };
    return { rides: cell.rides, proto: protoOf(proto) };
  };

  // Build the write plan's nodes.
  let serial = 0;
  const cellProto = (cell, troop, extra = {}) => ({ kind: "cell", variant, role: roleOfCell(cell), partKey: "", troop, trait, grade: "", ...extra });
  const stackOfPart = (p, troop) => {
    const src = p.source ?? {};
    let proto;
    if (p.role === "body") proto = protoOf(cellProto("", troop, { role: "", partKey: p.part }));
    else if (src.uuid) proto = protoOf({ kind: "entry", uuid: src.uuid });
    else if (src.templateCell) proto = protoOf(cellProto(src.templateCell, troop, { partKey: p.part }));
    else if (src.name && p.role !== "captive") {
      const r = outside(src.name, p.part);
      proto = protoOf(r.status === REFERENCE.resolved ? { kind: "entry", uuid: r.entry.uuid ?? "" } : { kind: "label", label: src.name });
    } else proto = protoOf({ kind: "label", label: src.name || p.label || p.part });
    const spec = prototypes[proto];
    const hp = spec.kind === "entry" ? null : printedHp(spec);
    return { proto, label: spec.kind === "label" ? spec.label : p.label, count: p.count, role: p.role, gen: { part: p.part, cite: p.cite ?? "" }, ...(Number.isFinite(hp) ? { fixedHp: hp } : {}), ...(p.chance != null ? { chance: p.chance } : {}) };
  };

  const toNode = (en, parentKey) => {
    const troop = troopAt(en);
    const node = { key: `r${++serial}`, word: en.unit, kind: en.unit, shareKind: en.kind, parentKey, label: "", camp: false, troop, trait, officers: [], stacks: [], children: [], evalKey: en.key };
    for (const l of en.leaders) {
      const cell = l.source?.templateCell ?? "";
      const leaderTroop = troop || troopAbove(en);
      for (let i = 0; i < Math.max(0, l.count); i++) {
        const bonus = l.moraleWhileAlive;
        const inRange = Number.isInteger(bonus) && bonus >= MORALE_BONUS_RANGE[0] && bonus <= MORALE_BONUS_RANGE[1];
        if (bonus != null && !inRange) findings.push({ what: "morale", part: l.part, figure: bonus });
        node.officers.push({
          proto: protoOf(cellProto(cell, leaderTroop, { grade: leaderSource === "table" ? "table" : "", partKey: l.part })),
          part: l.part, cite: l.cite, role: roleOfCell(cell), troop: leaderTroop, moraleBonus: inRange ? bonus : null,
        });
      }
    }
    const camp = [];
    for (const p of en.parts) (p.role === "body" ? node.stacks : camp).push(stackOfPart(p, troop));
    for (const c of en.children) node.children.push(toNode(c, node.key));
    if (camp.length) node.children.push({ key: `r${++serial}`, word: "", kind: "", parentKey: node.key, label: "", camp: true, troop: "", trait, officers: [], stacks: camp, children: [], evalKey: "" });
    return node;
  };
  const top = toNode(evaluated.top, null);
  const nodes = walk(top);

  // 5. Mounts: a mounted unit's bodies ride, and the leader of each unit above it rides.
  if (on.troops) {
    const byKey = new Map(nodes.map((n) => [n.key, n]));
    const rides = new Map();
    for (const n of nodes) {
      const mount = !n.camp && n.troop ? mountOf(n.troop) : null;
      if (!mount) continue;
      if (!mount.rides) {
        findings.push({ what: "alongside", unit: n.word, proto: mount.proto });
        continue;
      }
      for (const s of n.stacks) if (s.role === "body") s.mount = { proto: mount.proto, perBody: 1 };
      for (let at = n; at; at = byKey.get(at.parentKey)) if (!rides.has(at.key)) rides.set(at.key, mount.proto);
    }
    for (const n of nodes) if (rides.has(n.key) && n.officers[0]) n.officers[0].mount = { proto: rides.get(n.key) };
  }

  // The trait's beasts, where the Judge chose which.
  const traitRow = (org.traitRules?.rows ?? []).find((r) => r.key === trait);
  if (trait && traitRow?.figures?.beastDice) {
    const word = String(choices.traitBeast ?? "").trim();
    if (!word) findings.push({ what: "traitBeasts", trait, dice: traitRow.figures.beastDice });
    else {
      const r = outside(word, "traitBeast");
      const count = rollFormula(traitRow.figures.beastDice, rng) ?? 0;
      const proto = protoOf(r.status === REFERENCE.resolved ? { kind: "entry", uuid: r.entry.uuid ?? "" } : { kind: "label", label: word });
      const camp = nodes.find((n) => n.camp) ?? null;
      const stack = { proto, label: word, count, role: "guard", gen: { part: `trait-${trait}`, cite: traitRow.cite ?? "" } };
      if (camp) camp.stacks.push(stack);
      else top.children.push({ key: `r${++serial}`, word: "", kind: "", parentKey: top.key, label: "", camp: true, troop: "", trait, officers: [], stacks: [stack], children: [], evalKey: "" });
    }
  }

  // 6. Gear: who may carry is the equipment table's, by rank and troop; a piece outside it is listed and never rolled onto.
  if (on.gear) {
    const d100 = () => rollDie("1d100", rng);
    for (const row of org.equipment?.rows ?? []) {
      const f = row.figures ?? {};
      const entries = Array.isArray(f.carry) ? f.carry : [];
      for (const n of nodes) {
        const lead = n.officers[0];
        if (lead) {
          const eligible = (f.ranks ?? []).includes(lead.role) && (!(f.troops ?? []).length || (f.troops ?? []).includes(lead.troop));
          (lead.gearEligible ??= []);
          if (eligible) lead.gearEligible.push(row.key);
          else (lead.gearNot ??= []).push(row.key);
          for (const e of entries) {
            if (!eligible || (e.scope && unitWord(e.scope) !== n.word)) continue;
            const hd = e.perHitDie ? whole(hdOf(lead.role)) : 1;
            if (hd === null) {
              findings.push({ what: "hd", gear: row.key, role: lead.role });
              continue;
            }
            if (d100() <= Number(e.pct) * (e.perHitDie ? hd : 1)) (lead.gear ??= []).push(row.key);
          }
        }
        for (const s of n.stacks) {
          const pct = whole(troopRuleOf(n.troop)?.carry?.[row.key]);
          if (s.role !== "body" || pct === null) continue;
          let k = 0;
          for (let i = 0; i < s.count; i++) if (d100() <= pct) k++;
          if (k) (s.carry ??= {})[row.key] = k;
        }
      }
    }
  }

  // 7. Speakers of Common.
  const speech = org.organisation?.figures ?? {};
  const warriorPct = whole(speech.commonWarrior);
  const leaderPerHd = whole(speech.commonLeaderPerHd);
  for (const n of nodes) {
    for (const s of n.stacks) {
      if (s.role !== "body" || warriorPct === null) continue;
      let k = 0;
      for (let i = 0; i < s.count; i++) if (rollDie("1d100", rng) <= warriorPct) k++;
      s.speakers = k;
    }
    for (const o of n.officers) {
      const hd = whole(hdOf(o.role));
      if (leaderPerHd === null || hd === null) continue;
      o.speaksCommon = rollDie("1d100", rng) <= leaderPerHd * hd;
    }
  }

  const gen = { variant, context: evaluated.context, state: evaluated.state, rules: on, leaderSource, villageSource, trait, choices: evaluated.choices };
  return { ok: true, context: evaluated.context, state: evaluated.state, lair: evaluated.lair, treasure: { deal: evaluated.state === "lair" }, top, prototypes, findings, steps: evaluated.steps, gen };
}
