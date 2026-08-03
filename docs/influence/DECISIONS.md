# Influence & reactions — decision record

Why this feature is shaped the way it is. How it behaves *now* is
[MODEL.md](MODEL.md).

Entries are dated and append-only. A superseded entry stays, marked.

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
