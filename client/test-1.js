// test-1.js
// Тестовый скрипт для ручной регистрации SQL-файла и его объектов через API
// Запуск: node test-1.js
// Убедитесь, что сервер запущен на http://localhost:3005

const fetch = require('node-fetch'); // npm install node-fetch@2.6.1 если нет

const BASE_URL = 'http://localhost:3005';

async function apiPost(endpoint, body) {
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await response.json();
  if (!response.ok) {
    console.error(`Ошибка в ${endpoint}:`, data);
    process.exit(1);
  }
  return data;
}

(async () => {
  console.log('=== Шаг 1: Регистрация файла ===');
  const registerRes = await apiPost('/register-file', {
    filename: '1.sql',
    contextCode: 'MY_DB'
  });
  const fileId = registerRes.fileId;
  console.log(`Файл зарегистрирован. fileId = ${fileId}\n`);

  console.log('=== Шаг 2: Создание AI Item для функции ===');
  const aiItemRes = await apiPost('/create-or-update-ai-item', {
    full_name: 'public.calculate_salary',
    contextCode: 'MY_DB',
    type: 'function',
    sName: 'calculate_salary',
    fileId: fileId
  });
  const aiItemId = aiItemRes.aiItem.id;
  console.log(`AI Item создан/обновлён. aiItemId = ${aiItemId}\n`);

  console.log('=== Шаг 3: Сохранение чанка уровня 0 (исходный код функции) ===');
  const chunk0Res = await apiPost('/save-chunk', {
    fileId: fileId,
    content: `CREATE OR REPLACE FUNCTION public.calculate_salary(employee_id INT, base_salary NUMERIC)
RETURNS NUMERIC AS $$
BEGIN
    RETURN base_salary * 1.15 + 5000;
END;
$$ LANGUAGE plpgsql;`,
    chunkIndex: 0,
    level: '0-исходник',
    type: 'function',
    full_name: 'public.calculate_salary',
    sName: 'calculate_salary',
    aiItemId: aiItemId
  });
  const chunk0Id = chunk0Res.chunkId;
  console.log(`Чанк уровня 0 сохранён. chunkId = ${chunk0Id}\n`);

  console.log('=== Шаг 4: Сохранение чанка уровня 1 (описание функции) ===');
  const chunk1Res = await apiPost('/save-chunk', {
    fileId: fileId,
    content: `Функция calculate_salary рассчитывает итоговую зарплату сотрудника с учётом фиксированной премии в 5000 и коэффициента 1.15 к базовой ставке. Используется в отчётах по зарплатам.`,
    chunkIndex: 100,
    level: '1-описание',
    type: 'description',
    full_name: 'public.calculate_salary',
    aiItemId: aiItemId,
    parentChunkId: chunk0Id  // привязка к чанку уровня 0
  });
  console.log(`Чанк уровня 1 сохранён. chunkId = ${chunk1Res.chunkId}\n`);

  console.log('=== Всё успешно завершено ===');
  console.log(`Файл: 1.sql (fileId=${fileId})`);
  console.log(`Функция: public.calculate_salary (aiItemId=${aiItemId})`);
  console.log(`Чанки: уровень 0 (id=${chunk0Id}), уровень 1 (id=${chunk1Res.chunkId})`);
})();