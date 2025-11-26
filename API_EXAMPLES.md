# API Examples - Примеры использования

**API Версия: 2.1.1**

## Базовые операции

### Проверка статуса
```bash
curl http://localhost:3200/api/health
```

Ответ:
```json
{
  "status": "ok",
  "timestamp": "2025-01-20T12:00:00Z",
  "version": "2.1.1"
}
```

### Получить все AI элементы
```bash
curl http://localhost:3200/api/items
```

### Получить статистику
```bash
curl http://localhost:3200/api/stats
```

## RAG Chat

### Задать вопрос системе
```bash
curl -X POST http://localhost:3200/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Как работает функция parse_self_to_ai_items?"}'
```

## Project Management (v2.1.1)

### Получить дерево файлов проекта
```bash
curl "http://localhost:3200/api/project/tree?rootPath=/app/projects/my-app&depth=10"
```

### Сохранить выборку файлов
```bash
curl -X POST http://localhost:3200/api/project/selection \
  -H "Content-Type: application/json" \
  -d '{
    "rootPath": "/app/projects/my-app",
    "files": [
      "./src/utils/api.ts",
      "./src/components/Button.tsx",
      "./backend/main.py"
    ]
  }'
```

## Pipeline Management

### Запустить новый pipeline
```bash
# Без параметров (использует текущую конфигурацию)
curl -X POST http://localhost:3200/api/pipeline/start \
  -H "Content-Type: application/json" \
  -d '{}'

# С принудительным пересканированием
curl -X POST http://localhost:3200/api/pipeline/start \
  -H "Content-Type: application/json" \
  -d '{"forceRescan": true}'
```

**Важно:** Pipeline использует конфигурацию из `/api/kb-config`. Если `fileSelection` не пуст, используются только эти файлы. Иначе применяются `includeMask` и `ignorePatterns`.

### Получить список всех pipeline
```bash
curl http://localhost:3200/api/pipeline
```

### Проверить статус pipeline
```bash
curl http://localhost:3200/api/pipeline/pipeline_1643025600123
```

### Получить прогресс pipeline
```bash
curl http://localhost:3200/api/pipeline/pipeline_1643025600123/progress
```

### Отменить pipeline
```bash
curl -X DELETE http://localhost:3200/api/pipeline/pipeline_1643025600123
```

## Knowledge Base Configuration

### Получить текущие настройки
```bash
curl http://localhost:3200/api/kb-config
```

Ответ:
```json
{
  "success": true,
  "config": {
    "rootPath": "/app/projects/my-app",
    "includeMask": "**/*.{py,js,ts,tsx,go,java}",
    "ignorePatterns": "**/node_modules/**,**/venv/**,**/__pycache__/**,**/dist/**",
    "fileSelection": [
      "./src/utils/api.ts",
      "./src/components/Button.tsx"
    ],
    "metadata": {
      "projectName": "My Awesome App",
      "description": "Full-stack монолит"
    },
    "lastUpdated": "2025-01-20T12:00:00Z"
  }
}
```

### Обновить настройки (классический способ с glob-масками)
```bash
curl -X POST http://localhost:3200/api/kb-config \
  -H "Content-Type: application/json" \
  -d '{
    "rootPath": "/app/projects/my-app",
    "includeMask": "**/*.{py,js,ts,tsx,go,java}",
    "ignorePatterns": "**/tests/**,**/venv/**,**/node_modules/**"
  }'
```

### Обновить настройки (новый способ с точной выборкой)
```bash
curl -X POST http://localhost:3200/api/kb-config \
  -H "Content-Type: application/json" \
  -d '{
    "rootPath": "/app/projects/my-app",
    "fileSelection": [
      "./src/utils/api.ts",
      "./src/components/Button.tsx",
      "./backend/main.py"
    ],
    "metadata": {
      "projectName": "My Awesome App",
      "tags": ["react", "fastapi"]
    }
  }'
```

**Приоритет:** Если `fileSelection` не пуст, он имеет приоритет над `includeMask` и `ignorePatterns`.

## Логи и файлы

### Получить логи сервера
```bash
# Все логи
curl http://localhost:3200/api/logs

# Только ошибки
curl "http://localhost:3200/api/logs?level=ERROR&limit=50"

# Логи с фильтром по времени
curl "http://localhost:3200/api/logs?since=2025-01-20T10:00:00Z&limit=100"
```

### Получить структуру файлов (DEPRECATED)
```bash
# ⚠️ УСТАРЕВШИЙ ЭНДПОИНТ - используйте /api/project/tree
curl http://localhost:3200/api/files
```

**Рекомендация:** Используйте `/api/project/tree` для получения дерева файлов с правильной схемой данных.

## Server-Sent Events (SSE)

### Подписаться на логи в реальном времени
```javascript
const eventSource = new EventSource('http://localhost:3200/api/logs/stream');

eventSource.addEventListener('log', function(event) {
    const logData = JSON.parse(event.data);
    console.log('New log:', logData);
});

eventSource.addEventListener('heartbeat', function(event) {
    console.log('Heartbeat:', event.data);
});
```

### Отслеживать прогресс pipeline
```javascript
const pipelineId = 'pipeline_1643025600123';
const eventSource = new EventSource(`http://localhost:3200/api/pipeline/${pipelineId}/stream`);

eventSource.addEventListener('progress', function(event) {
    const progress = JSON.parse(event.data);
    console.log('Pipeline progress:', progress);
    // { id: "...", status: "running", timestamp: "..." }
});

eventSource.addEventListener('heartbeat', function(event) {
    console.log('Heartbeat:', event.data);
});

// Закрываем при завершении
eventSource.addEventListener('error', function(event) {
    console.error('SSE error:', event);
    eventSource.close();
});
```

## OpenAPI спецификация

### Получить в YAML формате
```bash
curl http://localhost:3200/api/contract
```

### Получить в JSON формате
```bash
curl "http://localhost:3200/api/contract?format=json"
```

## Swagger UI

После запуска сервера, Swagger UI доступен по адресу:
```
http://localhost:3200/docs
```

Там можно интерактивно тестировать все endpoints с примерами запросов и ответов.

## Полезные команды

### Запуск с автоперезагрузкой
```bash
uvicorn main:app --port 3200 --reload --host 0.0.0.0
```

### Проверка версии API
```bash
curl http://localhost:3200/api/health | jq '.version'
```

## Типичный workflow (v2.1.1)

### 1. Настройка проекта
```bash
# Получить дерево файлов
curl "http://localhost:3200/api/project/tree?rootPath=/app/projects/my-app" > tree.json

# Выбрать нужные файлы и сохранить выборку
curl -X POST http://localhost:3200/api/project/selection \
  -H "Content-Type: application/json" \
  -d '{
    "rootPath": "/app/projects/my-app",
    "files": ["./src/main.ts", "./src/utils.ts"]
  }'
```

### 2. Запуск pipeline
```bash
# Pipeline автоматически использует сохранённую выборку
curl -X POST http://localhost:3200/api/pipeline/start \
  -H "Content-Type: application/json" \
  -d '{}'
```

### 3. Мониторинг
```bash
# Получить список pipeline
curl http://localhost:3200/api/pipeline

# Проверить статус
curl http://localhost:3200/api/pipeline/{pipeline_id}

# Отслеживать прогресс через SSE (см. пример выше)
```


