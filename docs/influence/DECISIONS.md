# Influence & reactions — decision record

Why this feature is shaped the way it is. How it behaves *now* is
[MODEL.md](MODEL.md).

Entries are dated and append-only. A superseded entry stays, marked.

---

## 2026-09-02 — the attempt ladder and the wage ladder are imported, not shipped

**Ruled: both were IP leaks and are gone from the shipped artifact.**

`INFLUENCE_TIME_STEPS` paired six attempt rungs with six `ACKS-INFLUENCE.time.*`
strings, and `lang/en.json` ships. That is the wrong side of the line twice
over: a ladder of rungs a reader picks from is a TABLE OF OPTIONS, content
whatever it is made of, and the strings stated what the BOOK says rather than
what the FIELD does. `HENCHMAN_MONTHLY_WAGE` — a frozen array of printed prices
— sat in the same file and is fixed with it.

**What ships is the procedure, and only that.** An influence attempt can be
repeated; the first step is the initial reaction, which SETS an attitude rather
than shifting one; each later step is a further attempt; a bribe may be offered
and its size is keyed to what the target is worth. None of that is printed — it
is the rule being performed.

**What arrives registered** (`lib/tables.mjs`, doc `influence`):
`tables.attemptTime`, which carries how many rungs there are and what each
costs, and `tables.henchmanWage`.

**Degradation is honest, never invented.** With nothing registered the ladder
still runs: a rung is labelled by its own ORDINAL, a fact about this tracker
rather than a fact from a page, and no time is quoted because none is known.
`maxAttempt` is null in that state, so the tracker does not cap at a limit
nobody supplied, and the bribe fee is left blank for the Judge to name.

**Rejected: keeping the printed values as a fallback sample.** `lib/tables.mjs`
has forbidden that since the extraction program, and for this exact reason — a
fallback is how a printed table survives being registered.

**Cost:** a world that has not imported this table sees ordinals where it used
to see times, and an uncapped attempt counter. That is the shape the whole
family already has: the procedure ships, the numbers come from the GM's own
book.

---

### A stand-in power is claimed by the box it fills, and named once (2026-08-03)

Hotfix 1.3.2, completing the entry below. Claiming by NAME could not reach a
power standing in for a proficiency (`actsAs`), because such a power is named
for itself — "Command of Voice", never "Diplomacy". Four shapes exist and only
one leaked: a power whose effect carries the reaction change was already
claimed for its item, but one carrying `actsAs` and no change of its own, with
its number in the abilities model, ticked the box AND added its own row. So the
claim reads stand-ins too, gated by `CORE_PROFS` — the same list that ticks the
box, so a power standing in for anything else claims nothing and keeps its row.

The rename moved with it, from the view into the config. `#buildGroups` renamed
the box after the power while `#activeModifiers` localized the static label, so
the dialog said "Command of Voice" and the chat card said "Diplomacy
proficiency" about the same +1. One label, stamped once at build time, is read
by both. Holding the power AND the proficiency still shows the proficiency's
name: one non-stacking capability, called what the book calls it.

---

### A proficiency row wins over the same item's effects (2026-08-03)

Hotfix 1.3.1. A character holding Diplomacy opened the roller at **+2**, and one
holding Diplomacy and Mystic Aura at **+4**, where the book says +1 and +2.

One ability reaches the roller by three routes: `PROFICIENCY_MATCHERS` detects
it by name and fills a static checkbox, an Active Effect on it can speak, and
the abilities effect model can speak. The dual-source reader (phase 4, 0.11.0)
deduplicated the last two against each other and left the first out of it — and
those were the two that collided, because an audited content import gives
Diplomacy exactly the +1 its static row already offers, unconditional and
non-situational, so both arrived pre-ticked.

The static row wins, and the claim is settled per page:

- It carries the mechanic somebody read against the page; the effect row may be
  a machine draft.
- The mutually exclusive tone set is modelled on those rows (`exclusive` in
  `INFLUENCE_MODIFIERS`), so letting an effect row carry the bonus instead would
  let all three tone proficiencies stack again on the hiring page — undoing that
  rule by a route it cannot see.
- Per page, because which proficiencies get a row differs by page: Performance
  has one only on Seduction, and Beast Friendship, Folkways, Animal Husbandry
  and Bribery have none anywhere. Claiming by matcher key would delete their
  modifiers rather than deduplicate them — a silently missing bonus, which is
  the worse failure of the two.

Rejected: making the name match a fallback, the way the henchmen feature does it
(`collectEffectModifiers` recovers a named proficiency only when the item
carries no effect of its own). That is right where the name match has no other
home, and wrong here, where exclusivity, the bewitched kicker and the bribe fee
all hang off the static rows.

Unchanged by this fix: the roller still does not infer tone from an ability's
name. An effect declaring no `tones` is offered on every tone page, because tone
scoping is the authored spec's to state and not the roller's to guess.

---

### Sheet injectors gate on the document, never on `.actor` (2026-08-02)

The header button and the Notes-tab Relationships section resolve their subject
from `app.document`, and require it to be an Actor of type `character`. Reading
`app.actor` first — the previous gate — is what broke.

`renderApplicationV2` offers every ApplicationV2, and an owned Item's sheet
exposes `.actor` as its *owner*. So an owned item's sheet passed the character
test, and the Influence button was being injected into item sheet headers.
The same window then failed the Notes-tab lookup and tripped the one-shot
"no Notes-tab host found" warning, which latched for the rest of the session
and read as "the section never renders" — while the section was in fact
rendering correctly on every character sheet all along. The reported symptom
was the warning, not the feature.

Rejected: narrowing the hook registrations to `renderActorSheetV2` alone. The
three registrations exist so the system's minified sheet class name can change
freely, and the correct gate makes the broad hook harmless. This matches the
gate the equipment injectors already use.

A second guard follows from the same rule: a character sheet with no primary
tab strip (the Follower Card, this module's location sheet) has no Notes tab to
extend, and returns silently. Only a sheet carrying the strip is expected to
host the section, so only that case is worth warning about.

---

### Racial and cross-species reactions ship strict-RAW (2026-07-16)

Shipped as `racial.mjs` plus roller integration, compendium items and settings.

**No invented human/elf/dwarf penalty.** Core states none, so none is shipped.
Only cited mechanics: the Inhumanity tiers, the optional BTA caste effects,
type-scoped powers, and the hard-hatred notes.

**A campaign relations registry, and it is not symmetric.** A campaign registers
its own inhumanity matrix through a hook/setting and it auto-applies. Entries
need not be symmetric — dwarf→elf may differ from elf→dwarf, and forcing symmetry
would have made half the interesting cases unstateable.

Deltas from the original plan, both deliberate: the BTA caste effects ship gated
by the `enableBtaCaste` world setting (default on), and the relations row renders
as its own "Racial relations" group rather than folded into "Both".

**Out of scope, deliberately.** No automation of caste *clan* identity —
own-clan bonuses stay situational checkboxes, because the data model carries
no clan field. No forced auto-Hostile result for the MM's hard-hatred pairs
(dwarf↔goblin sentries, gnome↔kobold) — the roller adds a RAW note to the
chat card and leaves the call to the table, per the no-inventions policy.
Slavery, liberation and troop-scale racial availability stay with henchmen.

---

### Modifiers are offered, never asserted (founding)

The dialog is a recipe, not a rule. Situational modifiers are toggles the table
resolves, not silent additions, because whether a modifier applies is a judgement
about the fiction that the module is not in a position to make.

A mechanic not yet read against the printed page is badged **unaudited** in amber
rather than red: it is probably correct and is genuinely offered, and colouring
it as an error would be a stronger claim than the module can support in either
direction.

---

### An unknown is not a modifier (founding)

An `auto` source whose input cannot be resolved is **skipped**, not scored as
zero. Zero is a claim that the modifier applies and happens to be worth nothing;
skipping is the truthful statement that the module could not tell.

---

### Alignment is translated at the boundary, not renamed (founding)

This feature keeps its own alignment token set (`law` / `chaos` / `neutral` /
`other`), baked into published effect flags, and translates at its boundary to
the shared vocabulary's `lawful` / `neutral` / `chaotic`.

The shared library deliberately ships **no** `normalizeAlignment` fold: with this
feature translating at its own edge there is no live consumer for one, and a
primitive with no consumer is a dead primitive.

---

### The subject of an effect is carried, not folded in (founding)

The roller resolves ONE actor's social roll. An effect aimed at an opponent or an
ally is not a modifier on that roll, and storing it as one is exactly the
inversion the subject field exists to prevent. It is carried through rather than
discarded so an opposed mode can use it — see [../ROADMAP.md](../ROADMAP.md).

---

### The example proficiency compendium is retired as superseded, not as an IP leak (2026-07-19)

The 23 hand-built items in `packs/proficiencies` (Diplomacy, Intimidation,
Beast Friendship, the Inhumanity tiers, the BTA caste items, and the rest) are
unshipped: removed from the manifest, the repo, and the release artifact.

**Why removal, and why now.** Not because the content was unsafe — ACKS II
proficiency and class-power text used in-app is covered by the ACKS II App
License and was vetted as legitimate. It goes because the module is handing
this job to acks-lib + acks-abilities + acks-importer, and a module should not
keep shipping a placeholder compendium that its own successor exists to
replace — it invites a GM to install duplicate copies of abilities the
importer will bring in properly. Reference copies are kept at
`acks-rules/acks-influence/compendium-reference/` because the effect
*structures* remain the specification the importer's authored specs should
reproduce, kept out of the repo so no second copy drifts from what the
importer eventually produces.

**Rejected: framing it as IP remediation.** An earlier pass read this as a
leak and flagged `tools/ip-scan.mjs` for missing it under its prose-length
threshold. Wrong premise: app-licensed mechanical text belongs in packs, and
tightening the scanner to fire on ordinary item descriptions would raise false
positives on permitted content for no real gain.

**Git history purge is a hygiene pass, deferred until the replacement is
fully in place** — not urgent containment, and no reason to retract the
published `v0.9.1` asset in the meantime.

Functionally this was a real gap for a while: dropping the compendium with
nothing reading the abilities model yet would have blinded the roller to
every effect-granted modifier. That gap closed once influence grew a reader
for `flags["acks-extras"].extras.effects` (imported abilities now drive the
roller, unaudited entries badged and never pre-ticked); what remains is not
architecture but the importer's own audit sign-off burn-down, tracked in that
repo.

### Three morale subsystems, never conflated (2026-08-18, recorded from the 2026-07-19 correction)

ACKS has three morale subsystems that look alike and are not: **Monster
Morale** (RR 307-308, encounter scale — this feature's `morale` mode), **Unit
Morale** (RR 468, mass combat — formation's domain), and **Domain Morale**
(JJ, campaign — out of scope). **The RR 436 morale modifier (commander's CHA
+ Command + prowess) applies to the Unit table ONLY** — RR 436 says so
explicitly, and adds that it does not affect Unit Loyalty either. Adding it
to an RR 307 roll inflates every encounter morale check; this was mis-built
once before the extract corrected it. Monster Morale mechanics to hold:
2d6 + morale rating (−6…+4), bands 2−/3−5/6−8/9−11/12+, the seven suggested
modifiers come in **ladders, not sums**, no natural-2/12 clamp is stated
(unlike Hireling Loyalty, RR 166), and PCs never roll it — they choose.
Hireling Obedience (RR 167) is a fourth, separate morale-based roll.
Full text: LOCAL-ONLY extract `acks-rules/acks-influence/` §8.

### Stripping a printed magnitude from a label without migrating its constant is a regression (2026-09-03)

**Ruled:** the pass that removed every page citation from `lang/en.json`
stopped at the citations and left the printed magnitudes standing — "Apparent
level difference (−1 per level)", "Judge's adjustment (±2)", the 25
`ACKS-INFLUENCE.mod.*` labels of ROADMAP §1 and the 22 `ACKS-HENCHMEN` ones
beside them.

**Why, given the doctrine puts both on the far side of the line.** For these
rows the label is the *only* disclosure. The number in the parentheses is not
a second copy of a constant the user could otherwise see; it is the sole place
the applied figure is stated, and the code applies it either from a hard-coded
constant or from a value the row pre-fills. Deleting the parenthesis therefore
does not stop a printed number reaching the reader — it stops the reader
learning which number is being applied to their roll. The label and the
constant have to move together: the row loses its magnitude in the same change
that makes the magnitude arrive registered, so a world with no imported table
shows no figure and says so, and a world with one shows the reader's own.

**What it cost.** A release that removes every citation still ships the
magnitudes, so `ip-scan` reporting clean is not the same as the feature being
clean, and this entry is the standing reason. The order is forced, not
preferred — the alternative ships a UI that silently applies undisclosed
printed numbers, which is worse than one that prints them.

**Amended the same day.** The citation half was reversed by owner ruling
(template `DECISIONS.md`, 2026-09-03): a page reference reproduces nothing and
ships. 6.3.0 therefore keeps every reference it had and removes only the
figures beside them. That strengthens this entry rather than weakening it — a
label reduced to "Apparent level difference (RR 168)" still tells the reader
where the applied figure is printed, which is the disclosure the magnitude was
carrying. The magnitudes still have to move together with their constants; the
reference is what makes their absence survivable in the meantime, and the 22
`ACKS-HENCHMEN` labels below have no reference to fall back on because they
never carried one.
