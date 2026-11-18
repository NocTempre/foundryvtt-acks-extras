/**
 * Pure-logic tests for what the pot's cards wear (Foundry-free): the art tier of
 * a picture, the art seam's lookup and fallback, and the frame, corners, foil and
 * grime chosen by band, look and status. Every path and name here is this file's
 * own invention.
 */
import assert from "node:assert/strict";
import { POOL } from "../scripts/treasure/constants.mjs";
import {
  ART_TIER, TEXTURE, artTier, backArt, backDress, faceArt, faceDress, isCoreDefault, noArt, setArtReader, textureArt,
} from "../scripts/treasure/card-art.mjs";

let checks = 0;
const ok = (cond, msg) => {
  assert.ok(cond, msg);
  checks++;
};
const eq = (a, b, msg) => {
  assert.deepEqual(a, b, msg);
  checks++;
};

/* --- the tier of a picture --- */
{
  eq(artTier("acks-extras-art/page-3.webp"), ART_TIER.full, "a raster under the world art directory is full art");
  eq(artTier("worlds/w/acks-extras-art/page-3.png"), ART_TIER.full, "wherever that directory sits in the path");
  eq(artTier("/acks-extras-art/x.jpg?v=2"), ART_TIER.full, "a query string is not part of the path");
  eq(artTier("worlds/w/token.webp"), ART_TIER.slot, "any other raster is the framed slot");
  eq(artTier("icons/commodities/gem.webp"), ART_TIER.slot, "a core raster icon takes the slot too");
  eq(artTier("icons/svg/coins.svg"), ART_TIER.lozenge, "an svg icon is the lozenge");
  eq(artTier("acks-extras-art/mark.svg"), ART_TIER.lozenge, "an svg is the lozenge even in the art directory");
  eq(artTier("worlds/w/readme.txt"), ART_TIER.lozenge, "a file that is no raster is the lozenge");
  eq(artTier(""), ART_TIER.lozenge, "no path is the lozenge");
  eq(artTier(null), ART_TIER.lozenge);
  eq(artTier(undefined), ART_TIER.lozenge);
  eq(artTier(42), ART_TIER.lozenge, "a value that is no path is the lozenge");
  eq(artTier("worlds/w/acks-extras-art-old/x.png"), ART_TIER.slot, "the directory is a whole segment");
  ok(isCoreDefault("icons/svg/aura.svg") && isCoreDefault("/icons/x.webp") && isCoreDefault("icons/x.webp?a=1"), "a path under icons/ is core's");
  ok(!isCoreDefault("worlds/icons/x.webp") && !isCoreDefault("acks-extras-art/x.png"), "any other path is not");
}

/* --- the art seam: the reader, its fallback, and what it is asked --- */
{
  eq(backArt({ backKey: POOL.coins, band: 1 }), { src: null, tier: ART_TIER.lozenge, full: false, slot: false }, "with the stub wired a back has no art");
  eq(faceArt({ poolKey: POOL.item, band: 0, kind: "weapon", artSrc: "" }), { src: null, tier: ART_TIER.lozenge, full: false, slot: false }, "and a face with no picture of its own has none");
  ok(noArt() === null, "the stub finds nothing");

  const asked = [];
  const reader = (request) => (asked.push(request), request.side === "back" ? "acks-extras-art/back-" + request.pool + ".webp" : "worlds/w/face-" + request.pool + ".png");
  const b = backArt({ backKey: POOL.gems, band: 2, kind: "weapon", artSrc: "worlds/w/own.png", auraBack: true }, reader);
  eq(asked, [{ side: "back", pool: POOL.gems, band: 2 }], "a back asks for the pool and band only, whatever else it is handed");
  eq(b, { src: "acks-extras-art/back-gems.webp", tier: ART_TIER.full, full: true, slot: false }, "the reader's picture is the back's, tiered");
  asked.length = 0;
  const f = faceArt({ poolKey: POOL.item, band: 3, kind: "weapon", artSrc: "worlds/w/own.webp" }, reader);
  eq(asked, [{ side: "face", pool: POOL.item, band: 3, kind: "weapon" }], "a face asks for the pool, band and kind");
  eq(f.src, "worlds/w/face-item.png", "the reader's picture wins over the item's own");
  eq(f.tier, ART_TIER.slot);
  asked.length = 0;
  faceArt({ poolKey: POOL.item, band: 1, artSrc: "" }, reader);
  eq(asked[0].kind, null, "a face with no kind asks with a null one");
  eq(backArt({ backKey: POOL.item, band: 99 }, (r) => (asked.push(r), null)) && asked.at(-1).band, 3, "the band is clamped before it is asked");

  eq(faceArt({ poolKey: POOL.item, band: 0, kind: null, artSrc: "worlds/w/own.webp" }), { src: "worlds/w/own.webp", tier: ART_TIER.slot, full: false, slot: true }, "with nothing found the item's own raster is the framed slot");
  eq(faceArt({ poolKey: POOL.item, band: 0, kind: null, artSrc: "acks-extras-art/own.webp" }).full, true, "an uploaded picture of its own is full art");
  eq(faceArt({ poolKey: POOL.item, band: 0, kind: null, artSrc: "icons/svg/item-bag.svg" }).src, null, "a core default is never the picture");
  eq(faceArt({ poolKey: POOL.item, band: 0, kind: null, artSrc: "icons/containers/bags/sack-leather-tan.webp" }).src, null, "nor is a core raster the importer falls back to");
  eq(faceArt({ poolKey: POOL.item, band: 0, kind: null, artSrc: "worlds/w/own.svg" }).slot, false, "an svg of its own is the lozenge");
  eq(faceArt({ poolKey: POOL.item, band: 0, kind: null, artSrc: "worlds/w/own.webp" }, () => "icons/svg/coins.svg").src, null, "a reader that answers an svg gives the lozenge, not the item's picture");

  eq(backArt({ backKey: POOL.item, band: 0 }, () => { throw new Error("no library"); }).src, null, "a reader that throws finds nothing");
  eq(faceArt({ poolKey: POOL.item, band: 0, kind: null, artSrc: "worlds/w/own.webp" }, () => { throw new Error("no library"); }).src, "worlds/w/own.webp", "and a face falls back to its own picture");
  eq(backArt({ backKey: POOL.item, band: 0 }, () => 7).src, null, "a reader that answers a non-path finds nothing");

  setArtReader(() => "acks-extras-art/wired.webp");
  eq(backArt({ backKey: POOL.item, band: 0 }).src, "acks-extras-art/wired.webp", "a wired reader is the default");
  eq(faceArt({ poolKey: POOL.item, band: 0, kind: null, artSrc: "" }).src, "acks-extras-art/wired.webp");
  setArtReader("nonsense");
  eq(backArt({ backKey: POOL.item, band: 0 }).src, null, "wiring something that is no function restores the stub");
}

/* --- a back's dressing, by band, aura and pool --- */
{
  const dress = (band, extra = {}) => backDress({ backKey: POOL.item, band, auraBack: false, ...extra });
  eq(dress(0).frame, "hair", "the lowest band is a hairline");
  eq(dress(1).frame, "double", "the next is the double rule");
  eq(dress(2).frame, "double");
  eq(dress(3).frame, "double");
  eq([0, 1, 2, 3].map((n) => dress(n).corners), [false, false, true, true], "lozenge corners from the third band");
  eq([0, 1, 2, 3].map((n) => dress(n).breaks), [false, false, false, true], "lozenge breaks at the last");
  eq([0, 1, 2, 3].map((n) => dress(n).foil), ["", "", "", "prism"], "foil on the top band only");
  eq([0, 1, 2, 3].map((n) => /acks-porphyry--rich/.test(dress(n).className)), [false, false, true, true], "the rich fleck from the third band");
  eq([0, 1, 2, 3].map((n) => dress(n).grime), [3, 2, 1, 0], "grime falls as the band rises");
  ok(dress(0).className.split(" ").includes("acks-porphyry"), "every back is porphyry");
  ok(dress(2).className.includes("is-frame-double"), "and names its frame");
  eq(dress(0, { auraBack: true }).frame, "gold", "an aura turns the rule gold, at any band");
  eq(dress(3, { auraBack: true }).frame, "gold");
  eq({ ...dress(2, { auraBack: true }), className: "", frame: "" }, { ...dress(2), className: "", frame: "" }, "and nothing else about the back changes");
  ok(backDress({ backKey: POOL.special, band: 1, auraBack: false }).notched, "a special pool's back is notched");
  ok(backDress({ backKey: POOL.special, band: 1, auraBack: false }).className.includes("is-notched"));
  ok(![POOL.coins, POOL.gems, POOL.jewelry, POOL.item, POOL.magic].some((backKey) => backDress({ backKey, band: 1, auraBack: false }).notched), "no other pool's is");
  eq(backDress({ backKey: POOL.item, band: 99, auraBack: false }).foil, "prism", "an out-of-range band is clamped");
  eq(backDress({ backKey: POOL.item, band: -4, auraBack: false }).frame, "hair");
  ok(!JSON.stringify(dress(2, { auraBack: true })).match(/magic|curs/i), "no dressing of a back names magic or a curse");
}

/* --- a face's dressing, by look, band and status --- */
{
  const dress = (look, band = 1, extra = {}) => faceDress({ look, band, poolKey: POOL.item, ...extra });
  eq(dress("plain").frame, "plain");
  eq(dress("magic").frame, "magic");
  eq(dress("cursed").frame, "cursed");
  eq(["plain", "magic", "cursed"].map((l) => dress(l).corners), ["", "filled", "hollow"], "known magic has filled corners and a curse hollow ones");
  eq(dress("cursed").vignette, true, "a curse wears the vignette");
  eq(dress("plain").vignette || dress("magic").vignette, false, "nothing else does");
  eq(dress("magic", 0).foil, "magic", "known magic is foil at any band");
  eq(dress("magic", 3).foil, "magic", "and the magic foil, not the prismatic, on the top band");
  eq(dress("plain", 3).foil, "prism", "a plain face of the top band is foil");
  eq(dress("plain", 2).foil, "", "a plain face below it is not");
  eq(dress("cursed", 3).foil, "", "a curse gets no foil, even on the top band");
  eq(dress("cursed", 0).foil, "");
  eq([0, 1, 2, 3].map((n) => dress("plain", n).aged), [true, true, false, false], "plain faces of the lower bands are aged stock");
  eq(dress("magic", 0).aged || dress("cursed", 0).aged, false, "magic and cursed faces are not");
  ok(dress("plain", 0).className.includes("acks-parchment--aged") && !dress("plain", 3).className.includes("acks-parchment--aged"), "the class follows");
  ok(dress("magic").className.split(" ").includes("acks-parchment"), "every face is parchment");
  ok(!("hatch" in dress("plain", 1)), "no face is hatched: a removed card is dashed and greyed, and no pattern is drawn");
  eq(faceDress({ look: "plain", band: 1, poolKey: POOL.special }).notched, true, "a special pool's face is notched");
  ok(faceDress({ look: "plain", band: 1, poolKey: POOL.special }).className.includes("is-notched"));
  eq(faceDress({ look: "plain", band: 1, poolKey: POOL.item }).notched, false);
  eq(faceDress({ look: "bogus", band: 1, poolKey: POOL.item }).frame, "plain", "an unknown look is plain");
  eq(faceDress({ look: "plain", band: 77, poolKey: POOL.item }).foil, "prism", "the band is clamped");
}

/* --- textures: read from the seam, never drawn --- */
{
  eq(textureArt(TEXTURE.grime, 0), null, "with no reader wired a layer finds no texture, and is not rendered");
  const asked = [];
  const reader = (req) => {
    asked.push(req);
    return "worlds/w/acks-extras-art/tex/muck.webp";
  };
  eq(textureArt(TEXTURE.grime, 9, reader), 'url("worlds/w/acks-extras-art/tex/muck.webp")', "a found raster is a CSS url");
  eq(asked[0], { side: "texture", kind: "grime", band: 3 }, "the reader is asked side, kind and the clamped band");
  eq(textureArt(TEXTURE.foil, 3, () => "worlds/w/foil.svg"), null, "an svg is no texture");
  eq(textureArt(TEXTURE.foil, 3, () => { throw new Error("x"); }), null, "a reader that throws finds nothing");
  eq(textureArt(TEXTURE.vignette, 0, () => 'a/b c"d\\e.png'), 'url("a/b%20c%22d%5Ce.png")', "a quote, a backslash and white space cannot close the url");
  eq(textureArt(TEXTURE.vignette, 0, () => "a/My%20file.png"), 'url("a/My%20file.png")', "an already-encoded path is not encoded twice");
  eq(Object.values(TEXTURE).sort(), ["foil", "foil-magic", "grime", "vignette"], "the kinds a layer may ask for");
}

console.log(`test-treasure-art: ${checks} checks passed`);
