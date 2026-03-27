-- Миграция: создание таблицы graph_snapshots для хранения снимков графа
-- Дата: 2026-03-27

-- Создаём sequence для id
CREATE SEQUENCE IF NOT EXISTS kosmos.graph_snapshot_id_seq;

-- Создаём таблицу graph_snapshots
CREATE TABLE IF NOT EXISTS kosmos.graph_snapshot (
    id                  VARCHAR(64)              PRIMARY KEY,
    context_code        TEXT                     NOT NULL,
    name                VARCHAR(200)             NOT NULL,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    data                JSONB                    NOT NULL,
    
    -- data содержит:
    -- nodeIds: string[]
    -- selectedNodeIds: string[]
    -- focusedNodeIds: string[]
    -- hiddenLinkTypes: string[]
    -- nodeCount: number
    -- linkCount: number
    -- previewNodeNames: string[]
    
    CONSTRAINT graph_snapshot_name_check CHECK (char_length(name) >= 1 AND char_length(name) <= 200)
);

-- Комментарий к таблице
COMMENT ON TABLE kosmos.graph_snapshot IS 'Снимки состояния графа для сохранения и восстановления';
COMMENT ON COLUMN kosmos.graph_snapshot.id IS 'Уникальный идентификатор снимка (формат: snap_{timestamp}_{random})';
COMMENT ON COLUMN kosmos.graph_snapshot.context_code IS 'Код контекста базы знаний';
COMMENT ON COLUMN kosmos.graph_snapshot.name IS 'Название/описание снимка';
COMMENT ON COLUMN kosmos.graph_snapshot.created_at IS 'Дата и время создания снимка';
COMMENT ON COLUMN kosmos.graph_snapshot.data IS 'JSON с данными снимка: nodeIds, selectedNodeIds, focusedNodeIds, hiddenLinkTypes, nodeCount, linkCount, previewNodeNames';

-- Индексы
CREATE INDEX IF NOT EXISTS idx_graph_snapshot_context_code 
    ON kosmos.graph_snapshot (context_code);

CREATE INDEX IF NOT EXISTS idx_graph_snapshot_created_at 
    ON kosmos.graph_snapshot (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_graph_snapshot_context_created 
    ON kosmos.graph_snapshot (context_code, created_at DESC);

-- Права доступа (если нужно)
-- ALTER TABLE kosmos.graph_snapshot OWNER TO carl;

-- Вывод для проверки
SELECT 'Table kosmos.graph_snapshot created successfully' AS status;
