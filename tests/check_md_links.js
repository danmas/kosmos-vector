// Проверка связей MD в БД
const { Client } = require('pg');
require('dotenv').config();

const TEST_CONTEXT = 'TEST_MD';

async function checkLinks() {
  const pgClient = new Client({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    database: process.env.PGDATABASE || 'postgres',
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || ''
  });

  try {
    await pgClient.connect();
    console.log('✓ Подключено к БД\n');

    // Проверка follows связей
    const followsQuery = await pgClient.query(`
      SELECT l.source, l.target, lt.code as link_type
      FROM public.link l
      JOIN public.link_type lt ON l.link_type_id = lt.id
      WHERE l.context_code = $1 AND lt.code = 'md_follows'
      ORDER BY l.source
    `, [TEST_CONTEXT]);
    
    console.log('md_follows связи:');
    followsQuery.rows.forEach(row => {
      const sourceParts = row.source.split('##H2:');
      const targetParts = row.target.split('##H2:');
      const sourceH1 = sourceParts[0].split('#H1:')[1] || 'DOC';
      const targetH1 = targetParts[0].split('#H1:')[1] || 'DOC';
      
      console.log(`  ${row.source} (${sourceH1}) → ${row.target} (${targetH1})`);
    });

    console.log(`\nВсего follows связей: ${followsQuery.rows.length}`);

  } catch (error) {
    console.error('Ошибка:', error.message);
  } finally {
    await pgClient.end();
  }
}

checkLinks();
