/**
 * The cookbook stamp: which files make up the compile's inputs, and when the
 * drift check may skip its recompile.
 *
 * PDF-free and book-free: a temp directory holds an invented compiler, modules,
 * register files, cookbook files and stand-in "PDFs" of a few bytes, because
 * what is under test is the fingerprint and the decision, not a compile.
 */
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { COMPILER_ENTRY, FORCE_ENV, decide, inputFingerprint, outputFingerprint, readStamp, specifiersOf, walkImports, writeStamp } from "./cookbook-stamp.mjs";

let pass = 0;
const check = (label, cond) => {
  assert.ok(cond, label);
  pass++;
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), "acks-stamp-test-"));
const put = (rel, text) => {
  const f = path.join(root, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
};

try {
  // --- specifier extraction ---
  const s = specifiersOf(`
    import a from "./a.mjs";
    import { b,
      c } from '../b.mjs';
    export * from "./re.mjs";
    export { d } from "./d.mjs";
    import "./side.mjs";
    const m = await import("./lazy.mjs");
    import fs from "node:fs";
  `);
  for (const want of ["./a.mjs", "../b.mjs", "./re.mjs", "./d.mjs", "./side.mjs", "./lazy.mjs", "node:fs"]) {
    check(`specifier ${want} is found`, s.specs.includes(want));
  }
  check("a literal dynamic import is not blind", s.blind === 0);
  check("a force variable of 0 does not force", decide({ now: { inputs: "a", outputs: "b" }, stamp: { inputs: "a", outputs: "b" }, env: { [FORCE_ENV]: "0" } }).skip === true);
  check("a computed dynamic import is blind", specifiersOf("await import(name);").blind === 1);
  check("a template-literal dynamic import is blind", specifiersOf("await import(`./x/${id}.mjs`);").blind === 1);
  check("an import( inside a comment is not blind", specifiersOf("// load with import(x)\n/* import(y) */ const q = 1;").blind === 0);

  // --- the invented tree ---
  put(COMPILER_ENTRY, 'import { a } from "./helper.mjs";\nimport { b } from "../../scripts/mod/b.mjs";\n');
  put("tools/importer/helper.mjs", "export const a = 1;\n");
  put("scripts/mod/b.mjs", 'import { c } from "./c.mjs";\nexport { c };\nexport const b = 2;\n');
  put("scripts/mod/c.mjs", "export const c = 3;\n");
  put("scripts/unrelated.mjs", "export const u = 0;\n");
  put("register/book/entry.json", '{"id":"one"}\n');
  put("register/_kinds/k.json", '{"id":"kind"}\n');
  put("register/_refs/r.json", '{"registry":"r"}\n');
  put("register/_ledger.json", "{}\n");
  put("register/_manifest/m.json", "{}\n");
  put("register/_proposals/p.json", "{}\n");
  put("register/_icons.json", "{}\n");
  put("vendor/pdfjs/pdf.worker.mjs", "// worker\n");
  put("cookbook/rr.json", '{"entries":{}}\n');
  put("cookbook/index.json", '{"books":["rr"]}\n');
  put("pdfs/rr.pdf", "12345");
  put("pdfs/jj.pdf", "123456789");
  const pdfs = { rr: path.join(root, "pdfs/rr.pdf"), jj: path.join(root, "pdfs/jj.pdf") };

  const walk = walkImports(root, COMPILER_ENTRY);
  check("the walk finds the compiler and every transitive module", walk.files.join() === [COMPILER_ENTRY, "tools/importer/helper.mjs", "scripts/mod/b.mjs", "scripts/mod/c.mjs"].sort().join());
  check("a module nothing imports is outside the set", !walk.files.includes("scripts/unrelated.mjs"));

  const digests = () => ({ inputs: inputFingerprint({ root, pdfs }), outputs: outputFingerprint(path.join(root, "cookbook")) });
  const now = () => {
    const d = digests();
    return { inputs: d.inputs.hash, outputs: d.outputs };
  };

  const base = digests();
  check("the input set holds the walk, the register and the vendored worker", base.inputs.files.length === 4 + 3 + 1);
  check("local pipeline state under register/ is not an input", !base.inputs.files.some((f) => /_ledger|_manifest|_proposals|_icons/.test(f)));
  check("the digests are stable across two reads", JSON.stringify(now()) === JSON.stringify({ inputs: base.inputs.hash, outputs: base.outputs }));

  // --- the stamp file ---
  const stampFile = path.join(root, "stamp.json");
  check("an absent stamp reads as null", readStamp(stampFile) === null);
  writeStamp(stampFile, now());
  const stamp = readStamp(stampFile);
  check("a written stamp reads back", stamp.inputs === base.inputs.hash && stamp.outputs === base.outputs);
  fs.writeFileSync(stampFile, "not json");
  check("a corrupt stamp reads as null", readStamp(stampFile) === null);
  writeStamp(stampFile, now());

  // --- the decision ---
  const env = {};
  check("a matching stamp skips", decide({ now: now(), stamp, env }).skip === true);
  check("no stamp runs the full check", decide({ now: now(), stamp: null, env }).skip === false);
  check("the force variable runs the full check on a match", decide({ now: now(), stamp, env: { [FORCE_ENV]: "1" } }).skip === false);

  const changes = {
    "a register file": () => put("register/book/entry.json", '{"id":"two"}\n'),
    "a register _refs file": () => put("register/_refs/r.json", '{"registry":"r2"}\n'),
    "a new register file": () => put("register/book/extra.json", "{}\n"),
    "a module the compiler imports": () => put("tools/importer/helper.mjs", "export const a = 11;\n"),
    "a module imported through a re-export": () => put("scripts/mod/c.mjs", "export const c = 33;\n"),
    "the compiler itself": () => put(COMPILER_ENTRY, 'import { a } from "./helper.mjs";\nimport { b } from "../../scripts/mod/b.mjs";\n// edit\n'),
    "the vendored worker": () => put("vendor/pdfjs/pdf.worker.mjs", "// worker 2\n"),
    "a cookbook file": () => put("cookbook/rr.json", '{"entries":{"x":1}}\n'),
    "a new cookbook file": () => put("cookbook/jj.json", '{"entries":{}}\n'),
    "a reference PDF's size": () => put("pdfs/rr.pdf", "123456"),
    "a reference PDF going absent": () => fs.rmSync(path.join(root, "pdfs/jj.pdf")),
  };
  for (const [label, change] of Object.entries(changes)) {
    // Each change starts from the stamped state, then is undone by restamping.
    writeStamp(stampFile, now());
    const st = readStamp(stampFile);
    assert.ok(decide({ now: now(), stamp: st, env }).skip);
    change();
    const d = decide({ now: now(), stamp: st, env });
    check(`${label} forces the full path`, d.skip === false);
    check(`${label} is named in the reason`, /inputs|cookbook/.test(d.why));
  }

  // A line-ending difference alone is not a change.
  writeStamp(stampFile, now());
  put("scripts/mod/c.mjs", "export const c = 33;\r\n");
  const crlfStamp = { ...now() };
  put("scripts/mod/c.mjs", "export const c = 33;\n");
  check("CRLF and LF text digest alike", JSON.stringify(now()) === JSON.stringify(crlfStamp));

  // Local pipeline state changing is not an input: a scratch clone does not have it.
  const beforeState = now();
  put("register/_ledger.json", '{"rows":1}\n');
  put("register/_proposals/p.json", '{"rows":2}\n');
  check("a gitignored register file does not move the digest", JSON.stringify(now()) === JSON.stringify(beforeState));

  // An unrelated file changing is not an input.
  const before = now();
  put("scripts/unrelated.mjs", "export const u = 99;\n");
  check("a module outside the walk does not move the digest", JSON.stringify(now()) === JSON.stringify(before));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`test-cookbook-stamp: ${pass} checks passed.`);
