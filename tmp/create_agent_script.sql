-- Миграция: создание таблицы agent_script для Natural Query Engine
-- Выполнить один раз в БД

-- Таблица для кэширования сгенерированных скриптов
CREATE TABLE IF NOT EXISTS public.agent_script (
    id serial PRIMARY KEY,
    context_code text NOT NULL,
    question text NOT NULL,
    script text NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    usage_count int DEFAULT 0,
    is_valid boolean DEFAULT false
);

-- Уникальный индекс: один вопрос на контекст
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_script_unique 
    ON public.agent_script (context_code, question);

-- FTS индекс для поиска похожих вопросов на русском
CREATE INDEX IF NOT EXISTS idx_agent_script_question_fts 
    ON public.agent_script USING gin (to_tsvector('russian', question));

-- Триггер автообновления updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Применяем триггер (если ещё нет)
DROP TRIGGER IF EXISTS trg_agent_script_updated_at ON public.agent_script;
CREATE TRIGGER trg_agent_script_updated_at
    BEFORE UPDATE ON public.agent_script
    FOR EACH ROW
    EXECUTE PROCEDURE public.update_updated_at();

-- Права доступа (опционально, для Supabase)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_script TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_script TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_script TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.agent_script_id_seq TO anon;
GRANT USAGE, SELECT ON SEQUENCE public.agent_script_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.agent_script_id_seq TO service_role;

-- Проверка
SELECT 'agent_script table created successfully' as status;

