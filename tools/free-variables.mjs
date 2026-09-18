/**
 * Free variables: an identifier read or written that NO enclosing scope binds
 * and no allowlist covers.
 *
 * `node --check` cannot see this class of defect and neither can a test: a free
 * variable is legal JavaScript that throws `ReferenceError` only when the line
 * carrying it is reached, so a name that lost its binding in a branch nothing
 * offline calls passes every check and dies in a world.
 *
 * The scan is a real parse, not a regex: acorn builds the AST, this file builds
 * the lexical scope tree over it, and every reference is resolved against the
 * scopes that enclose it. The allowlists are what a runtime legitimately
 * supplies — the browser and Foundry's own globals for `scripts/`, Node's for
 * `tools/` — so a name outside them is unbound at every altitude and the report
 * is the whole of the finding.
 *
 * acorn arrives from the copy Node already bundles, which needs
 * `--expose-internals`; that flag is refused inside NODE_OPTIONS, so a caller
 * re-execs. If the path is ever gone the gate FAILS and names the reason: a
 * check that quietly stops checking is worse than no check.
 *
 *   node --expose-internals tools/free-variables.mjs <root> --allow=<list.json>
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
let acorn;
let walk;
try {
  acorn = require_("internal/deps/acorn/acorn/dist/acorn");
  walk = require_("internal/deps/acorn/acorn-walk/dist/walk");
} catch (err) {
  console.error(`free-variables: cannot reach Node's bundled acorn — ${err?.message ?? err}`);
  console.error("free-variables: run with --expose-internals, or add acorn as a devDependency; this gate does not skip.");
  process.exit(2);
}

/* ------------------------------------------------------------------ scopes */
const newScope = (type, parent) => ({ type, parent, names: new Set() });
const varScopeOf = (scope) => {
  let s = scope;
  while (s.type === "block") s = s.parent;
  return s;
};

export function analyze(src, filename) {
  const ast = acorn.parse(src, {
    ecmaVersion: "latest",
    sourceType: "module",
    locations: true,
    allowHashBang: true,
    allowAwaitOutsideFunction: true,
  });

  const refs = [];
  const moduleScope = newScope("module", null);
  moduleScope.names.add("import"); // import.meta / dynamic import

  const declareName = (scope, name, kind) => {
    (kind === "var" || kind === "func" ? varScopeOf(scope) : scope).names.add(name);
  };

  function declarePattern(pat, scope, kind, c, st) {
    if (!pat) return;
    switch (pat.type) {
      case "Identifier":
        declareName(scope, pat.name, kind);
        break;
      case "ObjectPattern":
        for (const p of pat.properties) {
          if (p.type === "RestElement") declarePattern(p.argument, scope, kind, c, st);
          else {
            if (p.computed) c(p.key, st, "Expression");
            declarePattern(p.value, scope, kind, c, st);
          }
        }
        break;
      case "ArrayPattern":
        for (const el of pat.elements) declarePattern(el, scope, kind, c, st);
        break;
      case "AssignmentPattern":
        declarePattern(pat.left, scope, kind, c, st);
        c(pat.right, st, "Expression");
        break;
      case "RestElement":
        declarePattern(pat.argument, scope, kind, c, st);
        break;
      default:
        c(pat, st, "Expression"); // member-expression target, etc.
    }
  }

  /* An assignment/for-of target that is NOT a declaration: every Identifier in
   * it is a reference (writing an unbound name throws in module strict mode). */
  function walkTarget(node, st, c) {
    if (!node) return;
    switch (node.type) {
      case "Identifier":
        refs.push({ name: node.name, node, scope: st.scope });
        break;
      case "ObjectPattern":
        for (const p of node.properties) {
          if (p.type === "RestElement") walkTarget(p.argument, st, c);
          else {
            if (p.computed) c(p.key, st, "Expression");
            walkTarget(p.value, st, c);
          }
        }
        break;
      case "ArrayPattern":
        for (const el of node.elements) walkTarget(el, st, c);
        break;
      case "AssignmentPattern":
        walkTarget(node.left, st, c);
        c(node.right, st, "Expression");
        break;
      case "RestElement":
        walkTarget(node.argument, st, c);
        break;
      default:
        c(node, st, "Expression");
    }
  }

  function walkFunction(node, st, c, bindOwnName) {
    const scope = newScope("function", st.scope);
    if (bindOwnName && node.id) scope.names.add(node.id.name);
    if (node.type !== "ArrowFunctionExpression") {
      scope.names.add("arguments");
      scope.names.add("this");
    }
    const inner = { scope };
    for (const p of node.params) declarePattern(p, scope, "param", c, inner);
    if (node.body.type === "BlockStatement") {
      const bodyScope = newScope("block", scope);
      for (const s of node.body.body) c(s, { scope: bodyScope }, "Statement");
    } else {
      c(node.body, inner, "Expression");
    }
  }

  function walkClass(node, st, c) {
    const scope = newScope("block", st.scope);
    if (node.id) scope.names.add(node.id.name);
    const inner = { scope };
    if (node.superClass) c(node.superClass, inner, "Expression");
    for (const el of node.body.body) {
      if (el.type === "StaticBlock") {
        const sb = { scope: newScope("block", scope) };
        for (const s of el.body) c(s, sb, "Statement");
        continue;
      }
      if (el.computed && el.key) c(el.key, inner, "Expression");
      if (el.value) c(el.value, inner, "Expression");
    }
  }

  const V = {
    Program(node, st, c) {
      for (const s of node.body) c(s, st, "Statement");
    },
    Identifier(node, st) {
      refs.push({ name: node.name, node, scope: st.scope });
    },
    /* Only reachable as an assignment target — declarations are all handled
     * explicitly below, so anything arriving here is a write to a binding. */
    VariablePattern(node, st) {
      refs.push({ name: node.name, node, scope: st.scope });
    },
    VariableDeclaration(node, st, c) {
      for (const d of node.declarations) {
        declarePattern(d.id, st.scope, node.kind === "var" ? "var" : "let", c, st);
        if (d.init) c(d.init, st, "Expression");
      }
    },
    FunctionDeclaration(node, st, c) {
      if (node.id) declareName(st.scope, node.id.name, "func");
      walkFunction(node, st, c, false);
    },
    FunctionExpression(node, st, c) {
      walkFunction(node, st, c, true);
    },
    ArrowFunctionExpression(node, st, c) {
      walkFunction(node, st, c, false);
    },
    ClassDeclaration(node, st, c) {
      if (node.id) declareName(st.scope, node.id.name, "let");
      walkClass(node, st, c);
    },
    ClassExpression(node, st, c) {
      walkClass(node, st, c);
    },
    BlockStatement(node, st, c) {
      const scope = newScope("block", st.scope);
      for (const s of node.body) c(s, { scope }, "Statement");
    },
    StaticBlock(node, st, c) {
      const scope = newScope("block", st.scope);
      for (const s of node.body) c(s, { scope }, "Statement");
    },
    SwitchStatement(node, st, c) {
      c(node.discriminant, st, "Expression");
      const scope = newScope("block", st.scope);
      const inner = { scope };
      for (const cs of node.cases) {
        if (cs.test) c(cs.test, inner, "Expression");
        for (const s of cs.consequent) c(s, inner, "Statement");
      }
    },
    ForStatement(node, st, c) {
      const inner = { scope: newScope("block", st.scope) };
      if (node.init) c(node.init, inner, node.init.type === "VariableDeclaration" ? "Statement" : "Expression");
      if (node.test) c(node.test, inner, "Expression");
      if (node.update) c(node.update, inner, "Expression");
      c(node.body, inner, "Statement");
    },
    ForInStatement: forInOf,
    ForOfStatement: forInOf,
    CatchClause(node, st, c) {
      const scope = newScope("block", st.scope);
      const inner = { scope };
      if (node.param) declarePattern(node.param, scope, "let", c, inner);
      c(node.body, inner, "Statement");
    },
    ImportDeclaration(node, st) {
      for (const s of node.specifiers) st.scope.names.add(s.local.name);
    },
    ExportNamedDeclaration(node, st, c) {
      if (node.declaration) c(node.declaration, st, "Statement");
      else if (!node.source) {
        for (const s of node.specifiers) {
          if (s.local.type === "Identifier") refs.push({ name: s.local.name, node: s.local, scope: st.scope });
        }
      }
    },
    ExportDefaultDeclaration(node, st, c) {
      const d = node.declaration;
      const isDecl = d.type === "FunctionDeclaration" || d.type === "ClassDeclaration";
      c(d, st, isDecl ? "Statement" : "Expression");
    },
    ExportAllDeclaration() {},
    LabeledStatement(node, st, c) {
      c(node.body, st, "Statement");
    },
  };

  function forInOf(node, st, c) {
    const scope = newScope("block", st.scope);
    const inner = { scope };
    if (node.left.type === "VariableDeclaration") {
      for (const d of node.left.declarations) {
        declarePattern(d.id, scope, node.left.kind === "var" ? "var" : "let", c, inner);
      }
    } else {
      walkTarget(node.left, inner, c);
    }
    c(node.right, st, "Expression");
    c(node.body, inner, "Statement");
  }

  /* Assignment targets route through acorn-walk's "Pattern" override type,
   * which lands on VariablePattern above for a bare Identifier. */
  walk.recursive(ast, { scope: moduleScope }, V, walk.base);

  const unresolved = [];
  for (const r of refs) {
    let s = r.scope;
    let found = false;
    while (s) {
      if (s.names.has(r.name)) {
        found = true;
        break;
      }
      s = s.parent;
    }
    if (!found) unresolved.push({ name: r.name, line: r.node.loc.start.line, column: r.node.loc.start.column + 1, file: filename });
  }
  return unresolved;
}

/* ------------------------------------------------------------------- CLI */
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const root = process.argv[2] ?? ".";
  const asJson = process.argv.includes("--json");
  const allowPath = process.argv.find((a) => a.startsWith("--allow="))?.slice(8);
  const allow = new Set(allowPath ? JSON.parse(fs.readFileSync(allowPath, "utf8")) : []);

  const files = [];
  (function w(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) w(f);
      else if (f.endsWith(".mjs")) files.push(f);
    }
  })(root);
  files.sort();

  const all = [];
  const t0 = Date.now();
  for (const f of files) {
    const relp = path.relative(process.cwd(), f).replaceAll(path.sep, "/");
    try {
      for (const u of analyze(fs.readFileSync(f, "utf8"), relp)) {
        if (!allow.has(u.name)) all.push(u);
      }
    } catch (err) {
      all.push({ name: `<parse error: ${err.message}>`, line: 0, column: 0, file: relp });
    }
  }
  const ms = Date.now() - t0;
  if (asJson) {
    console.log(JSON.stringify({ ms, files: files.length, findings: all }, null, 1));
    process.exit(all.length ? 1 : 0);
  }
  for (const u of all) console.error(`  FAIL ${u.file}:${u.line}: ${u.name} is bound by no enclosing scope`);
  const plural = files.length === 1 ? "" : "s";
  console.log(`  ok: ${files.length} file${plural} under ${root}/ read only names something binds (${ms} ms)`);
  process.exit(all.length ? 1 : 0);
}
