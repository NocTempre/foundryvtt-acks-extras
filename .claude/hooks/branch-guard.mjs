/**
 * Claude Code hook that keeps `main`'s working tree on `main` and routes every
 * other line of work through the branch tool,
 * `node .claude/skills/acks-branch/branch.mjs open|land|close|park <slug>`.
 * Topic work lives in a sibling worktree on `topic/<slug>`; the rules are in
 * `.claude/rules/shared-tree.md`, "Topic and parked branches".
 *
 * Four modes, wired to hook events in `.claude/settings.json`:
 *
 * - `pretool` — reads a PreToolUse payload on stdin and denies a Bash command
 *   (every `&&`, `||`, `;`, `|` and newline part of it is judged on its own)
 *   that does one of three things:
 *   1. creates a branch or a worktree by hand: `git worktree add`,
 *      `git checkout -b/-B`, `git switch -c/-C/--create`, `git branch <name>`
 *      without an inspect, delete, rename or copy flag. The tool makes both,
 *      on the names the rules give them.
 *   2. removes a worktree: `git worktree remove`, with any flags, anywhere. A
 *      worktree's `node_modules` is a link to the main checkout's, and git's
 *      removal reaches through the link on Windows and empties the main
 *      checkout's `node_modules`; `branch.mjs close` unlinks first.
 *   3. moves `main`'s tree off `main`: `git switch <x>` with `<x>` other than
 *      `main` (`--detach`, `--orphan` and `-` included), and `git checkout
 *      <x>` where `<x>` resolves to a commit and is not `main` (`--detach`,
 *      `--orphan` and `-` included). A checkout with `--` or with a path after
 *      the ref restores files, and a name that is no ref is no switch; both
 *      pass. A linked worktree is free to switch.
 *   Listing and pruning worktrees, deleting, renaming and listing branches,
 *   and every other git command pass through untouched.
 * - `worktree-create` — refuses the app's own worktree creation, the path no
 *   Bash guard can see.
 * - `session-start` — speaks only where the session stands somewhere that
 *   needs it: in a linked worktree it names the branch and says the work there
 *   is not live until it lands; in `main`'s tree it warns when `HEAD` is not
 *   `refs/heads/main`; inside `.claude/worktrees/` it warns that the app made
 *   a throwaway worktree.
 *
 * A "main's tree" is a repository whose first `.git` walking up from the
 * command's target is a directory, or a `.git` file whose git directory holds
 * no `commondir`. The target is the payload's `cwd`, moved by each `cd` in the
 * command and then by each `git -C <dir>`. A linked worktree is a `.git` file
 * whose git directory holds `commondir`. Where the target is no repository,
 * or its path cannot be resolved from the command text, the switch passes.
 *
 * The removal refusal is a pointer to the tool, not a barrier: a recursive
 * delete of a worktree directory that still holds the link does the same
 * damage and has too many spellings for a command guard to name.
 *
 * The setting `worktree.bgIsolation` stops background sessions minting
 * worktrees, but it is read when the daemon starts, so a daemon already
 * running keeps making them until it restarts; `worktree-create` covers that.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const MODE = process.argv[2];

const BRANCH_TOOL = "node .claude/skills/acks-branch/branch.mjs";
const SECTION = '"Topic and parked branches" in .claude/rules/shared-tree.md';

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

/** One shell word with a pair of surrounding quotes taken off. */
const unquote = (word) => word.replace(/^(["'])(.*)\1$/, "$2");

/**
 * A path as the shell wrote it, made absolute against `base`. Git Bash writes
 * a Windows drive as `/c/...`; that spelling is read back to `c:/...`.
 */
function resolveDir(base, dir) {
  const native = process.platform === "win32" ? dir.replace(/^\/([a-zA-Z])(\/|$)/, "$1:/") : dir;
  return path.resolve(base, native);
}

/**
 * Which kind of working tree `dir` is inside: `{ kind: "main" | "linked",
 * root }`, or null when `dir` does not exist or no `.git` lies above it.
 */
function treeOf(dir) {
  let at = path.resolve(dir);
  if (!fs.existsSync(at)) return null;
  for (;;) {
    const dot = path.join(at, ".git");
    let stat = null;
    try {
      stat = fs.statSync(dot);
    } catch {
      // No `.git` here; keep walking up.
    }
    if (stat?.isDirectory()) return { kind: "main", root: at };
    if (stat?.isFile()) {
      let gitdir = null;
      try {
        const m = /^gitdir:\s*(.+?)\s*$/m.exec(fs.readFileSync(dot, "utf8"));
        if (m) gitdir = path.resolve(at, m[1]);
      } catch {
        // An unreadable pointer is not a linked worktree.
      }
      return { kind: gitdir && fs.existsSync(path.join(gitdir, "commondir")) ? "linked" : "main", root: at };
    }
    const up = path.dirname(at);
    if (up === at) return null;
    at = up;
  }
}

/** Runs git in `dir` with the variables that would redirect it removed. */
function git(dir, args) {
  const env = { ...process.env };
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_PREFIX"]) delete env[key];
  return spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", env });
}

/** Whether `name` resolves to a commit in the repository at `dir`. */
function isCommit(dir, name) {
  const r = git(dir, ["rev-parse", "--verify", "--quiet", `${name}^{commit}`]);
  return r.status === 0;
}

/**
 * The verb, its arguments and the `-C` directories of one shell segment, or
 * null when the segment runs no git. Git's own options before the verb
 * (`-C <dir>`, `-c k=v`, `--no-pager`) are skipped.
 */
function parseGit(segment) {
  const argv = segment.trim().split(/\s+/).filter(Boolean).map(unquote);
  const at = argv.indexOf("git");
  if (at === -1) return null;
  const dirs = [];
  let i = at + 1;
  while (i < argv.length && argv[i].startsWith("-")) {
    if (argv[i] === "-C") dirs.push(argv[++i] ?? "");
    else if (argv[i] === "-c") i++;
    i++;
  }
  return { verb: argv[i], rest: argv.slice(i + 1), dirs };
}

/** What a hand-made branch or worktree is told: the tool makes them. */
function creationMessage(reason) {
  return `${reason}. Topic branches and worktrees are made by the tool, not by hand: ` +
    `\`${BRANCH_TOOL} open <slug>\`. See ${SECTION}.`;
}

/**
 * Names the branch-creating shape of one git call, or null if it creates
 * nothing.
 */
function creationReason({ verb, rest }) {
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

/**
 * The target of a git call that would move the tree at `dir` off `main`, or
 * null when it stays. `dir` is main's tree; the caller has judged that.
 */
function switchTarget({ verb, rest }, dir) {
  const flag = (...names) => rest.some((a) => names.includes(a.split("=")[0]));
  if (verb === "switch") {
    if (flag("--detach", "-d", "--orphan")) return "a detached or orphan HEAD";
    if (rest.includes("-")) return "the previous branch";
    const target = rest.find((a) => !a.startsWith("-"));
    return target && target !== "main" ? target : null;
  }
  if (verb === "checkout") {
    if (rest.includes("--") || flag("-p", "--patch", "--pathspec-from-file")) return null;
    if (flag("--detach", "--orphan")) return "a detached or orphan HEAD";
    const positional = rest.filter((a) => !a.startsWith("-"));
    if (!positional.length) return rest.includes("-") ? "the previous branch" : null;
    if (positional.length > 1) return null;
    const [target] = positional;
    return target !== "main" && isCommit(dir, target) ? target : null;
  }
  return null;
}

/**
 * The message for the first thing one shell segment does that the guard
 * refuses, or null. `cwd` is where the segment runs.
 */
function refusalOf(segment, cwd) {
  const call = parseGit(segment);
  if (!call) return null;

  const creates = creationReason(call);
  if (creates) return creationMessage(creates);

  if (call.verb === "worktree" && call.rest[0] === "remove") {
    return "`git worktree remove` is refused: git's removal reaches through a worktree's node_modules " +
      "link and empties the main checkout's node_modules. Close the worktree with the tool, which " +
      `unlinks first: \`${BRANCH_TOOL} close <slug>\`. See ${SECTION}.`;
  }

  if (call.verb === "switch" || call.verb === "checkout") {
    let dir = cwd;
    for (const d of call.dirs) dir = resolveDir(dir, d);
    if (treeOf(dir)?.kind !== "main") return null;
    const target = switchTarget(call, dir);
    if (target) {
      return `\`git ${call.verb}\` would move main's tree off \`main\` (to ${target}). Main's tree stays on ` +
        `\`main\`; other work happens in its own worktree: \`${BRANCH_TOOL} open <slug>\`, ` +
        `or \`${BRANCH_TOOL} land <slug>\` to bring a finished line to \`main\`. See ${SECTION}.`;
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
      permissionDecisionReason: reason,
    },
  }));
}

if (MODE === "pretool") {
  const raw = await readStdin();
  let command = "";
  let cwd = process.cwd();
  try {
    const payload = JSON.parse(raw);
    command = payload?.tool_input?.command ?? "";
    if (typeof payload?.cwd === "string" && payload.cwd) cwd = payload.cwd;
  } catch {
    process.exit(0); // Unparseable payload is not a reason to block a command.
  }
  // Chained commands hide a refusal behind a separator, so judge each part,
  // carrying the directory a `cd` moves to into the parts after it.
  for (const segment of command.split(/&&|\|\||;|\||\n/)) {
    const cd = /^\s*cd\s+(\S+)\s*$/.exec(segment);
    if (cd) {
      const moved = resolveDir(cwd, unquote(cd[1]));
      if (fs.existsSync(moved)) cwd = moved;
      continue;
    }
    const reason = refusalOf(segment, cwd);
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
      "Worktrees here are made by the branch tool, not by the app: " +
      `\`${BRANCH_TOOL} open <slug>\`. See ${SECTION}.`,
    systemMessage:
      "Blocked a worktree: open topic work with " +
      `\`${BRANCH_TOOL} open <slug>\`.`,
  }));
  process.exit(0);
}

if (MODE === "session-start") {
  const cwd = process.cwd();
  const speak = (systemMessage, additionalContext) => {
    process.stdout.write(JSON.stringify({
      systemMessage,
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext },
    }));
  };

  if (cwd.replace(/\\/g, "/").includes("/.claude/worktrees/")) {
    speak(
      "This session is running in a worktree the app made, on a throwaway claude/* branch. " +
        `Topic work belongs in a worktree from \`${BRANCH_TOOL} open <slug>\`; main's work belongs in main's checkout on main.`,
      "WARNING: cwd is inside .claude/worktrees/, so commits land on a claude/* branch, not main. " +
        `Before committing, move the work to main's checkout or to a topic worktree (\`${BRANCH_TOOL} open <slug>\`), ` +
        "or tell the user the work is stranded on a side branch.",
    );
    process.exit(0);
  }

  const tree = treeOf(cwd);
  if (tree) {
    const head = git(tree.root, ["symbolic-ref", "-q", "HEAD"]);
    if (!head.error) {
      const ref = head.status === 0 ? head.stdout.trim() : "";
      const branch = ref.replace(/^refs\/heads\//, "") || "(detached HEAD)";
      if (tree.kind === "linked") {
        const slug = branch.replace(/^(topic|parked)\//, "");
        speak(
          `This session is in a linked worktree on branch ${branch}. Nothing here is live until it lands: ` +
            `commit by hand, then \`${BRANCH_TOOL} land ${slug}\` and \`${BRANCH_TOOL} close ${slug}\`.`,
          `You are in a linked worktree on branch ${branch}. Work here is not live until it is landed on main: ` +
            "the dev install and the live test world read main's tree, so no live walk sees it. " +
            `Commit by hand in this worktree, then land it with \`${BRANCH_TOOL} land ${slug}\` and close it with ` +
            `\`${BRANCH_TOOL} close ${slug}\`. Never \`git worktree remove\` it. See ${SECTION}.`,
        );
      } else if (ref !== "refs/heads/main") {
        speak(
          `Main's tree is on ${branch}, not main. Put it back on main before working here.`,
          `WARNING: this is main's checkout and HEAD is ${branch}, not refs/heads/main. Work meant for main would ` +
            `commit to the wrong line. Switch back to main (\`git switch main\`) before committing, and open other ` +
            `lines with \`${BRANCH_TOOL} open <slug>\`.`,
        );
      }
    }
  }
  process.exit(0);
}

process.exit(0);
