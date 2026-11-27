/**
 * Every notification the importer raises leads with the module id once. The
 * runtime half drives `openBookPage` (the one exported notice path of
 * module.mjs); the source half reads every `ui.notifications` call in
 * scripts/importer and holds its argument to a form that adds the prefix.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

let pass = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) {
    console.error(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`);
    process.exitCode = 1;
    throw new Error(`test-notice-prefix: ${label}`);
  }
  pass++;
};

/* --- the runtime: a cited page with no book, and one the seat may not see ---------------------- */

const notices = [];
globalThis.ui = { notifications: { warn: (m) => notices.push(["warn", m]), info: (m) => notices.push(["info", m]), error: (m) => notices.push(["error", m]) } };
const journals = [];
globalThis.game = {
  user: { isGM: false },
  i18n: { localize: (k) => k, format: (k, d) => `${k}|${JSON.stringify(d)}` },
  journal: journals,
};
globalThis.foundry = { applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (Base) => class extends Base {} } } };
globalThis.Hooks = { once() {}, on() {}, callAll() {} };
const { openBookPage } = await import("../../scripts/importer/module.mjs");

{
  const before = notices.length;
  const opened = await openBookPage("rr", 5);
  ok("a cited book with no shelf refuses", opened === false);
  ok("and says so once, led by the module id", notices.length === before + 1 && notices.at(-1)[0] === "warn" && notices.at(-1)[1] === "acks-extras | ACKS-IMPORTER.ui.citeNoBook|{\"book\":\"ACKS II Revised Rulebook\"}", JSON.stringify(notices.at(-1)));
}

{
  journals.push({
    getFlag: (_scope, key) => (key === "shelf" ? { book: "rr" } : null),
    pages: [{ type: "pdf", src: "books/rr.pdf", testUserPermission: () => false }],
  });
  const flagKey = readFileSync(new URL("../../scripts/importer/module.mjs", import.meta.url), "utf8").match(/const SHELF_FLAG = "([^"]+)"/)?.[1];
  ok("the shelf flag key is found", !!flagKey);
  journals[0].getFlag = (_scope, key) => (key === flagKey ? { book: "rr" } : null);
  const before = notices.length;
  const opened = await openBookPage("rr", 5);
  ok("a shelved book the seat may not observe refuses", opened === false);
  ok("and says so once, led by the module id", notices.length === before + 1 && notices.at(-1)[1].startsWith("acks-extras | ACKS-IMPORTER.ui.citeNoAccess|"), JSON.stringify(notices.at(-1)));
  ok("with one prefix", notices.at(-1)[1].split("acks-extras |").length === 2);
}

/* --- the source: every call's text arrives through a form that prefixes ------------------------ */

const root = fileURLToPath(new URL("../../scripts/importer/", import.meta.url));
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (name.endsWith(".mjs")) files.push(path);
  }
})(root);

/** The text between a call's opening parenthesis and its match, skipping strings and template literals. */
function argsOf(src, open) {
  let depth = 0;
  let quote = null;
  const stack = [];
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === "\\") i++;
      else if (quote === "`" && c === "$" && src[i + 1] === "{") {
        depth++;
        stack.push(depth);
        quote = null;
        i++;
      } else if (c === quote) quote = null;
      continue;
    }
    if (c === "`" || c === '"' || c === "'") quote = c;
    else if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") {
      if (c === "}" && stack.at(-1) === depth) {
        stack.pop();
        quote = "`";
      }
      depth--;
      if (!quote && depth === 0) return src.slice(open + 1, i);
    }
  }
  return null;
}

// An argument holds a text that leads with the module id, or a call that builds one.
const LEADS = [/`\$\{MODULE_ID\} \| /, /\b(?:noticeText|prefixed|notice|say|fingerprintNotice)\(/, /^\s*message\s*$/, /\bsaid\b/];
// A lang lookup is only ever read as the body of a prefixed text, or as the tail a prefixed text is followed by.
const BARE_LOOKUP = /(?<!\$\{MODULE_ID\} \| \$\{)(?<!prefixed\()(?<!prefixed\(\s{0,40})(?<!` \$\{)game\.i18n\.(?:format|localize)\(/;
// `message` (ingestBook) and `said` (readNotifier) are built from noticeText above their calls;
// progress.mjs labels a bar, not a notice.
const SKIPPED = new Set(["progress.mjs"]);

let seen = 0;
for (const path of files) {
  const file = path.slice(root.length).replaceAll("\\", "/");
  if (SKIPPED.has(file)) continue;
  const src = readFileSync(path, "utf8");
  for (const m of src.matchAll(/\bui\.notifications\??\.?(?:\[[^\]]*\]|info|warn|error)\??\.?\(/g)) {
    const open = m.index + m[0].length - 1;
    const args = argsOf(src, open);
    const line = src.slice(0, m.index).split("\n").length;
    ok(`${file}:${line} has a readable argument`, args !== null);
    seen++;
    const leads = LEADS.some((re) => re.test(args));
    ok(`${file}:${line} leads with the module id (${args.slice(0, 60).replace(/\s+/g, " ")})`, leads);
    // A literal prefix covers the lookups inside its own template.
    ok(`${file}:${line} reads no lang string bare`, args.includes("`${MODULE_ID} | ") || !BARE_LOOKUP.test(args));
    ok(`${file}:${line} carries it once`, (args.match(/\$\{MODULE_ID\} \|/g) ?? []).length <= 1 && !/prefixed\([^)]*\$\{MODULE_ID\} \|/.test(args));
  }
}
ok("the scan found the importer's notices", seen > 100, String(seen));

console.log(`test-notice-prefix: ${pass} checks passed`);
