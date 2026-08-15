# Abilities — not built

Work that is designed but absent, deliberately. How the feature behaves now is
[MODEL.md](MODEL.md); why it is shaped that way is [DECISIONS.md](DECISIONS.md).

---

## Shared level tables — the ladder half

The `progression` kind now resolves: the classes registry publishes every
class document's attack bands, `resolveLevelValue` completes lib's resolver
through them, and the roll editor's picker names the four chassis or any
class the world holds instead of retyping rungs.

What remains is naming a published LADDER (a thief-skill column, a house
table) rather than an attack progression — the registry publishes them
(`acks.class.<key>`), but the `progression` target's vocabulary only reaches
the attack table today. The internal table stays regardless — a throw whose
ladder is its own is the common case, and a shared table is an alternative
source for the same target, not a replacement for typing one.
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
