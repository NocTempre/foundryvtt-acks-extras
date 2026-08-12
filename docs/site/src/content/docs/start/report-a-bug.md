---
title: Report a bug
description: Where bug reports go for ACKS II — Extras and ACKS II — Importer, which module owns which symptom, and what makes a report easy to act on.
---

Something misbehaved at the table? Reports are welcome — every one is
investigated, and you will hear back on the issue whether the answer is a
fix, a documentation improvement, a design-feedback note, or an explanation
of what the module was doing and why.

Two modules share this site, and each keeps its own issue queue. Pick by
symptom, not by which module you installed first — and don't worry about
getting it wrong; a misfiled report is rerouted, not dropped.

## Where to file

<ul class="acks-buy">
  <li>
    <h3>ACKS II — Extras</h3>
    <p>Everything on the sheet and at the table: class documents and the class builder, proficiencies and class powers, equipment and encumbrance, formations and marching order, henchmen and hirelings, influence and reactions, places and markets, monster stat blocks.</p>
    <p><a href="https://github.com/NocTempre/foundryvtt-acks-extras/issues/new?template=bug_report.yml">File an Extras bug report</a></p>
  </li>
  <li>
    <h3>ACKS II — Importer</h3>
    <p>Connecting your books, importing content and tables from them, page references, and the Getting Started dialog that opens at launch.</p>
    <p><a href="https://github.com/NocTempre/foundryvtt-acks-importer/issues/new?template=bug_report.yml">File an Importer bug report</a></p>
  </li>
</ul>

Filing needs a free [GitHub account](https://github.com/signup). The form
walks you through everything below.

## What makes a report actionable

- **Versions** — the module's and Foundry's. Both are on the form, and both
  matter: the bug you hit may already be fixed in a newer release.
- **What you did and what you saw**, step by step. Which sheet, which
  button, which actor or item. "Encumbrance is wrong" takes a conversation;
  "I dragged a shield onto Marcus and his stone count didn't change" takes a
  fix.
- **What you expected** — the rule as you understand it, with a book and
  page citation if you have one.
- **Console errors.** Press <kbd>F12</kbd>, open the Console tab, and paste
  anything red. This is very often the whole diagnosis.
- **Whether it survives disabling other modules.** If you can, try with only
  the module and its requirements enabled — it is the first question we will
  ask.

:::caution[Cite pages, never paste them]
Never paste book text or attach page scans or PDFs to a report. Name the book
and page instead — "ACKS II Revised Rulebook p. 47" tells us everything the
excerpt would.
:::

Not sure it's a bug? Check the [guides](../../guides/abilities/) first — the
behaviour you hit may be documented, and if it turns out the docs are what's
missing, that's a report worth filing too.
