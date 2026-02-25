// index.js - Точка входа модуля @kosmos-vector/db-core
// Универсальный Data Access Layer (DAL) для PostgreSQL с pgvector

/**
 * @kosmos-vector/db-core
 * 
 * Модуль для работы с PostgreSQL базой данных.
 * Реализует паттерн Repository для разделения SQL-запросов и бизнес-логики.
 * 
 * Основные компоненты:
 * - Database - менеджер подключений (Client/Pool) с поддержкой транзакций
 * - Migrator - система миграций для управления схемой БД
 * - FilesRepository - работа с таблицей files
 * - VectorRepository - работа с pgvector (chunk_vector, similarity search)
 * - AiItemsRepository - работа с ai_item, ai_comment, tags
 * 
 * @example
 * const { Database, FilesRepository, VectorRepository } = require('@kosmos-vector/db-core');
 * 
 * const db = new Database(process.env.DATABASE_URL);
 * await db.connect();
 * 
 * const filesRepo = new FilesRepository(db);
 * const vectorRepo = new VectorRepository(db);
 * 
 * const file = await filesRepo.createFile({ filename: 'test.js', contextCode: 'MY_PROJECT' });
 * const similar = await vectorRepo.similaritySearch(embedding, { limit: 5, contextCode: 'MY_PROJECT' });
 */

// Core components
const Database = require('./Database');

// Repositories
const FilesRepository = require('./repositories/FilesRepository');
const VectorRepository = require('./repositories/VectorRepository');
const AiItemsRepository = require('./repositories/AiItemsRepository');

// Migration system
const Migrator = require('./Migrator');

module.exports = {
  // Core
  Database,

  // Repositories
  FilesRepository,
  VectorRepository,
  AiItemsRepository,

  // Migrations
  Migrator
};
