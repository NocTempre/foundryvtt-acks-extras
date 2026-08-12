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

## A hoard nobody owns yet

Storage is owner-attributed by construction: `storageFlagOf` stamps whose a row
is, `storedItems` lists only stamped rows, and the sheet buckets them by owner.
So there is no way to stock a place with treasure that belongs to nobody —
a Judge filling a bugbear lair ahead of the session has no owner to file it
under, and `_onDropItem` refuses a sidebar or compendium item for exactly that
reason. The ruling and the alternatives weighed are in
[DECISIONS.md](DECISIONS.md) (2026-08-11).

The workaround is a placeholder character to hold the hoard until the party
takes it, which works and is what field reports describe people doing.

What is missing is a **house pile**: an owner slot that is the place itself
rather than a character. The pieces it would have to answer for —

- Who may retrieve from it. Attribution currently decides which rows show a
  Retrieve button; an unowned bucket has no such answer and would need one
  (GM-only, anyone present, or a lock the Judge sets).
- What the delete policy does with it. `storageDeletePolicy` returns goods to
  their owners; a pile with no owner has nowhere to be returned TO, so it needs
  either a designated inheritor or an explicit "lost with the place".
- Whether it is a third owner kind or the absence of one. A sentinel owner uuid
  keeps every existing bucket-by-owner path working unchanged; a nullable owner
  touches every reader.
