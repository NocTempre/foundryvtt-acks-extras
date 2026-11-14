/**
 * The shipped Lairs & Encounters cookbook's lairs, as data: no PDFs, no Foundry.
 *
 * Chapter 3's how-to is the `le.lairs` place and each of its listings a keyed
 * place in that place's key space, numbered in print order: pages ascending,
 * the left column before the right, top to bottom. A row ships its hash locator,
 * its pages and, where the Judge's ACKS II monsters hold one, the monster it
 * is the lair of; the cookbook reads the name off the page by the hash and
 * ships no word of it. `PLATES` pins each plated lair to the page its listing's
 * own pointer names and the page it points at, as `harvest-lairs.mjs` read
 * them; the scenes pair by this table: one `kind.scene` per plated lair, on
 * the plate's page, naming that lair as its `place`.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { lairOfProblems, replacementProblems } from "./register-rules.mjs";
import { isRegionRecipe, placementHolding, recipeContext, recipeProblems, sceneFrame } from "../../scripts/importer/scene-binding.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
const cb = JSON.parse(fs.readFileSync(path.join(root, "cookbook", "le.json"), "utf8"));
const entries = cb.entries ?? {};
const scenes = cb.scenes ?? {};

let n = 0;
const t = (name, fn) => {
  fn();
  n++;
  console.log(`ok - ${name}`);
};

/** The register's rows by id, the Monstrous Manual's and this book's. */
const rows = new Map();
for (const book of ["mm", "le"]) {
  const dir = path.join(root, "register", book);
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    for (const r of JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))) rows.set(r.id, r);
  }
}
const lairRows = [...rows.values()].filter((r) => r.book === "le" && r.meta?.space === "le.lairs");
const ordinal = (id) => Number(/^le\.lair(\d+)$/.exec(id)?.[1]);

/** The listings that print a full-page plate: row id -> [the page its pointer stands on, the plate page it names]. */
const PLATES = {
  "le.lair4": [17, 190],
  "le.lair5": [17, 191],
  "le.lair40": [28, 192],
  "le.lair41": [29, 193],
  "le.lair42": [30, 194],
  "le.lair47": [33, 195],
  "le.lair48": [34, 224],
  "le.lair49": [37, 196],
  "le.lair50": [37, 197],
  "le.lair51": [38, 198],
  "le.lair52": [40, 199],
  "le.lair55": [42, 200],
  "le.lair56": [45, 201],
  "le.lair70": [53, 202],
  "le.lair72": [55, 203],
  "le.lair73": [57, 204],
  "le.lair84": [63, 205],
  "le.lair85": [66, 206],
  "le.lair89": [68, 207],
  "le.lair102": [73, 208],
  "le.lair103": [74, 207],
  "le.lair104": [75, 209],
  "le.lair105": [76, 211],
  "le.lair106": [78, 212],
  "le.lair107": [81, 213],
  "le.lair109": [82, 215],
  "le.lair110": [83, 210],
  "le.lair111": [85, 214],
  "le.lair116": [89, 216],
  "le.lair117": [90, 217],
  "le.lair118": [93, 218],
  "le.lair122": [96, 219],
  "le.lair124": [97, 220],
  "le.lair139": [103, 223],
  "le.lair141": [104, 222],
  "le.lair149": [106, 221],
  "le.lair164": [112, 225],
};
/** The plated lairs whose pointer stands on a page before the listing's own first page: the map is captioned inside the listing above. */
const POINTER_BEFORE_LISTING = ["le.lair55"];
/** The listings no ACKS II monster is the lair of, by ordinal. */
const NO_MONSTER = [17, 21, 22, 30, 36, 65, 66, 77, 108, 109, 110, 112, 127];

t("the book's lairs are 167 listings numbered from 1 with no gap", () => {
  assert.equal(lairRows.length, 167);
  assert.deepEqual(lairRows.map((r) => ordinal(r.id)).sort((a, b) => a - b), Array.from({ length: 167 }, (_, i) => i + 1));
  for (const r of lairRows) assert.equal(r.name, `Lair ${ordinal(r.id)}`);
});

t("the container is the one place holding the key space, and every lair is in it", () => {
  const lairs = rows.get("le.lairs");
  assert.equal(lairs.kind, "kind.location");
  assert.equal(lairs.meta, undefined);
  for (const r of lairRows) {
    assert.equal(r.kind, "kind.location");
    assert.equal(r.meta.space, "le.lairs", r.id);
    assert.equal(r.meta.parent, "le.lairs", r.id);
    assert.match(r.anchor.hash, /^[0-9a-z]+$/, r.id);
  }
  assert.equal(new Set([...lairRows, lairs].map((r) => r.anchor.hash)).size, 168);
});

t("every meta.of names an ACKS II monster or template, and the none are the ones listed", () => {
  assert.deepEqual(lairOfProblems(rows), []);
  const without = lairRows.filter((r) => r.meta.of === undefined).map((r) => ordinal(r.id)).sort((a, b) => a - b);
  assert.deepEqual(without, NO_MONSTER);
  assert.equal(lairRows.length - without.length, 154);
});

t("each register row is compiled, with its pages and the hash the page is read by", () => {
  assert.deepEqual(Object.keys(entries).sort(), [...rows.values()].filter((r) => r.book === "le" && r.kind === "kind.location").map((r) => r.id).sort());
  for (const r of rows.values()) {
    if (r.book !== "le" || r.kind !== "kind.location") continue;
    const e = entries[r.id];
    assert.equal(e.kind, "kind.location", r.id);
    assert.equal(e.name, r.name, r.id);
    assert.deepEqual(e.pages, r.pages, r.id);
    assert.equal(e.cite, `LE p.${r.pages[0]}`, r.id);
    assert.equal(e.fields.name.op, "heading", r.id);
    assert.equal(e.fields.name.hash, r.anchor.hash, r.id);
    assert.equal(e.fields.name.page, r.pages[0], r.id);
    assert.equal("text" in e.fields.name, false, r.id);
    assert.equal(e.meta?.of, r.meta?.of, r.id);
  }
});

t("a listing's text is read on its own pages and reaches its last one", () => {
  for (const e of Object.values(entries)) {
    const read = new Set();
    const walk = (o) => {
      if (o && typeof o === "object") {
        if (typeof o.page === "number") read.add(o.page);
        Object.values(o).forEach(walk);
      }
    };
    walk(e.fields);
    assert.ok(e.fields.description?.paras?.length > 0, e.name);
    assert.equal(Math.min(...read), e.pages[0], e.name);
    assert.equal(Math.max(...read), e.pages[e.pages.length - 1], e.name);
  }
});

t("a page's prose is read in the book's two columns, the same two on every page of a parity", () => {
  const bands = { odd: new Set(), even: new Set() };
  for (const e of Object.values(entries)) {
    for (const p of e.fields.description.paras) {
      const page = p.page ?? e.fields.description.page;
      bands[page % 2 ? "odd" : "even"].add(`${Math.round(p.box.x0)}-${Math.round(p.box.x1)}`);
    }
  }
  assert.deepEqual([...bands.odd].sort(), ["16-296", "296-590"]);
  assert.deepEqual([...bands.even].sort(), ["26-306", "306-590"]);
});

t("print order: the number rises with page, then column, then height", () => {
  const at = (id) => {
    const { page, box } = entries[id].fields.name;
    return [page, box.x0 < 150 ? 0 : 1, box.y0];
  };
  const placed = lairRows.map((r) => ({ n: ordinal(r.id), at: at(r.id) })).sort((a, b) => a.n - b.n);
  for (let i = 1; i < placed.length; i++) {
    const [p, c, y] = placed[i - 1].at;
    const [q, d, z] = placed[i].at;
    assert.ok(q > p || (q === p && (d > c || (d === c && z > y))), `lair ${placed[i].n} stands before lair ${placed[i - 1].n}`);
  }
  assert.equal(at("le.lairs")[0], 16);
  assert.ok(at("le.lair1")[0] === 16 && at("le.lair4")[0] === 17);
});

t("a plate's lair is the row whose pages hold its pointer, bar the one captioned above it", () => {
  const ids = Object.keys(PLATES);
  assert.equal(ids.length, 37);
  assert.equal(new Set(Object.values(PLATES).map(([, plate]) => plate)).size, 36);
  assert.equal(Object.values(PLATES).filter(([, plate]) => plate === 207).length, 2);
  for (const [id, [pointer, plate]] of Object.entries(PLATES)) {
    const row = rows.get(id);
    assert.ok(row?.meta?.space === "le.lairs", id);
    assert.ok(plate >= 189 && plate <= 229, id);
    if (POINTER_BEFORE_LISTING.includes(id)) assert.ok(pointer < row.pages[0], id);
    else assert.ok(row.pages.includes(pointer), `${id}: pointer p.${pointer} is outside pages ${row.pages}`);
  }
});

/** The book's scene rows, as authored: the register's, by id. */
const sceneRows = [...rows.values()].filter((r) => r.book === "le" && r.kind === "kind.scene");

t("a plate is one scene on its lair's page, named by id and by place", () => {
  assert.equal(sceneRows.length, 37);
  assert.deepEqual(sceneRows.map((r) => r.id).sort(), Object.keys(PLATES).map((id) => `${id}Map`).sort());
  for (const [id, [, plate]] of Object.entries(PLATES)) {
    const row = rows.get(`${id}Map`);
    assert.equal(row.name, `Lair ${ordinal(id)} Map`, id);
    assert.deepEqual(row.pages, [plate], id);
    assert.equal(row.scene.place, id, id);
    assert.ok(rows.get(row.scene.place)?.meta?.space === "le.lairs", id);
  }
  assert.deepEqual([...new Set(sceneRows.map((r) => r.pages[0]))].sort((a, b) => a - b), Array.from({ length: 36 }, (_, i) => 190 + i));
  assert.equal(new Set(sceneRows.map((r) => r.scene.place)).size, 37);
});

t("no lair scene reads as the book's region map: each names a place and a square grid of 5 ft", () => {
  for (const r of sceneRows) {
    const { scene } = r;
    assert.equal(isRegionRecipe(scene), false, r.id);
    assert.equal(scene.travel, "delve", r.id);
    assert.equal(scene.walls, undefined, r.id);
    assert.equal(scene.places, undefined, r.id);
    assert.equal(scene.grid.family, "square", r.id);
    assert.equal(scene.grid.distance, 5, r.id);
    assert.equal(scene.grid.units, "ft", r.id);
    assert.equal(scene.grid.box.w, scene.grid.box.h, r.id);
    assert.ok(scene.grid.pixels >= 50 && scene.grid.pixels <= 70, r.id);
    assert.ok(scene.turn === undefined || [1, 2, 3].includes(scene.turn), r.id);
  }
  assert.equal(sceneRows.filter((r) => r.scene.turn === undefined).length, 11);
  assert.equal(sceneRows.filter((r) => r.scene.turn !== undefined).length, 26);
});

t("each scene is compiled over its plate: the placement holds the crop, and the recipe passes the checks", () => {
  assert.deepEqual(Object.keys(scenes).sort(), sceneRows.map((r) => r.id).sort());
  const placed = new Map();
  for (const r of sceneRows) {
    const row = scenes[r.id];
    assert.equal(row.kind, "kind.scene", r.id);
    assert.equal(row.cite, `LE p.${r.pages[0]}`, r.id);
    assert.deepEqual(row.pages, r.pages, r.id);
    const { page, placement, ...recipe } = row.scene;
    assert.equal(page, r.pages[0], r.id);
    assert.deepEqual(recipe, (({ note, ...rest }) => rest)(r.scene), r.id);
    assert.deepEqual(placementHolding([placement], recipe.crop), placement, r.id);
    assert.deepEqual(recipeProblems(recipe, recipeContext(entries)), [], r.id);
    assert.equal(isRegionRecipe(recipe), false, r.id);
    // The picture is cut at the grid's scale; one past the browser's canvas ceiling is never rendered.
    const frame = sceneFrame(recipe, { pixelsPerPoint: recipe.grid.pixels / recipe.grid.box.w });
    assert.ok(Math.max(frame.width, frame.height) <= 12000, `${r.id}: picture ${frame.width}x${frame.height}`);
    const [cx, cy] = recipe.grid.centre;
    assert.ok(cx > recipe.crop.x && cx < recipe.crop.x + recipe.crop.w && cy > recipe.crop.y && cy < recipe.crop.y + recipe.crop.h, r.id);
    placed.set(page, [...(placed.get(page) ?? []), placement]);
  }
  const two = placed.get(207);
  assert.equal(two.length, 2);
  assert.notDeepEqual(two[0], two[1]);
});

t("the creature replacements are reviewed for this book, key no name, and bind a lair's stat line to an ACKS II monster", () => {
  const reg = JSON.parse(fs.readFileSync(path.join(root, "register", "_refs", "creatureReplacement.json"), "utf8"));
  assert.equal(reg.registry, "creatureReplacement");
  assert.deepEqual(replacementProblems(reg.table, rows), []);
  const pairs = Object.values(reg.table);
  assert.equal(pairs.length, 81);
  assert.equal(new Set(pairs.map((p) => p.ref)).size, 39);
  assert.ok(pairs.every((p) => rows.get(p.ref)?.kind === "kind.monster" && p.books.length === 1 && p.books[0] === "le"));
  // Whatever a lair is the lair of, its own stat line is registered to the same row where one is.
  assert.ok(lairRows.filter((r) => r.meta.of && pairs.some((p) => p.ref === r.meta.of)).length >= 20);
});

console.log(`le-cookbook: ${n} checks OK`);
