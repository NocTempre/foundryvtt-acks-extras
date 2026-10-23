# Henchmen — Roadmap

What is not built. How it behaves now is [MODEL.md](MODEL.md); why is
[DECISIONS.md](DECISIONS.md).

- **A relationship map / graph view** over attitude (character → character)
  and slander (party/character → location), rendered as one navigable web.
  **Integration first**: adopt or feed a maintained community graph module
  (Foundry Graph was the leading v14-verified candidate as of 2026-07-23)
  before building a bespoke viewer, and treat it as a **projection** of the
  existing stores, never a second source of truth — a bespoke D3/SVG viewer
  in this feature is the last resort, only if no candidate grows a
  data-driven write API.

- **22 `ACKS-HENCHMEN` strings still print a magnitude in the label** — the
  outcome hints (`outcomeHint.hesitate`, `.grudging`, `.fanatic`,
  `.begrudging`, `.acceptElan`, `.refuses`, `.refuseSlander`), the modifier
  labels (`mod.oppositeAlignment`, `.customaryTask`, `.recentCasualties`,
  `.mercenaryAdventuring`), `cond.threats`' HD threshold,
  `posting.commissioned`, `posting.classLevelHint`, `followers.loyaltyDefault`,
  `followers.loyaltyFanatic`, `card.insist`, and
  `monster.feigned.escape`'s band. The 2026-09-03 pass retired printed figures
  from 21 sibling strings in this root and deliberately left these; the reason
  and the order the fix has to take are one ruling, in
  [../influence/DECISIONS.md](../influence/DECISIONS.md). Unlike those 21 these
  carry no page reference at all, so once a magnitude goes the reader has
  nowhere to look it up — retiring one here means leaving a reference behind
  it. `posting.created`,
  `card.downedNote` and `roster.calamityPlaceholder` are not in the set —
  their figures are world-computed interpolations or the zero point.

- **Loyalty penalty magnitudes arrive through the importer.** `WOUND_PENALTIES`
  in `rules/loyalty.mjs` ships the printed magnitudes (RR 166). The agreed
  shape (2026-09-23): a `throws` value table filled by an importer recipe and
  read through a throw-values reader; with the table absent, the roster's
  penalty prompt names the missing table and disables the unpriced kinds;
  tampering penalties stay permanent, with a Judge override that lifts an
  entry and a reset; it ships as a hotfix. The first `throws` import would
  freeze the sample automation into the world layer, so the same change makes
  the import merge over the written layer only, makes picker presence read the
  world layer, and lists only world and override tables in the journal.
- **Utter Domination's morale base has no located value.** `moraleBase` is
  read only from an Active Effect; the importer register carries no locator
  for it, and the page's figure is a floor rather than a bonus, so the shape a
  typed effect would take (an override, or an upgrade to the figure) wants a
  ruling before the locator.
- **A Judge cannot give a non-character employer a henchman limit.** The limit
  is the imported base plus a Charisma modifier, and a monster carries no
  Charisma score, so a monster leading henchmen has none, and the manual
  `retainBonus` flag only adds to a limit that exists
  ([DECISIONS.md](DECISIONS.md), 2026-10-23). A Judge-set Charisma modifier
  or limit, from a flag or an Active Effect, would close the gap.
- **Three reads have nothing to feed them.** `tools/validate-producers.mjs`
  waives each against this entry until a recipe writes it or the read goes:
  - **Followers ruledata has no producer.** The followers dialog reads a
    `followers` document (troop types, followers by class, companion levels,
    follower loyalty) and stays disabled until it is imported, and no recipe
    reads it off a page, so no import ever enables it.
  - `wages.mercenaryOfficers`: an officer's morale modifier and command level
    (`engine/hire-group.mjs`) read rows no `wages` recipe writes, so both take
    their fallbacks.
  - `people.classRegistry`: `classInfo` (`rules/identity.mjs`) prefers an
    imported registry that no recipe writes, so the derived entry is what
    every world gets. Retire the read or add the recipe.
- **Hire as Group makes no hiring roll.** The unit dialog takes troops and an
  officer straight onto the employer's books, where an offer through the Hire
  button rolls each head's reaction (RR 162; [MODEL.md](MODEL.md) §2, "Bulk
  rows"). The unit's heads would answer the same way before the stack is made.
- **A handed-over payday refused in part does not tell the asking seat who
  went unpaid.** Its answer is `paid` and carries no refusal, so the one
  notification names only what moved ([MODEL.md](MODEL.md) §4c). The answer
  would carry the unpaid entries as a payday refused whole does, and the
  paid notification would name them.
