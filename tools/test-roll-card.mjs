/**
 * The multi-roller chat card (scripts/lib/roll-card.mjs).
 *
 * The first half pins the markup every existing caller gets: the strings below
 * are what the renderer wrote before the optional fields existed, captured
 * under the same stand-ins, so a card that names none of the new fields must
 * still match them byte for byte. The second half pins the optional fields:
 * a row's assembled tooltip and action column, a section's and a note's
 * tooltip, and the footer of buttons. Every name and figure is invented.
 */
import assert from "node:assert/strict";

let passed = 0;
const ok = (name, fn) => {
  fn();
  passed++;
  console.log("ok   " + name);
};

// Core's `escapeHTML` (five characters) and a lang that answers its own key.
globalThis.foundry = {
  utils: {
    escapeHTML: (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"),
  },
};
globalThis.game = { i18n: { format: (k) => k, localize: (k) => k, has: () => true } };
const { renderRollCard } = await import("../scripts/lib/roll-card.mjs");

/** The inputs of the captured cards, in the order of `GOLDEN`. */
const CARDS = [
  { title: "Save <vs> Alpha", subtitle: "The Company", note: "A note", sections: [{ rows: [
    { name: "Ann & Bo", total: 14, target: 12, outcome: "Success", emphasis: "success", tooltip: "1d20 + 2" },
    { name: "Cy", total: 5, target: 12, targetSuffix: "-", targetTooltip: "from \"here\"", outcome: "Failure", emphasis: "failure", detail: "+1 thing" },
  ] }], footnote: "Dee could not roll" },
  { title: "Marks", sections: [{ title: "Group", rows: [{ name: "Eve", total: 3, emphasis: "neutral" }] }, { rows: [] }] },
  { title: "Empty", empty: "Nobody rolled", footnote: "fn", sections: [] },
  { title: "Nothing", sections: [] },
  { title: "Labelled", labels: { name: "Who", total: "Roll", target: "Needs", result: "Verdict" }, sections: [{ rows: [{ name: "Fay", total: 9, target: 8, outcome: "Pass", emphasis: "success" }] }] },
];

const GOLDEN = [
  "<div class=\"acks-extras-roll-card acks-chat\"><header class=\"acks-chat-header\"><h3 class=\"acks-chat-title\">Save &lt;vs&gt; Alpha</h3><span class=\"acks-chat-subtitle\">The Company</span></header><div class=\"acks-chat-body\"><p class=\"acks-extras-roll-note\">A note</p><table class=\"acks-table\"><thead><tr><th>ACKS-LIB.rollCard.colName</th><th class=\"acks-nums\">ACKS-LIB.rollCard.colTotal</th><th class=\"acks-nums\">ACKS-LIB.rollCard.colTarget</th><th>ACKS-LIB.rollCard.colResult</th></tr></thead><tbody><tr class=\"is-success\"><td>Ann &amp; Bo</td><td class=\"acks-nums\" data-tooltip=\"1d20 + 2\">14</td><td class=\"acks-nums\">12+</td><td><strong>Success</strong></td></tr><tr class=\"is-failure\"><td>Cy<span class=\"acks-extras-roll-detail\">+1 thing</span></td><td class=\"acks-nums\">5</td><td class=\"acks-nums\" data-tooltip-text=\"from &quot;here&quot;\">12-</td><td>Failure</td></tr></tbody></table><p class=\"acks-extras-roll-footnote\">Dee could not roll</p></div></div>",
  "<div class=\"acks-extras-roll-card acks-chat\"><header class=\"acks-chat-header\"><h3 class=\"acks-chat-title\">Marks</h3></header><div class=\"acks-chat-body\"><h4 class=\"acks-extras-roll-section acks-table-title\">Group</h4><table class=\"acks-table\"><thead><tr><th>ACKS-LIB.rollCard.colName</th><th class=\"acks-nums\">ACKS-LIB.rollCard.colTotal</th></tr></thead><tbody><tr class=\"is-neutral\"><td>Eve</td><td class=\"acks-nums\">3</td></tr></tbody></table></div></div>",
  "<div class=\"acks-extras-roll-card acks-chat\"><header class=\"acks-chat-header\"><h3 class=\"acks-chat-title\">Empty</h3></header><div class=\"acks-chat-body\"><p class=\"acks-extras-roll-note\">Nobody rolled</p><p class=\"acks-extras-roll-footnote\">fn</p></div></div>",
  "",
  "<div class=\"acks-extras-roll-card acks-chat\"><header class=\"acks-chat-header\"><h3 class=\"acks-chat-title\">Labelled</h3></header><div class=\"acks-chat-body\"><table class=\"acks-table\"><thead><tr><th>Who</th><th class=\"acks-nums\">Roll</th><th class=\"acks-nums\">Needs</th><th>Verdict</th></tr></thead><tbody><tr class=\"is-success\"><td>Fay</td><td class=\"acks-nums\">9</td><td class=\"acks-nums\">8+</td><td><strong>Pass</strong></td></tr></tbody></table></div></div>",
];

ok("a card that names none of the optional fields is byte-identical to what it was", () => {
  assert.equal(CARDS.length, GOLDEN.length);
  CARDS.forEach((card, i) => assert.equal(renderRollCard(card), GOLDEN[i], `card ${i}`));
});

ok("the optional fields given as empty change nothing either", () => {
  const plain = { title: "T", note: "N", sections: [{ title: "S", rows: [{ name: "A", total: 1, outcome: "ok", emphasis: "success" }] }], footnote: "F" };
  const empty = {
    ...plain,
    noteTooltip: "",
    buttons: [],
    sections: [{ title: "S", titleTooltip: "", rows: [{ name: "A", total: 1, outcome: "ok", emphasis: "success", tooltipText: "", actions: [] }] }],
  };
  assert.equal(renderRollCard(empty), renderRollCard(plain));
});

ok("a row's assembled tooltip is written as text, takes the place of a lang-key tooltip and is escaped", () => {
  const html = renderRollCard({ title: "T", sections: [{ rows: [{ name: "A", total: 7, tooltipText: "2d4: 3 + 4 \"fire\"" }, { name: "B", total: 8, tooltip: "key.here", tooltipText: "wins" }, { name: "C", total: 9, tooltip: "key.only" }] }] });
  assert.ok(html.includes('<td class="acks-nums" data-tooltip-text="2d4: 3 + 4 &quot;fire&quot;">7</td>'));
  assert.ok(html.includes('<td class="acks-nums" data-tooltip-text="wins">8</td>'));
  assert.ok(!html.includes('data-tooltip="key.here"'), "the assembled text replaces the key");
  assert.ok(html.includes('<td class="acks-nums" data-tooltip="key.only">9</td>'), "a row with only the key keeps it");
});

ok("a section's title and the note carry their tooltip as text", () => {
  const html = renderRollCard({ title: "T", note: "N", noteTooltip: "where <it> came from", sections: [{ title: "S", titleTooltip: "the die & its parts", rows: [{ name: "A", total: 1 }] }] });
  assert.ok(html.includes('<h4 class="acks-extras-roll-section acks-table-title" data-tooltip-text="the die &amp; its parts">S</h4>'));
  assert.ok(html.includes('<p class="acks-extras-roll-note" data-tooltip-text="where &lt;it&gt; came from">N</p>'));
});

ok("an action column appears only where some row has an action, and a row without one leaves its cell empty", () => {
  const withActions = renderRollCard({
    title: "T",
    sections: [{ rows: [
      { name: "A", total: 1, actions: [{ action: "throwIt", label: "Throw", icon: "fa-solid fa-dice-d20", data: { tKey: "t1", rowKey: "scorch" }, tooltip: "rolls <it>" }] },
      { name: "B", total: 2 },
    ] }],
  });
  assert.ok(withActions.includes("<th>ACKS-LIB.rollCard.colActions</th>"), "the column is headed");
  assert.ok(withActions.includes('<td><button type="button" class="acks-extras-roll-action" data-action="throwIt" data-t-key="t1" data-row-key="scorch" data-tooltip-text="rolls &lt;it&gt;"><i class="fa-solid fa-dice-d20" inert></i><span>Throw</span></button></td>'));
  assert.ok(withActions.includes("<td></td></tr>"), "the second row's cell is empty");
  const without = renderRollCard({ title: "T", sections: [{ rows: [{ name: "A", total: 1, actions: [] }, { name: "B", total: 2 }] }] });
  assert.ok(!without.includes("colActions") && !without.includes("<button"), "no row has one, so no column");
  const named = renderRollCard({ title: "T", labels: { actions: "Do" }, sections: [{ rows: [{ name: "A", total: 1, actions: [{ action: "x", label: "X" }] }] }] });
  assert.ok(named.includes("<th>Do</th>"), "the heading can be named");
});

ok("an action and a button escape every written value, and a disabled one says so", () => {
  const html = renderRollCard({
    title: "T",
    sections: [{ rows: [{ name: "A", total: 1, actions: [{ action: 'a"b', label: "<b>", data: { uuid: 'Actor."x"' }, disabled: true }] }] }],
    buttons: [{ action: "undo", label: "Undo & redo" }],
  });
  assert.ok(html.includes('data-action="a&quot;b"'));
  assert.ok(html.includes("<span>&lt;b&gt;</span>"));
  assert.ok(html.includes('data-uuid="Actor.&quot;x&quot;"'));
  assert.ok(html.includes(" disabled>"));
  assert.ok(html.includes("<span>Undo &amp; redo</span>"));
});

ok("the footer of buttons follows the tables and the footnote, and is never the system's card-buttons group", () => {
  const html = renderRollCard({
    title: "T",
    sections: [{ rows: [{ name: "A", total: 1 }] }],
    footnote: "F",
    buttons: [{ action: "undoCast", label: "Undo", icon: "fa-solid fa-rotate-left" }, { action: "again", label: "Again", tooltip: "once more" }],
  });
  assert.ok(html.endsWith('</p><footer class="acks-extras-roll-actions"><button type="button" class="acks-extras-roll-action" data-action="undoCast"><i class="fa-solid fa-rotate-left" inert></i><span>Undo</span></button><button type="button" class="acks-extras-roll-action" data-action="again" data-tooltip-text="once more"><span>Again</span></button></footer></div></div>'));
  assert.ok(!html.includes("card-buttons"), "the system binds that class, and its handler is not ours");
  assert.ok(!html.includes('data-action="applyDamage"'));
  const noFoot = renderRollCard({ title: "T", sections: [{ rows: [{ name: "A", total: 1 }] }] });
  assert.ok(!noFoot.includes("<footer"));
});

ok("a card with no rows still posts its banner, line and buttons when it has an empty line", () => {
  const html = renderRollCard({ title: "T", empty: "Nothing to show", buttons: [{ action: "x", label: "X" }] });
  assert.ok(html.includes('<p class="acks-extras-roll-note">Nothing to show</p>'));
  assert.ok(html.includes("<footer"));
  assert.equal(renderRollCard({ title: "T", buttons: [{ action: "x", label: "X" }] }), "", "and none at all without it");
});

ok("a bare card with no rows renders its banner, note and footnote, and the default stays \"\"", () => {
  const card = { title: "T", note: "N", footnote: "Line one · Line two", sections: [] };
  const html = renderRollCard({ ...card, bare: true });
  assert.ok(html.includes('<h3 class="acks-chat-title">T</h3>') && html.includes(">N</p>"));
  assert.ok(html.includes('<p class="acks-extras-roll-footnote">Line one · Line two</p>'));
  assert.ok(!html.includes("<table"), "no table and no empty line");
  assert.equal(renderRollCard(card), "", "without the flag the card is not posted");
  assert.equal(renderRollCard({ ...card, bare: false }), "");
});

ok("a target word opens the Target column, prints escaped with no suffix, and carries the row's tooltip", () => {
  const html = renderRollCard({
    title: "T",
    sections: [{ rows: [{ name: "A", total: 5, targetText: "Au<to>", targetTooltip: "why & how" }, { name: "B", total: 9, target: 14, targetTooltip: "the figure" }] }],
  });
  assert.ok(html.includes("rollCard.colTarget"));
  assert.ok(html.includes('<td class="acks-nums" data-tooltip-text="why &amp; how">Au&lt;to&gt;</td>'));
  assert.ok(html.includes('<td class="acks-nums" data-tooltip-text="the figure">14+</td>'), "a numeric target renders as before");
});

ok("a target word alone opens the column, and a number wins over a word on the same row", () => {
  const alone = renderRollCard({ title: "T", sections: [{ rows: [{ name: "A", total: 1, targetText: "None" }] }] });
  assert.ok(alone.includes("colTarget") && alone.includes('<td class="acks-nums">None</td>'));
  const both = renderRollCard({ title: "T", sections: [{ rows: [{ name: "A", total: 1, target: 8, targetSuffix: "-", targetText: "None", targetTooltip: "t" }] }] });
  assert.ok(both.includes('data-tooltip-text="t">8-</td>') && !both.includes("None"));
  const neither = renderRollCard({ title: "T", sections: [{ rows: [{ name: "A", total: 1, targetTooltip: "t" }] }] });
  assert.ok(!neither.includes("colTarget") && !neither.includes('data-tooltip-text="t"'));
});

console.log(`\n${passed} passed`);
