# Tasks: externalize-builder-prompt-defaults

## 1. External defaults file

- [x] 1.1 Создать `config/ontology_builder.defaults.json` со всеми текущими значениями
      из `getDefaultOntologyBuilderConfig()` (тексты промптов + кнобы), 1:1 перенос
- [x] 1.2 Fail-hard при отсутствии/битом файле: `suggest`/`export` → ошибка
      `ONTOLOGY_DEFAULTS_MISSING`, текст промптов из кода НЕ восстанавливается.
      Knobs-only каркас — только если реально нужен partial boot (см. design D4)

## 2. Code: stop holding prompt text

- [x] 2.1 `packages/core/ontologyBuilderDefaults.js`: удалить строковые константы
      промптов; `getDefaultOntologyBuilderConfig()` читает внешний файл (с кэшем)
- [x] 2.2 Оставить `renderPromptTemplate` в коде (это логика, не промпт)
- [x] 2.3 Проверить, что `appConfigService.js` и `routes/ontology/ontologyBuilder.js`
      получают дефолты только через обновлённый `getDefaultOntologyBuilderConfig()`
- [x] 2.4 Проверка «нет тел промптов как источника дефолтов» в production-модулях
      (`packages/core/**`, `routes/**`), исключая тесты/комментарии/error-строки.
      Критерий — строка служит значением дефолта промпта, а не «любая длинная строка»

## 3. Behavior parity

- [x] 3.1 Reset-to-factory и первый запуск берут значения из внешнего файла
- [x] 3.2 GET/PATCH `/api/config`, merge, seedMode, excludeNamePatterns — без изменений
- [x] 3.3 `POST /api/config/reset` восстанавливает из файла
- [x] 3.4 UI «Reset to factory» (`OntologyBuilderConfigTab.tsx`/`SettingsDialog.tsx`)
      делегирует на `POST /api/config/reset` (или берёт `factory.ontology_builder` из
      `GET /api/config`); убрать собственную копию дефолтов на фронте, если есть

## 4. Docs

- [x] 4.1 `docs/ONTOLOGY_BUILDER_TUNING.md`: тюнинг только через settings/внешний файл
- [x] 4.2 `KB/README_APP_CONFIG_API.md`: описать внешний файл дефолтов + строку про кэш
      (правка файла подхватывается только после рестарта процесса)
- [x] 4.3 `CHANGELOG.md`

## 5. Verification (host-side)

- [x] 5.1 Старт с пустым `config.json` → значения приходят из внешнего файла
- [x] 5.2 Reset-to-factory возвращает внешние дефолты
- [x] 5.3 Удалить/испортить файл → понятная ошибка, без текста промптов из кода
- [x] 5.4 `suggest` работает как раньше (парити поведения)
