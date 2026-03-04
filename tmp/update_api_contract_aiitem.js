const fs = require('fs');
const path = require('path');

const yamlPath = path.join(__dirname, '..', 'docs', 'api-contract.yaml');

// Читаем файл
const content = fs.readFileSync(yamlPath, 'utf8');
const lines = content.split('\n');

// Находим строку с AiItem: (полная схема, не AiItemSummary)
let aiItemIndex = -1;
let filePathIndex = -1;

for (let i = 0; i < lines.length; i++) {
  if (lines[i].trim() === 'AiItem:' && i > 0) {
    // Проверяем, что это не внутри комментария
    const prevLine = lines[i - 1] || '';
    if (!prevLine.includes('# ──')) {
      aiItemIndex = i;
      // Ищем filePath после этого
      for (let j = i + 1; j < Math.min(i + 30, lines.length); j++) {
        if (lines[j].includes('filePath:')) {
          filePathIndex = j;
          break;
        }
      }
      break;
    }
  }
}

if (aiItemIndex < 0 || filePathIndex < 0) {
  console.log('⚠ Не найдена секция AiItem или поле filePath');
  console.log('aiItemIndex:', aiItemIndex);
  console.log('filePathIndex:', filePathIndex);
  
  if (aiItemIndex >= 0) {
    console.log('\nКонтекст вокруг AiItem:');
    for (let i = aiItemIndex; i < Math.min(aiItemIndex + 25, lines.length); i++) {
      console.log(`${i + 1}: ${lines[i]}`);
    }
  }
  
  process.exit(1);
}

// Проверяем, не добавлено ли уже поле isVectorized
const contextAfter = lines.slice(filePathIndex, filePathIndex + 5).join('\n');
if (contextAfter.includes('isVectorized')) {
  console.log('✓ Поле isVectorized уже присутствует в AiItem');
  process.exit(0);
}

// Вставляем isVectorized после filePath
const newLines = [
  ...lines.slice(0, filePathIndex + 1),
  '        isVectorized:',
  '          type: boolean',
  '          description: Флаг наличия хотя бы одного embedding для чанков этого ai_item',
  '          default: false',
  ...lines.slice(filePathIndex + 1)
];

// Сохраняем обновленный файл
fs.writeFileSync(yamlPath, newLines.join('\n'), 'utf8');

console.log('✓ API контракт успешно обновлен!');
console.log('✓ Добавлено поле isVectorized в схему AiItem после строки', filePathIndex + 1);
console.log('\nДобавленные строки:');
console.log('        isVectorized:');
console.log('          type: boolean');
console.log('          description: Флаг наличия хотя бы одного embedding для чанков этого ai_item');
console.log('          default: false');
