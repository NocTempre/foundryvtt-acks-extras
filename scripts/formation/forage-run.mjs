/* global game, Roll, ChatMessage */
/**
 * Spending the day's hours on the country, and what comes back.
 *
 * [foraging.mjs](./foraging.mjs) prices the throws and owns no dice. This rolls
 * them, and — the part that makes the slots worth picking — deposits what is
 * found so the order can eat it.
 *
 * What is found is written to the FORAGER's own pack, not to a party pool
 * document, because the party pool is already the sum of what the members
 * carry ([provisions.mjs](./provisions.mjs)). Inventing a second store would
 * be a second answer to "how much food is there", and the two would disagree
 * the first time someone dropped a sack.
 */
import { MODULE_ID, RATION_PATTERN } from "./constants.mjs";
import { makeLoc, gmIds } from "./../lib/util.mjs";
import { getMemberActor, realMembers, hasAbility } from "./formation-model.mjs";
import { travelOf } from "./travel.mjs";
import { forageSpec, huntSpec, forageYield, partyThrows, FORAGE_KINDS } from "./foraging.mjs";

const loc = makeLoc("ACKS-FORMATION");

/** Item names the deposit uses. Presentation — the RULES never name an item. */
const DEPOSIT_NAMES = Object.freeze({
  food: "Foraged Food", water: "Foraged Water", firewood: "Firewood", hunt: "Fresh Game",
});

/**
 * Does this yield feed anybody?
 *
 * A yield that states who its weight feeds, or that is already counted in
 * days, is provisions. Anything else is material — firewood is the case, and
 * it is measured in the weight the party has to carry.
 */
function provisioning(yielded) {
  return !!yielded && (yielded.feeds != null || yielded.unit === "days");
}

/** One d20 against a target and its modifier. */
async function throwAgainst(target, modifier = 0) {
  const roll = await new Roll(modifier ? `1d20 + ${modifier}` : "1d20").evaluate();
  return { roll, total: roll.total, beat: roll.total >= target };
}

/**
 * Add days of a provision to an actor's pack.
 *
 * Stacks onto an existing foraged item rather than littering the sheet with
 * one item per successful day.
 */
async function deposit(actor, kind, days) {
  if (!actor || !(days > 0)) return null;
  const name = DEPOSIT_NAMES[kind] ?? DEPOSIT_NAMES.food;
  const existing = actor.items.find((i) => i.name === name);
  if (existing) {
    const now = Number(existing.system?.quantity?.value ?? 0) + days;
    await existing.update({ "system.quantity.value": now });
    return existing;
  }
  const [made] = await actor.createEmbeddedDocuments("Item", [{
    name,
    type: "item",
    system: { quantity: { value: days } },
    flags: { [MODULE_ID]: { foraged: kind } },
  }]);
  return made ?? null;
}

/**
 * Work the country for one day.
 *
 * Water is thrown for the PARTY — once per group, not once per forager — while
 * food and firewood are each forager's own attempt. Hunting is its own throw
 * again. Anything unimported is reported rather than rolled, because a throw
 * against a target nobody supplied is not a throw.
 */
export async function runForageDay(formation, { kinds = ["food"], hunting = false } = {}) {
  if (!game.user?.isGM) return null;
  const t = travelOf(formation);
  const actors = realMembers(formation).map(getMemberActor).filter(Boolean);
  if (!actors.length) return null;
  const survival = actors.some((a) => hasAbility(a, /survival/i));

  const results = [];

  for (const kind of kinds) {
    if (!FORAGE_KINDS[kind]) continue;
    const spec = forageSpec({
      kind, terrain: t.ground, territory: t.territory, survival,
      standingWater: t.following === "river",
    });
    if (!spec.ok) { results.push({ kind, unpriced: spec.missing ?? true }); continue; }

    const yielded = forageYield(kind);
    if (spec.automatic) {
      // Standing water needs no throw: everyone fills what they can carry.
      results.push({ kind, automatic: true, found: yielded?.amount ?? null });
      continue;
    }

    // What a success is worth, and in what. A kind that FEEDS converts its
    // weight into days by how many mouths that weight feeds; firewood does
    // not feed anyone, so its stone stays stone. Reporting fuel in days is how
    // a Judge comes to think the party has a fortnight's food.
    const perThrow = yielded ? yielded.amount * (yielded.feeds ?? 1) : 0;
    const unit = provisioning(yielded) ? "days" : (yielded?.unit ?? null);

    if (spec.perParty) {
      const throws = partyThrows(actors.length);
      let found = 0;
      for (let n = 0; n < throws; n++) {
        const r = await throwAgainst(spec.target, spec.bonus);
        if (r.beat && yielded) found += perThrow;
      }
      if (found > 0) await deposit(actors[0], kind, found);
      results.push({ kind, throws, found, unit, perParty: true });
    } else {
      let found = 0;
      for (const actor of actors) {
        const r = await throwAgainst(spec.target, spec.bonus);
        if (!r.beat || !yielded) continue;
        found += perThrow;
        await deposit(actor, kind, perThrow);
      }
      results.push({ kind, throws: actors.length, found, unit });
    }
  }

  if (hunting) {
    const spec = huntSpec({ territory: t.territory });
    if (!spec.ok) results.push({ kind: "hunt", unpriced: spec.missing });
    else {
      const yielded = forageYield("food");
      let found = 0;
      for (const actor of actors) {
        const r = await throwAgainst(spec.target, spec.bonus);
        if (!r.beat || !yielded) continue;
        const days = yielded.amount * (yielded.feeds ?? 1);
        found += days;
        await deposit(actor, "hunt", days);
      }
      results.push({ kind: "hunt", throws: actors.length, found, territory: spec.territory });
    }
  }

  await whisperForage(results);
  return results;
}

/** What the day's work turned up, for the Judge. */
async function whisperForage(results) {
  const lines = results.map((r) => {
    const label = game.i18n.localize(FORAGE_KINDS[r.kind]?.label ?? "ACKS-FORMATION.travel.activity.hunt");
    if (r.unpriced) return loc("forageRun.unpriced", { kind: label });
    if (r.automatic) return loc("forageRun.automatic", { kind: label });
    if (!(r.found > 0)) return loc("forageRun.nothing", { kind: label, throws: r.throws });
    const amount = Math.round(r.found * 10) / 10;
    return r.unit === "days"
      ? loc("forageRun.found", { kind: label, days: amount, throws: r.throws })
      : loc("forageRun.foundStone", { kind: label, amount, throws: r.throws });
  });
  if (!lines.length) return;
  await ChatMessage.create({
    speaker: { alias: loc("forageRun.speaker") },
    whisper: gmIds(),
    content: `<div class="acks-extras-forage-card"><h3>${loc("forageRun.title")}</h3>`
      + `<ul>${lines.map((l) => `<li>${l}</li>`).join("")}</ul></div>`,
  });
}

/** Items this feature deposited, for a caller that wants to clean up. */
export function foragedItems(actor) {
  return (actor?.items ?? []).filter((i) => i.getFlag?.(MODULE_ID, "foraged"));
}

/** Rations pattern re-export, so callers need not reach into constants. */
export { RATION_PATTERN };
