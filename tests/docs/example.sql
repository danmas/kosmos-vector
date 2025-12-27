create table public.chunk_vector
(
    id               uuid                     default gen_random_uuid() not null
        primary key,
    file_url         text                                               not null
        constraint chunk_vector_file_url_pk
            unique,
    embedding        vector(1536),
    created_at       timestamp                default now(),
    dt_file_modified timestamp with time zone default now()             not null
);

comment on column public.chunk_vector.dt_file_modified is 'Когда изменился файл в файловой системе';

alter table public.chunk_vector
    owner to postgres;

create index chunk_vector_embedding_idx
    on public.chunk_vector using ivfflat (embedding);

grant delete, insert, references, select, trigger, truncate, update on public.chunk_vector to anon;

grant delete, insert, references, select, trigger, truncate, update on public.chunk_vector to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.chunk_vector to service_role;


-- Пример SQL-запросов для работы с базой данных

-- Создание таблицы пользователей
CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Создание таблицы категорий
CREATE TABLE categories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    parent_id INT,
    FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE CASCADE
);

-- Создание таблицы статей
CREATE TABLE articles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    author_id INT NOT NULL,
    category_id INT,
    status ENUM('draft', 'published', 'archived') DEFAULT 'draft',
    published_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
);

-- Запрос для получения всех опубликованных статей с информацией об авторе
SELECT a.id, a.title, a.content, a.published_at, u.username as author
FROM articles a
JOIN users u ON a.author_id = u.id
WHERE a.status = 'published'
ORDER BY a.published_at DESC;

-- Запрос для получения статей по категории
SELECT a.id, a.title, a.content, a.published_at, c.name as category
FROM articles a
JOIN categories c ON a.category_id = c.id
WHERE c.name = 'Технологии' AND a.status = 'published'
ORDER BY a.published_at DESC;

-- Запрос для поиска статей по ключевому слову
SELECT a.id, a.title, a.content, a.published_at, u.username as author
FROM articles a
JOIN users u ON a.author_id = u.id
WHERE a.status = 'published' 
AND (a.title LIKE '%искусственный интеллект%' OR a.content LIKE '%искусственный интеллект%')
ORDER BY a.published_at DESC;