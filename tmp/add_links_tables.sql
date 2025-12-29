-- Миграция: добавление таблиц для дублирования связей (link + link_type)
-- Запускать через tmp/migrate.js или вручную

-- Справочник типов связей
CREATE TABLE IF NOT EXISTS public.link_type (
    id          serial PRIMARY KEY,
    code        text NOT NULL UNIQUE,
    label       text NOT NULL,
    description text,
    is_active   boolean DEFAULT true,
    created_at  timestamp DEFAULT current_timestamp,
    updated_at  timestamp DEFAULT current_timestamp
);

-- Функция для updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = current_timestamp;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Триггеры
DROP TRIGGER IF EXISTS trg_link_type_updated_at ON public.link_type;
CREATE TRIGGER trg_link_type_updated_at
    BEFORE UPDATE ON public.link_type
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Таблица связей
CREATE TABLE IF NOT EXISTS public.link (
    id                serial PRIMARY KEY,
    context_code      text NOT NULL,
    source            text NOT NULL,
    target            text NOT NULL,
    link_type_id      integer NOT NULL REFERENCES public.link_type(id),
    file_id           uuid,

    created_at        timestamp DEFAULT current_timestamp,
    updated_at        timestamp DEFAULT current_timestamp
);

DROP TRIGGER IF EXISTS trg_link_updated_at ON public.link;
CREATE TRIGGER trg_link_updated_at
    BEFORE UPDATE ON public.link
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Индексы
CREATE INDEX IF NOT EXISTS idx_link_context_source ON public.link(context_code, source);
CREATE INDEX IF NOT EXISTS idx_link_context_target ON public.link(context_code, target);
CREATE INDEX IF NOT EXISTS idx_link_context_type   ON public.link(context_code, link_type_id);
CREATE INDEX IF NOT EXISTS idx_link_context_target_type ON public.link(context_code, target, link_type_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_link_unique 
    ON public.link(context_code, source, target, link_type_id);

-- Начальные данные в справочник
INSERT INTO public.link_type (code, label, description)
VALUES
('calls',        'calls',        'Function calls another function'),
('reads_from',   'reads from',   'SELECT / FROM / JOIN table'),
('updates',      'updates',      'UPDATE table'),
('inserts_into', 'inserts into', 'INSERT INTO table'),
('imports',      'imports',      'JS/TS import module or symbol'),
('depends_on',   'depends on',   'General dependency (reserved)')
ON CONFLICT (code) DO NOTHING;

COMMIT;