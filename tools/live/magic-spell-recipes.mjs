/**
 * Live walk, magic-spell-recipes: a spell's effect rows arrive through the
 * importer's recipe channel. Walks docs/magic/TESTING.md "Spell effect rows
 * (the recipe channel)" on the GM seat: the Spells repair writes register rows
 * on the five recipe spells of the seat's own RR, every figure the recipe
 * locates is filled or listed as unread, a Judge's own row survives a repair,
 * a change on the spell sheet's Overview keeps every row field it does not
 * render, and an edit in the row editor makes the row the Judge's. It also
 * reads the scopes and area measures off the rows, evaluates a bonus row's
 * scope against three creatures, and checks that an editor submit keeps a
 * nested `anyOf`.
 *
 * Fixtures: three kept actors found by marker (`magic/scope-chaotic-undead`,
 * `magic/scope-ally-caster`, `magic/scope-neutral-token`), built when none
 * carries it and only read. The rows are written onto the library's own
 * imported spells (owner ruling 2026-11-11: a walk may write the test world's
 * items), and the walk leaves each as it found it. The rows it adds carry its
 * own marks (`walk-hand-row`, `walk-edit`, `walk-edit-scope`) and are removed
 * by those marks before a closing repair; a row anyone else added stays.
 * Prints counts and booleans, never a figure or a book word.
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
  const expectKinds = { desiccate: ["damage", "conditionGrant"], cureLightInjury: ["heal", "conditionRemove", "damage"], frightenHumanoid: ["conditionGrant"], holyCircle: ["ward", "modifier", "modifier", "ward", "modifier", "modifier"], sharpness: ["modifier", "modifier", "modifier"] };
  for (const [k, kinds] of Object.entries(expectKinds)) check(`${k}: the recipe's row kinds, all register-origin`, JSON.stringify(r1[k].kinds) === JSON.stringify(kinds) && r1[k].allRegister, r1[k].kinds);
  check("every damage and heal row has its dice", Object.values(r1).every(v => v.rolled.every(Boolean)), Object.fromEntries(Object.entries(r1).map(([k, v]) => [k, v.rolled])));
  check("every damage row has one damage type", Object.values(r1).every(v => v.typed.every(n => n === 1)));
  check("every modifier row has its figure", Object.values(r1).every(v => v.valued.every(Boolean)));
  check("the only unread field is the extraordinary mark", Object.values(r1).every(v => v.unread.every(f => f === "extraordinary")), Object.fromEntries(Object.entries(r1).map(([k, v]) => [k, v.unread])));
  check("save categories read where the recipe locates one", r1.desiccate.saveCategory && r1.frightenHumanoid.saveCategory);
  check("area sizes read", r1.desiccate.areaSize && r1.holyCircle.areaSize);
  check("creature filters read", r1.desiccate.filters > 0 && r1.cureLightInjury.filters > 0 && r1.frightenHumanoid.filters > 0);

  section("Scopes and measures on the repaired rows");
  const H = IDS[3];
  const r5 = await gm.eval(`(async () => { ${LIB}
    const doc = L.byCookbookId("Item", ${JSON.stringify(H)}, { original: true });
    const des = L.byCookbookId("Item", ${JSON.stringify(IDS[0])}, { original: true });
    const rows = ${rowsOf(H)};
    const ward = rows.filter(r => r.type === "ward");
    const bonus = rows.filter(r => r.type === "modifier");
    const branchShape = (r) => (r.anyOf ?? []).map(b => ({ enemy: !!b.vsEnemy, of: b.vsAlignmentOf ?? "", mode: b.vsAlignmentMode ?? "", kinds: (b.vsKinds ?? []).length, fixed: !!b.vsAlignment }));
    const sheet = doc.sheet; await sheet.render({ force: true });
    for (let i = 0; i < 40 && !sheet.rendered; i++) await new Promise(r => setTimeout(r, 100));
    const out = sheet.element.querySelector(".acks-magic-area-extent");
    const res = {
      wards: ward.map(r => ({ kinds: (r.vsKinds ?? []).length, reversed: !!r.reversed })),
      bonus: bonus.map(r => ({ reversed: !!r.reversed, branches: branchShape(r), condition: !!r.condition })),
      measure: { holyCircle: doc.getFlag("acks-extras", "spell")?.target?.area?.measure ?? null, desiccate: des.getFlag("acks-extras", "spell")?.target?.area?.measure ?? null },
      extentText: !!out && out.textContent.trim() !== "—", tipParts: (out?.dataset.tooltipText ?? "").split(" · ").filter(Boolean).length,
    };
    await sheet.close();
    return res;
  })()`);
  check("holy circle's two wards are scoped to one kind token, one of them reversed", r5.wards.length === 2 && r5.wards.every(w => w.kinds === 1) && r5.wards.filter(w => w.reversed).length === 1, r5.wards);
  const okBranches = (b) => b.length === 2 && b[0].enemy && b[0].of === "source" && b[0].mode === "except" && b[1].kinds > 0 && b[1].fixed;
  check("its four bonus rows carry an anyOf of two branches and no condition, two of them reversed", r5.bonus.length === 4 && r5.bonus.every(b => okBranches(b.branches) && !b.condition) && r5.bonus.filter(b => b.reversed).length === 2, r5.bonus.map(b => b.branches.map(x => x.kinds)));
  check("desiccate's measure is a diameter and holy circle's a radius", r5.measure.desiccate === "diameter" && r5.measure.holyCircle === "radius", r5.measure);
  check("the Overview's extent reads a figure and its tooltip names its parts", r5.extentText && r5.tipParts >= 3, { tipParts: r5.tipParts });

  section("The alignment scope answers on three creatures");
  const fx = {
    undead: await gm.fixture("magic/scope-chaotic-undead", "Actor", { name: "Scope Undead", type: "monster", system: { details: { alignment: "Chaotic" } }, prototypeToken: { disposition: -1 }, flags: { "acks-extras": { extras: { types: ["undead"] } } } }),
    ally: await gm.fixture("magic/scope-ally-caster", "Actor", { name: "Scope Ally", type: "character", system: { details: { alignment: "Lawful" } }, prototypeToken: { disposition: 1 } }),
    neutral: await gm.fixture("magic/scope-neutral-token", "Actor", { name: "Scope Neutral", type: "monster", system: { details: { alignment: "Neutral" } }, prototypeToken: { disposition: 0 } }),
  };
  // A kept fixture carries whatever it was left with, and a monster is created
  // hostile whatever its data says: bring each to the shape the step reads.
  await gm.eval(`(async () => {
    const shape = { ${JSON.stringify(fx.undead.uuid)}: -1, ${JSON.stringify(fx.ally.uuid)}: 1, ${JSON.stringify(fx.neutral.uuid)}: 0 };
    for (const [uuid, disposition] of Object.entries(shape)) {
      const a = await fromUuid(uuid);
      if (a.prototypeToken.disposition !== disposition) await a.update({ "prototypeToken.disposition": disposition });
    }
    return true;
  })()`);
  const r6 = await gm.eval(`(async () => { ${LIB}
    const V = await import("/modules/acks-extras/scripts/lib/vocab.mjs");
    const A = await import("/modules/acks-extras/scripts/lib/actor-read.mjs");
    const doc = L.byCookbookId("Item", ${JSON.stringify(H)}, { original: true });
    const row = (${rowsOf(H)}).find(r => r.type === "modifier" && !r.reversed);
    const caster = await fromUuid(${JSON.stringify(fx.ally.uuid)});
    const shape = {}, out = {};
    for (const [k, uuid] of Object.entries(${JSON.stringify(Object.fromEntries(Object.entries(fx).map(([k, v]) => [k, v.uuid])))})) {
      const a = await fromUuid(uuid);
      shape[k] = { kinds: [...A.creatureKinds(a)], alignment: A.actorAlignment(a), disposition: a.prototypeToken.disposition };
      const ctx = { kinds: A.creatureKinds(a), alignment: A.actorAlignment(a), sourceAlignment: A.actorAlignment(caster), enemy: A.areEnemies(caster.prototypeToken, a.prototypeToken) };
      const v = V.scopeApplies(row, ctx);
      out[k] = v.applies && !v.undetermined ? "applies" : v.undetermined ? "undetermined" : "fails";
    }
    return { shape, out };
  })()`);
  console.log(`fixtures: ${JSON.stringify(r6.shape)}`);
  check("the fixtures carry the kinds, alignment and disposition the step needs", r6.shape.undead.kinds.includes("undead") && r6.shape.undead.alignment === "chaotic" && r6.shape.ally.alignment === "lawful" && r6.shape.neutral.kinds.length === 0 && r6.shape.neutral.disposition === 0, r6.shape);
  check("the chaotic undead applies, the ally fails, the neutral token is undetermined", r6.out.undead === "applies" && r6.out.ally === "fails" && r6.out.neutral === "undetermined", r6.out);

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

  section("A row-editor submit keeps a nested scope");
  const r7 = await gm.eval(`(async () => { ${LIB}
    const doc = L.byCookbookId("Item", ${JSON.stringify(H)}, { original: true });
    const before = ${rowsOf(H)};
    const index = before.findIndex(r => r.type === "modifier" && Array.isArray(r.anyOf) && r.anyOf.length);
    if (index < 0) return { row: false };
    // A submit writes each branch through the schema, filling the fields a
    // branch left unset with their initial values ("", [], false, "gate"),
    // which scopeApplies reads the same as unset.
    const norm = (a) => JSON.stringify((a ?? []).map(b => Object.fromEntries(Object.entries(b).filter(([k, v]) => !(v === "" || v === false || v == null || (Array.isArray(v) && !v.length) || (k === "vsAlignmentMode" && v === "gate"))).sort())));
    const scopeBefore = norm(before[index].anyOf);
    const sheet = doc.sheet; await sheet.render({ force: true, tab: "mechanics" });
    for (let i = 0; i < 40 && !sheet.rendered; i++) await new Promise(r => setTimeout(r, 100));
    sheet.changeTab?.("mechanics", "primary");
    const btn = sheet.element.querySelector(\`[data-action="effectEdit"][data-index="\${index}"]\`);
    if (!btn) { await sheet.close(); return { row: true, button: false }; }
    btn.click();
    let ed = null;
    for (let i = 0; i < 40 && !ed; i++) { ed = [...foundry.applications.instances.values()].find(a => a.element?.classList?.contains("acks-extras-effect-editor")); if (!ed) await new Promise(r => setTimeout(r, 100)); }
    if (!ed) { await sheet.close(); return { row: true, button: true, editor: false }; }
    const shown = [...ed.element.querySelectorAll("output.acks-extras-effect-readonly")].some(o => o.textContent.trim().length > 0);
    const field = ed.element.querySelector('input[name="condition"], textarea[name="condition"], input[name="note"], textarea[name="note"]');
    if (!field) { await ed.close(); await sheet.close(); return { row: true, button: true, editor: true, field: false }; }
    field.value = (field.value || "") + " walk-edit-scope"; field.dispatchEvent(new Event("change", { bubbles: true }));
    for (let i = 0; i < 30 && (${rowsOf(H)})[index]?.origin === "register"; i++) await new Promise(r => setTimeout(r, 100));
    const edited = (${rowsOf(H)})[index];
    await ed.close(); await sheet.close();
    return { row: true, button: true, editor: true, field: true, shown, kept: norm(edited?.anyOf) === scopeBefore, cleared: !edited?.origin };
  })()`);
  check("the editor opened on a scoped bonus row and took a change", r7.row && r7.button && r7.editor && r7.field, r7);
  check("the anyOf reads back as stored and the row's origin is cleared", r7.kept && r7.cleared, { kept: r7.kept, cleared: r7.cleared });
  check("the editor shows the anyOf", r7.shown);

  section("Teardown");
  const tdh = await gm.eval(`(async () => { ${LIB}
    const doc = L.byCookbookId("Item", ${JSON.stringify(H)}, { original: true });
    const rows = ${rowsOf(H)};
    const mine = (r) => /walk-edit-scope/.test(\`\${r.note ?? ""} \${r.condition ?? ""}\`);
    const keep = rows.filter(r => !mine(r));
    await doc.setFlag("acks-extras", "spell.effects", keep);
    ${repair([H])}
    const after = ${rowsOf(H)};
    return { removed: rows.length - keep.length, walkRowsLeft: after.filter(mine).length, register: after.filter(r => r.origin === "register").length };
  })()`);
  check("holy circle keeps no row of the walk's own, and its register rows", tdh.walkRowsLeft === 0 && tdh.register === r5.wards.length + r5.bonus.length, tdh);
  const td = await gm.eval(`(async () => { ${LIB}
    const doc = L.byCookbookId("Item", ${JSON.stringify(D)}, { original: true });
    const rows = ${rowsOf(D)};
    const mine = (r) => r.note === "walk-hand-row" || /walk-edit/.test(\`\${r.note ?? ""} \${r.condition ?? ""}\`);
    const keep = rows.filter(r => !mine(r));
    await doc.setFlag("acks-extras", "spell.effects", keep);
    ${repair([D])}
    const after = ${rowsOf(D)};
    return { removed: rows.length - keep.length, after: after.length, walkRowsLeft: after.filter(mine).length, register: after.filter(r => r.origin === "register").length };
  })()`);
  check("desiccate keeps no row of the walk's own, and its register rows", td.walkRowsLeft === 0 && td.register === r2.registerBefore, td);
  walkDone();
} catch (e) {
  if (!(e instanceof WalkBlocked)) console.log("WALK ERROR:", e?.stack ?? e);
} finally {
  const failed = checks.filter(([, ok]) => !ok).length;
  console.log(`${checks.length - failed} passed, ${failed} failed`);
  try { gm?.close?.(); } catch {}
  process.exitCode = failed ? 1 : 0;
}
