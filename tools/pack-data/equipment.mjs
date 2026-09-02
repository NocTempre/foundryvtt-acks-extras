/**
 * Compendium document content for the equipment feature (module-owned; the harness in
 * tools/build-packs.mjs is synced from acks-module-template and consumes the
 * `packs` map exported at the bottom of this file).
 *
 * Keep this file free of Foundry runtime imports — it runs under plain Node at
 * build time.
 *
 * _stats timestamps are FIXED, not Date.now(): a fixed stamp keeps every
 * rebuild byte-identical so `packs/_source` never churns (see
 * acks-module-template docs/TOOLCHAIN.md §2 and §8).
 */

const MODULE_ID = "acks-extras";
const STAMP = 1784101908835; // fixed; matches the committed pack sources
const STATS = { coreVersion: "14", createdTime: STAMP, modifiedTime: STAMP };

/* -------------------------------------------- */
/*  Macros                                       */
/* -------------------------------------------- */

const MACROS = [
  {
    _id: "acksEqInspect000",
    name: "Loadout Inspector",
    img: "icons/svg/upgrade.svg",
    command: `// Show the selected actor's RAW loadout: hands, fighting style, and any violations.
const api = game.modules.get("acks-extras")?.api?.equipment ?? globalThis.acksExtras.equipment;
if (!api) { ui.notifications.error("ACKS Equipment is not active."); return; }
const actor = canvas.tokens.controlled[0]?.actor ?? game.user.character;
if (!actor) { ui.notifications.warn("Select a token or assign a character."); return; }
const lo = api.getLoadout(actor);
const rows = lo.weapons.map((w) =>
  \`<tr><td>\${w.item.name}</td><td>\${w.profile.size}</td><td>\${w.handsMin}\${w.wieldTwoHanded ? " (2H)" : ""}</td></tr>\`).join("");
const viol = lo.violations.length
  ? "<ul>" + lo.violations.map((v) => \`<li class="\${v.advisory ? "" : "notification error"}">\${v.type}: \${(v.items || []).map((i) => i.name).join(", ")}</li>\`).join("") + "</ul>"
  : "<p><em>Legal loadout.</em></p>";
const content = \`<div class="acks-equipment-loadout">
  <p><b>Hands</b> \${lo.handsUsed}/\${lo.handBudget} · <b>Style</b> \${lo.activeStyle}\${lo.styleProficient ? "" : " <em>(untrained)</em>"}</p>
  <table><thead><tr><th>Weapon</th><th>Size</th><th>Hands</th></tr></thead><tbody>\${rows || "<tr><td colspan=3><em>none equipped</em></td></tr>"}</tbody></table>
  <p><b>Armour</b> \${lo.armor?.name ?? "none"}\${lo.shield ? " · <b>Shield</b> " + lo.shield.name : ""}\${lo.hasHelmet ? " · helmet" : ""}</p>
  \${viol}</div>\`;
new foundry.applications.api.DialogV2({
  classes: ["acks-extras", "acks-extras-scroll"],
  window: { title: \`Loadout — \${actor.name}\`, resizable: true },
  position: { width: 520 },
  content,
  buttons: [{ action: "ok", label: "Close", default: true }],
}).render(true);`,
  },
  {
    _id: "acksEqContainer0",
    name: "Containers",
    img: "icons/containers/bags/pack-leather-brown.webp",
    command: `// Annotate carrying gear from the RAW capacity table (RR pp. 142-145, 161)
// and open the sheet where containers now live.
//
// The Container Manager window is retired: opening, locking, concealing,
// filling and emptying a container all happen on the character sheet's
// equipment tab, next to the gear they act on. This macro does the one thing
// that was genuinely bulk — stamping capacities onto every carrying device the
// character owns — and then shows you the tab.
const api = game.modules.get("acks-extras")?.api?.equipment ?? globalThis.acksExtras.equipment;
if (!api) { ui.notifications.error("ACKS Equipment is not active."); return; }
const actor = canvas.tokens.controlled[0]?.actor ?? game.user.character;
if (!actor) { ui.notifications.warn("Select a token or assign a character first."); return; }

let n = 0;
for (const item of actor.items) {
  if (item.type !== "item" || api.isContainer(item)) continue;
  if (await api.annotateItem(item)) n++;
}
ui.notifications.info(\`Annotated \${n} carrying device(s).\`);
actor.sheet.render(true);`,
  },
  {
    _id: "acksEqItemLoss00",
    name: "Item Loss from Damage",
    img: "icons/svg/fire.svg",
    command: `// JJ p. 398 (optional): an area attack that drops a creature to -6 hp or lower
// destroys 1 stone of equipment, +1 per further 6 damage, in a fixed positional
// order, skipping materials the damage type cannot harm.
const MOD = "acks-extras";
const api = game.modules.get(MOD)?.api?.equipment ?? globalThis.acksExtras.equipment;
if (!api) { ui.notifications.error("ACKS Equipment is not active."); return; }
if (!game.settings.get(MOD, "overlayItemLoss")) { ui.notifications.warn("Enable the 'Item loss from damage' overlay in module settings first."); return; }
const actor = canvas.tokens.controlled[0]?.actor ?? game.user.character;
if (!actor) { ui.notifications.warn("Select a token."); return; }
const types = ["acidic","arcane","bludgeoning","piercing","poisonous","slashing","cold","electric","fire","luminous","necrotic","seismic"];
const form = await foundry.applications.api.DialogV2.prompt({
  classes: ["acks-extras", "acks-extras-scroll"],
  window: { title: \`Item Loss — \${actor.name}\` },
  content: \`<div style="display:grid;gap:.5rem">
    <p>Applies only when the creature was reduced to <b>-6 hp or lower</b> by an area attack it did not save against.</p>
    <label>Hit points after the attack <input type="number" name="hp" value="\${actor.system.hp?.value ?? -6}"></label>
    <label>Damage type <select name="dt">\${types.map((t) => \`<option value="\${t}">\${t}</option>\`).join("")}</select></label>
    <label><input type="checkbox" name="rear"> Damaged from the flank or rear (reverses the order)</label>
  </div>\`,
  ok: { label: "Resolve", callback: (_e, btn) => new FormData(btn.form) },
  rejectClose: false,
});
if (!form) return;
const loadout = api.getLoadout(actor);
const plan = api.planItemLoss(actor, loadout, { hp: Number(form.get("hp")), damageType: form.get("dt"), fromRear: !!form.get("rear") });
if (!plan.stones) { ui.notifications.info("Not at -6 hp or lower: no equipment is at risk."); return; }
const list = plan.destroyed.length
  ? plan.destroyed.map((d) => \`<li><b>\${d.item.name}</b> <span style="opacity:.7">(\${d.material})</span></li>\`).join("")
  : "<li><em>nothing vulnerable to that damage type</em></li>";
ChatMessage.create({
  speaker: ChatMessage.getSpeaker({ actor }),
  content: \`<div class="acks-equipment-loadout"><h3>Item Loss — \${actor.name}</h3>
    <p><b>\${plan.stones}</b> stone at risk (\${form.get("dt")}\${form.get("rear") ? ", from the rear" : ""}).</p>
    <ul>\${list}</ul>
    <p style="opacity:.75;font-size:.9em">\${plan.survivors} item(s) were immune to this damage type and skipped. Magic items get a saving throw (wielder's progression) before being destroyed; items of 2+ stone are damaged rather than destroyed, losing 1 AC per full stone.</p>
  </div>\`,
});`,
  },
  {
    _id: "acksEqRecover000",
    name: "Recover Thrown Weapons",
    img: "icons/svg/regen.svg",
    command: `// Recover thrown weapons — the manual retrieval RAW leaves to the Judge.
// A thrown hand axe / javelin is marked "thrown away" (weight removed) on use;
// this clears that state so the weapon is back in hand and weighs again.
// Fired ammunition (arrows/bolts/stones) is restocked by hand — RAW gives no
// automatic recovery percentage.
const MOD = "acks-extras";
const api = game.modules.get(MOD)?.api?.equipment ?? globalThis.acksExtras.equipment;
if (!api) { ui.notifications.error("ACKS Equipment is not active."); return; }
const actor = canvas.tokens.controlled[0]?.actor ?? game.user.character;
if (!actor) { ui.notifications.warn("Select a token or assign a character."); return; }
const names = await api.recoverThrown(actor);
if (!names.length) { ui.notifications.info("No thrown weapons to recover."); return; }
ChatMessage.create({
  speaker: ChatMessage.getSpeaker({ actor }),
  content: \`<p><b>\${actor.name}</b> recovers: \${names.join(", ")}.</p>\`,
});`,
  },
  {
    _id: "acksEqConfig0000",
    name: "Configure Proficiencies",
    img: "icons/svg/statue.svg",
    command: `// Set the selected actor's fighting styles, weapon proficiency, and armour cap.
//
// Weapon proficiency is a list of GRANT TOKENS (JJ p. 290), not free prose — so
// this offers the whole vocabulary as boxes: the size-based broad choices (i-ii),
// all missile weapons (v), the category-based narrow choices (i-vi), or the
// unrestricted grant. Names typed by hand are checked before they are saved: a
// token matching no weapon used to save silently and leave the character
// non-proficient with everything it owned.
const MOD = "acks-extras";
const api = game.modules.get(MOD)?.api?.equipment ?? globalThis.acksExtras.equipment;
if (!api) { ui.notifications.error("ACKS Equipment is not active."); return; }
const actor = canvas.tokens.controlled[0]?.actor ?? game.user.character;
if (!actor) { ui.notifications.warn("Select a token or assign a character."); return; }

// RAW: every character is trained in the single-weapon and missile styles
// (RR p. 106), so those two are stated, not offered.
const STYLES = [["dual", "Two weapons (dual wield)"], ["twoHanded", "Two-handed"], ["weaponShield", "Weapon &amp; shield"]];
const SIZES = [
  ["tiny", "Tiny", "dagger, knife, club, sap"],
  ["small", "Small", "short sword, hand axe, war hammer, javelin"],
  ["medium", "Medium", "sword, mace, flail, spear, staff"],
  ["large", "Large", "two-handed sword, great axe, pole arm, morning star"],
];
const CATEGORIES = [
  ["axe", "Axes"],
  ["bow", "Bows"],
  ["crossbow", "Crossbows"],
  ["flailHammerMace", "Flails, hammers &amp; maces"],
  ["swordDagger", "Swords &amp; daggers"],
  ["spearPolearm", "Spears &amp; pole arms"],
  ["other", "Bolas, cestus, nets, saps, slings, staff-slings &amp; whips"],
];
const ARMOURS = [["unarmored", "None"], ["veryLight", "Very light"], ["light", "Light"], ["medium", "Medium"], ["heavy", "Heavy"]];

// Decompose what is stored into the boxes it came from; a token naming a weapon
// (or a typo) goes back into the free-text field it was typed in.
const stored = String(actor.getFlag(MOD, "weaponProficiency") ?? "all").split(",").map((s) => s.trim()).filter(Boolean);
let state = {
  styles: new Set(String(actor.getFlag(MOD, "styles") ?? "single,missile").split(",").map((s) => s.trim()).filter(Boolean)),
  grants: new Set(stored.filter((t) => !["weapon", "unknown"].includes(api.classifyGrantToken(t)))),
  named: stored.filter((t) => ["weapon", "unknown"].includes(api.classifyGrantToken(t))).join(", "),
  armour: String(actor.getFlag(MOD, "armorMax") ?? "heavy"),
};
// Tokens are compared canonically (so a stored "tiny" ticks the melee-size box)
// but STORED as ticked, which keeps the saved list readable.
const on = (set, value) => [...set].some((s) => api.normalizeGrantToken(s) === api.normalizeGrantToken(value));

const box = (name, value, label, checked, note) =>
  \`<label style="display:flex;gap:.4rem;align-items:baseline"><input type="checkbox" name="\${name}" value="\${value}"\${checked ? " checked" : ""}>
    <span>\${label}\${note ? \` <span style="opacity:.6;font-size:.9em">— \${note}</span>\` : ""}</span></label>\`;

const render = (st) => \`<div style="display:grid;gap:.75rem;align-content:start">
  <fieldset><legend>Fighting styles (weapon style proficiencies)</legend>
    <p class="notes">How the character is trained to hold weapons — the book calls these <em>fighting styles</em>;
      character sheets and class tables often call the same thing <em>weapon style proficiencies</em>.
      Single-weapon and missile styles are always trained and are not listed.</p>
    \${STYLES.map(([k, l]) => box("style", k, l, on(st.styles, k))).join("")}
  </fieldset>
  <fieldset><legend>Weapon proficiency</legend>
    <p class="notes">Tick the class's weapon selections. <b>All weapons</b> overrides everything below it;
      ticking nothing at all clears the profile, leaving the character unrestricted.</p>
    \${box("grant", "all", "<b>All weapons</b> (unrestricted)", on(st.grants, "all"))}
    <p class="notes" style="margin-bottom:0"><b>Any melee weapon of these sizes</b> (broad choices i-ii)</p>
    \${SIZES.map(([k, l, ex]) => box("grant", \`melee:\${k}\`, l, on(st.grants, k), ex)).join("")}
    <p class="notes" style="margin-bottom:0"><b>Missile</b></p>
    \${box("grant", "missile:all", "All missile weapons", on(st.grants, "missile:all"), "broad choice v")}
    <p class="notes" style="margin-bottom:0"><b>Weapon categories</b> (narrow choices i-vi)</p>
    \${CATEGORIES.map(([k, l]) => box("grant", k, l, on(st.grants, k))).join("")}
    <label style="display:block;margin-top:.4rem">Specific weapons, comma-separated (narrow choice vii, broad choice vi)
      <input name="named" value="\${foundry.utils.escapeHTML(st.named)}" placeholder="e.g. sword, dagger, short bow"></label>
  </fieldset>
  <label>Maximum armour category
    <select name="armorMax">\${ARMOURS.map(([k, l]) => \`<option value="\${k}"\${k === st.armour ? " selected" : ""}>\${l}</option>\`).join("")}</select></label>
</div>\`;

// Loop rather than bail on a bad token: answering "no" to the warning must hand
// back the form as it was typed, not throw the whole entry away.
let typed = [];
for (;;) {
  const form = await foundry.applications.api.DialogV2.prompt({
    // Forty checkboxes in two fieldsets: the window opens at a workable height
    // and the body scrolls, rather than the frame being amputated at the
    // viewport cap with the Save button below the cut.
    classes: ["acks-extras", "acks-extras-scroll"],
    window: { title: \`Proficiencies — \${actor.name}\`, resizable: true },
    position: { width: 560, height: 640 },
    content: render(state),
    ok: { label: "Save", callback: (_ev, btn) => new FormData(btn.form) },
    rejectClose: false,
  });
  if (!form) return;
  state = {
    styles: new Set(form.getAll("style")),
    grants: new Set(form.getAll("grant")),
    named: String(form.get("named") ?? ""),
    armour: String(form.get("armorMax")),
  };
  typed = state.named.split(",").map((s) => s.trim()).filter(Boolean);
  const unknown = typed.filter((t) => api.classifyGrantToken(t) === "unknown");
  if (!unknown.length) break;
  const ok = await foundry.applications.api.DialogV2.confirm({
    classes: ["acks-extras", "acks-extras-scroll"],
    window: { title: "Unrecognised weapons" },
    content: \`<p>These match no weapon this module knows, so they will grant nothing:
      <b>\${foundry.utils.escapeHTML(unknown.join(", "))}</b>.</p>
      <p class="notes">Use the weapon's RAW name — the ones in core's equipment compendium.
      Choose <b>No</b> to go back and correct them, or <b>Yes</b> to save as typed.</p>\`,
    rejectClose: false,
  });
  if (ok) break;
}

const grants = [...state.grants];
const tokens = grants.includes("all") ? ["all"] : [...new Set([...grants, ...typed.map((t) => t.toLowerCase())])];
const styles = [...new Set(["single", "missile", ...state.styles])];
await actor.update({
  [\`flags.\${MOD}.styles\`]: styles.join(","),
  // Nothing ticked = no declared restriction. Clearing the flag is what says
  // that; an empty list would read as a profile granting nothing.
  ...(tokens.length ? { [\`flags.\${MOD}.weaponProficiency\`]: tokens.join(",") } : { [\`flags.\${MOD}.-=weaponProficiency\`]: null }),
  [\`flags.\${MOD}.armorMax\`]: state.armour,
});
ui.notifications.info(\`\${actor.name}: styles \${styles.join(", ")} · weapons \${tokens.join(", ") || "unrestricted"} · armour up to \${state.armour}.\`);`,
  },
  {
    _id: "acksEqUninstall0",
    name: "Uninstall — Strip Equipment Data",
    img: "icons/svg/hazard.svg",
    command: `// Remove everything the equipment feature wrote to this world, so ACKS
// Extras can be disabled or uninstalled with no equipment data left behind:
// the managed "Equipment Loadout" effects (which would otherwise keep
// applying stale AC/init/attack modifiers forever), the equipment flags on
// actors and items, and any disguise masks (revealed first, so items keep
// their TRUE identity).
// Optionally also reverts masterwork/scavenged stat layers to pristine.
// Run this BEFORE disabling the module — the macro needs the module's code.
if (!game.user.isGM) { ui.notifications.warn("GM only."); return; }
const api = game.modules.get("acks-extras")?.api?.equipment ?? globalThis.acksExtras.equipment;
if (!api?.stripModuleData) { ui.notifications.error("ACKS Equipment is not active."); return; }
const form = await foundry.applications.api.DialogV2.prompt({
  classes: ["acks-extras", "acks-extras-scroll"],
  window: { title: "Strip ACKS Equipment data from this world?" },
  content: \`<p>This removes the managed loadout effects, reveals any
    disguised items, and deletes every equipment flag from actors and items
    (containers, grips, ammo state, named-item trackers, proficiency
    profiles). It cannot be undone.</p>
    <label class="checkbox"><input type="checkbox" name="revert">
    Also revert masterwork / scavenged items to their original stats
    (unchecked: they keep their current, earned values)</label>
    <p class="notes">After it finishes, disable ACKS Extras before the next
    reload — while enabled, it rebuilds loadout effects on load. Note that
    disabling the module takes down every feature, not just equipment: any
    Animal/Group/Template/Location actors become unavailable while it is off
    (they return, unharmed, the moment it is re-enabled), and this macro does
    not touch the other features' data.</p>\`,
  ok: { label: "Strip module data", callback: (_ev, btn) => new FormData(btn.form) },
  rejectClose: false,
});
if (!form) return;
const counts = await api.stripModuleData({ revertLayers: !!form.get("revert") });
if (!counts) return;
ui.notifications.info(
  \`Equipment data stripped: \${counts.effects} loadout effect(s), \${counts.items} flagged item(s), \` +
  \`\${counts.actors} actor flag set(s), \${counts.revealed} disguise(s) revealed, \${counts.reverted} item(s) reverted. \` +
  "You can now disable the module safely."
);`,
  },
  {
    _id: "acksEqAnnotate00",
    name: "Annotate Equipment (RAW profiles)",
    img: "icons/svg/book.svg",
    command: `// Stamp the equipment feature's RAW flags onto the selected actor's gear (or,
// with no selection, everything in the world):
//   - weapon size / hands / qualities,
//   - carrying-device capacity (backpack, sack, saddlebag, bowquiver, harness),
//   - and WHERE EACH PIECE SITS: the wear slot plus, for anything that holds
//     something, whether drawing from it is free or costs an action
//     (RR pp. 293-294).
//
// All three item types are swept. Carrying devices are type "item" and armour
// is type "armor", so filtering to weapons alone left both unflagged — and
// armour is where the head/body distinction is declared.
//
// The slot is a best guess you can correct: open any item and use the Slot
// control on its Construction tab. Gear that belongs nowhere (rations, tools,
// loot, coin) is left declaring nothing, which is how it stays plain goods.
const api = game.modules.get("acks-extras")?.api?.equipment ?? globalThis.acksExtras.equipment;
if (!api) { ui.notifications.error("ACKS Equipment is not active."); return; }
const actor = canvas.tokens.controlled[0]?.actor ?? game.user.character;
const ANNOTATABLE = ["weapon", "armor", "item"];
const source = actor ? actor.items : game.items;
// annotateItem returns null for anything with no RAW profile, so a broad
// sweep is safe — it only writes where it recognises the gear.
const items = source.filter((i) => ANNOTATABLE.includes(i.type));
const counts = { weapon: 0, container: 0, gear: 0 };
for (const it of items) {
  const key = await api.annotateItem(it);
  if (!key) continue;
  counts[key === "container" || key === "gear" ? key : "weapon"]++;
}
ui.notifications.info(
  \`Annotated \${counts.weapon} weapon(s), \${counts.container} carrying device(s) and \${counts.gear} worn item(s)\${actor ? " on " + actor.name : " in the world"}.\`
);`,
  },
];

export function buildMacros() {
  return MACROS.map((m) => ({
    _id: m._id,
    _key: `!macros!${m._id}`,
    name: m.name,
    type: "script",
    img: m.img,
    scope: "global",
    command: m.command,
    folder: null,
    flags: {},
    ownership: { default: 0 },
    sort: 0,
    _stats: { ...STATS },
  }));
}

export { MODULE_ID, STATS };

/**
 * Pack contract for the synced tools/build-packs.mjs harness (see
 * acks-module-template): pack name -> document builder. Empty packs are
 * skipped by the harness and stay undeclared in module.json.
 */
export const packs = {
  macros: buildMacros,
};
