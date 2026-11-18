/**
 * Feeds the canonical IP scanner invented files and checks what it reads and
 * what it says of them. Its long-literal warning measures literals: it fires
 * on a long string or template wherever one sits, and never on a comment or
 * regex that happens to lie between two quote marks. A path is known in any
 * letter case, and a data file that does not parse is still read. Asked with
 * `from`, it judges the text git holds for a path, byte for byte and whatever
 * the work tree holds, and `flagged` names each path it raised an error for.
 *
 * Each case is a throwaway tree of invented files scanned through `scanPaths`,
 * the entry the pre-commit hook and the commit tool use. A case that gives a
 * `from` is a repository as well: `head` is its first commit and `staged` its
 * index, each put there with no file written. A case that gives `command` has
 * its tree scanned by the scanner started as a command as well, at the tree
 * and through a link to it.
 *
 * Usage:  node tools/toolchain-tests/test-ip-scan.mjs [<ip-scan.mjs>]
 *         (defaults to tools/ip-scan.mjs; pass a modified copy to
 *         confirm a case fails when the behaviour it guards is broken)
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";

const TEMPLATE_ROOT = path.dirname(path.dirname(path.dirname(url.fileURLToPath(import.meta.url))));
const SCANNER = path.resolve(process.argv[2] ?? path.join(TEMPLATE_ROOT, "tools", "ip-scan.mjs"));
const { scanPaths } = await import(url.pathToFileURL(SCANNER).href);

// The scanner runs in this process and its git reads this environment: a
// caller's own repository variables would turn it toward the caller's
// repository, and a runner has no identity to commit as.
for (const key of Object.keys(process.env)) if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|PREFIX)$/iu.test(key)) delete process.env[key];
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "test", GIT_AUTHOR_EMAIL: "test@example.invalid", GIT_COMMITTER_NAME: "test", GIT_COMMITTER_EMAIL: "test@example.invalid" };
const git = (root, args, input) => execFileSync("git", args, { cwd: root, input, env: GIT_ENV, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
/** Put each text in a repository's index under its name, with no file written. */
function stage(root, texts) {
  const lines = Object.entries(texts).map(([rel, text]) => `100644 ${git(root, ["hash-object", "-w", "--stdin"], text).trim()}\t${rel}\0`);
  if (lines.length) git(root, ["update-index", "--add", "-z", "--index-info"], lines.join(""));
}
/** Starts a copy of the scanner kept in a tree as a command, at the tree and through a link to it, and gives what either did other than report the tree's one leak. */
function commandProblems(root) {
  fs.mkdirSync(path.join(root, "tools"));
  fs.copyFileSync(SCANNER, path.join(root, "tools", "ip-scan.mjs"));
  const link = `${root}.link`;
  fs.symlinkSync(root, link, "junction");
  const problems = [];
  for (const [how, from] of [
    ["at the tree", root],
    ["through a link to it", link],
  ]) {
    // No repository above the tree is asked what it tracks, so the tree is walked wherever it stands.
    const r = spawnSync(process.execPath, [path.join(from, "tools", "ip-scan.mjs")], { cwd: from, encoding: "utf8", env: { ...GIT_ENV, GIT_CEILING_DIRECTORIES: path.dirname(root) } });
    if (r.status !== 1 || !/LEAK {2}ruledata/u.test(r.stderr) || !/ip-scan: FAILED — 1 leak\(s\)/u.test(r.stderr)) problems.push(`started ${how}, it exited ${r.status} and said: ${`${r.stdout}${r.stderr}`.trim() || "nothing"}`);
  }
  return problems;
}

// Invented text, longer than the scanner's 1500-character threshold.
const PROSE = "An invented sentence standing in for a paragraph someone pasted. ".repeat(26);
const HALF = PROSE.slice(0, 800);
const FILLER = Array.from({ length: 40 }, (_, n) => `export const filler${n} = ${n}; // ${"-".repeat(60)}\n`).join("");
// The notice is assembled so this file never holds one whole, and it
// stays out of every grep for the phrase.
const NOTICE = ["All", "rights", "reserved."].join(" ");
/** A data file as an author writes one, and the same file with a publisher's notice in it. */
const CLEAN = `${JSON.stringify({ title: "An invented label" }, null, 2)}\n`;
const NOTICED = `${JSON.stringify({ title: "An invented label", footer: `Invented Press. ${NOTICE}` }, null, 2)}\n`;
const NOTICED_SOURCE = `// Invented Press. ${NOTICE}\nexport const x = 1;\n`;
const NOTICED_TEMPLATE = `<p>Invented Press. ${NOTICE}</p>\n`;

const CASES = [
  {
    name: "a backtick in a comment or a regex opens no literal",
    files: {
      "scripts/module.mjs": `// A lone \` in a comment opens nothing, and the one in the regex below
// closes nothing: pairing quote marks would read 3,000 characters between.
${FILLER}const TICKS = /[\`'"]/g;
export const tidy = (s) => s.replace(TICKS, "");
`,
    },
    warnings: [],
  },
  {
    name: "a long string, template, or template with holes warns at its own line",
    files: {
      "scripts/texts.mjs": `export const A = "${PROSE}";
export const B = \`
${PROSE}
\`;
export const C = (x) => \`${HALF}\${x}${HALF}\`;
`,
    },
    warnings: [
      /^scripts\/texts\.mjs: line 1: a 1692-char string literal — verify this is authored, not transcribed$/,
      /^scripts\/texts\.mjs: line 2: a 1694-char string literal/,
      /^scripts\/texts\.mjs: line 5: a 1602-char string literal/,
    ],
  },
  {
    name: "a template counts its own text; a literal in its holes is measured alone",
    files: {
      "scripts/card.mjs": `export const card = (a) => \`<p>\${[${Array.from({ length: 300 }, (_, n) => `a.v${n}`).join(", ")}].join(" ")}</p>\`;
export const note = (on) => \`<p>\${on ? "${PROSE}" : ""}</p>\`;
`,
    },
    warnings: [/^scripts\/card\.mjs: line 2: a 1692-char string literal/],
  },
  {
    name: "a literal after a regex holding a backtick is still found",
    files: {
      "tools/quotes.mjs": `const QUOTES = /["'\`]/g;
export const A = \`${PROSE}\`;
// a closing \` in a comment
`,
    },
    warnings: [/^tools\/quotes\.mjs: line 2: a 1692-char string literal/],
  },
  {
    name: "a file the tokenizer cannot read is measured by quote pairing, and says so",
    files: {
      "scripts/broken.mjs": `export const broken = (1));
export const A = "${PROSE}";
`,
    },
    warnings: [
      /^scripts\/broken\.mjs: line 1: the literal scan lost its place here, so this file's literals were measured by pairing quote marks/,
      /^scripts\/broken\.mjs: line 2: a 1692-char string literal/,
    ],
  },
  {
    name: "a copyright notice in source still fails, in a comment as anywhere",
    files: { "tools/helper.mjs": `// ${NOTICE}\nexport const x = 1;\n` },
    warnings: [],
    errors: [/^tools\/helper\.mjs — publisher attribution in source/],
  },
  {
    name: "a banned directory, and a file whose text is read, are known in any letter case",
    files: {
      "_Proposals/x.json": "{}\n",
      "sub/_Manifest/x.json": "{}\n",
      "sub/_Ledger.JSON": "{}\n",
      "ACKS-Rules/notes.md": "x\n",
      "RuleData/table.json": "{}\n",
      "Packs/_Source/items/x.json": NOTICED,
      "Cookbook/x.JSON": NOTICED,
      "Register/rr/x.json": NOTICED,
      "Lang/EN.JSON": NOTICED,
      "Templates/Sheet.HBS": NOTICED_TEMPLATE,
      "Scripts/Helper.MJS": NOTICED_SOURCE,
      "Tools/Helper.MJS": NOTICED_SOURCE,
      // The scanner's own file, which names the notice in order to look for it.
      "Tools/IP-Scan.MJS": NOTICED_SOURCE,
    },
    warnings: [],
    errors: [
      /^_Proposals\/x\.json — extraction-pipeline state/,
      /^sub\/_Manifest\/x\.json — extraction-pipeline state/,
      /^sub\/_Ledger\.JSON — extraction-pipeline state/,
      /^ACKS-Rules\/notes\.md — extraction-pipeline state/,
      /^RuleData\/table\.json — extraction-pipeline state/,
      /^Packs\/_Source\/items\/x\.json: footer contains a copyright notice/,
      /^Cookbook\/x\.JSON: footer contains a copyright notice/,
      /^Register\/rr\/x\.json: footer contains a copyright notice/,
      /^Lang\/EN\.JSON: footer contains a copyright notice/,
      /^Templates\/Sheet\.HBS — copyright notice in a shipped template/,
      /^Scripts\/Helper\.MJS — publisher attribution in source/,
      /^Tools\/Helper\.MJS — publisher attribution in source/,
    ],
  },
  {
    name: "a data file that does not parse is read as text for a notice",
    files: {
      "lang/half.json": `{ "title": "half-written", "footer": "Invented Press. ${NOTICE}"\n`,
      "lang/half-clean.json": '{ "title": "half-written, ',
    },
    warnings: [],
    errors: [/^lang\/half\.json — copyright notice in a data file that does not parse/],
  },
  {
    name: "`flagged` names each path an error was raised for, as it was given, and no other",
    files: { "docs/note.txt": "clean\n" },
    // Judged by name alone, so neither banned file has to exist, and one could not on Windows.
    paths: ["ruledata/a: b — c.json", "docs/note.txt", "sub/RULES.md"],
    warnings: [],
    errors: [/^ruledata\/a: b — c\.json — extraction-pipeline state/, /^sub\/RULES\.md — LOCAL-ONLY rules extract/],
    flagged: ["ruledata/a: b — c.json", "sub/RULES.md"],
  },
  {
    name: "asked about the index, it judges what is staged for a path, whatever the work tree holds",
    from: "index",
    // Paths are given with this machine's separator, as a caller that built them here would.
    native: true,
    staged: { "lang/staged.json": NOTICED, "lang/on-disk.json": CLEAN, "scripts/gone.mjs": NOTICED_SOURCE, "templates/gone.hbs": NOTICED_TEMPLATE },
    files: { "lang/staged.json": CLEAN, "lang/on-disk.json": NOTICED },
    warnings: [],
    errors: [/^lang[/\\]staged\.json: footer contains a copyright notice/, /^scripts[/\\]gone\.mjs — publisher attribution in source/, /^templates[/\\]gone\.hbs — copyright notice in a shipped template/],
    flagged: ["lang/staged.json", "scripts/gone.mjs", "templates/gone.hbs"],
  },
  {
    name: "asked about a tree, it judges what that tree holds, and a path the tree lacks has no text",
    from: "HEAD",
    head: { "lang/in-head.json": NOTICED, "lang/staged.json": CLEAN },
    staged: { "lang/in-head.json": CLEAN, "lang/staged.json": NOTICED, "lang/new.json": NOTICED },
    files: {},
    warnings: [],
    errors: [/^lang\/in-head\.json: footer contains a copyright notice/],
    flagged: ["lang/in-head.json"],
  },
  {
    name: "each blob is read as its own bytes, an empty one, one with no line end and one over a megabyte among them",
    from: "index",
    staged: {
      "lang/0-empty.json": "",
      "lang/1-no-line-end.json": `{"k":"${"x".repeat(1600)}"}`,
      // 1,700 characters in 4,250 bytes.
      "lang/2-accents.json": `{"k":"${"é—".repeat(850)}"}\n`,
      "lang/3-crlf.json": `{\r\n"k": "${"x".repeat(1800)}"\r\n}\r\n`,
      // No JSON, and a line that reads as the header git prints before a blob.
      "lang/4-header.json": `{}\n${"0".repeat(40)} blob 5\n{}\n`,
      "lang/5-large.json": `{"k":"${"x".repeat(1_200_000)}"}\n`,
      "lang/6-last.json": NOTICED,
    },
    files: {},
    warnings: [
      /^lang\/1-no-line-end\.json: k is 1600 chars/,
      /^lang\/2-accents\.json: k is 1700 chars/,
      /^lang\/3-crlf\.json: k is 1800 chars/,
      /^lang\/5-large\.json: k is 1200000 chars/,
    ],
    errors: [/^lang\/6-last\.json: footer contains a copyright notice/],
    flagged: ["lang/6-last.json"],
  },
  {
    name: "started as a command through a linked directory, the scanner scans as it does started at the directory",
    files: { "ruledata/x.json": "{}\n", "docs/note.txt": "clean\n" },
    command: true,
    // Nothing here is asked of `scanPaths`.
    paths: [],
    warnings: [],
  },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "acks-ip-scan-"));
let failures = 0;
try {
  CASES.forEach((testCase, n) => {
    const root = path.join(tmp, String(n));
    const problems = [];
    try {
      fs.mkdirSync(root);
      for (const [rel, text] of Object.entries(testCase.files)) {
        fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        fs.writeFileSync(path.join(root, rel), text);
      }
      if (testCase.command) problems.push(...commandProblems(root));
      if (testCase.from) {
        git(root, ["init", "-q", "-b", "main"]);
        if (testCase.head) {
          stage(root, testCase.head);
          git(root, ["commit", "-q", "--no-verify", "-m", "base"]);
        }
        stage(root, testCase.staged);
      }
      const native = (rel) => (testCase.native ? rel.split("/").join(path.sep) : rel);
      const paths = (testCase.paths ?? Object.keys(testCase.staged ?? testCase.files)).map(native);
      const { errors, warnings, flagged } = scanPaths(root, paths, testCase.from ? { from: testCase.from } : undefined);
      if (testCase.flagged && JSON.stringify(flagged) !== JSON.stringify(testCase.flagged.map(native))) problems.push(`flagged is ${JSON.stringify(flagged)}`);
      for (const [kind, lines, expected] of [
        ["warning", warnings, testCase.warnings],
        ["error", errors, testCase.errors ?? []],
      ]) {
        for (const re of expected) if (!lines.some((line) => re.test(line))) problems.push(`no ${kind} matches ${re}`);
        for (const line of lines) if (!expected.some((re) => re.test(line))) problems.push(`unexpected ${kind}: ${line}`);
      }
    } catch (e) {
      // A scan that throws is that case's failure, and the cases after it still run.
      problems.push(`threw: ${String(e.stack ?? e).split("\n").slice(0, 4).join("\n  ")}`);
    }
    if (problems.length) {
      failures++;
      console.log(`FAIL ${testCase.name}\n  ${problems.join("\n  ")}`);
    } else console.log(`ok   ${testCase.name}`);
  });
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
const shown = path.relative(TEMPLATE_ROOT, SCANNER);
console.log(`test-ip-scan: ${CASES.length} cases against ${shown.startsWith("..") ? SCANNER : shown}, ${failures} failed`);
if (failures) process.exit(1);
