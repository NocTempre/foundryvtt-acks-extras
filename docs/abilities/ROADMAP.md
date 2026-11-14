# Abilities — not built

Re-issued 2026-11-14.

Work that is designed but absent, deliberately. How the feature behaves now is
[MODEL.md](MODEL.md); why it is shaped that way is [DECISIONS.md](DECISIONS.md).

---

## Typed modifiers: what is left

Built: standing and gated rows apply (MODEL, "Imported modifiers apply").
Not built:

- **The scan backlog.** 34 entries still carry a scan-read modifier on a field
  the sheet writes (43 rows: 13 save, 9 surprise, 8 initiative, 8 AC, 4 attack
  throw, 1 damage). Each wants a register recipe that
  says whether the row is standing, gated or situational; until then it
  applies and reads "unverified". Deferred by the orchestrator's ruling of
  2026-11-04, since those rows apply and are marked. Recount with the shipping
  executor over `cookbook/{proficiencies,powers,skills}.json`.
- **Roll-time scope (S6).** A row narrowed to a kind of opponent, an
  alignment, a tone or one activity is listed "at the roll" and applied by no
  roll yet; a quick effect is the Judge's route meanwhile.
- **An orphaned quick effect.** When Update Abilities changes a row, its quick
  effect no longer matches any row (it is found by the row's content key), so
  the row offers Start again and the old effect stays until deleted by hand.
- **Caps and sets.** A `modifies` row with `mode: "set"` (a cap on another
  ability's contribution while armoured) is listed "not applied".
- **Exclusions the page states in prose**, such as a bonus that does not hold
  while casting, are not modelled; the row is standing.
- **Opponent surprise.** A row that raises the opponent's surprise
  (`appliesTo: "opponent"`) is listed, never written to `surpriseothers`.
- **Encumbrance-only changes.** Picking up a non-wearable item changes the
  load a `lightlyEquipped` gate reads but does not rebuild the loadout; the
  next equip, level change or flag write does.
- **Retry limits.** A thief skill's retry limit (Searching, Trapbreaking) and
  a proficiency throw's (Tracking, Animal Husbandry) are shown and not
  enforced: no primitive counts tries.
- **Outcomes the Judge applies.** What some proficiency throws yield (Alchemy,
  Arcane Dabbling, Trapping) is left to the Judge; the roll card does not
  name it.

## Turning undead: the borrowers

The crusader's Rebuking Undead ladders import and the rebuke's throws are
built. The entries that read the same table at a fraction of their own level
are the importer's remaining work, tracked in
[../importer/ROADMAP.md](../importer/ROADMAP.md), "Rebuking undead: the
borrowers' own recipes".

## Shared level tables: what is left

- **An unresolved pick still says nothing** — the sheet now offers only picks
  the mechanics resolve, so the common way to acquire a dead selection is gone.
  Free text stays free, though, and `abilities-bridge.mjs` still skips a pick
  `resolveStylePick` cannot place without reporting it. That file is
  deliberately Foundry-free and logs nothing, so surfacing it means carrying
  unresolved picks out in the collector's return for a consumer to show, rather
  than warning from inside.
- **Vocabularies for the open families** — Art/Craft, Profession, Labor and
  Performance offer the entries core's pack happens to name, which are examples
  rather than the book's full lists; Knowledge and the language families have no
  shortlist at all and fall through to free text. Filling them means reading the
  lists off the page, which is importer work on the `kind.proficiency` register
  rather than a table hand-typed here.

  Those four ship EMPTY: a shipped example list would be a value read off a
  page ([DECISIONS.md](DECISIONS.md)). The seam they fill
  through exists (`acks.selectionVocab`); the producer that reads them from the
  GM's book is the remaining work, and until it lands free text is the surface.
- **The closed families' LABELS are still repo text.** Their keys are identifiers
  the loadout and combat rules branch on and must exist in code, but
  `"Weapon & Shield"` and `"Knock Down"` are display strings taken from the page.
  They are a far smaller surface than a list of professions and they name
  mechanisms rather than setting content, which is why they were left standing;
  whether the label too should arrive by import, leaving code holding only the
  key, is not decided. Deciding it means agreeing where a rules term stops being
  a rules term and starts being quoted text.

## One rank model

Two conventions record how many times a character took an ability, and they
disagree. Chargen grants rank N as N same-named copies, and `rankOf()` reads
rank by counting them; `extras.qty` records a count on one item, which the
sheet displays and nothing reads as rank. What a second take MEANS is
per-ability — a deeper rank for some, a second pick for others
(`selections`).

Designed and absent: holding one ability by two routes may read as rank 2
without becoming a second copy. An alias or variant that grants a rank of
another ability is absorbed by that root, leaving the root's own count alone,
so the mechanics read the count plus every granted rank. The two numbers
answer different questions — how often it was taken, and what it reads at.

## A throw that states what it costs in time

Nothing records how long an ability's throw takes. The party's checks already
state the unit they spend (`consumesRound` and `consumesTurn` in
`scripts/formation/party-rolls.mjs`), but an ability's roll definition, read
through `scripts/abilities/ability-rolls.mjs`, carries no time, so using the
ability spends none the module can see. Not built: a structured time cost on
the roll definition, stated in the unit vocabulary the turn plan spends
([formation ROADMAP](../formation/ROADMAP.md), "The turn plan"), with the
imported figure where the book prints one.

## A throw whose outcome the player cannot know

An ability rolled through `rollAbility` posts one card to one audience, so a
roll like hiding, whose result the player cannot know, shows its result to the
roller. Not built: a per-throw secrecy setting on the roll definition that
posts a public notice naming the actor and what was attempted, and whispers the
result to the Judge. It needs one shared owner of the chat-visibility policy in
lib (the initiative, surprise and influence cards each spell the Judge test and
the split their own way), and `stats-map.mjs` writes `blindroll: false` on
every imported proficiency, so a recipe-side flag comes with it.
