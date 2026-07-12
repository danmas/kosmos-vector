# Design: externalize-builder-prompt-defaults

## Context

Рантайм-настройки построителя уже внешние: `config.json` (repo root), секция
`ontology_builder`, читается/пишется `GET/PATCH /api/config`
(`packages/core/appConfigService.js`, `CONFIG_FILE = process.cwd()/config.json`).
Заводские дефолты пока в коде: `packages/core/ontologyBuilderDefaults.js` →
`getDefaultOntologyBuilderConfig()` возвращает объект с телами промптов как JS-констант.
`appConfigService` мёржит сохранённый конфиг поверх этих дефолтов (merge, Reset, seed).

Задача: вынести **текст промптов** из `.js` во внешний файл; код только читает.

## Decisions

### D1. Путь файла

`config/ontology_builder.defaults.json` (новая папка `config/` в корне репо).
Отдельно от рантайм-`config.json`, чтобы не путать «заводское» и «пользовательское».
Файл версионируется в git (это дефолты, а не пользовательские данные).

### D2. Формат файла

Тот же объект, что сейчас возвращает `getDefaultOntologyBuilderConfig()` — 1:1:
```json
{
  "model": null,
  "maxConcepts": 10,
  "depth": "concepts+grounding",
  "temperature": 0,
  "seedMode": "user-only",
  "enableDescriptionPass": false,
  "excludeNamePatterns": ["^format[A-Z]", "^validate[A-Z]", "Validator$", "^toString$", "^log$"],
  "systemPrompt": "…",
  "userPromptTemplate": "…",
  "descriptionSystemPrompt": "…",
  "descriptionPrompt": "…",
  "outputRulesSuffix": "…",
  "retrySystemPrompt": "…",
  "retryUserTemplate": "…",
  "byoInstruction": "…"
}
```
Ключи и семантика не меняются — меняется только источник.

### D3. Загрузка в коде

`ontologyBuilderDefaults.js`:
- убрать все `DEFAULT_*` строковые константы промптов;
- `getDefaultOntologyBuilderConfig()` читает JSON один раз и **кэширует** в модульной
  переменной (файл статичен в пределах процесса); повторные вызовы — из кэша.
  **Следствие:** правка `ontology_builder.defaults.json` без рестарта процесса не
  подхватывается — для factory-файла это норма; зафиксировать одной строкой в docs
  (task 4.2). Опциональный reload endpoint — вне scope этого change;
- `renderPromptTemplate(...)` **остаётся** в коде (это логика подстановки, не промпт);
- экспорт `renderPromptTemplate` + `getDefaultOntologyBuilderConfig` сохранить;
  экспорты отдельных `DEFAULT_*` строк удалить (проверить потребителей — если кто-то
  импортировал `DEFAULT_SYSTEM_PROMPT` напрямую, переключить на
  `getDefaultOntologyBuilderConfig().systemPrompt`).

Путь к файлу: `path.join(process.cwd(), 'config', 'ontology_builder.defaults.json')`
(симметрично `CONFIG_FILE`).

### D4. Отсутствие / битый файл — fail hard (решено)

Один вариант, без развилки: **fail hard**.

- Файл отсутствует или JSON.parse падает → `suggest`/`export` возвращают
  `ONTOLOGY_DEFAULTS_MISSING` с текстом «create config/ontology_builder.defaults.json»
  и НЕ выполняются.
- НЕ восстанавливать текст промптов из кода — никогда.
- Knobs-only каркас (не-текстовые дефолты: maxConcepts, depth, temperature, seedMode,
  excludeNamePatterns, enableDescriptionPass) допускается **только** как минимальный
  скелет для partial boot процесса, если это реально нужно; он НЕ подменяет тексты
  промптов и НЕ делает suggest доступным. По умолчанию — proceed без него, просто fail
  hard на suggest.

### D5. Reset / merge без изменений

`appConfigService`: сигнатуры и API (`getConfig`, `saveConfig`, `resetConfig`,
merge с дефолтами) не меняются — просто дефолты теперь приходят из файла через
`getDefaultOntologyBuilderConfig()`. `POST /api/config/reset` автоматически возьмёт
внешние значения.

### D6. UI Reset — единый путь, без копии на фронте

Кнопка «Reset to factory» в Settings MUST делегировать на backend
`POST /api/config/reset` (factory payload = `getDefaultOntologyBuilderConfig()`).
Проверить, что фронт (`OntologyBuilderConfigTab.tsx` / `SettingsDialog.tsx`) НЕ хранит
собственную копию заводских промптов и не «ресетит» из локальной константы — иначе
после выноса в файл фронт разъедется с backend. Если такая копия есть — убрать, брать
factory-значения из ответа `GET /api/config` — поле `factory.ontology_builder`
(= `getDefaultOntologyBuilderConfig()`, см. `routes/api.js:190-192`).

## Non-Goals

- Не менять содержание промптов в этом change (HR→универсальный — отдельная задача
  тюнинга через settings, см. `docs/ONTOLOGY_BUILDER_TUNING.md`). Здесь перенос 1:1.
- Не менять рантайм-механику config.json / GET / PATCH / history.
- Не выносить прочие промпты системы (RAG/chat в `prompts.json`) — только
  `ontology_builder`.

## Risks

- Пропущенный прямой импорт `DEFAULT_*` где-то в коде → сломается require. Митигируется
  grep-проверкой (task 2.4) до удаления констант.
- Забыли добавить `config/` в поставку/деплой → пустой старт упадёт по D4. Явно указать
  файл как обязательный артефакт репо.

## Migration

1. Сгенерировать `config/ontology_builder.defaults.json` из текущих значений
   `getDefaultOntologyBuilderConfig()` (снять до правки кода, чтобы гарантировать 1:1).
2. Переключить код на чтение файла.
3. Прогнать парити: Reset и первый старт дают те же значения, `suggest` не изменился.
