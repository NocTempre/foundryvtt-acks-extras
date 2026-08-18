/**
 * Dry-run a generated sweep.run.mjs with stubbed agents.
 * Validates the whole script body — plan wiring, pipeline shape, dedup,
 * coverage computation, summary, return value — without spending real agents.
 */
import fs from "node:fs";

const target = process.argv[2];
let src = fs.readFileSync(target, "utf8").replace(/^export const meta =/m, "const meta =");

const logs = [];
const phases = [];
const agentCalls = [];

/** Fabricate a response matching whatever schema the call asked for. */
function fakeFor(prompt, opts) {
  const s = opts?.schema;
  const label = opts?.label ?? "?";
  if (!s) return `# stubbed narrative for ${label}`;
  const p = s.properties ?? {};
  if (p.findings) {
    // Two findings per finder, one of which duplicates across clusters to
    // exercise dedup.
    return {
      findings: [
        { repo: "foundryvtt-acks-extras", file: "scripts/lib/util.mjs", line: "10", category: "silent-failure", severity: "High", summary: "s", failure_scenario: "f", recommended_fix: "r" },
        { repo: "foundryvtt-acks-extras", file: `scripts/${label}.mjs`, line: "20", category: "dead-code", severity: "Low", summary: "s", failure_scenario: "f", recommended_fix: "r" },
      ],
    };
  }
  if (p.verified) {
    return {
      verified: [
        { repo: "foundryvtt-acks-extras", file: "scripts/lib/util.mjs", line: "10", category: "silent-failure", severity: "High", summary: "s", failure_scenario: "f", recommended_fix: "r", verdict: "confirmed" },
        { repo: "foundryvtt-acks-extras", file: `scripts/${label}.mjs`, line: "20", category: "dead-code", severity: "Low", summary: "s", failure_scenario: "f", recommended_fix: "r", verdict: "rejected", verify_note: "false positive" },
      ],
      added: [],
    };
  }
  if (p.rows) {
    // Echo the findings the prompt carried, so the length check passes the way
    // a real normalizer would.
    const m = prompt.match(/FINDINGS \(JSON\):\n(\[[\s\S]*?\n\])\n\nReturn EXACTLY/);
    if (m) {
      try {
        return { rows: JSON.parse(m[1]) };
      } catch { /* fall through */ }
    }
    return { rows: [] };
  }
  if (p.domains) {
    return { domains: [{ domain: "damage-types", canonicalTerms: ["Acidic", "Bludgeoning"], citation: "RR ch.6", notes: "physical/energy" }] };
  }
  if (p.confirmedAvoided) {
    return { narrative: "core narrative", confirmedAvoided: ["pattern 1 checked"], recurringFindings: [] };
  }
  if (p.narrative) {
    return { narrative: "narrative", additionalFindings: [] };
  }
  return {};
}

const agent = async (prompt, opts) => {
  agentCalls.push({ label: opts?.label, phase: opts?.phase, effort: opts?.effort, promptChars: prompt.length });
  return fakeFor(prompt, opts);
};
const parallel = async (thunks) => Promise.all(thunks.map((t) => t().catch(() => null)));
const pipeline = async (items, ...stages) =>
  Promise.all(
    items.map(async (item, i) => {
      let acc = item;
      for (const stage of stages) acc = await stage(acc, item, i);
      return acc;
    })
  );
const phase = (t) => phases.push(t);
const log = (m) => logs.push(m);
const budget = { total: null, spent: () => 0, remaining: () => Infinity };

const body = new Function(
  "args", "agent", "parallel", "pipeline", "phase", "log", "budget", "workflow",
  `return (async () => { ${src} })()`
);

const result = await body(undefined, agent, parallel, pipeline, phase, log, budget, undefined);

console.log("=== ran with NO args (baked plan only) ===");
console.log("agent calls:", agentCalls.length);
const byPhase = {};
for (const c of agentCalls) byPhase[c.phase ?? "?"] = (byPhase[c.phase ?? "?"] || 0) + 1;
console.log("  by phase:", JSON.stringify(byPhase));
console.log("phases declared:", phases.join(" -> "));
console.log("prompt size: min", Math.min(...agentCalls.map((c) => c.promptChars)), "max", Math.max(...agentCalls.map((c) => c.promptChars)));
console.log("");
console.log("=== return value ===");
console.log("keys:", Object.keys(result).join(", "));
console.log("mode:", result.mode, "| lens:", result.lens);
console.log("rows:", result.rows.length, "(dedup should collapse the repeated util.mjs:10 hit to 1)");
console.log("  categories present:", [...new Set(result.rows.map((r) => r.category))].join(", "));
console.log("summary.total:", result.summary.total, "| bySeverity:", JSON.stringify(result.summary.bySeverity));
console.log("coverage rows:", result.coverage.length);
console.log("  checked:", result.coverage.filter((c) => c.checked).length,
            "| clean:", result.coverage.filter((c) => c.checked && c.clean).length,
            "| NOT checked:", result.coverage.filter((c) => c.checked === false).length);
console.log("checkedCategories:", result.checkedCategories.length, "| skippedCategories:", result.skippedCategories.length);
console.log("triageMarkdown chars:", result.triageMarkdown.length);
console.log("clusterStatus entries:", result.clusterStatus.length,
            "| all ok:", result.clusterStatus.every((s) => s.ok));
console.log("auditDir:", result.auditDir);
console.log("");
console.log("=== log lines ===");
for (const l of logs) console.log("  " + l);

// Invariants that must hold or the real run would write a bad audit.
const bad = [];
if (result.coverage.some((c) => c.checked === false && c.clean === true)) bad.push("a NOT-checked category is marked clean");
if (result.checkedCategories.length + result.skippedCategories.length !== 36) bad.push("checked+skipped != 36");
if (result.rows.some((r) => !result.checkedCategories.includes(r.category))) bad.push("a row uses a category outside the lens");
if (result.summary.total !== result.rows.length) bad.push("summary.total disagrees with rows.length");
console.log("");
console.log(bad.length ? "INVARIANT FAILURES:\n  " + bad.join("\n  ") : "all invariants hold");
