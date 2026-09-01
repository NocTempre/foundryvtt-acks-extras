/**
 * PoC recipe set: WHERE prose lives, never the prose itself. Each recipe is a
 * pointer (book, 1-based PDF page, heading anchor) plus how the heading is
 * typeset:
 *   mode "display" — large display heading (TrajanPro, >=12pt): proficiencies,
 *                    monster entries.
 *   mode "runin"   — 9pt bold run-in entry ("Grappling Hook:"); the extractor
 *                    self-calibrates the bold font from the matched heading,
 *                    so no font names are hardcoded.
 *
 * A recipe is read at the moment its document is created, and what it read is
 * written into that document with its citation — the recipe is the route to the
 * text, never a copy of it.
 */

export const RECIPES = [
  // One monster (Monstrous Manual)
  { id: "mm.griffon", book: "mm", page: 171, mode: "display", heading: "GRIFFON", cite: "MM PDF p. 171", kind: "monster", name: "Griffon" },

  // One page of proficiencies (Revised Rulebook, PDF p. 110)
  // payload = the modules' MECHANICAL interpretation (embedded math — ships;
  // it is not in the book and cannot be extracted). Demo: +1 initiative.
  {
    id: "prof.combatReflexes", book: "rr", page: 110, mode: "display", heading: "Combat Reflexes",
    cite: "RR PDF p. 110", kind: "ability", name: "Combat Reflexes",
    payload: {
      effects: [
        {
          name: "Combat Reflexes",
          img: "icons/svg/aura.svg",
          transfer: true,
          disabled: false,
          changes: [{ key: "system.initiative.mod", mode: 2, value: "1", priority: 20 }],
        },
      ],
    },
  },
  { id: "prof.blindFighting", book: "rr", page: 110, mode: "display", heading: "Blind Fighting", cite: "RR PDF p. 110", kind: "ability", name: "Blind Fighting" },
  { id: "prof.berserkergang", book: "rr", page: 110, mode: "display", heading: "Berserkergang", cite: "RR PDF p. 110", kind: "ability", name: "Berserkergang" },
  { id: "prof.combatFerocity", book: "rr", page: 110, mode: "display", heading: "Combat Ferocity", cite: "RR PDF p. 110", kind: "ability", name: "Combat Ferocity" },

  // One page of items (Revised Rulebook, PDF p. 145 — run-in entries)
  { id: "item.grapplingHook", book: "rr", page: 145, mode: "runin", heading: "Grappling Hook:", cite: "RR PDF p. 145", kind: "item", name: "Grappling Hook" },
  { id: "item.herbWolfsbane", book: "rr", page: 145, mode: "runin", heading: "Herb, Wolfsbane:", cite: "RR PDF p. 145", kind: "item", name: "Herb, Wolfsbane" },
  { id: "item.holyBook", book: "rr", page: 145, mode: "runin", heading: "Holy Book:", cite: "RR PDF p. 145", kind: "item", name: "Holy Book" },
];

