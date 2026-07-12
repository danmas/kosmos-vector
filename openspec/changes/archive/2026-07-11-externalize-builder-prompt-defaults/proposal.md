# Change: externalize-builder-prompt-defaults

## Why

Принцип: **текста промптов в коде быть не должно — только во внешних настройках.**

Рантайм уже читает промпты из внешнего `config.json` (секция `ontology_builder`) через
`GET/PATCH /api/config`. Но **заводские дефолты** этих промптов (system/user/retry/byo/
description/outputRules) физически лежат в коде — константы в
`packages/core/ontologyBuilderDefaults.js`, которые `appConfigService` подмешивает как
seed/Reset/fallback. Значит текст промптов всё ещё в `.js`.

Это же вскрыло содержательную проблему: текущие дефолты оверфитнуты под HR-домен
(`employee/department/skill/...` как «canonical ids»), см. `docs/ONTOLOGY_BUILDER_TUNING.md`.
Пока дефолты живут в коде, их правка = правка кода, что противоречит принципу и мешает
итеративному тюнингу через Settings.

## What Changes

- **NEW** внешний файл заводских дефолтов промптов, напр.
  `config/ontology_builder.defaults.json` — единственный источник текста промптов
  (system, user, description×2, outputRules, retry×2, byo) + не-текстовые кноб-дефолты
  (maxConcepts, depth, temperature, seedMode, excludeNamePatterns, enableDescriptionPass).
- **MODIFIED** `packages/core/ontologyBuilderDefaults.js`: больше НЕ содержит текст
  промптов; `getDefaultOntologyBuilderConfig()` читает дефолты из внешнего файла
  (кэш; missing/broken → fail-hard `ONTOLOGY_DEFAULTS_MISSING`). Плейсхолдер-рендер
  (`renderPromptTemplate`) остаётся в коде — это логика, не промпт.
- **MODIFIED** capability `ontology-builder`: требование о fallback меняется с
  «встроенные defaults из `ontologyBuilderDefaults.js`» на «дефолты из внешнего файла».
- Механика runtime (`config.json`, merge, Reset-to-factory, GET/PATCH) — без изменений,
  только источник заводских значений.

## Impact

- Код: `packages/core/ontologyBuilderDefaults.js` (убрать константы, читать файл),
  `packages/core/appConfigService.js` (без изменений API — просто получает дефолты),
  новый `config/ontology_builder.defaults.json`.
- Поведение: Reset-to-factory и первый запуск берут значения из внешнего файла.
- Тюнинг: правка/подмена дефолтов = правка внешнего файла, без пересборки кода.
- Совместимость: если файл отсутствует/битый — fail-hard
  `ONTOLOGY_DEFAULTS_MISSING` (suggest/export не выполняются); полный текст
  промптов из кода НЕ восстанавливается.
- Docs: `docs/ONTOLOGY_BUILDER_TUNING.md` (убрать путь «правка дефолтов в .js»),
  `KB/README_APP_CONFIG_API.md`, `CHANGELOG.md`.
