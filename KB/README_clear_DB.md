Чтобы очистить базу данных на запущенном сервере (http://localhost:3005), выполните один из следующих HTTP-запросов. Все они требуют обязательного подтверждения через поле `confirm: true`.

### Рекомендуемый способ: полная логическая очистка

```bash
curl -X POST http://localhost:3005/clear-database \
  -H "Content-Type: application/json" \
  -d '{"confirm": true}'
```

**Ожидаемый ответ:**
```json
{
  "success": true,
  "message": "Database has been completely cleared (all files, chunks, and AI items removed).",
  "method": "clearAllTables"
}
```

Это безопасно удалит все файлы, чанки и AI Items, используя обычные `DELETE` с каскадным удалением.

### Альтернатива: очень быстрая жёсткая очистка (TRUNCATE)

Только если вам нужна максимальная скорость (например, при большом объёме данных):

```bash
curl -X POST http://localhost:3005/truncate-database \
  -H "Content-Type: application/json" \
  -d '{"confirm": true}'
```

**Внимание:** Эта операция обходит некоторые проверки и мгновенно очищает всё.

### Дополнительно: очистить только «мусорные» AI Items

Если хотите удалить только те AI Items (классы, функции и т.д.), на которые больше нет ссылок:

```bash
curl -X POST http://localhost:3005/cleanup-orphaned-ai-items \
  -H "Content-Type: application/json" \
  -d '{"confirm": true}'
```

После выполнения любого из этих запросов база данных будет очищена, и вы сможете заново векторизовать файлы.

