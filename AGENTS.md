# AGENTS.md - Development Guidelines for AIAN Vector

This file contains coding guidelines, build commands, and development practices for agentic coding agents working in this repository.

## Как быстро понять систему (протокол для ИИ-агентов)

Порядок получения Понимания системы — от сильного к слабому:

0. **MCP kosmos-vector (предпочтительно).** Если подключён MCP-сервер `../kosmos-vector-mcp` — используй tools вместо прямых HTTP-вызовов и слепого чтения файлов:
   - `ontology_ask` — «как устроено / как связано» (concept-first);
   - `ontology_validate` — консистентность grounding / coverage;
   - `kb_search` — точечный поиск функции/фрагмента кода;
   - `kosmos_health` — доступность backend и сводка.
   Конфиг: `KOSMOS_BASE_URL`, `KOSMOS_CONTEXT_CODE` (см. `../kosmos-vector-mcp/README.md`).
1. **Онтология (верхний уровень знаний).** Понятия домена с отношениями и привязкой (grounding) к коду/таблицам/документам лежат в `../Ontology/concepts/*.md` (формат: `../Ontology/ONTOLOGY_SPEC.md`). Начни с них — это курируемая карта системы, а не пересказ кода.
2. **Спроси систему о ней самой.** Если сервер запущен (порт — PORT в `.env`): `POST /api/ontology/ask?context-code=KOSMOS-VECTOR`, body `{"question": "...", "generateAnswer": false}` — вернёт релевантные понятия, цепочку «понятие → отношение → код» и grounded-контекст. Это точнее самостоятельного поиска по файлам. (Эквивалент MCP: `ontology_ask`.)
3. **KB — оглавление в `KB/README_INDEX.md`.** Тематические README покрывают архитектуру, БД, загрузчики, API.
4. **Актуальность не гарантирована — проверяй.** `GET /api/ontology/validate?context-code=KOSMOS-VECTOR` показывает протухший grounding и битые ссылки; данные в БД могут отставать от кода (`needs_rebuild`). (Эквивалент MCP: `ontology_validate`.)

Правила при изменении кода:

- **«Без ИИ жизни нет!»** — сценарии с обязательным LLM при ошибке модели **останавливаются** и сообщают пользователю; запрещён тихий success без ИИ (эвристика вместо suggest, 200 + answerError и т.п.). Канон: `KB/README_PRINCIPLES.md`.
- Изменил поведение — обнови соответствующий `KB/README_*.md` и строку в `README_INDEX.md`.
- Затронул сущность, на которую ссылается понятие (grounding в `../Ontology/concepts/`), — проверь и поправь файл понятия; после правки понятий: Step1 (onto_loading) + повторная векторизация понятий.
- Новая крупная возможность — запись в `CHANGELOG.md` и строка в корневом `README.md`.

## Project Overview

AIAN Vector is a LangChain RAG server built with Bun/Express, PostgreSQL with pgvector, and a web UI. The project uses a modular architecture with:

- `packages/core/`: Business logic modules (database, embeddings, vector operations)
- `server.js`: Main Express server with REST API
- `tests/`: Comprehensive test suite
- `KB/`: Knowledge base documentation in Russian

## Build and Development Commands

### Primary Commands
```bash
# Install dependencies (Bun workspaces)
bun install

# Start main server with hot-reload
bun start

# Run a specific test (examples below)
bun tests/test_column_extractor.js
bun tests/test_agent_script.js
bun tests/test-epample-ShoppingCart.js
bun tests/test-sql-order-system.js
```

### Testing Commands
```bash
# Individual tests
bun tests/test_column_extractor.js          # Test SQL column extraction
bun tests/test_agent_script.js              # Test Natural Query Engine
bun tests/test-epample-ShoppingCart.js      # Test shopping cart functionality
bun tests/test-sql-order-system.js          # Test SQL order system

# Server tests (require server running)
node tests/full_system_test.js               # Complete system test

# Run all tests via test runner
node tests/run_all_tests.js
```

### No Linting/Type Checking
This project does not use ESLint, Prettier, or TypeScript compilation. Code should follow the conventions described below.

## Code Style Guidelines

### File Structure and Imports
- Use CommonJS modules (`require()`/`module.exports`)
- Place imports at the top of files
- Use relative imports for internal modules: `require('./DbService')`
- Use npm package imports for external dependencies
- Core modules are imported from `packages/core/` using relative paths

### Naming Conventions
- **Files**: PascalCase for classes (`DbService.js`), camelCase for utilities (`fileMatchUtils.js`)
- **Variables**: camelCase (`const dbService`, `function processData()`)
- **Constants**: UPPER_SNAKE_CASE for environment variables and config constants
- **Classes**: PascalCase (`class DbService`, `class PostgresVectorStore`)
- **Database tables/columns**: snake_case (`files`, `context_code`, `created_at`)

### Code Formatting
- Use 2 spaces for indentation (no tabs)
- Maximum line length: ~100 characters
- Use semicolons consistently
- Add blank lines between logical sections
- Keep functions focused and under 50 lines when possible

### Error Handling
- Always use try/catch blocks for async operations
- Use consistent error logging: `console.error('[CONTEXT] Error message:', error)`
- Return meaningful error messages to API consumers
- Use the logger module from `packages/core/logger.js` for structured logging
- Log levels: INFO, WARN, ERROR with context prefixes

### Database Operations
- Use the `DbService` class from `packages/core/DbService.js` for all DB operations
- Always use parameterized queries to prevent SQL injection
- Handle database connection errors gracefully
- Use transactions for multi-step operations
- Close connections properly in error scenarios

### API Development
- REST endpoints should return JSON responses
- Use proper HTTP status codes (200, 400, 404, 500)
- Include error messages in response body for failed requests
- Use middleware for CORS, logging, and error handling
- Follow Express.js patterns and conventions

### Configuration Management
- All configuration via environment variables (.env file)
- Use `require('dotenv').config()` at the top of entry files
- Database configuration: PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD
- Server configuration: PORT, BASE_URL, DOCS_DIR
- Feature flags: USE_OPENAI, etc.

### Testing Patterns
- Write smoke tests for API availability
- Use cleanup patterns to remove test data after runs
- Test both success and error scenarios
- Use descriptive test function names
- Include setup/teardown in test files
- Tests should be idempotent and not interfere with each other

## Project-Specific Patterns

### Vector Operations
- Use `PostgresVectorStore` from core for vector storage
- Embeddings via `EmbeddingsFactory` (supports OpenAI and simple embeddings)
- Vector similarity search with configurable filters
- Chunk text before vectorization using `TextSplitters`

### File Processing
- Support for multiple file types: JS, TS, PHP, SQL, MD, TXT
- Extract entities: classes, functions, methods, interfaces
- Parse L1 dependencies (imports, function calls)
- Store metadata and relationships in database

### Knowledge Base Configuration
- Store configs in `./kb-configs/{context-code}.json`
- Support multiple root paths separated by commas
- Use glob patterns for file inclusion/exclusion
- Manage file selection and metadata

### Logging and Monitoring
- Use structured logging with context prefixes
- Log to files in `logs/` directory with date rotation
- Separate log levels: INFO, WARN, ERROR
- Include timestamps and context information
- SSE streaming for real-time log monitoring

## Important Notes

- This is a Russian-language project (documentation in `KB/` is in Russian)
- Uses Bun runtime (>= 1.0.0) instead of Node.js when possible
- PostgreSQL with pgvector extension is required
- No TypeScript compilation - plain JavaScript only
- No automated linting - follow established patterns manually
- Server runs on port 3005 by default (configurable via PORT env var)
- All database operations should use the provided service classes
- Test data should be cleaned up after test execution
- Environment variables should never be committed to the repository