# Инструкция по интеграции с сервером AI моделей (README_AI_MODEL_integration)

Этот документ описывает архитектурный подход и техническую реализацию взаимодействия с внешним сервером ИИ (AI Server), используемую в проекте. Инструкция предназначена для разработчиков, желающих внедрить аналогичный механизм в свои проекты.

## 1. Архитектурный обзор

Взаимодействие строится по классической клиент-серверной архитектуре.

*   **Клиент (Ваше приложение):** Формирует контекст (историю сообщений), отправляет HTTP-запрос и обрабатывает текстовый ответ.
*   **AI Server:** Внешний сервис, предоставляющий API (обычно совместимый с OpenAI API). Это может быть облачный провайдер (OpenAI, Anthropic) или локальный сервер (LM Studio, Oobabooga, vLLM, LocalAI).

**Преимущества подхода:**
*   **Унификация:** Использование формата OpenAI API (`/v1/chat/completions`) позволяет легко менять бэкенд (модели) без изменения кода клиента.
*   **Контроль:** Централизованная конфигурация параметров (temperature, model) в одном месте.
*   **Отладка:** Логирование всех запросов и ответов в файл истории (`history.json`) позволяет анализировать поведение модели.

## 2. Предварительные требования

*   Node.js (v18+) или Bun (рекомендуется).
*   Доступ к работающему AI Server (URL и, опционально, API Key).

## 3. Пошаговая реализация

Ниже приведен полный код необходимых модулей. Вы можете скопировать их в свой проект.

### Шаг 1: Конфигурация (`env.ts`)

В .env добавьте ключ
 KOSMOS_API_KEY=<KOSMOS_MODEL_KEY>

Создайте config.json
```json
{
  "KOSMOS_BASE_URL": "http://localhost:3002/v1",
  "KOSMOS_MODEL": "FAST",
  "LOG_LEVEL": "info",
}
```

Создайте файл для управления настройками. Он должен уметь читать переменные окружения и/или локальный файл конфигурации.

```typescript
// env.ts
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// Путь к конфигу
const configPath = join(process.cwd(), 'config.json');
let config: any = {};

// Приоритет: config.json > process.env > значения по умолчанию
if (existsSync(configPath)) {
  try {
    config = JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch (error) {
    console.warn('⚠️ Ошибка чтения config.json, используем дефолтные значения');
  }
}

export const KOSMOS_BASE_URL = config.KOSMOS_BASE_URL || process.env.KOSMOS_BASE_URL || "http://localhost:1234/v1"; // Пример для LM Studio
export const KOSMOS_API_KEY = process.env.KOSMOS_API_KEY || ""; 
export const KOSMOS_MODEL = config.KOSMOS_MODEL || process.env.KOSMOS_MODEL || "local-model"; // Имя модели
```

### Шаг 2: Клиент API (`llm.ts`)

Это ядро интеграции. Модуль отвечает за отправку запросов и сохранение истории.

```typescript
// llm.ts
import { KOSMOS_BASE_URL, KOSMOS_API_KEY, KOSMOS_MODEL } from "./env";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

// === ТИПЫ ===
export type Message = { 
    role: "system" | "user" | "assistant"; 
    content: string 
};

interface HistoryEntry {
  timestamp: string;
  model: string;
  messages: Message[];
  response: string;
  error?: string;
}

// === ЛОГИРОВАНИЕ (HISTORY) ===
const HISTORY_FILE = join(process.cwd(), "history.json");

function loadHistory(): HistoryEntry[] {
  if (!existsSync(HISTORY_FILE)) return [];
  try {
    return JSON.parse(readFileSync(HISTORY_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function saveHistory(entry: HistoryEntry) {
  // В продакшене лучше использовать append или потоковую запись
  // Для локальной разработки JSON массив удобен для чтения
  const history = loadHistory();
  history.push(entry);
  writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), "utf-8");
}

// === ОСНОВНАЯ ФУНКЦИЯ ===
export async function callLLM(messages: Message[], model = KOSMOS_MODEL): Promise<string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  
  if (KOSMOS_API_KEY) {
    headers["Authorization"] = `Bearer ${KOSMOS_API_KEY}`;
  }

  const timestamp = new Date().toISOString();
  
  try {
    console.log(`📡 Отправка запроса к ${KOSMOS_BASE_URL} (Model: ${model})...`);
    
    const res = await fetch(`${KOSMOS_BASE_URL}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.3, // Настройте температуру под задачи (0.1 - код, 0.7 - креатив)
        // max_tokens: 4096, // Опционально
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      saveHistory({ timestamp, model, messages, response: "", error: errorText });
      throw new Error(`LLM Error ${res.status}: ${errorText}`);
    }

    const json = await res.json();
    
    // Парсинг ответа (стандарт OpenAI)
    const response = json.choices?.[0]?.message?.content || "";
    
    if (!response) {
       throw new Error("Пустой ответ от модели (структура JSON может отличаться)");
    }

    // Сохраняем успешный запрос
    saveHistory({ timestamp, model, messages, response });
    
    return response;

  } catch (e: any) {
    console.error("❌ Ошибка LLM:", e.message);
    if (!e.message.startsWith("LLM Error")) {
      // Сохраняем ошибки сети/парсинга
      saveHistory({ timestamp, model, messages, response: "", error: e.message });
    }
    throw e;
  }
}
```

## 4. Пример использования

Как внедрить вызов ИИ в бизнес-логику:

```typescript
import { callLLM, Message } from "./llm";

async function generateCodeTask(userGoal: string) {
    const messages: Message[] = [
        { 
            role: "system", 
            content: "Ты опытный программист. Твоя задача - писать чистый код на TypeScript." 
        },
        { 
            role: "user", 
            content: `Напиши функцию для: ${userGoal}` 
        }
    ];

    try {
        const code = await callLLM(messages);
        console.log("Сгенерированный код:\n", code);
    } catch (error) {
        console.error("Не удалось сгенерировать код.");
    }
}

// Запуск
generateCodeTask("Сортировки массива пузырьком");
```

## 5. Рекомендации и нюансы

1.  **Таймауты:** `fetch` по умолчанию не имеет таймаута в старых версиях Node.js. При использовании `Bun` или современных Node.js используйте `AbortController` для прерывания зависших запросов, если сервер моделей отвечает слишком долго.
2.  **Стриминг:** Текущая реализация ждет полного ответа (`await res.json()`). Для длинных генераций лучше использовать Stream API (Server-Sent Events), чтобы показывать ответ пользователю по мере поступления токенов.
3.  **Контекст:** Следите за размером контекста (`messages`). Если массив сообщений станет слишком большим, модель вернет ошибку превышения токенов. Реализуйте функцию обрезки истории (сохранять только последние N сообщений или системный промпт + последние).
4.  **Обработка JSON:** Если вы просите модель вернуть JSON, добавьте в `callLLM` валидацию ответа через `try-catch JSON.parse()`, так как модели иногда добавляют лишний текст (например "Вот ваш JSON: ...").

## 6. Структура `history.json`

Файл истории автоматически создается в корне проекта и выглядит так:

```json
[
  {
    "timestamp": "2023-10-27T10:00:00.000Z",
    "model": "gpt-4-local",
    "messages": [...],
    "response": "function bubbleSort() { ... }",
    "error": null
  }
]
```

