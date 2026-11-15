/**
 * Live walk, magic-spell-recipes: a spell's effect rows arrive through the
 * importer's recipe channel. Walks docs/magic/TESTING.md "Spell effect rows
 * (the recipe channel)" on the GM seat: the Spells repair writes register rows
 * on the five recipe spells of the seat's own RR, every figure the recipe
 * locates is filled or listed as unread, a Judge's own row survives a repair,
 * a change on the spell sheet's Overview keeps every row field it does not
 * render, and an edit in the row editor makes the row the Judge's.
 *
 * Fixtures: none. The rows are written onto the library's own imported spells
 * (owner ruling 2026-11-11: a walk may write the test world's items), and the
 * walk leaves each as a repair leaves it: register rows only. The hand-made
 * row and the edited row it adds are removed by their index before the closing
 * repair. Prints counts and booleans, never a figure or a book word.
 */
import { connect } from "./_driver.mjs";
import { seats, PORTS } from "./_env.mjs";
import { walkDone, blocked, WalkBlocked } from "./_walk.mjs";
const M = seats();
const IDS = ["def.spell.desiccate", "def.spell.cureLightInjury", "def.spell.frightenHumanoid", "def.spell.holyCircle", "def.spell.sharpness"];
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + JSON.stringify(detail)}`);
};
const section = (t) => console.log(`\n== ${t} ==`);
const LIB = `const L = await import("/modules/acks-extras/scripts/lib/library.mjs");`;
const rowsOf = (id) => `(L.byCookbookId("Item", ${JSON.stringify(id)}, { original: true })?.getFlag("acks-extras", "spell")?.effects ?? [])`;
const repair = (ids) => `await acksExtras.importer.importSpells({ only: new Set(${JSON.stringify(ids)}), repair: { replaced: 0, refused: 0, keptProse: 0 } });`;

let gm;
try {
  gm = await connect({ browser: M.browser, origin: M.origin, user: M.gm, port: PORTS.gm });
  section("Boot");
  // The importer's api is published after `ready` (it awaits the cookbook), and
  // the shelf opens the seat's books on its own schedule after that.
  const boot = await gm.eval(`(async () => { ${LIB}
    for (let i = 0; i < 600 && !(globalThis.acksExtras?.importer?.bookOpen?.("rr")); i++) await new Promise(r => setTimeout(r, 200));
    return { seated: game.users.filter(u => u.active).map(u => u.name), rr: !!acksExtras.importer.bookOpen?.("rr"),
      present: ${JSON.stringify(IDS)}.map(id => !!L.byCookbookId("Item", id, { original: true })) };
  })()`);
  console.log(`seated: ${JSON.stringify(boot.seated)}`);
  check("the GM seat has the RR open", boot.rr);
  check("the five recipe spells are imported", boot.present.every(Boolean), boot.present);
  if (!boot.rr) blocked("the RR is not open on the GM seat");
  if (!boot.present.every(Boolean)) blocked("the five recipe spells are not all imported");

  section("The Spells repair writes register rows");
  const r1 = await gm.eval(`(async () => { ${LIB} ${repair(IDS)}
    const out = {};
    for (const id of ${JSON.stringify(IDS)}) {
      const doc = L.byCookbookId("Item", id, { original: true });
      const sp = doc.getFlag("acks-extras", "spell") ?? {};
      const rows = sp.effects ?? [];
      out[id.split(".").pop()] = {
        rows: rows.length, kinds: rows.map(r => r.type), allRegister: rows.length > 0 && rows.every(r => r.origin === "register"),
        rolled: rows.filter(r => r.type === "damage" || r.type === "heal").map(r => !!r.roll),
        typed: rows.filter(r => r.type === "damage").map(r => (r.damage ?? []).length),
        valued: rows.filter(r => r.type === "modifier").map(r => r.value?.flat != null || r.value?.kind === "perLevel"),
        unread: rows.map(r => r.unread ?? []).flat(),
        saveCategory: !!sp.save?.category && sp.save.category !== "none", areaSize: !!(sp.target?.area?.size?.flat ?? sp.target?.area?.size), filters: (sp.target?.filters ?? []).length,
      };
    }
    return out;
  })()`);
  console.log(`rows: ${JSON.stringify(Object.fromEntries(Object.entries(r1).map(([k, v]) => [k, v.kinds])))}`);
  const expectKinds = { desiccate: ["damage", "conditionGrant"], cureLightInjury: ["heal", "conditionRemove", "damage"], frightenHumanoid: ["conditionGrant"], holyCircle: ["ward", "modifier", "modifier"], sharpness: ["modifier", "modifier", "modifier"] };
  for (const [k, kinds] of Object.entries(expectKinds)) check(`${k}: the recipe's row kinds, all register-origin`, JSON.stringify(r1[k].kinds) === JSON.stringify(kinds) && r1[k].allRegister, r1[k].kinds);
  check("every damage and heal row has its dice", Object.values(r1).every(v => v.rolled.every(Boolean)), Object.fromEntries(Object.entries(r1).map(([k, v]) => [k, v.rolled])));
  check("every damage row has one damage type", Object.values(r1).every(v => v.typed.every(n => n === 1)));
  check("every modifier row has its figure", Object.values(r1).every(v => v.valued.every(Boolean)));
  check("the only unread field is the extraordinary mark", Object.values(r1).every(v => v.unread.every(f => f === "extraordinary")), Object.fromEntries(Object.entries(r1).map(([k, v]) => [k, v.unread])));
  check("save categories read where the recipe locates one", r1.desiccate.saveCategory && r1.frightenHumanoid.saveCategory);
  check("area sizes read", r1.desiccate.areaSize && r1.holyCircle.areaSize);
  check("creature filters read", r1.desiccate.filters > 0 && r1.cureLightInjury.filters > 0 && r1.frightenHumanoid.filters > 0);

  section("A Judge's row survives a repair");
  const D = IDS[0];
  const r2 = await gm.eval(`(async () => { ${LIB}
    const doc = L.byCookbookId("Item", ${JSON.stringify(D)}, { original: true });
    const before = ${rowsOf(D)};
    await doc.setFlag("acks-extras", "spell.effects", [...before, { type: "illusion", appliesTo: "self", note: "walk-hand-row" }]);
    ${repair([D])}
    const after = ${rowsOf(D)};
    return { before: before.length, after: after.length, hand: after.filter(r => r.note === "walk-hand-row").length, register: after.filter(r => r.origin === "register").length, registerBefore: before.filter(r => r.origin === "register").length };
  })()`);
  check("the hand-made row is kept once and the register rows are replaced, not doubled", r2.hand === 1 && r2.register === r2.registerBefore && r2.after === r2.before + 1, r2);

  section("An Overview change keeps the fields it does not render");
  const r3 = await gm.eval(`(async () => { ${LIB}
    const doc = L.byCookbookId("Item", ${JSON.stringify(D)}, { original: true });
    // A submit writes the schema's initial value for a field the row left
    // unset ("" for a choice, [] for a list), which reads the same as unset.
    const n = (v) => (v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length) ? null : v);
    const pick = (rows) => JSON.stringify(rows.map(r => ({ o: n(r.origin), u: n(r.unread), x: n(r.extraordinary), s: n(r.saveEffect), l: n(r.lasts), d: n(r.delivery) })));
    const before = pick(${rowsOf(D)});
    const sheet = doc.sheet; await sheet.render({ force: true });
    for (let i = 0; i < 40 && !sheet.rendered; i++) await new Promise(r => setTimeout(r, 100));
    const root = sheet.element;
    const input = [...root.querySelectorAll('input[type="text"][name], textarea[name]')].find(el => /note/i.test(el.name) && el.closest('[data-tab="overview"], .tab.overview, section'));
    if (!input) { await sheet.close(); return { input: false }; }
    const name = input.name, old = input.value;
    input.value = old + " walk"; input.dispatchEvent(new Event("change", { bubbles: true }));
    for (let i = 0; i < 30 && foundry.utils.getProperty(doc, name.startsWith("flags") ? name : "system." + name) === old; i++) await new Promise(r => setTimeout(r, 100));
    const changed = foundry.utils.getProperty(doc._source, name) !== old;
    const mid = pick(${rowsOf(D)});
    await doc.update({ [name]: old });
    await sheet.close();
    return { input: true, name, changed, kept: mid === before };
  })()`);
  check("the Overview field submitted", r3.input && r3.changed, { field: r3.name ?? null });
  check("origin, unread, extraordinary, saveEffect, lasts and delivery survive the submit", r3.kept);

  section("A row edit makes the row the Judge's");
  const r4 = await gm.eval(`(async () => { ${LIB}
    const doc = L.byCookbookId("Item", ${JSON.stringify(D)}, { original: true });
    const sheet = doc.sheet; await sheet.render({ force: true, tab: "mechanics" });
    for (let i = 0; i < 40 && !sheet.rendered; i++) await new Promise(r => setTimeout(r, 100));
    sheet.changeTab?.("mechanics", "primary");
    const btn = sheet.element.querySelector('[data-action="effectEdit"][data-index="0"]');
    if (!btn) { await sheet.close(); return { button: false }; }
    btn.click();
    let ed = null;
    for (let i = 0; i < 40 && !ed; i++) { ed = [...foundry.applications.instances.values()].find(a => a.element?.classList?.contains("acks-extras-effect-editor")); if (!ed) await new Promise(r => setTimeout(r, 100)); }
    if (!ed) { await sheet.close(); return { button: true, editor: false }; }
    const field = ed.element.querySelector('textarea[name="note"], input[name="note"], input[name="condition"], textarea[name="condition"]');
    if (!field) { await ed.close(); await sheet.close(); return { button: true, editor: true, field: false }; }
    field.value = (field.value || "") + " walk-edit"; field.dispatchEvent(new Event("change", { bubbles: true }));
    for (let i = 0; i < 30 && (${rowsOf(D)})[0]?.origin === "register"; i++) await new Promise(r => setTimeout(r, 100));
    const edited = (${rowsOf(D)})[0];
    await ed.close(); await sheet.close();
    ${repair([D])}
    const after = ${rowsOf(D)};
    return { button: true, editor: true, field: true, cleared: !edited?.origin, keptAfterRepair: after.some(r => !r.origin && /walk-edit/.test(\`\${r.note ?? ""} \${r.condition ?? ""}\`)), registerAfter: after.filter(r => r.origin === "register").length, total: after.length };
  })()`);
  check("the editor opened from the Mechanics tab and took a change", r4.button && r4.editor && r4.field, r4);
  check("the edited row lost its register origin", r4.cleared);
  check("a repair keeps the edited row", r4.keptAfterRepair);
  console.log(`after an edit and a repair: ${r4.registerAfter} register row(s), ${r4.total} in all`);

  section("Teardown");
  const td = await gm.eval(`(async () => { ${LIB}
    const doc = L.byCookbookId("Item", ${JSON.stringify(D)}, { original: true });
    const rows = ${rowsOf(D)};
    const keep = rows.filter(r => r.origin === "register");
    await doc.setFlag("acks-extras", "spell.effects", keep);
    ${repair([D])}
    const after = ${rowsOf(D)};
    return { removed: rows.length - keep.length, after: after.length, allRegister: after.every(r => r.origin === "register") };
  })()`);
  check("desiccate is left with register rows only", td.allRegister, td);
  walkDone();
} catch (e) {
  if (!(e instanceof WalkBlocked)) console.log("WALK ERROR:", e?.stack ?? e);
} finally {
  const failed = checks.filter(([, ok]) => !ok).length;
  console.log(`${checks.length - failed} passed, ${failed} failed`);
  try { gm?.close?.(); } catch {}
  process.exitCode = failed ? 1 : 0;
}
