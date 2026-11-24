/**
 * Feeds the canonical validator invented modules and checks that it fails what
 * it exists to catch, and passes what a module legitimately writes. Each case
 * is a throwaway module — a few invented files plus tools/validate.mjs
 * — and the validator runs inside it exactly as `npm run validate` runs it.
 *
 * validate.mjs imports `handlebars`, so the fixtures borrow an installed copy
 * through a link to a node_modules directory: the argument when one is given,
 * otherwise this repository's own. The borrowed tree is only read, and the
 * link is removed before the fixtures are.
 *
 * Usage:  node tools/toolchain-tests/test-validate.mjs [<node_modules dir>]
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";

const TEMPLATE_ROOT = path.dirname(path.dirname(path.dirname(url.fileURLToPath(import.meta.url))));
const VALIDATOR = path.join(TEMPLATE_ROOT, "tools", "validate.mjs");

const candidates = process.argv[2]
  ? [path.resolve(process.argv[2])]
  : [path.join(TEMPLATE_ROOT, "node_modules")];
const nodeModules = candidates.find((dir) => fs.existsSync(path.join(dir, "handlebars", "package.json")));
if (!nodeModules) {
  console.error(`test-validate: no handlebars install in ${candidates.join(", ")} — pass a node_modules directory that holds one`);
  process.exit(1);
}

// Every fixture is a module the validator has nothing else to say about, so a
// case's FAIL lines are its subject's alone.
const BASE = {
  "module.json": JSON.stringify({ id: "acks-fixture", version: "0.1.0", compatibility: { minimum: "14" }, esmodules: ["scripts/module.mjs"] }, null, 2),
  "package.json": JSON.stringify({ name: "acks-fixture", private: true, type: "module" }, null, 2),
  "scripts/module.mjs": 'export const MODULE_ID = "acks-fixture";\n',
};

// The same module declaring one Macro pack, and a document of that pack's source.
const PACKED = JSON.stringify(
  {
    ...JSON.parse(BASE["module.json"]),
    flags: { "acks-fixture": { idPrefix: "acksFx" } },
    packs: [{ name: "macros", label: "Macros", path: "packs/macros", type: "Macro" }],
  },
  null,
  2,
);
const macro = (id, data) => JSON.stringify({ _id: id, _key: `!macros!${id}`, ...data }, null, 2);

// Every registration shape the reader accepts, beside every shape it must not
// mistake for one: a name in a comment, in a string, one level down in a
// nested object, and a method that merely shares the name. The regex holds a
// quote and a brace ahead of a key the templates call, so a tokenizer that
// misread it would lose that key.
const REGISTRATIONS = `const NAMED = "acksFixtureNamed";
const TABLED = {
  acksFixtureTabled: (label) => String(label),
};
const MENTION = "Handlebars.registerHelper('acksFixtureInString', () => '')";

class Registry {
  registerHelper(name, fn) {
    this[name] = fn;
  }
}

Hooks.once("init", () => {
  Handlebars.registerHelper("acksFixtureShout", (s) => String(s).toUpperCase());
  Handlebars.registerHelper({
    acksFixtureEscape(s) {
      return String(s).replace(/["{]/g, "");
    },
    // acksFixtureInComment is only mentioned here, so it registers nothing
    acksFixtureWhisper: (s) => \`\${String(s).toLowerCase()}\`,
    acksFixtureNested: { first: 1, acksFixtureDeepKey: () => "" },
  });
  Handlebars.registerHelper(NAMED, (v) => v);
  Handlebars.registerHelper(TABLED);
});
`;

// A stylesheet that defines the scroll contract, as 8a reads one.
const SCROLL_CONTRACT = `.acks-fixture-scroll.application .window-content {
  overflow-y: auto;
}
`;

const CASES = [
  {
    name: "a dialog with no classes key fails at its call, a bare, aliased or built one alike",
    files: {
      "styles/lib.css": SCROLL_CONTRACT,
      "scripts/dialogs.mjs": `const Dialog = foundry.applications.api.DialogV2;
export const bare = () => foundry.applications.api.DialogV2.confirm({
  window: { title: "Bare" },
});
export const aliased = () => Dialog.prompt({ content: "<p>Aliased</p>" });
export const built = () => new foundry.applications.api.DialogV2({ content: "<p>Built</p>" });
`,
    },
    exit: 1,
    fails: [
      /^FAIL scripts\/dialogs\.mjs: line 2: dialog declares no classes/,
      /^FAIL scripts\/dialogs\.mjs: line 5: dialog declares no classes/,
      /^FAIL scripts\/dialogs\.mjs: line 6: dialog declares no classes/,
    ],
  },
  {
    name: "a dialog that names classes, waives them or passes its bag by name passes",
    files: {
      "styles/lib.css": SCROLL_CONTRACT,
      "scripts/dialogs.mjs": `const CLASSES = ["acks-fixture-scroll"];
const { DialogV2 } = foundry.applications.api;
export const named = () => DialogV2.confirm({ classes: CLASSES });
export const literal = () => DialogV2.wait({ classes: ["acks-fixture-scroll"] });
// no-scroll: a single line of text and one button
export const waived = () => DialogV2.confirm({ content: "<p>Sure?</p>" });
export const spread = (more) => DialogV2.prompt({ ...more });
export const byName = (bag) => DialogV2.prompt(bag);
`,
    },
    exit: 0,
  },
  {
    name: "a compound selector makes its last class the contract, not the bare module class",
    files: {
      "styles/lib.css": `.acks-fixture.acks-fixture-sheet.application .window-content {
  overflow-y: auto;
}
`,
      "scripts/sheet.mjs": `export const OPTIONS = { classes: ["acks-fixture", "acks-fixture-sheet"] };
export const BARE = { classes: ["acks-fixture"] };
`,
    },
    exit: 1,
    fails: [/^FAIL scripts\/sheet\.mjs: line 2: classes array joins no scroll contract/],
  },
  {
    name: "a helper nothing registers, called with an argument, fails at its line",
    files: {
      "templates/roll-dialog.hbs": `<select name="mode">
  <option value="once" {{selected (not perTarget)}}>Once</option>
  <option value="each" {{selected perTarget}}>Each</option>
</select>
`,
    },
    exit: 1,
    fails: [
      /^FAIL templates\/roll-dialog\.hbs: line 2: \{\{selected .*throws "Missing helper: selected"/,
      /^FAIL templates\/roll-dialog\.hbs: line 3: \{\{selected /,
    ],
    out: [/validate: helpers checked 3 calls to 2 distinct helpers across 1 template,/],
  },
  {
    name: "the same call passes under a declared escape",
    files: {
      "templates/roll-dialog.hbs": `<select name="mode">
  {{!-- helper-ok: registered by a module this one requires --}}
  <option value="once" {{selected (not perTarget)}}>Once</option>
</select>
`,
    },
    exit: 0,
    out: [/validate: helpers checked 2 calls to 2 distinct helpers across 1 template,/],
  },
  {
    name: "core helpers, registered helpers, lookups, block params and context calls pass",
    files: {
      "scripts/module.mjs": REGISTRATIONS,
      "templates/sheet.hbs": `<form class="acks-fixture-sheet">
  <h2>{{localize "ACKS-${"FIXTURE"}.title"}}</h2>
  {{#if flags.open}}
    <p>{{acksFixtureShout name}}</p>
  {{else if flags.closed}}
    <p>{{acksFixtureWhisper name}}</p>
  {{else}}
    <p>{{selected}}</p>
  {{/if}}
  <select name="pick">{{selectOptions choices selected=pick localize=true}}</select>
  <input type="checkbox" name="on" {{checked on}}>
  {{#each rows as |row|}}
    <span>{{acksFixtureTabled row.label}} {{row 1}}</span>
  {{/each}}
  <span>{{acksFixtureNamed (concat "a" (acksFixtureEscape b))}}</span>
  <span>{{this.format total}} {{@root.partId}}</span>
  {{#*inline "cell"}}<td>{{value}}</td>{{/inline}}
  {{> cell value=(eq a b)}}
  {{#with totals as |t|}}{{t.sum}}{{/with}}
</form>
`,
    },
    exit: 0,
    out: [
      /validate: helpers checked 14 calls to 13 distinct helpers across 1 template, against Foundry [\d.]+ core \(\d+\) \+ 6 registered in scripts\/; 1 call on a context path/,
    ],
    absent: [/^WARN /m],
  },
  {
    name: "names in comments, strings, nested objects and test harnesses register nothing",
    files: {
      "scripts/module.mjs": REGISTRATIONS,
      "tools/test-fixture.mjs": `Handlebars.registerHelper("acksFixtureMock", () => "");\n`,
      "templates/sheet.hbs": `<p>{{acksFixtureInComment 1}}</p>
<p>{{acksFixtureInString 1}}</p>
<p>{{acksFixtureDeepKey 1}}</p>
<p>{{acksFixtureMock 1}}</p>
`,
    },
    exit: 1,
    fails: [
      /^FAIL templates\/sheet\.hbs: line 1: \{\{acksFixtureInComment /,
      /^FAIL templates\/sheet\.hbs: line 2: \{\{acksFixtureInString /,
      /^FAIL templates\/sheet\.hbs: line 3: \{\{acksFixtureDeepKey /,
      /^FAIL templates\/sheet\.hbs: line 4: \{\{acksFixtureMock /,
    ],
  },
  {
    name: "a call with no positional argument fails, and says it renders nothing",
    files: {
      "templates/sheet.hbs": `<p>{{acksFixtureGone key=1}}</p>
{{#if (acksFixtureAlsoGone)}}<p>x</p>{{/if}}
`,
    },
    exit: 1,
    fails: [
      /^FAIL templates\/sheet\.hbs: line 1: \{\{acksFixtureGone .*renders nothing, silently/,
      /^FAIL templates\/sheet\.hbs: line 2: \(acksFixtureAlsoGone .*renders nothing, silently/,
    ],
  },
  {
    name: "a block with no arguments fails unless a helper of that name is registered",
    files: {
      "templates/list.hbs": `<ul>
  {{#rows}}<li>{{this}}</li>{{/rows}}
</ul>
`,
    },
    exit: 1,
    fails: [/^FAIL templates\/list\.hbs: line 2: \{\{#rows\}\}.*a section over the context property "rows"/],
  },
  {
    name: "a registration whose name cannot be read is reported, and a call to it points back",
    files: {
      "scripts/module.mjs": `const HELPERS = globalThis.acksFixtureHelpers ?? {};
for (const [name, fn] of Object.entries(HELPERS)) Handlebars.registerHelper(name, fn);
Handlebars.registerHelper("acksFixture" + "Joined", () => "");
`,
      "templates/sheet.hbs": `<p>{{acksFixtureJoined 1}}</p>\n`,
    },
    exit: 1,
    fails: [
      /^FAIL templates\/sheet\.hbs: line 1: \{\{acksFixtureJoined .*\(2 registerHelper calls in scripts\/ could not be read/,
      /^FAIL scripts\/module\.mjs: line 2: registerHelper call whose helper name this check cannot read, so whether it starts with "acksFixture" is unchecked/,
      /^FAIL scripts\/module\.mjs: line 3: registerHelper call whose helper name this check cannot read/,
    ],
    out: [
      /WARN scripts\/module\.mjs:2: registerHelper call whose helper name this check cannot read/,
      /WARN scripts\/module\.mjs:3: registerHelper call whose helper name this check cannot read/,
    ],
  },
  {
    name: "an un-namespaced helper fails the namespace check in every shape a template call is checked against",
    files: {
      "scripts/module.mjs": `const LOOSE = "fixtureHeld";
Hooks.once("init", () => {
  Handlebars.registerHelper({
    acksFixtureFine: (s) => s,
    fixtureTabled: (s) => s,
  });
  Handlebars.registerHelper(LOOSE, (s) => s);
});
`,
      "scripts/legacy.js": `Handlebars.registerHelper("fixtureScript", (s) => s);\n`,
    },
    exit: 1,
    fails: [
      /^FAIL scripts\/module\.mjs: Handlebars helper "fixtureTabled" must start with "acksFixture"$/,
      /^FAIL scripts\/module\.mjs: Handlebars helper "fixtureHeld" must start with "acksFixture"$/,
      /^FAIL scripts\/legacy\.js: Handlebars helper "fixtureScript" must start with "acksFixture"$/,
    ],
    out: [/validate: helper namespacing checked 4 names registered in scripts\/ against "acksFixture"/],
  },
  {
    name: "a registration commented out or quoted in a string is not checked for its namespace",
    files: {
      "scripts/module.mjs": `// Handlebars.registerHelper("fixtureRetired", (s) => s);
/* Handlebars.registerHelper("fixtureParked", (s) => s); */
export const USAGE = 'Handlebars.registerHelper("fixtureQuoted", fn)';
`,
    },
    exit: 0,
    out: [/validate: helper namespacing checked 0 names registered in scripts\/ against "acksFixture"/],
  },
  {
    name: "a global or hook written in a comment, a string or a template's text is not read as code",
    files: {
      "scripts/module.mjs": `// globalThis.fixtureRetired = {};
/* Hooks.callAll("fixtureRetiredHook"); */
export const USAGE = 'globalThis.fixtureQuoted = api; Hooks.call("fixtureQuotedHook")';
export const HOWTO = \`Hooks.callAll("fixtureTemplated", globalThis.fixtureInTemplate = 1)\`;
export const AFTER = (x) => \`\${x} Hooks.callAll("fixtureAfterHole")\`;
export const acksFixture = (globalThis.acksFixture ??= {});
Hooks.on("fixtureListened", () => {});
Hooks.callAll("acksFixture.ready");
`,
    },
    exit: 0,
    out: [/validate: global and hook namespacing checked 1 globalThis write and 1 hook call in scripts\/ against "acksFixture"/],
  },
  {
    name: "a .js file under scripts/ is read for globals and hooks",
    files: {
      "scripts/legacy.js": `globalThis.fixtureLegacy = {};
Hooks.callAll("fixtureLegacyReady");
`,
    },
    exit: 1,
    fails: [
      /^FAIL scripts\/legacy\.js: line 1: globalThis\.fixtureLegacy must start with "acksFixture"$/,
      /^FAIL scripts\/legacy\.js: line 2: custom hook "fixtureLegacyReady" must start with "acksFixture"$/,
    ],
  },
  {
    name: "a global exposure is read in every spelling that writes one, and only those",
    files: {
      "scripts/module.mjs": `const API = { ready: true };
const NAME = "fixtureHeld";
globalThis["fixtureBracket"] = API;
globalThis[NAME] = API;
Object.assign(globalThis, { fixtureAssigned: API, acksFixtureFine: API });
Object.defineProperty(globalThis, "fixtureDefined", { value: API });
Object.defineProperties(globalThis, { fixtureDefinedToo: { value: API } });
Reflect.set(globalThis, "fixtureReflected", API);
globalThis.fixtureGuarded &&= API;
globalThis.acksFixture.nested = API;
globalThis.CONFIG.fixtureConfig = API;
if (globalThis.fixtureCompared == API) globalThis.acksFixtureOk = API;
`,
    },
    exit: 1,
    fails: [
      /^FAIL scripts\/module\.mjs: line 3: globalThis\.fixtureBracket must start with "acksFixture"$/,
      /^FAIL scripts\/module\.mjs: line 4: globalThis\.fixtureHeld \(named at scripts\/module\.mjs:2\) must start with "acksFixture"$/,
      /^FAIL scripts\/module\.mjs: line 5: globalThis\.fixtureAssigned must start with "acksFixture"$/,
      /^FAIL scripts\/module\.mjs: line 6: globalThis\.fixtureDefined must start with "acksFixture"$/,
      /^FAIL scripts\/module\.mjs: line 7: globalThis\.fixtureDefinedToo must start with "acksFixture"$/,
      /^FAIL scripts\/module\.mjs: line 8: globalThis\.fixtureReflected must start with "acksFixture"$/,
      /^FAIL scripts\/module\.mjs: line 9: globalThis\.fixtureGuarded must start with "acksFixture"$/,
    ],
    out: [/validate: global and hook namespacing checked 8 globalThis writes and 0 hook calls in scripts\/ against "acksFixture"/],
  },
  {
    name: "a global exposure whose name cannot be read fails",
    files: {
      "scripts/api.mjs": `export default { acksFixtureApi: true };\n`,
      "scripts/module.mjs": `import api from "./api.mjs";
export function expose(key, value) {
  globalThis[key] = value;
}
Object.assign(globalThis, api);
Object.assign(globalThis, { ...api });
`,
    },
    exit: 1,
    fails: [
      /^FAIL scripts\/module\.mjs: line 3: globalThis write whose name this check cannot read, so whether it starts with "acksFixture" is unchecked/,
      /^FAIL scripts\/module\.mjs: line 5: globalThis write whose name this check cannot read/,
      /^FAIL scripts\/module\.mjs: line 6: globalThis write whose name this check cannot read/,
    ],
  },
  {
    name: "a hook name held in a const, an object member, an import or a conditional is read",
    files: {
      "scripts/constants.mjs": `export const MODULE_ID = "acks-fixture";
export const NAMESPACE = "acksFixture";
export const HOOKS = Object.freeze({
  READY: \`\${NAMESPACE}.ready\`,
  LOOSE: "fixtureLoose",
  BORROWED: "acksOtherModuleReady",
});
export const SINGLE = "fixtureSingle";
export { HOOKS as EVENTS };
`,
      "scripts/relay.mjs": `export { SINGLE as RELAYED } from "./constants.mjs";\n`,
      "scripts/module.mjs": `import { HOOKS, NAMESPACE } from "./constants.mjs";
import { RELAYED } from "./relay.mjs";
import * as C from "./constants.mjs";

const LOCAL = "fixtureLocal";
const TABLE = { PICKED: "fixturePicked", KEPT: \`\${NAMESPACE}.kept\` };

Hooks.once("init", () => {
  Hooks.callAll(HOOKS.READY);
  Hooks.callAll(HOOKS.LOOSE);
  Hooks.callAll(HOOKS.BORROWED);
  Hooks.call(RELAYED);
  Hooks.call(LOCAL);
  Hooks.callAll?.(C.EVENTS["READY"]);
  Hooks.callAll(game.ready ? TABLE.KEPT : TABLE.PICKED);
  globalThis.Hooks?.callAll(\`\${NAMESPACE}.\${game.userId}Joined\`);
});
`,
    },
    exit: 1,
    fails: [
      /^FAIL scripts\/module\.mjs: line 10: custom hook "fixtureLoose" \(named at scripts\/constants\.mjs:5\) must start with "acksFixture"$/,
      /^FAIL scripts\/module\.mjs: line 12: custom hook "fixtureSingle" \(named at scripts\/constants\.mjs:8\) must start with "acksFixture"$/,
      /^FAIL scripts\/module\.mjs: line 13: custom hook "fixtureLocal" \(named at scripts\/module\.mjs:5\) must start with "acksFixture"$/,
      /^FAIL scripts\/module\.mjs: line 15: custom hook "fixturePicked" \(named at scripts\/module\.mjs:6\) must start with "acksFixture"$/,
    ],
    out: [
      /WARN scripts\/module\.mjs: line 11: hook "acksOtherModuleReady" \(named at scripts\/constants\.mjs:6\) fires under a foreign acks-\* namespace/,
      /validate: global and hook namespacing checked 0 globalThis writes and 8 hook calls in scripts\/ against "acksFixture"/,
    ],
  },
  {
    name: "a hook name that cannot be read fails unless hook-ok says why",
    files: {
      "scripts/constants.mjs": `export const MODULE_ID = "acks-fixture";\n`,
      "scripts/module.mjs": `import { MODULE_ID } from "./constants.mjs";
const NAMESPACE = MODULE_ID.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
const hook = "acksFixture.shadowed";

export function announce(hook, ...args) {
  Hooks.callAll(hook, ...args);
}

export function announceSafely(name, ...args) {
  try {
    // hook-ok: fires the name its caller passes; every caller passes an acksFixture.* literal
    Hooks.callAll(name, ...args);
  } catch (err) {
    console.error(err);
  }
}

Hooks.callAll(\`\${NAMESPACE}.ready\`);
`,
    },
    exit: 1,
    fails: [
      /^FAIL scripts\/module\.mjs: line 6: hook call whose name this check cannot read, so whether it starts with "acksFixture" is unchecked/,
      /^FAIL scripts\/module\.mjs: line 18: hook call whose name this check cannot read/,
    ],
    out: [/validate: global and hook namespacing checked 0 globalThis writes and 3 hook calls in scripts\/ against "acksFixture"; 1 hook call whose name it cannot read passed on hook-ok/],
  },
  // Both checks read one tokenizer. Each source below hides code from them, or
  // hands them a string's text as code, wherever a `/` is misjudged: division
  // read as a regex runs on to its line end, and a regex read as division lets
  // a quote or backtick inside it open a string.
  {
    name: "a / after x++ or x-- divides, so the hook on its line and the const on the line after it are read",
    files: {
      "scripts/module.mjs": `let seen = 0;
export function mark(total) {
  if (seen++ / total > 0.5) Hooks.callAll("fixtureHalfway", seen / total);
  if (seen-- / total < 0.5) Hooks.callAll("fixtureBelowHalf", seen / total);
}
export const share = (total) => seen++ / total;
const READY = "acksFixture.ready";
Hooks.once("init", () => Hooks.callAll(READY));
`,
    },
    exit: 1,
    fails: [
      /^FAIL scripts\/module\.mjs: line 3: custom hook "fixtureHalfway" must start with "acksFixture"$/,
      /^FAIL scripts\/module\.mjs: line 4: custom hook "fixtureBelowHalf" must start with "acksFixture"$/,
    ],
    out: [/validate: global and hook namespacing checked 0 globalThis writes and 3 hook calls in scripts\/ against "acksFixture"/],
  },
  {
    name: "a regex opening the statement an if or for head governs is read whole, so its quotes open no string",
    files: {
      "scripts/module.mjs": `export function note(name, names) {
  if (ready(name)) /["']/.test(name) && Hooks.callAll("fixtureQuoted", name);
  for (const each of names) /["']/.test(each) && Hooks.callAll("fixtureEachQuoted", each);
}
`,
    },
    exit: 1,
    fails: [
      /^FAIL scripts\/module\.mjs: line 2: custom hook "fixtureQuoted" must start with "acksFixture"$/,
      /^FAIL scripts\/module\.mjs: line 3: custom hook "fixtureEachQuoted" must start with "acksFixture"$/,
    ],
    out: [/validate: global and hook namespacing checked 0 globalThis writes and 2 hook calls in scripts\/ against "acksFixture"/],
  },
  {
    name: "a regex opening a template hole is read whole, so no code hides in a string and no string reads as code",
    files: {
      "scripts/module.mjs": `export function label(name, kind) {
  if (kind) return \`\${kind}: \${/'/.test(name) ? "quoted" : "bare"}\`;
  return \`\${/'/.test(name) ? "quoted" : "bare"}\`;
}
export const USAGE = \`call Handlebars.registerHelper("acksFixtureDocumented", fn) in init\`;
Hooks.callAll("fixtureAfterTemplate");
`,
      "templates/sheet.hbs": `<p>{{acksFixtureDocumented 1}}</p>\n`,
    },
    exit: 1,
    fails: [
      /^FAIL templates\/sheet\.hbs: line 1: \{\{acksFixtureDocumented .*throws "Missing helper: acksFixtureDocumented"/,
      /^FAIL scripts\/module\.mjs: line 6: custom hook "fixtureAfterTemplate" must start with "acksFixture"$/,
    ],
    out: [/\+ 0 registered in scripts\//],
  },
  {
    name: "a property named like a keyword is a name, so a / after it divides",
    files: {
      "scripts/module.mjs": `export function report(counts) {
  if (counts.new / counts.total > 0.5) Hooks.callAll("fixtureChurned", counts.new / counts.total);
}
`,
    },
    exit: 1,
    fails: [/^FAIL scripts\/module\.mjs: line 2: custom hook "fixtureChurned" must start with "acksFixture"$/],
  },
  {
    name: "a / read as opening a regex that meets its line end divides, so the next line is read",
    files: {
      "scripts/module.mjs": `const of = 4;
export const quarter = (n) => n / of / 2;
Hooks.callAll("fixtureAfterOf");
`,
    },
    exit: 1,
    fails: [/^FAIL scripts\/module\.mjs: line 3: custom hook "fixtureAfterOf" must start with "acksFixture"$/],
  },
  {
    name: "an instanceof against a DOM node interface fails, named bare or off a window global, in .mjs and .js",
    files: {
      "scripts/module.mjs": `export function onRender(app, element) {
  const root = element instanceof HTMLElement ? element : element?.[0];
  if (!root) return;
  root.addEventListener("change", (event) => {
    if (!(event.target instanceof HTMLInputElement || event.target instanceof window.HTMLSelectElement)) return;
    if (event.target.parentNode instanceof globalThis.Element) app.render();
  });
}
export const isGroup = (node) => node instanceof SVGGElement || node instanceof DocumentFragment;
`,
      "scripts/legacy.js": `function isText(node) {
  return node instanceof Text;
}
`,
    },
    exit: 1,
    fails: [
      /^FAIL scripts\/module\.mjs: line 2: instanceof HTMLElement — false for a node another browser window's document built.*"\/\/ realm-ok: <reason>"/,
      /^FAIL scripts\/module\.mjs: line 5: instanceof HTMLInputElement /,
      /^FAIL scripts\/module\.mjs: line 5: instanceof HTMLSelectElement /,
      /^FAIL scripts\/module\.mjs: line 6: instanceof Element /,
      /^FAIL scripts\/module\.mjs: line 9: instanceof SVGGElement /,
      /^FAIL scripts\/module\.mjs: line 9: instanceof DocumentFragment /,
      /^FAIL scripts\/legacy\.js: line 2: instanceof Text /,
    ],
    out: [/validate: node tests checked 7 instanceof tests in scripts\/ against the DOM node interfaces$/m],
  },
  {
    name: "a class the file binds itself, a document class, a property named instanceof and a test in a comment or a string pass",
    files: {
      "scripts/graph.mjs": `export class Node {
  constructor(id) {
    this.id = id;
  }
}
export const isNode = (x) => x instanceof Node;
`,
      "scripts/parts.mjs": `export function Element(name) {
  this.name = name;
}
`,
      "scripts/module.mjs": `import { Element } from "./parts.mjs";
import { Node } from "./graph.mjs";
// const root = element instanceof HTMLElement ? element : element?.[0];
/* if (el instanceof HTMLInputElement) return; */
export const USAGE = "never write element instanceof HTMLElement";
export const HOWTO = (x) => \`\${x} instanceof HTMLElement\`;
export function kinds(doc, part, x, Text) {
  return [
    doc instanceof Actor,
    doc instanceof foundry.abstract.Document,
    part instanceof Element,
    part instanceof Node,
    x instanceof Text,
    x instanceof Document,
    x instanceof Set,
    x?.nodeType === 1,
    x.instanceof,
  ];
}
`,
    },
    exit: 0,
    out: [/validate: node tests checked 8 instanceof tests in scripts\/ against the DOM node interfaces$/m],
  },
  {
    name: "a DOM instanceof passes under realm-ok on its own line or in a comment just above, and under no other line's",
    files: {
      "scripts/module.mjs": `const probe = document.createElement("template");
// realm-ok: built two lines up by this window's document and inserted nowhere
export const isTemplate = probe instanceof HTMLTemplateElement;
export const isDiv = (el) => el instanceof HTMLDivElement; // realm-ok: handed only what this file creates
export const isSpan = (el) => el instanceof HTMLSpanElement;
`,
    },
    exit: 1,
    fails: [/^FAIL scripts\/module\.mjs: line 5: instanceof HTMLSpanElement /],
    out: [/validate: node tests checked 3 instanceof tests in scripts\/ against the DOM node interfaces; 2 passed on realm-ok$/m],
  },
  {
    name: "a literal uppercase fails in styles/ and in the vendored design layer, in every spelling, once --acks-caps is declared",
    files: {
      "vendor/acks-design/tokens.css": `:root {
  --acks-caps: uppercase;
}
`,
      "vendor/acks-design/base.css": `.acks-heading {
  text-transform: uppercase;
}
`,
      "styles/lib.css": `.acks-fixture-a {
  text-transform: uppercase;
}
.acks-fixture-b { text-transform:uppercase!important; }
.acks-fixture-c {
  /* caps-ok: two lines clear of the declaration below, so it speaks for nothing */
  color: inherit;
  text-transform: uppercase;
}
`,
    },
    exit: 1,
    fails: [
      /^FAIL vendor\/acks-design\/base\.css: line 2: a literal uppercase holds capitals under the System style too.*"\/\* caps-ok: <reason> \*\/"$/,
      /^FAIL styles\/lib\.css: line 2: a literal uppercase /,
      /^FAIL styles\/lib\.css: line 4: a literal uppercase /,
      /^FAIL styles\/lib\.css: line 8: a literal uppercase /,
    ],
  },
  {
    name: "the token, a caps-ok escape on or just above the line, and uppercase in a comment pass",
    files: {
      "vendor/acks-design/tokens.css": `:root {
  --acks-caps: uppercase;
}
`,
      "styles/lib.css": `/* text-transform: uppercase is what the books' look sets through --acks-caps */
.acks-fixture-a {
  text-transform: var(--acks-caps);
}
.acks-fixture-b {
  /* caps-ok: a unit chip that is a capitalised abbreviation in both looks */
  text-transform: uppercase;
}
.acks-fixture-c {
  text-transform: uppercase; /* caps-ok: same */
}
`,
    },
    exit: 0,
  },
  {
    name: "a literal uppercase passes where no --acks-caps token is declared, since there is nothing for it to bypass",
    files: {
      "styles/lib.css": `.acks-fixture-a {
  text-transform: uppercase;
}
`,
    },
    exit: 0,
  },
  {
    name: "a legacy update key fails in every spelling that writes one, in .mjs and .js",
    files: {
      "scripts/module.mjs": `const MOD = "acks-fixture";
export async function strip(doc, race, keys, update, source) {
  await doc.update({ "-=stale": null, "flags.acks-fixture.==rows": [] });
  await doc.update({ [\`flags.\${MOD}.-=minted\`]: null });
  await doc.update({ [\`system.-=\${race}\`]: null });
  update["system.==racial"] = {};
  update["-=" + race] ??= null;
  await doc.update(Object.fromEntries(keys.map((k) => ["flags.-=" + k, null])));
  foundry.utils.setProperty(source, \`flags.\${MOD}.-=legacy\`, null);
}
`,
      "scripts/legacy.js": `game.user.update({ "flags.-=seen": null });\n`,
    },
    exit: 1,
    fails: [
      /^FAIL scripts\/module\.mjs: line 3: legacy forced-deletion key "-=stale" written as a property name of an object literal — .*\{key: new foundry\.data\.operators\.ForcedDeletion\(\)\}; or state why not with "\/\/ legacy-key-ok: <reason>" on or just above the line$/,
      /^FAIL scripts\/module\.mjs: line 3: legacy forced-replacement key "==rows" written as a property name of an object literal — .*\{key: foundry\.data\.operators\.ForcedReplacement\.create\(value\)\}/,
      /^FAIL scripts\/module\.mjs: line 4: legacy forced-deletion key "-=minted" written as a computed property name /,
      /^FAIL scripts\/module\.mjs: line 5: legacy forced-deletion key "-=…" written as a computed property name /,
      /^FAIL scripts\/module\.mjs: line 6: legacy forced-replacement key "==racial" written as the key of a member assignment /,
      /^FAIL scripts\/module\.mjs: line 7: legacy forced-deletion key "-=…" written as the key of a member assignment /,
      /^FAIL scripts\/module\.mjs: line 8: legacy forced-deletion key "-=…" written as the key of a \[key, null\] entry /,
      /^FAIL scripts\/module\.mjs: line 9: legacy forced-deletion key "-=legacy" written as the path handed to setProperty\(\) /,
      /^FAIL scripts\/legacy\.js: line 1: legacy forced-deletion key "-=seen" written as a property name of an object literal /,
    ],
    out: [
      /validate: legacy update keys checked 9 "-=" or "==" key spellings in 2 scripts under scripts\/ and 0 macro commands in packs\/_source: 9 written, 0 neither written nor read where spelled, 0 read$/m,
    ],
  },
  {
    name: "a legacy update key that is only tested, compared or looked up passes",
    files: {
      "scripts/module.mjs": `const MOD = "acks-fixture";
const FLAG = "attached";
export function watch(changes, key, keys) {
  if (\`-=\${FLAG}\` in (changes.flags?.[MOD] ?? {})) return "detached";
  if (("flags." + MOD + ".-=" + FLAG) in changes) return "detached";
  if (foundry.utils.hasProperty(changes, \`flags.\${MOD}.-=baseType\`)) return "undeclared";
  if (hasProperty(changes, "flags." + MOD + ".-=scene")) return "unlinked";
  if (Object.hasOwn(changes, "-=flags") || changes.hasOwnProperty("==system")) return "whole";
  if (key === "-=ownership" || "==ownership" !== key) return "owned";
  if (changes["-=name"] !== undefined) return "renamed";
  if (keys.includes("-=img") || key.startsWith("-=prototypeToken")) return "pictured";
  switch (key) {
    case "-=folder":
      return "unfiled";
  }
  const { "-=sort": unsorted, [\`-=\${FLAG}\`]: detached, ...kept } = changes;
  return foundry.utils.getProperty(changes, "system.-=details") ?? unsorted ?? detached ?? kept;
}
`,
    },
    exit: 0,
    out: [
      /validate: legacy update keys checked 15 "-=" or "==" key spellings in 1 script under scripts\/ and 0 macro commands in packs\/_source: 0 written, 0 neither written nor read where spelled, 15 read$/m,
    ],
  },
  {
    name: "an operator, a comment, a regex and a key no literal spells from its start are not read as legacy keys",
    files: {
      "scripts/module.mjs": `// await doc.update({ "-=stale": null });
/* update["system.==racial"] = {}; */
const OPERATORS = ["=", "+=", "-=", "==", "==="];
export function fold(total, step, key, path) {
  total -= step;
  if (total == step || key.startsWith("-=") || /^(-=|==)\\w/.test(key)) return "-= " + step;
  return { same: "== " + total, rule: "a == b", dotted: "x.-= y", path: \`\${path}-=\${key}\`, operators: OPERATORS };
}
`,
    },
    exit: 0,
    out: [
      /validate: legacy update keys checked 0 "-=" or "==" key spellings in 1 script under scripts\/ and 0 macro commands in packs\/_source: 0 written, 0 neither written nor read where spelled, 0 read$/m,
    ],
  },
  {
    name: "a legacy update key whose use is not written where it is spelled fails, and legacy-key-ok passes it and a written one",
    files: {
      "scripts/module.mjs": `const DROP = "-=stale";
export const dropKey = (key) => \`-=\${key}\`;
export const LEGACY = ["-=sheetClass", "==ownership"];
export function note(key) {
  console.warn("flags.-=" + key);
}
// legacy-key-ok: a world saved before the operator still sends this key, and the hook only strips it
const INBOUND = "-=sheetClass";
export const OUTBOUND = "==rows"; // legacy-key-ok: matched against the diff another module sends
// legacy-key-ok: runs where the operator does not exist
export const strip = (doc) => doc.update({ "-=stale": null });
const first = 1; // legacy-key-ok: a comment after code excuses its own line, never the next
const LATE = "-=late";
export function clear(legacy, update) {
  if (legacy) ["-=name", "-=img"].forEach((k) => (update[k] = null));
}
`,
    },
    exit: 1,
    fails: [
      /^FAIL scripts\/module\.mjs: line 15: legacy forced-deletion key "-=name" spelled as an array element, /,
      /^FAIL scripts\/module\.mjs: line 15: legacy forced-deletion key "-=img" spelled as an array element, /,
      /^FAIL scripts\/module\.mjs: line 1: legacy forced-deletion key "-=stale" spelled as a value bound, returned or passed on, where nothing written says whether it is written or only read — .*hasProperty\(changes, key\); or state why not with "\/\/ legacy-key-ok: <reason>" on or just above the line$/,
      /^FAIL scripts\/module\.mjs: line 2: legacy forced-deletion key "-=…" spelled as a value bound, returned or passed on, /,
      /^FAIL scripts\/module\.mjs: line 3: legacy forced-deletion key "-=sheetClass" spelled as an array element, /,
      /^FAIL scripts\/module\.mjs: line 3: legacy forced-replacement key "==ownership" spelled as an array element, /,
      /^FAIL scripts\/module\.mjs: line 5: legacy forced-deletion key "-=…" spelled as an argument of warn\(\), /,
      /^FAIL scripts\/module\.mjs: line 13: legacy forced-deletion key "-=late" spelled as a value bound, returned or passed on, /,
    ],
    out: [
      /validate: legacy update keys checked 11 "-=" or "==" key spellings in 1 script under scripts\/ and 0 macro commands in packs\/_source: 0 written, 8 neither written nor read where spelled, 0 read; 3 passed on legacy-key-ok$/m,
    ],
  },
  {
    name: "a script macro's command is read from packs/_source by its own lines, wherever a document holds one, and a chat macro is not",
    files: {
      "module.json": PACKED,
      "packs/_source/macros/strip-flags.json": macro("acksFxStripFlag1", {
        name: "Strip Flags (GM)",
        type: "script",
        command: `const scopes = ["a", "b"];
for (const actor of game.actors) {
  if ("-=flags" in actor) continue;
  await actor.update(Object.fromEntries(scopes.map((s) => ["flags.-=" + s, null])));
}
`,
      }),
      "packs/_source/macros/keep-old.json": macro("acksFxKeepOld001", {
        name: "Keep Old",
        type: "script",
        command: `// legacy-key-ok: also run against a world the operator does not exist in
await actor.update({ "-=old": null });
`,
      }),
      "packs/_source/macros/say-hello.json": macro("acksFxSayHello01", { name: "Say Hello", type: "chat", command: `update({ "-=greeting": null })` }),
      "packs/_source/macros/bundle.json": macro("acksFxBundle0001", {
        name: "Bundle",
        macros: [{ name: "Inner", type: "script", command: `token.document.update({ "==texture": {} });` }],
      }),
    },
    exit: 1,
    fails: [
      /^FAIL packs\/_source\/macros\/strip-flags\.json: macro "Strip Flags \(GM\)" command line 4: legacy forced-deletion key "-=…" written as the key of a \[key, null\] entry — .*on or just above the line of the command\. packs\/_source is what build:packs writes: change the command where tools\/pack-data\.mjs builds it, then rebuild$/,
      /^FAIL packs\/_source\/macros\/bundle\.json: macro "Inner" command line 1: legacy forced-replacement key "==texture" written as a property name of an object literal /,
    ],
    out: [
      /validate: legacy update keys checked 4 "-=" or "==" key spellings in 1 script under scripts\/ and 3 macro commands in packs\/_source: 2 written, 0 neither written nor read where spelled, 1 read; 1 passed on legacy-key-ok$/m,
    ],
  },
  {
    name: "a declared Macro pack with no source under packs/_source fails as unread",
    files: {
      "module.json": PACKED,
      "packs/macros/CURRENT": "MANIFEST-000002\n",
    },
    exit: 1,
    fails: [/^FAIL module\.json: declared Macro pack "macros" has no packs\/_source\/macros, so the commands it ships were not read for legacy update keys — run npm run build:packs/],
    out: [/validate: legacy update keys checked 0 "-=" or "==" key spellings in 1 script under scripts\/ and 0 macro commands in packs\/_source: /],
  },
  {
    name: "an object literal opening with value or max as a quantity's value fails, in a ternary arm and a call's argument alike",
    files: {
      "scripts/items.mjs": `export const stack = (n) => ({ name: "Torch", quantity: { value: n, max: 0 } });
export const arm = (flat, n) => ({ quantity: flat ? n : { value: n } });
export const call = (n) => ({ quantity: Object.assign({}, { max: 0, value: n }) });
`,
    },
    exit: 1,
    fails: [
      /^FAIL scripts\/items\.mjs: line 1: an object literal with the retired \{value, max\} shape as the value of a quantity property — .*"\/\/ quantity-shape-ok: <reason>" on or just above the line$/,
      /^FAIL scripts\/items\.mjs: line 2: an object literal with the retired/,
      /^FAIL scripts\/items\.mjs: line 3: an object literal with the retired/,
    ],
    out: [/^validate: quantity shape checked 3 retired \{value, max\} spellings in 3 files under scripts\/ and tools\/$/m],
  },
  {
    name: "a .value or .max read off a quantity fails, off a chain or optionally",
    files: {
      "scripts/items.mjs": `export const read = (item) => item.system.quantity.value;
export const safe = (item) => item?.system?.quantity?.max ?? 0;
`,
    },
    exit: 1,
    fails: [
      /^FAIL scripts\/items\.mjs: line 1: a \.value or \.max read off a quantity — /,
      /^FAIL scripts\/items\.mjs: line 2: a \.value or \.max read off a quantity — /,
    ],
    out: [/^validate: quantity shape checked 2 retired \{value, max\} spellings in 3 files under scripts\/ and tools\/$/m],
  },
  {
    name: "a string, or the last text of a template, that ends in the quantity's value or max path fails",
    files: {
      "scripts/items.mjs": `export const PATH = "system.quantity.value";
export const query = { fields: ["system.quantity.max"] };
export const dotted = (item) => item.update({ [\`\${item.prefix}.quantity.max\`]: 2 });
`,
    },
    exit: 1,
    fails: [
      /^FAIL scripts\/items\.mjs: line 1: an update or index path into the value or max of a quantity — /,
      /^FAIL scripts\/items\.mjs: line 2: an update or index path into the value or max of a quantity — /,
      /^FAIL scripts\/items\.mjs: line 3: an update or index path into the value or max of a quantity — /,
    ],
    out: [/^validate: quantity shape checked 3 retired \{value, max\} spellings in 3 files under scripts\/ and tools\/$/m],
  },
  {
    name: "a plain integer quantity, an unrelated numeric quantity, a case label and prose about the old shape pass, in scripts/ and tools/ alike",
    files: {
      "scripts/items.mjs": `// The old shape was quantity: { value: n, max: 0 }, and item.system.quantity.value read it.
/* "system.quantity.value" was its path */
export const NOTE = "the count lived at system.quantity.value once, and a value of 3";
export const stack = (n) => ({ name: "Torch", quantity: n });
export const bump = (item) => item.update({ "system.quantity": item.system.quantity + 1 });
export const retainer = { quantity: 4 };
export const roster = (group) => group.quantity * 2;
export const { quantity } = retainer;
export const doubled = quantity + quantity;
export const kind = (word) => {
  switch (word) {
    case "quantity":
      return 1;
    default:
      return 0;
  }
};
export const nested = { quantity: { amount: { value: 1 } } };
`,
      "tools/live/stock.mjs": `export const count = (item) => item.system.quantity;
export const fields = ["system.quantity", "system.quantitybank"];
`,
    },
    exit: 0,
    out: [/^validate: quantity shape checked 0 retired \{value, max\} spellings in 4 files under scripts\/ and tools\/$/m],
  },
  {
    name: "quantity-shape-ok with a reason passes a spelling on its line or in a comment of its own just above",
    files: {
      "scripts/items.mjs": `// quantity-shape-ok: reads the object an old saved copy keeps
export const old = (copy) => copy.system.quantity.value;
export const PATH = "system.quantity.value"; // quantity-shape-ok: names the path of that saved shape
export const saved = { quantity: { value: 2 } }; /* quantity-shape-ok: a saved copy */
`,
    },
    exit: 0,
    out: [/^validate: quantity shape checked 3 retired \{value, max\} spellings in 3 files under scripts\/ and tools\/; 3 passed on quantity-shape-ok$/m],
  },
  {
    name: "quantity-shape-ok with no reason does not count, nor does a trailing comment on the line above",
    files: {
      "scripts/items.mjs": `// quantity-shape-ok:
export const bare = (copy) => copy.system.quantity.max;
export const late = (copy) => copy.system.quantity.value; // quantity-shape-ok:
export const block = (copy) => copy.system.quantity.value; /* quantity-shape-ok: */
const first = 1; // quantity-shape-ok: a comment after code excuses its own line, never the next
export const next = (copy) => copy.quantity.max;
`,
    },
    exit: 1,
    fails: [
      /^FAIL scripts\/items\.mjs: line 2: a \.value or \.max read off a quantity — /,
      /^FAIL scripts\/items\.mjs: line 3: a \.value or \.max read off a quantity — /,
      /^FAIL scripts\/items\.mjs: line 4: a \.value or \.max read off a quantity — /,
      /^FAIL scripts\/items\.mjs: line 6: a \.value or \.max read off a quantity — /,
    ],
    out: [/^validate: quantity shape checked 4 retired \{value, max\} spellings in 3 files under scripts\/ and tools\/$/m],
  },
  {
    // The files are checked several at a time. The one walked first is long
    // enough to be the last whose check ends.
    name: "a file that does not parse fails at its name, and two are reported in the order they were walked",
    files: {
      "scripts/slow.mjs": `${"export function step() {}\nstep();\n".repeat(60_000)}export const broken = ;\n`,
      "tools/quick.mjs": "export const broken = ;\n",
    },
    exit: 1,
    fails: [/^FAIL scripts\/slow\.mjs: .*slow\.mjs:\d+$/, /^FAIL tools\/quick\.mjs: .*quick\.mjs:1$/],
    out: [/^FAIL scripts\/slow\.mjs: [^\n]*\r?\nFAIL tools\/quick\.mjs: /m],
  },
  {
    // Both run beside the checks above them. The scan is shown first and
    // ends last.
    name: "the IP scan and the module's own validator each show what they printed, the scan first, and pass at exit 0",
    files: {
      "tools/ip-scan.mjs": 'await new Promise((resolve) => setTimeout(resolve, 600));\nconsole.log("scan: nothing flagged");\n',
      "tools/validate-extra.mjs": 'console.log("extra: read the fixture");\n',
    },
    exit: 0,
    out: [/validate: legacy update keys checked [^]*scan: nothing flagged\r?\nextra: read the fixture\r?\nvalidate: scripts, templates, /],
  },
  {
    name: "an IP scan that exits non-zero fails validation",
    files: {
      "tools/ip-scan.mjs": 'console.log("scan: one path flagged");\nprocess.exit(1);\n',
      "tools/validate-extra.mjs": 'console.log("extra: read the fixture");\n',
    },
    exit: 1,
    out: [/scan: one path flagged\r?\nextra: read the fixture/],
    absent: [/validate: scripts, templates, /],
  },
  {
    name: "a module's own validator that exits non-zero fails validation, and what it wrote to either stream is shown",
    files: {
      "tools/ip-scan.mjs": 'console.log("scan: nothing flagged");\n',
      "tools/validate-extra.mjs": 'console.log("extra: read the fixture");\nconsole.error("extra: found a problem");\nprocess.exit(3);\n',
    },
    exit: 1,
    out: [/scan: nothing flagged\r?\nextra: read the fixture/, /extra: found a problem/],
    absent: [/validate: scripts, templates, /],
  },
  {
    // The stub writes a marker beside the tools directory and fails; a scan that
    // never started leaves no marker and cannot fail the run.
    name: "a clean verdict from the caller stands the IP scan down: no child starts, one line says so, and it is no failure",
    env: { ACKS_IP_SCAN_VERDICT: "clean" },
    files: {
      "tools/ip-scan.mjs": 'import fs from "node:fs";\nfs.writeFileSync(new URL("../scan-ran.marker", import.meta.url), "ran");\nconsole.log("scan: ran");\nprocess.exit(1);\n',
    },
    exit: 0,
    out: [/^validate: IP leak scan not run here: ACKS_IP_SCAN_VERDICT=clean, the workflow's tree scan already returned clean$/m, /validate: scripts, templates, /],
    absent: [/scan: ran/],
    noFiles: ["scan-ran.marker"],
  },
  ...["leak", "error", "", "CLEAN", " clean", "clean "].map((verdict) => ({
    name: `a verdict other than exactly "clean" (${JSON.stringify(verdict)}) leaves the IP scan running, and its failure fails validation`,
    env: { ACKS_IP_SCAN_VERDICT: verdict },
    files: {
      "tools/ip-scan.mjs": 'import fs from "node:fs";\nfs.writeFileSync(new URL("../scan-ran.marker", import.meta.url), "ran");\nconsole.log("scan: ran");\nprocess.exit(1);\n',
    },
    exit: 1,
    out: [/scan: ran/],
    absent: [/IP leak scan not run here/, /validate: scripts, templates, /],
    hasFiles: ["scan-ran.marker"],
  })),
  ...["2026.12.05", "2026.12.15.0", "2026.12.15-beta"].map((version) => ({
    name: `a version Foundry cannot order (${version}) fails at module.json`,
    files: { "module.json": JSON.stringify({ ...JSON.parse(BASE["module.json"]), version }, null, 2) },
    exit: 1,
    fails: [new RegExp(`^FAIL module\\.json: version "${version.replaceAll(".", "\\.")}" is not a version Foundry can order`)],
  })),
  ...["2026.12.15.1", "11.14.5"].map((version) => ({
    name: `a version Foundry can order (${version}) passes`,
    files: { "module.json": JSON.stringify({ ...JSON.parse(BASE["module.json"]), version }, null, 2) },
    exit: 0,
  })),
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "acks-validate-"));
const link = path.join(tmp, "node_modules");
let failures = 0;
try {
  fs.symlinkSync(nodeModules, link, "junction");
  CASES.forEach((testCase, n) => {
    // The directory is named for the module id, as validate.mjs expects.
    const root = path.join(tmp, String(n), "acks-fixture");
    for (const [rel, text] of Object.entries({ ...BASE, ...testCase.files })) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), text);
    }
    fs.mkdirSync(path.join(root, "tools"), { recursive: true });
    fs.copyFileSync(VALIDATOR, path.join(root, "tools", "validate.mjs"));

    // A case declares the variables it sets; the verdict variable is stripped
    // from the inherited env first, so a developer shell holding it changes no case.
    const { ACKS_IP_SCAN_VERDICT: _inherited, ...inheritedEnv } = process.env;
    const run = spawnSync(process.execPath, [path.join(root, "tools", "validate.mjs")], {
      encoding: "utf8",
      env: { ...inheritedEnv, ...testCase.env },
    });
    const output = `${run.stdout}${run.stderr}`;
    const failLines = output.split(/\r?\n/).filter((line) => line.startsWith("FAIL "));
    const problems = [];
    if (run.status !== testCase.exit) problems.push(`exit ${run.status}, expected ${testCase.exit}`);
    for (const re of testCase.fails ?? []) if (!failLines.some((line) => re.test(line))) problems.push(`no FAIL line matches ${re}`);
    for (const line of failLines) if (!(testCase.fails ?? []).some((re) => re.test(line))) problems.push(`unexpected ${line}`);
    for (const re of testCase.out ?? []) if (!re.test(output)) problems.push(`output lacks ${re}`);
    for (const re of testCase.absent ?? []) if (re.test(output)) problems.push(`output carries ${re}`);
    for (const rel of testCase.noFiles ?? []) if (fs.existsSync(path.join(root, rel))) problems.push(`${rel} exists`);
    for (const rel of testCase.hasFiles ?? []) if (!fs.existsSync(path.join(root, rel))) problems.push(`${rel} is missing`);

    if (problems.length) {
      failures++;
      console.log(`FAIL ${testCase.name}\n  ${problems.join("\n  ")}\n  --- validator output ---\n${output.replace(/^/gm, "  | ")}`);
    } else console.log(`ok   ${testCase.name}`);
  });
} finally {
  try {
    fs.unlinkSync(link);
  } catch {
    /* never created */
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}
if (!fs.existsSync(path.join(nodeModules, "handlebars", "package.json"))) {
  console.error(`test-validate: ${nodeModules} lost its handlebars install during cleanup — the link was followed`);
  process.exit(1);
}
console.log(`test-validate: ${CASES.length} case${CASES.length === 1 ? "" : "s"}, ${failures} failed`);
if (failures) process.exit(1);
