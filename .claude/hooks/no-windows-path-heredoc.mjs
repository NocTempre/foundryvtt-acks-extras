/**
 * Claude Code PreToolUse hook denying Bash commands that put a Windows path
 * inside a heredoc.
 *
 * Even a quoted `<<'PY'` heredoc loses a backslash level before the
 * interpreter sees the body: `C:\Proj\acks-rules` arrives as
 * `C:\Projacks-rules` with a BEL where `\a` was. Nothing errors — the file is
 * written and looks right in most viewers, the command runs against a path
 * that does not exist, and a control character can ride into a doc and
 * propagate through sync-toolchain. The fix is structural, not vigilance:
 * write files with the Write/Edit tools and pass paths as arguments or env
 * vars; a heredoc script that truly must contain one builds it from chr(92).
 *
 * The guard fires only when BOTH a heredoc operator and a drive-letter path
 * appear in one command — plain heredocs and plain Windows paths each pass.
 */

/** Reads all of stdin as UTF-8. Hook payloads are small and arrive at once. */
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

const raw = await readStdin();
let command = "";
try {
  command = JSON.parse(raw)?.tool_input?.command ?? "";
} catch {
  process.exit(0); // Unparseable payload is not a reason to block a command.
}

const hasHeredoc = /<<-?\s*['"]?\w+['"]?/u.test(command);
const hasDrivePath = /[A-Za-z]:\\/u.test(command);

if (hasHeredoc && hasDrivePath) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason:
        "A Windows path inside a Bash heredoc silently loses a backslash " +
        "level (C:\\Proj\\acks-rules arrives as C:\\Projacks-rules with a BEL " +
        "in it) and nothing errors. Write the file with the Write/Edit tools, " +
        "or pass the path as an argument or environment variable instead of " +
        "embedding it in the heredoc body.",
    },
  }));
}
process.exit(0);
