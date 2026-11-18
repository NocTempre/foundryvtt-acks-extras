/**
 * Drives `.claude/hooks/full-gate-guard.mjs` with payloads shaped as the Bash
 * and PowerShell tools report them and checks what it exists to guarantee:
 *
 * - a command that runs the full gate by hand is denied, in whatever spelling,
 *   position or wrapper it arrives, and the refusal names the suite to run
 *   and the escape;
 * - a single suite, a pack build, the producers validator and any text that
 *   only mentions a gate pass;
 * - the escape `# full-gate-ok: <reason>` passes a command only with a reason
 *   on its own line;
 * - an unreadable payload and a payload with no command pass.
 *
 * Usage:  node tools/toolchain-tests/test-full-gate-guard.mjs [<full-gate-guard.mjs>]
 *         (defaults to the copy in this repository; pass a modified copy to
 *         confirm a case fails when the behaviour it guards is broken)
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import url from "node:url";

const TEMPLATE_ROOT = path.dirname(path.dirname(path.dirname(url.fileURLToPath(import.meta.url))));
const arg = process.argv[2] === "--hook" ? process.argv[3] : process.argv[2];
const HOOK = path.resolve(arg ?? path.join(TEMPLATE_ROOT, ".claude/hooks/full-gate-guard.mjs"));

/** Runs the hook on a payload and reports whether it denied, and what it said. */
function run(command, { tool_name = "Bash", raw = null } = {}) {
  const r = spawnSync(process.execPath, [HOOK], { encoding: "utf8", input: raw ?? JSON.stringify({ tool_name, tool_input: { command } }) });
  let json = null;
  try {
    json = r.stdout ? JSON.parse(r.stdout) : null;
  } catch {
    /* a non-JSON stdout is a failure the checks below report */
  }
  const out = json?.hookSpecificOutput;
  return { status: r.status, stdout: r.stdout, denied: out?.permissionDecision === "deny", reason: out?.permissionDecisionReason ?? "", event: out?.hookEventName };
}

const results = [];
/** Records one named case. */
function check(name, ok, detail = "") {
  results.push(ok);
  if (!ok) console.log(`FAIL ${name}${detail ? `: ${detail}` : ""}`);
}
const denies = (command, options) => check(`denies ${JSON.stringify(command)}`, run(command, options).denied);
const passes = (command, options) => {
  const r = run(command, options);
  check(`passes ${JSON.stringify(command)}`, !r.denied && r.status === 0 && r.stdout === "", r.stdout);
};

// --- the full gate, in every spelling ---
for (const command of [
  "npm test",
  "npm t",
  "npm run test",
  "npm run validate",
  "npm run-script validate",
  "npm test --silent",
  "npm run validate -- --verbose",
  "npm run test:tree",
  "npm run-script test:tree",
  "npm --prefix ../x test",
  "npm.cmd run validate",
  "node tools/validate.mjs",
  "node ./tools/validate.mjs",
  "node tools/run-tests.mjs",
  "node tools/run-tests.mjs --rules",
  "node tools\\validate.mjs",
  "node tools\\run-tests.mjs",
  "node C:\\Proj\\foundryvtt-acks-extras\\tools\\validate.mjs",
  'node "C:\\Proj\\foundryvtt-acks-extras\\tools\\run-tests.mjs"',
  "node /c/Proj/foundryvtt-acks-extras/tools/validate.mjs",
  "node --max-old-space-size=4096 tools/validate.mjs",
]) denies(command);

// --- position in a compound command ---
for (const command of [
  "cd /c/Proj/x && npm test",
  "npm run build:packs && npm run validate",
  "git status; npm test",
  "git status || npm run validate",
  "npm test 2>&1 | tail -5",
  "echo x | npm test",
  "(cd sub && npm test)",
  "echo start\nnpm run validate",
  "FOO=1 npm test",
  "time npm test",
  "timeout 600 npm run validate",
  "env CI=1 node tools/run-tests.mjs",
  "if true; then npm test; fi",
  "bash -c 'npm test'",
  'bash -lc "cd x && npm run validate"',
  'pwsh -Command "npm test"',
  'powershell -c "node tools\\validate.mjs"',
  'cmd /c "npm test"',
  "cmd /c npm run validate",
  "  npm   test  ",
]) denies(command);

// --- the PowerShell tool ---
for (const command of ["npm test", "& npm run validate", "cd C:\\Proj\\x; npm test", "node tools\\validate.mjs", "$env:CI = '1'; npm test", "npm.cmd test"]) denies(command, { tool_name: "PowerShell" });
passes("node tools\\test-foo.mjs", { tool_name: "PowerShell" });
passes("npm run build:packs", { tool_name: "PowerShell" });
passes("npm test # full-gate-ok: release walk", { tool_name: "PowerShell" });

// --- the refusal says what to do ---
{
  const r = run("npm test");
  check("the refusal is a PreToolUse deny", r.denied && r.event === "PreToolUse" && r.status === 0);
  check("it names the suite to run", /node tools\/test-<name>\.mjs/.test(r.reason), r.reason);
  check("it names the escape", /# full-gate-ok: <reason>/.test(r.reason), r.reason);
  check("it names the land's gate", /landing tool/.test(r.reason), r.reason);
}

// --- what passes ---
for (const command of [
  "node tools/test-foo.mjs",
  "node tools/importer/test-grid-rows.mjs",
  "node bin/test-validate.mjs",
  "node bin/test-full-gate-guard.mjs",
  "node tools/test-validate.mjs",
  "node tools/validate-producers.mjs",
  "node tools/validate-producers.mjs && node tools/test-foo.mjs",
  "node tools/build-packs.mjs",
  "node .claude/skills/acks-commit/commit-own-hunks.mjs land",
  "node .claude/skills/acks-branch/branch.mjs land x",
  "node C:\\Proj\\foundryvtt-acks-extras\\tools\\test-foo.mjs",
  "npm run build:packs",
  "npm run test:treeish",
  "npm install",
  "npm ci && npm run build:packs",
  "npm ls --depth 0",
  "npm view foo test",
  "node -e \"console.log('npm test')\"",
  "node scripts/run.mjs tools/validate.mjs",
  "git status",
  "",
]) passes(command);

// --- text that only mentions a gate ---
for (const command of [
  'git commit -m "fix: npm run validate stays green; npm test too"',
  "git commit -m 'run npm test; then npm run validate'",
  'grep -rn "npm test" .claude',
  "grep -rn 'node tools/validate.mjs' docs",
  "echo npm test",
  "echo npm test && node tools/test-foo.mjs",
  'echo "a; npm test"',
  "ls # npm test",
  "git commit -m \"$(cat <<'EOF'\nthe full gate is npm run validate\nEOF\n)\"",
  "cat <<'EOF'\nnpm test\nnode tools/validate.mjs\nEOF",
  "cat <<EOF > notes.txt\nnpm run validate\nEOF\nnode tools/test-foo.mjs",
  "git log --oneline -- tools/validate.mjs",
  "cat tools/run-tests.mjs",
]) passes(command);

// --- the escape ---
for (const command of [
  "npm test # full-gate-ok: release walk, local rules suites",
  "npm test #full-gate-ok: new repo scaffold",
  "npm test # full-gate-ok:one-word",
  "# full-gate-ok: release walk\nnpm run validate",
  "npm run build:packs && npm run validate # full-gate-ok: new module",
  "node tools/run-tests.mjs --rules # full-gate-ok: working-tree rules suites",
]) passes(command);

// --- the escape needs a reason on its own line ---
for (const command of [
  "npm test # full-gate-ok:",
  "npm test # full-gate-ok:   ",
  "npm test # full-gate-ok:\nnpm run validate",
  "npm test # full-gate-ok:\n  a reason on the next line",
  "npm test # full-gate-ok",
  "npm test # full gate ok: because",
  "npm test \"# full-gate-ok: because\"",
  "echo '# full-gate-ok: because'; npm test",
  "echo $#full-gate-ok: x; npm test",
]) denies(command);

// --- a payload it cannot use ---
passes("", { raw: "not json" });
passes("", { raw: "{}" });
passes("", { raw: JSON.stringify({ tool_input: {} }) });
passes("", { raw: JSON.stringify({ tool_input: { command: 42 } }) });

const failures = results.filter((ok) => !ok).length;
console.log(`test-full-gate-guard: ${results.length} cases, ${failures} failed`);
if (failures) process.exit(1);
