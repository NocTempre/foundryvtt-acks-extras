---
name: acks-sync-toolchain
description: Propagate canonical toolchain files from acks-module-template into the acks-* module repos and verify each. Use after editing the template, or to audit repos for drift.
model: sonnet
effort: medium
---

The template repo `C:\Proj\acks-module-template` is the single source of truth
for the files listed in its `manifest.mjs` (release workflow, validate/build
harness, dotfiles, CLAUDE.md, Claude settings). Never edit those files inside a
module repo — edit the skeleton in the template, then sync.

The sync reads canon from a commit, never from the files on disk. `--apply`
writes the template's `origin/main` as the run fetches it, and `--check`
compares with the same commit. A run's first line names the commit, and a note
under it lists the canon in the working tree that the run did not read. The
script's header says what each flag and exit status means.

1. Audit first:
   `node C:\Proj\acks-module-template\bin\sync-toolchain.mjs --check`
   Summarize the drift per repo for the user. A path marked `(uncommitted)`
   is one that would hold step 3. To see what an edit that is not pushed
   would change, add `--worktree` (the tree as it stands, every session's
   uncommitted edits included) or `--from <rev>` (one commit). Both are
   previews; neither can be applied.
2. **Commit and push the template** (TOOLCHAIN §9). `--apply` has nothing
   else to write: an edit that is committed and not pushed reaches no module,
   and the run lists it as left out.
3. Apply: `node C:\Proj\acks-module-template\bin\sync-toolchain.mjs --apply`
   - **What is written is the whole branch**, not your change alone. Where
     another session pushed canon since the module was last synced, its files
     are written too. They are pushed canon and belong in the sync commit;
     name them in your summary.
   - **`held`** means a file the sync would write or remove carries an
     uncommitted change in that repo, and nothing was written there. Find out
     whose it is before anything else. Yours, written by an apply of yours
     that is not committed yet: run again with `--force`. Another session's,
     or one you cannot account for: leave it, do not force, and report the
     repo as not synced, with the paths.
   - **Exit 2** means the run could not do what was asked: a target that is
     missing or is not a module repo, or a branch that could not be fetched.
     It says nothing about drift. Fix the cause and run again.
4. Verify every repo that received changes:
   - `npm install` if package.json changed, then
     `npm run build:packs && npm run validate` (and `npm test` if present).
   - Compiled packs are gitignored build output; only a real content change
     can dirty `packs/_source`.
   - If validate fails because the *canonical* file is wrong for a legitimate
     case, fix it in the template skeleton and re-sync everywhere — never fork
     a per-repo copy.
5. Commit in each changed repo through the `acks-commit` skill
   (`chore: sync toolchain from acks-module-template`) and push — an unpushed
   sync leaves the repo's next CI run red against the already-pushed template.
   The files are a script's, and go into the change as that skill says a
   script's do.
6. Skills sync with everything else (`COPY_DIRS` in the manifest) — there is
   no separate install step. If a stale `~/.claude/skills/acks-*` copy exists
   on this machine, delete it: user-level copies sit outside every drift gate
   and once silently clobbered newer text.
