# Spec delta: ontology-builder

## MODIFIED Requirements

### Requirement: Suggest uses configurable model and prompts

`POST /api/ontology/build/suggest` MUST использовать настройки `ontology_builder` из
app config: модель (или fallback `KOSMOS_MODEL`), system prompt, user prompt template
с подстановкой плейсхолдеров `{{maxConcepts}}`, `{{contextCode}}`, `{{seedConcepts}}`,
`{{anchors}}`, и temperature при вызове LLM.

Заводские дефолты этих настроек MUST браться из **внешнего файла**
(`config/ontology_builder.defaults.json`), а НЕ из констант в коде.

#### Scenario: Empty stored prompts fall back to external defaults file

- **WHEN** в config сохранены пустые `systemPrompt` / `userPromptTemplate`
- **THEN** suggest использует дефолты из внешнего файла
  `config/ontology_builder.defaults.json`, а не отправляет пустые system/user сообщения
- **AND** код НЕ содержит текста промптов как источника этих дефолтов

#### Scenario: Request overrides settings maxConcepts/depth

- **WHEN** body suggest содержит `maxConcepts` и/или `depth`
- **THEN** эти значения имеют приоритет над defaults из `ontology_builder` для данного запроса

#### Scenario: Exclude patterns filter util anchors but keep tables

- **WHEN** заданы `excludeNamePatterns` (например `^validate[A-Z]`)
- **THEN** соответствующие non-table якоря не передаются в LLM, а items с `type=table`
  остаются доступны для кластеризации

## ADDED Requirements

### Requirement: Prompt text lives only in external settings/files

The system MUST keep ontology-builder prompt text only in external places: runtime in
app config (`config.json`, section `ontology_builder`); factory defaults in the external
file (`config/ontology_builder.defaults.json`). Source code (`.js`) MUST NOT contain
prompt bodies as string constants that serve as the default source. Placeholder
substitution logic (`renderPromptTemplate`) is not a prompt and MUST remain in code.

#### Scenario: No prompt bodies as defaults source in production modules

- **WHEN** проверяются production-модули (`packages/core/**`, `routes/**`), исключая
  тесты, комментарии и тексты error-сообщений
- **THEN** ни один из них не содержит строковой константы, СЛУЖАЩЕЙ источником дефолта
  промпта построителя (system/user/retry/byo/description/outputRules) — эти дефолты
  приходят только из внешнего файла/конфига
- **NOTE** критерий проверки — «строка используется как значение дефолта промпта», а не
  «любая длинная строка»; наивный grep по длине тестом не является

#### Scenario: Reset-to-factory reads external file (UI и API — один путь)

- **WHEN** пользователь жмёт «Reset to factory» для `ontology_builder`
- **THEN** значения восстанавливаются из `config/ontology_builder.defaults.json`,
  а не из захардкоженных строк в коде
- **AND** UI-кнопка делегирует на `POST /api/config/reset` (factory payload =
  `getDefaultOntologyBuilderConfig()`), без отдельной копии дефолтов на фронте

#### Scenario: Missing/broken defaults file → fail hard

- **WHEN** внешний файл дефолтов отсутствует или невалиден (JSON.parse падает)
- **THEN** `suggest`/`export` возвращают ошибку конфигурации `ONTOLOGY_DEFAULTS_MISSING`
  и НЕ выполняются
- **AND** система НИКОГДА не восстанавливает текст промптов из кода
- **AND** (опц.) процесс МОЖЕТ подняться на knobs-only каркасе (без текстов промптов)
  ТОЛЬКО чтобы разрешить partial boot; `suggest` недоступен, пока файла нет
