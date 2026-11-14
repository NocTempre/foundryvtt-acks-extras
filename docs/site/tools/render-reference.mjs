/**
 * The developer reference as pages: the module map drawn from
 * `extract-imports.mjs` and one API page per feature from `extract-api.mjs`.
 *
 * `sync.mjs` stages them into the site. How a link is spelled belongs to the
 * caller, which passes its own link builders and wraps each returned body in
 * the header its target needs.
 *
 * Every word on a page that is not a path, a key or a count is a docstring
 * read from `scripts/`, or one of the few fixed captions below.
 */
import { extractImports, featureOfPath, groupOf } from "./extract-imports.mjs";
import { extractApi } from "./extract-api.mjs";
import { apiPathProblems, docFiles } from "./api-paths.mjs";
import { REPO } from "./parse.mjs";

/** Internal import edges above which a feature's files are tabled and not charted. */
const CHART_MAX_EDGES = 40;

/** Features every other feature imports; charting their inbound edges hides the rest. */
const HUBS = ["lib", "module"];

const code = (s) => `\`${String(s)}\``;
const count = (n, noun) => `${n} ${noun}${n === 1 ? "" : "s"}`;
const nodeId = (s) => s.replace(/[^A-Za-z0-9]/g, "_");
const base = (file) => file.split("/").pop();

/** A docstring as markdown: `<` escaped outside code spans, `@tags` as a list. */
function prose(text) {
  const lines = [];
  let fenced = false;
  for (const line of text.split("\n")) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    if (fenced || /^\s*```/.test(line)) {
      lines.push(line);
      continue;
    }
    const escaped = line
      .split(/(`[^`]*`)/)
      .map((part, i) => (i % 2 ? part : part.replace(/</g, "&lt;").replace(/\{@link\s+([^}]+)\}/g, "`$1`")))
      .join("");
    lines.push(escaped.replace(/^@(\w+)\s*/, "- *$1* "));
  }
  return lines.join("\n").trim();
}

/**
 * Feature-level edge counts.
 *
 * @returns {Map<string, Map<string, number>>} importer feature → imported feature → file pairs
 */
function featureMatrix(edges) {
  const out = new Map();
  for (const e of edges) {
    const a = featureOfPath(e.from);
    const b = featureOfPath(e.to);
    if (a === b) continue;
    if (!out.has(a)) out.set(a, new Map());
    out.get(a).set(b, (out.get(a).get(b) ?? 0) + 1);
  }
  return out;
}

function renderMap(graph, link) {
  const features = [...new Set(graph.files.map((f) => f.feature))].sort();
  const matrix = featureMatrix(graph.edges);
  const filesOf = (feature) => graph.files.filter((f) => f.feature === feature);
  const out = [];

  out.push(
    `${count(graph.files.length, "file")} under \`scripts/\`, ${count(graph.edges.length, "import")} between them, ` +
      `${count(features.length, "feature directory").replace("directorys", "directories")}. ` +
      `An arrow or a count runs from the importing side to the imported one. ` +
      `\`module\` is the two files directly in \`scripts/\`: the entry point and the namespace.`,
    "",
    "## Features",
    "",
    `Imports of ${HUBS.map(code).join(" and ")} are left off the chart, since nearly every feature has them; the table below counts them.`,
    "",
    "```mermaid",
    // Top-down: the import chain is long and narrow, so left-to-right spends
    // the page's width on ranks and shrinks every label below reading size.
    "flowchart TB",
  );
  for (const f of features) if (!HUBS.includes(f)) out.push(`  ${nodeId(f)}["${f}"]`);
  for (const [from, row] of [...matrix].sort()) {
    for (const [to] of [...row].sort()) {
      if (HUBS.includes(from) || HUBS.includes(to)) continue;
      out.push(`  ${nodeId(from)} --> ${nodeId(to)}`);
    }
  }
  out.push("```", "", "Rows import columns. Each figure is a count of file pairs.", "");
  out.push(`| | ${features.map(code).join(" | ")} |`, `|---|${features.map(() => "--:").join("|")}|`);
  for (const from of features) {
    out.push(`| ${code(from)} | ${features.map((to) => (from === to ? "·" : (matrix.get(from)?.get(to) ?? ""))).join(" | ")} |`);
  }
  out.push("");

  for (const feature of features) {
    const files = filesOf(feature);
    const inside = graph.edges.filter((e) => featureOfPath(e.from) === feature && featureOfPath(e.to) === feature);
    const outbound = graph.edges.filter((e) => featureOfPath(e.from) === feature && featureOfPath(e.to) !== feature);
    const inbound = graph.edges.filter((e) => featureOfPath(e.to) === feature && featureOfPath(e.from) !== feature);
    const lines = files.reduce((n, f) => n + f.lines, 0);

    out.push(`## ${feature}`, "", `${count(files.length, "file")}, ${lines.toLocaleString("en-US")} lines.`);
    if (link.api(feature)) out.push("", `[API of \`${feature}\`](${link.api(feature)})`);
    out.push("");

    const byFeature = (list, side, other) => {
      const groups = new Map();
      for (const e of list) {
        const key = featureOfPath(e[other]);
        if (!groups.has(key)) groups.set(key, new Set());
        groups.get(key).add(e[side]);
      }
      return [...groups].sort((a, b) => a[0].localeCompare(b[0]));
    };
    if (outbound.length) {
      out.push("**Imports from**", "");
      for (const [other, targets] of byFeature(outbound, "to", "to")) {
        out.push(`- ${code(other)}: ${[...targets].sort().map((t) => `[${code(t.split("/").slice(2).join("/") || base(t))}](${link.source(t)})`).join(", ")}`);
      }
      out.push("");
    }
    if (inbound.length) {
      out.push("**Imported by**", "");
      for (const [other, targets] of byFeature(inbound, "to", "from")) {
        out.push(`- ${code(other)}: ${[...targets].sort().map((t) => code(t.split("/").slice(2).join("/") || base(t))).join(", ")}`);
      }
      out.push("");
    }

    if (inside.length && inside.length <= CHART_MAX_EDGES) {
      const short = (file) => file.split("/").slice(2).join("/");
      out.push("```mermaid", "flowchart LR");
      const groups = new Map();
      for (const f of files) {
        const g = groupOf(f.file);
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(f.file);
      }
      for (const [group, members] of [...groups].sort()) {
        if (group !== "(root)") out.push(`  subgraph ${nodeId(group)}["${group}"]`);
        for (const file of members) out.push(`  ${group === "(root)" ? "" : "  "}${nodeId(file)}["${short(file)}"]`);
        if (group !== "(root)") out.push("  end");
      }
      for (const e of inside) out.push(`  ${nodeId(e.from)} ${e.dynamic ? "-.->" : "-->"} ${nodeId(e.to)}`);
      out.push("```", "");
    } else if (inside.length) {
      out.push(`${count(inside.length, "import")} inside the feature, too many to chart; the table lists each file's.`, "");
    }

    if (files.length) {
      out.push("| File | Lines | Imports in feature | Imported by in feature |", "|---|--:|---|---|");
      for (const f of files) {
        const short = (file) => code(file.split("/").slice(2).join("/") || base(file));
        const uses = inside.filter((e) => e.from === f.file).map((e) => short(e.to));
        const usedBy = inside.filter((e) => e.to === f.file).map((e) => short(e.from));
        const list = (names) => (names.length > 8 ? `${names.slice(0, 8).join(", ")} and ${names.length - 8} more` : names.join(", "));
        out.push(`| [${short(f.file)}](${link.source(f.file)}) | ${f.lines} | ${list(uses)} | ${list(usedBy)} |`);
      }
      out.push("");
    }
  }
  return out.join("\n");
}

const KIND_LABEL = { function: "function", getter: "getter", class: "class", namespace: "namespace", object: "object" };

function renderFeatureApi(entry, link) {
  const out = [];
  const leaves = entry.rows.filter((r) => !r.group);
  const where = (row) => `[${code(`${row.file}:${row.line}`)}](${link.source(row.file, row.line)})`;

  out.push(
    `${code(`acksExtras.${entry.feature}`)}, assembled at ${where(entry)}. ${count(leaves.length, "key")}.`,
    "",
    `[Where \`${entry.dir}\` sits in the module map](${link.map(entry.dir)})`,
    "",
  );

  const depthOf = (key) => key.split(".").length;
  let open = false;
  for (const row of entry.rows) {
    const full = `acksExtras.${entry.feature}.${row.key}`;
    if (row.group) {
      const level = Math.min(depthOf(row.key) + 1, 4);
      out.push(`${"#".repeat(level)} ${row.key}`, "", `${code(full)} · ${row.kind} · ${where(row)}`, "");
      const text = row.doc || row.note;
      if (text) out.push(prose(text), "");
      open = true;
      continue;
    }
    if (!open && depthOf(row.key) === 1 && !out.includes("## Keys")) out.push("## Keys", "");
    const call = row.kind === "function" ? `${full}${(row.signature ?? "()").replace(/^async /, "")}` : full;
    const kind = `${row.kind === "function" && /^async /.test(row.signature ?? "") ? "async " : ""}${KIND_LABEL[row.kind] ?? row.kind}`;
    const detail = row.kind !== "function" && row.signature ? ` · ${code(row.signature)}` : "";
    out.push(`**${code(call)}**  `, `${kind}${detail} · ${where(row)}`, "");
    const text = row.doc || row.note;
    if (text) out.push(prose(text), "");
  }
  return out.join("\n");
}

/**
 * Every reference page.
 *
 * @param {object} link how this caller spells a link
 * @param {(file: string, line?: number) => string} link.source to a file under `scripts/`
 * @param {(dir: string) => string} link.map to a feature's section of the module map, from an API page
 * @param {(dir: string) => string|null} link.api to a feature's API page from the module map; null where the feature has none
 * @param {(feature: string) => string} link.fromIndex to a feature's API page from the API index
 * @returns {{pages: Array<{path: string, title: string, description: string, body: string}>,
 *   problems: string[], counts: {files: number, imports: number, features: number, keys: number, undocumented: number}}}
 *   `path` is relative to the reference root, without extension; `problems` is
 *   empty when every import names a file and every key was followed
 */
export function renderReference(link) {
  const graph = extractImports();
  const api = extractApi();
  const problems = [
    ...graph.missing.map((m) => `${m.from} imports "${m.specifier}", which is no file`),
    ...api.unresolved.map((u) => `acksExtras.${u.feature}.${u.key}: ${u.why}`),
    ...apiPathProblems(api.features, docFiles(REPO)),
  ];

  const entries = api.features.map((f) => ({ ...f, dir: featureOfPath(f.file) }));
  const dirs = new Set(graph.files.map((f) => f.feature));
  const unmapped = entries.filter((e) => !dirs.has(e.dir));
  for (const e of unmapped) problems.push(`acksExtras.${e.feature} is assembled in ${e.file}, outside any feature directory`);
  const apiOf = new Map(entries.map((e) => [e.dir, e.feature]));

  const pages = [
    {
      path: "architecture",
      title: "Module map",
      description: "Which file of ACKS II — Extras imports which, by feature, read from the import statements in scripts/.",
      body: renderMap(graph, { ...link, api: (dir) => (apiOf.has(dir) ? link.api(apiOf.get(dir)) : null) }),
    },
  ];

  const index = [
    "The public namespace is `globalThis.acksExtras`, which is also `game.modules.get(\"acks-extras\").api`. One page per key.",
    "",
    "| Namespace | Keys | Functions | Without a docstring | Assembled in |",
    "|---|--:|--:|--:|---|",
  ];
  let keys = 0;
  let undocumented = 0;
  for (const entry of entries) {
    const leaves = entry.rows.filter((r) => !r.group);
    const fns = leaves.filter((r) => r.kind === "function");
    const bare = fns.filter((r) => !r.doc && !r.note).length;
    keys += leaves.length;
    undocumented += bare;
    index.push(
      `| [${code(`acksExtras.${entry.feature}`)}](${link.fromIndex(entry.feature)}) | ${leaves.length} | ${fns.length} | ${bare} | [${code(entry.file)}](${link.source(entry.file, entry.line)}) |`,
    );
    pages.push({
      path: `api/${entry.feature}`,
      title: `acksExtras.${entry.feature}`,
      description: `Every key of acksExtras.${entry.feature}, with the docstring of the declaration behind it.`,
      body: renderFeatureApi(entry, link),
    });
  }
  pages.push({
    path: "api/index",
    title: "API",
    description: "The public namespace of ACKS II — Extras, read from the code that assembles it.",
    body: index.join("\n"),
  });

  return {
    pages,
    problems,
    counts: { files: graph.files.length, imports: graph.edges.length, features: dirs.size, keys, undocumented },
  };
}
