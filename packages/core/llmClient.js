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
 * @returns {Object} { KOSMOS_BASE_URL, KOSMOS_API_KEY, KOSMOS_MODEL, KOSMOS_LOGIC_ARHITECT_MODEL }
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
    KOSMOS_BASE_URL: config.KOSMOS_BASE_URL || process.env.KOSMOS_BASE_URL || "http://localhost:3002/v1",
    KOSMOS_API_KEY: process.env.KOSMOS_API_KEY || "",
    KOSMOS_MODEL: config.KOSMOS_MODEL || process.env.KOSMOS_MODEL || "FAST",
    KOSMOS_LOGIC_ARHITECT_MODEL: config.KOSMOS_LOGIC_ARHITECT_MODEL || process.env.KOSMOS_LOGIC_ARHITECT_MODEL || null
  };
}

// Экспортируем геттеры для обратной совместимости
function getKOSMOS_BASE_URL() {
  return getConfig().KOSMOS_BASE_URL;
}

function getKOSMOS_MODEL() {
  return getConfig().KOSMOS_MODEL;
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
 * @param {Object} options - Дополнительные опции
 * @param {boolean} options.jsonMode - Включить JSON mode (response_format: { type: 'json_object' })
 * @returns {Promise<string>} Текстовый ответ от модели
 */
async function callLLM(messages, model = null, options = {}) {
  const { jsonMode = false } = options;
  const temperature =
    options.temperature !== undefined && options.temperature !== null
      ? Number(options.temperature)
      : 0.0;
  // Default output budget: ontology/RAG JSON often needs more than gateway defaults
  const maxTokens =
    options.max_tokens !== undefined && options.max_tokens !== null
      ? Number(options.max_tokens)
      : options.maxTokens !== undefined && options.maxTokens !== null
        ? Number(options.maxTokens)
        : null;
  
  // Читаем конфиг каждый раз
  const config = getConfig();
  const actualModel = model || config.KOSMOS_MODEL;
  
  const headers = {
    "Content-Type": "application/json",
  };
  
  if (config.KOSMOS_API_KEY) {
    headers["Authorization"] = `Bearer ${config.KOSMOS_API_KEY}`;
  }

  try {
    console.log(`📡 Отправка запроса к ${config.KOSMOS_BASE_URL} (Model: ${actualModel})...`);
    console.log('Headers:', headers);
    console.log('Messages:', messages);
    console.log('Model:', actualModel);
    console.log('Temperature:', temperature);
    console.log('JSON Mode:', jsonMode);
    if (maxTokens != null && !isNaN(maxTokens)) {
      console.log('Max tokens:', maxTokens);
    }
    
    const requestBody = {
      model: actualModel,
      messages,
      temperature: isNaN(temperature) ? 0.0 : temperature
    };
    
    // Добавляем response_format для JSON mode
    if (jsonMode) {
      requestBody.response_format = { type: 'json_object' };
    }
    if (maxTokens != null && !isNaN(maxTokens) && maxTokens > 0) {
      requestBody.max_tokens = Math.floor(maxTokens);
    }
    
    const res = await fetch(`${config.KOSMOS_BASE_URL}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`LLM Error ${res.status}: ${errorText}`);
    }

    const json = await res.json();
    
    // Парсинг ответа (стандарт OpenAI)
    const choice = json.choices?.[0];
    const response = choice?.message?.content || "";
    const finishReason = choice?.finish_reason || choice?.finishReason || null;
    if (finishReason) {
      console.log(`   finish_reason: ${finishReason}`);
    }
    
    if (!response) {
      throw new Error(
        `Пустой ответ от модели` +
          (finishReason ? ` (finish_reason=${finishReason})` : ' (структура JSON может отличаться)')
      );
    }
    // Attach for callers that want it (non-enumerable-ish via property on String not possible; use wrapper)
    // Callers read finish_reason from logs; for truncation detection we re-check length + reason in builder.

    // Логируем детальный ответ от LLM
    const responseLength = response.length;
    const newlineCount = (response.match(/\n/g) || []).length;
    console.log(`✅ Ответ от LLM получен:`);
    console.log(`   Длина: ${responseLength} символов`);
    console.log(`   Переводов строк: ${newlineCount}`);
    console.log(`   ${'─'.repeat(60)}`);
    
    // Если ответ не очень длинный (до 2000 символов), выводим полностью
    // Иначе выводим первые 1000 символов и последние 200
    if (responseLength <= 2000) {
      console.log(`   Полный ответ:`);
      response.split('\n').forEach(line => {
        console.log(`   ${line}`);
      });
    } else {
      console.log(`   Первые 1000 символов:`);
      const firstPart = response.substring(0, 1000);
      firstPart.split('\n').forEach(line => {
        console.log(`   ${line}`);
      });
      console.log(`   ... (пропущено ${responseLength - 1200} символов) ...`);
      console.log(`   Последние 200 символов:`);
      const lastPart = response.substring(responseLength - 200);
      lastPart.split('\n').forEach(line => {
        console.log(`   ${line}`);
      });
    }
    console.log(`   ${'─'.repeat(60)}`);

    if (finishReason === 'length') {
      console.warn(
        '⚠️ LLM finish_reason=length — ответ мог быть обрезан (увеличьте max_tokens или сократите запрос)'
      );
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
    
    if (config.KOSMOS_API_KEY) {
      headers["Authorization"] = `Bearer ${config.KOSMOS_API_KEY}`;
    }

    // Отправляем минимальный тестовый запрос
    const res = await fetch(`${config.KOSMOS_BASE_URL}/chat/completions`, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: config.KOSMOS_MODEL,
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
// Для обратной совместимости KOSMOS_BASE_URL и KOSMOS_MODEL доступны как функции
// Используйте getConfig() для получения всех значений сразу
module.exports = {
  callLLM,
  checkLLMAvailability,
  getConfig,
  getKOSMOS_BASE_URL,
  getKOSMOS_MODEL,
  // Для обратной совместимости - свойства как функции
  // В коде используйте: KOSMOS_BASE_URL() вместо KOSMOS_BASE_URL
  KOSMOS_BASE_URL: getKOSMOS_BASE_URL,
  KOSMOS_MODEL: getKOSMOS_MODEL
};

