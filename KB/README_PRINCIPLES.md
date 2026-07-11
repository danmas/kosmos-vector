# Принципы продукта (AiItem / kosmos-vector)

**Назначение:** зафиксированные продуктовые и инженерные принципы, обязательные для backend, UI и агентов.  
**Актуализация:** 2026-07-11

---

## 1. Девиз

> **«Без ИИ жизни нет!»**  
> *«No AI, no life.»*

Система — RAG / ontology / natural-query / builder — **завязана на LLM**. Скрывать отказ модели «как будто всё хорошо» — запрещено.

---

## 2. Принцип: отказ LLM = остановка операции

### Правило

Если сценарий **требует** вызова LLM (генерация ответа, suggest онтологии, natural-query script, logic architect, description pass и т.п.):

| MUST | MUST NOT |
|------|----------|
| Остановить операцию | Тихий fallback «без ИИ, но похоже на успех» |
| Вернуть понятную ошибку пользователю (UI / API) | Soft-поле `answerError` при HTTP 200, если ответ был обязателен |
| Код ошибки вроде `LLM_REQUIRED` (где уместно) | Подмена LLM эвристикой без явного согласия пользователя |
| Лог: warn/error с причиной (модель, URL, message) | Продолжать apply/suggest «пустыми» или выдуманными данными |

### Примеры (канон)

| Сценарий | При ошибке LLM |
|----------|----------------|
| Ontology Builder **suggest** | 503 `LLM_REQUIRED`, **без** heuristic-черновика |
| Ontology **ask** с `generateAnswer: true` | 503, не 200 с `answerError` |
| RAG **ask** | 5xx / success:false (как сейчас) |
| Natural Query (генерация скрипта) | ошибка клиенту, не «пустой» script |
| Description pass builder (если включён) | стоп suggest, не skip pass |

### Допустимые исключения

- **Retrieve-only** (`generateAnswer: false`, `rag/retrieve`) — LLM не нужен, отказ модели не применим.
- **Эвристики / offline tools** — только если пользователь **явно** выбрал режим без LLM (флаг в API/UI), и UI это показывает. По умолчанию такого режима нет.

### Формулировка для пользователя (шаблон)

```text
LLM недоступен или вернул ошибку: <причина>.
«Без ИИ жизни нет!» — операция остановлена.
Проверьте kosmos-model / KOSMOS_BASE_URL / модель в System Settings.
```

---

## 3. Промпты и механизмы ИИ — только из настроек

| MUST | MUST NOT |
|------|----------|
| Тексты LLM (system/user/retry/BYO/description) — в `config.json` → `ontology_builder` / System Settings | Хардкод промптов в `routes/*` как runtime source of truth |
| Factory defaults — только seed («Подставить factory defaults»), файл `ontologyBuilderDefaults.js` | Тихо подменять пустые поля в builder без Settings |
| Модель suggest — `ontology_builder.model` или fallback `KOSMOS_MODEL` из App Config | Скрытые константы промпта, недоступные оператору |

UI: **System Settings → Ontology Builder**.  
Принцип тот же, что у Prompts Config / Logic Architect: **управляемое ИИ-поведение = конфиг, не redeploy.**

## 4. Связанные принципы (кратко)

1. **Сначала реальность, потом онтология** — grounding не к чему крепить без `ai_item` (см. `README_ONTO_LOADING.md`).
2. **MD — source of truth онтологии, PG — индекс.**
3. **KB first** — агенты и люди смотрят `KB/README_INDEX.md` до слепого grep.

---

## 5. Где в коде

- Builder: `routes/ontology/ontologyBuilder.js` → `getOntologyBuilderSettings()` из app config; `makeLlmRequiredError`.
- Factory seed: `packages/core/ontologyBuilderDefaults.js` (не runtime path).
- Ontology ask: `routes/ontology.js` → generateAnswer + LLM fail → 503.
- UI: Settings → Ontology Builder; sidebar девиз «AiItem Architect».

---

## Связанная документация

- [README_ONTO_LOADING.md](./README_ONTO_LOADING.md) — онтология и builder  
- [README_APP_CONFIG_API.md](./README_APP_CONFIG_API.md) — модели / settings  
- [README_INDEX.md](./README_INDEX.md) — оглавление KB  
