// Тест загрузки Markdown файлов через pipeline
const fetch = require('node-fetch');

const BASE_URL = 'http://localhost:3200';
const TEST_CONTEXT = 'TEST_MD';

async function testMdLoading() {
  console.log('=== ТЕСТ ЗАГРУЗКИ MARKDOWN ФАЙЛОВ ===\n');

  try {
    // 1. Проверка здоровья сервера
    console.log('[Шаг 1] Проверка сервера...');
    const healthRes = await fetch(`${BASE_URL}/api/health?context-code=${TEST_CONTEXT}`);
    if (!healthRes.ok) {
      throw new Error(`Сервер не отвечает: ${healthRes.status}`);
    }
    console.log('✓ Сервер доступен\n');

    // 2. Проверка конфигурации
    console.log('[Шаг 2] Проверка kb-config...');
    const configRes = await fetch(`${BASE_URL}/api/kb-config?context-code=${TEST_CONTEXT}`);
    if (!configRes.ok) {
      console.warn('⚠ Конфигурация не найдена, используйте TEST_MD конфиг из kb-configs/');
    } else {
      const config = await configRes.json();
      console.log(`✓ Конфиг загружен: ${config.metadata?.name || TEST_CONTEXT}`);
      console.log(`  rootPath: ${config.rootPath}`);
      console.log(`  includeMask: ${config.includeMask}\n`);
    }

    // 3. Очистка старых данных
    console.log('[Шаг 3] Очистка старых AI Items...');
    try {
      const deleteRes = await fetch(`${BASE_URL}/api/items/cleanup?context-code=${TEST_CONTEXT}`, {
        method: 'POST'
      });
      if (deleteRes.ok) {
        const result = await deleteRes.json();
        console.log(`✓ Очищено: ${result.deletedCount || 0} элементов\n`);
      }
    } catch (err) {
      console.log('⚠ Очистка пропущена:', err.message, '\n');
    }

    // 4. Запуск pipeline
    console.log('[Шаг 4] Запуск pipeline для загрузки MD файлов...');
    const pipelineRes = await fetch(`${BASE_URL}/api/pipeline/run?context-code=${TEST_CONTEXT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!pipelineRes.ok) {
      const errorText = await pipelineRes.text();
      throw new Error(`Pipeline failed: ${pipelineRes.status} - ${errorText}`);
    }

    const pipelineResult = await pipelineRes.json();
    console.log('✓ Pipeline запущен');
    console.log(`  Session ID: ${pipelineResult.sessionId || 'N/A'}\n`);

    // Ждём завершения
    console.log('⏳ Ожидание завершения pipeline (макс. 30 сек)...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // 5. Проверка результатов - AI Items
    console.log('\n[Шаг 5] Проверка созданных AI Items...\n');

    // md_doc
    const mdDocRes = await fetch(`${BASE_URL}/api/items?context-code=${TEST_CONTEXT}&type=md_doc`);
    if (mdDocRes.ok) {
      const mdDocs = await mdDocRes.json();
      console.log(`✓ md_doc элементов: ${mdDocs.items?.length || 0}`);
      if (mdDocs.items?.[0]) {
        console.log(`  - ${mdDocs.items[0].id}`);
      }
    }

    // H1
    const h1Res = await fetch(`${BASE_URL}/api/items?context-code=${TEST_CONTEXT}&type=head_level_1`);
    if (h1Res.ok) {
      const h1Items = await h1Res.json();
      console.log(`✓ head_level_1 элементов: ${h1Items.items?.length || 0}`);
      h1Items.items?.slice(0, 3).forEach(item => {
        console.log(`  - ${item.id} (${item.h_name})`);
      });
    }

    // H2
    const h2Res = await fetch(`${BASE_URL}/api/items?context-code=${TEST_CONTEXT}&type=head_level_2`);
    if (h2Res.ok) {
      const h2Items = await h2Res.json();
      console.log(`✓ head_level_2 элементов: ${h2Items.items?.length || 0}`);
      h2Items.items?.slice(0, 5).forEach(item => {
        console.log(`  - ${item.id} (${item.h_name})`);
      });
    }

    // 6. Проверка связей
    console.log('\n[Шаг 6] Проверка связей...\n');
    
    if (h2Res.ok) {
      const h2Items = await h2Res.json();
      if (h2Items.items?.[0]) {
        const firstH2 = h2Items.items[0];
        const itemDetailRes = await fetch(
          `${BASE_URL}/api/items/${encodeURIComponent(firstH2.id)}?context-code=${TEST_CONTEXT}`
        );
        
        if (itemDetailRes.ok) {
          const itemDetail = await itemDetailRes.json();
          console.log(`Связи для "${firstH2.h_name}":`);
          console.log(`  l1_out (исходящие): ${itemDetail.l1_out?.length || 0}`);
          if (itemDetail.l1_out?.length > 0) {
            itemDetail.l1_out.slice(0, 3).forEach(link => {
              console.log(`    → ${link.target} (${link.link_type})`);
            });
          }
          console.log(`  l1_in (входящие): ${itemDetail.l1_in?.length || 0}`);
          if (itemDetail.l1_in?.length > 0) {
            itemDetail.l1_in.slice(0, 3).forEach(link => {
              console.log(`    ← ${link.source} (${link.link_type})`);
            });
          }
        }
      }
    }

    // 7. Проверка chunks
    console.log('\n[Шаг 7] Проверка chunks...\n');
    const chunksRes = await fetch(`${BASE_URL}/api/chunks?context-code=${TEST_CONTEXT}&limit=10`);
    if (chunksRes.ok) {
      const chunks = await chunksRes.json();
      console.log(`✓ Всего chunks: ${chunks.total || chunks.length || 0}`);
      if (chunks.chunks || chunks.items) {
        const chunkList = chunks.chunks || chunks.items || [];
        console.log(`  Первые 3 чанка:`);
        chunkList.slice(0, 3).forEach(chunk => {
          console.log(`    - ${chunk.full_name || chunk.h_name || 'N/A'} (level: ${chunk.level})`);
        });
      }
    }

    console.log('\n=== ТЕСТ ЗАВЕРШЁН УСПЕШНО ✓ ===\n');

  } catch (error) {
    console.error('\n❌ ОШИБКА:', error.message);
    console.error('\nStack trace:', error.stack);
    process.exit(1);
  }
}

// Запуск
testMdLoading();
