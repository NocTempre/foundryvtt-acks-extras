# Looking a rule up — cheapest source first (canonical)

The moment any task turns on "what does the book actually say", the order is
fixed. Do not open a 98 MB PDF to answer a question grep can answer.

**The library's full holdings are indexed in `C:\Proj\acks-reference\README.md`
— read it before concluding a source does not exist.** The order below covers
the three core books; the library holds more (the **System Compatibility
Guide** — the canonical source for CONVERSIONS, with a greppable
`_structured.json` beside it — plus Treasure Tome, By This Axe, AXIOMS, the
ACKS I line, adventures). A question about converting older-edition or OSR
material starts at the Compatibility Guide, not at the core books.

1. **`C:\Proj\acks-reference\WIKI-SNAPSHOT\`** — the fan wiki captured whole,
   `<book>/html/<slug>.html` raw beside `<book>/md/<slug>.md` extracted. It
   covers all three core books: `rules/` = **RR** (16 sections), `judges/` =
   **JJ** (24), `monsters/` = **MM** (297). The markdown is greppable and
   **preserves the structure PDF text extraction destroys** — table cells,
   row boundaries and paragraph breaks survive instead of collapsing into
   run-ons. That is what makes it a **validation oracle**: you can check the
   *shape* of a grid — column count, row boundaries, which cell holds which
   value — against something the PDF layer cannot tell you. (It validates
   structure, never spacing: real extraction welds words together; write
   seams as `\s*`, not `\s+`.)
2. **`C:\Proj\acks-rules\<feature>\RULES.md`** and the owning module's
   `docs/<feature>/MODEL.md` / `DECISIONS.md` — rulings this family already
   made. A "maybe intentional" report is usually answered here, not in a book.
3. **`C:\Proj\acks-reference\ACKSII\*.pdf`** — **only** where 1 and 2 both
   have a gap, or when explicitly asked to double-check the printed page.

The snapshot is a derived fan compendium, so on a genuine conflict **the
printed page wins**. It is LOCAL-ONLY on the same footing as `acks-rules`:
never into a repo, a commit message or a changelog. Cite book/chapter/section,
never a snapshot path. When diffing extraction against the importer, compare
`cookbook/*.json` (compiled ops), **not** `register/rr/*.json`, whose declared
column headers drift from what the compiler actually emits.
