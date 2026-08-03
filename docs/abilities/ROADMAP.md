# Abilities — not built

Work that is designed but absent, deliberately. How the feature behaves now is
[MODEL.md](MODEL.md); why it is shaped that way is [DECISIONS.md](DECISIONS.md).

---

## Shared level tables

A level table is **internal** today: its rungs live on the throw that uses them,
typed in that throw's window. That is the right home for a table only one
ability reads, and the wrong one for the tables several abilities share — the
thief-skill ladders, the class attack progressions, a house table a Judge wants
every custom power to key on. Those get re-typed per ability today, and drift.

The seam is already in place and unused:

- `levelValueField()` carries a **`progression`** kind whose meaning is "read
  this off a table named elsewhere" (`as` + `atLevel`). `resolveLevelValue`
  returns null for it — by design, it is the caller's job to resolve — and no
  caller does, so a `progression` target shows its progression rather than a
  number.
- `lib/tables.mjs` is the registry such a table would come from: documents
  addressed by id, layered SAMPLE → CATALOG → WORLD → OVERRIDE, so a table
  shipped by a content module, imported into a world, or tweaked by a Judge all
  answer the same read without any ability knowing which layer won.

What is missing between them is the resolution step (`progression` → a table id
→ `getDoc`) and a picker in the roll editor that names one instead of typing
rungs. Neither is built, because nothing yet publishes a table for it to pick
and a picker with an empty list teaches the wrong thing about where tables come
from.

The internal table stays regardless — a throw whose ladder is its own is the
common case, and a shared table is an alternative source for the same target,
not a replacement for typing one.

## Reordering throws

Throws present in the order they were added. An ability whose book prints them
in another order has to be retyped to match. Ordering is not stored, so this is
a field before it is a control.
