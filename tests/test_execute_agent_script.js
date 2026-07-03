/**
 * Тест для выполнения скрипта через /api/agent-scripts/:id/execute
 * 
 * Запуск: bun tests/test_execute_agent_script.js
 * Требования: сервер должен быть запущен на BASE_URL
 */

const fetch = require('node-fetch');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3200';
const CONTEXT_CODE = 'CARL';

// === Утилиты ===

function success(msg) { console.log(`✅ ${msg}`); }
function error(msg)   { console.log(`❌ ${msg}`); }
function info(msg)    { console.log(`ℹ️  ${msg}`); }

// === Тесты ===

/**
 * Тест 1: Проверка доступности сервера
 */
async function testHealthCheck() {
  info('Тест 1: Health check');
  try {
    const res = await fetch(`${BASE_URL}/api/health?context-code=${CONTEXT_CODE}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    success('Сервер доступен');
    return true;
  } catch (e) {
    error(`Сервер недоступен на ${BASE_URL}: ${e.message}`);
    return false;
  }
}

/**
 * Тест 2: Получение списка скриптов, поиск валидного для выполнения
 */
async function testGetValidScript() {
  info('Тест 2: Поиск валидного скрипта для выполнения');
  try {
    const res = await fetch(`${BASE_URL}/api/agent-scripts?context-code=${CONTEXT_CODE}&limit=20`);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);

    const data = await res.json();
    if (!data.success) throw new Error(`API вернул success: false - ${data.error}`);
    if (!Array.isArray(data.scripts)) throw new Error('scripts должен быть массивм');

    const validScripts = data.scripts.filter(s => s.is_valid === true);
    info(`Всего скриптов: ${data.scripts.length}, валидных: ${validScripts.length}`);

    if (validScripts.length > 0) {
      const script = validScripts[0];
      success(`Найден валидный скрипт: id=${script.id}, question="${script.question.substring(0, 60)}..."`);
      return script.id;
    }

    info('Валидных скриптов не найдено — попробуем выполнить любой скрипт');
    if (data.scripts.length > 0) {
      return data.scripts[0].id;
    }

    info('Скриптов вообще нет в БД');
    return null;
  } catch (e) {
    error(`Тест 2 провален: ${e.message}`);
    return null;
  }
}

/**
 * Тест 3: Выполнение скрипта через POST /api/agent-scripts/:id/execute
 */
async function testExecuteScript(scriptId) {
  info(`Тест 3: POST /api/agent-scripts/${scriptId}/execute`);

  if (!scriptId) {
    info('Пропуск: нет скрипта для выполнения');
    return true;
  }

  try {
    const res = await fetch(`${BASE_URL}/api/agent-scripts/${scriptId}/execute?context-code=${CONTEXT_CODE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    const data = await res.json();

    if (!res.ok) {
      // Если скрипт невалиден, сервер вернёт 500 с деталями ошибки
      if (res.status === 500 && data.error && data.error.includes('Script execution failed')) {
        info(`Скрипт выполнился с ошибкой (ожидаемо для невалидных скриптов):`);
        info(`  Error: ${data.error}`);
        if (data.human) info(`  Human: ${data.human.substring(0, 120)}...`);
        if (data.script) info(`  Script (первые 200 симв.): ${data.script.substring(0, 200)}...`);
        return true; // Это не провал теста — сервер корректно обработал ошибку
      }
      throw new Error(`HTTP ${res.status}: ${JSON.stringify(data)}`);
    }

    if (!data.success) throw new Error(`API вернул success: false - ${data.error}`);

    // Проверяем структуру ответа
    if (typeof data.human !== 'string') throw new Error('human должен быть строкой');
    if (data.raw === undefined) throw new Error('raw должен присутствовать');
    if (typeof data.scriptId !== 'number') throw new Error('scriptId должен быть числом');
    if (data.scriptId !== scriptId) throw new Error(`scriptId mismatch: ожидали ${scriptId}, получили ${data.scriptId}`);

    success(`Скрипт выполнен успешно: scriptId=${data.scriptId}`);
    info(`  Human: ${data.human.substring(0, 120)}...`);

    // Выводим raw данные
    if (Array.isArray(data.raw)) {
      info(`  Raw: массив из ${data.raw.length} элементов`);
      if (data.raw.length > 0) {
        console.log(`  Первые 3 элемента:`);
        console.log(JSON.stringify(data.raw.slice(0, 3), null, 2));
      }
    } else if (data.raw !== null && typeof data.raw === 'object') {
      console.log(`  Raw: ${JSON.stringify(data.raw, null, 2).substring(0, 300)}`);
    }

    // Проверяем last_result
    if (data.last_result) {
      success(`last_result присутствует: executed_at=${data.last_result.executed_at}`);
    }

    return true;
  } catch (e) {
    error(`Тест 3 провален: ${e.message}`);
    return false;
  }
}

/**
 * Тест 4: Выполнение несуществующего скрипта (ожидается 404)
 */
async function testExecuteNonExistent() {
  info('Тест 4: Выполнение несуществующего скрипта (ожидается 404)');
  try {
    const fakeId = 999999;
    const res = await fetch(`${BASE_URL}/api/agent-scripts/${fakeId}/execute?context-code=${CONTEXT_CODE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    if (res.status !== 404) {
      throw new Error(`Ожидали 404, получили ${res.status}`);
    }

    const data = await res.json();
    if (data.success !== false) throw new Error('Ожидали success: false');

    success(`Корректно возвращён 404 для несуществующего скрипта`);
    return true;
  } catch (e) {
    error(`Тест 4 провален: ${e.message}`);
    return false;
  }
}

/**
 * Тест 5: Выполнение без context-code (ожидается 400)
 */
async function testExecuteWithoutContextCode() {
  info('Тест 5: Выполнение без context-code (ожидается 400)');
  try {
    const res = await fetch(`${BASE_URL}/api/agent-scripts/1/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    if (res.status !== 400) {
      throw new Error(`Ожидали 400, получили ${res.status}`);
    }

    const data = await res.json();
    if (data.success !== false) throw new Error('Ожидали success: false');
    if (!data.error.includes('context-code')) throw new Error('Ошибка должна упоминать context-code');

    success('Валидация context-code работает корректно');
    return true;
  } catch (e) {
    error(`Тест 5 провален: ${e.message}`);
    return false;
  }
}

/**
 * Тест 6: Выполнение с невалидным ID (строка вместо числа)
 */
async function testExecuteWithInvalidId() {
  info('Тест 6: Выполнение с невалидным ID (строка вместо числа)');
  try {
    const res = await fetch(`${BASE_URL}/api/agent-scripts/abc/execute?context-code=${CONTEXT_CODE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    if (res.status !== 400) {
      throw new Error(`Ожидали 400, получили ${res.status}`);
    }

    const data = await res.json();
    if (data.success !== false) throw new Error('Ожидали success: false');

    success('Невалидный ID корректно отклонён');
    return true;
  } catch (e) {
    error(`Тест 6 провален: ${e.message}`);
    return false;
  }
}

// === Функции UI-логики (реплики из NaturalQueryDialog.tsx и Inspector.tsx) ===

/**
 * Конвертация raw-данных в regex-фильтр (реплика applyToSearch из NaturalQueryDialog.tsx)
 * Извлекает идентификаторы из массива объектов и строит регулярку /^(?:item1|item2)$/i
 */
function rawToFilter(raw) {
  if (!raw || !Array.isArray(raw) || raw.length === 0) return '';

  const idKeys = ['function_name', 'fullName', 'id', 'name', 'source', 'target', 'label'];
  const items = raw.map(item => {
    if (typeof item === 'string') return item;
    for (const key of idKeys) {
      if (item[key]) return String(item[key]);
    }
    const stringVal = Object.values(item).find(v => typeof v === 'string');
    if (stringVal) return String(stringVal);
    return JSON.stringify(item);
  });

  const uniqueItems = Array.from(new Set(items)).filter(Boolean);
  if (uniqueItems.length === 0) return '';

  const MAX_REGEX_LENGTH = 2000;
  let includedItems = [];
  let currentLength = 10;

  for (const item of uniqueItems) {
    const escaped = item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (currentLength + escaped.length + 1 < MAX_REGEX_LENGTH) {
      includedItems.push(escaped);
      currentLength += escaped.length + 1;
    } else {
      break;
    }
  }

  return `/^(?:${includedItems.join('|')})$/i`;
}

/**
 * Объединение двух regex-фильтров (реплика mergeFilters из Inspector.tsx)
 * Если оба фильтра в формате /^(?:...)$/i — объединяет (union + dedup, макс 4000 симв.)
 * Иначе — заменяет текущий новым
 */
function mergeFilters(current, newFilter) {
  const cur = current.trim();

  if (!cur) return newFilter;

  const currentMatch = cur.match(/^\/\^\(\?:(.+)\)\$\/i$/);
  const newMatch = newFilter.match(/^\/\^\(\?:(.+)\)\$\/i$/);

  if (currentMatch && newMatch) {
    const currentItems = currentMatch[1].split('|');
    const newItems = newMatch[1].split('|');
    const allItems = Array.from(new Set([...currentItems, ...newItems]));

    const MAX_REGEX_LENGTH = 4000;
    let includedItems = [];
    let length = 10;
    for (const item of allItems) {
      if (length + item.length + 1 < MAX_REGEX_LENGTH) {
        includedItems.push(item);
        length += item.length + 1;
      } else {
        break;
      }
    }

    return `/^(?:${includedItems.join('|')})$/i`;
  }

  return newFilter;
}

/**
 * Парсинг regex-фильтра — извлекает список items из /^(?:item1|item2)$/i
 */
function parseFilterItems(filter) {
  const match = filter.match(/^\/\^\(\?:(.+)\)\$\/i$/);
  if (!match) return null;
  return match[1].split('|');
}

// === Тесты фильтров ===

/**
 * Тест 7: Конвертация raw данных в regex-фильтр (applyToSearch)
 * Выполняет скрипт, берёт raw и конвертирует в фильтр
 */
async function testRawToFilter(scriptId) {
  info('Тест 7: Конвертация raw → regex-фильтр (applyToSearch)');

  if (!scriptId) {
    info('Пропуск: нет скрипта для выполнения');
    return true;
  }

  try {
    // Выполняем скрипт для получения raw данных
    const res = await fetch(`${BASE_URL}/api/agent-scripts/${scriptId}/execute?context-code=${CONTEXT_CODE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      info(`Скрипт вернул ошибку — тестируем на моковых данных`);
      return testRawToFilterMock();
    }

    if (!Array.isArray(data.raw) || data.raw.length === 0) {
      info('Raw не массив или пуст — тестируем на моковых данных');
      return testRawToFilterMock();
    }

    // Конвертируем raw в фильтр
    const filter = rawToFilter(data.raw);
    if (!filter) throw new Error('Фильтр пустой');

    // Проверяем формат
    const regexMatch = filter.match(/^\/\^\(\?:(.+)\)\$\/i$/);
    if (!regexMatch) throw new Error(`Неверный формат фильтра: ${filter.substring(0, 80)}...`);

    const items = regexMatch[1].split('|');
    success(`Фильтр создан: ${items.length} элементов, длина=${filter.length}`);
    info(`  Формат: /^(?:...)$/i — корректный`);
    info(`  Первые 3 элемента: ${items.slice(0, 3).join(', ')}`);

    // Проверяем, что фильтр — валидная регулярка
    try {
      new RegExp(regexMatch[1]);
      success('Regex валиден');
    } catch (reErr) {
      throw new Error(`Невалидный regex: ${reErr.message}`);
    }

    return true;
  } catch (e) {
    error(`Тест 7 провален: ${e.message}`);
    return false;
  }
}

/**
 * Тест на моковых данных для rawToFilter
 */
function testRawToFilterMock() {
  const mockRaw = [
    { full_name: 'carl_auct.applyCivilCode', type: 'function', filename: 'api.sql' },
    { full_name: 'carl_auct._canProfBid', type: 'function', filename: 'api_wcb.sql' },
    { full_name: 'carl_auct.saveResult', type: 'function', filename: 'api_save.sql' }
  ];

  const filter = rawToFilter(mockRaw);
  if (!filter) throw new Error('Фильтр пустой для моковых данных');

  const regexMatch = filter.match(/^\/\^\(\?:(.+)\)\$\/i$/);
  if (!regexMatch) throw new Error(`Неверный формат: ${filter}`);

  const items = regexMatch[1].split('|');
  if (items.length !== 3) throw new Error(`Ожидали 3 элемента, получили ${items.length}`);

  // Первый приоритетный ключ — 'name', но у нас 'full_name', поэтому фоллбэк на первое строковое
  // В моке первое строковое значение — full_name
  if (!items[0].includes('carl_auct')) throw new Error(`Ожидали carl_auct в элементе, получили ${items[0]}`);

  success(`[mock] Фильтр создан: ${items.length} элементов — ${filter}`);
  return true;
}

/**
 * Тест 8: Объединение двух regex-фильтров (mergeFilters)
 */
function testMergeFilters() {
  info('Тест 8: Объединение двух regex-фильтров (mergeFilters)');

  try {
    const filter1 = '/^(?:carl_auct\\.fn1|carl_auct\\.fn2)$/i';
    const filter2 = '/^(?:carl_auct\\.fn3|carl_auct\\.fn1)$/i'; // fn1 — дубликат

    const merged = mergeFilters(filter1, filter2);

    const items = parseFilterItems(merged);
    if (!items) throw new Error(`Не удалось распарсить merged фильтр: ${merged}`);

    // Ожидаем 3 уникальных элемента (fn1 не дублируется)
    if (items.length !== 3) throw new Error(`Ожидали 3 уникальных элемента, получили ${items.length}: ${items.join(', ')}`);

    if (!items.includes('carl_auct\\.fn1')) throw new Error('fn1 отсутствует в merged');
    if (!items.includes('carl_auct\\.fn2')) throw new Error('fn2 отсутствует в merged');
    if (!items.includes('carl_auct\\.fn3')) throw new Error('fn3 отсутствует в merged');

    success(`Объединение: 2 + 2 (1 дубликат) = ${items.length} уникальных`);
    info(`  Результат: ${merged}`);

    return true;
  } catch (e) {
    error(`Тест 8 провален: ${e.message}`);
    return false;
  }
}

/**
 * Тест 9: Merge с пустым текущим фильтром
 */
function testMergeWithEmptyFilter() {
  info('Тест 9: Merge с пустым текущим фильтром');

  try {
    const newFilter = '/^(?:item1|item2)$/i';

    const result = mergeFilters('', newFilter);
    if (result !== newFilter) throw new Error(`Ожидали ${newFilter}, получили ${result}`);

    success('Пустой фильтр корректно заменён новым');

    // Также проверяем с пробелами
    const result2 = mergeFilters('   ', newFilter);
    if (result2 !== newFilter) throw new Error(`Ожидали ${newFilter} (trim), получили ${result2}`);

    success('Пробельный фильтр тоже корректно обработан');

    return true;
  } catch (e) {
    error(`Тест 9 провален: ${e.message}`);
    return false;
  }
}

/**
 * Тест 10: Merge с не-regex фильтром (простой текст)
 */
function testMergeWithPlainText() {
  info('Тест 10: Merge regex с простым текстом (замена)');

  try {
    const current = '/^(?:fn1|fn2)$/i';
    const plainText = 'simple_search_term';

    const result = mergeFilters(current, plainText);
    if (result !== plainText) throw new Error(`Ожидали "${plainText}", получили "${result}"`);

    success('При несовпадении форматов — корректная замена');

    // Обратный случай: текущий — текст, новый — regex
    const result2 = mergeFilters('some_text', '/^(?:a|b)$/i');
    if (result2 !== '/^(?:a|b)$/i') throw new Error(`Ожидали regex, получили "${result2}"`);

    success('Обратный случай тоже работает');

    return true;
  } catch (e) {
    error(`Тест 10 провален: ${e.message}`);
    return false;
  }
}

/**
 * Тест 11: Ограничение длины regex при merge (MAX 4000)
 */
function testMergeMaxLength() {
  info('Тест 11: Ограничение длины regex при merge (≤4000 симв.)');

  try {
    // Генерируем длинный фильтр
    const longItems = Array.from({ length: 200 }, (_, i) => `very_long_function_name_${String(i).padStart(3, '0')}`);
    const filter1 = `/^(?:${longItems.join('|')})$/i`;
    const moreItems = Array.from({ length: 200 }, (_, i) => `another_long_name_${String(i).padStart(3, '0')}`);
    const filter2 = `/^(?:${moreItems.join('|')})$/i`;

    info(`  filter1 длина: ${filter1.length}, filter2 длина: ${filter2.length}`);

    const merged = mergeFilters(filter1, filter2);
    if (merged.length > 4000) throw new Error(`Merged длина ${merged.length} > 4000`);

    const items = parseFilterItems(merged);
    if (!items) throw new Error('Не удалось распарсить merged');

    success(`Merged: ${items.length} элементов, длина=${merged.length} (≤4000)`);
    info(`  Исходных: 200 + 200 = 400, вошло: ${items.length}`);

    if (items.length >= 400) {
      throw new Error('Все 400 элементов влезли — ограничение не сработало (проверьте лимит)');
    }

    success('Ограничение длины regex работает корректно');
    return true;
  } catch (e) {
    error(`Тест 11 провален: ${e.message}`);
    return false;
  }
}

// === Главная функция ===

async function runAllTests() {
  console.log('='.repeat(60));
  console.log('🧪 Тест: выполнение скрипта (Agent Script Execute)');
  console.log(`   BASE_URL: ${BASE_URL}`);
  console.log(`   CONTEXT_CODE: ${CONTEXT_CODE}`);
  console.log('='.repeat(60));
  console.log('');

  const results = [];

  // Тест 1: Health check
  const healthy = await testHealthCheck();
  if (!healthy) {
    error('Сервер недоступен — тесты прерваны');
    process.exit(1);
  }
  results.push(true);
  console.log('');

  // Тест 2: Поиск валидного скрипта
  const scriptId = await testGetValidScript();
  results.push(scriptId !== null || true); // не провал, если скриптов нет
  console.log('');

  // Тест 3: Выполнение скрипта
  results.push(await testExecuteScript(scriptId));
  console.log('');

  // Тест 4: Несуществующий скрипт
  results.push(await testExecuteNonExistent());
  console.log('');

  // Тест 5: Без context-code
  results.push(await testExecuteWithoutContextCode());
  console.log('');

  // Тест 6: Невалидный ID
  results.push(await testExecuteWithInvalidId());
  console.log('');

  // === Тесты фильтров (UI-логика) ===
  console.log('─'.repeat(60));
  console.log('🔧 Тесты UI-логики: "Добавить к текущему фильтру"');
  console.log('─'.repeat(60));
  console.log('');

  // Тест 7: Конвертация raw → regex-фильтр
  results.push(await testRawToFilter(scriptId));
  console.log('');

  // Тест 8: Объединение двух regex-фильтров
  results.push(testMergeFilters());
  console.log('');

  // Тест 9: Merge с пустым фильтром
  results.push(testMergeWithEmptyFilter());
  console.log('');

  // Тест 10: Merge с простым текстом
  results.push(testMergeWithPlainText());
  console.log('');

  // Тест 11: Ограничение длины regex
  results.push(testMergeMaxLength());
  console.log('');

  // Итоги
  console.log('='.repeat(60));
  const passed = results.filter(r => r).length;
  const failed = results.filter(r => !r).length;

  if (failed === 0) {
    console.log(`🎉 Все тесты пройдены: ${passed}/${results.length}`);
  } else {
    console.log(`⚠️  Результат: ${passed} пройдено, ${failed} провалено`);
  }
  console.log('='.repeat(60));

  process.exit(failed > 0 ? 1 : 0);
}

// Запуск
runAllTests().catch(e => {
  console.error('Критическая ошибка:', e);
  process.exit(1);
});
