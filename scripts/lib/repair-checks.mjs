/* global game, fromUuid, foundry, Item, CONFIG, fetch, AbortController */
/**
 * The repair checks lib owns: records the system stamped as migrated while
 * keeping their old field names, bundles embedded where no sheet lists them,
 * carry links to actors that are gone, a weapon's two-handed die that
 * disagrees with its imported row, images whose file the server no longer has,
 * and the coin of actors a package no longer installed left unloadable. The
 * stranded-coin check reports only: it lists what it finds and writes nothing.
 */
import { MODULE_ID, LANG_PREFIX } from "./constants.mjs";
import { makeLoc } from "./util.mjs";
import { ITEM_TYPE } from "./vocab.mjs";
import { danglingRefCheck, fixEach, registerRepairCheck, worldActors } from "./repair.mjs";
import { resolveBundleRow, unpackEmbeddedBundle } from "./bundles.mjs";
import { bundleRows, unpackStage } from "./bundles-logic.mjs";
import { ATTACH_FLAG, ATTACH_ROLES, attachmentOf } from "./attachment.mjs";
import { resolveActorSync } from "./storage.mjs";
import { isLegacyChangeKey, migrateChangeKey } from "./actor-compat.mjs";
import { forgetRescue, rescuedFields } from "./patches/legacy-source.mjs";
import { distinctPaths, missingPaths, planRepair } from "./missing-images.mjs";

const loc = makeLoc(LANG_PREFIX);
const key = (name) => `${LANG_PREFIX}.repair.check.${name}`;

/** Whether the package a sub-type names is active, installed but off, or absent. */
function packageState(type) {
  const ns = String(type ?? "").includes(".") ? String(type).split(".")[0] : null;
  if (!ns) return { ns: null, state: "core", title: "" };
  if (game.system?.id === ns) return { ns, state: "active", title: game.system.title };
  const mod = game.modules?.get(ns);
  if (!mod) return { ns, state: "absent", title: ns };
  return { ns, state: mod.active ? "active" : "disabled", title: mod.title ?? ns };
}

/** The raw source of every document an embedded collection could not load. */
function invalidSources(collection) {
  const out = [];
  for (const id of collection?.invalidDocumentIds ?? []) {
    let src = null;
    try {
      src = collection.getInvalid(id, { strict: false })?.toObject?.() ?? null;
    } catch {
      src = null;
    }
    out.push({ id, src });
  }
  return out;
}

/**
 * An actor's coin as the raw source holds it: `{rows, text}`, over the money
 * rows that count more than nothing. A row's count and its banked figure are
 * added: the sweep that moves a banked figure into a vault reaches loaded
 * documents only, so on a source that does not load the banked figure is
 * still coin the actor is owed.
 */
function strandedCoin(src) {
  const count = (i) => (Number(i.system?.quantity) || 0) + (Number(i.system?.quantitybank) || 0);
  const coin = (Array.isArray(src?.items) ? src.items : []).filter((i) => i?.type === ITEM_TYPE.money && count(i) > 0);
  return { rows: coin.length, text: coin.map((i) => `${count(i)} × ${i.name ?? "?"}`).join(", ") };
}

/** Every effect a world actor or its items carry, labelled as the findings print them. */
function* actorEffects() {
  for (const actor of worldActors()) {
    for (const fx of actor.effects ?? []) yield [fx, `${actor.name} → ${fx.name}`];
    for (const item of actor.items ?? []) {
      for (const fx of item.effects ?? []) yield [fx, `${actor.name} → ${item.name} → ${fx.name}`];
    }
  }
  for (const item of game.items ?? []) {
    for (const fx of item.effects ?? []) yield [fx, `${item.name} → ${fx.name}`];
  }
}

/** Rewrite an effect's changes from the system's earlier field names; a key with no counterpart stays. */
async function rewriteLegacyChanges(fx) {
  const changes = (fx.changes ?? []).map((c) => {
    const key = migrateChangeKey(c.key);
    return key ? { ...c, key } : c;
  });
  await fx.update({ changes });
}

/**
 * Every world document the stamped-record rescue read back at load, with the
 * fields it read: the world's actors and their items, then the world's items.
 * An unlinked token's actor is left out: its record is the base actor's, plus
 * a delta the base actor's fix does not need.
 */
function* stampedDocs() {
  for (const actor of game.actors ?? []) {
    const filled = rescuedFields(actor._source?.system);
    if (filled) yield { doc: actor, parent: null, fields: filled, name: actor.name };
    for (const item of actor.items ?? []) {
      const fields = rescuedFields(item._source?.system);
      if (fields) yield { doc: item, parent: actor, fields, name: `${actor.name} → ${item.name}` };
    }
  }
  for (const item of game.items ?? []) {
    const fields = rescuedFields(item._source?.system);
    if (fields) yield { doc: item, parent: null, fields, name: item.name };
  }
}

/**
 * Write each rescued record whole as it loads, an actor's items in one call
 * per actor. The write is not diffed, since the documents already hold these
 * values, and it replaces `system` rather than merging into it: a deletion of
 * a key the schema does not declare is cleaned out of a change set before it
 * is sent, so the old names leave the record only when `system` is replaced.
 * Each rescue is forgotten once its write lands, since the record now stores
 * what the document shows.
 */
async function writeStampedRecords(findings) {
  const wanted = new Set(findings.map((f) => f.key));
  const batches = new Map();
  for (const entry of stampedDocs()) {
    if (!wanted.has(entry.doc.uuid)) continue;
    const owner = entry.doc.documentName === "Actor" ? entry.doc : entry.parent;
    const slot = owner?.uuid ?? "world";
    if (!batches.has(slot)) batches.set(slot, { owner, actor: null, items: [] });
    if (entry.doc.documentName === "Actor") batches.get(slot).actor = entry;
    else batches.get(slot).items.push(entry);
  }
  const results = [];
  const settle = (entries, error) => {
    for (const e of entries) {
      if (!error) forgetRescue(e.doc._source.system);
      results.push(error ? { key: e.doc.uuid, ok: false, error } : { key: e.doc.uuid, ok: true });
    }
  };
  // A fresh object per call: core writes the parent into the operation it is
  // handed, and a reused one sends the next batch to the last one's actor.
  const whole = () => ({ diff: false, recursive: false });
  const system = (doc) => foundry.utils.deepClone(doc._source.system);
  for (const { owner, actor, items } of batches.values()) {
    if (actor) {
      try {
        await actor.doc.update({ system: system(actor.doc) }, whole());
        settle([actor], null);
      } catch (err) {
        settle([actor], String(err?.message ?? err));
      }
    }
    if (!items.length) continue;
    const rows = items.map((e) => ({ _id: e.doc.id, system: system(e.doc) }));
    try {
      if (owner) await owner.updateEmbeddedDocuments("Item", rows, whole());
      else await Item.implementation.updateDocuments(rows, whole());
      settle(items, null);
    } catch (err) {
      settle(items, String(err?.message ?? err));
    }
  }
  return results;
}

/**
 * The two-handed die a weapon's imported row names, read off the modes the
 * importer stamped on the item from the Judge's own page: the die of the mode
 * held two-handed, `""` when the row names none, and null when the item
 * carries no imported row at all.
 */
function rowTwoHandedDie(item) {
  const modes = item?.flags?.[MODULE_ID]?.weapon?.modes;
  if (!Array.isArray(modes) || !modes.length) return null;
  return String(modes.find((m) => m?.grip === "two-handed" && m.damage)?.damage ?? "");
}

/** A die with its spacing and case folded away, so two spellings of one die agree. */
const foldDie = (die) => String(die ?? "").replace(/\s+/g, "").toLowerCase();

/**
 * Every weapon the two-handed-die check reads, labelled as it prints them: the
 * world's actors' items, then the world's items. An unlinked token's actor is
 * left out, as `stampedDocs` leaves it, since its record is the base actor's
 * plus a delta.
 */
function* weaponDocs() {
  for (const actor of game.actors ?? []) {
    for (const item of actor.items ?? []) {
      if (item.type === ITEM_TYPE.weapon) yield { item, name: `${actor.name} → ${item.name}` };
    }
  }
  for (const item of game.items ?? []) {
    if (item.type === ITEM_TYPE.weapon) yield { item, name: item.name };
  }
}

/**
 * Every weapon whose stored alternate die differs from the one its imported
 * row names. The finding carries the die to write (`want`, `""` for none). A
 * weapon the stamped-record rescue is still holding is listed and not offered:
 * its stored `damage` is not yet the object the loaded source shows, and a
 * change set merged into it would replace the base die.
 */
function twoHandedFindings() {
  const none = loc("repair.check.twoHandedRow.none");
  const out = [];
  for (const { item, name } of weaponDocs()) {
    const row = rowTwoHandedDie(item);
    if (row == null) continue;
    const stored = String(item.system?.damage?.alternate?.formula ?? "").trim();
    if (foldDie(stored) === foldDie(row)) continue;
    out.push({
      key: item.uuid,
      uuid: item.uuid,
      name,
      want: row,
      detail: loc("repair.check.twoHandedRow.detail", { stored: stored || none, row: row || none }),
      ...(rescuedFields(item._source?.system) ? { fixable: false, reason: loc("repair.check.twoHandedRow.stampedFirst") } : {}),
    });
  }
  return out;
}

/**
 * Every world document the missing-image check reads, as `{kind, doc, name,
 * source, ownerImg?}`: the world's actors with their items and effects, the
 * world's items with their effects, macros, roll tables with their results,
 * journal pages, and every scene with its levels and tokens. An unlinked token's synthetic actor is left out, as in
 * `stampedDocs`: its art is the token's own field. A scene token carries its
 * base actor's image, the default its own art falls back to.
 */
function* imageDocs() {
  const effectsOf = (owner, label) => [...(owner.effects ?? [])].map((fx) => ({ kind: "ActiveEffect", doc: fx, name: `${label} → ${fx.name}`, source: fx._source }));
  for (const actor of game.actors ?? []) {
    yield { kind: "Actor", doc: actor, name: actor.name, source: actor._source };
    yield* effectsOf(actor, actor.name);
    for (const item of actor.items ?? []) {
      const label = `${actor.name} → ${item.name}`;
      yield { kind: "Item", doc: item, name: label, source: item._source };
      yield* effectsOf(item, label);
    }
  }
  for (const item of game.items ?? []) {
    yield { kind: "Item", doc: item, name: item.name, source: item._source };
    yield* effectsOf(item, item.name);
  }
  for (const macro of game.macros ?? []) yield { kind: "Macro", doc: macro, name: macro.name, source: macro._source };
  for (const table of game.tables ?? []) {
    yield { kind: "RollTable", doc: table, name: table.name, source: table._source };
    for (const result of table.results ?? []) {
      yield { kind: "TableResult", doc: result, name: `${table.name} → ${result.name || result.id}`, source: result._source };
    }
  }
  for (const entry of game.journal ?? []) {
    for (const page of entry.pages ?? []) {
      yield { kind: "JournalEntryPage", doc: page, name: `${entry.name} → ${page.name}`, source: page._source };
    }
  }
  for (const scene of game.scenes ?? []) {
    yield { kind: "Scene", doc: scene, name: scene.name, source: scene._source };
    for (const level of scene.levels ?? []) {
      yield { kind: "Level", doc: level, name: `${scene.name} → ${level.name}`, source: level._source };
    }
    for (const token of scene.tokens ?? []) {
      yield { kind: "Token", doc: token, name: `${scene.name} → ${token.name}`, source: token._source, ownerImg: token.baseActor?._source?.img };
    }
  }
}

/** The default image of a document kind: its class's `DEFAULT_ICON`, or null (a scene, level, journal page or table result has none). */
const defaultImage = (kind) => CONFIG[kind]?.documentClass?.DEFAULT_ICON ?? null;

/** Longest a probe waits for the server before the path counts as unknown. */
const PROBE_TIMEOUT_MS = 10000;

/**
 * Ask the server whether a local file is there. One HEAD request per distinct
 * path is the whole cost: it moves no image bytes, works for the world, module
 * and system trees alike, and needs no file-browsing permission, which a
 * directory listing through the file picker would (and it would list one
 * source at a time). Only a 404 or 410 answers false; any other failure,
 * a timeout included, answers null, so an unreachable server never reports
 * every image missing.
 * @returns {Promise<boolean|null>}
 */
async function probeImage(path) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(foundry.utils.getRoute(path), { method: "HEAD", signal: ctl.signal });
    if (res.status === 404 || res.status === 410) return false;
    return res.ok ? true : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Every world document whose image names a local file the server answers
 * not-found for. The finding carries the change set to write (`update`); a
 * document of a kind with no default image (a scene's thumbnail and level
 * images, a journal page's file, a roll-table result's image) is listed and
 * not offered.
 */
async function missingImageFindings() {
  const docs = [...imageDocs()];
  const missing = await missingPaths(distinctPaths(docs), probeImage);
  if (!missing.size) return [];
  const out = [];
  for (const entry of docs) {
    const plan = planRepair(entry, missing, defaultImage);
    if (!plan) continue;
    out.push({
      key: entry.doc.uuid,
      uuid: entry.doc.uuid,
      name: entry.name,
      update: plan.update,
      detail: loc("repair.check.missingImages.detail", { paths: plan.paths.join(", ") }),
      ...(plan.update ? {} : { fixable: false, reason: loc("repair.check.missingImages.noDefault") }),
    });
  }
  return out;
}

/** Registers lib's checks. Called once, at `init`. */
export function registerLibRepairChecks() {
  registerRepairCheck({
    id: "lib.stampedRecords",
    label: key("stampedRecords.label"),
    hint: key("stampedRecords.hint"),
    order: 5,
    scan: () => [...stampedDocs()].map(({ doc, name, fields }) => ({
      key: doc.uuid,
      uuid: doc.uuid,
      name,
      detail: loc("repair.check.stampedRecords.detail", { fields: fields.join(", ") }),
    })),
    fix: writeStampedRecords,
  });

  registerRepairCheck({
    id: "lib.twoHandedRow",
    label: key("twoHandedRow.label"),
    hint: key("twoHandedRow.hint"),
    order: 6,
    scan: twoHandedFindings,
    fix: (findings) =>
      fixEach(findings, async (f) => {
        const item = await fromUuid(f.uuid);
        if (!item) throw new Error(loc("repair.subjectGone"));
        await item.update({ "system.damage.alternate.formula": f.want });
      }),
  });

  registerRepairCheck({
    id: "lib.missingImages",
    label: key("missingImages.label"),
    hint: key("missingImages.hint"),
    order: 7,
    scan: missingImageFindings,
    fix: (findings) =>
      fixEach(findings, async (f) => {
        const doc = await fromUuid(f.uuid);
        if (!doc) throw new Error(loc("repair.subjectGone"));
        await doc.update(f.update);
        return loc("repair.check.missingImages.done");
      }),
  });

  registerRepairCheck({
    id: "lib.embeddedBundles",
    label: key("embeddedBundles.label"),
    hint: key("embeddedBundles.hint"),
    order: 10,
    scan: async () => {
      const out = [];
      for (const actor of worldActors()) {
        const held = actor.items.map((i) => i.toObject());
        for (const bundle of actor.items.filter((i) => i.type === ITEM_TYPE.bundle)) {
          const plain = bundle.toObject();
          const stage = unpackStage(plain, held);
          const missing = [];
          if (stage === "fresh") {
            for (const row of bundleRows(plain)) if (!(await resolveBundleRow(row))) missing.push(row.name || row.uuid);
          }
          const shape = stage !== "fresh" ? "partial" : "other";
          out.push({
            key: bundle.uuid,
            uuid: bundle.uuid,
            name: `${actor.name}: ${bundle.name}`,
            detail: loc(`repair.check.embeddedBundles.${shape}`, { rows: bundleRows(plain).length }),
            fixable: !missing.length,
            reason: missing.length ? loc("repair.check.embeddedBundles.missing", { rows: missing.join(", ") }) : null,
          });
        }
      }
      return out;
    },
    fix: (findings) =>
      fixEach(findings, async (f) => {
        const bundle = await fromUuid(f.uuid);
        if (!bundle) return null;
        const done = await unpackEmbeddedBundle(bundle);
        if (!done.ok) throw new Error(loc("repair.check.embeddedBundles.missing", { rows: done.missing.join(", ") }));
        return loc("repair.check.embeddedBundles.done", { count: done.created.length });
      }),
  });

  registerRepairCheck(
    danglingRefCheck({
      id: "lib.attachments",
      label: key("attachments.label"),
      hint: key("attachments.hint"),
      order: 20,
      collect: () =>
        worldActors()
          .map((a) => [a, attachmentOf(a)])
          .filter(([, at]) => at)
          .map(([a, at]) => ({
            key: a.uuid,
            uuid: a.uuid,
            name: a.name,
            ref: at.uuid,
            detail: loc("repair.check.attachments.detail", { role: game.i18n.localize(ATTACH_ROLES[at.role].label) }),
          })),
      live: (c) => !!resolveActorSync(c.ref),
      clear: async (f) => (await fromUuid(f.uuid))?.unsetFlag(MODULE_ID, ATTACH_FLAG),
    })
  );

  registerRepairCheck({
    id: "lib.legacyEffectKeys",
    label: key("legacyEffectKeys.label"),
    hint: key("legacyEffectKeys.hint"),
    order: 35,
    scan: () => {
      const out = [];
      for (const [fx, label] of actorEffects()) {
        const legacy = (fx.changes ?? []).map((c) => String(c.key ?? "")).filter(isLegacyChangeKey);
        if (!legacy.length) continue;
        const fixable = legacy.filter((k) => migrateChangeKey(k));
        const stuck = legacy.filter((k) => !migrateChangeKey(k));
        out.push({
          key: `effect:${fx.uuid}`,
          uuid: fx.uuid,
          name: label,
          detail: loc("repair.check.legacyEffectKeys.detail", { keys: legacy.join(", ") }),
          // A finding with nothing to rewrite is listed only: it declares
          // itself unfixable, or the window offers a Fix that reports failure.
          ...(fixable.length ? {} : { fixable: false, reason: loc("repair.check.legacyEffectKeys.noCounterpart", { keys: stuck.join(", ") }) }),
        });
      }
      return out;
    },
    fix: (findings) => fixEach(findings, async (f) => rewriteLegacyChanges(await fromUuid(f.uuid))),
  });

  registerRepairCheck({
    id: "lib.strandedCoin",
    label: key("strandedCoin.label"),
    hint: key("strandedCoin.hint"),
    order: 40,
    scan: () => {
      const out = [];
      for (const { id, src } of invalidSources(game.actors)) {
        const pkg = packageState(src?.type);
        if (pkg.state !== "absent" && pkg.state !== "disabled") continue;
        const coin = strandedCoin(src);
        if (!coin.rows) continue;
        out.push({
          key: `Actor.${id}`,
          uuid: null,
          name: src?.name ?? id,
          detail: loc("repair.check.strandedCoin.detail", { type: src?.type ?? "?", coin: coin.text }),
          reason: pkg.state === "disabled" ?loc("repair.enablePackage", { title: pkg.title }) : loc("repair.check.strandedCoin.reportOnly"),
        });
      }
      return out;
    },
  });
}
