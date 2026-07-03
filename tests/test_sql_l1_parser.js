/**
 * Тест парсинга L1 для PL/pgSQL функций
 * Проверяет поддержку разных вариантов dollar-quoting: $$, $function$, $body$, AS '
 */

const path = require('path');

// Импортируем parsePlpgsqlFunctionL1 через require (функция не экспортируется напрямую,
// поэтому тестируем через обёртку — копируем логику здесь для изоляции)
// Но проще: перезагрузим модуль и вызовем parsePlpgsqlFunctionL1 через обходной путь.
// Функция не экспортируется, поэтому тестируем через inline-копию + проверяем фикс regex.

// ============================================================
// Упрощённая копия parsePlpgsqlFunctionL1 (только блок поиска тела)
// для проверки исправления регекса
// ============================================================
function extractBody(code) {
  let cleaned = code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--.*$/gm, '');
  cleaned = cleaned.replace(/\s+/g, ' ');

  const createRegex = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([a-zA-Z0-9_]+\.[a-zA-Z0-9_]+|[a-zA-Z0-9_]+)\s*\(/i;
  const match = cleaned.match(createRegex);
  if (!match) throw new Error("Не удалось найти CREATE FUNCTION");
  const functionName = match[1].trim();

  // Новый регекс: поддерживает $$, $function$, $body$, $tag$ и т.д.
  const asRegex = /\bAS\s*('|\$\w*\$)/i;
  const asMatch = cleaned.match(asRegex);
  if (!asMatch) throw new Error("Не найден блок AS $$ / AS $tag$ / AS '");

  const delimiter = asMatch[1];
  const asIndex = cleaned.indexOf(asMatch[0]);
  let bodyStart = asIndex + asMatch[0].length;
  let body = '';

  if (delimiter === "'") {
    const endQuoteIndex = cleaned.indexOf("';", bodyStart);
    if (endQuoteIndex === -1) throw new Error("Не найден конец блока AS ' ... ';");
    body = cleaned.substring(bodyStart, endQuoteIndex);
  } else {
    const dollarParts = cleaned.substring(bodyStart).split(delimiter);
    if (dollarParts.length < 2) throw new Error(`Не найден закрывающий ${delimiter}`);
    body = dollarParts.slice(0, -1).join(delimiter).trim();
  }
  return { functionName, body, delimiter };
}

// ============================================================
// Тест-кейсы
// ============================================================
let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  PASS: ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL: ${msg}`);
    failed++;
  }
}

// --- Кейс 1: Обычный $$ ---
console.log('\n=== Кейс 1: AS $$ ... $$ ===');
{
  const sql = `
CREATE OR REPLACE FUNCTION carl_inspect.getFavoriteList(p_user_id int)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_agg(row_to_json(t))
  INTO v_result
  FROM carl_inspect.favorite_list t
  WHERE t.user_id = p_user_id;
  RETURN v_result;
END;
$$;
`;
  const { functionName, body, delimiter } = extractBody(sql);
  assert(functionName === 'carl_inspect.getFavoriteList', 'Имя функции извлечено');
  assert(delimiter === '$$', 'Делимитер $$');
  assert(body.includes('DECLARE'), 'DECLARE присутствует в теле');
  assert(body.includes('carl_inspect.favorite_list'), 'Таблица извлечена');
  assert(!body.includes('LANGUAGE plpgsql'), 'LANGUAGE не попало в тело');
}

// --- Кейс 2: $function$ ---
console.log('\n=== Кейс 2: AS $function$ ... $function$ ===');
{
  const sql = `
CREATE OR REPLACE FUNCTION carl_inspect._removeFavoriteInspectReportById(p_id int)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  v_report_id int;
BEGIN
  SELECT report_id INTO v_report_id
  FROM carl_inspect.favorite_inspect_report
  WHERE id = p_id;

  DELETE FROM carl_inspect.favorite_inspect_report WHERE id = p_id;
  PERFORM carl_inspect._recalcReportStats(v_report_id);
END;
$function$;
`;
  const { functionName, body, delimiter } = extractBody(sql);
  assert(functionName === 'carl_inspect._removeFavoriteInspectReportById', 'Имя функции ($function$)');
  assert(delimiter === '$function$', 'Делимитер $function$');
  assert(body.includes('DELETE FROM carl_inspect.favorite_inspect_report'), 'DELETE в теле');
  assert(body.includes('carl_inspect._recalcReportStats'), 'PERFORM вызов извлечён');
  assert(!body.includes('$function$'), 'Сам тег не попал в тело');
}

// --- Кейс 3: $body$ ---
console.log('\n=== Кейс 3: AS $body$ ... $body$ ===');
{
  const sql = `
CREATE OR REPLACE FUNCTION public.calculate_total(p_order_id int)
RETURNS numeric
LANGUAGE plpgsql
AS $body$
DECLARE
  v_total numeric := 0;
BEGIN
  SELECT sum(price * quantity)
  INTO v_total
  FROM order_items
  WHERE order_id = p_order_id;
  RETURN v_total;
END;
$body$;
`;
  const { functionName, body, delimiter } = extractBody(sql);
  assert(functionName === 'public.calculate_total', 'Имя функции ($body$)');
  assert(delimiter === '$body$', 'Делимитер $body$');
  assert(body.includes('order_items'), 'Таблица order_items');
  assert(body.includes('sum(price'), 'Агрегатная функция в теле');
}

// --- Кейс 4: AS '...' (одинарные кавычки) ---
console.log('\n=== Кейс 4: AS \' ... \'; ===');
{
  const sql = `
CREATE OR REPLACE FUNCTION public.simple_func(p_id int)
RETURNS int
LANGUAGE plpgsql
AS '
DECLARE
  v int;
BEGIN
  SELECT id INTO v FROM some_table WHERE id = p_id;
  RETURN v;
END;
';
`;
  const { functionName, body, delimiter } = extractBody(sql);
  assert(functionName === 'public.simple_func', 'Имя функции (AS \')');
  assert(delimiter === "'", "Делимитер '");
  assert(body.includes('some_table'), 'Таблица some_table');
}

// --- Кейс 5: $tag$ с вложенными $$ внутри строковых литералов ---
console.log('\n=== Кейс 5: $func$ с $$ внутри тела (вложенный dollar-quote в строке) ===');
{
  const sql = `
CREATE OR REPLACE FUNCTION schema.build_query(p text)
RETURNS text
LANGUAGE plpgsql
AS $func$
DECLARE
  q text;
BEGIN
  q := $$SELECT * FROM inner_table$$;
  RETURN q;
END;
$func$;
`;
  const { functionName, body, delimiter } = extractBody(sql);
  assert(functionName === 'schema.build_query', 'Имя функции ($func$)');
  assert(delimiter === '$func$', 'Делимитер $func$');
  // Вложенные $$ должны остаться в теле, т.к. split по $func$
  assert(body.includes('$$SELECT * FROM inner_table$$'), 'Вложенные $$ сохранены в теле');
}

// --- Кейс 6: Отсутствие AS-блока (должен бросить ошибку) ---
console.log('\n=== Кейс 6: Отсутствие AS-блока (ожидаемая ошибка) ===');
{
  const sql = `
CREATE OR REPLACE FUNCTION public.broken_func()
RETURNS void
LANGUAGE plpgsql;
`;
  let threw = false;
  try {
    extractBody(sql);
  } catch (e) {
    threw = true;
    assert(e.message.includes('Не найден блок'), 'Корректная ошибка: ' + e.message);
  }
  assert(threw, 'Ошибка брошена при отсутствии AS-блока');
}

// --- Кейс 7: $proc$ (редкий тег) ---
console.log('\n=== Кейс 7: AS $proc$ ... $proc$ ===');
{
  const sql = `
CREATE FUNCTION utils.cleanup(p_days int)
RETURNS void
LANGUAGE plpgsql
AS $proc$
BEGIN
  DELETE FROM utils.audit_log WHERE created_at < now() - (p_days || ' days')::interval;
  PERFORM utils._logCleanup(p_days);
END;
$proc$;
`;
  const { functionName, body, delimiter } = extractBody(sql);
  assert(functionName === 'utils.cleanup', 'Имя функции ($proc$)');
  assert(delimiter === '$proc$', 'Делимитер $proc$');
  assert(body.includes('utils.audit_log'), 'Таблица audit_log');
  assert(body.includes('utils._logCleanup'), 'Вызов _logCleanup');
}

// ============================================================
// Итог
// ============================================================
console.log(`\n${'='.repeat(40)}`);
console.log(`Итого: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(40)}`);

process.exit(failed > 0 ? 1 : 0);
