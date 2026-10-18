/**
 * The shipped AX1 cookbook's keyed areas, as data: no PDFs, no Foundry.
 *
 * Each of the book's three key spaces holds every key its pages print, once,
 * under the id and label `spaceKeyed` derives from the key, and reads the
 * area's printed name off the page by that key; the cookbook ships no word of
 * it. An area's quick-stat lines become occupants, each read from its label's
 * origin. The inhabitants are read by key the same way, each with its prose and
 * one quick-stat block. No two areas' or inhabitants' boxes meet on a page,
 * which is how a stop that failed to fire shows in the compiled data.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

console.log(`ax1-cookbook: ${n} checks OK`);
