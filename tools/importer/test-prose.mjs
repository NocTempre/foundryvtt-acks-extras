/**
 * The shape imported book text takes, and the ownership test built on it.
 *
 * Three things are pinned here because each fails invisibly. Escaping: a page
 * that prints an angle bracket must not put a tag in a description field.
 * Attribution: the page reference closes the block, so it travels with the
 * words rather than living in a field beside them. And the stamp: it is the
 * ONLY thing telling a re-import "this is my writing, not the Judge's", and
 * getting that wrong means either clobbering someone's notes or never
 * repairing anything again. The live world cannot gate the third — proving it
 * there means running the update pass over every ability a world holds.
 */
import { bookText, entryText, nodeParagraphs, nodeText, stripBookText, escapeText } from "../../scripts/importer/prose.mjs";

let failed = 0;
const ok = (name, cond, detail = "") => {
  if (!cond) { console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); failed++; }
};
const eq = (name, got, want) => ok(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const node = {
  fields: {
    description: [
      { text: "A griffon is <fierce> & swift.", section: "appearance" },
      { text: "It strikes twice.", section: "combat" },
      { text: "It nests high.", section: "combat" },
    ],
  },
};

/* --- the block --- */
const full = entryText(node, "mm.griffon", "MM p.171");
ok("every paragraph lands", (full.match(/<p>/g) ?? []).length === 3);
ok("in printed order", full.indexOf("griffon") < full.indexOf("strikes") && full.indexOf("strikes") < full.indexOf("nests"));
ok("markup characters are escaped, never parsed", full.includes("&lt;fierce&gt; &amp; swift"));
ok("no raw angle bracket survives from the page", !/<fierce>/.test(full));
ok("the page reference closes the block", /<p class="acks-extras-importer-cite">MM p\.171<\/p><\/div>$/.test(full));
ok("exactly one page reference", (full.match(/acks-extras-importer-cite/g) ?? []).length === 1);
ok("the block is stamped with its entry", full.includes('data-acks-entry="mm.griffon"'));

/* --- sections --- */
const combat = entryText(node, "mm.griffon", "MM p.171", { section: "combat" });
ok("a section keeps only its own paragraphs", (combat.match(/<p>/g) ?? []).length === 2 && !combat.includes("griffon is"));
eq("unsectioned paragraphs count as appearance", nodeParagraphs({ fields: { description: [{ text: "x" }] } }, "appearance").length, 1);
eq("a node with no description yields nothing", nodeParagraphs(null).length, 0);
eq("plain text joins a section for inline use", nodeText(node, "combat"), "It strikes twice. It nests high.");

/* --- degenerate inputs --- */
ok("a page that yielded no prose still says where it was read", /cite">RR p\.128</.test(bookText([], "RR p.128", { id: "def.weapon.staff" })));
eq("nothing to say and nowhere to cite is empty, not an empty block", bookText([], ""), "");
ok("blank paragraphs are dropped, not rendered", !/<p><\/p>/.test(bookText(["", "  ", "real"], "c")));
ok("an id with a quote cannot break out of the attribute", !/data-acks-entry="[^"]*"[^>]*"/.test(bookText([], "c", { id: 'a"b' })));
eq("escapeText leaves ordinary text alone", escapeText("plain text"), "plain text");

/* --- the ownership test --- */
eq("a generated block is not the Judge's writing", stripBookText(full).trim(), "");
eq("nor is the legacy tag it replaced", stripBookText("<p>@PdfText[mm.ghoul]{MM p.112}</p>").trim(), "");
eq("nor a bare legacy tag inside other markup", stripBookText("<p>@PdfText[def.x]</p>").trim(), "");
ok("but a Judge's own paragraph survives the strip", stripBookText(`${full}<p>My table's ghouls are worse.</p>`).includes("ghouls are worse"));
ok("and so does writing that precedes the block", stripBookText(`<p>Note.</p>${full}`).includes("Note."));
ok("two generated blocks both strip", stripBookText(full + entryText(node, "x", "c")).trim() === "");

if (failed) { console.error(`\ntest-prose: ${failed} failure(s)`); process.exit(1); }
console.log("test-prose: all checks passed");
