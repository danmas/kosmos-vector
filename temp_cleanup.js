const { Client } = require('pg');
require('dotenv').config();

async function cleanup() {
  const pgClient = new Client({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    database: process.env.PGDATABASE || 'postgres',
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || ''
  });

  try {
    await pgClient.connect();
    console.log('Connected to DB');
    
    // Delete links for TEST_MD context
    const linkRes = await pgClient.query('DELETE FROM kosmos.link WHERE context_code = $1 RETURNING *', ['TEST_MD']);
    console.log(`Deleted ${linkRes.rowCount} links`);
    
    // Delete chunks for files in TEST_MD context
    const chunkRes = await pgClient.query(`
      DELETE FROM kosmos.chunk_vector 
      WHERE file_id IN (
        SELECT id FROM kosmos.files WHERE context_code = $1
      ) 
      RETURNING *
    `, ['TEST_MD']);
    console.log(`Deleted ${chunkRes.rowCount} chunks`);
    
    // Delete AI items for TEST_MD context
    const itemRes = await pgClient.query('DELETE FROM kosmos.ai_item WHERE context_code = $1 RETURNING *', ['TEST_MD']);
    console.log(`Deleted ${itemRes.rowCount} AI items`);
    
    // Delete files for TEST_MD context
    const fileRes = await pgClient.query('DELETE FROM kosmos.files WHERE context_code = $1 RETURNING *', ['TEST_MD']);
    console.log(`Deleted ${fileRes.rowCount} files`);
    
    console.log('Cleanup completed successfully');
  } catch (error) {
    console.error('Error during cleanup:', error.message);
  } finally {
    await pgClient.end();
  }
}

cleanup();