// test_app_config.js
// Простой тест для проверки API управления конфигурацией приложения

const BASE_URL = 'http://localhost:3200';

async function testAppConfigAPI() {
  console.log('=== Тест API управления конфигурацией приложения ===\n');

  try {
    // 1. GET /api/config - получить текущую конфигурацию
    console.log('1. Получение текущей конфигурации...');
    let response = await fetch(`${BASE_URL}/api/config`);
    let data = await response.json();
    
    if (data.success) {
      console.log('✅ Текущая конфигурация получена:');
      console.log(JSON.stringify(data.config, null, 2));
    } else {
      console.error('❌ Ошибка получения конфига:', data.error);
      return;
    }

    const originalConfig = data.config;
    console.log('\n---\n');

    // 2. PATCH /api/config - обновить конфигурацию (изменим LOG_LEVEL)
    console.log('2. Обновление конфигурации (LOG_LEVEL -> debug)...');
    response = await fetch(`${BASE_URL}/api/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        LOG_LEVEL: 'debug',
        NATURAL_QUERY_SUGGEST_LIMIT: 10
      })
    });
    data = await response.json();

    if (data.success) {
      console.log('✅ Конфигурация обновлена:');
      console.log(`  LOG_LEVEL: ${data.config.LOG_LEVEL}`);
      console.log(`  NATURAL_QUERY_SUGGEST_LIMIT: ${data.config.NATURAL_QUERY_SUGGEST_LIMIT}`);
    } else {
      console.error('❌ Ошибка обновления конфига:', data.error);
      if (data.validationErrors) {
        console.error('  Ошибки валидации:', data.validationErrors);
      }
    }
    console.log('\n---\n');

    // 3. Проверка валидации - попытка установить невалидный URL
    console.log('3. Проверка валидации (невалидный URL)...');
    response = await fetch(`${BASE_URL}/api/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        KOSMOS_BASE_URL: 'not-a-valid-url'
      })
    });
    data = await response.json();

    if (!data.success && response.status === 400) {
      console.log('✅ Валидация работает корректно:');
      console.log(`  Ошибка: ${data.error}`);
      console.log(`  Детали: ${data.validationErrors?.join(', ')}`);
    } else {
      console.warn('⚠️ Валидация не сработала как ожидалось');
    }
    console.log('\n---\n');

    // 4. Проверка валидации - попытка установить невалидный LOG_LEVEL
    console.log('4. Проверка валидации (невалидный LOG_LEVEL)...');
    response = await fetch(`${BASE_URL}/api/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        LOG_LEVEL: 'invalid_level'
      })
    });
    data = await response.json();

    if (!data.success && response.status === 400) {
      console.log('✅ Валидация работает корректно:');
      console.log(`  Ошибка: ${data.error}`);
      console.log(`  Детали: ${data.validationErrors?.join(', ')}`);
    } else {
      console.warn('⚠️ Валидация не сработала как ожидалось');
    }
    console.log('\n---\n');

    // 5. Восстановление оригинальной конфигурации
    console.log('5. Восстановление оригинальной конфигурации...');
    response = await fetch(`${BASE_URL}/api/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        LOG_LEVEL: originalConfig.LOG_LEVEL,
        NATURAL_QUERY_SUGGEST_LIMIT: originalConfig.NATURAL_QUERY_SUGGEST_LIMIT
      })
    });
    data = await response.json();

    if (data.success) {
      console.log('✅ Оригинальная конфигурация восстановлена');
    } else {
      console.error('❌ Ошибка восстановления конфига:', data.error);
    }

    console.log('\n=== Тест завершён успешно ===');
  } catch (error) {
    console.error('❌ Ошибка выполнения теста:', error.message);
  }
}

// Запуск теста
testAppConfigAPI();
