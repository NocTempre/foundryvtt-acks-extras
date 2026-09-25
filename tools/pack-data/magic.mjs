/**
 * Compendium document content for the magic feature (module-owned; the
 * harness in tools/build-packs.mjs is synced from acks-module-template and
 * consumes the `packs` map exported at the bottom of this file).
 *
 * Keep this file free of Foundry runtime imports — it runs under plain Node
 * at build time. _stats timestamps are FIXED so every rebuild is
 * byte-identical.
 */

const STATS = { coreVersion: "14", createdTime: 1784101908835, modifiedTime: 1784101908835 };

const MACROS = [
  {
    _id: "acksMagicStrip00",
    name: "Uninstall — Strip Spell Data",
    img: "icons/svg/hazard.svg",
    command: `// Remove everything the magic feature wrote to this world, so ACKS Extras
// can be disabled or uninstalled with no spell data left behind: the spell
// primitive (lists, shapes, target, save, effect rows) on every spell item in
// the world, on actors and on unlinked tokens. Core's own fields — name,
// description, level, class, range, duration, save — stay, so a spell keeps
// the stat line a plain sheet shows.
// Run this BEFORE disabling the module — the macro needs the module's code.
if (!game.user.isGM) { ui.notifications.warn("GM only."); return; }
const api = game.modules.get("acks-extras")?.api?.magic ?? globalThis.acksExtras.magic;
if (!api?.stripModuleData) { ui.notifications.error("ACKS Magic is not active."); return; }
const ok = await foundry.applications.api.DialogV2.confirm({
  classes: ["acks-extras", "acks-extras-scroll"],
  window: { title: "Strip ACKS spell data from this world?" },
  content: \`<p>This deletes the spell primitive from every spell item in the
    world: the lists it prints on, its range, duration, target and save
    shapes, and its effect rows. The spell's own name, description, level,
    class, range, duration and save strings stay. It cannot be undone.</p>
    <p class="notes">Disabling the module takes down every feature, not just
    magic; this macro does not touch the other features' data.</p>\`,
  rejectClose: false,
});
if (!ok) return;
const counts = await api.stripModuleData();
if (!counts) return;
ui.notifications.info(\`Stripped spell data from \${counts.items} spell item(s) across \${counts.actors} actor(s) and the world.\`);`,
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

/** Pack contract for the synced tools/build-packs.mjs harness: pack name → document builder. */
export const packs = {
  macros: buildMacros,
};
