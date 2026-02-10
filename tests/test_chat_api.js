const fetch = require('node-fetch');

const BASE_URL = 'http://localhost:3200';
const TEST_CONTEXT_CODE = 'TEST';

/**
 * Тест для маршрута POST /api/chat
 * 
 * Проверяет:
 * 1. Валидацию обязательного параметра context-code
 * 2. Валидацию обязательного поля message в теле запроса
 * 3. Успешный запрос с корректными параметрами
 * 4. Структуру ответа согласно api-contract.yaml (ChatResponse)
 */
async function testChatApi() {
  console.log('=== Тест маршрута POST /api/chat ===\n');

  // ────────────────────────────────────────────────────────
  // Тест 1: Отсутствует обязательный параметр context-code
  // ────────────────────────────────────────────────────────
  console.log('Тест 1: Запрос без параметра context-code (ожидаем 400)');
  try {
    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Тестовый вопрос' })
    });

    if (res.status === 400) {
      const data = await res.json();
      console.log('  [SUCCESS] Получен статус 400, как ожидалось');
      console.log(`  Сообщение об ошибке: ${data.error}`);
    } else {
      console.error(`  [FAILURE] Ожидался статус 400, но получен ${res.status}`);
    }
  } catch (error) {
    console.error(`  [FAILURE] Ошибка при запросе:`, error.message);
  }

  // ────────────────────────────────────────────────────────
  // Тест 2: Отсутствует обязательное поле message
  // ────────────────────────────────────────────────────────
  console.log('\nТест 2: Запрос без поля message (ожидаем 400)');
  try {
    const res = await fetch(`${BASE_URL}/api/chat?context-code=${TEST_CONTEXT_CODE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    if (res.status === 400) {
      const data = await res.json();
      console.log('  [SUCCESS] Получен статус 400, как ожидалось');
      console.log(`  Сообщение об ошибке: ${data.error}`);
    } else {
      console.error(`  [FAILURE] Ожидался статус 400, но получен ${res.status}`);
    }
  } catch (error) {
    console.error(`  [FAILURE] Ошибка при запросе:`, error.message);
  }

  // ────────────────────────────────────────────────────────
  // Тест 3: Поле message не является строкой
  // ────────────────────────────────────────────────────────
  console.log('\nТест 3: Поле message не является строкой (ожидаем 400)');
  try {
    const res = await fetch(`${BASE_URL}/api/chat?context-code=${TEST_CONTEXT_CODE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 12345 })
    });

    if (res.status === 400) {
      const data = await res.json();
      console.log('  [SUCCESS] Получен статус 400, как ожидалось');
      console.log(`  Сообщение об ошибке: ${data.error}`);
    } else {
      console.error(`  [FAILURE] Ожидался статус 400, но получен ${res.status}`);
    }
  } catch (error) {
    console.error(`  [FAILURE] Ошибка при запросе:`, error.message);
  }

  // ────────────────────────────────────────────────────────
  // Тест 4: Успешный запрос с корректными параметрами
  // ────────────────────────────────────────────────────────
  console.log('\nТест 4: Успешный запрос с корректными параметрами');
  try {
    const testMessage = 'Что такое векторное хранилище?';
    const res = await fetch(`${BASE_URL}/api/chat?context-code=${TEST_CONTEXT_CODE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: testMessage })
    });

    if (res.ok) {
      const data = await res.json();
      console.log('  [SUCCESS] Получен ответ с кодом 200');
      
      // Проверка структуры ответа согласно ChatResponse из api-contract.yaml
      const hasResponse = typeof data.response === 'string';
      const hasTimestamp = typeof data.timestamp === 'string';
      const hasUsedContextIds = Array.isArray(data.usedContextIds) || data.usedContextIds === undefined;

      console.log(`  Структура ответа:`);
      console.log(`    response (string): ${hasResponse ? '✓' : '✗'}`);
      console.log(`    timestamp (string): ${hasTimestamp ? '✓' : '✗'}`);
      console.log(`    usedContextIds (array, optional): ${hasUsedContextIds ? '✓' : '✗'}`);

      if (hasResponse && hasTimestamp && hasUsedContextIds) {
        console.log('  [SUCCESS] Структура ответа соответствует ChatResponse');
        console.log(`  Ответ LLM (первые 100 символов): ${data.response.substring(0, 100)}...`);
        
        if (data.usedContextIds && data.usedContextIds.length > 0) {
          console.log(`  Использовано ${data.usedContextIds.length} чанков контекста`);
        } else {
          console.log('  [INFO] Контекст не использовался или массив пустой');
        }
      } else {
        console.error('  [FAILURE] Структура ответа не соответствует ChatResponse');
      }
    } else {
      const errorData = await res.json().catch(() => ({ error: 'Не удалось распарсить JSON' }));
      console.error(`  [FAILURE] Получен статус ${res.status}`);
      console.error(`  Ошибка:`, errorData);
    }
  } catch (error) {
    console.error(`  [FAILURE] Ошибка при запросе:`, error.message);
  }

  // ────────────────────────────────────────────────────────
  // Тест 5: Проверка альтернативного формата context-code (camelCase)
  // ────────────────────────────────────────────────────────
  console.log('\nТест 5: Проверка альтернативного формата contextCode (camelCase)');
  try {
    const testMessage = 'Как работает RAG?';
    const res = await fetch(`${BASE_URL}/api/chat?contextCode=${TEST_CONTEXT_CODE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: testMessage })
    });

    if (res.ok) {
      const data = await res.json();
      console.log('  [SUCCESS] Получен ответ с кодом 200');
      console.log('  [SUCCESS] camelCase формат параметра contextCode тоже работает');
    } else {
      console.error(`  [FAILURE] Получен статус ${res.status}`);
    }
  } catch (error) {
    console.error(`  [FAILURE] Ошибка при запросе:`, error.message);
  }

  // ────────────────────────────────────────────────────────
  // Тест 6: Проверка работы с несуществующим context-code
  // ────────────────────────────────────────────────────────
  console.log('\nТест 6: Запрос с несуществующим context-code');
  try {
    const testMessage = 'Тестовый вопрос';
    const nonExistentContext = 'NON_EXISTENT_CONTEXT_' + Date.now();
    const res = await fetch(`${BASE_URL}/api/chat?context-code=${nonExistentContext}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: testMessage })
    });

    if (res.ok) {
      const data = await res.json();
      console.log('  [SUCCESS] Сервер обработал запрос (код 200)');
      console.log('  [INFO] Ответ получен даже для несуществующего контекста (RAG вернул ответ без контекста)');
      
      if (!data.usedContextIds || data.usedContextIds.length === 0) {
        console.log('  [INFO] Как ожидалось, контекст не использовался');
      }
    } else {
      console.error(`  [FAILURE] Получен статус ${res.status}`);
    }
  } catch (error) {
    console.error(`  [FAILURE] Ошибка при запросе:`, error.message);
  }

  console.log('\n=== Тест маршрута POST /api/chat завершён ===');
}

// Запуск теста
testChatApi().catch(error => {
  console.error('\n[FATAL ERROR] Критическая ошибка во время теста:', error);
  process.exit(1);
});
