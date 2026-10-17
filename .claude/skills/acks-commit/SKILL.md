---
name: acks-commit
description: Commit this session's own change from a working tree other sessions are writing in — its hunks and no peer's, gated as the exact tree that is committed, with a base that moved under the gate refused or carried by rule. Use when the user says "commit", "commit when ready", "commit only your hunks" or "leave it unpushed" in an acks-* repo, and from acks-release step 6. Not the release procedure itself (acks-release) and not a canon sync (acks-sync-toolchain).
---

The rule is `.claude/rules/shared-tree.md`; `commit-own-hunks.mjs`, beside this
file, carries it out, and its header is the reference for every mode and every
`change.json` key. The user's "commit", or any finished piece of the work (a
fix, a slice, a step) once gated, is the go-ahead to commit. A push waits for the owner's own go-ahead (TOOLCHAIN
§2), so `land` carries `--no-push` until one is given.

## 1. Describe the change

A directory outside the repository with `commit-msg.txt`, the message in the
repo's own voice (`acks-hotfix`, "Voice", for a fix), and `change.json`:

- `{}` for a change made with the Edit and Write tools: the tool takes every
  line the edit ledger gives this session, in every file, and no other.
- A file a script wrote (a generator, a formatter, a sync) has no record and
  is named `{ "whole": true }`; a new one goes under `added`, a deleted one
  (removed with `rm`) under `removed`, an executable under `mode`. The header
  has the rest: `own`, `adopt`, `expect`, `link`.
- **A change that touches no gated file takes `"gate": []`**: docs, `.claude/`
  text, `CHANGELOG.md`. Nothing offline reads them and the default gate is
  minutes. Where `package.json` names no gate, `gate` lists the commands.

Finish the wording first; every edit after the gate costs another gate.

## 2. Land

```bash
node .claude/skills/acks-commit/commit-own-hunks.mjs land --change <dir> --no-push
```

One command: record, gate in a scratch clone, commit, clean; without
`--no-push` it also pushes the commit's own sha. Run it in the foreground with
a 10-minute timeout; a gate longer than that runs in the background, and its
one completion notice is the wait — never a polling loop. It prints one line:

`landed <sha> not pushed (--no-push); gate: build:packs 2s, validate 153s, test 46s; <dir>/land.log`

On the owner's go-ahead to push, a change not landed yet lands without
`--no-push`. One already landed goes with `git push origin <sha>:refs/heads/main`,
which sends every local commit beneath it as well; the ask names them.

Report that line, and the modified paths left out as other sessions'. Any
other exit prints `REFUSED:` with the reason and the log's last lines, and
nothing is staged:

| Exit | Meaning | Next |
| --- | --- | --- |
| 1 | refused; the reason names it. A listing means the change takes a file on its own word (`whole`, `added`, a pattern): read it in `land.log`, fix `change.json` where a `MINE` is not this change's, and `land` again — it then holds the listing | |
| 3 | the base moved under every attempt | `land` again |
| 4 | staging that is not this run's is in the shared index | wait for it to land, `land` again |
| 5 | the landing lease was held past the wait | `land` again, `--wait <minutes>` where the holder's gate is long |

In a listing, `MINE` is taken, `PART` takes this change's lines of a hunk two
sessions wrote, `left` stays; `[me]`, `[session 1a2b3c4d]`, `[no record]` say
who wrote it. A hunk `left` under two sessions' names with no refusal is one
where the peer's line stands in place of yours: the peer lands it.

A red gate is read in `<dir>/gate-*.log`, never guessed from the last line.
The gate is offline and reads committed files only: a runtime change still
owes its live walk (`.claude/rules/live-testing.md`), and a gitignored suite
does not run in the clone.

## A base that moved under a green gate

`shared-tree.md` gives the three conditions. `commit --carry --change <dir>`
refuses with exit 3 when a landed commit writes one of the change's files or
gate tooling, and `postgate <sha> --change <dir>` is the full gate on the
commit, run in the background. A release never carries.
