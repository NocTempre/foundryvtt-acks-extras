/**
 * Compendium content: henchmen-relevant proficiencies & class powers as acks
 * `ability` Items whose ACTIVE EFFECTS carry the module's machine-readable
 * mechanics (the flags.acks-henchmen.* change-key contract — docs/MODEL.md),
 * plus helper macros. Pure data; consumed by tools/build-packs.mjs.
 *
 * Rules text is paraphrased with book citations (never verbatim book text).
 */
import crypto from "node:crypto";

/** Deterministic prefixed 16-char id ("acksHm" + 10 hash chars) from a seed. */
function did(seed) {
  return "acksHm" + crypto.createHash("sha1").update(seed).digest("hex").slice(0, 10);
}

function effect(itemName, { label, changes, condition, target }) {
  const itemId = did(`item:${itemName}`);
  const effectId = did(`${itemName}:effect:${label ?? "main"}`);
  return {
    _id: effectId,
    _key: `!items.effects!${itemId}.${effectId}`,
    name: label ?? itemName,
    type: "base",
    img: "icons/svg/aura.svg",
    system: {},
    transfer: true,
    disabled: false,
    changes: changes.map((c) => ({ priority: 20, ...c })),
    duration: { startTime: null, seconds: null },
    flags: {
      "acks-henchmen": {
        ...(condition ? { condition } : {}),
        ...(target ? { target } : {}),
      },
    },
  };
}

const ADD = 2; // CONST.ACTIVE_EFFECT_MODES.ADD
const CUSTOM = 0; // read by the module, ignored by core prepareData

function ability(name, { type = "general", description, requirements = "", effects = [] }) {
  const id = did(`item:${name}`);
  return {
    _id: id,
    _key: `!items!${id}`,
    name,
    type: "ability",
    img: "icons/svg/book.svg",
    system: {
      description: `<p>${description}</p>`,
      proficiencytype: type,
      favorite: false,
      pattern: "white",
      requirements,
      roll: "",
      rollType: "result",
      rollTarget: 0,
      blindroll: false,
      save: "",
      _schemaVersion: 3,
    },
    effects,
  };
}

export function buildProficienciesPowers() {
  const K = "flags.acks-henchmen";
  return [
    ability("Diplomacy", {
      description:
        "Smooth-tongued and familiar with protocol: +1 to reaction rolls when parleying. Stacks with Mystic Aura, not with Intimidation or Seduction. (RR 108)",
      effects: [
        effect("Diplomacy", {
          changes: [{ key: `${K}.hiring`, mode: ADD, value: "1" }],
          condition: "ACKS-HENCHMEN.cond.parley",
        }),
      ],
    }),
    ability("Intimidation", {
      description:
        "Bullies others: +1 to reaction rolls when implicitly or explicitly threatening; targets must be under 5 HD or outnumbered/outranked. Stacks with Mystic Aura, not with Diplomacy or Seduction. (RR 113)",
      effects: [
        effect("Intimidation", {
          changes: [{ key: `${K}.hiring`, mode: ADD, value: "1" }],
          condition: "ACKS-HENCHMEN.cond.threats",
        }),
      ],
    }),
    ability("Seduction", {
      description:
        "Naturally alluring: +1 to reaction rolls with others potentially attracted to the character. Stacks with Mystic Aura, not with Diplomacy or Intimidation. (RR 118)",
      effects: [
        effect("Seduction", {
          changes: [{ key: `${K}.hiring`, mode: ADD, value: "1" }],
          condition: "ACKS-HENCHMEN.cond.attracted",
        }),
      ],
    }),
    ability("Mystic Aura", {
      type: "class",
      description:
        "Projects magical presence: +1 to reaction rolls to impress and intimidate; on a total of 12+ subjects act as if bewitched while in the character's presence. (RR 115)",
      effects: [
        effect("Mystic Aura", {
          changes: [{ key: `${K}.hiring`, mode: ADD, value: "1" }],
          condition: "ACKS-HENCHMEN.cond.impress",
        }),
      ],
    }),
    ability("Bribery", {
      description:
        "Skilled at bribing with gifts: +1 to reaction rolls when offering one day's pay, +2 for a week's, +3 for a month's — politely deniable by both parties. The recruit dialog prices signing-bonus tiers on the cheaper Bribery scale when this item is present. (RR 107)",
    }),
    ability("Command", {
      type: "class",
      description:
        "Mastered the art of command: the character's henchmen, mercenaries, and other troops receive +2 to morale. (RR 108)",
      effects: [
        effect("Command", {
          changes: [{ key: `${K}.henchmanMorale`, mode: ADD, value: "2" }],
        }),
      ],
    }),
    ability("Leadership", {
      description:
        "An inspirational authority figure: may hire one more henchman than Charisma would otherwise permit; the base morale of any ruled domain increases by 1. (RR 114)",
      effects: [
        effect("Leadership", {
          changes: [{ key: `${K}.retainBonus`, mode: ADD, value: "1" }],
        }),
      ],
    }),
    ability("Beast Friendship", {
      type: "class",
      description:
        "Schooled in the natural world: identifies plants and fauna (11+), understands animal vocalizations, +2 to reaction rolls with normal animals, and can take animals as henchmen. With Friend of Birds and Beasts: +1 henchman limit while at least one henchman is an animal. (RR 106)",
      effects: [
        effect("Beast Friendship", {
          label: "Beast Friendship — animal reactions",
          changes: [
            { key: `${K}.hiring`, mode: ADD, value: "2" },
            { key: `${K}.recruitKinds`, mode: CUSTOM, value: "animal" },
          ],
          condition: "ACKS-HENCHMEN.cond.animals",
          target: "ACKS-HENCHMEN.target.animals",
        }),
      ],
    }),
    ability("Blood of Ancient Kings", {
      type: "class",
      description:
        "The blood of ancient kings and heroes: may hire one more henchman than Charisma permits, and the base loyalty of any henchmen increases by 1. (JJ powers: Blood of Kings)",
      effects: [
        effect("Blood of Ancient Kings", {
          changes: [
            { key: `${K}.retainBonus`, mode: ADD, value: "1" },
            { key: `${K}.baseLoyalty`, mode: ADD, value: "1" },
          ],
        }),
      ],
    }),
    ability("Friends of Birds and Beasts", {
      type: "class",
      description:
        "Understands the language of beasts: +2 to reaction rolls with normal animals and can take animals as henchmen; trains and handles animal henchmen without Animal Training. (JJ powers)",
      effects: [
        effect("Friends of Birds and Beasts", {
          changes: [
            { key: `${K}.hiring`, mode: ADD, value: "2" },
            { key: `${K}.recruitKinds`, mode: CUSTOM, value: "animal" },
          ],
          condition: "ACKS-HENCHMEN.cond.animals",
          target: "ACKS-HENCHMEN.target.animals",
        }),
      ],
    }),
    ability("Battlefield Prowess", {
      type: "class",
      description:
        "Henchmen and mercenaries hired by the character gain +1 to their morale score whenever he personally leads them. (JJ powers)",
      effects: [
        effect("Battlefield Prowess", {
          changes: [{ key: `${K}.henchmanMorale`, mode: ADD, value: "1" }],
          condition: "ACKS-HENCHMEN.cond.personallyLed",
        }),
      ],
    }),
    ability("Chronicles of Battle", {
      type: "class",
      description:
        "Henchmen and mercenaries gain +1 to their morale score if the character is there to witness and record their deeds. (JJ powers — Bard)",
      effects: [
        effect("Chronicles of Battle", {
          changes: [{ key: `${K}.henchmanMorale`, mode: ADD, value: "1" }],
          condition: "ACKS-HENCHMEN.cond.witnessed",
        }),
      ],
    }),
    ability("Holy Fervor", {
      type: "class",
      description:
        "Hirelings of the same religion as the character gain +1 to their morale score whenever he is present. (JJ powers — Paladin, Flagellant)",
      effects: [
        effect("Holy Fervor", {
          changes: [{ key: `${K}.henchmanMorale`, mode: ADD, value: "1" }],
          condition: "ACKS-HENCHMEN.cond.sameReligion",
        }),
      ],
    }),
    ability("Dark Charisma", {
      type: "class",
      description:
        "Chaotic characters or monsters in the character's service gain +1 to their morale score whenever he personally leads them. (JJ powers — Zaharan Ruinguard)",
      effects: [
        effect("Dark Charisma", {
          changes: [{ key: `${K}.henchmanMorale`, mode: ADD, value: "1" }],
          condition: "ACKS-HENCHMEN.cond.chaoticServants",
        }),
      ],
    }),
    ability("Experience and Hardiness", {
      type: "class",
      description:
        "Hirelings on a wilderness adventure led by this character gain +1 to their morale score; stacks with Charisma and proficiency modifiers. (JJ powers — Explorer)",
      effects: [
        effect("Experience and Hardiness", {
          changes: [{ key: `${K}.henchmanMorale`, mode: ADD, value: "1" }],
          condition: "ACKS-HENCHMEN.cond.wilderness",
        }),
      ],
    }),
    ability("Familial Loyalty", {
      type: "class",
      description:
        "May hire one more henchman than Charisma permits and henchman base loyalty +1, provided the henchman is related by blood or marriage; related NPCs gain +1 morale when the character is present. (JJ powers — Katripol)",
      effects: [
        effect("Familial Loyalty", {
          changes: [
            { key: `${K}.retainBonus`, mode: ADD, value: "1" },
            { key: `${K}.baseLoyalty`, mode: ADD, value: "1" },
            { key: `${K}.henchmanMorale`, mode: ADD, value: "1" },
          ],
          condition: "ACKS-HENCHMEN.cond.related",
        }),
      ],
    }),
    ability("Mercantile Network", {
      type: "class",
      description:
        "In a market previously entered, the character may treat the market as one class larger than its actual size (Class I stays Class I) when buying, selling, and hiring retainers. (JJ powers — Venturer)",
      effects: [
        effect("Mercantile Network", {
          changes: [{ key: `${K}.marketClass`, mode: ADD, value: "1" }],
          condition: "ACKS-HENCHMEN.cond.knownMarket",
        }),
      ],
    }),
    ability("Military Genius", {
      type: "class",
      description:
        "Commands the battlefield like a god of war: permanent +1 to strategic ability, leadership ability, and morale modifier when commanding troops. (JJ powers — Chosen)",
      effects: [
        effect("Military Genius", {
          changes: [{ key: `${K}.henchmanMorale`, mode: ADD, value: "1" }],
          condition: "ACKS-HENCHMEN.cond.commanding",
        }),
      ],
    }),
    ability("Inspire Courage", {
      type: "class",
      description:
        "A few moments of oration inspire up to 30 allies within 50': +1 to attack throws, AC, morale rolls, and saves vs. magical fear for 1 turn. Once per day per class level. (RR 106 — Bard)",
      effects: [
        effect("Inspire Courage", {
          changes: [{ key: `${K}.moraleRoll`, mode: ADD, value: "1" }],
          condition: "ACKS-HENCHMEN.cond.inspired",
        }),
      ],
    }),
    ability("Utter Domination", {
      type: "class",
      description:
        "The character's henchmen have base morale scores of +4 and no longer make loyalty rolls upon suffering calamities (mercenaries unaffected). (JJ powers — Zaharan Sorcerer)",
      effects: [
        effect("Utter Domination", {
          changes: [
            { key: `${K}.skipCalamityLoyalty`, mode: CUSTOM, value: "1" },
            { key: `${K}.moraleBase`, mode: ADD, value: "4" },
          ],
        }),
      ],
    }),
  ];
}

export function buildMacros() {
  const macro = (name, img, command) => {
    const id = did(`macro:${name}`);
    return {
      _id: id,
      _key: `!macros!${id}`,
      name,
      type: "script",
      scope: "global",
      img,
      command,
    };
  };
  return [
    macro(
      "Open Recruitment Board",
      "icons/svg/tavern.svg",
      `const locations = game.actors.filter((a) => a.type === "acks-henchmen.location");
if (!locations.length) return ui.notifications.warn("Create a Location actor first.");
(locations.find((l) => l.testUserPermission(game.user, "OBSERVER")) ?? locations[0]).sheet.render(true);`
    ),
    macro(
      "Post Recruitment Notice",
      "icons/svg/scroll.svg",
      `const locations = game.actors.filter((a) => a.type === "acks-henchmen.location");
if (!locations.length) return ui.notifications.warn("Create a Location actor first.");
acksHenchmen.openPostingDialog(locations[0]);`
    ),
    macro(
      "Loyalty Check (Selected)",
      "icons/svg/daze.svg",
      `const actor = canvas.tokens.controlled[0]?.actor ?? game.user.character;
if (!actor) return ui.notifications.warn("Select a hireling token first.");
acksHenchmen.openThrowDialog("hirelingLoyalty", {
  title: actor.name,
  actor,
  derived: { effectiveLoyalty: actor.system?.retainer?.loyalty ?? 0 },
});`
    ),
    macro(
      "Obedience Check (Selected)",
      "icons/svg/combat.svg",
      `const actor = canvas.tokens.controlled[0]?.actor ?? game.user.character;
if (!actor) return ui.notifications.warn("Select a hireling token first.");
acksHenchmen.openThrowDialog("hirelingObedience", {
  title: actor.name,
  actor,
  derived: { moraleScore: actor.system?.details?.morale ?? 0 },
});`
    ),
    macro(
      "Forgive Wage Arrears (Repair)",
      "icons/svg/heal.svg",
      `// Repair for worlds hit by the epoch-billing bug (pre-existing henchmen
// invoiced for every month since worldTime zero and hit with calamities when
// the bill bounced), or for a Judge simply writing off back wages: zeroes
// wage arrears, marks the loyalty penalties recorded for MISSED WAGES
// compensated so they stop counting — they stay in the roster ledger and can
// be restored from there (other calamities are untouched), fixes the calamity
// counters, and re-derives effective loyalty. Groups get their arrears zeroed
// too. Running it twice changes nothing the second time.
if (!game.user.isGM) return ui.notifications.warn("Only a GM can forgive wage debts.");
const selected = canvas.tokens.controlled.map((t) => t.actor).filter(Boolean);
const employers = selected.length ? selected : acksHenchmen.allEmployers();
if (!employers.length) return ui.notifications.info("No employers found.");
const names = employers.map((e) => e.name).join(", ");
const ok = await foundry.applications.api.DialogV2.confirm({
  window: { title: "Forgive wage arrears?" },
  content: \`<p>Forgive all recorded wage arrears and missed-wage loyalty penalties for the hirelings and units of: <b>\${names}</b>?</p>
    <p class="notes">Select employer tokens first to limit the sweep; with nothing selected it covers every employer in the world. Nothing is deleted — the forgiven penalties are marked compensated in each hireling's roster ledger, where you can restore them. Unit morale drops are left for you to judge.</p>\`,
  rejectClose: false,
});
if (!ok) return;
let hirelings = 0, groups = 0, gp = 0, calamities = 0;
for (const employer of employers) {
  const s = await acksHenchmen.forgiveWageDebts(employer);
  hirelings += s.hirelings; groups += s.groups; gp += s.arrearsGp; calamities += s.calamities;
}
ui.notifications.info(\`Forgiven: \${gp} gp of arrears across \${hirelings} hireling(s) and \${groups} unit(s); \${calamities} missed-wage calamity(ies) reversed.\`);`
    ),
    macro(
      "Repair Henchmen References",
      "icons/svg/repair.svg",
      `// Fixes the core acks 14.0.1 crash where a character sheet fails to render
// ("Cannot read properties of undefined (reading 'system')" in getTotalWages):
// a hireling was deleted while still listed on its employer.
if (!game.user.isGM) return ui.notifications.warn("Only a GM can repair actor references.");
const selected = canvas.tokens.controlled.map((t) => t.actor).filter(Boolean);
const scope = selected.length ? selected : game.actors.contents;
const preview = await acksHenchmen.repair.repairWorld({ dryRun: true, actors: scope });
if (!preview.repaired.length) {
  return ui.notifications.info(\`No dangling references found (\${preview.scanned} actor(s) scanned).\`);
}
const lines = preview.repaired.map((r) => "<li>" + acksHenchmen.repair.describeRepair(r) + "</li>").join("");
const go = await foundry.applications.api.DialogV2.confirm({
  window: { title: "Repair Henchmen References" },
  content: \`<p>Found dangling references on <b>\${preview.repaired.length}</b> of \${preview.scanned} actor(s):</p><ul>\${lines}</ul><p>Remove them?</p>\`,
});
if (!go) return;
const done = await acksHenchmen.repair.repairWorld({ actors: scope });
ui.notifications.info(\`Repaired \${done.repaired.length} actor(s). Re-open any sheet that was failing.\`);`
    ),
    macro(
      "Generate Followers (Selected)",
      "icons/svg/castle.svg",
      `const actor = canvas.tokens.controlled[0]?.actor ?? game.user.character;
if (!actor) return ui.notifications.warn("Select a 9th+ level character token first.");
acksHenchmen.openFollowersDialog(actor);`
    ),
    macro(
      "Recruit Monster (Targeted)",
      "icons/svg/pawprint.svg",
      `const employer = canvas.tokens.controlled[0]?.actor ?? game.user.character;
const monster = game.user.targets.first()?.actor;
if (!employer || !monster) return ui.notifications.warn("Select your character's token and TARGET the monster.");
const captured = await foundry.applications.api.DialogV2.confirm({
  window: { title: "Recruit " + monster.name },
  content: "<p>Was the monster defeated and captured (Irrefusable Offer, MM 351)? Choose No for a peaceful/market offer.</p>",
});
acksHenchmen.recruitMonster(monster, employer, { captured });`
    ),
    macro(
      "Advance 1 Week",
      "icons/svg/clockwork.svg",
      `acksHenchmen.time.advanceDays(7);`
    ),
    macro(
      "Process Recruitment Time Now",
      "icons/svg/regen.svg",
      `acksHenchmen.processAllLocations().then(() => ui.notifications.info("Recruitment postings processed."));`
    ),
  ];
}

/**
 * Pack contract for the synced tools/build-packs.mjs harness (see
 * acks-module-template): pack name -> document builder.
 */
export const packs = {
  "proficiencies-powers": buildProficienciesPowers,
  macros: buildMacros,
};
