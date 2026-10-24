/**
 * The Statblock tab, decided on plain data with no Foundry in reach: which
 * rows the dashboard shows, what each is made of, which ones roll and which
 * post, and what the band reads. The sheet feeds it a snapshot it reads off
 * the actor (`monster-sheet.mjs`, `snapshot()`), and
 * `tools/test-monster-sheet.mjs` pins the decisions without a running world.
 *
 * Row ids are stable strings because the pins are stored by id: `save:<key>`,
 * `reaction`, `morale`, `loyalty`, `init`, `surprise:others`,
 * `surprise:avoid`, `enc:dungeon`, `enc:wilderness`, `lair`, `treasure`,
 * `atk:<itemId>`, `hp`, `hd`, `abl:<itemId>` (an ability with a throw) and
 * `post:<itemId>` (one without, which posts its card). Each kind is its own,
 * so a throw added later can never take another's id.
 */
import { SAVE_KEYS, num, signed, clampPct } from "../lib/frame-model.mjs";

/**
 * The glyph a body form puts on the band. A form with no glyph of its own
 * wears the paw; a monster with no form recorded wears it too.
 */
export const BODY_FORM_ICONS = Object.freeze({
  humanoid: "fa-solid fa-person",
  simian: "fa-solid fa-person",
  draconine: "fa-solid fa-dragon",
  dinosaurian: "fa-solid fa-dragon",
  serpentine: "fa-solid fa-staff-snake",
  equine: "fa-solid fa-horse",
  cameline: "fa-solid fa-horse",
  canine: "fa-solid fa-dog",
  feline: "fa-solid fa-cat",
  piscine: "fa-solid fa-fish",
  selachian: "fa-solid fa-fish-fins",
  cetacean: "fa-solid fa-fish-fins",
  arachnine: "fa-solid fa-spider",
  apian: "fa-solid fa-bug",
  formic: "fa-solid fa-bug",
  coleopteran: "fa-solid fa-bug",
  dipterous: "fa-solid fa-bug",
  scolopendrine: "fa-solid fa-bug",
  accipitrine: "fa-solid fa-crow",
  aquiline: "fa-solid fa-crow",
  pterosaurian: "fa-solid fa-crow",
  vespertilionine: "fa-solid fa-crow",
  bovine: "fa-solid fa-cow",
  monadine: "fa-solid fa-droplet",
  vermian: "fa-solid fa-worm",
  octopine: "fa-solid fa-shrimp",
  cancrine: "fa-solid fa-shrimp",
  ranine: "fa-solid fa-frog",
  crocodilian: "fa-solid fa-frog",
  lacertine: "fa-solid fa-frog",
  salamandrine: "fa-solid fa-frog",
  basilicine: "fa-solid fa-frog",
});

/** The default band glyph: what every form without one wears. */
export const DEFAULT_GLYPH = "fa-solid fa-paw";

/** The glyph for a body form key, the paw where it has none. */
export const bodyFormIcon = (form) => BODY_FORM_ICONS[form] ?? DEFAULT_GLYPH;

/**
 * The Hit Dice rating as the band prints it: count, a range where there is
 * one, the bonus signed, the asterisks. `null` where the rating has no
 * count, so the band falls back to core's formula.
 */
export function hdRating({ count, countMax, bonus, asterisks } = {}) {
  if (count == null || count === "") return null;
  const n = num(count);
  const max = countMax != null && countMax !== "" ? num(countMax) : null;
  const b = num(bonus);
  const stars = Math.max(0, num(asterisks));
  const range = max != null && max !== n ? `${n}–${max}` : `${n}`;
  const plus = b ? (b > 0 ? `+${b}` : `−${Math.abs(b)}`) : "";
  return `${range}${plus}${stars ? ` ${"*".repeat(stars)}` : ""}`;
}

/** A movement figure in feet, with the prime the sheet prints. */
export const feet = (n) => `${num(n)}′`;

/**
 * The movement cell's reading: the speed row in force (the first, or the one
 * the menu picked) with its combat figure as the sub-line. No row: a pad.
 */
export function moveReading(speeds = [], rowIndex = 0) {
  const rows = Array.isArray(speeds) ? speeds : [];
  if (!rows.length) return { row: null, index: -1, sub: "", pad: true };
  const i = rowIndex >= 0 && rowIndex < rows.length ? rowIndex : 0;
  const row = rows[i];
  return { row, index: i, sub: row.combat != null ? feet(row.combat) : row.run != null ? feet(row.run) : "", pad: false };
}

/**
 * The senses cell: what the creature sees by. Lightless vision prints its
 * range; any other vision prints nothing under the eye; nothing recorded is
 * a pad.
 */
export function sensesReading({ vision = [], lightlessRange = null, otherSenses = [] } = {}) {
  const kinds = Array.from(vision ?? []);
  const others = Array.isArray(otherSenses) ? otherSenses : [];
  const any = kinds.length > 0 || others.length > 0;
  const lightless = kinds.includes("lightless") && lightlessRange != null ? feet(lightlessRange) : "";
  return { any, sub: lightless, pad: !any, kinds, others };
}

/**
 * The load bar's readings for a creature: what it carries against its
 * normal load and its maximum, the normal-load tick, the tone past it. A
 * creature with no normal load recorded shows an empty bar and says so.
 */
export function loadReading({ stone = 0, normal = null, max = null } = {}) {
  const carried = Math.max(0, num(stone));
  if (normal == null) return { pct: 0, tick: null, tone: null, unset: true, carried, normal: null, max: null };
  const n = num(normal);
  const m = max != null ? num(max) : n * 2;
  const denom = m > 0 ? m : n || 1;
  const pct = clampPct((carried / denom) * 100);
  const tick = clampPct((n / denom) * 100);
  const tone = carried > m ? "bad" : carried > n ? "warn" : null;
  return { pct, tick, tone, unset: false, carried, normal: n, max: m };
}

/** One dashboard row. The pin state is read off the id. */
const row = (pins, id, label, value, extra = {}) => ({
  id,
  label,
  value: value ?? "",
  line: "",
  post: false,
  rollable: true,
  pinned: pins.has(id),
  item: null,
  ...extra,
});

/**
 * The Statblock's groups, three columns as the board lays them out. The
 * first two columns are throws; the third is readings — movement rows,
 * senses rows, the load bar, the defence pills and the spell slots — which
 * carry `kind` so the template draws them as such.
 *
 * @param {object} snap the sheet's snapshot (see `monster-sheet.mjs`)
 * @param {Function} loc the ACKS-MONSTERS localizer, `loc(key, data)`
 * @returns {{columns: object[][], ids: string[]}}
 */
export function statblockColumns(snap, loc) {
  const pins = new Set(Array.isArray(snap.pins) ? snap.pins : []);
  const groups = [];

  const saves = {
    key: "saves",
    kind: "rolls",
    name: loc("statblock.group.saves"),
    note: snap.savesAs ? loc("statblock.note.savesAs", snap.savesAs) : "",
    rows: SAVE_KEYS.map((k) => row(pins, `save:${k}`, snap.saveLabels?.[k] ?? k, `${num(snap.saves?.[k])}+`)),
  };

  const reactions = {
    key: "reactions",
    kind: "rolls",
    name: loc("statblock.group.reactions"),
    rows: [
      row(pins, "morale", loc("statblock.row.morale"), signed(num(snap.morale))),
      ...(snap.loyalty != null ? [row(pins, "loyalty", loc("statblock.row.loyalty"), signed(num(snap.loyalty)))] : []),
      row(pins, "reaction", loc("statblock.row.reaction"), "", { line: "2d6" }),
      row(pins, "init", loc("statblock.row.initiative"), signed(num(snap.initiative))),
      row(pins, "surprise:others", loc("statblock.row.surpriseOthers"), signed(num(snap.surpriseOthers))),
      row(pins, "surprise:avoid", loc("statblock.row.avoidSurprise"), signed(num(snap.surpriseAvoid))),
    ],
  };

  const encLine = (side) => {
    const parts = [];
    if (side?.wandering) parts.push(loc("statblock.row.wandering", { n: side.wandering }));
    if (side?.lair) parts.push(loc("statblock.row.inLair", { n: side.lair }));
    return parts.join(" · ");
  };
  const treasure = snap.treasure ?? {};
  const encounter = {
    key: "encounter",
    kind: "rolls",
    name: loc("statblock.group.encounter"),
    note: loc("statblock.note.ecologyPen"),
    rows: [
      row(pins, "enc:dungeon", loc("statblock.row.dungeon"), "", { line: encLine(snap.encounter?.dungeon) }),
      row(pins, "enc:wilderness", loc("statblock.row.wilderness"), "", { line: encLine(snap.encounter?.wilderness) }),
      row(pins, "lair", loc("statblock.row.lair"), snap.lairChance != null ? `${num(snap.lairChance)}%` : "", { rollable: snap.lairChance != null }),
      row(pins, "treasure", loc("statblock.row.treasure"), "", {
        line: treasure.linked
          ? loc("statblock.row.treasureLinked", { type: treasure.type || "—" })
          : treasure.type ? loc("statblock.row.treasureType", { type: treasure.type }) : loc("statblock.row.treasureNone"),
        post: true,
        rollable: !!treasure.linked,
      }),
    ],
  };

  const attacks = {
    key: "attacks",
    kind: "attacks",
    name: loc("statblock.group.attacks"),
    note: loc("statblock.note.attacks", { n: num(snap.attackThrow, 10) }),
    empty: loc("statblock.row.noAttacks"),
    rows: (snap.attacks ?? []).map((a) =>
      row(pins, `atk:${a.id}`, a.name, `${num(snap.attackThrow, 10)}+`, {
        line: [a.damageType, a.natural ? loc("statblock.row.natural") : "", a.extraordinary ? loc("statblock.row.extraordinary") : ""].filter(Boolean).join(" · "),
        damage: a.damage || "—",
        counter: a.counter ?? null,
        item: a.id,
      }),
    ),
  };

  const hitPoints = {
    key: "hitPoints",
    kind: "rolls",
    name: loc("statblock.group.hitPoints"),
    note: snap.hp?.formula ?? "",
    rows: [
      row(pins, "hp", loc("statblock.row.rollHp"), `${num(snap.hp?.value)} / ${num(snap.hp?.max)}`, { line: loc("statblock.row.rollHpLine") }),
      row(pins, "hd", loc("statblock.row.hitDice"), "", { line: snap.hdText ?? "", post: true }),
    ],
  };

  const abilities = {
    key: "abilities",
    kind: "rolls",
    name: loc("statblock.group.abilities"),
    note: loc("statblock.note.abilities"),
    empty: loc("statblock.row.noAbilities"),
    rows: (snap.abilities ?? []).map((a) =>
      a.rollable
        ? row(pins, `abl:${a.id}`, a.name, a.target != null && a.target !== "" ? `${num(a.target)}+` : "", { line: a.line ?? "", item: a.id })
        : row(pins, `post:${a.id}`, a.name, "", { line: a.line ?? "", post: true, item: a.id }),
    ),
  };

  const movement = {
    key: "movement",
    kind: "readings",
    name: loc("statblock.group.movement"),
    note: loc("statblock.note.movement"),
    empty: loc("statblock.row.noSpeeds"),
    rows: (snap.speeds ?? []).map((s) => ({
      label: s.label,
      line: s.hover ? loc("statblock.row.hover") : "",
      value: [s.combat != null ? feet(s.combat) : "—", s.run != null ? feet(s.run) : "—"].join(" / "),
    })),
  };

  const senses = {
    key: "senses",
    kind: "readings",
    name: loc("statblock.group.senses"),
    note: loc("statblock.note.senses"),
    empty: loc("statblock.row.noSenses"),
    rows: [
      ...(snap.vision ?? []).map((v) => ({
        label: v.label,
        line: "",
        value: v.key === "lightless" && snap.lightlessRange != null ? feet(snap.lightlessRange) : "",
      })),
      ...(snap.otherSenses ?? []).map((s) => ({ label: s.label, line: s.note ?? "", value: s.range != null ? feet(s.range) : "" })),
    ],
  };

  const load = loadReading(snap.load ?? {});
  const loadGroup = {
    key: "load",
    kind: "bar",
    name: loc("statblock.group.load"),
    note: load.unset
      ? loc("statblock.note.loadUnset")
      : loc("statblock.note.load", { stone: load.carried, normal: load.normal, max: load.max }),
    bar: load,
    rows: snap.load?.rider
      ? [{ label: loc("statblock.row.rider"), line: loc("statblock.row.riderLine", snap.load.rider), value: `${snap.load.rider.stone} st` }]
      : [],
  };

  const d = snap.defenses ?? {};
  const pill = (label, tone, title = "") => ({ label, tone, title });
  const defences = {
    key: "defences",
    kind: "pills",
    name: loc("statblock.group.defences"),
    note: loc("statblock.note.defencesPen"),
    pills: [
      ...(d.immune ?? []).map((l) => pill(l, "on")),
      ...(d.resist ?? []).map((l) => pill(l, "pos")),
      ...(d.susceptible ?? []).map((l) => pill(l, "neg")),
    ],
  };

  const sp = snap.spells ?? {};
  const spells = sp.enabled
    ? {
        key: "spells",
        kind: "pills",
        name: loc("statblock.group.spells"),
        note: sp.casterClass ? loc("statblock.note.casts", { cls: sp.casterClass, level: num(sp.casterLevel) }) : "",
        pills: (sp.slots ?? []).map((s) => pill(loc("statblock.row.slot", s), "ts")),
        tab: "spells",
        tabLabel: loc("statblock.row.spellsTab"),
      }
    : null;

  groups.push(saves, reactions, encounter, attacks, hitPoints, abilities, movement, senses, loadGroup, defences);
  if (spells) groups.push(spells);

  const columns = [
    [saves, reactions, encounter],
    [attacks, hitPoints, abilities],
    [movement, senses, loadGroup, defences, ...(spells ? [spells] : [])],
  ];
  const ids = groups.flatMap((g) => (g.kind === "rolls" || g.kind === "attacks" ? g.rows.map((r) => r.id) : []));
  return { columns, ids };
}

/** Every roll row across the columns, flat. */
export const rollRows = (columns) => columns.flat().filter((g) => g.kind === "rolls" || g.kind === "attacks").flatMap((g) => g.rows);
