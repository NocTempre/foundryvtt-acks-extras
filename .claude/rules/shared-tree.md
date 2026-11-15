# Working beside other sessions (canonical)

Several sessions write in `main`'s working tree at the same time. A commit
there holds one session's change and nothing else, and the tree it holds is
the tree that was gated. The mechanics are the `acks-commit` skill; the
rulings behind this page are `acks-module-template/docs/DECISIONS.md`
(2026-10-07, and 2026-11-12 for the branch model). The test world's half of
this is `live-testing.md`, "Concurrency". A topic branch in a worktree of its
own has one writer and none of this page's machinery but the last section's.

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
  CI checks out the commit. The commit tool builds the change apart from the
  shared index, gates that tree in a clone, and stages only when the shared
  index writes the same tree id.
- **One run of the tool gates and commits at a time.** It holds a lease from
  its gate through its commit. A run that finds the lease held says who holds
  it, waits its turn, and gates on the commit the run before it landed.
- Finish every wording pass before the first gate. Each edit after it costs a
  whole gate.

## When the base moves under a green gate

Under the lease a base moves only by a commit made around the tool: the
owner's own, or a session's from before the hooks reached it. Gate again on
the new base, or carry the result. A base is carried only when all three
hold:

1. the commits that landed write none of the change's files and no gate
   tooling (a new check that reads your files is gate tooling);
2. the tests pass again on the exact rebuilt tree;
3. the full gate then runs on the commit itself, and the report gives its
   result.

A release is never carried. Its gates are the ones TOOLCHAIN §4 ("Release
shape") names, run on the release's own commits.

## Versions, tags and pushes

- **An open CHANGELOG heading reserves nothing.** Only the tag list says what
  shipped. Read it before writing into a section and again before staging; a
  version a peer published is spent, and the answer is the day's next version.
- **A release tags its own commit's sha, never `HEAD`:** the docs commit, or
  the release commit where a hotfix takes no shots. It pushes that sha with its
  tag in one atomic push, so a commit that landed above it stays local for the
  session that made it.
- **One runtime writer on `main`'s tree during a release's live window.** From
  the release commit (`acks-release` step 4) to the tag's push, the session
  cutting the release is the only one that lands a change to what the zip ships
  (the paths `tools/walk-results.mjs` hashes as the runtime tree). A peer's
  runtime landing in that window, a topic's included, makes the walks stale,
  and the preflight run on the tag's commit refuses. `acks-branch land`
  refuses a topic's runtime landing while `main`'s version has no tag (exit
  6); a commit through `acks-commit` has no such guard.
- **Every commit is reported by sha, with whether it is pushed.** Whether to
  push is TOOLCHAIN §2 unless the user said otherwise.

## Topic and parked branches

This section is in force in a repository once its synced `.claude/` holds it
together with the hooks synced beside it. Until then a branch, a worktree, a
rebase and a merge each wait for the owner's word.

- **`main` is what is released and walked, and its tree never leaves
  `main`.** A hook refuses a switch of `main`'s tree to another branch or
  commit.
- **A new feature is built on `topic/<slug>`.** A feature is work whose plan,
  brief or ledger row adds or reworks a surface a user or another module
  reaches: a window, a setting, a document sub-type, an importer for a book
  or a kind of entry, an API. The plan or brief names its tree before the
  first edit, as it names its agent.
- **Written in `main`'s tree:** a fix that restores what a shipped surface
  already claims (a triage row, a hotfix, what a walk finds, a printed value
  moved by the work that found it), docs and plans, a release's own commits,
  and a change that neither adds nor reworks a surface. Such a change may
  take a topic branch
  when it spans more than one commit and nothing in it is walked live until
  it is finished.
- **A feature is walked on `main`.** The Foundry junction points at `main`'s
  tree, so a slice is built to an offline green in the worktree and landed,
  then walked live on `main`, and what the walk finds is fixed on `main`. A
  feature is not reported built until that walk has run. A topic lands once
  for each slice that needs its walk and stays open between landings;
  `sync` brings what `main` gained meanwhile into its worktree.
  The plan it is built from stays in `main`'s tree, where its sessions read
  it and append to it.
- **`acks-branch` is the one way a branch or a worktree comes to exist or
  goes away**: `open`, `land`, `sync`, `close`, `park`. The worktree is the sibling
  folder `<repo>.<slug>`. A hook refuses a hand-made branch or worktree, a
  hand `git worktree remove`, and the app's own worktrees.
- **A worktree directory is closed by the tool and never deleted by hand.**
  Its `node_modules` is a link to `main`'s, and a recursive delete of the
  folder (`git worktree remove`, `rm -r`, `Remove-Item -Recurse`) reaches
  through the link and empties `main`'s; `close` removes the link first. No
  hook catches every spelling of a delete.
- **One session writes a worktree at a time, with the agents it starts, and
  commits there by hand.** The edit ledger and the shared-tree guard stand
  down in a linked worktree; the pre-commit IP quarantine still runs. The
  session's brief carries what the track needs.
- **The session that wrote a topic branch lands it** with `branch.mjs land`:
  a rebase onto `main` in the worktree, which stops at the first conflict,
  then the full gate on the tip under the landing lease, then a fast-forward.
  No squash and no merge commit. The branch ruling is standing approval for
  that rebase of an unpushed topic branch and for the tool's fast-forward;
  every other merge, rebase, push or history rewrite still asks.
- **Rebase conflicts.** `CHANGELOG.md`: none, since entries are fragments.
  DECISIONS and ROADMAP appends: keep both, `main`'s first. `lang/en.json`:
  keep both sides' keys. Generated files
  (`packs/_source`, `cookbook/*.json`): take `main`'s side, rerun the
  generator, commit the result.
- **A topic branch is never pushed.** A parked branch, `parked/<slug>`, is
  pushed once, at creation, on the owner's go-ahead; it is never synced and
  never built by CI.
- **Nothing is left unnamed.** The Stop hook lists unmerged topic branches,
  topics landed and open, unpushed parked branches and any other local
  branch. A topic between two landings is listed as landed and open, is
  synced before its next slice, and is closed once its feature is walked. `close` deletes a landed branch;
  an unmerged one goes only on the owner's word. What a topic has not landed
  does not ship, and a release asks once about a feature landed in part
  (`acks-release` step 1).
