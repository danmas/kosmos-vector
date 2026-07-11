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

После успешного suggest `OntologyBuilderDialog` SHOULD показать использованную
модель/источник и указать, что промпт/модель настраиваются в System Settings →
Ontology Builder.

#### Scenario: Banner after suggest

- **WHEN** suggest завершился успешно
- **THEN** баннер содержит model (или default) и упоминание Settings → Ontology Builder
