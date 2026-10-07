---
name: acks-commit
description: Commit this session's own change from a working tree other sessions are writing in — its hunks and no peer's, gated as the exact tree that is committed, with a base that moved under the gate refused or carried by rule. Use when the user says "commit", "commit when ready", "commit only your hunks" or "leave it unpushed" in an acks-* repo, and from acks-release step 6. Not the release procedure itself (acks-release) and not a canon sync (acks-sync-toolchain).
---

The rule is `.claude/rules/shared-tree.md`; this skill is how it is carried
out. `commit-own-hunks.mjs`, beside this file, does the work: it builds the
change in a private index, gates that tree in a scratch clone, and stages on
the shared index only when the tree id is the gated one. Its header documents
every mode and every `change.json` key, and is the reference; nothing there is
repeated here.

The user's "commit" is the go-ahead for the commit. A push follows TOOLCHAIN
§2 unless they said to leave it.

## 1. Look before listing anything

```bash
git status --short
git diff --cached --name-only
git log --oneline -3
```

- **A staged path that is not yours** is a peer between `add` and `commit`.
  Wait until the index is empty and `HEAD` has moved, then start.
- **For each modified file you touched, read `git diff -U0 -- <file>`.** Every
  hunk is yours, or the file is shared. Decide per file; a file that was
  wholly yours an hour ago may not be now.
- **Modified paths you did not write stay where they are.** They are named in
  the report as left out, and at a release they are asked about
  (`shared-tree.md`).
- **Finish the wording first.** Any edit after the gate costs another gate.

## 2. Describe the change

Make a directory in the session's scratch space, outside the repository, with
two files.

`change.json`:

```json
{
  "files": {
    "docs/lib/MODEL.md": { "own": "strandedCoin", "count": 1 },
    "scripts/lib/repair-checks.mjs": { "whole": true }
  },
  "added": ["tools/test-repair-checks.mjs"],
  "expect": ["ok - a scan lists only coin that is there"]
}
```

- A **shared** file takes `own`, a pattern that matches each of your hunks and
  none of a peer's, and `count`, how many hunks that is. Pick words only your
  change wrote.
- A file where every hunk is yours takes `whole`. So does any binary file.
- A new check or suite names one of its own output lines under `expect`: a
  check that cannot run where the gate runs it often exits 0 with a note.
- `gate` is needed only where `package.json` does not name the gate
  (`build:packs`, `validate`, `test`). `link` adds any second `node_modules`
  the gate reads, such as a docs site's.
- A change of many files, a release above all, writes its lists from
  `git status --porcelain` with every path that is not its own taken out, and
  then reads `record`'s listing against the session's own account of what it
  changed. A list built by exclusion takes in whatever a peer wrote since.

`commit-msg.txt` holds the message, in the repo's own voice
(`acks-hotfix`, "Voice", for a fix).

## 3. Record, read the listing, ship

```bash
node .claude/skills/acks-commit/commit-own-hunks.mjs record --change <dir>
```

`record` prints every hunk of every listed file as `MINE` or `left`. **Read
it.** A `MINE` you did not write, or a `left` you did, is fixed in
`change.json` and recorded again. It writes nothing to the repository.

```bash
node .claude/skills/acks-commit/commit-own-hunks.mjs ship --change <dir>
```

Run `ship` in the background and wait for it; a full gate takes minutes, more
than a foreground command is given. It holds whole and added files to what
`record` hashed, gates, commits, and goes again on a new base only while a
peer's commit lands under its gate, four times at most.

| Exit | Meaning | Next |
| --- | --- | --- |
| 0 | `OK: the commit holds the gated tree on the gated base` | §5 |
| 1 | `REFUSED:` with the reason; nothing is staged | fix what it names, `record` again |
| 3 | every attempt lost its base to a landed commit | §4, or `ship` again |
| 4 | a peer's staging is in the shared index | wait for it to land, `ship` again |

The gate's output is in `<dir>/gate-*.log`. A red gate is read there, never
guessed at from the last line.

## 4. A base that moved under a green gate

`shared-tree.md` gives the three conditions. The tool checks the first two and
runs the third on request:

```bash
node .claude/skills/acks-commit/commit-own-hunks.mjs commit --carry --change <dir>
node .claude/skills/acks-commit/commit-own-hunks.mjs postgate <sha> --change <dir>
```

`commit --carry` refuses, with exit 3, when a landed commit writes one of the
change's files or gate tooling, or when the rebuilt tree no longer holds the
gated content; then the answer is a new gate. `postgate` is the full gate on
the commit, run in the background. The carry stands once it is green, and a
red one is this session's to fix before anything else. A release never takes
this path.

## 5. After the commit

```bash
git show --stat HEAD
git status --short
node .claude/skills/acks-commit/commit-own-hunks.mjs clean --change <dir>
```

`git status` now shows peers' work and nothing of the change. Push when the
user's word or TOOLCHAIN §2 says to, naming the commit so nothing above it
goes with it: `git push origin <sha>:refs/heads/main`.

Report the sha, pushed or not, the gate's stages with their times as the tool
printed them, whether the base was carried and what `postgate` said, and the
paths left out as not this change's.

## What a clone gate does not cover

- **It is offline.** A runtime change still owes its live walk
  (`.claude/rules/live-testing.md`).
- **It reads committed files only.** A suite or fixture that is gitignored
  does not exist in the clone, so the count of suites that ran is the
  committed count.
