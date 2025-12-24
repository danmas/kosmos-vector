const fs = require('fs');
const path = require('path');

// === Конфигурация API ===
const BASE_URL = 'http://localhost:3200';

async function apiPost(endpoint, body) {
  try {
    const response = await fetch(`${BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error(`Ошибка API ${endpoint}:`, response.status, data);
      process.exit(1);
    }

    return data;
  } catch (err) {
    console.error(`Сетевая ошибка при вызове ${endpoint}:`, err.message);
    process.exit(1);
  }
}

// === Проверка аргументов ===
if (process.argv.length < 3) {
  console.error('Ошибка: не указан путь к SQL-файлу.');
  console.error('Использование: node parse_sql_functions.js <путь_к_файлу.sql>');
  process.exit(1);
}

const sqlFilePath = process.argv[2];
const filename = path.basename(sqlFilePath); // Например: api_auct_sort.sql

if (!fs.existsSync(sqlFilePath)) {
  console.error(`Ошибка: файл не найден: ${sqlFilePath}`);
  process.exit(1);
}

// === Чтение SQL-файла ===
let sqlContent;
try {
  sqlContent = fs.readFileSync(sqlFilePath, 'utf8');
} catch (err) {
  console.error(`Ошибка чтения файла: ${err.message}`);
  process.exit(1);
}

// === Регулярное выражение для поиска функций ===
const functionRegex = new RegExp(
  '(={10,}|-{10,})\\s*\\n' +
  '((?:--[^\\n]*\\n)*?)' +
  '(={10,}|-{10,})\\s*\\n' +
  '(create\\s+or\\s+replace\\s+function\\s+' +
  '(?:[\\w]+\\.)?[\\w]+\\s*\\([^\\)]*\\)' +
  '[\\s\\S]*?' +
  'language\\s+\\w+\\s*;?' +
  '\\s*(?:--.*)?\\s*$)',
  'gim'
);

const functions = [];
let match;
let index = 0;

while ((match = functionRegex.exec(sqlContent)) !== null) {
  index++;
  const rawCommentBlock = match[2];
  const functionDefinition = match[4].trim();

  // Комментарий
  const commentLines = rawCommentBlock
    .split('\n')
    .map(line => line.replace(/^--\s?/, '').trimEnd());
  const comment = commentLines.join('\n').trim();

  // Тело функции
  let body = functionDefinition;
  if (!body.endsWith(';')) body += ';';

  // Полное имя (со схемой)
  const fullNameMatch = body.match(/create\s+or\s+replace\s+function\s+((?:[\w]+\.)?[\w]+)\s*\(/i);
  const full_name = fullNameMatch ? fullNameMatch[1].trim() : `unknown_function_${index}`;

  // Короткое имя (sname)
  const sname = full_name.split('.').pop();

  // Сигнатура
  const signatureMatch = body.match(/create\s+or\s+replace\s+function\s+((?:[\w]+\.)?[\w]+\s*\([^\)]*\))/i);
  const signature = signatureMatch ? signatureMatch[1].trim() : full_name;

  functions.push({
    full_name: full_name,
    sname: sname,
    comment: comment || null,
    signature: signature,
    body: body
  });
}

// === Если функций не найдено ===
if (functions.length === 0) {
  console.log('Внимание: функции с блоками комментариев --- не найдены.');
  process.exit(0);
}

// === Отправка в систему ===
(async () => {
  try {
    // Шаг 1: Регистрация файла
    console.log('=== Шаг 1: Регистрация файла ===');
    const registerRes = await apiPost('/register-file', {
      filename: filename,
      contextCode: 'CARL'
    });
    const fileId = registerRes.fileId;
    console.log(`Файл зарегистрирован: ${filename} → fileId = ${fileId}\n`);

    // Обработка каждой функции
    for (const func of functions) {
      console.log(`Обработка функции: ${func.full_name} (${func.sname})`);

      // Шаг 2: Создание/обновление AI Item
      console.log('   → Создание AI Item...');
      const aiItemRes = await apiPost('/create-or-update-ai-item', {
        full_name: func.full_name,
        contextCode: 'CARL',
        type: 'function',
        sName: func.sname,
        fileId: fileId
      });
      const aiItemId = aiItemRes.aiItem.id;
      console.log(`   AI Item: aiItemId = ${aiItemId}`);

      // Шаг 3: Сохранение чанка уровня 0 (весь JSON функции)
      console.log('   → Сохранение чанка уровня 0...');
      const chunkContent = {
        full_name: func.full_name,
        sname: func.sname,
        comment: func.comment,
        signature: func.signature,
        body: func.body
      };

      const chunk0Res = await apiPost('/save-chunk', {
        fileId: fileId,
        content: chunkContent,
        chunkIndex: 0,
        level: '0-исходник',
        type: 'function',
        full_name: func.full_name,
        sName: func.sname,
        aiItemId: aiItemId
      });
      const chunk0Id = chunk0Res.chunkId;
      console.log(`   Чанк уровня 0 сохранён: chunkId = ${chunk0Id}\n`);
    }

    console.log('Готово! Все функции успешно загружены в систему.');

    // Опционально: сохранить локальный JSON для отладки
    const outputPath = path.join(path.dirname(sqlFilePath), 'parsed_functions.json');
    fs.writeFileSync(outputPath, JSON.stringify(functions, null, 2), 'utf8');
    console.log(`Локальный JSON сохранён: ${outputPath}`);

  } catch (err) {
    console.error('Критическая ошибка:', err);
    process.exit(1);
  }
})();