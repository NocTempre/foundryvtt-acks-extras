/**
 * Module-owned compendium document content, consumed by the synced
 * tools/build-packs.mjs harness.
 *
 * Contract: export a `packs` map of pack name -> documents (array, or a
 * zero-arg function returning one). Every top-level document needs:
 *   _id   16 alphanumeric characters, unique within the pack
 *   _key  "!<collection>!<_id>" (e.g. "!items!<id>", "!macros!<id>",
 *         "!tables!<id>"); embedded documents use
 *         "!items.effects!<parentId>.<childId>" style keys
 * Large datasets may live in sibling files (e.g. bestiary-data.mjs) and be
 * re-exported through this map.
 *
 * If documents carry `_stats`, use FIXED createdTime/modifiedTime values —
 * `Date.now()` makes every rebuild churn packs/_source and the compiled packs.
 */

/**
 * The world-wide vision sweep, as a macro.
 *
 * The library derives a token's sight from its sheet whenever something it
 * watches changes, but everything it watches is local: the scene on screen, the
 * actor just edited. A world that turns the setting on mid-campaign, or upgrades
 * into a corrected sense model, has scenes nobody will open for months still
 * carrying whatever their tokens were last set to. This is the one surface that
 * asks for all of them at once.
 *
 * Taking back hand-edited tokens is the second question rather than part of the
 * first: a released token is a Judge's override, and a sweep that silently undid
 * every one of them would be the destructive reading of "migrate".
 */
const MIGRATE_VISION = `// Re-derive every token's sight from its sheet, on every scene.
const api = game.modules.get("acks-extras")?.api?.lib ?? globalThis.acksExtras?.lib;
if (!api?.vision) return ui.notifications.error("ACKS Extras is not active.");
if (!game.user.isGM) return ui.notifications.warn("Only the Judge can migrate token vision.");

const reclaim = await foundry.applications.api.DialogV2.confirm({
  window: { title: "Migrate Token Vision" },
  content:
    "<p>Re-derive every token's sight from its sheet, on every scene in this world.</p>" +
    "<p>Tokens whose vision you edited by hand are left alone, permanently. Take those back as well?</p>",
  yes: { label: "Take hand-edited tokens back" },
  no: { label: "Leave hand-edited tokens alone", default: true },
  rejectClose: false,
});
if (reclaim === null) return;

const report = await api.vision.migrateWorld({ reclaim });
if (!report.ran) {
  return ui.notifications.warn(
    "Nothing swept: either token vision management is switched off in the module settings, or another GM is the primary one."
  );
}
console.log("acks-extras | vision migration", report);
ui.notifications.info(
  \`Vision migrated: \${report.written} of \${report.tokens} token(s) rewritten across \${report.scenes} scene(s). \` +
    \`\${report.reclaimed} taken back; \${report.released} still left to your own edits.\`
);`;

export function buildMacros() {
  return [
    {
      _id: "acksLibVisionMig",
      _key: "!macros!acksLibVisionMig",
      name: "Migrate Token Vision",
      type: "script",
      scope: "global",
      img: "icons/svg/eye.svg",
      command: MIGRATE_VISION,
      ownership: { default: 0 },
      _stats: { coreVersion: "13", createdTime: 1785551134915, modifiedTime: 1785551134915 },
    },
  ];
}

export const packs = { macros: buildMacros };
