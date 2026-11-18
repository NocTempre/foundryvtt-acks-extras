# ACKS Module Licensing & Disclaimer Rules

The ACKS modules are **ACKS II Apps** under the **ACKS II App License**. Two
obligations bind every module in this family.

> Source of truth: the *ACKS II App License Guide* (Autarch LLC). This doc is the
> family's operational reading of it — when the App License changes, change this
> doc first.

## Rule 1 — No module may claim a license that lets others take the code

The developer **owns** the original code; ACKS II material placed inside the app
is **not** open and does **not** transfer to the developer. Therefore:

- **No open-source or Open Game / community-use / compatibility license may ever
  be applied to the code.** No `MIT`, `GPL`, `Apache`, `CC-*`, "provided as-is",
  "public domain", or "free to reuse" wording. Those phrases are prohibited in
  `LICENSE`, `README`, `module.json`, and package metadata.
- The code is **proprietary, all rights reserved**, except the limited rights
  Autarch LLC holds under the App License (archive, preserve access, security /
  compatibility fixes, port, maintain-if-abandoned). Autarch may not appropriate
  and sell an **actively maintained** app; commercialization requires abandonment
  or the developer's written permission.
- Do **not** publish the ACKS database separately (no data dumps, bulk exports,
  public content APIs, downloadable embeddings, or reconstruction tools), and do
  **not** train/fine-tune models on ACKS material.

Stated by the **`LICENSE`** file (see below).

## Rule 2 — The mandatory disclaimers must be clear

Every module states, prominently, in its `README` "## License" section (and in
any in-app "about"/credits surface where practical):

1. **Unofficial** — not published or endorsed by Autarch LLC; the module's own
   name and developer identity stay more prominent than "ACKS II".
2. **Required ACKS II publications** — name the book(s) the module needs; state
   that users must own them and the module is not a substitute.
3. **Free** — free to access and use; donations (if any) buy no advantage.
4. **Trademark** — ACKS, ACKS II, and Adventurer Conqueror King System are
   trademarks of Autarch LLC; ACKS II content is used under the ACKS II App
   License.

No registration number: Autarch issues none under the App License, so a
disclaimer carries no number and no placeholder for one (DECISIONS 2026-11-06).

## Where each is stated

- **`LICENSE`** carries the code-ownership terms + the generic disclaimer, and
  points to the README for the required publications. No check reads it: the
  drift check that held it byte-identical went with the template
  (`docs/DECISIONS.md`, 2026-11-18), so a change to it is the owner's.
- **`README` "## License"** carries the module's disclaimer: required
  publications, unofficial/free/trademark statements, and a link to `LICENSE`.
- **`module.json`** sets `"license": "LICENSE"` so Foundry surfaces it in the
  module browser.

## Rule 3 — every publish passes an IP leak scan

Licensed ACKS II material must never reach a public repo or a release artifact.
`tools/ip-scan.mjs` is wired into `tools/validate.mjs`,
so it gates every `npm run validate` and therefore every release. CI runs it
**twice**: once against the tree, once against the *unpacked `module.zip`*, so
what actually ships is what gets checked.

What it flags:

- **Local-only rules extracts** (`RULES.md`, `PROFICIENCIES.md`,
  `*Reactions-Reference.md`) — these belong in `C:\Proj\acks-rules\<feature>\`
  and were purged from every repo history 2026-07-16.
- **`ruledata/`** — a hard path ban, not a judgement call: book tables shipped
  publicly from that directory until the 2026-07-19 ruling that no value read
  off a page ships in any repo. The signals were table rows and name lists, all
  individually short, so no prose-length rule would ever have caught them.
- **Extraction-pipeline state** (`_proposals/`, `_manifest/`, `_ledger.json`) —
  holds raw fragments lifted from the user's own PDFs.
- **Publisher attribution inside data files** — in a pack source or cookbook it
  means text was copied in wholesale rather than authored. A data file that
  does not parse is read as text for the same notice.
- **Warning only:** very long string leaves in data files, and very long string
  or template literals in `scripts/` and `tools/` source, so transcribed prose
  gets a second look. Macro `command` bodies in data files are exempt
  (authored JS). Source is tokenized rather than scanned for quote marks, and
  `tools/toolchain-tests/test-ip-scan.mjs` pins that reading: run it after editing the scanner.

A path is matched in any letter case, a banned directory and a directory whose
files are read alike. A filesystem that folds case opens `RuleData/` as
`ruledata/`, and git tracks the spelling it was handed.

It scans **git-tracked files** in a work tree and **everything** elsewhere. An
ignored, untracked file is not in the repo and never reaches the remote — the
extraction pipeline depends on that — but force-add one and it becomes tracked,
and the scan catches it. The file deliberately contains **no book text**: it
matches structural signals, never known passages, because storing those here
would itself be the leak.

### On a leak: quarantine the file, not the work

**The gate is local, and it fires at commit time.** That is the only moment it
can work: once a flagged file is in a commit, ignoring it afterwards does not
remove it from history, and the repo has to be purged and force-pushed (as
acks-formation was, 2026-07-17). CI is far too late — by the time it runs, the
content is already on the remote.

`.githooks/pre-commit` runs `tools/ip-quarantine.mjs` over the **staged** set,
and what it judges is what the commit would hold: the content in the index git
is making the commit from, never the file on disk. A file edited, deleted or
left half-written after it was staged is judged as it was staged, and a notice
on disk that was never staged is not that commit's. On a flagged file that
HEAD does not hold it:

1. **unstages it** — the file stays on disk, nothing you wrote is lost;
2. **appends it to `.git/info/exclude`**, a local-only ignore that is never
   committed, so it cannot leak the filename or reach a teammate. The line is
   that file's path and matches no other;
3. **lets the commit proceed** with everything else. Where the flagged files
   were the whole staged set, nothing is left and the commit is abandoned.

The commit lands, the push lands, your work is saved, and the licensed material
never leaves the machine. No repo visibility change is needed.

A flagged file that **HEAD already holds** cannot be quarantined: git does not
ignore a tracked file, and unstaging one would commit its removal. That is a
hard stop, and the stop says which of two things it met. Where HEAD's own copy
is flagged, history is contaminated, and the instruction is to purge it before
pushing. Where HEAD's copy is clean, the staged change is what brings the
material in, and the instruction is to take it out and stage the file again.

The commit goes ahead only where what is left staged scans clean. A leak the
scanner names no staged path for stops it, and so does a scanner that cannot
be loaded.

The commit tool (`.claude/skills/acks-commit/`) asks the same scanner before
it stages anything, about the tree it is about to commit. A peer's uncommitted
lines in the same file are in neither that tree nor the verdict.
`tools/toolchain-tests/test-ip-quarantine.mjs` drives the hook through each of
these in throwaway repositories: run it after editing the quarantine or the
scanner.

The hook is armed by `npm install` (the `prepare` script sets
`core.hooksPath=.githooks`). Hooks are not committed, so a fresh clone that has
never run `npm install` is ungated — this is why CI still backstops. Armed is
not the whole of it on Linux and macOS, where git runs a hook only as an
executable file, so the hook's file is tracked as mode 100755. TOOLCHAIN §9
says what holds it there.

### CI backstop

CI reads a tree, at two moments, and never history. The release workflow
scans the tagged tree and then the unpacked `module.zip`, and on a leak
withholds the release and takes the repo **private**. A push between releases
is read by neither.

So a flagged file the hook was not asked about (`--no-verify`, an unarmed
clone, a merge, a cherry-pick, a rebase, or a scan rule added after the
commit) is caught only where it is still in the tree when a scan runs. One a
later commit removed first is public in history and unread. A session cannot
commit around the hook: `shared-tree-guard.mjs` refuses it `git commit`,
`merge`, `cherry-pick` and `rebase`, and the commit tool scans its change set
whether or not the hook is armed. `docs/DECISIONS.md` (2026-10-13) says why
no reader was built for a commit the owner makes by hand.

> **Setup required:** the auto-private step needs a PAT with `admin:repo` in the
> repo secret **`IP_GATE_TOKEN`**, because `GITHUB_TOKEN` cannot change repo
> visibility. Until that secret exists the release **fails loudly** with manual
> instructions — it never passes silently — but you must take the repo private
> by hand. The local hook is what actually keeps this from mattering.

See `docs/TOOLCHAIN.md` for the wider toolchain conventions.
