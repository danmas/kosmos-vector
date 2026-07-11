# Design: add-ontology-builder-settings (+ follow-ups)

## Context

Step 6 Ontology Builder existed; operators needed editable prompts/model, BYO LLM path,
rebuild-from-scratch, and fail-fast LLM behavior under **«Без ИИ жизни нет!»**.

## Goals

- All LLM texts for builder live in `config.json` → `ontology_builder` (Settings UI).
- Factory defaults only seed empty config / “reset factory”, not a second silent runtime source.
- External chat can replace built-in suggest without changing materialize/apply.
- Clear ontology (DB + MD) for a context without wiping code reality.
- Domain-first suggest (seedMode, anchors, anti-fragment) to improve overview quality.

## Key decisions

| Topic | Decision |
|-------|----------|
| Storage | App config nested object (not prompts-config history) |
| Seed | Default `user-only`; list existing as “may reuse”, not full avoid dump |
| BYO | export-prompt + import same finalize pipeline as suggest |
| Clear | POST /ontology/clear with confirm; optional dryRun |
| LLM fail | 503/502 user-facing; no heuristic success for suggest |
| JSON | salvage + retry using settings retry prompts |

## Non-goals

- Per-context ontology_builder in kb-config
- Full ontology graph UI (use Graph / validate / ask)
- Prompt version history table

## Rollout

Implemented on `dev`. Archive this change after tasks checklist complete.
