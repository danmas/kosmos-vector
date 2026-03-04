# Database Module Refactoring Plan

This plan describes the extraction of database logic from the monolithic [DbService.js](file:///c:/ERV/projects-ex/kosmos-vector/packages/core/DbService.js) into a reusable, universal module `packages/db-core`.

## Goal
To resolve the "God Object" anti-pattern in [packages/core/DbService.js](file:///c:/ERV/projects-ex/kosmos-vector/packages/core/DbService.js) by creating a standalone, reusable Data Access Layer (DAL) that can be easily imported into this project and future projects. It will separate SQL queries from business logic.

## Progress Status

| Stage | Status | Description |
|-------|--------|-------------|
| Stage 1 | ✅ COMPLETE | Create db-core package structure (Database.js, index.js) |
| Stage 2 | ✅ COMPLETE | Create Repository classes (Files, Vector, AiItems) |
| Stage 3 | ✅ COMPLETE | Create Migration system (Migrator.js + SQL files) |
| Stage 4 | ✅ COMPLETE | Refactor DbService.js to use db-core repositories |
| Stage 5 | ✅ COMPLETE | Update server.js initialization |
| Stage 6 | ✅ COMPLETE | Run tests and verify functionality |

## User Review Required
> [!IMPORTANT]
> - Should `packages/db-core` use plain JavaScript (CommonJS) like the rest of the project, or should we set it up with TypeScript? 
>   - **Answer:** Using plain JavaScript (CommonJS) to match the existing ecosystem.
> - Should we implement a basic SQL Query Builder like `knex` or stick to raw parameterized `pg` queries inside the repository classes?
>   - **Answer:** Sticking to raw parameterized `pg` queries to minimize dependencies.

## Implemented Architecture

`packages/db-core/` now exports the following components:

1. **[Database.js](file:///c:/ERV/projects-ex/kosmos-vector/packages/db-core/src/Database.js)** - Connection Manager
   - Wrapper around `pg.Client` / `pg.Pool`
   - Transaction support (begin, commit, rollback)
   - Query helpers (`query`, `queryRaw`, `queryOne`, `queryAll`)

2. **[Migrator.js](file:///c:/ERV/projects-ex/kosmos-vector/packages/db-core/src/Migrator.js)** - Migration Runner
   - Reads `.sql` files from `migrations/` directory
   - Tracks applied migrations in `_migrations` table
   - Supports creating new migration files

3. **Repositories:**
   - **[FilesRepository.js](file:///c:/ERV/projects-ex/kosmos-vector/packages/db-core/src/repositories/FilesRepository.js)** - Handles `public.files` table
   - **[VectorRepository.js](file:///c:/ERV/projects-ex/kosmos-vector/packages/db-core/src/repositories/VectorRepository.js)** - Handles `public.chunk_vector` (similarity search, pgvector)
   - **[AiItemsRepository.js](file:///c:/ERV/projects-ex/kosmos-vector/packages/db-core/src/repositories/AiItemsRepository.js)** - Handles `public.ai_item`, `public.ai_comment`, and tags

## Proposed Changes

### 1. New Core Package `packages/db-core`
#### [NEW] `packages/db-core/package.json`
- Define module, workspace dependencies (`pg`).

#### [NEW] `packages/db-core/src/Database.js`
- Connection wrapper for PostgreSQL.

#### [NEW] `packages/db-core/src/migrations/*`
- Extract SQL from [initializeSchema()](file:///c:/ERV/projects-ex/kosmos-vector/packages/core/DbService.js#14-248) into discrete files like `001_initial_schema.sql`, `002_add_file_hash.sql`.
- Create `Migrator.js` to run these sequentially.

#### [NEW] `packages/db-core/src/repositories/*.js`
- Create `FilesRepository.js`, `VectorRepository.js`, `AiItemsRepository.js`.
- Move specific SQL queries from [DbService.js](file:///c:/ERV/projects-ex/kosmos-vector/packages/core/DbService.js) into these repositories.

### 2. Refactoring Existing Components
#### [MODIFY] [packages/core/DbService.js](file:///c:/ERV/projects-ex/kosmos-vector/packages/core/DbService.js)
- **Goal:** Transform into a business logic facade.
- Remove all raw SQL (`this.pgClient.query`).
- Inject `@kosmos-vector/db-core` repositories.
- Keep file system logic (`fs.existsSync`, `fs.statSync`) here, but delegate DB saves to `FilesRepository`.

#### [MODIFY] [server.js](file:///c:/ERV/projects-ex/kosmos-vector/server.js)
- Update initialization to instantiate `Database` and `Migrator` from `@kosmos-vector/db-core`.
- Run migrations on startup.
- Construct [DbService](file:///c:/ERV/projects-ex/kosmos-vector/packages/core/DbService.js#8-3973) by passing the initialized repositories.

## Verification Plan

### Automated Tests
- Run existing project tests: `bun run test-sql-vectorization`, `bun run test-query-access`, etc.
- Verify that standard vectorization and retrieval workflows pass without errors.
- Ensure that the migration runner properly initializes an empty database.

### Manual Verification
- Start the application (`bun start`) and verify that it doesn't crash on schema initialization.
- Test the chat UI to ensure RAG retrieval ([similaritySearch](file:///c:/ERV/projects-ex/kosmos-vector/packages/core/DbService.js#633-732)) accurately returns context.
