# Project: kosmos-vector (AIAN Vector)

## Purpose

RAG-платформа с двухуровневой Базой Знаний:

- **Нижний уровень (реальность):** код, SQL, документы → `ai_item`, чанки, L1-связи в
  PostgreSQL/pgvector. Наполняется pipeline-загрузчиками.
- **Верхний уровень (онтология):** понятия домена (`concept:*`) с типизированными
  отношениями (`onto_*`) и **grounding** — привязкой к реальным `ai_item`. Источник
  истины — MD-файлы в git; PostgreSQL — индекс.

Принцип: **сначала реальность, потом онтология** (grounding не к чему привязывать,
пока нет `ai_item`).

## Repos

| Repo | Роль | Путь |
|------|------|------|
| `kosmos-vector` | Backend (Bun/Express), pipeline, онтология, REST API | этот репозиторий |
| `kosmos-vector-UI` | Web UI (React/TS) | `../kosmos-vector-UI` |
| `Ontology` | Спецификация формата понятий, пилотные `concepts/*.md` | `../Ontology` |

## Pipeline steps (текущие)

Определения: `packages/core/pipelineConfigService.js` → `getDefaultStepDefinitions()`.

| id | name | label | реализован runner? |
|----|------|-------|--------------------|
| 1 | parsing | Polyglot Parsing (L0) | да (`step1Runner.js`) — включает `onto_loading` |
| 2 | dependencies | Dependencies Extraction (L1) | да (`step2Runner.js`) |
| 3 | enrichment | Enrichment (L2) | нет (определение есть, runner нет) |
| 4 | vectorization | Vectorization | да (`step4Vectorize.js`) |
| 5 | indexing | Indexing | нет |

## Key conventions

- Изменил поведение → обнови `KB/README_*.md` и строку в `KB/README_INDEX.md`.
- Затронул grounded-сущность → проверь `../Ontology/concepts/*.md`, затем Step1
  (onto_loading) + повторная векторизация понятий (Step4 по `concept:*`).
- Крупная возможность → `CHANGELOG.md` + строка в корневом `README.md`.

## OpenSpec

Спецификации изменений живут в `openspec/changes/<id>/`. Активные изменения ещё не
влиты в `openspec/specs/` (baseline).
