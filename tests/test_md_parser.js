// Простой тест парсера MD
const fs = require('fs');
const path = require('path');

const TEST_FILE = path.join(__dirname, 'test_data', 'test_simple.md');

function parseMdStructure(mdContent, filePath) {
  const lines = mdContent.split('\n');
  const structure = {
    mdDoc: null,
    h1Sections: []
  };

  const headings = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h1Match = line.match(/^#\s+(.+)$/);
    const h2Match = line.match(/^##\s+(.+)$/);

    console.log(`Строка ${i}: "${line}"`);
    console.log(`  h1Match: ${h1Match ? 'YES' : 'NO'} ${h1Match ? h1Match[1] : ''}`);
    console.log(`  h2Match: ${h2Match ? 'YES' : 'NO'} ${h2Match ? h2Match[1] : ''}`);
    console.log(`  startsWith ##: ${line.startsWith('##')}`);

    if (h1Match && !line.startsWith('##')) {
      console.log(`  → Добавляем H1: ${h1Match[1]}`);
      headings.push({
        level: 1,
        title: h1Match[1].trim(),
        lineIndex: i
      });
    } else if (h2Match) {
      console.log(`  → Добавляем H2: ${h2Match[1]}`);
      headings.push({
        level: 2,
        title: h2Match[1].trim(),
        lineIndex: i
      });
    }
  }

  console.log(`\n[ИТОГО] Найдено заголовков: ${headings.length}`);
  headings.forEach(h => {
    console.log(`  H${h.level}: "${h.title}" (строка ${h.lineIndex})`);
  });
  
  return structure;
}

// Запуск
const content = fs.readFileSync(TEST_FILE, 'utf8');
console.log('=== ТЕСТ ПАРСЕРА MD ===\n');
console.log(`Файл: ${TEST_FILE}\n`);
parseMdStructure(content, TEST_FILE);
