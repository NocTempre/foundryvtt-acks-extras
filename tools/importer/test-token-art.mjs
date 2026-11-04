/**
 * Overhead token art from an installed Actor compendium: the plan
 * (`token-art-logic.mjs`) and its performance (`token-art.mjs`) against an
 * invented source package, invented monsters and invented paths. Nothing here
 * is a real package's art, name or layout.
 */
import assert from "node:assert";
import { MODULE_ID } from "../../scripts/importer/constants.mjs";
import { foldName, indexSource, isPackageArt, planApply, planRestore, planPlaced, ART_FIT } from "../../scripts/importer/token-art-logic.mjs";

let pass = 0;
const ok = (label, cond, detail = "") => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ""}`);
  pass++;
};

const PKG = "zz-art-pack";
const art = (stem) => `modules/${PKG}/tokens/${stem}.png`;
const row = (name, tokenSrc, extra = {}) => ({ name, type: "monster", tokenSrc, uuid: `Compendium.${PKG}.monsters.Actor.${foldName(name)}`, ...extra });

/* --- folding ---------------------------------------------------------------------------- */
ok("a name folds without case, spacing, punctuation or diacritics", foldName("Gröbble-Wump, Elder") === foldName("grobble wump elder") && foldName("Gröbble-Wump, Elder") === "grobblewumpelder");
ok("a path is the package's only under its own modules directory", isPackageArt(art("a"), PKG) && !isPackageArt("icons/svg/mystery-man.svg", PKG) && !isPackageArt(`modules/other/${PKG}.png`, PKG) && !isPackageArt(art("a"), ""));

/* --- the index -------------------------------------------------------------------------- */
const index = indexSource(
  [
    row("Wump", art("wump")),
    row("Zorn", art("zorn-*"), { randomImg: true }),
    row("Plink", "icons/svg/mystery-man.svg"),
    row("Twin", art("twin-a")),
    row("Twin", art("twin-b")),
    row("Same", art("same")),
    row("Same", art("same")),
    { name: "Pilgrim", type: "character", tokenSrc: art("pilgrim") },
  ],
  PKG,
);
ok("a monster whose token is the package's own art is indexed by its folded name", index.art.get("wump")?.[0].src === art("wump"));
ok("a wildcard path is marked wildcard whether or not the row says so", index.art.get("zorn")[0].randomImg === true && indexSource([row("Zorn", art("zorn-*"))], PKG).art.get("zorn")[0].randomImg === true);
ok("a placeholder token is no art, and the name is remembered as such", !index.art.has("plink") && index.noArt.has("plink"));
ok("a row that is not a monster is not indexed", !index.art.has("pilgrim") && !index.noArt.has("pilgrim"));
ok("two rows with different art under one name both stand", index.art.get("twin").length === 2);
ok("two rows with the same art under one name are one", index.art.get("same").length === 1);
ok("the count is the names with art", index.count === 4, String(index.count));

/* --- apply ------------------------------------------------------------------------------ */
const subject = (name, img, tokenSrc, extra = {}) => ({ uuid: `Actor.${foldName(name)}`, name, img, tokenSrc, ...extra });
const BOOKART = "acks-extras-art/zz.one.png";
const subjects = [
  subject("Wump", BOOKART, BOOKART),
  subject("Zorn", BOOKART, BOOKART),
  subject("Plink", BOOKART, BOOKART),
  subject("Twin", BOOKART, BOOKART),
  subject("Nothing", BOOKART, BOOKART),
  subject("Gröbble", BOOKART, BOOKART),
];
const first = planApply(subjects, index, { from: "ZZ Art" });
ok("a token still showing the import's portrait changes", first.changes.some((c) => c.name === "Wump" && c.src === art("wump")));
ok("a wildcard carries its mark", first.changes.find((c) => c.name === "Zorn").randomImg === true);
ok("the token that stood is kept as what Restore returns", first.changes[0].was.src === BOOKART && first.changes[0].was.randomImg === false);
ok("the counts: two change, one no art, one ambiguous, two no match", JSON.stringify(first.counts) === JSON.stringify({ change: 2, current: 0, kept: 0, noArt: 1, ambiguous: 1, noMatch: 2 }), JSON.stringify(first.counts));
ok("the source's uuid is recorded", first.changes[0].from.startsWith(`Compendium.${PKG}.`));

const judged = planApply([subject("Wump", BOOKART, "worlds/mine/wump.png")], index);
ok("a token a Judge set is counted and left", judged.counts.kept === 1 && judged.changes.length === 0);
const handled = planApply([subject("Wump", BOOKART, BOOKART, { fit: "cover" })], index);
ok("only the image and mark are planned, never a size or scale", !("scaleX" in handled.changes[0]) && !("width" in handled.changes[0]) && ART_FIT === "contain");

const written = subject("Wump", BOOKART, art("wump"), { flag: { src: art("wump"), was: { src: BOOKART, randomImg: false, fit: "" } } });
const again = planApply([written], index);
ok("a token this feature wrote and that already shows the art is current", again.counts.current === 1 && again.changes.length === 0);
const newer = indexSource([row("Wump", art("wump-two"))], PKG);
const rewritten = planApply([written], newer);
ok("a token this feature wrote is written again when the source moved", rewritten.changes.length === 1 && rewritten.changes[0].src === art("wump-two"));
ok("and the original token, not the first write, is what Restore will return", rewritten.changes[0].was.src === BOOKART);
const noImg = planApply([subject("Wump", BOOKART, "")], index);
ok("an empty token is the import's default", noImg.changes.length === 1);

/* --- restore ---------------------------------------------------------------------------- */
const restore = planRestore([
  written,
  subject("Gone", BOOKART, "worlds/mine/other.png", { flag: { src: art("gone"), was: { src: BOOKART } } }),
  subject("Plain", BOOKART, BOOKART),
]);
ok("a flagged token still showing the written art is restored from the flag alone", restore.restores.length === 1 && restore.restores[0].was.src === BOOKART);
ok("a flagged token a Judge has changed since is counted and left", restore.counts.kept === 1 && restore.counts.restore === 1);
ok("an unflagged monster is not touched", restore.restores.every((r) => r.name !== "Plain"));

/* --- placed tokens ---------------------------------------------------------------------- */
const tokens = [
  { uuid: "T.a", actorLink: false, src: BOOKART },
  { uuid: "T.b", actorLink: true, src: BOOKART },
  { uuid: "T.c", actorLink: false, src: "worlds/mine/x.png" },
];
const moved = planPlaced(tokens, BOOKART, art("wump"));
ok("an unlinked token showing the old path moves to the new one", moved.length === 1 && moved[0].uuid === "T.a" && moved[0].src === art("wump"));
ok("a linked token and a token the Judge changed are left", !moved.some((m) => m.uuid === "T.b" || m.uuid === "T.c"));
ok("nothing moves between equal paths", planPlaced(tokens, BOOKART, BOOKART).length === 0);

/* --- the Foundry side, against an invented world ---------------------------------------- */
const flagKey = `flags.${MODULE_ID}.tokenArt`;
const updates = [];
const makeActor = (name, tokenSrc, extra = {}) => {
  const actor = {
    id: foldName(name),
    uuid: `Actor.${foldName(name)}`,
    pack: null,
    name,
    type: "monster",
    img: BOOKART,
    flags: { [MODULE_ID]: { cookbook: { id: `zz.${foldName(name)}` }, ...(extra.flag ? { tokenArt: extra.flag } : {}) } },
    prototypeToken: { randomImg: false, texture: { src: tokenSrc, fit: "contain" } },
    async update(patch) {
      updates.push([name, patch]);
      if (extra.refuse) throw new Error("locked");
      for (const [k, v] of Object.entries(patch)) {
        if (k === "prototypeToken.texture.src") this.prototypeToken.texture.src = v;
        else if (k === "prototypeToken.randomImg") this.prototypeToken.randomImg = v;
        else if (k === "prototypeToken.texture.fit") this.prototypeToken.texture.fit = v;
        else if (k === flagKey) {
          if (v?.constructor?.name === "ForcedDeletion") delete this.flags[MODULE_ID].tokenArt;
          else this.flags[MODULE_ID].tokenArt = v;
        }
      }
    },
  };
  return actor;
};
const actors = [makeActor("Wump", BOOKART), makeActor("Zorn", BOOKART), makeActor("Zork", "worlds/mine/zork.png"), makeActor("Locked", BOOKART, { refuse: true }), makeActor("Twin", BOOKART)];
const sceneUpdates = [];
const scenes = [
  {
    tokens: [
      { id: "tk1", uuid: "Token.tk1", actorId: "wump", actorLink: false, texture: { src: BOOKART } },
      { id: "tk2", uuid: "Token.tk2", actorId: "wump", actorLink: true, texture: { src: BOOKART } },
    ],
    async updateEmbeddedDocuments(type, list) {
      sceneUpdates.push([type, list]);
    },
  },
];
class ForcedDeletion {}
let dialogResult = { placed: true };
const asked = [];
const notices = [];
const pack = {
  documentName: "Actor",
  collection: `${PKG}.monsters`,
  metadata: { packageType: "module", packageName: PKG },
  async getIndex() {
    const rows = [
      { _id: "w", name: "Wump", type: "monster", prototypeToken: { texture: { src: art("wump") } } },
      { _id: "z", name: "Zorn", type: "monster", prototypeToken: { randomImg: true, texture: { src: art("zorn-*") } } },
      { _id: "t1", name: "Twin", type: "monster", prototypeToken: { texture: { src: art("twin-a") } } },
      { _id: "t2", name: "Twin", type: "monster", prototypeToken: { texture: { src: art("twin-b") } } },
      { _id: "k", name: "Zork", type: "monster", prototypeToken: { texture: { src: art("zork") } } },
      { _id: "l", name: "Locked", type: "monster", prototypeToken: { texture: { src: art("locked") } } },
    ];
    return rows;
  },
};
const ownPack = { documentName: "Actor", collection: `${MODULE_ID}.shelf`, metadata: { packageType: "module", packageName: MODULE_ID }, async getIndex() { return [{ _id: "x", name: "Wump", type: "monster", prototypeToken: { texture: { src: `modules/${MODULE_ID}/x.png` } } }]; } };
const corePack = { documentName: "Actor", collection: "acks.monsters", metadata: { packageType: "system", packageName: "acks" }, async getIndex() { return [{ _id: "x", name: "Wump", type: "monster", prototypeToken: { texture: { src: `modules/${PKG}/${"x"}.png` } } }]; } };
let active = true;
globalThis.game = {
  user: { isGM: true },
  i18n: { localize: (k) => k, format: (k, d) => `${k}|${JSON.stringify(d)}` },
  packs: [pack, ownPack, corePack],
  modules: new Map([[PKG, { get active() { return active; }, title: "ZZ Art Pack" }], [MODULE_ID, { active: true, title: "Extras" }]]),
  scenes,
  actors,
  collections: new Map(),
  folders: [],
};
globalThis.ui = { notifications: { info: (m) => notices.push(m), warn: (m) => notices.push(m), error: (m) => notices.push(m) } };
globalThis.foundry = {
  utils: { escapeHTML: (x) => x },
  data: { operators: { ForcedDeletion } },
  applications: { api: { DialogV2: { wait: async (opts) => (asked.push(opts), dialogResult) } } },
};
const library = await import("../../scripts/lib/library.mjs");
const { tokenArtSources, applyTokenArt, restoreTokenArt, hasTokenArtFlag } = await import("../../scripts/importer/token-art.mjs");

// The library reads the world's actors through `game.actors`.
const readable = (library.libraryActors().length === actors.length);
ok("the library reads the invented world's monsters", readable, String(library.libraryActors().length));

const sources = await tokenArtSources();
ok("a source is found at runtime, with its title read from the package", sources.length === 1 && sources[0].id === PKG && sources[0].title === "ZZ Art Pack");
ok("this module's own packs and the system's are never a source", sources.every((s) => s.id !== MODULE_ID && s.id !== "acks"));
active = false;
ok("a package that is not active offers nothing", (await tokenArtSources()).length === 0);
active = true;

dialogResult = false;
const cancelled = await applyTokenArt(sources[0]);
ok("cancel writes nothing", cancelled === null && updates.length === 0 && sceneUpdates.length === 0);
ok("the confirm carries the counts and a placed-tokens tick", /name="placed"/.test(asked[0].content) && asked[0].rejectClose === false && asked[0].classes.includes("acks-extras-scroll"));

dialogResult = { placed: true };
const result = await applyTokenArt(sources[0]);
ok("apply counts what it wrote, what it left and what it refused", result.change === 2 && result.refused === 1 && result.kept === 1 && result.ambiguous === 1, JSON.stringify(result));
ok("the token and its mark are written, the portrait is not", actors[0].prototypeToken.texture.src === art("wump") && actors[0].img === BOOKART);
ok("the fit is contain and no size or scale is written", actors[0].prototypeToken.texture.fit === "contain" && updates.every(([, patch]) => Object.keys(patch).every((k) => !/scale|width|height/.test(k))));
ok("a wildcard sets the mark", actors[1].prototypeToken.randomImg === true && actors[1].prototypeToken.texture.src === art("zorn-*"));
ok("a Judge's own token is left", actors[2].prototypeToken.texture.src === "worlds/mine/zork.png" && !actors[2].flags[MODULE_ID].tokenArt);
ok("the flag records the source and the token that stood", actors[0].flags[MODULE_ID].tokenArt.was.src === BOOKART && actors[0].flags[MODULE_ID].tokenArt.src === art("wump"));
ok("the placed unlinked token moves and the linked one is left", sceneUpdates.length === 1 && sceneUpdates[0][1].length === 1 && sceneUpdates[0][1][0]._id === "tk1" && result.placed === 1, JSON.stringify(sceneUpdates));
ok("the flag is found so Restore is offered", hasTokenArtFlag() === true);

const rerun = await applyTokenArt(sources[0]);
ok("a second apply changes nothing it already wrote", rerun.change === 0 && rerun.current === 2, JSON.stringify(rerun));

const restored = await restoreTokenArt();
ok("restore puts the recorded token back and clears the flag", restored.restore === 2 && actors[0].prototypeToken.texture.src === BOOKART && !actors[0].flags[MODULE_ID].tokenArt, JSON.stringify(restored));
ok("restore of a wildcard returns the mark", actors[1].prototypeToken.randomImg === false);
ok("and none is left to restore", hasTokenArtFlag() === false);
active = false;
ok("restore needs no source package", (await restoreTokenArt()).restore === 0);
game.user.isGM = false;
ok("a seat that is not a GM does nothing", (await applyTokenArt(sources[0])) === null && (await restoreTokenArt()) === null);

delete globalThis.game;
delete globalThis.ui;
delete globalThis.foundry;
console.log(`test-token-art: ${pass} checks passed.`);
