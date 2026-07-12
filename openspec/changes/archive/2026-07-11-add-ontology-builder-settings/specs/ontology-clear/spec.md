# Spec delta: ontology-clear

## ADDED Requirements

### Requirement: Clear ontology for a context

Система MUST предоставить `POST /api/ontology/clear?context-code=:` для сброса
онтологии контекста **без** удаления non-concept reality (functions, tables, classes…).

Body: `{ "confirm": true, "deleteDb"?: true, "deleteFiles"?: true, "dryRun"?: false }`.

#### Scenario: Confirm required

- **WHEN** `confirm` не true
- **THEN** 400 `CONFIRM_REQUIRED`, ничего не удаляется

#### Scenario: Full clear

- **WHEN** confirm=true, deleteDb=true, deleteFiles=true
- **THEN** удаляются ai_item type=concept, связанные chunk_vector, links onto_% /
  concept:*, MD concept-файлы в onto_loading.dirs; отчёт со счётчиками

#### Scenario: Dry run

- **WHEN** dryRun=true
- **THEN** отчёт с counts без фактического DELETE/unlink

### Requirement: UI clear control

Ontology Builder UI MUST offer «Очистить онтологию…» with confirmation, call the clear
API, and reset the local suggest draft.

#### Scenario: User confirms clear from Builder

- **WHEN** the user confirms clear ontology in Ontology Builder
- **THEN** the UI calls `POST /api/ontology/clear` with `confirm: true` and clears the
  local suggest draft on success
