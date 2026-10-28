/**
 * The shipped AX1 cookbook's keyed areas, as data: no PDFs, no Foundry.
 *
 * Each of the book's three key spaces holds every key its pages print, once,
 * under the id and label `spaceKeyed` derives from the key, and reads the
 * area's printed name off the page by that key; the cookbook ships no word of
 * it. An area's quick-stat lines become occupants, each read from its label's
 * origin. The inhabitants are read by key the same way, each with its prose and
 * one quick-stat block. No two areas' or inhabitants' boxes meet on a page,
 * which is how a stop that failed to fire shows in the compiled data. The
 * demand grid keys its goods as AX3's grid does.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { nameKeys } from "../../scripts/lib/vocab.mjs";
import { bareKey, spaceKeyed } from "./register-rules.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const cb = JSON.parse(fs.readFileSync(path.join(here, "..", "..", "cookbook", "ax1.json"), "utf8"));
const entries = cb.entries ?? {};

let n = 0;
const t = (name, fn) => {
  fn();
  n++;
  console.log(`ok - ${name}`);
};

/** Each key space: its row id, the highest key it prints, and how many areas it keys. */
const SPACES = [
  { id: "ax1.fort", last: 25, keyed: 91, sections: 0 },
  { id: "ax1.l1", last: 75, keyed: 78, sections: 6 },
  { id: "ax1.l2", last: 39, keyed: 39, sections: 0 },
];

const inSpace = (id) => Object.entries(entries).filter(([, e]) => e.meta?.space === id);
const numbered = (id) => inSpace(id).filter(([, e]) => e.fields?.name?.number != null);
const sectioned = (id) => inSpace(id).filter(([, e]) => e.fields?.name?.hash != null);

/** The integers a key covers: "5-8" is 5 to 8, "11c-l" and "11c" are 11. */
const integersOf = (key) => {
  const m = /^(\d+)(?:-(\d+)(?![A-Za-z]))?/.exec(key);
  const out = [];
  for (let i = Number(m[1]); i <= Number(m[2] ?? m[1]); i++) out.push(i);
  return out;
};

for (const space of SPACES) {
  const row = entries[space.id];

  t(`${space.id} is a place read off the page by its key, with no words shipped`, () => {
    assert.equal(row?.kind, "kind.location");
    assert.equal(row.fields.name.op, "heading");
    assert.match(row.fields.name.hash, /^[0-9a-z]+$/);
    assert.equal("text" in row.fields.name, false);
  });

  t(`${space.id} keys ${space.keyed} areas and ${space.sections} sections`, () => {
    assert.equal(numbered(space.id).length, space.keyed);
    assert.equal(sectioned(space.id).length, space.sections);
    assert.equal(inSpace(space.id).length, space.keyed + space.sections);
  });

  t(`${space.id}: every area ships the id and label its key derives`, () => {
    const wrong = numbered(space.id).filter(([id, e]) => {
      const want = spaceKeyed({ id: space.id, name: row.name }, e.fields.name.number);
      return id !== want.id || e.name !== want.label;
    });
    assert.deepEqual(wrong.map(([id]) => id), []);
  });

  t(`${space.id}: every area reads its name off the page, and no heading is shipped`, () => {
    const wrong = inSpace(space.id).filter(([, e]) => {
      const name = e.fields?.name;
      if (name?.op !== "heading") return true;
      return [name, ...(name.parts ?? [])].some((p) => "text" in p || "display" in p);
    });
    assert.deepEqual(wrong.map(([id]) => id), []);
  });

  t(`${space.id}: keys 1 to ${space.last}, each once`, () => {
    const seen = new Map();
    for (const [id, e] of numbered(space.id)) {
      const key = bareKey(e.fields.name.number);
      // A lettered key ("11c") sits under the number it letters; only a key
      // with no letter, or a range, keys the number itself.
      if (/^\d+[A-Za-z]/.test(key)) continue;
      for (const i of integersOf(key)) seen.set(i, [...(seen.get(i) ?? []), id]);
    }
    const missing = [];
    for (let i = 1; i <= space.last; i++) if (!seen.has(i)) missing.push(i);
    assert.deepEqual(missing, []);
    assert.deepEqual([...seen].filter(([, ids]) => ids.length > 1).map(([i]) => i), []);
    assert.equal(Math.max(...seen.keys()), space.last);
  });

  t(`${space.id}: every area stands under a parent that reaches the space`, () => {
    const wrong = inSpace(space.id).filter(([id]) => {
      const seen = new Set([id]);
      let at = entries[id].meta.parent;
      while (at && at !== space.id) {
        if (seen.has(at) || entries[at]?.meta?.space !== space.id) return true;
        seen.add(at);
        at = entries[at].meta.parent;
      }
      return at !== space.id;
    });
    assert.deepEqual(wrong.map(([id]) => id), []);
  });

  t(`${space.id}: a lettered area stands under the area it letters`, () => {
    const wrong = numbered(space.id).filter(([, e]) => {
      const base = /^(\d+)[A-Za-z]/.exec(bareKey(e.fields.name.number))?.[1];
      if (!base) return false;
      const parent = spaceKeyed({ id: space.id, name: row.name }, `${base}.`).id;
      return parent in entries && e.meta.parent !== parent;
    });
    assert.deepEqual(wrong.map(([id]) => id), []);
  });

  t(`${space.id}: every area has prose`, () => {
    const wrong = inSpace(space.id).filter(([, e]) => {
      const d = e.fields?.description;
      return d?.op !== "text" || !d.paras?.length || d.paras.some((p) => !p.box && !p.boxes?.length);
    });
    assert.deepEqual(wrong.map(([id]) => id), []);
  });
}

/* ---------------- occupants ---------------- */

const occupied = Object.entries(entries).filter(([, e]) => Object.keys(e.fields ?? {}).some((k) => /^occupants\.\d+\.stats$/.test(k)));

t("the book's areas hold occupants", () => {
  assert.ok(occupied.length > 0);
});

t("an occupant is read by its quick-stat label: a creature, a count and its stats", () => {
  const wrong = [];
  for (const [id, e] of occupied) {
    const f = e.fields;
    const at = Object.keys(f).filter((k) => /^occupants\.\d+\.stats$/.test(k)).map((k) => Number(k.split(".")[1])).sort((a, b) => a - b);
    if (at.some((i, j) => i !== j)) wrong.push(`${id}: occupants not numbered from 0`);
    for (const i of at) {
      const name = f[`occupants.${i}.name`], count = f[`occupants.${i}.count`], stats = f[`occupants.${i}.stats`], creature = f[`creatures.${i}`];
      if (name?.table !== "creature" || name.op !== "value") wrong.push(`${id}.${i}: name`);
      if (count?.pattern !== "countParen") wrong.push(`${id}.${i}: count`);
      if (stats?.pattern !== "statline") wrong.push(`${id}.${i}: stats`);
      // The name, the count and the creature lookup are one run: the label's.
      const same = (a, b) => JSON.stringify(a?.box) === JSON.stringify(b?.box) && a?.page === b?.page;
      if (!same(name, count) || !same(name, creature)) wrong.push(`${id}.${i}: label boxes differ`);
      if (name && name.box.x1 - name.box.x0 > 5) wrong.push(`${id}.${i}: label box wider than an origin`);
    }
  }
  assert.deepEqual(wrong, []);
});

/* ---------------- inhabitants ---------------- */

const people = Object.entries(entries).filter(([, e]) => e.kind === "kind.npc");

t("the book's 10 inhabitants are NPC 1 to NPC 10, read off the page by key", () => {
  assert.deepEqual(people.map(([id]) => id).sort(), Array.from({ length: 10 }, (_, i) => `ax1.npc${i + 1}`).sort());
  const wrong = people.filter(([id, e]) => {
    const name = e.fields?.name;
    return e.name !== `NPC ${id.slice(7)}` || name?.op !== "heading" || !/^[0-9a-z]+$/.test(name.hash ?? "") ||
      [name, ...(name.parts ?? [])].some((p) => "text" in p || "display" in p);
  });
  assert.deepEqual(wrong.map(([id]) => id), []);
});

t("nine inhabitants are characters; the one whose block is a monster's is not", () => {
  assert.deepEqual(people.filter(([, e]) => e.meta?.actor !== "character").map(([id]) => id), ["ax1.npc2"]);
});

t("every inhabitant has prose and one quick-stat block", () => {
  const wrong = people.filter(([, e]) => {
    const { description: d, statline: s } = e.fields;
    return d?.op !== "text" || !d.paras?.length || s?.op !== "value" || s.pattern !== "statline" || !(s.box || s.boxes?.length);
  });
  assert.deepEqual(wrong.map(([id]) => id), []);
});

t("a block the column's foot cuts reads its run-on from the next column's top, after its first part", () => {
  const runOn = people.filter(([, e]) => e.fields.statline.boxes);
  assert.deepEqual(runOn.map(([id]) => id), ["ax1.npc4"]);
  const [first, more] = runOn[0][1].fields.statline.boxes;
  assert.ok(more.x0 > first.x1 && more.y1 < first.y0, "the second box is the next column's top");
});

/* ---------------- pins ---------------- */

/** The plans that are a place's own, and the place each one is. */
const PLANS = { "ax1.level1Map": "ax1.l1", "ax1.level2Map": "ax1.l2", "ax1.fort18Map": "ax1.fort18", "ax1.fort24Map": "ax1.fort24" };
const parentOf = (id) => entries[id]?.meta?.parent ?? entries[id]?.meta?.space;
const insideOf = (place) => Object.keys(entries).filter((id) => {
  for (let at = parentOf(id), hops = 0; at && hops < 9; at = parentOf(at), hops++) if (at === place) return true;
  return false;
});

t("each plan is the place it draws, explored a turn at a time", () => {
  for (const [map, place] of Object.entries(PLANS)) {
    assert.equal(cb.scenes[map]?.scene?.place, place, map);
    assert.equal(cb.scenes[map].scene.travel, "delve", map);
  }
});

t("every area inside a plan's place that holds no other is pinned on it, once", () => {
  for (const [map, place] of Object.entries(PLANS)) {
    const inside = insideOf(place);
    const holders = new Set(inside.map(parentOf));
    const pinned = (cb.scenes[map].scene.places ?? []).map((p) => p.id);
    assert.equal(new Set(pinned).size, pinned.length, `${map} pins a row twice`);
    assert.deepEqual(inside.filter((id) => !holders.has(id) && !pinned.includes(id)), [], `${map} leaves areas off`);
    assert.deepEqual(pinned.filter((id) => !inside.includes(id)), [], `${map} pins areas from elsewhere`);
  }
});

/* ---------------- zones ---------------- */

t("each dungeon level is one zone over its plan, reading its chance, interval and dungeon level off the page with its level's list", () => {
  const zones = Object.entries(cb.scenes).filter(([, row]) => row.zone);
  const want = { "ax1.level1Map": "ax1.wanderingLevel1", "ax1.level2Map": "ax1.wanderingLevel2" };
  assert.deepEqual(Object.fromEntries(zones.map(([, row]) => [row.zone.scene, row.zone.table])), want);
  for (const [id, { zone }] of zones) {
    const patterns = Object.fromEntries(Object.entries(zone.fields).map(([field, f]) => [field, f.pattern]));
    assert.deepEqual(patterns, { target: "rollTarget", every: "countWord", dungeonLevel: "int" }, id);
    const { crop } = cb.scenes[zone.scene].scene;
    assert.deepEqual(zone.outline, [crop.x, crop.y, crop.x + crop.w, crop.y, crop.x + crop.w, crop.y + crop.h, crop.x, crop.y + crop.h].map((n) => +n.toFixed(2)), `${id} covers its plan`);
  }
});

/* ---------------- prose boxes ---------------- */

t("no two areas' or inhabitants' boxes meet on a page", () => {
  const boxes = [];
  for (const space of SPACES) {
    for (const [id, e] of [[space.id, entries[space.id]], ...inSpace(space.id)]) {
      const d = e.fields.description;
      for (const p of d?.paras ?? []) for (const b of p.boxes ?? [p.box]) boxes.push({ id, page: p.page ?? d.page, b });
    }
  }
  for (const [id, e] of people) {
    const { description: d, statline: s } = e.fields;
    for (const p of d.paras) for (const b of p.boxes ?? [p.box]) boxes.push({ id, page: p.page ?? d.page, b });
    for (const b of s.boxes ?? [s.box]) boxes.push({ id, page: s.page, b });
  }
  const meet = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const p = boxes[i], q = boxes[j];
      if (p.id === q.id || p.page !== q.page) continue;
      const w = Math.min(p.b.x1, q.b.x1) - Math.max(p.b.x0, q.b.x0);
      const h = Math.min(p.b.y1, q.b.y1) - Math.max(p.b.y0, q.b.y0);
      if (w > 0 && h > 0) meet.push(`${p.id} ~ ${q.id} p.${p.page}`);
    }
  }
  assert.deepEqual(meet, []);
});

t("the demand grid reads sideways, its goods under AX3's keys, its columns naming their places", () => {
  const grid = entries["ax1.marketGrid1"]?.fields?.["grids.markets"];
  assert.ok(grid?.transpose, "transposed");
  const ax3 = JSON.parse(fs.readFileSync(path.join(here, "..", "..", "cookbook", "ax3.json"), "utf8")).entries;
  const goods = ax3["ax3.marketGrid1"].fields["grids.markets"].cols.map((c) => c.key).filter((k) => k !== "marketClass");
  assert.deepEqual(grid.rowBands.map((b) => b.key), goods, "one band per AX3 good, in AX3's order");
  assert.deepEqual(grid.cols.map((c) => c.key), ["mkt1", "mkt2", "mkt3", "mkt4", "mkt5", "mkt6"]);
  assert.ok(grid.headerBand, "the header is read, so a market is named from its column");
  assert.deepEqual(entries["ax1.marketGrid1"].meta.markets, { mkt1: { sameAs: "ax3.mkt21" }, mkt2: { place: "ax1.fort" } });
});

t("a level's text stops short of its wandering section, which its table reads", () => {
  const meets = (p, q) => Math.min(p.x1, q.x1) > Math.max(p.x0, q.x0) && Math.min(p.y1, q.y1) > Math.max(p.y0, q.y0);
  const boxesOf = (op) => (op?.paras ?? []).flatMap((p) => (p.boxes ?? [p.box]).map((b) => ({ page: p.page ?? op.page, b })));
  for (const [level, table] of [["ax1.l1", "ax1.wanderingLevel1"], ["ax1.l2", "ax1.wanderingLevel2"]]) {
    const theirs = ["description", "rows"].flatMap((k) => boxesOf(entries[table].fields[k]));
    assert.ok(theirs.length > 0, `${table} reads its section`);
    const meeting = boxesOf(entries[level].fields.description).filter((o) => theirs.some((q) => q.page === o.page && meets(o.b, q.b)));
    assert.deepEqual(meeting, [], level);
  }
});

t("a passage reads no text another row reads", () => {
  // A column's box reaches a few points into the gutter from either side, so
  // two boxes meet only across more than that.
  const meets = (p, q) => Math.min(p.x1, q.x1) - Math.max(p.x0, q.x0) > 10 && Math.min(p.y1, q.y1) > Math.max(p.y0, q.y0);
  const boxesOf = (op) => (op?.paras ?? []).flatMap((p) => (p.boxes ?? [p.box]).map((b) => ({ page: p.page ?? op.page, b })));
  const rows = JSON.parse(fs.readFileSync(path.join(here, "..", "..", "register", "ax1", "p4-p71-passages.json"), "utf8"));
  const passages = rows.filter((r) => !r.assists?.aside);
  assert.ok(passages.length > 0);
  for (const row of passages) {
    const mine = boxesOf(entries[row.id]?.fields?.description);
    assert.ok(mine.length > 0, `${row.id} reads paragraphs`);
    for (const [id, e] of Object.entries(entries)) {
      if (id === row.id || !(e.pages ?? []).some((p) => row.pages.includes(p))) continue;
      const theirs = ["description", "rows"].flatMap((k) => boxesOf(e.fields?.[k]));
      const meeting = mine.filter((o) => theirs.some((q) => q.page === o.page && meets(o.b, q.b)));
      assert.deepEqual(meeting, [], `${row.id} against ${id}`);
    }
  }
});

t("a table opened by a section head carries the paragraph between the head and its grid", () => {
  const rows = JSON.parse(fs.readFileSync(path.join(here, "..", "..", "register", "ax1", "p5-p56-tables.json"), "utf8"));
  for (const id of ["ax1.motivations", "ax1.rumors"]) {
    const grid = rows.find((r) => r.id === id).assists.grid;
    const boxes = (entries[id]?.fields?.description?.paras ?? []).flatMap((p) => p.boxes ?? [p.box]);
    assert.ok(boxes.length > 0, `${id} has a description`);
    assert.ok(boxes.every((b) => b.y1 < grid.headerSkip[0] && b.x0 < grid.cellX1 && b.x1 > grid.dieX0), `${id}'s description is above its grid, in its column`);
  }
});

t("each room table reads one row per die result, from the first without a gap", () => {
  for (const id of ["ax1.pool", "ax1.mutations"]) {
    const sections = (entries[id]?.fields?.rows?.paras ?? []).map((p) => p.section);
    assert.ok(sections.length > 1, `${id} has rows`);
    assert.deepEqual(sections, sections.map((_, i) => `r${i + 1}`), id);
  }
});

t("each sidebar is a note of its own, read from its box alone", () => {
  const rows = JSON.parse(fs.readFileSync(path.join(here, "..", "..", "register", "ax1", "p9-p68-notes.json"), "utf8"));
  assert.ok(rows.length > 0);
  for (const row of rows) {
    const e = entries[row.id];
    assert.equal(e?.kind, "kind.prose", row.id);
    assert.equal(e.meta?.group, "Notes", row.id);
    assert.ok(e.meta?.title, `${row.id} is titled`);
    const box = row.assists.aside;
    const paras = e.fields.description.paras;
    assert.ok(paras.length > 0, `${row.id} reads paragraphs`);
    for (const b of paras.flatMap((p) => p.boxes ?? [p.box])) {
      assert.ok(b.x0 >= box.x0 - 1 && b.x1 <= box.x1 + 1 && b.y1 <= box.y1 + 3, `${row.id} stays in its box`);
    }
  }
  assert.equal(new Set(rows.map((r) => entries[r.id].meta.title)).size, rows.length, "every note's title differs");
});

t("the book's item reads across its two pages", () => {
  const e = entries["ax1.item1"];
  assert.equal(e?.kind, "kind.adventureItem");
  const paras = e.fields.description.paras;
  assert.ok(paras.some((p) => !p.page) && paras.some((p) => p.page === e.pages[1]), "paragraphs on both pages");
});

t("the book's equipment is the rows no other register prints, each read under its run-in", () => {
  const rows = JSON.parse(fs.readFileSync(path.join(here, "..", "..", "register", "ax1", "p70-equipment.json"), "utf8"));
  const equip = JSON.parse(fs.readFileSync(path.join(here, "..", "..", "cookbook", "equipment.json"), "utf8")).entries;
  const others = new Set(Object.values(equip).filter((e) => e.book !== "ax1").flatMap((e) => [...nameKeys(e.name)]));
  assert.deepEqual(Object.keys(equip).filter((id) => equip[id].book === "ax1"), rows.map((r) => r.id));
  for (const row of rows) {
    const e = equip[row.id];
    assert.deepEqual([...nameKeys(e.name)].filter((k) => others.has(k)), [], `${row.id} is printed by no other book`);
    assert.equal(e.fields.name.op, "expect", row.id);
    const paras = e.fields.description.paras;
    assert.ok(paras.length > 0 && paras.every((p) => p.fixes?.drop?.[0] === 0), `${row.id} reads its body, its run-in dropped`);
  }
});

console.log(`ax1-cookbook: ${n} checks OK`);
