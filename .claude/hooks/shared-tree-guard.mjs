/**
 * Claude Code PreToolUse hook that keeps a hand-run git command off the index
 * and the working files every session in this tree shares.
 *
 * Several sessions write in one working tree (`.claude/rules/shared-tree.md`).
 * A commit there is made by the commit tool
 * (`.claude/skills/acks-commit/commit-own-hunks.mjs`), which stages nothing
 * until the tree it built has passed its gate. This hook denies the commands
 * that go around it:
 *
 * - `git add`, `git stage`, `git rm`, `git mv` and `git commit`, which write
 *   the shared index or commit whatever it holds;
 * - `git revert`, `git cherry-pick`, `git am`, `git merge`, `git pull` and
 *   `git rebase`, which make or move commits no gate has read;
 * - `git reset` to a commit or with `--hard`, `git restore` of working files,
 *   `git stash`, `git clean` and `git checkout` of paths, which move the
 *   branch or discard changes without knowing whose they are.
 *
 * Unstaging passes, as `git restore --staged` and as `git reset` of paths: it
 * writes no file and moves no branch, and it is how staging a session made
 * before this hook, or a run that died while staging, comes out of the index.
 *
 * A command is judged by the repository it runs in: the directory the tool
 * call starts in, moved by each `cd` and by `git -C` ahead of the verb. It is
 * denied only where that repository carries the commit tool and its `origin`
 * is a remote URL. A scratch clone's origin is a path on this machine, and a
 * repository without the tool has nothing to route a commit through, so both
 * pass. `git add` passes under a `GIT_INDEX_FILE` of its own, which is not
 * the shared index.
 *
 * The commit tool's own git calls are children of `node` and never reach this
 * hook. A payload that does not parse, and a command this cannot read, pass:
 * the guard refuses what it recognises and nothing else.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TOOL = ".claude/skills/acks-commit/commit-own-hunks.mjs";

/** Reads all of stdin as UTF-8. Hook payloads arrive at once. */
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

/** The command with every heredoc body taken out: a body is text, whatever it spells. */
function withoutHeredocs(command) {
  const out = [];
  let until = null;
  for (const line of command.split("\n")) {
    if (until !== null) {
      if (line.trim() === until) until = null;
      continue;
    }
    out.push(line);
    const opened = /<<-?\s*(['"]?)([A-Za-z_][\w-]*)\1/.exec(line);
    if (opened) until = opened[2];
  }
  return out.join("\n");
}

/**
 * Split a command line into its commands, each a list of words. Separators
 * and spaces inside quotes are text. A word keeps no quotes. A backslash
 * escapes the next character in a POSIX shell and is a path separator in
 * PowerShell.
 */
function commandsOf(command, posix) {
  const commands = [[]];
  let word = null;
  let quote = null;
  const endWord = () => {
    if (word !== null) commands[commands.length - 1].push(word);
    word = null;
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (posix && c === "\\" && quote === '"' && i + 1 < command.length) word += command[++i];
      else word += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      word ??= "";
    } else if (posix && c === "\\" && i + 1 < command.length && command[i + 1] !== "\n") {
      word = (word ?? "") + command[++i];
    } else if (/\s/.test(c) && c !== "\n") {
      endWord();
    } else if (c === "\n" || c === ";" || c === "|" || c === "&" || c === "(" || c === ")" || c === "{" || c === "}") {
      endWord();
      if (commands[commands.length - 1].length) commands.push([]);
    } else {
      word = (word ?? "") + c;
    }
  }
  endWord();
  return commands.filter((words) => words.length);
}

/** A directory a shell word names, as this platform spells it; null where the word is computed. */
function directory(word, from) {
  if (!word || /[$`*?]/.test(word)) return null;
  let target = word;
  const msys = /^\/([a-zA-Z])(\/.*)?$/.exec(target);
  if (process.platform === "win32" && msys) target = `${msys[1].toUpperCase()}:${msys[2] ?? "/"}`;
  if (target === "~" || target.startsWith("~/")) target = path.join(os.homedir(), target.slice(1));
  return from === null && !path.isAbsolute(target) ? null : path.resolve(from ?? "", target);
}

/**
 * Whether a hand-run commit in `dir` goes around the commit tool: `dir` lies
 * in a repository that carries the tool and whose `origin` is a remote URL.
 */
function guarded(dir) {
  for (let at = dir; ; at = path.dirname(at)) {
    const dot = path.join(at, ".git");
    const stat = fs.statSync(dot, { throwIfNoEntry: false });
    if (stat) {
      if (!fs.existsSync(path.join(at, TOOL))) return false;
      let gitDir = dot;
      if (stat.isFile()) {
        const named = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dot, "utf8"));
        if (!named) return false;
        gitDir = path.resolve(at, named[1].trim());
        const common = path.join(gitDir, "commondir");
        if (fs.existsSync(common)) gitDir = path.resolve(gitDir, fs.readFileSync(common, "utf8").trim());
      }
      const config = fs.readFileSync(path.join(gitDir, "config"), "utf8");
      const origin = /\[remote "origin"\][^[]*?^\s*url\s*=\s*(\S+)/m.exec(config);
      return Boolean(origin) && /^(https?:\/\/|ssh:\/\/|git:\/\/|[\w.-]+@[\w.-]+:)/.test(origin[1]);
    }
    if (path.dirname(at) === at) return false;
  }
}

/** Why one git command is refused in a shared tree, or null. `rest` is what follows the verb. */
function reason(verb, rest, privateIndex) {
  const has = (...flags) => rest.some((a) => flags.includes(a));
  switch (verb) {
    case "add":
    case "stage":
      return privateIndex ? null : `\`git ${verb}\` writes the index every session here shares`;
    case "rm":
    case "mv":
      return `\`git ${verb}\` writes the index every session here shares`;
    case "commit":
      return "`git commit` by hand commits whatever the shared index holds, ungated; anything you staged comes out with `git restore --staged <paths>`";
    case "revert":
    case "cherry-pick":
    case "am":
    case "merge":
    case "pull":
    case "rebase":
      return `\`git ${verb}\` makes or moves commits by hand, ungated, under every session here`;
    case "reset": {
      // Unstaging writes no file and moves no branch: no mode is asked for,
      // and nothing is named ahead of the paths but HEAD.
      const split = rest.indexOf("--");
      const named = (split === -1 ? rest : rest.slice(0, split)).filter((a) => !a.startsWith("-"));
      const unstages = !has("--hard", "--soft", "--merge", "--keep") && (split === -1 ? named.length === 0 || named[0] === "HEAD" : named.every((a) => a === "HEAD"));
      return unstages ? null : "`git reset` to a commit moves the branch every session is on, and `--hard` discards their changes; `git reset -- <paths>` unstages";
    }
    case "restore": {
      const short = rest.filter((a) => /^-[A-Za-z]+$/.test(a)).join("");
      const indexOnly = (has("--staged") || short.includes("S")) && !has("--worktree") && !short.includes("W");
      return indexOnly ? null : "`git restore` discards changes without knowing whose they are; `git restore --staged <paths>` unstages";
    }
    case "stash":
      return rest.length && ["list", "show"].includes(rest[0]) ? null : "`git stash` takes every session's changes out of the tree";
    case "clean":
      return has("-n", "--dry-run") ? null : "`git clean` deletes untracked files without knowing whose they are";
    case "checkout":
      return has("--", ".") ? "`git checkout` of paths discards changes without knowing whose they are" : null;
    default:
      return null;
  }
}

function deny(why) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason:
        `${why}. Several sessions write in this working tree. Commit with ` +
        `\`node ${TOOL}\` (the \`acks-commit\` skill), and undo an edit of ` +
        `your own with the Edit tool. The rule is .claude/rules/shared-tree.md.`,
    },
  }));
}

let payload;
try {
  payload = JSON.parse(await readStdin());
} catch {
  process.exit(0); // An unparseable payload is not a reason to block a command.
}
const command = payload?.tool_input?.command;
if (typeof command !== "string") process.exit(0);

try {
  let dir = payload.cwd ?? process.cwd();
  let privateIndex = false;
  for (const words of commandsOf(withoutHeredocs(command), payload.tool_name !== "PowerShell")) {
    let i = 0;
    let ownIndex = privateIndex;
    for (; i < words.length && /^\w+=/.test(words[i]); i++) if (words[i].startsWith("GIT_INDEX_FILE=")) ownIndex = true;
    const name = (words[i] ?? "").replace(/^.*[\\/]/, "").replace(/\.exe$/i, "");
    const args = words.slice(i + 1);

    if (name === "export") {
      if (args.some((a) => a.startsWith("GIT_INDEX_FILE="))) privateIndex = true;
    } else if (["cd", "pushd", "Set-Location", "sl", "chdir"].includes(name)) {
      dir = directory(args.find((a) => !a.startsWith("-")), dir);
    } else if (name === "git") {
      let at = dir;
      let v = 0;
      while (v < args.length && args[v].startsWith("-")) {
        if (args[v] === "-C") at = directory(args[v + 1], at);
        if (args[v] === "-C" || args[v] === "-c") v++;
        v++;
      }
      const why = reason(args[v], args.slice(v + 1), ownIndex);
      const where = at ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
      if (why && guarded(where)) {
        deny(why);
        break;
      }
    }
  }
} catch {
  // A command this cannot read passes.
}
process.exit(0);
