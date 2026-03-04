const fs = require('fs');
const path = require('path');

const yamlPath = path.join(__dirname, '..', 'docs', 'api-contract.yaml');

// Читаем файл
const content = fs.readFileSync(yamlPath, 'utf8');
const lines = content.split('\n');

// Находим строку с AiItemSummary и добавляем isVectorized после default: []
let aiItemSummaryIndex = -1;
let tagsDefaultIndex = -1;

for (let i = 0; i < lines.length; i++) {
  if (lines[i].trim() === 'AiItemSummary:') {
    aiItemSummaryIndex = i;
  }
  if (aiItemSummaryIndex >= 0 && lines[i].includes('default: []')) {
    tagsDefaultIndex = i;
    break;
  }
}

if (aiItemSummaryIndex < 0 || tagsDefaultIndex < 0) {
  console.log('⚠ Не найдена секция AiItemSummary или default: []');
  console.log('aiItemSummaryIndex:', aiItemSummaryIndex);
  console.log('tagsDefaultIndex:', tagsDefaultIndex);
  
  if (aiItemSummaryIndex >= 0) {
    console.log('\nКонтекст вокруг AiItemSummary:');
    for (let i = aiItemSummaryIndex; i < Math.min(aiItemSummaryIndex + 20, lines.length); i++) {
      console.log(`${i + 1}: ${lines[i]}`);
    }
  }
  
  process.exit(1);
}

// Проверяем, не добавлено ли уже поле isVectorized
const contextAfter = lines.slice(tagsDefaultIndex, tagsDefaultIndex + 5).join('\n');
if (contextAfter.includes('isVectorized')) {
  console.log('✓ Поле isVectorized уже присутствует в AiItemSummary');
  process.exit(0);
}

// Вставляем isVectorized после default: []
const newLines = [
  ...lines.slice(0, tagsDefaultIndex + 1),
  '        isVectorized:',
  '          type: boolean',
  '          description: Флаг наличия хотя бы одного embedding для чанков этого ai_item',
  '          default: false',
  ...lines.slice(tagsDefaultIndex + 1)
];

// Сохраняем обновленный файл
fs.writeFileSync(yamlPath, newLines.join('\n'), 'utf8');

console.log('✓ API контракт успешно обновлен!');
console.log('✓ Добавлено поле isVectorized в схему AiItemSummary после строки', tagsDefaultIndex + 1);
console.log('\nДобавленные строки:');
console.log('        isVectorized:');
console.log('          type: boolean');
console.log('          description: Флаг наличия хотя бы одного embedding для чанков этого ai_item');
console.log('          default: false');
