---
name: acks-sync-toolchain
description: Propagate canonical toolchain files from acks-module-template into the acks-* module repos and verify each. Use after editing the template, or to audit repos for drift.
---

The template repo `C:\Proj\acks-module-template` is the single source of truth
for the files listed in its `manifest.mjs` (release workflow, validate/build
harness, dotfiles, CLAUDE.md, Claude settings). Never edit those files inside a
module repo — edit the skeleton in the template, then sync.

1. Audit first:
   `node C:\Proj\acks-module-template\bin\sync-toolchain.mjs --check`
   Summarize the drift per repo for the user.
2. If the skeleton changed, regenerate the copy-me folder:
   `node C:\Proj\acks-module-template\bin\make-blank.mjs`
3. **Commit and push the template FIRST** (TOOLCHAIN §9). The module CI
   drift check re-renders canon from the template's `main` **on GitHub** —
   syncing from an unpushed template turns every module repo's toolchain-check
   red on the very commit meant to fix it, and a local `--check` reporting
   zero drift while CI is red is the signature of exactly that race.
4. Apply: `node C:\Proj\acks-module-template\bin\sync-toolchain.mjs --apply`
   Repos with uncommitted changes are skipped automatically — leave them; note
   them in your summary rather than using `--force`.
5. Verify every repo that received changes:
   - `npm install` if package.json changed, then
     `npm run build:packs && npm run validate` (and `npm test` if present).
   - Compiled packs are gitignored build output; only a real content change
     can dirty `packs/_source`.
   - If validate fails because the *canonical* file is wrong for a legitimate
     case, fix it in the template skeleton and re-sync everywhere — never fork
     a per-repo copy.
6. Commit in each changed repo
   (`chore: sync toolchain from acks-module-template`) and push — an unpushed
   sync leaves the repo's next CI run red against the already-pushed template.
7. Skills sync with everything else (`COPY_DIRS` in the manifest) — there is
   no separate install step. If a stale `~/.claude/skills/acks-*` copy exists
   on this machine, delete it: user-level copies sit outside every drift gate
   and once silently clobbered newer text.
