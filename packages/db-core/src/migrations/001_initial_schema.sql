-- Миграция: Initial Schema
-- Создана: Начальная схема базы данных для kosmos-vector
-- Извлечено из DbService.initializeSchema()

-- =========================================
-- Расширение pgvector
-- =========================================
CREATE EXTENSION IF NOT EXISTS vector;

-- =========================================
-- Таблица files (информация о файлах)
-- =========================================
CREATE TABLE IF NOT EXISTS public.files (
  id SERIAL PRIMARY KEY,
  filename TEXT NOT NULL,
  file_url TEXT,
  content TEXT,
  context_code TEXT NOT NULL DEFAULT 'DEFAULT',
  file_hash TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  modified_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Уникальное ограничение на filename + context_code
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'files_filename_context_code_unique'
  ) THEN
    ALTER TABLE public.files ADD CONSTRAINT files_filename_context_code_unique UNIQUE (filename, context_code);
  END IF;
END $$;

-- =========================================
-- Таблица ai_item (AI элементы)
-- =========================================
CREATE TABLE IF NOT EXISTS public.ai_item (
  id SERIAL PRIMARY KEY,
  full_name TEXT NOT NULL,
  context_code TEXT NOT NULL DEFAULT 'DEFAULT',
  file_id INTEGER REFERENCES public.files(id) ON DELETE SET NULL,
  type TEXT,
  s_name TEXT,
  h_name TEXT,
  content_hash TEXT,
  needs_rebuild BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Индексы для ai_item
CREATE INDEX IF NOT EXISTS idx_ai_item_full_name ON public.ai_item(full_name);
CREATE INDEX IF NOT EXISTS idx_ai_item_context_code ON public.ai_item(context_code);
CREATE INDEX IF NOT EXISTS idx_ai_item_needs_rebuild ON public.ai_item (context_code, needs_rebuild) WHERE needs_rebuild = true;

-- =========================================
-- Таблица chunk_vector (векторы чанков)
-- =========================================
CREATE TABLE IF NOT EXISTS public.chunk_vector (
  id SERIAL PRIMARY KEY,
  file_id INTEGER REFERENCES public.files(id) ON DELETE CASCADE,
  ai_item_id INTEGER REFERENCES public.ai_item(id) ON DELETE SET NULL,
  parent_chunk_id INTEGER REFERENCES public.chunk_vector(id) ON DELETE CASCADE,
  chunk_content JSONB NOT NULL,
  content JSONB,
  embedding VECTOR,
  chunk_index INTEGER,
  type TEXT DEFAULT 'текст',
  level TEXT DEFAULT '0-исходник',
  s_name TEXT,
  h_name TEXT,
  full_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE
);

-- Индексы для chunk_vector
CREATE INDEX IF NOT EXISTS idx_chunk_vector_file_id ON public.chunk_vector(file_id);
CREATE INDEX IF NOT EXISTS idx_chunk_vector_parent_chunk_id ON public.chunk_vector(parent_chunk_id);
CREATE INDEX IF NOT EXISTS idx_chunk_vector_ai_item_id ON public.chunk_vector(ai_item_id);

-- =========================================
-- Таблица ai_comment (комментарии к AI элементам)
-- =========================================
CREATE TABLE IF NOT EXISTS public.ai_comment (
  id SERIAL PRIMARY KEY,
  context_code TEXT NOT NULL,
  full_name TEXT NOT NULL,
  comment TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(context_code, full_name)
);

CREATE INDEX IF NOT EXISTS idx_ai_comment_context_full_name 
  ON public.ai_comment(context_code, full_name);

-- =========================================
-- Таблица tag (теги)
-- =========================================
CREATE TABLE IF NOT EXISTS public.tag (
  id SERIAL PRIMARY KEY,
  context_code TEXT NOT NULL,
  code VARCHAR(50) NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(context_code, code)
);

-- =========================================
-- Таблица ai_item_tag (связь AI элементов и тегов)
-- =========================================
CREATE TABLE IF NOT EXISTS public.ai_item_tag (
  ai_item_full_name TEXT NOT NULL,
  ai_item_context_code TEXT NOT NULL,
  tag_id INTEGER REFERENCES public.tag(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (ai_item_full_name, ai_item_context_code, tag_id)
);

-- =========================================
-- Таблица link_type (типы связей)
-- =========================================
CREATE TABLE IF NOT EXISTS public.link_type (
  id SERIAL PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Начальные типы связей
INSERT INTO public.link_type (code, name, description)
VALUES 
  ('import', 'Import', 'Import statement'),
  ('call', 'Function Call', 'Function or method call'),
  ('extends', 'Extends', 'Class inheritance'),
  ('implements', 'Implements', 'Interface implementation'),
  ('uses', 'Uses', 'General usage dependency'),
  ('reference', 'Reference', 'General reference')
ON CONFLICT (code) DO NOTHING;

-- =========================================
-- Таблица link (связи между элементами)
-- =========================================
CREATE TABLE IF NOT EXISTS public.link (
  id SERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  target TEXT NOT NULL,
  context_code TEXT NOT NULL,
  link_type_id INTEGER REFERENCES public.link_type(id) ON DELETE SET NULL,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source, target, context_code, link_type_id)
);

CREATE INDEX IF NOT EXISTS idx_link_source ON public.link(source);
CREATE INDEX IF NOT EXISTS idx_link_target ON public.link(target);
CREATE INDEX IF NOT EXISTS idx_link_context ON public.link(context_code);

-- =========================================
-- Таблица agent_script (скрипты агента - Natural Query Engine)
-- =========================================
CREATE TABLE IF NOT EXISTS public.agent_script (
  id SERIAL PRIMARY KEY,
  context_code TEXT NOT NULL,
  question TEXT NOT NULL,
  script TEXT NOT NULL,
  is_valid BOOLEAN DEFAULT false,
  usage_count INTEGER DEFAULT 0,
  last_result JSONB,
  question_embedding VECTOR(1536),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(context_code, question)
);

CREATE INDEX IF NOT EXISTS idx_agent_script_context ON public.agent_script(context_code);
CREATE INDEX IF NOT EXISTS idx_agent_script_valid ON public.agent_script(context_code, is_valid);
