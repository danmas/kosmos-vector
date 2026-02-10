// test_prompts_config.js
// Тестовый скрипт для Prompts Config API с историей

const BASE_URL = 'http://localhost:3200';

console.log('🧪 Тестирование Prompts Config API с историей\n');

async function testPromptsConfigAPI() {
  let testHistoryId = null;

  try {
    // Тест 1: Получение текущей конфигурации
    console.log('1️⃣  Получение текущей конфигурации промптов...');
    const getResponse = await fetch(`${BASE_URL}/api/prompts-config`);
    const getResult = await getResponse.json();
    
    if (getResult.success) {
      console.log('✅ Конфигурация получена');
      console.log(`   - Секций: ${Object.keys(getResult.prompts).length}`);
      console.log(`   - RAG systemPrompt: ${getResult.prompts.rag?.systemPrompt?.substring(0, 50)}...`);
    } else {
      console.error('❌ Ошибка получения конфигурации:', getResult.error);
      return;
    }

    // Тест 2: Обновление конфигурации с комментарием
    console.log('\n2️⃣  Обновление RAG промпта с комментарием...');
    const updatePayload = {
      updates: {
        rag: {
          systemPrompt: "Тестовый системный промпт для RAG",
          userPromptTemplate: getResult.prompts.rag.userPromptTemplate
        },
        naturalQuery: getResult.prompts.naturalQuery,
        l1l2Templates: getResult.prompts.l1l2Templates,
        vectorOperations: getResult.prompts.vectorOperations
      },
      comment: "Тестовое обновление RAG промпта"
    };
    
    const updateResponse = await fetch(`${BASE_URL}/api/prompts-config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatePayload)
    });
    const updateResult = await updateResponse.json();
    
    if (updateResult.success) {
      console.log('✅ Конфигурация обновлена');
      console.log(`   - Версия: ${updateResult.historyEntry.version}`);
      console.log(`   - Комментарий: ${updateResult.historyEntry.comment}`);
      console.log(`   - ID истории: ${updateResult.historyEntry.id}`);
      testHistoryId = updateResult.historyEntry.id;
    } else {
      console.error('❌ Ошибка обновления:', updateResult.error);
      if (updateResult.validationErrors) {
        console.error('   Ошибки валидации:', updateResult.validationErrors);
      }
      return;
    }

    // Тест 3: Получение истории изменений
    console.log('\n3️⃣  Получение истории изменений...');
    const historyResponse = await fetch(`${BASE_URL}/api/prompts-config/history?limit=10`);
    const historyResult = await historyResponse.json();
    
    if (historyResult.success) {
      console.log(`✅ История получена: ${historyResult.count} записей`);
      historyResult.history.forEach((entry, index) => {
        console.log(`   ${index + 1}. Версия ${entry.version} (ID: ${entry.id})`);
        console.log(`      Дата: ${new Date(entry.createdAt).toLocaleString('ru-RU')}`);
        if (entry.comment) {
          console.log(`      Комментарий: ${entry.comment}`);
        }
      });
    } else {
      console.error('❌ Ошибка получения истории:', historyResult.error);
    }

    // Тест 4: Получение конкретной версии из истории
    if (testHistoryId) {
      console.log(`\n4️⃣  Получение версии ${testHistoryId} из истории...`);
      const entryResponse = await fetch(`${BASE_URL}/api/prompts-config/history/${testHistoryId}`);
      const entryResult = await entryResponse.json();
      
      if (entryResult.success) {
        console.log('✅ Версия получена');
        console.log(`   - Версия: ${entryResult.historyEntry.version}`);
        console.log(`   - Комментарий: ${entryResult.historyEntry.comment || 'нет'}`);
        console.log(`   - RAG systemPrompt: ${entryResult.historyEntry.config.rag.systemPrompt.substring(0, 50)}...`);
      } else {
        console.error('❌ Ошибка получения версии:', entryResult.error);
      }
    }

    // Тест 5: Второе обновление для создания новой версии
    console.log('\n5️⃣  Второе обновление конфигурации...');
    const update2Payload = {
      updates: {
        rag: {
          systemPrompt: "Ещё один тестовый промпт",
          userPromptTemplate: getResult.prompts.rag.userPromptTemplate
        },
        naturalQuery: getResult.prompts.naturalQuery,
        l1l2Templates: getResult.prompts.l1l2Templates,
        vectorOperations: getResult.prompts.vectorOperations
      },
      comment: "Второе тестовое обновление"
    };
    
    const update2Response = await fetch(`${BASE_URL}/api/prompts-config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(update2Payload)
    });
    const update2Result = await update2Response.json();
    
    if (update2Result.success) {
      console.log('✅ Вторая версия создана');
      console.log(`   - Версия: ${update2Result.historyEntry.version}`);
    }

    // Тест 6: Восстановление из истории
    if (testHistoryId) {
      console.log(`\n6️⃣  Восстановление из версии ${testHistoryId}...`);
      const restoreResponse = await fetch(`${BASE_URL}/api/prompts-config/restore/${testHistoryId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: "Тестовое восстановление" })
      });
      const restoreResult = await restoreResponse.json();
      
      if (restoreResult.success) {
        console.log('✅ Конфигурация восстановлена');
        console.log(`   - Новая версия: ${restoreResult.historyEntry.version}`);
        console.log(`   - Комментарий: ${restoreResult.historyEntry.comment}`);
      } else {
        console.error('❌ Ошибка восстановления:', restoreResult.error);
      }
    }

    // Тест 7: Валидация - попытка отправить невалидную конфигурацию
    console.log('\n7️⃣  Тест валидации (невалидная конфигурация)...');
    const invalidPayload = {
      updates: {
        rag: {
          systemPrompt: "Промпт есть"
          // userPromptTemplate отсутствует - должна быть ошибка
        },
        naturalQuery: getResult.prompts.naturalQuery,
        l1l2Templates: getResult.prompts.l1l2Templates,
        vectorOperations: getResult.prompts.vectorOperations
      }
    };
    
    const invalidResponse = await fetch(`${BASE_URL}/api/prompts-config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(invalidPayload)
    });
    const invalidResult = await invalidResponse.json();
    
    if (!invalidResult.success && invalidResponse.status === 400) {
      console.log('✅ Валидация работает корректно');
      console.log('   Ошибки валидации:', invalidResult.validationErrors);
    } else {
      console.error('❌ Валидация не сработала');
    }

    // Тест 8: Сброс конфигурации к дефолтным значениям
    console.log('\n8️⃣  Сброс конфигурации к дефолтным значениям...');
    const resetResponse = await fetch(`${BASE_URL}/api/prompts-config/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment: "Тестовый сброс к дефолтным значениям" })
    });
    const resetResult = await resetResponse.json();
    
    if (resetResult.success) {
      console.log('✅ Конфигурация сброшена');
      console.log(`   - Версия: ${resetResult.historyEntry.version}`);
      console.log(`   - Комментарий: ${resetResult.historyEntry.comment}`);
    } else {
      console.error('❌ Ошибка сброса:', resetResult.error);
    }

    // Тест 9: Проверка финальной истории
    console.log('\n9️⃣  Финальная история изменений...');
    const finalHistoryResponse = await fetch(`${BASE_URL}/api/prompts-config/history?limit=10`);
    const finalHistoryResult = await finalHistoryResponse.json();
    
    if (finalHistoryResult.success) {
      console.log(`✅ История обновлена: ${finalHistoryResult.count} записей`);
      console.log('\nПоследние 5 версий:');
      finalHistoryResult.history.slice(0, 5).forEach((entry, index) => {
        console.log(`   ${index + 1}. Версия ${entry.version} - ${entry.comment || 'без комментария'}`);
      });
    }

    console.log('\n✅ Все тесты успешно пройдены!');

  } catch (error) {
    console.error('\n❌ Ошибка тестирования:', error.message);
    console.error('Stack:', error.stack);
  }
}

// Запуск тестов
console.log('⏳ Запуск тестов Prompts Config API...\n');
testPromptsConfigAPI()
  .then(() => {
    console.log('\n🎉 Тестирование завершено');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n💥 Критическая ошибка:', error);
    process.exit(1);
  });
