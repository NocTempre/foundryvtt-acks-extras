# Abilities — not built

Work that is designed but absent, deliberately. How the feature behaves now is
[MODEL.md](MODEL.md); why it is shaped that way is [DECISIONS.md](DECISIONS.md).

---

## Turning undead: the importer half

The module now performs the whole of RAW — a per-undead-type ladder whose top
rungs need no throw, read at a fraction of class level, followed by the measure
that says how many Hit Dice are affected — but nothing IMPORTS it. Every part is
typed by hand.

`def.power.rebukeUndead` ships its name and description and nothing else, and
the Crusader Rebuking Undead grid is not among the tables the importer extracts.
The remaining work is all in `foundryvtt-acks-importer`:

1. **A table recipe on the crusader** for "Crusader Rebuking Undead" (RR p.39).
   It needs no transposed grid mode: its label column is the undead type and its
   column headers are the crusader's levels, which is the shape
   `compile-cookbook`'s reader already takes. Fourteen tight single-digit
   headers will land on the header-span fallback, as the Nobiran's dual spell
   groups do.
2. **A binding that turns those rows into ladders** — one per undead type, keyed
   off the row label. The cell rule is structural and needs no printed letter in
   the recipe: a cell that parses as a number is a target, a dash is `none`, and
   anything else non-empty is `auto` with the cell carried through as `text`.
3. **A roll-spec form that expands per published ladder**, since the throw count
   is data — nine undead types, and a Judge's own book may print another. Plus
   one `measure` spec for the 2d6.
4. **The borrowers**, which extract nothing new. Several classes and one
   proficiency rebuke or control undead off the crusader's table at a fraction
   of their own level; each is the same `progression` target pointing at the one
   published table, differing only in the fraction and its rounding. Both of
   those are printed, so both are read from the page — the target carries a
   numerator and a denominator, not a key into a list of fractions.

## Shared level tables — the ladder half

The `progression` kind now resolves: the classes registry publishes every
class document's attack bands, `resolveLevelValue` completes lib's resolver
through them, and the roll editor's picker names the four chassis or any
class the world holds instead of retyping rungs.

**Shipped 4.8.0:** a `progression` target can now name a published LADDER (a
thief-skill column, a house table) as well — the roll editor offers the
ladders the named class publishes, blank keeping the attack bands. The
internal table stays regardless — a throw whose ladder is its own is the
common case, and a shared table is an alternative source for the same target,
not a replacement for typing one. Nothing on this row remains open.
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

  **Updated 2026-08-14:** those four now ship EMPTY — the "examples" were a value
  read off a page and are gone ([DECISIONS.md](DECISIONS.md)). The seam they fill
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
