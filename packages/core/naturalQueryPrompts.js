// naturalQueryPrompts.js
// Промпты для генерации и обработки скриптов Natural Query Engine

/**
 * Системный промпт для генерации скриптов
 * @param {string} question - Вопрос пользователя
 * @returns {string} Полный промпт с подставленным вопросом
 */
function getScriptGenerationPrompt(question) {
  return `Ты — генератор простых async JS-скриптов для анализа кодовой базы в KOSMOS-VECTOR.

Ключевые правила идентификации: все AiItems и связи уникальны по паре (context_code + full_name). full_name — это полное имя вроде "schema.function" или "module.exportFunc".

Доступные инструменты в скрипте:
- Только fetch к разрешённым GET-эндпоинтам: /api/items, /api/items-list, /api/items/{id}, /api/graph, /api/stats (с ?context-code=\${contextCode}).
- Прямой SQL через DbService.queryRaw(\`SELECT ...\`, [params]) — ТОЛЬКО SELECT! Всегда WHERE context_code = $1.

Скрипт: одна async function execute(contextCode) { ... return rawData; } // rawData — массив или объект
Максимум 4 запроса. Если вопрос не реализуем точно — return { error: "clarify", message: "Уточни: ..." }

Справочник типов связей (link_type):
code: calls → "Function calls another function"
code: reads_from → "SELECT / FROM / JOIN table"
code: updates → "UPDATE table"
code: inserts_into → "INSERT INTO table"
code: imports → "JS/TS import module or symbol"
code: depends_on → "General dependency (reserved)"

Ключевые таблицы:
- ai_item (id serial, full_name text, context_code text, type text, file_id uuid references files(id))
- link (source text, target text, link_type_id int references link_type(id), context_code text)
- link_type (id serial, code text, label text, description text)
- chunk_vector (ai_item_id int references ai_item(id), full_name text, level text, file_id uuid)
- files (id uuid, filename text, context_code text)

Все SQL с WHERE context_code = $1.

Схема отношений:
ai_item --> files (file_id)
chunk_vector --> ai_item (ai_item_id)
chunk_vector --> files (file_id)
link --> link_type (link_type_id)

Примеры:

Вопрос: Какие типы связей вообще используются в проекте?

Скрипт:
async function execute(contextCode) {
  const rows = await DbService.queryRaw(\`
    SELECT lt.code, lt.label, lt.description
    FROM link_type lt
    WHERE EXISTS (
      SELECT 1 FROM link l 
      WHERE l.link_type_id = lt.id AND l.context_code = $1
    )
    ORDER BY lt.id
  \`, [contextCode]);
  return rows;
}

Вопрос: Список всех функций, которые читают таблицу carl_data.users (обратная связь reads_from)?

Скрипт:
async function execute(contextCode) {
  const tableName = "carl_data.users";
  const rows = await DbService.queryRaw(\`
    SELECT ai.full_name, ai.type, f.filename
    FROM link l
    JOIN link_type lt ON l.link_type_id = lt.id
    JOIN ai_item ai ON l.source = ai.full_name AND ai.context_code = l.context_code
    JOIN files f ON ai.file_id = f.id
    WHERE l.context_code = $1
      AND lt.code = 'reads_from'
      AND l.target = $2
    ORDER BY ai.full_name
  \`, [contextCode, tableName]);
  return rows;
}

Вопрос: Топ-10 самых вызываемых функций (по типу связи calls)?

Скрипт:
async function execute(contextCode) {
  const rows = await DbService.queryRaw(\`
    SELECT l.target AS called_function, COUNT(*) AS calls_count
    FROM link l
    JOIN link_type lt ON l.link_type_id = lt.id
    WHERE l.context_code = $1 AND lt.code = 'calls'
    GROUP BY l.target
    ORDER BY calls_count DESC
    LIMIT 10
  \`, [contextCode]);
  return rows;
}

Вопрос: Все таблицы, которые обновляются хотя бы одной функцией из схемы carl_comm?

Скрипт:
async function execute(contextCode) {
  const schemaPrefix = "carl_comm.";
  const rows = await DbService.queryRaw(\`
    SELECT DISTINCT l.target AS table_name
    FROM link l
    JOIN link_type lt ON l.link_type_id = lt.id
    JOIN ai_item ai ON l.source = ai.full_name AND ai.context_code = l.context_code
    WHERE l.context_code = $1
      AND lt.code = 'updates'
      AND ai.full_name LIKE $2 || '%'
  \`, [contextCode, schemaPrefix]);
  return rows;
}

Вопрос: Список всех импортов в JS-файлах?

Скрипт:
async function execute(contextCode) {
  const rows = await DbService.queryRaw(\`
    SELECT l.source AS importer, l.target AS imported
    FROM link l
    JOIN link_type lt ON l.link_type_id = lt.id
    WHERE l.context_code = $1 AND lt.code = 'imports'
    ORDER BY l.source, l.target
  \`, [contextCode]);
  return rows;
}

Теперь вопрос пользователя: ${question}
Сгенерируй только код скрипта как строку, без лишнего.`;
}

/**
 * Промпт для превращения rawData в человекочитаемый текст
 * @param {string} question - Оригинальный вопрос пользователя
 * @param {any} rawData - Сырые данные из скрипта
 * @returns {string} Промпт для humanize
 */
function getHumanizePrompt(question, rawData) {
  const rawDataStr = JSON.stringify(rawData, null, 2);
  
  return `Ты помощник для анализа кодовой базы. Преврати сырые данные из базы данных в понятный человекочитаемый текст на русском языке.

Вопрос пользователя: ${question}

Сырые данные из базы:
${rawDataStr}

Сформулируй краткий, но информативный ответ на русском языке. Используй данные из rawData для конкретики. Если данных нет или массив пуст, честно скажи об этом.`;
}

module.exports = {
  getScriptGenerationPrompt,
  getHumanizePrompt
};

