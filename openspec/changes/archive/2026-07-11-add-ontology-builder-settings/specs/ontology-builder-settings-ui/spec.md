# Spec delta: ontology-builder-settings-ui

## ADDED Requirements

### Requirement: Ontology Builder tab in System Settings

UI (`../kosmos-vector-UI`) MUST предоставить вкладку **Ontology Builder** в
`SettingsDialog` (рядом с App Config / Prompts Config / Item Types), реализованную
компонентом `OntologyBuilderConfigTab`.

#### Scenario: Edit and save builder settings

- **WHEN** пользователь меняет model, maxConcepts, depth, temperature, prompts,
  exclude patterns или enableDescriptionPass и нажимает Save
- **THEN** UI вызывает `PATCH /api/config` с телом `{ ontology_builder: { ... } }`
  и при успехе сбрасывает флаг unsaved changes

#### Scenario: Load current section from app config

- **WHEN** открыта вкладка Ontology Builder
- **THEN** форма заполняется из `config.ontology_builder` (после GET /api/config),
  placeholder model показывает глобальный `KOSMOS_MODEL`

### Requirement: Types for ontology_builder

`types.ts` MUST описывать `OntologyBuilderConfig` и включать опциональное поле
`ontology_builder` в `AppConfig` / `AppConfigUpdateRequest`.

#### Scenario: Typed save payload

- **WHEN** вкладка сохраняет настройки
- **THEN** payload типизирован как `Partial<AppConfig>` с `ontology_builder`,
  без `any` в публичной сигнатуре save

### Requirement: Builder dialog references Settings

After a successful suggest, `OntologyBuilderDialog` MUST show the used model/source and
MUST indicate that prompts/model are configured in System Settings → Ontology Builder
(or equivalent).

#### Scenario: Banner after suggest

- **WHEN** suggest completes successfully
- **THEN** the banner contains the model (or default) and a reference to Settings →
  Ontology Builder

### Requirement: Numbered action groups and BYO / clear

Ontology Builder UI MUST group actions as (1) draft via built-in or external LLM,
(2) materialize MD, (3) apply; MUST provide BYO export/import controls; MUST provide
clear-ontology control.

#### Scenario: Step 1 has both suggest channels

- **WHEN** the user opens Ontology Builder action strip
- **THEN** built-in suggest and external LLM appear under step 1, materialize under 2,
  apply under 3
