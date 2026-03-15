// Database.js - Универсальный менеджер подключений к PostgreSQL
// Обёртка над pg.Client / pg.Pool с поддержкой транзакций

const { Client, Pool } = require('pg');

/**
 * @typedef {Object} DatabaseConfig
 * @property {string} [connectionString] - DATABASE_URL строка подключения
 * @property {string} [host] - Хост БД
 * @property {number} [port] - Порт БД
 * @property {string} [database] - Имя БД
 * @property {string} [user] - Пользователь БД
 * @property {string} [password] - Пароль БД
 * @property {boolean} [usePool=false] - Использовать Pool вместо Client
 * @property {number} [maxPoolSize=10] - Максимальный размер пула соединений
 */

/**
 * Менеджер подключений к PostgreSQL
 * Поддерживает как одиночное соединение (Client), так и пул (Pool)
 */
class Database {
  /**
   * @param {DatabaseConfig|string} config - Конфигурация или строка подключения
   */
  constructor(config) {
    // Поддержка внедрения готового Pool/Client
    if (config && (config instanceof Pool || config instanceof Client)) {
      this.config = {};
      this.connection = config;
      this.connected = true;
      this.usePool = config instanceof Pool;
      this._externalConnection = true;
      this.maxPoolSize = 10;
      this._transactionClient = null;
      return;
    }

    // Нормализация конфигурации
    if (typeof config === 'string') {
      this.config = { connectionString: config };
    } else {
      this.config = config || {};
    }

    this.usePool = this.config.usePool || false;
    this.maxPoolSize = this.config.maxPoolSize || 10;
    this._externalConnection = false;

    /** @type {Client|Pool|null} */
    this.connection = null;

    /** @type {boolean} */
    this.connected = false;

    /** @type {Client|null} - Клиент транзакции для изоляции */
    this._transactionClient = null;
  }

  /**
   * Подключение к базе данных
   * @returns {Promise<void>}
   */
  async connect() {
    if (this.connected) {
      return;
    }

    try {
      if (this.usePool) {
        this.connection = new Pool({
          connectionString: this.config.connectionString,
          host: this.config.host,
          port: this.config.port,
          database: this.config.database,
          user: this.config.user,
          password: this.config.password,
          options: this.config.options || '-csearch_path=kosmos,public',
          max: this.maxPoolSize,
          idleTimeoutMillis: 10000,
          connectionTimeoutMillis: 10000
        });
        this.connection.on('error', (err) => {
          console.error('[Database Pool] Idle client error:', err.message);
        });
        const testClient = await this.connection.connect();
        testClient.release();
      } else {
        this.connection = new Client({
          connectionString: this.config.connectionString,
          host: this.config.host,
          port: this.config.port,
          database: this.config.database,
          user: this.config.user,
          password: this.config.password,
          options: this.config.options || '-csearch_path=kosmos,public'
        });
        await this.connection.connect();
      }

      this.connected = true;
      console.log(`[Database] Подключено к PostgreSQL (${this.usePool ? 'Pool' : 'Client'})`);
    } catch (error) {
      console.error('[Database] Ошибка подключения:', error.message);
      throw error;
    }
  }

  /**
   * Отключение от базы данных
   * @returns {Promise<void>}
   */
  async disconnect() {
    if (!this.connected || !this.connection) {
      return;
    }
    if (this._externalConnection) {
      return;
    }

    try {
      await this.connection.end();
      this.connected = false;
      this.connection = null;
      console.log('[Database] Отключено от PostgreSQL');
    } catch (error) {
      console.error('[Database] Ошибка отключения:', error.message);
      throw error;
    }
  }

  /**
   * Выполнение SQL-запроса
   * @param {string} sql - SQL-запрос
   * @param {Array} [params=[]] - Параметры запроса
   * @returns {Promise<import('pg').QueryResult>}
   */
  async query(sql, params = []) {
    if (!this.connected) {
      throw new Error('[Database] Не подключен к базе данных. Вызовите connect() перед выполнением запросов.');
    }

    // Если активна транзакция, используем её клиент
    const client = this._transactionClient || this.connection;

    try {
      return await client.query(sql, params);
    } catch (error) {
      console.error('[Database] Ошибка запроса:', error.message);
      console.error('[Database] SQL:', sql.substring(0, 200));
      throw error;
    }
  }

  /**
   * Выполнение "сырого" SQL-запроса (алиас для query)
   * Используется в Natural Query Engine и других инструментах
   * @param {string} sql - SQL-запрос
   * @param {Array} [params=[]] - Параметры запроса
   * @returns {Promise<import('pg').QueryResult>}
   */
  async queryRaw(sql, params = []) {
    return this.query(sql, params);
  }

  /**
   * Получение одной строки (первой) из результата запроса
   * @param {string} sql - SQL-запрос
   * @param {Array} [params=[]] - Параметры запроса
   * @returns {Promise<Object|null>} - Первая строка или null
   */
  async queryOne(sql, params = []) {
    const result = await this.query(sql, params);
    return result.rows.length > 0 ? result.rows[0] : null;
  }

  /**
   * Получение всех строк из результата запроса
   * @param {string} sql - SQL-запрос
   * @param {Array} [params=[]] - Параметры запроса
   * @returns {Promise<Array>}
   */
  async queryAll(sql, params = []) {
    const result = await this.query(sql, params);
    return result.rows;
  }

  // ==================== Транзакции ====================

  /**
   * Начало транзакции
   * @returns {Promise<void>}
   */
  async beginTransaction() {
    if (this._transactionClient) {
      throw new Error('[Database] Транзакция уже активна');
    }

    if (this.usePool) {
      // Для Pool: получаем отдельный клиент для транзакции
      this._transactionClient = await this.connection.connect();
      await this._transactionClient.query('BEGIN');
    } else {
      // Для Client: используем тот же клиент
      this._transactionClient = this.connection;
      await this._transactionClient.query('BEGIN');
    }

    console.log('[Database] Транзакция начата');
  }

  /**
   * Фиксация транзакции
   * @returns {Promise<void>}
   */
  async commit() {
    if (!this._transactionClient) {
      throw new Error('[Database] Нет активной транзакции для фиксации');
    }

    try {
      await this._transactionClient.query('COMMIT');
      console.log('[Database] Транзакция зафиксирована');
    } finally {
      if (this.usePool && this._transactionClient !== this.connection) {
        this._transactionClient.release();
      }
      this._transactionClient = null;
    }
  }

  /**
   * Откат транзакции
   * @returns {Promise<void>}
   */
  async rollback() {
    if (!this._transactionClient) {
      throw new Error('[Database] Нет активной транзакции для отката');
    }

    try {
      await this._transactionClient.query('ROLLBACK');
      console.log('[Database] Транзакция откачена');
    } finally {
      if (this.usePool && this._transactionClient !== this.connection) {
        this._transactionClient.release();
      }
      this._transactionClient = null;
    }
  }

  /**
   * Выполнение функции в транзакции с автоматическим commit/rollback
   * @template T
   * @param {() => Promise<T>} fn - Функция для выполнения в транзакции
   * @returns {Promise<T>}
   */
  async transaction(fn) {
    await this.beginTransaction();
    try {
      const result = await fn();
      await this.commit();
      return result;
    } catch (error) {
      await this.rollback();
      throw error;
    }
  }

  // ==================== Утилиты ====================

  /**
   * Проверка подключения (health check)
   * @returns {Promise<boolean>}
   */
  async isHealthy() {
    try {
      const result = await this.query('SELECT 1 as health');
      return result.rows[0].health === 1;
    } catch (error) {
      return false;
    }
  }

  /**
   * Получение информации о подключении
   * @returns {Object}
   */
  getConnectionInfo() {
    return {
      connected: this.connected,
      usePool: this.usePool,
      maxPoolSize: this.usePool ? this.maxPoolSize : null,
      hasActiveTransaction: !!this._transactionClient
    };
  }

  /**
   * Получение "сырого" pg Client/Pool для обратной совместимости
   * @returns {Client|Pool|null}
   */
  getClient() {
    return this.connection;
  }
}

module.exports = Database;
