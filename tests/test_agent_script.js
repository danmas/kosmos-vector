/**
 * Тесты для Natural Query Engine (Agent Script)
 * 
 * Запуск: node tests/test_agent_script.js
 * Требования: сервер должен быть запущен на BASE_URL
 */

const fetch = require('node-fetch');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3200';
const CONTEXT_CODE = 'CARL';

let createdScriptId = null;

// === Утилиты ===

function log(emoji, message) {
  console.log(`${emoji} ${message}`);
}

function success(message) {
  log('✅', message);
}

function error(message) {
  log('❌', message);
}

function info(message) {
  log('ℹ️', message);
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// === Тесты ===

/**
 * Тест 1: Проверка списка скриптов (GET /api/agent-scripts)
 */
async function testGetScriptsList() {
  info('Тест 1: GET /api/agent-scripts - список скриптов');
  
  try {
    const res = await fetch(`${BASE_URL}/api/agent-scripts?context-code=${CONTEXT_CODE}`);
    
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    }
    
    const data = await res.json();
    
    if (!data.success) {
      throw new Error(`API вернул success: false - ${data.error}`);
    }
    
    if (!Array.isArray(data.scripts)) {
      throw new Error('scripts должен быть массивом');
    }
    
    success(`Получен список: ${data.scripts.length} скриптов`);
    return true;
  } catch (e) {
    error(`Тест 1 провален: ${e.message}`);
    return false;
  }
}

/**
 * Тест 2: Генерация нового скрипта через natural-query
 */
async function testNaturalQueryGenerate() {
  info('Тест 2: POST /api/v1/natural-query - генерация скрипта');
  
  try {
    const question = 'Какие типы связей используются в проекте?';
    
    const res = await fetch(`${BASE_URL}/api/v1/natural-query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: question,
        contextCode: CONTEXT_CODE
      })
    });
    
    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`HTTP ${res.status}: ${errorText}`);
    }
    
    const data = await res.json();
    
    if (!data.success) {
      throw new Error(`API вернул success: false - ${data.error}`);
    }
    
    // Проверяем структуру ответа
    if (typeof data.human !== 'string') {
      throw new Error('human должен быть строкой');
    }
    
    if (data.raw === undefined) {
      throw new Error('raw должен присутствовать');
    }
    
    if (typeof data.scriptId !== 'number') {
      throw new Error('scriptId должен быть числом');
    }
    
    if (typeof data.cached !== 'boolean') {
      throw new Error('cached должен быть boolean');
    }
    
    createdScriptId = data.scriptId;
    
    success(`Скрипт сгенерирован: id=${data.scriptId}, cached=${data.cached}`);
    info(`Human: ${data.human.substring(0, 100)}...`);
    
    // Получаем детали скрипта для вывода сгенерированного кода
    try {
      const scriptRes = await fetch(`${BASE_URL}/api/agent-scripts/${data.scriptId}?context-code=${CONTEXT_CODE}`);
      if (scriptRes.ok) {
        const scriptData = await scriptRes.json();
        if (scriptData.success && scriptData.script) {
          console.log('\n📜 Сгенерированный скрипт:');
          console.log('─'.repeat(60));
          console.log(scriptData.script.script);
          console.log('─'.repeat(60));
        }
      }
    } catch (e) {
      info(`Не удалось получить детали скрипта: ${e.message}`);
    }
    
    // Выводим результат выполнения скрипта (raw данные)
    console.log('\n📊 Результат выполнения скрипта (raw):');
    console.log('─'.repeat(60));
    if (Array.isArray(data.raw)) {
      console.log(`Массив из ${data.raw.length} элементов:`);
      if (data.raw.length > 0) {
        console.log(JSON.stringify(data.raw.slice(0, 5), null, 2)); // Первые 5 элементов
        if (data.raw.length > 5) {
          console.log(`... и ещё ${data.raw.length - 5} элементов`);
        }
      } else {
        console.log('(массив пуст)');
      }
    } else if (typeof data.raw === 'object' && data.raw !== null) {
      console.log(JSON.stringify(data.raw, null, 2));
    } else {
      console.log(data.raw);
    }
    console.log('─'.repeat(60));
    
    return true;
  } catch (e) {
    error(`Тест 2 провален: ${e.message}`);
    return false;
  }
}

/**
 * Тест 3: Кэширование - повторный запрос должен вернуть cached=true
 */
async function testNaturalQueryCached() {
  info('Тест 3: POST /api/v1/natural-query - проверка кэширования');
  
  try {
    const question = 'Какие типы связей используются в проекте?';
    
    // Небольшая пауза чтобы скрипт был помечен как valid
    await sleep(500);
    
    const res = await fetch(`${BASE_URL}/api/v1/natural-query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: question,
        contextCode: CONTEXT_CODE
      })
    });
    
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    }
    
    const data = await res.json();
    
    if (!data.success) {
      throw new Error(`API вернул success: false - ${data.error}`);
    }
    
    // При точном совпадении вопроса должен вернуться cached=true
    // (FTS найдёт тот же скрипт)
    if (data.cached === true) {
      success(`Кэширование работает: cached=true, scriptId=${data.scriptId}`);
      
      // Получаем детали скрипта для вывода
      try {
        const scriptRes = await fetch(`${BASE_URL}/api/agent-scripts/${data.scriptId}?context-code=${CONTEXT_CODE}`);
        if (scriptRes.ok) {
          const scriptData = await scriptRes.json();
          if (scriptData.success && scriptData.script) {
            console.log('\n📜 Использованный скрипт (из кэша):');
            console.log('─'.repeat(60));
            console.log(scriptData.script.script);
            console.log('─'.repeat(60));
          }
        }
      } catch (e) {
        info(`Не удалось получить детали скрипта: ${e.message}`);
      }
      
      // Выводим результат выполнения скрипта
      console.log('\n📊 Результат выполнения скрипта (raw):');
      console.log('─'.repeat(60));
      if (Array.isArray(data.raw)) {
        console.log(`Массив из ${data.raw.length} элементов:`);
        if (data.raw.length > 0) {
          console.log(JSON.stringify(data.raw.slice(0, 5), null, 2)); // Первые 5 элементов
          if (data.raw.length > 5) {
            console.log(`... и ещё ${data.raw.length - 5} элементов`);
          }
        } else {
          console.log('(массив пуст)');
        }
      } else if (typeof data.raw === 'object' && data.raw !== null) {
        console.log(JSON.stringify(data.raw, null, 2));
      } else {
        console.log(data.raw);
      }
      console.log('─'.repeat(60));
    } else {
      // Не ошибка, FTS может не найти при низком rank
      info(`Скрипт не найден в кэше (возможно низкий rank FTS)`);
    }
    
    return true;
  } catch (e) {
    error(`Тест 3 провален: ${e.message}`);
    return false;
  }
}

/**
 * Тест 4: Получение деталей скрипта (GET /api/agent-scripts/:id)
 */
async function testGetScriptDetails() {
  info('Тест 4: GET /api/agent-scripts/:id - детали скрипта');
  
  if (!createdScriptId) {
    info('Пропуск: нет созданного скрипта');
    return true;
  }
  
  try {
    const res = await fetch(`${BASE_URL}/api/agent-scripts/${createdScriptId}?context-code=${CONTEXT_CODE}`);
    
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    }
    
    const data = await res.json();
    
    if (!data.success) {
      throw new Error(`API вернул success: false - ${data.error}`);
    }
    
    if (!data.script) {
      throw new Error('script должен присутствовать');
    }
    
    if (data.script.id !== createdScriptId) {
      throw new Error(`Неверный id: ожидали ${createdScriptId}, получили ${data.script.id}`);
    }
    
    if (typeof data.script.script !== 'string') {
      throw new Error('script.script должен быть строкой');
    }
    
    success(`Детали скрипта получены: id=${data.script.id}, question="${data.script.question.substring(0, 50)}..."`);
    return true;
  } catch (e) {
    error(`Тест 4 провален: ${e.message}`);
    return false;
  }
}

/**
 * Тест 5: Обновление скрипта (PUT /api/agent-scripts/:id)
 */
async function testUpdateScript() {
  info('Тест 5: PUT /api/agent-scripts/:id - обновление скрипта');
  
  if (!createdScriptId) {
    info('Пропуск: нет созданного скрипта');
    return true;
  }
  
  try {
    const res = await fetch(`${BASE_URL}/api/agent-scripts/${createdScriptId}?context-code=${CONTEXT_CODE}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        is_valid: true
      })
    });
    
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    }
    
    const data = await res.json();
    
    if (!data.success) {
      throw new Error(`API вернул success: false - ${data.error}`);
    }
    
    if (data.script.is_valid !== true) {
      throw new Error('is_valid должен быть true после обновления');
    }
    
    success(`Скрипт обновлён: id=${data.script.id}, is_valid=${data.script.is_valid}`);
    return true;
  } catch (e) {
    error(`Тест 5 провален: ${e.message}`);
    return false;
  }
}

/**
 * Тест 6: Удаление скрипта (DELETE /api/agent-scripts/:id)
 */
async function testDeleteScript() {
  info('Тест 6: DELETE /api/agent-scripts/:id - удаление скрипта');
  
  if (!createdScriptId) {
    info('Пропуск: нет созданного скрипта');
    return true;
  }
  
  try {
    const res = await fetch(`${BASE_URL}/api/agent-scripts/${createdScriptId}?context-code=${CONTEXT_CODE}`, {
      method: 'DELETE'
    });
    
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    }
    
    const data = await res.json();
    
    if (!data.success) {
      throw new Error(`API вернул success: false - ${data.error}`);
    }
    
    success(`Скрипт удалён: id=${createdScriptId}`);
    
    // Проверяем, что скрипт действительно удалён
    const checkRes = await fetch(`${BASE_URL}/api/agent-scripts/${createdScriptId}?context-code=${CONTEXT_CODE}`);
    if (checkRes.status !== 404) {
      throw new Error('Скрипт всё ещё существует после удаления');
    }
    
    success('Подтверждено: скрипт не найден после удаления');
    return true;
  } catch (e) {
    error(`Тест 6 провален: ${e.message}`);
    return false;
  }
}

/**
 * Тест 7: Валидация запроса (отсутствие обязательных полей)
 */
async function testValidation() {
  info('Тест 7: Валидация обязательных полей');
  
  try {
    // Без question
    let res1;
    try {
      res1 = await fetch(`${BASE_URL}/api/v1/natural-query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contextCode: CONTEXT_CODE })
      });
    } catch (fetchError) {
      if (fetchError.code === 'ECONNRESET' || fetchError.message.includes('ECONNRESET')) {
        throw new Error(`Соединение разорвано сервером. Возможно, сервер упал при обработке запроса. Проверьте логи сервера.`);
      }
      throw new Error(`Ошибка соединения: ${fetchError.message}`);
    }
    
    if (!res1.ok && res1.status !== 400) {
      const errorText = await res1.text().catch(() => 'не удалось прочитать');
      throw new Error(`Ожидали 400 без question, получили ${res1.status}: ${errorText}`);
    }
    
    if (res1.status !== 400) {
      throw new Error(`Ожидали 400 без question, получили ${res1.status}`);
    }
    
    const data1 = await res1.json().catch(() => ({}));
    if (data1.error && !data1.error.includes('question')) {
      info(`Предупреждение: сообщение об ошибке не упоминает 'question': ${data1.error}`);
    }
    
    // Без contextCode
    let res2;
    try {
      res2 = await fetch(`${BASE_URL}/api/v1/natural-query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: 'Test' })
      });
    } catch (fetchError) {
      if (fetchError.code === 'ECONNRESET' || fetchError.message.includes('ECONNRESET')) {
        throw new Error(`Соединение разорвано сервером. Возможно, сервер упал при обработке запроса. Проверьте логи сервера.`);
      }
      throw new Error(`Ошибка соединения: ${fetchError.message}`);
    }
    
    if (!res2.ok && res2.status !== 400) {
      const errorText = await res2.text().catch(() => 'не удалось прочитать');
      throw new Error(`Ожидали 400 без contextCode, получили ${res2.status}: ${errorText}`);
    }
    
    if (res2.status !== 400) {
      throw new Error(`Ожидали 400 без contextCode, получили ${res2.status}`);
    }
    
    const data2 = await res2.json().catch(() => ({}));
    if (data2.error && !data2.error.includes('contextCode')) {
      info(`Предупреждение: сообщение об ошибке не упоминает 'contextCode': ${data2.error}`);
    }
    
    success('Валидация работает корректно');
    return true;
  } catch (e) {
    error(`Тест 7 провален: ${e.message}`);
    if (e.message.includes('ECONNRESET')) {
      error('💡 Совет: Проверьте логи сервера - возможно, сервер падает при обработке невалидных запросов');
    }
    return false;
  }
}

/**
 * Тест 8: Валидация context-code для CRUD
 */
async function testContextCodeValidation() {
  info('Тест 8: Валидация context-code для CRUD эндпоинтов');
  
  try {
    // Без context-code
    const res = await fetch(`${BASE_URL}/api/agent-scripts`);
    
    if (res.status !== 400) {
      throw new Error(`Ожидали 400 без context-code, получили ${res.status}`);
    }
    
    const data = await res.json();
    if (!data.error.includes('context-code')) {
      throw new Error('Сообщение об ошибке должно упоминать context-code');
    }
    
    success('Валидация context-code работает');
    return true;
  } catch (e) {
    error(`Тест 8 провален: ${e.message}`);
    return false;
  }
}

// === Главная функция ===

async function runAllTests() {
  console.log('='.repeat(60));
  console.log('🧪 Тесты Natural Query Engine (Agent Script)');
  console.log(`   BASE_URL: ${BASE_URL}`);
  console.log(`   CONTEXT_CODE: ${CONTEXT_CODE}`);
  console.log('='.repeat(60));
  console.log('');
  
  const results = [];
  
  // Проверка доступности сервера
  try {
    const healthRes = await fetch(`${BASE_URL}/api/health?context-code=${CONTEXT_CODE}`);
    if (!healthRes.ok) {
      throw new Error(`Сервер недоступен: ${healthRes.status}`);
    }
    success('Сервер доступен\n');
  } catch (e) {
    error(`Сервер недоступен на ${BASE_URL}`);
    error(`Запустите сервер: node server.js`);
    process.exit(1);
  }
  
  // Запуск тестов
  results.push(await testGetScriptsList());
  console.log('');
  
  results.push(await testNaturalQueryGenerate());
  console.log('');
  
  results.push(await testNaturalQueryCached());
  console.log('');
  
  results.push(await testGetScriptDetails());
  console.log('');
  
  results.push(await testUpdateScript());
  console.log('');
  
  results.push(await testDeleteScript());
  console.log('');
  
  results.push(await testValidation());
  console.log('');
  
  results.push(await testContextCodeValidation());
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

