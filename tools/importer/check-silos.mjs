/**
 * The book gate: book-specific code stays in its silo, and an ACKS book's code
 * stays in its folder.
 *
 * A silo owns book ids and is kept out of the zip. One is declared, `ose`: the
 * books `REGISTRY` marks `stats: "ose"`, the id prefix `ose.`, the kinds
 * `kind.oseMonster` and `kind.oseLocation`, and the member files
 * `OSE_SILO.members` lists. Its books and members have left `main` for the
 * parked `ose` branch, so today it owns none and the gate keeps the ids and
 * kinds out of `scripts/`. The ACKS books own no silo: they ship, and each one's
 * print facts live in `scripts/importer/books/<id>/`, which the seam
 * `scripts/importer/books/index.mjs` imports. The rulings are
 * docs/importer/DECISIONS.md, "Book-specific code lives in a silo, and a gate
 * keeps it there" and "An ACKS book's importer code lives in its own folder,
 * and the silo gate counts what is left".
 *
 * Seven rules, each a pure function over facts a parse extracts (import edges,
 * string and template literals, `book` roles, comments), never a regex over
 * source:
 *
 *   imports       a file outside the silo imports a member (static, `export
 *                 from`, literal `import()`), or calls `import()` with a
 *                 non-literal argument under `scripts/`
 *   literals      under `scripts/`, a file outside the silo holds a literal that
 *                 names a silo book id, the silo id, a silo kind or a member path;
 *                 a `// silo-ok: <reason>` comment on or just above the line
 *                 excuses it, and one with no reason is itself a violation
 *   closure       a member is reachable from `module.json`'s entry points, other
 *                 than through the silo's manifest edge
 *   agreement     the manifest imports the silo's entry exactly when `module.json`
 *                 declares its stylesheet; applicable once the manifest exists
 *   book-roles    a file in `scripts/importer/` outside `books/`, or
 *                 `tools/importer/compile-cookbook.mjs`, holds a `book:` value or
 *                 a `.book ===`/`!==` test naming an ACKS book id (a registry id
 *                 that names no silo). The ROLE is matched, never the bare
 *                 literal: `"cat"` is also a form field. Hits are counted per
 *                 file and id, and `silo-ok` excuses them as it does a literal
 *   book-imports  nothing under `books/<a>/` imports from `books/<b>/`, and
 *                 under `scripts/` nothing but `books/index.mjs` imports a book
 *                 folder
 *   book-manifest every `books/<id>/` is a registry id with an `index.mjs`, and
 *                 `books/index.mjs` imports exactly the folders there are
 *
 * Today's violations are `tools/importer/silo-baseline.json`, each with a count
 * where it repeats. The gate fails on a violation the baseline lacks or holds
 * more of, and on a baseline entry that no longer occurs or occurs less, so the
 * file only shrinks. `--write-baseline` rewrites it.
 *
 * A script's facts come from the acorn Node bundles, which needs
 * `--expose-internals`, as `tools/free-variables.mjs` does; the flag is refused
 * inside NODE_OPTIONS, so `tools/validate-extra.mjs` re-execs:
 *
 *   node --expose-internals tools/importer/check-silos.mjs [--write-baseline]
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

let acorn;
try {
  acorn = createRequire(import.meta.url)("internal/deps/acorn/acorn/dist/acorn");
} catch (err) {
  console.error(`check-silos: cannot reach Node's bundled acorn — ${String(err?.message ?? err).split("\n")[0]}`);
  console.error("check-silos: run with --expose-internals, or add acorn as a devDependency; this gate does not skip.");
  process.exit(2);
}

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The repository root, two directories above this file. */
export const ROOT = path.resolve(HERE, "..", "..");

/** Where today's violations are committed. */
export const BASELINE_PATH = path.join(HERE, "silo-baseline.json");

/** The rules, in the order a report lists them. */
export const RULES = ["imports", "literals", "closure", "agreement", "book-roles", "book-imports", "book-manifest"];

/**
 * Where an ACKS book's code lives. `dir` holds one folder per book, `manifest`
 * is the one file that imports them, `scope` lists the paths (a prefix ending in
 * `/`, or an exact file) whose `book` roles are counted outside `dir`, and
 * `ids` is filled in by `loadBookTree` from the registry.
 */
export const BOOK_TREE = Object.freeze({
  dir: "scripts/importer/books/",
  manifest: "scripts/importer/books/index.mjs",
  scope: ["scripts/importer/", "tools/importer/compile-cookbook.mjs"],
});

/** The longest literal a violation's `target` carries; a longer one is cut. */
const TARGET_MAX = 80;

/**
 * The silo definition, less the book ids, which `loadSilo` reads from `REGISTRY`.
 *
 * `members` are repository paths: an exact path, or a path whose basename holds
 * `*`. `dir` is the silo's own directory, every file under which is a member.
 * `entry` is the one file the manifest imports; `manifest` is the one file that
 * may; `stylesheet` is the silo's CSS, null while it has none. `importExempt`
 * lists files that may import a member (`target` narrows it to one file).
 * `literalExempt` lists files outside the silo that may name its ids.
 */
export const OSE_SILO = Object.freeze({
  id: "ose",
  kinds: ["kind.oseMonster", "kind.oseLocation"],
  members: [],
  dir: "scripts/importer/silos/ose/",
  entry: "scripts/importer/silos/ose/index.mjs",
  manifest: "scripts/importer/silos/index.mjs",
  stylesheet: null,
  importExempt: [
    { file: "scripts/importer/silos/index.mjs", target: "scripts/importer/silos/ose/index.mjs" },
    { file: "tools/importer/silos.mjs" },
  ],
  literalExempt: ["scripts/importer/books.mjs", "scripts/importer/silos/seam.mjs"],
});

/**
 * The silo with its book ids filled in from the registry: every id whose
 * `stats` is `"ose"`. Never a hand list, so a book added to the registry joins
 * the silo's literal rule with no edit here.
 *
 * @param {string} [root] repository root holding `scripts/importer/books.mjs`
 * @param {object} [base] the silo definition to extend
 * @returns {Promise<object>} the definition plus `books`
 */
export async function loadSilo(root = ROOT, base = OSE_SILO) {
  const { REGISTRY } = await import(pathToFileURL(path.join(root, "scripts/importer/books.mjs")).href);
  const books = Object.keys(REGISTRY).filter((id) => REGISTRY[id].stats === base.id);
  return { ...base, books };
}

/**
 * The book tree with its ids filled in from the registry: every id whose
 * `stats` names no silo. A book added to the registry joins the role rule with
 * no edit here.
 *
 * @param {string} [root] repository root holding `scripts/importer/books.mjs`
 * @param {object} [silo] the silo whose books are left out
 * @returns {Promise<object>} `BOOK_TREE` plus `ids`
 */
export async function loadBookTree(root = ROOT, silo = OSE_SILO) {
  const { REGISTRY } = await import(pathToFileURL(path.join(root, "scripts/importer/books.mjs")).href);
  const ids = Object.keys(REGISTRY).filter((id) => REGISTRY[id].stats !== silo.id);
  return { ...BOOK_TREE, ids };
}

/* ------------------------------------------------------------------ facts */

/** The text of a string literal, or of a template with no interpolation; null for anything else. */
function staticText(node) {
  if (node?.type === "Literal" && typeof node.value === "string") return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0].value.cooked ?? node.quasis[0].value.raw;
  return null;
}

/**
 * The facts one JavaScript module's rules read.
 *
 * `imports` holds each import edge: `kind` is `static`, `reexport` or
 * `dynamic`, and `spec` is its specifier, null for a dynamic import whose
 * argument is not a literal. `literals` holds each string literal and each
 * template quasi outside an import specifier, with the line it opens on.
 * `comments` holds each comment with the lines it spans, a block's leading
 * stars removed, and whether code stands before it on its first line.
 * `roles` holds each string a file uses AS a book: a `book:` property value
 * (`kind: "value"`), and a string a `.book` member is compared to with `===`,
 * `!==`, `==` or `!=`, or matched against by a `switch` (`kind: "test"`).
 *
 * @param {string} source
 * @returns {{imports: {kind: string, spec: string|null}[], literals: {text: string, line: number}[], roles: {kind: string, text: string, line: number}[], comments: {text: string, line: number, last: number, trailing: boolean}[]}}
 */
export function factsOf(source) {
  const comments = [];
  const ast = acorn.parse(source, {
    ecmaVersion: "latest",
    sourceType: "module",
    locations: true,
    allowHashBang: true,
    allowAwaitOutsideFunction: true,
    onComment: (block, text, start, _end, from, to) =>
      comments.push({
        text: block ? text.replace(/^[ \t]*\*+ ?/gm, "") : text,
        line: from.line,
        last: to.line,
        trailing: source.slice(source.lastIndexOf("\n", start - 1) + 1, start).trim() !== "",
      }),
  });
  const imports = [];
  const literals = [];
  const roles = [];
  const isBookMember = (n) => {
    const m = n?.type === "ChainExpression" ? n.expression : n;
    return m?.type === "MemberExpression" && (m.computed ? staticText(m.property) === "book" : m.property.type === "Identifier" && m.property.name === "book");
  };
  const role = (kind, valueNode) => {
    const text = staticText(valueNode);
    if (text !== null) roles.push({ kind, text, line: valueNode.loc.start.line });
  };
  const visit = (node) => {
    if (!node || typeof node.type !== "string") return;
    switch (node.type) {
      case "Property":
        if (!node.computed && !node.shorthand && (node.key.name === "book" || node.key.value === "book")) role("value", node.value);
        break;
      case "BinaryExpression":
        if (["===", "!==", "==", "!="].includes(node.operator)) {
          if (isBookMember(node.left)) role("test", node.right);
          if (isBookMember(node.right)) role("test", node.left);
        }
        break;
      case "SwitchStatement":
        if (isBookMember(node.discriminant)) for (const c of node.cases) if (c.test) role("test", c.test);
        break;
      case "ImportDeclaration":
        imports.push({ kind: "static", spec: node.source.value });
        return;
      case "ExportAllDeclaration":
        imports.push({ kind: "reexport", spec: node.source.value });
        return;
      case "ExportNamedDeclaration":
        if (node.source) {
          imports.push({ kind: "reexport", spec: node.source.value });
          return;
        }
        break;
      case "ImportExpression": {
        const spec = staticText(node.source);
        imports.push({ kind: "dynamic", spec });
        if (spec === null) visit(node.source);
        return;
      }
      case "Literal":
        if (typeof node.value === "string") literals.push({ text: node.value, line: node.loc.start.line });
        return;
      case "TemplateElement":
        literals.push({ text: node.value.cooked ?? node.value.raw, line: node.loc.start.line });
        return;
    }
    for (const key of Object.keys(node)) {
      if (key === "loc") continue;
      const child = node[key];
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === "object") visit(child);
    }
  };
  visit(ast);
  return { imports, literals, roles, comments };
}

/* ------------------------------------------------------------------- tree */

/**
 * Every repository file the gate may read, as `/`-separated paths from `root`.
 * With `useGit`, the tracked and the untracked-not-ignored files, so a path a
 * machine ignores (`tools/rules-tests/`) never reaches the baseline; without,
 * or where git cannot answer, a directory walk that skips `node_modules`,
 * `.git` and `rules-tests`.
 *
 * @param {string} root
 * @param {boolean} [useGit]
 * @returns {string[]}
 */
export function listFiles(root, useGit = false) {
  if (useGit) {
    try {
      const out = execFileSync("git", ["-C", root, "ls-files", "-co", "--exclude-standard", "-z"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
      return out.split("\0").filter((f) => f && fs.existsSync(path.join(root, f))).sort();
    } catch {
      /* not a repository: walk */
    }
  }
  const files = [];
  (function walk(dir, rel) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (["node_modules", ".git", "rules-tests"].includes(entry.name)) continue;
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), next);
      else files.push(next);
    }
  })(root, "");
  return files.sort();
}

/**
 * The member files of a silo among `present`: exact paths and `*` patterns of
 * `silo.members`, plus every file under `silo.dir`. An exact member that is not
 * present is reported as missing, not dropped.
 *
 * @param {object} silo
 * @param {string[]} present
 * @returns {{members: string[], missing: string[]}}
 */
export function expandMembers(silo, present) {
  const members = new Set(present.filter((f) => f.startsWith(silo.dir)));
  const missing = [];
  for (const pattern of silo.members) {
    if (!pattern.includes("*")) {
      if (present.includes(pattern)) members.add(pattern);
      else missing.push(pattern);
      continue;
    }
    const slash = pattern.lastIndexOf("/");
    const dir = pattern.slice(0, slash + 1);
    const re = new RegExp(`^${pattern.slice(slash + 1).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", "[^/]*")}$`);
    for (const f of present) if (f.startsWith(dir) && !f.slice(dir.length).includes("/") && re.test(f.slice(dir.length))) members.add(f);
  }
  return { members: [...members].sort(), missing };
}

/**
 * Where a relative specifier lands, as a repository path. A bare or URL
 * specifier is not an edge in this tree and gives null. A path no file answers
 * to is returned as written, so an edge into a member that is gone still shows.
 */
function resolveSpec(from, spec, present) {
  if (typeof spec !== "string" || !spec.startsWith(".")) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  return [base, `${base}.mjs`, `${base}/index.mjs`].find((c) => present.has(c)) ?? base;
}

/**
 * Parses every `.mjs` under `scripts/` and `tools/` among `present`.
 *
 * @param {string} root
 * @param {string[]} present
 * @returns {{facts: Map<string, ReturnType<typeof factsOf>>, errors: string[]}}
 */
export function loadFacts(root, present) {
  const facts = new Map();
  const errors = [];
  for (const file of present) {
    if (!file.endsWith(".mjs") || !(file.startsWith("scripts/") || file.startsWith("tools/"))) continue;
    try {
      facts.set(file, factsOf(fs.readFileSync(path.join(root, file), "utf8")));
    } catch (err) {
      errors.push(`${file}: cannot parse — ${String(err?.message ?? err).split("\n")[0]}`);
    }
  }
  return { facts, errors };
}

/* ------------------------------------------------------------------ rules */

/** The `silo-ok` comments of a file: the lines each excuses, and whether one has no reason. */
function siloOk(comments) {
  const lines = new Set();
  let bare = false;
  for (const c of comments) {
    const first = c.text.split("\n")[0].trim();
    if (!/^silo-ok\b/.test(first)) continue;
    const m = /^silo-ok:\s*(\S.*)$/.exec(c.text.trim().replace(/\s*\n\s*/g, " "));
    if (!m) {
      bare = true;
      continue;
    }
    // A comment after code excuses its own lines; one standing alone excuses the line below it too.
    for (let n = c.line; n <= c.last + (c.trailing ? 0 : 1); n++) lines.add(n);
  }
  return { lines, bare };
}

/** Whether a literal names the silo: a book id or the silo id, bare or as a dotted prefix; a kind; a member path. */
function namesSilo(text, silo, members) {
  const names = [...silo.books, silo.id];
  if (names.some((n) => text === n || text.startsWith(`${n}.`))) return true;
  if (silo.kinds.includes(text)) return true;
  return members.some((m) => text === m || text.endsWith(`/${m}`) || (!m.endsWith(".mjs") && text.endsWith(`/${path.posix.basename(m)}`)));
}

/**
 * The rules over one tree's facts.
 *
 * @param {object} tree
 * @param {Map<string, ReturnType<typeof factsOf>>} tree.facts parsed `.mjs` files
 * @param {string[]} tree.present every repository path
 * @param {object} tree.silo the definition, `books` filled in
 * @param {string[]} tree.members the silo's member files
 * @param {{esmodules?: string[], styles?: string[]}} tree.moduleJson
 * @param {object|null} [tree.bookTree] `BOOK_TREE` with `ids`; the three book rules run only when given
 * @returns {{violations: {rule: string, file: string, target: string, count: number}[], notes: string[]}}
 *   violations carry no line numbers; a repeat of one `(rule, file, target)` is one entry whose `count` is the repeats
 */
export function findViolations({ facts, present, silo, members, moduleJson, bookTree = null }) {
  const memberSet = new Set(members);
  const isMember = (f) => memberSet.has(f) || f.startsWith(silo.dir);
  const presentSet = new Set(present);
  const found = new Map();
  const add = (rule, file, target) => {
    const k = `${rule}\0${file}\0${target}`;
    const held = found.get(k);
    if (held) held.count++;
    else found.set(k, { rule, file, target, count: 1 });
  };
  const notes = [];

  for (const [file, f] of facts) {
    // imports: a computed specifier can land anywhere, a member's own included
    if (file.startsWith("scripts/") && f.imports.some((imp) => imp.spec === null)) add("imports", file, "<non-literal import()>");
    if (isMember(file)) continue;
    for (const imp of f.imports) {
      if (imp.spec === null) continue;
      const target = resolveSpec(file, imp.spec, presentSet);
      if (!target || !isMember(target)) continue;
      if (silo.importExempt.some((x) => x.file === file && (!x.target || x.target === target))) continue;
      add("imports", file, target);
    }
    // literals
    if (!file.startsWith("scripts/") || silo.literalExempt.includes(file)) continue;
    const ok = siloOk(f.comments);
    if (ok.bare) add("literals", file, "silo-ok without a reason");
    for (const lit of f.literals) {
      if (ok.lines.has(lit.line) || !namesSilo(lit.text, silo, members)) continue;
      add("literals", file, lit.text.length > TARGET_MAX ? `${lit.text.slice(0, TARGET_MAX)}…` : lit.text);
    }
  }

  // closure: a member reachable from module.json's entry points
  const manifestEdge = (from, to) => from === silo.manifest && to === silo.entry;
  const roots = [...(moduleJson.esmodules ?? []), ...(moduleJson.styles ?? [])];
  const reached = new Map();
  for (const root of roots) {
    if (reached.has(root)) continue;
    reached.set(root, root);
    const queue = [root];
    while (queue.length) {
      const file = queue.shift();
      for (const imp of facts.get(file)?.imports ?? []) {
        const to = resolveSpec(file, imp.spec, presentSet);
        if (!to || reached.has(to) || manifestEdge(file, to)) continue;
        reached.set(to, root);
        queue.push(to);
      }
    }
  }
  for (const [file, root] of reached) if (isMember(file)) add("closure", file, root);

  // agreement: the manifest imports the entry exactly when module.json declares the stylesheet
  if (!presentSet.has(silo.manifest)) {
    notes.push(`agreement: not yet applicable (no ${silo.manifest}); the SILOS.${silo.id}.active half waits on it too`);
  } else {
    const imports = (facts.get(silo.manifest)?.imports ?? []).some((i) => resolveSpec(silo.manifest, i.spec, presentSet) === silo.entry);
    const declared = silo.stylesheet ? (moduleJson.styles ?? []).includes(silo.stylesheet) : imports;
    if (imports !== declared) add("agreement", silo.manifest, `stylesheet ${silo.stylesheet}`);
    notes.push(`agreement: manifest ${imports ? "imports" : "does not import"} ${silo.id}; the SILOS.${silo.id}.active half is not yet checked`);
  }

  if (bookTree) bookRules({ facts, present: presentSet, silo, isMember, bookTree, add, notes });

  const violations = [...found.values()].sort((a, b) => key(a).localeCompare(key(b)));
  return { violations, notes };
}

/**
 * The three ACKS-book rules: `book-roles`, `book-imports` and `book-manifest`.
 * `add` records one hit; `notes` takes what the tree cannot be asked yet.
 */
function bookRules({ facts, present, silo, isMember, bookTree, add, notes }) {
  const ids = new Set(bookTree.ids);
  const inScope = (file) => !file.startsWith(bookTree.dir) && bookTree.scope.some((s) => (s.endsWith("/") ? file.startsWith(s) : file === s));
  /** The book folder a path sits in, or null for a path outside every folder (the manifest and `books/` files included). */
  const folderOf = (file) => {
    if (!file.startsWith(bookTree.dir)) return null;
    const rest = file.slice(bookTree.dir.length);
    const slash = rest.indexOf("/");
    return slash < 0 ? null : rest.slice(0, slash);
  };

  for (const [file, f] of facts) {
    // book-roles: the role a string plays, never the bare literal
    if (inScope(file) && !silo.literalExempt.includes(file) && !isMember(file)) {
      const ok = siloOk(f.comments);
      // a bare `silo-ok` under scripts/ is the literals rule's to report, once
      if (ok.bare && !file.startsWith("scripts/")) add("book-roles", file, "silo-ok without a reason");
      for (const r of f.roles) {
        if (!ids.has(r.text) || ok.lines.has(r.line)) continue;
        add("book-roles", file, r.kind === "value" ? `book: ${r.text}` : `.book === ${r.text}`);
      }
    }
    // book-imports: books never reach into each other, and only the manifest names a folder
    const own = folderOf(file);
    for (const imp of f.imports) {
      if (imp.spec === null) continue;
      const target = resolveSpec(file, imp.spec, present);
      const into = target ? folderOf(target) : null;
      if (into === null) continue;
      if (own !== null ? own !== into : file.startsWith("scripts/") && file !== bookTree.manifest) add("book-imports", file, target);
    }
  }

  // book-manifest: the folders, the registry and the manifest's imports agree
  const folders = new Map();
  for (const p of present) {
    const id = folderOf(p);
    if (id !== null) folders.set(id, [...(folders.get(id) ?? []), p]);
  }
  for (const [id, files] of folders) {
    if (!ids.has(id)) add("book-manifest", `${bookTree.dir}${id}/`, "folder is not a registry book id");
    if (!files.includes(`${bookTree.dir}${id}/index.mjs`)) add("book-manifest", `${bookTree.dir}${id}/`, "folder has no index.mjs");
  }
  if (!present.has(bookTree.manifest)) {
    if (folders.size) add("book-manifest", bookTree.manifest, "missing while book folders exist");
    else notes.push(`book-manifest: not yet applicable (no ${bookTree.manifest})`);
    return;
  }
  const imported = new Set();
  for (const imp of facts.get(bookTree.manifest)?.imports ?? []) {
    const target = imp.spec === null ? null : resolveSpec(bookTree.manifest, imp.spec, present);
    const id = target ? folderOf(target) : null;
    if (id === null) continue;
    if (target !== `${bookTree.dir}${id}/index.mjs`) add("book-manifest", bookTree.manifest, `imports ${target}, not a folder's index.mjs`);
    else imported.add(id);
  }
  for (const id of imported) if (!folders.has(id)) add("book-manifest", bookTree.manifest, `imports ${id}, which has no folder`);
  for (const id of folders.keys()) if (!imported.has(id)) add("book-manifest", bookTree.manifest, `does not import ${id}`);
  notes.push(`book-manifest: ${folders.size} book folder(s), ${imported.size} imported`);
}

/** A violation's identity in a baseline, its count apart. */
function key(v) {
  return `${v.rule}\0${v.file}\0${v.target}`;
}

/** How many times a violation occurs; an entry with no `count` occurs once. */
const countOf = (v) => v.count ?? 1;

/**
 * A scan against a baseline. An entry is identified by rule, file and target and
 * carries a count, so a second use where one is held is a rise, not a repeat.
 *
 * @param {{rule: string, file: string, target: string, count?: number}[]} violations
 * @param {{members?: string[], violations?: {rule: string, file: string, target: string, count?: number}[]}} baseline
 * @param {string[]} members
 * @returns {{added: object[], stale: object[], membersAdded: string[], membersGone: string[]}}
 *   `added` occur and are not in the baseline or occur more often (`was` is the
 *   baseline's count); `stale` are in it and no longer occur or occur less often
 *   (`now` is the scan's count)
 */
export function compareBaseline(violations, baseline, members) {
  const have = new Map(violations.map((v) => [key(v), countOf(v)]));
  const want = new Map((baseline.violations ?? []).map((v) => [key(v), countOf(v)]));
  const was = new Set(baseline.members ?? []);
  const is = new Set(members);
  return {
    added: violations.filter((v) => countOf(v) > (want.get(key(v)) ?? 0)).map((v) => ({ ...v, was: want.get(key(v)) ?? 0 })),
    stale: (baseline.violations ?? []).filter((v) => countOf(v) > (have.get(key(v)) ?? 0)).map((v) => ({ ...v, now: have.get(key(v)) ?? 0 })),
    membersAdded: members.filter((m) => !was.has(m)),
    membersGone: [...was].filter((m) => !is.has(m)),
  };
}

/**
 * Reads a tree and runs the rules.
 *
 * @param {object} options
 * @param {string} options.root
 * @param {object} options.silo the definition, `books` filled in
 * @param {string[]} [options.present] the repository paths; a directory walk when absent
 * @param {object|null} [options.bookTree] `loadBookTree`'s result; the book rules are skipped without it
 * @returns {{members: string[], missing: string[], violations: object[], notes: string[], errors: string[]}}
 */
export function analyse({ root, silo, present = listFiles(root), bookTree = null }) {
  const { members, missing } = expandMembers(silo, present);
  const { facts, errors } = loadFacts(root, present);
  let moduleJson = {};
  try {
    moduleJson = JSON.parse(fs.readFileSync(path.join(root, "module.json"), "utf8"));
  } catch {
    /* a tree with no manifest has no entry points */
  }
  const { violations, notes } = findViolations({ facts, present, silo, members, moduleJson, bookTree });
  return { members, missing, violations, notes, errors };
}

/** Per-rule counts of a violation list: every occurrence, a repeat included. */
export function countByRule(violations) {
  return Object.fromEntries(RULES.map((rule) => [rule, violations.filter((v) => v.rule === rule).reduce((n, v) => n + countOf(v), 0)]));
}

/** The baseline file's text for a scan; `count` is written only where it is above one. */
export function baselineText(members, violations) {
  const entry = ({ rule, file, target, count }) => (count > 1 ? { rule, file, target, count } : { rule, file, target });
  return `${JSON.stringify({ members, violations: violations.map(entry) }, null, 2)}\n`;
}

/* -------------------------------------------------------------------- CLI */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const silo = await loadSilo(ROOT);
  const bookTree = await loadBookTree(ROOT, silo);
  const present = listFiles(ROOT, true);
  const { members, missing, violations, notes, errors } = analyse({ root: ROOT, silo, present, bookTree });
  const counts = countByRule(violations);
  const summary = RULES.map((r) => `${r} ${counts[r]}`).join(", ");

  if (process.argv.includes("--write-baseline")) {
    if (errors.length || missing.length) {
      for (const e of [...errors, ...missing.map((m) => `member not present: ${m}`)]) console.error(`  FAIL: ${e}`);
      process.exit(1);
    }
    fs.writeFileSync(BASELINE_PATH, baselineText(members, violations));
    console.log(`check-silos: baseline written — ${members.length} member(s); ${summary}`);
    process.exit(0);
  }

  const failures = [...errors, ...missing.map((m) => `silo member is not present: ${m} (update OSE_SILO.members in tools/importer/check-silos.mjs)`)];
  let baseline = { members: [], violations: [] };
  try {
    baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
  } catch (err) {
    failures.push(`cannot read tools/importer/silo-baseline.json — ${err.message}; \`--write-baseline\` makes it`);
  }
  const diff = compareBaseline(violations, baseline, members);
  const fix = (rule) => (rule.startsWith("book-") ? "put the book's code in scripts/importer/books/<id>/, or add `// silo-ok: <reason>` for a role" : "move the code into the silo, or add `// silo-ok: <reason>` for a literal");
  for (const v of diff.added) failures.push(`new ${v.rule} violation: ${v.file} → ${v.target}${v.was || countOf(v) > 1 ? ` (${v.was} held, ${countOf(v)} now)` : ""} (${fix(v.rule)})`);
  for (const v of diff.stale) failures.push(`stale baseline entry, ${v.now ? `fewer than the ${countOf(v)} held (${v.now} now)` : "no longer occurs"}: ${v.rule} ${v.file} → ${v.target} (the baseline only shrinks: \`--write-baseline\`)`);
  for (const m of diff.membersAdded) failures.push(`silo member not in the baseline: ${m} (\`--write-baseline\`)`);
  for (const m of diff.membersGone) failures.push(`baseline member is no longer a member: ${m} (\`--write-baseline\`)`);

  for (const n of notes) console.log(`  note: ${n}`);
  if (failures.length) {
    for (const f of failures) console.error(`  FAIL: ${f}`);
    console.error(`\ncheck-silos: ${failures.length} problem(s)`);
    process.exit(1);
  }
  console.log(`  ok: silo "${silo.id}" (${silo.books.length} book(s), ${members.length} member file(s)) and ${bookTree.ids.length} ACKS book id(s) hold to the baseline — ${summary}`);
}
