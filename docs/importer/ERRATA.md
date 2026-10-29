# Errata

Printing errors in the books this module imports, and what the importer does
about each. An entry names the book, the page, and the rows or records it
corrects by ordinal and key number, never by what the page prints. The words
and figures still come from your own copy at import, read past the error.

A place the importer corrects carries a note naming the entry, with a link that
opens the printed page.

Each heading is the id the importer's register declares (`meta.errata` on a
grid, `meta.gridClassErratum` on a record). The register lint refuses an id
this file does not define.

## ax3-p223-offset

- **Where:** AX3 p.223 (PDF page 225), the second regional demand grid. Rows
  are numbered by market across both grids, so this page holds rows 14–25,
  and the error is in rows 21–25, its last five.
- **The error:** from row 21 on, the figures fall out of step with the market
  names by one row. Each of rows 22–25 carries the figures of the market named
  on the row above it. Row 21 carries the figures of the market at site 29,
  which the grid does not name. Site 44's market is named on row 25 and has no
  figures on the page.
- **What the importer does:** reads row 21's figures onto site 29's place, and
  each of rows 22–25 onto the market named one row above it (sites 34, 36, 42
  and 43). It writes no figures from this page for site 44's market. On a
  world imported before the correction, it moves the base demand and class
  this page wrote onto the right market. It also clears them from site 44's
  market. A base or class from another book, or one you set yourself, stays.
- **Evidence:**
  - AX1 prints three of these markets in a grid of its own. Its column for
    site 34 matches row 22 in 31 of 31 cells, the one for site 36 matches row
    23, and the one for site 29 matches row 21, each 31 of 31. Two rows
    holding different markets match in a median of 8 of 31 cells (90th
    percentile 18, highest 28).
  - AX3's domain record for site 34 (p.30) prints the class of row 22, not row
    21. Its urban families fall in that class by the families bands of RR
    ch. 8.
  - Nothing above row 21 is shifted. AX1's columns for sites 28 and 22 match
    their own rows, 31 of 31, and row 20's record agrees with its row.
  - A second printing attests only the steps from row 21 to 22 and from 22 to
    23. Rows 24 and 25, and site 44 having no figures, follow from the pattern
    and have not been checked against another printing.
- **Ruling:** `docs/markets/DECISIONS.md`, 2026-10-28, "AX3's demand grid is
  corrected as printing errata".

## ax3-p222-class

- **Where:** AX3 p.222 (PDF page 224), the first regional demand grid: the
  class cell of row 6, beside the name of site 9's market. That market's
  domain record is on AX3 p.29.
- **The error:** the grid's class cell disagrees with the domain record.
  The record's urban families fall in the record's class by the families
  bands of RR ch. 8, and not in the grid's. No row from 4 to 8 carries the
  record's class, so this is a single cell and not a shift.
- **What the importer does:** imports the record's class, as it does for any
  record that disagrees with its grid row, but does not warn about this one.
  The place carries a note naming this entry.
- **Ruling:** `docs/markets/DECISIONS.md`, 2026-10-28, "AX3's demand grid is
  corrected as printing errata".
