/* global game, fromUuid, fromUuidSync, Hooks, Roll, Item, ChatMessage */
/**
 * What a research project's Finish writes in the live world (`research-project.mjs` `finish` is the model and
 * decides the order; this is the half that touches documents): the natural die, the researcher's formulas, the
 * components bucket's rows, the result written by kind and the card.
 *
 * - a known item reaches the researcher through lib's `deliverDrop`, a known spell joins their repertoire
 *   (`spellPayload`, skipped where they already carry it) and an identification marks the item fully identified
 *   through `markIdentified` and lifts its mask as the markets' own identification does;
 * - a subject no document answers to (a novel spell or item) becomes a blank document filled with what the project
 *   knows (its name, picture and a spell's level), opened for the Judge to finish;
 * - the formula is recorded on the researcher, `flags["acks-extras"].magic.formulas` (`cleanFormulas`), and is
 *   read by the next project for the same subject (`formulasOf`);
 * - the bucket is settled by lib (`settlementPlan` decides, `applySettlement` writes) and a power row is spent from
 *   the researcher's ledger (`acksExtras.magic.power.settle`);
 * - the result is one card through lib's `renderRollCard`, naming the throw's parts and what was written.
 *
 * Every heavy import is taken where it is used, so the model's suites load this file without the world.
 */
import { MODULE_ID, LANG_PREFIX, FLAG_MAGIC } from "./constants.mjs";
import { FORMULAS_KEY, PROJECT_KIND, powerRowFit, componentPolicy, cleanFormulas, withFormula, subjectFits } from "./research-project.mjs";
import { kindOfRow, POWER_ROW_PREFIX } from "./power-ledger.mjs";
import { cookbookId } from "../lib/library.mjs";

/** A string of the research lang group. */
const loc = (key, data) => game.i18n.format(`${LANG_PREFIX}.research.${key}`, data ?? {});

/** A document of a uuid that resolves now, else null; a uuid into an unloaded pack throws. */
function resolve(uuid) {
  try {
    return uuid ? fromUuidSync(uuid) : null;
  } catch {
    return null;
  }
}

/** A document of a uuid, loading a compendium's if need be; null for none. */
const resolveAsync = (uuid) => (uuid ? fromUuid(uuid).catch(() => null) : Promise.resolve(null));

/** A researcher's recorded formulas, cleaned. */
export const formulasOf = (uuid) => cleanFormulas(resolve(uuid)?.flags?.[MODULE_ID]?.[FLAG_MAGIC]?.[FORMULAS_KEY]);

/** A subject's cookbook id, "" where the document has none or does not resolve. */
export const cookbookOf = (uuid) => cookbookId(resolve(uuid));

/** The type of a subject's document, null where it names none that resolves. */
export const subjectTypeOf = (uuid) => resolve(uuid)?.type ?? null;

/**
 * The components bucket of a project as lib entries, valued and fitted by the project's policy: each stored row's
 * document read again, then the power rows (a row names no document; it is read from the researcher's ledger, held
 * to the balance, and is matched unless the stored row says otherwise: power is no substitute, so it takes no
 * penalty and does not turn the formula off).
 */
export async function projectEntries(project) {
  const { entriesFromAnswer } = await import("../lib/bucket.mjs");
  const policy = componentPolicy(project);
  const docs = (await entriesFromAnswer(project.bucket, resolveAsync, { policy })).entries;
  const { powerApi } = await import("./power-ledger-live.mjs");
  const actor = resolve(project.researcher);
  const powers = [];
  for (const row of project.bucket) {
    const kind = kindOfRow(row.uuid);
    const entry = kind && actor ? powerApi.row(actor, kind, { amount: row.qty, fit: powerRowFit(row.fit) }) : null;
    if (entry) powers.push(entry);
  }
  return [...docs, ...powers];
}

/** The spell or item a known subject names, and the researcher who is to have it. */
async function parties(project) {
  return { doc: await resolveAsync(project.subject.uuid), actor: resolve(project.researcher) };
}

/** The writers and the card, in the shape `projectOps`'s `deps.outcome` takes. */
export function outcomeDeps() {
  return {
    subject: async (project) => {
      const doc = await resolveAsync(project.subject.uuid);
      return doc?.documentName === "Item" ? { type: doc.type, cookbookId: cookbookId(doc) } : null;
    },
    entries: projectEntries,
    formulas: async (uuid) => formulasOf(uuid),
    /** The natural die, rolled here; the roll rides on to the card. */
    roll: async (formula) => {
      const roll = await new Roll(formula).evaluate();
      return { die: roll.total, roll };
    },
    deliver: async (project) => {
      const { doc, actor } = await parties(project);
      const { deliverDrop } = await import("../lib/bundles.mjs");
      const got = await deliverDrop(actor, doc);
      return { name: doc.name, actor: actor.name, ids: [...got.created, ...got.updated].map((i) => i.id) };
    },
    addSpell: async (project) => {
      const { doc, actor } = await parties(project);
      const { foldName } = await import("../lib/spell-sources.mjs");
      const held = [...actor.items].some((i) => i.type === doc.type && foldName(i.name) === foldName(doc.name));
      if (held) return { name: doc.name, actor: actor.name, held: true };
      const { spellPayload } = await import("./repertoire.mjs");
      const made = await actor.createEmbeddedDocuments("Item", [spellPayload(doc)]);
      return { name: doc.name, actor: actor.name, ids: (made ?? []).map((i) => i.id) };
    },
    identify: async (project) => {
      const { doc, actor } = await parties(project);
      const { markIdentified } = await import("../lib/item-model.mjs");
      const { ITEM_FLAG, HOOKS } = await import("../markets/constants.mjs");
      await doc.setFlag(MODULE_ID, ITEM_FLAG, markIdentified(doc.getFlag(MODULE_ID, ITEM_FLAG) ?? {}, "full"));
      // The markets' own listener lifts the item's mask on the client that wrote the mark.
      // hook-ok: HOOKS.IDENTIFIED is the markets' namespaced constant, imported dynamically so the check cannot follow it.
      Hooks.callAll(HOOKS.IDENTIFIED, { item: doc, identifier: actor, method: "research", depth: "full" });
      return { name: doc.name };
    },
    blank: async (project) => {
      const spell = project.kind === PROJECT_KIND.spell;
      const data = { name: project.subject.name || loc(`kind.${project.kind}`), type: spell ? "spell" : "item" };
      if (project.subject.img) data.img = project.subject.img;
      if (spell && project.level !== null) data.system = { lvl: project.level };
      const item = await Item.create(data);
      // The Judge finishes it: the sheet opens on a Judge's client, which is where a document is made for a Player's project.
      if (game.user.isGM) item.sheet?.render({ force: true });
      return { uuid: item.uuid, name: item.name };
    },
    recordFormula: async (project, entry) => {
      const actor = resolve(project.researcher);
      const entries = withFormula(formulasOf(project.researcher), { kind: project.kind, name: project.subject.name, project: project.id, ...entry });
      await actor.update({ [`flags.${MODULE_ID}.${FLAG_MAGIC}.${FORMULAS_KEY}`]: entries });
      return { name: project.subject.name, actor: actor.name };
    },
    /** Apply the settlement and spend what it handed back for a power row from the researcher's ledger. */
    settle: async (project, plan) => {
      const { applySettlement } = await import("../lib/bucket-apply.mjs");
      const done = await applySettlement(plan, resolveAsync);
      const { powerApi } = await import("./power-ledger-live.mjs");
      const actor = resolve(project.researcher);
      const power = [];
      for (const step of done.handed) {
        if (!String(step.uuid).startsWith(POWER_ROW_PREFIX)) continue;
        power.push(await powerApi.settle(actor, step, { name: loc("card.title", { name: project.subject.name }), ref: project.id }));
      }
      return { spent: done.spent.length, marked: done.marked.length, gone: done.gone.length, failed: done.failed.length, power };
    },
    /** The outcome as one card through lib's roll card, posted to everyone who sees the researcher's rolls. */
    card: async ({ project, plan, result, rolled, written, failed, settled, made }) => {
      const { renderRollCard } = await import("../lib/roll-card.mjs");
      const actor = resolve(project.researcher);
      const name = project.subject.name || loc(`kind.${project.kind}`);
      const modifier = plan.modifier;
      const signed = (n) => (n >= 0 ? `+${n}` : String(n));
      // A Finish with no throw names why and carries no die, total or target.
      const parts = result.noThrow ? [result.noThrow === "formula" ? loc("throwPartFormula") : loc("throwPartCommon")] : [
        plan.levelRaise ? loc("throwPartLevel", { n: plan.levelRaise }) : "",
        plan.int !== null ? loc("throwPartInt", { n: signed(plan.int) }) : "",
        plan.bonusRead ? loc("throwPartBonus", { n: plan.bonus }) : "",
        plan.substituted && plan.penalty !== null ? loc("throwPartPenalty", { n: plan.penalty, cite: loc("cite.prose") }) : "",
        plan.formula.known ? (plan.formula.used ? loc("throwPartFormula") : loc("throwPartFormulaOff")) : "",
      ].filter(Boolean);
      const lines = [];
      if (result.auto) lines.push(loc("card.auto", { cite: loc("cite.prose") }));
      for (const w of written) {
        if (w.what === "identify") lines.push(loc("card.identified", { name: w.name }));
        else if (w.what === "spell") lines.push(w.held ? loc("card.spellHeld", { name: w.name, actor: w.actor }) : loc("card.spellAdded", { name: w.name, actor: w.actor }));
        else if (w.what === "item") lines.push(loc("card.itemDelivered", { name: w.name, actor: w.actor }));
        else if (w.what === "blank") lines.push(loc("card.blank", { name: w.name }));
        else if (w.what === "formula") lines.push(loc("card.formula", { name: w.name, actor: w.actor }));
      }
      if (settled && (settled.spent || settled.marked || settled.power.some((p) => p?.ok))) lines.push(loc("card.settled", { spent: settled.spent + settled.power.filter((p) => p?.ok).length, marked: settled.marked }));
      for (const f of failed) lines.push(loc("card.failed", { what: loc(`card.what.${f.what}`) }));
      const outcome = { outcome: result.success ? loc("card.success") : loc("card.failure"), emphasis: result.success ? "success" : "failure" };
      const row = result.noThrow
        ? { name: actor?.name ?? "", total: "", detail: parts.join(" · "), ...outcome }
        : {
            name: actor?.name ?? "",
            total: result.total,
            target: result.target,
            targetSuffix: "+",
            targetTooltip: plan.by === "hand" ? loc("throwTipHand") : loc("throwTip", { cite: loc("cite.ladder") }),
            detail: parts.join(" · "),
            tooltipText: loc("card.dieTip", { die: result.die, modifier: modifier >= 0 ? `+${modifier}` : String(modifier) }),
            ...outcome,
          };
      const content = renderRollCard({ title: loc("card.title", { name }), subtitle: loc(`kind.${project.kind}`), sections: [{ rows: [row] }], footnote: lines.join(" ") || undefined });
      await ChatMessage.create({ content, rolls: rolled?.roll ? [rolled.roll] : [], speaker: actor ? ChatMessage.getSpeaker({ actor }) : undefined });
      return made;
    },
  };
}

/**
 * Whether this seat may write everything a Finish touches: a Judge always, anyone else only where Foundry lets them
 * modify the location, the researcher, every component (a deletion), and the subject an identification marks, and the
 * result makes no document (a novel spell or item is made on a Judge's client).
 */
export function canFinish(location, id) {
  if (game.user.isGM) return true;
  const project = (location?.flags?.[MODULE_ID]?.[FLAG_MAGIC]?.projects ?? []).find((p) => p?.id === id);
  if (!project) return false;
  const may = (doc, action) => doc?.canUserModify?.(game.user, action) === true;
  const subject = resolve(project.subject?.uuid);
  if (project.kind !== PROJECT_KIND.identify && (!subject || !subjectFits(project.kind, subject.type))) return false;
  if (!may(location, "update") || !may(resolve(project.researcher), "update")) return false;
  if (project.kind === PROJECT_KIND.identify && !may(subject, "update")) return false;
  return (project.bucket ?? []).filter((row) => !kindOfRow(row.uuid)).every((row) => may(resolve(row.uuid), "delete"));
}
