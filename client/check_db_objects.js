// Проверка объектов БД с file_vectors
const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432'),
  database: process.env.PGDATABASE || 'postgres',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD
});

async function check() {
  await client.connect();
  console.log('Connected to database');
  
  // 1. Проверяем все объекты с file_vectors в имени
  const objectsResult = await client.query(`
    SELECT 
      n.nspname as schema,
      c.relname as name,
      CASE c.relkind
        WHEN 'r' THEN 'TABLE'
        WHEN 'v' THEN 'VIEW'
        WHEN 'm' THEN 'MATERIALIZED VIEW'
        WHEN 'i' THEN 'INDEX'
        WHEN 'S' THEN 'SEQUENCE'
        WHEN 's' THEN 'SEQUENCE'
        WHEN 'f' THEN 'FOREIGN TABLE'
        WHEN 'p' THEN 'PARTITIONED TABLE'
        ELSE c.relkind::text
      END as type
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE (c.relname LIKE '%file_vectors%' OR c.relname LIKE '%file_vector%')
    AND n.nspname NOT IN ('pg_catalog', 'information_schema');
  `);
  
  console.log('\n1. Objects with file_vectors in name:');
  if (objectsResult.rows.length === 0) {
    console.log('   None found');
  } else {
    objectsResult.rows.forEach(r => console.log(`   ${r.schema}.${r.name} (${r.type})`));
  }
  
  // 2. Проверяем правила (rules) 
  const rulesResult = await client.query(`
    SELECT rulename, tablename, definition
    FROM pg_rules
    WHERE definition ILIKE '%file_vectors%'
  `);
  
  console.log('\n2. Rules referencing file_vectors:');
  if (rulesResult.rows.length === 0) {
    console.log('   None found');
  } else {
    rulesResult.rows.forEach(r => console.log(`   ${r.rulename} on ${r.tablename}`));
  }
  
  // 3. Проверяем триггеры
  const triggersResult = await client.query(`
    SELECT tgname, relname
    FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    WHERE c.relname = 'chunk_vector' OR c.relname = 'file_vectors'
  `);
  
  console.log('\n3. Triggers on chunk_vector or file_vectors:');
  if (triggersResult.rows.length === 0) {
    console.log('   None found');
  } else {
    triggersResult.rows.forEach(r => console.log(`   ${r.tgname} on ${r.relname}`));
  }
  
  // 4. Тестируем запрос getAllFullAiItems напрямую
  console.log('\n4. Testing getAllFullAiItems query:');
  try {
    const testResult = await client.query(`
      SELECT 
        ai.id AS ai_id,
        ai.full_name,
        ai.type,
        ai.s_name,
        ai.h_name,
        ai.context_code,
        ai.file_id,
        f.filename,
        f.file_url,
        COALESCE(
          json_agg(
            json_build_object(
              'chunk_content', COALESCE(fv.chunk_content->>'text', fv.chunk_content::text),
              'level', fv.level,
              'type', fv.type
            ) ORDER BY fv.chunk_index
          ) FILTER (WHERE fv.id IS NOT NULL),
          '[]'::json
        ) AS chunks
      FROM public.ai_item ai
      JOIN public.files f ON ai.file_id = f.id
      LEFT JOIN public.chunk_vector fv ON fv.ai_item_id = ai.id
      WHERE ai.context_code = 'CARL'
      GROUP BY ai.id, f.id
      LIMIT 1
    `);
    console.log(`   SUCCESS: Query returned ${testResult.rows.length} rows`);
    if (testResult.rows.length > 0) {
      console.log(`   Sample: ${testResult.rows[0].full_name}`);
    }
  } catch (error) {
    console.log(`   ERROR: ${error.message}`);
  }
  
  await client.end();
}

async function checkSchemas() {
  await client.connect();
  
  // Проверяем все схемы с таблицей file_vectors
  const schemasResult = await client.query(`
    SELECT schemaname, tablename 
    FROM pg_tables 
    WHERE tablename = 'file_vectors'
  `);
  
  console.log('\nSchemas with file_vectors table:');
  if (schemasResult.rows.length === 0) {
    console.log('   None found');
  } else {
    schemasResult.rows.forEach(r => console.log(`   ${r.schemaname}.${r.tablename}`));
  }
  
  // Проверяем search_path
  const searchPath = await client.query('SHOW search_path');
  console.log('\nCurrent search_path:', searchPath.rows[0].search_path);
  
  await client.end();
}

if (process.argv[2] === '--schemas') {
  checkSchemas().catch(e => { console.error(e); process.exit(1); });
} else {
  check().catch(e => { console.error(e); process.exit(1); });
}

