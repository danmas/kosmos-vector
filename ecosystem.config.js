/**
 * PM2 Ecosystem Configuration
 * Загружает переменные окружения из .env файла
 */
require('dotenv').config();

module.exports = {
  apps: [{
    name: 'kosmos-vector',
    script: 'server.js',
    interpreter: 'bun',
    cwd: __dirname,
    watch: false,
    instances: 1,
    autorestart: true,
    max_restarts: 10,
    restart_delay: 1000,
    
    // Переменные окружения из .env
    env: {
      NODE_ENV: 'development',
      PORT: process.env.PORT || 3200,
      
      // PostgreSQL
      PGUSER: process.env.PGUSER,
      PGHOST: process.env.PGHOST,
      PGDATABASE: process.env.PGDATABASE,
      PGPASSWORD: process.env.PGPASSWORD,
      PGPORT: process.env.PGPORT,
      DATABASE_URL: process.env.DATABASE_URL || 
        `postgresql://${process.env.PGUSER}:${process.env.PGPASSWORD}@${process.env.PGHOST}:${process.env.PGPORT}/${process.env.PGDATABASE}`,
      
      // OpenAI / Embeddings
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      USE_OPENAI: process.env.USE_OPENAI,
      EMBEDDINGS_MODEL: process.env.EMBEDDINGS_MODEL,
      EMBEDDINGS_MODEL_NAME: process.env.EMBEDDINGS_MODEL_NAME,
      
      // LLM
      LLM_API_KEY: process.env.LLM_API_KEY,
      DEFAULT_MODEL_NAME: process.env.DEFAULT_MODEL_NAME,
      DEFAULT_TEMPERATURE: process.env.DEFAULT_TEMPERATURE,
      
      // Server
      BASE_URL: process.env.BASE_URL,
      MAX_RESULTS: process.env.MAX_RESULTS,
      DOCS_DIR: process.env.DOCS_DIR,
      
      // User DB
      POSTGRES_URL: process.env.POSTGRES_URL
    },
    
    env_production: {
      NODE_ENV: 'production'
    }
  }]
};
