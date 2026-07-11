# app-config Specification

## Purpose
TBD - created by archiving change add-ontology-builder-settings. Update Purpose after archive.
## Requirements
### Requirement: Ontology Builder section in application config

Система MUST хранить настройки Ontology Builder в глобальной конфигурации приложения
(`config.json`) под ключом `ontology_builder` и отдавать/принимать их через существующие
эндпоинты `GET /api/config` и `PATCH /api/config`.

Объект MUST поддерживать поля: `model` (string|null), `maxConcepts` (1–30), `depth`
(`concepts` | `concepts+grounding`), `temperature` (0–2), `systemPrompt`,
`userPromptTemplate`, `descriptionPrompt` (string), `excludeNamePatterns` (string[]),
`enableDescriptionPass` (boolean).

#### Scenario: Defaults when section missing

- **WHEN** `config.json` не содержит `ontology_builder`
- **THEN** `GET /api/config` возвращает секцию, заполненную значениями по умолчанию
  из `getDefaultOntologyBuilderConfig()` (в т.ч. system/user prompts и maxConcepts)

#### Scenario: Partial PATCH deep-merges section

- **WHEN** клиент отправляет `PATCH /api/config` с `{ "ontology_builder": { "model": "RICH" } }`
- **THEN** сохраняется merge с предыдущей секцией и defaults, без обнуления
  `systemPrompt` / `userPromptTemplate`, если они не переданы

#### Scenario: Validation rejects invalid knobs

- **WHEN** `maxConcepts` вне 1–30, или `depth` не из enum, или `excludeNamePatterns` не массив строк
- **THEN** PATCH отвечает ошибкой валидации и не записывает конфиг

