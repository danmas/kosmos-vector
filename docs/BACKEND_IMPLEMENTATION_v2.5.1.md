# 🔥 Backend Implementation Guide v2.5.1
## Bulk Tags Operations API

### 📋 **Краткое описание**
Добавлены новые эндпоинты для массовых операций с тегами, позволяющие эффективно управлять тегами множества AiItems одновременно.

---

## 🎯 **Новые API эндпоинты**

### 1. **POST /api/ai-items/bulk/tags/add**
**Массовое добавление тегов к AiItems**

#### Request:
```json
{
  "itemIds": ["utils.fetchData", "api.createUser", "db.saveRecord"],
  "tagCodes": ["deprecated", "needs-review"]
}
```

#### Response (200):
```json
{
  "success": true,
  "processedItems": 15,
  "failedItems": [
    {
      "itemId": "nonexistent.function",
      "error": "Item not found"
    }
  ]
}
```

#### Логика реализации:
```sql
-- Псевдокод для добавления тегов
FOR each itemId IN request.itemIds:
  FOR each tagCode IN request.tagCodes:
    IF ai_item EXISTS AND tag EXISTS:
      INSERT IGNORE INTO ai_item_tags (item_id, tag_id, context_code)
      VALUES (itemId, tagId, contextCode)
    ELSE:
      ADD to failedItems array
```

### 2. **POST /api/ai-items/bulk/tags/remove**
**Массовое удаление тегов у AiItems**

#### Request:
```json
{
  "itemIds": ["utils.fetchData", "api.createUser", "db.saveRecord"],
  "tagCodes": ["deprecated", "needs-review"]
}
```

#### Response (200):
```json
{
  "success": true,
  "processedItems": 15,
  "failedItems": []
}
```

#### Логика реализации:
```sql
-- Псевдокод для удаления тегов
FOR each itemId IN request.itemIds:
  FOR each tagCode IN request.tagCodes:
    DELETE FROM ai_item_tags 
    WHERE item_id = itemId 
      AND tag_id = (SELECT id FROM tags WHERE code = tagCode AND context_code = contextCode)
      AND context_code = contextCode
```

---

## ⚙️ **Технические требования**

### **Валидация входных данных:**
- `itemIds`: массив строк, минимум 1 элемент
- `tagCodes`: массив строк, минимум 1 элемент
- `context-code`: обязательный query параметр

### **Обработка ошибок:**
- **400 Bad Request**: пустые массивы или невалидные данные
- **404 Not Found**: один или несколько тегов не существуют
- **500 Internal Server Error**: ошибки базы данных

### **Производительность:**
- Использовать batch операции для вставки/удаления
- Максимальный размер массива itemIds: **100 элементов**
- Максимальный размер массива tagCodes: **50 элементов**
- Timeout операции: **30 секунд**

---

## 🔧 **Пример реализации (Node.js/Express)**

```javascript
// POST /api/ai-items/bulk/tags/add
app.post('/api/ai-items/bulk/tags/add', async (req, res) => {
  const { itemIds, tagCodes } = req.body;
  const contextCode = req.query['context-code'];
  
  // Валидация
  if (!itemIds?.length || !tagCodes?.length) {
    return res.status(400).json({
      success: false,
      error: 'itemIds and tagCodes arrays must not be empty'
    });
  }
  
  if (itemIds.length > 100 || tagCodes.length > 50) {
    return res.status(400).json({
      success: false,
      error: 'Arrays exceed maximum allowed size'
    });
  }
  
  try {
    let processedItems = 0;
    const failedItems = [];
    
    // Получаем все существующие теги одним запросом
    const tags = await db.query(`
      SELECT id, code FROM tags 
      WHERE code IN (${tagCodes.map(() => '?').join(',')}) 
        AND context_code = ?
    `, [...tagCodes, contextCode]);
    
    const tagMap = new Map(tags.map(t => [t.code, t.id]));
    
    // Проверяем, что все теги существуют
    const missingTags = tagCodes.filter(code => !tagMap.has(code));
    if (missingTags.length > 0) {
      return res.status(404).json({
        success: false,
        error: `Tags not found: ${missingTags.join(', ')}`
      });
    }
    
    // Выполняем массовую операцию
    for (const itemId of itemIds) {
      try {
        // Проверяем существование AiItem
        const itemExists = await db.query(
          'SELECT 1 FROM ai_items WHERE full_name = ? AND context_code = ?',
          [itemId, contextCode]
        );
        
        if (!itemExists.length) {
          failedItems.push({
            itemId,
            error: 'Item not found'
          });
          continue;
        }
        
        // Добавляем теги (используем INSERT IGNORE для idempotency)
        for (const tagCode of tagCodes) {
          const tagId = tagMap.get(tagCode);
          await db.query(`
            INSERT IGNORE INTO ai_item_tags (item_full_name, tag_id, context_code)
            VALUES (?, ?, ?)
          `, [itemId, tagId, contextCode]);
        }
        
        processedItems++;
      } catch (error) {
        failedItems.push({
          itemId,
          error: error.message
        });
      }
    }
    
    res.json({
      success: true,
      processedItems,
      ...(failedItems.length > 0 && { failedItems })
    });
    
  } catch (error) {
    console.error('Bulk tags operation failed:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// POST /api/ai-items/bulk/tags/remove - аналогичная логика с DELETE вместо INSERT
```

---

## 🗃️ **Структура базы данных**

### **Предполагаемая схема:**
```sql
-- Таблица тегов
CREATE TABLE tags (
  id INT PRIMARY KEY AUTO_INCREMENT,
  code VARCHAR(50) NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT NULL,
  context_code VARCHAR(50) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_code_per_context (code, context_code)
);

-- Связь между AiItem и тегами
CREATE TABLE ai_item_tags (
  id INT PRIMARY KEY AUTO_INCREMENT,
  item_full_name VARCHAR(255) NOT NULL,
  tag_id INT NOT NULL,
  context_code VARCHAR(50) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE,
  UNIQUE KEY unique_item_tag (item_full_name, tag_id, context_code)
);

-- Индексы для производительности
CREATE INDEX idx_ai_item_tags_context ON ai_item_tags(context_code);
CREATE INDEX idx_ai_item_tags_item ON ai_item_tags(item_full_name, context_code);
```

---

## 🧪 **Тестирование**

### **Unit тесты:**
```javascript
describe('Bulk Tags API', () => {
  test('should add tags to multiple items', async () => {
    const response = await request(app)
      .post('/api/ai-items/bulk/tags/add?context-code=TEST')
      .send({
        itemIds: ['test.function1', 'test.function2'],
        tagCodes: ['deprecated', 'needs-review']
      });
    
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.processedItems).toBeGreaterThan(0);
  });
  
  test('should handle non-existent items gracefully', async () => {
    const response = await request(app)
      .post('/api/ai-items/bulk/tags/add?context-code=TEST')
      .send({
        itemIds: ['nonexistent.function'],
        tagCodes: ['deprecated']
      });
    
    expect(response.status).toBe(200);
    expect(response.body.failedItems).toHaveLength(1);
    expect(response.body.failedItems[0].error).toBe('Item not found');
  });
});
```

---

## 📝 **Чек-лист реализации**

- [ ] **Реализовать POST /api/ai-items/bulk/tags/add**
- [ ] **Реализовать POST /api/ai-items/bulk/tags/remove**
- [ ] **Добавить валидацию входных данных**
- [ ] **Обработать все возможные ошибки**
- [ ] **Оптимизировать производительность (batch операции)**
- [ ] **Написать unit тесты**
- [ ] **Написать integration тесты**
- [ ] **Обновить документацию API**
- [ ] **Проверить производительность на больших объемах данных**
- [ ] **Добавить логирование операций**

---

## ⚡ **Оптимизации**

### **Batch операции:**
```javascript
// Вместо множества отдельных INSERT
for (const itemId of itemIds) {
  for (const tagCode of tagCodes) {
    await db.query('INSERT IGNORE INTO ai_item_tags...');
  }
}

// Используйте один большой batch INSERT
const values = [];
for (const itemId of itemIds) {
  for (const tagCode of tagCodes) {
    values.push([itemId, tagMap.get(tagCode), contextCode]);
  }
}

await db.query(`
  INSERT IGNORE INTO ai_item_tags (item_full_name, tag_id, context_code)
  VALUES ${values.map(() => '(?, ?, ?)').join(', ')}
`, values.flat());
```

### **Кэширование:**
- Кэшировать карту `tagCode -> tagId` на уровне приложения
- Использовать Redis для кэширования часто запрашиваемых тегов

---

## 🚨 **Важные моменты**

1. **Идемпотентность**: операции должны быть безопасными для повторного вызова
2. **Атомарность**: используйте транзакции для больших batch операций
3. **Контекст-изоляция**: все операции изолированы по `context-code`
4. **Производительность**: тестируйте на реальных объемах данных
5. **Логирование**: логируйте все массовые операции для аудита

---

## 📞 **Контакты**
При возникновении вопросов по реализации обращайтесь к фронтенд команде.

**Frontend Team**: Реализация UI для массовых операций завершена ✅  
**Backend Team**: Требуется реализация API эндпоинтов 🔄