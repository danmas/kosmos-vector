-- Скрипт для исправления функции find_similar_documents
-- Заменит все упоминания file_vectors на chunk_vector

-- Сначала получаем определение функции
DO $$
DECLARE
    func_def TEXT;
    new_def TEXT;
BEGIN
    -- Получаем текущее определение функции
    SELECT pg_get_functiondef(oid) INTO func_def
    FROM pg_proc
    WHERE proname = 'find_similar_documents'
    AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
    LIMIT 1;
    
    IF func_def IS NOT NULL THEN
        -- Заменяем file_vectors на chunk_vector
        new_def := REPLACE(func_def, 'file_vectors', 'chunk_vector');
        new_def := REPLACE(new_def, 'FILE_VECTORS', 'CHUNK_VECTOR');
        
        -- Выводим новое определение для проверки
        RAISE NOTICE 'Новое определение функции:';
        RAISE NOTICE '%', new_def;
    ELSE
        RAISE NOTICE 'Функция find_similar_documents не найдена';
    END IF;
END $$;

-- Показываем текущее определение функции
SELECT 
    p.proname AS function_name,
    pg_get_functiondef(p.oid) AS function_definition
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
AND p.proname = 'find_similar_documents';

