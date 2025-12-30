// llmClient.js
// Модуль для взаимодействия с внешним LLM API (kosmos-model)
const { readFileSync, existsSync } = require('fs');
const { join } = require('path');

// === КОНФИГУРАЦИЯ ===
// Путь к config.json
const configPath = join(process.cwd(), 'config.json');

/**
 * Чтение конфигурации из config.json (динамически, каждый раз)
 * Приоритет: config.json > process.env > значения по умолчанию
 * @returns {Object} { LLM_BASE_URL, LLM_API_KEY, LLM_MODEL }
 */
function getConfig() {
  let config = {};
  
  // Читаем config.json каждый раз
  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, 'utf-8'));
    } catch (error) {
      console.warn('⚠️ Ошибка чтения config.json, используем переменные окружения:', error.message);
    }
  }
  
  return {
    LLM_BASE_URL: config.LLM_BASE_URL || process.env.LLM_BASE_URL || "http://localhost:3002/v1",
    LLM_API_KEY: process.env.LLM_API_KEY || "",
    LLM_MODEL: config.LLM_MODEL || process.env.LLM_MODEL || "FAST"
  };
}

// Экспортируем геттеры для обратной совместимости
function getLLM_BASE_URL() {
  return getConfig().LLM_BASE_URL;
}

function getLLM_MODEL() {
  return getConfig().LLM_MODEL;
}

// === ТИПЫ ===
/**
 * @typedef {Object} Message
 * @property {"system" | "user" | "assistant"} role
 * @property {string} content
 */

// === ОСНОВНАЯ ФУНКЦИЯ ===
/**
 * Вызов LLM API для генерации ответа
 * @param {Message[]} messages - Массив сообщений (system, user, assistant)
 * @param {string} model - Имя модели (по умолчанию из конфига)
 * @returns {Promise<string>} Текстовый ответ от модели
 */
async function callLLM(messages, model = null) {
  // Читаем конфиг каждый раз
  const config = getConfig();
  const actualModel = model || config.LLM_MODEL;
  
  const headers = {
    "Content-Type": "application/json",
  };
  
  if (config.LLM_API_KEY) {
    headers["Authorization"] = `Bearer ${config.LLM_API_KEY}`;
  }

  try {
    console.log(`📡 Отправка запроса к ${config.LLM_BASE_URL} (Model: ${actualModel})...`);
    console.log('Headers:', headers);
    console.log('Messages:', messages);
    console.log('Model:', actualModel);
    console.log('Temperature:', 0.3);
    console.log('Max Tokens:', 4096);
    
    const res = await fetch(`${config.LLM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: actualModel,
        messages,
        temperature: 0.0 // Настройте температуру под задачи (0.1 - код, 0.7 - креатив)
        // max_tokens: 4096, // Опционально
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`LLM Error ${res.status}: ${errorText}`);
    }

    const json = await res.json();
    
    // Парсинг ответа (стандарт OpenAI)
    const response = json.choices?.[0]?.message?.content || "";
    
    if (!response) {
      throw new Error("Пустой ответ от модели (структура JSON может отличаться)");
    }

    return response;

  } catch (e) {
    console.error("❌ Ошибка LLM:", e.message);
    throw e;
  }
}

// === ПРОВЕРКА ДОСТУПНОСТИ ===
/**
 * Проверка доступности LLM сервера
 * @param {number} timeout - Таймаут в миллисекундах (по умолчанию 5000)
 * @returns {Promise<boolean>} true если сервер доступен, false иначе
 */
async function checkLLMAvailability(timeout = 5000) {
  try {
    // Читаем конфиг каждый раз
    const config = getConfig();
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const headers = {
      "Content-Type": "application/json",
    };
    
    if (config.LLM_API_KEY) {
      headers["Authorization"] = `Bearer ${config.LLM_API_KEY}`;
    }

    // Отправляем минимальный тестовый запрос
    const res = await fetch(`${config.LLM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: config.LLM_MODEL,
        messages: [{ role: "user", content: "test" }],
        max_tokens: 5, // Минимальный ответ для проверки
      }),
    });

    clearTimeout(timeoutId);

    // Если получили ответ (даже с ошибкой), сервер доступен
    return res.status === 200 || res.status === 400 || res.status === 401 || res.status === 404;
  } catch (error) {
    if (error.name === 'AbortError') {
      console.error(`⏱️ LLM сервер не ответил в течение ${timeout}ms`);
    } else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      console.error(`🔌 LLM сервер недоступен: ${error.message}`);
    } else {
      console.error(`❌ Ошибка проверки LLM: ${error.message}`);
    }
    return false;
  }
}

// Экспорт модуля
// Для обратной совместимости LLM_BASE_URL и LLM_MODEL доступны как функции
// Используйте getConfig() для получения всех значений сразу
module.exports = {
  callLLM,
  checkLLMAvailability,
  getConfig,
  getLLM_BASE_URL,
  getLLM_MODEL,
  // Для обратной совместимости - свойства как функции
  // В коде используйте: LLM_BASE_URL() вместо LLM_BASE_URL
  LLM_BASE_URL: getLLM_BASE_URL,
  LLM_MODEL: getLLM_MODEL
};

