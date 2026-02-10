# App Config API - Управление глобальной конфигурацией приложения

## Версия: 2.8.0

Добавлен новый функционал для управления глобальными настройками приложения через REST API.

## Файлы

### Новые файлы:
- `packages/core/appConfigService.js` - сервис для работы с config.json
- `tests/test_app_config.js` - тестовый скрипт для проверки API

### Изменённые файлы:
- `routes/api.js` - добавлены маршруты `/api/config`, `/api/config/reset`
- `docs/api-contract.yaml` - обновлена версия до 2.8.0, добавлены пути
- `docs/openapi/schemas/common.yaml` - добавлены схемы AppConfig, AppConfigResponse, etc.
- `docs/openapi/paths/system.yaml` - добавлены пути для config API

## API Endpoints

### 1. GET /api/config
Получить текущую конфигурацию приложения.

**Не требует `context-code`** (глобальные настройки)

**Response 200:**
```json
{
  "success": true,
  "config": {
    "KOSMOS_BASE_URL": "http://localhost:3002/v1",
    "KOSMOS_MODEL": "FAST",
    "KOSMOS_LOGIC_ARHITECT_MODEL": "INSTRUCT",
    "LOG_LEVEL": "info",
    "NATURAL_QUERY_SUGGEST_LIMIT": 5,
    "NATURAL_QUERY_SIMILARITY_THRESHOLD": 0.8,
    "NATURAL_QUERY_AUTO_USE_THRESHOLD": 0.95
  }
}
```

### 2. PATCH /api/config
Частично обновить конфигурацию (можно передать только изменяемые поля).

**Request Body:**
```json
{
  "KOSMOS_MODEL": "RICH",
  "LOG_LEVEL": "debug"
}
```

**Response 200:**
```json
{
  "success": true,
  "config": { /* обновлённая конфигурация */ },
  "message": "Configuration updated successfully"
}
```

**Response 400 (ошибка валидации):**
```json
{
  "success": false,
  "error": "Configuration validation failed",
  "validationErrors": [
    "KOSMOS_BASE_URL must be a valid URL",
    "LOG_LEVEL must be one of: debug, info, warn, error"
  ]
}
```

### 3. POST /api/config/reset
Сбросить конфигурацию к значениям по умолчанию.

**⚠️ Используйте с осторожностью!**

**Response 200:**
```json
{
  "success": true,
  "config": { /* дефолтная конфигурация */ },
  "message": "Configuration reset to defaults"
}
```

## Валидация

### KOSMOS_BASE_URL
- Тип: `string`
- Валидация: формат URL
- Пример: `http://localhost:3002/v1`

### KOSMOS_MODEL
- Тип: `string`
- Валидация: пока без проверки
- **TODO:** Согласовать список допустимых моделей с проектом `kosmos-model`
- Пример: `FAST`, `RICH`, `INSTRUCT`

### KOSMOS_LOGIC_ARHITECT_MODEL
- Тип: `string | null`
- Валидация: пока без проверки
- **TODO:** Согласовать список допустимых моделей с проектом `kosmos-model`
- Пример: `INSTRUCT`

### LOG_LEVEL
- Тип: `string`
- Валидация: enum
- Допустимые значения: `debug`, `info`, `warn`, `error`
- По умолчанию: `info`

### NATURAL_QUERY_SUGGEST_LIMIT
- Тип: `integer`
- Валидация: от 1 до 100
- По умолчанию: `5`

### NATURAL_QUERY_SIMILARITY_THRESHOLD
- Тип: `number`
- Валидация: от 0 до 1
- По умолчанию: `0.8`

### NATURAL_QUERY_AUTO_USE_THRESHOLD
- Тип: `number`
- Валидация: от 0 до 1
- По умолчанию: `0.95`

## Тестирование

Запустите тестовый скрипт (требуется запущенный сервер на порту 3200):

```bash
bun tests/test_app_config.js
# или
node tests/test_app_config.js
```

Тест проверяет:
1. ✅ Получение текущей конфигурации
2. ✅ Обновление конфигурации
3. ✅ Валидацию URL (должна отклонить невалидный URL)
4. ✅ Валидацию LOG_LEVEL (должна отклонить невалидное значение)
5. ✅ Восстановление оригинальной конфигурации

## Примеры использования

### Изменить модель LLM
```bash
curl -X PATCH http://localhost:3200/api/config \
  -H "Content-Type: application/json" \
  -d '{"KOSMOS_MODEL": "RICH"}'
```

### Изменить URL и уровень логирования
```bash
curl -X PATCH http://localhost:3200/api/config \
  -H "Content-Type: application/json" \
  -d '{
    "KOSMOS_BASE_URL": "http://usa:3002/v1",
    "LOG_LEVEL": "debug"
  }'
```

### Сбросить к дефолтным значениям
```bash
curl -X POST http://localhost:3200/api/config/reset
```

## Важные замечания

1. **Не требует `context-code`** - конфигурация глобальная для всего приложения
2. **Нет автоматической перезагрузки** - изменения сохраняются в `config.json`, но не требуют перезапуска сервера (конфиг читается динамически в `llmClient.js`)
3. **Открытый endpoint** - нет авторизации/аутентификации
4. **Без истории изменений** - не сохраняются бэкапы или история изменений конфига

## Интеграция с Frontend

Frontend может:
1. Получить текущие настройки при загрузке страницы настроек
2. Отобразить форму с валидацией на стороне клиента
3. Отправить PATCH с изменёнными полями
4. Обработать ошибки валидации и показать пользователю

Пример использования в React/Vue:
```javascript
// Получить конфигурацию
const response = await fetch('/api/config');
const { config } = await response.json();

// Обновить конфигурацию
const updateResponse = await fetch('/api/config', {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    KOSMOS_MODEL: 'RICH',
    LOG_LEVEL: 'debug'
  })
});

if (updateResponse.status === 400) {
  const { validationErrors } = await updateResponse.json();
  // Показать ошибки валидации пользователю
}
```

## OpenAPI Contract

Полная спецификация доступна в:
- **Главный контракт:** `docs/api-contract.yaml` (версия 2.8.0)
- **Схемы:** `docs/openapi/schemas/common.yaml` (AppConfig, AppConfigResponse, etc.)
- **Пути:** `docs/openapi/paths/system.yaml` (/api/config, /api/config/reset)

Для генерации единого файла:
```bash
npx @redocly/cli bundle docs/api-contract.yaml -o docs/api-contract-bundled.yaml
```
