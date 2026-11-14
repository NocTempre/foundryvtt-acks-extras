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
import { convertedDie } from "./kits.mjs";
import { loadStanding } from "./load-rule.mjs";
import { printKey } from "../importer/printed-name.mjs";

/**
 * The glyph a body form puts on the band, keyed by `printKey` of the form's
 * key: the hash of its folded letters, so the table holds no printed name. A
 * form with no glyph of its own wears the paw; a monster with no form recorded
 * wears it too.
 */
export const BODY_FORM_ICONS = Object.freeze({
  "1drveiq": "fa-solid fa-person",
  "1qvyz90": "fa-solid fa-person",
  "mrkyvk": "fa-solid fa-dragon",
  "178y1pe": "fa-solid fa-dragon",
  "14t22ci": "fa-solid fa-staff-snake",
  "18y6uew": "fa-solid fa-horse",
  "z6ktb5": "fa-solid fa-horse",
  "182p075": "fa-solid fa-dog",
  "kov1ra": "fa-solid fa-cat",
  "105tmhq": "fa-solid fa-fish",
  "5sfp8r": "fa-solid fa-fish-fins",
  "pzwcd5": "fa-solid fa-fish-fins",
  "1n53w9e": "fa-solid fa-spider",
  "1pbfygk": "fa-solid fa-bug",
  "1e4vkff": "fa-solid fa-bug",
  "1wyrnqh": "fa-solid fa-bug",
  "1xa1jwe": "fa-solid fa-bug",
  "16xys0": "fa-solid fa-bug",
  "pwluv6": "fa-solid fa-crow",
  "rwlyov": "fa-solid fa-crow",
  "1duxbis": "fa-solid fa-crow",
  "1mfiunt": "fa-solid fa-crow",
  "1dx5x5i": "fa-solid fa-cow",
  "f7plaq": "fa-solid fa-droplet",
  "x29eln": "fa-solid fa-worm",
  "1xfltwk": "fa-solid fa-shrimp",
  "1k9tini": "fa-solid fa-shrimp",
  "18d71o4": "fa-solid fa-frog",
  "14gzmt8": "fa-solid fa-frog",
  "1j676t2": "fa-solid fa-frog",
  "1le737m": "fa-solid fa-frog",
  "2pxemu": "fa-solid fa-frog",
});

/** The default band glyph: what every form without one wears. */
export const DEFAULT_GLYPH = "fa-solid fa-paw";

/**
 * The glyph for a body form key, the paw where it has none. `icons` is the
 * map the key is looked up in, by its `printKey`.
 */
export const bodyFormIcon = (form, icons = BODY_FORM_ICONS) => icons[printKey(form)] ?? DEFAULT_GLYPH;

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
 * creature with no normal load recorded shows an empty bar and says so. The
 * maximum is the creature's own, else `maxMultiple` times its normal load
 * (`load-rule.mjs`); with neither, `max` is null and no tone reads red.
 */
export function loadReading({ stone = 0, normal = null, max = null, maxMultiple = null } = {}) {
  const carried = Math.max(0, num(stone));
  if (normal == null) return { pct: 0, tick: null, tone: null, unset: true, carried, normal: null, max: null };
  const n = num(normal);
  const { ceiling, denom, state } = loadStanding({ stone: carried, normal: n, max: max != null ? num(max) : null, maxMultiple });
  const pct = clampPct((carried / denom) * 100);
  const tick = clampPct((n / denom) * 100);
  const tone = state === "overloaded" ? "bad" : state === "encumbered" ? "warn" : null;
  return { pct, tick, tone, unset: false, carried, normal: n, max: ceiling };
}

/** An attack's damage text with the creature's own modifier after it, where it has one. */
const modded = (damage, mod) => (damage && mod ? `${damage} ${signed(mod)}` : damage);

/**
 * The leader tooltip's clause for how the member's hit-point bonus came along:
 * carried whole, or multiplied by the factor the leader record holds; none
 * where the record holds no factor.
 */
function carriedTip(leader, loc) {
  if (leader.carried === "carried") return loc("statblock.tip.leaderCarried");
  if (leader.carried !== "multiplied" || leader.bonusFactor == null) return "";
  const factor = Number(leader.bonusFactor);
  return Number.isFinite(factor) ? loc("statblock.tip.leaderMultiplied", { factor }) : "";
}

/**
 * The tooltips naming what an import worked a throw and a save row out from
 * (`snap.derived`, the extras `derived` block): each only while the actor still
 * carries the figure it wrote, so a figure a Judge has since typed is not
 * explained by parts it no longer comes from. A throw the ladder could not
 * give says so. `leaderTip` names where a leader's own figures came from (its
 * page, or the leader procedure's parts); `acTip` its armour class alone, for
 * the rail, and a kit's (`snap.kit`) over a leader's where the actor holds the
 * kit's; `moraleTip` and `damageTip` the kit's troop row, where the actor holds
 * its figure. `{throwTip, savesTip, leaderTip, acTip, moraleTip, damageTip}`,
 * "" where there is nothing to name.
 */
export function derivationTips(snap, loc) {
  const d = snap.derived ?? {};
  const t = d.throw ?? {};
  let throwTip = "";
  if (t.missing) throwTip = loc("statblock.tip.throwMissing");
  else if (t.value != null && Number(t.value) === Number(snap.attackThrow)) {
    const cite = t.cite || loc("statblock.tip.ladderOverride");
    throwTip =
      t.base != null && t.rows != null
        ? loc("statblock.tip.throwMoved", { value: t.value, base: t.base, baseHd: t.baseHd, rows: t.rows, hd: t.hd, cite })
        : loc("statblock.tip.throwLadder", { value: t.value, hd: t.hd, cite });
  }
  const s = d.saves ?? {};
  const savesTip =
    s.level != null && snap.savesAs && Number(s.level) === Number(snap.saveLevel)
      ? loc("statblock.tip.savesMoved", { cls: snap.savesAs.cls, level: s.level, baseLevel: s.baseLevel ?? "—", baseHd: s.baseHd, hd: s.hd })
      : "";
  // Where a leader's own figures came from: its page, or the procedure with
  // each part it added, named only while the actor carries what it built.
  const l = d.leader ?? {};
  let leaderTip = "";
  let acTip = "";
  if (l.source === "printed") {
    leaderTip = loc("statblock.tip.leaderPrinted", { cite: l.cite || "—" });
    if (l.ac != null && Number(l.ac) === Number(snap.ac)) acTip = loc("statblock.tip.acPrinted", { ac: l.ac, cite: l.cite || "—" });
  } else if (l.source) {
    if (Number(l.ac) === Number(snap.ac)) {
      acTip = loc("statblock.tip.acDerived", { ac: l.ac, baseAc: l.baseAc, acAdd: signed(num(l.acAdd)), cite: l.cite || "—" });
    }
    // A generated kit replaces the leader's armour class; the leader counts as intact while the kit was worked out from it.
    const kitHeld = d.kit?.value != null && Number(d.kit.value) === Number(snap.ac) && d.kit.leaderAc != null;
    const leaderAc = kitHeld ? d.kit.leaderAc : snap.ac;
    const intact = Number(l.ac) === Number(leaderAc) && Number(l.damage) === Number(snap.damageMod ?? 0);
    leaderTip = intact
      ? loc("statblock.tip.leaderDerived", {
          cite: l.cite || "—",
          hd: l.hd,
          rows: l.rows,
          baseHd: l.baseHd,
          carried: carriedTip(l, loc),
          ac: l.ac,
          baseAc: l.baseAc,
          acAdd: signed(num(l.acAdd)),
          damage: signed(num(l.damage)),
          baseDamage: signed(num(l.baseDamage)),
          damageAdd: signed(num(l.damageAdd)),
        })
      : loc("statblock.tip.leaderDerivedEdited", { cite: l.cite || "—" });
  }
  // A kit outranks the leader's own armour class: what the actor holds is the
  // kit's, printed on its troop row or worked out at generation.
  const k = snap.kit?.troop ? snap.kit : null;
  const dk = d.kit ?? null;
  let moraleTip = "";
  let damageTip = "";
  if (k) {
    const label = k.label || k.troop || "";
    if (dk && dk.value != null && Number(dk.value) === Number(snap.ac)) {
      const parts = { ac: dk.value, base: dk.base, label, cite: dk.cite || "—", step: signed(num(dk.step)), leaderAc: dk.leaderAc ?? "—", memberAc: dk.memberAc ?? "—" };
      const key = dk.from === "natural" ? (dk.step || dk.leaderAc != null ? "acKitNaturalLeader" : "acKitNatural") : "acKitLeader";
      acTip = loc(`statblock.tip.${key}`, parts);
    } else if (!k.compute && k.ac != null && Number(k.ac) === Number(snap.ac)) {
      acTip = loc("statblock.tip.acKit", { ac: k.ac, label, cite: k.cite || "—" });
    }
    if (k.morale != null && Number(k.morale) === Number(snap.morale)) moraleTip = loc("statblock.tip.kitFigure", { label, cite: k.cite || "—" });
    if (!k.compute && k.damage != null && Number(k.damage) === Number(snap.damageMod ?? 0)) damageTip = loc("statblock.tip.kitFigure", { label, cite: k.cite || "—" });
  }
  return { throwTip, savesTip, leaderTip, acTip, moraleTip, damageTip };
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
  const { throwTip, savesTip, leaderTip, moraleTip, damageTip: kitDamageTip } = derivationTips(snap, loc);
  // An attack's damage tooltip: its die and the creature's modifier, where
  // the modifier came from a kit's row, and the die the imported conversion
  // table makes of the pair.
  const attackDamageTip = (formula) => {
    if (!snap.damageMod || !formula) return "";
    const parts = [loc("statblock.row.damageWithMod", { formula, mod: signed(snap.damageMod) })];
    if (kitDamageTip) parts.push(kitDamageTip);
    const die = convertedDie(snap.dice?.rows, formula, Number(snap.damageMod));
    if (die) parts.push(loc("statblock.tip.dieConverted", { die, cite: snap.dice?.cite || "—" }));
    return parts.join(" · ");
  };

  const saves = {
    key: "saves",
    kind: "rolls",
    name: loc("statblock.group.saves"),
    note: snap.savesAs ? loc("statblock.note.savesAs", snap.savesAs) : "",
    noteTip: savesTip,
    rows: SAVE_KEYS.map((k) => row(pins, `save:${k}`, snap.saveLabels?.[k] ?? k, `${num(snap.saves?.[k])}+`, { valueTip: savesTip })),
  };

  const reactions = {
    key: "reactions",
    kind: "rolls",
    name: loc("statblock.group.reactions"),
    rows: [
      row(pins, "morale", loc("statblock.row.morale"), signed(num(snap.morale)), { valueTip: moraleTip }),
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
  // A side with a line and no formula counts units: it reads and does not roll.
  const encRow = (id, label, side) => {
    const line = encLine(side);
    return row(pins, id, label, "", {
      line,
      rollable: !!side?.formula,
      lineTip: line && !side?.formula ? loc("statblock.row.inUnits") : "",
    });
  };
  const treasure = snap.treasure ?? {};
  const encounter = {
    key: "encounter",
    kind: "rolls",
    name: loc("statblock.group.encounter"),
    note: loc("statblock.note.ecologyPen"),
    rows: [
      encRow("enc:dungeon", loc("statblock.row.dungeon"), snap.encounter?.dungeon),
      encRow("enc:wilderness", loc("statblock.row.wilderness"), snap.encounter?.wilderness),
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
    noteTip: throwTip,
    empty: loc("statblock.row.noAttacks"),
    rows: (snap.attacks ?? []).map((a) =>
      row(pins, `atk:${a.id}`, a.name, `${num(snap.attackThrow, 10)}+`, {
        line: [a.damageType, a.natural ? loc("statblock.row.natural") : "", a.extraordinary ? loc("statblock.row.extraordinary") : ""].filter(Boolean).join(" · "),
        // The creature's own damage modifier rides every roll beside the
        // attack's die, so the tag shows both and the tooltip names each.
        damage: modded(a.damage, snap.damageMod) || "—",
        damageTip: attackDamageTip(a.damage),
        valueTip: throwTip,
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
    noteTip: leaderTip,
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
      : load.max == null
        ? loc("statblock.note.loadNoMax", { stone: load.carried, normal: load.normal })
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
