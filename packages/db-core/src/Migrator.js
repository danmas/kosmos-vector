// Migrator.js - Система миграций для управления схемой БД
// Выполняет SQL-файлы миграций из директории migrations/ последовательно

const fs = require('fs');
const path = require('path');

/**
 * @typedef {Object} MigrationRecord
 * @property {number} id
 * @property {string} name - Имя файла миграции
 * @property {Date} applied_at - Дата применения
 * @property {string|null} checksum - MD5 хеш содержимого файла
 */

/**
 * @typedef {Object} MigrationFile
 * @property {string} name - Имя файла
 * @property {string} path - Полный путь к файлу
 * @property {string} content - Содержимое SQL
 */

/**
 * Система миграций базы данных
 */
class Migrator {
  /**
   * @param {import('./Database')} db - Экземпляр Database
   * @param {Object} [options={}]
   * @param {string} [options.migrationsDir] - Директория с файлами миграций
   * @param {string} [options.tableName='_migrations'] - Имя таблицы для хранения истории миграций
   */
  constructor(db, options = {}) {
    this.db = db;
    this.migrationsDir = options.migrationsDir || path.join(__dirname, 'migrations');
    this.tableName = options.tableName || '_migrations';
  }

  /**
   * Инициализация таблицы миграций
   * @returns {Promise<void>}
   */
  async init() {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS public.${this.tableName} (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        checksum VARCHAR(64)
      )
    `);
    console.log(`[Migrator] Таблица ${this.tableName} готова`);
  }

  /**
   * Получение списка примененных миграций
   * @returns {Promise<MigrationRecord[]>}
   */
  async getAppliedMigrations() {
    try {
      const rows = await this.db.queryAll(
        `SELECT * FROM public.${this.tableName} ORDER BY id`
      );
      return rows;
    } catch (error) {
      // Таблица может не существовать при первом запуске
      if (error.code === '42P01') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Получение списка доступных файлов миграций
   * @returns {Promise<MigrationFile[]>}
   */
  async getAvailableMigrations() {
    if (!fs.existsSync(this.migrationsDir)) {
      console.log(`[Migrator] Директория миграций не существует: ${this.migrationsDir}`);
      return [];
    }

    const files = fs.readdirSync(this.migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort(); // Сортируем по имени (001_, 002_, и т.д.)

    return files.map(filename => ({
      name: filename,
      path: path.join(this.migrationsDir, filename),
      content: fs.readFileSync(path.join(this.migrationsDir, filename), 'utf-8')
    }));
  }

  /**
   * Получение списка ожидающих (не примененных) миграций
   * @returns {Promise<MigrationFile[]>}
   */
  async getPendingMigrations() {
    const applied = await this.getAppliedMigrations();
    const appliedNames = new Set(applied.map(m => m.name));

    const available = await this.getAvailableMigrations();
    return available.filter(m => !appliedNames.has(m.name));
  }

  /**
   * Применение одной миграции
   * @param {MigrationFile} migration
   * @returns {Promise<void>}
   */
  async applyMigration(migration) {
    console.log(`[Migrator] Применение миграции: ${migration.name}`);

    try {
      // Выполняем SQL миграции в транзакции
      await this.db.beginTransaction();

      // Разбиваем содержимое на отдельные команды по точке с запятой
      // Но учитываем, что внутри DO блоков могут быть точки с запятой
      await this.db.query(migration.content);

      // Записываем в таблицу миграций
      await this.db.query(
        `INSERT INTO public.${this.tableName} (name, checksum) VALUES ($1, $2)`,
        [migration.name, this._calculateChecksum(migration.content)]
      );

      await this.db.commit();
      console.log(`[Migrator] ✅ Миграция ${migration.name} успешно применена`);

    } catch (error) {
      await this.db.rollback();
      console.error(`[Migrator] ❌ Ошибка при применении миграции ${migration.name}:`, error.message);
      throw error;
    }
  }

  /**
   * Применение всех ожидающих миграций
   * @returns {Promise<{applied: string[], skipped: string[]}>}
   */
  async migrate() {
    await this.init();

    const pending = await this.getPendingMigrations();

    if (pending.length === 0) {
      console.log('[Migrator] Нет новых миграций для применения');
      return { applied: [], skipped: [] };
    }

    console.log(`[Migrator] Найдено ${pending.length} новых миграций`);

    const applied = [];
    const skipped = [];

    for (const migration of pending) {
      try {
        await this.applyMigration(migration);
        applied.push(migration.name);
      } catch (error) {
        skipped.push(migration.name);
        // Прерываем при первой ошибке
        throw new Error(`Миграция ${migration.name} не удалась: ${error.message}`);
      }
    }

    return { applied, skipped };
  }

  /**
   * Получение статуса миграций
   * @returns {Promise<Object>}
   */
  async status() {
    await this.init();

    const applied = await this.getAppliedMigrations();
    const available = await this.getAvailableMigrations();
    const pending = await this.getPendingMigrations();

    return {
      applied: applied.map(m => ({
        name: m.name,
        appliedAt: m.applied_at
      })),
      pending: pending.map(m => m.name),
      total: available.length,
      appliedCount: applied.length,
      pendingCount: pending.length
    };
  }

  /**
   * Вычисление контрольной суммы содержимого
   * @param {string} content
   * @returns {string}
   */
  _calculateChecksum(content) {
    const crypto = require('crypto');
    return crypto.createHash('md5').update(content).digest('hex');
  }

  /**
   * Создание новой миграции из шаблона
   * @param {string} name - Описание миграции (без номера)
   * @returns {Promise<string>} - Путь к созданному файлу
   */
  async createMigration(name) {
    if (!fs.existsSync(this.migrationsDir)) {
      fs.mkdirSync(this.migrationsDir, { recursive: true });
    }

    const files = fs.readdirSync(this.migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    // Определяем следующий номер
    let nextNumber = 1;
    if (files.length > 0) {
      const lastFile = files[files.length - 1];
      const match = lastFile.match(/^(\d+)_/);
      if (match) {
        nextNumber = parseInt(match[1]) + 1;
      }
    }

    // Формируем имя файла
    const paddedNumber = String(nextNumber).padStart(3, '0');
    const safeName = name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const filename = `${paddedNumber}_${safeName}.sql`;
    const filepath = path.join(this.migrationsDir, filename);

    // Создаем файл с шаблоном
    const template = `-- Миграция: ${name}
-- Создана: ${new Date().toISOString()}

-- Добавьте SQL-команды миграции ниже:

`;

    fs.writeFileSync(filepath, template, 'utf-8');
    console.log(`[Migrator] Создана миграция: ${filepath}`);

    return filepath;
  }
}

module.exports = Migrator;
