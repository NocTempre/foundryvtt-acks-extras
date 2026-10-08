# Working beside other sessions (canonical)

Several sessions write in one working tree, on one branch, at the same time.
A commit holds one session's change and nothing else, and the tree it holds is
the tree that was gated. The mechanics are the `acks-commit` skill; the
rulings behind this page are `acks-module-template/docs/DECISIONS.md`
(2026-10-07). The test world's half of this is `live-testing.md`,
"Concurrency".

## What is yours

- **Your change is the lines you wrote.** A hook records every Edit and Write
  under its session, and the commit tool takes from a file the lines that
  record gives you. A line no record accounts for, a script's or a
  formatter's, is nobody's until a session names it. A hand-run `git add` or
  `git commit` is refused by a hook.
- **A peer's path is not yours to change.** The same hook refuses `restore`,
  `stash`, `clean`, `reset` and a `checkout` of paths; an edit of your own
  is undone with the Edit tool. No edit to a peer's path turns a gate green
  either: a gate that is red on a peer's in-flight hunk is run where that
  hunk is not, and the report says so.
- **At a release, work in the tree that you did not write is asked about
  once.** List the modified paths outside your change and ask whether they
  ship. Neither include them nor leave them out on your own call. Left out,
  they ride the next release; no release is cut for them alone.
- **What you started, you stop.** A background gate, server or watcher is
  stopped before the session finishes, with its children: stopping the task
  can leave them running. A peer's processes carry the same names, so match
  one to your own scratch path before stopping it.

## The tree you gate is the tree you commit

- Gates read the files on disk, which hold every session's in-flight hunks;
  CI checks out the commit. Build the change apart from the shared index,
  gate that tree in a clone, and stage only when the shared index writes the
  same tree id.
- Read `HEAD` and the tag list immediately before the gate and again before
  the commit. A clean `git status` says nothing about what a peer committed.
- A path staged in the shared index that is not yours is a peer between `add`
  and `commit`. Wait for it to land; a gate started under it is lost.
- Finish every wording pass before the first gate. Each edit after it costs a
  whole gate.

## When the base moves under a green gate

Gate again on the new base, or carry the result. A base is carried only when
all three hold:

1. the commits that landed write none of the change's files and no gate
   tooling (a new check that reads your files is gate tooling);
2. the tests pass again on the exact rebuilt tree;
3. the full gate then runs on the commit itself, and the report gives its
   result.

A release is never carried. Its gates are TOOLCHAIN §4's, run on the release
tree.

## Versions, tags and pushes

- **An open CHANGELOG heading reserves nothing.** Only the tag list says what
  shipped. Read it before writing into a section and again before staging; a
  version a peer published is spent, and the answer is the next patch.
- **A release tags its own commit's sha, never `HEAD`,** and pushes that sha
  with its tag in one atomic push, so a commit that landed above it stays
  local for the session that made it.
- **Every commit is reported by sha, with whether it is pushed.** Whether to
  push is TOOLCHAIN §2 unless the user said otherwise.
