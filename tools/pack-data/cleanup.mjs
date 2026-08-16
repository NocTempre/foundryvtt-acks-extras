/**
 * The post-switch cleaner.
 *
 * A world that ran the nine separate acks-* modules still carries what they
 * wrote: flag scopes under their ids, Active Effect change keys pointing at
 * those scopes, world settings in their namespaces, and sheet-class pointers at
 * their sheet keys. Nothing carries across — this is a clean break, not a
 * migration — so all of it is dead weight, and the sub-typed Actors among it
 * are worse than dead: Foundry refuses to instantiate an Actor whose `type` is
 * gone, so they surface as "Failed to initialize Actor" on every load.
 *
 * This macro finds that residue and removes it. It reports before it deletes,
 * it is idempotent, and it runs with the old modules uninstalled — flags of an
 * uninstalled module are still readable, and invalid Actors are reached through
 * the collection's invalid-document accessors rather than the normal lookup.
 *
 * It does NOT touch anything acks-extras or acks-importer own.
 */
import crypto from "node:crypto";

const did = (seed) => "acks" + crypto.createHash("sha1").update(seed).digest("hex").slice(0, 12);
const STATS = { coreVersion: "13", createdTime: 1785551134915, modifiedTime: 1785551134915 };

const COMMAND = String.raw`
// ACKS II — clean up after the module merge.
// Removes what the nine old acks-* modules left in this world. Nothing is
// migrated: the merge was a clean break, so this is residue, not data.
if (!game.user.isGM) { ui.notifications.warn("GM only."); return; }

const OLD = ["acks-lib","acks-abilities","acks-equipment","acks-formation",
             "acks-henchmen","acks-influence","acks-location","acks-monsters",
             "acks-content"];
const OLD_TYPE = /^acks-(lib|abilities|equipment|formation|henchmen|influence|location|monsters|content)\./;
const CHANGE_KEY = /^flags\.acks-(lib|abilities|equipment|formation|henchmen|influence|location|monsters|content)\./;

const plan = { flags: [], effects: [], settings: [], sheets: [], invalid: [] };

/* --- documents whose sub-type belonged to an old module ------------------ */
// These never instantiate, so game.actors.get() cannot see them. The collection
// keeps their ids and raw source separately; that is the only way in.
for (const [name, coll] of [["Actor", game.actors], ["Item", game.items]]) {
  for (const id of (coll.invalidDocumentIds ?? new Set())) {
    let src = null;
    try { src = coll.getInvalid(id, { strict: false })?.toObject?.() ?? null; } catch (e) { /* unreadable */ }
    const type = src?.type ?? "(unknown)";
    if (OLD_TYPE.test(type)) plan.invalid.push({ doc: name, id, name: src?.name ?? "(unnamed)", type });
  }
}

// A behaviour hangs off a Region inside a Scene, so it is in no world
// collection and the sweep above cannot see it. It breaks the load exactly
// the same way, and one of the old modules put an encounter zone on every
// region a Judge drew.
for (const scene of game.scenes) {
  for (const region of (scene.regions ?? [])) {
    const behaviors = region.behaviors;
    for (const id of (behaviors?.invalidDocumentIds ?? new Set())) {
      let src = null;
      try { src = behaviors.getInvalid(id, { strict: false })?.toObject?.() ?? null; } catch (e) { /* unreadable */ }
      const type = src?.type ?? "(unknown)";
      if (OLD_TYPE.test(type)) {
        plan.invalid.push({ doc: "RegionBehavior", id, name: src?.name ?? "(unnamed)", type, parent: region.uuid });
      }
    }
  }
}

/* --- flag scopes, AE change keys, sheet pointers ------------------------- */
const scan = (doc, label) => {
  const scopes = OLD.filter((s) => doc.flags?.[s] !== undefined);
  if (scopes.length) plan.flags.push({ uuid: doc.uuid, label, scopes });
  const sheet = doc.flags?.core?.sheetClass;
  if (typeof sheet === "string" && OLD.some((s) => sheet.startsWith(s + "."))) {
    plan.sheets.push({ uuid: doc.uuid, label, sheet });
  }
  for (const fx of (doc.effects ?? [])) {
    const bad = (fx.changes ?? []).filter((c) => CHANGE_KEY.test(String(c.key ?? "")));
    if (bad.length) plan.effects.push({ uuid: fx.uuid, label: label + " → " + fx.name, keys: bad.map((c) => c.key) });
    const fxScopes = OLD.filter((s) => fx.flags?.[s] !== undefined);
    if (fxScopes.length) plan.flags.push({ uuid: fx.uuid, label: label + " → " + fx.name, scopes: fxScopes });
  }
};
for (const a of game.actors) { scan(a, a.name); for (const i of a.items) scan(i, a.name + " → " + i.name); }
for (const i of game.items) scan(i, i.name);
for (const j of game.journal) scan(j, j.name);
for (const t of game.tables) scan(t, t.name);
for (const s of game.scenes) { scan(s, s.name); for (const tk of s.tokens) scan(tk, s.name + " → " + tk.name); }

/* --- world settings in the old namespaces -------------------------------- */
for (const s of game.settings.storage.get("world")) {
  const ns = String(s.key ?? "").split(".")[0];
  if (OLD.includes(ns)) plan.settings.push({ id: s.id, key: s.key });
}

const total = plan.invalid.length + plan.flags.length + plan.effects.length + plan.settings.length + plan.sheets.length;
if (!total) { ui.notifications.info("Nothing left from the old modules — this world is already clean."); return; }

const li = (rows, f) => rows.length ? "<ul>" + rows.slice(0, 12).map(f).join("") + (rows.length > 12 ? "<li><em>…and " + (rows.length - 12) + " more</em></li>" : "") + "</ul>" : "";
const content =
  "<p>Found <strong>" + total + "</strong> leftover(s) from the pre-merge modules. Nothing here is carried over by the merge.</p>" +
  (plan.invalid.length  ? "<h4>Documents of a removed sub-type (" + plan.invalid.length + ") — deleted</h4>" + li(plan.invalid, (r) => "<li>" + r.doc + " <b>" + r.name + "</b> <code>" + r.type + "</code></li>") : "") +
  (plan.flags.length    ? "<h4>Flag scopes (" + plan.flags.length + ") — removed</h4>" + li(plan.flags, (r) => "<li>" + r.label + " <code>" + r.scopes.join(", ") + "</code></li>") : "") +
  (plan.effects.length  ? "<h4>Effect change keys (" + plan.effects.length + ") — removed</h4>" + li(plan.effects, (r) => "<li>" + r.label + " <code>" + r.keys.join(", ") + "</code></li>") : "") +
  (plan.sheets.length   ? "<h4>Sheet pointers (" + plan.sheets.length + ") — cleared</h4>" + li(plan.sheets, (r) => "<li>" + r.label + " <code>" + r.sheet + "</code></li>") : "") +
  (plan.settings.length ? "<h4>World settings (" + plan.settings.length + ") — deleted</h4>" + li(plan.settings, (r) => "<li><code>" + r.key + "</code></li>") : "") +
  "<p><strong>This cannot be undone.</strong> Back the world up first if you have not.</p>";

const go = await foundry.applications.api.DialogV2.confirm({
  window: { title: "ACKS II — Clean Up After the Merge" },
  classes: ["acks-extras", "acks-extras-scroll"],
  content,
  yes: { label: "Remove them" },
  no: { label: "Cancel", default: true },
});
if (!go) return;

let done = 0;
// invalid documents first: they are the ones breaking world load
for (const r of plan.invalid) {
  if (r.doc === "RegionBehavior") {
    // Deleted through the region that holds it: an embedded document has no
    // collection of its own to be reached by id.
    const region = await fromUuid(r.parent).catch(() => null);
    if (region) {
      try { await region.deleteEmbeddedDocuments("RegionBehavior", [r.id]); done++; }
      catch (e) { console.error("acks-extras | could not delete RegionBehavior " + r.id, e); }
    }
    continue;
  }
  const coll = r.doc === "Actor" ? game.actors : game.items;
  try { await coll.getInvalid(r.id, { strict: false }).delete(); done++; }
  catch (e) { console.error("acks-extras | could not delete " + r.doc + " " + r.id, e); }
}
for (const r of plan.effects) {
  const fx = await fromUuid(r.uuid).catch(() => null);
  if (!fx) continue;
  const keep = (fx.changes ?? []).filter((c) => !CHANGE_KEY.test(String(c.key ?? "")));
  try { await fx.update({ changes: keep }); done++; } catch (e) { console.error(e); }
}
for (const r of plan.flags) {
  const d = await fromUuid(r.uuid).catch(() => null);
  if (!d) continue;
  try { for (const s of r.scopes) await d.unsetFlag(s, ""); done++; }
  catch (e) {
    // unsetFlag refuses a scope that is not an active package; go through the
    // document's own update with the -= deletion syntax instead.
    try { await d.update(Object.fromEntries(r.scopes.map((s) => ["flags.-=" + s, null]))); done++; }
    catch (e2) { console.error("acks-extras | could not clear flags on " + r.uuid, e2); }
  }
}
for (const r of plan.sheets) {
  const d = await fromUuid(r.uuid).catch(() => null);
  if (d) { try { await d.unsetFlag("core", "sheetClass"); done++; } catch (e) { console.error(e); } }
}
for (const r of plan.settings) {
  try { await game.settings.storage.get("world").get(r.id).delete(); done++; }
  catch (e) { console.error("acks-extras | could not delete setting " + r.key, e); }
}

ui.notifications.info("Cleaned up " + done + " leftover(s). Reload the world (F5) to clear the console errors.");
console.log("acks-extras | cleanup plan", plan);
`;

/**
 * The coin rescue, which must run BEFORE the cleaner.
 *
 * A safehouse built by the old location module is an Actor of a sub-type that
 * no longer exists, so Foundry will not instantiate it — and everything stored
 * inside it, the strongbox included, is embedded in a document nobody can
 * open. The cleaner's answer is to delete it, which is right for a dead flag
 * scope and wrong for a party's money.
 *
 * The raw source survives whatever the schema thinks, so the coin can be read
 * straight out of it and re-minted somewhere a Judge can reach. Nothing is
 * deleted here: this hands the money back, and the cleaner is still what
 * removes the husk afterwards.
 */
const RESCUE = String.raw`
// ACKS II — recover coin stranded in pre-merge locations.
if (!game.user.isGM) { ui.notifications.warn("GM only."); return; }

const OLD_TYPE = /^acks-(lib|abilities|equipment|formation|henchmen|influence|location|monsters|content)\./;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// Every unloadable document the old modules left, with its raw contents.
const found = [];
for (const [label, coll] of [["Actor", game.actors], ["Item", game.items]]) {
  for (const id of (coll.invalidDocumentIds ?? new Set())) {
    let src = null;
    try { src = coll.getInvalid(id, { strict: false })?.toObject?.() ?? null; } catch (e) { /* unreadable */ }
    if (!src || !OLD_TYPE.test(src.type ?? "")) continue;
    const items = Array.isArray(src.items) ? src.items : [];
    const coin = items.filter((i) => i.type === "money");
    // A coin's worth is its copper value times every one of it held, banked
    // or in hand — both are the location's, and only one of them is visible.
    const cp = coin.reduce((s, i) => s + num(i.system?.coppervalue) * (num(i.system?.quantity) + num(i.system?.quantitybank)), 0);
    if (coin.length || items.length) {
      found.push({ label, id, name: src.name ?? "(unnamed)", type: src.type, coin, cp, others: items.length - coin.length });
    }
  }
}

const withCoin = found.filter((f) => f.coin.length);
if (!withCoin.length) {
  ui.notifications.info(found.length
    ? "Found " + found.length + " unloadable document(s) from the old modules, but no coin in them."
    : "No stranded documents from the old modules in this world.");
  return;
}

const totalGp = withCoin.reduce((s, f) => s + f.cp, 0) / 100;
const dests = game.actors.filter((a) => a.isOwner).sort((a, b) => a.name.localeCompare(b.name));
if (!dests.length) { ui.notifications.error("No actor available to receive the coin."); return; }

const rows = withCoin.map((f) =>
  "<li><b>" + f.name + "</b> <code>" + f.type + "</code> — " +
  f.coin.map((c) => (num(c.system?.quantity) + num(c.system?.quantitybank)) + " × " + c.name).join(", ") +
  " <em>(" + (f.cp / 100) + " gp)</em>" +
  (f.others ? " <span class='notes'>+ " + f.others + " other item(s), not touched</span>" : "") + "</li>").join("");

const options = dests.map((a) => "<option value='" + a.id + "'>" + a.name + "</option>").join("");
const go = await foundry.applications.api.DialogV2.prompt({
  window: { title: "ACKS II — Recover Stranded Coin" },
  classes: ["acks-extras", "acks-extras-scroll"],
  content:
    "<p>Found <strong>" + (totalGp) + " gp</strong> in " + withCoin.length + " location(s) this world can no longer open.</p><ul>" + rows + "</ul>" +
    "<p>Coin is <strong>copied</strong> to the actor you choose. The locations are left exactly as they are — run <em>Clean Up After the Merge</em> afterwards to remove them.</p>" +
    "<p class='notification warning'>Run this once: pressing it twice mints the coin twice.</p>" +
    "<div class='form-group'><label>Give it to</label><div class='form-fields'><select name='dest'>" + options + "</select></div></div>",
  ok: { label: "Recover the coin", callback: (ev, btn) => btn.form.elements.dest.value },
  rejectClose: false,
});
if (!go) return;

const dest = game.actors.get(go);
if (!dest) { ui.notifications.error("That actor is gone."); return; }
// Minted fresh rather than moved: the source cannot be updated, so a transfer
// would have no side to take the coin FROM.
const payload = withCoin.flatMap((f) => f.coin.map((c) => {
  const o = foundry.utils.deepClone(c);
  delete o._id;
  return o;
}));
await dest.createEmbeddedDocuments("Item", payload);
ui.notifications.info("Recovered " + totalGp + " gp into " + dest.name + ".");
console.log("acks-extras | coin recovery", { totalGp, withCoin });
`;

export function buildMacros() {
  const id = did("macro:cleanup-after-merge");
  const rescueId = did("macro:recover-stranded-coin");
  return [
    {
      _id: rescueId,
      _key: `!macros!${rescueId}`,
      name: "Recover Coin from Unloadable Locations (GM)",
      type: "script",
      scope: "global",
      img: "icons/commodities/currency/coins-assorted-mix-copper-silver-gold.webp",
      command: RESCUE.trim(),
      ownership: { default: 0 },
      _stats: STATS,
    },
    {
      _id: id,
      _key: `!macros!${id}`,
      name: "Clean Up After the Merge (GM)",
      type: "script",
      scope: "global",
      img: "icons/svg/daze.svg",
      command: COMMAND.trim(),
      ownership: { default: 0 },
      _stats: STATS,
    },
  ];
}

export const packs = { macros: buildMacros };
