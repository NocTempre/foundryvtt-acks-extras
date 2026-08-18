# Delegating to self-hosted workers (canonical)

The family offloads low-complexity, long-duration work to local hardware in
three tiers. The Anthropic-powered session stays the orchestrator; nothing
local ever becomes an autonomous author of record.

## Tier A — scripts, not models

Most recurring work is deterministic: the nightly family run
(`acks-module-template/bin/nightly.mjs` — build, validate, ip-scan, drift
check across every repo) needs no model at all. Before designing an LLM
worker for a task, ask whether it is actually a cron job. Scheduling is
machine-specific and lives in `TEST_ENVIRONMENT.md`.

## Tier B — single-shot local inference

A local model (Ollama on the LAN; configured user-scope, never committed —
connection recipe in `TEST_ENVIRONMENT.md`) may be handed **single-shot,
verifiable** jobs: classify a log line, summarize a diff, draft a changelog
bullet, transform data against a schema with examples. Prompt in, JSON or
prose out, checked by the orchestrator or by a diff before use.

## Tier C — never

- **No agentic loops on small local models.** Sub-30B models in multi-step
  tool loops fail in the worst way available: malformed tool calls, silent
  empty-payload "successes" built upon, and retry-until-token-exhaustion.
- **No local writes to shared state.** A local worker never pushes to
  `main`, never touches the live test world, never edits `packs/_source`.
  It produces **patches, reports and issues** for a session to review;
  labels: `nightly-failure` (Tier A), `local-triage` (Tier B verdicts) —
  both are `acks-bug-triage` intake surfaces.
- **No judgment calls against doctrine.** The IP structure-vs-content line,
  release scoping, and anything touching licensed text stay with the
  orchestrator; a wrong local call there ships book content.
- **No unbounded runs.** Any unattended worker carries an iteration cap, a
  wall-clock timeout, and tool-call deduplication.

## Hardware realism (so plans stay honest)

An 8GB Jetson-class box is a single-shot classify/summarize/embed appliance —
it does not run coding agents. Real bounded-edit work wants a 24GB-class GPU
running a ~30B coding MoE; below that, Tier B only.
