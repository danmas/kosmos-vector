-- Миграция: добавление колонки question_embedding в таблицу agent_script
-- Выполнить один раз в БД

-- Добавляем колонку для эмбеддинга вопроса
ALTER TABLE public.agent_script 
ADD COLUMN IF NOT EXISTS question_embedding vector(1536);

-- Создаём индекс для векторного поиска (IVFFlat для cosine similarity)
CREATE INDEX IF NOT EXISTS idx_agent_script_question_embedding 
    ON public.agent_script 
    USING ivfflat (question_embedding vector_cosine_ops)
    WITH (lists = 100);

-- Комментарий к колонке
COMMENT ON COLUMN public.agent_script.question_embedding 
IS 'Вектор эмбеддинга вопроса для семантического поиска (1536 измерений)';

-- Проверка
SELECT 'question_embedding column added successfully' as status;
