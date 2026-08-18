---
name: acks-new-module
description: Scaffold a new ACKS II Foundry module repo from acks-module-template. Use when the user wants to start a new acks-* module.
---

Scaffold a new module in the NocTempre ACKS family. The canonical toolchain and
conventions live in `C:\Proj\acks-module-template` (read `docs/TOOLCHAIN.md`
before deviating from anything).

1. Establish the module id (lowercase kebab, `acks-` prefix), feature title
   (without the "ACKS II — " prefix), and a one-line description. Ask only if
   the user's request doesn't determine them.
2. Run:
   `node C:\Proj\acks-module-template\bin\new-module.mjs <id> --title "<Title>" --desc "<Description>"`
   This creates `C:\Proj\<id>`, renders placeholders, `git init -b main`, and
   makes the first commit.
3. In the new repo: `npm install`, then `npm run validate` — both must pass.
4. Start the design docs before writing runtime code: fill the canonical
   rules extract at `C:\Proj\acks-rules\<id>\RULES.md` (**LOCAL-ONLY, never
   in the repo** — licensed book text; cite book/chapter/section) and the
   in-repo `docs/MODEL.md` with the reuse → extend → enhance → invent
   breakdown.
   Source the extract from `C:\Proj\acks-reference\WIKI-SNAPSHOT\` before any
   PDF — it covers all three core books (`rules/` = **RR**, `judges/` = **JJ**,
   `monsters/` = **MM**) as greppable markdown that keeps the table cells, row
   boundaries and paragraph breaks PDF extraction collapses into run-ons, which
   is what lets it **validate** a table's shape rather than merely read faster.
   Open `acks-reference\ACKSII\*.pdf` only where the snapshot has a gap or the
   printed page needs a double-check; on a genuine conflict the printed page
   wins. The snapshot is LOCAL-ONLY on the same footing as `acks-rules`.
5. Publishing is a separate, user-confirmed step — ask before running
   `gh repo create NocTempre/<id> --public --source . --push`.
6. Foundry dev install (junction, not copy):
   `New-Item -ItemType Junction -Path "$env:LOCALAPPDATA\FoundryVTT\Data\modules\<id>" -Target "C:\Proj\<id>"`

Never copy toolchain files from a sibling module — the template is the only
source; sibling copies may carry stale drift.
