# Henchmen — Roadmap

Re-issued 2026-11-14.

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

- **The settlement-alignment rarity shift is a module inference.**
  `RARITY_AUTOMATION` in `data/throws-data.mjs` ships one rarity step for a
  directed class search that meets an opposed-alignment settlement; the
  location sheet's alignment field (`settlementAlignment` in
  `scripts/location/data/location-data.mjs`) feeds it. No page prints the
  step, so it needs a ruling: keep it as a Judge-set number, or retire it with
  the field.
- **The followers card names the page and shows no starting figures.** The
  dialog (`apps/followers-dialog.mjs`) picks the fanatic or the default
  line from the `followerLoyalty` table's class list and prints each as a
  field name with its page; the starting loyalty, morale and calamity rule
  they point at arrive when a followers recipe exists (next entry).

- **Loyalty penalty magnitudes arrive through the importer.** `WOUND_PENALTIES`
  in `rules/loyalty.mjs` ships the printed magnitudes (RR 166). The agreed
  shape (2026-09-23): a `throws` value table filled by an importer recipe and
  read through a throw-values reader; with the table absent, the roster's
  penalty prompt names the missing table and disables the unpriced kinds;
  tampering penalties stay permanent, with a Judge override that lifts an
  entry and a reset. The first `throws` import would
  freeze the sample automation into the world layer, so the same change makes
  the import merge over the written layer only, makes picker presence read the
  world layer, and lists only world and override tables in the journal.
- **Loyalty figures still in source beside the imported ones.** The
  calamity and level-gain loyalty changes in `engine/events.mjs` are printed
  in the same list `influence.loyaltyChanges` reads (RR 166), so each is one
  more row of that recipe. The signing-bonus option values in
  `data/throws-data.mjs` are the same kind as the bribe tiers the influence
  roller now imports. The `judgeAdj` stepper's bounds want a ruling on whether
  they are printed before they move.
- **The liberation loyalty throw opens from nowhere.** `throws-data.mjs`
  still declares `liberationLoyalty`, no surface opens it, and no page for its
  figures has been found; it is wired to a page or removed.
- **The insist tooltip has two states.** A Judge's override of the insist
  penalty reads as imported; the third state (`ui-tooltips.md`) names the
  override.
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
- **Two reads have nothing to feed them.** `tools/validate-producers.mjs`
  waives each against this entry until a recipe writes it or the read goes:
  - **Followers ruledata has no producer.** The followers dialog reads a
    `followers` document (troop types, followers by class, companion levels,
    follower loyalty) and stays disabled until it is imported, and no recipe
    reads it off a page, so no import ever enables it.
  - `wages.mercenaryOfficers`: a mercenary officer's own morale modifier and
    command level (`engine/hire-group.mjs`, `rules/wages.mjs`
    `officerMoraleModifier`) read rows no `wages` recipe writes, so the
    modifier is null and the level takes the employer's. A marshal's or master
    mariner's modifier reads the imported `wages.officerMorale` figure.
- **Hire as Group makes no hiring roll.** The unit dialog takes troops and an
  officer straight onto the employer's books, where an offer through the Hire
  button rolls each head's reaction (RR 162; [MODEL.md](MODEL.md) §2, "Bulk
  rows"). The unit's heads would answer the same way before the stack is made.
- **Result hints name the result and cite the page, and show no text
  (T-0512).** The throw card's `outcomeHint` strings for the hiring,
  Irrefusable Offer and Hireling Loyalty results carry the result's name and
  its page reference only. Not built: an importer recipe that captures each
  result's printed text from the Judge's own copy, shown beside the name when
  imported. The influence roller's result labels are the matching row in
  [../influence/ROADMAP.md](../influence/ROADMAP.md) §5.
- **Apparent level from an adventurer's spending.** Not built: an optional
  world rule, off by default, under which a hireling's loyalty checks read the
  level an employer's monthly spending implies (RR 173) beside the level the
  employer holds. It wants a setting that gates a read of the imported wage
  ladder in the loyalty roll, and a tooltip on the roll naming which level
  answered.
- **The command capacity ships its figures.** `lib/group-logic.mjs`
  `platoonCapacity` returns a capacity by commander level (RR p. 169), and the
  group's `troopStrength` (`lib/data/group-data.mjs`) is the measure it is
  compared with; Hire as Group reads the strength. The figures are printed
  and each is a literal in source. They want a recipe and a Judge-editable
  override, with nothing shown where nothing is imported. The 1st-level figure
  is an interpretation (`docs/lib/DECISIONS.md`).
- **A people's caste names are printed names in identifiers.**
  `importer/table-recipes.mjs` `dwarvenCastes` carries the castes' names in its
  merge keys, order and labels, and `rules/identity.mjs` `generateOccupation`
  reads them. Under the name rule (`.claude/rules/ip-doctrine.md`) they want
  neutral labels, ids built from an ordinal and a locator, with the names
  arriving at import.
- **A market hire's morale base is a stored zero.** `engine/hire.mjs` `hire`
  writes `morale.base` as 0 where no caller passes one, and the record's field
  (`data/henchman-record.mjs`) cannot be empty, so core's own morale field is
  never read for a market hire (`rules/loyalty.mjs` `effectiveMorale`,
  `rules/service.mjs` `moraleParts`). The page prints a base by hireling kind
  (RR p. 166). First the field becomes nullable and a mercenary takes the base
  its troop type imports; then the specialists' bases are read from the
  paragraph the `levelMorale` and `officerMorale` recipes window, and a
  henchman's stays empty and falls back to core's field.
- **A hire's starting loyalty is a stored zero.** `engine/hire.mjs` and
  `engine/monster.mjs` call `startingLoyalty` with a base no caller passes; the
  page prints the start by kind (RR ch. 4, Hirelings Loyalty), and the
  mercenary-officer figure the `baseLoyalty` recipe reads (RR p. 171) never
  reaches a hire.
- **Blank figures that have no page reference yet.** Fields left blank when
  nothing is imported carry a page-reference tooltip only where one was
  written. These carry none, and each needs its page looked up:
  `ACKS-HENCHMEN` `service.tip.shareUnimported`, `roster.limitNotImported`, and
  the unread and not-imported badges (the influence feature's matching row is
  in [../influence/ROADMAP.md](../influence/ROADMAP.md)).
