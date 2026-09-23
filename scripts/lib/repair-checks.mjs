/* global game, fromUuid */
/**
 * The repair checks lib owns: bundles embedded where no sheet lists them,
 * carry and mount links to actors that are gone, and what packages no longer
 * installed left in the world. The two invalid-document checks report only:
 * they list what they find and write nothing.
 */
import { MODULE_ID, LANG_PREFIX } from "./constants.mjs";
import { makeLoc } from "./util.mjs";
import { ITEM_TYPE } from "./vocab.mjs";
import { danglingRefCheck, fixEach, registerRepairCheck, worldActors } from "./repair.mjs";
import { resolveBundleRow, unpackEmbeddedBundle } from "./bundles.mjs";
import { bundleRows, isPurchaseBundle, unpackStage } from "./bundles-logic.mjs";
import { ATTACH_FLAG, ATTACH_ROLES, attachmentOf } from "./attachment.mjs";
import { MOUNT_FLAG, RIDER_FLAG } from "./mount.mjs";
import { resolveActorSync } from "./storage.mjs";

const loc = makeLoc(LANG_PREFIX);
const key = (name) => `${LANG_PREFIX}.repair.check.${name}`;

/**
 * The acks-* modules the merge retired, and the patterns their residue matches.
 * The cleaner macro carries the same list: a macro cannot import.
 */
const OLD_MODULES = Object.freeze([
  "acks-lib", "acks-abilities", "acks-equipment", "acks-formation",
  "acks-henchmen", "acks-influence", "acks-location", "acks-monsters", "acks-content",
]);
const OLD_TYPE = /^acks-(lib|abilities|equipment|formation|henchmen|influence|location|monsters|content)\./;
const OLD_CHANGE_KEY = /^flags\.acks-(lib|abilities|equipment|formation|henchmen|influence|location|monsters|content)\./;

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

/** An actor's coin as the raw source holds it: `{rows, text}`. */
function strandedCoin(src) {
  const coin = (Array.isArray(src?.items) ? src.items : []).filter((i) => i?.type === ITEM_TYPE.money);
  const count = (i) => (Number(i.system?.quantity) || 0) + (Number(i.system?.quantitybank) || 0);
  return { rows: coin.length, text: coin.map((i) => `${count(i)} × ${i.name ?? "?"}`).join(", ") };
}

/** Every document the cleaner walks, labelled as it prints them. */
function* residueDocs() {
  for (const a of game.actors) {
    yield [a, a.name];
    for (const i of a.items) yield [i, `${a.name} → ${i.name}`];
  }
  for (const i of game.items) yield [i, i.name];
  for (const j of game.journal) yield [j, j.name];
  for (const t of game.tables) yield [t, t.name];
  for (const s of game.scenes) {
    yield [s, s.name];
    for (const tk of s.tokens) yield [tk, `${s.name} → ${tk.name}`];
  }
}

/** Old flag scopes on one document, and old change keys and scopes on its effects. */
function residueOn(doc, label, out) {
  const scopes = OLD_MODULES.filter((s) => doc.flags?.[s] !== undefined);
  if (scopes.length) out.push({ key: `flags:${doc.uuid}`, uuid: doc.uuid, name: label, detail: loc("repair.check.mergeResidue.flags", { scopes: scopes.join(", ") }) });
  const sheet = doc.flags?.core?.sheetClass;
  if (typeof sheet === "string" && OLD_MODULES.some((s) => sheet.startsWith(`${s}.`))) {
    out.push({ key: `sheet:${doc.uuid}`, uuid: doc.uuid, name: label, detail: loc("repair.check.mergeResidue.sheet", { sheet }) });
  }
  for (const fx of doc.effects ?? []) {
    const fxLabel = `${label} → ${fx.name}`;
    const bad = (fx.changes ?? []).map((c) => String(c.key ?? "")).filter((k) => OLD_CHANGE_KEY.test(k));
    if (bad.length) out.push({ key: `effect:${fx.uuid}`, uuid: fx.uuid, name: fxLabel, detail: loc("repair.check.mergeResidue.changeKeys", { keys: bad.join(", ") }) });
    const fxScopes = OLD_MODULES.filter((s) => fx.flags?.[s] !== undefined);
    if (fxScopes.length) out.push({ key: `flags:${fx.uuid}`, uuid: fx.uuid, name: fxLabel, detail: loc("repair.check.mergeResidue.flags", { scopes: fxScopes.join(", ") }) });
  }
}

/** Registers lib's checks. Called once, at `init`. */
export function registerLibRepairChecks() {
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
          const shape = stage !== "fresh" ? "partial" : isPurchaseBundle(plain) ? "purchase" : "other";
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
    id: "lib.mountPairs",
    label: key("mountPairs.label"),
    hint: key("mountPairs.hint"),
    order: 30,
    scan: () => {
      const out = [];
      for (const actor of worldActors()) {
        for (const [flag, back] of [[MOUNT_FLAG, RIDER_FLAG], [RIDER_FLAG, MOUNT_FLAG]]) {
          const uuid = actor.getFlag(MODULE_ID, flag);
          if (!uuid) continue;
          const other = resolveActorSync(uuid);
          if (other?.getFlag(MODULE_ID, back) === actor.uuid) continue;
          out.push({
            key: `${actor.uuid}#${flag}`,
            uuid: actor.uuid,
            name: actor.name,
            flag,
            detail: other ? loc(`repair.check.mountPairs.${flag}OneSided`, { other: other.name }) : loc(`repair.check.mountPairs.${flag}Gone`),
          });
        }
      }
      return out;
    },
    fix: (findings) => fixEach(findings, async (f) => (await fromUuid(f.uuid))?.unsetFlag(MODULE_ID, f.flag)),
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
          // A retired acks-* module is never the answer, installed or not.
          reason: pkg.state === "disabled" && !OLD_TYPE.test(src.type) ? loc("repair.enablePackage", { title: pkg.title }) : loc("repair.check.strandedCoin.reportOnly"),
        });
      }
      return out;
    },
  });

  registerRepairCheck({
    id: "lib.mergeResidue",
    label: key("mergeResidue.label"),
    hint: key("mergeResidue.hint"),
    order: 50,
    scan: () => {
      const out = [];
      const viaMacro = loc("repair.check.mergeResidue.viaMacro");
      // The macro deletes an unloadable actor whole, so one holding coin says so
      // rather than sending the Judge to a fix that destroys the coin.
      const invalid = (doc, id, src, where) => {
        if (!OLD_TYPE.test(String(src?.type ?? ""))) return;
        const coin = doc === "Actor" ? strandedCoin(src) : { rows: 0 };
        let reason = viaMacro;
        if (doc === "RegionBehavior") reason = loc("repair.check.mergeResidue.regionReport");
        else if (coin.rows) reason = loc("repair.check.mergeResidue.holdsCoin", { coin: coin.text });
        out.push({
          key: `invalid:${where}:${id}`,
          uuid: null,
          name: src.name ?? id,
          detail: loc("repair.check.mergeResidue.invalid", { doc, type: src.type }),
          reason,
        });
      };
      for (const [doc, coll] of [["Actor", game.actors], ["Item", game.items]]) {
        for (const { id, src } of invalidSources(coll)) invalid(doc, id, src, doc);
      }
      // A behaviour hangs off a Region inside a Scene: no world collection holds it.
      for (const scene of game.scenes) {
        for (const region of scene.regions ?? []) {
          for (const { id, src } of invalidSources(region.behaviors)) invalid("RegionBehavior", id, src, region.uuid);
        }
      }
      for (const [doc, label] of residueDocs()) residueOn(doc, label, out);
      for (const s of game.settings.storage.get("world") ?? []) {
        const k = String(s.key ?? "");
        if (OLD_MODULES.includes(k.split(".")[0])) out.push({ key: `setting:${k}`, uuid: null, name: k, detail: loc("repair.check.mergeResidue.setting") });
      }
      return out.map((f) => ({ reason: viaMacro, ...f }));
    },
  });
}
