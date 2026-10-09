---
name: acks-new-module
description: Scaffold a new ACKS II Foundry module repo from acks-module-template. Use when the user wants to start a new acks-* module.
model: sonnet
effort: medium
---

Scaffold a new module in the NocTempre ACKS family. The canonical toolchain and
conventions live in `C:\Proj\acks-module-template` (read `docs/TOOLCHAIN.md`
before deviating from anything).

1. Establish the module id (lowercase kebab, `acks-` prefix), feature title
   (without the "ACKS II — " prefix), and a one-line description. Ask only if
   the user's request doesn't determine them.
2. Run:
   `node C:\Proj\acks-module-template\bin\new-module.mjs <id> --title "<Title>" --desc "<Description>"`
   This creates `C:\Proj\<id>` from the template's tree as it stands, renders
   placeholders, `git init -b main`, makes the first commit, and then has the
   sync compare the module with the template's `origin/main`. The last line
   is the verdict:
   - **`level:`** go on.
   - **`not level:`** the run names each file that differs and, under
     `note:`, the canon in the template's tree that the pushed branch does
     not hold: another session's uncommitted edit, or a commit not pushed
     yet. The module was built from that tree, so they are in it. Run the
     command the verdict names, which writes the pushed branch over them, and
     once step 3 passes commit what it wrote in the new repo through the
     `acks-commit` skill (`chore: sync toolchain from acks-module-template`).
     The files are a script's, and go into the change as that skill says a
     script's do. A file that differs with no such path to account for it
     means `skeleton/` and the manifest disagree. That is a defect of the
     template: report it and fix it there, never in the module.
   - **`not checked:`** nothing compared the module, and the lines above the
     verdict say why. A module that was not finished is removed, and the run
     repeated once the cause is fixed. One that was made is checked with
     `node C:\Proj\acks-module-template\bin\sync-toolchain.mjs --check --repo-path C:\Proj\<id>`.

   The check covers the files the sync writes. A path the note lists in a
   file outside them (the README, `docs/`, `lang/`) is in the module as the
   tree held it: read it there and decide whether it belongs.
3. In the new repo: `npm install`, then `npm run validate` — both must pass.
4. Start the design docs before writing runtime code: fill the canonical
   rules extract at `C:\Proj\acks-rules\<id>\RULES.md` (**LOCAL-ONLY, never
   in the repo** — licensed book text; cite book/chapter/section) and the
   in-repo `docs/MODEL.md` with the reuse → extend → enhance → invent
   breakdown. Source the extract in `.claude/rules/rules-lookup.md`'s order —
   wiki snapshot before any PDF; on a genuine conflict the printed page wins.
5. Publishing is a separate, user-confirmed step — ask before running
   `gh repo create NocTempre/<id> --public --source . --push`.
6. Foundry dev install (junction, not copy):
   `New-Item -ItemType Junction -Path "$env:LOCALAPPDATA\FoundryVTT\Data\modules\<id>" -Target "C:\Proj\<id>"`

Never copy toolchain files from a sibling module — the template is the only
source; sibling copies may carry stale drift.
