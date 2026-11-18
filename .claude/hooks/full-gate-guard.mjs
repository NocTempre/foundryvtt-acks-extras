/**
 * Claude Code PreToolUse hook (Bash and PowerShell) denying a command that
 * runs a repository's full gate by hand.
 *
 * Work is checked twice: its own unit suites after the build, and once at
 * integration, by the gate the landing tool runs itself (`land` in
 * `commit-own-hunks.mjs` and `branch.mjs`, which spawn npm directly and never
 * pass through this hook). A full gate run from a session is a third check
 * that overlaps the land's and every other session's, so it is refused.
 *
 * What is refused, as the command word of any command in the line (after
 * `&&`, `||`, `;`, `|`, a newline, a subshell, a wrapper such as `timeout`,
 * or inside `bash -c` / `pwsh -Command` / `cmd /c`):
 *
 * - `npm test`, `npm t`, `npm run test`, `npm run test:tree`,
 *   `npm run validate` (`npm.cmd`, flags and `run-script` included);
 * - `node tools/validate.mjs` and `node tools/run-tests.mjs`, however the
 *   path is spelled.
 *
 * Everything else passes: a single suite (`node tools/test-<name>.mjs`),
 * `npm run build:packs`, `tools/validate-producers.mjs`, and any text that
 * only mentions a gate (a commit message, a grep pattern, a heredoc body). A command that must run the full gate carries a comment
 * `# full-gate-ok: <reason>` with the reason on the same line.
 *
 * A command substituted inside double quotes is text to this hook, and so is
 * a script that a file runs.
 */

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
 * Split a command line into its commands, each a list of words, and collect
 * the comments. Separators, spaces and `#` inside quotes are text. A word
 * keeps no quotes. A backslash is a path separator, never an escape, except
 * before a double quote inside double quotes: a Windows path may appear
 * unquoted in either tool.
 */
function parse(command) {
  const commands = [[]];
  const comments = [];
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
      else if (c === "\\" && quote === '"' && command[i + 1] === '"') word += command[++i];
      else word += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      word ??= "";
    } else if (c === "#" && word === null) {
      let end = command.indexOf("\n", i);
      if (end === -1) end = command.length;
      comments.push(command.slice(i + 1, end));
      i = end - 1;
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
  return { commands: commands.filter((words) => words.length), comments };
}

/** Words that run the command after them, and the shell keywords that open a command. */
const WRAPPERS = new Set(["time", "command", "exec", "env", "nohup", "timeout", "sudo", "call", "builtin", "then", "do", "else", "elif", "if", "while", "until", "!"]);
/** An npm option that takes its value as the next word. */
const NPM_VALUE_FLAGS = new Set(["--prefix", "-C", "--workspace", "-w", "--cache", "--loglevel", "--userconfig", "--registry"]);
/** A node option that takes its value as the next word. */
const NODE_VALUE_FLAGS = new Set(["-r", "--require", "--import", "--loader", "--experimental-loader", "--env-file", "--conditions", "-C"]);

/** A program word's name: its last path segment, lower-cased, without a Windows executable suffix. */
function programOf(word) {
  return word.replace(/\\/g, "/").split("/").pop().toLowerCase().replace(/\.(cmd|exe|bat|ps1)$/u, "");
}

/** Whether `npm <args>` is `test`, `t`, `run test` or `run validate`. */
function npmRunsGate(args) {
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("-")) {
      if (NPM_VALUE_FLAGS.has(args[i])) i++;
    } else positional.push(args[i]);
  }
  const [verb, script] = positional;
  if (["test", "t", "tst"].includes(verb)) return true;
  return ["run", "run-script", "rum", "urn"].includes(verb) && (script === "test" || script === "validate" || script === "test:tree");
}

/** Whether `node <args>` runs the repository's validator or test runner. */
function nodeRunsGate(args) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-e" || args[i] === "-p" || args[i] === "--eval" || args[i] === "--print") return false;
    if (args[i].startsWith("-")) {
      if (NODE_VALUE_FLAGS.has(args[i])) i++;
      continue;
    }
    return /(^|\/)tools\/(validate|run-tests)\.mjs$/u.test(args[i].replace(/\\/g, "/").replace(/\/{2,}/g, "/"));
  }
  return false;
}

/** The command a shell word list hands to another shell as a string, or null. */
function nested(program, args) {
  if (["bash", "sh", "zsh", "dash", "ksh"].includes(program)) {
    const at = args.findIndex((a) => /^-[A-Za-z]*c[A-Za-z]*$/u.test(a));
    return at === -1 ? null : (args[at + 1] ?? null);
  }
  if (["pwsh", "powershell"].includes(program)) {
    const at = args.findIndex((a) => /^-c(ommand)?$/iu.test(a));
    return at === -1 ? null : args.slice(at + 1).join(" ");
  }
  if (program === "cmd") {
    const at = args.findIndex((a) => /^\/[ck]$/iu.test(a));
    return at === -1 ? null : args.slice(at + 1).join(" ");
  }
  return null;
}

/** Whether any command in `command` runs the full gate. */
function runsGate(command, depth = 0) {
  if (depth > 3) return false;
  for (const words of parse(withoutHeredocs(command)).commands) {
    let i = 0;
    for (;;) {
      while (i < words.length && /^[A-Za-z_]\w*=/u.test(words[i])) i++;
      if (i < words.length && WRAPPERS.has(programOf(words[i]))) {
        i++;
        while (i < words.length && (words[i].startsWith("-") || /^[A-Za-z_]\w*=/u.test(words[i]) || /^\d+(\.\d+)?[smhd]?$/u.test(words[i]))) i++;
        continue;
      }
      break;
    }
    if (i >= words.length) continue;
    const program = programOf(words[i]);
    const args = words.slice(i + 1);
    if (program === "npm" && npmRunsGate(args)) return true;
    if (program === "node" && nodeRunsGate(args)) return true;
    const inner = nested(program, args);
    if (inner !== null && runsGate(inner, depth + 1)) return true;
  }
  return false;
}

const raw = await readStdin();
let command = "";
try {
  command = JSON.parse(raw)?.tool_input?.command ?? "";
} catch {
  process.exit(0); // Unparseable payload is not a reason to block a command.
}
if (typeof command !== "string") process.exit(0);

const escaped = parse(withoutHeredocs(command)).comments.some((text) => /full-gate-ok:[ \t]*\S/u.test(text));

if (!escaped && runsGate(command)) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason:
        "Work is checked twice: its own unit suites after the build, and once at integration by the " +
        "gate the landing tool runs itself, so a hand-run full gate is a third check. Run " +
        "`node tools/test-<name>.mjs` for the files you touched instead; a command that must run " +
        "the full gate anyway carries a comment `# full-gate-ok: <reason>` on its line.",
    },
  }));
}
process.exit(0);
