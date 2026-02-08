// Демонстрация правильного использования маршрута /vectorize-ai-items
// В соответствии с реальной реализацией, а не с контрактом

const axios = require('axios'); // или используйте fetch

// Правильный URL для маршрута vectorize-ai-items (как он есть на сервере)
const BASE_URL = `http://localhost:${process.env.PORT || 3200}`;

// Функция для векторизации ai_item по full_name
async function vectorizeAiItemByFullName(fullName, contextCode, force = false) {
  try {
    const response = await fetch(`${BASE_URL}/vectorize-ai-items?context-code=${contextCode}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fullNames: [fullName],
        force: force
      })
    });

    const result = await response.json();
    console.log('Ответ от /vectorize-ai-items:', result);
    return result;
  } catch (error) {
    console.error('Ошибка при вызове /vectorize-ai-items:', error.message);
    throw error;
  }
}

// Функция для векторизации ai_item по ID
async function vectorizeAiItemById(aiItemId, contextCode, force = false) {
  try {
    const response = await fetch(`${BASE_URL}/vectorize-ai-items?context-code=${contextCode}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        aiItemIds: [aiItemId],
        force: force
      })
    });

    const result = await response.json();
    console.log('Ответ от /vectorize-ai-items (по ID):', result);
    return result;
  } catch (error) {
    console.error('Ошибка при вызове /vectorize-ai-items (по ID):', error.message);
    throw error;
  }
}

// Пример использования
async function demonstrateCorrectUsage() {
  console.log('=== Демонстрация правильного использования маршрута /vectorize-ai-items ===');
  console.log('Примечание: Маршрут доступен как /vectorize-ai-items, а не как /api/files/vectorize-ai-items');
  
  // Пример вызова (значения будут зависеть от ваших данных в БД)
  // const result1 = await vectorizeAiItemByFullName('your.function.name', 'YOUR_CONTEXT');
  // const result2 = await vectorizeAiItemById(123, 'YOUR_CONTEXT');
  
  console.log('\nДля фактического вызова замените параметры на реальные значения из вашей базы данных.');
  console.log('Маршрут корректно работает при вызове как: http://localhost:3200/vectorize-ai-items');
}

// Запуск демонстрации
demonstrateCorrectUsage().catch(console.error);

module.exports = {
  vectorizeAiItemByFullName,
  vectorizeAiItemById
};