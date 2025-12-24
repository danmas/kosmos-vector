# UI руководство для AIAN Vector

UI — статическая SPA (без сборщика) в папке `public/`. Подключается в `server.js` через `express.static` и открывается на корне `/`.

Главные файлы:

- `public/index.html` — разметка вкладок Вопросы/Документы + все модальные окна
- `public/index.js` — логика вкладок, загрузки данных, обработчики действий
- `public/js/server-info.js` — обновляет заголовок страницы информацией о сервере
- `public/js/aiItem.js` — просмотр чанков AI Item, экспорт чанков в файлы
- `public/styles.css` — стили

## Структура экрана

- Заголовок: динамически меняется на `{appName} ({host}:{port})`
- Вкладки:
  - Вопросы (работает с `/ask`)
  - Документы (работает с `/files` и операциями векторизации)

### Вкладка «Вопросы»

Элементы:

- Фильтр контекста: селект `/context-codes`
- Фильтр по типу чанка: фиксированный список (текст, function, table, ...)
- Фильтр по уровню: `0-исходник | 1-связи | 2-логика`
- Контейнер кнопок моделей AI: подгружается из `/api/available-models` или `GET /api/config`
- Поле вопроса, чекбокс «Показать детали», селект «Количество результатов» (3/5/7/10/15)
- Кнопка «Получить ответ» — отправляет POST `/ask` с параметрами и выбранной моделью

Формируемый запрос к `/ask` содержит:

- `question`, `contextCode` (из фильтра), опционально: `showDetails`, `maxResults`, `chunkType`, `chunkLevel`, `model`

Ответ отображается в блоке «Ответ», с бейджем выбранного контекста.

### Вкладка «Документы»

Элементы:

- Кнопка «Обновить список» — запрос `GET /files`
- Поле пути «Путь к папке документов» и кнопка «Сканировать папку» — `POST /scan-folder`
- Таблица документов: Имя/Тип/Размер/Статус/Контекст/Чанков/Изменён/Действия
  - Действия на строке (часть реализована в `index.js`):
    - Просмотр чанков: `GET /file-chunks/:filename` (откроет модал «Просмотр чанков»)
    - Просмотр содержимого: `GET /file-content/:filename` (модал «Содержимое файла»)
    - Векторизовать: открывает модал «Настройка параметров векторизации»
    - Удалить: `DELETE /file/:filename` или `POST /delete-file`

#### Модал «Настройка параметров векторизации»

Позволяет задать:

- Базовые: `chunkSize`, `chunkOverlap`, `separator` (newline|paragraph|space|sentence|section|custom)
- Если `section`: появится поле `sectionMarker` (например, `SECTION:`)
- Тип/Уровень чанков и `contextCode`
- Специфичные блоки по типу файла (определяются по расширению)
  - JS/TS: `includeComments`, `parseImports`
  - MD: `headingLevels` (H1..H6), `codeBlocks` (inline|separate|ignore)
  - SQL: `defaultSchema`
  - Java: `includeJavadoc`

UI вызывает POST `/vectorize/:filename` с телом `{ params, contextCode }`. Сервер ожидает `vectorizationParams`, но параллельно предусмотрен эндпоинт `POST /vectorize` (без `:filename`), где тело `{ fileName, contextCode, params }` обрабатывается напрямую. Для неизменённого UI рекомендуем использовать `POST /vectorize` в интеграциях.

#### Модал «Просмотр чанков файла»

- Загружает `GET /file-chunks/:filename` и показывает список чанков с id, type, level, именами `s_name/h_name/full_name` и привязкой к `ai_item_id`.

#### Модал «SQL-векторизация файла»

- Вкладки: Уровень 0/1/2
- L0: деление на SQL-объекты + векторизация (`POST /vectorize-sql/:filename`)
- L1/L2: формирование чанков через внешний AI-сервер (`/api/send-request`) и сохранение через `/save-level-chunk-db`

#### Модал «AI Item»

- Просмотр метаданных AI Item и связанных чанков по уровням
- Кнопки «Создать чанки уровня 1/2» с выбором модели и промптов; прогресс и результаты
- Кнопка «Сохранить в файл» в шапке каждого чанка — вызывает `window.saveChunkToFile(content, type, sName, level)`, что уходит на `POST /api/v1/save-chunk-file` и создаёт файл `type#sName#level.md` в `OUTPUT_DOCS_DIR`

## Конфигурация UI

`public/js/server-info.js` экспортирует:

- `initServerInfo({ endpoint, headerSelector, headerTemplate, appName, updateDelay, enableLogging })`

По умолчанию тянет `GET /server-info` и заполняет заголовок. При ошибке берёт `window.location` как fallback.

## Типовые сценарии

1) Добавить файлы в `DOCS_DIR`, просканировать каталог, векторизовать по одному из модалов.
2) Задать вопрос во вкладке «Вопросы», использовать фильтры контекста/типа/уровня.
3) Для SQL — L0/L1/L2: сначала `/vectorize-sql/:filename`, затем создавать уровни через AI и сохранять в БД.
4) Создавать AI Item из чанка и работать далее через модал AI Item.

## Советы

- Для больших JS/MD файлов корректно подбирайте `chunkSize/chunkOverlap`.
- Для MD с кодом лучше `codeBlocks: separate` при аналитике.
- Для SQL используйте корректный `defaultSchema`.


