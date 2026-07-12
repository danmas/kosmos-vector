# Ontology Builder — prompt tuning harness

Крутит цикл **правка промпта → suggest → оценка** через API. Запускается **на хосте**
(нужен доступ к работающему серверу `:3200` и LLM `:3002`). Claude из песочницы сервер
не достаёт, поэтому прогоны — на тебе, а рубрику/оценку по Postgres — на Claude.

## Что где

- `tune.mjs` — харнес (Node 18+ / Bun, без зависимостей).
- `variants/P1.system.txt`, `variants/P1.user.txt` — вариант **P1** (универсальный
  промпт без HR-хардкода + правило «покрываем центральные таблицы, не все»).
- `out/` — сюда пишутся результаты (`<variant>.<mode>.<run>.json`) + `_config-backup.json`.

Плейсхолдеры в `*.user.txt` (`{{maxConcepts}}`, `{{contextCode}}`, `{{seedConcepts}}`,
`{{existingConcepts}}`, `{{anchors}}`) подставляет сервер — не трогай их имена.

## Ключевые факты

- `suggest` **read-only** — в БД/git ничего не пишет, цикл безопасен.
- Правим промпт через `PATCH /api/config` (живьём), НЕ через `defaults.json` (кэш, рестарт).
- `mode=export` дергает `suggest/export-prompt`: собирает тот же промпт с якорями, но
  **без вызова LLM** — бесплатная проверка, что вариант рендерится верно.

## Прогон

```bash
cd tools/ontology-tuning

# 0) (бесплатно) увидеть, какой промпт реально уходит в LLM для P1:
node tune.mjs --variant P1 --mode export

# 1) baseline — текущий дефолт (HR-оверфит), 2 прогона:
node tune.mjs --variant baseline --runs 2

# 2) P1 — универсальный промпт, 2 прогона, вернуть конфиг назад после:
node tune.mjs --variant P1 --runs 2 --restore
```

Флаги: `--base` (деф. `http://localhost:3200`), `--context` (деф. `KOSMOS-VECTOR`),
`--runs`, `--max` (деф. 12), `--mode suggest|export`, `--model <name>`, `--restore`, `--outdir`.

**Restore.** Восстановление идёт в **factory** (`factory.ontology_builder` из `GET /api/config`),
а не в «живой» бэкап — иначе если прошлый прогон не был восстановлен, бэкап уже равен варианту.
`export` **всегда** авто-ресторится (это read-only осмотр). Харнес предупреждает, если live-конфиг
на старте отличается от factory (значит, кто-то не восстановился).

**429 (free-tier).** Если LLM-путь уходит в free-tier несмотря на `KOSMOS_MODEL`, задай
не-free модель прямо для билдера: `--model RICH-KOSMOS-INSTRUCT` (пишет `ontology_builder.model`
в патч; работает и для baseline). Либо `--runs 1` и реже.

## Оценка

Пришли Claude содержимое `out/baseline.suggest.*.json` и `out/P1.suggest.*.json`.
Claude считает рубрику (`docs/ONTOLOGY_BUILDER_TUNING.md`, §4) по JSON + Postgres и
сравнивает с золотым эталоном KOSMOS-VECTOR (§2): grounding-резолвится, покрытие
центральных таблиц, отсутствие фрагментов/понятий-на-метод, вменяемость понятий.

Гипотеза теста: P0 предложит HR-понятия (employee/department), которых в коде нет;
P1 выдаст доменные (ai-item, chunk, pipeline, loader, vectorization…), близкие к эталону.

## Дальше

Победивший промпт «печём» в `config/ontology_builder.defaults.json` (factory) —
отдельным шагом, не в код. Затем повторяем на CARL (другой домен) для проверки
переносимости.
