# Locations — not built

Work that is designed but absent, deliberately. How the feature behaves now is
[MODEL.md](MODEL.md); why it is shaped that way is [DECISIONS.md](DECISIONS.md).

---

## A private notes field the party cannot read

`system.notes` is the place's shared record: every viewer reads it, and anyone
who owns the location writes it ([DECISIONS.md](DECISIONS.md), 2026-08-05). That
leaves a Judge with nowhere on the sheet to keep what a place *actually* is — the
faction that really owns the inn, what the cellar door is hiding — and a journal
entry is the current answer.

A second field would need a schema addition and its own gate, which is a minor
rather than a patch. The shape to prefer is one more `HTMLField` beside `notes`,
rendered only inside the sheet's existing GM region, so the two are visibly
different records rather than one field whose audience depends on a setting.

---

## A notes cell for occupants and special hires

Two row types carry a `notes` string that a caller can already write and nobody
can read. `occupantRow()`'s option bag fills `roster[].notes`; `addSpecialHire()`
fills `market.specialHires[].notes`; neither table on the location sheet has a
cell for either. Why this garrison is billeted here, what the party promised the
NPC they found in the ruins — the storage exists, the surface does not.

The roster table (`location-sheet.hbs`, the "Who is here" block) shows portrait /
name / kind / quantity / actions; the special-hires table shows name / origin /
decision window / refusals. A note belongs as a tooltip or an expanding cell
rather than a sixth column, because most rows will never carry one.

Two constraints the implementation inherits from the surrounding model:

- The roster merges stored rows with derived scene tokens, and only a STORED row
  can hold a note — a derived row is a live observation that disappears when the
  token walks away. The control appears on pinned rows only.
- `hidden` gates roster display for players, so a note on a hidden row is hidden
  with it. That is the same UI convention the rest of the roster follows, not a
  security boundary.

Until this lands the fields are write-only; the ruling that keeps them rather
than deleting them is in [DECISIONS.md](DECISIONS.md) (2026-08-05).
