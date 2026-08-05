/**
 * Claude Code hook enforcing this repo's single-branch convention: all work
 * lands on `main`, and tags are the only other refs.
 *
 * Two modes, wired to two hook events in `.claude/settings.json`:
 *
 * - `pretool` — reads a PreToolUse payload on stdin and denies Bash commands
 *   that create a branch or a worktree. Deleting, listing, renaming and
 *   checking out existing branches all pass through untouched.
 * - `worktree-create` — refuses the app's own worktree creation, the path that
 *   no Bash guard can see.
 * - `session-start` — warns when a session's cwd is inside
 *   `.claude/worktrees/`, which means it is about to commit onto a throwaway
 *   `claude/*` branch instead of `main`.
 *
 * Root cause this guards: background sessions default to worktree isolation
 * (`worktree.bgIsolation`), which mints a `claude/<name>` branch per session.
 * That default is turned off in settings, but the setting is read when the
 * background daemon starts, so a daemon already running keeps making worktrees
 * until it restarts — which is why the `worktree-create` mode exists rather
 * than trusting the setting alone.
 */

const MODE = process.argv[2];

/** Flags that make `git branch` an inspect/delete/rename call, not a create. */
const NON_CREATING_BRANCH_FLAGS = new Set([
  "-d", "-D", "--delete",
  "-m", "-M", "--move",
  "-c", "-C", "--copy",
  "-l", "--list",
  "-a", "--all",
  "-r", "--remotes",
  "-v", "-vv", "--verbose",
  "--merged", "--no-merged", "--contains", "--no-contains",
  "--show-current", "--format", "--sort", "--points-at",
  "-u", "--set-upstream-to", "--unset-upstream",
  "--edit-description",
]);

/**
 * Names the branch-creating shape of one shell segment, or null if the
 * segment creates nothing. Returns the message shown to the model.
 */
function creationReason(segment) {
  const argv = segment.trim().split(/\s+/).filter(Boolean);
  const git = argv.indexOf("git");
  if (git === -1) return null;

  // Skip `git`'s own options (-C <dir>, -c k=v, --no-pager) to find the verb.
  let i = git + 1;
  while (i < argv.length && argv[i].startsWith("-")) {
    if (argv[i] === "-C" || argv[i] === "-c") i++;
    i++;
  }
  const verb = argv[i];
  const rest = argv.slice(i + 1);

  if (verb === "worktree" && rest[0] === "add") {
    return "`git worktree add` creates a worktree on a new branch";
  }
  if (verb === "checkout" && rest.some((a) => a === "-b" || a === "-B")) {
    return "`git checkout -b` creates a branch";
  }
  if (verb === "switch" && rest.some((a) => a === "-c" || a === "-C" || a === "--create")) {
    return "`git switch -c` creates a branch";
  }
  if (verb === "branch") {
    const inspecting = rest.some((a) => NON_CREATING_BRANCH_FLAGS.has(a.split("=")[0]));
    const positional = rest.find((a) => !a.startsWith("-"));
    if (!inspecting && positional) {
      return `\`git branch ${positional}\` creates a branch`;
    }
  }
  return null;
}

/** Reads all of stdin as UTF-8. Hook payloads are small and arrive at once. */
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason:
        `${reason}. This repo is single-branch: commit to \`main\`. ` +
        `See the "Conventions" section of CLAUDE.md.`,
    },
  }));
}

if (MODE === "pretool") {
  const raw = await readStdin();
  let command = "";
  try {
    command = JSON.parse(raw)?.tool_input?.command ?? "";
  } catch {
    process.exit(0); // Unparseable payload is not a reason to block a command.
  }
  // Chained commands hide the creation behind a separator, so check each part.
  for (const segment of command.split(/&&|\|\||;|\||\n/)) {
    const reason = creationReason(segment);
    if (reason) {
      deny(reason);
      process.exit(0);
    }
  }
  process.exit(0);
}

if (MODE === "worktree-create") {
  process.stdout.write(JSON.stringify({
    continue: false,
    stopReason:
      "This repo is single-branch: no worktrees. Run in the repo's main " +
      "checkout on main. See CLAUDE.md, Conventions.",
    systemMessage:
      "Blocked a worktree: this repo is single-branch, work happens on main.",
  }));
  process.exit(0);
}

if (MODE === "session-start") {
  const cwd = process.cwd().replace(/\\/g, "/");
  if (cwd.includes("/.claude/worktrees/")) {
    process.stdout.write(JSON.stringify({
      systemMessage:
        "This session is running in an isolated worktree, which commits to a " +
        "throwaway claude/* branch. This repo is single-branch — work in " +
        "the repo's main checkout on main instead.",
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext:
          "WARNING: cwd is inside .claude/worktrees/, so commits land on a " +
          "claude/* branch, not main. This repo's convention is single-branch " +
          "development on main. Before committing, either merge back to main " +
          "or tell the user the work is stranded on a side branch.",
      },
    }));
  }
  process.exit(0);
}

process.exit(0);
